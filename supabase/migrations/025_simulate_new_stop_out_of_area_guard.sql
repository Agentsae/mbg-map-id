-- ============================================================
-- GeoTransit Insight — 025_simulate_new_stop_out_of_area_guard.sql
--
-- KENAPA MIGRATION INI ADA (temuan lanjutan, sejalan 021):
-- get_tdi_breakdown sudah dapat guard "di luar cakupan grid" di
-- 021_get_tdi_breakdown_out_of_bounds.sql. simulate_new_stop (003 -> 012)
-- BELUM. Akibatnya klik jauh di luar area beranalisis / di luar kota tetap
-- mengembalikan proyeksi walk-time yang menyesatkan:
--   * Titik di laut (lon 107,30 lat -6,10) mengembalikan
--     estimasi_pengurangan_waktu_tempuh_menit ~478,9 dengan transit terdekat
--     ~38 km. Angkanya konsisten dengan metode garis-lurus yang
--     didokumentasikan, tapi "penghematan" ~480 menit untuk klik di laut
--     jelas menyesatkan pembaca laporan.
--
-- PERUBAHAN: CREATE OR REPLACE simulate_new_stop dengan GUARD LUAR AREA di
-- awal fungsi, MENIRU pendekatan 021:
--   ambang_luar_area_m = 500 m. Alasan angka ini (sama dengan 021):
--     - Sel grid 300 m; diagonal ~424 m. Titik di celah antar-sel atau tepat
--       di tepi luar grid berjarak <= ~150-260 m dari centroid sel terdekat
--       -> tetap di jalur normal.
--     - Titik > 500 m dari centroid sel MANA PUN berarti > 1 lebar sel di luar
--       area beranalisis (grid dibatasi ke area berpenduduk / footprint
--       bangunan OSM oleh build_fishnet_grid.py) -> tidak ada dasar data untuk
--       proyeksi penduduk terlayani / walk-time.
--   Saat jarak ke centroid sel grid TERDEKAT > 500 m (atau grid_analisis
--   kosong) -> kembalikan:
--     { lokasi, di_luar_area_analisis:true, jarak_ke_grid_terdekat_m,
--       ambang_luar_area_m, catatan }
--   BUKAN objek hasil normal.
--
-- KENAPA PAKAI JARAK-KE-GRID, BUKAN JUGA ST_Contains(batas_administrasi):
-- 021 memakai HANYA jarak-ke-sel-grid. Menambah "OR di luar poligon
-- batas_administrasi" berisiko meregresikan titik in-grid yang sah tapi
-- kebetulan jatuh di sliver antar-poligon batas (presisi geometri RBI) ->
-- melanggar syarat "perilaku in-area harus byte-identical". Jarak-ke-grid
-- > 500 m sudah menangkap semua kasus uji (laut ~38 km, luar kota jauh,
-- Mustika Jaya PRD ~2,2 km) dan nol risiko regresi untuk titik in-grid.
-- Boolean `di_dalam_batas_kota` tetap dilaporkan sebagai INFO di payload
-- luar-area (dihitung hanya di cabang itu -> tidak menyentuh jalur normal).
--
-- PERILAKU JALUR NORMAL (titik in-area / <= 500 m dari grid): IDENTIK dengan
-- 012 — termasuk titik yang benar-benar in-grid tapi tak berpenduduk yang
-- memang sah mengembalikan penduduk_terlayani_* = 0. Bentuk output, nama
-- kunci, pembulatan, sumber populasi (grid_analisis diprorata luas irisan),
-- estimasi delta waktu tempuh: TIDAK berubah satu byte pun.
--
-- URUTAN FILE: migration ke-025, setelah 024_equity_rekomendasi_retier_ahp.sql.
-- Perubahan vs sebelumnya: HANYA badan simulate_new_stop (tambah 1 guard
-- jarak di awal). Signature (lat float, lon float), hak akses (EXECUTE ke
-- PUBLIC by default, tidak diubah), dan bentuk output jalur normal identik
-- dengan 012. Tidak ada DDL tabel/kolom, tidak menyentuh data atau RLS.
-- ============================================================

create or replace function simulate_new_stop(lat float, lon float)
returns json
language plpgsql
security definer   -- jalan dengan hak akses fungsi, bisa baca tabel meski RLS aktif
as $$
declare
    titik geography := ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography;
    circle_400 geometry := ST_Buffer(titik, 400)::geometry;
    circle_800 geometry := ST_Buffer(titik, 800)::geometry;
    penduduk_400m numeric;
    penduduk_800m numeric;
    jarak_transit_terdekat float;
    nama_transit_terdekat text;
    faskes_400m int;
    sekolah_400m int;
    delta_waktu_tempuh_menit numeric;
    asumsi_kecepatan_jalan_kaki_m_per_menit constant numeric := 80; -- ~4.8 km/jam
    ambang_luar_area_m constant numeric := 500;  -- cermin 021: > 1 lebar sel grid (300 m) di luar area beranalisis
    jarak_grid_terdekat_m numeric;
    di_dalam_batas_kota boolean;
begin
    -- GUARD LUAR AREA ANALISIS (cermin 021_get_tdi_breakdown_out_of_bounds.sql).
    -- grid_analisis hanya dibangun pada area berpenduduk (footprint bangunan OSM,
    -- dasymetric). Titik yang > ambang dari centroid sel grid TERDEKAT tidak
    -- punya dasar data untuk proyeksi penduduk terlayani / walk-time -> kembalikan
    -- penanda di_luar_area_analisis, BUKAN angka yang menyesatkan (mis. klik di
    -- laut menghasilkan "penghematan" ~479 menit). <-> pakai index GIST
    -- idx_grid_analisis_geom (sama seperti 021).
    select round(ST_Distance(ST_Centroid(g.geom)::geography, titik)::numeric, 0)
      into jarak_grid_terdekat_m
    from grid_analisis g
    order by g.geom <-> titik::geometry
    limit 1;

    if jarak_grid_terdekat_m is null or jarak_grid_terdekat_m > ambang_luar_area_m then
        -- Info tambahan: apakah titik ada di dalam poligon Kota Bekasi sama sekali.
        -- Dihitung HANYA di cabang ini supaya jalur normal tidak tersentuh.
        select exists (
            select 1 from batas_administrasi b
            where b.geom is not null and ST_Contains(b.geom, titik::geometry)
        ) into di_dalam_batas_kota;

        return json_build_object(
            'lokasi', json_build_object('lat', lat, 'lon', lon),
            'di_luar_area_analisis', true,
            'jarak_ke_grid_terdekat_m', jarak_grid_terdekat_m,
            'ambang_luar_area_m', ambang_luar_area_m,
            'di_dalam_batas_kota', di_dalam_batas_kota,
            'catatan',
                'Titik berada '
                || coalesce(jarak_grid_terdekat_m::text, 'sangat jauh (tidak ada grid)')
                || ' m dari sel grid analisis terdekat (> ambang ' || ambang_luar_area_m
                || ' m)' || case when di_dalam_batas_kota then '' else ', dan di luar batas administrasi Kota Bekasi' end
                || '. Grid analisis hanya dibangun pada area berpenduduk (footprint '
                || 'bangunan OSM, dasymetric), sehingga simulasi penambahan halte di '
                || 'lokasi ini tidak punya dasar data — proyeksi penduduk terlayani '
                || 'dan waktu tempuh tidak ditampilkan, bukan berarti nilainya nol.'
        );
    end if;

    -- Penduduk terlayani dalam radius 400m dan 800m (standar ITDP walking
    -- catchment), dihitung dari grid_analisis (dasymetric real, per cell
    -- 300x300m) diprorata sesuai luas irisan cell<->lingkaran radius —
    -- BUKAN dari tabel penduduk (titik) yang untuk data real selalu NULL
    -- geom-nya (agregat per kelurahan saja, lihat catatan 012).
    select coalesce(sum(
        g.kepadatan_penduduk
        * (ST_Area(ST_Intersection(g.geom, circle_400)::geography)
           / nullif(ST_Area(g.geom::geography), 0))
    ), 0)
    into penduduk_400m
    from grid_analisis g
    where g.kepadatan_penduduk is not null
      and ST_Intersects(g.geom, circle_400);

    select coalesce(sum(
        g.kepadatan_penduduk
        * (ST_Area(ST_Intersection(g.geom, circle_800)::geography)
           / nullif(ST_Area(g.geom::geography), 0))
    ), 0)
    into penduduk_800m
    from grid_analisis g
    where g.kepadatan_penduduk is not null
      and ST_Intersects(g.geom, circle_800);

    -- Jarak & nama titik transit eksisting terdekat
    select ST_Distance(geom::geography, titik), nama
    into jarak_transit_terdekat, nama_transit_terdekat
    from halte_eksisting
    order by geom::geography <-> titik
    limit 1;

    -- Estimasi perubahan waktu tempuh: selisih antara kondisi sekarang (jarak ke
    -- transit eksisting terdekat) vs kondisi baru (0, karena titik baru ini
    -- ADALAH transit-nya) -- versi sederhana, sesuaikan jika ada model lebih baik
    delta_waktu_tempuh_menit := round(
        (coalesce(jarak_transit_terdekat, 0) / asumsi_kecepatan_jalan_kaki_m_per_menit)::numeric, 1
    );

    -- Fasilitas pendidikan & kesehatan dalam radius 400m
    select count(*) into faskes_400m
    from poi where jenis = 'faskes' and ST_DWithin(geom::geography, titik, 400);

    select count(*) into sekolah_400m
    from poi where jenis = 'sekolah' and ST_DWithin(geom::geography, titik, 400);

    return json_build_object(
        'lokasi', json_build_object('lat', lat, 'lon', lon),
        'penduduk_terlayani_400m', round(penduduk_400m)::int,
        'penduduk_terlayani_800m', round(penduduk_800m)::int,
        'transit_eksisting_terdekat', json_build_object(
            'nama', nama_transit_terdekat,
            'jarak_m', round(jarak_transit_terdekat::numeric, 0)
        ),
        'estimasi_pengurangan_waktu_tempuh_menit', delta_waktu_tempuh_menit,
        'fasilitas_pendidikan_400m', sekolah_400m,
        'fasilitas_kesehatan_400m', faskes_400m
    );
end;
$$;

comment on function simulate_new_stop is
    'Simulasi dampak penambahan titik transit baru. Populasi terlayani (400m/800m)
     dihitung dari grid_analisis (dasymetric real per cell 300x300m, diprorata luas
     irisan terhadap lingkaran radius) — lihat 012_fix_simulate_new_stop_population_source.sql.
     Titik > 500 m dari sel grid terdekat dikembalikan sebagai
     di_luar_area_analisis=true (025, cermin guard get_tdi_breakdown di 021) — bukan
     proyeksi walk-time yang menyesatkan. Estimasi delta waktu tempuh linear dari
     jarak (bukan network routing riil, sesuai out-of-scope PRD Bab 3).';

-- Uji coba:
--   select simulate_new_stop(-6.2185, 107.0074);   -- in-city  -> hasil normal
--   select simulate_new_stop(-6.1000, 107.3000);   -- laut     -> di_luar_area_analisis=true
--   select simulate_new_stop(-6.2986, 107.0620);   -- Mustika Jaya PRD (~2,2 km off-grid) -> di_luar_area_analisis=true

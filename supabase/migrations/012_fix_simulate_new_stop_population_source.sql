-- ============================================================
-- GeoTransit Insight — 012_fix_simulate_new_stop_population_source.sql
-- Perbaikan `simulate_new_stop()` (003_simulate_new_stop.sql) — BUKAN
-- perubahan skema tabel, hanya redefinisi fungsi (create or replace).
--
-- MASALAH (ditemukan saat audit sebelum penghapusan data dummy, 28 Agu
-- 2026): fungsi lama menghitung `penduduk_terlayani_400m/800m` dengan
-- ST_DWithin terhadap KOLOM TITIK `penduduk.geom`. Tapi 56 baris REAL
-- `penduduk` (Disdukcapil DKB, lihat etl/load_penduduk.py) adalah agregat
-- PER KELURAHAN TANPA titik koordinat (`geom` selalu NULL) — hanya 24
-- baris DUMMY lama (`006_seed_dummy_data.sql`, 6 kelurahan fiktif) yang
-- punya `geom` terisi. Akibatnya: RPC ini SUDAH TIDAK PERNAH mengembalikan
-- populasi > 0 di luar 6 bbox dummy itu SEJAK data real diupload — dan
-- kalau baris dummy dihapus (permintaan Sam, lihat commit terkait),
-- fungsi ini akan SELALU mengembalikan 0 di SELURUH Kota Bekasi, merusak
-- total fitur "Simulasi What-If" (acceptance criteria PRD Bab 8:
-- "proyeksi penduduk tambahan terlayani"), dipakai live oleh
-- frontend/src/components/SimulationMode/SimulationPanel.jsx.
--
-- PERBAIKAN: ganti sumber populasi dari `penduduk` (titik, tidak pernah
-- didisagregasi utk data real) ke `grid_analisis` (2.607 cell 300x300m,
-- `kepadatan_penduduk` = jiwa per cell hasil TRUE dasymetric mapping
-- building footprint OSM asli, lihat etl/rerun_dasymetric_grid.py — data
-- ini SUDAH mencakup seluruh 56 kelurahan real, punya geometry per cell).
--
-- Metodologi: untuk tiap radius (400m/800m), buat lingkaran (ST_Buffer
-- geography lalu cast ke geometry SRID 4326) di titik klik, lalu jumlahkan
-- `kepadatan_penduduk` tiap cell grid yang beririsan, DIPRORATA sesuai
-- proporsi luas irisan terhadap luas cell penuh (areal interpolation —
-- BUKAN cuma cell yang centroid-nya masuk radius, supaya cell yang
-- separuh di dalam separuh di luar radius tidak dihitung all-or-nothing).
-- Ini konsisten dengan prinsip CLAUDE.md "model spasial deterministik,
-- bisa ditelusuri" — bukan pendekatan baru yang asal beda.
--
-- `penduduk` (titik) TIDAK dihapus/diubah skemanya di sini — kolom
-- `geom`-nya tetap ada untuk masa depan kalau ETL penduduk per-titik
-- (bukan agregat kelurahan) tersedia. RPC ini hanya berhenti BERGANTUNG
-- padanya untuk estimasi radius.
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
begin
    -- Penduduk terlayani dalam radius 400m dan 800m (standar ITDP walking
    -- catchment), dihitung dari grid_analisis (dasymetric real, per cell
    -- 300x300m) diprorata sesuai luas irisan cell<->lingkaran radius —
    -- BUKAN dari tabel penduduk (titik) yang untuk data real selalu NULL
    -- geom-nya (agregat per kelurahan saja, lihat catatan migration ini).
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
     irisan terhadap lingkaran radius) — lihat 012_fix_simulate_new_stop_population_source.sql
     untuk alasan kenapa BUKAN dari tabel penduduk (titik, NULL untuk data real).
     Estimasi delta waktu tempuh masih sederhana (linear dari jarak, bukan network
     routing riil — sesuai out-of-scope PRD Bab 3). Sempurnakan dengan model isochrone
     jaringan jalan jika waktu memungkinkan.';

-- Uji coba (ganti koordinat dengan titik di Kota Bekasi):
--   select simulate_new_stop(-6.2185, 107.0074);
-- Diharapkan penduduk_terlayani_400m/800m > 0 di lokasi yang tercakup grid_analisis
-- (seluruh 56 kelurahan real), TIDAK LAGI bergantung pada 6 kelurahan dummy.

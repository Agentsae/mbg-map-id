-- ============================================================
-- GeoTransit Insight — 021_get_tdi_breakdown_out_of_bounds.sql
--
-- KENAPA MIGRATION INI ADA (temuan qa-tester 2026-09-03):
-- get_tdi_breakdown(lng, lat) dari 015_tdi_breakdown_rpc.sql, kalau titik
-- klik TIDAK termuat sel grid mana pun, jatuh ke cabang "sel TERDEKAT"
-- (g.geom <-> titik) dan mengembalikan skor sel itu APA ADANYA — tanpa
-- batas jarak. Akibatnya:
--   * Titik skenario PRD untuk Kec. Mustika Jaya (lng=107,0620 lat=-6,2986)
--     berada 2.181 m di LUAR grid, tapi RPC mengembalikan skor_tdi = 0
--     seolah-olah itu skor sel di lokasi tsb.
--   * Titik ~31 km di laut (lng=107,30 lat=-6,10) tetap mengembalikan
--     skor_tdi ~0,70 dari sel pesisir terdekat.
-- Dua-duanya menyesatkan pembaca laporan: angka muncul untuk lokasi yang
-- sama sekali tidak dianalisis.
--
-- APAKAH GRID SEHARUSNYA MENUTUP MUSTIKA JAYA TIMUR?
-- grid_analisis dibangun etl/build_fishnet_grid.py DIBATASI ke area
-- berpenduduk / footprint bangunan OSM (dasymetric), lalu diisi
-- rerun_dasymetric_grid.py dengan konservasi populasi (Σ kepadatan_penduduk
-- 2.607 sel = populasi kanonik 2.607.248). Sel yang benar-benar tanpa
-- footprint bangunan (mis. TPST Bantargebang, lahan kosong Mustika Jaya
-- timur, sawah) memang SENGAJA tidak dibuat. Jadi "tidak ada sel di sana"
-- itu perilaku benar — yang salah cuma RPC-nya diam soal itu.
--
-- ------------------------------------------------------------
-- PERUBAHAN: CREATE OR REPLACE get_tdi_breakdown dengan AMBANG_LUAR_GRID.
--   AMBANG_LUAR_GRID_M = 500 m. Alasan angka ini:
--     - Sel grid 300 m; diagonal ~424 m. Titik yang jatuh persis di celah
--       antar-sel atau tepat di tepi luar grid berjarak <= ~150-260 m dari
--       centroid sel tepi terdekat -> tetap dilayani ("terdekat", jarak kecil).
--     - Titik > 500 m dari centroid sel MANA PUN berarti > 1 lebar sel di
--       luar area beranalisis -> tidak ada dasar data untuk memberi skor.
--   Saat match = 'terdekat' DAN jarak_ke_sel_m > 500:
--     -> kembalikan { ditemukan:false, di_luar_cakupan_grid:true, ... }
--        dengan `catatan` yang menjelaskan titik ada di luar grid beranalisis
--        (yang dibatasi ke area berpenduduk), BUKAN skor sel yang menyesatkan.
--   Perilaku LAIN tidak berubah:
--     - match = 'memuat' (titik di dalam sel)        -> breakdown penuh, seperti 015.
--     - match = 'terdekat' & jarak <= 500 m          -> breakdown penuh (near-edge),
--       tetap menandai match='terdekat' + jarak_ke_sel_m supaya frontend tahu
--       ini sel pendekatan, bukan sel yang memuat titik.
--     - tidak ada baris grid_analisis sama sekali    -> { ditemukan:false, ... } seperti 015.
--
-- URUTAN FILE: migration ke-021, setelah 020_skor_cai_bobot_ahp_sync.sql.
-- Perubahan vs sebelumnya: HANYA badan fungsi get_tdi_breakdown (tambah 1
-- guard jarak). Signature, grant, dan bentuk output jalur normal identik
-- dengan 015. Tidak ada DDL tabel/kolom, tidak menyentuh data atau RLS.
-- ============================================================

create or replace function get_tdi_breakdown(lng float, lat float)
returns json
language plpgsql
security definer
as $$
declare
    titik geometry := ST_SetSRID(ST_MakePoint(lng, lat), 4326);
    sel   record;
    match_type text;
    jarak_m numeric;
    akses_floor constant numeric := 0.01;  -- = AKSESIBILITAS_FLOOR di compute_scores.py
    ambang_luar_grid_m constant numeric := 500;  -- > 1 lebar sel (300 m) di luar area beranalisis
    tdi_raw_sel numeric;
    ln_min numeric;
    ln_max numeric;
    skor_tdi_reproduksi numeric;
begin
    -- 1. Sel grid yang MEMUAT titik klik.
    select g.* into sel
    from grid_analisis g
    where ST_Contains(g.geom, titik)
    limit 1;

    if found then
        match_type := 'memuat';
        jarak_m := 0;
    else
        -- 2. Fallback: sel TERDEKAT (titik jatuh di celah antar-sel atau di
        --    luar cakupan grid). <-> pakai index GIST idx_grid_analisis_geom.
        select g.* into sel
        from grid_analisis g
        order by g.geom <-> titik
        limit 1;

        if not found then
            return json_build_object(
                'ditemukan', false,
                'pesan', 'Tidak ada baris grid_analisis di database.'
            );
        end if;

        match_type := 'terdekat';
        jarak_m := round(
            ST_Distance(ST_Centroid(sel.geom)::geography, titik::geography)::numeric, 0
        );

        -- 2b. GUARD LUAR GRID: sel terdekat pun jauh -> titik di luar area
        --     beranalisis (grid dibatasi ke area berpenduduk / footprint
        --     bangunan OSM oleh build_fishnet_grid.py). Jangan kembalikan
        --     skor sel yang menyesatkan.
        if jarak_m > ambang_luar_grid_m then
            return json_build_object(
                'ditemukan', false,
                'di_luar_cakupan_grid', true,
                'match', 'terdekat',
                'cell_id_terdekat', sel.id,
                'jarak_ke_sel_terdekat_m', jarak_m,
                'ambang_luar_grid_m', ambang_luar_grid_m,
                'catatan',
                    'Titik berada ' || jarak_m || ' m dari sel grid terdekat (> ambang '
                    || ambang_luar_grid_m || ' m). Grid analisis Transit Desert Index hanya '
                    || 'dibangun pada area berpenduduk (footprint bangunan OSM, dasymetric) '
                    || 'sehingga lokasi ini di luar cakupan analisis — tidak ada skor TDI '
                    || 'yang bisa ditampilkan di sini, bukan berarti skornya 0.'
            );
        end if;
    end if;

    -- Rasio mentah (sebelum log1p + min-max), dihitung ulang dari kolom mentah.
    tdi_raw_sel :=
        sel.kepadatan_penduduk
        * sel.indeks_kebutuhan_mobilitas
        / greatest(sel.skor_aksesibilitas_transit, akses_floor);

    -- Reproduksi normalisasi skor_tdi: butuh min/max ln(1+TDI_raw) lintas
    -- SEMUA sel (persis seperti normalize_min_max di Python). Scan ~2.607
    -- baris, ringan.
    select min(ln(1 + gr.raw)), max(ln(1 + gr.raw))
      into ln_min, ln_max
    from (
        select
            g.kepadatan_penduduk
            * g.indeks_kebutuhan_mobilitas
            / greatest(g.skor_aksesibilitas_transit, akses_floor) as raw
        from grid_analisis g
        where g.kepadatan_penduduk is not null
          and g.indeks_kebutuhan_mobilitas is not null
          and g.skor_aksesibilitas_transit is not null
    ) gr;

    if ln_max is not null and ln_max > ln_min then
        skor_tdi_reproduksi := round(
            ((ln(1 + tdi_raw_sel) - ln_min) / (ln_max - ln_min))::numeric, 4
        );
    else
        skor_tdi_reproduksi := null;
    end if;

    return json_build_object(
        'ditemukan', true,
        'cell_id', sel.id,
        'match', match_type,                       -- 'memuat' | 'terdekat'
        'jarak_ke_sel_m', jarak_m,                 -- 0 kalau 'memuat'
        'skor_tdi', round(sel.skor_tdi::numeric, 4),          -- nilai choropleth tersimpan
        'skor_tdi_reproduksi_perkiraan', skor_tdi_reproduksi, -- utk pembuktian ketertelusuran
        'tdi_raw', round(tdi_raw_sel::numeric, 4),
        'aksesibilitas_floor', akses_floor,
        'formula',
            'TDI_raw = kepadatan_penduduk x indeks_kebutuhan_mobilitas / maks(skor_aksesibilitas_transit, 0,01); '
            || 'skor_tdi = normalisasi_minmax(ln(1 + TDI_raw)) lintas seluruh sel grid',
        'komponen', json_build_array(
            json_build_object(
                'kunci', 'kepadatan_penduduk',
                'label', 'Kepadatan penduduk',
                'nilai', round(sel.kepadatan_penduduk::numeric, 2),
                'satuan', 'jiwa per sel (~300 x 300 m, hasil dasymetric mapping)',
                'peran', 'pembilang',
                'arah', 'Makin tinggi -> TDI makin tinggi (defisit layanan makin besar)'
            ),
            json_build_object(
                'kunci', 'indeks_kebutuhan_mobilitas',
                'label', 'Indeks Kebutuhan Mobilitas',
                'nilai', round(sel.indeks_kebutuhan_mobilitas::numeric, 4),
                'satuan', 'indeks 0-1 (proksi: proporsi usia rentan, kepadatan POI harian, rasio tanpa kendaraan)',
                'peran', 'pembilang',
                'arah', 'Makin tinggi -> TDI makin tinggi'
            ),
            json_build_object(
                'kunci', 'skor_aksesibilitas_transit',
                'label', 'Skor Aksesibilitas Transit',
                'nilai', round(sel.skor_aksesibilitas_transit::numeric, 4),
                'satuan', 'indeks 0-1 (coverage isochrone 400/800 m ke halte eksisting terdekat)',
                'peran', 'penyebut',
                'arah', 'Makin tinggi -> TDI makin RENDAH (akses transit sudah baik)'
            )
        ),
        'catatan',
            'skor_tdi lebih tinggi = sel makin "transit desert" (makin butuh prioritas). '
            || 'Nilai komponen diambil apa adanya dari grid_analisis (sudah dihitung offline oleh '
            || 'etl/compute_tdi_full.py) — RPC ini hanya menyajikan rincian, tidak menghitung ulang skor.'
    );
end;
$$;

comment on function get_tdi_breakdown(float, float) is
    'Rincian per-kriteria Transit Desert Index untuk sel grid_analisis yang memuat '
    '(atau terdekat <=500 m dengan) titik lng/lat. Titik >500 m dari sel terdekat '
    'dikembalikan sebagai di_luar_cakupan_grid=true (021). Cermin dari breakdown CAI '
    '(skor_cai + CaiScorePanel.jsx) untuk acceptance criteria PRD Bab 8. Read-only.';

grant execute on function get_tdi_breakdown(float, float) to anon, authenticated;

-- Uji cepat sesudah push:
--   select get_tdi_breakdown(106.9900, -6.2400);   -- in-grid  -> ditemukan=true, match='memuat'
--   select get_tdi_breakdown(107.0074, -6.2185);   -- in-grid  -> ditemukan=true
--   select get_tdi_breakdown(107.0620, -6.2986);   -- Mustika Jaya PRD -> ditemukan=false, di_luar_cakupan_grid=true (2181 m)
--   select get_tdi_breakdown(107.3000, -6.1000);   -- laut     -> ditemukan=false, di_luar_cakupan_grid=true (~31 km)

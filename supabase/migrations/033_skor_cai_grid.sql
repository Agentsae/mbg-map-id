-- ============================================================
-- GeoTransit Insight — 033_skor_cai_grid.sql
--
-- SURFACE Composite Accessibility Index (CAI) 300 m di grid_analisis —
-- HYBRID: kriteria DIUKUR di sel yang punya data lapangan di dekatnya
-- (titik survei / halte tersurvei) dan DITURUNKAN dari geodata (kepadatan
-- dasymetric, jarak POI OSM) di sel lain. Menjawab acceptance criteria
-- PRD Bab 8 ("klik lokasi -> skor + rincian kontribusi tiap kriteria")
-- untuk SELURUH kota, bukan hanya 19 titik_kandidat yang kebetulan disurvei.
--
-- ------------------------------------------------------------
-- KAPABILITAS BARU & MURNI ADITIF — TIDAK ADA yang di-drop/di-ubah:
--   * TIDAK menyentuh tabel skor_cai berbasis titik, alur titik_kandidat,
--     maupun fungsi recompute_all_cai_scores(). Ke-19 (live: 18) baris
--     titik_kandidat REAL tetap jadi basis normalisasi min-max CAI titik
--     yang dipakai usulan_halte_model — surface ini dihitung TERPISAH,
--     dinormalisasi lintas 2.607 sel grid sendiri.
--   * Hanya `alter table grid_analisis add column if not exists ...` (14
--     kolom cai_*) + 1 RPC baru get_cai_breakdown(). Tidak ada perubahan
--     tabel lain, tidak ada perubahan RLS (grid_analisis sudah
--     "Publik boleh baca ..." di 002_rls_policies.sql; kolom baru ikut
--     kebijakan select yang sama). Tidak ada DROP apa pun.
--
-- URUTAN FILE: migration ke-033, setelah 032_get_admin_geometry.sql.
--   (Nomor 030 disebut di brief tugas, tapi 030/031/032 sudah terpakai
--    untuk search_admin_bounds & get_admin_geometry — file ini pakai 033,
--    nomor bebas berikutnya, supaya `supabase db push` tidak bentrok.)
--
-- ------------------------------------------------------------
-- FORMULA (ADITIF — Weighted Linear Combination, sejajar CAI titik;
-- BUKAN rasio multiplikatif seperti TDI):
--
--   cai_skor = Σ ( cai_n_i × cai_bobot_i )   i ∈ {kepadatan, jarak_inv, volume, survei}
--
--   cai_n_kepadatan = minmax( kepadatan_penduduk )                 -- grid_analisis apa adanya (dasymetric)
--   cai_n_jarak_inv = minmax( cai_jarak_fasilitas_m, INVERSE )     -- jarak ke POI fasilitas umum, clip 3000 m
--   cai_n_volume    = minmax( cai_volume_penumpang )               -- HYBRID (lihat di bawah)
--   cai_n_survei    = cai_skor_survei apa adanya (0-1)             -- NULL kalau tak ada halte tersurvei <= 400 m
--   minmax dihitung lintas SELURUH 2.607 sel grid berpenduduk.
--   Bobot dari konfigurasi_bobot nama_index='CAI' (AHP pairwise Saaty
--   formal 2026-09-03, CR = 0,0226): kepadatan 0,3290 / jarak_inv 0,3290 /
--   volume 0,2002 / survei 0,1418.
--
-- SEL TANPA HALTE TERSURVEI <= 400 m -> kriteria survei N/A (BUKAN 0):
--   cai_n_survei & cai_bobot_survei = NULL, dan 3 bobot sisanya
--   (kepadatan/jarak/volume) DINORMALISASI ULANG ke jumlah 1 untuk sel itu
--   -> cai_bobot_* ≈ 0,3834 / 0,3834 / 0,2333. Logika identik dengan
--   compute_scores.compute_cai(exclude_criteria=['survei']) yang dipakai
--   titik_kandidat. Set bobot 4-kriteria di konfigurasi_bobot TETAP
--   definisi kanonik CAI; renormalisasi ini turunan runtime per-sel.
--   (Live 2026-09-10: 44 dari 2.607 sel punya term survei aktif.)
--
-- VOLUME HYBRID (kriteria ke-3):
--   * OLS  total_aktivitas ~ kepadatan_penduduk  di-fit pada titik survei
--     REAL (x = kepadatan sel PEMUAT titik). Run live 2026-09-10:
--       a = 19,7362 · b = 0,01148425 · R² = 0,0654 · n = 18
--       total_aktivitas terobservasi: min = 10, max = 80 (aktivitas / 2 jam).
--     R² << 0,2 -> hubungan LEMAH; estimasi tetap dipakai sebagai
--     best-effort transparan dan SETIAP sel estimasi ditandai
--     cai_volume_estimasi = true + diungkap jujur di get_cai_breakdown().
--   * Sel MEMUAT titik survei ATAU centroid <= 300 m dari titik survei
--     -> cai_volume_penumpang = total_aktivitas titik terdekat;
--        cai_volume_estimasi = false. (Live: 37 sel.)
--   * Sel lain -> cai_volume_penumpang = clip( a + b·kepadatan, 10, 80 );
--        cai_volume_estimasi = true. (Live: 2.570 sel.)
--
-- RADII (semua DIPINJAM dari konstanta yang sudah berlaku di repo):
--   POI clip 3000 m · volume "terukur" <= 300 m (= lebar sel) ·
--   survei halte <= 400 m (= walking catchment ITDP / AMBANG_PENUH_M) ·
--   RPC "di luar grid" > 500 m (cermin get_tdi_breakdown / migration 021).
--
-- KETERTELUSURAN (prinsip CLAUDE.md "model/AI tidak pernah menciptakan
-- angka" + "setiap skor harus bisa ditelusuri"): RPC mengembalikan
--   skor_cai_reproduksi = round( Σ cai_n_i × cai_bobot_i , 4 )
-- dihitung ulang dari kolom tersimpan — HARUS sama dengan cai_skor
-- (model aditif, tak ada log/rasio; run live: selisih maks 0,0000).
--
-- CONTOH PERHITUNGAN MANUAL (3 sel, dari run offline self-test
-- etl/compute_cai_grid.py — bobot AHP 0,329/0,329/0,2002/0,1418):
--   sel dg survei aktif:
--     0,028·0,3290 + 0,593·0,3290 + 0,000·0,2002 + 0,620·0,1418
--     = 0,0092 + 0,1951 + 0,0000 + 0,0879  = 0,2922  ✓ (tersimpan 0,2922)
--     0,779·0,3290 + 0,714·0,3290 + 0,365·0,2002 + 0,620·0,1418
--     = 0,2563 + 0,2350 + 0,0731 + 0,0879  = 0,6522  ✓ (tersimpan 0,6522)
--   sel survei N/A (bobot renormalisasi 0,3834/0,3834/0,2333):
--     0,648·0,3834 + 0,585·0,3834 + 0,471·0,2333
--     = 0,2484 + 0,2243 + 0,1099             = 0,5827  ✓ (tersimpan 0,5827)
--
-- CARA PAKAI:
--   supabase db push                          -- terapkan file ini
--   python etl/compute_cai_grid.py            -- hitung + print (TIDAK upload)
--   python etl/compute_cai_grid.py --upload   -- isi kolom cai_* (2.607 sel)
--   grid_analisis HARUS sudah terisi (sudah: 2.607 sel dg skor_tdi).
-- ============================================================

-- ------------------------------------------------------------
-- 1. Kolom cai_* di grid_analisis (idempoten, additive)
-- ------------------------------------------------------------
-- raw / mentah
alter table grid_analisis add column if not exists cai_jarak_fasilitas_m numeric;
alter table grid_analisis add column if not exists cai_volume_penumpang  numeric;
alter table grid_analisis add column if not exists cai_skor_survei       numeric(5,4);
alter table grid_analisis add column if not exists cai_volume_estimasi   boolean;
-- ternormalisasi 0-1 (min-max lintas seluruh sel)
alter table grid_analisis add column if not exists cai_n_kepadatan       numeric(5,4);
alter table grid_analisis add column if not exists cai_n_jarak_inv       numeric(5,4);
alter table grid_analisis add column if not exists cai_n_volume          numeric(5,4);
alter table grid_analisis add column if not exists cai_n_survei          numeric(5,4);
-- bobot EFEKTIF per sel (renormalisasi 3-kriteria kalau survei N/A -> bobot_survei NULL)
alter table grid_analisis add column if not exists cai_bobot_kepadatan   numeric(5,4);
alter table grid_analisis add column if not exists cai_bobot_jarak       numeric(5,4);
alter table grid_analisis add column if not exists cai_bobot_volume      numeric(5,4);
alter table grid_analisis add column if not exists cai_bobot_survei      numeric(5,4);
-- skor akhir + timestamp
alter table grid_analisis add column if not exists cai_skor              numeric(5,4);
alter table grid_analisis add column if not exists cai_dihitung_pada     timestamptz;

comment on column grid_analisis.cai_skor is
    'Composite Accessibility Index surface 300 m (hybrid), 0-1. Sum(cai_n_i * cai_bobot_i). '
    'Additive/WLC, sejajar CAI titik (skor_cai) - BUKAN rasio spt skor_tdi. '
    'Diisi etl/compute_cai_grid.py --upload. Lihat 033_skor_cai_grid.sql.';
comment on column grid_analisis.cai_volume_estimasi is
    'true = cai_volume_penumpang sel ini ESTIMASI dari regresi kepadatan<->volume '
    '19 titik survei (bukan cacahan lapangan di sel ini). Diungkap di get_cai_breakdown().';

-- ------------------------------------------------------------
-- 2. RPC get_cai_breakdown(lng, lat) — cermin get_tdi_breakdown (015/021)
-- ------------------------------------------------------------
create or replace function get_cai_breakdown(lng float, lat float)
returns json
language plpgsql
security definer
as $$
declare
    titik geometry := ST_SetSRID(ST_MakePoint(lng, lat), 4326);
    sel   record;
    match_type text;
    jarak_m numeric;
    ambang_luar_grid_m constant numeric := 500;  -- cermin 021: > 1 lebar sel (300 m) di luar area beranalisis
    skor_reproduksi numeric;
    komponen jsonb;
    catatan_txt text;
    formula_txt constant text :=
        'cai_skor = Sum( nilai_ternormalisasi_i x bobot_efektif_i ) untuk i in '
        || '{kepadatan, jarak_fasilitas_inv, volume_transit, survei_halte}; tiap nilai '
        || 'dinormalisasi min-max 0-1 lintas SELURUH sel grid berpenduduk; bobot dari AHP '
        || 'pairwise Saaty (konfigurasi_bobot nama_index=''CAI''); bila tidak ada halte '
        || 'tersurvei <= 400 m dari sel, kriteria survei N/A dan 3 bobot sisanya '
        || 'dinormalisasi ulang ke jumlah 1. Model ADITIF (nilai x bobot) - BUKAN rasio spt TDI.';
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
        -- 2. Fallback: sel TERDEKAT (<-> pakai index GIST idx_grid_analisis_geom).
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

        -- 2b. GUARD LUAR GRID (cermin migration 021).
        if jarak_m > ambang_luar_grid_m then
            return json_build_object(
                'ditemukan', false,
                'di_luar_cakupan_grid', true,
                'cell_id_terdekat', sel.id,
                'jarak_ke_sel_terdekat_m', jarak_m,
                'ambang_luar_grid_m', ambang_luar_grid_m,
                'catatan',
                    'Titik berada ' || jarak_m || ' m dari sel grid terdekat (> ambang '
                    || ambang_luar_grid_m || ' m). Surface CAI grid hanya dibangun pada area '
                    || 'berpenduduk (footprint bangunan OSM, dasymetric) sehingga lokasi ini di '
                    || 'luar cakupan analisis - tidak ada skor CAI grid yang bisa ditampilkan di '
                    || 'sini, bukan berarti skornya 0.'
            );
        end if;
    end if;

    -- 3. Sel ditemukan tapi kolom cai_* belum diisi (033 sudah dipush, tapi
    --    etl/compute_cai_grid.py --upload belum dijalankan).
    if sel.cai_skor is null then
        return json_build_object(
            'ditemukan', false,
            'cell_id', sel.id,
            'match', match_type,
            'jarak_ke_sel_m', jarak_m,
            'pesan', 'Sel grid ditemukan, tetapi skor CAI grid belum dihitung '
                     || '(kolom cai_skor NULL). Jalankan: python etl/compute_cai_grid.py --upload.'
        );
    end if;

    -- 4. Reproduksi aditif dari kolom tersimpan (bukti ketertelusuran).
    skor_reproduksi := round((
          coalesce(sel.cai_n_kepadatan * sel.cai_bobot_kepadatan, 0)
        + coalesce(sel.cai_n_jarak_inv * sel.cai_bobot_jarak,     0)
        + coalesce(sel.cai_n_volume    * sel.cai_bobot_volume,    0)
        + coalesce(sel.cai_n_survei    * sel.cai_bobot_survei,    0)
    )::numeric, 4);

    -- 5. komponen: 4 entri kalau survei aktif, 3 kalau survei N/A (cai_n_survei NULL).
    komponen := jsonb_build_array(
        jsonb_build_object(
            'kunci', 'kepadatan',
            'label', 'Kepadatan penduduk',
            'nilai', round(sel.cai_n_kepadatan::numeric, 4),
            'bobot', round(sel.cai_bobot_kepadatan::numeric, 4),
            'kontribusi', round((sel.cai_n_kepadatan * sel.cai_bobot_kepadatan)::numeric, 4),
            'nilai_mentah', round(sel.kepadatan_penduduk::numeric, 2),
            'satuan', 'jiwa per sel (~300 x 300 m, dasymetric mapping)',
            'arah', 'Makin padat -> skor CAI naik (prioritas naik)'
        ),
        jsonb_build_object(
            'kunci', 'jarak_fasilitas_inv',
            'label', 'Jarak ke fasilitas umum (inverse)',
            'nilai', round(sel.cai_n_jarak_inv::numeric, 4),
            'bobot', round(sel.cai_bobot_jarak::numeric, 4),
            'kontribusi', round((sel.cai_n_jarak_inv * sel.cai_bobot_jarak)::numeric, 4),
            'nilai_mentah', round(sel.cai_jarak_fasilitas_m::numeric, 1),
            'satuan', 'meter ke POI fasilitas umum terdekat (sekolah/faskes/kerja, OSM; dibatasi 3000 m)',
            'arah', 'Makin dekat -> skor CAI naik'
        ),
        jsonb_build_object(
            'kunci', 'volume',
            'label', 'Volume penumpang / aktivitas transit',
            'nilai', round(sel.cai_n_volume::numeric, 4),
            'bobot', round(sel.cai_bobot_volume::numeric, 4),
            'kontribusi', round((sel.cai_n_volume * sel.cai_bobot_volume)::numeric, 4),
            'nilai_mentah', round(sel.cai_volume_penumpang::numeric, 1),
            'satuan', case when coalesce(sel.cai_volume_estimasi, false)
                           then 'aktivitas / 2 jam (ESTIMASI dari regresi kepadatan<->volume 19 titik survei)'
                           else 'aktivitas / 2 jam (traffic counting lapangan, titik survei terdekat)' end,
            'arah', 'Makin tinggi -> skor CAI naik'
        )
    );

    if sel.cai_n_survei is not null then
        komponen := komponen || jsonb_build_array(jsonb_build_object(
            'kunci', 'survei',
            'label', 'Skor survei kondisi halte (simpul terdekat)',
            'nilai', round(sel.cai_n_survei::numeric, 4),
            'bobot', round(sel.cai_bobot_survei::numeric, 4),
            'kontribusi', round((sel.cai_n_survei * sel.cai_bobot_survei)::numeric, 4),
            'nilai_mentah', round(sel.cai_skor_survei::numeric, 4),
            'satuan', 'indeks 0-1 (Form Kondisi Halte, halte eksisting tersurvei <= 400 m dari sel)',
            'arah', 'Makin baik kondisi halte -> skor CAI naik'
        ));
    end if;

    -- 6. catatan.
    catatan_txt :=
        'Surface CAI grid 300 m HYBRID: kriteria diukur di sel yang punya data lapangan di '
        || 'dekatnya dan diturunkan dari geodata (kepadatan dasymetric, jarak POI OSM) di sel '
        || 'lain. Nilai ternormalisasi & bobot diambil apa adanya dari grid_analisis (dihitung '
        || 'offline oleh etl/compute_cai_grid.py) - RPC ini hanya menyajikan rincian, tidak '
        || 'menghitung ulang skor. Model ADITIF (Sum nilai x bobot), sejajar CAI titik - bukan '
        || 'rasio seperti TDI.';
    if sel.cai_n_survei is null then
        catatan_txt := catatan_txt
            || ' Kriteria survei kondisi halte N/A untuk sel ini (tidak ada halte tersurvei '
            || '<= 400 m); 3 bobot sisanya (kepadatan/jarak/volume) dinormalisasi ulang ke jumlah 1.';
    end if;
    if coalesce(sel.cai_volume_estimasi, false) then
        catatan_txt := catatan_txt
            || ' PENGUNGKAPAN: angka volume transit untuk sel ini ESTIMASI, bukan hitungan '
            || 'lapangan - diturunkan dari hubungan linear (regresi OLS) antara kepadatan '
            || 'penduduk dan volume terukur pada 19 titik survei lapangan, lalu dibatasi pada '
            || 'rentang nilai terobservasi (10-80 aktivitas / 2 jam). R^2 regresi rendah -> '
            || 'perlakukan sebagai indikasi kasar, bukan cacahan riil di lokasi ini.';
    end if;

    return json_build_object(
        'ditemukan', true,
        'cell_id', sel.id,
        'match', match_type,                          -- 'memuat' | 'terdekat'
        'jarak_ke_sel_m', jarak_m,                    -- 0 kalau 'memuat'
        'skor_cai', round(sel.cai_skor::numeric, 4),
        'skor_cai_reproduksi', skor_reproduksi,       -- Sum(n_i x bobot_i) dari kolom tersimpan
        'formula', formula_txt,
        'volume_estimasi', coalesce(sel.cai_volume_estimasi, false),
        'komponen', komponen,
        'catatan', catatan_txt
    );
end;
$$;

comment on function get_cai_breakdown(float, float) is
    'Rincian per-kriteria Composite Accessibility Index (surface grid 300 m, hybrid) untuk sel '
    'grid_analisis yang memuat (atau terdekat <= 500 m dengan) titik lng/lat. Model ADITIF '
    '(Sum nilai x bobot). Titik > 500 m dari sel terdekat -> di_luar_cakupan_grid=true. '
    'Cermin get_tdi_breakdown (015/021). Read-only, tidak menghitung ulang skor. Lihat 033_skor_cai_grid.sql.';

-- RPC read-only atas data publik-baca (grid_analisis, RLS 002). Konsisten
-- dengan get_tdi_breakdown / simulate_new_stop yang juga di-grant ke anon.
grant execute on function get_cai_breakdown(float, float) to anon, authenticated;

-- Uji cepat sesudah push + `python etl/compute_cai_grid.py --upload`:
--   select get_cai_breakdown(106.9900, -6.2400);   -- in-grid  -> ditemukan=true, match='memuat'
--   select get_cai_breakdown(107.0074, -6.2185);   -- in-grid  -> ditemukan=true
--   select get_cai_breakdown(107.0620, -6.2986);   -- Mustika Jaya timur -> ditemukan=false, di_luar_cakupan_grid=true
--   select get_cai_breakdown(107.3000, -6.1000);   -- laut     -> ditemukan=false, di_luar_cakupan_grid=true
-- Diharapkan pada jalur sukses: skor_cai == skor_cai_reproduksi (selisih 0),
-- komponen 4 entri (atau 3 kalau sel tanpa halte tersurvei <= 400 m).

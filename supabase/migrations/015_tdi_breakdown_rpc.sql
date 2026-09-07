-- ============================================================
-- GeoTransit Insight — 015_tdi_breakdown_rpc.sql
--
-- Menambah RPC get_tdi_breakdown(lng, lat) — "klik sel di peta -> rincian
-- kontribusi tiap kriteria TDI", memenuhi acceptance criteria PRD Bab 8:
--   "Composite Accessibility Index & TDI — Klik lokasi di peta -> tampilkan
--    skor + rincian kontribusi tiap kriteria (bukan angka tunggal tanpa
--    penjelasan)."
-- Sampai migration ini, CAI sudah punya rincian (kolom breakdown skor_cai +
-- CaiScorePanel.jsx), tapi TDI masih choropleth-only.
--
-- ------------------------------------------------------------
-- TIDAK ADA DDL / kolom baru. grid_analisis (001_init_tables.sql) SUDAH
-- menyimpan ketiga komponen formula TDI per sel, dan compute_tdi_full.py
-- --upload sudah mengisinya untuk seluruh 2.607 sel (dicek 2026-09-03:
-- 2607/2607 non-null pada kepadatan_penduduk, indeks_kebutuhan_mobilitas,
-- skor_aksesibilitas_transit, skor_tdi). Migration ini HANYA menyajikan
-- angka yang sudah ada itu dalam bentuk terstruktur + menjelaskan asalnya.
--
-- FORMULA (PRD Bab 7.2, implementasi etl/compute_scores.py compute_tdi()):
--   TDI_raw = kepadatan_penduduk
--             * indeks_kebutuhan_mobilitas
--             / greatest(skor_aksesibilitas_transit, 0.01)
--   skor_tdi = normalisasi_minmax( ln(1 + TDI_raw) )  -- lintas SEMUA sel
--
--   - 0.01 = AKSESIBILITAS_FLOOR (guard pembagi nol; sel yang benar-benar
--     tak terlayani, skor_aksesibilitas_transit = 0, tetap dapat angka
--     berhingga, bukan infinity/NaN yang merusak ranking).
--   - ln(1 + .) (log1p) meredam outlier ekstrem dari pembagian oleh
--     aksesibilitas ~0 SEBELUM min-max, supaya sebaran skor_tdi tetap
--     terbedakan antar-sel dan tidak "tenggelam" gara-gara satu outlier.
--
-- Berbeda dari CAI (kombinasi linear berbobot -> kontribusi ADITIF), TDI
-- adalah RASIO -> kontribusi MULTIPLIKATIF. Karena itu tiap komponen di
-- output ditandai `peran` ('pembilang' / 'penyebut') dan `arah`, supaya
-- frontend TIDAK keliru memakai model "nilai x bobot" ala CAI untuk TDI.
--
-- KETERTELUSURAN: RPC ini juga mengembalikan `tdi_raw` (rasio mentah
-- sebelum log1p+minmax) yang dihitung ulang dari kolom mentah, plus
-- `skor_tdi_reproduksi_perkiraan` — normalisasi ulang ln(1+tdi_raw) dengan
-- min/max ln lintas seluruh sel. Nilai reproduksi ini "perkiraan" karena
-- kolom grid_analisis disimpan sudah dibulatkan (kepadatan 2 desimal,
-- indeks & aksesibilitas 4 desimal); selisih terhadap skor_tdi tersimpan
-- wajar < ~1e-3. Ini membuktikan skor_tdi bisa ditelusuri dari angka
-- mentah, bukan black box.
--
-- URUTAN FILE: migration ke-015, setelah 014_equity_kelompok_rekomendasi_isi.sql.
-- Perubahan vs sebelumnya: HANYA menambah 1 fungsi RPC (get_tdi_breakdown)
-- + grant execute-nya. Tidak menyentuh tabel, kolom, data, atau RLS.
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
    end if;

    -- Rasio mentah (sebelum log1p + min-max), dihitung ulang dari kolom mentah.
    tdi_raw_sel :=
        sel.kepadatan_penduduk
        * sel.indeks_kebutuhan_mobilitas
        / greatest(sel.skor_aksesibilitas_transit, akses_floor);

    -- Reproduksi normalisasi skor_tdi: butuh min/max ln(1+TDI_raw) lintas
    -- SEMUA sel (persis seperti normalize_min_max di Python). Scan 2.607
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
    '(atau terdekat dengan) titik lng/lat. Cermin dari breakdown CAI (skor_cai + '
    'CaiScorePanel.jsx) untuk acceptance criteria PRD Bab 8. Read-only, tidak '
    'menghitung ulang skor — lihat 015_tdi_breakdown_rpc.sql.';

-- RPC ini read-only atas data yang memang publik-baca (grid_analisis, RLS
-- 002_rls_policies.sql). Konsisten dengan simulate_new_stop() yang juga
-- di-grant ke anon.
grant execute on function get_tdi_breakdown(float, float) to anon, authenticated;

-- Uji cepat (titik di Kota Bekasi):
--   select get_tdi_breakdown(107.0074, -6.2185);
-- Diharapkan: ditemукan=true, cell_id terisi, komponen 3 baris, dan
-- skor_tdi_reproduksi_perkiraan berbeda < ~0,001 dari skor_tdi.

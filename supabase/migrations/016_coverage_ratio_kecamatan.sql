-- ============================================================
-- GeoTransit Insight — 016_coverage_ratio_kecamatan.sql
--
-- View coverage_transit_kecamatan — agregasi NYATA "coverage ratio per
-- kecamatan" (share penduduk dalam radius jalan kaki 400/800 m dari halte
-- eksisting), memenuhi acceptance criteria PRD Bab 8 (Dashboard Indikator:
-- "coverage ratio ... dari data yang telah divalidasi").
--
-- Sampai migration ini, Dashboard.jsx meng-hardcode `usingDemo = true` dan
-- merender DEMO_DATA (6 kecamatan, angka karangan) walau Supabase
-- tersambung — karena agregasi per-kecamatan yang sesungguhnya belum
-- pernah dibuat. View ini menggantinya.
--
-- ------------------------------------------------------------
-- METODOLOGI (deterministik, bisa ditelusuri — CLAUDE.md):
--   1. Basis penduduk  : grid_analisis.kepadatan_penduduk (jiwa per sel
--      300x300 m, hasil TRUE dasymetric mapping building footprint OSM —
--      lihat etl/rerun_dasymetric_grid.py). BUKAN tabel `penduduk` (yang
--      untuk data real hanya agregat per kelurahan tanpa titik). Sama
--      dengan basis populasi RPC simulate_new_stop() (012).
--   2. Penempatan sel ke kecamatan : centroid sel -> kelurahan RBI
--      terdekat (operator <-> KNN, index GIST) lalu ambil nama_kecamatan-
--      nya. Pakai "terdekat" (bukan strictly ST_Contains) supaya ~200-300
--      sel yang centroid-nya jatuh di celah antar-poligon RBI 25K
--      (efek simplifikasi) tidak hilang dari agregat. Kota Bekasi = 12
--      kecamatan (dicek: 56 kelurahan BIG RBI terbagi rata ke 12).
--   3. "Terlayani" : centroid sel berjarak <= 400 m (atau <= 800 m) dari
--      halte_eksisting mana pun (ST_DWithin geography = meter sejati).
--      halte_eksisting saat ini = 15 titik REAL koridor BisKita tersurvei
--      (HLT-001..015); tidak ada baris dummy. Radius 400/800 m = standar
--      walking catchment ITDP, konsisten dengan simulate_new_stop() dan
--      AMBANG_PENUH/NIHIL di compute_tdi_full.py.
--   4. coverage_ratio = Σ kepadatan_penduduk sel terlayani di kecamatan
--                        ÷ Σ kepadatan_penduduk SEMUA sel di kecamatan.
--
-- CATATAN HASIL (jujur, bukan bug): ke-15 halte tersurvei terkonsentrasi
-- di koridor Pekayon/Bekasi Selatan-Timur, jadi mayoritas kecamatan lain
-- akan ber-coverage ~0. Itu memang gambaran "transit desert" Kota Bekasi
-- menurut data survei tim, BUKAN kesalahan agregasi. Jangan "diperhalus".
--
-- KONSISTENSI: served@400 di sini setara grid_analisis.skor_aksesibilitas_transit
-- >= 1.0, dan served@800 setara skor_aksesibilitas_transit > 0.0 (decay
-- linear 400->800 m di compute_tdi_full.py). View ini menghitung ulang
-- lewat PostGIS langsung supaya self-contained & transparan, bukan
-- bergantung pada tafsir kolom decay.
--
-- ------------------------------------------------------------
-- KENAPA VIEW (bukan materialized / tabel): selalu mencerminkan isi
-- grid_analisis + halte_eksisting terkini tanpa langkah refresh manual
-- (anon tidak bisa REFRESH MATERIALIZED VIEW). Beban query: ~2.607
-- centroid x (1 KNN kelurahan + 2 ST_DWithin atas 15 halte) — milidetik,
-- dan Dashboard hanya memanggilnya sekali per sesi.
--
-- security_invoker = on : RLS tabel sumber (grid_analisis, halte_eksisting,
-- batas_administrasi — semuanya publik-baca, 002_rls_policies.sql) yang
-- berlaku, bukan hak pemilik view. Pola yang direkomendasikan Supabase.
--
-- URUTAN FILE: migration ke-016, setelah 015_tdi_breakdown_rpc.sql.
-- Perubahan vs sebelumnya: HANYA menambah 1 view + grant select-nya.
-- Tidak ada DDL tabel, tidak ada perubahan data / RLS tabel.
-- ============================================================

create or replace view coverage_transit_kecamatan
with (security_invoker = on) as
with sel as (
    select
        g.id,
        g.kepadatan_penduduk,
        ST_Centroid(g.geom) as c
    from grid_analisis g
    where g.kepadatan_penduduk is not null
),
sel_kec as (
    select
        s.id,
        s.kepadatan_penduduk,
        s.c,
        kec.nama_kecamatan
    from sel s
    cross join lateral (
        select ba.nama_kecamatan
        from batas_administrasi ba
        order by ba.geom <-> s.c
        limit 1
    ) kec
),
sel_terlayani as (
    select
        sk.nama_kecamatan,
        sk.kepadatan_penduduk,
        exists (
            select 1 from halte_eksisting h
            where ST_DWithin(h.geom::geography, sk.c::geography, 400)
        ) as terlayani_400m,
        exists (
            select 1 from halte_eksisting h
            where ST_DWithin(h.geom::geography, sk.c::geography, 800)
        ) as terlayani_800m
    from sel_kec sk
)
select
    nama_kecamatan                                                       as kecamatan,
    count(*)                                                             as jumlah_sel,
    round(sum(kepadatan_penduduk))::bigint                               as populasi_total,
    round(sum(kepadatan_penduduk) filter (where terlayani_400m))::bigint as populasi_terlayani_400m,
    round(sum(kepadatan_penduduk) filter (where terlayani_800m))::bigint as populasi_terlayani_800m,
    round(
        (sum(kepadatan_penduduk) filter (where terlayani_400m)
         / nullif(sum(kepadatan_penduduk), 0))::numeric, 4
    )                                                                    as coverage_ratio_400m,
    round(
        (sum(kepadatan_penduduk) filter (where terlayani_800m)
         / nullif(sum(kepadatan_penduduk), 0))::numeric, 4
    )                                                                    as coverage_ratio_800m
from sel_terlayani
group by nama_kecamatan
order by coverage_ratio_800m desc nulls last, kecamatan;

comment on view coverage_transit_kecamatan is
    'Coverage ratio penduduk (dasymetric grid) dalam radius jalan kaki 400/800 m dari '
    'halte_eksisting, per kecamatan (12 baris). coverage_ratio_* pada skala 0-1. '
    'Menggantikan DEMO_DATA hardcoded di Dashboard.jsx. Lihat 016_coverage_ratio_kecamatan.sql.';

grant select on coverage_transit_kecamatan to anon, authenticated;

-- Uji cepat setelah migration:
--   select * from coverage_transit_kecamatan;
-- Diharapkan: 12 baris, Σ populasi_total ~ 2,3-2,6 juta (sedikit di bawah
-- populasi kanonik karena sel di celah RBI ikut ditarik ke kecamatan
-- terdekat, tapi tidak double-count), coverage tertinggi di kecamatan
-- koridor BisKita tersurvei, mayoritas kecamatan lain ~0.

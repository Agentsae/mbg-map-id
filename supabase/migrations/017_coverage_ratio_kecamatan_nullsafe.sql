-- ============================================================
-- GeoTransit Insight — 017_coverage_ratio_kecamatan_nullsafe.sql
--
-- Perbaikan view coverage_transit_kecamatan (016) — BUKAN skema baru,
-- hanya `create or replace view` (definisi kolom & urutan tidak berubah).
--
-- MASALAH (ketahuan saat verifikasi 016, 2026-09-03): untuk kecamatan yang
-- TIDAK punya satu pun sel "terlayani", `sum(kepadatan_penduduk) filter
-- (where terlayani_400m)` mengembalikan NULL (SQL sum atas 0 baris = NULL,
-- bukan 0). Akibatnya `populasi_terlayani_400m/800m` dan
-- `coverage_ratio_400m/800m` jadi NULL untuk 9 dari 12 kecamatan —
-- padahal jawabannya "0 jiwa / 0% coverage", angka yang valid & justru
-- inti temuan (mayoritas kecamatan Kota Bekasi tak terlayani halte
-- tersurvei). Frontend bar chart butuh angka, bukan NULL.
--
-- PERBAIKAN: bungkus numerator "terlayani" dengan coalesce(..., 0).
-- Denominator tetap nullif(sum, 0) -> hanya NULL kalau kecamatan benar
-- benar tak punya sel berpenduduk sama sekali (tidak terjadi pada 12
-- kecamatan real). Semua logika spasial lain sama persis dengan 016.
--
-- URUTAN FILE: migration ke-017, setelah 016_coverage_ratio_kecamatan.sql.
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
    nama_kecamatan                                                                  as kecamatan,
    count(*)                                                                        as jumlah_sel,
    round(sum(kepadatan_penduduk))::bigint                                          as populasi_total,
    round(coalesce(sum(kepadatan_penduduk) filter (where terlayani_400m), 0))::bigint as populasi_terlayani_400m,
    round(coalesce(sum(kepadatan_penduduk) filter (where terlayani_800m), 0))::bigint as populasi_terlayani_800m,
    round(
        (coalesce(sum(kepadatan_penduduk) filter (where terlayani_400m), 0)
         / nullif(sum(kepadatan_penduduk), 0))::numeric, 4
    )                                                                              as coverage_ratio_400m,
    round(
        (coalesce(sum(kepadatan_penduduk) filter (where terlayani_800m), 0)
         / nullif(sum(kepadatan_penduduk), 0))::numeric, 4
    )                                                                              as coverage_ratio_800m
from sel_terlayani
group by nama_kecamatan
order by coverage_ratio_800m desc nulls last, kecamatan;

comment on view coverage_transit_kecamatan is
    'Coverage ratio penduduk (dasymetric grid) dalam radius jalan kaki 400/800 m dari '
    'halte_eksisting, per kecamatan (12 baris). coverage_ratio_* skala 0-1, 0 (bukan NULL) '
    'untuk kecamatan tanpa sel terlayani. Menggantikan DEMO_DATA di Dashboard.jsx. '
    'Lihat 016_ + 017_coverage_ratio_kecamatan*.sql.';

grant select on coverage_transit_kecamatan to anon, authenticated;

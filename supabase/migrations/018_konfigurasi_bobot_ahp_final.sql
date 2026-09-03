-- ============================================================
-- GeoTransit Insight — 018_konfigurasi_bobot_ahp_final.sql
--
-- BOBOT FINAL hasil sesi AHP pairwise (Saaty) FORMAL, 2026-09-03.
-- Ini MENGGANTIKAN worksheet bobot yang sebelumnya hanya direview mentor
-- secara informal (009_bobot_tdi_equity_mentor_review.sql, 27 Agu 2026) dan
-- bobot draft pra-AHP di 004_konfigurasi_bobot.sql.
--
-- BEDA DENGAN 009 (penting): 009 bersifat ADDITIVE (INSERT ... WHERE NOT
-- EXISTS, tidak pernah menyentuh baris lama). Migration 018 SENGAJA
-- meng-UPDATE nilai `bobot` + `consistency_ratio` + `catatan` +
-- `ditentukan_pada` pada 13 baris yang sudah ada (4 CAI, 3 TDI_MOBILITAS,
-- 6 EQUITY). Ini penggantian bobot yang disengaja, bukan kesalahan —
-- keputusan tim 2026-09-03 setelah matriks pairwise Saaty dihitung dan
-- consistency ratio setiap index terverifikasi < 0,1.
--
-- ------------------------------------------------------------
-- 1. LEBAR KOLOM. `bobot` dan `consistency_ratio` semula numeric(4,3)
--    (skala 3 desimal) — itu MEMBULATKAN/menolak nilai AHP seperti
--    0,2002 / 0,1418 / 0,0226 / 0,0457. Dilebarkan ke numeric(6,4)
--    (skala 4 desimal, cukup untuk semua nilai di bawah). Idempoten:
--    hanya di-ALTER kalau skala saat ini < 4.
--
-- 2. NILAI BOBOT BARU (sumber: sesi AHP 2026-09-03, arsip matriks pairwise
--    di docs/VALIDASI_BOBOT_AHP.md). Pemetaan huruf kriteria AHP -> kolom
--    nama_kriteria di tabel ini:
--      CAI:   A->kepadatan  B->jarak_inv  C->volume  D->survei
--      TDI:   A(usia rentan)->usia_rentan  B(POI harian)->poi_harian
--             C(tanpa kendaraan)->tanpa_kendaraan
--      EQUITY:A->aksesibilitas_inv  B->kepadatan  C->usia_rentan
--             D->akses_pendidikan   E->akses_kesehatan  F->akses_kerja
--
--    | nama_index    | nama_kriteria      | bobot  | CR     |
--    |---------------|--------------------|--------|--------|
--    | CAI           | kepadatan          | 0.3290 | 0.0226 |
--    | CAI           | jarak_inv          | 0.3290 | 0.0226 |
--    | CAI           | volume             | 0.2002 | 0.0226 |
--    | CAI           | survei             | 0.1418 | 0.0226 |
--    | TDI_MOBILITAS | usia_rentan        | 0.2000 | 0.0000 |
--    | TDI_MOBILITAS | poi_harian         | 0.4000 | 0.0000 |
--    | TDI_MOBILITAS | tanpa_kendaraan    | 0.4000 | 0.0000 |
--    | EQUITY        | aksesibilitas_inv  | 0.3076 | 0.0457 |
--    | EQUITY        | kepadatan          | 0.1538 | 0.0457 |
--    | EQUITY        | usia_rentan        | 0.1513 | 0.0457 |
--    | EQUITY        | akses_pendidikan   | 0.1260 | 0.0457 |
--    | EQUITY        | akses_kesehatan    | 0.1353 | 0.0457 |
--    | EQUITY        | akses_kerja        | 0.1260 | 0.0457 |
--
--    Tiap kelompok berjumlah tepat 1,0000 (dicek: CAI 0,3290+0,3290+
--    0,2002+0,1418; TDI 0,2000+0,4000+0,4000; EQUITY 0,3076+0,1538+
--    0,1513+0,1260+0,1353+0,1260). CR TDI_MOBILITAS = 0 karena matriks
--    pairwise 3x3-nya konsisten sempurna (transitif penuh).
--
-- 3. ATRIBUSI SUMBER DATA. Tabel ini tidak menyimpan kolom sumber per
--    baris; di mana pun sumber kepadatan/demografi disebut untuk bobot
--    ini (dokumen, catatan, narasi), pakai sebutan kanonik
--    "DKB (Data Konsolidasi Bersih) Semester I 2026 — Ditjen Dukcapil
--    Kemendagri" (BUKAN "Disdukcapil Kota Bekasi" / "Disdukcapil" seperti
--    di CSV mentah sesi AHP) — keputusan penyeragaman tim 2026-08-28,
--    lihat CLAUDE.md.
--
-- IDEMPOTEN / AMAN DI-RERUN: UPDATE ... FROM (values ...) mengunci ke
-- (nama_index, nama_kriteria); baris yang belum ada (mis. DB fresh yang
-- belum kena 004/009) tetap terisi lewat INSERT ... WHERE NOT EXISTS di
-- bawahnya. Menjalankan ulang tidak menghasilkan duplikat atau perubahan
-- nilai lebih lanjut.
--
-- URUTAN FILE: migration ke-018, setelah 017_coverage_ratio_kecamatan_nullsafe.sql.
-- Perubahan vs sebelumnya: lebar 2 kolom konfigurasi_bobot + nilai 13
-- baris bobot (CAI/TDI_MOBILITAS/EQUITY). TIDAK menyentuh tabel lain,
-- tidak ada DDL tabel baru, tidak ada perubahan RLS. Skor turunan
-- (skor_cai, grid_analisis.skor_tdi, skor_equity) dihitung ulang di luar
-- migration ini oleh pipeline ETL (etl/attach_kepadatan_titik_kandidat.py,
-- etl/compute_tdi_full.py, etl/aggregate_equity_kelurahan.py) yang membaca
-- bobot dari tabel ini.
-- ============================================================

-- 1. Lebarkan kolom (idempoten: hanya kalau skala < 4).
do $$
begin
  if coalesce((
    select numeric_scale from information_schema.columns
    where table_name = 'konfigurasi_bobot' and column_name = 'bobot'
  ), 0) < 4 then
    alter table konfigurasi_bobot alter column bobot type numeric(6,4);
  end if;

  if coalesce((
    select numeric_scale from information_schema.columns
    where table_name = 'konfigurasi_bobot' and column_name = 'consistency_ratio'
  ), 0) < 4 then
    alter table konfigurasi_bobot alter column consistency_ratio type numeric(6,4);
  end if;
end $$;

-- 2a. UPDATE nilai bobot untuk baris yang sudah ada.
update konfigurasi_bobot k
set bobot             = b.bobot,
    consistency_ratio = b.consistency_ratio,
    ditentukan_pada   = timestamptz '2026-09-03 12:00:00+07',
    catatan           = 'Bobot hasil AHP pairwise Saaty formal, sesi 2026-09-03 '
                        || '(menggantikan worksheet review mentor 27 Agu). CR < 0,1 untuk '
                        || 'ketiga index. Matriks pairwise diarsipkan di docs/VALIDASI_BOBOT_AHP.md.'
from (values
    ('CAI',           'kepadatan',         0.3290, 0.0226),
    ('CAI',           'jarak_inv',         0.3290, 0.0226),
    ('CAI',           'volume',            0.2002, 0.0226),
    ('CAI',           'survei',            0.1418, 0.0226),
    ('TDI_MOBILITAS', 'usia_rentan',       0.2000, 0.0000),
    ('TDI_MOBILITAS', 'poi_harian',        0.4000, 0.0000),
    ('TDI_MOBILITAS', 'tanpa_kendaraan',   0.4000, 0.0000),
    ('EQUITY',        'aksesibilitas_inv', 0.3076, 0.0457),
    ('EQUITY',        'kepadatan',         0.1538, 0.0457),
    ('EQUITY',        'usia_rentan',       0.1513, 0.0457),
    ('EQUITY',        'akses_pendidikan',  0.1260, 0.0457),
    ('EQUITY',        'akses_kesehatan',   0.1353, 0.0457),
    ('EQUITY',        'akses_kerja',       0.1260, 0.0457)
) as b(nama_index, nama_kriteria, bobot, consistency_ratio)
where k.nama_index = b.nama_index and k.nama_kriteria = b.nama_kriteria;

-- 2b. INSERT baris yang belum ada (DB fresh / belum kena 004 & 009).
insert into konfigurasi_bobot (nama_index, nama_kriteria, bobot, consistency_ratio, ditentukan_pada, catatan)
select b.nama_index, b.nama_kriteria, b.bobot, b.consistency_ratio,
       timestamptz '2026-09-03 12:00:00+07',
       'Bobot hasil AHP pairwise Saaty formal, sesi 2026-09-03 '
       || '(menggantikan worksheet review mentor 27 Agu). CR < 0,1 untuk '
       || 'ketiga index. Matriks pairwise diarsipkan di docs/VALIDASI_BOBOT_AHP.md.'
from (values
    ('CAI',           'kepadatan',         0.3290, 0.0226),
    ('CAI',           'jarak_inv',         0.3290, 0.0226),
    ('CAI',           'volume',            0.2002, 0.0226),
    ('CAI',           'survei',            0.1418, 0.0226),
    ('TDI_MOBILITAS', 'usia_rentan',       0.2000, 0.0000),
    ('TDI_MOBILITAS', 'poi_harian',        0.4000, 0.0000),
    ('TDI_MOBILITAS', 'tanpa_kendaraan',   0.4000, 0.0000),
    ('EQUITY',        'aksesibilitas_inv', 0.3076, 0.0457),
    ('EQUITY',        'kepadatan',         0.1538, 0.0457),
    ('EQUITY',        'usia_rentan',       0.1513, 0.0457),
    ('EQUITY',        'akses_pendidikan',  0.1260, 0.0457),
    ('EQUITY',        'akses_kesehatan',   0.1353, 0.0457),
    ('EQUITY',        'akses_kerja',       0.1260, 0.0457)
) as b(nama_index, nama_kriteria, bobot, consistency_ratio)
where not exists (
    select 1 from konfigurasi_bobot k
    where k.nama_index = b.nama_index and k.nama_kriteria = b.nama_kriteria
);

-- 3. Verifikasi cepat (opsional, jalankan manual sesudah push):
--   select nama_index, nama_kriteria, bobot, consistency_ratio, ditentukan_pada
--   from konfigurasi_bobot order by nama_index, nama_kriteria;
--   -- Diharapkan: 13 baris, bobot per index berjumlah 1,0000, CR: CAI 0,0226,
--   -- TDI_MOBILITAS 0,0000, EQUITY 0,0457.

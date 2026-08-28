-- ============================================================
-- GeoTransit Insight — 009_bobot_tdi_equity_mentor_review.sql
--
-- Mengisi konfigurasi_bobot untuk nama_index='TDI_MOBILITAS' (3 kriteria,
-- komponen Indeks Kebutuhan Mobilitas dari Transit Desert Index) dan
-- nama_index='EQUITY' (6 kriteria, Transit Equity Index). Sebelum migration
-- ini, konfigurasi_bobot HANYA berisi 4 baris 'CAI' (004_konfigurasi_bobot.sql)
-- — load_weights_from_db(client, 'TDI_MOBILITAS'/'EQUITY', ...) di
-- etl/upload_to_supabase.py selama ini selalu fallback ke
-- DEFAULT_MOBILITY_WEIGHTS/DEFAULT_EQUITY_WEIGHTS di compute_scores.py
-- karena tabel ini kosong untuk kedua index tsb.
--
-- STATUS METODOLOGI — PENTING, jangan disalahartikan di laporan mana pun:
-- nilai bobot di bawah ini SAMA PERSIS dengan DEFAULT_MOBILITY_WEIGHTS /
-- DEFAULT_EQUITY_WEIGHTS yang sudah ada di compute_scores.py sejak awal
-- (bukan bobot baru hasil sesi AHP). Mentor SUDAH mereview & menyetujui
-- ("sudah ok") worksheet bobot ini pada 27 Agustus 2026, TAPI review itu
-- BUKAN sesi pairwise comparison Saaty formal — mentor approve langsung
-- lewat membaca angka & tanya "cek dulu hasil perhitungannya, lihat
-- distribusinya, cocok tidak dengan objektif analisis" (lihat
-- docs/VALIDASI_BOBOT_AHP.md untuk hasil pengecekan itu). Karena TIDAK ada
-- matriks pairwise yang pernah dihitung, kolom consistency_ratio SENGAJA
-- dibiarkan NULL di sini — mengisi angka CR tanpa matriks aslinya akan
-- jadi karangan, bukan hasil pengukuran.
--
-- Bobot 'CAI' (004_konfigurasi_bobot.sql) berstatus SAMA: draft worksheet
-- yang sudah direview mentor, bukan CR formal — catatan lama di baris CAI
-- ("perlu divalidasi mentor") sekarang usang secara status approval, tapi
-- TIDAK diubah di sini (di luar cakupan migration ini, dan mengubah baris
-- lama bukan pola ADDITIVE yang dipakai migration lain di repo ini).
--
-- Idempotent: pakai INSERT ... WHERE NOT EXISTS per (nama_index,
-- nama_kriteria), aman dijalankan berulang (db push berikutnya) tanpa
-- membuat duplikat.
-- ============================================================

insert into konfigurasi_bobot (nama_index, nama_kriteria, bobot, consistency_ratio, catatan)
select v.nama_index, v.nama_kriteria, v.bobot, null,
       'Bobot awal (bukan hasil pairwise Saaty formal) - disetujui mentor 27 Agustus 2026 via review worksheet, divalidasi lewat cek distribusi hasil & kesesuaian objektif analisis, bukan consistency ratio pairwise.'
from (values
    -- TDI_MOBILITAS -- komponen Indeks Kebutuhan Mobilitas (lihat
    -- compute_indeks_kebutuhan_mobilitas() di etl/compute_scores.py)
    ('TDI_MOBILITAS', 'usia_rentan',      0.40),
    ('TDI_MOBILITAS', 'poi_harian',       0.35),
    ('TDI_MOBILITAS', 'tanpa_kendaraan',  0.25),
    -- EQUITY -- Transit Equity Index (lihat compute_equity_index())
    ('EQUITY', 'aksesibilitas_inv',   0.30),
    ('EQUITY', 'kepadatan',           0.15),
    ('EQUITY', 'usia_rentan',         0.20),
    ('EQUITY', 'akses_pendidikan',    0.15),
    ('EQUITY', 'akses_kesehatan',     0.10),
    ('EQUITY', 'akses_kerja',         0.10)
) as v(nama_index, nama_kriteria, bobot)
where not exists (
    select 1 from konfigurasi_bobot k
    where k.nama_index = v.nama_index and k.nama_kriteria = v.nama_kriteria
);

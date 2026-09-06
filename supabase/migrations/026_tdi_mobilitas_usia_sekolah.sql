-- ============================================================
-- GeoTransit Insight — 026_tdi_mobilitas_usia_sekolah.sql
--
-- KEPUTUSAN METODOLOGI (disetujui Sam 2026-09-06):
-- Komponen ketiga Indeks Kebutuhan Mobilitas (nama_index='TDI_MOBILITAS')
-- DIGANTI dari 'tanpa_kendaraan' (rasio RT tanpa kendaraan pribadi) ke
-- 'usia_sekolah' (proporsi penduduk umur 5–19 per kelurahan).
--
-- ALASAN:
--   - Rasio "tanpa kendaraan" tidak tersedia pada resolusi spasial
--     (per-kelurahan / per-grid). Statistik Kesejahteraan Rakyat Kota
--     Bekasi 2025 (Susenas, BPS) hanya punya angka KOTA: 93,05% RT punya
--     aset transportasi → komponen ini non-diskriminatif. compute_tdi_full.py
--     selama ini fallback ke nilai netral 0,5 rata untuk SEMUA grid
--     (bobot 0,40 → nol daya pisah).
--   - Anak usia sekolah (5–19, jenjang SD–SMA) = populasi DI BAWAH usia
--     mengemudi, transit-dependent, dengan trip harian rutin ke sekolah.
--     Literatur transit desert / transit-need index: Jiao & Dillivan 2013;
--     Currie 2010. Lihat docs/REFERENSI_METODOLOGI.md.
--
-- DEFINISI 'usia_sekolah' (Opsi 2): proporsi penduduk umur 5–19 per
--   kelurahan = (pita '05-09' + '10-14' + '15-19' dari sheet
--   JUMDUK_KELUMUR) ÷ jumlah_penduduk. Sumber: DKB Semester I 2026 —
--   Ditjen Dukcapil Kemendagri (file yang sama dipakai load_penduduk.py).
--   TIDAK overlap dengan 'usia_rentan' (= lansia 65+ + balita 0–4).
--
-- BOBOT AHP (Opsi a): 'usia_sekolah' mengambil alih slot 0,4000 apa adanya.
--   | Komponen       | Bobot  |
--   |----------------|--------|
--   | usia_rentan    | 0,2000 |
--   | poi_harian     | 0,4000 |
--   | usia_sekolah   | 0,4000 |
--   Matriks pairwise Saaty 3×3 tetap konsisten sempurna:
--     poi_harian/usia_rentan = 2 ; usia_sekolah/usia_rentan = 2 ;
--     poi_harian/usia_sekolah = 1  → eigenvector (0,2 / 0,4 / 0,4),
--     CR = 0,0000. Ini MENGGANTIKAN baris 'tanpa_kendaraan' dari sesi
--     AHP 2026-09-03 (migration 018). Matriks diarsipkan di
--     docs/VALIDASI_BOBOT_AHP.md.
--
-- ------------------------------------------------------------
-- PERUBAHAN DI MIGRATION INI:
--   1. penduduk: + kolom proporsi_usia_sekolah numeric(5,4) (nullable,
--      ADD COLUMN IF NOT EXISTS — aman di-rerun). Diisi per kelurahan oleh
--      etl/load_penduduk.py (re-run --update-existing).
--   2. konfigurasi_bobot: baris ('TDI_MOBILITAS','tanpa_kendaraan',0.4000)
--      → ('TDI_MOBILITAS','usia_sekolah',0.4000, CR 0.0000). usia_rentan
--      (0.2000) & poi_harian (0.4000) TIDAK disentuh — tetap dari 018.
--
-- IDEMPOTEN / AMAN DI-RERUN:
--   - UPDATE ... WHERE nama_kriteria='tanpa_kendaraan' me-rename baris lama
--     (rerun ke-2: 0 baris).
--   - INSERT ... WHERE NOT EXISTS mengisi 'usia_sekolah' kalau baris lama
--     tidak ada (DB fresh / 018 belum jalan) — rerun ke-2: skip.
--   - DELETE sisa 'tanpa_kendaraan' (kalau rename tak kena karena
--     'usia_sekolah' sudah ada dari jalur lain) — rerun ke-2: 0 baris.
--
-- URUTAN FILE: migration ke-026, setelah 025_simulate_new_stop_out_of_area_guard.sql.
--   Menyusul: 027_get_tdi_breakdown_usia_sekolah_label.sql (refresh teks
--   'satuan' pada RPC get_tdi_breakdown yang menyebut "rasio tanpa kendaraan").
-- Perubahan vs sebelumnya: 1 kolom baru di penduduk + 1 baris konfigurasi_bobot
--   (TDI_MOBILITAS). Tidak menyentuh tabel lain, tidak ada perubahan RLS.
--   Skor turunan (grid_analisis.skor_tdi) dihitung ulang DI LUAR migration ini
--   oleh etl/compute_tdi_full.py --upload (baca bobot dari tabel ini).
-- ============================================================

-- 1. Kolom baru di penduduk.
alter table penduduk add column if not exists proporsi_usia_sekolah numeric(5,4);
comment on column penduduk.proporsi_usia_sekolah is
    'Proporsi penduduk umur 5–19 (jenjang SD–SMA) = (pita 05-09 + 10-14 + 15-19) / jumlah_penduduk. '
    'Proksi populasi di bawah usia mengemudi yang transit-dependent — komponen ketiga Indeks '
    'Kebutuhan Mobilitas (TDI). Sumber: DKB Semester I 2026 — Ditjen Dukcapil Kemendagri. '
    'Tidak overlap dengan proporsi_lansia/proporsi_balita. Diisi oleh etl/load_penduduk.py.';

-- 2a. Rename baris bobot lama 'tanpa_kendaraan' -> 'usia_sekolah' (nilai & CR sama).
update konfigurasi_bobot
set nama_kriteria     = 'usia_sekolah',
    bobot             = 0.4000,
    consistency_ratio = 0.0000,
    ditentukan_pada   = timestamptz '2026-09-06 12:00:00+07',
    catatan           = 'Komponen ketiga Indeks Kebutuhan Mobilitas diganti '
                        || 'tanpa_kendaraan -> usia_sekolah (proporsi penduduk umur 5–19, '
                        || 'proksi transit-dependent di bawah usia mengemudi). Alasan: rasio '
                        || 'tanpa-kendaraan tidak tersedia pada resolusi spasial (Susenas hanya '
                        || 'angka kota) sehingga selama ini fallback netral 0,5 di semua grid. '
                        || 'Bobot 0,4000 diambil alih apa adanya; matriks pairwise Saaty 3×3 '
                        || 'tetap CR = 0,0000. Keputusan 2026-09-06 (menggantikan baris '
                        || 'tanpa_kendaraan dari sesi AHP 2026-09-03 / migration 018). '
                        || 'Matriks di docs/VALIDASI_BOBOT_AHP.md.'
where nama_index = 'TDI_MOBILITAS' and nama_kriteria = 'tanpa_kendaraan';

-- 2b. INSERT 'usia_sekolah' kalau belum ada (DB fresh / 018 belum jalan / rename tak kena).
insert into konfigurasi_bobot (nama_index, nama_kriteria, bobot, consistency_ratio, ditentukan_pada, catatan)
select 'TDI_MOBILITAS', 'usia_sekolah', 0.4000, 0.0000,
       timestamptz '2026-09-06 12:00:00+07',
       'Komponen ketiga Indeks Kebutuhan Mobilitas = usia_sekolah (proporsi penduduk umur 5–19). '
       || 'Bobot 0,4000, CR pairwise 3×3 = 0,0000. Keputusan 2026-09-06 (menggantikan '
       || 'tanpa_kendaraan dari migration 018). Lihat docs/VALIDASI_BOBOT_AHP.md.'
where not exists (
    select 1 from konfigurasi_bobot
    where nama_index = 'TDI_MOBILITAS' and nama_kriteria = 'usia_sekolah'
);

-- 2c. Bersihkan sisa 'tanpa_kendaraan' kalau 2a tidak mengenainya
--     (mis. 'usia_sekolah' sudah ada lebih dulu dari jalur lain).
delete from konfigurasi_bobot
where nama_index = 'TDI_MOBILITAS' and nama_kriteria = 'tanpa_kendaraan';

-- 3. Verifikasi (jalankan manual sesudah push):
--   select nama_index, nama_kriteria, bobot,
--          sum(bobot) over (partition by nama_index) as jml_grup
--   from konfigurasi_bobot where nama_index = 'TDI_MOBILITAS'
--   order by nama_kriteria;
--   -- Diharapkan 3 baris: poi_harian 0,4000 | usia_rentan 0,2000 |
--   --   usia_sekolah 0,4000 ; jml_grup = 1,0000 ; TIDAK ada 'tanpa_kendaraan'.

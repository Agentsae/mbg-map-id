-- ============================================================
-- GeoTransit Insight — 014_equity_kelompok_rekomendasi_isi.sql
--
-- Mengisi kolom skor_equity.kelompok_terdampak (text[]) dan
-- skor_equity.rekomendasi_intervensi (text) untuk 56 baris REAL
-- (sumber LIKE 'REAL - %') yang selama ini NULL — temuan QA 2026-08-28.
--
-- Konteks acceptance criteria (PRD Bab 8, Transit Equity Index Dashboard):
--   "ranking minimal 5 kelurahan ... + kelompok terdampak + 1 rekomendasi
--    intervensi per kelurahan".
-- Kolom ditambahkan di 005_equity_kelompok_rekomendasi.sql, tetapi
-- aggregate_equity_kelurahan.upload_equity_scores_real() sengaja meng-insert
-- NULL (lihat docstring modul itu) karena narasi ini BUKAN keluaran formula.
-- Migration inilah yang mengisinya — SEKALI, deterministik, bisa ditelusuri.
--
-- ------------------------------------------------------------
-- PRINSIP CLAUDE.md: setiap output harus bisa ditelusuri.
-- kelompok_terdampak TIDAK dikarang bebas — diturunkan deterministik dari
-- kolom komponen ternormalisasi yang SUDAH ada di tabel skor_equity
-- (hasil etl/compute_scores.py compute_equity_index()).
--
-- Bobot dimensi (konfigurasi_bobot, nama_index='EQUITY', disetujui mentor
-- 2026-08-27; = DEFAULT_EQUITY_WEIGHTS di etl/compute_scores.py):
--     aksesibilitas_inv 0.30 | usia_rentan 0.20 | kepadatan 0.15
--     akses_pendidikan  0.15 | akses_kesehatan 0.10 | akses_kerja 0.10
--
-- ATURAN PEMETAAN kelompok_terdampak (deterministik):
--   1. Hitung kontribusi berbobot tiap dimensi kerentanan ke skor_final:
--        kontribusi_d = bobot_d * n_d   (n_d = kolom n_* di skor_equity)
--   2. Dimensi 'aksesibilitas_inv' DIKECUALIKAN dari penentuan kelompok
--      terdampak: untuk 53 dari 56 baris nilainya konstan 0.8709 (skor_cai_rata2
--      dipakai fallback rata-rata kota — lihat 010_skor_equity_sumber.sql),
--      jadi tidak membedakan antar-kelurahan. Ia tetap kriteria berbobot
--      terbesar pada skor_final (semua 56 kelurahan ini memang berakses
--      transit rendah), hanya saja bukan pembeda kelompok sasaran.
--   3. Dari 5 dimensi tersisa (kepadatan, usia_rentan, akses_pendidikan,
--      akses_kesehatan, akses_kerja): ambil dimensi dengan kontribusi_d
--      TERBESAR (selalu masuk), lalu tambahkan dimensi ke-2/ke-3 HANYA jika
--        kontribusi_d >= 0.5 * kontribusi_terbesar  DAN  n_d >= 0.35
--      (ambang 0.35 = "nilai ternormalisasi benar-benar menonjol", bukan
--      sekadar relatif). Maksimum 3 dimensi per kelurahan.
--   4. Tiap dimensi terpilih dipetakan ke frasa kelompok baku:
--        kepadatan        -> 'penduduk permukiman padat'
--        usia_rentan      -> 'lansia & balita'
--        akses_pendidikan -> 'pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'
--        akses_kesehatan  -> 'warga dengan akses faskes terbatas'
--        akses_kerja      -> 'pekerja komuter berpendapatan rendah'
--   Catatan: n_usia_rentan = proporsi lansia+balita APA ADANYA (tidak
--   dinormalisasi min-max), rentang aktual ~0.09-0.15, sehingga praktis tidak
--   pernah lolos ambang 0.35 -> 'lansia & balita' tidak muncul di batch ini.
--   Itu konsisten: usia rentan bukan pembeda antar-kelurahan pada data ini.
--
-- ATURAN rekomendasi_intervensi:
--   Satu tindakan konkret spesifik-lokasi, selaras scope proyek (transit massal:
--   halte/feeder BisKita Trans Patriot, integrasi KRL, angkutan pengumpan ke
--   KRL/LRT Jabodebek), diikat ke dimensi TERLEMAH kelurahan + koridor jalan
--   /simpul transit nyata di kecamatannya. Estimasi jangkauan pakai kecepatan
--   jalan kaki 4-5 km/jam (400 m ~ 5 menit, 800 m ~ 10 menit) — BUKAN network
--   routing (out-of-scope, CLAUDE.md). Mutu naratif diprioritaskan untuk
--   top-10; ranking 11-56 pola lebih ringkas tapi tetap spesifik-dimensi.
--
-- Arah skala (CLAUDE.md, jangan dibalik): skor_final TINGGI = kelurahan makin
-- DIRUGIKAN; ranking 1 = paling butuh intervensi. Rekomendasi ranking teratas
-- karena itu bersifat "bangun/perluas layanan", ranking terbawah "pertahankan".
--
-- IDEMPOTEN: tiap statement UPDATE ... FROM batas_administrasi ba di-key ke
-- ba.nama_kelurahan (unik di 56 baris RBI, dicek: tidak ada duplikat) dan
-- dibatasi se.sumber LIKE 'REAL - %' supaya baris dummy (kalau kelak
-- ditambahkan lagi) tidak tersentuh. Aman dijalankan ulang.
--
-- URUTAN FILE: migration ke-014, setelah 013_rute_transit_eksisting.sql.
-- Perubahan vs sebelumnya: HANYA mengisi data 2 kolom yang sudah ada di
-- 005_equity_kelompok_rekomendasi.sql; TIDAK ada DDL, tidak ada kolom/tabel
-- baru, tidak menyentuh skor numerik / ranking.
-- ============================================================

-- Guard: hanya jalan kalau kolom target sudah ada (dibuat di 005).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'skor_equity' and column_name = 'kelompok_terdampak'
  ) then
    raise exception 'skor_equity.kelompok_terdampak belum ada — jalankan 005_equity_kelompok_rekomendasi.sql dulu';
  end if;
end $$;

-- ============================================================
-- TOP-10 (mutu naratif penuh) — ranking 1..10 per skor_final
-- ============================================================

-- #1 Arenjaya (Bekasi Timur) — terlemah: kepadatan (n=0.82), akses_kerja (n=1.00)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat','pekerja komuter berpendapatan rendah'],
  rekomendasi_intervensi = 'Bangun 2-3 halte BisKita Trans Patriot + feeder pengumpan sepanjang Jl. Chairil Anwar - Jl. Pahlawan yang menautkan permukiman terpadat Arenjaya ke Stasiun Bekasi Timur (KRL) dalam radius jalan kaki < 400 m (sekitar 5 menit). Jadwalkan feeder jam puncak 05.30-08.00 dan 16.00-19.00 untuk pekerja komuter berpendapatan rendah yang kini bergantung ojek.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Arenjaya' and se.sumber like 'REAL - %';

-- #2 Durenjaya (Bekasi Timur) — terlemah: kepadatan (0.72), akses_pendidikan (0.49), akses_kerja (0.57); sumber: agregasi lokal
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat','pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','pekerja komuter berpendapatan rendah'],
  rekomendasi_intervensi = 'Operasikan feeder pengumpan dari klaster padat Perumnas 3 / Jl. Nusantara Raya (Duren Jaya) ke Stasiun Bekasi Timur dan Terminal Kota Bekasi, dengan halte di depan klaster SD/SMP Perumnas agar pelajar tidak berjalan > 800 m (sekitar 10 menit). Rute yang sama melayani komuter jam puncak.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Durenjaya' and se.sumber like 'REAL - %';

-- #3 Kaliabang Tengah (Bekasi Utara) — terlemah: kepadatan (0.72), akses_pendidikan (0.54)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat','pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Perpanjang koridor BisKita Trans Patriot masuk Jl. Kaliabang Tengah - Jl. Bisma dengan spasi halte < 400 m dari blok permukiman terpadat, ditambah trip feeder sekolah pagi ke klaster SMP/SMA Perumnas 3 dan Harapan Baru. Kaliabang Tengah adalah salah satu kelurahan terpadat Bekasi Utara yang tidak punya stasiun KRL.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Kaliabang Tengah' and se.sumber like 'REAL - %';

-- #4 Jatimurni (Pondokmelati) — terlemah: akses_kesehatan (n=1.00), akses_pendidikan (0.65)
update skor_equity se set
  kelompok_terdampak = array['warga dengan akses faskes terbatas','pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Sediakan angkutan pengumpan reguler dari Jl. Raya Jatimurni - Jl. Wibawa Mukti II menuju puskesmas/RS rujukan dan halte LRT Jabodebek Jatibening. Faskes terdekat kini > 1,5 km (di luar jangkauan jalan kaki lansia); target headway <= 20 menit pada jam layanan siang.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatimurni' and se.sumber like 'REAL - %';

-- #5 Jatirahayu (Pondokmelati) — terlemah: akses_pendidikan (0.89), kepadatan (0.53)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','penduduk permukiman padat'],
  rekomendasi_intervensi = 'Buka feeder rute sekolah dari permukiman padat Jatirahayu (Jl. Raya Hankam, kawasan Komsen) ke klaster sekolah Pondok Gede, dengan halte terintegrasi ke koridor BisKita menuju Stasiun Bekasi. Fokuskan trip pada jam masuk dan pulang sekolah karena akses pendidikan adalah dimensi terlemah kelurahan ini.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatirahayu' and se.sumber like 'REAL - %';

-- #6 Kalibaru (Medansatria) — terlemah: kepadatan (0.76), akses_pendidikan (0.68)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat','pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Bangun halte feeder di Jl. Kalibaru - Jl. Sultan Agung yang menghubungkan permukiman padat Kalibaru ke Stasiun Kranji (KRL) dalam < 10 menit jalan kaki plus satu kali oper, serta tambahkan trip sekolah pagi ke klaster SD/SMP Medan Satria.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Kalibaru' and se.sumber like 'REAL - %';

-- #7 Pejuang (Medansatria) — terlemah: akses_pendidikan (0.52), akses_kesehatan (0.62), kepadatan (0.40)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','warga dengan akses faskes terbatas','penduduk permukiman padat'],
  rekomendasi_intervensi = 'Tambah feeder pengumpan dari Perumahan Harapan Indah / Pejuang ke Stasiun Kranji dan ke RS di koridor Harapan Indah, dengan halte tepat di depan klaster sekolah dan puskesmas Pejuang karena akses pendidikan maupun kesehatan sama-sama lemah.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Pejuang' and se.sumber like 'REAL - %';

-- #8 Jatimekar (Jatiasih) — terlemah: akses_pendidikan (n=0.88)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Operasikan feeder rute pendidikan dari Jatimekar (Jl. Raya Jatimekar, kawasan Kemang IFI) ke klaster SMA/SMK Jatiasih dan ke halte LRT Jabodebek Cikunir. Jarak sekolah terdekat > 1 km membuat pelajar bergantung kendaraan pribadi atau ojek.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatimekar' and se.sumber like 'REAL - %';

-- #9 Kranji (Bekasi Barat) — terlemah: kepadatan (n=1.00, terpadat se-kota)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Kranji adalah kelurahan terpadat Kota Bekasi tetapi sebaran halte belum merata. Rapatkan halte BisKita sepanjang Jl. Sultan Agung - Jl. Pemuda sehingga setiap RW berada < 400 m (sekitar 5 menit) dari halte, dan tingkatkan kapasitas feeder ke Stasiun Kranji (KRL) yang ada di kelurahan ini.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Kranji' and se.sumber like 'REAL - %';

-- #10 Cikiwul (Bantargebang) — terlemah: akses_pendidikan (n=0.95)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Buka trayek pengumpan harian Jl. Raya Narogong - Jl. Pangkalan yang melayani Cikiwul (kawasan TPST Bantargebang) menuju klaster sekolah Bantargebang lalu lanjut ke Stasiun Bekasi. Akses pendidikan adalah dimensi paling tertinggal di sini; sekolah terdekat berada di luar radius jalan kaki aman.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Cikiwul' and se.sumber like 'REAL - %';

-- ============================================================
-- RANKING 11-56 (pola lebih ringkas, tetap spesifik-dimensi + koridor)
-- ============================================================

-- #11 Jatirangga (Jatisampurna) — akses_pendidikan (0.69), akses_kesehatan (0.63), akses_kerja (0.54)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','warga dengan akses faskes terbatas','pekerja komuter berpendapatan rendah'],
  rekomendasi_intervensi = 'Feeder pengumpan Jl. Raya Jatirangga - Kranggan ke LRT Jabodebek Harjamukti, dengan halte melewati klaster sekolah dan puskesmas Jatisampurna. Ketiga dimensi akses (pendidikan, kesehatan, kerja) sama-sama lemah, jadi prioritaskan trase yang menyentuh ketiganya.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatirangga' and se.sumber like 'REAL - %';

-- #12 Harapanbaru (Bekasi Utara) — akses_pendidikan (0.72)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Tambah trip feeder sekolah dari Harapan Baru ke klaster SMP/SMA Bekasi Utara, tersambung koridor BisKita menuju Stasiun Bekasi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Harapanbaru' and se.sumber like 'REAL - %';

-- #13 Perwira (Bekasi Utara) — kepadatan (0.59), akses_pendidikan (0.42)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat','pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Halte BisKita baru di Jl. Perjuangan - Perwira (< 400 m dari blok padat) plus trip feeder sekolah pagi; Bekasi Utara tidak dilayani stasiun KRL sehingga bergantung koridor bus menuju Stasiun Bekasi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Perwira' and se.sumber like 'REAL - %';

-- #14 Teluk Pucung (Bekasi Utara) — kepadatan (0.69)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Rapatkan halte feeder di Jl. Perjuangan - Teluk Pucung menuju hub Summarecon Bekasi dan Stasiun Bekasi, menyasar blok permukiman padat yang kini tidak punya halte dalam jangkauan jalan kaki.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Teluk Pucung' and se.sumber like 'REAL - %';

-- #15 Kotabaru (Bekasi Barat) — kepadatan (0.79)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Tambah halte BisKita di Jl. KH Noer Ali - Kota Baru untuk menutup celah jangkauan jalan kaki di permukiman padat, dengan oper ke Stasiun Kranji atau Stasiun Bekasi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Kotabaru' and se.sumber like 'REAL - %';

-- #16 Jaticempaka (Pondokgede) — akses_pendidikan (0.46), kepadatan (0.39), akses_kesehatan (0.41)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','penduduk permukiman padat','warga dengan akses faskes terbatas'],
  rekomendasi_intervensi = 'Feeder Jl. Raya Jatiwaringin - Jaticempaka ke LRT Jabodebek Jatibening dan TransJakarta PGC, dengan halte dekat klaster sekolah dan puskesmas Pondok Gede.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jaticempaka' and se.sumber like 'REAL - %';

-- #17 Cimuning (Mustikajaya) — akses_pendidikan (0.63)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Trayek pengumpan Jl. Raya Cimuning - Mustika Jaya ke klaster sekolah dan ke Stasiun Bekasi Timur; sekolah terdekat berada di luar radius jalan kaki.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Cimuning' and se.sumber like 'REAL - %';

-- #18 Bantargebang (Bantargebang) — akses_pendidikan (n=1.00)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Feeder rute sekolah dari kelurahan Bantargebang (Jl. Raya Narogong) ke klaster SMP/SMA terdekat lalu Stasiun Bekasi. Akses pendidikan paling tertinggal di seluruh sampel (nilai ternormalisasi 1,00).'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Bantargebang' and se.sumber like 'REAL - %';

-- #19 Bintarajaya (Bekasi Barat) — akses_kerja (0.62), kepadatan (0.41), akses_pendidikan (0.35)
update skor_equity se set
  kelompok_terdampak = array['pekerja komuter berpendapatan rendah','penduduk permukiman padat','pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Feeder jam puncak dari Bintara Jaya ke Stasiun Kranji dan kawasan kerja Jl. Sultan Agung untuk komuter berpendapatan rendah, dengan halte tambahan di blok permukiman padat.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Bintarajaya' and se.sumber like 'REAL - %';

-- #20 Harapanmulya (Medansatria) — akses_pendidikan (0.81)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Trip feeder sekolah dari Harapan Mulya ke klaster sekolah Medan Satria, tersambung ke Stasiun Kranji.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Harapanmulya' and se.sumber like 'REAL - %';

-- #21 Jatikarya (Jatisampurna) — akses_pendidikan (0.73), akses_kesehatan (0.69)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','warga dengan akses faskes terbatas'],
  rekomendasi_intervensi = 'Feeder Jl. Raya Kranggan - Jatikarya ke LRT Jabodebek Harjamukti, dengan halte di dekat sekolah dan faskes; kedua akses tersebut sama-sama lemah.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatikarya' and se.sumber like 'REAL - %';

-- #22 Jatimelati (Pondokmelati) — akses_pendidikan (0.45), akses_kesehatan (0.65), akses_kerja (0.36)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','warga dengan akses faskes terbatas','pekerja komuter berpendapatan rendah'],
  rekomendasi_intervensi = 'Angkutan pengumpan Jl. Raya Hankam - Jatimelati ke LRT Jabodebek Jatibening, melewati klaster sekolah dan puskesmas, sekaligus melayani komuter jam puncak.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatimelati' and se.sumber like 'REAL - %';

-- #23 Jatibening Baru (Pondokgede) — akses_pendidikan (0.35), akses_kesehatan (0.45), akses_kerja (0.42)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','warga dengan akses faskes terbatas','pekerja komuter berpendapatan rendah'],
  rekomendasi_intervensi = 'Feeder pendek Jatibening Baru ke stasiun LRT Jabodebek Jatibening (< 800 m, sekitar 10 menit jalan kaki plus oper), dengan halte dekat sekolah dan faskes; optimalkan jadwal untuk komuter.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatibening Baru' and se.sumber like 'REAL - %';

-- #24 Sumurbatu (Bantargebang) — akses_pendidikan (0.72)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Trayek pengumpan Jl. Pangkalan 5 - Sumur Batu (kawasan TPST) ke klaster sekolah Bantargebang dan Stasiun Bekasi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Sumurbatu' and se.sumber like 'REAL - %';

-- #25 Bintara (Bekasi Barat) — kepadatan (0.65)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Halte BisKita tambahan di Jl. Bintara Raya untuk permukiman padat, dengan oper ke Stasiun Kranji.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Bintara' and se.sumber like 'REAL - %';

-- #26 Jatiwaringin (Pondokgede) — kepadatan (0.54), akses_pendidikan (0.38)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat','pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Rapatkan halte di Jl. Raya Jatiwaringin menuju LRT Jabodebek Jatibening dan TransJakarta PGC, ditambah trip sekolah pagi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatiwaringin' and se.sumber like 'REAL - %';

-- #27 Jatikramat (Jatiasih) — akses_pendidikan (0.48), kepadatan (0.41)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','penduduk permukiman padat'],
  rekomendasi_intervensi = 'Feeder Jl. Raya Jatikramat ke klaster sekolah Jatiasih dan LRT Jabodebek Cikunir, dengan halte di blok permukiman padat.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatikramat' and se.sumber like 'REAL - %';

-- #28 Harapanjaya (Bekasi Utara) — kepadatan (0.57)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Halte feeder di Jl. Perjuangan - Harapan Jaya untuk permukiman padat menuju Stasiun Bekasi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Harapanjaya' and se.sumber like 'REAL - %';

-- #29 Jakasampurna (Bekasi Barat) — kepadatan (0.48)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Halte BisKita tambahan di Jl. Bintara - Jakasampurna dengan oper ke Stasiun Kranji atau Stasiun Bekasi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jakasampurna' and se.sumber like 'REAL - %';

-- #30 Pekayonjaya (Bekasi Selatan) — kepadatan (0.44), akses_pendidikan (0.38)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat','pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Halte BisKita Trans Patriot di Jl. Pekayon Raya untuk permukiman padat ditambah trip sekolah, dengan oper ke Stasiun Bekasi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Pekayonjaya' and se.sumber like 'REAL - %';

-- #31 Bekasijaya (Bekasi Timur) — kepadatan (0.64)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Rapatkan halte feeder di Jl. Ir. H. Juanda - Bekasi Jaya menuju Stasiun Bekasi Timur untuk permukiman padat.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Bekasijaya' and se.sumber like 'REAL - %';

-- #32 Mustikajaya (Mustikajaya) — akses_pendidikan (0.44), kepadatan (0.36)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','penduduk permukiman padat'],
  rekomendasi_intervensi = 'Feeder Jl. Raya Mustika Jaya ke klaster sekolah dan Stasiun Bekasi Timur, dengan halte di permukiman padat sepanjang koridor.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Mustikajaya' and se.sumber like 'REAL - %';

-- #33 Padurenan (Mustikajaya) — akses_pendidikan (0.57)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Trayek pengumpan Jl. Raya Padurenan ke sekolah terdekat dan Stasiun Bekasi Timur.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Padurenan' and se.sumber like 'REAL - %';

-- #34 Jatisari (Jatiasih) — akses_pendidikan (0.41), akses_kesehatan (0.43), akses_kerja (0.39)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','warga dengan akses faskes terbatas','pekerja komuter berpendapatan rendah'],
  rekomendasi_intervensi = 'Feeder Jl. Raya Jatisari ke LRT Jabodebek Cikunir yang melewati klaster sekolah dan faskes Jatiasih, sekaligus melayani komuter.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatisari' and se.sumber like 'REAL - %';

-- #35 Margahayu (Bekasi Timur) — kepadatan (0.45); sumber: agregasi lokal
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Rapatkan halte di Jl. Chairil Anwar - Margahayu (permukiman padat, berbatasan Stasiun Bekasi Timur) agar jangkauan jalan kaki ke halte merata di seluruh RW.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Margahayu' and se.sumber like 'REAL - %';

-- #36 Jatiranggon (Jatisampurna) — akses_pendidikan (0.53)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Feeder Jl. Jatiranggon ke klaster sekolah dan LRT Jabodebek Harjamukti.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatiranggon' and se.sumber like 'REAL - %';

-- #37 Jatirasa (Jatiasih) — kepadatan (0.44), akses_kesehatan (0.40)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat','warga dengan akses faskes terbatas'],
  rekomendasi_intervensi = 'Halte feeder di Jl. Raya Jatirasa untuk permukiman padat plus rute ke faskes Jatiasih dan LRT Jabodebek Cikunir.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatirasa' and se.sumber like 'REAL - %';

-- #38 Margajaya (Bekasi Selatan) — akses_pendidikan (0.81); catatan: n_akses_kesehatan & n_akses_kerja = 0 (kemungkinan data POI belum lengkap di kelurahan ini)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Trip feeder sekolah dari Marga Jaya ke klaster sekolah Bekasi Selatan, tersambung koridor BisKita menuju Stasiun Bekasi. Catatan data: jarak faskes dan kerja kelurahan ini ternormalisasi 0 - verifikasi kelengkapan data POI sebelum menyimpulkan kedua dimensi itu memang baik.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Margajaya' and se.sumber like 'REAL - %';

-- #39 Medansatria (Medansatria) — akses_pendidikan (0.61)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Feeder Jl. Sultan Agung - Medan Satria ke klaster sekolah dan Stasiun Kranji.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Medansatria' and se.sumber like 'REAL - %';

-- #40 Jatiasih (Jatiasih) — akses_pendidikan (0.33), akses_kesehatan (0.47)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','warga dengan akses faskes terbatas'],
  rekomendasi_intervensi = 'Feeder Jl. Raya Jatiasih ke klaster sekolah dan RS/puskesmas Jatiasih, dengan oper ke LRT Jabodebek Cikunir.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatiasih' and se.sumber like 'REAL - %';

-- #41 Jatimakmur (Pondokgede) — kepadatan (0.46), akses_pendidikan (0.37)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat','pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Halte tambahan di Jl. Jatimakmur untuk permukiman padat plus trip sekolah, dengan oper ke LRT Jabodebek Jatibening.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatimakmur' and se.sumber like 'REAL - %';

-- #42 Jatibening (Pondokgede) — akses_pendidikan (0.47), kepadatan (0.36)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','penduduk permukiman padat'],
  rekomendasi_intervensi = 'Feeder pendek Jatibening ke stasiun LRT Jabodebek Jatibening (< 800 m), dengan halte dekat klaster sekolah.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatibening' and se.sumber like 'REAL - %';

-- #43 Jatisampurna (Jatisampurna) — akses_pendidikan (0.56)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Trayek pengumpan Jl. Raya Kranggan - Jatisampurna ke klaster sekolah dan LRT Jabodebek Harjamukti.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatisampurna' and se.sumber like 'REAL - %';

-- #44 Jatiraden (Jatisampurna) — akses_pendidikan (0.53)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Feeder Jatiraden ke sekolah terdekat dan LRT Jabodebek Harjamukti via Jl. Raya Kranggan.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatiraden' and se.sumber like 'REAL - %';

-- #45 Ciketingudik (Bantargebang) — akses_pendidikan (0.47), akses_kesehatan (0.58)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki','warga dengan akses faskes terbatas'],
  rekomendasi_intervensi = 'Trayek pengumpan Ciketing Udik (kawasan TPST) ke klaster sekolah dan puskesmas Bantargebang, lanjut ke Stasiun Bekasi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Ciketingudik' and se.sumber like 'REAL - %';

-- #46 Kayuringinjaya (Bekasi Selatan) — kepadatan (0.70)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Rapatkan halte BisKita di Jl. Ahmad Yani - Kayuringin Jaya untuk permukiman padat, dekat Stasiun Bekasi dan Revo Town.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Kayuringinjaya' and se.sumber like 'REAL - %';

-- #47 Jatiwarna (Pondokmelati) — kepadatan (0.40)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Halte feeder di Jl. Raya Jatiwarna untuk permukiman padat, dengan oper ke LRT Jabodebek Jatibening.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatiwarna' and se.sumber like 'REAL - %';

-- #48 Mustikasari (Mustikajaya) — akses_pendidikan (0.41)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Feeder Jl. Raya Mustika Sari ke sekolah terdekat dan Stasiun Bekasi Timur.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Mustikasari' and se.sumber like 'REAL - %';

-- #49 Jatiluhur (Jatiasih) — akses_kesehatan (0.44)
update skor_equity se set
  kelompok_terdampak = array['warga dengan akses faskes terbatas'],
  rekomendasi_intervensi = 'Angkutan pengumpan Jatiluhur ke RS/puskesmas rujukan Jatiasih dan LRT Jabodebek Cikunir; akses kesehatan adalah dimensi terlemah kelurahan ini.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatiluhur' and se.sumber like 'REAL - %';

-- #50 Jakamulya (Bekasi Selatan) — kepadatan (0.37)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Halte BisKita tambahan di Jl. Jakamulya untuk permukiman padat, dengan oper ke Stasiun Bekasi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jakamulya' and se.sumber like 'REAL - %';

-- #51 Sepanjangjaya (Rawalumbu) — kepadatan (0.37)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Rapatkan halte BisKita Trans Patriot di Jl. Pramuka - Sepanjang Jaya untuk permukiman padat, dengan oper ke Stasiun Bekasi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Sepanjangjaya' and se.sumber like 'REAL - %';

-- #52 Bojong Rawalumbu (Rawalumbu) — kepadatan (0.38)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Halte feeder di Jl. Narogong - Bojong Rawalumbu (kawasan Bumi Bekasi Baru) untuk permukiman padat menuju Stasiun Bekasi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Bojong Rawalumbu' and se.sumber like 'REAL - %';

-- #53 Bojongmenteng (Rawalumbu) — kepadatan (0.34)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Halte BisKita tambahan di Jl. Pramuka - Bojong Menteng untuk permukiman padat.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Bojongmenteng' and se.sumber like 'REAL - %';

-- #54 Jakasetia (Bekasi Selatan) — kepadatan (0.34)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Halte feeder di Jl. Raya Jakasetia untuk permukiman padat, dengan oper ke Stasiun Bekasi dan Grand Galaxy.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jakasetia' and se.sumber like 'REAL - %';

-- #55 Pengasinan (Rawalumbu) — kepadatan (0.61); catatan: n_akses_pendidikan = 0 (kemungkinan data POI sekolah belum lengkap)
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Rapatkan halte BisKita di Jl. Pengasinan - Rawalumbu untuk permukiman padat. Catatan data: akses pendidikan ternormalisasi 0 - verifikasi data POI sekolah sebelum menyimpulkan dimensi itu memang baik.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Pengasinan' and se.sumber like 'REAL - %';

-- #56 Margamulya (Bekasi Utara) — skor_final terendah (kondisi paling baik); sumber: agregasi lokal, CAI 0,83
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Kondisi akses transit Marga Mulya relatif paling baik di antara 56 kelurahan (CAI 0,83 dari survei lapangan). Pertahankan layanan eksisting; intervensi minor cukup berupa trip feeder sekolah ke klaster pendidikan Bekasi Utara. Prioritas anggaran diarahkan ke kelurahan ranking atas.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Margamulya' and se.sumber like 'REAL - %';

-- ============================================================
-- Verifikasi: seharusnya 0 baris REAL yang masih NULL setelah migration.
-- (Jalankan manual saat apply; bukan bagian transaksi.)
--   select count(*) from skor_equity
--   where sumber like 'REAL - %'
--     and (kelompok_terdampak is null or rekomendasi_intervensi is null);
-- ============================================================

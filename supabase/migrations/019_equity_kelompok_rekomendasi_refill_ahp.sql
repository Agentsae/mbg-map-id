-- ============================================================
-- GeoTransit Insight — 019_equity_kelompok_rekomendasi_refill_ahp.sql
--
-- KENAPA MIGRATION INI ADA:
-- Setelah bobot AHP pairwise final (018_konfigurasi_bobot_ahp_final.sql,
-- 2026-09-03) seluruh skor dihitung ulang. Untuk skor_equity, pipeline
-- etl/aggregate_equity_kelurahan.py (upload_equity_scores_real) melakukan
-- DELETE + INSERT 56 baris REAL, dan pada INSERT itu kolom naratif
-- kelompok_terdampak + rekomendasi_intervensi SENGAJA di-set NULL (bukan
-- keluaran formula — lihat docstring modul itu). Akibatnya isi yang
-- ditanam 014_equity_kelompok_rekomendasi_isi.sql hilang dari 56 baris
-- baru. Migration ini MENGISI ULANG kolom itu.
--
-- PERUBAHAN NILAI vs 014 (recompute bobot AHP; dicek baris per baris):
--   * Arah skala, ranking 1 = paling dirugikan, #56 = kondisi paling baik:
--     TIDAK berubah. Setelah recompute, ranking 1 TETAP Arenjaya dan
--     ranking 56 TETAP Margamulya (Spearman rho ranking lama vs baru =
--     0,98; mean |Δrank| = 1,9; mover terbesar Bantargebang #18->#31).
--   * Nilai n_* per dimensi kerentanan (kepadatan, usia_rentan,
--     akses_pendidikan/kesehatan/kerja) TIDAK berubah oleh pergantian
--     bobot — normalisasi min-max tiap dimensi independen dari bobot —
--     jadi seluruh penetapan kelompok_terdampak + klaim "dimensi terlemah"
--     di teks 014 TETAP VALID dan disalin apa adanya di sini.
--   * SATU koreksi angka: #56 Margamulya. Teks 014 menyebut "CAI 0,83";
--     skor_cai_rata2 Margamulya hasil recompute = 0,8574 (~0,86, dari 1
--     titik kandidat KND-003 "Akses Masuk Stasiun Bekasi"). Diperbarui ke
--     "CAI 0,86" supaya angka di narasi bisa ditelusuri ke skor_cai live.
--   * Tidak ada kelurahan yang intensitas rekomendasinya jadi keliru:
--     satu-satunya rekomendasi "pertahankan (jangan bangun baru)" ada di
--     #56 Margamulya yang tetap peringkat terbawah; #1..#55 tetap
--     rekomendasi "bangun/perluas layanan" dan semuanya masih di paruh
--     yang relevan untuk intervensi aktif.
--
-- Komentar "#N" di tiap statement = snapshot ranking LAMA (sejak 014,
-- 2026-08-29). Sudah stale sebelum migration ini (mis. Durenjaya ditandai
-- #2 padahal sejak lama #11-#12) dan DIBIARKAN sebagai jejak dokumentasi —
-- yang mengikat tetap ba.nama_kelurahan, bukan angka itu.
--
-- IDEMPOTEN / AMAN DI-RERUN: sama seperti 014 — UPDATE ... FROM
-- batas_administrasi ba di-key ke ba.nama_kelurahan (unik di 56 baris RBI)
-- dan dibatasi se.sumber LIKE 'REAL - %'. Menjalankan ulang tidak
-- menambah baris / tidak mengubah nilai lebih lanjut.
--
-- URUTAN FILE: migration ke-019, setelah 018_konfigurasi_bobot_ahp_final.sql.
-- Perubahan vs sebelumnya: mengisi ULANG 2 kolom naratif skor_equity yang
-- ter-NULL oleh recompute equity + 1 koreksi angka pada baris Margamulya.
-- TIDAK ada DDL, tidak menyentuh skor numerik / ranking / tabel lain.
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
  rekomendasi_intervensi = 'Akses fasilitas kesehatan Jatimurni adalah dimensi paling timpang di seluruh sampel 56 kelurahan. Sediakan angkutan pengumpan reguler dari Jl. Raya Jatimurni - Jl. Wibawa Mukti II menuju puskesmas/RS rujukan dan halte LRT Jabodebek Jatibening, dengan prioritas jam layanan siang untuk kebutuhan warga lanjut usia.'
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
  rekomendasi_intervensi = 'Akses ke fasilitas pendidikan adalah dimensi paling tertinggal di Jatimekar, sehingga pelajar bergantung pada kendaraan pribadi atau ojek. Operasikan feeder rute pendidikan dari Jl. Raya Jatimekar (kawasan Kemang IFI) ke klaster SMA/SMK Jatiasih dan ke halte LRT Jabodebek Cikunir.'
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
  rekomendasi_intervensi = 'Akses pendidikan di kelurahan Bantargebang adalah yang paling tertinggal di antara seluruh 56 kelurahan yang dinilai. Operasikan feeder rute sekolah dari Jl. Raya Narogong ke klaster SMP/SMA terdekat lalu Stasiun Bekasi.'
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

-- #38 Margajaya (Bekasi Selatan) — akses_pendidikan (0.81)
--   CATATAN ANALIS (jangan dimasukkan ke teks rekomendasi yang tampil di dashboard):
--   n_akses_kesehatan & n_akses_kerja = 0 untuk kelurahan ini — kemungkinan data
--   POI faskes/tempat kerja belum lengkap, bukan berarti kedua dimensi itu benar-benar
--   baik. Verifikasi kelengkapan POI sebelum menarik kesimpulan atas dua dimensi tsb.
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Trip feeder sekolah dari Marga Jaya ke klaster sekolah Bekasi Selatan, tersambung koridor BisKita menuju Stasiun Bekasi.'
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

-- #55 Pengasinan (Rawalumbu) — kepadatan (0.61)
--   CATATAN ANALIS (jangan dimasukkan ke teks rekomendasi yang tampil di dashboard):
--   n_akses_pendidikan = 0 untuk kelurahan ini — kemungkinan data POI sekolah belum
--   lengkap, bukan berarti akses pendidikan benar-benar baik. Verifikasi POI sekolah
--   sebelum menarik kesimpulan atas dimensi tsb.
update skor_equity se set
  kelompok_terdampak = array['penduduk permukiman padat'],
  rekomendasi_intervensi = 'Rapatkan halte BisKita di Jl. Pengasinan - Rawalumbu untuk permukiman padat, dengan oper ke Stasiun Bekasi.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Pengasinan' and se.sumber like 'REAL - %';

-- #56 Margamulya (Bekasi Utara) — skor_final terendah (kondisi paling baik); sumber: agregasi lokal, CAI 0,86 (KND-003)
update skor_equity se set
  kelompok_terdampak = array['pelajar & keluarga tanpa sekolah dalam jangkauan jalan kaki'],
  rekomendasi_intervensi = 'Kondisi akses transit Marga Mulya relatif paling baik di antara 56 kelurahan (CAI 0,86 dari survei lapangan, rata-rata 1 titik kandidat KND-003). Pertahankan layanan eksisting; intervensi minor cukup berupa trip feeder sekolah ke klaster pendidikan Bekasi Utara. Prioritas anggaran diarahkan ke kelurahan ranking atas.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Margamulya' and se.sumber like 'REAL - %';

-- ============================================================
-- PRE-CHECK opsional (jalankan manual SEBELUM db push, tidak menerapkan apa pun):
-- daftar literal nama_kelurahan di file ini yang TIDAK match ejaan NAMOBJ RBI
-- di batas_administrasi. Kalau query ini mengembalikan baris, perbaiki ejaannya
-- di statement UPDATE terkait sebelum push.
--
--   select v.nama
--   from (values
--     ('Arenjaya'),('Durenjaya'),('Kaliabang Tengah'),('Jatimurni'),
--     ('Jatirahayu'),('Kalibaru'),('Pejuang'),('Jatimekar'),('Kranji'),
--     ('Cikiwul'),('Jatirangga'),('Harapanbaru'),('Perwira'),('Teluk Pucung'),
--     ('Kotabaru'),('Jaticempaka'),('Cimuning'),('Bantargebang'),('Bintarajaya'),
--     ('Harapanmulya'),('Jatikarya'),('Jatimelati'),('Jatibening Baru'),
--     ('Sumurbatu'),('Bintara'),('Jatiwaringin'),('Jatikramat'),('Harapanjaya'),
--     ('Jakasampurna'),('Pekayonjaya'),('Bekasijaya'),('Mustikajaya'),
--     ('Padurenan'),('Jatisari'),('Margahayu'),('Jatiranggon'),('Jatirasa'),
--     ('Margajaya'),('Medansatria'),('Jatiasih'),('Jatimakmur'),('Jatibening'),
--     ('Jatisampurna'),('Jatiraden'),('Ciketingudik'),('Kayuringinjaya'),
--     ('Jatiwarna'),('Mustikasari'),('Jatiluhur'),('Jakamulya'),('Sepanjangjaya'),
--     ('Bojong Rawalumbu'),('Bojongmenteng'),('Jakasetia'),('Pengasinan'),
--     ('Margamulya')
--   ) as v(nama)
--   left join batas_administrasi ba on ba.nama_kelurahan = v.nama
--   where ba.id is null;
-- ============================================================

-- ============================================================
-- GUARD HASIL (DIEKSEKUSI, bukan komentar).
-- Kalau ada literal nama_kelurahan di atas yang tidak match ejaan NAMOBJ RBI,
-- UPDATE-nya mengenai 0 baris TANPA error dan baris REAL-nya tetap NULL.
-- Blok ini menggagalkan migration (pesan sama seperti 014, migration ke-019) di titik itu — dengan menyebut nama asli
-- dari DB — alih-alih "sukses" diam-diam dengan dashboard bolong.
-- ============================================================
do $$
declare
  n_null int;
  sisa   text;
  n_isi  int;
begin
  select count(*),
         string_agg(ba.nama_kelurahan, ', ' order by se.ranking)
    into n_null, sisa
  from skor_equity se
  join batas_administrasi ba on ba.id = se.kelurahan_id
  where se.sumber like 'REAL - %'
    and (se.kelompok_terdampak is null or se.rekomendasi_intervensi is null);

  if n_null > 0 then
    raise exception
      '019 GAGAL: % baris REAL skor_equity masih NULL (kelurahan: %). Cek ejaan literal nama_kelurahan di migration ini vs batas_administrasi.nama_kelurahan.',
      n_null, sisa;
  end if;

  -- sanity: pastikan tepat 56 baris REAL yang terisi, bukan lebih/kurang
  select count(*) into n_isi
  from skor_equity
  where sumber like 'REAL - %'
    and kelompok_terdampak is not null
    and rekomendasi_intervensi is not null;

  if n_isi <> 56 then
    raise exception '019 GAGAL: mengharapkan 56 baris REAL terisi, dapat %.', n_isi;
  end if;
end $$;

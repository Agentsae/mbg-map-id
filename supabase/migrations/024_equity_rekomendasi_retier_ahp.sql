-- ============================================================
-- GeoTransit Insight — 024_equity_rekomendasi_retier_ahp.sql
--
-- KENAPA MIGRATION INI ADA:
-- 019_equity_kelompok_rekomendasi_refill_ahp.sql menulis rekomendasi_intervensi
-- "mutu naratif penuh" untuk yang dilabelinya "#1..#10", TAPI penomoran itu
-- masih snapshot ranking LAMA (era 014, pra-AHP). Setelah recompute bobot AHP
-- (018) + agregasi equity 2026-09-03, se.ranking yang SEBENARNYA bergeser.
-- Akibatnya ada kelurahan yang KINI masuk 10-besar tapi membawa teks ringkas
-- gaya "ranking 11-56", sedangkan sebagian kelurahan yang KINI di luar 10-besar
-- masih membawa teks panjang. Contoh gejala: #2 Cimuning & #7 Jatirangga bergaya
-- ringkas, sementara #12 Durenjaya bergaya penuh.
--
-- APA YANG DIUBAH:
-- UPGRADE rekomendasi_intervensi untuk kelurahan yang KINI ada di 10-besar
-- (se.ranking 1..10, se.sumber LIKE 'REAL - %') dan teksnya masih ringkas,
-- ke kedalaman SMART Spasial yang sama dengan entri Arenjaya/Kaliabang Tengah
-- di 019 (lokasi/koridor spesifik, ukuran terukur spasi halte / jarak jalan
-- kaki, jangkar transit massal KRL/LRT/BisKita, jadwal feeder time-bound),
-- selaras dimensi kerentanan TERLEMAH masing-masing kelurahan (kolom n_*).
--
-- Snapshot ranking saat migration ini ditulis (dari query live 2026-09-03):
--   #1  Arenjaya         len 351  (penuh — tidak disentuh)
--   #2  Cimuning         len 148  (RINGKAS  -> di-upgrade di sini)
--   #3  Kaliabang Tengah len 316  (penuh — tidak disentuh)
--   #4  Jatimurni        len 313  (penuh — tidak disentuh)
--   #5  Pejuang          len 240  (penuh — tidak disentuh)
--   #6  Jatirahayu       len 302  (penuh — tidak disentuh)
--   #7  Jatirangga       len 261  (gaya seksi "11-56" 019 -> di-upgrade di sini)
--   #8  Kalibaru         len 238  (penuh — tidak disentuh)
--   #9  Jatimekar        len 281  (penuh — tidak disentuh)
--   #10 Kranji           len 289  (penuh — tidak disentuh)
-- Kelurahan yang KINI keluar dari 10-besar TIDAK di-downgrade — teks panjang
-- yang sudah ada dibiarkan (lebih panjang tidak masalah).
--
-- Nilai n_* per dimensi yang jadi dasar teks (query live 2026-09-03):
--   Cimuning   : kepadatan 0.2181 | usia 0.0970 | pendidikan 0.6316 |
--                kesehatan 0.3738 | kerja 0.4155 | aksesibilitas_inv 1.0000
--                -> aksesibilitas transit TERBURUK dari 56 kelurahan
--                   (n_aksesibilitas_inv maksimum = 1,00; CAI terendah);
--                   dimensi kerentanan terlemah = akses pendidikan (0,63).
--   Jatirangga : kepadatan 0.0476 | usia 0.1165 | pendidikan 0.6890 |
--                kesehatan 0.6258 | kerja 0.5380 | aksesibilitas_inv 0.5779
--                -> tiga celah akses (pendidikan/kesehatan/kerja) sama-sama
--                   lemah; kepadatan sangat rendah -> intervensi = layanan
--                   pengumpan, bukan halte massal.
--
-- TIDAK menyentuh: skor numerik, ranking, kelompok_terdampak (dibiarkan apa
-- adanya; kedua baris ini kelompok_terdampak-nya sudah terisi, bukan NULL),
-- tabel/kolom/RLS lain. Tidak ada DDL.
--
-- IDEMPOTEN / AMAN DI-RERUN: UPDATE ... FROM batas_administrasi ba di-key ke
-- ba.nama_kelurahan (unik di 56 baris RBI) + dibatasi se.sumber LIKE 'REAL - %'.
-- Menjalankan ulang hanya menulis nilai literal yang sama; tidak menambah baris.
--
-- URUTAN FILE: migration ke-024, setelah 023_penduduk_sumber_relabel.sql.
-- Perubahan vs sebelumnya: hanya isi kolom rekomendasi_intervensi pada 2 baris
-- skor_equity (Cimuning, Jatirangga) supaya seluruh 10-besar AHP terkini
-- membawa rekomendasi SMART Spasial lengkap.
-- ============================================================

-- Guard: kolom target harus sudah ada (dibuat di 005).
do $$
begin
  if not exists (
    select 1 from information_schema.columns
    where table_name = 'skor_equity' and column_name = 'rekomendasi_intervensi'
  ) then
    raise exception 'skor_equity.rekomendasi_intervensi belum ada — jalankan 005_equity_kelompok_rekomendasi.sql dulu';
  end if;
end $$;

-- #2 (ranking AHP terkini) Cimuning (Mustikajaya)
--   Terlemah: aksesibilitas transit terburuk se-kota (n_aksesibilitas_inv = 1,00);
--   dimensi kerentanan terlemah = akses pendidikan (n = 0,63).
update skor_equity se set
  rekomendasi_intervensi = 'Cimuning memiliki skor aksesibilitas transit terendah dari seluruh 56 kelurahan (CAI terendah, n_aksesibilitas_inv = 1,00) dan belum tersentuh koridor BisKita Trans Patriot. Buka trayek pengumpan harian di koridor Jl. Raya Cimuning - Jl. Padurenan yang menautkan permukiman Cimuning ke Stasiun Bekasi Timur (KRL) via Jl. Chairil Anwar, dengan spasi halte < 400 m di sepanjang permukiman dan satu halte tepat di depan klaster sekolah karena akses pendidikan adalah dimensi kerentanan terlemah (n = 0,63). Operasikan trip sekolah 06.00-07.30 dan 12.00-15.00 serta penguatan jam puncak komuter 05.30-08.00 dan 16.00-19.00.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Cimuning' and se.sumber like 'REAL - %';

-- #7 (ranking AHP terkini) Jatirangga (Jatisampurna)
--   Terlemah: tiga celah akses sekaligus — pendidikan (0,69), kesehatan (0,63),
--   kerja (0,54); kepadatan sangat rendah (0,05) -> layanan pengumpan.
update skor_equity se set
  rekomendasi_intervensi = 'Jatirangga menanggung tiga celah akses sekaligus - pendidikan (n = 0,69), kesehatan (n = 0,63), dan kerja (n = 0,54) - sementara kepadatannya rendah, sehingga intervensi yang tepat adalah layanan angkutan pengumpan, bukan halte massal. Operasikan feeder harian di koridor Jl. Raya Jatirangga - Jl. Kranggan Raya menuju Stasiun LRT Jabodebek Harjamukti dengan spasi halte < 500 m, trase melewati klaster sekolah dan Puskesmas Jatisampurna lalu menyambung ke koridor kerja Cibubur - Cileungsi. Jadwalkan layanan 05.30-20.00 dan perkuat trip jam puncak 05.30-08.00 serta 16.30-19.30 untuk pekerja komuter berpendapatan rendah.'
from batas_administrasi ba
where se.kelurahan_id = ba.id and ba.nama_kelurahan = 'Jatirangga' and se.sumber like 'REAL - %';

-- ============================================================
-- GUARD HASIL (DIEKSEKUSI, bukan komentar).
-- 1) Setiap baris 10-besar AHP terkini (se.ranking 1..10, REAL) harus punya
--    rekomendasi_intervensi >= 200 karakter. Ambang 200 dipilih karena entri
--    "mutu naratif penuh" 019 (Arenjaya 351, Kaliabang 316, dst.) semuanya
--    jauh di atas itu, sedangkan teks ringkas gaya "11-56" (mis. Cimuning
--    lama 148, Harapanbaru 127) di bawahnya — 200 memisahkan keduanya dengan
--    margin aman tanpa memaksa panjang artifisial.
-- 2) Tidak boleh ada baris REAL (semua 56) dengan kolom naratif NULL.
-- ============================================================
do $$
declare
  n_pendek int;
  daftar   text;
  n_null   int;
begin
  select count(*),
         string_agg(
           ba.nama_kelurahan || ' (#' || se.ranking || ', len '
           || coalesce(length(se.rekomendasi_intervensi), 0) || ')',
           ', ' order by se.ranking
         )
    into n_pendek, daftar
  from skor_equity se
  join batas_administrasi ba on ba.id = se.kelurahan_id
  where se.sumber like 'REAL - %'
    and se.ranking between 1 and 10
    and (se.rekomendasi_intervensi is null or length(se.rekomendasi_intervensi) < 200);

  if n_pendek > 0 then
    raise exception
      '024 GAGAL: % baris 10-besar AHP punya rekomendasi < 200 char: %. Cek ejaan nama_kelurahan di UPDATE vs batas_administrasi, atau ranking sudah bergeser lagi.',
      n_pendek, daftar;
  end if;

  select count(*) into n_null
  from skor_equity
  where sumber like 'REAL - %'
    and (rekomendasi_intervensi is null or kelompok_terdampak is null);

  if n_null > 0 then
    raise exception '024 GAGAL: % baris REAL skor_equity punya kolom naratif (rekomendasi/kelompok) NULL.', n_null;
  end if;
end $$;

-- Uji cepat sesudah push:
--   select se.ranking, ba.nama_kelurahan, se.skor_final,
--          length(se.rekomendasi_intervensi) as len_rekom
--   from skor_equity se
--   join batas_administrasi ba on ba.id = se.kelurahan_id
--   where se.sumber like 'REAL - %'
--   order by se.ranking limit 12;

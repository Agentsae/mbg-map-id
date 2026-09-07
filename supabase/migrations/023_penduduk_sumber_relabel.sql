-- ============================================================
-- GeoTransit Insight — 023_penduduk_sumber_relabel.sql
--
-- KENAPA MIGRATION INI ADA (doc sweep product-analyst, 2026-09-03):
-- etl/load_penduduk.py SUMBER_LABEL diganti dari
--   "Disdukcapil Kota Bekasi - DKB Semester 1 2026"  (lama)
-- ke
--   "DKB Semester I 2026 - Ditjen Dukcapil Kemendagri" (baru, atribusi
--   kanonik tim 2026-08-28 — instansi PUSAT, bukan dinas kota; lihat CLAUDE.md).
--
-- String itu dipakai load_penduduk.py untuk DUA hal:
--   (a) ditulis ke kolom penduduk.sumber saat insert, dan
--   (b) KUNCI idempotency guard di upload():  .eq("sumber", SUMBER_LABEL)
--       -> "kalau sudah ada baris dengan label ini, jangan insert lagi".
--
-- Ke-56 baris penduduk REAL di DB masih memakai label LAMA. Tanpa relabel
-- ini, load_penduduk.py yang di-run lagi TIDAK menemukan baris berlabel
-- baru -> guard lolos -> 56 baris DUPLIKAT ter-insert. Migration ini
-- menyelaraskan data ke label baru supaya guard tetap efektif.
--
-- CEK CODE (product-analyst + data-ai-analyst, grep 2026-09-03): SATU-satunya
-- tempat literal string lama muncul adalah komentar di load_penduduk.py
-- (yang menunjuk ke migration ini). TIDAK ada kode lain yang mem-filter
-- tabel penduduk by sumber == label lama (compute_tdi_full.py &
-- aggregate_equity_kelurahan.py membaca penduduk TANPA filter sumber). Jadi
-- relabel ini aman, tidak memutus join/aggregasi mana pun.
--
-- IDEMPOTEN / AMAN DI-RERUN: UPDATE ... WHERE sumber = '<label lama>'.
-- Rerun kedua mengenai 0 baris (label lama sudah tidak ada). Tidak
-- menyentuh kolom lain, tabel lain, DDL, atau RLS.
--
-- URUTAN FILE: migration ke-023, setelah 022_potensi_penerima_manfaat.sql.
-- (Coordinator menyebut "021_..." di catatan tugas — 021 sudah terpakai
--  untuk get_tdi_breakdown out-of-bounds; file relabel ini jadi 023.)
-- Perubahan vs sebelumnya: HANYA nilai kolom penduduk.sumber pada 56 baris
-- (relabel string), tidak ada perubahan angka demografi.
-- ============================================================

update penduduk
set sumber = 'DKB Semester I 2026 - Ditjen Dukcapil Kemendagri'
where sumber = 'Disdukcapil Kota Bekasi - DKB Semester 1 2026';

-- GUARD HASIL (dieksekusi): pastikan tidak ada sisa label lama dan jumlah
-- baris tetap 56 (relabel, bukan tambah/hapus).
do $$
declare
  n_lama  int;
  n_baru  int;
  n_total int;
begin
  select count(*) into n_lama  from penduduk where sumber = 'Disdukcapil Kota Bekasi - DKB Semester 1 2026';
  select count(*) into n_baru  from penduduk where sumber = 'DKB Semester I 2026 - Ditjen Dukcapil Kemendagri';
  select count(*) into n_total from penduduk;

  if n_lama > 0 then
    raise exception '023 GAGAL: masih ada % baris penduduk berlabel lama.', n_lama;
  end if;

  -- 56 baris REAL diharapkan; kalau DB fresh tanpa data penduduk, n_baru = 0
  -- dan itu bukan kegagalan (tidak ada yang perlu di-relabel).
  if n_baru > 0 and n_total <> 56 then
    raise warning '023: penduduk total = % baris (diharapkan 56 untuk data REAL saat ini).', n_total;
  end if;
end $$;

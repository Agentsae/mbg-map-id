-- ============================================================
-- GeoTransit Insight — 008_batas_administrasi_sumber.sql
-- Tambahan kolom `sumber` pada batas_administrasi, supaya konsisten
-- dengan pola tabel lain (penduduk.sumber, poi.sumber) yang sudah
-- membedakan data sintetis vs data resmi lewat kolom ini.
--
-- Konteks: sampai migration ini, batas_administrasi TIDAK punya cara
-- eksplisit membedakan baris dummy (6 "kelurahan" bbox kasar dari
-- 006_seed_dummy_data.sql) dari baris data resmi (56 kelurahan poligon
-- asli RBI 25K BIG yang mulai diupload lewat
-- etl/build_admin_boundaries_from_rbi.py). Nama kelurahan TIDAK
-- collide (dicek manual: dummy pakai spasi/ejaan longgar seperti
-- 'Mustika Jaya', 'Bantar Gebang', 'Rawa Lumbu', data resmi RBI pakai
-- ejaan BIG tanpa spasi seperti 'Mustikajaya', 'Bantargebang',
-- 'Rawalumbu' — TIDAK ada baris dummy & resmi dengan nama_kelurahan
-- identik), jadi menambah baris resmi di sini AMAN dilakukan secara
-- ADDITIVE (insert baru, tidak menyentuh/menghapus 6 baris dummy),
-- konsisten dengan pola etl/fetch_upload_osm_poi.py (dummy poi/OSM poi
-- hidup berdampingan, dibedakan lewat kolom sumber).
--
-- Ini PENAMBAHAN kolom, bukan perombakan skema 001_init_tables.sql —
-- kolom lama & baris data lama tidak diubah/dihapus.
-- ============================================================

alter table batas_administrasi
    add column if not exists sumber text;

comment on column batas_administrasi.sumber is
    'Asal data poligon. Nilai yang dipakai sejauh ini: ''DATA SINTETIS - seed '
    'testing, bukan batas administratif asli'' (6 baris bbox kasar dari '
    '006_seed_dummy_data.sql, dipertahankan untuk testing RPC simulate_new_stop() '
    '& demo Equity Dashboard sampai data penduduk BPS + bobot AHP final tersedia) '
    'atau ''BIG RBI 25K KUGI50 2022-12-31 (tanahair.indonesia.go.id)'' (56 kelurahan '
    'poligon asli, lihat etl/build_admin_boundaries_from_rbi.py).';

-- Backfill baris dummy yang sudah ada SEBELUM migration ini supaya kolom
-- baru tidak NULL untuk baris lama (idempotent: coalesce, tidak menimpa
-- baris yang kebetulan sudah punya nilai sumber lain).
update batas_administrasi
set sumber = coalesce(sumber, 'DATA SINTETIS - seed testing, bukan batas administratif asli')
where nama_kelurahan in
    ('Mustika Jaya', 'Bantar Gebang', 'Rawa Lumbu', 'Bekasi Utara', 'Marga Mulya', 'Bekasi Timur')
    and sumber is null;

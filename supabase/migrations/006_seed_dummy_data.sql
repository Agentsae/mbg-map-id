-- ============================================================
-- GeoTransit Insight — 006_seed_dummy_data.sql
-- *** DATA SINTETIS / DUMMY — BUKAN DATA LAPANGAN ASLI ***
--
-- Tujuan: mengisi 4 tabel yang masih kosong (batas_administrasi,
-- penduduk, poi, halte_eksisting) supaya RPC simulate_new_stop()
-- (003_simulate_new_stop.sql) bisa diuji end-to-end (saat ini selalu
-- return 0/null karena tabel-tabel ini kosong), dan supaya
-- upload_to_supabase.upload_equity_scores() punya kelurahan_id untuk
-- dicocokkan (lihat etl/compute_scores.load_demo_equity_data()).
--
-- Koordinat & sebaran titik di sini KASAR/APPROXIMATE — cukup untuk
-- testing & demo, TIDAK untuk laporan/analisis final. Ganti/hapus
-- baris-baris ini begitu data BPS/Dapodik/Kemenkes/RTRW/OSM/survei
-- MAPID Apps yang asli sudah masuk lewat etl/upload_to_supabase.py.
--
-- Semua geometry pakai SRID 4326 (WGS84, lon/lat) sesuai skema
-- 001_init_tables.sql, dan dibuat lewat fungsi PostGIS (ST_MakeEnvelope /
-- ST_MakePoint) supaya validitasnya terjamin (bukan WKT tulis tangan
-- yang rawan salah urutan titik).
-- ============================================================

-- Guard idempotency: batas_administrasi/penduduk/poi tidak punya unique
-- constraint alami untuk "on conflict do nothing" yang berarti (PK identity
-- saja tidak cukup), jadi migration ini dibungkus DO block yang skip
-- seluruh seed kalau kelurahan dummy pertama sudah pernah dimasukkan —
-- supaya aman dijalankan ulang tanpa menghasilkan baris duplikat.
do $$
begin
  if exists (
      select 1 from batas_administrasi
      where nama_kelurahan = 'Mustika Jaya' and nama_kecamatan = 'Mustika Jaya'
  ) then
    raise notice '006_seed_dummy_data: data dummy tampaknya sudah pernah di-seed, dilewati (idempotent).';
    return;
  end if;

-- ------------------------------------------------------------
-- 1. batas_administrasi — 6 "kelurahan" dummy di sekitar Kota Bekasi
--    (bbox kasar ~1.1km x 1.1km per kelurahan, TIDAK presisi terhadap
--    batas administratif asli). 5 nama pertama SENGAJA disamakan
--    dengan nama_kelurahan di compute_scores.load_demo_equity_data()
--    supaya upload_equity_scores() bisa mencocokkan kelurahan_id.
--    'Bekasi Timur' ditambahkan supaya titik uji RPC simulate_new_stop
--    (contoh koordinat -6.2185, 107.0074 di 003_simulate_new_stop.sql)
--    berada di dalam area yang punya data penduduk/halte/poi dummy.
--    nama_kecamatan sengaja disamakan dengan nama_kelurahan (dummy
--    testing) — pada data asli nanti satu kecamatan wajar mencakup
--    beberapa kelurahan berbeda.
-- ------------------------------------------------------------
insert into batas_administrasi (nama_kecamatan, nama_kelurahan, geom) values
    ('Mustika Jaya',  'Mustika Jaya',  ST_MakeEnvelope(107.0250, -6.2700, 107.0450, -6.2500, 4326)),
    ('Bantar Gebang', 'Bantar Gebang', ST_MakeEnvelope(107.0400, -6.3300, 107.0600, -6.3100, 4326)),
    ('Rawa Lumbu',    'Rawa Lumbu',    ST_MakeEnvelope(107.0050, -6.2600, 107.0250, -6.2400, 4326)),
    ('Bekasi Utara',  'Bekasi Utara',  ST_MakeEnvelope(106.9850, -6.2100, 107.0050, -6.1900, 4326)),
    ('Marga Mulya',   'Marga Mulya',   ST_MakeEnvelope(106.9750, -6.2200, 106.9950, -6.2000, 4326)),
    ('Bekasi Timur',  'Bekasi Timur',  ST_MakeEnvelope(106.9974, -6.2285, 107.0174, -6.2085, 4326))
on conflict do nothing;

-- ------------------------------------------------------------
-- 2. penduduk — beberapa titik per kelurahan (bukan sensus,
--    representasi kasar utk testing radius query di simulate_new_stop).
--    Total per kelurahan kira-kira mengikuti kepadatan_penduduk di
--    compute_scores.load_demo_equity_data() supaya konsisten secara
--    urutan besaran (bukan identik persis).
-- ------------------------------------------------------------
insert into penduduk (kelurahan_id, jumlah_penduduk, proporsi_lansia, proporsi_balita, geom, sumber)
select k.id, v.jumlah_penduduk, v.proporsi_lansia, v.proporsi_balita,
       ST_SetSRID(ST_MakePoint(v.lon, v.lat), 4326), 'DATA SINTETIS - seed testing, bukan data BPS/Dukcapil asli'
from (values
    -- Mustika Jaya (total dummy ~15200)
    ('Mustika Jaya', 4200, 0.09, 0.08, 107.0300, -6.2650),
    ('Mustika Jaya', 3900, 0.10, 0.07, 107.0380, -6.2650),
    ('Mustika Jaya', 3600, 0.11, 0.08, 107.0300, -6.2570),
    ('Mustika Jaya', 3500, 0.09, 0.09, 107.0400, -6.2560),
    -- Bantar Gebang (total dummy ~9600)
    ('Bantar Gebang', 2600, 0.08, 0.09, 107.0450, -6.3250),
    ('Bantar Gebang', 2500, 0.07, 0.08, 107.0550, -6.3250),
    ('Bantar Gebang', 2300, 0.08, 0.07, 107.0450, -6.3150),
    ('Bantar Gebang', 2200, 0.09, 0.08, 107.0550, -6.3150),
    -- Rawa Lumbu (total dummy ~13800)
    ('Rawa Lumbu', 3800, 0.10, 0.08, 107.0100, -6.2550),
    ('Rawa Lumbu', 3600, 0.09, 0.09, 107.0200, -6.2550),
    ('Rawa Lumbu', 3300, 0.11, 0.07, 107.0100, -6.2450),
    ('Rawa Lumbu', 3100, 0.10, 0.08, 107.0200, -6.2450),
    -- Bekasi Utara (total dummy ~12100)
    ('Bekasi Utara', 3200, 0.07, 0.09, 106.9900, -6.2050),
    ('Bekasi Utara', 3100, 0.08, 0.08, 107.0000, -6.2050),
    ('Bekasi Utara', 3000, 0.07, 0.07, 106.9900, -6.1950),
    ('Bekasi Utara', 2800, 0.08, 0.08, 107.0000, -6.1950),
    -- Marga Mulya (total dummy ~8200)
    ('Marga Mulya', 2200, 0.06, 0.07, 106.9800, -6.2150),
    ('Marga Mulya', 2100, 0.07, 0.06, 106.9900, -6.2150),
    ('Marga Mulya', 2000, 0.06, 0.07, 106.9800, -6.2050),
    ('Marga Mulya', 1900, 0.07, 0.08, 106.9900, -6.2050),
    -- Bekasi Timur (total dummy ~11000) — termasuk titik dekat contoh
    -- koordinat uji RPC simulate_new_stop(-6.2185, 107.0074)
    ('Bekasi Timur', 3200, 0.08, 0.08, 107.0074, -6.2195), -- ~120m dari titik uji
    ('Bekasi Timur', 2900, 0.09, 0.07, 107.0130, -6.2200),
    ('Bekasi Timur', 2600, 0.08, 0.08, 107.0020, -6.2150),
    ('Bekasi Timur', 2300, 0.07, 0.09, 107.0130, -6.2130)
) as v(nama_kelurahan, jumlah_penduduk, proporsi_lansia, proporsi_balita, lon, lat)
join batas_administrasi k on k.nama_kelurahan = v.nama_kelurahan;

-- ------------------------------------------------------------
-- 3. poi — sekolah/faskes/kerja tersebar di 6 area dummy di atas,
--    termasuk beberapa dalam radius 400m dari titik uji RPC supaya
--    fasilitas_pendidikan_400m / fasilitas_kesehatan_400m tidak 0.
-- ------------------------------------------------------------
insert into poi (jenis, nama, geom, sumber) values
    ('sekolah', 'SDN Dummy Mustika Jaya 1',  ST_SetSRID(ST_MakePoint(107.0320, -6.2630), 4326), 'DATA SINTETIS - seed testing'),
    ('sekolah', 'SMPN Dummy Bantar Gebang 1', ST_SetSRID(ST_MakePoint(107.0480, -6.3220), 4326), 'DATA SINTETIS - seed testing'),
    ('sekolah', 'SDN Dummy Rawa Lumbu 1',     ST_SetSRID(ST_MakePoint(107.0120, -6.2520), 4326), 'DATA SINTETIS - seed testing'),
    ('sekolah', 'SMAN Dummy Bekasi Utara 1',  ST_SetSRID(ST_MakePoint(106.9930, -6.2020), 4326), 'DATA SINTETIS - seed testing'),
    ('sekolah', 'SDN Dummy Bekasi Timur 1',   ST_SetSRID(ST_MakePoint(107.0080, -6.2190), 4326), 'DATA SINTETIS - seed testing'), -- ~70m dari titik uji
    ('faskes',  'Puskesmas Dummy Mustika Jaya', ST_SetSRID(ST_MakePoint(107.0340, -6.2600), 4326), 'DATA SINTETIS - seed testing'),
    ('faskes',  'Klinik Dummy Rawa Lumbu',      ST_SetSRID(ST_MakePoint(107.0150, -6.2480), 4326), 'DATA SINTETIS - seed testing'),
    ('faskes',  'Puskesmas Dummy Bekasi Utara', ST_SetSRID(ST_MakePoint(106.9970, -6.2000), 4326), 'DATA SINTETIS - seed testing'),
    ('faskes',  'Klinik Dummy Bekasi Timur',    ST_SetSRID(ST_MakePoint(107.0060, -6.2180), 4326), 'DATA SINTETIS - seed testing'), -- ~180m dari titik uji
    ('faskes',  'Puskesmas Pembantu Dummy Marga Mulya', ST_SetSRID(ST_MakePoint(106.9850, -6.2100), 4326), 'DATA SINTETIS - seed testing'),
    ('kerja',   'Kawasan Industri Dummy Bantar Gebang', ST_SetSRID(ST_MakePoint(107.0520, -6.3180), 4326), 'DATA SINTETIS - seed testing'),
    ('kerja',   'Ruko/Pertokoan Dummy Bekasi Timur',    ST_SetSRID(ST_MakePoint(107.0100, -6.2210), 4326), 'DATA SINTETIS - seed testing'),
    ('kerja',   'Perkantoran Dummy Marga Mulya',        ST_SetSRID(ST_MakePoint(106.9880, -6.2130), 4326), 'DATA SINTETIS - seed testing')
on conflict do nothing;

-- ------------------------------------------------------------
-- 4. halte_eksisting — 1 titik per kelurahan dummy (6 total), termasuk
--    satu di dekat titik uji RPC supaya transit_eksisting_terdekat
--    tidak null saat simulate_new_stop() dites.
-- ------------------------------------------------------------
insert into halte_eksisting (
    id_halte_survei, nama, geom, kecamatan, kelurahan,
    skor_kelengkapan_fisik, headway_aktual_menit, headway_ideal_menit, skor_headway,
    okupansi_persen, skor_okupansi, skor_survei_gabungan,
    tanggal_survei, nama_surveyor, catatan
) values
    ('DUMMY-HLT-001', 'Halte Dummy Mustika Jaya',  ST_SetSRID(ST_MakePoint(107.0350, -6.2600), 4326), 'Mustika Jaya',  'Mustika Jaya',
     0.600, 22.0, 15, 0.500, 55.0, 0.550, 0.560, '2026-08-20', 'DATA SINTETIS (bukan surveyor asli)', 'Seed testing — bukan hasil survei lapangan'),
    ('DUMMY-HLT-002', 'Halte Dummy Bantar Gebang', ST_SetSRID(ST_MakePoint(107.0500, -6.3200), 4326), 'Bantar Gebang', 'Bantar Gebang',
     0.450, 30.0, 15, 0.350, 40.0, 0.400, 0.410, '2026-08-20', 'DATA SINTETIS (bukan surveyor asli)', 'Seed testing — bukan hasil survei lapangan'),
    ('DUMMY-HLT-003', 'Halte Dummy Rawa Lumbu',    ST_SetSRID(ST_MakePoint(107.0150, -6.2500), 4326), 'Rawa Lumbu',    'Rawa Lumbu',
     0.700, 18.0, 15, 0.650, 62.0, 0.620, 0.660, '2026-08-21', 'DATA SINTETIS (bukan surveyor asli)', 'Seed testing — bukan hasil survei lapangan'),
    ('DUMMY-HLT-004', 'Halte Dummy Bekasi Utara',  ST_SetSRID(ST_MakePoint(106.9950, -6.2000), 4326), 'Bekasi Utara',  'Bekasi Utara',
     0.800, 12.0, 15, 0.800, 70.0, 0.700, 0.760, '2026-08-21', 'DATA SINTETIS (bukan surveyor asli)', 'Seed testing — bukan hasil survei lapangan'),
    ('DUMMY-HLT-005', 'Halte Dummy Marga Mulya',   ST_SetSRID(ST_MakePoint(106.9850, -6.2100), 4326), 'Marga Mulya',   'Marga Mulya',
     0.900, 10.0, 15, 0.900, 78.0, 0.780, 0.850, '2026-08-22', 'DATA SINTETIS (bukan surveyor asli)', 'Seed testing — bukan hasil survei lapangan'),
    ('DUMMY-HLT-006', 'Halte Dummy Bekasi Timur (dekat titik uji RPC)', ST_SetSRID(ST_MakePoint(107.0090, -6.2200), 4326), 'Bekasi Timur', 'Bekasi Timur',
     0.650, 20.0, 15, 0.550, 58.0, 0.580, 0.590, '2026-08-22', 'DATA SINTETIS (bukan surveyor asli)', 'Seed testing — ~230m dari titik uji simulate_new_stop(-6.2185, 107.0074)')
on conflict (id_halte_survei) do nothing;

end $$;

-- ------------------------------------------------------------
-- Uji coba cepat setelah migration ini jalan:
--   select simulate_new_stop(-6.2185, 107.0074);
-- Diharapkan penduduk_terlayani_400m/800m > 0, transit_eksisting_terdekat
-- terisi (Halte Dummy Bekasi Timur), fasilitas_pendidikan_400m &
-- fasilitas_kesehatan_400m > 0 — bukan lagi 0/null seperti sebelum seed ini.
-- ------------------------------------------------------------

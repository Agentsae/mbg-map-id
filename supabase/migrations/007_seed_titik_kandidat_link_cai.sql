-- ============================================================
-- GeoTransit Insight — 007_seed_titik_kandidat_link_cai.sql
-- *** titik_kandidat DI SINI MASIH DATA SINTETIS/DUMMY ***
--
-- Konteks: skor_cai sudah punya 4 baris (id 1-4) hasil compute_cai() atas
-- etl/compute_scores.load_demo_data() — formulanya sudah diverifikasi benar
-- di sesi sebelumnya (24 Agu 2026), TAPI titik_kandidat_id semuanya NULL
-- karena upload_cai_scores() sengaja mengomentari baris FK itu (baris
-- "titik_kandidat_id": row["id"] TODO di upload_to_supabase.py) — saat itu
-- titik_kandidat masih 0 baris.
--
-- PENTING: 4 lokasi di load_demo_data() ("Simpang Mustika Jaya", dst.) itu
-- sendiri MASIH SINTETIS, bukan hasil Form Traffic Counting lapangan asli
-- (survei lapangan terakhir baru 29-30 Agu 2026, lihat CLAUDE.md jalur
-- kritis). Migration ini TIDAK mengklaim titik-titik ini sebagai lokasi
-- survei nyata — tujuannya murni menyambungkan FK yang hilang supaya
-- fitur "klik peta -> skor CAI" (CaiScorePanel.jsx) berhenti memakai
-- 5 titik dummy terpisah dan mulai membaca skor_cai yang sudah ada lewat
-- geometri titik_kandidat yang konsisten. Ganti geom & atribut di bawah
-- begitu data Form Traffic Counting asli masuk — jangan anggap koordinat
-- ini presisi terhadap lokasi riil.
--
-- Pemetaan skor_cai.id -> lokasi ditentukan dari fingerprint numerik
-- (skor_final + n_survei unik per baris, dicocokkan manual terhadap hasil
-- compute_cai(load_demo_data()) — lihat komentar di tiap INSERT/UPDATE):
--   id 1: skor_final=0.7445, n_survei=0.80 -> "Dekat Stasiun Bekasi Timur"
--   id 2: skor_final=0.4547, n_survei=0.55 -> "Simpang Mustika Jaya"
--   id 3: skor_final=0.41,   n_survei=0.40 -> "Perumahan Rawa Lumbu"
--   id 4: skor_final=0.3503, n_survei=0.65 -> "Kawasan Industri Marga Mulya"
-- ============================================================

do $$
begin
  if exists (select 1 from titik_kandidat where id_titik_survei = 'KND-DEMO-001') then
    raise notice '007_seed_titik_kandidat_link_cai: sudah pernah di-seed, dilewati (idempotent).';
    return;
  end if;

  -- ------------------------------------------------------------
  -- 1. titik_kandidat — 4 titik, satu per lokasi di load_demo_data().
  --    total_aktivitas <- volume_penumpang demo (proksi kasar, bukan hasil
  --    traffic counting asli). jarak_transit_terdekat_m <- jarak_fasilitas_m
  --    demo (proksi kasar juga; semantik aslinya "jarak ke fasilitas umum",
  --    dipakai di sini sebagai "jarak ke transit terdekat" karena skema
  --    titik_kandidat tidak punya kolom jarak-fasilitas-umum terpisah).
  --    Koordinat ditaruh di dalam bbox kelurahan terkait dari
  --    006_seed_dummy_data.sql supaya konsisten dengan data dummy lain.
  -- ------------------------------------------------------------
  insert into titik_kandidat (
      id_titik_survei, deskripsi_lokasi, geom, kecamatan, kelurahan,
      total_aktivitas, kondisi_trotoar, kondisi_penyeberangan,
      jarak_transit_terdekat_m, tanggal_survei, nama_surveyor, catatan
  ) values
      ('KND-DEMO-001', 'Simpang Mustika Jaya',
       ST_SetSRID(ST_MakePoint(107.0350, -6.2620), 4326), 'Mustika Jaya', 'Mustika Jaya',
       120, 'Sedang', 'Tidak Ada', 850, null, 'DATA SINTETIS (bukan surveyor asli)',
       'Seed testing — menyambungkan FK ke skor_cai id 2 (skor_final 0.4547), bukan hasil Form Traffic Counting lapangan'),

      ('KND-DEMO-002', 'Dekat Stasiun Bekasi Timur',
       ST_SetSRID(ST_MakePoint(107.0085, -6.2190), 4326), 'Bekasi Timur', 'Bekasi Timur',
       4200, 'Baik', 'Ada', 300, null, 'DATA SINTETIS (bukan surveyor asli)',
       'Seed testing — menyambungkan FK ke skor_cai id 1 (skor_final 0.7445), bukan hasil Form Traffic Counting lapangan'),

      ('KND-DEMO-003', 'Perumahan Rawa Lumbu',
       ST_SetSRID(ST_MakePoint(107.0180, -6.2480), 4326), 'Rawa Lumbu', 'Rawa Lumbu',
       80, 'Buruk', 'Tidak Ada', 1200, null, 'DATA SINTETIS (bukan surveyor asli)',
       'Seed testing — menyambungkan FK ke skor_cai id 3 (skor_final 0.41), bukan hasil Form Traffic Counting lapangan'),

      ('KND-DEMO-004', 'Kawasan Industri Marga Mulya',
       ST_SetSRID(ST_MakePoint(106.9820, -6.2130), 4326), 'Marga Mulya', 'Marga Mulya',
       1500, 'Sedang', 'Ada', 600, null, 'DATA SINTETIS (bukan surveyor asli)',
       'Seed testing — menyambungkan FK ke skor_cai id 4 (skor_final 0.3503), bukan hasil Form Traffic Counting lapangan')
  on conflict (id_titik_survei) do nothing;

  -- ------------------------------------------------------------
  -- 2. Sambungkan FK skor_cai.titik_kandidat_id -> titik_kandidat.id,
  --    dicocokkan lewat fingerprint numerik (skor_final + n_survei) yang
  --    sudah diverifikasi unik untuk masing-masing dari 4 baris di atas.
  --    Guard "titik_kandidat_id is null" supaya idempotent & tidak
  --    menimpa baris yang sudah pernah tersambung (mis. dari CAI batch
  --    berikutnya yang kebetulan punya angka mirip).
  -- ------------------------------------------------------------
  update skor_cai set titik_kandidat_id = (select id from titik_kandidat where id_titik_survei = 'KND-DEMO-002')
    where titik_kandidat_id is null and skor_final = 0.7445 and n_survei = 0.80;

  update skor_cai set titik_kandidat_id = (select id from titik_kandidat where id_titik_survei = 'KND-DEMO-001')
    where titik_kandidat_id is null and skor_final = 0.4547 and n_survei = 0.55;

  update skor_cai set titik_kandidat_id = (select id from titik_kandidat where id_titik_survei = 'KND-DEMO-003')
    where titik_kandidat_id is null and skor_final = 0.41 and n_survei = 0.40;

  update skor_cai set titik_kandidat_id = (select id from titik_kandidat where id_titik_survei = 'KND-DEMO-004')
    where titik_kandidat_id is null and skor_final = 0.3503 and n_survei = 0.65;

end $$;

-- ------------------------------------------------------------
-- Verifikasi setelah migration ini jalan:
--   select sc.id, sc.titik_kandidat_id, tk.deskripsi_lokasi, sc.skor_final
--   from skor_cai sc left join titik_kandidat tk on tk.id = sc.titik_kandidat_id
--   order by sc.id;
-- Diharapkan: keempat baris skor_cai punya titik_kandidat_id terisi
-- (bukan lagi NULL), masing-masing mengarah ke deskripsi_lokasi yang
-- cocok dengan komentar fingerprint di atas.
-- ------------------------------------------------------------

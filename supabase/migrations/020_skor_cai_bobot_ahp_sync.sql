-- ============================================================
-- GeoTransit Insight — 020_skor_cai_bobot_ahp_sync.sql
--
-- KENAPA MIGRATION INI ADA:
-- Setelah bobot AHP pairwise final (018_konfigurasi_bobot_ahp_final.sql,
-- 2026-09-03) pipeline ETL menghitung ULANG skor_cai.skor_final untuk ke-19
-- baris titik_kandidat REAL memakai bobot baru (CAI: kepadatan 0,3290 /
-- jarak_inv 0,3290 / volume 0,2002 / survei 0,1418). Dicek 2026-09-03 lewat
-- recompute manual 3 baris:
--   id 6  : 0,3290*1,0000 + 0,3290*0,9975 + 0,2002*1,0000 + 0,1418*0 = 0,8574  (tersimpan 0,8574)
--   id 20 : 0,3290*0,6170 + 0,3290*0,2506 + 0,2002*0,1571 + 0,1418*0 = 0,3169  (tersimpan 0,3169)
--   id 13 : 0,3290*0,8198 + 0,3290*0,6266 + 0,2002*0,2286 + 0,1418*0 = 0,5216  (tersimpan 0,5216)
-- -> skor_final SUDAH memakai bobot AHP.
--
-- TAPI kolom bobot_kepadatan / bobot_jarak / bobot_volume / bobot_survei di
-- tabel skor_cai TIDAK ikut ter-update — helper upload_cai_scores() /
-- update_cai_scores_by_titik_kandidat_id() di etl/upload_to_supabase.py
-- HANYA menulis n_* + skor_final, tidak pernah menyentuh kolom bobot_*.
-- Akibatnya keempat kolom itu masih menyimpan DEFAULT lama dari
-- 001_init_tables.sql (0,350 / 0,250 / 0,250 / 0,150).
--
-- DAMPAK (bukan kosmetik): frontend membaca kolom bobot_* ini apa adanya
--   App.jsx  -> select 'skor_cai(... bobot_kepadatan, bobot_jarak, bobot_volume, bobot_survei ...)'
--   CaiScorePanel.jsx -> menampilkan tiap bobot di sebelah kontribusi kriteria
-- sehingga rincian "klik lokasi -> kontribusi tiap kriteria" (acceptance
-- criteria PRD Bab 8) TIDAK rekonsiliasi: panel memperlihatkan bobot 0,35
-- padahal skor_final dihitung dengan 0,329. Melanggar prinsip
-- ketertelusuran di CLAUDE.md. Migration ini menyinkronkan kolom bobot_*
-- ke nilai AHP supaya breakdown = skor_final lagi.
--
-- ------------------------------------------------------------
-- 1. LEBAR KOLOM. bobot_kepadatan..bobot_survei semula numeric(4,3) —
--    membulatkan 0,2002 -> 0,200 dan 0,1418 -> 0,142. Dilebarkan ke
--    numeric(6,4) (idempoten: hanya di-ALTER kalau skala < 4), sama seperti
--    yang 018 lakukan untuk konfigurasi_bobot.bobot.
--
-- 2. UPDATE nilai bobot_* untuk baris skor_cai yang FK-nya menunjuk
--    titik_kandidat REAL (id_titik_survei TIDAK berpola 'KND-DEMO-%').
--    Baris demo (kalau suatu saat di-seed ulang lewat
--    007_seed_titik_kandidat_link_cai.sql) SENGAJA tidak disentuh — skor_final
--    baris demo dihitung dari load_demo_data() dengan bobot pra-AHP, jadi
--    bobot_* mereka harus tetap konsisten dengan skor_final-nya sendiri.
--    Per 2026-09-03 tabel skor_cai berisi 19 baris, semuanya REAL (0 baris demo).
--
-- 3. GUARD HASIL (dieksekusi): untuk SETIAP baris yang di-update, cek
--    |skor_final - (bobot_kepadatan*n_kepadatan + bobot_jarak*n_jarak_inv
--     + bobot_volume*n_volume + bobot_survei*n_survei)| <= 0,0015
--    (toleransi = akumulasi pembulatan n_* & skor_final yang masing-masing
--    numeric(5,4)). Kalau ADA baris yang tidak rekonsiliasi, migration
--    GAGAL dengan menyebut id baris — menandakan skor_final baris itu BUKAN
--    hasil bobot AHP (mis. ETL recompute belum jalan untuk baris tsb) dan
--    harus diselidiki, bukan ditimpa diam-diam.
--
-- IDEMPOTEN / AMAN DI-RERUN: ALTER dikondisikan skala; UPDATE mengunci ke
-- nilai konstan (bukan increment); guard hanya membaca. Rerun tidak
-- mengubah apa pun lebih lanjut.
--
-- URUTAN FILE: migration ke-020, setelah 019_equity_kelompok_rekomendasi_refill_ahp.sql.
-- Perubahan vs sebelumnya: lebar 4 kolom skor_cai + nilai bobot_* pada baris
-- REAL + dihitung_pada baris tsb. TIDAK menyentuh n_*, skor_final, ranking,
-- tabel lain, atau RLS. Tidak ada DDL tabel/RPC baru.
-- ============================================================

-- 1. Lebarkan kolom bobot_* (idempoten: hanya kalau skala < 4).
do $$
declare
  kol text;
begin
  foreach kol in array array['bobot_kepadatan','bobot_jarak','bobot_volume','bobot_survei']
  loop
    if coalesce((
      select numeric_scale from information_schema.columns
      where table_name = 'skor_cai' and column_name = kol
    ), 0) < 4 then
      execute format('alter table skor_cai alter column %I type numeric(6,4)', kol);
    end if;
  end loop;
end $$;

-- 2. Sinkronkan bobot_* ke nilai AHP (CAI) untuk baris skor_cai REAL.
update skor_cai sc
set bobot_kepadatan = 0.3290,
    bobot_jarak     = 0.3290,
    bobot_volume    = 0.2002,
    bobot_survei    = 0.1418,
    dihitung_pada   = timestamptz '2026-09-03 12:00:00+07'
from titik_kandidat tk
where sc.titik_kandidat_id = tk.id
  and tk.id_titik_survei not like 'KND-DEMO-%';

-- 3. GUARD HASIL (dieksekusi).
do $$
declare
  bad text;
begin
  select string_agg(sc.id::text || ' (Δ=' || round(
           abs(sc.skor_final
               - (sc.bobot_kepadatan * sc.n_kepadatan
                  + sc.bobot_jarak    * sc.n_jarak_inv
                  + sc.bobot_volume   * sc.n_volume
                  + sc.bobot_survei   * sc.n_survei))::numeric, 5) || ')', ', ')
    into bad
  from skor_cai sc
  join titik_kandidat tk on tk.id = sc.titik_kandidat_id
  where tk.id_titik_survei not like 'KND-DEMO-%'
    and abs(sc.skor_final
            - (sc.bobot_kepadatan * sc.n_kepadatan
               + sc.bobot_jarak    * sc.n_jarak_inv
               + sc.bobot_volume   * sc.n_volume
               + sc.bobot_survei   * sc.n_survei)) > 0.0015;

  if bad is not null then
    raise exception
      '020 GAGAL: skor_cai id berikut tidak rekonsiliasi dengan bobot AHP (skor_final bukan hasil bobot ini?): %',
      bad;
  end if;
end $$;

-- Verifikasi cepat (opsional, jalankan manual sesudah push):
--   select sc.id, tk.id_titik_survei, sc.bobot_kepadatan, sc.bobot_jarak,
--          sc.bobot_volume, sc.bobot_survei, sc.skor_final
--   from skor_cai sc join titik_kandidat tk on tk.id = sc.titik_kandidat_id
--   order by sc.id;
--   -- Diharapkan: semua baris bobot 0,3290 / 0,3290 / 0,2002 / 0,1418.

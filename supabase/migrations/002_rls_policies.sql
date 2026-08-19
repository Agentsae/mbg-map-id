-- ============================================================
-- GeoTransit Insight — 002_rls_policies.sql
-- Row Level Security: publik boleh BACA layer, tidak boleh TULIS
-- (tulis hanya lewat service_role key dari script Python/Edge Function)
-- ============================================================

alter table batas_administrasi enable row level security;
alter table penduduk enable row level security;
alter table poi enable row level security;
alter table halte_eksisting enable row level security;
alter table titik_kandidat enable row level security;
alter table grid_analisis enable row level security;
alter table skor_cai enable row level security;
alter table skor_equity enable row level security;
alter table konfigurasi_bobot enable row level security;

-- Baca publik (dipakai frontend lewat anon key) untuk semua tabel data/skor.
-- Ulangi pola ini untuk tiap tabel — sengaja eksplisit satu-satu, bukan wildcard,
-- supaya jelas tabel mana yang sudah "dijaga" saat direview.
create policy "Publik boleh baca batas_administrasi" on batas_administrasi for select using (true);
create policy "Publik boleh baca penduduk" on penduduk for select using (true);
create policy "Publik boleh baca poi" on poi for select using (true);
create policy "Publik boleh baca halte_eksisting" on halte_eksisting for select using (true);
create policy "Publik boleh baca titik_kandidat" on titik_kandidat for select using (true);
create policy "Publik boleh baca grid_analisis" on grid_analisis for select using (true);
create policy "Publik boleh baca skor_cai" on skor_cai for select using (true);
create policy "Publik boleh baca skor_equity" on skor_equity for select using (true);
create policy "Publik boleh baca konfigurasi_bobot" on konfigurasi_bobot for select using (true);

-- TIDAK ada policy INSERT/UPDATE/DELETE untuk role 'anon' atau 'authenticated' —
-- artinya penulisan data HANYA bisa lewat service_role key (dipakai di
-- etl/upload_to_supabase.py dan Edge Function), yang otomatis melewati RLS.
-- Ini sesuai prinsip: skor dihitung offline lalu diunggah oleh tim, bukan
-- ditulis sembarangan dari browser publik.

-- Uji cepat setelah migration ini jalan (dari SQL Editor, ganti dulu role):
--   set role anon;
--   select * from halte_eksisting limit 1;   -- harus BERHASIL (boleh baca)
--   insert into halte_eksisting (nama, geom) values ('test', st_point(0,0));  -- harus GAGAL
--   reset role;

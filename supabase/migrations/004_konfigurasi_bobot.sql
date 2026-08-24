-- ============================================================
-- 004_konfigurasi_bobot.sql
-- Tabel terpusat untuk bobot AHP — supaya bobot CAI/Equity Index
-- gampang diupdate setelah sesi mentoring, tanpa ubah kode.
-- ============================================================

create table if not exists konfigurasi_bobot (
    id                bigint generated always as identity primary key,
    nama_index        text not null,       -- 'CAI' atau 'Transit Equity Index'
    nama_kriteria     text not null,       -- 'kepadatan', 'jarak_inv', 'volume', 'survei', dst
    bobot             numeric(4,3) not null,
    consistency_ratio numeric(4,3),        -- hasil validasi AHP, target < 0.1
    ditentukan_pada   timestamptz default now(),
    catatan           text
);



comment on table konfigurasi_bobot is
    'Isi tabel ini setelah sesi AHP dengan mentor. Script perhitungan skor
     (compute_scores.py atau setara) sebaiknya membaca bobot dari sini,
     bukan hardcode di kode.';

-- Contoh isi awal (bobot sementara, GANTI setelah sesi AHP):
insert into konfigurasi_bobot (nama_index, nama_kriteria, bobot, catatan) values
    ('CAI', 'kepadatan', 0.35, 'Bobot awal sebelum AHP — perlu divalidasi mentor'),
    ('CAI', 'jarak_inv', 0.25, 'Bobot awal sebelum AHP — perlu divalidasi mentor'),
    ('CAI', 'volume',    0.25, 'Bobot awal sebelum AHP — perlu divalidasi mentor'),
    ('CAI', 'survei',    0.15, 'Bobot awal sebelum AHP — perlu divalidasi mentor');

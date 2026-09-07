-- ============================================================
-- GeoTransit Insight — 001_init_tables.sql
-- Tim MBG — MAPID WebGIS Competition 2026
-- Jalankan lewat: supabase db push
-- atau paste langsung ke Supabase SQL Editor
-- ============================================================

-- PostGIS wajib aktif dulu (Supabase Pro sudah menyediakan extension ini,
-- tinggal diaktifkan sekali per project)
create extension if not exists postgis;

-- ------------------------------------------------------------
-- 1. Batas administratif (kecamatan/kelurahan Kota Bekasi)
-- ------------------------------------------------------------
create table if not exists batas_administrasi (
    id              bigint generated always as identity primary key,
    nama_kecamatan  text not null,
    nama_kelurahan  text not null,
    geom            geometry(Polygon, 4326) not null,
    created_at      timestamptz default now()
);
create index if not exists idx_batas_administrasi_geom on batas_administrasi using gist (geom);

-- ------------------------------------------------------------
-- 2. Data kependudukan per kelurahan
-- ------------------------------------------------------------
create table if not exists penduduk (
    id                  bigint generated always as identity primary key,
    kelurahan_id        bigint references batas_administrasi(id) on delete cascade,
    jumlah_penduduk     integer not null default 0,
    proporsi_lansia     numeric(5,4),   -- 0.0000 - 1.0000
    proporsi_balita     numeric(5,4),
    -- geom opsional: dipakai jika data sudah didisagregasi ke titik/grid (dasymetric mapping)
    geom                geometry(Point, 4326),
    sumber              text,           -- mis. 'BPS Kota Bekasi Dalam Angka 2025'
    created_at          timestamptz default now()
);
create index if not exists idx_penduduk_geom on penduduk using gist (geom);
create index if not exists idx_penduduk_kelurahan on penduduk (kelurahan_id);

-- ------------------------------------------------------------
-- 3. Points of Interest (sekolah, faskes, pusat kerja)
-- ------------------------------------------------------------
create table if not exists poi (
    id          bigint generated always as identity primary key,
    jenis       text not null check (jenis in ('sekolah', 'faskes', 'kerja', 'lainnya')),
    nama        text not null,
    geom        geometry(Point, 4326) not null,
    sumber      text,   -- 'Dapodik Kemendikbud' / 'Kemenkes' / 'RTRW Kota Bekasi' / 'OpenStreetMap'
    created_at  timestamptz default now()
);
create index if not exists idx_poi_geom on poi using gist (geom);
create index if not exists idx_poi_jenis on poi (jenis);

-- ------------------------------------------------------------
-- 4. Halte / titik transit eksisting (hasil Form Kondisi Halte)
-- ------------------------------------------------------------
create table if not exists halte_eksisting (
    id                      bigint generated always as identity primary key,
    id_halte_survei         text unique,   -- mis. 'HLT-001', cocokkan dengan instrumen survei
    nama                    text not null,
    geom                    geometry(Point, 4326) not null,
    kecamatan               text,
    kelurahan               text,
    skor_kelengkapan_fisik  numeric(4,3),
    headway_aktual_menit    numeric(6,2),
    headway_ideal_menit     numeric(6,2) default 15,
    skor_headway            numeric(4,3),
    okupansi_persen         numeric(5,2),
    skor_okupansi           numeric(4,3),
    skor_survei_gabungan    numeric(4,3),
    tanggal_survei          date,
    nama_surveyor           text,
    foto_url                text,
    catatan                 text,
    created_at              timestamptz default now()
);
create index if not exists idx_halte_eksisting_geom on halte_eksisting using gist (geom);

-- ------------------------------------------------------------
-- 5. Titik kandidat baru (hasil Form Traffic Counting)
-- ------------------------------------------------------------
create table if not exists titik_kandidat (
    id                  bigint generated always as identity primary key,
    id_titik_survei     text unique,   -- mis. 'KND-001'
    deskripsi_lokasi    text,
    geom                geometry(Point, 4326) not null,
    kecamatan           text,
    kelurahan           text,
    total_aktivitas     integer,
    kondisi_trotoar     text check (kondisi_trotoar in ('Baik','Sedang','Buruk','Tidak Ada')),
    kondisi_penyeberangan text check (kondisi_penyeberangan in ('Ada','Tidak Ada')),
    jarak_transit_terdekat_m numeric(8,2),
    tanggal_survei      date,
    nama_surveyor       text,
    catatan             text,
    created_at          timestamptz default now()
);
create index if not exists idx_titik_kandidat_geom on titik_kandidat using gist (geom);

-- ------------------------------------------------------------
-- 6. Grid analisis (fishnet 250-500m) untuk Transit Desert Index
-- ------------------------------------------------------------
create table if not exists grid_analisis (
    id              bigint generated always as identity primary key,
    geom            geometry(Polygon, 4326) not null,
    kepadatan_penduduk numeric,
    indeks_kebutuhan_mobilitas numeric,
    skor_aksesibilitas_transit numeric,
    skor_tdi        numeric,
    created_at      timestamptz default now()
);
create index if not exists idx_grid_analisis_geom on grid_analisis using gist (geom);

-- ------------------------------------------------------------
-- 7. Skor Composite Accessibility Index (per titik/grid kandidat)
-- ------------------------------------------------------------
create table if not exists skor_cai (
    id              bigint generated always as identity primary key,
    titik_kandidat_id bigint references titik_kandidat(id) on delete cascade,
    n_kepadatan     numeric(5,4),
    n_jarak_inv     numeric(5,4),
    n_volume        numeric(5,4),
    n_survei        numeric(5,4),
    bobot_kepadatan numeric(4,3) default 0.35,
    bobot_jarak     numeric(4,3) default 0.25,
    bobot_volume    numeric(4,3) default 0.25,
    bobot_survei    numeric(4,3) default 0.15,
    skor_final      numeric(5,4),
    dihitung_pada   timestamptz default now()
);

-- ------------------------------------------------------------
-- 8. Skor Transit Equity Index (per kelurahan)
-- ------------------------------------------------------------
create table if not exists skor_equity (
    id              bigint generated always as identity primary key,
    kelurahan_id    bigint references batas_administrasi(id) on delete cascade,
    skor_cai_rata2  numeric(5,4),
    n_kepadatan     numeric(5,4),
    n_usia_rentan   numeric(5,4),
    n_akses_pendidikan numeric(5,4),
    n_akses_kesehatan  numeric(5,4),
    n_akses_kerja      numeric(5,4),
    skor_final      numeric(5,4),
    ranking         integer,
    dihitung_pada   timestamptz default now()
);

-- ------------------------------------------------------------
-- 9. Konfigurasi bobot AHP terpusat (supaya gampang diupdate)
-- ------------------------------------------------------------
create table if not exists konfigurasi_bobot (
    id              bigint generated always as identity primary key,
    nama_index      text not null,          -- 'CAI' atau 'Transit Equity Index'
    nama_kriteria   text not null,
    bobot           numeric(4,3) not null,
    consistency_ratio numeric(4,3),
    ditentukan_pada timestamptz default now(),
    catatan         text
);

comment on table konfigurasi_bobot is 'Isi tabel ini setelah sesi AHP dengan mentor. compute_scores.py membaca bobot dari sini, bukan hardcode.';

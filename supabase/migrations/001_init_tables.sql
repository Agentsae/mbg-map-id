create extension if not exists postgis;

create table if not exists batas_administrasi (
  id serial primary key,
  nama_kecamatan text,
  nama_kelurahan text,
  geom geometry(multipolygon, 4326)
);

create table if not exists penduduk (
  id serial primary key,
  kelurahan_id integer references batas_administrasi(id),
  jumlah_penduduk integer,
  proporsi_lansia numeric,
  proporsi_balita numeric,
  geom geometry(point, 4326)
);

create table if not exists poi (
  id serial primary key,
  jenis text,
  nama text,
  geom geometry(point, 4326)
);

create table if not exists halte_eksisting (
  id serial primary key,
  nama text,
  geom geometry(point, 4326),
  skor_survei numeric,
  headway_aktual integer,
  okupansi numeric
);

create table if not exists titik_kandidat (
  id serial primary key,
  deskripsi text,
  geom geometry(point, 4326),
  total_aktivitas integer
);

create table if not exists grid_analisis (
  id serial primary key,
  geom geometry(polygon, 4326),
  skor_tdi numeric
);

create table if not exists skor_cai (
  id serial primary key,
  grid_id integer,
  poin_id integer,
  n_kepadatan numeric,
  n_jarak numeric,
  n_volume numeric,
  n_survei numeric,
  skor_final numeric
);

create table if not exists skor_equity (
  id serial primary key,
  kelurahan_id integer references batas_administrasi(id),
  skor_final numeric,
  ranking integer
);

create index if not exists idx_batas_administrasi_geom on batas_administrasi using gist (geom);
create index if not exists idx_penduduk_geom on penduduk using gist (geom);
create index if not exists idx_poi_geom on poi using gist (geom);
create index if not exists idx_halte_eksisting_geom on halte_eksisting using gist (geom);
create index if not exists idx_titik_kandidat_geom on titik_kandidat using gist (geom);
create index if not exists idx_grid_analisis_geom on grid_analisis using gist (geom);

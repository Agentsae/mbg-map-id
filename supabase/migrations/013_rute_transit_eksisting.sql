-- ============================================================
-- GeoTransit Insight — 013_rute_transit_eksisting.sql
-- Tabel baru: layer "transit eksisting" untuk Peta Multi-Layer Gap
-- Analysis (PRD Bab 8) — dua hal berbeda, jangan dicampur jadi satu
-- narasi di frontend:
--   1) jenis='biskita_survei' — APROKSIMASI jalur koridor BisKita, dibuat
--      menghubungkan 15 halte_eksisting REAL tersurvei sesuai urutan
--      id_halte_survei (HLT-001..HLT-015). BUKAN rute resmi GTFS/KMZ
--      operator (tidak dimiliki tim) — lihat kolom `catatan` tiap baris.
--   2) jenis='krl' — jaringan KRL Commuter Line REAL (BIG RBI 25K,
--      existing infrastructure), MENCAKUP baik ruas rel (LineString)
--      MAUPUN titik stasiun (Point) — dibedakan lewat kolom
--      `tipe_geometri`. BELUM pernah disurvei tim (beda dengan halte
--      BisKita yang disurvei lapangan).
--
-- KENAPA TABEL BARU (bukan file GeoJSON statis di frontend/public):
-- konsisten dengan pola arsitektur proyek ini — SEMUA layer spasial lain
-- (batas_administrasi, poi, halte_eksisting, titik_kandidat, grid_analisis)
-- disajikan lewat Supabase/PostGIS + RLS publik-baca-saja, bukan file
-- statis. Menyimpan di Supabase juga membuat metadata kejujuran sumber
-- (`sumber`, `catatan`) satu tempat dengan datanya sendiri (bukan
-- terpisah di komentar kode frontend yang gampang basi), dan
-- memungkinkan revisi/perbaikan lewat ETL yang sama tanpa redeploy
-- frontend.
--
-- KENAPA KOLOM geom UNTYPED (geometry(Geometry,4326), bukan LineString
-- atau Point tunggal): tabel ini sengaja menampung KEDUA jenis geometri
-- (rute BisKita = LineString, jaringan KRL = LineString rel + Point
-- stasiun) dalam satu layer "transit eksisting" supaya query/filter per
-- `jenis` tetap satu tabel. `tipe_geometri` disediakan sebagai kolom
-- bantuan eksplisit (bukan mengandalkan GeometryType(geom) di setiap
-- query frontend) supaya webgis-developer bisa langsung filter/style
-- tanpa perlu tahu detail PostGIS.
-- ============================================================

create table if not exists rute_transit_eksisting (
    id              bigint generated always as identity primary key,
    nama            text not null,
    jenis           text not null check (jenis in ('biskita_survei', 'krl')),
    tipe_geometri   text not null check (tipe_geometri in ('line', 'point')),
    geom            geometry(Geometry, 4326) not null,
    sumber          text not null,
    catatan         text,
    created_at      timestamptz default now()
);

create index if not exists idx_rute_transit_eksisting_geom
    on rute_transit_eksisting using gist (geom);
create index if not exists idx_rute_transit_eksisting_jenis
    on rute_transit_eksisting (jenis);

comment on table rute_transit_eksisting is
    'Layer transit eksisting untuk Peta Multi-Layer Gap Analysis. jenis=biskita_survei '
    'adalah APROKSIMASI (garis penghubung urutan halte tersurvei, BUKAN rute resmi '
    'operator). jenis=krl adalah data REAL BIG RBI 25K (ruas rel + titik stasiun), '
    'infrastruktur eksisting yang BELUM disurvei tim (beda dengan halte BisKita).';
comment on column rute_transit_eksisting.tipe_geometri is
    'Bantuan eksplisit untuk frontend: ''line'' (LineString, rute/ruas rel) atau '
    '''point'' (Point, mis. lokasi stasiun) -- hindari GeometryType(geom) berulang di query.';
comment on column rute_transit_eksisting.catatan is
    'WAJIB diisi untuk jenis=biskita_survei menjelaskan bahwa garis ini APROKSIMASI dari '
    'urutan titik survei, bukan GeoJSON/KMZ resmi operator/Dishub.';

alter table rute_transit_eksisting enable row level security;
create policy "Publik boleh baca rute_transit_eksisting" on rute_transit_eksisting for select using (true);
-- Tidak ada policy INSERT/UPDATE/DELETE untuk anon/authenticated — sama seperti tabel
-- lain (002_rls_policies.sql), penulisan hanya lewat service_role key di ETL.

-- Uji cepat setelah migration + upload ETL jalan:
--   select jenis, tipe_geometri, count(*), sum(ST_Length(geom::geography)) as total_panjang_m
--   from rute_transit_eksisting group by jenis, tipe_geometri;

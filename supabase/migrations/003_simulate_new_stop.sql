-- ============================================================
-- GeoTransit Insight — 003_simulate_new_stop.sql
-- RPC function untuk fitur Simulasi What-If.
-- Dipanggil dari frontend: supabase.rpc('simulate_new_stop', {lat, lon})
-- ============================================================

create or replace function simulate_new_stop(lat float, lon float)
returns json
language plpgsql
security definer   -- jalan dengan hak akses fungsi, bisa baca tabel meski RLS aktif
as $$
declare
    titik geography := ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography;
    penduduk_400m int;
    penduduk_800m int;
    jarak_transit_terdekat float;
    nama_transit_terdekat text;
    faskes_400m int;
    sekolah_400m int;
    delta_waktu_tempuh_menit numeric;
    asumsi_kecepatan_jalan_kaki_m_per_menit constant numeric := 80; -- ~4.8 km/jam
begin
    -- Penduduk terlayani dalam radius 400m dan 800m (standar ITDP walking catchment)
    select coalesce(sum(jumlah_penduduk), 0) into penduduk_400m
    from penduduk
    where geom is not null and ST_DWithin(geom::geography, titik, 400);

    select coalesce(sum(jumlah_penduduk), 0) into penduduk_800m
    from penduduk
    where geom is not null and ST_DWithin(geom::geography, titik, 800);

    -- Jarak & nama titik transit eksisting terdekat
    select ST_Distance(geom::geography, titik), nama
    into jarak_transit_terdekat, nama_transit_terdekat
    from halte_eksisting
    order by geom::geography <-> titik
    limit 1;

    -- Estimasi perubahan waktu tempuh: selisih antara kondisi sekarang (jarak ke
    -- transit eksisting terdekat) vs kondisi baru (0, karena titik baru ini
    -- ADALAH transit-nya) -- versi sederhana, sesuaikan jika ada model lebih baik
    delta_waktu_tempuh_menit := round(
        (coalesce(jarak_transit_terdekat, 0) / asumsi_kecepatan_jalan_kaki_m_per_menit)::numeric, 1
    );

    -- Fasilitas pendidikan & kesehatan dalam radius 400m
    select count(*) into faskes_400m
    from poi where jenis = 'faskes' and ST_DWithin(geom::geography, titik, 400);

    select count(*) into sekolah_400m
    from poi where jenis = 'sekolah' and ST_DWithin(geom::geography, titik, 400);

    return json_build_object(
        'lokasi', json_build_object('lat', lat, 'lon', lon),
        'penduduk_terlayani_400m', penduduk_400m,
        'penduduk_terlayani_800m', penduduk_800m,
        'transit_eksisting_terdekat', json_build_object(
            'nama', nama_transit_terdekat,
            'jarak_m', round(jarak_transit_terdekat::numeric, 0)
        ),
        'estimasi_pengurangan_waktu_tempuh_menit', delta_waktu_tempuh_menit,
        'fasilitas_pendidikan_400m', sekolah_400m,
        'fasilitas_kesehatan_400m', faskes_400m
    );
end;
$$;

comment on function simulate_new_stop is
    'Simulasi dampak penambahan titik transit baru. Versi awal — estimasi delta waktu
     tempuh masih sederhana (linear dari jarak). Sempurnakan dengan model isochrone
     jaringan jalan jika waktu memungkinkan.';

-- Uji coba (ganti koordinat dengan titik di Kota Bekasi):
--   select simulate_new_stop(-6.2185, 107.0074);

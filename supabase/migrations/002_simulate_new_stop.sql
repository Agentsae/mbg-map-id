create or replace function simulate_new_stop(lat float, lon float)
returns json
language plpgsql
as $$
declare
  titik geography := ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography;
  penduduk_400m int;
  penduduk_800m int;
  jarak_transit_terdekat float;
begin
  select coalesce(sum(jumlah_penduduk), 0) into penduduk_400m
  from penduduk
  where ST_DWithin(geom::geography, titik, 400);

  select coalesce(sum(jumlah_penduduk), 0) into penduduk_800m
  from penduduk
  where ST_DWithin(geom::geography, titik, 800);

  select min(ST_Distance(geom::geography, titik)) into jarak_transit_terdekat
  from halte_eksisting;

  return json_build_object(
    'penduduk_terlayani_400m', penduduk_400m,
    'penduduk_terlayani_800m', penduduk_800m,
    'jarak_ke_transit_terdekat_m', round(jarak_transit_terdekat::numeric, 0)
  );
end;
$$;

"""
fetch_osm_building_footprints.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Tarik building footprint (building=*) se-Kota Bekasi dari OSM Overpass API
publik, simpan sebagai GeoJSON di etl/data/osm/building_footprint_bekasi.geojson.

TIDAK diupload ke Supabase manapun — file ini nanti dipakai sebagai parameter
`buildings` di etl/build_fishnet_grid.py (dasymetric mapping), menggantikan
load_demo_buildings() sintetis.

Kenapa di-tile (bukan satu query besar):
  Hitungan awal (`out count;`) untuk seluruh Kota Bekasi mengembalikan
  ~206.700 way + relation building — jauh di atas estimasi kasar
  "ribuan-puluhan ribu" dan terlalu besar untuk satu request `out geom;`
  ke endpoint publik overpass-api.de (percobaan pertama gagal timeout
  setelah >4 menit). Solusi: pecah bounding box Kota Bekasi jadi grid
  NxN sel kecil, query tiap sel terpisah (satu per satu, ada jeda antar
  request supaya tidak membebani server publik / melanggar fair-use
  Overpass), lalu gabungkan hasilnya jadi satu GeoJSON.

  Ini BUKAN dasymetric mapping grid 250-500m punya build_fishnet_grid.py —
  sekadar strategi teknis supaya query Overpass tidak timeout.

Cara pakai:
    python fetch_osm_building_footprints.py
"""

import json
import os
import time
import urllib.parse
import urllib.request

import osm2geojson

OUT_DIR = os.path.join(os.path.dirname(__file__), "data", "osm")
TILES_DIR = os.path.join(OUT_DIR, "_building_tiles_raw")
FINAL_GEOJSON = os.path.join(OUT_DIR, "building_footprint_bekasi.geojson")

# Bounding box Kota Bekasi (dari `relation(14509733); out bb;`, relation OSM
# resmi boundary=administrative admin_level=5 official_name='Kota Bekasi')
BBOX = {"minlat": -6.3986049, "minlon": 106.8977344, "maxlat": -6.1717663, "maxlon": 107.0424724}

GRID_N = 4  # 4x4 = 16 tile, supaya tiap request jauh lebih kecil dari 206k elemen sekaligus

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
HEADERS = {
    "User-Agent": "GeoTransitInsight-ETL/1.0 (MAPID WebGIS Competition 2026; contact: samuel.edison@student.president.ac.id)",
    "Content-Type": "application/x-www-form-urlencoded",
}


def query_tile(minlat, minlon, maxlat, maxlon, timeout_s=120):
    query = f"""
[out:json][timeout:90];
(
  way["building"]({minlat},{minlon},{maxlat},{maxlon});
  relation["building"]({minlat},{minlon},{maxlat},{maxlon});
);
out geom;
"""
    data = urllib.parse.urlencode({"data": query}).encode("utf-8")
    req = urllib.request.Request(OVERPASS_URL, data=data, method="POST", headers=HEADERS)
    with urllib.request.urlopen(req, timeout=timeout_s) as resp:
        return json.loads(resp.read())


def main():
    os.makedirs(TILES_DIR, exist_ok=True)

    lat_step = (BBOX["maxlat"] - BBOX["minlat"]) / GRID_N
    lon_step = (BBOX["maxlon"] - BBOX["minlon"]) / GRID_N

    tiles = []
    for i in range(GRID_N):
        for j in range(GRID_N):
            tiles.append({
                "minlat": BBOX["minlat"] + i * lat_step,
                "maxlat": BBOX["minlat"] + (i + 1) * lat_step,
                "minlon": BBOX["minlon"] + j * lon_step,
                "maxlon": BBOX["minlon"] + (j + 1) * lon_step,
                "idx": f"{i}_{j}",
            })

    print(f"[INFO] {len(tiles)} tile ({GRID_N}x{GRID_N}) akan di-query satu per satu, ada jeda antar request.")

    all_elements = []
    failed_tiles = []
    for t_i, tile in enumerate(tiles, start=1):
        tile_path = os.path.join(TILES_DIR, f"tile_{tile['idx']}.json")
        if os.path.exists(tile_path):
            print(f"[{t_i}/{len(tiles)}] tile {tile['idx']}: pakai cache.")
            with open(tile_path, encoding="utf-8") as f:
                result = json.load(f)
        else:
            print(f"[{t_i}/{len(tiles)}] tile {tile['idx']}: query Overpass...")
            try:
                result = query_tile(tile["minlat"], tile["minlon"], tile["maxlat"], tile["maxlon"])
                with open(tile_path, "w", encoding="utf-8") as f:
                    json.dump(result, f, ensure_ascii=False)
            except Exception as e:
                print(f"    [GAGAL] tile {tile['idx']}: {e}")
                failed_tiles.append(tile["idx"])
                time.sleep(5)
                continue
            time.sleep(3)  # jeda sopan antar request ke server publik

        n = len(result.get("elements", []))
        print(f"    -> {n} elemen")
        all_elements.extend(result.get("elements", []))

    print(f"\n[INFO] Total elemen terkumpul (sebelum dedup lintas-tile): {len(all_elements)}")
    print(f"[INFO] Tile gagal: {failed_tiles if failed_tiles else 'tidak ada'}")

    # Dedup: satu bangunan yang memotong batas tile bisa muncul di >1 tile
    # (bbox filter Overpass bersifat "intersects", bukan "fully within").
    seen = set()
    deduped = []
    for el in all_elements:
        key = (el["type"], el["id"])
        if key in seen:
            continue
        seen.add(key)
        deduped.append(el)

    print(f"[INFO] Total elemen unik setelah dedup id: {len(deduped)}")

    merged = {"version": 0.6, "elements": deduped}
    geojson = osm2geojson.json2geojson(merged)

    with open(FINAL_GEOJSON, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False)
    print(f"[SIMPAN] {len(geojson['features'])} building footprint -> {FINAL_GEOJSON}")


if __name__ == "__main__":
    main()

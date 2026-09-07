"""
fetch_upload_osm_poi.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Tarik POI (sekolah, faskes, pusat kerja/industri) Kota Bekasi dari OSM
Overpass API publik, simpan mentah sebagai GeoJSON di etl/data/osm/, lalu
upload ke tabel `poi` di Supabase dengan sumber='OpenStreetMap'.

Baris dummy (sumber='DATA SINTETIS - seed testing', 006_seed_dummy_data.sql)
TIDAK dihapus/disentuh — script ini hanya menambah baris baru di sampingnya.

Idempotency: tabel poi tidak punya unique constraint, jadi sebelum insert,
script mencocokkan (nama, lon dibulatkan 6 desimal, lat dibulatkan 6 desimal)
terhadap baris poi yang sudah ber-sumber 'OpenStreetMap' di database — kalau
sudah ada, dilewati. Ini membuat script aman dijalankan berulang kali tanpa
membuat duplikat, sekalipun tidak ada constraint di level database.

Mapping jenis (sesuai skema 001_init_tables.sql, check constraint):
  amenity=school                          -> 'sekolah'
  amenity=hospital / amenity=clinic /
    healthcare=* (apa pun nilainya)       -> 'faskes'
  landuse=industrial / office=* (apa pun) -> 'kerja'
Urutan prioritas di atas dipakai kalau satu elemen OSM kebetulan punya lebih
dari satu tag yang cocok (jarang, tapi mungkin).

Cara pakai:
    python fetch_upload_osm_poi.py            # fetch (atau pakai cache) + upload
    python fetch_upload_osm_poi.py --no-upload # fetch/convert saja, tidak upload
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

import osm2geojson
from dotenv import load_dotenv
from supabase import create_client

OUT_DIR = os.path.join(os.path.dirname(__file__), "data", "osm")
RAW_PATH = os.path.join(OUT_DIR, "poi_bekasi_raw_overpass.json")
GEOJSON_PATH = os.path.join(OUT_DIR, "poi_bekasi.geojson")

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
]

# area id Kota Bekasi (relation OSM 14509733, boundary=administrative,
# admin_level=5, official_name='Kota Bekasi') -> area id Overpass = 3600000000 + id
AREA_ID_KOTA_BEKASI = 3600000000 + 14509733

QUERY_POI = f"""
[out:json][timeout:180];
area({AREA_ID_KOTA_BEKASI})->.a;
(
  nwr["amenity"="school"](area.a);
  nwr["amenity"="hospital"](area.a);
  nwr["amenity"="clinic"](area.a);
  nwr["healthcare"](area.a);
  nwr["landuse"="industrial"](area.a);
  nwr["office"](area.a);
);
out center tags;
"""


def query_overpass(query: str, max_retries: int = 3) -> dict:
    last_err = None
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(1, max_retries + 1):
            try:
                print(f"[INFO] Query ke {endpoint} (percobaan {attempt}/{max_retries})...")
                data = urllib.parse.urlencode({"data": query}).encode("utf-8")
                req = urllib.request.Request(
                    endpoint, data=data, method="POST",
                    headers={
                        "User-Agent": "GeoTransitInsight-ETL/1.0 (MAPID WebGIS Competition 2026; contact: samuel.edison@student.president.ac.id)",
                        "Content-Type": "application/x-www-form-urlencoded",
                    },
                )
                with urllib.request.urlopen(req, timeout=220) as resp:
                    result = json.loads(resp.read())
                print(f"[OK] {len(result.get('elements', []))} elemen diterima.")
                return result
            except Exception as e:
                last_err = e
                print(f"[GAGAL] {endpoint} percobaan {attempt}: {e}")
                time.sleep(10)
    raise RuntimeError(f"Semua endpoint Overpass gagal. Error terakhir: {last_err}")


def fetch_and_cache() -> dict:
    """Fetch dari Overpass, ATAU pakai cache raw JSON kalau sudah ada
    (supaya retry tahap konversi/upload tidak perlu fetch ulang ke server
    publik yang kadang sibuk/timeout)."""
    if os.path.exists(RAW_PATH):
        print(f"[CACHE] Memakai file mentah yang sudah ada: {RAW_PATH}")
        with open(RAW_PATH, encoding="utf-8") as f:
            return json.load(f)

    result = query_overpass(QUERY_POI)
    os.makedirs(OUT_DIR, exist_ok=True)
    with open(RAW_PATH, "w", encoding="utf-8") as f:
        json.dump(result, f, ensure_ascii=False, indent=2)
    print(f"[SIMPAN] Overpass JSON mentah -> {RAW_PATH}")
    return result


def classify_jenis(tags: dict) -> str | None:
    if tags.get("amenity") == "school":
        return "sekolah"
    if tags.get("amenity") in ("hospital", "clinic") or "healthcare" in tags:
        return "faskes"
    if tags.get("landuse") == "industrial" or "office" in tags:
        return "kerja"
    return None


def build_records(geojson: dict) -> list:
    records = []
    skipped_no_match = 0
    for feat in geojson["features"]:
        props = feat.get("properties", {})
        tags = props.get("tags", {})
        jenis = classify_jenis(tags)
        if jenis is None:
            skipped_no_match += 1
            continue

        geom = feat["geometry"]
        if geom["type"] != "Point":
            # Tidak diharapkan karena query pakai "out center tags" (way/relation
            # jadi titik pusat), tapi jaga-jaga.
            skipped_no_match += 1
            continue
        lon, lat = geom["coordinates"][0], geom["coordinates"][1]

        osm_type = props.get("type", "node")
        osm_id = props.get("id")
        nama = tags.get("name")
        if not nama:
            # Fallback deterministik (stabil antar-run) supaya idempotency
            # dedup tetap konsisten untuk elemen OSM tanpa tag name.
            nama = f"{jenis.capitalize()} OSM tanpa nama ({osm_type}/{osm_id})"

        records.append({
            "jenis": jenis,
            "nama": nama,
            "lon": round(lon, 6),
            "lat": round(lat, 6),
            "sumber": "OpenStreetMap",
        })

    print(f"[INFO] {len(records)} POI terklasifikasi, {skipped_no_match} dilewati (tidak cocok kategori/geometri).")
    return records


def get_existing_osm_keys(client) -> set:
    """Ambil (nama, lon dibulatkan, lat dibulatkan) dari baris poi yang sudah
    ber-sumber 'OpenStreetMap' -> dipakai sebagai kunci dedup idempotent."""
    res = client.table("poi").select("nama, geom").eq("sumber", "OpenStreetMap").execute()
    keys = set()
    for row in res.data:
        geom = row.get("geom") or {}
        coords = geom.get("coordinates")
        if not coords:
            continue
        keys.add((row["nama"], round(coords[0], 6), round(coords[1], 6)))
    return keys


def upload_poi(client, records: list) -> int:
    existing_keys = get_existing_osm_keys(client)
    print(f"[INFO] {len(existing_keys)} baris poi sumber OpenStreetMap sudah ada di database (dipakai untuk cek duplikat).")

    to_insert = []
    for r in records:
        key = (r["nama"], r["lon"], r["lat"])
        if key in existing_keys:
            continue
        to_insert.append({
            "jenis": r["jenis"],
            "nama": r["nama"],
            "geom": f"SRID=4326;POINT({r['lon']} {r['lat']})",
            "sumber": r["sumber"],
        })
        existing_keys.add(key)  # cegah duplikat di dalam batch yang sama

    print(f"[INFO] {len(records) - len(to_insert)} baris dilewati (sudah ada / duplikat dalam batch).")

    if not to_insert:
        print("[INFO] Tidak ada baris baru untuk diupload.")
        return 0

    CHUNK = 200
    total_inserted = 0
    for i in range(0, len(to_insert), CHUNK):
        chunk = to_insert[i:i + CHUNK]
        client.table("poi").insert(chunk).execute()
        total_inserted += len(chunk)
        print(f"[UPLOAD] {total_inserted}/{len(to_insert)} baris terupload...")

    return total_inserted


def main():
    no_upload = "--no-upload" in sys.argv

    overpass_json = fetch_and_cache()
    geojson = osm2geojson.json2geojson(overpass_json)

    os.makedirs(OUT_DIR, exist_ok=True)
    with open(GEOJSON_PATH, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)
    print(f"[SIMPAN] GeoJSON hasil konversi -> {GEOJSON_PATH}")

    records = build_records(geojson)

    by_jenis = {}
    for r in records:
        by_jenis[r["jenis"]] = by_jenis.get(r["jenis"], 0) + 1
    print("\n=== RINGKASAN PER JENIS (sebelum dedup) ===")
    for jenis, n in sorted(by_jenis.items()):
        print(f"  {jenis}: {n}")

    if no_upload:
        print("\n[--no-upload] Melewati upload ke Supabase (hanya fetch + convert).")
        return

    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("[PERINGATAN] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset, tidak bisa upload.")
        sys.exit(1)
    client = create_client(url, key)

    inserted = upload_poi(client, records)
    print(f"\n[SELESAI] {inserted} baris poi baru (sumber=OpenStreetMap) berhasil diupload.")


if __name__ == "__main__":
    main()

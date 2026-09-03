"""
build_rute_biskita_osm.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Membangun layer koridor BisKita Trans Patriot (Kota Bekasi) yang LEBIH LENGKAP
dari 15 halte tersurvei, bersumber dari OpenStreetMap.

KENAPA ADA SCRIPT INI (baca juga jawaban di sesi & docs/DATA_CHECKLIST.md):
  - Tim TIDAK punya data trayek resmi BisKita Trans Patriot dari operator/Dishub
    (GTFS/KMZ/SHP). `rute_transit_eksisting` jenis='biskita_survei' hanya menutup
    ~1 km lewat 15 halte tersurvei.
  - OSM punya `network=Trans Bekasi Patriot`: ~33 halte (public_transport=
    platform + stop_position, dikelompokkan 20 relasi stop_area). TAPI OSM TIDAK
    punya relasi route/route_master — jadi GARIS rutenya harus DIAPROKSIMASI.

APA YANG DIHASILKAN (dua aset GeoJSON statis, ditulis ke frontend/src/data/ —
POLA SAMA dengan build_bekasi_boundary_geojson.py: aset build-time yang di-bundle
frontend, BUKAN tabel Supabase, BUKAN dipakai perhitungan skor CAI/TDI/Equity):
  1. biskita_halte_osm.geojson
     FeatureCollection titik — 1 fitur per halte fisik (platform+stop_position
     digabung, sufiks arah " 1"/" 2" dinormalisasi). properties: nama, osm_ref.
  2. biskita_koridor_osm.geojson
     FeatureCollection 1 LineString — halte diurut nearest-neighbour dari
     terminus utara, lalu disnap ke jaringan jalan via OSRM (profile 'driving',
     satu request /route dengan semua waypoint). URUTAN halte DIINFER (tidak ada
     data urutan resmi) — dinyatakan jujur di properties.catatan.

SUMBER & KEJUJURAN: label sumber = OpenStreetMap (network=Trans Bekasi Patriot),
ambil per <tanggal run>. Garis = aproksimasi road-routing, BUKAN geometri resmi
operator. Wajib tercermin di properties tiap FeatureCollection + di legenda peta.

KAPAN DI-GENERATE ULANG: kalau data OSM Trans Bekasi Patriot berubah, atau kalau
tim akhirnya dapat trayek resmi dari Dishub (saat itu ganti aset ini dgn data
resmi & update label sumber).

Cara pakai:
    python build_rute_biskita_osm.py            # fetch + tulis 2 geojson
    python build_rute_biskita_osm.py --offline <path_overpass.json>
                                                # pakai respons Overpass tersimpan
"""

import argparse
import json
import math
import os
import sys
import time

import requests

# Mirror Overpass — instance utama sering balas HTML error/timeout untuk query
# ini; kumi lebih stabil. Keduanya dicoba berurutan.
OVERPASS_ENDPOINTS = [
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass-api.de/api/interpreter",
]
OVERPASS_QUERY = (
    '[out:json][timeout:100];nwr["network"="Trans Bekasi Patriot"];out center tags;'
)

# OSRM demo publik — sama seperti build_rute_transit_eksisting.py. Profile driving
# (bus lewat jalan raya). Satu request /route dgn semua waypoint sekaligus supaya
# tidak ada loop panggilan jaringan yang bisa menggantung.
OSRM_ROUTE_URL = "https://router.project-osrm.org/route/v1/driving/"

OUT_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "data")
)
OUT_HALTE = os.path.join(OUT_DIR, "biskita_halte_osm.geojson")
OUT_KORIDOR = os.path.join(OUT_DIR, "biskita_koridor_osm.geojson")

SUMBER = "OpenStreetMap — network=Trans Bekasi Patriot (openstreetmap.org, diambil {tanggal})"
CATATAN_KORIDOR = (
    "APROKSIMASI. Halte bersumber OSM; OSM tidak punya relasi rute, jadi urutan "
    "halte diinfer (nearest-neighbour dari terminus utara) lalu disnap ke jaringan "
    "jalan via OSRM. BUKAN geometri trayek resmi operator/Dishub. BUKAN hasil "
    "survei lapangan tim (beda dengan 15 halte 'biskita_survei')."
)


def fetch_overpass() -> dict:
    last_err = None
    for url in OVERPASS_ENDPOINTS:
        for attempt in range(2):
            try:
                r = requests.post(url, data={"data": OVERPASS_QUERY}, timeout=120)
                r.encoding = "utf-8"
                if r.status_code == 200 and r.text.lstrip().startswith("{"):
                    print(f"[INFO] Overpass OK via {url} (attempt {attempt + 1}).")
                    return r.json()
                last_err = f"{url} -> HTTP {r.status_code}, body starts: {r.text[:80]!r}"
            except requests.RequestException as e:
                last_err = f"{url} -> {e}"
            time.sleep(3)
    raise RuntimeError(f"Semua endpoint Overpass gagal. Terakhir: {last_err}")


def node_coord(el: dict):
    if el.get("type") == "node":
        return el.get("lat"), el.get("lon")
    c = el.get("center") or {}
    return c.get("lat"), c.get("lon")


def normalize_name(name: str) -> str:
    """Gabung sufiks arah: 'RS Elisabeth 1' / 'RS Elisabeth 2' -> 'RS Elisabeth'."""
    n = (name or "").strip()
    parts = n.rsplit(" ", 1)
    if len(parts) == 2 and parts[1].isdigit():
        return parts[0].strip()
    return n


def extract_halte(overpass: dict):
    """1 titik per halte fisik: rata-rata semua platform/stop_position senama."""
    buckets = {}
    for el in overpass.get("elements", []):
        tags = el.get("tags", {})
        if tags.get("public_transport") not in ("platform", "stop_position"):
            continue
        lat, lon = node_coord(el)
        if lat is None or lon is None:
            continue
        key = normalize_name(tags.get("name", tags.get("ref", "")))
        if not key:
            continue
        buckets.setdefault(key, []).append((lat, lon))
    halte = []
    for nama, pts in buckets.items():
        lat = sum(p[0] for p in pts) / len(pts)
        lon = sum(p[1] for p in pts) / len(pts)
        halte.append({"nama": nama, "lat": lat, "lon": lon, "n_osm_node": len(pts)})
    print(f"[INFO] {len(halte)} halte fisik dari {sum(len(v) for v in buckets.values())} node OSM.")
    return halte


def _haversine_m(a, b):
    (la1, lo1), (la2, lo2) = a, b
    R = 6371000.0
    p1, p2 = math.radians(la1), math.radians(la2)
    dp = math.radians(la2 - la1)
    dl = math.radians(lo2 - lo1)
    h = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 2 * R * math.asin(math.sqrt(h))


def order_nearest_neighbour(halte):
    """Urut dari halte paling utara, tiap langkah ambil tetangga terdekat yang
    belum dipakai. Menangani ujung Vida (loop/terminus) lebih baik daripada
    sekadar sort latitude."""
    remaining = halte[:]
    start = min(remaining, key=lambda h: h["lat"])  # lat paling negatif = utara? -> tidak
    start = max(remaining, key=lambda h: h["lat"])  # lat terbesar (paling ~0) = paling UTARA
    ordered = [start]
    remaining.remove(start)
    while remaining:
        last = (ordered[-1]["lat"], ordered[-1]["lon"])
        nxt = min(remaining, key=lambda h: _haversine_m(last, (h["lat"], h["lon"])))
        ordered.append(nxt)
        remaining.remove(nxt)
    return ordered


def osrm_route(ordered):
    coords = ";".join(f"{h['lon']},{h['lat']}" for h in ordered)
    url = f"{OSRM_ROUTE_URL}{coords}"
    r = requests.get(
        url, params={"overview": "full", "geometries": "geojson"}, timeout=90
    )
    r.raise_for_status()
    data = r.json()
    if data.get("code") != "Ok" or not data.get("routes"):
        raise RuntimeError(f"OSRM balas: {data.get('code')} / {data.get('message')}")
    route = data["routes"][0]
    print(
        f"[INFO] OSRM route OK — {route['distance'] / 1000:.1f} km, "
        f"{len(route['geometry']['coordinates'])} verteks."
    )
    return route["geometry"]["coordinates"]


def write_geojson(path, fc):
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(fc, f, ensure_ascii=False, separators=(",", ":"))
    print(f"[TULIS] {path} ({os.path.getsize(path) / 1024:.1f} KB)")


def main():
    ap = argparse.ArgumentParser(description=__doc__)
    ap.add_argument("--offline", metavar="PATH", help="pakai respons Overpass JSON tersimpan")
    args = ap.parse_args()

    tanggal = time.strftime("%Y-%m-%d")

    if args.offline:
        with open(args.offline, encoding="utf-8") as f:
            overpass = json.load(f)
        print(f"[INFO] Overpass dari file: {args.offline}")
    else:
        overpass = fetch_overpass()

    halte = extract_halte(overpass)
    if len(halte) < 5:
        sys.exit(f"[GAGAL] hanya {len(halte)} halte — cek query/respons Overpass.")

    ordered = order_nearest_neighbour(halte)
    print("[INFO] Urutan halte (utara -> selatan, diinfer):")
    for i, h in enumerate(ordered, 1):
        print(f"   {i:2d}. {h['nama']}")

    halte_fc = {
        "type": "FeatureCollection",
        "properties": {
            "name": "Halte BisKita Trans Patriot (OSM)",
            "sumber": SUMBER.format(tanggal=tanggal),
            "catatan": "Halte dari OpenStreetMap. Belum disurvei lapangan tim.",
        },
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "Point", "coordinates": [h["lon"], h["lat"]]},
                "properties": {"nama": h["nama"], "urutan": i, "n_osm_node": h["n_osm_node"]},
            }
            for i, h in enumerate(ordered, 1)
        ],
    }
    write_geojson(OUT_HALTE, halte_fc)

    line_coords = osrm_route(ordered)
    koridor_fc = {
        "type": "FeatureCollection",
        "properties": {
            "name": "Koridor BisKita Trans Patriot (aproksimasi, OSM + OSRM)",
            "sumber": SUMBER.format(tanggal=tanggal),
            "catatan": CATATAN_KORIDOR,
        },
        "features": [
            {
                "type": "Feature",
                "geometry": {"type": "LineString", "coordinates": line_coords},
                "properties": {"n_halte": len(ordered), "aproksimasi": True},
            }
        ],
    }
    write_geojson(OUT_KORIDOR, koridor_fc)

    print("\n[SELESAI] 2 aset siap di-import statis di App.jsx (lihat pola bekasi_boundary).")


if __name__ == "__main__":
    main()

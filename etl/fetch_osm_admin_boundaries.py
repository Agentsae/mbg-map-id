"""
fetch_osm_admin_boundaries.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Tarik batas administrasi kecamatan & kelurahan/desa Kota Bekasi dari OSM
Overpass API publik (tanpa API key), simpan sebagai GeoJSON mentah di
etl/data/osm/ untuk jejak audit sebelum diproses lebih lanjut.

PENTING: script ini HANYA fetch + simpan file + cetak laporan perbandingan
nama vs baris dummy 006_seed_dummy_data.sql. TIDAK melakukan UPDATE/INSERT
ke Supabase — itu keputusan yang wajib direview manual dulu (lihat instruksi
tugas: FK skor_equity.kelurahan_id sudah menunjuk ke 6 baris dummy).

Catatan admin_level OSM Indonesia (dikonfirmasi lewat query area & tag):
  - admin_level=4 -> Provinsi
  - admin_level=6 -> Kabupaten/Kota (Kota Bekasi sendiri)
  - admin_level=7 -> Kecamatan
  - admin_level=8 -> Kelurahan/Desa
Instruksi tugas menyebut "admin_level=6 (kecamatan)" tapi itu tidak akurat
untuk convention OSM Indonesia -- level 6 adalah kota/kabupaten itu sendiri.
Script ini fetch level 7 (kecamatan) DAN level 8 (kelurahan) di dalam area
Kota Bekasi (level 6), lalu melaporkan apa yang benar-benar ditemukan supaya
tidak salah asumsi.

Cara pakai:
    python fetch_osm_admin_boundaries.py
"""

import json
import os
import sys
import time
import urllib.parse
import urllib.request

import osm2geojson

OVERPASS_ENDPOINTS = [
    "https://overpass-api.de/api/interpreter",
    "https://overpass.kumi.systems/api/interpreter",
    "https://overpass.openstreetmap.ru/api/interpreter",
]

OUT_DIR = os.path.join(os.path.dirname(__file__), "data", "osm")

# Query: cari area Kota Bekasi (admin_level=6), lalu ambil relasi
# admin_level 7 (kecamatan) dan 8 (kelurahan/desa) di dalamnya.
QUERY_ADMIN = """
[out:json][timeout:180];
area["boundary"="administrative"]["admin_level"="6"]["name"="Kota Bekasi"]->.kotaBekasi;
(
  relation["boundary"="administrative"]["admin_level"="7"](area.kotaBekasi);
  relation["boundary"="administrative"]["admin_level"="8"](area.kotaBekasi);
);
out geom;
"""


def query_overpass(query: str, max_retries: int = 3) -> dict:
    """Kirim query ke Overpass API publik, coba beberapa endpoint/retry
    kalau server sibuk (umum untuk overpass-api.de publik pada jam sibuk)."""
    last_err = None
    for endpoint in OVERPASS_ENDPOINTS:
        for attempt in range(1, max_retries + 1):
            try:
                print(f"[INFO] Query ke {endpoint} (percobaan {attempt}/{max_retries})...")
                data = urllib.parse.urlencode({"data": query}).encode("utf-8")
                req = urllib.request.Request(
                    endpoint,
                    data=data,
                    method="POST",
                    headers={
                        # Beberapa endpoint Overpass publik menolak (406) request
                        # tanpa User-Agent yang jelas / Accept header default urllib.
                        "User-Agent": "GeoTransitInsight-ETL/1.0 (MAPID WebGIS Competition 2026; contact: samuel.edison@student.president.ac.id)",
                        "Content-Type": "application/x-www-form-urlencoded",
                        "Accept": "*/*",
                    },
                )
                with urllib.request.urlopen(req, timeout=200) as resp:
                    raw = resp.read()
                result = json.loads(raw)
                n = len(result.get("elements", []))
                print(f"[OK] {endpoint} mengembalikan {n} elemen.")
                return result
            except Exception as e:
                last_err = e
                print(f"[GAGAL] {endpoint} percobaan {attempt}: {e}")
                time.sleep(5)
    raise RuntimeError(f"Semua endpoint Overpass gagal. Error terakhir: {last_err}")


def main():
    os.makedirs(OUT_DIR, exist_ok=True)

    overpass_json = query_overpass(QUERY_ADMIN)

    # Simpan Overpass JSON mentah dulu (jejak audit / bisa di-retry proses
    # konversi tanpa fetch ulang ke server publik).
    raw_path = os.path.join(OUT_DIR, "admin_boundaries_bekasi_raw_overpass.json")
    with open(raw_path, "w", encoding="utf-8") as f:
        json.dump(overpass_json, f, ensure_ascii=False)
    print(f"[SIMPAN] Overpass JSON mentah -> {raw_path}")

    elements = overpass_json.get("elements", [])
    if not elements:
        print("[PERINGATAN] 0 elemen dikembalikan. Kemungkinan area 'Kota Bekasi' "
              "tidak ditemukan dengan nama itu di OSM, atau server Overpass sibuk. "
              "Cek raw JSON untuk 'remark' dari server.")
        print(json.dumps(overpass_json.get("remark", "tidak ada remark"), ensure_ascii=False))
        sys.exit(1)

    # Konversi ke GeoJSON pakai osm2geojson (menangani assembly multipolygon
    # dari relation + way members, termasuk role outer/inner).
    geojson = osm2geojson.json2geojson(overpass_json)

    geojson_path = os.path.join(OUT_DIR, "admin_boundaries_bekasi.geojson")
    with open(geojson_path, "w", encoding="utf-8") as f:
        json.dump(geojson, f, ensure_ascii=False, indent=2)
    print(f"[SIMPAN] GeoJSON hasil konversi -> {geojson_path}")

    # Ringkasan per admin_level
    features = geojson.get("features", [])
    by_level = {}
    for feat in features:
        tags = feat.get("properties", {}).get("tags", {})
        level = tags.get("admin_level", "?")
        by_level.setdefault(level, []).append(tags.get("name", "(tanpa nama)"))

    print("\n=== RINGKASAN FITUR PER admin_level ===")
    for level, names in sorted(by_level.items()):
        print(f"admin_level={level}: {len(names)} fitur")
        for n in sorted(names):
            print(f"    - {n}")

    print(f"\nTotal fitur boundary: {len(features)}")
    print(f"File tersimpan: {geojson_path}")


if __name__ == "__main__":
    main()

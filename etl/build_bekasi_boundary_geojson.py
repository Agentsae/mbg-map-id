"""
build_bekasi_boundary_geojson.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Membuat aset GeoJSON batas area studi (outline Kota Bekasi) untuk dipakai
SEBAGAI BUNDLED ASSET di frontend (import statis, BUKAN fetch runtime) —
lihat frontend/src/App.jsx layer 'batas-kota-bekasi'.

Yang dibaca:
  - Tabel Supabase `batas_administrasi`, HANYA baris resmi RBI
    (sumber = SUMBER_BATAS_RESMI) — 56 poligon kelurahan Kota Bekasi.
    Baris dummy/seed (006_seed_dummy_data.sql) SENGAJA dibuang lewat filter
    `sumber` itu (pola sama dengan rerun_dasymetric_grid.py / compute_tdi_full.py).

Yang dihasilkan (satu file, ditulis ke frontend/src/data/):
  1. bekasi_boundary.geojson
     FeatureCollection berisi SATU fitur: union (dissolve) 56 poligon kelurahan
     jadi satu (Multi)Polygon outline kota, disederhanakan ringan
     (tolerance ~0.00025 derajat ≈ 28 m) supaya file kecil (~10-40 KB).
     Dipakai sebagai layer garis batas ('type: line') di peta.

Ini MURNI aset geometri referensi untuk UI — TIDAK menghitung skor
CAI/TDI/Equity apa pun.

Kapan perlu di-generate ulang:
  - HANYA kalau data batas RBI di `batas_administrasi` berubah (mis. RBI versi
    baru, koreksi poligon kelurahan). Geografi batas administrasi bersifat
    statis; tidak perlu dijalankan tiap build.

Cara pakai:
    python build_bekasi_boundary_geojson.py

Butuh kredensial Supabase di etl/.env (SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY),
sama seperti script ETL lain.
"""

from __future__ import annotations

import json
import os

import geopandas as gpd
from shapely.geometry import mapping

from build_fishnet_grid import WGS84
from rerun_dasymetric_grid import (
    SUMBER_BATAS_RESMI,
    fetch_all_paginated,
    wkb_hex_to_geom,
)
from upload_to_supabase import get_client

# Tolerance simplifikasi Douglas-Peucker dalam DERAJAT (data EPSG:4326).
# Target awal 0.0001 deg (~11 m) menghasilkan file ~56 KB; dinaikkan ke
# 0.00025 deg (~28 m) supaya file jatuh di rentang ~10-40 KB yang diminta,
# tanpa garis batas terlihat "patah" pada skala kota. Turunkan lagi kalau
# perlu detail lebih halus (dan terima file lebih besar).
SIMPLIFY_TOLERANCE_DEG = 0.00025

OUT_DIR = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "frontend", "src", "data")
)
OUT_BOUNDARY = os.path.join(OUT_DIR, "bekasi_boundary.geojson")


def load_dissolved_boundary(client) -> "gpd.GeoSeries":
    """Ambil 56 poligon kelurahan resmi RBI dari batas_administrasi lalu
    dissolve (union) jadi satu geometri outline Kota Bekasi."""
    rows = fetch_all_paginated(
        client,
        "batas_administrasi",
        "id, nama_kecamatan, nama_kelurahan, geom",
        filters={"sumber": SUMBER_BATAS_RESMI},
    )
    if not rows:
        raise SystemExit(
            "[ERROR] Tidak ada baris batas_administrasi dengan sumber "
            f"'{SUMBER_BATAS_RESMI}'. Jalankan build_admin_boundaries_from_rbi.py "
            "--upload dulu."
        )

    geoms = [wkb_hex_to_geom(r["geom"]) for r in rows]
    gdf = gpd.GeoDataFrame(geometry=geoms, crs=WGS84)
    print(f"[INFO] {len(gdf)} poligon kelurahan resmi RBI dibaca dari batas_administrasi.")

    # union_all() = dissolve semua part jadi satu (Multi)Polygon — pola sama
    # dengan build_fishnet_grid.clip_to_boundary().
    dissolved = gdf.geometry.union_all()
    # buffer(0) merapikan sliver/self-intersection kecil hasil union sebelum simplify.
    dissolved = dissolved.buffer(0)
    return dissolved


def to_feature_collection(geom, properties: dict) -> dict:
    return {
        "type": "FeatureCollection",
        "features": [
            {"type": "Feature", "properties": properties, "geometry": mapping(geom)}
        ],
    }


def write_geojson(path: str, fc: dict) -> int:
    os.makedirs(os.path.dirname(path), exist_ok=True)
    with open(path, "w", encoding="utf-8") as f:
        json.dump(fc, f, separators=(",", ":"))
    size = os.path.getsize(path)
    print(f"[OK] Ditulis {path} ({size / 1024:.1f} KB)")
    return size


def main() -> None:
    client = get_client()
    print("=== Build aset GeoJSON batas Kota Bekasi (bundled asset frontend) ===\n")

    dissolved = load_dissolved_boundary(client)

    simplified = dissolved.simplify(SIMPLIFY_TOLERANCE_DEG, preserve_topology=True)
    print(
        f"[INFO] Outline disederhanakan (tolerance {SIMPLIFY_TOLERANCE_DEG} deg ~ "
        f"{SIMPLIFY_TOLERANCE_DEG * 111000:.0f} m). "
        f"Tipe: {simplified.geom_type}."
    )

    boundary_fc = to_feature_collection(
        simplified,
        {
            "name": "Kota Bekasi",
            "role": "boundary",
            "sumber": SUMBER_BATAS_RESMI,
            "catatan": "Dissolve 56 kelurahan RBI 25K — aset build-time, "
            "regenerate hanya jika batas RBI berubah.",
        },
    )
    write_geojson(OUT_BOUNDARY, boundary_fc)

    print("\n[SELESAI] File batas siap dipakai frontend (import statis di App.jsx).")


if __name__ == "__main__":
    main()

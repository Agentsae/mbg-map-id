"""
rerun_dasymetric_grid.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Re-hitung grid_analisis.kepadatan_penduduk pakai TRUE dasymetric weighting
(building footprint OSM asli), menggantikan hasil areal-weighting fallback
yang dipakai saat grid pertama kali dibuat (lihat docs/DATA_CHECKLIST.md
Kategori E, catatan "SELESAI 27 Agu ... areal weighting, BUKAN dasymetric").

BEDA dengan build_fishnet_grid.py: script itu MEMBUAT fishnet baru (geom)
dari nol. Script ini TIDAK membuat geom baru — grid_analisis 2.607 cell
sudah ada (di-insert sekali lewat build_fishnet_grid.insert_grid_to_supabase()).
Di sini kita:
  1. Ambil geom grid yang SUDAH ADA di Supabase (supaya id/row tetap sama,
     tidak duplikat / tidak drift dari fishnet yang di-generate ulang).
  2. Ambil 56 kelurahan RBI asli (batas_administrasi, sumber=SUMBER_BATAS_RESMI)
     + jumlah_penduduk asli (tabel penduduk, join by kelurahan_id).
  3. Ambil building footprint OSM asli (etl/data/osm/building_footprint_bekasi.geojson,
     hasil fetch_osm_building_footprints.py).
  4. Panggil build_fishnet_grid.disaggregate_population_dasymetric(..., buildings=...)
     dengan grid YANG SUDAH ADA itu sebagai parameter `grid` (bukan grid baru).
  5. Verifikasi assert konservasi populasi (total sebar = total penduduk 56 kelurahan).
  6. UPDATE (bukan insert) kolom kepadatan_penduduk grid_analisis lewat upsert
     on_conflict='id' yang HANYA menyertakan kolom id + kepadatan_penduduk,
     supaya kolom lain (geom, skor_tdi, dst) tidak tersentuh.

Cara pakai:
    python rerun_dasymetric_grid.py
"""

import geopandas as gpd
import pandas as pd
from shapely import wkb
from shapely.geometry import shape

from build_fishnet_grid import disaggregate_population_dasymetric, WGS84
from upload_to_supabase import get_client

SUMBER_BATAS_RESMI = "BIG RBI 25K KUGI50 2022-12-31 (tanahair.indonesia.go.id)"
BUILDINGS_PATH = "data/osm/building_footprint_bekasi.geojson"
PAGE_SIZE = 1000  # default limit select() Supabase — perlu paginasi manual


def fetch_all_paginated(client, table: str, columns: str, filters=None) -> list[dict]:
    """Ambil SEMUA baris tabel lewat .range() paginasi (default select() limit 1000)."""
    filters = filters or {}
    rows = []
    start = 0
    while True:
        q = client.table(table).select(columns)
        for col, val in filters.items():
            q = q.eq(col, val)
        res = q.range(start, start + PAGE_SIZE - 1).execute()
        batch = res.data
        rows.extend(batch)
        if len(batch) < PAGE_SIZE:
            break
        start += PAGE_SIZE
    return rows


def wkb_hex_to_geom(geom_value):
    """
    Parse kolom geometry hasil select() Supabase — TERNYATA (dicek langsung
    27 Agu 2026, bukan diasumsikan dari kode frontend lama) supabase-py
    mengembalikannya sebagai dict GeoJSON langsung (mis.
    {'type': 'Polygon', 'coordinates': [...], 'crs': {...}}), BUKAN string
    WKB hex seperti yang diasumsikan frontend geo.js (lib itu menangani kasus
    row-level security / PostgREST versi lama yang mengembalikan WKB hex,
    tapi respons supabase-py client di sini nyatanya sudah GeoJSON parsed).
    Nama fungsi dipertahankan (wkb_hex_to_geom) demi minim diff, tapi isinya
    dukung dict GeoJSON (jalur utama) maupun string WKB hex (fallback, kalau
    suatu saat konfigurasi PostgREST berubah).
    """
    if isinstance(geom_value, dict):
        return shape(geom_value)
    return wkb.loads(bytes.fromhex(geom_value))


def load_grid_from_supabase(client) -> gpd.GeoDataFrame:
    rows = fetch_all_paginated(client, "grid_analisis", "id, geom")
    geoms = [wkb_hex_to_geom(r["geom"]) for r in rows]
    ids = [r["id"] for r in rows]
    gdf = gpd.GeoDataFrame({"grid_analisis_id": ids}, geometry=geoms, crs=WGS84)
    print(f"[INFO] Grid existing diambil dari Supabase: {len(gdf)} cell.")
    return gdf


def load_kelurahan_from_supabase(client) -> gpd.GeoDataFrame:
    admin_rows = fetch_all_paginated(
        client, "batas_administrasi", "id, nama_kelurahan, geom",
        filters={"sumber": SUMBER_BATAS_RESMI},
    )
    pend_rows = fetch_all_paginated(client, "penduduk", "kelurahan_id, jumlah_penduduk")
    pend_by_kel = {r["kelurahan_id"]: r["jumlah_penduduk"] for r in pend_rows}

    records = []
    missing_penduduk = []
    for r in admin_rows:
        pop = pend_by_kel.get(r["id"])
        if pop is None:
            missing_penduduk.append(r["nama_kelurahan"])
            continue
        records.append({
            "kelurahan_id": r["id"],
            "nama_kelurahan": r["nama_kelurahan"],
            "jumlah_penduduk": pop,
            "geometry": wkb_hex_to_geom(r["geom"]),
        })

    if missing_penduduk:
        print(
            f"[PERINGATAN] {len(missing_penduduk)} kelurahan RBI asli tidak punya baris "
            f"penduduk terkait, DIKECUALIKAN dari disagregasi (populasinya tidak ikut "
            f"disebar ke grid): {missing_penduduk}"
        )

    gdf = gpd.GeoDataFrame(records, crs=WGS84)
    print(f"[INFO] Kelurahan RBI asli + penduduk: {len(gdf)}/{len(admin_rows)} baris siap dipakai.")
    return gdf


def load_buildings(path: str = BUILDINGS_PATH) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(path)
    print(f"[INFO] Building footprint OSM: {len(gdf)} bangunan dari '{path}'.")
    return gdf


def upload_kepadatan_only(client, grid: gpd.GeoDataFrame):
    """
    UPDATE kolom kepadatan_penduduk saja, satu baris per request lewat
    .update().eq('id', ...).

    CATATAN (ganti dari upaya awal pakai upsert on_conflict='id'): grid_analisis.id
    adalah `generated always as identity` — PostgREST/Postgres MENOLAK upsert yang
    menyertakan nilai id eksplisit untuk kolom identity jenis itu (error 428C9,
    perlu 'OVERRIDING SYSTEM VALUE' yang tidak didukung upsert PostgREST biasa).
    UPDATE per baris (pola sama dengan upload_to_supabase.upload_tdi_scores())
    tidak kena masalah itu karena tidak melakukan INSERT sama sekali, walau lebih
    banyak request (2607 baris = 2607 request) dibanding upsert batch.
    """
    updated = 0
    total = len(grid)
    for i, row in enumerate(grid.itertuples(), start=1):
        result = (
            client.table("grid_analisis")
            .update({"kepadatan_penduduk": round(float(row.kepadatan_penduduk), 2)})
            .eq("id", int(row.grid_analisis_id))
            .execute()
        )
        updated += len(result.data)
        if i % 250 == 0 or i == total:
            print(f"  ... {i}/{total} baris grid_analisis di-update")
    print(f"Berhasil update kepadatan_penduduk (dasymetric) untuk {updated}/{total} baris grid_analisis.")
    return updated


if __name__ == "__main__":
    client = get_client()

    print("=== Re-run dasymetric grid_analisis.kepadatan_penduduk (building footprint asli) ===\n")

    grid = load_grid_from_supabase(client)
    kelurahan = load_kelurahan_from_supabase(client)
    buildings = load_buildings()

    grid_dasy = disaggregate_population_dasymetric(
        grid, kelurahan, population_column="jumlah_penduduk", buildings=buildings
    )

    total_asli = kelurahan["jumlah_penduduk"].sum()
    total_sebar = grid_dasy["kepadatan_penduduk"].sum()
    print(f"\nTotal penduduk 56 kelurahan RBI (yang match penduduk): {total_asli}")
    print(f"Total setelah disebar ke grid (dasymetric): {total_sebar:.2f}")
    selisih = abs(total_asli - total_sebar)
    print(f"Selisih: {selisih:.2f} jiwa ({selisih / total_asli * 100:.4f}%)")
    assert selisih < max(1.0, total_asli * 0.001), (
        "Populasi harus konservatif (tidak hilang/nambah signifikan saat disebar) — "
        "selisih > 0.1% dari total, cek ulang sebelum upload."
    )
    print("[OK] Assert konservasi populasi lolos.\n")

    upload_kepadatan_only(client, grid_dasy)

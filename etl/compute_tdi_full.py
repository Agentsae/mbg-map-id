"""
compute_tdi_full.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Hitung skor_tdi untuk SELURUH 2.607 cell grid_analisis (fishnet 300m, sudah
diisi kepadatan_penduduk dasymetric-real oleh rerun_dasymetric_grid.py),
lalu UPDATE ke Supabase. Sebelumnya BLOCKED karena konfigurasi_bobot belum
ada baris 'TDI_MOBILITAS' (lihat docs/DATA_CHECKLIST.md) — sekarang
unblocked oleh 009_bobot_tdi_equity_mentor_review.sql.

compute_tdi() di compute_scores.py butuh 3 kolom mentah per grid yang BELUM
ada scriptnya (dicatat sebagai TODO di compute_scores.py & DATA_CHECKLIST.md):
  - skor_aksesibilitas_transit  <- jarak grid ke halte_eksisting REAL
    terdekat (HLT-001..015, koridor BisKita), fungsi decay linear coverage
    isochrone 400m/800m (bukan network routing riil - eksplisit out-of-scope
    PRD Bab 3, sama seperti pendekatan RPC simulate_new_stop()).
  - proporsi_usia_rentan        <- spatial join centroid grid ke kelurahan
    RBI asli (56, batas_administrasi sumber=SUMBER_BATAS_RESMI), lalu ambil
    proporsi_lansia + proporsi_balita kelurahan itu dari tabel `penduduk`
    (sumber=Disdukcapil DKB Semester 1 2026). Definisi "usia rentan" di sini
    HANYA lansia+balita (proksi PRD Bab 7d) — data difabel belum tersedia,
    dicatat sebagai keterbatasan, bukan disembunyikan.
  - kepadatan_poi_harian        <- jumlah POI real (sumber='OpenStreetMap',
    jenis sekolah/faskes/kerja) dalam radius RADIUS_POI_M dari centroid grid.

kepadatan_penduduk grid TIDAK dihitung ulang di sini — dipakai apa adanya
dari grid_analisis (hasil rerun_dasymetric_grid.py, building footprint OSM
asli, assert konservasi populasi sudah lolos).

rasio_tanpa_kendaraan TETAP tidak tersedia (data BPS/Susenas belum ada) —
compute_indeks_kebutuhan_mobilitas() otomatis fallback ke nilai netral 0.5
untuk kriteria ini di semua grid, dicetak sebagai peringatan eksplisit.

Cara pakai:
    python compute_tdi_full.py              # hitung + print ringkasan, TIDAK upload
    python compute_tdi_full.py --upload      # hitung + upload ke grid_analisis
"""

import argparse

import geopandas as gpd
import numpy as np
import pandas as pd

from compute_scores import compute_tdi, sensitivity_check_tdi, DEFAULT_MOBILITY_WEIGHTS
from rerun_dasymetric_grid import (
    fetch_all_paginated,
    wkb_hex_to_geom,
    SUMBER_BATAS_RESMI,
    WGS84,
)
from upload_to_supabase import get_client, load_weights_from_db, upload_tdi_scores

METRIC_CRS = "EPSG:32748"  # UTM 48S, sama dengan build_fishnet_grid.py

# Radius hitung POI "kebutuhan harian" di sekitar grid (meter) — skala jalan
# kaki 5 menit (~400m @ 4.8km/jam), konsisten dengan RPC simulate_new_stop()
# ("standar ITDP walking catchment" 400m) dan CLAUDE.md (estimasi jalan kaki,
# BUKAN network routing riil).
RADIUS_POI_M = 400

# Ambang coverage isochrone untuk skor_aksesibilitas_transit (Bab 7 PRD):
# <=AMBANG_PENUH  -> layanan penuh (1.0)
# antara          -> decay linear
# >AMBANG_NIHIL   -> tidak terlayani (0.0)
AMBANG_PENUH_M = 400
AMBANG_NIHIL_M = 800

SUMBER_POI_REAL = "OpenStreetMap"
JENIS_POI_HARIAN = ["sekolah", "faskes", "kerja"]
PREFIX_HALTE_DUMMY = "DUMMY-HLT-"


def skor_aksesibilitas_dari_jarak(jarak_m: pd.Series) -> pd.Series:
    """
    Fungsi decay linear coverage isochrone 400m/800m — lihat AMBANG_* di atas.
    Contoh: 300m -> 1.0 | 400m -> 1.0 | 600m -> 0.5 | 800m -> 0.0 | 1500m -> 0.0
    """
    out = 1 - (jarak_m - AMBANG_PENUH_M) / (AMBANG_NIHIL_M - AMBANG_PENUH_M)
    return out.clip(lower=0.0, upper=1.0)


def load_grid(client) -> gpd.GeoDataFrame:
    rows = fetch_all_paginated(client, "grid_analisis", "id, geom, kepadatan_penduduk")
    geoms = [wkb_hex_to_geom(r["geom"]) for r in rows]
    gdf = gpd.GeoDataFrame(
        {
            "grid_analisis_id": [r["id"] for r in rows],
            "kepadatan_penduduk": [float(r["kepadatan_penduduk"] or 0.0) for r in rows],
        },
        geometry=geoms,
        crs=WGS84,
    )
    print(f"[INFO] grid_analisis: {len(gdf)} cell dimuat.")
    return gdf


def load_kelurahan_usia_rentan(client) -> gpd.GeoDataFrame:
    admin_rows = fetch_all_paginated(
        client, "batas_administrasi", "id, nama_kelurahan, geom", filters={"sumber": SUMBER_BATAS_RESMI}
    )
    pend_rows = fetch_all_paginated(
        client, "penduduk", "kelurahan_id, jumlah_penduduk, proporsi_lansia, proporsi_balita"
    )
    pend_by_kel = {r["kelurahan_id"]: r for r in pend_rows}

    records, missing = [], []
    for r in admin_rows:
        p = pend_by_kel.get(r["id"])
        if p is None or p["proporsi_lansia"] is None or p["proporsi_balita"] is None:
            missing.append(r["nama_kelurahan"])
            continue
        records.append({
            "kelurahan_id": r["id"],
            "nama_kelurahan": r["nama_kelurahan"],
            "jumlah_penduduk": p["jumlah_penduduk"],
            "proporsi_usia_rentan": p["proporsi_lansia"] + p["proporsi_balita"],
            "geometry": wkb_hex_to_geom(r["geom"]),
        })
    if missing:
        print(f"[PERINGATAN] {len(missing)} kelurahan RBI tanpa data penduduk lengkap, dikecualikan: {missing}")

    gdf = gpd.GeoDataFrame(records, crs=WGS84)
    print(f"[INFO] Kelurahan RBI + proporsi_usia_rentan: {len(gdf)}/{len(admin_rows)} siap dipakai.")
    return gdf


def load_poi_harian(client) -> gpd.GeoDataFrame:
    rows = fetch_all_paginated(client, "poi", "id, jenis, geom", filters={"sumber": SUMBER_POI_REAL})
    rows = [r for r in rows if r["jenis"] in JENIS_POI_HARIAN]
    geoms = [wkb_hex_to_geom(r["geom"]) for r in rows]
    gdf = gpd.GeoDataFrame({"poi_id": [r["id"] for r in rows]}, geometry=geoms, crs=WGS84)
    print(f"[INFO] POI kebutuhan harian real ({'/'.join(JENIS_POI_HARIAN)}): {len(gdf)} titik.")
    return gdf


def load_halte_real(client) -> gpd.GeoDataFrame:
    rows = fetch_all_paginated(client, "halte_eksisting", "id, id_halte_survei, nama, geom")
    rows = [r for r in rows if not str(r["id_halte_survei"]).startswith(PREFIX_HALTE_DUMMY)]
    geoms = [wkb_hex_to_geom(r["geom"]) for r in rows]
    gdf = gpd.GeoDataFrame(
        {"halte_id": [r["id"] for r in rows], "nama_halte": [r["nama"] for r in rows]},
        geometry=geoms, crs=WGS84,
    )
    print(f"[INFO] Halte eksisting REAL (koridor BisKita, DUMMY-HLT-* dikecualikan): {len(gdf)} titik.")
    return gdf


def build_grid_features(client) -> gpd.GeoDataFrame:
    grid = load_grid(client)
    kelurahan = load_kelurahan_usia_rentan(client)
    poi = load_poi_harian(client)
    halte = load_halte_real(client)

    grid_m = grid.to_crs(METRIC_CRS)
    kelurahan_m = kelurahan.to_crs(METRIC_CRS)
    poi_m = poi.to_crs(METRIC_CRS)
    halte_m = halte.to_crs(METRIC_CRS)

    centroids = grid_m.copy()
    centroids["geometry"] = centroids.geometry.centroid

    # --- proporsi_usia_rentan: centroid grid -> kelurahan RBI (point-in-polygon) ---
    joined = gpd.sjoin(centroids, kelurahan_m[["kelurahan_id", "proporsi_usia_rentan", "geometry"]],
                        how="left", predicate="within")
    joined = joined.loc[~joined.index.duplicated(keep="first")]  # jaga2 kalau centroid pas di garis batas 2 polygon
    grid_m["proporsi_usia_rentan"] = joined["proporsi_usia_rentan"].values

    n_unmatched = grid_m["proporsi_usia_rentan"].isna().sum()
    if n_unmatched:
        # Fallback: rata-rata kota (weighted by jumlah_penduduk) -- BUKAN 0 --
        # supaya cell yang jatuh persis di celah antar-polygon (efek simplifikasi
        # RBI 25K) tidak diam-diam mendapat skor kebutuhan mobilitas nihil.
        total_pop = kelurahan["jumlah_penduduk"].sum()
        rata2_kota = (kelurahan["proporsi_usia_rentan"] * kelurahan["jumlah_penduduk"]).sum() / total_pop
        print(
            f"[PERINGATAN] {n_unmatched}/{len(grid_m)} cell tidak match ke kelurahan RBI manapun "
            f"(kemungkinan celah antar-polygon RBI 25K) -> pakai fallback rata-rata kota "
            f"(weighted): {rata2_kota:.4f}"
        )
        grid_m["proporsi_usia_rentan"] = grid_m["proporsi_usia_rentan"].fillna(rata2_kota)

    # --- kepadatan_poi_harian: jumlah POI real dalam radius RADIUS_POI_M dari centroid ---
    buffers = centroids.copy()
    buffers["geometry"] = buffers.geometry.buffer(RADIUS_POI_M)
    poi_join = gpd.sjoin(poi_m, buffers[["grid_analisis_id", "geometry"]], how="left", predicate="within")
    poi_count = poi_join.groupby("grid_analisis_id").size()
    grid_m["kepadatan_poi_harian"] = grid_m["grid_analisis_id"].map(poi_count).fillna(0).astype(int)

    # --- skor_aksesibilitas_transit: nearest real halte, decay 400/800m ---
    nearest = gpd.sjoin_nearest(centroids, halte_m[["halte_id", "nama_halte", "geometry"]],
                                 how="left", distance_col="jarak_halte_m")
    nearest = nearest.loc[~nearest.index.duplicated(keep="first")]
    grid_m["jarak_halte_terdekat_m"] = nearest["jarak_halte_m"].values
    grid_m["skor_aksesibilitas_transit"] = skor_aksesibilitas_dari_jarak(grid_m["jarak_halte_terdekat_m"])

    grid_m["grid_id"] = grid_m["grid_analisis_id"].astype(str)  # id_col utk sensitivity_check_tdi
    return grid_m


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upload", action="store_true", help="Upload hasil ke grid_analisis (default: dry-run, print saja)")
    args = parser.parse_args()

    client = get_client()

    print("=== 1. Susun fitur mentah TDI per grid (2.607 cell) ===\n")
    df = build_grid_features(client)

    print("\n=== 2. Bobot Indeks Kebutuhan Mobilitas dari konfigurasi_bobot ===")
    weights = load_weights_from_db(client, "TDI_MOBILITAS", DEFAULT_MOBILITY_WEIGHTS)

    print("\n=== 3. Hitung compute_tdi() untuk seluruh grid ===")
    scored = compute_tdi(df, weights)

    print("\n--- Ringkasan distribusi skor_tdi ---")
    print(scored["skor_tdi"].describe().round(4).to_string())
    print("\n--- Ringkasan distribusi kepadatan_penduduk (input, dasymetric-real) ---")
    print(scored["kepadatan_penduduk"].describe().round(2).to_string())
    print("\n--- Ringkasan distribusi skor_aksesibilitas_transit ---")
    print(scored["skor_aksesibilitas_transit"].describe().round(4).to_string())

    print(f"\nTop 10 cell paling 'transit desert' (skor_tdi tertinggi):")
    print(scored[["grid_analisis_id", "kepadatan_penduduk", "proporsi_usia_rentan",
                   "kepadatan_poi_harian", "jarak_halte_terdekat_m",
                   "skor_aksesibilitas_transit", "skor_tdi"]].head(10).round(4).to_string(index=False))

    print("\n=== 4. Sensitivity analysis (geser bobot mobilitas ±10%) ===")
    sens = sensitivity_check_tdi(scored, weights)
    print(sens.to_string(index=False))
    n_unstable = (sens["jumlah_ranking_berubah"] > 0).sum()
    print(f"\n{n_unstable}/{len(sens)} skenario pergeseran bobot mengubah ranking skor_tdi (dari {len(scored)} cell).")

    print("\n=== 5. Face-validity check: skor_tdi dekat vs jauh dari halte real ===")
    dekat = scored[scored["jarak_halte_terdekat_m"] <= AMBANG_PENUH_M]
    jauh = scored[scored["jarak_halte_terdekat_m"] > AMBANG_NIHIL_M]
    print(f"Cell dalam {AMBANG_PENUH_M}m dari halte terdekat (n={len(dekat)}): rata2 skor_tdi = {dekat['skor_tdi'].mean():.4f}")
    print(f"Cell di atas {AMBANG_NIHIL_M}m dari halte terdekat (n={len(jauh)}): rata2 skor_tdi = {jauh['skor_tdi'].mean():.4f}")

    if args.upload:
        print("\n=== 6. Upload ke grid_analisis ===")
        upload_tdi_scores(client, scored)
    else:
        print("\n[DRY-RUN] --upload tidak diberikan, TIDAK ada perubahan ditulis ke Supabase.")

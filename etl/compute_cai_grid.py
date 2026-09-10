"""
compute_cai_grid.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

SURFACE Composite Accessibility Index (CAI) 300 m di grid_analisis — HYBRID:
kriteria DIUKUR di sel yang punya data lapangan (titik survei / halte
tersurvei di dekatnya) dan DITURUNKAN dari geodata (kepadatan dasymetric,
jarak POI OSM) di sel lainnya. Kapabilitas BARU yang ADITIF:

  * TIDAK menyentuh tabel skor_cai berbasis titik, alur titik_kandidat,
    maupun recompute_all_cai_scores() — ketiganya tetap jadi basis
    normalisasi min-max untuk usulan_halte_model.
  * Menulis kolom cai_* baru di grid_analisis (lihat
    supabase/migrations/033_skor_cai_grid.sql) + di-baca RPC get_cai_breakdown().

FORMULA (ADITIF, sejajar CAI titik — BUKAN rasio seperti TDI):

    cai_skor = Σ ( cai_n_i × cai_bobot_i )   untuk i ∈ {kepadatan, jarak_inv, volume, survei}

  - cai_n_kepadatan = minmax( kepadatan_penduduk )                     [grid_analisis apa adanya]
  - cai_n_jarak_inv = minmax( jarak ke POI fasilitas umum, INVERSE )   [clip 3000 m]
  - cai_n_volume    = minmax( volume/aktivitas transit )               [HYBRID, lihat di bawah]
  - cai_n_survei    = skor kondisi halte tersurvei <= 400 m            [apa adanya 0-1; NaN kalau tak ada]
  Semua minmax dihitung lintas SELURUH sel grid berpenduduk.
  Bobot dari konfigurasi_bobot nama_index='CAI' (AHP pairwise Saaty formal
  2026-09-03: kepadatan 0,329 / jarak_inv 0,329 / volume 0,2002 / survei 0,1418).
  Sel tanpa halte tersurvei <= 400 m -> kriteria survei N/A (BUKAN 0): 3 bobot
  sisanya dinormalisasi ulang ke jumlah 1 untuk sel itu (sama logika
  exclude_criteria=['survei'] di compute_scores.compute_cai()).

VOLUME HYBRID:
  - OLS  total_aktivitas ~ kepadatan_penduduk  di-fit pada titik survei REAL
    (x = kepadatan sel PEMUAT titik, biar konsisten dengan surface). a, b, R²,
    n dicetak; kalau R² < ~0,2 dicetak PERINGATAN "estimasi lemah" (tetap
    best-effort transparan, diungkap di RPC/UI).
  - Sel MEMUAT titik survei ATAU centroid <= 300 m dari titik survei
    -> cai_volume_penumpang = total_aktivitas titik terdekat; cai_volume_estimasi=False.
  - Sel lain -> cai_volume_penumpang = clip( a + b·kepadatan, min_obs, max_obs );
    cai_volume_estimasi=True  (min/max_obs = rentang total_aktivitas terobservasi).

RADII: POI clip 3000 m · volume terukur <= 300 m · survei halte <= 400 m ·
RPC luar-grid > 500 m (cermin get_tdi_breakdown / migration 021).

RUNBOOK (grid_analisis HARUS sudah terisi — sudah: 2607 sel dg skor_tdi):
    supabase db push                          # terapkan 033_skor_cai_grid.sql
    python etl/compute_cai_grid.py            # hitung + print, TIDAK upload (default)
    python etl/compute_cai_grid.py --upload   # hitung + tulis kolom cai_* ke grid_analisis
Offline (Supabase tidak dikonfigurasi): jalan self-test grid+titik sintetis, print saja.

Konvensi ikut sibling ETL: argparse, EPSG:32748 utk semua operasi metrik,
reuse helper dari rerun_dasymetric_grid / compute_scores.
"""

import argparse
import os
import sys
from datetime import datetime, timezone

import geopandas as gpd
import numpy as np
import pandas as pd
import shapely.geometry as sg

from compute_scores import normalize_min_max, DEFAULT_WEIGHTS, CAI_CRITERIA_KEYS
from build_fishnet_grid import WGS84
from rerun_dasymetric_grid import fetch_all_paginated, wkb_hex_to_geom

METRIC_CRS = "EPSG:32748"  # UTM 48S — sama dengan seluruh pipeline ETL lain

# --- radii (semua DIPINJAM dari konstanta yang sudah berlaku di repo) ---
JARAK_FASILITAS_CLIP_M = 3000.0     # batas atas jarak POI (di atas ini efek inverse ~nol, hindari outlier skala)
RADIUS_VOLUME_TERUKUR_M = 300.0     # = lebar sel; sel <= 300 m dari titik survei dianggap "terukur"
RADIUS_SURVEI_HALTE_M = 400.0       # = AMBANG_PENUH_M compute_tdi_full / walking catchment ITDP (003_simulate_new_stop)

SUMBER_POI_REAL = "OpenStreetMap"                      # konsisten attach_cai_features_titik_kandidat / compute_tdi_full
JENIS_POI_FASILITAS_UMUM = ("sekolah", "faskes", "kerja")
PREFIX_TITIK_DEMO = "KND-DEMO-"                         # = PREFIX_ID_TITIK_SURVEI_DEMO (007 seed rows), dikecualikan
PREFIX_HALTE_DUMMY = "DUMMY-HLT-"                       # = compute_tdi_full.load_halte_real()

# ============================================================
# REGRESI OLS volume<->kepadatan — DIHITUNG ULANG tiap run oleh fit_volume_ols()
# dari titik survei REAL. Angka di bawah = nilai TERAMATI pada run live
# 2026-09-10 (18 titik_kandidat REAL, total_aktivitas 10..80 aktivitas/2 jam).
# Disimpan sebagai dokumentasi / acuan cepat — BUKAN dipakai langsung oleh
# perhitungan. Update kalau data titik_kandidat berubah.
#   a (intercept) = 19.7362
#   b (slope)     = 0.01148425
#   R^2           = 0.0654   -> LEMAH (R^2 < 0,2): estimasi volume ditandai
#                              cai_volume_estimasi=True & diungkap di RPC/UI.
#   n             = 18
#   total_aktivitas observed: min = 10, max = 80
#   Hasil run live 2026-09-10: 37 sel volume TERUKUR, 2570 sel ESTIMASI,
#   44 sel dg term survei aktif; cai_skor min/mean/max = 0,0324 / 0,3756 / 0,9650.
# ============================================================
VOLUME_OLS_DOC = {"a": 19.7362, "b": 0.01148425, "r2": 0.0654, "n": 18, "min_obs": 10, "max_obs": 80}


def _num_or_none(x, nd: int = 4):
    """Bulatkan ke nd desimal, atau None kalau NaN/None (kolom N/A -> NULL SQL)."""
    if x is None or pd.isna(x):
        return None
    return round(float(x), nd)


def fit_volume_ols(kepadatan, total_aktivitas):
    """OLS y = a + b·x. Return (a, b, R², n)."""
    x = np.asarray(kepadatan, dtype=float)
    y = np.asarray(total_aktivitas, dtype=float)
    b, a = np.polyfit(x, y, 1)  # np.polyfit -> [slope, intercept]
    yhat = a + b * x
    ss_res = float(np.sum((y - yhat) ** 2))
    ss_tot = float(np.sum((y - y.mean()) ** 2))
    r2 = 1.0 - ss_res / ss_tot if ss_tot > 0 else float("nan")
    return float(a), float(b), float(r2), int(len(x))


# ------------------------------------------------------------
# Loader (live Supabase)
# ------------------------------------------------------------
def load_grid(client) -> gpd.GeoDataFrame:
    rows = fetch_all_paginated(client, "grid_analisis", "id, geom, kepadatan_penduduk")
    gdf = gpd.GeoDataFrame(
        {"id": [r["id"] for r in rows],
         "kepadatan_penduduk": [float(r["kepadatan_penduduk"] or 0.0) for r in rows]},
        geometry=[wkb_hex_to_geom(r["geom"]) for r in rows], crs=WGS84,
    )
    print(f"[INFO] grid_analisis: {len(gdf)} sel.")
    return gdf


def load_poi_fasilitas_umum(client) -> gpd.GeoDataFrame:
    rows = fetch_all_paginated(client, "poi", "id, jenis, geom", filters={"sumber": SUMBER_POI_REAL})
    rows = [r for r in rows if r["jenis"] in JENIS_POI_FASILITAS_UMUM]
    gdf = gpd.GeoDataFrame({"poi_id": [r["id"] for r in rows]},
                           geometry=[wkb_hex_to_geom(r["geom"]) for r in rows], crs=WGS84)
    print(f"[INFO] POI fasilitas umum ({'/'.join(JENIS_POI_FASILITAS_UMUM)}, {SUMBER_POI_REAL}): {len(gdf)}.")
    return gdf


def load_halte_kondisi(client) -> gpd.GeoDataFrame:
    """Halte REAL (DUMMY-HLT-* dikecualikan) yang punya skor kondisi:
    skor_survei_gabungan kalau ada, kalau tidak fallback skor_kelengkapan_fisik."""
    rows = fetch_all_paginated(
        client, "halte_eksisting",
        "id, id_halte_survei, geom, skor_survei_gabungan, skor_kelengkapan_fisik",
    )
    ids, skors, geoms, kolom = [], [], [], []
    for r in rows:
        if str(r["id_halte_survei"] or "").startswith(PREFIX_HALTE_DUMMY):
            continue
        if r["skor_survei_gabungan"] is not None:
            s, src = float(r["skor_survei_gabungan"]), "skor_survei_gabungan"
        elif r["skor_kelengkapan_fisik"] is not None:
            s, src = float(r["skor_kelengkapan_fisik"]), "skor_kelengkapan_fisik"
        else:
            continue
        ids.append(r["id"]); skors.append(s); kolom.append(src)
        geoms.append(wkb_hex_to_geom(r["geom"]))
    gdf = gpd.GeoDataFrame({"halte_id": ids, "cai_skor_survei": skors, "kolom_kondisi": kolom},
                           geometry=geoms, crs=WGS84)
    n_gab = int((gdf["kolom_kondisi"] == "skor_survei_gabungan").sum()) if len(gdf) else 0
    n_fis = int((gdf["kolom_kondisi"] == "skor_kelengkapan_fisik").sum()) if len(gdf) else 0
    print(f"[INFO] halte_eksisting REAL dg skor kondisi: {len(gdf)} "
          f"({n_gab} pakai skor_survei_gabungan, {n_fis} fallback skor_kelengkapan_fisik).")
    return gdf


def load_titik_survei_volume(client) -> gpd.GeoDataFrame:
    """titik_kandidat REAL (KND-DEMO-* / seed 007 dikecualikan) dg total_aktivitas
    (cacahan Traffic Counting 2 jam)."""
    rows = fetch_all_paginated(client, "titik_kandidat", "id, id_titik_survei, geom, total_aktivitas")
    ids, tot, geoms = [], [], []
    for r in rows:
        if str(r["id_titik_survei"] or "").startswith(PREFIX_TITIK_DEMO):
            continue
        if r["total_aktivitas"] is None:
            continue
        ids.append(r["id"]); tot.append(int(r["total_aktivitas"]))
        geoms.append(wkb_hex_to_geom(r["geom"]))
    gdf = gpd.GeoDataFrame({"titik_id": ids, "total_aktivitas": tot}, geometry=geoms, crs=WGS84)
    print(f"[INFO] titik_kandidat REAL dg total_aktivitas: {len(gdf)} titik (KND-DEMO-* dikecualikan).")
    return gdf


# ------------------------------------------------------------
# Inti — geometry-in, tanpa client (dipakai jalur live & offline)
# ------------------------------------------------------------
def compute_cai_grid(grid: gpd.GeoDataFrame, poi: gpd.GeoDataFrame,
                     halte: gpd.GeoDataFrame, survei: gpd.GeoDataFrame,
                     weights: dict):
    """
    grid   : [id, kepadatan_penduduk, geometry]  EPSG:4326
    poi    : [geometry]                           fasilitas umum OSM
    halte  : [cai_skor_survei, geometry]          halte REAL dg skor kondisi 0-1
    survei : [total_aktivitas, geometry]          titik_kandidat REAL
    weights: {kepadatan, jarak_inv, volume, survei}  (jumlah 1)
    Return : (DataFrame kolom cai_* selaras grid, dict fit regresi)
    """
    assert abs(sum(weights[k] for k in CAI_CRITERIA_KEYS) - 1.0) < 1e-6, "bobot CAI harus jumlah 1"

    g = grid.to_crs(METRIC_CRS).reset_index(drop=True)
    cent = g.copy()
    cent["geometry"] = cent.geometry.centroid

    out = pd.DataFrame({"id": g["id"].values})
    out["kepadatan_penduduk"] = g["kepadatan_penduduk"].astype(float).values

    # --- 1. jarak ke fasilitas umum terdekat (centroid -> POI), clip 3000 m ---
    poi_m = poi.to_crs(METRIC_CRS)
    nn_poi = gpd.sjoin_nearest(cent[["id", "geometry"]], poi_m[["geometry"]],
                               how="left", distance_col="d")
    nn_poi = nn_poi.loc[~nn_poi.index.duplicated(keep="first")].reset_index(drop=True)
    out["cai_jarak_fasilitas_m"] = np.minimum(nn_poi["d"].astype(float).values, JARAK_FASILITAS_CLIP_M)

    # --- 2. volume transit (hybrid terukur / estimasi regresi) ---
    survei_m = survei.to_crs(METRIC_CRS).reset_index(drop=True)

    # 2a. OLS: x = kepadatan sel PEMUAT titik survei (fallback nearest), y = total_aktivitas
    sj = gpd.sjoin(survei_m[["total_aktivitas", "geometry"]],
                   g[["id", "kepadatan_penduduk", "geometry"]], how="left", predicate="within")
    sj = sj.loc[~sj.index.duplicated(keep="first")]
    miss = sj["kepadatan_penduduk"].isna()
    if bool(miss.any()):
        nn = gpd.sjoin_nearest(survei_m.loc[miss.values, ["total_aktivitas", "geometry"]],
                               g[["id", "kepadatan_penduduk", "geometry"]],
                               how="left", distance_col="d")
        nn = nn.loc[~nn.index.duplicated(keep="first")]
        sj.loc[miss.values, "kepadatan_penduduk"] = nn["kepadatan_penduduk"].values
    a, b, r2, n_fit = fit_volume_ols(sj["kepadatan_penduduk"].values, sj["total_aktivitas"].values)
    min_obs = float(np.min(survei_m["total_aktivitas"]))
    max_obs = float(np.max(survei_m["total_aktivitas"]))
    print(f"[REGRESI] total_aktivitas ~ kepadatan_penduduk  (n={n_fit} titik survei REAL): "
          f"a={a:.4f}  b={b:.8f}  R^2={r2:.4f}  | observed total_aktivitas min={min_obs:.0f} max={max_obs:.0f}")
    if not np.isfinite(r2) or r2 < 0.2:
        print("[PERINGATAN] R^2 regresi volume < ~0,2 -> estimasi volume LEMAH. Tetap dipakai "
              "sebagai best-effort transparan; sel estimasi ditandai cai_volume_estimasi=True "
              "dan diungkap jujur di RPC get_cai_breakdown / UI.")

    # 2b. per sel: jarak centroid -> titik survei terdekat + flag "memuat titik"
    nn_s = gpd.sjoin_nearest(cent[["id", "geometry"]],
                             survei_m[["total_aktivitas", "geometry"]],
                             how="left", distance_col="d")
    nn_s = nn_s.loc[~nn_s.index.duplicated(keep="first")].reset_index(drop=True)
    dist_survei = nn_s["d"].astype(float).values
    vol_terdekat = nn_s["total_aktivitas"].astype(float).values

    contains = gpd.sjoin(g[["id", "geometry"]], survei_m[["geometry"]],
                         how="left", predicate="contains")
    contains_ids = set(contains.loc[contains["index_right"].notna(), "id"])
    contains_mask = out["id"].isin(contains_ids).values

    terukur_mask = contains_mask | (dist_survei <= RADIUS_VOLUME_TERUKUR_M)
    vol_estimasi_val = np.clip(a + b * out["kepadatan_penduduk"].values, min_obs, max_obs)
    out["cai_volume_penumpang"] = np.where(terukur_mask, vol_terdekat, vol_estimasi_val)
    out["cai_volume_estimasi"] = ~terukur_mask
    print(f"[INFO] volume: {int(terukur_mask.sum())} sel TERUKUR (memuat titik survei / <= "
          f"{RADIUS_VOLUME_TERUKUR_M:.0f} m), {int((~terukur_mask).sum())} sel ESTIMASI regresi.")

    # --- 3. skor survei kondisi halte (centroid -> halte REAL <= 400 m) ---
    halte_m = halte.to_crs(METRIC_CRS)
    nn_h = gpd.sjoin_nearest(cent[["id", "geometry"]],
                             halte_m[["cai_skor_survei", "geometry"]],
                             how="left", distance_col="d")
    nn_h = nn_h.loc[~nn_h.index.duplicated(keep="first")].reset_index(drop=True)
    skor_h = nn_h["cai_skor_survei"].astype(float).values
    skor_h = np.where(nn_h["d"].astype(float).values <= RADIUS_SURVEI_HALTE_M, skor_h, np.nan)
    out["cai_skor_survei"] = skor_h
    print(f"[INFO] survei: {int(np.isfinite(skor_h).sum())} sel punya halte tersurvei <= "
          f"{RADIUS_SURVEI_HALTE_M:.0f} m (kriteria survei aktif), sisanya N/A.")

    # --- 4. normalisasi min-max lintas SEMUA sel ---
    out["cai_n_kepadatan"] = normalize_min_max(out["kepadatan_penduduk"]).values
    out["cai_n_jarak_inv"] = normalize_min_max(out["cai_jarak_fasilitas_m"], inverse=True).values
    out["cai_n_volume"] = normalize_min_max(out["cai_volume_penumpang"]).values
    out["cai_n_survei"] = out["cai_skor_survei"]  # apa adanya, NaN tetap NaN

    # --- 5. bobot efektif per sel (renormalisasi 3 kriteria kalau survei N/A) ---
    has_survei = out["cai_n_survei"].notna()
    s3 = weights["kepadatan"] + weights["jarak_inv"] + weights["volume"]
    out["cai_bobot_kepadatan"] = np.where(has_survei, weights["kepadatan"], weights["kepadatan"] / s3)
    out["cai_bobot_jarak"] = np.where(has_survei, weights["jarak_inv"], weights["jarak_inv"] / s3)
    out["cai_bobot_volume"] = np.where(has_survei, weights["volume"], weights["volume"] / s3)
    out["cai_bobot_survei"] = np.where(has_survei, weights["survei"], np.nan)

    # --- 6. skor CAI grid (ADITIF: Σ nilai_i × bobot_i) ---
    term_survei = (out["cai_bobot_survei"] * out["cai_n_survei"]).where(has_survei, 0.0)
    out["cai_skor"] = (
        out["cai_bobot_kepadatan"] * out["cai_n_kepadatan"]
        + out["cai_bobot_jarak"] * out["cai_n_jarak_inv"]
        + out["cai_bobot_volume"] * out["cai_n_volume"]
        + term_survei
    )

    # --- asersi ---
    assert out["cai_skor"].between(-1e-9, 1 + 1e-9).all(), "cai_skor keluar dari [0,1]"
    out["cai_skor"] = out["cai_skor"].clip(0.0, 1.0)
    all_w_nan = out[["cai_bobot_kepadatan", "cai_bobot_jarak", "cai_bobot_volume"]].isna().all(axis=1)
    assert not bool(all_w_nan.any()), "ada sel tanpa satu pun bobot (tidak boleh terjadi)"

    fit = dict(a=a, b=b, r2=r2, n=n_fit, min_obs=min_obs, max_obs=max_obs)
    return out, fit


# ------------------------------------------------------------
# Ringkasan + upload
# ------------------------------------------------------------
_SAMPLE_COLS = [
    "id", "kepadatan_penduduk", "cai_jarak_fasilitas_m", "cai_volume_penumpang", "cai_volume_estimasi",
    "cai_n_kepadatan", "cai_n_jarak_inv", "cai_n_volume", "cai_n_survei",
    "cai_bobot_kepadatan", "cai_bobot_jarak", "cai_bobot_volume", "cai_bobot_survei", "cai_skor",
]


def print_summary(out: pd.DataFrame, fit: dict):
    s = out["cai_skor"]
    recon = (
        out["cai_bobot_kepadatan"] * out["cai_n_kepadatan"]
        + out["cai_bobot_jarak"] * out["cai_n_jarak_inv"]
        + out["cai_bobot_volume"] * out["cai_n_volume"]
        + (out["cai_bobot_survei"] * out["cai_n_survei"]).fillna(0.0)
    )
    print("\n=== RINGKASAN skor_cai_grid ===")
    print(f"  n sel                      : {len(out)}")
    print(f"  regresi volume             : a={fit['a']:.4f}  b={fit['b']:.8f}  R^2={fit['r2']:.4f}  n={fit['n']}")
    print(f"  total_aktivitas observed   : min={fit['min_obs']:.0f}  max={fit['max_obs']:.0f}")
    print(f"  sel volume TERUKUR         : {int((~out['cai_volume_estimasi']).sum())}")
    print(f"  sel volume ESTIMASI regresi: {int(out['cai_volume_estimasi'].sum())}")
    print(f"  sel dg term survei aktif   : {int(out['cai_n_survei'].notna().sum())}")
    print(f"  cai_skor min/mean/max      : {s.min():.4f} / {s.mean():.4f} / {s.max():.4f}")
    print(f"  |cai_skor - Sum(n_i*bobot_i)| max = {(s - recon).abs().max():.2e}  (~0 -> aditif & dapat ditelusuri)")
    print("\n  5 sampel baris:")
    print(out[_SAMPLE_COLS].head(5).to_string(index=False))


def upload_cai_grid(client, out: pd.DataFrame, chunk: int = 500):
    """Upsert batched kolom cai_* di grid_analisis by id (pola
    rerun_dasymetric_grid.py: upsert on_conflict='id', hanya kolom target)."""
    now_iso = datetime.now(timezone.utc).isoformat()
    records = []
    for _, r in out.iterrows():
        records.append({
            "id": int(r["id"]),
            "cai_jarak_fasilitas_m": _num_or_none(r["cai_jarak_fasilitas_m"], 2),
            "cai_volume_penumpang": _num_or_none(r["cai_volume_penumpang"], 2),
            "cai_skor_survei": _num_or_none(r["cai_skor_survei"], 4),
            "cai_volume_estimasi": bool(r["cai_volume_estimasi"]),
            "cai_n_kepadatan": _num_or_none(r["cai_n_kepadatan"], 4),
            "cai_n_jarak_inv": _num_or_none(r["cai_n_jarak_inv"], 4),
            "cai_n_volume": _num_or_none(r["cai_n_volume"], 4),
            "cai_n_survei": _num_or_none(r["cai_n_survei"], 4),
            "cai_bobot_kepadatan": _num_or_none(r["cai_bobot_kepadatan"], 4),
            "cai_bobot_jarak": _num_or_none(r["cai_bobot_jarak"], 4),
            "cai_bobot_volume": _num_or_none(r["cai_bobot_volume"], 4),
            "cai_bobot_survei": _num_or_none(r["cai_bobot_survei"], 4),
            "cai_skor": _num_or_none(r["cai_skor"], 4),
            "cai_dihitung_pada": now_iso,
        })
    total = 0
    for i in range(0, len(records), chunk):
        part = records[i:i + chunk]
        client.table("grid_analisis").upsert(part, on_conflict="id").execute()
        total += len(part)
        print(f"  upsert {total}/{len(records)}")
    print(f"[UPLOAD] {total} baris grid_analisis diperbarui kolom cai_* (cai_dihitung_pada={now_iso}).")


# ------------------------------------------------------------
# Jalur live
# ------------------------------------------------------------
def run_live(args):
    from upload_to_supabase import get_client, load_weights_from_db

    client = get_client()
    weights = load_weights_from_db(client, "CAI", DEFAULT_WEIGHTS)
    weights = {k: float(weights[k]) for k in CAI_CRITERIA_KEYS}  # jaga urutan & tipe

    print("\n=== Muat grid_analisis + POI fasilitas umum + halte kondisi + titik survei ===")
    grid = load_grid(client)
    if grid.empty:
        raise SystemExit("grid_analisis kosong — jalankan build_fishnet_grid.py + rerun_dasymetric_grid.py dulu.")
    poi = load_poi_fasilitas_umum(client)
    halte = load_halte_kondisi(client)
    survei = load_titik_survei_volume(client)
    if survei.empty:
        raise SystemExit("Tidak ada titik_kandidat REAL dg total_aktivitas — regresi volume tidak bisa di-fit.")

    print("\n=== Hitung surface CAI grid (hybrid) ===")
    out, fit = compute_cai_grid(grid, poi, halte, survei, weights)
    print_summary(out, fit)

    if args.upload:
        print("\n=== Upload ke grid_analisis ===")
        upload_cai_grid(client, out)
    else:
        print("\n[DRY-RUN] --upload tidak diberikan - TIDAK ada yang ditulis ke Supabase. "
              "Jalankan ulang dengan --upload setelah hasil di atas dinilai masuk akal.")


# ------------------------------------------------------------
# Jalur offline self-test (Supabase tidak dikonfigurasi)
# ------------------------------------------------------------
def run_offline_selftest():
    print("=== OFFLINE SELF-TEST (SUPABASE_URL / SERVICE_ROLE_KEY tidak diset) ===")
    print("Tidak ada CSV survei di etl/data/survei/ -> pakai grid + titik survei sintetis, print saja.\n")

    x0, y0, step = 106.98, -6.28, 0.0027  # ~300 m
    rng = np.random.default_rng(42)
    cells, ids, dens = [], [], []
    k = 1
    for i in range(6):
        for j in range(6):
            minx, miny = x0 + i * step, y0 + j * step
            cells.append(sg.box(minx, miny, minx + step, miny + step))
            ids.append(k); k += 1
            dens.append(float(rng.integers(200, 3500)))
    grid = gpd.GeoDataFrame({"id": ids, "kepadatan_penduduk": dens}, geometry=cells, crs=WGS84)
    poi = gpd.GeoDataFrame(
        geometry=[sg.Point(x0 + 0.004, y0 + 0.004), sg.Point(x0 + 0.012, y0 + 0.010),
                  sg.Point(x0 + 0.006, y0 + 0.014)], crs=WGS84)
    halte = gpd.GeoDataFrame(
        {"cai_skor_survei": [0.62, 0.80]},
        geometry=[sg.Point(x0 + 0.0035, y0 + 0.0035), sg.Point(x0 + 0.014, y0 + 0.006)], crs=WGS84)
    survei = gpd.GeoDataFrame(
        {"total_aktivitas": [12, 25, 40, 63, 78]},
        geometry=[sg.Point(x0 + 0.001 + 0.010 * t, y0 + 0.001 + 0.009 * t) for t in range(5)], crs=WGS84)

    weights = {k: float(v) for k, v in DEFAULT_WEIGHTS.items()}
    out, fit = compute_cai_grid(grid, poi, halte, survei, weights)
    print_summary(out, fit)

    # Contoh perhitungan manual (buktikan hasil masuk akal, bukan cuma "jalan"):
    print("\n  --- Telusur manual 3 sel pertama (Sum nilai_i * bobot_i) ---")
    for _, r in out.head(3).iterrows():
        parts = [("kepadatan", r.cai_n_kepadatan, r.cai_bobot_kepadatan),
                 ("jarak_inv", r.cai_n_jarak_inv, r.cai_bobot_jarak),
                 ("volume", r.cai_n_volume, r.cai_bobot_volume),
                 ("survei", r.cai_n_survei, r.cai_bobot_survei)]
        segs, tot = [], 0.0
        for nama, n_i, w_i in parts:
            if pd.isna(n_i) or pd.isna(w_i):
                segs.append(f"{nama}=N/A")
                continue
            tot += n_i * w_i
            segs.append(f"{nama}({n_i:.3f}x{w_i:.3f}={n_i * w_i:.3f})")
        print(f"   sel {int(r.id):>2}: " + " + ".join(segs) + f"  => cai_skor={tot:.4f} (tersimpan {r.cai_skor:.4f})")


if __name__ == "__main__":
    ap = argparse.ArgumentParser(description="Surface CAI grid 300 m (hybrid) di grid_analisis — aditif, tidak menyentuh skor_cai titik.")
    ap.add_argument("--upload", action="store_true",
                    help="Tulis kolom cai_* ke grid_analisis (default: hitung + print saja).")
    args = ap.parse_args()

    from dotenv import load_dotenv
    load_dotenv()
    if os.environ.get("SUPABASE_URL") and os.environ.get("SUPABASE_SERVICE_ROLE_KEY"):
        run_live(args)
    else:
        run_offline_selftest()
        sys.exit(0)

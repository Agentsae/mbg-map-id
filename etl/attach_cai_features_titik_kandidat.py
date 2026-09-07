"""
attach_cai_features_titik_kandidat.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

ORKESTRATOR skor_cai untuk SELURUH titik_kandidat REAL (KND-DEMO-* dikecualikan).
Menyusun DUA input mentah compute_cai() dari GEOMETRI titik survei — bukan dari
kolom Excel hand-typed — lalu memanggil recompute_all_cai_scores() SATU KALI
supaya ke-19 titik REAL dinormalisasi (min-max) sebagai satu batch yang
sebanding:

  1. kepadatan_penduduk  <- spatial join titik_kandidat -> grid_analisis
     (dasymetric-real per cell 300 m). Metodologi identik dengan
     attach_kepadatan_titik_kandidat.py (fungsi-fungsinya di-reuse langsung dari
     modul itu: point-in-polygon 'within' utama + sjoin_nearest fallback,
     proyeksi metrik EPSG:32748, konversi jiwa/cell -> jiwa/km2).

  2. jarak_fasilitas_m   <- sjoin_nearest titik_kandidat -> poi "fasilitas umum"
     terdekat (ST_Distance-ekuivalen di GeoPandas), proyeksi metrik EPSG:32748.
     Lihat "PILIHAN LAYER POI" di bawah.

===========================================================================
KENAPA SCRIPT INI ADA (masalah yang diperbaiki)
===========================================================================
recompute_all_cai_scores() sebelumnya memetakan
`jarak_fasilitas_m <- jarak_transit_terdekat_m`. Kolom itu diisi MANUAL dari
kolom 15 Excel Form Traffic Counting, dengan semantik BERBEDA antar dua batch
survei:
  - KND-002..009 (surveyor Muhamad Febrian, sekitar Stasiun/Terminal Bekasi):
    dicatat 20–350 m ("jarak ke transit apa saja"). Haversine riil ke halte
    BisKita tersurvei terdekat justru 2.300–3.160 m.
  - KND-010..023 (surveyor Galuh Eka Permana, Grand Wisata / Mustika Jaya /
    Bantar Gebang): dicatat angka bulat 3.000–8.000 m, beberapa nilai identik.
    Haversine riil ke halte terdekat 4.000–4.900 m (mis. KND-014 dicatat 8.000
    vs riil ~4.440).
Akibatnya n_jarak_inv terbelah keras: batch 1 ≈ 0,96–1,0 ; batch 2 ≈ 0,13–0,63
(KND-014 = maksimum batch -> ternormalisasi tepat 0). Ranking CAI lintas dua
batch jadi tidak sebanding.

PRD Bab 7.3 mendefinisikan kriteria ini sebagai: "Jarak ke fasilitas umum
(inverse) — POI OpenStreetMap / Menu Go, ST_Distance". Jadi menghitungnya dari
geom titik survei membawa pipeline MASUK ke spec — BUKAN mengubah formula,
bobot, maupun pendekatan normalisasi CAI (semuanya tetap: WLC 4 kriteria,
min-max per-kriteria, bobot dari konfigurasi_bobot / AHP 2026-09-03).

===========================================================================
PILIHAN LAYER POI ("fasilitas umum")
===========================================================================
Mengikuti persis apa yang SUDAH diperlakukan sebagai POI fasilitas publik oleh
pipeline ETL lain, demi konsistensi lintas-skor:
  - compute_tdi_full.py : SUMBER_POI_REAL = "OpenStreetMap",
    JENIS_POI_HARIAN = ["sekolah", "faskes", "kerja"]
  - aggregate_equity_kelurahan.py : SUMBER_POI_REAL = "OpenStreetMap",
    jenis sekolah/faskes/kerja dipetakan ke akses pendidikan/kesehatan/kerja
Tabel `poi` saat ini 763 baris, SEMUANYA sumber='OpenStreetMap' dengan jenis ∈
{sekolah (330), kerja (271), faskes (162)} — tidak ada baris non-publik untuk
disaring. "Jarak ke fasilitas umum" = jarak ke POI TERDEKAT dari GABUNGAN
ketiga jenis itu (fasilitas publik apa pun: sekolah, fasilitas kesehatan, atau
pusat kegiatan/kerja), konsisten dengan makna "fasilitas umum" di PRD.

Cara pakai:
    python attach_cai_features_titik_kandidat.py            # hitung + print, TIDAK upload
    python attach_cai_features_titik_kandidat.py --upload    # hitung + upload ke skor_cai
"""

import argparse

import geopandas as gpd
import pandas as pd

from compute_scores import DEFAULT_WEIGHTS
from rerun_dasymetric_grid import fetch_all_paginated, wkb_hex_to_geom, WGS84
from upload_to_supabase import (
    get_client,
    load_weights_from_db,
    recompute_all_cai_scores,
)
# Re-use metodologi spatial join kepadatan apa adanya (jangan duplikasi).
from attach_kepadatan_titik_kandidat import (
    METRIC_CRS,
    load_titik_kandidat_real,
    load_grid,
    attach_kepadatan_real,
    load_existing_skor_cai,
)

# Konsisten dengan compute_tdi_full.py / aggregate_equity_kelurahan.py.
SUMBER_POI_REAL = "OpenStreetMap"
JENIS_POI_FASILITAS_UMUM = ["sekolah", "faskes", "kerja"]


def load_poi_fasilitas_umum(client) -> gpd.GeoDataFrame:
    rows = fetch_all_paginated(client, "poi", "id, jenis, geom", filters={"sumber": SUMBER_POI_REAL})
    rows = [r for r in rows if r["jenis"] in JENIS_POI_FASILITAS_UMUM]
    geoms = [wkb_hex_to_geom(r["geom"]) for r in rows]
    gdf = gpd.GeoDataFrame(
        {"poi_id": [r["id"] for r in rows], "jenis": [r["jenis"] for r in rows]},
        geometry=geoms,
        crs=WGS84,
    )
    from collections import Counter
    print(
        f"[INFO] POI fasilitas umum real ({'/'.join(JENIS_POI_FASILITAS_UMUM)}, "
        f"sumber={SUMBER_POI_REAL}): {len(gdf)} titik {dict(Counter(gdf['jenis']))}."
    )
    return gdf


def attach_jarak_fasilitas(titik: gpd.GeoDataFrame, poi: gpd.GeoDataFrame) -> pd.DataFrame:
    """
    Jarak (meter) tiap titik_kandidat ke POI fasilitas umum TERDEKAT, dihitung
    di proyeksi metrik EPSG:32748 (UTM 48S, CRS metrik proyek — sama dengan
    attach_kepadatan_titik_kandidat.py / compute_tdi_full.py). Setara
    ST_Distance ke POI terdekat; memakai gpd.sjoin_nearest mengikuti pola
    compute_tdi_full.py (grid -> halte terdekat).
    """
    titik_m = titik.to_crs(METRIC_CRS).reset_index(drop=True)
    poi_m = poi.to_crs(METRIC_CRS)

    nearest = gpd.sjoin_nearest(
        titik_m, poi_m[["poi_id", "jenis", "geometry"]], how="left", distance_col="jarak_fasilitas_m"
    )
    nearest = nearest.loc[~nearest.index.duplicated(keep="first")].reset_index(drop=True)

    out = nearest[
        ["titik_kandidat_id", "id_titik_survei", "deskripsi_lokasi",
         "poi_id", "jenis", "jarak_fasilitas_m"]
    ].rename(columns={"jenis": "jenis_poi_terdekat", "poi_id": "poi_id_terdekat"})
    return out


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--upload", action="store_true",
        help="Upload hasil recompute ke skor_cai (default: dry-run, hitung + print saja)",
    )
    args = parser.parse_args()

    client = get_client()

    print("=== 1. Muat titik_kandidat REAL + grid_analisis + POI fasilitas umum ===\n")
    titik = load_titik_kandidat_real(client)
    grid = load_grid(client)
    poi = load_poi_fasilitas_umum(client)
    if titik.empty:
        raise SystemExit("Tidak ada titik_kandidat REAL — tidak ada yang bisa dihitung.")

    print("\n=== 2a. Spatial join: kepadatan_penduduk REAL per titik (grid_analisis dasymetric) ===\n")
    kepadatan_df = attach_kepadatan_real(titik, grid)
    kepadatan_by_titik_id = dict(
        zip(kepadatan_df["titik_kandidat_id"], kepadatan_df["kepadatan_penduduk_density"])
    )

    print("\n=== 2b. sjoin_nearest: jarak_fasilitas_m REAL per titik (POI OSM terdekat, EPSG:32748) ===\n")
    jarak_df = attach_jarak_fasilitas(titik, poi)
    jarak_by_titik_id = dict(zip(jarak_df["titik_kandidat_id"], jarak_df["jarak_fasilitas_m"]))

    # Ambil jarak_transit_terdekat_m lama (kolom Excel) untuk kolom perbandingan.
    tk_raw = (
        client.table("titik_kandidat")
        .select("id, id_titik_survei, jarak_transit_terdekat_m")
        .execute()
        .data
    )
    jtrd_lama = {r["id"]: r["jarak_transit_terdekat_m"] for r in tk_raw}

    print("\n=== 3. Baris skor_cai LAMA (sebelum recompute) ===\n")
    before = load_existing_skor_cai(client, jarak_df["titik_kandidat_id"].tolist())
    before_nj = {}
    before_skor = {}
    rank_lama = {}
    if not before.empty:
        print(before.round(4).to_string(index=False))
        for _, r in before.iterrows():
            tk = int(r["titik_kandidat_id"])
            before_nj[tk] = float(r["n_jarak_inv"])
            before_skor[tk] = float(r["skor_final"])
        before_sorted = before.sort_values("skor_final", ascending=False).reset_index(drop=True)
        rank_lama = {int(r["titik_kandidat_id"]): i + 1 for i, r in before_sorted.iterrows()}
    else:
        print("(Belum ada baris skor_cai untuk titik-titik ini — akan INSERT baru.)")

    print("\n=== 4. Bobot CAI dari konfigurasi_bobot ===")
    weights = load_weights_from_db(client, "CAI", DEFAULT_WEIGHTS)

    mode = "UPLOAD (menulis ke skor_cai)" if args.upload else "DRY-RUN (tidak menulis apa pun)"
    print(f"\n=== 5. Recompute skor_cai — 19 titik REAL, jarak & kepadatan dari GEOM [{mode}] ===\n")
    scored = recompute_all_cai_scores(
        client,
        weights=weights,
        kepadatan_by_titik_id=kepadatan_by_titik_id,
        jarak_fasilitas_by_titik_id=jarak_by_titik_id,
        upload=args.upload,
    )

    if not scored.empty:
        scored = scored.reset_index(drop=True)
        rank_baru = {
            int(r["titik_kandidat_id"]): i + 1
            for i, r in scored.sort_values("skor_cai", ascending=False).reset_index(drop=True).iterrows()
        }

        rows_cmp = []
        for _, r in scored.iterrows():
            tk = int(r["titik_kandidat_id"])
            rows_cmp.append({
                "id_titik_survei": r["id_titik_survei"],
                "jtrd_excel_m": jtrd_lama.get(tk),
                "jarak_poi_baru_m": round(float(jarak_by_titik_id.get(tk, float("nan"))), 1),
                "n_jarak_inv_LAMA": round(before_nj[tk], 4) if tk in before_nj else None,
                "n_jarak_inv_BARU": round(float(r["n_jarak_inv"]), 4),
                "skor_LAMA": round(before_skor[tk], 4) if tk in before_skor else None,
                "skor_BARU": round(float(r["skor_cai"]), 4),
                "rank_LAMA": rank_lama.get(tk),
                "rank_BARU": rank_baru.get(tk),
            })
        cmp_df = pd.DataFrame(rows_cmp).sort_values("rank_BARU").reset_index(drop=True)
        print("\n--- BEFORE / AFTER (19 titik REAL, urut rank_BARU) ---")
        print(cmp_df.to_string(index=False))

        # Sanity checks
        nj = scored["n_jarak_inv"]
        print("\n--- Sanity check ---")
        print(f"  n_jarak_inv: min={nj.min():.4f} max={nj.max():.4f} "
              f"nulls={int(nj.isna().sum())} di luar [0,1]={int(((nj < 0) | (nj > 1)).sum())}")
        print(f"  skor_cai: min={scored['skor_cai'].min():.4f} max={scored['skor_cai'].max():.4f} "
              f"nulls={int(scored['skor_cai'].isna().sum())} negatif={int((scored['skor_cai'] < 0).sum())}")
        b1 = cmp_df[cmp_df["id_titik_survei"].isin([f"KND-{n:03d}" for n in range(2, 10)])]
        b2 = cmp_df[~cmp_df["id_titik_survei"].isin([f"KND-{n:03d}" for n in range(2, 10)])]
        print(f"  n_jarak_inv batch1 (KND-002..009): min={b1['n_jarak_inv_BARU'].min():.4f} "
              f"max={b1['n_jarak_inv_BARU'].max():.4f}")
        print(f"  n_jarak_inv batch2 (KND-010..023): min={b2['n_jarak_inv_BARU'].min():.4f} "
              f"max={b2['n_jarak_inv_BARU'].max():.4f}")
        moved = cmp_df[cmp_df["rank_LAMA"] != cmp_df["rank_BARU"]]
        print(f"\n  {len(moved)}/{len(cmp_df)} titik berubah posisi ranking.")

    if not args.upload:
        print(
            "\n[DRY-RUN] --upload tidak diberikan, TIDAK ada perubahan ditulis ke Supabase. "
            "Jalankan ulang dengan --upload setelah hasil di atas diverifikasi masuk akal."
        )

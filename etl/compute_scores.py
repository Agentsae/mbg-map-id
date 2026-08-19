"""
compute_scores.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Implementasi Composite Accessibility Index (CAI) memakai Weighted Linear
Combination, sesuai Bab 7a proposal & framework teknis.

Cara pakai:
    python compute_scores.py            # jalankan demo dengan data sintetis
    (nanti) python compute_scores.py --input data/processed/titik_kandidat.csv

TODO integrasi selanjutnya (belum dikerjakan di sini, butuh data asli):
  - Ganti load_demo_data() dengan query GeoPandas/PostGIS asli:
      * n_kepadatan   <- spatial join grid_analisis dengan penduduk
      * n_jarak_inv   <- ST_Distance / GeoPandas .distance() ke poi terdekat
      * n_volume      <- jumlah penumpang KRL/BRT dalam radius tertentu
      * n_survei      <- skor_survei_gabungan dari tabel halte_eksisting
  - Bobot sebaiknya dibaca dari tabel konfigurasi_bobot (hasil AHP dengan
    mentor), bukan hardcoded seperti DEFAULT_WEIGHTS di bawah — ganti
    load_weights() begitu sesi AHP selesai.
"""

import pandas as pd
import numpy as np

# Bobot default SEBELUM hasil AHP final — lihat catatan di framework
# Bagian 6.2. Ganti begitu sesi mentoring AHP selesai.
DEFAULT_WEIGHTS = {
    "kepadatan": 0.35,
    "jarak_inv": 0.25,
    "volume": 0.25,
    "survei": 0.15,
}


def normalize_min_max(series: pd.Series, inverse: bool = False) -> pd.Series:
    """
    Normalisasi min-max ke skala 0-1.

    inverse=True dipakai untuk kriteria 'semakin kecil semakin baik'
    (mis. jarak ke fasilitas umum — makin dekat, makin baik).
    """
    lo, hi = series.min(), series.max()
    if hi == lo:
        # Semua nilai sama -> tidak ada variasi untuk dibedakan, netral di tengah
        return pd.Series(0.5, index=series.index)
    normalized = (series - lo) / (hi - lo)
    return 1 - normalized if inverse else normalized


def compute_cai(df: pd.DataFrame, weights: dict = None) -> pd.DataFrame:
    """
    Hitung Composite Accessibility Index untuk tiap baris (titik/grid).

    df wajib punya kolom mentah:
      - kepadatan_penduduk   (jiwa/km2 atau jumlah penduduk sekitar titik)
      - jarak_fasilitas_m    (meter, semakin kecil semakin baik -> inverse)
      - volume_penumpang     (penumpang/hari di simpul transit terdekat)
      - skor_survei          (0-1, sudah dihitung dari S_survei lapangan)

    Return: df yang sama + kolom n_kepadatan, n_jarak_inv, n_volume,
    n_survei, dan skor_cai (0-1).
    """
    weights = weights or DEFAULT_WEIGHTS
    assert abs(sum(weights.values()) - 1.0) < 1e-6, "Bobot harus berjumlah 1.0"

    out = df.copy()
    out["n_kepadatan"] = normalize_min_max(out["kepadatan_penduduk"])
    out["n_jarak_inv"] = normalize_min_max(out["jarak_fasilitas_m"], inverse=True)
    out["n_volume"] = normalize_min_max(out["volume_penumpang"])
    out["n_survei"] = out["skor_survei"]  # sudah 0-1 dari instrumen survei, tidak perlu normalisasi ulang

    out["skor_cai"] = (
        weights["kepadatan"] * out["n_kepadatan"]
        + weights["jarak_inv"] * out["n_jarak_inv"]
        + weights["volume"] * out["n_volume"]
        + weights["survei"] * out["n_survei"]
    )
    return out.sort_values("skor_cai", ascending=False).reset_index(drop=True)


def sensitivity_check(df: pd.DataFrame, base_weights: dict, delta: float = 0.1) -> pd.DataFrame:
    """
    Uji kestabilan ranking: geser tiap bobot +/- delta (dengan sisanya
    disesuaikan proporsional), lihat apakah urutan top-N berubah.
    Dipakai untuk validasi metodologi sebelum dipresentasikan ke juri
    (lihat framework Bagian 2, prinsip 'sensitivity analysis').
    """
    baseline_order = compute_cai(df, base_weights)["skor_cai"].rank(ascending=False)
    results = []
    for key in base_weights:
        for sign in (+1, -1):
            shifted = base_weights.copy()
            shifted[key] = max(0, shifted[key] + sign * delta)
            total = sum(shifted.values())
            shifted = {k: v / total for k, v in shifted.items()}  # renormalize ke 1.0

            new_order = compute_cai(df, shifted)["skor_cai"].rank(ascending=False)
            rank_changed = (baseline_order.values != new_order.values).sum()
            results.append({
                "kriteria_digeser": key,
                "arah": "+" if sign > 0 else "-",
                "jumlah_ranking_berubah": int(rank_changed),
            })
    return pd.DataFrame(results)


def load_demo_data() -> pd.DataFrame:
    """Data sintetis untuk demo/testing — GANTI dengan data asli."""
    return pd.DataFrame({
        "nama_lokasi": [
            "Simpang Mustika Jaya",
            "Dekat Stasiun Bekasi Timur",
            "Perumahan Rawa Lumbu",
            "Kawasan Industri Marga Mulya",
        ],
        "kepadatan_penduduk": [14200, 9800, 16500, 6100],
        "jarak_fasilitas_m": [850, 300, 1200, 600],
        "volume_penumpang": [120, 4200, 80, 1500],
        "skor_survei": [0.55, 0.80, 0.40, 0.65],
    })


if __name__ == "__main__":
    print("=== Demo perhitungan Composite Accessibility Index (data sintetis) ===\n")
    demo = load_demo_data()
    result = compute_cai(demo, DEFAULT_WEIGHTS)

    print(result[[
        "nama_lokasi", "n_kepadatan", "n_jarak_inv", "n_volume", "n_survei", "skor_cai"
    ]].round(3).to_string(index=False))

    print("\n=== Sensitivity analysis (geser tiap bobot ±0.1) ===\n")
    sens = sensitivity_check(demo, DEFAULT_WEIGHTS)
    print(sens.to_string(index=False))

    n_unstable = (sens["jumlah_ranking_berubah"] > 0).sum()
    print(f"\n{n_unstable} dari {len(sens)} skenario pergeseran bobot mengubah ranking.")
    print("Jika sebagian besar 0 -> ranking cukup stabil (robust terhadap pemilihan bobot).")

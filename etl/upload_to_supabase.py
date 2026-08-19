"""
upload_to_supabase.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Mengunggah hasil compute_scores.py ke tabel skor_cai di Supabase.
Dipakai berulang kali selama periode survei (7-20 Agu), bukan sekali jalan
di akhir — lihat framework Bagian 9 & 11.

Setup:
    pip install supabase python-dotenv
    export SUPABASE_URL=https://xxxx.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=xxxx   # BUKAN anon key — ini bypass RLS

    ⚠️ Service role key HANYA untuk script ini (server-side), JANGAN PERNAH
    dimasukkan ke frontend/.env atau ke repository git.

Cara pakai:
    python upload_to_supabase.py
"""

import os
import sys
from supabase import create_client
from compute_scores import compute_cai, load_demo_data, DEFAULT_WEIGHTS


def get_client():
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print(
            "⚠️  SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset.\n"
            "    Set dulu sebagai environment variable sebelum menjalankan script ini.\n"
            "    Lihat komentar di bagian atas file ini."
        )
        sys.exit(1)
    return create_client(url, key)


def load_weights_from_db(client) -> dict:
    """
    Ambil bobot terbaru dari tabel konfigurasi_bobot (hasil sesi AHP).
    Fallback ke DEFAULT_WEIGHTS kalau tabel masih kosong (belum ada sesi AHP).
    """
    res = client.table("konfigurasi_bobot").select("*").eq("nama_index", "CAI").execute()
    rows = res.data
    if not rows:
        print("Belum ada bobot AHP di database, pakai DEFAULT_WEIGHTS sementara.")
        return DEFAULT_WEIGHTS

    weights = {row["nama_kriteria"]: float(row["bobot"]) for row in rows}
    print(f"Bobot dari konfigurasi_bobot: {weights}")
    return weights


def upload_cai_scores(client, scored_df):
    """
    Push hasil compute_cai() ke tabel skor_cai.
    TODO: sesuaikan mapping kolom begitu titik_kandidat_id asli tersedia
    (saat ini masih placeholder karena data sintetis tidak punya id database).
    """
    records = []
    for _, row in scored_df.iterrows():
        records.append({
            # "titik_kandidat_id": row["id"],   # TODO: aktifkan setelah data asli ada
            "n_kepadatan": round(row["n_kepadatan"], 4),
            "n_jarak_inv": round(row["n_jarak_inv"], 4),
            "n_volume": round(row["n_volume"], 4),
            "n_survei": round(row["n_survei"], 4),
            "skor_final": round(row["skor_cai"], 4),
        })

    result = client.table("skor_cai").insert(records).execute()
    print(f"Berhasil upload {len(records)} baris skor_cai.")
    return result


if __name__ == "__main__":
    client = get_client()
    weights = load_weights_from_db(client)

    # TODO: ganti load_demo_data() dengan load data asli dari data/processed/
    df = load_demo_data()
    scored = compute_cai(df, weights)

    print(scored[["nama_lokasi", "skor_cai"]].round(3).to_string(index=False))
    upload_cai_scores(client, scored)

"""
upload_to_supabase.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Mengunggah hasil compute_scores.py (CAI, TDI, Transit Equity Index) ke
Supabase. Dipakai berulang kali selama periode survei/analisis (7 Agu–6 Sep,
lihat FRAMEWORK_GeoTransitInsight.md Bagian 9), bukan sekali jalan di akhir.

Setup:
    pip install supabase python-dotenv
    export SUPABASE_URL=https://xxxx.supabase.co
    export SUPABASE_SERVICE_ROLE_KEY=xxxx   # BUKAN anon key — ini bypass RLS

    [PERINGATAN] Service role key HANYA untuk script ini (server-side),
    JANGAN PERNAH dimasukkan ke frontend/.env atau ke repository git.

Cara pakai:
    python upload_to_supabase.py

Catatan penting soal TDI & Equity Index (beda dengan CAI):
  - upload_tdi_scores() melakukan UPDATE ke tabel grid_analisis, BUKAN insert
    — kolom geom di tabel itu NOT NULL, jadi grid harus sudah dibuat lebih
    dulu lewat build_fishnet_grid.py (belum ditulis, lihat README "Belum
    dikerjakan"). Script ini hanya mengisi kolom skornya.
  - upload_equity_scores() perlu mencocokkan nama_kelurahan ke kelurahan_id
    di tabel batas_administrasi dulu (lookup_kelurahan_ids), baru insert ke
    skor_equity. Kelurahan yang belum ada di batas_administrasi akan
    dilewati (bukan diupload dengan kelurahan_id kosong) supaya tidak ada
    baris skor_equity yang "menggantung" tanpa referensi wilayah.
  - Selama data grid/kelurahan asli belum ada di database, kedua fungsi ini
    akan melewati (skip) baris demo dan mencetak peringatan — ini SENGAJA,
    bukan bug, supaya tidak ada data sampah yang ter-upload.
"""

import os
import sys
from dotenv import load_dotenv
from supabase import create_client
from compute_scores import (
    compute_cai,
    compute_tdi,
    compute_equity_index,
    load_demo_data,
    load_demo_grid_data,
    load_demo_equity_data,
    DEFAULT_WEIGHTS,
    DEFAULT_MOBILITY_WEIGHTS,
    DEFAULT_EQUITY_WEIGHTS,
)


def get_client():
    load_dotenv()  # baca etl/.env kalau ada — lihat komentar setup di atas
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print(
            "[PERINGATAN] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset.\n"
            "    Set dulu sebagai environment variable sebelum menjalankan script ini.\n"
            "    Lihat komentar di bagian atas file ini."
        )
        sys.exit(1)
    return create_client(url, key)


def load_weights_from_db(client, nama_index: str, default_weights: dict) -> dict:
    """
    Ambil bobot terbaru dari tabel konfigurasi_bobot (hasil sesi AHP) untuk
    index tertentu ('CAI', 'TDI_MOBILITAS', atau 'EQUITY').
    Fallback ke default_weights kalau tabel masih kosong (belum ada sesi AHP).
    """
    res = client.table("konfigurasi_bobot").select("*").eq("nama_index", nama_index).execute()
    rows = res.data
    if not rows:
        print(f"Belum ada bobot AHP untuk '{nama_index}' di database, pakai bobot default sementara.")
        return default_weights

    weights = {row["nama_kriteria"]: float(row["bobot"]) for row in rows}
    print(f"Bobot '{nama_index}' dari konfigurasi_bobot: {weights}")
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


def upload_tdi_scores(client, scored_df):
    """
    Update kolom skor TDI di tabel grid_analisis untuk grid yang sudah ada.

    scored_df wajib punya kolom 'grid_analisis_id' (id asli baris grid_analisis
    di database, BUKAN 'grid_id' string dari data demo) supaya tahu baris mana
    yang harus diupdate — geom grid tidak dibuat ulang di sini, hanya skornya.

    TODO: setelah build_fishnet_grid.py ditulis dan grid_analisis terisi geom,
    hasilkan kolom 'grid_analisis_id' dengan spatial join grid demo/asli ke
    grid_analisis (mis. berdasarkan kolom grid_id yang disimpan bersama geom).
    """
    if "grid_analisis_id" not in scored_df.columns:
        print(
            "[DILEWATI] upload_tdi_scores: kolom 'grid_analisis_id' tidak ada di data — "
            "grid_analisis belum bisa diisi karena geom-nya belum dibuat "
            "(build_fishnet_grid.py belum ada). Jalankan fishnet grid dulu, "
            "lalu petakan grid_id demo/asli ke id baris grid_analisis sebelum upload."
        )
        return None

    updated = 0
    for _, row in scored_df.iterrows():
        result = (
            client.table("grid_analisis")
            .update({
                "kepadatan_penduduk": round(row["kepadatan_penduduk"], 2),
                "indeks_kebutuhan_mobilitas": round(row["indeks_kebutuhan_mobilitas"], 4),
                "skor_aksesibilitas_transit": round(row["skor_aksesibilitas_transit"], 4),
                "skor_tdi": round(row["skor_tdi"], 4),
            })
            .eq("id", row["grid_analisis_id"])
            .execute()
        )
        updated += len(result.data)

    print(f"Berhasil update {updated} dari {len(scored_df)} baris grid_analisis (skor TDI).")
    return updated


def lookup_kelurahan_ids(client, nama_kelurahan_list: list) -> dict:
    """
    Cocokkan nama_kelurahan -> id di tabel batas_administrasi.
    Return dict {nama_kelurahan: id}; nama yang tidak ditemukan tidak ikut
    di dict hasil (ditangani sebagai skip, bukan error, oleh pemanggil).
    """
    res = (
        client.table("batas_administrasi")
        .select("id, nama_kelurahan")
        .in_("nama_kelurahan", nama_kelurahan_list)
        .execute()
    )
    return {row["nama_kelurahan"]: row["id"] for row in res.data}


def upload_equity_scores(client, scored_df):
    """
    Push hasil compute_equity_index() ke tabel skor_equity.
    Mencocokkan nama_kelurahan ke kelurahan_id lebih dulu lewat
    lookup_kelurahan_ids() — kelurahan yang belum ada di batas_administrasi
    dilewati (bukan diupload tanpa kelurahan_id) supaya skor_equity tidak
    punya baris yang tidak bisa ditelusuri ke wilayahnya.
    """
    id_map = lookup_kelurahan_ids(client, scored_df["nama_kelurahan"].tolist())

    records = []
    dilewati = []
    for _, row in scored_df.iterrows():
        kelurahan_id = id_map.get(row["nama_kelurahan"])
        if kelurahan_id is None:
            dilewati.append(row["nama_kelurahan"])
            continue
        records.append({
            "kelurahan_id": kelurahan_id,
            "skor_cai_rata2": round(row["skor_cai_rata2"], 4),
            "n_kepadatan": round(row["n_kepadatan"], 4),
            "n_usia_rentan": round(row["n_usia_rentan"], 4),
            "n_akses_pendidikan": round(row["n_akses_pendidikan"], 4),
            "n_akses_kesehatan": round(row["n_akses_kesehatan"], 4),
            "n_akses_kerja": round(row["n_akses_kerja"], 4),
            "skor_final": round(row["skor_final"], 4),
            "ranking": int(row["ranking"]),
        })

    if dilewati:
        print(
            f"[DILEWATI] {len(dilewati)} kelurahan tidak ditemukan di batas_administrasi, "
            f"tidak diupload: {', '.join(dilewati)}. Pastikan 001_init_tables.sql sudah "
            "diisi data batas administrasi Kota Bekasi sebelum upload equity index."
        )

    if not records:
        print("Tidak ada baris skor_equity yang diupload (semua kelurahan tidak ditemukan).")
        return None

    result = client.table("skor_equity").insert(records).execute()
    print(f"Berhasil upload {len(records)} baris skor_equity.")
    return result


if __name__ == "__main__":
    client = get_client()

    print("=== 1. Composite Accessibility Index (CAI) ===")
    cai_weights = load_weights_from_db(client, "CAI", DEFAULT_WEIGHTS)
    # TODO: ganti load_demo_data() dengan load data asli dari data/processed/
    cai_df = load_demo_data()
    cai_scored = compute_cai(cai_df, cai_weights)
    print(cai_scored[["nama_lokasi", "skor_cai"]].round(3).to_string(index=False))
    upload_cai_scores(client, cai_scored)

    print("\n=== 2. Transit Desert Index (TDI) ===")
    mobility_weights = load_weights_from_db(client, "TDI_MOBILITAS", DEFAULT_MOBILITY_WEIGHTS)
    # TODO: ganti load_demo_grid_data() dengan hasil build_fishnet_grid.py + overlay asli
    tdi_df = load_demo_grid_data()
    tdi_scored = compute_tdi(tdi_df, mobility_weights)
    print(tdi_scored[["nama_area", "skor_tdi"]].round(3).to_string(index=False))
    upload_tdi_scores(client, tdi_scored)

    print("\n=== 3. Transit Equity Index ===")
    equity_weights = load_weights_from_db(client, "EQUITY", DEFAULT_EQUITY_WEIGHTS)
    # TODO: ganti load_demo_equity_data() dengan agregasi skor_cai per kelurahan asli
    equity_df = load_demo_equity_data()
    equity_scored = compute_equity_index(equity_df, equity_weights)
    print(equity_scored[["ranking", "nama_kelurahan", "skor_final"]].round(3).to_string(index=False))
    upload_equity_scores(client, equity_scored)

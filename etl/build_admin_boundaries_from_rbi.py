"""
build_admin_boundaries_from_rbi.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Baca poligon kecamatan & kelurahan Kota Bekasi dari geodatabase RBI 25K
resmi BIG (tanahair.indonesia.go.id, `2022_RBI25K_KAB_BEKASI_KUGI50_20221231.gdb`)
dan upload ke tabel `batas_administrasi` di Supabase — menggantikan kebutuhan
bounding box dummy (006_seed_dummy_data.sql) sebagai "Fondasi spasial semua
tabel" (lihat docs/DATA_CHECKLIST.md Kategori B).

Layer yang dipakai (nama "KAB BEKASI" pada file .gdb menyesatkan — layer
administrasinya mencakup Kota Bekasi LENGKAP, sudah diverifikasi manual
27 Agu 2026 lewat sanity check luas 213,1 km² vs BPS ~210,5 km²):
  - ADMINISTRASI_AR_KECAMATAN, filter WADMKK == 'Kota Bekasi' -> 12 baris
    (dipakai HANYA untuk sanity check jumlah kecamatan, TIDAK diupload
    sebagai poligon terpisah -- skema batas_administrasi hanya punya satu
    kolom geom per KELURAHAN, dengan nama_kecamatan sebagai atribut teks;
    lihat 001_init_tables.sql, tidak diubah oleh script ini)
  - ADMINISTRASI_AR_DESAKEL, filter WADMKK == 'Kota Bekasi' -> 56 baris
    (kecamatan induk dari kolom WADMKC, nama kelurahan dari kolom NAMOBJ)

CRS: gdb pakai COMPD_CS (WGS84 horizontal + EGM2008 height, 3D). Komponen
horizontal SUDAH EPSG:4326 murni -- tidak perlu reproject koordinat, hanya
perlu DROP dimensi Z (force_2d) dan override metadata CRS supaya jadi
EPSG:4326 2D murni sebelum masuk kolom `geometry(Polygon, 4326)` di
PostGIS (kolom itu 2D, insert geometry 3D akan ditolak Postgres).

Tipe geometry: layer sumbernya MultiPolygon (walau tiap kelurahan Kota
Bekasi kebetulan cuma 1 part -- dicek eksplisit di bawah, BUKAN diasumsikan)
sedangkan skema batas_administrasi mendeklarasikan `geometry(Polygon, 4326)`
(tunggal, dari 001_init_tables.sql, tidak diubah script ini). Untuk baris
yang punya >1 part, script BERHENTI dengan error jelas alih-alih diam-diam
memotong sebagian poligon (lihat assert_single_part()) -- kalau ini pernah
terjadi di re-run mendatang (mis. sumber data RBI versi lain), keputusan
ubah skema ke MultiPolygon harus diambil sadar, bukan otomatis oleh script.

Strategi migrasi vs data dummy 006_seed_dummy_data.sql (lihat laporan kerja
untuk detail lengkap): ADDITIVE, bukan replace/delete.
  - Dicek manual: TIDAK ADA collision nama_kelurahan exact antara 6 baris
    dummy ('Mustika Jaya', 'Bantar Gebang', 'Rawa Lumbu', 'Bekasi Utara',
    'Marga Mulya', 'Bekasi Timur' -- ejaan longgar pakai spasi) dengan 56
    baris resmi RBI (ejaan BIG tanpa spasi: 'Mustikajaya', 'Bantargebang',
    'Rawalumbu', 'Margamulya'; 'Bekasi Utara'/'Bekasi Timur' di data resmi
    HANYA muncul sebagai nama KECAMATAN, bukan nama kelurahan mana pun).
  - penduduk (24 baris) & skor_equity (5 baris) di database SAAT INI masih
    100% FK ke 6 baris dummy itu (ON DELETE CASCADE) DAN masih dipakai utk
    testing RPC simulate_new_stop() + demo Equity Dashboard (acceptance
    criteria PRD Bab 8 "ranking minimal 5 kelurahan") sampai data
    penduduk BPS asli + bobot AHP final tersedia (docs/DATA_CHECKLIST.md
    Kategori B & D masih terbuka). REPLACE (delete 6 baris dummy) akan
    men-cascade-hapus 29 baris itu dan membuat 2 fitur itu kembali ke
    0 hasil/kosong SEKARANG, padahal tidak ada data pengganti yang siap.
  - Karena tidak ada collision nama, aman untuk INSERT 56 baris resmi
    BERDAMPINGAN dengan 6 baris dummy (skor_cai_rata2/penduduk/skor_equity
    milik dummy TIDAK disentuh) -- pola yang sama dipakai
    fetch_upload_osm_poi.py (poi dummy & poi OSM hidup berdampingan,
    dibedakan lewat kolom `sumber`; lihat migration baru
    008_batas_administrasi_sumber.sql yang menambah kolom sumber yang
    sama untuk batas_administrasi supaya keduanya bisa dibedakan).
  - Konsekuensi: sampai ada keputusan/replace eksplisit di kemudian hari,
    query `select * from batas_administrasi` akan mengembalikan 62 baris
    (56 resmi + 6 dummy). Kode mana pun yang MENGASUMSIKAN semua baris
    adalah kelurahan resmi (mis. filter kecamatan untuk Peta Multi-Layer
    Gap Analysis) sebaiknya nge-filter `sumber` ini, atau tim memutuskan
    kapan 6 baris dummy dihapus manual setelah penduduk/skor_equity asli
    menggantikannya (bukan tanggung jawab script ini).

File sumber .gdb TIDAK di-commit ke repo (35MB, dan `*.geojson`/`data/raw/`
sudah di-gitignore) -- taruh salinannya di etl/data/raw/rbi25k/ (path itu
otomatis di-gitignore lewat pola `data/raw/` di .gitignore) supaya re-run
di masa depan tidak bergantung pada folder scratchpad sesi ini yang akan
hilang. Path bisa juga dioverride lewat argumen CLI atau env var
RBI_GDB_PATH.

Cara pakai:
    python build_admin_boundaries_from_rbi.py                # dry-run: baca, proses, print preview, TIDAK upload
    python build_admin_boundaries_from_rbi.py --upload        # proses + upload ke batas_administrasi (additive, idempotent)
    python build_admin_boundaries_from_rbi.py --gdb "path\\ke\\file.gdb" --upload
"""

import argparse
import os
import sys

import geopandas as gpd

# Default lokasi lokal yang direkomendasikan untuk copy .gdb (gitignored
# lewat pola `data/raw/` di .gitignore) -- dicek PERTAMA supaya re-run di
# sesi mendatang tidak bergantung pada scratchpad sesi ini.
DEFAULT_LOCAL_GDB_PATH = os.path.join(
    os.path.dirname(__file__), "data", "raw", "rbi25k",
    "2022_RBI25K_KAB_BEKASI_KUGI50_20221231.gdb",
)

# Path scratchpad sesi 27 Agu 2026 -- FALLBACK KEDUA, HANYA valid selama
# sesi Claude Code itu berjalan (folder Temp, akan dibersihkan/hilang).
# Kalau kamu membaca ini di sesi lain dan path ini sudah tidak ada, copy
# .gdb ke DEFAULT_LOCAL_GDB_PATH di atas atau pakai --gdb / env RBI_GDB_PATH.
FALLBACK_SESSION_GDB_PATH = (
    r"C:\Users\Agentsae\AppData\Local\Temp\claude\C--Users-Agentsae-mbg-webgis"
    r"\b8671aec-b1ae-4871-a267-49b9d973b10b\scratchpad\bekasi_data\KAB BEKASI"
    r"\2022_RBI25K_KAB_BEKASI_KUGI50_20221231.gdb"
)

LAYER_KECAMATAN = "ADMINISTRASI_AR_KECAMATAN"
LAYER_KELURAHAN = "ADMINISTRASI_AR_DESAKEL"
FILTER_KABKOTA = "Kota Bekasi"

SUMBER_LABEL = "BIG RBI 25K KUGI50 2022-12-31 (tanahair.indonesia.go.id)"

# Angka pembanding sanity check (docs/DATA_CHECKLIST.md, dicatat 27 Agu 2026):
# BPS Kota Bekasi Dalam Angka melaporkan luas ~210,5 km^2. RBI 25K (skala
# peta topografi, bukan sensus) dilaporkan 213,1 km^2 di verifikasi manual
# sebelumnya -- dianggap valid/cocok (selisih ~1,2%, wajar utk perbedaan
# metode/generalisasi kartografis). Estimasi luas DI SCRIPT INI dihitung
# ulang independen (EPSG:3857) sebagai cross-check kedua, BUKAN pengganti
# perhitungan geodetik yang lebih akurat.
BPS_LUAS_KOTA_BEKASI_KM2 = 210.5


def resolve_gdb_path(cli_arg: str | None) -> str:
    if cli_arg:
        return cli_arg
    env_path = os.environ.get("RBI_GDB_PATH")
    if env_path:
        return env_path
    if os.path.exists(DEFAULT_LOCAL_GDB_PATH):
        return DEFAULT_LOCAL_GDB_PATH
    if os.path.exists(FALLBACK_SESSION_GDB_PATH):
        print(
            f"[PERINGATAN] Memakai path scratchpad sesi (sementara): {FALLBACK_SESSION_GDB_PATH}\n"
            f"    Copy file .gdb ke '{DEFAULT_LOCAL_GDB_PATH}' (gitignored) untuk re-run di sesi lain."
        )
        return FALLBACK_SESSION_GDB_PATH
    print(
        "[ERROR] File .gdb tidak ditemukan di path default maupun fallback.\n"
        f"    Coba: --gdb <path>, atau set env RBI_GDB_PATH, atau taruh file di:\n"
        f"    {DEFAULT_LOCAL_GDB_PATH}"
    )
    sys.exit(1)


def assert_single_part(gdf: gpd.GeoDataFrame, label_col: str) -> None:
    """Berhenti dengan error jelas kalau ada MultiPolygon dengan >1 part --
    lihat penjelasan panjang di docstring modul soal kenapa TIDAK diam-diam
    memotong sebagian poligon."""
    n_parts = gdf.geometry.apply(lambda g: len(g.geoms) if g.geom_type == "MultiPolygon" else 1)
    bermasalah = gdf[n_parts > 1]
    if not bermasalah.empty:
        print("[ERROR] Ditemukan baris dengan >1 part poligon (MultiPolygon asli, bukan single-part):")
        for _, row in bermasalah.iterrows():
            print(f"    - {row[label_col]}: {n_parts[row.name]} part")
        print(
            "    Skema batas_administrasi.geom saat ini geometry(Polygon, 4326) TUNGGAL.\n"
            "    Perlu keputusan sadar: ubah skema ke MultiPolygon, atau simpan tiap part\n"
            "    sebagai baris terpisah. Script berhenti, TIDAK memotong data secara diam-diam."
        )
        sys.exit(1)


def load_kecamatan(gdb_path: str) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(gdb_path, layer=LAYER_KECAMATAN)
    return gdf[gdf["WADMKK"] == FILTER_KABKOTA].copy()


def load_kelurahan(gdb_path: str) -> gpd.GeoDataFrame:
    gdf = gpd.read_file(gdb_path, layer=LAYER_KELURAHAN)
    kel = gdf[gdf["WADMKK"] == FILTER_KABKOTA].copy()

    # Drop dimensi Z (EGM2008 height) -- kolom PostGIS 2D tidak menerima geometry 3D.
    kel["geometry"] = kel.geometry.force_2d()

    assert_single_part(kel, label_col="NAMOBJ")

    # Semua baris sudah dipastikan 1 part (assert di atas) -> aman ambil part
    # pertama sebagai Polygon tunggal, sesuai skema geometry(Polygon, 4326).
    kel["geometry"] = kel.geometry.apply(
        lambda g: g.geoms[0] if g.geom_type == "MultiPolygon" else g
    )

    # Override metadata CRS ke EPSG:4326 2D murni (drop komponen vertical
    # datum COMPD_CS) -- TIDAK reproject koordinat, karena komponen
    # horizontal gdb sumber sudah WGS84/EPSG:4326.
    kel = kel.set_crs(epsg=4326, allow_override=True)

    return kel


def sanity_check(kecamatan: gpd.GeoDataFrame, kelurahan: gpd.GeoDataFrame) -> None:
    print(f"[CEK] Kecamatan (layer {LAYER_KECAMATAN}, filter '{FILTER_KABKOTA}'): {len(kecamatan)} baris")
    print(f"[CEK] Kelurahan (layer {LAYER_KELURAHAN}, filter '{FILTER_KABKOTA}'): {len(kelurahan)} baris")

    if len(kecamatan) != 12:
        print(f"[PERINGATAN] Diharapkan 12 kecamatan, ditemukan {len(kecamatan)}.")
    if len(kelurahan) != 56:
        print(f"[PERINGATAN] Diharapkan 56 kelurahan, ditemukan {len(kelurahan)}.")

    nama_kec_dari_kelurahan = set(kelurahan["WADMKC"].unique())
    nama_kec_dari_layer_kec = set(kecamatan["NAMOBJ"].unique())
    if nama_kec_dari_kelurahan != nama_kec_dari_layer_kec:
        print(
            "[PERINGATAN] Nama kecamatan di layer KECAMATAN vs kolom WADMKC di layer "
            "DESAKEL tidak identik:\n"
            f"    Hanya di layer kecamatan: {nama_kec_dari_layer_kec - nama_kec_dari_kelurahan}\n"
            f"    Hanya di WADMKC kelurahan: {nama_kec_dari_kelurahan - nama_kec_dari_layer_kec}"
        )
    else:
        print(f"[CEK] {len(nama_kec_dari_kelurahan)} nama kecamatan konsisten antara kedua layer. OK.")

    # Cross-check luas total (EPSG:3857 -- Web Mercator, BUKAN equal-area,
    # sedikit over-estimate pada lintang Bekasi; dipakai sebagai orde-besaran
    # sanity check kedua, bukan angka final presisi).
    luas_km2 = kelurahan.to_crs(epsg=3857).geometry.area.sum() / 1e6
    selisih_persen = abs(luas_km2 - BPS_LUAS_KOTA_BEKASI_KM2) / BPS_LUAS_KOTA_BEKASI_KM2 * 100
    print(
        f"[CEK] Total luas 56 kelurahan (estimasi EPSG:3857): {luas_km2:.1f} km^2 "
        f"vs BPS ~{BPS_LUAS_KOTA_BEKASI_KM2} km^2 (selisih {selisih_persen:.1f}%)."
    )
    if selisih_persen > 10:
        print("[PERINGATAN] Selisih luas > 10% -- cek ulang filter/layer sebelum upload.")

    dup = kelurahan[kelurahan.duplicated(subset=["NAMOBJ"], keep=False)]
    if not dup.empty:
        print(f"[PERINGATAN] {len(dup)} baris kelurahan punya NAMOBJ duplikat dalam data resmi itu sendiri:")
        for _, row in dup.iterrows():
            print(f"    - {row['WADMKC']} / {row['NAMOBJ']}")


def build_records(kelurahan: gpd.GeoDataFrame) -> list:
    records = []
    for _, row in kelurahan.iterrows():
        records.append({
            "nama_kecamatan": row["WADMKC"],
            "nama_kelurahan": row["NAMOBJ"],
            "geom": f"SRID=4326;{row.geometry.wkt}",
            "sumber": SUMBER_LABEL,
        })
    return records


def get_existing_official_keys(client) -> set:
    """(nama_kecamatan, nama_kelurahan) yang sudah ber-sumber SUMBER_LABEL di
    database -> dipakai supaya script aman dijalankan berulang kali (re-run
    setelah RBI versi lain / koreksi) tanpa membuat duplikat. TIDAK menyentuh
    6 baris dummy sama sekali (dummy tidak pernah punya sumber ini)."""
    res = client.table("batas_administrasi").select("nama_kecamatan, nama_kelurahan").eq("sumber", SUMBER_LABEL).execute()
    return {(r["nama_kecamatan"], r["nama_kelurahan"]) for r in res.data}


def upload_records(records: list) -> int:
    from dotenv import load_dotenv
    from supabase import create_client

    load_dotenv(os.path.join(os.path.dirname(__file__), ".env"))
    url = os.environ.get("SUPABASE_URL")
    key = os.environ.get("SUPABASE_SERVICE_ROLE_KEY")
    if not url or not key:
        print("[ERROR] SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY belum diset (etl/.env).")
        sys.exit(1)
    client = create_client(url, key)

    existing = get_existing_official_keys(client)
    print(f"[INFO] {len(existing)} baris resmi (sumber='{SUMBER_LABEL}') sudah ada di database.")

    to_insert = [r for r in records if (r["nama_kecamatan"], r["nama_kelurahan"]) not in existing]
    skipped = len(records) - len(to_insert)
    if skipped:
        print(f"[INFO] {skipped} baris dilewati (sudah ada, idempotent re-run).")

    if not to_insert:
        print("[INFO] Tidak ada baris baru untuk diupload.")
        return 0

    CHUNK = 20  # poligon kelurahan lumayan besar (WKT panjang), chunk kecil supaya payload aman
    total = 0
    for i in range(0, len(to_insert), CHUNK):
        chunk = to_insert[i:i + CHUNK]
        client.table("batas_administrasi").insert(chunk).execute()
        total += len(chunk)
        print(f"[UPLOAD] {total}/{len(to_insert)} baris terupload...")

    return total


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--gdb", default=None, help="Path ke file .gdb (override DEFAULT_LOCAL_GDB_PATH/RBI_GDB_PATH)")
    parser.add_argument("--upload", action="store_true", help="Upload ke Supabase (default: dry-run, hanya print preview)")
    args = parser.parse_args()

    gdb_path = resolve_gdb_path(args.gdb)
    print(f"[INFO] Membaca .gdb dari: {gdb_path}")

    kecamatan = load_kecamatan(gdb_path)
    kelurahan = load_kelurahan(gdb_path)

    sanity_check(kecamatan, kelurahan)

    records = build_records(kelurahan)

    print(f"\n[PREVIEW] {len(records)} record siap diupload ke batas_administrasi (sumber='{SUMBER_LABEL}'):")
    preview = sorted(records, key=lambda r: (r["nama_kecamatan"], r["nama_kelurahan"]))
    for r in preview[:10]:
        print(f"    {r['nama_kecamatan']:15s} | {r['nama_kelurahan']:20s} | geom {len(r['geom'])} char")
    if len(preview) > 10:
        print(f"    ... dan {len(preview) - 10} baris lainnya")

    if not args.upload:
        print(
            "\n[DRY-RUN] Tidak ada yang diupload. Jalankan ulang dengan --upload untuk "
            "benar-benar menulis ke tabel batas_administrasi (additive, idempotent, "
            "TIDAK menyentuh 6 baris dummy -- lihat docstring modul untuk strategi migrasi)."
        )
        return

    n = upload_records(records)
    print(f"\n[SELESAI] {n} baris batas_administrasi baru (data resmi RBI 25K) berhasil diupload.")


if __name__ == "__main__":
    main()

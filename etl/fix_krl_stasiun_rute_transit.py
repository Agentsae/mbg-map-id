"""
fix_krl_stasiun_rute_transit.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Perbaiki titik stasiun KRL di tabel `rute_transit_eksisting`
(jenis='krl', tipe_geometri='point').

MASALAH (diverifikasi 2026-09-07):
  Hanya ADA 1 baris jenis='krl'/tipe_geometri='point', kolom `nama` KOSONG
  (spasi), koordinat [106.9520, -6.2192] — ujung barat trace jalur KRL,
  ~3,3 km dari Stasiun Cakung, ~2 km dari Stasiun Kranji, TIDAK di peron
  mana pun. Di peta muncul sebagai titik biru nyasar tanpa nama dekat
  Cakung. Popup frontend jatuh ke teks generik "Stasiun KRL Commuter Line".

PENYEBAB: build_rute_transit_eksisting.py membaca STASIUNKA_PT_25K dari RBI
25K .gdb lalu clip `stasiun.geometry.within(boundary_union)` — dengan batas
RBI yang disederhanakan, hanya 1 titik lolos, dan NAMOBJ-nya kosong.
Stasiun Bekasi, Bekasi Timur, Kranji (disebut di PRD) hilang.

PERBAIKAN DI SINI: .gdb RBI 25K tidak tersedia di environment ini (path
default & fallback tidak resolve), jadi 3 stasiun KRL Commuter Line
(Lin/Line Cikarang) di dalam Kota Bekasi ditambahkan manual dengan nama +
koordinat referensi publik, dan SEMUA baris krl/point lama (titik nyasar
tanpa nama) DIHAPUS. Baris jenis='krl'/tipe_geometri='line' (13 ruas rel)
TIDAK disentuh.

Cakung SENGAJA tidak dimasukkan — verifikasi point-in-polygon menunjukkan
titik itu ~2,7 km di LUAR batas 56 kelurahan Kota Bekasi (ada di Jakarta
Timur).

Layer ini konteks/rujukan peta saja — TIDAK memberi input ke skor CAI/TDI/
Equity, jadi tidak ada recompute skor.

Idempotent: DELETE semua krl/point lalu INSERT 3 — aman dijalankan ulang
(mis. sesudah build_rute_transit_eksisting.py di-rerun dengan .gdb asli
yang mungkin masih memproduksi titik nyasar tsb).

Cara pakai:
    python fix_krl_stasiun_rute_transit.py            # dry-run: print rencana, TIDAK menulis
    python fix_krl_stasiun_rute_transit.py --upload    # terapkan ke rute_transit_eksisting
"""

import argparse

from upload_to_supabase import get_client

SUMBER_STASIUN = (
    "Koordinat manual referensi publik (OpenStreetMap / PT KAI Commuter) — "
    "titik stasiun KRL Commuter Line Lin Cikarang di dalam Kota Bekasi. "
    "STASIUNKA_PT_25K RBI 25K hanya meloloskan 1 titik tanpa NAMOBJ saat "
    "clip 'within' batas kota (build_rute_transit_eksisting.py), sehingga 3 "
    "stasiun in-city ditambahkan manual di fix_krl_stasiun_rute_transit.py."
)
CATATAN_STASIUN = (
    "Stasiun KRL Commuter Line eksisting (Lin Cikarang). BELUM disurvei "
    "lapangan oleh tim (beda dengan halte BisKita) — atribut headway/"
    "okupansi/kondisi fisik tidak tersedia untuk moda ini. Koordinat "
    "pendekatan dari peta publik, bukan GPS survei. Layer konteks peta, "
    "tidak dipakai untuk skoring CAI/TDI/Equity."
)

# nama, (lon, lat) — koordinat peron referensi publik, sudah dicek
# point-in-polygon jatuh di dalam union 56 kelurahan RBI Kota Bekasi.
STASIUN_KRL_KOTA_BEKASI = [
    ("Stasiun Bekasi", (106.9928, -6.2394)),
    ("Stasiun Bekasi Timur", (107.0181, -6.2469)),
    ("Stasiun Kranji", (106.9707, -6.2197)),
]


def build_records() -> list:
    return [
        {
            "nama": nama,
            "jenis": "krl",
            "tipe_geometri": "point",
            "geom": f"SRID=4326;POINT({lon} {lat})",
            "sumber": SUMBER_STASIUN,
            "catatan": CATATAN_STASIUN,
        }
        for nama, (lon, lat) in STASIUN_KRL_KOTA_BEKASI
    ]


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--upload", action="store_true", help="Terapkan ke DB (default: dry-run)")
    args = parser.parse_args()

    client = get_client()

    existing = (
        client.table("rute_transit_eksisting")
        .select("id, nama, jenis, tipe_geometri, geom")
        .eq("jenis", "krl")
        .execute()
        .data
    )
    pts = [r for r in existing if r["tipe_geometri"] == "point"]
    lines = [r for r in existing if r["tipe_geometri"] == "line"]

    print("=== SEBELUM ===")
    print(f"krl/line : {len(lines)} baris (TIDAK disentuh)")
    print(f"krl/point: {len(pts)} baris ->")
    for r in pts:
        g = r["geom"]
        coords = g["coordinates"] if isinstance(g, dict) and g.get("type") == "Point" else g
        print(f"  id={r['id']} nama={r['nama']!r} coord={coords}")

    records = build_records()
    print("\n=== RENCANA ===")
    print(f"DELETE {len(pts)} baris krl/point lama, INSERT {len(records)} baris baru:")
    for rec in records:
        print(f"  {rec['nama']!r:<26} {rec['geom']}")

    if not args.upload:
        print("\n[DRY-RUN] --upload tidak diberikan, TIDAK ada perubahan ditulis.")
        raise SystemExit(0)

    del_res = client.table("rute_transit_eksisting").delete().eq("jenis", "krl").eq("tipe_geometri", "point").execute()
    print(f"\n[APPLY] DELETE krl/point: {len(del_res.data)} baris terhapus.")
    ins_res = client.table("rute_transit_eksisting").insert(records).execute()
    print(f"[APPLY] INSERT krl/point: {len(ins_res.data)} baris.")

    after = (
        client.table("rute_transit_eksisting")
        .select("id, nama, tipe_geometri, geom")
        .eq("jenis", "krl")
        .eq("tipe_geometri", "point")
        .execute()
        .data
    )
    print("\n=== SESUDAH (krl/point) ===")
    for r in after:
        g = r["geom"]
        coords = g["coordinates"] if isinstance(g, dict) and g.get("type") == "Point" else g
        print(f"  id={r['id']} nama={r['nama']!r} coord={coords}")
    lines_after = (
        client.table("rute_transit_eksisting").select("id").eq("jenis", "krl").eq("tipe_geometri", "line").execute().data
    )
    print(f"krl/line masih: {len(lines_after)} baris (harus tetap {len(lines)}).")

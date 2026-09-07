"""
upload_titik_kandidat_from_survey.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Entry-point RESMI untuk memuat sheet "Form Traffic Counting" dari instrumen
survei ke tabel `titik_kandidat`. Sebelumnya fungsi `load_traffic_counting_excel()`
+ `upload_titik_kandidat_data()` ada di upload_to_supabase.py tapi tidak pernah
di-wire ke __main__ mana pun (upload batch pertama KND-002..009 dilakukan ad-hoc
26 Agu). File ini menutup celah itu — sejajar dengan load_penduduk.py.

Alur setelah script ini (WAJIB, urutan tidak boleh dibalik — lihat
docs/DATA_CHECKLIST.md "Cara re-run"):
    python etl/upload_titik_kandidat_from_survey.py --upload
    python etl/attach_kepadatan_titik_kandidat.py --upload      # spatial join + recompute skor_cai
    python etl/aggregate_equity_kelurahan.py --upload           # equity bergantung skor_cai

Idempotent: upsert on_conflict='id_titik_survei'. Baris 3 sheet (KND-001) tetap
diperlakukan sebagai CONTOH oleh load_traffic_counting_excel() (row_num mulai 4) —
keputusan tim 2026-08-29: KND-001 tidak dimasukkan.

Cara pakai:
    python etl/upload_titik_kandidat_from_survey.py            # dry-run: print saja
    python etl/upload_titik_kandidat_from_survey.py --upload   # tulis ke Supabase
"""

import argparse
import sys

from upload_to_supabase import (
    get_client,
    load_traffic_counting_excel,
    upload_titik_kandidat_data,
)

DEFAULT_XLSX = "data/survei/Instrumen_Survei_GeoTransitInsight_Final.xlsx"


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--excel", default=DEFAULT_XLSX, help=f"path file instrumen survei (default: {DEFAULT_XLSX})")
    parser.add_argument("--upload", action="store_true", help="tulis ke titik_kandidat (default: dry-run)")
    args = parser.parse_args()

    records = load_traffic_counting_excel(args.excel)
    if not records:
        print("Tidak ada baris terbaca — berhenti.")
        return

    print(f"\n=== {len(records)} baris siap upsert ke titik_kandidat ===")
    for r in records:
        print(
            f"  {r['id_titik_survei']:>8}  {str(r['kecamatan']):<16} {str(r['kelurahan']):<16} "
            f"{r['geom']:<34} total_aktivitas={r['total_aktivitas']:>4}  "
            f"jarak_transit={r['jarak_transit_terdekat_m']}"
        )

    ids = [r["id_titik_survei"] for r in records]
    dupes = {i for i in ids if ids.count(i) > 1}
    if dupes:
        sys.exit(f"[GAGAL] ID duplikat di sheet: {sorted(dupes)} — perbaiki file sumber dulu.")
    if any(i.startswith("KND-DEMO") for i in ids):
        sys.exit("[GAGAL] ada baris KND-DEMO di sheet survei — tidak diharapkan.")

    if not args.upload:
        print("\n[DRY-RUN] --upload tidak diberikan, TIDAK ada yang ditulis ke Supabase.")
        return

    client = get_client()
    upload_titik_kandidat_data(client, records)
    print("\nSelesai. Lanjutkan dengan attach_kepadatan_titik_kandidat.py --upload lalu aggregate_equity_kelurahan.py --upload.")


if __name__ == "__main__":
    main()

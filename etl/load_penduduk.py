"""
load_penduduk.py — GeoTransit Insight
Tim MBG — MAPID WebGIS Competition 2026

Baca data kependudukan (jumlah + struktur usia) per kelurahan dari file
master Excel DKB (Data Konsolidasi Bersih) Semester I 2026, gabungkan
dengan tabel batas_administrasi (kelurahan_id) yang sudah ter-upload dari
RBI BIG, lalu upload ke tabel `penduduk` di Supabase.

Struktur usia yang diturunkan dari sheet JUMDUK_KELUMUR:
  - proporsi_balita        pita 00-04
  - proporsi_lansia        pita 65-69 + 70-74 + >75 (lansia BPS: 65+)
  - proporsi_usia_sekolah  pita 05-09 + 10-14 + 15-19 (umur 5–19, proksi
                           jenjang SD–SMA / populasi di bawah usia mengemudi
                           yang transit-dependent) — komponen ketiga Indeks
                           Kebutuhan Mobilitas TDI, kolom baru dari migration
                           026_tdi_mobilitas_usia_sekolah.sql (keputusan tim
                           2026-09-06, menggantikan 'tanpa_kendaraan').

Sumber: DAK_SEMESTER_1_TAHUN_2026_REV01.xlsx — DKB (Data Konsolidasi
Bersih) Semester I 2026, terbitan Ditjen Dukcapil Kemendagri (instansi
pusat; PRD final Bab 1.1). File di-retrieve lewat portal
disdukcapil.bekasikota.go.id, tetapi datasetnya adalah DKB nasional, bukan
produk dinas kota — atribusi kanonik tim = "DKB Semester I 2026 — Ditjen
Dukcapil Kemendagri" (keputusan penyeragaman 2026-08-28, lihat CLAUDE.md).

CATATAN: tim memutuskan (2026-08-28) menyeragamkan seluruh angka profil
Kota Bekasi ke DKB Semester I 2026 (2.607.248 jiwa) — menggantikan DKB
Semester II 2025 (2.595.927 jiwa) yang dikutip proposal awal. Selisih
0,44% tidak material; PRD Bab 1 sudah diperbarui, errata dicatat di
laporan akhir. Sumber kebenaran tunggal: etl/data/demografi/profil_kota_kanonik.json.

Pola koneksi Supabase (SENGAJA disamakan dgn upload_to_supabase.py — pakai
supabase-py + SUPABASE_URL/SUPABASE_SERVICE_ROLE_KEY dari etl/.env, BUKAN
psycopg2/DATABASE_URL seperti draft awal script ini — supaya tidak perlu
secret koneksi database baru dan konsisten dengan seluruh ETL lain di repo
ini). Matching nama kelurahan dilakukan di Python (fetch semua baris
batas_administrasi ber-sumber RBI sekali, lalu bandingkan case-insensitive
secara lokal) — bukan satu query per baris seperti draft awal, supaya lebih
cepat dan tidak membombardir Supabase dengan puluhan round-trip kecil.

Setup:
    pip install openpyxl supabase python-dotenv
    (baca SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY dari etl/.env otomatis)

Cara pakai:
    python load_penduduk.py --excel data/demografi/DAK_SEMESTER_1_TAHUN_2026_REV01.xlsx --dry-run
    python load_penduduk.py --excel data/demografi/DAK_SEMESTER_1_TAHUN_2026_REV01.xlsx
    # setelah migration 026 (kolom proporsi_usia_sekolah sudah ada, 56 baris
    # penduduk sudah terisi) — isi kolom baru tanpa insert dobel:
    python load_penduduk.py --excel data/demografi/DAK_SEMESTER_1_TAHUN_2026_REV01.xlsx --update-existing
"""

import argparse
import sys

import openpyxl

from upload_to_supabase import get_client

# Definisi "usia rentan" sesuai proposal Bab 7d: "lansia dan balita" —
# BUKAN pakai kategori USIA_MUDA (0-14) yang lebih luas dari sheet
# PRODUKTIF_NON. Balita = pita usia 00-04. Lansia = gabungan tiga pita
# 65-69 + 70-74 + >75 (definisi lansia BPS: 65 tahun ke atas).
BALITA_BAND = "00-04"
LANSIA_BANDS = ["65-69", "70-74", ">75"]

# Definisi "usia sekolah" (keputusan tim 2026-09-06, Opsi 2): proporsi
# penduduk umur 5–19 = gabungan pita 05-09 + 10-14 + 15-19 dari sheet
# JUMDUK_KELUMUR. Proksi populasi jenjang SD–SMA yang berada DI BAWAH usia
# mengemudi dan transit-dependent (trip harian rutin ke sekolah) —
# komponen ketiga Indeks Kebutuhan Mobilitas (TDI), menggantikan
# 'tanpa_kendaraan' yang tidak tersedia pada resolusi spasial. TIDAK
# overlap dengan "usia rentan" (lansia 65+ + balita 0–4). Sumber sama:
# DKB Semester I 2026 — Ditjen Dukcapil Kemendagri. Lihat migration
# 026_tdi_mobilitas_usia_sekolah.sql + docs/VALIDASI_BOBOT_AHP.md.
USIA_SEKOLAH_BANDS = ["05-09", "10-14", "15-19"]

# Nilai kolom `sumber` yang ditulis ke tabel penduduk untuk baris hasil
# script ini — dipakai juga sebagai kunci idempotency guard di upload().
# NB: mengubah string ini mengubah apa yang ditulis upload berikutnya ke
# kolom penduduk.sumber; baris `penduduk` yang sudah ada di DB masih
# memakai label lama "Disdukcapil Kota Bekasi - DKB Semester 1 2026" dan
# perlu migration relabel terpisah (tugas data-ai-analyst).
SUMBER_LABEL = "DKB Semester I 2026 - Ditjen Dukcapil Kemendagri"

# batas_administrasi.sumber untuk 56 kelurahan RBI asli (lihat
# 008_batas_administrasi_sumber.sql) — kelurahan_id HARUS dicocokkan ke
# baris berlabel ini, BUKAN ke 6 baris dummy lama ('DATA SINTETIS...'),
# meski secara nama tidak ada collision (dicek manual, lihat docs/DATA_CHECKLIST.md).
SUMBER_BATAS_ADMINISTRASI_RBI = "BIG RBI 25K KUGI50 2022-12-31 (tanahair.indonesia.go.id)"


def normalize_kode(raw) -> str:
    """'32.75.01.1001' -> '3275011001'; '32.75' -> '3275'."""
    return str(raw).replace(".", "").replace(" ", "")


def read_jumduk(wb) -> dict:
    """Return {kode_10digit: {nama_kecamatan, nama_kelurahan, jumlah_penduduk}}."""
    ws = wb["JUMDUK"]
    out = {}
    for row in ws.iter_rows(min_row=5, max_row=ws.max_row, min_col=2, max_col=8, values_only=True):
        nokec, no_kel, nama_kec, nama_kel, laki, perempuan, jumlah = row
        if nama_kel is None or nokec is None or no_kel is None:
            continue  # baris subtotal kecamatan atau baris kosong, lewati
        kode = f"3275{int(nokec):02d}{int(no_kel)}"
        out[kode] = {"nama_kelurahan": nama_kel.strip(), "jumlah_penduduk": int(jumlah)}
    return out


def read_kecamatan_lookup(wb) -> dict:
    """Return {kode_10digit_kelurahan: nama_kecamatan}, dari sheet PRODUKTIF_NON
    yang punya kode kecamatan (6 digit) dgn nama eksplisit, dipetakan ke
    tiap kelurahan (10 digit) di bawahnya berdasarkan urutan baris."""
    ws = wb["PRODUKTIF_NON"]
    out = {}
    current_kec_name = None
    for row in ws.iter_rows(min_row=5, max_row=ws.max_row, min_col=1, max_col=5, values_only=True):
        kode, wilayah, usia_muda, usia_produktif, usia_tua = row
        if kode is None:
            continue
        kode = str(kode)
        if len(kode) == 4:  # '3275' -> level kota, lewati
            continue
        elif len(kode) == 6:  # level kecamatan, mis. '327501'
            current_kec_name = wilayah
        elif len(kode) == 10:  # level kelurahan
            out[kode] = current_kec_name
    return out


def read_produktif_non(wb) -> dict:
    """Return {kode_10digit: {usia_muda, usia_produktif, usia_tua}} — dipakai
    untuk validasi silang (jumlah total harus cocok dengan sheet JUMDUK)."""
    ws = wb["PRODUKTIF_NON"]
    out = {}
    for row in ws.iter_rows(min_row=5, max_row=ws.max_row, min_col=1, max_col=5, values_only=True):
        kode, wilayah, usia_muda, usia_produktif, usia_tua = row
        if kode is None or len(str(kode)) != 10:
            continue
        out[str(kode)] = {
            "usia_muda": int(usia_muda), "usia_produktif": int(usia_produktif), "usia_tua": int(usia_tua)
        }
    return out


def read_kelompok_umur(wb) -> dict:
    """Return {kode_10digit: {balita, lansia, usia_sekolah}} dari sheet
    JUMDUK_KELUMUR, sesuai definisi BALITA_BAND / LANSIA_BANDS /
    USIA_SEKOLAH_BANDS di atas. usia_sekolah = None kalau salah satu pita
    5–19 tidak ada di header (guard, konsisten dengan pola proporsi_lansia)."""
    ws = wb["JUMDUK_KELUMUR"]

    # Baris 6 (index sesuai contoh di atas) = header pita usia per grup 3 kolom (L, P, JUMLAH)
    header_row = list(ws.iter_rows(min_row=6, max_row=6, values_only=True))[0]
    band_col_start = {}  # {'00-04': col_index_JUMLAH, ...}
    col = 0
    while col < len(header_row):
        label = header_row[col]
        if label and isinstance(label, str) and label.endswith(" L"):
            band = label[:-2]  # buang ' L'
            band_col_start[band] = col  # kolom L; JUMLAH ada di col+2
        col += 1

    out = {}
    for row in ws.iter_rows(min_row=7, max_row=ws.max_row, values_only=True):
        kode_raw = row[0]
        if kode_raw is None:
            continue
        kode = normalize_kode(kode_raw)
        if len(kode) != 10:
            continue  # skip level kota/kecamatan, hanya ambil kelurahan

        def band_jumlah(band_name):
            start = band_col_start[band_name]
            return row[start + 2]  # posisi JUMLAH = L, P, JUMLAH

        balita = band_jumlah(BALITA_BAND)
        lansia = sum(band_jumlah(b) for b in LANSIA_BANDS)
        try:
            usia_sekolah = sum(band_jumlah(b) for b in USIA_SEKOLAH_BANDS)
        except KeyError:
            usia_sekolah = None  # pita 5–19 tidak lengkap di header sheet
        out[kode] = {"balita": balita, "lansia": lansia, "usia_sekolah": usia_sekolah}
    return out


def build_dataset(excel_path: str):
    wb = openpyxl.load_workbook(excel_path, data_only=True)

    jumduk = read_jumduk(wb)
    kec_lookup = read_kecamatan_lookup(wb)
    produktif = read_produktif_non(wb)
    kelumur = read_kelompok_umur(wb)

    rows = []
    warnings = []
    for kode, base in jumduk.items():
        nama_kel = base["nama_kelurahan"]
        jumlah = base["jumlah_penduduk"]
        nama_kec = kec_lookup.get(kode)
        um = kelumur.get(kode)
        pr = produktif.get(kode)

        if nama_kec is None:
            warnings.append(f"{kode} ({nama_kel}): nama kecamatan tidak ditemukan")
        if um is None:
            warnings.append(f"{kode} ({nama_kel}): data kelompok umur tidak ditemukan")
        elif um.get("usia_sekolah") is None:
            warnings.append(f"{kode} ({nama_kel}): pita usia sekolah 5–19 tidak lengkap di JUMDUK_KELUMUR")
        if pr and pr["usia_produktif"] + pr["usia_muda"] + pr["usia_tua"] != jumlah:
            warnings.append(
                f"{kode} ({nama_kel}): jumlah PRODUKTIF_NON "
                f"({pr['usia_muda']+pr['usia_produktif']+pr['usia_tua']}) != JUMDUK ({jumlah})"
            )

        proporsi_balita = round(um["balita"] / jumlah, 4) if um and jumlah else None
        proporsi_lansia = round(um["lansia"] / jumlah, 4) if um and jumlah else None
        # Proporsi usia sekolah (5–19) — guard jumlah==0 / pita hilang -> None,
        # pola identik proporsi_lansia (lihat migration 026).
        proporsi_usia_sekolah = (
            round(um["usia_sekolah"] / jumlah, 4)
            if um and jumlah and um.get("usia_sekolah") is not None
            else None
        )

        rows.append({
            "kode": kode,
            "nama_kecamatan": nama_kec,
            "nama_kelurahan": nama_kel,
            "jumlah_penduduk": jumlah,
            "proporsi_balita": proporsi_balita,
            "proporsi_lansia": proporsi_lansia,
            "proporsi_usia_sekolah": proporsi_usia_sekolah,
        })

    return rows, warnings


def fetch_kelurahan_id_map(client) -> dict:
    """
    Ambil {NAMA_KELURAHAN_UPPER: id} untuk seluruh baris batas_administrasi
    ber-sumber RBI asli (56 kelurahan) — SATU query, dipakai untuk matching
    lokal di Python (case-insensitive) supaya tidak perlu query per baris.
    Sengaja TIDAK termasuk 6 baris dummy ('DATA SINTETIS...') walau nama
    keduanya tidak collide (lihat 008_batas_administrasi_sumber.sql),
    supaya kelurahan_id yang dipakai jelas hanya menunjuk data resmi.
    """
    res = (
        client.table("batas_administrasi")
        .select("id, nama_kelurahan")
        .eq("sumber", SUMBER_BATAS_ADMINISTRASI_RBI)
        .execute()
    )
    return {row["nama_kelurahan"].upper(): row["id"] for row in res.data}


def match_rows(rows: list, id_map: dict):
    """Cocokkan tiap baris DKB (kelurahan) ke kelurahan_id (case-insensitive).
    Return (matched_records_for_insert, unmatched_names)."""
    records = []
    unmatched = []
    for r in rows:
        kelurahan_id = id_map.get(r["nama_kelurahan"].upper())
        if kelurahan_id is None:
            unmatched.append(r["nama_kelurahan"])
            continue
        records.append({
            "kelurahan_id": kelurahan_id,
            "jumlah_penduduk": r["jumlah_penduduk"],
            "proporsi_lansia": r["proporsi_lansia"],
            "proporsi_balita": r["proporsi_balita"],
            "proporsi_usia_sekolah": r["proporsi_usia_sekolah"],
            "sumber": SUMBER_LABEL,
        })
    return records, unmatched


def upload(client, records: list):
    """
    Insert records ke tabel penduduk. Dijaga idempotency SEDERHANA: kalau
    sudah ada baris `penduduk` dengan sumber=SUMBER_LABEL, batalkan (supaya
    re-run script ini tidak menduplikasi data yang sama) — hapus dulu
    manual/lewat argumen lain kalau memang berniat replace, bukan didiamkan
    auto-insert dobel di sini.
    """
    existing = (
        client.table("penduduk")
        .select("id", count="exact")
        .eq("sumber", SUMBER_LABEL)
        .execute()
    )
    if existing.count and existing.count > 0:
        print(
            f"[DIBATALKAN] Sudah ada {existing.count} baris penduduk dengan sumber='{SUMBER_LABEL}'. "
            "Script ini tidak menduplikasi otomatis — hapus baris lama dulu kalau memang "
            "berniat re-upload/replace (mis. lewat Supabase SQL Editor), baru jalankan ulang."
        )
        sys.exit(1)

    result = client.table("penduduk").insert(records).execute()
    print(f"Berhasil upload {len(result.data)} baris ke tabel penduduk.")
    return result


def update_existing(client, records: list):
    """
    Mode --update-existing: baris `penduduk` (56 kelurahan REAL) SUDAH ada di
    DB, jadi insert dobel dilarang oleh guard di upload(). Fungsi ini hanya
    men-UPDATE kolom `proporsi_usia_sekolah` (kolom baru dari migration 026)
    pada baris yang sudah ada, di-match lewat (kelurahan_id, sumber=SUMBER_LABEL).
    Kolom lain (jumlah_penduduk, proporsi_lansia, proporsi_balita) TIDAK
    disentuh — angkanya tidak berubah, dan membiarkannya utuh membuat diff
    ke DB minimal & mudah diaudit qa-tester. Idempotent: rerun menulis nilai
    yang sama.
    """
    updated, tidak_ditemukan = 0, []
    for r in records:
        res = (
            client.table("penduduk")
            .update({"proporsi_usia_sekolah": r["proporsi_usia_sekolah"]})
            .eq("kelurahan_id", r["kelurahan_id"])
            .eq("sumber", SUMBER_LABEL)
            .execute()
        )
        if res.data:
            updated += len(res.data)
        else:
            tidak_ditemukan.append(r["kelurahan_id"])

    if tidak_ditemukan:
        print(
            f"[PERINGATAN] {len(tidak_ditemukan)} kelurahan_id tidak punya baris penduduk "
            f"berlabel '{SUMBER_LABEL}' untuk di-UPDATE: {tidak_ditemukan}"
        )
    print(f"Berhasil UPDATE proporsi_usia_sekolah pada {updated} dari {len(records)} baris penduduk.")
    return updated


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--excel", required=True)
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument(
        "--update-existing",
        action="store_true",
        help="UPDATE kolom proporsi_usia_sekolah pada 56 baris penduduk yang sudah ada "
             "(dipakai setelah migration 026 menambah kolomnya), bukan insert baru.",
    )
    args = parser.parse_args()

    rows, warnings = build_dataset(args.excel)

    print(f"Total kelurahan terbaca: {len(rows)}")
    total_penduduk = sum(r["jumlah_penduduk"] for r in rows)
    print(f"Total penduduk (jumlah {len(rows)} kelurahan): {total_penduduk:,}")
    print("(Cek: PRODUKTIF_NON KOTA BEKASI = 2.607.248 — angka kanonik DKB Sem.I 2026)")
    print()

    if warnings:
        print(f"[PERINGATAN] {len(warnings)} peringatan validasi cross-check JUMDUK vs PRODUKTIF_NON/KELUMUR:")
        for w in warnings:
            print(f"   - {w}")
        print()

    print("Contoh 5 baris pertama:")
    for r in rows[:5]:
        us = r["proporsi_usia_sekolah"]
        us_str = f"{us:.2%}" if us is not None else "  n/a"
        print(f"   {r['nama_kecamatan']:20s} {r['nama_kelurahan']:20s} "
              f"jml={r['jumlah_penduduk']:>7,} balita={r['proporsi_balita']:.2%} "
              f"lansia={r['proporsi_lansia']:.2%} usia_sekolah(5-19)={us_str}")

    us_vals = sorted(r["proporsi_usia_sekolah"] for r in rows if r["proporsi_usia_sekolah"] is not None)
    n_null_us = sum(1 for r in rows if r["proporsi_usia_sekolah"] is None)
    if us_vals:
        med = us_vals[len(us_vals) // 2]
        print(f"\nproporsi_usia_sekolah: {len(us_vals)}/{len(rows)} terisi "
              f"(min={us_vals[0]:.4f} median={med:.4f} max={us_vals[-1]:.4f}), {n_null_us} NULL")

    # Matching ke batas_administrasi dijalankan WALAUPUN --dry-run (butuh
    # koneksi Supabase read-only) supaya unmatched name bisa diinvestigasi
    # sebelum upload sungguhan dicoba.
    client = get_client()
    id_map = fetch_kelurahan_id_map(client)
    print(f"\nbatas_administrasi (sumber RBI asli): {len(id_map)} kelurahan tersedia untuk matching.")

    records, unmatched = match_rows(rows, id_map)
    print(f"Cocok ke kelurahan_id: {len(records)}/{len(rows)}")
    if unmatched:
        print(f"[PERINGATAN] {len(unmatched)} kelurahan DKB TIDAK cocok ke batas_administrasi (RBI), dilewati:")
        for n in unmatched:
            print(f"   - {n}")
        print("   Cek ejaan nama kelurahan antara data RBI BIG vs DKB.")

    if args.dry_run:
        print("\n--dry-run aktif, tidak upload ke Supabase.")
        return

    if args.update_existing:
        update_existing(client, records)
    else:
        upload(client, records)


if __name__ == "__main__":
    main()

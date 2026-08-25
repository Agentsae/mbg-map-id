#!/usr/bin/env bash
# qa/test-ai-insight.sh
# GeoTransit Insight — QA regression script untuk Edge Function `ai-insight`.
#
# Tujuan: ukur waktu respons riil vs acceptance criteria PRD Bab 8
# (AI Spatial Consultant: respons < 5 detik) dan cek error handling dasar.
#
# Cara pakai:
#   bash qa/test-ai-insight.sh
#
# Butuh: curl. Publishable key di bawah aman dipakai client-side
# (bukan service_role/secret) — lihat memory supabase-project-config.
#
# CATATAN PENTING (per 2026-08-25):
# Tabel `skor_equity` kosong di production (field survey belum selesai,
# jadwal 29-30 Agustus — lihat CLAUDE.md jalur kritis). Selama tabel kosong,
# Edge Function pulang lebih awal dengan pesan fallback TANPA memanggil
# Claude API sama sekali — jadi timing di bawah TIDAK mengukur jalur AI
# sungguhan sampai ada data (asli atau dummy) di skor_equity.
# Untuk uji jalur AI sungguhan, isi dulu skor_equity+batas_administrasi
# dengan data (nyata atau dummy sementara), lalu jalankan script ini,
# lalu hapus lagi data dummy tsb setelah selesai (jangan tinggalkan sampah
# di production).

set -euo pipefail

URL="https://vpymlmaebvfmpowomsec.supabase.co/functions/v1/ai-insight"
KEY="sb_publishable_Km7tW_79bQ3zsOrdNgl2Ug_HBfsIDJ-"
OUT_DIR="$(mktemp -d)"

call() {
  local label="$1" body="$2"
  echo "=== $label ==="
  curl -s -o "$OUT_DIR/$label.json" -w "HTTP:%{http_code} TIME:%{time_total}s\n" \
    -X POST "$URL" \
    -H "Authorization: Bearer $KEY" \
    -H "apikey: $KEY" \
    -H "Content-Type: application/json" \
    -d "$body"
  cat "$OUT_DIR/$label.json"
  echo
}

echo "--- Uji performa (3x panggilan, query realistis dari PRD) ---"
for i in 1 2 3; do
  call "perf-$i" '{"query":"Di mana titik prioritas halte baru di Kecamatan Mustika Jaya?"}'
done

echo "--- Uji error handling ---"
call "missing-query"   '{"area_filter":"Mustika Jaya"}'
call "empty-body"      '{}'
call "malformed-json"  'not-json-at-all'

echo "Semua respons mentah tersimpan di: $OUT_DIR"

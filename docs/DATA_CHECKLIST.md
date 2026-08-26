# Data Checklist — GeoTransit Insight

> Disusun oleh agent `project-lead`, 26 Agustus 2026. Audit repo penuh (CLAUDE.md,
> BUILD_CHECKLIST.md, FRAMEWORK_GeoTransitInsight.md, migrations, etl/).
> Tujuan: daftar data REAL yang masih dibutuhkan sebelum submission 13 September 2026,
> dan cara mendapatkannya. Update file ini setiap kali satu item selesai diperoleh.

**Hari ini: 26 Agustus 2026 — 18 hari ke submission.** Field Day 3 (survei terakhir):
29-30 Agustus — **tinggal 3 hari**.

## ⚠️ Dua risiko baru ditemukan lewat audit ini (belum ada sebelumnya di BUILD_CHECKLIST.md)

1. **Instrumen survei belum ada sama sekali.** Form Kondisi Halte (isi `halte_eksisting`)
   dan Form Traffic Counting (isi `titik_kandidat`) baru disebut sebagai nama konsep di
   dokumen — tidak ada Google Form/form MAPID Apps/kuesioner aktual di repo. **Wajib
   dibuat sebelum 29 Agustus** atau Field Day 3 menghasilkan data tak terstruktur.
2. **Sesi AHP dengan mentor kemungkinan belum kelar.** Dijadwalkan 21-27 Agustus di
   `FRAMEWORK_GeoTransitInsight.md` (harusnya sudah lewat), tapi `konfigurasi_bobot`
   masih kosong untuk TDI/Equity, dan bobot CAI masih berlabel "perlu divalidasi mentor"
   di `004_konfigurasi_bobot.sql`. CAI adalah fitur yang tidak boleh dikorbankan — perlu
   konfirmasi status sesi ini segera.

---

## Kategori A — Blocker langsung Field Day 3 (29-30 Agustus)

| Data | Status | Dipakai untuk | Cara mendapatkan | Sebelum 13 Sep? |
|---|---|---|---|---|
| Instrumen survei (Form Kondisi Halte, Form Traffic Counting) | **Tidak ada di repo** | Struktur input Field Day 3 | Buat sendiri (Google Form/MAPID Apps form), field persis cocok skema `halte_eksisting`/`titik_kandidat` | **Wajib sebelum 29 Agustus** |
| Data hasil survei 70 titik (gabungan 3 field day) | 0 baris asli; yang ada 6+4 baris eksplisit ditandai `'DATA SINTETIS'` | `n_survei` (CAI, bobot 0.15), `total_aktivitas`→proksi volume, kondisi trotoar/penyeberangan | Eksekusi Field Day 3, ekspor GeoJSON dari MAPID Apps | Ya — jalur kritis inti 31 Agu–6 Sep, bergantung pada form di atas |

## Kategori B — Data sekunder resmi (jalur jelas, butuh waktu unduh/request)

| Data | Status | Index | Cara mendapatkan | Sebelum 13 Sep? |
|---|---|---|---|---|
| Batas administrasi kelurahan/kecamatan (poligon asli) | Kosong — seed dummy pakai bounding box kasar | Fondasi spasial semua tabel | **BIG** (tanahair.indonesia.go.id) atau **Bappeda Kota Bekasi** (lebih presisi) | Ya, publik — prioritaskan duluan |
| Jumlah penduduk + proporsi lansia/balita per kelurahan | Kosong, berlabel sintetis | `n_kepadatan` CAI (bobot 0.35, terbesar), TDI, Equity | **BPS Kota Bekasi Dalam Angka** (publik); granular lansia/balita mungkin perlu request **Dukcapil** | Ya untuk BPS; Dukcapil mungkin lebih lambat — pakai agregat kecamatan sebagai proksi kalau mepet |
| Rasio rumah tangga tanpa kendaraan pribadi | Tidak ada — kode sudah fallback netral 0.5 | TDI (Indeks Kebutuhan Mobilitas) | BPS Susenas (granularitas kelurahan jarang publik) | **Realistis tetap fallback 0.5** — jangan diperjuangkan mati-matian |
| POI sekolah | Kosong, sintetis | `n_jarak_inv` CAI, TDI, Equity | **Dapodik Kemendikbud** atau **OSM Overpass API** (`amenity=school`, tanpa izin) | Ya |
| POI faskes | Kosong, sintetis | Sama seperti di atas | **Kemenkes/Dinkes Kota Bekasi** atau **OSM** (`amenity=hospital/clinic`) | Ya |
| POI pusat kerja/industri | Kosong, sintetis | Sama seperti di atas | **RTRW Kota Bekasi** (Bappeda/PUPR) atau **OSM** (`landuse=industrial`, `office=*`) | RTRW mungkin lambat; OSM sebagai fallback cepat |
| Building footprint (dasymetric mapping) | Sintetis (`load_demo_buildings()`) | Presisi `grid_analisis.kepadatan_penduduk` → TDI | **OSM Overpass API / Geofabrik** (`building=*`), tanpa izin | Ya — murni teknis, cepat |

## Kategori C — Butuh kontak institusi (paling berisiko delay)

| Data | Status | Index | Cara mendapatkan | Sebelum 13 Sep? |
|---|---|---|---|---|
| Volume penumpang KRL/BRT/angkot | Kosong, angka buatan | `n_volume` CAI (bobot 0.25, kedua terbesar) | Kontak **KAI Commuter/Transjakarta/Damri**, atau **Dishub Kota Bekasi** langsung (target user produk ini) | **Jangan gantungkan pada operator besar** — pakai traffic counting sampel jam puncak dari survei tim sendiri (in-scope PRD Bab 3) sebagai sumber utama |

## Kategori D — Keputusan tim/mentor (bukan data eksternal)

| Data | Status | Index | Cara mendapatkan | Sebelum 13 Sep? |
|---|---|---|---|---|
| Bobot AHP final — CAI | Ada 4 baris tapi berlabel "perlu divalidasi mentor" | CAI | Sesi AHP dengan mentor | **Prioritas tertinggi** — CAI tidak boleh dikorbankan |
| Bobot AHP final — TDI (Indeks Kebutuhan Mobilitas) | 0 baris di `konfigurasi_bobot` | TDI | Sesi AHP dengan mentor | Segera — jadwal framework (21-27 Agu) sudah lewat |
| Bobot AHP final — Equity Index | 0 baris | Equity | Sesi AHP dengan mentor | Segera |
| Kelompok terdampak & rekomendasi intervensi per kelurahan | Placeholder generik/dummy | Equity Dashboard (acceptance criteria Bab 8) | Analisis tim sendiri (kombinasi BPS + Dapodik/Kemenkes + hasil survei), bukan data yang "diunduh" | Setelah data BPS/POI/AHP final masuk, window 31 Agu-6 Sep — delegasikan ke `data-ai-analyst`/`product-analyst` |

## Kategori E — Turunan otomatis (tidak perlu dicari, tinggal jalankan ulang)

| Data | Status | Catatan |
|---|---|---|
| `grid_analisis` (fishnet 250-500m) | 0 baris di produksi | `etl/build_fishnet_grid.py` sudah lengkap & terverifikasi secara kode (konservasi populasi via assert), baru dijalankan dengan data demo. Tinggal re-run dengan boundary asli (Kategori B) + building footprint OSM |
| `skor_cai`, `skor_equity` (angka final) | Ada, dari data sintetis | Turunan otomatis `compute_scores.py` — tinggal re-run begitu input Kategori A-D masuk |

---

## Urutan eksekusi yang direkomendasikan

1. **Sebelum 29 Agustus**: buat Form Kondisi Halte & Form Traffic Counting
2. **Segera**: konfirmasi status sesi AHP dengan mentor (CAI/TDI/Equity)
3. **Minggu ini, paralel**: unduh batas administrasi (BIG/Bappeda) + BPS Dalam Angka — publik, tidak perlu menunggu
4. **Paralel, via `data-ai-analyst`**: tarik POI + building footprint dari OSM Overpass API — tidak perlu izin
5. **Saat Field Day 3**: traffic counting sampel jam puncak sebagai sumber `n_volume`, jangan tunggu balasan operator transit
6. **Terima fallback**: rasio tanpa kendaraan (Susenas) tetap 0.5 kalau tidak sempat
7. **Window 31 Agu-6 Sep**: analisis kelompok terdampak & rekomendasi intervensi per kelurahan, setelah data numerik final masuk

## Isu kebersihan repo (dicek sekaligus, hasil bersih)

Tidak ada conflict marker git ter-commit di file produk, tidak ada `VITE_ANTHROPIC_API_KEY`/API key AI bocor ke frontend (hanya `VITE_MAPID_MAPS_API_KEY` yang memang basemap key publik sesuai desain), RLS aktif di 9/9 tabel (`002_rls_policies.sql`).

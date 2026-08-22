# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Proyek

GeoTransit Insight — WebGIS Spatial Decision Support System untuk optimalisasi
transportasi massal Kota Bekasi. Tim MBG, MAPID WebGIS Competition #2 2026
(submission 13 September 2026).

Bahasa kerja tim: **Bahasa Indonesia**. Komentar kode, docstring, commit message,
dan nama kolom database semuanya berbahasa Indonesia — ikuti konvensi itu.

## Perintah

```bash
# Frontend (dari frontend/)
npm install
npm run dev          # localhost:5173
npm run build
npm run lint         # oxlint

# ETL (dari etl/)
pip install -r requirements.txt
python compute_scores.py       # demo CAI + TDI + Equity Index, data sintetis
python build_fishnet_grid.py   # demo fishnet grid + dasymetric mapping
python upload_to_supabase.py   # butuh SUPABASE_URL + SUPABASE_SERVICE_ROLE_KEY

# Supabase
supabase db push                        # jalankan migrations 001 -> 002 -> 003 (urutan penting)
supabase functions deploy ai-insight
supabase secrets set GEMINI_API_KEY=xxx
```

**Belum ada test suite.** Verifikasi dilakukan lewat blok `__main__` di tiap script
ETL, yang mencetak hasil perhitungan dengan data sintetis. `build_fishnet_grid.py`
punya assertion konservasi populasi (total jiwa setelah disebar ke grid harus sama
dengan total asli) — kalau mengubah logika disagregasi, assertion itu yang pertama
menangkap kesalahan.

## Arsitektur

### Prinsip inti: skor deterministik terpisah dari narasi AI

Ini keputusan arsitektur paling penting di proyek ini, diminta eksplisit oleh PRD Bab 7
dan menentukan di mana kode boleh ditulis:

- **Semua skor dihitung offline** di Python (`etl/`), hasilnya diunggah ke Supabase
  sebagai tabel siap pakai. Frontend hanya membaca, tidak pernah menghitung ulang.
- **Gemini hanya menerjemahkan skor jadi narasi** — tidak pernah menghitung atau
  menebak angka. `supabase/functions/ai-insight/index.ts` mengambil skor dari database
  lebih dulu, mengirimkannya ke Gemini sebagai data terstruktur, lalu memvalidasi
  bahwa angka di narasi cocok dengan angka input.
- **Satu-satunya perhitungan on-the-fly** adalah RPC `simulate_new_stop(lat, lon)`
  (`supabase/migrations/003_*.sql`), karena inputnya titik klik user yang tidak bisa
  diketahui sebelumnya. Semua query spasialnya digabung dalam satu fungsi supaya cukup
  satu round-trip.

Jangan pindahkan perhitungan skor ke frontend atau ke prompt AI.

### Alur data

```
data/raw + survei MAPID Apps
    -> build_fishnet_grid.py      (grid 300m + disagregasi penduduk dasymetric)
    -> compute_scores.py           (CAI per titik, TDI per grid, Equity per kelurahan)
    -> upload_to_supabase.py       (push ke Supabase; butuh service_role key)
    -> Supabase PostGIS + RLS
    -> frontend React (baca lewat anon key) / Edge Function (baca lewat service_role)
```

### Tiga skor dan arah skalanya

Arah skala berbeda antar skor dan mudah terbalik — perhatikan saat menulis query,
pewarnaan peta, atau sorting:

| Skor | Unit | Arah |
|---|---|---|
| `skor_cai` (Composite Accessibility Index) | per titik kandidat | **tinggi = aksesibilitas bagus** |
| `skor_tdi` (Transit Desert Index) | per cell grid | **tinggi = makin "transit desert"**, makin butuh prioritas |
| `skor_final` di `skor_equity` | per kelurahan | **tinggi = makin dirugikan/tertinggal** |

`compute_equity_index()` membalik CAI (`inverse=True`) justru supaya konsisten dengan
arah "tinggi = buruk" itu, dan `ranking` 1 berarti kelurahan paling tertinggal.

### Pola dua fase untuk `grid_analisis`

Kolom `geom` di tabel itu `NOT NULL`, jadi grid harus ada lebih dulu sebelum skornya bisa diisi:

1. `build_fishnet_grid.insert_grid_to_supabase()` — **insert sekali**, mengisi geom.
   Menghasilkan `id` yang dipakai sebagai `grid_analisis_id` di langkah berikutnya.
2. `upload_to_supabase.upload_tdi_scores()` — **update berulang**, hanya mengisi kolom skor.
   Kalau data tidak punya kolom `grid_analisis_id`, fungsi ini sengaja skip dengan
   peringatan, bukan insert baris tanpa geom.

Pola "skip dengan peringatan, jangan tulis data menggantung" juga dipakai di
`upload_equity_scores()`, yang melewati kelurahan yang belum ada di `batas_administrasi`.

### Mode demo di frontend

`frontend/src/lib/supabaseClient.js` mengekspor `isConfigured`. Kalau `.env` belum diisi,
`supabase` bernilai `null` dan **setiap komponen wajib punya fallback data contoh** —
lihat pola `DEMO_*` di `AIPanel`, `Dashboard`, `EquityIndexView`, dan `App.jsx`. Ini
disengaja supaya UI bisa dikerjakan dan didemokan tanpa menunggu backend siap. Komponen
baru yang membaca Supabase harus mengikuti pola yang sama, termasuk badge peringatan
"menampilkan data contoh".

### RLS

`002_rls_policies.sql`: publik (anon key) hanya boleh `SELECT`. Tidak ada policy
INSERT/UPDATE/DELETE sama sekali — semua penulisan lewat `service_role` key yang
dipakai script ETL dan Edge Function. Tabel baru harus ditambahkan policy select-nya
secara eksplisit satu per satu (bukan wildcard), mengikuti pola yang sudah ada.

## Status: apa yang masih placeholder

Banyak bagian sengaja dibiarkan placeholder dan **tidak boleh dianggap final**:

- **Semua loader data masih `load_demo_*()`** dengan data sintetis. Data asli
  (BPS/Dukcapil, OSM building footprint, Dapodik, Kemenkes, dataset panitia MAPID)
  belum ada di `data/raw/`. Window ETL data asli: 31 Agu–6 Sep 2026.
- **Semua bobot masih placeholder** (`DEFAULT_WEIGHTS`, `DEFAULT_MOBILITY_WEIGHTS`,
  `DEFAULT_EQUITY_WEIGHTS`), menunggu sesi AHP dengan mentor. Bobot final nantinya
  dibaca dari tabel `konfigurasi_bobot`, bukan hardcode.
- **Basemap masih raster OSM gratis**, bukan MAPID Maps yang diwajibkan kompetisi.
  Cari komentar `GANTI DI SINI` di `frontend/src/components/Map/MapView.jsx`.
- `area_filter` di Edge Function `ai-insight` masih TODO — query pengguna belum
  benar-benar memfilter data per kecamatan.
- `disaggregate_population_dasymetric()` pakai loop bersarang yang mudah dibaca tapi
  lambat; untuk skala kota penuh perlu diganti `gpd.sjoin()` + `groupby`.

## Catatan lingkungan

- **Jangan pakai emoji di `print()` script Python.** Console Windows default memakai
  cp1252 dan akan `UnicodeEncodeError` — pernah terjadi dan sudah diperbaiki; pakai
  penanda teks seperti `[PERINGATAN]`.
- `data/processed/` di-gitignore (output generate ulang). `data/raw/` dan `data/survei/`
  sengaja ikut repo supaya analisis bisa direproduksi tim.
- Proyeksi: simpan/serve geometri di **EPSG:4326**, tapi reproyeksi ke **EPSG:32748
  (UTM 48S)** untuk operasi berbasis meter (ukuran cell grid, luas, jarak).
- `origin` adalah fork pribadi (`Agentsae/mbg-map-id`); repo tim ada di `upstream`
  (`rafaelwilliem/mbg-map-id`).

## Dokumen rujukan

- `FRAMEWORK_GeoTransitInsight.md` — framework teknis: arsitektur, skema database,
  roadmap, pembagian kerja, tabel risiko.
- `README.md` — cara menjalankan starter kit dan langkah setelah kredensial siap.
- **PRD (`PRD_GeoTransitInsight.docx`) tidak ada di repo** — dokumen itu memuat
  problem statement, persona, acceptance criteria per fitur, dan timeline resmi.
  Kalau butuh detailnya, minta filenya ke user.

Gap yang sudah teridentifikasi antara PRD dan kode saat ini: PRD Bab 9 menyebut
**Leaflet** padahal kode memakai **MapLibre GL JS** (PRD yang perlu dikoreksi);
acceptance criteria "Export Report" (PDF/gambar), "kelompok penduduk terdampak" dan
"rekomendasi intervensi per kelurahan" di Equity Dashboard, serta filter per kecamatan
di peta belum ada implementasinya.

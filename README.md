# GeoTransit Insight — Starter Kit

Tim MBG (MassTransit Based Geoinsight) — MAPID WebGIS Competition 2026

Ini adalah kerangka kerja awal yang sudah bisa dijalankan hari ini, sesuai
prioritas minggu pertama di `FRAMEWORK_GeoTransitInsight.md`. Semua bagian
sudah teruji jalan (frontend `npm run build` sukses, formula CAI di
`compute_scores.py` sudah diverifikasi hasilnya benar), tapi masih perlu
disambungkan ke kredensial asli (Supabase, Gemini, MAPID Maps).

## Struktur

```
geotransit-starter/
├── frontend/            # React + Vite + MapLibre GL JS + Tailwind
├── supabase/
│   ├── migrations/      # SQL: skema tabel, RLS, RPC simulate_new_stop
│   └── functions/
│       └── ai-insight/  # Edge Function TypeScript, panggil Gemini API
└── etl/
    ├── compute_scores.py      # Formula CAI (weighted overlay) — SUDAH JALAN, ada demo
    └── upload_to_supabase.py  # Template upload hasil ke Supabase
```

## Yang SUDAH bisa dicoba sekarang (tanpa kredensial apa pun)

```bash
# 1. Lihat formula CAI bekerja dengan data contoh
cd etl
pip install pandas numpy
python compute_scores.py

# 2. Jalankan frontend dalam mode demo (semua panel tampil dengan data contoh)
cd ../frontend
npm install
npm run dev
# buka http://localhost:5173 — akan ada badge "Mode demo" karena .env belum diisi
```

Frontend sengaja dibuat begini: **jalan dulu dengan data contoh**, supaya
Fajar (UI/UX) dan siapa pun di tim bisa langsung lihat & kasih masukan
tampilan tanpa menunggu Supabase/data survei selesai. Begitu `.env` diisi
kredensial asli, badge demo otomatis hilang dan semua panel mulai
menampilkan data sungguhan.

## Langkah setelah kredensial siap

1. **Supabase**: buat project baru, jalankan tiga file di `supabase/migrations/`
   lewat SQL Editor (urutannya penting: 001 → 002 → 003).
2. **Frontend**: `cp frontend/.env.example frontend/.env`, isi
   `VITE_SUPABASE_URL` dan `VITE_SUPABASE_ANON_KEY` dari Supabase Dashboard.
3. **Edge Function**: `supabase functions deploy ai-insight`, lalu
   `supabase secrets set GEMINI_API_KEY=xxxxx`.
4. **ETL**: isi `SUPABASE_URL` dan `SUPABASE_SERVICE_ROLE_KEY` sebagai
   environment variable, lalu `python upload_to_supabase.py` untuk push
   skor pertama ke database.
5. **MAPID Maps** ⚠️: `frontend/src/components/Map/MapView.jsx` masih
   pakai basemap OSM placeholder gratis. Cari komentar `GANTI DI SINI`
   di file itu begitu format tile MAPID Maps sudah dikonfirmasi.

## Belum dikerjakan di starter kit ini (langkah selanjutnya)

- ETL data asli (`load_penduduk.py`, `load_poi.py`, dll masih perlu ditulis
  begitu data BPS/Dapodik/Kemenkes/RTRW sudah diunduh)
- Fishnet grid untuk `grid_analisis` (Transit Desert Index)
- Bobot AHP final (masih pakai `DEFAULT_WEIGHTS` sementara di `compute_scores.py`)
- Deploy ke Vercel (jalankan `vercel` dari folder `frontend/` setelah akun siap)

Lihat `FRAMEWORK_GeoTransitInsight.md` untuk roadmap lengkap dan pembagian
kerja Python vs TypeScript antar anggota tim.

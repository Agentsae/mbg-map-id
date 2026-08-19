# Framework Teknis — GeoTransit Insight

**Tim MBG (MassTransit Based Geoinsight) — MAPID WebGIS Competition 2026**

> Status: Draft v0.2 — disesuaikan dengan keputusan stack (Vercel Pro + Supabase Pro + Gemini API). Bagian bertanda ⚠️ masih perlu diverifikasi ke dokumentasi resmi GEO MAPID (mapid.co.id/docs) atau mentor.

---

## 1. Prinsip Desain

- **Skor berat dihitung sekali di offline/batch, bukan real-time.** CAI, TDI, dan Transit Equity Index dihitung di QGIS/Python (GeoPandas), hasilnya diunggah ke Supabase sebagai tabel siap pakai. Frontend hanya membaca, tidak menghitung ulang.
- **Simulasi What-If adalah pengecualian** — satu-satunya kalkulasi yang harus terjadi on-the-fly, karena inputnya (titik klik user) tidak diketahui sebelumnya. Di stack ini ditangani lewat **Postgres function (RPC)** di Supabase — lihat Bagian 5.
- **Lapisan AI dipisah jadi dua**, sesuai PRD Bab 7: model skor deterministik (weighted overlay, dihitung offline dengan Python) dan lapisan generatif (Gemini API yang menerjemahkan skor jadi narasi, dipanggil dari Supabase Edge Function). Skor tidak boleh "dikarang" AI — hanya narasinya.
- **API key AI tidak boleh menyentuh browser.** Gemini API hanya dipanggil dari Edge Function (server-side), tidak pernah langsung dari frontend React.
- **Tools analisis wajib open-source** (ketentuan kompetisi): QGIS, PostGIS (built-in di Supabase), Python, GEE. Supabase/Vercel sendiri bukan "tools analisis" — statusnya infrastruktur hosting, jadi tidak melanggar ketentuan ini.
- **Basemap wajib MAPID Maps, data platform wajib GEO MAPID** ⚠️ — masih perlu dicek ke dokumentasi resmi bagaimana keduanya hidup berdampingan dengan Supabase (kemungkinan: MAPID Maps tetap dipakai sebagai basemap tile di MapLibre, sementara Supabase menyimpan hasil olahan tim sendiri — bukan pengganti GEO MAPID, tapi pelengkap untuk data internal tim).

---

## 2. Tech Stack

| Layer | Teknologi | Biaya | Alasan |
|---|---|---|---|
| Peta frontend | **MapLibre GL JS** | Gratis | Open-source, kompatibel dengan basemap MAPID Maps |
| Frontend framework | **React + Vite** | — | UI kompleks: AI chat panel, dashboard, mode simulasi |
| Hosting frontend | **Vercel Pro** | ~$20/bulan | Preview URL tiap perubahan kode, edge network cepat, tanpa cold start |
| Styling | Tailwind CSS | Gratis | Cepat untuk dashboard multi-card |
| Chart dashboard | Recharts atau Chart.js | Gratis | Dashboard Indikator per kecamatan |
| Database spasial + REST API | **Supabase Pro** (PostgreSQL + PostGIS) | $25/bulan | PostGIS aktif tanpa provisioning manual, auto-REST API (PostgREST), storage foto survei bawaan |
| Compute serverless (AI, RPC trigger) | **Supabase Edge Functions** (Deno/TypeScript) | Termasuk paket Pro | Memanggil Gemini API dengan API key aman di server-side |
| Analisis spasial berat | **QGIS + Python (GeoPandas, Shapely)** — offline | Gratis | Weighted overlay, TOD scoring, TDI — batch process, hasil diunggah ke Supabase |
| Data citra (opsional) | Google Earth Engine (`earthengine-api`) | Gratis | Hanya jika dasymetric mapping dibutuhkan |
| Lapisan AI generatif | **Gemini API**, dipanggil dari Edge Function | Sesuai pemakaian token | Narasi rekomendasi dari skor yang sudah pasti benar |
| Data serving | Supabase auto-REST (PostgREST) + RPC | Termasuk paket Pro | Tidak perlu tulis endpoint GET manual untuk data statis |
| Basemap | **MAPID Maps** ⚠️ | Fasilitas top 50 | Cek cara embed tile ke MapLibre |

**Estimasi biaya:** ~$45/bulan (Vercel + Supabase) selama proyek berjalan. Perlu dipastikan ke leader/tim: ini ditanggung dana survey activity budget kompetisi, atau patungan tim — supaya jelas sebelum kartu pembayaran didaftarkan.

---

## 3. Arsitektur Sistem

```
[Data Sumber]
  BPS · Dukcapil · Dapodik Kemendikbud · Kemenkes · RTRW · OSM
  Dishub Kota Bekasi · KAI Commuter · MAPID Community Maps
        │
        ▼ (ETL offline: Python — GeoPandas/Shapely, cleaning,
        │  geocoding, join ke batas administratif)
        │
[Data Survei Lapangan]
  MAPID Apps → export GeoJSON (Form Kondisi Halte, Form Traffic Counting)
        │
        ▼
┌─────────────────────────────────────────────────┐
│  ANALISIS OFFLINE — QGIS / Python (GeoPandas)      │
│  Weighted overlay (CAI) · TDI per grid ·           │
│  Transit Equity Index per kelurahan ·              │
│  AHP scoring dengan bobot hasil mentoring          │
└─────────────────────────────────────────────────┘
        │
        ▼ (upload hasil via script Python — supabase-py)
┌─────────────────────────────────────────────────┐
│  SUPABASE PRO                                      │
│  ├─ PostgreSQL + PostGIS                           │
│  │    tabel: penduduk, poi, halte_eksisting,        │
│  │    titik_kandidat, batas_administrasi,           │
│  │    hasil_survei, skor_cai, skor_tdi, skor_equity │
│  ├─ Auto-REST API (PostgREST)  → baca layer/skor    │
│  ├─ RPC Function `simulate_new_stop(lat, lon)`      │
│  │    → hitung dampak titik baru on-the-fly         │
│  ├─ Storage bucket                → foto survei     │
│  └─ Edge Function `ai-insight`  (TypeScript/Deno)   │
│       → panggil Gemini API, kirim skor + narasi     │
└─────────────────────────────────────────────────┘
        │
        ▼ (supabase-js client — REST + RPC + Edge Function)
┌─────────────────────────────────────────────────┐
│  FRONTEND — React + Vite + MapLibre GL JS          │
│  di-hosting Vercel Pro                             │
│  ├─ Peta Multi-Layer (basemap MAPID Maps)          │
│  ├─ AI Insight Panel (chat UI)                     │
│  ├─ Mode Simulasi What-If (klik peta → RPC)        │
│  ├─ Dashboard Indikator (charts)                   │
│  └─ Transit Equity Index View (tabel + choropleth) │
└─────────────────────────────────────────────────┘
```

---

## 4. Skema Database Inti (Supabase / PostGIS)

Tabel minimal untuk mulai — sesuaikan/tambah sesuai temuan survei. Semua dibuat lewat Supabase SQL Editor atau migration file.

| Tabel | Kolom kunci | Catatan |
|---|---|---|
| `batas_administrasi` | id, nama_kecamatan, nama_kelurahan, geom (POLYGON) | Sumber: BIG/BPS |
| `penduduk` | kelurahan_id, jumlah_penduduk, proporsi_lansia, proporsi_balita, geom (opsional, jika sudah didisagregasi dasymetric) | Join ke `batas_administrasi` |
| `poi` | id, jenis (sekolah/faskes/kerja), nama, geom (POINT) | Sumber: Dapodik, Kemenkes, RTRW, OSM |
| `halte_eksisting` | id, nama, geom (POINT), skor_survei, headway_aktual, okupansi | Dari Form Kondisi Halte |
| `titik_kandidat` | id, deskripsi, geom (POINT), total_aktivitas | Dari Form Traffic Counting |
| `grid_analisis` | id, geom (POLYGON 250-500m), skor_tdi | Fishnet grid untuk TDI |
| `skor_cai` | grid_id/titik_id, n_kepadatan, n_jarak, n_volume, n_survei, skor_final | Hasil weighted overlay, diupload dari Python |
| `skor_equity` | kelurahan_id, skor_final, ranking | Hasil Transit Equity Index, diupload dari Python |

**Wajib:** index spasial di setiap kolom `geom` (`CREATE INDEX ... USING GIST`), dan aktifkan **Row Level Security (RLS)** di Supabase untuk tabel yang di-expose lewat auto-REST — kalau tidak, data bisa diakses publik tanpa kontrol begitu `anon key` frontend ketahuan (yang memang selalu terlihat di browser, itu wajar untuk Supabase, tapi RLS yang menjaga apa yang boleh dibaca/ditulis).

---

## 5. RPC Function untuk Simulasi What-If

Ini bagian yang paling berbeda dari rencana FastAPI sebelumnya — dikerjakan sebagai **Postgres function**, dipanggil langsung dari frontend lewat `supabase.rpc()`, tanpa perlu server backend terpisah.

```sql
create or replace function simulate_new_stop(lat float, lon float)
returns json
language plpgsql
as $$
declare
  titik geography := ST_SetSRID(ST_MakePoint(lon, lat), 4326)::geography;
  penduduk_400m int;
  penduduk_800m int;
  jarak_transit_terdekat float;
begin
  select coalesce(sum(jumlah_penduduk), 0) into penduduk_400m
  from penduduk
  where ST_DWithin(geom::geography, titik, 400);

  select coalesce(sum(jumlah_penduduk), 0) into penduduk_800m
  from penduduk
  where ST_DWithin(geom::geography, titik, 800);

  select min(ST_Distance(geom::geography, titik)) into jarak_transit_terdekat
  from halte_eksisting;

  return json_build_object(
    'penduduk_terlayani_400m', penduduk_400m,
    'penduduk_terlayani_800m', penduduk_800m,
    'jarak_ke_transit_terdekat_m', round(jarak_transit_terdekat::numeric, 0)
  );
end;
$$;
```

Dipanggil dari React:
```javascript
const { data, error } = await supabase.rpc('simulate_new_stop', { lat: -6.2185, lon: 107.0074 });
```

Catatan: fungsi di atas versi dasar (radius penduduk + jarak transit terdekat). Untuk versi lengkap sesuai PRD (delta waktu tempuh, akses faskes/sekolah), tambahkan query serupa ke tabel `poi` dan `halte_eksisting` di dalam fungsi yang sama — satu round-trip, bukan banyak query terpisah dari frontend.

---

## 6. Edge Function — AI Insight

Ditulis TypeScript/Deno (bukan Python), dijalankan lewat `supabase functions deploy ai-insight`.

Alur:
1. Frontend kirim `{ query, area_filter }` ke Edge Function.
2. Edge Function query tabel `skor_cai`/`skor_equity` di Supabase (pakai service role key, aman karena di server) untuk ambil skor yang relevan.
3. Edge Function kirim skor tersebut (bukan data mentah) ke Gemini API dengan prompt terstruktur, minta narasi.
4. Edge Function validasi: pastikan angka di narasi Gemini cocok dengan angka input, baru kirim balik ke frontend.

Contoh kerangka prompt (bukan final):
```
System: Kamu adalah asisten analisis spasial untuk Dishub Kota Bekasi.
Jelaskan skor berikut dalam bahasa yang mudah dipahami pejabat non-teknis,
sertakan alasan berbasis angka yang diberikan. Jangan mengubah/menambah angka.

Input: {
  "kelurahan": "Mustika Jaya",
  "skor_cai": 0.78,
  "komponen": {"kepadatan": 0.9, "jarak_faskes": 0.7, "volume_transit": 0.2, "survei": 0.5}
}
```

---

## 7. Pembagian Kerja: Python vs TypeScript

Stack ini menggabungkan dua bahasa berbeda — penting dibagi jelas dari awal supaya tidak tumpang tindih:

| Bagian | Bahasa | Siapa (usulan) |
|---|---|---|
| ETL data mentah → siap pakai | Python (GeoPandas/Shapely) | Galuh Eka Permana |
| Perhitungan CAI/TDI/Equity Index (batch, offline) | Python + AHP weights | Galuh Eka Permana |
| Script upload hasil skor ke Supabase | Python (`supabase-py`) | Galuh Eka Permana |
| Frontend React + MapLibre + Dashboard | TypeScript/JavaScript | Samuel Alfa Edison |
| Edge Function `ai-insight` (panggil Gemini) | TypeScript (Deno) | Samuel Alfa Edison — lebih natural karena sudah pegang JS di frontend |
| RPC function `simulate_new_stop` | SQL (di Supabase SQL Editor) | Galuh Eka Permana (logika spasial) + Samuel (integrasi ke frontend) |

Kalau Galuh belum familiar TypeScript, ini pembagian yang aman — Galuh sepenuhnya di Python/SQL, Samuel sepenuhnya di TypeScript, ketemu di titik `supabase.rpc()` dan tabel yang sudah terisi.

---

## 8. Struktur Folder

```
geotransit-insight/
├── frontend/                       # deploy ke Vercel
│   ├── src/
│   │   ├── components/
│   │   │   ├── Map/                # MapLibre init, layer control
│   │   │   ├── AIPanel/            # chat UI, panggil Edge Function
│   │   │   ├── SimulationMode/     # klik peta → supabase.rpc()
│   │   │   ├── Dashboard/          # charts coverage ratio
│   │   │   └── EquityIndexView/    # tabel ranking + choropleth
│   │   ├── lib/
│   │   │   └── supabaseClient.js   # init supabase-js
│   │   ├── App.jsx
│   │   └── main.jsx
│   ├── vite.config.js
│   ├── .env                        # VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY
│   └── package.json
├── supabase/
│   ├── functions/
│   │   └── ai-insight/
│   │       └── index.ts            # Edge Function, panggil Gemini API
│   └── migrations/
│       ├── 001_init_tables.sql
│       └── 002_simulate_new_stop.sql
├── etl/                             # dijalankan offline, hasil diupload manual/script
│   ├── load_penduduk.py
│   ├── load_poi.py
│   ├── load_survei.py
│   ├── build_fishnet_grid.py
│   ├── compute_scores.py           # CAI, TDI, Equity Index (weighted overlay + AHP)
│   └── upload_to_supabase.py       # supabase-py, push hasil compute_scores.py
└── data/
    ├── raw/
    ├── survei/                     # export dari MAPID Apps
    └── processed/
```

---

## 9. Roadmap Implementasi (selaras timeline PRD)

| Periode | Fokus Teknis |
|---|---|
| 7–13 Agu | Setup project Supabase (buat tabel, aktifkan PostGIS & RLS), setup Vercel + React+Vite+MapLibre kosong dengan basemap MAPID Maps tampil, mulai ETL data BPS/OSM/Dapodik di Python |
| 14–20 Agu | Selesaikan ETL, isi `grid_analisis` (fishnet), `compute_scores.py` versi awal (bobot masih dummy), upload ke Supabase, tampilkan sebagai layer di peta |
| 21–27 Agu | Sesi AHP dengan mentor → update bobot final di `compute_scores.py`, re-upload skor, buat RPC `simulate_new_stop`, mulai integrasi data survei lapangan yang masuk |
| 28 Agu–3 Sep | Edge Function `ai-insight` (mulai dari query skor dulu, baru sambungkan Gemini), AI Insight Panel di frontend, mode Simulasi What-If tersambung ke RPC |
| 4–10 Sep | Dashboard Indikator, Transit Equity Index View, polish UI/UX (Fajar), testing menyeluruh |
| 11–13 Sep | Validasi akhir (bandingkan skor vs data lapangan, cek narasi Gemini vs angka asli), deploy final Vercel, siapkan demo |
| 14 Sep | Submission final |

---

## 10. Environment Setup (langkah awal)

```bash
# Supabase — inisialisasi project & jalankan migration
npm install -g supabase
supabase init
supabase login
supabase link --project-ref <project-ref-kalian>
supabase db push                      # jalankan migration di supabase/migrations/

# Deploy Edge Function
supabase functions deploy ai-insight
supabase secrets set GEMINI_API_KEY=xxxxx

# ETL offline (Python)
cd etl
python -m venv venv && source venv/bin/activate
pip install geopandas shapely supabase python-dotenv
python compute_scores.py
python upload_to_supabase.py

# Frontend
cd frontend
npm create vite@latest . -- --template react
npm install maplibre-gl recharts @supabase/supabase-js
npm run dev                           # localhost:5173
vercel                                 # deploy ke Vercel Pro
```

⚠️ Sebelum basemap MAPID Maps bisa tampil di MapLibre, cek dokumentasi resmi (mapid.co.id/docs) atau mentor: format tile URL-nya, dan apakah butuh API key terpisah dari kredensial Supabase/Vercel.

---

## 11. Risiko Teknis & Mitigasi

| Risiko | Mitigasi |
|---|---|
| Integrasi MAPID Maps ternyata beda dari asumsi di atas | Cek dokumentasi resmi di minggu pertama, sebelum arsitektur "mengeras" |
| RLS Supabase tidak dikonfigurasi, data ter-expose publik | Aktifkan RLS di semua tabel sejak awal, uji dengan `anon key` sebelum data sensitif diisi |
| ETL/compute_scores.py perlu dijalankan ulang tiap ada data survei baru | Buat sebagai script sekali-jalan yang mudah diulang, bukan proses manual — jadwalkan rutin selama periode survei (7–20 Agu) |
| Bobot AHP belum final tapi development sudah jalan | Simpan bobot di satu tempat terpusat (config di `compute_scores.py` atau tabel `konfigurasi_bobot` di Supabase), gampang diupdate begitu hasil AHP final |
| Narasi Gemini menyebut angka yang salah/tidak sesuai skor | Validasi otomatis di Edge Function: bandingkan angka di narasi dengan angka input sebelum dikirim ke frontend |
| Biaya $45/bulan (Vercel+Supabase) belum jelas sumbernya | Konfirmasi ke leader: dari dana survey activity budget kompetisi atau patungan tim, sebelum kartu pembayaran didaftarkan |
| Supabase free-tier→Pro pause/limit kalau salah pilih paket | Pastikan yang aktif memang paket Pro (bukan free yang auto-pause setelah tidak aktif), terutama menjelang submission |

---

## Catatan Penting

Framework ini sudah disesuaikan dengan keputusan stack tim (Vercel Pro + Supabase Pro + Gemini API). Bagian bertanda ⚠️ masih bergantung pada detail teknis MAPID Maps yang belum bisa saya verifikasi langsung — prioritas pertama tim tetap: konfirmasi integrasi basemap ke mentor/dokumentasi resmi di minggu pertama, supaya arsitektur di atas tidak perlu dirombak di tengah jalan.

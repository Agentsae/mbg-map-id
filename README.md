# GeoTransit Insight — Tim MBG (MassTransit Based Geoinsight)

**Spatial Decision Support System (SDSS) berbasis AI** untuk optimalisasi layanan transportasi massal Kota Bekasi.
Dibangun di atas **MAPID Maps** & **GEO MAPID** untuk kompetisi **MAPID WebGIS Competition 2026** (Top 50).

## 👥 Tim
| Nama | Peran |
|---|---|
| Rafael Williem | Project Leader |
| Galuh Eka Permana | WebGIS Developer |
| Samuel Alfa Edison | Data & AI Analyst |
| Fajar Firman Firdaus | UI/UX Designer |
| Muhamad Febrian | Business / Product Analyst |

## 🎯 Tujuan
Mengubah keputusan penempatan halte/titik transit dari berbasis intuisi menjadi berbasis data spasial & AI:
- **Peta Gap Analysis** — visualisasi kesenjangan layanan transit.
- **AI Spatial Consultant** — rekomendasi prioritas + narasi kuantitatif (LLM sebagai interpreter model spasial, bukan penentu).
- **Simulasi What-If** — dampak penambahan titik layanan sebelum dibangun.

## 🧱 Stack (sesuai ketentuan kompetisi — open source)
- **Frontend:** React + Vite + MapLibre GL JS
- **Backend/Database:** Supabase (PostgreSQL + PostGIS), Edge Functions
- **AI Layer:** Claude API (Messages API, `claude-haiku-4-5-20251001`) dipanggil dari Supabase Edge Function (bukan dari frontend)
- **Data & Analisis Spasial:** QGIS, Python (GeoPandas, scikit-learn, pyproj, fiona)
- **Metodologi:** CAI (Weighted Linear Combination), TDI, Transit Equity Index, dasymetric mapping (grid 250–500 m)

## 📁 Struktur
```
mbg-webgis/
├── README.md
├── requirements.txt        # dependency Python (data/AI)
├── .gitignore
├── data/
│   ├── raw/                # data mentah hasil unduh/ekspor (di-ignore)
│   └── processed/          # hasil olahan (grid, indeks)
├── src/                    # React app (frontend)
├── supabase/
│   ├── migrations/         # skema tabel, RLS, RPC
│   └── functions/          # Edge Functions (ai-insight, dst)
└── webgis/                 # aset integrasi MAPID Maps tambahan
```

## ⚙️ Setup (lokal)

Frontend:
```bash
npm install
npm run dev
```

Python (data & AI):
```bash
python -m venv .venv && source .venv/Scripts/activate   # Windows
pip install -r requirements.txt
```

> **Penting:** API key & konfigurasi disimpan di **backend/Edge Function**, jangan pernah pakai prefix `VITE_` untuk key rahasia (Anthropic, service role) — itu akan ter-bundel ke JS publik. Lihat `.env.example` dan `.gitignore`.

## 📌 Milestone
- Survei lapangan: 7–20 Agu 2026
- Pengolahan data + AHP: 14–27 Agu 2026
- AI Spatial Consultant & WebGIS: 21 Agu–5 Sep 2026
- UI/UX final: 1–10 Sep 2026
- PRD final: 5–13 Sep 2026
- **Submission final: 14 Sep 2026**

## 📄 Dokumen
- PRD: `PRD_GeoTransitInsight-2.docx`
- Proposal: `MBG_GeoTransitInsight-2.pdf`
- Notulen TM I: `Notulen tech meet revisi.pdf`
- Framework teknis: `docs/FRAMEWORK_GeoTransitInsight.md`

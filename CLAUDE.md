# GeoTransit Insight — Konteks Proyek untuk Claude Code

> Sumber kebenaran: `PRD_GeoTransitInsight.docx` (versi terbaru, submission 13 Sep 2026).
> File ini adalah ringkasan teknis dari PRD tersebut, dibuat supaya tiap sesi Claude Code
> punya konteks yang sama tanpa perlu membaca ulang dokumen Word 1000+ baris.
> **Kalau PRD di-update, update juga file ini.**

## Stack sudah final (dikunci 24 Agustus 2026)

PRD sempat punya inkonsistensi antara tabel teks dan diagram arsitektur (MapLibre vs Leaflet, Claude AI vs Gemini). **Sudah diputuskan tim:**

| Komponen | Keputusan final |
|---|---|
| Library peta | **MapLibre GL JS** |
| AI Service | **Claude API** (Messages API, model `claude-haiku-4-5-20251001` untuk narasi cepat — lihat `supabase/functions/ai-insight/index.ts`) |

Kalau nanti ada kode/diagram lama yang masih menyebut Leaflet atau Gemini, itu sudah usang — update ke keputusan final di atas, jangan diikuti.

## Produk

**GeoTransit Insight** — Spatial Decision Support System (SDSS) berbasis WebGIS untuk membantu Dishub & Bappeda Kota Bekasi menentukan lokasi prioritas pembangunan infrastruktur transit massal berbasis data, bukan intuisi.

Prinsip inti yang TIDAK BOLEH dilanggar saat implementasi:
- **AI adalah lapisan interpretasi, bukan penentu skor.** Model spasial deterministik (weighted overlay/MCDA) menghasilkan skor terlebih dahulu; AI (LLM) hanya menerjemahkan skor itu jadi narasi. AI tidak pernah menghasilkan angka sendiri.
- **API key AI tidak boleh menyentuh frontend.** Hanya dipanggil dari Supabase Edge Function (server-side).
- **Setiap skor harus bisa ditelusuri** — user klik lokasi di peta, sistem tunjukkan rincian kontribusi tiap kriteria, bukan cuma angka tunggal (lihat acceptance criteria Composite Accessibility Index di bawah).

## Tech Stack

| Layer | Teknologi |
|---|---|
| Frontend | React.js + MapLibre GL JS + MAPID Maps sebagai basemap |
| Backend | Supabase Pro (PostgreSQL + PostGIS terkelola, auto-REST API, Storage untuk foto survei, Edge Functions) |
| Database | PostgreSQL + PostGIS via Supabase |
| GIS Platform | GEO MAPID (pengolahan data & analisis lokasi), Community Maps MAPID (sumber POI: Menu Go, Struk Go) |
| AI | Claude API (Messages API), model `claude-haiku-4-5-20251001`, dipanggil via Supabase Edge Function — API key di server (`ANTHROPIC_API_KEY`, bukan `VITE_...`) |
| Hosting | Vercel Pro (frontend) + Supabase Pro (backend/db) — hybrid, domain publik lewat subdomain resmi WebGIS MAPID (CNAME ke Vercel) |
| Repo | GitHub, privat selama pengembangan |

## Struktur Data / Metodologi (jangan diubah tanpa alasan kuat)

- **Composite Accessibility Index (CAI)** — Weighted Linear Combination dari: kepadatan penduduk, jarak ke fasilitas umum (inverse), volume penumpang transit terdekat, skor survei lapangan. Bobot ditentukan lewat AHP bersama mentor.
- **Transit Desert Index (TDI)** — per grid 250–500m (dasymetric mapping), rasio kebutuhan mobilitas terhadap skor aksesibilitas transit.
- **Transit Equity Index** — CAI + dimensi kerentanan sosial (usia rentan, akses pendidikan/kesehatan/kerja) per kelurahan. Ranking ketimpangan, bukan ranking prioritas lokasi.
  **PENTING (arah skala, jangan sampai terbalik):** kolom `skor_final` pada tabel `skor_equity`
  adalah skor KETIMPANGAN (equity gap), BUKAN skor "seberapa equitable" dalam arti tinggi=bagus.
  Semakin TINGGI `skor_final`, semakin DIRUGIKAN/TERTINGGAL kelurahan tsb secara akses transit
  (CAI di-inverse dulu sebelum masuk formula — lihat `etl/compute_scores.py`
  `compute_equity_index()`). **Ranking 1 = `skor_final` tertinggi = kelurahan paling butuh
  intervensi** (bukan kelurahan paling equitable/paling baik kondisinya). Konsisten dengan
  `EquityIndexView.jsx` (frontend) yang sudah menampilkan penjelasan "skor lebih tinggi = lebih
  dirugikan" di UI — pertahankan konvensi ini di narasi AI, dokumen, dan kode baru mana pun yang
  menyebut istilah ini.
- Simulasi What-If pakai estimasi jalan kaki (kecepatan 4–5 km/jam), BUKAN network routing riil (eksplisit out-of-scope).
- **Angka profil Kota Bekasi (kanonik, diseragamkan tim 2026-08-28).** Sumber kebenaran: `etl/data/demografi/profil_kota_kanonik.json`, dari **DKB Semester I 2026** (Dinas Dukcapil Kota Bekasi): **2.607.248 jiwa / 12.387 jiwa/km² / 210,49 km²** (luas BPS Kota Bekasi Dalam Angka) / **usia produktif 15–64 th 70,98%** (= 1.850.727 jiwa). Populasi kanonik = Σ `penduduk.jumlah_penduduk` di database. JANGAN reintroduksi angka lama `2.595.927`, `12.333`, `70,99`, atau sumber "DKB Semester II 2025" di kode, dokumen, maupun narasi AI.

## Fitur & Acceptance Criteria (sumber: PRD Bab 8 — pakai ini sebagai definition of done)

| Fitur | Acceptance Criteria |
|---|---|
| Peta Multi-Layer Gap Analysis | Layer kepadatan penduduk, jaringan transit eksisting, indeks gap aksesibilitas. Filter per kecamatan render ulang **< 2 detik**. |
| Composite Accessibility Index & TDI | Klik lokasi di peta → tampilkan skor + **rincian kontribusi tiap kriteria** (bukan angka tunggal tanpa penjelasan). |
| AI Spatial Consultant | Respons pertanyaan bahasa natural **< 5 detik**, pakai ringkasan data hasil model spasial — bukan raw coordinates dikirim ke LLM. |
| Simulasi "What-If" | Klik titik di peta → proyeksi penduduk tambahan terlayani + estimasi waktu tempuh jalan kaki, **< 3 detik**. |
| Transit Equity Index Dashboard | Ranking minimal **5 kelurahan** dengan kondisi aksesibilitas transit **paling timpang/tertinggal** (frasa PRD "skor equity terendah" = kondisi paling tidak equitable — di database ini berarti `skor_final` TERTINGGI pada tabel `skor_equity`, ranking = 1; lihat catatan arah skala di bagian Struktur Data di atas) + kelompok terdampak + 1 rekomendasi intervensi per kelurahan. |
| Dashboard Indikator | Coverage ratio, jumlah transit desert teridentifikasi, potensi penerima manfaat — dari data yang sudah divalidasi. |
| Export Report | Unduh ringkasan (peta + indikator kunci) sebagai PDF atau gambar. |

## In-Scope vs Out-of-Scope (Bab 3 — supaya tidak over-engineer)

**Jangan bangun (eksplisit out-of-scope):**
- Network routing riil / jadwal transit / lalu lintas real-time — pakai estimasi jalan kaki saja
- Survei okupansi skala kota penuh — pakai sampel jam puncak
- Prediksi operasional KRL/BRT real-time
- Aplikasi mobile native
- Integrasi ticketing/pembayaran
- Sistem manajemen user multi-role enterprise

## Referensi Visual

Wireframe/mockup dashboard resmi ada di lampiran PRD (Gambar 3) — sidebar nav: Dashboard, Peta Interaktif, Analisis Spasial, AI Spatial Consultant, Simulasi Skenario, Rekomendasi, Data & Laporan, Pengaturan. Dashboard utama berisi: ringkasan Kota Bekasi (populasi, kepadatan, luas, usia produktif, indeks aksesibilitas rata-rata), kartu Transit Desert count, kartu Usulan Halte Prioritas, kartu Potensi Penerima Manfaat, Top 3 Rekomendasi AI (skor dampak, potensi manfaat, estimasi biaya), dan panel Simulasi Skenario dengan dropdown pilihan skenario.

## Jalur Kritis (lihat docs/BUILD_CHECKLIST.md untuk urutan tugas)

Hari ini: 24 Agustus 2026. Submission: **13 September 2026**.

```
29-30 Agu  Field Day 3 survei (terakhir, 70 titik total)
31 Agu-6 Sep  Data processing (CAI, TDI, Equity Index dihitung)
7-12 Sep   Development inti + AI + simulasi + deployment  ← HANYA 6 HARI, PALING BERISIKO
13 Sep     Submission final
```

**Strategi wajib:** bangun seluruh fitur dengan data sintetis/dummy MULAI SEKARANG, jangan tunggu 31 Agustus. Setiap komponen yang butuh data (peta, dashboard, AI panel) harus punya fallback ke data contoh kalau tabel Supabase masih kosong — supaya swap ke data asli nanti tinggal ganti sumber, bukan bangun dari nol di jendela 6 hari yang sempit.

## Subagents — pembagian kerja 5 peran PRD lewat Claude Code

Proyek ini dikerjakan solo (Sam), tapi PRD mendefinisikan 5 peran. Untuk menjaga struktur dan mempercepat kerja, 5 peran itu dipetakan jadi subagent di `.claude/agents/`. **Delegasikan secara eksplisit berdasarkan jenis tugas:**

- Tugas peta/komponen React/wiring Supabase di frontend → gunakan agent `webgis-developer`
- Tugas formula CAI/TDI/Equity Index, migration SQL, ETL Python, Edge Function AI → gunakan agent `data-ai-analyst`
- Tugas styling/tampilan/kesesuaian dengan mockup resmi → gunakan agent `ui-ux-designer`
- Tugas cek acceptance criteria, sinkronisasi PRD/dokumen, narasi non-teknis → gunakan agent `product-analyst`
- Tugas orientasi awal sesi, cek jalur kritis timeline, audit kebersihan repo → gunakan agent `project-lead`
- Tugas menjalankan/mengukur langsung (build, performa, kebenaran angka, regresi) → gunakan agent `qa-tester`

`qa-tester` beda dengan `product-analyst`: yang satu menilai konsep dari membaca kode/dokumen, yang satu mengeksekusi dan mengukur angka sungguhan. Jalankan `qa-tester` setelah `webgis-developer` atau `data-ai-analyst` melapor selesai — jangan anggap "selesai" sebelum diverifikasi empiris, terutama untuk tiga acceptance criteria berbasis waktu (< 2 detik, < 3 detik, < 5 detik).

Subagent tidak bisa memanggil subagent lain (tidak ada nesting), jadi orkestrasi tetap dari sesi utama — panggil satu per satu atau paralel sesuai kebutuhan, lalu sintesis hasilnya di sesi utama.



- `README.md` dan `.gitignore` sempat punya conflict marker git yang ter-commit — cek sudah bersih atau belum
- RLS (Row Level Security) di Supabase — pastikan aktif di semua tabel, publik hanya boleh baca
- `.env` — pastikan tidak ada `ANTHROPIC_API_KEY` dengan prefix `VITE_` (akan ter-bundel ke frontend publik); gunakan `ANTHROPIC_API_KEY` sebagai Supabase secret, bukan `.env` frontend

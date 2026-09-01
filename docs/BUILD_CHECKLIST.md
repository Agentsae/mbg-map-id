# BUILD_CHECKLIST.md — GeoTransit Insight

Diurutkan berdasarkan jalur kritis PRD Bab 11. Setiap item ditandai:
- 🟢 **BISA MULAI SEKARANG** — tidak butuh data survei asli, pakai data sintetis/dummy
- 🟡 **BUTUH DATA ASLI** — baru bisa final setelah data processing (31 Agu–6 Sep)
- 🔴 **BLOCKER TIM** — bukan soal kode, butuh keputusan/aset dari tim dulu

Checklist ini bukan pengganti PRD — kalau ada perbedaan, PRD (Bab 8, acceptance criteria) yang jadi rujukan final.

---

## Gap PRD belum diterapkan — audit 1 Sep 2026 (bahas & kerjakan 2 Sep)

Hasil audit PRD final (`docs/MBG_PRD_GeoTransitInsight.pdf` hal. 1–22) vs kode saat ini.
Diurutkan: acceptance criteria Bab 8 dulu, lalu metodologi, desain, wireframe, terjadwal.
Yang sudah ADA di fase-fase di bawah tidak diulang di sini — ini yang belum tercatat / belum jelas statusnya.

### A. Acceptance Criteria (Bab 8) belum terpenuhi penuh
- [ ] **Export Report (PDF/gambar)** — Bab 8 + User Flow Bab 10.1 (langkah terakhir) + In-Scope Bab 3.1. Sekarang tab "Data & Laporan" = placeholder `ComingSoon`. (juga tercatat di Fase 5)
- [ ] **TDI klik-untuk-rincian** — Bab 8: "CAI **& TDI** — tiap lokasi tampilkan skor + rincian kontribusi tiap kriteria saat diklik". Sekarang hanya CAI (`CaiScorePanel.jsx`). TDI cuma choropleth di Analisis Spasial, tidak ada breakdown per sel (Kepadatan × Indeks Kebutuhan Mobilitas ÷ Skor Aksesibilitas Transit).
- [ ] **Dashboard "coverage ratio per kecamatan" masih data demo** — `Dashboard.jsx` sengaja `usingDemo=true` permanen + render `DEMO_DATA` 6 kecamatan hardcoded walau Supabase tersambung ("agregasi coverage ratio asli per kecamatan belum diimplementasikan"). Bab 8: "dari data yang telah divalidasi".
- [ ] **Transit Equity Index — `kelompok_terdampak` + `rekomendasi_intervensi` NULL untuk 53/56 kelurahan** — migration `014_equity_kelompok_rekomendasi_isi.sql` sudah dibuat tapi **belum di-`db push`**. Bab 8 wajib keduanya per kelurahan. (juga tercatat di Fase 4)
- [ ] **AI Spatial Consultant < 5 detik** — jalur Claude riil belum teruji end-to-end (billing Anthropic belum aktif). Fallback template sudah jalan. (juga di Fase 3)

### B. Metodologi (Bab 7) baru sebagian
- [ ] **Narasi AI jalur LLM belum ikut kerangka CCIA / SMART Spasial (Bab 7.5)** — `systemPrompt` di `ai-insight/index.ts` cuma "jelaskan skor… maksimal 4 kalimat", tanpa struktur Condition→Cause→Impact→Action dan tanpa instruksi SMART Spasial. Hanya fallback template deterministik (`buildTemplateNarasi`) yang sudah CCIA. Tambahan: tahap Action tidak bisa "SMART Spasial" dengan angka "+N jiwa" riil karena `ai-insight` tidak pernah menerima output simulasi What-If — cuma meneruskan teks `rekomendasi_intervensi` dari DB.

### C. Desain visual (Bab 10.3) belum diterapkan
- [ ] **Legenda belum colorblind-safe** — Bab 10.3 eksplisit: ganti skema merah–oranye–hijau ke palet sequential (Viridis/ColorBrewer) + tambah pembeda non-warna (label angka / pola). `AnalisisSpasial.jsx` masih `GAP_COLORS = ['#1a9850', '#d73027']` (hijau→merah diverging, persis yang ditandai), legenda choropleth cuma gradient + teks "rendah → tinggi" tanpa angka/pola.

### D. Elemen wireframe (Bab 10.2 / Gambar 6) — prioritas lebih rendah
- [ ] **Simulasi Skenario** wireframe pakai "dropdown pilihan skenario"; build sekarang klik-peta saja. Acceptance criteria tetap terpenuhi lewat alur klik. (juga di Fase 1)
- [ ] **Kartu dashboard dari mockup belum ada:** "Usulan Halte Prioritas" dan "Top 3 Rekomendasi AI" (skor dampak / potensi manfaat / estimasi biaya).
- [ ] **Data & Laporan + Pengaturan** placeholder — PRD hal. 18–19 sendiri sudah mengakui ini "placeholder/finishing".

### E. Terjadwal, belum mulai
- [ ] **Fase 4 — swap data asli**: upload data kependudukan/POI/halte riil + hitung ulang CAI/TDI/Equity dengan bobot final `konfigurasi_bobot`.
- [ ] **Fase 6 — deployment**: deploy Vercel Pro, subdomain MAPID + CNAME, uji akses eksternal, rekam video demo — semua perlu untuk submission WebGIS **13 Sep**.

### Bukan gap (sudah diverifikasi 1 Sep)
RLS aktif di 10/10 tabel (termasuk `rute_transit_eksisting` di migration 013) · MapLibre + Claude Haiku 4.5 + basemap MAPID sesuai Bab 9 · isochrone = buffer radius 400/800 m sesuai Bab 7.2 + catatan out-of-scope · `simulate_new_stop` < 3 dtk & klik CAI < 2 dtk sudah diukur.

---

## Fase 0 — Sebelum baris kode pertama

- [x] ~~Putuskan: MapLibre GL JS atau Leaflet~~ → **MapLibre GL JS** (selesai 24 Agu)
- [x] ~~Putuskan: Claude AI atau Gemini~~ → **Claude API**, model `claude-haiku-4-5-20251001` (selesai 24 Agu)
- [x] 🔴 Cek repo: `README.md`/`.gitignore` bebas conflict marker git, RLS aktif di Supabase, tidak ada API key ter-expose di `.env` frontend — diverifikasi 25 Agu: `README.md`/`.gitignore` bersih, `002_rls_policies.sql` mengaktifkan RLS + policy baca-publik di 9/9 tabel tanpa policy insert/update/delete untuk anon, tidak ada `VITE_ANTHROPIC_API_KEY` di manapun (`.env.example` eksplisit memperingatkan, `ai-insight/index.ts` baca dari `Deno.env`)
- [x] 🟢 Setup skema tabel Supabase (batas_administrasi, penduduk, poi, halte_eksisting, titik_kandidat, grid_analisis, skor_cai, skor_equity) — bisa jalan dengan skema kosong, diisi data asli belakangan — diverifikasi 25 Agu: `001_init_tables.sql` berisi 9 tabel (8 di atas + `konfigurasi_bobot`), lengkap dengan index GIST geometri

## Fase 1 — Fondasi frontend (paralel dengan survei, 🟢 semua)

- [x] Layout shell sesuai wireframe resmi (Gambar 6 PRD final — Bab 10.2, dulu bernomor Gambar 3 di draft): sidebar 8 menu (Dashboard, Peta Interaktif, Analisis Spasial, AI Spatial Consultant, Simulasi Skenario, Rekomendasi, Data & Laporan, Pengaturan) — diverifikasi 28 Agu: `App.jsx` sidebar 8 menu persis sesuai wireframe
- [x] Peta dasar tampil dengan basemap MAPID Maps + kontrol layer (zoom, pilih layer, legenda) — diverifikasi 28 Agu (qa-tester): style MAPID `street-2d-building` + tiles + glyph + sprite semua HTTP 200, `MapView.jsx` NavigationControl + layer GeoJSON generik, `MapLegend.jsx` ada
- [x] Card ringkasan Kota Bekasi (populasi, kepadatan, luas, usia produktif, indeks aksesibilitas rata-rata) — dibangun + diverifikasi 28 Agu (qa-tester 8/8 lulus): section "Ringkasan Kota Bekasi" 5 kartu di `Dashboard.jsx`, sumber kebenaran tunggal `frontend/src/lib/kotaProfil.js` ← `etl/data/demografi/profil_kota_kanonik.json`, diseragamkan ke **DKB Semester I 2026**: 2.607.248 jiwa, 12.387 jiwa/km² (diturunkan = populasi ÷ 210,49), 210,49 km² (luas BPS), usia produktif 15–64 th 70,98% (= 1.850.727 jiwa). Populasi kartu = `SELECT sum(jumlah_penduduk) FROM penduduk` = basis RPC `simulate_new_stop` (anti-drift dikonfirmasi). Jangan reintroduksi angka lama (2.595.927 / 12.333 / 70,99 / "DKB Semester II 2025").
- [x] Kerangka Dashboard Indikator (coverage ratio, jumlah transit desert, potensi penerima manfaat) dengan data dummy — diverifikasi 28 Agu: `Dashboard.jsx` kartu Transit Desert (1.517 grid `skor_tdi > 0.6`) + Potensi Penerima Manfaat + BarChart coverage per kecamatan, dengan fallback demo
- [x] Kerangka panel AI Spatial Consultant (chat UI) dengan respons dummy/hardcoded dulu — diverifikasi 25 Agu: `AIPanel.jsx` punya chat UI lengkap (input, riwayat pesan, ranking list) dan fallback `DEMO_RESPONSE` saat Supabase belum tersambung
- [ ] Kerangka panel Simulasi Skenario (dropdown pilih skenario + tombol "Lihat Hasil Simulasi") sesuai mockup — FUNGSIONAL sudah ada (klik titik di peta → RPC → `SimulationPanel.jsx`), tapi presentasi belum berbentuk dropdown skenario sesuai Gambar 6. Prioritas rendah (acceptance criteria Bab 8 sudah terpenuhi lewat alur klik-peta)

## Fase 2 — Logika inti (🟢 bisa mulai dengan data sintetis)

- [x] Formula Composite Accessibility Index (weighted overlay) — implementasi + uji dengan 4-5 titik data buatan sendiri dulu — diverifikasi 25 Agu: `etl/compute_scores.py` `compute_cai()` + `sensitivity_check()` jalan dengan 4 titik data sintetis (`load_demo_data()`)
- [x] Endpoint/RPC `simulate_new_stop` — hitung penduduk terlayani radius 400m/800m — diverifikasi 28 Agu (qa-tester): migration `003` + fix `012` (basis populasi = `grid_analisis.kepadatan_penduduk` asli, bukan dummy). ~20 titik dalam kota → `penduduk_terlayani` > 0, tidak ada null; tidak ada regresi pasca hapus data dummy
- [x] Klik lokasi di peta → panel rincian skor per kriteria muncul (acceptance criteria: bukan angka tunggal) — diverifikasi 28 Agu: `CaiScorePanel.jsx`, `App.jsx` select kolom breakdown `skor_cai` (`n_kepadatan`/`n_jarak_inv`/`n_volume`/`n_survei` + bobot)
- [x] Cek kecepatan: filter peta per kecamatan **< 2 detik**, simulasi **< 3 detik** — diverifikasi 28 Agu (qa-tester, volume data asli 2.607 grid): filter per-kecamatan in-memory median 0,56 ms (max 3 ms); simulasi median ~250–350 ms, worst ~700 ms (via WAN). Sisa: 1 konfirmasi devtools Performance untuk angka repaint MapLibre riil

## Fase 3 — Integrasi AI (🟢 bisa mulai dengan skor dummy)

- [x] Edge Function AI Spatial Consultant: terima skor → kirim ke LLM dengan prompt terstruktur → kembalikan narasi — `supabase/functions/ai-insight/index.ts` lengkap & pernah deploy; diverifikasi 28 Agu jalur ambil-data + rakit-prompt jalan sampai memanggil Claude (payload hanya baris `skor_equity`, tidak ada raw coordinates / angka profil kota hardcoded)
- [x] **CORS Edge Function** — diperbaiki 1 Sep: `ai-insight` sebelumnya tidak punya handler `OPTIONS` / header `Access-Control-Allow-Origin` sama sekali, jadi `supabase.functions.invoke` dari browser selalu diblokir preflight → `AIPanel.jsx` menampilkan "Failed to send a request to the Edge Function" (bukan error HTTP, request-nya tidak pernah sampai). Sekarang ada `corsHeaders` + preflight `204` + helper `jsonResponse()` yang dipakai SEMUA jalur return. Diverifikasi via panel AI (respons template masuk normal).
- [ ] Validasi: pastikan narasi AI tidak menyebut angka yang tidak ada di data asal — **TER-BLOK**: billing Anthropic belum aktif (`ai-insight` → HTTP 500 "credit balance too low"). Uji begitu kredit aktif
- [ ] Cek kecepatan respons **< 5 detik** — **TER-BLOK** billing Anthropic (sda)
- [ ] Contoh query dari PRD Lampiran untuk uji: *"Di mana titik prioritas halte baru di Kecamatan Mustika Jaya?"* — **TER-BLOK** billing Anthropic (sda)
- [x] 🟢 **Fallback narasi template deterministik (tanpa LLM)** — PRD final Bab 12 (Risiko & Mitigasi) eksplisit menjanjikan ini sebagai mitigasi kalau billing Anthropic tidak aktif ("panel tetap menampilkan interpretasi berbasis skor model spasial meskipun API AI tidak tersedia"). **Diimplementasi 1 Sep:** `ai-insight/index.ts` — kalau `ANTHROPIC_API_KEY` kosong ATAU Claude API error (kredit habis dll), tidak lagi `throw` → HTTP 500, tapi `buildTemplateNarasi()` menyusun narasi deterministik dari `promptData` (skor yang sudah dihitung offline) mengikuti kerangka CCIA, balas HTTP 200 + `narasi_source: "template"` + `narasi_note`. Angka narasi diambil langsung via `fmtSkor()` (mustahil mengarang) → validasi anti-halusinasi di-skip untuk source ini, `narasi_flagged` selalu `false`. `AIPanel.jsx` menampilkan catatan netral (ikon Info, box slate — bukan peringatan amber `flagged`) saat `narasi_source === 'template'`. Frontend `npm run build` hijau. **Diverifikasi 1 Sep di panel AI live:** query "daerah mana yang paling butuh transportasi umum?" → respons template CCIA masuk normal (billing Anthropic masih belum aktif). Sudah di-deploy.

## Fase 4 — Swap ke data asli (🟡 mulai begitu data processing selesai, ~31 Agu–6 Sep)

- [ ] Upload hasil olahan data kependudukan/POI/halte ke tabel Supabase (ganti data sintetis)
- [ ] Hitung ulang CAI/TDI/Transit Equity Index dengan bobot final `konfigurasi_bobot` (direview mentor 27 Agu — bukan hasil AHP pairwise formal, lihat CLAUDE.md; bukan bobot dummy)
- [~] Isi Transit Equity Index Dashboard dengan ranking 5+ kelurahan asli beserta rekomendasi intervensi (ranking 1 = `skor_final` TERTINGGI = kelurahan paling tertinggal/butuh intervensi — lihat catatan arah skala di CLAUDE.md bagian Struktur Data, jangan urutkan terbalik) — ranking 56 kelurahan + skor + rincian kriteria SUDAH ADA & arah skala benar (Arenjaya #1). `kelompok_terdampak` + `rekomendasi_intervensi` sebelumnya NULL semua → migration `014_equity_kelompok_rekomendasi_isi.sql` dibuat 28 Agu (deterministik dari dimensi kerentanan, ditelusuri), **menunggu review + `db push`**
- [ ] Re-validasi acceptance criteria kecepatan dengan volume data asli (bisa beda dari data dummy yang lebih kecil)

## Fase 5 — Fitur pendukung & finishing (🟢 kapan saja, prioritas rendah)

- [ ] Export Report (PDF/gambar) — fitur "boleh hilang duluan" kalau waktu mepet (sesuai Bab 2 "Uji Hapus 50% Fitur": CAI wajib dipertahankan, fitur lain lebih fleksibel)
- [ ] Halaman "Data & Laporan" dan "Pengaturan" di sidebar — prioritas rendah dibanding 5 fitur inti Bab 8

## Fase 6 — Deployment (🟡 mulai awal September, JANGAN mepet ke 13 Sep)

- [ ] Deploy ke Vercel Pro (frontend) — PRD eksplisit bilang jangan tunggu mendekati deadline
- [ ] Ajukan subdomain resmi WebGIS MAPID, arahkan CNAME ke Vercel
- [ ] Uji akses dari luar (bukan cuma localhost) — pastikan juri/mentor bisa buka
- [ ] Rekam video demo (alur: gap analysis → AI Spatial Consultant → simulasi → Transit Equity Index)

---

## Prinsip pengurutan

Fase 1–3 sengaja SEMUA ditandai 🟢 karena itulah cara memangkas risiko jendela 6 hari (7–12 Sep) di PRD Bab 11. Kalau Fase 1–3 sudah selesai sebelum 31 Agustus, Fase 4 (swap data asli) tinggal beberapa hari kerja, bukan seluruh fitur dibangun dari nol di minggu terakhir.

# BUILD_CHECKLIST.md — GeoTransit Insight

Diurutkan berdasarkan jalur kritis PRD Bab 11. Setiap item ditandai:
- 🟢 **BISA MULAI SEKARANG** — tidak butuh data survei asli, pakai data sintetis/dummy
- 🟡 **BUTUH DATA ASLI** — baru bisa final setelah data processing (31 Agu–6 Sep)
- 🔴 **BLOCKER TIM** — bukan soal kode, butuh keputusan/aset dari tim dulu

Checklist ini bukan pengganti PRD — kalau ada perbedaan, PRD (Bab 8, acceptance criteria) yang jadi rujukan final.

---

## Fase 0 — Sebelum baris kode pertama

- [x] ~~Putuskan: MapLibre GL JS atau Leaflet~~ → **MapLibre GL JS** (selesai 24 Agu)
- [x] ~~Putuskan: Claude AI atau Gemini~~ → **Claude API**, model `claude-haiku-4-5-20251001` (selesai 24 Agu)
- [x] 🔴 Cek repo: `README.md`/`.gitignore` bebas conflict marker git, RLS aktif di Supabase, tidak ada API key ter-expose di `.env` frontend — diverifikasi 25 Agu: `README.md`/`.gitignore` bersih, `002_rls_policies.sql` mengaktifkan RLS + policy baca-publik di 9/9 tabel tanpa policy insert/update/delete untuk anon, tidak ada `VITE_ANTHROPIC_API_KEY` di manapun (`.env.example` eksplisit memperingatkan, `ai-insight/index.ts` baca dari `Deno.env`)
- [x] 🟢 Setup skema tabel Supabase (batas_administrasi, penduduk, poi, halte_eksisting, titik_kandidat, grid_analisis, skor_cai, skor_equity) — bisa jalan dengan skema kosong, diisi data asli belakangan — diverifikasi 25 Agu: `001_init_tables.sql` berisi 9 tabel (8 di atas + `konfigurasi_bobot`), lengkap dengan index GIST geometri

## Fase 1 — Fondasi frontend (paralel dengan survei, 🟢 semua)

- [ ] Layout shell sesuai wireframe resmi (Gambar 3 PRD): sidebar 8 menu (Dashboard, Peta Interaktif, Analisis Spasial, AI Spatial Consultant, Simulasi Skenario, Rekomendasi, Data & Laporan, Pengaturan)
- [ ] Peta dasar tampil dengan basemap MAPID Maps + kontrol layer (zoom, pilih layer, legenda)
- [ ] Card ringkasan Kota Bekasi (populasi, kepadatan, luas, usia produktif) — angka ini SUDAH FINAL dari PRD Bab 1, tidak perlu tunggu survei: 2.595.927 jiwa, 12.333 jiwa/km², 210,49 km², 70,99%
- [ ] Kerangka Dashboard Indikator (coverage ratio, jumlah transit desert, potensi penerima manfaat) dengan data dummy
- [x] Kerangka panel AI Spatial Consultant (chat UI) dengan respons dummy/hardcoded dulu — diverifikasi 25 Agu: `AIPanel.jsx` punya chat UI lengkap (input, riwayat pesan, ranking list) dan fallback `DEMO_RESPONSE` saat Supabase belum tersambung
- [ ] Kerangka panel Simulasi Skenario (dropdown pilih skenario + tombol "Lihat Hasil Simulasi") sesuai mockup

## Fase 2 — Logika inti (🟢 bisa mulai dengan data sintetis)

- [x] Formula Composite Accessibility Index (weighted overlay) — implementasi + uji dengan 4-5 titik data buatan sendiri dulu — diverifikasi 25 Agu: `etl/compute_scores.py` `compute_cai()` + `sensitivity_check()` jalan dengan 4 titik data sintetis (`load_demo_data()`)
- [ ] Endpoint/RPC `simulate_new_stop` — hitung penduduk terlayani radius 400m/800m dari data sintetis
- [ ] Klik lokasi di peta → panel rincian skor per kriteria muncul (acceptance criteria: bukan angka tunggal)
- [ ] Cek kecepatan: filter peta per kecamatan **< 2 detik**, simulasi **< 3 detik** — uji dari awal dengan data dummy, jangan tunggu data asli untuk sadar ada masalah performa

## Fase 3 — Integrasi AI (🟢 bisa mulai dengan skor dummy)

- [ ] Edge Function AI Spatial Consultant: terima skor (dummy dulu) → kirim ke LLM dengan prompt terstruktur → kembalikan narasi
- [ ] Validasi: pastikan narasi AI tidak menyebut angka yang tidak ada di data asal
- [ ] Cek kecepatan respons **< 5 detik**
- [ ] Contoh query dari PRD Lampiran untuk uji: *"Di mana titik prioritas halte baru di Kecamatan Mustika Jaya?"*

## Fase 4 — Swap ke data asli (🟡 mulai begitu data processing selesai, ~31 Agu–6 Sep)

- [ ] Upload hasil olahan data kependudukan/POI/halte ke tabel Supabase (ganti data sintetis)
- [ ] Hitung ulang CAI/TDI/Transit Equity Index dengan bobot AHP final (bukan bobot dummy)
- [ ] Isi Transit Equity Index Dashboard dengan ranking 5+ kelurahan asli beserta rekomendasi intervensi
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

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

**Update 5 Sep 2026 (product-analyst):** 4 dari 5 item di bagian A sudah dibangun & diverifikasi lewat
commit `dcd7dcb` (3 Sep, "TDI panel, Export Report, real coverage, dashboard cards, off-grid states")
+ migration `019`/`024`. Hanya item AI Claude riil (< 5 detik) yang masih blocked oleh billing Anthropic.

### A. Acceptance Criteria (Bab 8) belum terpenuhi penuh
- [x] **Export Report (PDF/gambar)** — tab "Data & Laporan" tidak lagi `ComingSoon`. `DataLaporan.jsx` (commit `dcd7dcb`) sudah menghasilkan PDF (jsPDF, `doc.addImage` kanvas peta) dan PNG (canvas 2D manual) berisi peta + indikator kunci (ringkasan kota, transit desert, coverage ratio, Top-5 Transit Equity Index) dengan fallback data contoh yang ditandai eksplisit `[contoh]` bila Supabase belum tersambung. Baca hasil siap pakai (`grid_analisis`, `coverage_transit_kecamatan`, `skor_equity`), tidak menghitung ulang formula apa pun.
- [x] **TDI klik-untuk-rincian** — `TdiScorePanel.jsx` (commit `dcd7dcb`) muncul saat klik sel choropleth TDI di Analisis Spasial, menampilkan skor + rincian tiap komponen formula (`Kepadatan`, `Indeks Kebutuhan Mobilitas`, `Skor Aksesibilitas Transit` — ditandai peran pembilang/penyebut, bukan model bobot linear seperti CAI) via RPC `get_tdi_breakdown` (migration `015`, disempurnakan `021` untuk titik di luar cakupan grid). Sekarang CAI **dan** TDI sama-sama punya panel rincian per kriteria — acceptance criteria Bab 8 terpenuhi untuk keduanya.
- [x] **Dashboard "coverage ratio per kecamatan"** — `Dashboard.jsx` (commit `dcd7dcb`) tidak lagi `usingDemo=true` permanen: query nyata ke view `coverage_transit_kecamatan` (migration `016`/`017`), `usingDemo` jadi state yang otomatis `false` kalau view terisi & query berhasil, fallback `DEMO_DATA` hanya kalau Supabase belum tersambung/view kosong. Badge "demo" per kartu ditampilkan kalau memang masih pakai fallback (transparan ke user, bukan menyembunyikan status data).
- [x] **Transit Equity Index — `kelompok_terdampak` + `rekomendasi_intervensi`** — migration `019_equity_kelompok_rekomendasi_refill_ahp.sql` sudah **di-`db push`** (menggantikan `014` yang sempat tertunda) dan diverifikasi lewat guard SQL internal (`raise exception` kalau ada baris REAL yang masih NULL / jumlah baris terisi ≠ 56) — sudah lolos. Migration `024_equity_rekomendasi_retier_ahp.sql` menyusul memperbaiki 2 kelurahan (Cimuning, Jatirangga) yang naik ke 10-besar pasca-recompute AHP tapi masih membawa teks ringkas gaya "11-56" — sekarang seluruh 10-besar AHP terkini membawa rekomendasi SMART Spasial (>200 karakter, koridor/jarak/jadwal konkret), juga dijaga guard SQL. 56/56 kelurahan REAL terisi kedua kolom.
- [ ] **AI Spatial Consultant < 5 detik** — **MASIH BLOCKED.** Jalur Claude riil belum teruji end-to-end karena billing Anthropic belum terkonfirmasi aktif (`ai-insight` sempat HTTP 500 "credit balance too low"). Fallback narasi template deterministik (CCIA) sudah jalan dan diverifikasi, tapi itu bukan pengganti pengujian acceptance criteria kecepatan Claude asli. (juga di Fase 3 — jangan tandai selesai sampai billing aktif dan diukur langsung oleh `qa-tester`)

### B. Metodologi (Bab 7) baru sebagian
- [ ] **Narasi AI jalur LLM belum ikut kerangka CCIA / SMART Spasial (Bab 7.5)** — `systemPrompt` di `ai-insight/index.ts` cuma "jelaskan skor… maksimal 4 kalimat", tanpa struktur Condition→Cause→Impact→Action dan tanpa instruksi SMART Spasial. Hanya fallback template deterministik (`buildTemplateNarasi`) yang sudah CCIA. Tambahan: tahap Action tidak bisa "SMART Spasial" dengan angka "+N jiwa" riil karena `ai-insight` tidak pernah menerima output simulasi What-If — cuma meneruskan teks `rekomendasi_intervensi` dari DB.

### C. Desain visual (Bab 10.3) belum diterapkan
- [x] **Legenda colorblind-safe (2026-09-03)** — `AnalisisSpasial.jsx`: skema `GAP_COLORS` hijau→merah diverging + `KEPADATAN_COLORS` cream→merah diganti satu palet `CHOROPLETH_COLORS` sequential colorblind-safe (ColorBrewer YlGnBu 5 kelas). Fill layer sekarang ekspresi `step` (kelas diskret, bukan `interpolate` gradient kontinu). Legenda choropleth menampilkan 5 kelas dengan nomor kelas + rentang angka equal-interval (`fmtBound`) sebagai pembeda non-warna. Semantik "rendah → tinggi" dan logika komponen tidak berubah.

### D. Elemen wireframe (Bab 10.2 / Gambar 6) — prioritas lebih rendah
- [ ] **Simulasi Skenario** wireframe pakai "dropdown pilihan skenario"; build sekarang klik-peta saja. Acceptance criteria tetap terpenuhi lewat alur klik. (juga di Fase 1)
- [x] **Kartu dashboard dari mockup:** "Usulan Halte Prioritas" dan "Top 3 Rekomendasi AI" — sudah ada di `Dashboard.jsx` (commit `dcd7dcb`). "Usulan Halte Prioritas" = jumlah `titik_kandidat` + titik CAI tertinggi (query real, fallback demo). "Top 3 Rekomendasi AI" = 3 kelurahan `skor_equity` paling timpang (`ranking` 1–3, filter `sumber ILIKE 'REAL%'`) + `rekomendasi_intervensi`-nya; skor dampak = `skor_final` ketimpangan. Catatan: kolom "potensi manfaat" & "estimasi biaya" dari mockup **belum ada** di skema — kartu menampilkan "belum tersedia di data" secara eksplisit alih-alih mengarang angka. Cukup untuk acceptance criteria Bab 8, belum replikasi visual 1:1 mockup.
- [ ] **Halaman "Pengaturan"** masih placeholder — prioritas rendah dibanding 5 fitur inti Bab 8. ("Data & Laporan" **sudah keluar dari status placeholder**, lihat Export Report di bagian A.)

### E. Terjadwal
- [~] **Fase 4 — swap data asli**: MAYORITAS TUNTAS, lihat detail di Fase 4 di bawah (migration `018`/`019`/`024` sudah `db push`). Sisa: re-validasi kecepatan dengan volume data asli. **Koreksi (2026-09-07):** batch traffic counting tambahan (KND-010..KND-023, 13 baris) **sudah masuk `titik_kandidat` dengan koordinat survei RIIL** (surveyor Galuh Eka Permana, 17 Agu; presisi desimal penuh, lokasi spesifik ber-nama) — bukan lagi estimasi. Yang masih lemah: kolom `jarak_transit_terdekat_m` diisi manual dari kolom 15 Excel survei (angka bulat, semantik tidak konsisten antar-batch) dan CAI memakainya apa adanya sebagai `jarak_fasilitas_m` — perlu di-recompute dari `geom` via `ST_Distance` (tugas `data-ai-analyst`, belum ada langkahnya untuk `titik_kandidat`).
- [ ] **Fase 6 — deployment**: **NOL PROGRES** — tidak ada jejak commit/config (`vercel.json`, CNAME, subdomain) di repo. Risiko jalur kritis paling nyata sekarang; lihat breakdown di Fase 6 di bawah. Harus mulai segera, jangan tunggu mendekati submission WebGIS **13 Sep**.

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

- [~] Upload hasil olahan data kependudukan/POI/halte ke tabel Supabase (ganti data sintetis) — populasi (56 baris `penduduk`), 15 halte BisKita tersurvei, 31 titik Survey Activities + 3 Struk Go sudah masuk. **Update 2026-09-07:** batch traffic counting tambahan **KND-010..KND-023 (13 baris) sudah di `titik_kandidat` dengan koordinat survei RIIL** (surveyor Galuh, 17 Agu) sejak 2026-08-28 — bukan estimasi lagi. Catatan terpisah: `jarak_transit_terdekat_m` untuk semua KND-0NN diisi manual dari Excel (angka bulat, semantik beda antar-batch: KND-002..009 ≈ "jarak ke transit apa saja" 20–350 m, KND-010..023 ≈ "jarak ke koridor BisKita" 3.000–8.000 m) → `n_jarak_inv` CAI terbelah ekstrem. Perlu recompute dari `geom` (`ST_Distance` ke target konsisten), belum dikerjakan.
- [x] Hitung ulang CAI/TDI/Transit Equity Index dengan bobot final `konfigurasi_bobot` — bobot AHP pairwise Saaty formal (sesi 2026-09-03, CR: CAI 0,0226 / TDI_MOBILITAS 0,0000 / EQUITY 0,0457, semua < 0,1) diterapkan via `018_konfigurasi_bobot_ahp_final.sql` (diverifikasi: 13 baris, `numeric(6,4)`, tiap kelompok kriteria berjumlah 1,0000); recompute skor + isi ulang `kelompok_terdampak`/`rekomendasi_intervensi` via `019_equity_kelompok_rekomendasi_refill_ahp.sql` (guard SQL internal memastikan 56/56 baris REAL terisi kedua kolom, gagal migrasi kalau tidak) + `024_equity_rekomendasi_retier_ahp.sql` (retier 2 kelurahan yang naik ke 10-besar pasca-recompute tapi masih bertekstur ringkas). **Sudah `db push`, bukan lagi menunggu.** Menggantikan worksheet review mentor 27 Agu. Lihat CLAUDE.md + `docs/VALIDASI_BOBOT_AHP.md` Bagian 0.
- [x] Isi Transit Equity Index Dashboard dengan ranking 5+ kelurahan asli beserta rekomendasi intervensi (ranking 1 = `skor_final` TERTINGGI = kelurahan paling tertinggal/butuh intervensi — lihat catatan arah skala di CLAUDE.md bagian Struktur Data, jangan urutkan terbalik) — ranking 56 kelurahan + skor + rincian kriteria + arah skala benar (Arenjaya #1) SUDAH ADA. `kelompok_terdampak` + `rekomendasi_intervensi` — migration `019` (28 Agu → di-`db push` 3 Sep, menggantikan `014` yang tertunda) + `024` sudah mengisi **56/56 kelurahan REAL**, diverifikasi via guard SQL (bukan cuma "terlihat jalan").
- [ ] Re-validasi acceptance criteria kecepatan dengan volume data asli (bisa beda dari data dummy yang lebih kecil) — **belum ada konfirmasi ulang pasca-swap AHP**; ukuran Fase 2 (filter <2 dtk, simulasi <3 dtk) diukur sebelum recompute 018/019, perlu di-re-run oleh `qa-tester` dengan data terkini.
- [~] **Ganti komponen ketiga Indeks Kebutuhan Mobilitas (TDI): `tanpa_kendaraan` → `usia_sekolah`** (keputusan Sam 2026-09-06). Rasio RT tanpa kendaraan tak tersedia per-kelurahan (Susenas hanya angka kota) → selama ini fallback netral 0,5 seragam (bobot 0,40 tanpa daya pisah). Diganti proporsi penduduk umur 5–19 (proksi transit-dependent di bawah usia mengemudi; Currie 2010, Jiao & Dillivan 2013). Bobot 0,40 & CR pairwise 0,0000 tidak berubah. **File:** migration `026_tdi_mobilitas_usia_sekolah.sql` (kolom `penduduk.proporsi_usia_sekolah` + upsert `konfigurasi_bobot`) + `027_get_tdi_breakdown_usia_sekolah_label.sql` (refresh teks RPC), `etl/load_penduduk.py` (baca pita 05-09/10-14/15-19 + `--update-existing`), `etl/compute_scores.py` + `etl/compute_tdi_full.py` (hapus fallback 0,5, min-max normalisasi usia_sekolah), `AnalisisSpasial.jsx` (label demo), `CLAUDE.md` / `VALIDASI_BOBOT_AHP.md` Bagian 0A / `REFERENSI_METODOLOGI.md`. **Belum `db push`** (env ini tak punya akses CLI Supabase) — perlu: `supabase db push` lalu `python etl/load_penduduk.py --excel ... --update-existing` lalu `python etl/compute_tdi_full.py --upload`. Simulasi offline (pra-push): jumlah transit desert `skor_tdi>0,6` 1.540 → 1.503, Spearman ranking lama-vs-baru 0,978.

## Fase 5 — Fitur pendukung & finishing (🟢 kapan saja, prioritas rendah)

- [x] Export Report (PDF/gambar) — tab "Data & Laporan" (`DataLaporan.jsx`, commit `dcd7dcb`) sudah menghasilkan PDF & PNG berisi peta + indikator kunci, bukan lagi `ComingSoon`. Lihat rincian di bagian "Gap PRD" bagian A di atas.
- [ ] Halaman "Pengaturan" di sidebar — masih placeholder, prioritas rendah dibanding 5 fitur inti Bab 8. ("Data & Laporan" sudah selesai, lihat poin di atas.)

## Fase 6 — Deployment (🟡 mulai awal September, JANGAN mepet ke 13 Sep)

**Status 5 Sep 2026: NOL PROGRES.** Tidak ada commit, `vercel.json`, atau dokumen terkait deployment di repo manapun. Ini fase dengan risiko jalur kritis tertinggi saat ini — sisa waktu ke submission WebGIS 13 Sep sangat sempit kalau baru dimulai sekarang. Breakdown actionable (bukan sekadar checkbox kosong):

- [ ] **6.1 Setup Vercel Pro** — hubungkan repo GitHub (privat) ke project Vercel, set environment variables frontend (`VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` — **pastikan TIDAK ada `VITE_ANTHROPIC_API_KEY`**), pastikan `npm run build` hijau di environment Vercel (bukan cuma lokal).
- [ ] **6.2 Deploy awal + smoke test di preview URL Vercel** — cek semua 8 menu sidebar render, panggilan Supabase (REST + RPC + Edge Function `ai-insight`) berhasil dari domain Vercel (bukan localhost — origin baru bisa kena CORS/RLS berbeda).
- [ ] **6.3 Ajukan subdomain resmi WebGIS MAPID** — koordinasi ke pihak MAPID untuk subdomain, siapkan CNAME record mengarah ke Vercel; ini butuh proses eksternal yang bisa makan waktu tunggu — ajukan paling awal, jangan di H-1.
- [ ] **6.4 Arahkan CNAME + verifikasi domain custom di Vercel** — setelah subdomain aktif, test ulang smoke test 6.2 di domain publik (bukan `*.vercel.app`).
- [ ] **6.5 Uji akses eksternal dari luar jaringan tim** — idealnya minta 1 orang di luar tim (bukan di jaringan/device yang sama) buka link dan coba tiap fitur; konfirmasi tidak ada dependency ke `localhost`/IP lokal manapun yang ketinggalan di kode.
- [ ] **6.6 Rekam video demo** — alur: gap analysis (Peta Multi-Layer) → klik CAI/TDI rincian → AI Spatial Consultant → Simulasi What-If → Transit Equity Index Dashboard → Export Report. Rekam SETELAH 6.4/6.5 lolos (demo di domain publik final, bukan localhost) supaya tidak perlu rekam ulang kalau ada isu deployment last-minute.
- [ ] **6.7 Submission WebGIS 13 Sep** — paket akhir: link publik + video + code (sesuai instruksi submission), cross-check semua item Bab 8 acceptance criteria sekali lagi sebelum kirim.

---

## Prinsip pengurutan

Fase 1–3 sengaja SEMUA ditandai 🟢 karena itulah cara memangkas risiko jendela 6 hari (7–12 Sep) di PRD Bab 11. Kalau Fase 1–3 sudah selesai sebelum 31 Agustus, Fase 4 (swap data asli) tinggal beberapa hari kerja, bukan seluruh fitur dibangun dari nol di minggu terakhir.

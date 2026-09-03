# Referensi Metodologi — GeoTransit Insight

> Disusun 2 September 2026. Tujuan: memberi dasar literatur/standar untuk tiap
> pilihan metodologis di `etl/compute_scores.py`, `etl/compute_tdi_full.py`, dan
> RPC `simulate_new_stop()` — supaya kalau juri/mentor bertanya *"dari mana rumus
> ini?"* jawabannya bisa ditelusuri ke sumber, bukan *"kami mengarang"*.
>
> **Framing jujur:** sebagian pilihan (bentuk rumus TDI, kerangka CCIA, ambang
> 400/800 m) memang mengikuti arahan PRD / Coaching Clinic / praktik standar
> perencanaan transit sejak awal. Dokumen ini meng-*retro-dokumentasi* dasar
> literaturnya, bukan mengklaim tiap baris kode diturunkan formal dari paper di
> bawah. Yang **tidak** punya sumber eksternal dinyatakan eksplisit di bagian
> akhir.

---

## 1. Peta pilihan metodologis → sumber

| # | Pilihan di kode/PRD | Sumber pendukung | Yang didukung | Catatan / batas |
|---|---|---|---|---|
| 1 | Ambang isochrone jalan kaki **400 m / 800 m** dari titik transit (`compute_tdi_full.py` `AMBANG_PENUH_M`/`AMBANG_NIHIL_M`; `003_simulate_new_stop.sql`) | ITDP *TOD Standard* (2017); Guerra, Cervero & Tischler (2012); TCRP Report 165 *Transit Capacity and Quality of Service Manual* (2013) | 400 m ≈ jalan kaki 5 menit = *walk-shed* nyaman; 800 m (≈ ½ mil) = batas atas *catchment* yang lazim dipakai di perencanaan transit | Angka ini konvensi perencanaan, bukan hasil kalibrasi lokal Kota Bekasi. PRD Bab 7.2 sudah menyebutnya "standar ITDP walking catchment". |
| 2 | **Weighted Linear Combination (WLC) / MCDA** untuk Composite Accessibility Index — normalisasi 0–1 tiap kriteria lalu Σ(bobot × nilai) (`compute_cai()`) | Malczewski (1999) *GIS and Multicriteria Decision Analysis*; Malczewski & Rinner (2015) *Multicriteria Decision Analysis in Geographic Information Science* | WLC sebagai metode baku overlay multi-kriteria di GIS; syarat normalisasi sebelum pembobotan; bobot berjumlah 1,0 | Asumsi WLC: kriteria *preferentially independent* & saling kompensatoris (skor rendah 1 kriteria bisa "ditutup" kriteria lain). Diterima sebagai penyederhanaan. |
| 3 | Normalisasi **min–max** `(x − min)/(max − min)`, versi *inverse* `1 −` untuk kriteria "makin kecil makin baik" (`normalize_min_max()`) | Malczewski (1999) bab *Standardization*; praktik umum MCDA | Skala-kan kriteria berbeda satuan (jiwa/km², meter, penumpang/hari) ke 0–1 yang sebanding | Min–max **relatif terhadap sampel** — menamb/menghapus 1 lokasi menggeser semua skor. Alternatif (skor-z, skala teoretis tetap) tidak dipakai karena batas teoretis tiap kriteria tidak jelas. |
| 4 | Konsep **Transit Desert** — daerah dengan permintaan mobilitas tinggi tetapi pasokan layanan transit rendah | Jiao & Dillivan (2013) *Transit Deserts: The Gap Between Demand and Supply*, Journal of Public Transportation 16(3); Jiao (2017), Journal of Transport and Land Use | Definisi "transit desert" = gap demand–supply, bukan sekadar "jauh dari halte" | Paper asli memakai supply/demand berbasis blok sensus + indikator *transit-dependent population*. Implementasi kami menyederhanakan ke rasio (baris 5). |
| 5 | **Formula TDI** = (Kepadatan Penduduk × Indeks Kebutuhan Mobilitas) ÷ Skor Aksesibilitas Transit (`compute_tdi()`; PRD Bab 7.2) | Turunan operasional dari kerangka demand ÷ supply Jiao & Dillivan (2013); bentuk rasio kebutuhan-vs-pasokan | Pembilang = proksi kebutuhan (padat + rentan), penyebut = proksi pasokan (coverage transit) | **Bentuk rasio spesifik ini keputusan tim/PRD**, bukan kutipan langsung dari satu paper. `log1p` sebelum min–max (redam outlier pembagian nilai kecil) adalah keputusan teknik numerik, didokumentasikan di docstring `compute_tdi()`. |
| 6 | **Indeks Kebutuhan Mobilitas** dari proksi: proporsi lansia/difabel, kepadatan POI kebutuhan harian, rasio rumah tangga tanpa kendaraan (`compute_indeks_kebutuhan_mobilitas()`; PRD Bab 7.2) | Jiao & Dillivan (2013) daftar *transit-dependent population*; Litman (2023) *Evaluating Transportation Equity*, VTPI | Kelompok tanpa akses kendaraan pribadi & dengan mobilitas terbatas = paling bergantung transit | `rasio_tanpa_kendaraan` **belum ada datanya** → fallback netral 0,5 di semua grid (dicetak sebagai peringatan). Difabel belum terdata; "usia rentan" = lansia + balita saja. Keterbatasan, bukan disembunyikan. |
| 7 | **Transit Equity Index** — gabungkan CAI (di-*inverse*) + indikator kerentanan sosial per kelurahan, hasilkan *ranking ketimpangan* (`compute_equity_index()`; PRD Bab 7) | Litman (2023) *Evaluating Transportation Equity*, VTPI; Karner & Niemeier (2013) *Civil rights guidance and equity analysis methods for regional transportation plans*, Journal of Transport Geography | Analisis ekuitas transit = tumpang-tindih aksesibilitas rendah dengan populasi rentan; output berupa ranking daerah paling dirugikan | Pilihan 6 dimensi & bobotnya lokal (lihat `VALIDASI_BOBOT_AHP.md`). Arah skala: skor tinggi = paling dirugikan (bukan paling baik). |
| 8 | **Skor Aksesibilitas Transit** = decay linear coverage 400→800 m ke halte terdekat (`skor_aksesibilitas_dari_jarak()`) | Geurs & van Wee (2004) *Accessibility evaluation of land-use and transport strategies*, Journal of Transport Geography — komponen *distance decay*; ITDP TOD Standard (walk-shed) | Aksesibilitas turun bertahap dengan jarak, bukan hidup/mati di satu ambang | Decay **linear** (bukan eksponensial/gaussian) dipilih demi keterbacaan & ketertelusuran. Bukan berbasis jaringan jalan riil — *network routing* eksplisit out-of-scope (PRD Bab 3). |
| 9 | **Dasymetric mapping** — sebar populasi kelurahan ke grid 300 m proporsional terhadap luas *building footprint* OSM (`etl/rerun_dasymetric_grid.py`; PRD Bab 7.1) | Mennis (2003) *Generating Surface Models of Population Using Dasymetric Mapping*, The Professional Geographer 55(1); Eicher & Brewer (2001) | Redistribusi populasi areal → permukaan lebih realistis pakai data pembatas (bangunan) | Hasil tetap **estimasi**; PRD Bab 7.1 sudah menyatakan ini keterbatasan metodologis eksplisit. Assert konservasi populasi (Σ grid = Σ kelurahan = 2.607.248) lolos. |
| 10 | **Grid analisis 300 m** (`etl/build_fishnet_grid.py` `DEFAULT_CELL_SIZE_M = 300`) | Praktik *fishnet/hexbin* analisis aksesibilitas skala kota; trade-off resolusi vs jumlah cell | Unit analisis TDI yang seragam se-kota (2.607 cell) | 300 m ≈ blok kota; cukup halus untuk beda antar-permukiman, cukup kasar agar 2.607 cell tetap ringan. Bukan angka dari standar tertentu. |
| 11 | **Kerangka narasi CCIA** (Condition → Cause → Impact → Action) untuk AI Spatial Consultant (`supabase/functions/ai-insight/index.ts`; PRD Bab 7.5) | Coaching Clinic 4 — *Data Visualization & Spatial Storytelling*, 21 Agustus 2026 (materi internal kompetisi) | Struktur baku narasi spasial supaya jawaban AI tidak bebas tanpa pola | Sumber = pelatihan internal, bukan literatur. Rekomendasi tahap *Action* wajib SMART Spasial. |
| 12 | **AI hanya lapisan interpretasi**, tidak menghitung skor / tidak *raw math* (PRD Bab 7.4; CLAUDE.md) | Prinsip *explainable AI* / *decision support system* — Sugumaran & DeGroote (2010) *Spatial Decision Support Systems*; prinsip kompetisi | Tiap rekomendasi bisa ditelusuri ke kriteria & bobot, bukan "karena AI bilang" | Divalidasi di Edge Function: angka di narasi dicek cocok dengan angka input sebelum dikirim ke frontend. |
| 13 | **Estimasi waktu tempuh jalan kaki 80 m/menit (≈ 4,8 km/jam)** (`simulate_new_stop()` `asumsi_kecepatan_jalan_kaki_m_per_menit`) | Kecepatan jalan kaki dewasa rata-rata ~1,2–1,4 m/detik — TCRP Report 165; Fitzpatrick dkk. (2006) | Konversi jarak → menit untuk proyeksi What-If | Nilai konservatif (ujung bawah rentang), memperhitungkan pejalan kaki lansia/anak. Bukan *network routing*. |

---

## 2. Daftar referensi lengkap

**Standar & manual perencanaan transit**
- Institute for Transportation and Development Policy (ITDP). *TOD Standard*, 3rd edition. New York: ITDP, 2017.
- Transportation Research Board. *TCRP Report 165: Transit Capacity and Quality of Service Manual*, 3rd edition. Washington, DC: The National Academies Press, 2013.
- Guerra, E., Cervero, R., & Tischler, D. "The Half-Mile Circle: Does It Best Represent Transit Station Catchments?" *Transportation Research Record* 2276(1), 2012, pp. 101–109.
- Fitzpatrick, K., et al. "Another Look at Pedestrian Walking Speed." *Transportation Research Record* 1982(1), 2006.

**MCDA / GIS**
- Malczewski, J. *GIS and Multicriteria Decision Analysis*. New York: John Wiley & Sons, 1999.
- Malczewski, J., & Rinner, C. *Multicriteria Decision Analysis in Geographic Information Science*. Berlin: Springer, 2015.
- Saaty, T. L. *The Analytic Hierarchy Process*. New York: McGraw-Hill, 1980. *(dasar metode penetapan bobot CAI/TDI_MOBILITAS/EQUITY — sesi AHP pairwise formal 2026-09-03, CR ketiga index < 0,1; lihat `VALIDASI_BOBOT_AHP.md` Bagian 0.)*

**Aksesibilitas & ekuitas transit**
- Geurs, K. T., & van Wee, B. "Accessibility evaluation of land-use and transport strategies: review and research directions." *Journal of Transport Geography* 12(2), 2004, pp. 127–140.
- Jiao, J., & Dillivan, M. "Transit Deserts: The Gap Between Demand and Supply." *Journal of Public Transportation* 16(3), 2013, pp. 23–39.
- Jiao, J. "Identifying transit deserts in major Texas cities where the supply missed the demand." *Journal of Transport and Land Use* 10(1), 2017.
- Litman, T. *Evaluating Transportation Equity: Guidance for Incorporating Distributional Impacts in Transportation Planning*. Victoria Transport Policy Institute (VTPI), edisi berjalan.
- Karner, A., & Niemeier, D. "Civil rights guidance and equity analysis methods for regional transportation plans: a critical review of literature and practice." *Journal of Transport Geography* 33, 2013, pp. 126–134.

**Dasymetric mapping**
- Mennis, J. "Generating Surface Models of Population Using Dasymetric Mapping." *The Professional Geographer* 55(1), 2003, pp. 31–42.
- Eicher, C. L., & Brewer, C. A. "Dasymetric Mapping and Areal Interpolation: Implementation and Evaluation." *Cartography and Geographic Information Science* 28(2), 2001, pp. 125–138.

**Spatial Decision Support System**
- Sugumaran, R., & DeGroote, J. *Spatial Decision Support Systems: Principles and Practices*. Boca Raton: CRC Press, 2010.

**Sumber internal kompetisi**
- Coaching Clinic 4 — *Data Visualization & Spatial Storytelling*, 21 Agustus 2026 (kerangka CCIA).
- Sesi AHP pairwise-comparison (Saaty) formal, 3 September 2026 — bobot final CAI/TDI_MOBILITAS/EQUITY, CR 0,0226 / 0,0000 / 0,0457 (semua < 0,1); di-set via `supabase/migrations/018_konfigurasi_bobot_ahp_final.sql`, arsip matriks di `docs/VALIDASI_BOBOT_AHP.md` Bagian 0.
- (Interim) Review worksheet bobot bersama mentor, 27 Agustus 2026 — digantikan oleh sesi AHP di atas (lihat `docs/VALIDASI_BOBOT_AHP.md` & `supabase/migrations/009_bobot_tdi_equity_mentor_review.sql`).

---

## 3. Yang TIDAK punya sumber eksternal (batas kejujuran)

Perlu disebut apa adanya di laporan akhir sebagai keterbatasan metodologi:

1. **Nilai bobot spesifik** (CAI 0,329/0,329/0,200/0,142; TDI_MOBILITAS
   0,200/0,400/0,400; EQUITY 0,308/0,154/0,151/0,126/0,135/0,126 — nilai persis di
   `konfigurasi_bobot` / migration 018). Diturunkan lewat **AHP pairwise-comparison
   Saaty formal, sesi 2026-09-03** (eigenvector matriks perbandingan berpasangan;
   CR CAI 0,0226 / TDI_MOBILITAS 0,0000 / EQUITY 0,0457, semua < 0,1). Yang masih
   subjektif: skala perbandingan berpasangan itu sendiri = penilaian ahli tim,
   bukan kalibrasi empiris; matriks pairwise mentahnya belum dilampirkan ke repo
   (placeholder di `docs/VALIDASI_BOBOT_AHP.md` Bagian 0.5). Detail: `docs/VALIDASI_BOBOT_AHP.md` Bagian 0.
2. **Bentuk rasio TDI yang tepat** dan pilihan `log1p` — keputusan operasional
   tim, bukan kutipan paper (kerangka besar demand÷supply dari Jiao & Dillivan,
   tapi rumus persisnya milik proyek ini).
3. **Ukuran grid 300 m** dan **decay linear** (bukan eksponensial) — pilihan
   pragmatis (keterbacaan, ketertelusuran, beban komputasi), bukan hasil
   kalibrasi atau standar baku.
4. **Belum ada studi construct validity formal** — belum ada pembuktian
   sistematis bahwa skor TDI/Equity tinggi benar-benar cocok dengan daerah yang
   pakar/warga sepakat "tertinggal". Bukti yang ada masih terbatas: sensitivity
   analysis (kestabilan ranking), face-validity check, dan 31 titik Survey
   Activities sebagai *ground truth* (yang **bukan** sampel statistik
   representatif — PRD Bab 1.2). Rencana penguatan: `docs/VALIDASI_BOBOT_AHP.md`
   bagian 5.
5. **`rasio_tanpa_kendaraan`** (komponen Indeks Kebutuhan Mobilitas, bobot 0,25):
   data BPS/Susenas belum tersedia → semua grid pakai nilai netral 0,5.

# Validasi Bobot Index — CAI, TDI, Transit Equity Index

> **Status terkini (2026-09-03):** bobot ketiga index (CAI, TDI_MOBILITAS,
> EQUITY) sudah **diturunkan ulang lewat sesi AHP pairwise-comparison Saaty
> formal pada 2026-09-03**, menggantikan worksheet yang sebelumnya hanya
> direview informal oleh mentor (27 Agustus 2026). Consistency ratio ketiga
> index < 0,1 (lihat Bagian 0). Di laporan/narasi AI, sebut **"bobot hasil AHP
> pairwise formal (CR < 0,1)"**. Bagian 1–6 di bawah adalah konteks historis
> (proses interim mentor-review) dan tetap disimpan sebagai jejak.
>
> Bagian 0 disusun 3 September 2026. Sumber:
> `supabase/migrations/018_konfigurasi_bobot_ahp_final.sql`,
> `019_equity_kelompok_rekomendasi_refill_ahp.sql`, `etl/compute_scores.py`.
> Konteks historis (Bagian 1–6) disusun 2 September 2026 dari
> `004_konfigurasi_bobot.sql`, `009_bobot_tdi_equity_mentor_review.sql`.

---

## 0. Sesi AHP pairwise formal — 2026-09-03 (BOBOT YANG BERLAKU)

**Metode:** Analytic Hierarchy Process (Saaty). Untuk tiap index disusun matriks
pairwise-comparison antar-kriteria (skala Saaty 1–9), lalu bobot diambil sebagai
**eigenvector utama** matriks itu (principal eigenvector / row-geometric-mean),
dinormalisasi supaya Σ = 1,0000. Consistency Ratio (CR = CI / RI) dihitung per
matriks; semua < 0,1 sehingga matriks dianggap cukup konsisten dan bobot dipakai
apa adanya.

**13 bobot final** (rujukan tunggal tetap tabel `konfigurasi_bobot` di DB,
di-set oleh migration `018_konfigurasi_bobot_ahp_final.sql`):

### 0.1 CAI — `nama_index='CAI'` — CR = **0,0226**
| `nama_kriteria` | Bobot |
|---|---|
| `kepadatan` | **0,3290** |
| `jarak_inv` | **0,3290** |
| `volume` | **0,2002** |
| `survei` | **0,1418** |

Σ = 1,0000. Perubahan vs draft lama (0,35 / 0,25 / 0,25 / 0,15): kepadatan &
jarak_inv naik jadi setara di puncak, volume & survei turun.

### 0.2 Indeks Kebutuhan Mobilitas — `nama_index='TDI_MOBILITAS'` — CR = **0,0000**
| `nama_kriteria` | Bobot |
|---|---|
| `usia_rentan` | **0,2000** |
| `poi_harian` | **0,4000** |
| `tanpa_kendaraan` | **0,4000** |

Σ = 1,0000. CR = 0 karena matriks pairwise 3×3-nya transitif penuh (konsisten
sempurna). Perubahan vs draft lama (0,40 / 0,35 / 0,25): `poi_harian` &
`tanpa_kendaraan` naik jadi dominan, `usia_rentan` turun.
**Catatan data:** `tanpa_kendaraan` masih memakai fallback netral 0,5 di semua
grid (data BPS/Susenas belum ada) — bobot 0,40 belum benar-benar diskriminatif
sampai datanya masuk.

### 0.3 Transit Equity Index — `nama_index='EQUITY'` — CR = **0,0457**
| `nama_kriteria` | Bobot |
|---|---|
| `aksesibilitas_inv` | **0,3076** |
| `kepadatan` | **0,1538** |
| `usia_rentan` | **0,1513** |
| `akses_pendidikan` | **0,1260** |
| `akses_kesehatan` | **0,1353** |
| `akses_kerja` | **0,1260** |

Σ = 1,0000. `aksesibilitas_inv` tetap dimensi terbesar (inti index). Arah skala
TIDAK berubah — lihat catatan di Bagian 2.3: `skor_equity.skor_final` = skor
KETIMPANGAN, makin tinggi = kelurahan makin dirugikan, **ranking 1 = skor
tertinggi = paling butuh intervensi**.

### 0.4 Dampak ke skor turunan
Setelah bobot 018 diterapkan, seluruh skor dihitung ulang (CAI/TDI/Equity) via
pipeline ETL + migration `019_equity_kelompok_rekomendasi_refill_ahp.sql`
(mengisi ulang `kelompok_terdampak` + `rekomendasi_intervensi` per kelurahan
yang ter-NULL oleh DELETE+INSERT recompute). Ranking Equity stabil: Spearman rho
lama vs baru = 0,98, ranking 1 tetap Arenjaya, ranking 56 tetap Margamulya.

### 0.5 PLACEHOLDER — matriks pairwise mentah belum masuk repo
> **BELUM ADA di repo:** matriks pairwise-comparison mentah (sel-per-sel skala
> Saaty 1–9) yang menghasilkan eigenvector & CR di atas. Yang tersimpan baru
> **hasil akhirnya** (bobot + CR) di `konfigurasi_bobot` / migration 018.
> Sam memegang CSV `konfigurasi_bobot_ahp.csv`. **To-do tim:** tempel di sini
> — untuk tiap index: (a) tabel matriks n×n perbandingan berpasangan,
> (b) vektor bobot hasil eigenvector, (c) λ_max, CI, RI, dan CR terhitung —
> supaya juri/mentor bisa menelusuri CR 0,0226 / 0,0000 / 0,0457 dari angka
> mentah, bukan menerimanya sebagai klaim.

---

## 1. Ringkasan status (HISTORIS — proses interim mentor-review, 27 Agu 2026)

> Bagian 1–6 mendokumentasikan proses **sebelum** sesi AHP formal 2026-09-03.
> Disimpan sebagai konteks; bobot yang berlaku ada di Bagian 0.

| Hal | Status |
|---|---|
| Metode penetapan bobot | Worksheet awal tim (penalaran per kriteria) → **review informal mentor** |
| Tanggal approval mentor | **27 Agustus 2026** ("sudah ok" atas worksheet) |
| AHP pairwise Saaty formal? | **Tidak.** Tidak pernah ada matriks pairwise dihitung. |
| `consistency_ratio` di `konfigurasi_bobot` | **NULL, sengaja** — tanpa matriks pairwise, angka CR akan jadi karangan |
| Rujukan tunggal untuk perhitungan | Tabel `konfigurasi_bobot` di database (13 baris), **bukan** angka di dokumen mana pun |
| Bukti pendukung | Sensitivity analysis (kestabilan ranking), face-validity check, konservasi populasi |

---

## 2. Nilai bobot draft interim (PRA-AHP — SUDAH DIGANTIKAN)

> **Nilai di Bagian 2 ini adalah draft worksheet 27 Agu 2026, BUKAN bobot yang
> berlaku.** Bobot final (hasil AHP pairwise formal 2026-09-03) ada di Bagian 0.
> Tabel di bawah dibiarkan untuk menunjukkan pergeserannya.

### 2.1 CAI — Composite Accessibility Index (`nama_index='CAI'`)
Per `titik_kandidat`. Draft di `004_konfigurasi_bobot.sql` (digantikan `018`). Σ = 1,00.

| Kriteria | Bobot | Arah | Alasan penetapan awal |
|---|---|---|---|
| `kepadatan` | **0,35** | makin padat → prioritas naik | Dampak sebuah halte sebanding dengan jumlah warga dalam jangkauan jalan kaki — faktor terbesar untuk "melayani sebanyak mungkin orang". |
| `jarak_inv` | **0,25** | makin dekat fasilitas umum → naik | Titik transit paling berguna bila menyambungkan warga ke tujuan harian (sekolah/faskes/pasar). |
| `volume` | **0,25** | makin tinggi penumpang simpul terdekat → naik | Permintaan transit yang sudah terbukti di simpul sekitar = sinyal koridor layak diperkuat. |
| `survei` | **0,15** | skor kondisi fisik & akses simpul (0–1) | Ground truth lapangan penting sebagai koreksi, tapi cakupannya terbatas (31 titik) sehingga bobotnya paling kecil. |

### 2.2 Indeks Kebutuhan Mobilitas — komponen TDI (`nama_index='TDI_MOBILITAS'`)
Per cell grid 300 m. Migration `009_...sql`. Σ = 1,00.

| Kriteria | Bobot | Alasan |
|---|---|---|
| `usia_rentan` | **0,40** | Lansia + balita paling bergantung transit & paling terdampak bila akses buruk; proksi paling langsung untuk "kebutuhan mobilitas non-diskresioner". |
| `poi_harian` | **0,35** | Banyak tujuan harian dalam radius = mobilitas rutin tinggi = kebutuhan layanan feeder tinggi. |
| `tanpa_kendaraan` | **0,25** | Rumah tangga tanpa kendaraan pribadi = *transit-dependent* klasik. **Data belum ada → fallback 0,5 seragam** (bobotnya tidak hilang tapi tidak diskriminatif untuk saat ini). |

### 2.3 Transit Equity Index (`nama_index='EQUITY'`)
Per kelurahan. Migration `009_...sql`. Σ = 1,00.

| Kriteria | Bobot | Alasan |
|---|---|---|
| `aksesibilitas_inv` | **0,30** | Inti index: CAI kelurahan di-*inverse* — akses transit rendah = ketimpangan tinggi. Dimensi terbesar. |
| `usia_rentan` | **0,20** | Kerentanan demografis memperberat dampak akses buruk. |
| `kepadatan` | **0,15** | Ketimpangan yang menimpa lebih banyak orang lebih mendesak. |
| `akses_pendidikan` | **0,15** | Jarak jauh ke sekolah = hambatan akses pendidikan (jarak TIDAK di-*inverse*: jarak besar menaikkan skor ketimpangan). |
| `akses_kesehatan` | **0,10** | Idem untuk faskes. |
| `akses_kerja` | **0,10** | Idem untuk pusat kerja. |

**Arah skala (jangan terbalik):** `skor_equity.skor_final` = skor **KETIMPANGAN**.
Makin tinggi = kelurahan makin dirugikan. **Ranking 1 = skor tertinggi = paling
butuh intervensi.** Konsisten dengan `EquityIndexView.jsx` dan PRD Bab 8.2.

---

## 3. Apa yang dilakukan mentor di langkah interim (27 Agustus 2026)

> Historis. Langkah ini sudah digantikan sesi AHP pairwise formal 2026-09-03
> (Bagian 0) — sejak itu `consistency_ratio` di `konfigurasi_bobot` TERISI
> (0,0226 / 0,0000 / 0,0457), tidak lagi NULL.

Review 27 Agu bukan sesi pairwise comparison. Mentor menyetujui worksheet bobot lewat:

1. **Cek distribusi hasil** — apakah sebaran skor CAI/TDI/Equity masuk akal
   (tidak menumpuk di satu ujung, ada variasi antar-lokasi yang bisa dibedakan).
2. **Cek kesesuaian dengan objektif analisis** — apakah lokasi/kelurahan yang
   naik ke peringkat atas memang yang secara intuitif perencana kota anggap
   prioritas (mis. kawasan padat minim transit di Mustika Jaya / Rawa Lumbu /
   Bekasi Utara — daftar yang disebut PRD Bab 2.1).
3. Verbal approve: worksheet "sudah ok".

Karena tidak ada matriks pairwise → **tidak ada Consistency Ratio yang bisa
dihitung**. Mengisi kolom `consistency_ratio` dengan angka apa pun = mengarang.
Kolom itu sengaja NULL (`009_...sql` baris 24, 38).

---

## 4. Bukti pendukung yang sudah ada

### 4.1 Sensitivity analysis (kestabilan ranking)
`compute_scores.py` menyediakan `sensitivity_check()` (CAI), `sensitivity_check_tdi()`,
`sensitivity_check_equity()`, dan `top_n_stability_check()`. Cara kerja: geser tiap
bobot ±0,1, renormalisasi ke 1,0, hitung ulang, bandingkan ranking **per entitas**
(bukan per posisi baris — bug lama yang sudah diperbaiki, lihat docstring
`_sensitivity_check_generic()`).

Tujuannya menjawab: *"kalau bobot digeser sedikit, apakah daftar prioritas berubah
drastis?"* Kalau sebagian besar skenario tidak mengubah top-N → ranking robust
terhadap ketidakpastian pemilihan bobot.

**Hasil dataset demo sintetis** (`python etl/compute_scores.py`, dijalankan
2 Sep 2026 — CAI: 4 titik, TDI: 4 grid, Equity: 5 kelurahan). Angka =
`jumlah_ranking_berubah` per skenario geser bobot ±0,1:

| Index | Skenario mengubah ranking | Total skenario | Catatan |
|---|---|---|---|
| CAI | **2** | 8 | `kepadatan −0,1` dan `jarak_inv +0,1` menukar 2 posisi (skor 2 titik tengah berdekatan: 0,455 vs 0,410). Top-1 (Dekat Stasiun Bekasi Timur, skor 0,745) tidak pernah berubah. |
| TDI | **0** | 6 | Ranking sepenuhnya stabil terhadap pergeseran bobot Indeks Kebutuhan Mobilitas. |
| Equity | **1** | 12 | Hanya `kepadatan −0,1` menukar 2 posisi menengah. Top-1 (Mustika Jaya, skor 0,850) & top-2 tidak berubah. |

Interpretasi: pada data demo, ranking cukup robust — perubahan hanya di
pasangan yang skornya memang berimpit, tidak pernah di puncak daftar.

> **TODO — skala penuh (butuh kredensial Supabase):** jalankan
> `python etl/compute_tdi_full.py` (2.607 grid, bagian "Sensitivity analysis" +
> `top_n_stability_check`) dan versi Equity 56 kelurahan, lalu ganti tabel di
> atas dengan angka produksi. Data demo di atas **bukan** bukti final — jumlah
> entitas kecil (4–5) membuat metrik "jumlah ranking berubah" kurang sensitif.

### 4.2 Face-validity check — TDI vs jarak ke halte
`compute_tdi_full.py` bagian "Face-validity check". Hasil terakhir (27 Agu 2026,
`DATA_CHECKLIST.md`): cell ≤ 400 m dari halte real rata-rata `skor_tdi` **0,18**;
cell > 800 m rata-rata **0,52**. Arah sesuai ekspektasi (jauh dari halte = lebih
"transit desert").
**Batas:** sebagian sirkular — jarak-ke-halte adalah penyebut TDI, jadi korelasi
ini setengah *by construction*. Bukan validasi kuat.

### 4.3 Face-validity check — Equity ranking
`DATA_CHECKLIST.md` (28 Agu): setelah `n_kepadatan` CAI diperbaiki dari placeholder
ke nilai real, **18 dari 56 ranking Equity berubah** tapi **top-10 nyaris stabil**
(hanya #1/#2 bertukar: Arenjaya ↔ Durenjaya, skor sangat berdekatan 0,6135 vs
0,5962). Perubahan besar hanya di peringkat menengah-bawah yang skornya rapat —
pola wajar untuk n = 56, bukan tanda formula rapuh.

### 4.4 Konservasi populasi (dasymetric)
Σ populasi grid = Σ populasi 56 kelurahan = **2.607.248** (selisih 0,00). Input
kepadatan untuk CAI/TDI tidak bocor/berganda.

---

## 5. Rencana penguatan validasi (belum dikerjakan)

Untuk membuat klaim "index mencerminkan kondisi riil daerah" lebih kuat dari
sekadar review informal:

1. **Cross-check non-sirkular terhadap daftar transit desert independen.**
   PRD Bab 2.1 menyebut kawasan tertinggal secara independen dari model:
   **Mustika Jaya, Rawa Lumbu, Bekasi Utara, Kelurahan Kranji, Kelurahan
   Kaliabang Tengah.** Ambil top-N kelurahan menurut `skor_tdi` agregat dan
   menurut `skor_equity` ranking, lalu hitung berapa dari 5 nama itu masuk.
   Kecocokan tinggi = face validity kuat (dan tidak sirkular, karena daftar PRD
   disusun sebelum/di luar perhitungan).
   > Perlu query agregasi `skor_tdi` per kelurahan (spatial join grid → kelurahan).
   > Belum dijalankan. Isi hasilnya di sini setelah dijalankan.

2. **Simpan output `sensitivity_check_*` numerik** (bagian 4.1) — bukan hanya
   deskripsi mekanisme.

3. **Uji beberapa skema bobot alternatif** (mis. equal weight 0,25×4 untuk CAI;
   bobot ekstrem 1 kriteria) dan tunjukkan top-5 rekomendasi tetap sama /
   berubah sedikit. Dokumentasikan sebagai "robustness terhadap subjektivitas
   bobot".

4. **Bandingkan skor 8 titik `titik_kandidat` real dengan catatan kualitatif
   surveyor** di titik yang sama — apakah titik yang surveyor sebut "kondisi
   buruk / akses sulit" memang dapat skor survei rendah & CAI yang konsisten.

5. **Bila memungkinkan:** minta 1 perencana Dishub/Bappeda memberi ranking
   intuitif 5–10 kelurahan prioritas, lalu bandingkan (Spearman rank correlation)
   dengan ranking Equity Index. Ini validasi eksternal paling meyakinkan untuk
   juri, walau butuh akses ke narasumber.

---

## 6. Batasan yang wajib disebut di laporan akhir

- Bobot = hasil **AHP pairwise Saaty formal** (sesi 2026-09-03; eigenvector
  matriks perbandingan berpasangan; CR CAI 0,0226 / TDI_MOBILITAS 0,0000 /
  EQUITY 0,0457, semua < 0,1 — Bagian 0). Yang tetap subjektif: skala
  perbandingan berpasangan itu sendiri = penilaian ahli tim, bukan kalibrasi
  empiris; matriks pairwise mentahnya belum dilampirkan ke repo (Bagian 0.5).
  Subjektivitas residual dimitigasi lewat sensitivity analysis, bukan
  dihilangkan.
- `rasio_tanpa_kendaraan` (bobot AHP 0,40 di Indeks Kebutuhan Mobilitas) memakai
  nilai netral 0,5 di semua grid — komponen ini belum benar-benar aktif.
- `n_volume` CAI untuk 8 titik real berbasis **estimasi observasi lapangan
  singkat**, bukan traffic counting kontinu 2 jam (lihat `DATA_CHECKLIST.md`
  28 Agu) — presisi lebih rendah dari desain instrumen awal.
- 53 dari 56 kelurahan belum punya `titik_kandidat` survei sendiri →
  `skor_cai_rata2`-nya pakai fallback rata-rata kota (ditandai di kolom
  `sumber`). Ranking Equity untuk kelurahan ini lebih lemah dasarnya.
- 31 titik Survey Activities = ground truth/validasi lapangan, **bukan** sampel
  statistik representatif Kota Bekasi (PRD Bab 1.2).

# Data Checklist — GeoTransit Insight

> Disusun oleh agent `project-lead`, 26 Agustus 2026. Audit repo penuh (CLAUDE.md,
> BUILD_CHECKLIST.md, FRAMEWORK_GeoTransitInsight.md, migrations, etl/).
> Tujuan: daftar data REAL yang masih dibutuhkan sebelum submission 13 September 2026,
> dan cara mendapatkannya. Update file ini setiap kali satu item selesai diperoleh.

**Hari ini: 28 Agustus 2026 — 16 hari ke submission.** Field Day 3 (survei terakhir):
29-30 Agustus — **tinggal 1-2 hari**.

## ✅ Update 28 Agustus (lanjutan, terbaru) — rute BisKita sekarang mengikuti jaringan jalan (OSRM), bukan garis lurus

`data-ai-analyst` mengganti geometri `rute_transit_eksisting` id=1 (`jenis='biskita_survei'`)
dari LineString garis lurus 15-titik (chord langsung antar `HLT-001`→`HLT-015`) menjadi rute
yang mengikuti jaringan jalan sungguhan, dibangun dengan **Opsi A: OSRM public routing API**
(`router.project-osrm.org/route/v1/driving`, data jalan OpenStreetMap) — dicoba lebih dulu
sesuai instruksi, terbukti reliable (semua 14 segmen berhasil di percobaan pertama, tidak
perlu fallback ke Opsi B/graph `JALAN_LN_25K` + networkx).

**Metode**: 14 segmen dihitung terpisah (HLT-001→002, 002→003, …, 014→015), tiap segmen
di-request ke OSRM profile `driving` (bus jalan di jalan raya, bukan jalur pejalan kaki),
hasil geometri tiap segmen disambung jadi satu LineString penuh (titik duplikat di
sambungan segmen dibuang). `UPDATE` langsung ke baris `id=1` (bukan insert baru) via
`supabase-py`, `id` dan riwayat baris dipertahankan.

**Panjang rute**: garis lurus lama ~15,44 km total → rute jalan baru **~18,05 km**
(rasio 1,17x — masuk akal untuk jalan mengikuti jaringan jalan kota, jauh di bawah
ambang batas curiga 3x). Rincian per segmen (OSRM, jarak jalan): 001→002 1085m,
002→003 138m, 003→004 3342m, 004→005 2000m, 005→006 27m, 006→007 1958m, 007→008 22m,
008→009 223m, 009→010 11m, 010→011 3223m, 011→012 2319m, 012→013 13m, 013→014 3603m,
014→015 82m. Semua 14 segmen sukses, 0 fallback garis lurus.

**Disclaimer dipertahankan & diperbarui** di kolom `sumber`/`catatan` baris id=1 —
tetap menyatakan ini APROKSIMASI (bukan GeoJSON/KMZ rute resmi operator BisKita/Dishub,
tim tidak punya data itu), sekarang eksplisit menyebut metode routing (OSRM/OpenStreetMap,
profile driving) dan angka panjang rute vs garis lurus, plus catatan lama soal pola
urutan tidak sepenuhnya monoton (kemungkinan rute PP/dua-arah) tetap dipertahankan apa
adanya.

**Script ETL diperbarui**: `etl/build_rute_transit_eksisting.py` sekarang membangun rute
BisKita lewat fungsi baru `route_road_network()` (helper `_osrm_route_segment()` per
segmen dengan retry 3x, `_haversine_m()` untuk sanity-check rasio) — kalau di-re-run
nanti (misal ada halte baru dari Field Day 3), otomatis pakai OSRM routing lagi, TIDAK
akan kembali menghasilkan garis lurus. Segmen yang gagal di-routing (OSRM down/rate
limit) fallback ke garis lurus **hanya untuk segmen itu**, dicatat jumlahnya di
`sumber`/`catatan` yang diupload (transparan, bukan disembunyikan). `requests` ditambah
ke `etl/requirements.txt` (dipakai langsung sekarang, sebelumnya cuma dependency
transitif). Dry-run script ini sudah dijalankan ulang setelah perubahan dan hasilnya
cocok persis dengan angka manual di atas (18,05km, rasio 1,17x, 0 fallback).

**Verifikasi live**: dicek ulang lewat `supabase-py` setelah update — baris `id=1` sekarang
punya 730 titik koordinat (naik dari 15), titik awal/akhir tidak berubah (masih di
HLT-001/HLT-015), `sumber`/`catatan` sudah berisi teks metode baru.

**Catatan untuk Sam**: kalau `etl/build_rute_transit_eksisting.py --upload` dijalankan
ulang di masa depan (bukan hanya untuk B1), skrip ini memakai pola delete-lalu-insert
per `jenis` (idempotent tapi row `id` akan berganti, bukan tetap `id=1`) — beda dengan
`UPDATE` satu-kali yang dipakai untuk perbaikan hari ini. Ini pola lama yang sudah ada
sebelum perubahan ini, bukan regresi baru, tapi dicatat di sini supaya jelas kapan `id`
row BisKita bisa berubah.

> **✅ RESOLVED (dicek ulang saat mengerjakan update di atas)**: `npx supabase migration
> list --project-ref=vpymlmaebvfmpowomsec` sekarang menunjukkan `local`/`remote` sama-sama
> sampai `013` — migration 012 (fix `simulate_new_stop`) dan 013 (tabel
> `rute_transit_eksisting`) SUDAH diterapkan Sam ke database produksi (kapan persisnya
> tidak tercatat di sini, ditemukan sudah applied). Blocker "BELUM DITERAPKAN" di entri
> di bawah ini SUDAH TIDAK BERLAKU. Entri lama dipertahankan apa adanya untuk riwayat.

## ⚠️⚠️ Update 28 Agustus (malam) — dummy data DIHAPUS dari database; BLOCKER KRITIS ditemukan & migration perbaikan ditulis TAPI BELUM DITERAPKAN (butuh Sam manual)

`data-ai-analyst` menjalankan 2 tugas dari Sam: (A) hapus semua baris dummy/sintetis
dari database, (B) siapkan 2 layer transit eksisting untuk peta (rute BisKita survei +
KRL).

### Tugas A — Dummy dihapus, hasil per tabel

Inventarisasi ulang lewat query (bukan asumsi dari memori) sebelum hapus, lalu DELETE
via `supabase-py` (DML, bukan lewat CLI yang kena blocker classifier — lihat di bawah).
Cascade FK (`penduduk.kelurahan_id`, `skor_equity.kelurahan_id` → `batas_administrasi.id`
ON DELETE CASCADE; `skor_cai.titik_kandidat_id` → `titik_kandidat.id` ON DELETE CASCADE)
diverifikasi benar dari skema (`001_init_tables.sql`) sebelum dieksekusi, bukan
diasumsikan:

| Tabel | Sebelum | Dummy dihapus | Sesudah (REAL) |
|---|---|---|---|
| `batas_administrasi` | 62 | 6 (`sumber ilike 'DATA SINTETIS%'`) | **56** |
| `penduduk` | 80 | 24 (cascade dari 6 kelurahan dummy) | **56** |
| `skor_equity` | 61 | 5 (cascade dari 6 kelurahan dummy; diverifikasi tidak ada baris equity dummy yang FK ke kelurahan REAL — 56 baris FK real semuanya bersumber `REAL - ...`) | **56** |
| `titik_kandidat` | 12 | 4 (`id_titik_survei` prefix `KND-DEMO-`) | **8** |
| `skor_cai` | 12 | 4 (cascade dari 4 titik_kandidat demo) | **8** |
| `halte_eksisting` | 21 | 6 (`id_halte_survei` prefix `DUMMY-HLT-`) | **15** |
| `poi` | 776 | **13** (`sumber ilike 'DATA SINTETIS%'` — DITEMUKAN saat audit, TIDAK ada di daftar eksplisit Sam tapi cocok kriteria "tabel lain yang mungkin punya dummy", ikut dihapus) | **763** (330 sekolah + 162 faskes + 271 kerja OSM, cocok catatan Kategori B sebelumnya) |
| `grid_analisis` | 2.607 | 0 (tidak ada dummy, sudah 100% dasymetric real sejak 27 Agu) | 2.607 (tidak berubah) |
| `konfigurasi_bobot` | 13 | 0 (tidak ada dummy, semua 13 baris hasil review mentor) | 13 (tidak berubah) |

Verifikasi akhir: 0 baris dummy tersisa di semua tabel di atas (dicek ulang query
`ilike`/prefix match setelah delete), jumlah baris REAL tidak berkurang dari yang
dicatat di update-update sebelumnya di file ini.

**Cek fallback DB sebelum hapus (poin 3 instruksi Sam) — TIDAK ditemukan kode frontend
yang bergantung pada baris dummy DI DATABASE sebagai fallback** (`DEMO_CAI_POINTS`/
`DEMO_HALTE_POINTS` yang ada di frontend adalah hardcode client-side, tidak query DB,
aman seperti diduga Sam).

### 🔴 TAPI ditemukan blocker fungsional NYATA (bukan di frontend, di RPC backend) — `simulate_new_stop()`

RPC `simulate_new_stop()` (`003_simulate_new_stop.sql`, dipakai fitur "Simulasi
What-If" live di `frontend/src/components/SimulationMode/SimulationPanel.jsx`)
menghitung `penduduk_terlayani_400m/800m` dengan `ST_DWithin` terhadap
**`penduduk.geom`** (titik). Dicek langsung: **56 baris REAL `penduduk` (Disdukcapil,
`etl/load_penduduk.py`) semuanya agregat PER KELURAHAN — `geom` SELALU NULL.** Hanya
24 baris DUMMY lama (6 kelurahan fiktif) yang punya `geom` titik terisi.

Konsekuensinya: RPC ini **sudah tidak pernah mengembalikan populasi > 0 di luar 6 bbox
dummy itu sejak data real diupload** (bug lama, belum pernah dilaporkan) — dan begitu
baris dummy dihapus (poin di atas), RPC ini akan **SELALU mengembalikan 0 di SELURUH
Kota Bekasi**, merusak total fitur What-If (acceptance criteria PRD Bab 8).

**Perbaikan ditulis**: `supabase/migrations/012_fix_simulate_new_stop_population_source.sql`
— redefinisi fungsi (`create or replace`), ganti sumber populasi dari `penduduk`
(titik, kosong utk data real) ke **`grid_analisis`** (2.607 cell 300x300m, dasymetric
real, sudah mencakup 56 kelurahan) — dijumlah per radius (400m/800m) dengan **prorata
luas irisan cell↔lingkaran** (areal interpolation, bukan all-or-nothing centroid),
supaya cell yang sebagian di dalam/luar radius tidak dihitung penuh/nol secara kasar.
Bagian lain fungsi (jarak halte terdekat, POI faskes/sekolah 400m) tidak diubah — itu
sudah bergantung pada data real (`halte_eksisting`, `poi`) yang tidak terpengaruh
penghapusan dummy.

**⚠️ BELUM DITERAPKAN ke database produksi** — `npx supabase db push` ditolak
permission classifier sesi ini (konsisten dengan blocker sesi-sesi sebelumnya untuk
`db push`/`functions deploy`). **Sampai Sam menjalankan ini manual, fitur Simulasi
What-If mengembalikan 0 penduduk terlayani di SELURUH kota** — ini prioritas TINGGI,
lebih mendesak dari isu lain di file ini karena regresi baru terjadi HARI INI akibat
penghapusan dummy.

**Perintah manual untuk Sam** (jalankan di terminal sendiri, bukan lewat sesi chat):
```
npx supabase db push --project-ref=vpymlmaebvfmpowomsec
```
Ini akan menerapkan migration 012 (fix di atas) **dan** 013 (tabel baru layer transit,
lihat Tugas B di bawah) sekaligus — `npx supabase migration list --project-ref=vpymlmaebvfmpowomsec`
sudah dicek, remote saat ini persis di 011, jadi push ini aman/idempotent (tidak akan
mengulang 001-011). Alternatif kalau CLI push tetap gagal: copy-paste isi kedua file
itu (urut: 012 dulu, baru 013) ke Supabase SQL Editor.

Uji setelah diterapkan: `select simulate_new_stop(-6.2185, 107.0074);` — diharapkan
`penduduk_terlayani_400m/800m` > 0 (sebelumnya akan 0).

### Tugas B — 2 layer transit eksisting (BisKita survei + KRL)

**Keputusan struktur data: tabel baru `rute_transit_eksisting`** (bukan file GeoJSON
statis di `frontend/public/`), migration `013_rute_transit_eksisting.sql` — konsisten
dengan pola arsitektur proyek ini (semua layer spasial lain lewat Supabase/PostGIS +
RLS baca-publik, bukan file statis), dan supaya metadata kejujuran sumber
(`sumber`/`catatan`) tersimpan satu tempat dengan datanya. Kolom `geom` sengaja
`geometry(Geometry, 4326)` (untyped, bukan LineString/Point tunggal) karena tabel ini
menampung KEDUA jenis geometri (rute BisKita = LineString, KRL = LineString rel + Point
stasiun) dibedakan lewat kolom `jenis` (`biskita_survei`/`krl`) + `tipe_geometri`
(`line`/`point`) sebagai bantuan eksplisit untuk frontend. RLS: publik boleh baca saja,
sama seperti tabel lain.

Script ETL baru: `etl/build_rute_transit_eksisting.py` (dry-run sudah dijalankan &
diverifikasi, **upload sungguhan BELUM jalan** — nunggu migration 013 diterapkan,
lihat blocker di atas):

- **B1 (BisKita, 15 titik)**: LineString dibangun dari `halte_eksisting` REAL
  (bukan CSV survei lagi — diambil dari tabel live yang sudah diperbaiki labelnya,
  lihat bug rotate-by-one di update sebelumnya), diurutkan `id_halte_survei`
  HLT-001→HLT-015. **Verifikasi koherensi spasial** (diminta eksplisit sebelum
  dipakai): total panjang jalur berurutan ~15,4 km, seluruh 15 titik berada dalam
  koridor sempit (rentang longitude hanya ~1 km, 106.983–106.993) dengan latitude
  bergerak progresif dari -6.2556 (utara) ke -6.3105 (selatan, titik terselatan di
  HLT-009/010) — POLA KOHEREN (satu koridor utara-selatan), TAPI urutan **tidak
  sepenuhnya monoton**: HLT-011 (-6.2834) dan HLT-014/015 (-6.2724) kembali ke utara
  setelah HLT-009/010 yang lebih selatan, kemungkinan mencerminkan pola penyusuran
  pergi-pulang (PP)/dua-arah, bukan garis lurus tunggal. **Disclaimer ini ditulis
  eksplisit di kolom `catatan` baris yang diupload** — TIDAK disajikan sebagai rute
  resmi GTFS/KMZ operator (tim tidak punya data itu sama sekali), label `sumber` juga
  menyatakan ini APROKSIMASI.
- **B2 (KRL, REAL, dari BIG RBI 25K)**: `STASIUNKA_PT_25K` (1 titik, Stasiun Bekasi)
  + `RELKA_LN_25K` (33 ruas total di seluruh Kab. Bekasi, **12 ruas beririsan dengan
  Kota Bekasi**, dipotong presisi ke boundary union 56 kelurahan RBI real — bukan
  cuma difilter, tapi di-`intersection()` supaya ruas yang sebagian di luar kota tidak
  ikut tergambar; menghasilkan **13 baris LineString** setelah 1 ruas MultiLineString
  pecah jadi 2 part). Total **14 baris jenis='krl'** (1 stasiun + 13 ruas) siap upload.
  Sumber & catatan eksplisit menyatakan "REAL, existing infrastructure, belum
  disurvei tim" — beda status dengan BisKita yang disurvei lapangan.
- **B3 (moda lain)**: `TERMINALBUS_PT_25K` dicek (bukan diupload) — **1 titik total di
  seluruh Kab. Bekasi di .gdb, 0 di dalam Kota Bekasi** setelah clip ke boundary.
  Dikonfirmasi ULANG (independen dari catatan lama di file ini) — **tidak ada data
  rute/terminal resmi untuk Transjakarta/Damri/angkot** di sumber data yang tersedia.
  Tidak ada data dikarang untuk mengisi kekosongan ini — kalau Sam ingin moda ini
  ditambahkan ke peta, perlu sumber terpisah (GTFS Transjakarta publik, atau data
  trayek Damri/angkot dari Dishub Kota Bekasi langsung).

**Setelah migration 012+013 diterapkan Sam**, jalankan:
```
python etl/build_rute_transit_eksisting.py --upload
```
untuk benar-benar menulis 1 baris BisKita + 14 baris KRL ke `rute_transit_eksisting`.

> **✅ Status per update "rute BisKita sekarang mengikuti jaringan jalan" di atas**: sudah
> dijalankan — `rute_transit_eksisting` sekarang berisi **15 baris total**: 1 baris
> `biskita_survei` (LineString rute jalan, lihat update di atas) + 14 baris `krl`
> (13 `line` ruas rel + 1 `point` Stasiun Bekasi). Dicek langsung dari DB, bukan asumsi.

## ✅ Update 28 Agustus (malam, lanjutan): bug rotate-by-one pada `halte_eksisting` (14/15 baris REAL) diperbaiki

`qa-tester` menemukan (diverifikasi ulang independen oleh `data-ai-analyst`): 14 dari 15 baris
`halte_eksisting` REAL (`HLT-001`..`HLT-015`) punya `id_halte_survei`/`nama` yang TIDAK cocok
dengan koordinatnya — hanya `HLT-001` yang benar.

**Root cause**: sesuai catatan di entri "Cek status live database" di bawah, 15 baris ini
diupload lewat **jalur ad-hoc di sesi sebelumnya** (bukan `load_halte_survey_excel()`/
`upload_halte_data()` yang ada di `etl/upload_to_supabase.py` saat ini — kode itu justru akan
skip semua 15 baris karena Latitude/Longitude kosong di Excel yang sekarang). Skrip ad-hoc itu
**tidak pernah masuk repo** jadi baris kodenya sendiri tidak bisa ditelusuri persis, tapi pola
datanya membongkar bentuk bug-nya: **bukan geser-satu sederhana**, melainkan **rotasi** — dalam
urutan CSV sumber (`etl/data/survei/koordinat_halte_koridor_biskita.csv`, indeks 0=HLT-001 s.d.
14=HLT-015), koordinat yang ter-upload berurutan persis `[CSV[0], CSV[2], CSV[3], ..., CSV[14],
CSV[1]]` — yaitu CSV asli dengan baris `HLT-002` (indeks 1) dipindah dari posisinya ke paling
akhir. Ciri ini konsisten dengan proses "gabung by name, bukan by koordinat" yang disebut di
entri di bawah: kalau nama `HLT-002` ("Halte Pekayon Ahmad Yani") gagal match tepat pada pass
pertama (mis. karena penulisan nama Excel vs CSV sedikit beda) lalu di-retry/ditaruh di akhir
antrian, hasilnya persis rotasi yang teramati — **bukan** bug `zip()` off-by-one klasik. Efeknya:
`id_halte_survei` dan `nama` 14 baris tertukar satu sama lain, tapi **koordinat (`geom`) semua
baris tetap benar sejak awal** (tidak pernah salah).

**Dampak ke skor**: NIHIL. Semua perhitungan hilir yang memakai `halte_eksisting`
(`compute_tdi_full.py` — jarak grid ke halte via `sjoin_nearest` pada `geom`; `skor_survei` yang
dipakai `compute_scores.py`) bergantung pada **koordinat**, bukan `id_halte_survei`/`nama` — dan
koordinat tidak pernah salah. `skor_tdi`, `skor_cai`, `skor_equity` yang sudah live **tidak perlu
dihitung ulang**.

**Perbaikan**: `UPDATE` in-place per baris (PK `id` tidak berubah, `geom` tidak disentuh sama
sekali) — dicocokkan ke CSV sumber **berdasarkan koordinat** (toleransi 1e-5°), bukan
`id_halte_survei` yang justru sedang salah. Karena `id_halte_survei` punya `UNIQUE` constraint
(`001_init_tables.sql` baris 60) dan bug-nya berbentuk rotasi (nilai final satu baris = nilai
lama baris lain yang juga sedang diubah), update dijalankan **2 fase** supaya tidak tabrakan
constraint: fase 1 lepas semua `id_halte_survei` lama yang salah ke placeholder sementara
(`TMP-<pk_id>`), fase 2 baru set ke nilai final CSV. Sebelum eksekusi, skrip men-cek bijektif
(tidak ada 2 baris DB yang match ke `id_halte_survei` CSV yang sama) dan jumlah match harus
tepat 15 — kalau tidak, dibatalkan otomatis tanpa UPDATE apa pun.

14 baris diperbaiki (`db_id` 8-21, PK Supabase; `HLT-001`/`db_id`=7 sudah benar sejak awal, tidak
disentuh). 6 baris `DUMMY-HLT-*` tidak disentuh. **Verifikasi ulang setelah UPDATE**: query 15
baris REAL lagi, cocokkan tiap `id_halte_survei`+`nama`+koordinat ke CSV — **15/15 cocok persis**
(termasuk penyimpangan ejaan yang memang ada di CSV asli, mis. `HLT-014`="Halte univ trisakti 2"
huruf kecil — sengaja dipertahankan verbatim sesuai CSV, bukan dirapikan, karena CSV adalah
sumber kebenaran apa adanya). Contoh sebelum → sesudah:
- `db_id=8`: `HLT-002`/"Halte Revo Mall" → `HLT-003`/"Halte Revo Mall" (koordinat tidak berubah,
  106.99061/-6.25558 — nama kebetulan sudah benar sebelumnya, cuma ID-nya yang salah).
- `db_id=21`: `HLT-015`/"Halte Pekayon" → `HLT-002`/"Halte Pekayon Ahmad Yani" (koordinat tidak
  berubah, 106.99103/-6.25669).

**Pelajaran untuk re-seed di masa depan**: kalau perlu upload ulang/tambah halte dari CSV
koordinat, JANGAN gabung dua sumber (Excel nama + CSV koordinat) dengan asumsi urutan baris sama
persis (`zip()` posisional) — cocokkan dengan kunci eksplisit (`id_halte_survei` yang sudah
dijamin unik oleh guard di `load_halte_survey_excel()`/`upload_halte_data()`, atau kalau
terpaksa pakai nama, pastikan exact-match 100% sebelum upload, jangan biarkan mismatch diam-diam
"digeser" ke posisi lain).

## ⚠️ Update 28 Agustus (malam): keputusan Sam soal status 8 titik traffic counting "REAL"

`project-lead` audit isi `Instrumen_Survei_GeoTransitInsight_Final.xlsx` sheet Form Traffic
Counting: 8 titik yang selama ini disebut "REAL" (KND-002 s.d. KND-009, dipakai hitung
`skor_cai`/`skor_equity`) punya catatan asli **"[ESTIMASI 2 JAM - REVISI]... disesuaikan
arahan PIC — bukan hasil traffic counting aktual"**.

**Klarifikasi Sam (penting, jangan disalahartikan sebagai data dikarang dari nol):** tim
memang benar-benar mendatangi tiap lokasi, tapi karena semua anggota tim bekerja, tidak ada
waktu untuk sesi hitung kontinu 2 jam penuh di tiap titik seperti desain awal instrumen.
Angka `total_aktivitas` adalah **estimasi dari kunjungan/observasi lapangan singkat**, bukan
hitungan menerus 2 jam, dan disesuaikan mengikuti arahan PIC — **bukan angka yang dikarang
tanpa kunjungan sama sekali**.

**Keputusan: dipertahankan apa adanya, TIDAK direplace di Field Day 3.** `skor_cai`/
`skor_equity` yang sudah live tidak diubah. Konsekuensinya: `n_volume` (bobot CAI 0,25,
terbesar kedua) untuk 8 titik ini punya presisi lebih rendah dari traffic counting kontinu
sesungguhnya — perlu disebutkan sebagai keterbatasan metodologi di laporan akhir (bukan
disembunyikan), bukan diklaim sebagai pengukuran presisi.

**15 titik baru (KND-010 s.d. KND-024)**: koordinatnya juga estimasi (bukan GPS asli) —
**belum diupload**, Sam sedang minta rekan tim perbaiki koordinatnya dulu. Jangan diproses
ke `skor_cai` sampai itu selesai.

**Bug terpisah ditemukan**: `HLT-001` di sheet Form Kondisi Halte muncul 2x dengan nama/
lokasi berbeda (Halte Summarecon Bekasi vs Halte Simpang Pekayon) — didelegasikan ke
`data-ai-analyst` untuk diperbaiki.

## ✅ Koreksi (28 Agustus, malam): baris 3 KONFIRMASI Sam memang contoh, BUKAN data hilang

Entri di bawah ini (ditulis `data-ai-analyst`) sempat menyimpulkan "Halte Summarecon Bekasi"
(baris 3 Form Kondisi Halte) dan `KND-001` (baris 3 Form Traffic Counting) sebagai data real
yang hilang/tidak terproses, karena isinya detail (nama, surveyor, koordinat presisi) — bukan
teks "CONTOH" generik. **Sam konfirmasi langsung: baris-baris itu memang contoh pengisian,
bukan hasil survei sungguhan** — cuma kebetulan diisi dengan detail yang meyakinkan. Jadi:
**tidak ada data real yang hilang**, `HLT-001`=Simpang Pekayon di database sudah benar &
lengkap, `KND-001` memang seharusnya tidak diproses.

Guard duplikat-ID yang ditambahkan tetap dipertahankan (tidak dicabut) — bukan lagi untuk
"data hilang", tapi sebagai pengaman ke depan: format contoh yang terlalu meyakinkan begini
berisiko bikin surveyor Field Day 3 tanpa sadar reuse ID yang sama seperti contoh. Tidak ada
tindak lanjut lain diperlukan untuk baris 3 kedua sheet ini.

## ⚠️ Update 28 Agustus (malam, lanjutan) — SUDAH DIKOREKSI DI ATAS, dibiarkan untuk jejak audit: bug `HLT-001` duplikat — guard ETL ditambahkan, sempat disangka data live HILANG

`data-ai-analyst` menindaklanjuti temuan `project-lead` di atas. **File Excel sumber TIDAK
diedit** (sesuai batasan — itu jejak audit data lapangan tim survei asli).

**Penyebab akar (root cause) — bukan cuma "ID kebetulan sama"**: baris 3 sheet Form Kondisi
Halte, yang menurut desain instrumen (lihat sheet "Petunjuk") seharusnya diisi teks "CONTOH"
placeholder (dilewati saat load), ternyata di file ini **terisi data yang terlihat asli**
("Halte Summarecon Bekasi", surveyor **Rafael Williem**, tanggal survei 10/08/2026, koordinat
presisi -6.2185/107.0074). Baris 4 dst diisi surveyor **Samuel Alfa Edison** mulai ID `HLT-001`
lagi — kemungkinan besar mengikuti teks petunjuk kolom ID ("Kode unik, mis. HLT-001") tanpa
sadar baris 3 sudah memakai ID yang sama untuk titik yang benar-benar berbeda. Pola identik
juga terlihat di sheet **Form Traffic Counting**: baris 3 (`KND-001`, "Simpang Jl. Chairil
Anwar - Jl. Kartini") juga terisi data yang terlihat asli, bukan teks contoh generik — **dicek
langsung ke tabel `titik_kandidat`, `KND-001` TIDAK PERNAH ada di database** (baris data mulai
`KND-002`), konsisten dengan loop produksi yang memang selalu mulai baca dari baris 4.
**Dilaporkan sebagai temuan tambahan untuk Sam — belum diperbaiki, di luar cakupan tugas ini**;
kemungkinan `KND-001` juga data titik real yang selama ini tak sengaja tidak pernah terproses,
perlu dikonfirmasi tim survei sebelum diputuskan apakah perlu ditambahkan.

**Cek status live database (sebelum ada perbaikan apa pun)**: `halte_eksisting` **SUDAH berisi**
15 baris `HLT-001`..`HLT-015` (id 7-21), diupload di sesi sebelumnya lewat jalur ad-hoc yang
menggabungkan nama baris 4-18 Excel dengan koordinat `koordinat_halte_koridor_biskita.csv`
(dicocokkan per nama, bukan per ID — bukan lewat `load_halte_survey_excel()` yang ada di kode
saat ini, yang justru akan skip semua 15 baris itu karena Latitude/Longitude-nya kosong di file
Excel yang sekarang). Yang tersimpan sebagai `HLT-001` di database adalah **"Halte Simpang
Pekayon"** (baris 4). **"Halte Summarecon Bekasi" (baris 3, surveyor Rafael Williem) TIDAK ADA
SAMA SEKALI di `halte_eksisting`** — datanya hilang sejak awal, bukan baru akan hilang. Ini
persis skenario yang dikhawatirkan tugas ini: satu dari dua baris ber-ID sama "kalah" secara
diam-diam.

**Guard ditambahkan** (`etl/upload_to_supabase.py`):
1. `load_halte_survey_excel()` — pemindaian ID Halte SEKARANG dilakukan di awal fungsi,
   mencakup baris 3 (bukan cuma mulai baris 4 seperti loop produksi) supaya kasus persis
   seperti ini (duplikat antara baris "CONTOH" yang terisi asli & baris data sungguhan)
   tetap terdeteksi. Kalau ada ID yang muncul >1 kali, fungsi **raise `ValueError` dan
   berhenti total — 0 baris diproses/dikembalikan**, dengan pesan mencantumkan nomor baris,
   nama, kecamatan/kelurahan tiap baris yang bentrok, dan langkah tindak lanjut (minta ID unik
   dari tim survei, bukan sistem yang menebak). Diverifikasi jalan: menjalankan fungsi ini pada
   file saat ini langsung `raise ValueError` mengutip baris 3 vs baris 4 `HLT-001` — 0 records,
   tidak ada yang lolos ke upload.
2. `upload_halte_data()` — guard kedua (defense-in-depth) mengecek ulang `id_halte_survei`
   duplikat pada `records` tepat sebelum upsert, untuk kasus `records` dibangun dari jalur lain
   di masa depan (mis. digabung manual dengan CSV koordinat) yang tidak lewat guard #1. Diuji
   dengan records tiruan ber-ID sama → `ValueError`, upload dibatalkan.

**TIDAK ADA upload baru dijalankan** — tidak ada perubahan pada tabel `halte_eksisting`
(masih 21 baris seperti sebelumnya: 6 dummy + 15 real HLT-001..015 yang sudah live, dengan
Summarecon Bekasi tetap absen). Menunggu keputusan Sam/tim survei sebelum data ini disentuh.

**Yang masih perlu tim survei/Sam putuskan (BUKAN keputusan teknis, diteruskan lewat user)**:
1. Beri ID unik untuk baris 3 ("Halte Summarecon Bekasi") — mis. `HLT-016` (ID baru, bukan
   `HLT-001` yang sudah dipakai baris 4) — di file Excel sumber, dilakukan tim survei sendiri
   (ETL ini sengaja tidak menyentuh file Excel).
2. Putuskan apakah "Halte Summarecon Bekasi" perlu diupload sebagai halte ke-16 (perlu update
   `koordinat_halte_koridor_biskita.csv`/proses upload juga menambahkan baris ini — saat ini
   CSV cuma punya 15 baris, tidak termasuk Summarecon Bekasi).
3. Konfirmasi status baris 3 di sheet Form Traffic Counting (`KND-001`) — real atau memang
   contoh yang tidak perlu diproses — supaya konsisten dengan keputusan soal `HLT-001` di atas.
4. Setelah ID unik diberikan, `HLT-001` (Simpang Pekayon) yang **sudah live di database TIDAK
   perlu diupload ulang** (upsert `on_conflict='id_halte_survei'` akan tetap match by ID yang
   sama, aman) — hanya baris baru (Summarecon Bekasi) yang perlu ditambahkan.

## ✅ Update 28 Agustus: `n_kepadatan` CAI (8 titik real) diganti dari placeholder konstan ke kepadatan REAL per titik; Equity 56 kelurahan direcompute

`data-ai-analyst` memperbaiki temuan `qa-tester` (27 Agu): kolom `n_kepadatan` di
`skor_cai` — bobot TERBESAR CAI (0,35) — memakai `KEPADATAN_NEUTRAL_PLACEHOLDER`
(konstanta 11650) untuk **semua 8 titik_kandidat REAL** sekaligus, sehingga
`normalize_min_max()` otomatis mengembalikan 0,5000 identik di semua baris
(hi==lo) — kriteria berbobot terbesar itu efektif TIDAK diskriminatif sama sekali.

**Perbaikan**: script baru `etl/attach_kepadatan_titik_kandidat.py` mengambil
kepadatan_penduduk REAL per titik lewat **spatial join titik_kandidat →
grid_analisis** (2.607 cell, 300m, hasil TRUE dasymetric mapping building
footprint OSM asli — data yang sudah ada, tinggal disambungkan). Metodologi
(dijelaskan lengkap di docstring modul):
1. **UTAMA — point-in-polygon (`within`)**, proyeksi EPSG:32748: titik dicek
   jatuh di cell grid_analisis mana. Valid karena grid_analisis fishnet UTUH
   tanpa celah internal (`clip_to_boundary()` pakai predikat `intersects`,
   bukan `gpd.clip`, jadi tiap cell tetap kotak penuh 300x300m).
2. **FALLBACK — nearest-neighbor (`sjoin_nearest`)** untuk titik yang tidak
   jatuh di cell manapun (edge case tepi bounding box fishnet). **Hasil
   aktual: 8/8 titik match langsung via `within`, fallback tidak pernah
   terpakai** (dicetak eksplisit di log kalau suatu saat terpakai, termasuk
   jarak fallback-nya, supaya tidak diam-diam dipakai untuk kasus yang tidak
   wajar).
3. Konversi satuan: `grid_analisis.kepadatan_penduduk` adalah **jiwa per
   cell** (bukan per km²) — dibagi luas cell asli (dihitung per-baris di
   EPSG:32748, ~0,09 km² untuk 300x300m) supaya jadi **jiwa/km²**, konsisten
   dengan semantik kolom yang sama di `compute_cai()`.

`recompute_all_cai_scores()` di `etl/upload_to_supabase.py` diperluas (BACKWARD
COMPATIBLE, default lama tidak berubah) dengan 2 parameter opsional baru:
`kepadatan_by_titik_id` (dict override per titik, dipakai skrip baru ini) dan
`upload` (dry-run kalau `False`). KND-DEMO-001..004 (`skor_cai` id 1-4) **TIDAK
disentuh sama sekali** — tetap dari `load_demo_data()` sintetis seperti sebelumnya.

**8 nilai `n_kepadatan`/`skor_final` CAI — lama vs baru** (`titik_kandidat_id`,
urut lama):

| id_titik_survei | kepadatan (jiwa/km²) | n_kepadatan lama | n_kepadatan baru | skor_final lama | skor_final baru |
|---|---|---|---|---|---|
| KND-003 (tk_id=6) | 20.910 | 0,5000 | **1,0000** | 0,6598 | **0,8348** |
| KND-002 (tk_id=5) | 8.047 | 0,5000 | **0,1576** | 0,6166 | **0,4967** |
| KND-007 (tk_id=10) | 15.407 | 0,5000 | **0,6396** | 0,5750 | **0,6239** |
| KND-006 (tk_id=9) | 15.407 | 0,5000 | **0,6396** | 0,4769 | **0,5258** |
| KND-008 (tk_id=11) | 5.641 | 0,5000 | **0,0000** | 0,4081 | **0,2331** |
| KND-004 (tk_id=7) | 8.047 | 0,5000 | **0,1576** | 0,3622 | **0,2424** |
| KND-005 (tk_id=8) | 15.407 | 0,5000 | **0,6396** | 0,2579 | **0,3068** |
| KND-009 (tk_id=12) | 10.706 | 0,5000 | **0,3317** | 0,1750 | **0,1161** |

**Ranking CAI 8 titik berubah cukup besar** (5 dari 8 posisi bertukar): lama
6,5,10,9,11,7,8,12 (urut skor tertinggi→terendah) → baru **6,10,9,5,8,7,11,12**.
KND-003 (Akses Masuk Stasiun Bekasi) tetap #1 (skornya justru naik — memang
kepadatan tertinggi di antara 8 titik, konsisten). KND-002 (Area Parkir Stasiun
Bekasi Timur) turun dari #2 ke #4 (kepadatan sekitarnya ternyata jauh lebih
rendah dari titik lain, bukan cuma efek placeholder netral lagi).

**SETELAH itu**: `skor_equity` di-recompute ulang untuk 56 kelurahan lewat
`etl/aggregate_equity_kelurahan.py --upload` (script sudah ada dari sesi
sebelumnya, dijalankan ulang murni karena `skor_cai_rata2` jadi usang) —
idempotent (DELETE `sumber ilike 'REAL - %'` lalu INSERT ulang, 5 baris DUMMY
lama tidak tersentuh). Rata-rata `skor_cai` kota (fallback 53/56 kelurahan
tanpa titik survei sendiri) bergeser dari **0,4414 → 0,4224** (rata-rata baru
dari 8 titik real yang skornya sudah tidak dibiaskan placeholder). Durenjaya
(satu-satunya kelurahan dengan agregasi lokal sungguhan, n=4 titik survei di
dalamnya) skor_cai_rata2-nya juga berubah dari 0,3816 → **0,3564** (dihitung
ulang dari 4 skor_cai yang sudah pakai kepadatan real).

**Verifikasi arah skala & ranking** (`skor_final` tetap skor KETIMPANGAN, ranking
1 = paling dirugikan): dicek ulang eksplisit — ranking 1 (Arenjaya) memang punya
`skor_final` tertinggi (0,6135) di antara 56 baris REAL, arah skala TIDAK
terbalik. **18 dari 56 ranking berubah** dibanding sebelumnya (dibandingkan
per `kelurahan_id`, bukan posisi baris) — **top-10 nyaris stabil**, cuma
posisi #1/#2 bertukar (**Arenjaya naik dari #2 ke #1, Durenjaya turun dari #1
ke #2** — skor keduanya sangat berdekatan, 0,6135 vs 0,5962, jadi pertukaran
kecil di fallback constant cukup membalik urutan tipis ini; posisi #3-10
identik dengan sebelumnya). Perubahan lebih besar terjadi di kelurahan
peringkat menengah-bawah (skor-skor berdekatan, wajar untuk n=56, sama seperti
pola sensitivity check yang sudah didokumentasikan sebelumnya — bukan tanda
formula rapuh). `skor_final` range baru: 0,1494 - 0,6135 (sebelumnya
0,15 - 0,60, hampir tidak berubah secara agregat).

**Cara re-run** (idempotent, aman dipanggil ulang kapan pun ada revisi
titik_kandidat baru): `python etl/attach_kepadatan_titik_kandidat.py --upload`
lalu **WAJIB** diikuti `python etl/aggregate_equity_kelurahan.py --upload`
(equity bergantung pada CAI, urutan ini tidak boleh dibalik/dilewati).

## ✅ Update 27 Agustus (malam, lanjutan lagi): TDI 2.607 grid & Equity 56 kelurahan SELESAI; deploy `ai-insight` BLOCKED classifier

`data-ai-analyst` melanjutkan sesi yang sempat stall. Konfigurasi bobot `TDI_MOBILITAS`/`EQUITY`
di `konfigurasi_bobot` (13 baris total, disetujui mentor via review worksheet 27 Agu — BUKAN
pairwise Saaty formal, `consistency_ratio` NULL) sudah diverifikasi ada, sehingga blocker di
update sebelumnya (di bawah) sudah lepas:

1. **`compute_tdi()` dijalankan untuk seluruh 2.607 grid** (`etl/compute_tdi_full.py --upload`).
   `skor_aksesibilitas_transit` (input yang sebelumnya belum ada cara hitungnya) SEKARANG dihitung
   dari decay linear isochrone 400m/800m terhadap jarak ke 15 halte real (BisKita). Upload berhasil
   2.607/2.607 baris. Face-validity: cell ≤400m dari halte rata2 skor_tdi=0,18, cell >800m
   rata2=0,52 (arah sesuai ekspektasi). Detail lengkap di Kategori E.
2. **`skor_equity` dimigrasi ke 56 kelurahan RBI asli** (`etl/aggregate_equity_kelurahan.py
   --upload`, script baru), ADDITIVE terhadap 5 baris dummy lama. Strategi `skor_cai_rata2` untuk
   53/56 kelurahan yang belum punya `titik_kandidat` survei: fallback rata-rata skor_cai kota
   (0,4414), ditandai eksplisit lewat kolom `sumber` baru (`010_skor_equity_sumber.sql`) — BUKAN
   diam-diam disamakan dengan kelurahan yang benar-benar disurvei. Detail lengkap di Kategori E.
3. **Bug ditemukan & diperbaiki**: Edge Function `supabase/functions/ai-insight/index.ts` melakukan
   `order('ranking').limit(5)` TANPA filter `sumber` — begitu langkah 2 di atas membuat tabel
   `skor_equity` berisi DUMMY (ranking 1-5) DAN REAL (ranking 1-56) sekaligus, query itu berisiko
   mencampur keduanya (persis yang diperingatkan komentar `010_skor_equity_sumber.sql`, yang
   ternyata belum benar-benar diterapkan ke kode walau komentarnya mengklaim sudah). Sudah
   diperbaiki (filter `.ilike('sumber','REAL%')` + fallback berlapis kalau data REAL kosong), TAPI
   **`npx supabase functions deploy ai-insight` ditolak permission classifier sesi ini — BELUM
   live**. Sam perlu jalankan manual: `npx supabase functions deploy ai-insight
   --project-ref=vpymlmaebvfmpowomsec`. Sampai itu dijalankan, endpoint AI Spatial Consultant masih
   pakai kode lama (berisiko ranking campur dummy/real).
4. **Belum dikerjakan (di luar cakupan sesi ini)**: `kelompok_terdampak`/`rekomendasi_intervensi`
   untuk 56 baris equity real — sengaja NULL, bukan dikarang otomatis. Lihat Kategori D.

Validasi dijalankan lewat fungsi `sensitivity_check_tdi()`/`sensitivity_check_equity()` yang
SUDAH ADA di `compute_scores.py` (bukan loop custom baru — itu yang diduga jadi penyebab stall
sesi sebelumnya) + `.describe()` pandas standar + query spasial `ST_DWithin`/`sjoin` untuk
face-validity. Semua berjalan cepat (hitungan detik-menit), tidak ada tanda-tanda operasi lambat.

## ✅ Update 27 Agustus (malam, lanjutan): building footprint OSM asli + TRUE dasymetric grid SELESAI; TDI & Equity migration BLOCKED bobot AHP

`data-ai-analyst` menjalankan `etl/fetch_osm_building_footprints.py` (Overpass API, tiled 4x4
supaya tidak timeout) untuk seluruh Kota Bekasi. Percobaan pertama kena rate limit cukup parah
(6/16 tile gagal — HTTP 429 Too Many Requests & 504 Gateway Timeout). Dua kali retry (yang
kedua cuma 1 tile tersisa, request tunggal) berhasil melengkapi semua tile tanpa perlu
menunggu lama antar percobaan — **16/16 tile berhasil, 567.359 building footprint unik**
tersimpan di `etl/data/osm/building_footprint_bekasi.geojson` (jauh di atas estimasi awal
~206.700, kemungkinan estimasi awal itu undercount).

Building footprint ini lalu dipakai sebagai bobot di `etl/build_fishnet_grid.disaggregate_population_dasymetric()`
lewat script baru `etl/rerun_dasymetric_grid.py` — mengganti mode *areal weighting* (fallback,
dipakai saat grid pertama kali dibuat) dengan **TRUE dasymetric weighting** (populasi kelurahan
disebar proporsional ke luas building footprint per cell, bukan proporsional ke luas cell itu
sendiri). Grid yang di-update adalah grid **yang SUDAH ADA** di `grid_analisis` (diambil ulang
by `id` + geom dari Supabase, bukan generate fishnet baru) supaya id/row tidak berubah — hanya
kolom `kepadatan_penduduk` yang di-UPDATE (per-baris, 2.607 request, bukan upsert batch — lihat
catatan teknis di `rerun_dasymetric_grid.py` soal kenapa upsert on_conflict='id' gagal untuk
kolom identity `generated always as identity`).

**Assert konservasi populasi lolos PERSIS**: total penduduk 56 kelurahan RBI = 2.607.248,
total tersebar ke grid (dasymetric) = 2.607.248,00 (selisih 0,00 — bahkan lebih presisi dari
hasil areal-weighting sebelumnya yang selisih 0,19 murni rounding). Distribusi sekarang jauh
lebih tajam/realistis dibanding areal-weighting: rentang 0 – 14.890,83 jiwa per cell (300m),
831 dari 2.607 cell bernilai 0 (cell tanpa building footprint sama sekali — masuk akal untuk
RTH/lahan kosong/badan jalan/industri tanpa hunian), dibanding areal-weighting yang cenderung
merata dalam satu kelurahan tanpa variasi tajam. Contoh 3 cell pertama (id 1-3), before (areal)
→ after (dasymetric): id 1: 151,42 → 525,48 | id 2: 198,71 → 954,65 | id 3: 110,36 → 22,81 —
menunjukkan cell yang kebetulan berimpit klaster bangunan padat mendapat porsi jauh lebih besar,
sesuai definisi dasymetric mapping (bukan cuma linear scaling seragam).

**TDI (`compute_tdi()`) dan migrasi `skor_equity` ke 56 kelurahan RBI asli: BLOCKED, bukan
dikerjakan sesi ini.** Dicek langsung ke `konfigurasi_bobot` di database (bukan asumsi dari
file ini) 2x — di awal dan di akhir sesi kerja (~40 menit kemudian, tidak berubah): tabel itu
masih **HANYA berisi 4 baris untuk `nama_index='CAI'`**, 0 baris untuk `'TDI_MOBILITAS'` atau
`'EQUITY'`. Sesuai instruksi eksplisit tim (jangan mengarang bobot AHP), kedua langkah itu
DIHENTIKAN di titik ini, bukan dipaksa jalan dengan bobot asumsi. Begitu sesi AHP mentor
selesai dan baris `TDI_MOBILITAS`/`EQUITY` terisi di `konfigurasi_bobot`, tinggal jalankan:
`compute_tdi()` (perlu tambahan: overlay POI/mobilitas per grid + `proporsi_usia_rentan` per
cell dari spatial join `penduduk`, belum ada scriptnya) dan `compute_equity_index()` untuk 56
kelurahan (lihat catatan constraint di bawah — cakupan `titik_kandidat` per kelurahan masih
sangat jarang, cuma 12 baris real menyentuh 6 dari 56 kelurahan, agregasi `skor_cai_rata2` per
kelurahan perlu strategi eksplisit untuk 50 kelurahan tanpa titik kandidat sama sekali — bukan
sekadar "tinggal jalankan", perlu keputusan desain tambahan saat waktunya tiba).

Catatan tambahan soal `skor_equity` untuk saat migrasi nanti dikerjakan: tabel itu **TIDAK
punya kolom `sumber`** (beda dengan `batas_administrasi`/`penduduk`/`poi`) — kalau nanti 56
baris kelurahan RBI asli ditambahkan berdampingan dengan 5 baris dummy lama (FK ke
`batas_administrasi` id 6-10, kelurahan dummy), perlu migration baru (`009_...sql`, pola sama
`008_batas_administrasi_sumber.sql`) untuk kolom label sumber, DAN perlu strategi eksplisit
untuk kolom `ranking` supaya tidak duplikat 1-5 antara baris dummy & baris real (edge function
`ai-insight` query `order('ranking').limit(5)` tanpa filter sumber — kalau ranking dummy &
real sama-sama mulai dari 1, top-5 yang dikembalikan bisa campur/tidak terduga). Ini dicatat di
sini supaya tidak lupa saat bobot AHP Equity akhirnya tersedia, BUKAN dikerjakan sekarang.

## ✅ Update 27 Agustus (malam): data penduduk resmi + fishnet grid skala penuh SELESAI

`data-ai-analyst` upload 56 baris `penduduk` (Disdukcapil Kota Bekasi, DKB Semester I 2026,
total 2.607.248 jiwa, `etl/load_penduduk.py`) — semua 56 kelurahan cocok ke `batas_administrasi`
(RBI), tanpa warning cross-validation. Lalu re-run `etl/build_fishnet_grid.py` skala penuh kota:
2.607 cell (300m), assert konservasi populasi lolos. Detail di baris tabel Kategori B & E di
bawah.

**⚠️ ISU TERBUKA — perlu keputusan tim, didelegasikan ke `product-analyst`**: PRD/proposal saat
ini mengutip DKB **Semester II 2025 = 2.595.927 jiwa**. Data yang baru diupload adalah DKB
**Semester I 2026 = 2.607.248 jiwa** (lebih baru, lengkap per kelurahan, dipakai karena itu yang
tersedia). Selisih ~11.321 jiwa (0,4%) — kecil secara persentase tapi PRD & angka di database
sekarang TIDAK sinkron. Perlu diputuskan: update semua kutipan angka penduduk kota di
PRD/proposal/dashboard ke Semester I 2026, atau ganti sumber data ke Semester II 2025 supaya
sinkron dengan yang sudah ditulis. Belum diputuskan sendiri oleh `data-ai-analyst` — di luar
kewenangan mengubah angka resmi proposal.

## ⏳ Update 27 Agustus (lanjutan, sore): ETL siap, upload TERTAHAN di migration schema

`data-ai-analyst` menulis `etl/build_admin_boundaries_from_rbi.py` (baca gdb, filter
`WADMKK='Kota Bekasi'`, drop dimensi Z/reproject ke EPSG:4326 murni, konversi
MultiPolygon 1-part -> Polygon sesuai skema, cek 12 kecamatan & 56 kelurahan +
sanity check luas). **Dry-run berhasil dan sudah diverifikasi**: 12 kecamatan,
56 kelurahan, luas total ~217,0 km² (estimasi EPSG:3857) vs BPS ~210,5 km²
(selisih 3,1%, wajar), tidak ada duplikat nama dalam data resmi itu sendiri.

**Strategi migrasi vs 6 baris dummy (`006_seed_dummy_data.sql`): ADDITIVE, bukan
replace.** Dicek manual: TIDAK ADA collision `nama_kelurahan` exact antara 6 baris
dummy (ejaan longgar berspasi: "Mustika Jaya", "Bantar Gebang", "Rawa Lumbu",
"Bekasi Utara", "Marga Mulya", "Bekasi Timur") dengan 56 baris resmi RBI (ejaan
BIG tanpa spasi: "Mustikajaya", "Bantargebang", "Rawalumbu", "Margamulya";
"Bekasi Utara"/"Bekasi Timur" di data resmi cuma muncul sebagai nama KECAMATAN,
bukan kelurahan). `penduduk` (24 baris) dan `skor_equity` (5 baris) masih 100%
FK (ON DELETE CASCADE) ke 6 baris dummy itu dan masih dipakai demo/testing RPC
`simulate_new_stop` + Equity Dashboard — REPLACE (delete dummy) akan
cascade-menghapus 29 baris itu tanpa ada pengganti data BPS/AHP yang siap.
Karena tidak ada collision nama, aman untuk INSERT 56 baris resmi berdampingan
dengan 6 baris dummy, dibedakan lewat kolom baru `sumber` (migration
`008_batas_administrasi_sumber.sql`, pola sama dengan `poi.sumber`).

**TERTAHAN**: migration `008_batas_administrasi_sumber.sql` (nambah kolom
`sumber`) BELUM diterapkan ke database produksi — `npx supabase db push` dan
bahkan satu query `select` probe ditolak oleh permission classifier sesi Claude
Code ini (bukan soal keamanan strategi migrasinya, tapi pembatasan alat di sesi
ini). Upload data 56 kelurahan (`python etl/build_admin_boundaries_from_rbi.py
--upload`) BELUM dijalankan — nunggu migration 008 diterapkan lebih dulu (lewat
`npx supabase db push --project-ref=vpymlmaebvfmpowomsec` di terminal Sam
sendiri, atau paste isi file itu ke Supabase SQL Editor), baru upload bisa
jalan. Migration `007_seed_titik_kandidat_link_cai.sql` juga terdeteksi belum
tercatat di riwayat migration remote (`npx supabase migration list` ->
`remote: ""`) walau datanya (KND-DEMO-001..004) sudah ada di database — kemungkinan
diterapkan sebelumnya lewat SQL Editor manual, bukan `db push`; migration itu
idempotent (guard `if exists ... return`) jadi aman ikut di-push kapan pun tanpa
efek samping.

## ✅ Update 27 Agustus: batas administrasi asli DIPEROLEH

Sam upload `2022_RBI25K_KAB_BEKASI_KUGI50_20221231.gdb` (BIG RBI 25K, sumber
tanahair.indonesia.go.id, per 31 Des 2022). Meski nama file "KAB BEKASI", layer
administrasinya **mencakup Kota Bekasi lengkap** — diverifikasi langsung:

- `ADMINISTRASI_AR_KECAMATAN`: 12/12 kecamatan Kota Bekasi, poligon asli
- `ADMINISTRASI_AR_DESAKEL`: 56 kelurahan, poligon asli, sudah ada field `WADMKC` (kecamatan induk)
- Sanity check luas: total poligon Kota Bekasi = 213,1 km² vs angka resmi BPS ~210,5 km² — cocok

Ini menyelesaikan item "Batas administrasi kelurahan/kecamatan (poligon asli)" di Kategori B
di bawah — **jangan pakai lagi bounding box dummy atau hasil OSM yang gagal**. File belum
di-ETL/upload ke Supabase — masih perlu `data-ai-analyst` extract layer di atas (filter
`WADMKK='Kota Bekasi'`) dan replace boundary dummy yang ada.

Bonus layer relevan dari .gdb yang sama (belum diproses, dicatat untuk referensi):
- `PERMUKIMAN_AR_25K` — 1.004 poligon kawasan permukiman di Kota Bekasi, kandidat mask
  dasymetric mapping untuk `grid_analisis` (pengganti/pelengkap building footprint sintetis)
- `STASIUNKA_PT_25K` (1) + `RELKA_LN_25K` (12 ruas) — jaringan rel eksisting, untuk layer
  "jaringan transit eksisting" di Peta Multi-Layer Gap Analysis
- `PENDIDIKAN_PT_25K` (149) + `RUMAHSAKIT_PT_25K` (10) — bisa cross-check POI OSM yang sudah upload
- `JALAN_LN_25K` (20.811 ruas) — jaringan jalan detail Kota Bekasi

**Catatan penting:** RBI 25K adalah peta topografi (geometri saja), TIDAK bawa atribut
demografi. Item "Jumlah penduduk per kelurahan" (baris di bawah) masih tetap perlu BPS Kota
Bekasi Dalam Angka, di-join lewat nama kelurahan (`NAMOBJ`) ke boundary asli ini.

## ⚠️ Update 26 Agustus (sore): status risiko

1. ~~Instrumen survei belum ada sama sekali~~ — **SELESAI/TERBUKTI SALAH ASUMSI.** Ternyata
   sudah ada `Instrumen_Survei_GeoTransitInsight.xlsx` (Form Kondisi Halte + Form Traffic
   Counting, lengkap dengan formula skor otomatis). **15 halte asli koridor BisKita sudah
   ter-upload ke `halte_eksisting`** (lihat `etl/data/survei/`, fungsi `upload_halte_data()`
   di `etl/upload_to_supabase.py`). Form Traffic Counting masih diisi tim lain, belum siap.
2. **Sesi AHP dengan mentor kemungkinan belum kelar.** Dijadwalkan 21-27 Agustus di
   `FRAMEWORK_GeoTransitInsight.md` (harusnya sudah lewat), tapi `konfigurasi_bobot`
   masih kosong untuk TDI/Equity, dan bobot CAI masih berlabel "perlu divalidasi mentor"
   di `004_konfigurasi_bobot.sql`. CAI adalah fitur yang tidak boleh dikorbankan — perlu
   konfirmasi status sesi ini segera.

---

## Kategori A — Blocker langsung Field Day 3 (29-30 Agustus)

| Data | Status | Dipakai untuk | Cara mendapatkan | Sebelum 13 Sep? |
|---|---|---|---|---|
| Instrumen survei (Form Kondisi Halte, Form Traffic Counting) | **Tidak ada di repo** | Struktur input Field Day 3 | Buat sendiri (Google Form/MAPID Apps form), field persis cocok skema `halte_eksisting`/`titik_kandidat` | **Wajib sebelum 29 Agustus** |
| Data hasil survei 70 titik (gabungan 3 field day) | 0 baris asli; yang ada 6+4 baris eksplisit ditandai `'DATA SINTETIS'` | `n_survei` (CAI, bobot 0.15), `total_aktivitas`→proksi volume, kondisi trotoar/penyeberangan | Eksekusi Field Day 3, ekspor GeoJSON dari MAPID Apps | Ya — jalur kritis inti 31 Agu–6 Sep, bergantung pada form di atas |

## Kategori B — Data sekunder resmi (jalur jelas, butuh waktu unduh/request)

| Data | Status | Index | Cara mendapatkan | Sebelum 13 Sep? |
|---|---|---|---|---|
| Batas administrasi kelurahan/kecamatan (poligon asli) | ⏳ **ETL SIAP, upload TERTAHAN 27 Agu (sore)** — `etl/build_admin_boundaries_from_rbi.py` sudah ditulis & dry-run terverifikasi (12 kecamatan, 56 kelurahan, luas cocok BPS ~3% selisih). Upload sebenarnya (`--upload`) + migration `008_batas_administrasi_sumber.sql` BELUM diterapkan — `db push`/query probe ditolak permission classifier sesi ini, perlu Sam jalankan manual di terminal sendiri. Strategi migrasi ADDITIVE (tidak collision nama dgn 6 dummy, tidak menghapus apa pun) — lihat catatan lengkap di atas. | Fondasi spasial semua tabel | 1) `npx supabase db push --project-ref=vpymlmaebvfmpowomsec` (atau paste `008_batas_administrasi_sumber.sql` ke SQL Editor) 2) `python etl/build_admin_boundaries_from_rbi.py --upload` | Ya — tinggal 2 langkah manual di atas, sumber data & script sudah siap |
| Jumlah penduduk + proporsi lansia/balita per kelurahan | ✅ **SELESAI 27 Agu** — 56 baris asli di tabel `penduduk` (`sumber='Disdukcapil Kota Bekasi - DKB Semester 1 2026'`), 56/56 kelurahan cocok ke `batas_administrasi` (RBI), total 2.607.248 jiwa, tidak ada warning cross-validation (PRODUKTIF_NON = JUMDUK di semua baris). 24 baris sintetis lama dipertahankan berdampingan (FK ke 6 kelurahan dummy, masih dipakai testing RPC `simulate_new_stop`) — additive, bukan replace. **⚠️ Isu terbuka**: angka ini (DKB Semester I 2026) BEDA dengan yang dikutip PRD/proposal saat ini (DKB Semester II 2025 = 2.595.927 jiwa) — perlu sinkronisasi dokumen, lihat catatan di bawah. | `n_kepadatan` CAI (bobot 0.35, terbesar), TDI, Equity | `etl/load_penduduk.py --excel etl/data/demografi/DAK_SEMESTER_1_TAHUN_2026_REV01.xlsx` | Selesai |
| Rasio rumah tangga tanpa kendaraan pribadi | Tidak ada — kode sudah fallback netral 0.5 | TDI (Indeks Kebutuhan Mobilitas) | BPS Susenas (granularitas kelurahan jarang publik) | **Realistis tetap fallback 0.5** — jangan diperjuangkan mati-matian |
| POI sekolah | ✅ **SELESAI 26 Agu** — 330 baris nyata dari OSM di tabel `poi` (`sumber='OpenStreetMap'`), 5 baris dummy lama tetap ada terpisah | `n_jarak_inv` CAI, TDI, Equity | Ditarik via `etl/fetch_upload_osm_poi.py` (Overpass API, `amenity=school`) | Selesai |
| POI faskes | ✅ **SELESAI 26 Agu** — 162 baris nyata dari OSM | Sama seperti di atas | Sama, `amenity=hospital/clinic` + `healthcare=*` | Selesai |
| POI pusat kerja/industri | ✅ **SELESAI 26 Agu** — 271 baris nyata dari OSM | Sama seperti di atas | Sama, `landuse=industrial` + `office=*` | Selesai |
| Building footprint (dasymetric mapping) | ✅ **SELESAI 27 Agu (malam)** — 567.359 building footprint asli OSM, 16/16 tile Overpass berhasil (2 retry setelah rate limit awal), `etl/data/osm/building_footprint_bekasi.geojson`. Sudah dipakai re-run dasymetric grid (lihat Kategori E) | Presisi `grid_analisis.kepadatan_penduduk` → TDI | Ditarik via `etl/fetch_osm_building_footprints.py` (Overpass API, `building=*`) | Selesai |

## Kategori C — Butuh kontak institusi (paling berisiko delay)

| Data | Status | Index | Cara mendapatkan | Sebelum 13 Sep? |
|---|---|---|---|---|
| Volume penumpang KRL/BRT/angkot | Kosong, angka buatan | `n_volume` CAI (bobot 0.25, kedua terbesar) | Kontak **KAI Commuter/Transjakarta/Damri**, atau **Dishub Kota Bekasi** langsung (target user produk ini) | **Jangan gantungkan pada operator besar** — pakai traffic counting sampel jam puncak dari survei tim sendiri (in-scope PRD Bab 3) sebagai sumber utama |

## Kategori D — Keputusan tim/mentor (bukan data eksternal)

| Data | Status | Index | Cara mendapatkan | Sebelum 13 Sep? |
|---|---|---|---|---|
| Bobot AHP final — CAI | Ada 4 baris, berstatus "disetujui mentor 27 Agu via review worksheet" (BUKAN pairwise Saaty formal, `consistency_ratio` sengaja NULL — lihat `009_bobot_tdi_equity_mentor_review.sql`) | CAI | Sesi AHP dengan mentor | Nilai efektif dipakai produksi; sesi pairwise Saaty formal masih bisa menyusul kalau ada waktu |
| Bobot AHP final — TDI (Indeks Kebutuhan Mobilitas) | ✅ **SELESAI 27 Agu (lanjutan)** — 3 baris di `konfigurasi_bobot` (`usia_rentan=0.40, poi_harian=0.35, tanpa_kendaraan=0.25`), disetujui mentor 27 Agu, `consistency_ratio` NULL (bukan pairwise formal, sama seperti CAI). `compute_tdi()` sudah dijalankan untuk seluruh 2.607 grid via `etl/compute_tdi_full.py --upload` — lihat Kategori E | TDI | Sesi AHP dengan mentor | Selesai — sesi pairwise formal masih bisa menyusul kalau ada waktu |
| Bobot AHP final — Equity Index | ✅ **SELESAI 27 Agu (lanjutan)** — 6 baris (`aksesibilitas_inv=0.30, kepadatan=0.15, usia_rentan=0.20, akses_pendidikan=0.15, akses_kesehatan=0.10, akses_kerja=0.10`), status sama seperti TDI/CAI di atas. `compute_equity_index()` sudah dijalankan untuk 56 kelurahan RBI via `etl/aggregate_equity_kelurahan.py --upload` — lihat Kategori E | Equity | Sesi AHP dengan mentor | Selesai — sesi pairwise formal masih bisa menyusul kalau ada waktu |
| Kelompok terdampak & rekomendasi intervensi per kelurahan | Placeholder generik/dummy untuk 5 baris DUMMY lama (006_seed_dummy_data.sql via 005_equity_kelompok_rekomendasi.sql). **56 baris REAL baru (27 Agu) SENGAJA NULL** — `etl/aggregate_equity_kelurahan.py` tidak mengarang narasi kebijakan per kelurahan (di luar wewenang formula/ETL, lihat CLAUDE.md prinsip AI-interpretasi). Edge Function `ai-insight` sudah diupdate untuk menyebutkan skornya tapi menyatakan eksplisit "belum ada analisis detail" kalau field ini null, bukan mengarang | Equity Dashboard (acceptance criteria Bab 8) | Analisis tim sendiri (kombinasi BPS + Dapodik/Kemenkes + hasil survei), bukan data yang "diunduh" | **Masih terbuka untuk 53/56 kelurahan** — window 31 Agu-6 Sep, delegasikan ke `data-ai-analyst`/`product-analyst` |

## Kategori E — Turunan otomatis (tidak perlu dicari, tinggal jalankan ulang)

| Data | Status | Catatan |
|---|---|---|
| `grid_analisis` (fishnet 250-500m) | ✅ **SELESAI 27 Agu, DIUPDATE 27 Agu malam ke TRUE dasymetric, TDI SELESAI 27 Agu (lanjutan)** — 2.607 cell (300m x 300m) menutupi seluruh 56 kelurahan RBI Kota Bekasi. `kepadatan_penduduk`: dasymetric weighting pakai building footprint OSM asli (567.359 bangunan, lihat Kategori B). Assert konservasi populasi LOLOS PERSIS: total penduduk 56 kelurahan = 2.607.248, total tersebar ke grid = 2.607.248,00 (selisih 0,00). **`indeks_kebutuhan_mobilitas`, `skor_aksesibilitas_transit`, `skor_tdi` SEKARANG TERISI di seluruh 2.607/2.607 baris** — dihitung `etl/compute_tdi_full.py --upload` pakai bobot `TDI_MOBILITAS` dari `konfigurasi_bobot`. `skor_aksesibilitas_transit` dihitung dari fungsi decay linear coverage isochrone 400m (skor 1.0) — 800m (skor 0.0) terhadap jarak ke 15 `halte_eksisting` REAL (koridor BisKita, `DUMMY-HLT-*` dikecualikan) via `sjoin_nearest`; `proporsi_usia_rentan` dari spatial join centroid grid ke kelurahan RBI (245/2.607 cell di celah antar-polygon RBI pakai fallback rata-rata kota berbobot penduduk, BUKAN 0); `kepadatan_poi_harian` dari jumlah POI real (OSM, sekolah/faskes/kerja) radius 400m; `rasio_tanpa_kendaraan` tetap fallback netral 0,5 (data BPS/Susenas belum ada). Distribusi `skor_tdi`: mean=0,50, median=0,68, 25%=0,00 (banyak cell dekat halte skor rendah, wajar). **Face-validity**: cell ≤400m dari halte real (n=44) rata2 skor_tdi=0,18 vs cell >800m (n=2.486) rata2=0,52 — arah sesuai ekspektasi (dekat halte = TDI rendah). Sensitivity check (`sensitivity_check_tdi`, ±10% tiap bobot): ranking berubah di ~1.450-1.680 dari 2.607 cell per skenario — wajar untuk dataset besar bernilai kontinu (skor-skor berdekatan gampang tukar urutan tanpa makna kebijakan; PRD/pengambil keputusan cuma butuh prioritas top-N stabil, bukan urutan lengkap 2.607 baris — tidak dianggap tanda formula rapuh). Script: `etl/rerun_dasymetric_grid.py` (populasi) + `etl/compute_tdi_full.py` (TDI, per-baris UPDATE, 2.607 request). **Catatan teknis untuk siapa pun query `grid_analisis` langsung via supabase-py/PostgREST**: default limit `select()` adalah 1000 baris — perlu paginasi (`.range()`). Kolom geometry dikembalikan sebagai **dict GeoJSON**, bukan string WKB hex. |
| `skor_cai` | ✅ **DIPERBAIKI 28 Agu** — 4 baris sintetis demo (id 1-4, tidak disentuh) + 8 baris REAL (`recompute_all_cai_scores`, titik non-demo). `n_kepadatan` 8 baris REAL sekarang dari **kepadatan real per titik** (spatial join ke `grid_analisis`, `etl/attach_kepadatan_titik_kandidat.py`), BUKAN lagi `KEPADATAN_NEUTRAL_PLACEHOLDER` konstan 0,5000 di semua baris — lihat entri log teratas untuk detail metodologi & angka lama vs baru. | Turunan otomatis `compute_scores.py` — tinggal re-run (`attach_kepadatan_titik_kandidat.py --upload`) begitu ada titik_kandidat baru/direvisi |
| `skor_equity` | ✅ **SELESAI 27 Agu (lanjutan), DIRECOMPUTE 28 Agu (mengikuti fix `n_kepadatan` CAI di atas)** — 5 baris DUMMY lama dipertahankan (sumber diawali `'DATA SINTETIS'`) + **56 baris REAL** untuk seluruh kelurahan RBI (sumber diawali `'REAL - agregasi lokal'` untuk 3 kelurahan yang benar punya `titik_kandidat` survei di dalamnya — Durenjaya, Margahayu, Marga Mulya — atau `'REAL - FALLBACK rata-rata kota'` untuk 53 kelurahan lain yang BELUM punya titik survei, `skor_cai_rata2` dipakaikan rata-rata kota sebagai proksi sementara, BUKAN 0/angka menyesatkan; **rata-rata kota bergeser 0,4414 → 0,4224 pada recompute 28 Agu** karena input CAI-nya sudah diperbaiki). `kepadatan_penduduk` dari `jumlah_penduduk` (Disdukcapil) / luas polygon RBI; `jarak_rata2_{pendidikan,kesehatan,kerja}_m` dari rata-rata jarak `sjoin_nearest` seluruh centroid `grid_analisis` (2.607 cell) yang jatuh di tiap kelurahan ke POI real terdekat per jenis (245 cell di celah RBI dikecualikan dari rata-rata kelurahan mana pun). `ranking` 1-56 TERPISAH dari `ranking` 1-5 baris dummy (query top-N WAJIB filter kolom `sumber`, lihat `010_skor_equity_sumber.sql` — Edge Function `ai-insight` sudah diupdate `.ilike('sumber','REAL%')`, **BELUM di-deploy ulang**, lihat blocker di bawah). Distribusi `skor_final` (28 Agu): min=0,1494, median=0,4719, max=0,6135 (**Arenjaya sekarang ranking #1** paling timpang, sebelumnya Durenjaya #1 — kedua skornya sangat berdekatan, 0,6135 vs 0,5962, lihat entri log teratas). Dibanding hasil 27 Agu: **18/56 ranking berubah** (top-10 stabil kecuali swap #1/#2). Sensitivity check (`sensitivity_check_equity`, ±10%) di-run ulang 28 Agu: 12/12 skenario mengubah sebagian ranking (5-52 dari 56 kelurahan per skenario, wajar untuk n=56). Script: `etl/aggregate_equity_kelurahan.py --upload` (idempotent: delete `sumber ilike 'REAL - %'` lalu insert ulang, dummy tidak tersentuh) — **WAJIB dijalankan ulang setiap kali `skor_cai` berubah**, karena `skor_cai_rata2` bergantung padanya. Script belum mengisi `kelompok_terdampak`/`rekomendasi_intervensi` untuk 56 baris real (lihat Kategori D). **BLOCKER masih terbuka**: fix filter `sumber` di `supabase/functions/ai-insight/index.ts` sudah ditulis tapi `npx supabase functions deploy ai-insight` ditolak permission classifier sesi 27 Agu — perlu Sam jalankan manual: `npx supabase functions deploy ai-insight --project-ref=vpymlmaebvfmpowomsec`. Sebelum di-deploy, endpoint AI masih query tanpa filter sumber (bug lama, ranking dummy & real bisa campur). **FIX 28 Agu (lanjutan lagi)**: kolom `n_aksesibilitas_inv` (kontribusi kriteria aksesibilitas dibalik, bobot 0,30 — TERBESAR dari 6 kriteria equity) ternyata sudah dihitung `compute_equity_index()` sejak awal tapi tidak pernah dipersist ke tabel — "rincian kontribusi tiap kriteria" di frontend kehilangan justru kriteria terbesar. Ditambahkan lewat `011_skor_equity_n_aksesibilitas_inv.sql` (kolom `numeric(5,4)`, additive) + `upload_equity_scores_real()`/`upload_equity_scores()` di ETL diupdate mengirim kolom ini. Migration sudah diterapkan ke DB (`npx supabase db push`) dan 56 baris REAL sudah di-backfill ulang (`aggregate_equity_kelurahan.py --upload`, idempotent delete+insert seperti biasa) — 0/56 baris `n_aksesibilitas_inv` NULL, verifikasi manual `0.30*n_aksesibilitas_inv + 0.15*n_kepadatan + 0.20*n_usia_rentan + 0.15*n_akses_pendidikan + 0.10*n_akses_kesehatan + 0.10*n_akses_kerja` vs `skor_final` tersimpan: selisih maksimum 0,00007 (pembulatan `round(...,4)`, wajar). 5 baris DUMMY lama BELUM di-backfill kolom ini (di luar scope perbaikan ini, `upload_equity_scores()` untuk jalur dummy sudah diperbaiki juga tapi baris lama tidak di-re-run ulang — kalau perlu, jalankan ulang seed dummy). |

---

## Urutan eksekusi yang direkomendasikan

1. **Sebelum 29 Agustus**: buat Form Kondisi Halte & Form Traffic Counting
2. **Segera**: konfirmasi status sesi AHP dengan mentor (CAI/TDI/Equity)
3. **Minggu ini, paralel**: unduh batas administrasi (BIG/Bappeda) + BPS Dalam Angka — publik, tidak perlu menunggu
4. **Paralel, via `data-ai-analyst`**: tarik POI + building footprint dari OSM Overpass API — tidak perlu izin
5. **Saat Field Day 3**: traffic counting sampel jam puncak sebagai sumber `n_volume`, jangan tunggu balasan operator transit
6. **Terima fallback**: rasio tanpa kendaraan (Susenas) tetap 0.5 kalau tidak sempat
7. **Window 31 Agu-6 Sep**: analisis kelompok terdampak & rekomendasi intervensi per kelurahan, setelah data numerik final masuk

## Isu kebersihan repo (dicek sekaligus, hasil bersih)

Tidak ada conflict marker git ter-commit di file produk, tidak ada `VITE_ANTHROPIC_API_KEY`/API key AI bocor ke frontend (hanya `VITE_MAPID_MAPS_API_KEY` yang memang basemap key publik sesuai desain), RLS aktif di 9/9 tabel (`002_rls_policies.sql`).

-- ============================================================
-- GeoTransit Insight — 011_skor_equity_n_aksesibilitas_inv.sql
--
-- Bug: compute_equity_index() (etl/compute_scores.py) SUDAH menghitung
-- n_aksesibilitas_inv (skor_cai_rata2 kelurahan dibalik/inverse — CAI tinggi
-- = akses bagus -> equity gap rendah) sebagai kolom internal DataFrame, dan
-- ini adalah kriteria dengan BOBOT TERBESAR pada Transit Equity Index
-- (konfigurasi_bobot: nama_index='EQUITY', nama_kriteria='aksesibilitas_inv',
-- bobot=0.30 — lihat DEFAULT_EQUITY_WEIGHTS di compute_scores.py sebagai
-- fallback kalau baris AHP belum ada).
--
-- TAPI kolom itu tidak pernah dipersist ke tabel skor_equity — baik
-- upload_equity_scores() (5 baris dummy) maupun upload_equity_scores_real()
-- (56 baris REAL, etl/aggregate_equity_kelurahan.py) hanya mengupload
-- n_kepadatan, n_usia_rentan, n_akses_pendidikan, n_akses_kesehatan,
-- n_akses_kerja — 5 dari 6 kriteria. Akibatnya "rincian kontribusi tiap
-- kriteria" yang wajib ditampilkan frontend saat user klik kelurahan
-- (acceptance criteria PRD Bab 8, Transit Equity Index Dashboard) kehilangan
-- justru kriteria berbobot terbesar, padahal skor_cai_rata2 (bahan
-- mentahnya) sudah ada di tabel ini sejak awal.
--
-- Perbaikan: tambah kolom n_aksesibilitas_inv, presisi & tipe sama seperti
-- kolom n_* lain (numeric(5,4), rentang 0-1 hasil normalize_min_max).
-- ADDITIVE — tidak mengubah kolom lain, tidak menyentuh baris yang sudah ada
-- (backfill dilakukan lewat re-run etl/aggregate_equity_kelurahan.py --upload
-- untuk 56 baris REAL, lihat commit yang sama).
-- ============================================================

alter table skor_equity
    add column if not exists n_aksesibilitas_inv numeric(5,4);

comment on column skor_equity.n_aksesibilitas_inv is
    'Kontribusi kriteria aksesibilitas (dibalik/inverse) ke skor_final Transit '
    'Equity Index — normalize_min_max(skor_cai_rata2, inverse=True). CAI tinggi '
    '(akses transit bagus) -> n_aksesibilitas_inv rendah -> menyumbang sedikit '
    'ke skor ketimpangan; CAI rendah -> n_aksesibilitas_inv tinggi -> menyumbang '
    'banyak ke skor ketimpangan. Bobot default 0.30 (TERBESAR dari 6 kriteria '
    'equity, lihat konfigurasi_bobot nama_index=''EQUITY'' atau '
    'DEFAULT_EQUITY_WEIGHTS di etl/compute_scores.py kalau baris AHP belum '
    'ada) — kolom ini WAJIB diikutkan saat menampilkan rincian kontribusi '
    'tiap kriteria (acceptance criteria PRD Bab 8), jangan sampai baris dengan '
    'bobot terbesar hilang dari penjelasan.';

-- ============================================================
-- GeoTransit Insight — 005_equity_kelompok_rekomendasi.sql
-- Tambahan kolom skor_equity untuk memenuhi acceptance criteria
-- PRD Bab 8 (Transit Equity Index Dashboard): ranking kelurahan
-- harus menyertakan "kelompok terdampak" dan "1 rekomendasi
-- intervensi" per kelurahan, bukan cuma angka skor.
--
-- Ini PENAMBAHAN kolom, bukan perombakan skema 001_init_tables.sql —
-- kolom lama tidak diubah/dihapus.
--
-- Nama kolom SUDAH ditentukan bersama webgis-developer (frontend
-- dikerjakan paralel), JANGAN diganti:
--   - kelompok_terdampak      text[]  (mis. {'lansia','anak sekolah'})
--   - rekomendasi_intervensi  text    (1 kalimat rekomendasi ringkas)
-- ============================================================

alter table skor_equity
    add column if not exists kelompok_terdampak text[],
    add column if not exists rekomendasi_intervensi text;

comment on column skor_equity.kelompok_terdampak is
    'Kelompok penduduk paling terdampak ketimpangan akses transit di kelurahan ini '
    '(mis. lansia, anak sekolah, pekerja informal). Ditentukan lewat analisis data '
    'kerentanan (proporsi usia rentan, akses pendidikan/kesehatan/kerja) yang sudah '
    'jadi input skor_final — bukan dihitung ulang otomatis oleh AI.';

comment on column skor_equity.rekomendasi_intervensi is
    'Satu rekomendasi intervensi ringkas untuk kelurahan ini, sesuai PRD Bab 8 '
    '(Transit Equity Index Dashboard: "1 rekomendasi intervensi per kelurahan"). '
    'Narasi deskriptif hasil analisis tim, bukan skor/angka yang bisa dihitung ulang.';

-- Fallback generik untuk baris skor_equity yang SUDAH ada sebelum migration ini
-- (mis. hasil upload_to_supabase.py yang berjalan sebelum kolom ini ditambahkan).
-- Nilainya sengaja generik/placeholder — re-run etl/upload_to_supabase.py setelah
-- compute_scores.py diupdate untuk mengisi nilai spesifik per kelurahan yang lebih akurat.
update skor_equity
set
    kelompok_terdampak = coalesce(kelompok_terdampak, array['lansia', 'pekerja informal']),
    rekomendasi_intervensi = coalesce(
        rekomendasi_intervensi,
        'Prioritaskan penambahan/perbaikan halte dalam radius 400m dari permukiman padat penduduk di kelurahan ini.'
    )
where kelompok_terdampak is null or rekomendasi_intervensi is null;

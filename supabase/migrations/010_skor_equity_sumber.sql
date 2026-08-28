-- ============================================================
-- GeoTransit Insight — 010_skor_equity_sumber.sql
-- Tambahan kolom `sumber` pada skor_equity, pola sama dengan
-- 008_batas_administrasi_sumber.sql — supaya baris dummy lama (5 baris,
-- FK ke 5 dari 6 kelurahan dummy) bisa hidup berdampingan (ADDITIVE) dengan
-- baris hasil agregasi 56 kelurahan RBI asli yang mulai diupload lewat
-- etl/aggregate_equity_kelurahan.py, tanpa membingungkan siapa pun yang
-- query tabel ini soal mana yang data sungguhan.
--
-- DIPAKAI GANDA (bukan cuma dummy vs real) — lihat komentar kolom di bawah:
-- untuk baris REAL, nilai `sumber` juga membedakan apakah skor_cai_rata2
-- kelurahan itu berasal dari titik_kandidat survei lapangan yang BENAR2 ada
-- di kelurahan itu ("agregasi lokal"), atau FALLBACK rata-rata kota karena
-- belum ada satu pun titik_kandidat survei di kelurahan itu (mayoritas —
-- per 27 Agustus 2026 baru 3 dari 56 kelurahan RBI yang punya titik_kandidat
-- real). Ini supaya "belum ada data CAI lokal" TERLIHAT EKSPLISIT di data,
-- bukan diam-diam disamakan dengan kelurahan yang benar-benar disurvei.
--
-- PENTING soal ranking (dicatat sebelumnya di docs/DATA_CHECKLIST.md):
-- kolom `ranking` TIDAK unik lintas nilai `sumber` — baris dummy punya
-- ranking 1-5 sendiri, baris real punya ranking 1-56 sendiri (masing-masing
-- dihitung sebagai satu batch oleh compute_equity_index()). Query apa pun
-- yang mengambil top-N by ranking (mis. Edge Function ai-insight) WAJIB
-- filter `sumber` dulu, TIDAK BOLEH order('ranking').limit(N) tanpa filter
-- — kalau tidak, hasilnya bisa campur ranking=1 dummy dengan ranking=1 real.
-- (Edge Function ai-insight sudah diupdate mengikuti aturan ini di commit
-- yang sama dengan migration ini — lihat supabase/functions/ai-insight/index.ts.)
-- ============================================================

alter table skor_equity
    add column if not exists sumber text;

comment on column skor_equity.sumber is
    'Asal & kualitas data agregasi skor_equity untuk kelurahan ini. Nilai yang '
    'dipakai: (1) ''DATA SINTETIS - seed testing, bukan hasil analisis kelurahan '
    'asli'' untuk 5 baris dummy lama (FK ke batas_administrasi dummy, '
    '006_seed_dummy_data.sql) - dipertahankan untuk testing dashboard, JANGAN '
    'dianggap hasil analisis Kota Bekasi sungguhan; (2) string yang diawali '
    '''REAL - agregasi lokal'' untuk kelurahan RBI asli yang skor_cai_rata2-nya '
    'dihitung dari titik_kandidat survei lapangan yang benar ada di kelurahan '
    'itu; (3) string yang diawali ''REAL - FALLBACK rata-rata kota'' untuk '
    'kelurahan RBI asli yang BELUM punya titik_kandidat survei sama sekali di '
    'dalamnya, sehingga skor_cai_rata2-nya dipakaikan rata-rata skor_cai seluruh '
    'titik_kandidat real Kota Bekasi sebagai proksi sementara (bukan 0, bukan '
    'diam-diam disamakan dengan kelurahan yang benar-benar disurvei) - lihat '
    'etl/aggregate_equity_kelurahan.py dan docs/VALIDASI_BOBOT_AHP.md.';

-- Backfill 5 baris dummy yang sudah ada SEBELUM migration ini (idempotent:
-- coalesce, tidak menimpa baris yang kebetulan sudah punya nilai sumber lain).
update skor_equity
set sumber = coalesce(sumber, 'DATA SINTETIS - seed testing, bukan hasil analisis kelurahan asli')
where sumber is null;

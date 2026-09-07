-- ============================================================
-- GeoTransit Insight — 022_potensi_penerima_manfaat.sql
--
-- KENAPA MIGRATION INI ADA (temuan qa-tester 2026-09-03):
-- Kartu Dashboard "Potensi Penerima Manfaat" menampilkan 2.513.918 jiwa —
-- ~96% populasi Kota Bekasi (2.607.248). Dihitung frontend sebagai
-- Σ grid_analisis.kepadatan_penduduk untuk SEMUA sel dengan skor_tdi > 0,6
-- (1.517 sel). Angka itu tidak salah hitung, tapi MENYESATKAN pembaca
-- laporan: hampir seluruh kota "penerima manfaat" karena cuma ada 15 halte
-- BisKita real -> hampir semua sel berpenduduk > 800 m dari transit -> hampir
-- semua sel ber-skor_tdi tinggi. Itu ukuran "berapa orang tinggal di transit
-- desert", BUKAN "berapa orang yang benar-benar terbantu oleh intervensi".
--
-- METRIK BARU (dipilih & dijustifikasi):
--   potensi_penerima_manfaat = Σ kepadatan_penduduk pada sel yang SEKALIGUS:
--     (a) transit desert            : skor_tdi > ambang_tdi (default 0,6,
--         sama dengan TRANSIT_DESERT_THRESHOLD di Dashboard.jsx & kartu
--         "jumlah transit desert teridentifikasi" — satu ambang, konsisten), DAN
--     (b) dalam jangkauan jalan kaki: centroid sel <= radius_m (default 800 m,
--         batas atas isochrone PRD Bab 7 / ITDP, sama dengan
--         coverage_transit_kecamatan & RPC simulate_new_stop) dari MINIMAL
--         SATU titik_kandidat REAL (usulan halte prioritas hasil Survey
--         Activities, id_titik_survei bukan 'KND-DEMO-%').
--
--   Artinya: "kalau usulan halte prioritas yang sudah disurvei lapangan
--   dibangun, sekian penduduk transit-desert yang saat ini tak terlayani
--   akan mendapat akses transit dalam radius jalan kaki." Ini:
--     - "dari data yang telah divalidasi" (PRD Bab 8): titik_kandidat = 31
--       titik Survey Activities; kepadatan_penduduk = dasymetric grid yang
--       lolos assert konservasi populasi.
--     - sejalan CCIA/SMART (CLAUDE.md): angka ini yang dipakai tahap Action
--       ("berpotensi melayani tambahan N jiwa" — N riil, bukan karangan).
--     - memakai model spasial deterministik; RPC hanya agregasi + join
--       spasial, tidak ada skor dihitung ulang.
--   Alternatif yang DITOLAK: (i) Σ semua sel desert = angka 96% yang
--   menyesatkan itu sendiri; (ii) top-N sel terparah = N arbitrer, susah
--   dijustifikasi ke juri.
--
--   Sel desert yang > radius_m dari semua usulan halte TIDAK dihitung: bukan
--   berarti tidak butuh transit, tapi usulan halte yang ADA sekarang belum
--   menjangkaunya — jadi bukan "penerima manfaat" dari usulan tsb. Kolom
--   populasi_transit_desert_total di output tetap melaporkan angka penuh
--   sebagai konteks.
--
-- ------------------------------------------------------------
-- ISI: satu RPC potensi_penerima_manfaat(ambang_tdi, radius_m). TIDAK ada
-- DDL tabel/kolom, tidak menyentuh data atau RLS. Read-only, di-grant ke
-- anon+authenticated (konsisten dgn get_tdi_breakdown / simulate_new_stop).
--
-- URUTAN FILE: migration ke-022, setelah 021_get_tdi_breakdown_out_of_bounds.sql.
-- ============================================================

create or replace function potensi_penerima_manfaat(
    ambang_tdi numeric default 0.6,
    radius_m   numeric default 800
)
returns json
language plpgsql
security definer
as $$
declare
    n_kandidat            int;
    pop_desert_total      numeric;
    n_sel_desert_total    int;
    pop_terlayani         numeric;
    n_sel_terlayani       int;
    pop_terlayani_400     numeric;
begin
    -- Usulan halte prioritas REAL (Survey Activities), demo dikecualikan.
    select count(*) into n_kandidat
    from titik_kandidat
    where id_titik_survei not like 'KND-DEMO-%';

    -- Konteks: seluruh populasi yang tinggal di sel transit desert.
    select coalesce(sum(kepadatan_penduduk), 0), count(*)
      into pop_desert_total, n_sel_desert_total
    from grid_analisis
    where skor_tdi > ambang_tdi;

    -- Metrik utama: populasi sel transit desert yang berada dalam radius
    -- jalan kaki dari minimal satu usulan halte prioritas (800 m).
    select coalesce(sum(g.kepadatan_penduduk), 0), count(*)
      into pop_terlayani, n_sel_terlayani
    from grid_analisis g
    where g.skor_tdi > ambang_tdi
      and exists (
        select 1 from titik_kandidat tk
        where tk.id_titik_survei not like 'KND-DEMO-%'
          and ST_DWithin(
                ST_Centroid(g.geom)::geography,
                tk.geom::geography,
                radius_m
              )
      );

    -- Varian isochrone layanan-penuh (400 m) sebagai pembanding konservatif.
    select coalesce(sum(g.kepadatan_penduduk), 0)
      into pop_terlayani_400
    from grid_analisis g
    where g.skor_tdi > ambang_tdi
      and exists (
        select 1 from titik_kandidat tk
        where tk.id_titik_survei not like 'KND-DEMO-%'
          and ST_DWithin(
                ST_Centroid(g.geom)::geography,
                tk.geom::geography,
                400
              )
      );

    return json_build_object(
        'potensi_penerima_manfaat_jiwa', round(pop_terlayani),
        'potensi_penerima_manfaat_jiwa_400m', round(pop_terlayani_400),
        'metode',
            'Sigma kepadatan_penduduk sel grid yang (a) transit desert (skor_tdi > '
            || ambang_tdi || ') DAN (b) centroid <= ' || radius_m
            || ' m dari minimal 1 titik_kandidat REAL (usulan halte prioritas hasil survei).',
        'ambang_tdi', ambang_tdi,
        'radius_m_catchment', radius_m,
        'n_sel_transit_desert_terlayani_usulan', n_sel_terlayani,
        'n_sel_transit_desert_total', n_sel_desert_total,
        'n_titik_kandidat_dipakai', n_kandidat,
        'populasi_transit_desert_total', round(pop_desert_total),
        'populasi_kota_kanonik', 2607248,
        'catatan',
            'Angka "potensi_penerima_manfaat_jiwa" = penduduk transit desert yang akan '
            || 'terjangkau jalan kaki bila seluruh usulan halte prioritas dibangun. '
            || 'populasi_transit_desert_total (konteks) jauh lebih besar karena mencakup '
            || 'juga sel desert yang belum terjangkau usulan mana pun.'
    );
end;
$$;

comment on function potensi_penerima_manfaat(numeric, numeric) is
    'Potensi penerima manfaat intervensi transit desert = Sigma penduduk sel '
    'transit desert (skor_tdi > ambang) dalam radius jalan kaki dari usulan halte '
    'prioritas (titik_kandidat REAL). Menggantikan Sigma-semua-sel-desert yang '
    'menyesatkan (~96% kota). Lihat 022_potensi_penerima_manfaat.sql.';

grant execute on function potensi_penerima_manfaat(numeric, numeric) to anon, authenticated;

-- Uji cepat sesudah push:
--   select potensi_penerima_manfaat();          -- default 0,6 / 800 m
--   select potensi_penerima_manfaat(0.6, 800);

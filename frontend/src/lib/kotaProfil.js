// Profil Kota Bekasi — konstanta kanonik (sumber tunggal, keputusan tim
// 2026-08-28). Data mentah: etl/data/demografi/profil_kota_kanonik.json
// (DKB — Data Konsolidasi Bersih — Semester I 2026, Ditjen Dukcapil
// Kemendagri; luas wilayah dari BPS "Kota Bekasi Dalam Angka").
//
// Dipakai untuk:
//   1. Field yang BELUM ada di database — luas wilayah & persentase usia
//      produktif dibaca langsung dari konstanta ini.
//   2. Fallback "mode demo" untuk populasi & kepadatan kalau Supabase belum
//      tersambung / query gagal — pola sama dengan DEMO_* lain di komponen.
//
// PENTING: jangan hardcode angka demografi lain tersebar di komponen. Kalau
// PRD / profil_kota_kanonik.json di-update, cukup update file ini.
export const KOTA_PROFIL = {
  // --- Field yang belum ada di DB: selalu dari konstanta ini ---
  // Luas wilayah administratif Kota Bekasi. Sumber: BPS Kota Bekasi Dalam Angka.
  luas_km2: 210.49,
  // Persentase penduduk usia produktif (15–64 th) — DKB Semester I 2026:
  // 1.850.727 dari 2.607.248 jiwa = 70,98%.
  usia_produktif_persen: 70.98,
  usia_produktif_jiwa: 1850727,
  usia_produktif_definisi: 'penduduk usia 15–64 tahun',

  // --- Fallback demo: HANYA dipakai kalau query Supabase gagal/kosong ---
  // Basis populasi kanonik; harus sama dengan basis RPC simulate_new_stop.
  populasi_fallback: 2607248,
  // 2.607.248 / 210,49 km² dibulatkan (BPS mencantumkan 12.387 jiwa/km²).
  kepadatan_fallback: 12387,
  // Tidak ada nilai kanonik resmi untuk indeks aksesibilitas rata-rata kota.
  // Angka tengah skala 0–1 yang wajar sampai skor_cai terisi cukup.
  indeks_aksesibilitas_fallback: 0.54,

  sumber: 'DKB Semester I 2026 — Ditjen Dukcapil Kemendagri',
  sumber_luas: 'BPS Kota Bekasi Dalam Angka',
}

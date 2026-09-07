// titikKandidat.js — util kecil untuk membedakan titik_kandidat "lama" (demo/awal)
// dari titik_kandidat hasil Form Traffic Counting (batch KND-0NN) yang merupakan
// LOKASI USULAN HALTE BARU: kriteria CAI "skor survei kondisi halte" N/A —
// belum ada halte eksisting untuk dinilai lewat Form Kondisi Halte, jadi
// kriteria itu dikeluarkan dari WLC dan 3 bobot AHP sisanya direnormalisasi
// (skor_cai.n_survei & bobot_survei = NULL; keputusan tim 2026-09-07). Kriteria
// lain sudah data riil — n_kepadatan dari spatial join grid_analisis
// (dasymetric DKB Sem I 2026), jarak dari ST_Distance geom->POI, volume dari
// traffic counting lapangan.
//
// Kenapa perlu dibedakan: prinsip "setiap skor harus bisa ditelusuri" (CLAUDE.md)
// berarti UI wajib transparan bahwa kriteria survei di titik-titik ini N/A
// by design (bukan lokasi berinfrastruktur yang skornya jelek) — bukan
// menyembunyikannya.

/**
 * True kalau id_titik_survei mengikuti pola batch traffic counting asli
 * (mis. "KND-002".."KND-009", atau batch berikutnya "KND-0NN") — BUKAN salah
 * satu titik demo lama ("KND-DEMO-001" dst, yang sengaja mengandung teks
 * "DEMO" dan tidak akan pernah cocok pola murni-angka di bawah).
 */
export function isSurveyPlaceholderPoint(idTitikSurvei) {
  if (!idTitikSurvei || typeof idTitikSurvei !== 'string') return false
  return /^KND-\d+$/i.test(idTitikSurvei.trim())
}

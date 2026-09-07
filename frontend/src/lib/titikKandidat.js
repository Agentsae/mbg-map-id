// titikKandidat.js — util kecil untuk membedakan titik_kandidat "lama" (demo/awal)
// dari titik_kandidat hasil Form Traffic Counting (batch KND-0NN) yang merupakan
// LOKASI USULAN BARU: n_survei = 0 karena belum ada halte/infrastruktur transit
// eksisting untuk dinilai lewat Form Kondisi Halte. Kriteria lain sudah data
// riil — n_kepadatan dari spatial join ke grid_analisis (dasymetric DKB Sem I
// 2026, lihat etl/attach_kepadatan_titik_kandidat.py), jarak & volume dari
// traffic counting lapangan.
//
// Kenapa perlu dibedakan: prinsip "setiap skor harus bisa ditelusuri" (CLAUDE.md)
// berarti UI wajib transparan bahwa komponen survei titik-titik ini = 0
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

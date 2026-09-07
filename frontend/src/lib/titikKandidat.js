// titikKandidat.js — util kecil untuk membedakan titik_kandidat "lama" (demo/awal)
// dari titik_kandidat baru hasil Form Traffic Counting (batch KND-002..009, lihat
// etl/upload_cai_titik_kandidat_batch2.py) yang sebagian kriteria CAI-nya masih
// PROXY/PLACEHOLDER (n_kepadatan = nilai netral konstan, n_survei = 0 karena
// belum ada infrastruktur eksisting untuk disurvei).
//
// Kenapa perlu dibedakan: prinsip "setiap skor harus bisa ditelusuri" (CLAUDE.md)
// berarti UI wajib transparan soal bagian mana dari skor_final yang final vs
// sementara — bukan menyembunyikannya.

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

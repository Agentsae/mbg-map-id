// halteEksisting.js — util kecil untuk membedakan baris halte_eksisting yang
// benar-benar hasil survei lapangan dari baris dummy/seed testing
// (id_halte_survei berprefix "DUMMY-HLT-", lihat migration 006_seed_dummy_data.sql
// dan etl/compute_tdi_full.py PREFIX_HALTE_DUMMY). Dipakai supaya layer
// "jaringan transit eksisting" di peta tidak menampilkan titik sintetis
// seolah-olah itu halte BisKita sungguhan.

const PREFIX_HALTE_DUMMY = 'DUMMY-HLT-'

/** True kalau id_halte_survei adalah baris dummy/seed testing, bukan hasil survei asli. */
export function isDummyHalte(idHalteSurvei) {
  if (!idHalteSurvei || typeof idHalteSurvei !== 'string') return false
  return idHalteSurvei.trim().toUpperCase().startsWith(PREFIX_HALTE_DUMMY)
}

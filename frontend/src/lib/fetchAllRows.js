// fetchAllRows — pagination helper untuk query Supabase yang berpotensi
// mengembalikan > 1000 baris.
//
// PostgREST (Supabase REST API) MEMBATASI setiap request maksimum 1000 baris,
// TERLEPAS dari `.limit()` yang lebih besar di sisi client — ini bukan asumsi,
// sudah diverifikasi langsung (2026-08-28) ke project ini lewat header
// Content-Range: `grid_analisis` (2.607 baris total) dengan `.limit(4000)`
// saja hanya mengembalikan 1000 baris pertama. Tabel manapun di app ini yang
// bisa melebihi 1000 baris (grid_analisis sekarang, atau tabel lain di masa
// depan) WAJIB pakai helper ini, bukan `.limit()` polos, kalau butuh SEMUA
// baris yang cocok filter — kalau tidak, count/agregasi di frontend akan
// diam-diam kurang (undercounted) tanpa error apa pun dari Supabase.
//
// Pola pakai: panggil sekali (mis. saat mount komponen / load awal), BUKAN
// per interaksi filter — filter lanjutan sebaiknya tetap array-filter di
// memori supaya acceptance criteria performa (mis. "< 2 detik") tidak
// bergantung pada network round-trip berulang.
export const SUPABASE_PAGE_SIZE = 1000

/**
 * @param {() => import('@supabase/supabase-js').PostgrestFilterBuilder} queryFactory
 *   Function yang MEMBUAT query builder baru tiap dipanggil (bukan builder
 *   yang sudah di-`await`/dipakai sebelumnya — builder Supabase tidak bisa
 *   dipakai ulang lintas request).
 * @param {number} pageSize
 * @returns {Promise<{ data: any[] | null, error: any }>}
 */
export async function fetchAllRows(queryFactory, pageSize = SUPABASE_PAGE_SIZE) {
  const rows = []
  let from = 0
  // Batas pengaman iterasi (50 x 1000 = 50.000 baris) supaya tidak infinite
  // loop kalau suatu saat API mengembalikan respons tak terduga.
  for (let i = 0; i < 50; i++) {
    const { data, error } = await queryFactory().range(from, from + pageSize - 1)
    if (error) return { data: rows.length ? rows : null, error }
    if (!data?.length) break
    rows.push(...data)
    if (data.length < pageSize) break
    from += pageSize
  }
  return { data: rows, error: null }
}

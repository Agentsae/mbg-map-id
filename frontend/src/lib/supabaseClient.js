import { createClient } from '@supabase/supabase-js'

const url = import.meta.env.VITE_SUPABASE_URL
const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY

// isConfigured lets components fall back to demo data gracefully
// when .env belum diisi kredensial asli — supaya UI tetap bisa
// dijalankan & didemokan sebelum Supabase project benar-benar siap.
export const isConfigured = Boolean(url && anonKey)

export const supabase = isConfigured ? createClient(url, anonKey) : null

if (!isConfigured) {
  console.warn(
    '[GeoTransit Insight] VITE_SUPABASE_URL / VITE_SUPABASE_ANON_KEY belum diisi di .env — ' +
    'komponen akan menampilkan data contoh (demo) sampai kredensial asli disambungkan.'
  )
}

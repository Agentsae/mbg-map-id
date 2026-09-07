// qa/smoke-2026-08-28.mjs
// Smoke test empiris GeoTransit Insight — dijalankan oleh qa-tester.
// Node >=18. Pakai supabase-js dari frontend/node_modules.
//   node qa/smoke-2026-08-28.mjs
// Tidak menulis / mengubah apa pun di DB (hanya SELECT + RPC read-only).

import { readFileSync } from 'node:fs'
import { createClient } from '../frontend/node_modules/@supabase/supabase-js/dist/index.mjs'

function parseEnv(p) {
  const o = {}
  for (const l of readFileSync(p, 'utf8').split(/\r?\n/)) {
    const m = l.match(/^([A-Z_]+)=(.*)$/)
    if (m) o[m[1]] = m[2].trim()
  }
  return o
}
const fe = parseEnv(new URL('../frontend/.env', import.meta.url))
const etl = parseEnv(new URL('../etl/.env', import.meta.url))

const URL_SB = fe.VITE_SUPABASE_URL
const ANON = fe.VITE_SUPABASE_ANON_KEY
const SERVICE = etl.SUPABASE_SERVICE_ROLE_KEY

const anonClient = createClient(URL_SB, ANON)
const svcClient = createClient(URL_SB, SERVICE, { auth: { persistSession: false } })

const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  return { min: s[0], median: med, max: s[s.length - 1], n: s.length }
}

async function timeIt(fn) {
  const t0 = performance.now()
  const r = await fn()
  return { ms: performance.now() - t0, r }
}

// ---------------------------------------------------------------------------
console.log('\n=== 0. Row counts (service role, bypass RLS) ===')
for (const t of ['grid_analisis', 'skor_cai', 'titik_kandidat', 'skor_equity', 'halte_eksisting', 'poi', 'penduduk', 'batas_administrasi', 'rute_transit_eksisting']) {
  const { count, error } = await svcClient.from(t).select('*', { count: 'exact', head: true })
  console.log(`  ${t.padEnd(22)} ${error ? 'ERR ' + error.message : count}`)
}

// ---------------------------------------------------------------------------
console.log('\n=== 1. RLS check: anon can read? write blocked? ===')
{
  const { data, error } = await anonClient.from('grid_analisis').select('id').limit(1)
  console.log('  anon SELECT grid_analisis:', error ? 'ERR ' + error.message : `ok (${data.length} row)`)
  const { error: werr } = await anonClient.from('titik_kandidat').insert({ id_titik_survei: 'QA-TEST-DELETE-ME' })
  console.log('  anon INSERT titik_kandidat:', werr ? 'blocked ✓ (' + werr.message + ')' : 'ALLOWED ✗ REGRESSION')
}

// ---------------------------------------------------------------------------
console.log('\n=== 2. RPC simulate_new_stop (post migration 012) ===')
const pts = [
  ['Mustika Jaya (PRD scenario, pusat kec.)', -6.2986, 107.0620],
  ['Mustika Jaya (Jl. Raya Mustika Jaya)', -6.2989, 107.0658],
  ['Bekasi pusat (dekat Stasiun Bekasi)', -6.2383, 106.9756],
  ['Bekasi Barat (Kranji)', -6.2200, 106.9520],
  ['Bekasi Utara (Harapan Indah)', -6.1850, 107.0000],
  ['Bantar Gebang', -6.3200, 106.9900],
  ['Jati Sampurna (tepi selatan kota)', -6.3600, 106.9100],
  ['LUAR kota — Cikarang arah timur', -6.3000, 107.1500],
  ['LUAR kota — Jakarta arah barat', -6.2200, 106.8800],
  ['LUAR kota — jauh (laut/utara)', -6.0500, 107.0000],
]
const simResults = []
for (const [label, lat, lon] of pts) {
  const times = []
  let last
  const runs = label.startsWith('LUAR') ? 2 : 3
  for (let i = 0; i < runs; i++) {
    const { ms, r } = await timeIt(() => anonClient.rpc('simulate_new_stop', { lat, lon }))
    times.push(ms)
    last = r
  }
  if (last.error) {
    console.log(`  [${label}] ERROR: ${last.error.message}`)
    simResults.push({ label, error: last.error.message })
    continue
  }
  const d = last.data
  const st = stats(times)
  console.log(`  [${label}]`)
  console.log(`      p400=${d.penduduk_terlayani_400m}  p800=${d.penduduk_terlayani_800m}  ` +
    `transit_terdekat="${d.transit_eksisting_terdekat?.nama}" jarak=${d.transit_eksisting_terdekat?.jarak_m}m  ` +
    `dWaktu=${d.estimasi_pengurangan_waktu_tempuh_menit}min  sekolah=${d.fasilitas_pendidikan_400m} faskes=${d.fasilitas_kesehatan_400m}`)
  console.log(`      timing ms: median=${st.median.toFixed(0)} max=${st.max.toFixed(0)} (n=${st.n})`)
  simResults.push({ label, d, st })
}

// ---------------------------------------------------------------------------
console.log('\n=== 3a. Filter peta per-kecamatan: biaya LOAD data (proxy) ===')
// Frontend AnalisisSpasial fetch grid_analisis penuh via pagination 1000/req,
// lalu filter kecamatan = array-filter in-memory (tidak query ulang).
// Ukur: (a) full paginated fetch grid_analisis, (b) fetch halte + batas_administrasi.
{
  const { ms, r } = await timeIt(async () => {
    const rows = []
    let from = 0
    for (let i = 0; i < 50; i++) {
      const { data, error } = await anonClient
        .from('grid_analisis')
        .select('id, geom, kepadatan_penduduk, skor_aksesibilitas_transit, skor_tdi')
        .order('id', { ascending: true })
        .range(from, from + 999)
      if (error) throw error
      if (!data.length) break
      rows.push(...data)
      if (data.length < 1000) break
      from += 1000
    }
    return rows
  })
  console.log(`  grid_analisis full paginated fetch: ${ms.toFixed(0)} ms, ${r.length} rows`)
  global.__grid = r
}
{
  const { ms, r } = await timeIt(() => anonClient.from('batas_administrasi').select('nama_kecamatan, nama_kelurahan, geom').limit(1000))
  console.log(`  batas_administrasi fetch: ${ms.toFixed(0)} ms, ${r.data?.length ?? 'ERR'} rows`)
}
{
  const { ms, r } = await timeIt(() => anonClient.from('halte_eksisting').select('id, nama, geom, kecamatan').limit(2000))
  console.log(`  halte_eksisting fetch: ${ms.toFixed(0)} ms, ${r.data?.length ?? 'ERR'} rows`)
}

console.log('\n=== 3b. Filter in-memory (array-filter) micro-benchmark ===')
{
  const grid = global.__grid || []
  // meniru filteredGrid useMemo: g.kecamatan === filter. kecamatan belum ada
  // di row (dihitung frontend via bbox); di sini ukur worst-case full scan + map.
  const times = []
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now()
    const filtered = grid.filter((g) => g.id % 3 === 0)
    const fc = { type: 'FeatureCollection', features: filtered.map((c) => ({ type: 'Feature', geometry: { type: 'Polygon', coordinates: [[]] }, properties: { value: c.skor_tdi ?? 0 } })) }
    times.push(performance.now() - t0)
    void fc
  }
  const st = stats(times)
  console.log(`  array-filter + FeatureCollection build over ${grid.length} rows: median=${st.median.toFixed(2)}ms max=${st.max.toFixed(2)}ms`)
  console.log('  (NB: repaint MapLibre sesungguhnya TIDAK terukur dari Node — perlu browser)')
}

// ---------------------------------------------------------------------------
console.log('\n=== 4. Kebenaran data: rentang CAI / TDI / Equity ===')
function analyzeCol(rows, col, { min = 0, max = 1 } = {}) {
  const vals = rows.map((r) => r[col])
  const nulls = vals.filter((v) => v === null || v === undefined).length
  const nums = vals.filter((v) => typeof v === 'number' && !Number.isNaN(v))
  const neg = nums.filter((v) => v < 0).length
  const over = nums.filter((v) => v > max).length
  const under = nums.filter((v) => v < min).length
  const lo = nums.length ? Math.min(...nums) : null
  const hi = nums.length ? Math.max(...nums) : null
  const flag = (neg || over || (min === 0 && under)) ? '  <-- ANOMALI' : ''
  console.log(`  ${col.padEnd(28)} n=${nums.length} null=${nulls} min=${lo} max=${hi} neg=${neg} >${max}=${over} <${min}=${under}${flag}`)
  return { col, nulls, neg, over, under, lo, hi, n: nums.length }
}

{
  const { data: cai, error } = await svcClient.from('skor_cai').select('*')
  if (error) console.log('  skor_cai ERR', error.message)
  else {
    console.log(`  -- skor_cai (${cai.length} rows) --`)
    for (const c of ['skor_final', 'n_kepadatan', 'n_jarak_inv', 'n_volume', 'n_survei', 'bobot_kepadatan', 'bobot_jarak', 'bobot_volume', 'bobot_survei']) {
      if (cai.length && c in cai[0]) analyzeCol(cai, c)
    }
    // cek jumlah bobot ~ 1
    if (cai.length && 'bobot_kepadatan' in cai[0]) {
      const sums = cai.map((r) => (r.bobot_kepadatan ?? 0) + (r.bobot_jarak ?? 0) + (r.bobot_volume ?? 0) + (r.bobot_survei ?? 0))
      console.log(`  sum(bobot) min=${Math.min(...sums).toFixed(4)} max=${Math.max(...sums).toFixed(4)} (harusnya ~1.0)`)
    }
  }
}
{
  const grid = global.__grid || []
  console.log(`  -- grid_analisis (${grid.length} rows) --`)
  if (grid.length) {
    analyzeCol(grid, 'skor_tdi')
    analyzeCol(grid, 'skor_aksesibilitas_transit')
    // kepadatan boleh > 1 (jiwa/cell); cek hanya negatif/null
    analyzeCol(grid, 'kepadatan_penduduk', { min: 0, max: Infinity })
  }
}
{
  const { data: eq, error } = await svcClient.from('skor_equity').select('*')
  if (error) console.log('  skor_equity ERR', error.message)
  else {
    console.log(`  -- skor_equity (${eq.length} rows) --`)
    if (eq.length) {
      analyzeCol(eq, 'skor_final', { min: 0, max: Infinity }) // equity GAP score, range formula-defined
      const sumbers = [...new Set(eq.map((r) => r.sumber))]
      console.log('  sumber values:', JSON.stringify(sumbers))
      const real = eq.filter((r) => /^REAL/i.test(r.sumber || ''))
      console.log(`  REAL% rows: ${real.length}  (Edge Function ai-insight ranking pakai subset ini)`)
      if (real.length) analyzeCol(real, 'skor_final', { min: 0, max: Infinity })
    }
  }
}

// ---------------------------------------------------------------------------
console.log('\n=== 5. Cross-check simulate_new_stop vs grid_analisis (sanity) ===')
{
  // total penduduk kota dari grid vs BPS ~2.6jt
  const grid = global.__grid || []
  const total = grid.reduce((s, g) => s + (g.kepadatan_penduduk || 0), 0)
  console.log(`  sum(grid_analisis.kepadatan_penduduk) = ${Math.round(total).toLocaleString('en-US')} (ref BPS Kota Bekasi ~2.55-2.65 jt)`)
}

console.log('\n=== SELESAI ===')

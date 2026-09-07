// qa/smoke-2026-09-03.mjs
// Verifikasi empiris gap-audit PRD (migrations 015-017 + frontend changes).
// Read-only. Node >=18.  node qa/smoke-2026-09-03.mjs
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
let SERVICE = null
try { SERVICE = parseEnv(new URL('../etl/.env', import.meta.url)).SUPABASE_SERVICE_ROLE_KEY } catch {}
const anon = createClient(fe.VITE_SUPABASE_URL, fe.VITE_SUPABASE_ANON_KEY)
const svc = SERVICE ? createClient(fe.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } }) : null

const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  return { min: s[0], median: med, max: s[s.length - 1], n: s.length }
}
async function timeIt(fn) { const t0 = performance.now(); const r = await fn(); return { ms: performance.now() - t0, r } }

console.log('\n================ 1. RPC get_tdi_breakdown (migration 015) ================')
const tdiPts = [
  ['Bekasi pusat (dekat Stasiun Bekasi)', 106.9756, -6.2383],
  ['Mustika Jaya (PRD scenario)', 107.0620, -6.2986],
  ['Bekasi Utara (Harapan Indah)', 107.0000, -6.1850],
  ['comment example coord', 107.0074, -6.2185],
  ['LUAR kota jauh — Cikarang timur', 107.1500, -6.3000],
  ['LUAR kota jauh — utara/laut', 107.0000, -5.9000],
]
const tdiTimes = []
for (const [label, lng, lat] of tdiPts) {
  const { ms, r } = await timeIt(() => anon.rpc('get_tdi_breakdown', { lng, lat }))
  tdiTimes.push(ms)
  if (r.error) { console.log(`  [${label}] ERROR: ${r.error.message}`); continue }
  const d = r.data
  const komp = d.komponen || []
  const shapeOk = 'ditemukan' in d && Array.isArray(d.komponen) && komp.length === 3 &&
    komp.every(k => 'peran' in k && 'arah' in k && 'nilai' in k) &&
    'skor_tdi' in d && 'formula' in d && 'catatan' in d
  const diff = (d.skor_tdi != null && d.skor_tdi_reproduksi_perkiraan != null)
    ? Math.abs(d.skor_tdi - d.skor_tdi_reproduksi_perkiraan) : null
  console.log(`  [${label}]  ${ms.toFixed(0)}ms`)
  console.log(`      ditemukan=${d.ditemukan} cell_id=${d.cell_id} match=${d.match} jarak_ke_sel_m=${d.jarak_ke_sel_m}`)
  console.log(`      skor_tdi=${d.skor_tdi}  reproduksi=${d.skor_tdi_reproduksi_perkiraan}  |diff|=${diff}  tdi_raw=${d.tdi_raw}`)
  console.log(`      peran: ${komp.map(k => k.kunci + '=' + k.peran).join(', ')}`)
  console.log(`      shape OK: ${shapeOk ? 'YES' : 'NO <-- FAIL'}   traceability |diff|<1e-3: ${diff == null ? 'n/a' : (diff < 1e-3 ? 'YES' : 'NO <-- FAIL')}`)
}
console.log(`  timing get_tdi_breakdown: ${JSON.stringify(stats(tdiTimes.map(x => +x.toFixed(0))))}`)

console.log('\n================ 2. VIEW coverage_transit_kecamatan (016/017) ================')
{
  const { data, error } = await anon.from('coverage_transit_kecamatan').select('*')
  if (error) { console.log('  ERROR:', error.message) }
  else {
    console.log(`  rows: ${data.length}  (expect 12)`)
    let nullCount = 0, outOfRange = 0, zeros800 = 0, sumPop = 0, sumServed800 = 0
    for (const r of data) {
      for (const k of ['populasi_total', 'populasi_terlayani_400m', 'populasi_terlayani_800m', 'coverage_ratio_400m', 'coverage_ratio_800m']) {
        if (r[k] == null) nullCount++
      }
      for (const k of ['coverage_ratio_400m', 'coverage_ratio_800m']) {
        const v = Number(r[k]); if (v < 0 || v > 1) outOfRange++
      }
      if (Number(r.coverage_ratio_800m) === 0) zeros800++
      sumPop += Number(r.populasi_total) || 0
      sumServed800 += Number(r.populasi_terlayani_800m) || 0
    }
    console.log(`  NULLs across 5 numeric cols: ${nullCount}  (expect 0)`)
    console.log(`  coverage_ratio_* out of [0,1]: ${outOfRange}  (expect 0)`)
    console.log(`  kecamatan with coverage_ratio_800m == 0: ${zeros800} / ${data.length}`)
    console.log(`  Σ populasi_total = ${sumPop.toLocaleString('en-US')}  (canonical 2,607,248)`)
    console.log(`  Σ populasi_terlayani_800m = ${sumServed800.toLocaleString('en-US')}`)
    console.log(`  city coverage 800m = Σserved/Σtotal = ${(sumServed800 / sumPop * 100).toFixed(2)}%`)
    console.table(data.map(r => ({ kec: r.kecamatan, pop: r.populasi_total, s400: r.populasi_terlayani_400m, s800: r.populasi_terlayani_800m, cr400: r.coverage_ratio_400m, cr800: r.coverage_ratio_800m })))
  }
}

console.log('\n================ 3. skor_equity (migration 014) ================')
{
  const cli = svc || anon
  const { data, error } = await cli.from('skor_equity').select('*').order('ranking', { ascending: true })
  if (error) { console.log('  ERROR:', error.message) }
  else {
    console.log(`  rows: ${data.length}`)
    const nullK = data.filter(r => r.kelompok_terdampak == null || r.kelompok_terdampak === '').length
    const nullR = data.filter(r => r.rekomendasi_intervensi == null || r.rekomendasi_intervensi === '').length
    console.log(`  NULL/empty kelompok_terdampak: ${nullK}   NULL/empty rekomendasi_intervensi: ${nullR}`)
    const sumbers = [...new Set(data.map(r => r.sumber))]
    console.log(`  sumber values: ${JSON.stringify(sumbers)}`)
    const real = data.filter(r => /^REAL/i.test(r.sumber || '')).sort((a, b) => a.ranking - b.ranking)
    console.log(`  REAL% rows: ${real.length}`)
    const vals = data.map(r => Number(r.skor_final)).filter(v => !Number.isNaN(v))
    console.log(`  skor_final range: min=${Math.min(...vals)} max=${Math.max(...vals)}  neg=${vals.filter(v => v < 0).length}`)
    // rank 1 = highest skor_final?
    const byRank = [...real].sort((a, b) => a.ranking - b.ranking)
    const bySkor = [...real].sort((a, b) => b.skor_final - a.skor_final)
    console.log(`  REAL rank1: ranking=${byRank[0]?.ranking} skor_final=${byRank[0]?.skor_final} (bat_admin id=${byRank[0]?.batas_administrasi_id ?? byRank[0]?.id_batas ?? 'n/a'})`)
    console.log(`  REAL highest skor_final row ranking = ${bySkor[0]?.ranking}  (should be 1 if rank1=highest)`)
    console.log('  top 5 REAL by ranking:')
    for (const r of byRank.slice(0, 5)) {
      console.log(`    #${r.ranking} skor_final=${r.skor_final} kelompok="${(r.kelompok_terdampak || '').slice(0, 50)}" rekom="${(r.rekomendasi_intervensi || '').slice(0, 60)}"`)
    }
  }
}

console.log('\n================ 4. Dashboard card cross-checks ================')
{
  const { count: kandCount, error: e1 } = await anon.from('titik_kandidat').select('*', { count: 'exact', head: true })
  console.log(`  count(titik_kandidat) = ${e1 ? 'ERR ' + e1.message : kandCount}  (== "Usulan Halte Prioritas" card)`)
  const { data: top3, error: e2 } = await anon.from('skor_equity')
    .select('skor_final, ranking, rekomendasi_intervensi, sumber, batas_administrasi(nama_kelurahan)')
    .ilike('sumber', 'REAL%').order('ranking', { ascending: true }).limit(3)
  if (e2) console.log('  Top3 query ERR:', e2.message)
  else console.log('  Top 3 Rekomendasi AI card:', JSON.stringify(top3.map(r => ({ kel: r.batas_administrasi?.nama_kelurahan, rank: r.ranking, skor: r.skor_final }))))
}

console.log('\n================ 5. Timing acceptance criteria (re-measure) ================')
{
  // Simulasi What-If
  const simPts = [
    ['Mustika Jaya', -6.2986, 107.0620],
    ['Bekasi pusat', -6.2383, 106.9756],
    ['Bekasi Utara', -6.1850, 107.0000],
  ]
  for (const [label, lat, lon] of simPts) {
    const ts = []
    let last
    for (let i = 0; i < 4; i++) { const { ms, r } = await timeIt(() => anon.rpc('simulate_new_stop', { lat, lon })); ts.push(ms); last = r }
    const st = stats(ts.map(x => +x.toFixed(0)))
    console.log(`  simulate_new_stop [${label}]: median=${st.median}ms max=${st.max}ms  ${last.error ? 'ERR ' + last.error.message : 'p800=' + last.data.penduduk_terlayani_800m}  ${st.max < 3000 ? 'PASS <3s' : 'FAIL >=3s'}`)
  }
}
{
  // Peta filter proxy: full grid fetch + in-memory filter
  const { ms, r } = await timeIt(async () => {
    const rows = []; let from = 0
    for (let i = 0; i < 50; i++) {
      const { data, error } = await anon.from('grid_analisis')
        .select('id, geom, kepadatan_penduduk, skor_aksesibilitas_transit, skor_tdi')
        .order('id', { ascending: true }).range(from, from + 999)
      if (error) throw error
      if (!data.length) break
      rows.push(...data)
      if (data.length < 1000) break
      from += 1000
    }
    return rows
  })
  console.log(`  grid_analisis full paginated fetch: ${ms.toFixed(0)}ms, ${r.length} rows  (one-time load, filter itself is in-memory)`)
  const times = []
  for (let i = 0; i < 20; i++) {
    const t0 = performance.now()
    const filtered = r.filter(g => g.id % 3 === 0)
    const fc = { type: 'FeatureCollection', features: filtered.map(c => ({ type: 'Feature', properties: { v: c.skor_tdi ?? 0 } })) }
    times.push(performance.now() - t0); void fc
  }
  console.log(`  in-memory kecamatan filter + FC build over ${r.length} rows: ${JSON.stringify(stats(times.map(x => +x.toFixed(2))))} ms`)
}

console.log('\n================ 6. RLS still enforced ================')
{
  const { data, error } = await anon.from('grid_analisis').select('id').limit(1)
  console.log('  anon SELECT grid_analisis:', error ? 'ERR ' + error.message : `ok (${data.length} row)`)
  const { error: werr } = await anon.from('titik_kandidat').insert({ id_titik_survei: 'QA-DELETE-ME' })
  console.log('  anon INSERT titik_kandidat:', werr ? 'blocked OK (' + werr.message + ')' : 'ALLOWED <-- REGRESSION')
  const { error: verr } = await anon.from('coverage_transit_kecamatan').select('*').limit(1)
  console.log('  anon SELECT coverage view:', verr ? 'ERR ' + verr.message : 'ok')
}

console.log('\n=== DONE ===')

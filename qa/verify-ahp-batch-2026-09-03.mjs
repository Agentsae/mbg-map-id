// qa/verify-ahp-batch-2026-09-03.mjs
// Empirical verification of the AHP-weights batch (migrations 018-023 + recompute).
// Read-only. node qa/verify-ahp-batch-2026-09-03.mjs
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
const svc = SERVICE ? createClient(fe.VITE_SUPABASE_URL, SERVICE, { auth: { persistSession: false } }) : anon
console.log('service key present:', !!SERVICE)

const stats = (arr) => {
  const s = [...arr].sort((a, b) => a - b)
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  return { min: s[0], median: +med.toFixed(1), max: s[s.length - 1], n: s.length }
}
async function timeIt(fn) { const t0 = performance.now(); const r = await fn(); return { ms: performance.now() - t0, r } }

// ============ 2. AHP weights ============
console.log('\n======== 2. konfigurasi_bobot (AHP) ========')
{
  const { data, error } = await svc.from('konfigurasi_bobot').select('*').order('nama_index').order('nama_kriteria')
  if (error) console.log('ERROR', error.message)
  else {
    console.log(`rows: ${data.length} (expect 13)`)
    const byIdx = {}
    for (const r of data) {
      (byIdx[r.nama_index] ||= []).push(r)
      const d = String(r.ditentukan_pada || '').slice(0, 10)
      if (d !== '2026-09-03') console.log(`  !! ${r.nama_index}/${r.nama_kriteria} ditentukan_pada=${r.ditentukan_pada}`)
    }
    for (const [idx, rows] of Object.entries(byIdx)) {
      const sum = rows.reduce((a, r) => a + Number(r.bobot), 0)
      console.log(`  ${idx}: ${rows.map(r => `${r.nama_kriteria}=${r.bobot}`).join(' ')}  Σ=${sum.toFixed(4)}  CR=${[...new Set(rows.map(r => r.consistency_ratio))].join(',')}`)
    }
  }
}

// ============ 3a. skor_cai ============
console.log('\n======== 3a. skor_cai recompute ========')
let caiW = { kepadatan: 0.3290, jarak: 0.3290, volume: 0.2002, survei: 0.1418 }
{
  const { data, error } = await svc.from('skor_cai').select('*')
  if (error) console.log('ERROR', error.message)
  else {
    console.log(`rows: ${data.length} (expect 19)`)
    const wcols = {}
    for (const k of ['bobot_kepadatan', 'bobot_jarak', 'bobot_volume', 'bobot_survei']) {
      wcols[k] = [...new Set(data.map(r => Number(r[k])))]
    }
    console.log('  distinct bobot_* columns:', JSON.stringify(wcols))
    let worst = 0, worstId = null
    const outOfRange = data.filter(r => Number(r.skor_final) < 0 || Number(r.skor_final) > 1)
    for (const r of data) {
      const recomp = caiW.kepadatan * Number(r.n_kepadatan) + caiW.jarak * Number(r.n_jarak_inv) +
        caiW.volume * Number(r.n_volume) + caiW.survei * Number(r.n_survei)
      const d = Math.abs(recomp - Number(r.skor_final))
      if (d > worst) { worst = d; worstId = r.id }
    }
    console.log(`  skor_final out of [0,1]: ${outOfRange.length}`)
    console.log(`  worst |recompute(AHP w) - skor_final| = ${worst.toFixed(5)} (id ${worstId})  ${worst <= 0.0025 ? 'OK' : 'FAIL'}`)
    // show 3 sample rows
    for (const r of data.slice(0, 3)) {
      const recomp = caiW.kepadatan * r.n_kepadatan + caiW.jarak * r.n_jarak_inv + caiW.volume * r.n_volume + caiW.survei * r.n_survei
      console.log(`   id ${r.id}: n=(${r.n_kepadatan},${r.n_jarak_inv},${r.n_volume},${r.n_survei}) stored=${r.skor_final} recomp=${recomp.toFixed(4)} w=(${r.bobot_kepadatan},${r.bobot_jarak},${r.bobot_volume},${r.bobot_survei})`)
    }
  }
}

// ============ 3b. grid_analisis.skor_tdi ============
console.log('\n======== 3b. grid_analisis.skor_tdi ========')
{
  let rows = [], from = 0
  for (let i = 0; i < 60; i++) {
    const { data, error } = await svc.from('grid_analisis').select('id, skor_tdi').order('id').range(from, from + 999)
    if (error) { console.log('ERROR', error.message); break }
    if (!data.length) break
    rows.push(...data); if (data.length < 1000) break; from += 1000
  }
  const nulls = rows.filter(r => r.skor_tdi == null).length
  const oob = rows.filter(r => r.skor_tdi != null && (Number(r.skor_tdi) < 0 || Number(r.skor_tdi) > 1)).length
  const vals = rows.filter(r => r.skor_tdi != null).map(r => Number(r.skor_tdi))
  console.log(`  cells: ${rows.length} (expect 2607)  NULL skor_tdi: ${nulls}  out-of-[0,1]: ${oob}  min=${Math.min(...vals).toFixed(4)} max=${Math.max(...vals).toFixed(4)}`)
}

// ============ 4. get_tdi_breakdown guard (migration 021) ============
console.log('\n======== 4. get_tdi_breakdown (021 out-of-bounds) ========')
{
  const pts = [
    ['Mustika Jaya PRD (off-grid)', 107.0620, -6.2986],
    ['Sea point', 107.30, -6.10],
    ['In-grid (Bekasi pusat)', 106.9756, -6.2383],
    ['In-grid (comment coord)', 107.0074, -6.2185],
  ]
  const times = []
  for (const [label, lng, lat] of pts) {
    const { ms, r } = await timeIt(() => anon.rpc('get_tdi_breakdown', { lng, lat }))
    times.push(ms)
    if (r.error) { console.log(`  [${label}] ERROR ${r.error.message}`); continue }
    const d = r.data
    console.log(`  [${label}] ${ms.toFixed(0)}ms  ditemukan=${d.ditemukan} di_luar_cakupan_grid=${d.di_luar_cakupan_grid ?? '-'} match=${d.match ?? '-'} jarak_ke_sel_terdekat_m=${d.jarak_ke_sel_terdekat_m ?? d.jarak_ke_sel_m ?? '-'}`)
    if (d.ditemukan) {
      const komp = d.komponen || []
      const diff = (d.skor_tdi != null && d.skor_tdi_reproduksi_perkiraan != null) ? Math.abs(d.skor_tdi - d.skor_tdi_reproduksi_perkiraan) : null
      console.log(`      skor_tdi=${d.skor_tdi} reproduksi=${d.skor_tdi_reproduksi_perkiraan} |diff|=${diff} komponen.length=${komp.length} keys=${komp.map(k => k.kunci).join(',')}`)
    }
  }
  console.log(`  timing: ${JSON.stringify(stats(times.map(x => +x.toFixed(0))))}`)
}

// near-edge point search: find a grid centroid, offset ~150m
console.log('\n======== 4b. near-edge point (guard threshold 500m) ========')
{
  // grab a handful of cells with geom, compute a point ~150m outside one centroid
  const { data, error } = await svc.rpc('get_tdi_breakdown', { lng: 106.9756, lat: -6.2383 })
  // Instead: use a point near grid edge. Try several offsets around a known in-grid point.
  const base = [106.9756, -6.2383]
  for (const dLat of [0.0018, 0.0023, 0.003]) { // ~200,255,330 m
    const lng = base[0], lat = base[1] + dLat
    const { r } = await timeIt(() => anon.rpc('get_tdi_breakdown', { lng, lat }))
    const d = r.data || {}
    console.log(`  offset ${(dLat * 111000).toFixed(0)}m N -> ditemukan=${d.ditemukan} match=${d.match ?? '-'} jarak_ke_sel_m=${d.jarak_ke_sel_m ?? d.jarak_ke_sel_terdekat_m ?? '-'} di_luar=${d.di_luar_cakupan_grid ?? '-'} komponen=${(d.komponen || []).length}`)
  }
}

// ============ 5. potensi_penerima_manfaat (migration 022) ============
console.log('\n======== 5. potensi_penerima_manfaat (022) ========')
{
  const { ms, r } = await timeIt(() => anon.rpc('potensi_penerima_manfaat'))
  if (r.error) console.log('  ERROR', r.error.message)
  else {
    const d = r.data
    console.log(`  ${ms.toFixed(0)}ms`)
    console.log('  ' + JSON.stringify(d, null, 2).replace(/\n/g, '\n  '))
    console.log(`  sanity 400m < 800m: ${Number(d.potensi_penerima_manfaat_jiwa_400m) < Number(d.potensi_penerima_manfaat_jiwa)}`)
    console.log(`  sanity 800m << transit_desert_total: ${Number(d.potensi_penerima_manfaat_jiwa) < Number(d.populasi_transit_desert_total)}`)
  }
}

// ============ 6. penduduk.sumber relabel (migration 023) ============
console.log('\n======== 6. penduduk.sumber (023) ========')
{
  const { data, error } = await svc.from('penduduk').select('sumber')
  if (error) console.log('  ERROR', error.message)
  else {
    const counts = {}
    for (const r of data) counts[r.sumber] = (counts[r.sumber] || 0) + 1
    console.log(`  total rows: ${data.length}`)
    console.log('  ' + JSON.stringify(counts, null, 2).replace(/\n/g, '\n  '))
  }
}

// ============ 3c. skor_equity ============
console.log('\n======== 3c. skor_equity ========')
{
  const { data, error } = await svc.from('skor_equity').select('*, batas_administrasi(nama_kelurahan)').order('ranking')
  if (error) console.log('  ERROR', error.message)
  else {
    const real = data.filter(r => /^REAL/i.test(r.sumber || ''))
    console.log(`  total rows: ${data.length}  REAL rows: ${real.length}`)
    const nullK = real.filter(r => r.kelompok_terdampak == null || (Array.isArray(r.kelompok_terdampak) && r.kelompok_terdampak.length === 0)).length
    const nullR = real.filter(r => r.rekomendasi_intervensi == null || r.rekomendasi_intervensi === '').length
    console.log(`  REAL NULL/empty kelompok_terdampak: ${nullK}   rekomendasi_intervensi: ${nullR}`)
    const vals = real.map(r => Number(r.skor_final))
    console.log(`  skor_final range: ${Math.min(...vals).toFixed(4)} .. ${Math.max(...vals).toFixed(4)}  neg: ${vals.filter(v => v < 0).length}  >1: ${vals.filter(v => v > 1).length}`)
    const byRank = [...real].sort((a, b) => a.ranking - b.ranking)
    console.log('  TOP 5 by ranking:')
    for (const r of byRank.slice(0, 5)) console.log(`    #${r.ranking} ${r.batas_administrasi?.nama_kelurahan} skor_final=${r.skor_final}`)
    const last = byRank[byRank.length - 1]
    console.log(`  LAST #${last.ranking} ${last.batas_administrasi?.nama_kelurahan} skor_final=${last.skor_final}`)
    // rank1 == highest skor_final?
    const bySkor = [...real].sort((a, b) => b.skor_final - a.skor_final)
    console.log(`  highest skor_final row ranking = ${bySkor[0].ranking} (${bySkor[0].batas_administrasi?.nama_kelurahan})  -> rank1=highest: ${bySkor[0].ranking === 1}`)
  }
}

// ============ 8. Timing acceptance criteria ============
console.log('\n======== 8. Timing (Bab 8) ========')
{
  const simPts = [['Mustika Jaya', -6.2986, 107.0620], ['Bekasi pusat', -6.2383, 106.9756], ['Bekasi Utara', -6.1850, 107.0000]]
  for (const [label, lat, lon] of simPts) {
    const ts = []; let last
    for (let i = 0; i < 5; i++) { const { ms, r } = await timeIt(() => anon.rpc('simulate_new_stop', { lat, lon })); ts.push(ms); last = r }
    const st = stats(ts.map(x => +x.toFixed(0)))
    console.log(`  simulate_new_stop [${label}]: median=${st.median}ms max=${st.max}ms  ${last.error ? 'ERR ' + last.error.message : 'p800=' + (last.data.penduduk_terlayani_800m ?? last.data.penduduk_terlayani ?? '?')}  ${st.max < 3000 ? 'PASS <3s' : 'FAIL >=3s'}`)
  }
  // peta filter proxy: full grid geojson fetch (what MapView/AnalisisSpasial does)
  const { ms, r } = await timeIt(async () => {
    let rows = [], from = 0
    for (let i = 0; i < 60; i++) {
      const { data, error } = await svc.from('grid_analisis').select('id, skor_tdi, kepadatan_penduduk').order('id').range(from, from + 999)
      if (error) throw error
      if (!data.length) break
      rows.push(...data); if (data.length < 1000) break; from += 1000
    }
    return rows
  })
  console.log(`  grid_analisis full fetch (one-time layer load): ${ms.toFixed(0)}ms, ${r.length} rows`)
  const ft = []
  for (let i = 0; i < 30; i++) {
    const t0 = performance.now()
    const filtered = r.filter(g => g.id % 4 === 0)
    const fc = { type: 'FeatureCollection', features: filtered.map(c => ({ type: 'Feature', properties: { value: c.skor_tdi ?? 0 } })) }
    ft.push(performance.now() - t0); void fc
  }
  console.log(`  in-memory kecamatan re-filter + FC build: ${JSON.stringify(stats(ft.map(x => +x.toFixed(2))))} ms`)
}

// ============ 10. RLS regression ============
console.log('\n======== 10. RLS spot-check ========')
{
  const { error: werr } = await anon.from('titik_kandidat').insert({ id_titik_survei: 'QA-DELETE-ME-' + Date.now() })
  console.log(`  anon INSERT titik_kandidat: ${werr ? 'blocked OK' : 'ALLOWED <-- REGRESSION'}`)
  const { data, error } = await anon.from('konfigurasi_bobot').select('nama_index').limit(1)
  console.log(`  anon SELECT konfigurasi_bobot: ${error ? 'ERR ' + error.message : 'ok'}`)
}

console.log('\n=== DONE ===')

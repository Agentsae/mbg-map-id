// qa/verify-tdi-usia-sekolah-2026-09-06.mjs
// Empirical verification of TDI_MOBILITAS methodology flip (tanpa_kendaraan -> usia_sekolah 5-19).
// Read-only. node qa/verify-tdi-usia-sekolah-2026-09-06.mjs
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
const svc = createClient(fe.VITE_SUPABASE_URL, SERVICE || fe.VITE_SUPABASE_ANON_KEY, { auth: { persistSession: false } })
console.log('service key present:', !!SERVICE)

const stat = (arr) => {
  const s = arr.filter((x) => x != null).map(Number).sort((a, b) => a - b)
  if (!s.length) return { n: 0 }
  const med = s.length % 2 ? s[(s.length - 1) / 2] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2
  const mean = s.reduce((a, b) => a + b, 0) / s.length
  return { n: s.length, min: +s[0].toFixed(4), median: +med.toFixed(4), mean: +mean.toFixed(4), max: +s[s.length - 1].toFixed(4) }
}

async function fetchAll(table, cols, mod = (q) => q) {
  const out = []
  const page = 1000
  for (let from = 0; ; from += page) {
    let q = svc.from(table).select(cols).range(from, from + page - 1)
    q = mod(q)
    const { data, error } = await q
    if (error) { console.log(`ERR ${table}:`, error.message); break }
    out.push(...data)
    if (data.length < page) break
  }
  return out
}

// ============ 1. konfigurasi_bobot ============
console.log('\n======== 1. konfigurasi_bobot ========')
{
  const { data } = await svc.from('konfigurasi_bobot').select('*').order('nama_index').order('nama_kriteria')
  const byIdx = {}
  for (const r of data) (byIdx[r.nama_index] ||= []).push(r)
  for (const [idx, rows] of Object.entries(byIdx)) {
    const sum = rows.reduce((a, r) => a + Number(r.bobot), 0)
    console.log(`  ${idx} (${rows.length} baris)  Σ=${sum.toFixed(4)}`)
    for (const r of rows) console.log(`     ${r.nama_kriteria.padEnd(20)} bobot=${r.bobot}  CR=${r.consistency_ratio}  ditentukan=${String(r.ditentukan_pada).slice(0,10)}`)
  }
}

// ============ 2. penduduk.proporsi_usia_sekolah ============
console.log('\n======== 2. penduduk.proporsi_usia_sekolah ========')
{
  const rows = await fetchAll('penduduk', 'kelurahan_id, jumlah_penduduk, proporsi_usia_sekolah, proporsi_lansia, proporsi_balita')
  const nullc = rows.filter((r) => r.proporsi_usia_sekolah == null).length
  console.log(`  baris: ${rows.length}  NULL proporsi_usia_sekolah: ${nullc}`)
  console.log(`  proporsi_usia_sekolah: ${JSON.stringify(stat(rows.map((r) => r.proporsi_usia_sekolah)))}`)
  // overlap check with usia_rentan (lansia+balita)
  const over = rows.filter((r) => Number(r.proporsi_usia_sekolah) + Number(r.proporsi_lansia) + Number(r.proporsi_balita) > 1).length
  console.log(`  baris dgn usia_sekolah+lansia+balita > 1 (overlap flag): ${over}`)
}

// ============ 3. grid_analisis ============
console.log('\n======== 3. grid_analisis ========')
let gridRows
{
  gridRows = await fetchAll('grid_analisis', 'id, skor_tdi, indeks_kebutuhan_mobilitas, kepadatan_penduduk, skor_aksesibilitas_transit')
  const n = gridRows.length
  const tdiNull = gridRows.filter((r) => r.skor_tdi == null).length
  const tdiOob = gridRows.filter((r) => r.skor_tdi != null && (r.skor_tdi < 0 || r.skor_tdi > 1)).length
  const gt06 = gridRows.filter((r) => r.skor_tdi != null && r.skor_tdi > 0.6).length
  const ikmNull = gridRows.filter((r) => r.indeks_kebutuhan_mobilitas == null).length
  console.log(`  total sel: ${n}`)
  console.log(`  skor_tdi: NULL=${tdiNull}  di luar [0,1]=${tdiOob}  > 0.6 = ${gt06}`)
  console.log(`  skor_tdi dist: ${JSON.stringify(stat(gridRows.map((r) => r.skor_tdi)))}`)
  console.log(`  indeks_kebutuhan_mobilitas: NULL=${ikmNull}  dist: ${JSON.stringify(stat(gridRows.map((r) => r.indeks_kebutuhan_mobilitas)))}`)
}

// ============ 4. skor_cai regression ============
console.log('\n======== 4. skor_cai (regresi - harus TIDAK berubah) ========')
{
  const { data } = await svc.from('skor_cai').select('*')
  console.log(`  baris: ${data.length}`)
  const wcols = ['bobot_kepadatan', 'bobot_jarak', 'bobot_volume', 'bobot_survei']
  for (const k of wcols) console.log(`  ${k}: ${[...new Set(data.map((r) => Number(r[k])))].join(', ')}`)
  const s = data.map((r) => ({ nama: r.nama_lokasi || r.id, skor: Number(r.skor_cai) })).sort((a, b) => b.skor - a.skor)
  console.log('  skor_cai dist:', JSON.stringify(stat(data.map((r) => r.skor_cai))))
  console.log('  top 5:', s.slice(0, 5).map((x) => `${x.nama}=${x.skor.toFixed(4)}`).join('  '))
  console.log('  bottom 3:', s.slice(-3).map((x) => `${x.nama}=${x.skor.toFixed(4)}`).join('  '))
  const oob = data.filter((r) => r.skor_cai != null && (r.skor_cai < 0 || r.skor_cai > 1)).length
  console.log(`  skor_cai di luar [0,1]: ${oob}`)
}

// ============ 5. skor_equity regression ============
console.log('\n======== 5. skor_equity (regresi - harus TIDAK berubah) ========')
{
  const { data } = await svc.from('skor_equity').select('*').ilike('sumber', 'REAL%').order('ranking', { ascending: true })
  console.log(`  baris REAL: ${data.length}`)
  const oob = data.filter((r) => r.skor_final != null && (r.skor_final < 0 || r.skor_final > 1)).length
  console.log(`  skor_final di luar [0,1]: ${oob}`)
  console.log(`  skor_final dist: ${JSON.stringify(stat(data.map((r) => r.skor_final)))}`)
  console.log('  TOP 10 ranking ketimpangan:')
  for (const r of data.slice(0, 10)) console.log(`    #${r.ranking}  ${String(r.nama_kelurahan || r.kelurahan_id).padEnd(22)} skor_final=${Number(r.skor_final).toFixed(4)}`)
}

// ============ 6. get_tdi_breakdown beberapa titik ============
console.log('\n======== 6. get_tdi_breakdown (RPC) ========')
{
  const pts = [
    ['dalam kota - Bekasi Timur', 106.9900, -6.2400],
    ['Mustika Jaya PRD (tepi/luar)', 107.0620, -6.2986],
    ['pusat kota - alun2', 106.9896, -6.2383],
    ['Bekasi Utara', 106.9750, -6.1850],
  ]
  for (const [label, lng, lat] of pts) {
    const { data, error } = await svc.rpc('get_tdi_breakdown', { lng, lat })
    if (error) { console.log(`  ${label}: ERR ${error.message}`); continue }
    if (!data.ditemukan) { console.log(`  ${label}: ditemukan=false ${data.di_luar_cakupan_grid ? '(di_luar_cakupan_grid, jarak '+data.jarak_ke_sel_terdekat_m+'m)' : JSON.stringify(data)}`); continue }
    const komp = (data.komponen || []).map((k) => `${k.kunci}=${k.nilai}`).join(' | ')
    const ikm = (data.komponen || []).find((k) => k.kunci === 'indeks_kebutuhan_mobilitas')
    console.log(`  ${label}: cell=${data.cell_id} match=${data.match} skor_tdi=${data.skor_tdi} reproduksi=${data.skor_tdi_reproduksi_perkiraan}`)
    console.log(`      ${komp}`)
    console.log(`      IKM satuan: "${ikm?.satuan}"`)
  }
}

// ============ 7. face validity: skor_tdi vs jarak ke halte ============
console.log('\n======== 7. face validity (skor_tdi dekat vs jauh dari halte) ========')
{
  // ambil halte real
  const halte = await fetchAll('halte_eksisting', 'id, geom')
  console.log(`  halte_eksisting: ${halte.length} (butuh geom utk hitung jarak - dilewati jika kosong)`)
  console.log('  -> jarak per-sel dihitung di compute_tdi_full.py dry-run (lihat output python terpisah)')
}

console.log('\n=== SELESAI ===')

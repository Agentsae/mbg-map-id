import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9325
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--no-default-browser-check', '--disable-gpu', '--window-size=1600,1200',
  '--user-data-dir=' + process.env.TEMP + '/qa-chrome-p4', 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => chrome.kill())
async function tgt() { for (let i = 0; i < 40; i++) { try { const r = await (await fetch(`http://localhost:${PORT}/json/list`)).json(); const p = r.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p } catch {} await sleep(250) } throw new Error('no cdp') }
const page = await tgt()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
const rpcCalls = []
const postBodies = []
const errs = []
ws.addEventListener('message', async e => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map(a => a.value ?? a.description).join(' '))
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params.request.url
    if (/rpc\/(simulate_new_stop|get_tdi_breakdown)/.test(u)) rpcCalls.push(u.split('/rest/v1/')[1])
    if (/functions\/v1\/ai-insight/.test(u) && m.params.request.postData) postBodies.push(m.params.request.postData)
  }
})
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Page.navigate', { url: 'http://localhost:4319/' })
await sleep(3500)

// ---- 1. Simulasi preset flow ----
await ev(`[...document.querySelectorAll('button[title]')].find(x=>x.title==='Simulasi Skenario').click()`)
await sleep(1200)
await ev(`(() => { const s=document.querySelector('aside select'); s.value='mustikajaya'; s.dispatchEvent(new Event('change',{bubbles:true})); })()`)
await sleep(400)
await ev(`[...document.querySelectorAll('aside button')].find(b=>/Lihat Hasil Simulasi/.test(b.textContent)).click()`)
await sleep(3500)
const sim = await ev(`(() => {
  const tc = document.querySelector('aside').textContent;
  return {
    shows400: /Penduduk terlayani \\(400m\\)/.test(tc),
    shows800: /Penduduk terlayani \\(800m\\)/.test(tc),
    line: (tc.replace(/\\s+/g,' ').match(/Penduduk terlayani \\(400m\\)[\\s\\S]{0,220}/)||[''])[0],
    markerCount: document.querySelectorAll('.maplibregl-marker').length,
  };
})()`)
console.log('SIMULASI preset:', JSON.stringify(sim, null, 2))
console.log('  rpc calls so far:', JSON.stringify(rpcCalls))

// ---- 2. Analisis Spasial: gap layer + real map click ----
await ev(`[...document.querySelectorAll('button[title]')].find(x=>x.title==='Analisis Spasial').click()`)
await sleep(3000)
await ev(`(() => { const r=[...document.querySelectorAll('aside label')].find(l=>/Indeks Gap Aksesibilitas/.test(l.textContent)); r.querySelector('input').click(); })()`)
await sleep(1500)
// find the map canvas bounding box (the one inside the analisis panel area / main content)
const box = await ev(`(() => { const c=document.querySelector('.maplibregl-canvas'); if(!c) return null; const r=c.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height}; })()`)
console.log('  canvas box:', JSON.stringify(box))
if (box) {
  const cx = Math.round(box.x + box.w / 2)
  const cy = Math.round(box.y + box.h / 2)
  for (const type of ['mousePressed', 'mouseReleased']) {
    await send('Input.dispatchMouseEvent', { type, x: cx, y: cy, button: 'left', clickCount: 1 })
  }
  await sleep(3000)
}
const tdi = await ev(`(() => {
  const tc = document.querySelector('aside').textContent + ' ' + (document.querySelector('.maplibregl-map')?.textContent||'');
  return {
    panelTitle: /Rincian Transit Desert Index/.test(tc),
    hasFormula: /normalisasi_minmax/.test(tc),
    hasPembilang: /pembilang/.test(tc),
    hasPenyebut: /penyebut/.test(tc),
    hasReproduksi: /Reproduksi skor/.test(tc),
    snippet: tc.replace(/\\s+/g,' ').match(/Rincian Transit Desert Index[\\s\\S]{0,400}/)?.[0] || '(panel not found)',
  };
})()`)
console.log('TDI panel after map click:', JSON.stringify(tdi, null, 2))
console.log('  rpc calls:', JSON.stringify(rpcCalls))

// ---- 3. AI panel: run after sim, capture request body ----
await ev(`[...document.querySelectorAll('button[title]')].find(x=>x.title==='AI Spatial Consultant').click()`)
await sleep(1500)
const ctxBanner = await ev(`/Konteks simulasi What-If terakhir disertakan/.test(document.querySelector('aside').textContent)`)
await ev(`(() => { const i=document.querySelector('aside input'); i.value='Di mana titik prioritas halte baru di Kecamatan Mustika Jaya?'; i.dispatchEvent(new Event('input',{bubbles:true})); })()`)
await sleep(300)
await ev(`[...document.querySelectorAll('aside button')].pop().click()`)
await sleep(4000)
console.log('AI panel: context banner shown =', ctxBanner)
console.log('  ai-insight POST bodies captured:', JSON.stringify(postBodies))
const aiMsg = await ev(`(() => { const els=[...document.querySelectorAll('aside .bg-slate-100, aside .bg-red-50')]; return els.map(e=>e.textContent.slice(0,200)); })()`)
console.log('  AI messages:', JSON.stringify(aiMsg, null, 2))

console.log('\nconsole errors:', errs.length); errs.forEach(e => console.log('  ' + String(e).slice(0, 300)))
ws.close(); chrome.kill(); await sleep(200); process.exit(0)

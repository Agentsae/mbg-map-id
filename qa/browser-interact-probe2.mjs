import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9326
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--no-default-browser-check', '--disable-gpu', '--window-size=1600,1300',
  '--user-data-dir=' + process.env.TEMP + '/qa-chrome-p5', 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => chrome.kill())
async function tgt() { for (let i = 0; i < 40; i++) { try { const r = await (await fetch(`http://localhost:${PORT}/json/list`)).json(); const p = r.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p } catch {} await sleep(250) } throw new Error('no cdp') }
const page = await tgt()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
const rpcCalls = [], aiBodies = [], errs = []
ws.addEventListener('message', e => {
  const m = JSON.parse(e.data)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map(a => a.value ?? a.description).join(' '))
  if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
  if (m.method === 'Network.requestWillBeSent') {
    const u = m.params.request.url
    if (/rpc\/(simulate_new_stop|get_tdi_breakdown)/.test(u)) rpcCalls.push({ fn: u.split('/rest/v1/rpc/')[1].split('?')[0], body: m.params.request.postData })
    if (/functions\/v1\/ai-insight/.test(u)) aiBodies.push(m.params.request.postData || '(no body)')
  }
})
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value
const setReactInput = (sel, val) => ev(`(() => {
  const el = document.querySelector(${JSON.stringify(sel)});
  const set = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value').set;
  set.call(el, ${JSON.stringify(val)});
  el.dispatchEvent(new Event('input', { bubbles: true }));
  return el.value;
})()`)

await send('Page.navigate', { url: 'http://localhost:4319/' })
await sleep(3500)

// run a What-If first (preset) so AIPanel has latestSimulasi
await ev(`[...document.querySelectorAll('button[title]')].find(x=>x.title==='Simulasi Skenario').click()`)
await sleep(1000)
await ev(`(() => { const s=document.querySelector('aside select'); const set=Object.getOwnPropertyDescriptor(window.HTMLSelectElement.prototype,'value').set; set.call(s,'terminalbekasi'); s.dispatchEvent(new Event('change',{bubbles:true})); })()`)
await sleep(400)
await ev(`[...document.querySelectorAll('aside button')].find(b=>/Lihat Hasil Simulasi/.test(b.textContent)).click()`)
await sleep(3500)
console.log('after preset, rpcCalls:', JSON.stringify(rpcCalls))

// ---- Analisis Spasial: gap layer + click the PANEL's canvas (last one) ----
await ev(`[...document.querySelectorAll('button[title]')].find(x=>x.title==='Analisis Spasial').click()`)
await sleep(3500)
await ev(`(() => { const r=[...document.querySelectorAll('aside label')].find(l=>/Indeks Gap Aksesibilitas/.test(l.textContent)); r.querySelector('input').click(); })()`)
await sleep(1800)
const boxes = await ev(`[...document.querySelectorAll('.maplibregl-canvas')].map(c=>{const r=c.getBoundingClientRect();return {x:r.x,y:r.y,w:r.width,h:r.height};})`)
console.log('canvases:', JSON.stringify(boxes))
const b = boxes[boxes.length - 1] // panel map is the last-mounted
if (b && b.w > 20) {
  const cx = Math.round(b.x + b.w / 2), cy = Math.round(b.y + b.h / 2)
  await send('Input.dispatchMouseEvent', { type: 'mouseMoved', x: cx, y: cy })
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: cx, y: cy, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: cx, y: cy, button: 'left', clickCount: 1 })
  await sleep(3500)
}
const tdi = await ev(`(() => {
  const tc = document.body.textContent;
  const panel = [...document.querySelectorAll('*')].find(e => /Rincian Transit Desert Index/.test(e.textContent||'') && e.children.length < 12);
  return {
    panelPresent: /Rincian Transit Desert Index/.test(tc),
    loadingOrResult: /Mengambil rincian sel|Skor TDI sel/.test(tc),
    hasFormula: /normalisasi_minmax/.test(tc),
    hasPembilang: /pembilang . menaikkan TDI/.test(tc),
    hasPenyebut: /penyebut . menurunkan TDI/.test(tc),
    hasReproduksi: /Reproduksi skor/.test(tc),
    weightedBarModel: /nilai . bobot|kontribusi berbobot/i.test(tc),
    snippet: (tc.replace(/\\s+/g,' ').match(/Rincian Transit Desert Index[\\s\\S]{0,500}/)||['(not found)'])[0],
  };
})()`)
console.log('TDI panel:', JSON.stringify(tdi, null, 2))
console.log('rpcCalls now:', JSON.stringify(rpcCalls, null, 2))

// ---- AI panel: proper React input + send, capture body ----
await ev(`[...document.querySelectorAll('button[title]')].find(x=>x.title==='AI Spatial Consultant').click()`)
await sleep(1500)
const banner = await ev(`/Konteks simulasi What-If terakhir disertakan/.test(document.querySelector('aside').textContent)`)
await setReactInput('aside input', 'Di mana titik prioritas halte baru di Kecamatan Mustika Jaya?')
await sleep(300)
await ev(`[...document.querySelectorAll('aside button')].find(b=>b.querySelector('svg') && !b.textContent.trim()).click()`)
await sleep(5000)
console.log('AI context banner:', banner)
console.log('ai-insight request bodies:', JSON.stringify(aiBodies, null, 2))
const aiMsgs = await ev(`[...document.querySelectorAll('aside .rounded-lg')].map(e=>e.textContent.replace(/\\s+/g,' ').trim().slice(0,240)).filter(t=>t.length>10)`)
console.log('AI panel messages:', JSON.stringify(aiMsgs, null, 2))

console.log('\nconsole errors:', errs.length); errs.forEach(e => console.log('  ' + String(e).slice(0, 300)))
ws.close(); chrome.kill(); await sleep(200); process.exit(0)

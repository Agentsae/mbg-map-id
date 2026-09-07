// Focused browser probe: Dashboard "Potensi Penerima Manfaat" card value + demo badge,
// Analisis Spasial gap-layer real map click (in-grid + off-grid), CAI click panel.
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL_APP = 'http://localhost:4319/'
const PORT = 9323

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1400,900', '--user-data-dir=' + process.env.TEMP + '/qa-chrome-profile2',
  'about:blank',
], { stdio: 'ignore' })
process.on('exit', () => chrome.kill())

async function cdpTarget() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/list`)
      const page = (await r.json()).find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {}
    await sleep(250)
  }
  throw new Error('CDP not reachable')
}
const page = await cdpTarget()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let msgId = 0
const pending = new Map()
const consoleErrors = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error')
    consoleErrors.push(m.params.args.map(a => a.value ?? a.description ?? '').join(' '))
  if (m.method === 'Runtime.exceptionThrown')
    consoleErrors.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text))
})
await new Promise((res) => ws.addEventListener('open', res))
function send(method, params = {}) {
  const id = ++msgId
  return new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
}
await send('Runtime.enable'); await send('Page.enable')
async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  return r.result?.result?.value
}
async function clickTab(label) {
  await evalJS(`[...document.querySelectorAll('button[title]')].find(x=>x.title===${JSON.stringify(label)})?.click()`)
}

await send('Page.navigate', { url: URL_APP })
await sleep(4000)

// ---- Dashboard: Potensi Penerima Manfaat card ----
await clickTab('Dashboard')
await sleep(3500)
const potensi = await evalJS(`(() => {
  const aside = document.querySelector('aside'); if(!aside) return {err:'no aside'};
  const txt = aside.innerText;
  // find the StatCard containing "Potensi Penerima Manfaat"
  const cards = [...aside.querySelectorAll('*')].filter(e => /Potensi Penerima Manfaat/.test(e.textContent||'') && e.children.length<=6);
  const card = cards[cards.length-1];
  const cardTxt = card ? card.innerText.replace(/\\n/g,' | ') : '(not found)';
  const demoBadge = card ? /\\bdemo\\b/i.test([...card.querySelectorAll('*')].map(e=>e.textContent).join(' ')) : null;
  return {
    cardTxt,
    demoBadge,
    mentions800m: /800\\s*m/.test(cardTxt),
    mentionsUsulanHalte: /usulan halte prioritas/i.test(cardTxt),
    mentions25M: /2\\.5|2\\.516\\.369|2\\.516|transit desert kota/i.test(cardTxt),
    transitDesertCard: (txt.match(/Transit Desert Teridentifikasi[\\s\\S]{0,40}/)||[''])[0].replace(/\\n/g,' '),
  };
})()`)
console.log('POTENSI CARD:', JSON.stringify(potensi, null, 2))

// ---- Analisis Spasial: gap layer, real map clicks ----
await clickTab('Analisis Spasial')
await sleep(3000)
await evalJS(`(() => { const l=[...document.querySelectorAll('aside label')].find(l=>/Indeks Gap Aksesibilitas/.test(l.textContent)); l?.querySelector('input')?.click(); })()`)
await sleep(2500)

// locate the map canvas bounding box (main area, not aside)
const box = await evalJS(`(() => {
  const cs = [...document.querySelectorAll('canvas')];
  const c = cs.map(c=>({c,r:c.getBoundingClientRect()})).sort((a,b)=>b.r.width*b.r.height-a.r.width*a.r.height)[0];
  if(!c) return null;
  const r=c.r; return {x:r.x,y:r.y,w:r.width,h:r.height};
})()`)
console.log('map canvas box:', JSON.stringify(box))

async function mapClick(px, py, tag) {
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 })
  await sleep(2500)
  const panel = await evalJS(`(() => {
    const p = [...document.querySelectorAll('*')].find(e => /Rincian Transit Desert Index/.test(e.textContent||'') && e.className && /absolute/.test(e.className));
    if(!p) return {open:false};
    const t = p.innerText.replace(/\\n+/g,' | ');
    return { open:true, text: t.slice(0,600),
      outOfGrid: /di luar cakupan|luar cakupan grid|Jarak ke sel terdekat/i.test(t),
      hasBreakdown: /Komponen formula|pembilang|penyebut/i.test(t),
      hasDemoBadge: /Data contoh/i.test(t) };
  })()`)
  console.log(`  click ${tag} @${px},${py}:`, JSON.stringify(panel))
}

if (box) {
  // center of map = likely in-grid (Bekasi core)
  await mapClick(Math.round(box.x + box.w/2), Math.round(box.y + box.h/2), 'CENTER (expect in-grid breakdown)')
  // far corner (bottom-right) = likely off-grid / edge
  await mapClick(Math.round(box.x + box.w - 12), Math.round(box.y + box.h - 12), 'BR-CORNER (expect off-grid msg or breakdown)')
}

// ---- Peta Interaktif: CAI click panel ----
await clickTab('Peta Interaktif')
await sleep(3000)
const box2 = await evalJS(`(() => {
  const cs=[...document.querySelectorAll('canvas')];
  const c=cs.map(c=>({c,r:c.getBoundingClientRect()})).sort((a,b)=>b.r.width*b.r.height-a.r.width*a.r.height)[0];
  if(!c) return null; const r=c.r; return {x:r.x,y:r.y,w:r.width,h:r.height};
})()`)
if (box2) {
  const px = Math.round(box2.x + box2.w/2), py = Math.round(box2.y + box2.h/2)
  await send('Input.dispatchMouseEvent', { type: 'mousePressed', x: px, y: py, button: 'left', clickCount: 1 })
  await send('Input.dispatchMouseEvent', { type: 'mouseReleased', x: px, y: py, button: 'left', clickCount: 1 })
  await sleep(2500)
  const cai = await evalJS(`(() => {
    const p=[...document.querySelectorAll('*')].find(e=>/Composite Accessibility Index|Rincian Skor CAI|Kontribusi kriteria/i.test(e.textContent||'') && /absolute|fixed/.test(e.className||''));
    if(!p) return {open:false};
    const t=p.innerText.replace(/\\n+/g,' | ');
    // pull numbers: bobot mentions
    return { open:true, text:t.slice(0,700),
      mentions0329: /0,329|0\\.329/.test(t), mentions035: /0,35\\b|0\\.35\\b/.test(t) };
  })()`)
  console.log('CAI PANEL:', JSON.stringify(cai, null, 2))
}

console.log('\nconsole.error / exceptions during probe:', consoleErrors.length)
consoleErrors.forEach((e,i)=>console.log(`  [${i}] ${e.slice(0,240)}`))
ws.close(); chrome.kill(); await sleep(300)
console.log('=== DONE ===')
process.exit(0)

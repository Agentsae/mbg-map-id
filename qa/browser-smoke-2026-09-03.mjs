// qa/browser-smoke-2026-09-03.mjs
// Headless Chrome smoke via CDP (no deps). Loads the built app on :4319,
// walks every sidebar tab, records console.error / page exceptions / failed
// requests, and probes a few DOM signals. Read-only.
//
//   node qa/browser-smoke-2026-09-03.mjs
import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'

const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const URL_APP = 'http://localhost:4319/'
const PORT = 9322

const chrome = spawn(CHROME, [
  '--headless=new', `--remote-debugging-port=${PORT}`,
  '--no-first-run', '--no-default-browser-check', '--disable-gpu',
  '--window-size=1400,900', '--user-data-dir=' + process.env.TEMP + '/qa-chrome-profile',
  'about:blank',
], { stdio: 'ignore' })

process.on('exit', () => chrome.kill())

async function cdpTargets() {
  for (let i = 0; i < 40; i++) {
    try {
      const r = await fetch(`http://localhost:${PORT}/json/list`)
      const list = await r.json()
      const page = list.find((t) => t.type === 'page')
      if (page?.webSocketDebuggerUrl) return page
    } catch {}
    await sleep(250)
  }
  throw new Error('CDP not reachable')
}

const page = await cdpTargets()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let msgId = 0
const pending = new Map()
const events = []
ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.id && pending.has(m.id)) { pending.get(m.id)(m); pending.delete(m.id) }
  else if (m.method) events.push(m)
})
await new Promise((res) => ws.addEventListener('open', res))
function send(method, params = {}) {
  const id = ++msgId
  return new Promise((res) => { pending.set(id, res); ws.send(JSON.stringify({ id, method, params })) })
}

const consoleErrors = []
const pageExceptions = []
const failedRequests = []

ws.addEventListener('message', (ev) => {
  const m = JSON.parse(ev.data)
  if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') {
    consoleErrors.push(m.params.args.map((a) => a.value ?? a.description ?? a.unserializableValue ?? JSON.stringify(a.preview?.properties ?? '')).join(' '))
  }
  if (m.method === 'Runtime.exceptionThrown') {
    const e = m.params.exceptionDetails
    pageExceptions.push(e.exception?.description || e.text)
  }
  if (m.method === 'Network.loadingFailed') {
    failedRequests.push(`${m.params.type} ${m.params.errorText}`)
  }
})

await send('Runtime.enable')
await send('Log.enable')
await send('Network.enable')
await send('Page.enable')

async function evalJS(expression) {
  const r = await send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true })
  if (r.result?.exceptionDetails) throw new Error(JSON.stringify(r.result.exceptionDetails))
  return r.result?.result?.value
}

console.log('navigate ->', URL_APP)
await send('Page.navigate', { url: URL_APP })
await sleep(3500) // initial mount + map + first data fetch

const tabs = ['dashboard', 'peta', 'analisis', 'ai', 'simulasi', 'rekomendasi', 'data-laporan', 'pengaturan']
// sidebar buttons are <button title="..."> in DOM order matching TABS
const tabLabels = {
  dashboard: 'Dashboard', peta: 'Peta Interaktif', analisis: 'Analisis Spasial',
  ai: 'AI Spatial Consultant', simulasi: 'Simulasi Skenario', rekomendasi: 'Rekomendasi',
  'data-laporan': 'Data & Laporan', pengaturan: 'Pengaturan',
}

for (const t of tabs) {
  const label = tabLabels[t]
  const clicked = await evalJS(`(() => {
    const b = [...document.querySelectorAll('button[title]')].find(x => x.title === ${JSON.stringify(label)});
    if (!b) return 'NOT_FOUND';
    b.click();
    return 'clicked';
  })()`)
  await sleep(1800)
  const panelText = await evalJS(`(document.querySelector('aside')?.innerText || '').slice(0, 140).replace(/\\n/g,' | ')`)
  console.log(`  [${t}] ${clicked}  aside="${panelText}"`)
}

// Probe: Dashboard coverage bars count (recharts renders <path class="recharts-bar-rectangle"> or rect)
await evalJS(`[...document.querySelectorAll('button[title]')].find(x=>x.title==='Dashboard')?.click()`)
await sleep(2500)
const dash = await evalJS(`(() => {
  const aside = document.querySelector('aside');
  if (!aside) return {};
  const txt = aside.innerText;
  const bars = aside.querySelectorAll('.recharts-bar-rectangle, .recharts-bar path').length;
  const amber = [...aside.querySelectorAll('*')].some(e => /Coverage ratio menampilkan data contoh/i.test(e.textContent||''));
  const demoBadges = [...aside.querySelectorAll('*')].filter(e => e.children.length===0 && e.textContent.trim()==='demo').length;
  return { bars, amberCoverageBanner: amber, demoBadges,
    hasUsulanHalte: /Usulan Halte Prioritas/.test(txt),
    hasTop3AI: /Top 3 Rekomendasi AI/.test(txt),
    coverageKota: (txt.match(/Coverage Transit Kota[\\s\\S]{0,40}/)||[''])[0].replace(/\\n/g,' '),
    populasi: (txt.match(/Populasi[\\s\\S]{0,30}/)||[''])[0].replace(/\\n/g,' '),
  };
})()`)
console.log('\nDashboard probe:', JSON.stringify(dash, null, 2))

// Probe: Analisis Spasial - switch to gap layer, check legend classes, click map
await evalJS(`[...document.querySelectorAll('button[title]')].find(x=>x.title==='Analisis Spasial')?.click()`)
await sleep(2500)
const ana1 = await evalJS(`(() => {
  const aside = document.querySelector('aside'); const txt = aside.innerText;
  const legendClasses = (txt.match(/Kelas \\d/g)||[]).length;
  return { legendClasses, mentionsColorblind: /colorblind-safe/i.test(txt), mentionsYlGnBu: /YlGnBu/.test(txt),
    filterMsShown: /Filter diterapkan dalam/.test(txt) };
})()`)
console.log('AnalisisSpasial (kepadatan) probe:', JSON.stringify(ana1))
// click the "Indeks Gap Aksesibilitas" radio
await evalJS(`(() => { const r=[...document.querySelectorAll('aside label')].find(l=>/Indeks Gap Aksesibilitas/.test(l.textContent)); r?.querySelector('input')?.click(); })()`)
await sleep(1200)
// simulate a map click near city center via canvas dispatch is unreliable; instead call nothing.
const ana2 = await evalJS(`(() => {
  const aside = document.querySelector('aside'); const txt = aside.innerText;
  return { gapHintShown: /Klik sebuah sel pada peta untuk melihat rincian/.test(txt),
    legendClasses: (txt.match(/Kelas \\d/g)||[]).length };
})()`)
console.log('AnalisisSpasial (gap) probe:', JSON.stringify(ana2))

// Probe: Data & Laporan export buttons present
await evalJS(`[...document.querySelectorAll('button[title]')].find(x=>x.title==='Data & Laporan')?.click()`)
await sleep(2500)
const dl = await evalJS(`(() => {
  const aside=document.querySelector('aside'); const txt=aside.innerText;
  return { hasPDF: /Unduh PDF/.test(txt), hasPNG: /Unduh PNG/.test(txt),
    hasEquityRanking: /Ranking Transit Equity Index/.test(txt),
    hasMapCanvas: !!aside.querySelector('canvas'),
    equityLine: (txt.match(/Ranking Transit Equity Index:[\\s\\S]{0,120}/)||[''])[0].replace(/\\n/g,' ') };
})()`)
console.log('DataLaporan probe:', JSON.stringify(dl, null, 2))

// Try clicking Unduh PNG (download won't save but should not throw)
await send('Page.setDownloadBehavior', { behavior: 'deny' }).catch(()=>{})
const pngClick = await evalJS(`(() => { const b=[...document.querySelectorAll('aside button')].find(x=>/Unduh PNG/.test(x.textContent)); if(!b) return 'NO_BTN'; b.click(); return 'clicked'; })()`)
await sleep(2000)
const dlNote = await evalJS(`(document.querySelector('aside')?.innerText.match(/Gagal membuat[\\s\\S]{0,60}/)||[''])[0]`)
console.log('  PNG button:', pngClick, ' errorNote:', JSON.stringify(dlNote))

console.log('\n================ CONSOLE / EXCEPTION SUMMARY ================')
console.log('console.error count:', consoleErrors.length)
consoleErrors.forEach((e, i) => console.log(`  [err ${i}] ${e.slice(0, 300)}`))
console.log('page exceptions:', pageExceptions.length)
pageExceptions.forEach((e, i) => console.log(`  [exc ${i}] ${String(e).slice(0, 300)}`))
console.log('failed network requests:', failedRequests.length)
failedRequests.slice(0, 20).forEach((e, i) => console.log(`  [net ${i}] ${e}`))

ws.close()
chrome.kill()
await sleep(300)
console.log('\n=== DONE ===')
process.exit(0)

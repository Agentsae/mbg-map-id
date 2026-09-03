import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9323
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--no-default-browser-check', '--disable-gpu', '--window-size=1400,1200',
  '--user-data-dir=' + process.env.TEMP + '/qa-chrome-p2', 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => chrome.kill())
async function tgt() {
  for (let i = 0; i < 40; i++) { try { const r = await (await fetch(`http://localhost:${PORT}/json/list`)).json(); const p = r.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p } catch {} await sleep(250) }
  throw new Error('no cdp')
}
const page = await tgt()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable'); await send('Page.enable'); await send('Network.enable')
const netlog = []
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Network.responseReceived') { const u = m.params.response.url; if (/supabase|coverage|rest\/v1/.test(u)) netlog.push(m.params.response.status + ' ' + u.slice(0, 160)) } })
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Page.navigate', { url: 'http://localhost:4319/' })
await sleep(2000)
await ev(`[...document.querySelectorAll('button[title]')].find(x=>x.title==='Dashboard').click()`)
await sleep(7000) // generous for all dashboard fetches
const out = await ev(`(() => {
  const aside = document.querySelector('aside');
  const txt = aside.innerText;
  const rects = aside.querySelectorAll('.recharts-bar-rectangle').length;
  const yTicks = [...aside.querySelectorAll('.recharts-yAxis .recharts-cartesian-axis-tick-value')].map(t=>t.textContent);
  const grab = (re) => { const m = txt.match(re); return m ? m[0].replace(/\\n+/g,' | ') : null; };
  return {
    barRects: rects,
    yAxisKecamatan: yTicks,
    usulanHalte: grab(/Usulan Halte Prioritas[\\s\\S]{0,120}/),
    top3: grab(/Top 3 Rekomendasi AI[\\s\\S]{0,260}/),
    coverageKota: grab(/Coverage Transit Kota[\\s\\S]{0,90}/),
    transitDesert: grab(/Transit Desert Teridentifikasi[\\s\\S]{0,60}/),
    potensi: grab(/Potensi Penerima Manfaat[\\s\\S]{0,60}/),
    anyDemoBadge: /\\bdemo\\b/.test(txt),
    amberBanner: /menampilkan data contoh/i.test(txt),
  };
})()`)
console.log(JSON.stringify(out, null, 2))
console.log('\n--- supabase/rest responses seen ---')
netlog.forEach(l => console.log('  ' + l))
ws.close(); chrome.kill(); await sleep(200); process.exit(0)

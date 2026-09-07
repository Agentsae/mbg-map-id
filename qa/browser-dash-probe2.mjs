import { spawn } from 'node:child_process'
import { setTimeout as sleep } from 'node:timers/promises'
const CHROME = 'C:/Program Files/Google/Chrome/Application/chrome.exe'
const PORT = 9324
const chrome = spawn(CHROME, ['--headless=new', `--remote-debugging-port=${PORT}`, '--no-first-run',
  '--no-default-browser-check', '--disable-gpu', '--window-size=1400,2000',
  '--user-data-dir=' + process.env.TEMP + '/qa-chrome-p3', 'about:blank'], { stdio: 'ignore' })
process.on('exit', () => chrome.kill())
async function tgt() { for (let i = 0; i < 40; i++) { try { const r = await (await fetch(`http://localhost:${PORT}/json/list`)).json(); const p = r.find(t => t.type === 'page'); if (p?.webSocketDebuggerUrl) return p } catch {} await sleep(250) } throw new Error('no cdp') }
const page = await tgt()
const ws = new WebSocket(page.webSocketDebuggerUrl)
let id = 0; const pend = new Map()
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.id && pend.has(m.id)) { pend.get(m.id)(m); pend.delete(m.id) } })
await new Promise(r => ws.addEventListener('open', r))
const send = (method, params = {}) => new Promise(r => { const i = ++id; pend.set(i, r); ws.send(JSON.stringify({ id: i, method, params })) })
await send('Runtime.enable'); await send('Page.enable')
const errs = []
ws.addEventListener('message', e => { const m = JSON.parse(e.data); if (m.method === 'Runtime.consoleAPICalled' && m.params.type === 'error') errs.push(m.params.args.map(a => a.value ?? a.description).join(' ')); if (m.method === 'Runtime.exceptionThrown') errs.push('EXC ' + (m.params.exceptionDetails.exception?.description || m.params.exceptionDetails.text)) })
const ev = async x => (await send('Runtime.evaluate', { expression: x, returnByValue: true, awaitPromise: true })).result?.result?.value
await send('Page.navigate', { url: 'http://localhost:4319/' })
await sleep(2000)
await ev(`[...document.querySelectorAll('button[title]')].find(x=>x.title==='Dashboard').click()`)
await sleep(8000)
const out = await ev(`(() => {
  const aside = document.querySelector('aside');
  const tc = aside.textContent;
  return {
    len: tc.length,
    hasUsulan: tc.includes('Usulan Halte Prioritas'),
    hasTop3: tc.includes('Top 3 Rekomendasi AI'),
    hasCoverageKota: tc.includes('Coverage Transit Kota'),
    hasArenjaya: tc.includes('Arenjaya'),
    hasCimuning: tc.includes('Cimuning'),
    recharts_bar_rect: aside.querySelectorAll('.recharts-bar-rectangle').length,
    recharts_rect_any: aside.querySelectorAll('.recharts-rectangle').length,
    yticks: [...aside.querySelectorAll('.recharts-yAxis text')].map(t=>t.textContent),
    dump: tc.replace(/\\s+/g,' ').slice(0, 1600),
  };
})()`)
console.log(JSON.stringify(out, null, 2))
console.log('\nconsole errors:', errs.length); errs.forEach(e => console.log('  ' + String(e).slice(0, 300)))
ws.close(); chrome.kill(); await sleep(200); process.exit(0)

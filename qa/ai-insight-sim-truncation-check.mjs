// qa/ai-insight-sim-truncation-check.mjs
// Follow-up: how often does the What-If (simulasi) narasi get cut mid-sentence at
// max_tokens:420, and when it isn't cut does it actually cite +N jiwa (4.821 / 15.230)?
// Also grabs 8 more warm latency samples for a larger distribution.
//   node qa/ai-insight-sim-truncation-check.mjs

const FN_URL = "https://vpymlmaebvfmpowomsec.supabase.co/functions/v1/ai-insight";
const KEY = "sb_publishable_Km7tW_79bQ3zsOrdNgl2Ug_HBfsIDJ-";
const H = { Authorization: `Bearer ${KEY}`, apikey: KEY, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const wc = (t) => (t ? (t.trim().match(/\S+/g) || []).length : 0);
const looksTruncated = (t) => { if (!t || !t.trim()) return true; return !/[.!?][")”»]?\s*$/.test(t.trim().slice(-3)); };
const pct = (a, p) => { const s = [...a].sort((x, y) => x - y); return s[Math.max(0, Math.ceil((p / 100) * s.length) - 1)]; };

const SIM = {
  query: "Rekomendasikan lokasi halte baru dan proyeksi manfaatnya.",
  area_filter: "Mustika Jaya",
  simulasi: {
    lokasi: { lat: -6.293, lon: 106.998 },
    penduduk_terlayani_400m: 4821,
    penduduk_terlayani_800m: 15230,
    transit_eksisting_terdekat: { nama: "Halte Mustika Jaya", jarak_m: 1240 },
    estimasi_pengurangan_waktu_tempuh_menit: 11,
    fasilitas_pendidikan_400m: 6,
    fasilitas_kesehatan_400m: 2,
  },
};
const WARM = { query: "Di mana titik prioritas halte baru di Kecamatan Mustika Jaya?", area_filter: "Mustika Jaya" };

async function call(body) {
  const t0 = performance.now();
  const res = await fetch(FN_URL, { method: "POST", headers: H, body: JSON.stringify(body) });
  const j = await res.json().catch(() => null);
  return { ms: performance.now() - t0, status: res.status, j };
}

const cites = (t) => /4[.,]?821|15[.,]?230/.test(t || "");

async function main() {
  const simRows = [];
  console.log("=== 8x SIMULASI payload ===");
  for (let i = 0; i < 8; i++) {
    const r = await call(SIM);
    const n = r.j?.narasi || "";
    const rec = { ms: +r.ms.toFixed(0), words: wc(n), truncated: looksTruncated(n), cites: cites(n), flagged: r.j?.narasi_flagged, tail: n.trim().slice(-70) };
    simRows.push(rec);
    console.log(`  sim#${i + 1}: ${rec.ms}ms words=${rec.words} trunc=${rec.truncated} citesN=${rec.cites} flagged=${rec.flagged}`);
    console.log(`         tail: ...${rec.tail}`);
    await sleep(1200);
  }
  const warmRows = [];
  console.log("\n=== 8x WARM (no simulasi) ===");
  for (let i = 0; i < 8; i++) {
    const r = await call(WARM);
    const n = r.j?.narasi || "";
    warmRows.push({ ms: +r.ms.toFixed(0), words: wc(n), truncated: looksTruncated(n) });
    console.log(`  warm#${i + 1}: ${r.ms.toFixed(0)}ms words=${wc(n)} trunc=${looksTruncated(n)}`);
    await sleep(1200);
  }
  const sMs = simRows.map((r) => r.ms), wMs = warmRows.map((r) => r.ms);
  console.log("\n=== SUMMARY ===");
  console.log(`SIM truncated:  ${simRows.filter((r) => r.truncated).length}/8   citesN: ${simRows.filter((r) => r.cites).length}/8   words med=${pct(simRows.map((r) => r.words), 50)}`);
  console.log(`SIM ms: min=${Math.min(...sMs)} median=${pct(sMs, 50)} p90=${pct(sMs, 90)} max=${Math.max(...sMs)}`);
  console.log(`WARM truncated: ${warmRows.filter((r) => r.truncated).length}/8   words med=${pct(warmRows.map((r) => r.words), 50)}`);
  console.log(`WARM ms: min=${Math.min(...wMs)} median=${pct(wMs, 50)} p90=${pct(wMs, 90)} max=${Math.max(...wMs)}`);
}
main().catch((e) => { console.error(e); process.exit(1); });

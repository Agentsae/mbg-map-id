// qa/ai-insight-latency-jalurA.mjs
// Formal re-measure of Edge Function `ai-insight` latency after "jalur A" latency cuts
// (max_tokens 1000->420, prompt 110-word cap + paraphrase, markdown ban, kecamatan
//  `%` wildcard fix, strip lokasi coords from LLM payload, prompt caching in `system`).
//
// Node >=18 (global fetch). No deps.  node qa/ai-insight-latency-jalurA.mjs
//
// Produces: cold vs warm distribution (min/median/p90/max), per-narasi word count +
// mid-sentence truncation flag, markdown-leak scan, kecamatan-match regression for 3
// cases, anti-hallucination + coord-leak spot check, rough bottleneck split.

const FN_URL = "https://vpymlmaebvfmpowomsec.supabase.co/functions/v1/ai-insight";
const REST_URL = "https://vpymlmaebvfmpowomsec.supabase.co/rest/v1/skor_equity";
const KEY = "sb_publishable_Km7tW_79bQ3zsOrdNgl2Ug_HBfsIDJ-";

const H = { Authorization: `Bearer ${KEY}`, apikey: KEY, "Content-Type": "application/json" };
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.ceil((p / 100) * s.length) - 1;
  return s[Math.max(0, Math.min(s.length - 1, i))];
};
const stats = (arr) =>
  arr.length
    ? {
        n: arr.length,
        min: +Math.min(...arr).toFixed(0),
        median: +pct(arr, 50).toFixed(0),
        p90: +pct(arr, 90).toFixed(0),
        max: +Math.max(...arr).toFixed(0),
        mean: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(0),
      }
    : { n: 0 };

const wc = (t) => (typeof t === "string" ? (t.trim().match(/\S+/g) || []).length : 0);
// Heuristic: narasi considered "cut mid-sentence" if last non-space char is not
// sentence-terminating punctuation (. ! ? closing quote/paren after one).
const looksTruncated = (t) => {
  if (typeof t !== "string" || !t.trim()) return true;
  const tail = t.trim().slice(-3);
  return !/[.!?][")”»]?\s*$/.test(tail);
};
const MD_PATTERNS = [
  ["bold **", /\*\*/],
  ["hr ---", /(^|\n)\s*-{3,}\s*(\n|$)/],
  ["heading #", /(^|\n)#{1,6}\s/],
  ["bullet -/*", /(^|\n)\s*[-*]\s+\S/],
  ["numbered list", /(^|\n)\s*\d+\.\s+\S/],
  ["CCIA label", /\b(Condition|Cause|Impact|Action|Kondisi|Penyebab|Dampak|Aksi)\s*:/],
];
const mdLeaks = (t) => MD_PATTERNS.filter(([, re]) => re.test(t || "")).map(([n]) => n);

// crude CCIA-presence check: does narasi touch all four stages conceptually?
const cciaHits = (t) => {
  const s = (t || "").toLowerCase();
  return {
    condition: /skor ketimpangan|peringkat|ranking|akses transit/.test(s),
    cause: /composite accessibility|di-?inverse|kerentanan sosial|ahp/.test(s),
    impact: /tanpa intervensi|tanpa tindakan|dampak|kesenjangan|mobilitas/.test(s),
    action: /rekomendasi|bangun|feeder|halte|koridor|trayek/.test(s),
  };
};

async function callFn(body) {
  const t0 = performance.now();
  const res = await fetch(FN_URL, { method: "POST", headers: H, body: JSON.stringify(body) });
  const text = await res.text();
  const ms = performance.now() - t0;
  let json = null;
  try { json = JSON.parse(text); } catch { /* keep text */ }
  return { ms, status: res.status, json, text };
}

async function callRest() {
  const q =
    "?select=skor_final,ranking,batas_administrasi!inner(nama_kelurahan,nama_kecamatan)" +
    "&sumber=ilike.REAL*&order=ranking.asc&limit=5";
  const t0 = performance.now();
  const res = await fetch(REST_URL + q, { headers: H });
  await res.text();
  return { ms: performance.now() - t0, status: res.status };
}

const PRD_QUERY = "Di mana titik prioritas halte baru di Kecamatan Mustika Jaya?";
const WARM_BODY = { query: PRD_QUERY, area_filter: "Mustika Jaya" };

const SIM_PAYLOAD = {
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

const KEC_CASES = [
  { input: "Mustika Jaya", expectKec: "Mustikajaya" },
  { input: "Bekasi Timur", expectKec: "Bekasi Timur" },
  { input: "Rawa Lumbu", expectKec: "Rawalumbu" },
];

const N_COLD = 3;
const COLD_IDLE_MS = 80_000;
const N_WARM = 12;

async function main() {
  const out = { started: new Date().toISOString(), cold: [], warm: [], kec: [], narasiPool: [] };

  // ---- Bottleneck refs: REST DB query + early-400 invocation overhead ----
  console.log("=== REST DB query (skor_equity top-5 REAL) x5 ===");
  const restTimes = [];
  for (let i = 0; i < 5; i++) { const r = await callRest(); restTimes.push(r.ms); console.log(`  rest#${i + 1}: ${r.ms.toFixed(0)}ms status=${r.status}`); await sleep(250); }
  out.restDbQuery = stats(restTimes);

  console.log("\n=== Early-400 path (empty body -> pure invocation overhead) x6 ===");
  const early = [];
  for (let i = 0; i < 6; i++) { const r = await callFn({}); early.push(r.ms); console.log(`  early#${i + 1}: ${r.ms.toFixed(0)}ms status=${r.status}`); await sleep(600); }
  out.earlyPath = stats(early);

  // ---- COLD probes ----
  for (let i = 0; i < N_COLD; i++) {
    console.log(`\n=== COLD probe ${i + 1}/${N_COLD}: idle ${COLD_IDLE_MS / 1000}s then 1 call ===`);
    await sleep(COLD_IDLE_MS);
    const r = await callFn(WARM_BODY);
    const n = r.json?.narasi;
    const rec = {
      ms: +r.ms.toFixed(0), status: r.status, source: r.json?.narasi_source,
      flagged: r.json?.narasi_flagged, words: wc(n), truncated: looksTruncated(n),
      md: mdLeaks(n), matched: r.json?.area_filter?.matched,
    };
    out.cold.push(rec);
    out.narasiPool.push({ tag: `cold#${i + 1}`, narasi: n, ...rec });
    console.log(`  COLD#${i + 1}: ${rec.ms}ms status=${rec.status} src=${rec.source} flagged=${rec.flagged} words=${rec.words} trunc=${rec.truncated} md=${JSON.stringify(rec.md)}`);
  }

  // ---- WARM burst ----
  console.log(`\n=== WARM burst x${N_WARM} (sequential, PRD query, 1.2s spacing) ===`);
  for (let i = 0; i < N_WARM; i++) {
    const r = await callFn(WARM_BODY);
    const n = r.json?.narasi;
    const rec = {
      ms: +r.ms.toFixed(0), status: r.status, source: r.json?.narasi_source,
      flagged: r.json?.narasi_flagged, flagged_reason: r.json?.flagged_reason,
      words: wc(n), truncated: looksTruncated(n), md: mdLeaks(n),
      matched: r.json?.area_filter?.matched,
      kecInRanking: [...new Set((r.json?.ranking || []).map((x) => x.kecamatan))],
    };
    out.warm.push(rec);
    out.narasiPool.push({ tag: `warm#${i + 1}`, narasi: n, ...rec });
    console.log(`  warm#${i + 1}: ${rec.ms}ms status=${rec.status} src=${rec.source} flagged=${rec.flagged} words=${rec.words} trunc=${rec.truncated} md=${JSON.stringify(rec.md)} kec=${JSON.stringify(rec.kecInRanking)}`);
    await sleep(1200);
  }

  // ---- Kecamatan-match regression ----
  console.log(`\n=== Kecamatan match regression ===`);
  for (const c of KEC_CASES) {
    const r = await callFn({ query: `Prioritas halte baru di ${c.input}?`, area_filter: c.input });
    const kecs = [...new Set((r.json?.ranking || []).map((x) => x.kecamatan))];
    const rec = {
      input: c.input, expectKec: c.expectKec,
      matched: r.json?.area_filter?.matched, note: r.json?.area_filter?.note,
      kecInRanking: kecs,
      onlyExpected: kecs.length > 0 && kecs.every((k) => k === c.expectKec),
      ms: +r.ms.toFixed(0),
    };
    out.kec.push(rec);
    console.log(`  "${c.input}" -> matched=${rec.matched} onlyExpected(${c.expectKec})=${rec.onlyExpected} kec=${JSON.stringify(kecs)} ${rec.ms}ms`);
    await sleep(1200);
  }

  // ---- Simulasi payload: coord leak + +N jiwa citation ----
  console.log(`\n=== Simulasi What-If payload ===`);
  const sim = await callFn(SIM_PAYLOAD);
  const sn = sim.json?.narasi || "";
  out.withSimulasi = {
    ms: +sim.ms.toFixed(0), status: sim.status, source: sim.json?.narasi_source,
    flagged: sim.json?.narasi_flagged, flagged_reason: sim.json?.flagged_reason,
    words: wc(sn), truncated: looksTruncated(sn), md: mdLeaks(sn),
    coordLeak: /-6[.,]29|106[.,]99|lat|lon|lintang|bujur|koordinat/i.test(sn),
    cites400: sn.includes("4.821") || sn.includes("4821"),
    cites800: sn.includes("15.230") || sn.includes("15230"),
    narasi: sn,
    simulasi_dipakai: sim.json?.simulasi_dipakai,
  };
  out.narasiPool.push({ tag: "simulasi", narasi: sn, ms: out.withSimulasi.ms, words: out.withSimulasi.words, truncated: out.withSimulasi.truncated, md: out.withSimulasi.md });
  console.log(`  ${out.withSimulasi.ms}ms src=${out.withSimulasi.source} flagged=${out.withSimulasi.flagged} words=${out.withSimulasi.words} trunc=${out.withSimulasi.truncated} coordLeak=${out.withSimulasi.coordLeak} cites400=${out.withSimulasi.cites400} cites800=${out.withSimulasi.cites800}`);

  // ---- Aggregates ----
  const warmMs = out.warm.filter((w) => w.status === 200).map((w) => w.ms);
  const warmExcl1 = warmMs.slice(1);
  const coldMs = out.cold.filter((c) => c.status === 200).map((c) => c.ms);
  out.agg = {
    warmAll: stats(warmMs),
    warmExclFirst: stats(warmExcl1),
    cold: stats(coldMs),
    warmMedianUnder5s: stats(warmExcl1).median < 5000,
    warmP90Under5s: stats(warmExcl1).p90 < 5000,
    truncatedWarm: out.warm.filter((w) => w.truncated).length,
    truncatedTotal: out.narasiPool.filter((x) => x.truncated).length,
    narasiTotal: out.narasiPool.length,
    mdLeakCount: out.narasiPool.filter((x) => (x.md || []).length).length,
    wordStats: stats(out.narasiPool.map((x) => x.words).filter(Boolean)),
    overheadMs: out.earlyPath.median,
    dbMs: out.restDbQuery.median,
  };
  const llmEst = stats(warmExcl1).median - out.earlyPath.median - out.restDbQuery.median;
  out.agg.llmPlusValidationEstMs = llmEst;

  out.finished = new Date().toISOString();

  const fs = await import("node:fs");
  const p = new URL(import.meta.url).pathname.replace(/\/[^/]+$/, "") + "/ai-insight-latency-jalurA-result.json";
  fs.writeFileSync(process.platform === "win32" ? p.replace(/^\//, "") : p, JSON.stringify(out, null, 2));

  console.log("\n\n================ SUMMARY ================");
  console.log("REST DB query ms       :", JSON.stringify(out.restDbQuery));
  console.log("Early-400 overhead ms  :", JSON.stringify(out.earlyPath));
  console.log("COLD ms                :", JSON.stringify(out.agg.cold), out.cold.map((c) => c.ms));
  console.log("WARM all ms            :", JSON.stringify(out.agg.warmAll));
  console.log("WARM excl#1 ms         :", JSON.stringify(out.agg.warmExclFirst));
  console.log("warm median < 5000ms   :", out.agg.warmMedianUnder5s);
  console.log("warm p90 < 5000ms      :", out.agg.warmP90Under5s);
  console.log("word count stats       :", JSON.stringify(out.agg.wordStats));
  console.log("truncated (warm/total) :", out.agg.truncatedWarm, "/", out.agg.truncatedTotal, "of", out.agg.narasiTotal);
  console.log("markdown-leak narasi   :", out.agg.mdLeakCount, "of", out.agg.narasiTotal);
  console.log("bottleneck split       : overhead", out.agg.overheadMs, "+ db", out.agg.dbMs, "+ llm/val ~", out.agg.llmPlusValidationEstMs, "ms");
  console.log("kecamatan cases        :", JSON.stringify(out.kec.map((k) => ({ in: k.input, matched: k.matched, onlyExpected: k.onlyExpected }))));
  console.log("simulasi coordLeak     :", out.withSimulasi.coordLeak, "| cites400", out.withSimulasi.cites400, "| cites800", out.withSimulasi.cites800, "| flagged", out.withSimulasi.flagged);
  console.log("=======================================");
  console.log("Full JSON: qa/ai-insight-latency-jalurA-result.json");
}

main().catch((e) => { console.error(e); process.exit(1); });

// qa/ai-insight-latency.mjs
// Empirical latency + correctness pass for Edge Function `ai-insight`.
// Node >=18 (global fetch). No deps.
//
//   node qa/ai-insight-latency.mjs
//
// Measures: cold start vs warm, distribution over N calls, rough bottleneck
// split (invocation overhead via early-400 path vs direct REST DB query vs
// remainder = Claude call + validation).

const FN_URL = "https://vpymlmaebvfmpowomsec.supabase.co/functions/v1/ai-insight";
const REST_URL = "https://vpymlmaebvfmpowomsec.supabase.co/rest/v1/skor_equity";
const KEY = "sb_publishable_Km7tW_79bQ3zsOrdNgl2Ug_HBfsIDJ-";

const H = {
  Authorization: `Bearer ${KEY}`,
  apikey: KEY,
  "Content-Type": "application/json",
};

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const pct = (arr, p) => {
  const s = [...arr].sort((a, b) => a - b);
  const i = Math.ceil((p / 100) * s.length) - 1;
  return s[Math.max(0, Math.min(s.length - 1, i))];
};
const stats = (arr) => ({
  n: arr.length,
  min: +Math.min(...arr).toFixed(2),
  median: +pct(arr, 50).toFixed(2),
  p90: +pct(arr, 90).toFixed(2),
  max: +Math.max(...arr).toFixed(2),
  mean: +(arr.reduce((a, b) => a + b, 0) / arr.length).toFixed(2),
});

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
    "?select=skor_final,ranking,kelompok_terdampak,rekomendasi_intervensi,batas_administrasi!inner(nama_kelurahan,nama_kecamatan)" +
    "&sumber=ilike.REAL*&order=ranking.asc&limit=5";
  const t0 = performance.now();
  const res = await fetch(REST_URL + q, { headers: H });
  const text = await res.text();
  const ms = performance.now() - t0;
  let json = null;
  try { json = JSON.parse(text); } catch { /* */ }
  return { ms, status: res.status, json, text };
}

const PRD_QUERY = "Di mana titik prioritas halte baru di Kecamatan Mustika Jaya?";

const QUERIES = [
  { label: "prd-mustika-jaya", body: { query: PRD_QUERY, area_filter: "Mustika Jaya" } },
  { label: "kota-umum", body: { query: "Kelurahan mana yang paling tertinggal akses transitnya di Kota Bekasi?" } },
  { label: "kelompok-terdampak", body: { query: "Siapa kelompok warga yang paling dirugikan dan mengapa?" } },
  { label: "pancing-proyeksi", body: { query: "Berapa persen penduduk yang belum terlayani dan berapa ribu jiwa tambahan kalau dibangun 3 halte baru? Sebutkan angkanya." } },
  { label: "pancing-simulasi-tanpa-data", body: { query: "Proyeksikan berapa jiwa tambahan terlayani jika halte baru dibangun di titik prioritas. Beri angka konkret." } },
];

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

async function main() {
  const out = { started: new Date().toISOString() };

  // ---- 0. REST DB query timing (5x) ----
  console.log("\n=== REST DB query (skor_equity top-5 REAL) ===");
  const restTimes = [];
  let restSample = null;
  for (let i = 0; i < 5; i++) {
    const r = await callRest();
    restTimes.push(r.ms);
    if (i === 0) restSample = r.json;
    console.log(`  rest#${i + 1}: ${r.ms.toFixed(0)}ms status=${r.status} rows=${Array.isArray(r.json) ? r.json.length : "?"}`);
    await sleep(300);
  }
  out.restDbQuery = { stats: stats(restTimes), sampleRows: restSample };

  // ---- 1. Cold start probe: wait, then fire ----
  console.log("\n=== Cold-start probe (idle 90s then 1 call) ===");
  console.log("  sleeping 90s to let function scale down...");
  await sleep(90_000);
  const cold = await callFn(QUERIES[0].body);
  console.log(`  COLD call: ${cold.ms.toFixed(0)}ms status=${cold.status} source=${cold.json?.narasi_source} flagged=${cold.json?.narasi_flagged}`);
  out.coldStart = { ms: +cold.ms.toFixed(2), status: cold.status, source: cold.json?.narasi_source, flagged: cold.json?.narasi_flagged };

  // ---- 2. Warm burst: 10 sequential calls, same query ----
  console.log("\n=== Warm burst (10 sequential, prd-mustika-jaya) ===");
  const warm = [];
  for (let i = 0; i < 10; i++) {
    const r = await callFn(QUERIES[0].body);
    warm.push({ ms: +r.ms.toFixed(2), status: r.status, source: r.json?.narasi_source, flagged: r.json?.narasi_flagged });
    console.log(`  warm#${i + 1}: ${r.ms.toFixed(0)}ms status=${r.status} source=${r.json?.narasi_source} flagged=${r.json?.narasi_flagged} reason=${r.json?.flagged_reason ?? "-"}`);
    await sleep(1500);
  }
  out.warmBurst = { calls: warm, statsAll: stats(warm.map((w) => w.ms)), statsExclFirst: stats(warm.slice(1).map((w) => w.ms)) };

  // ---- 3. Early-400 path timing (invocation overhead, no DB / no Claude) ----
  console.log("\n=== Early-400 path (empty body -> invocation overhead) ===");
  const early = [];
  for (let i = 0; i < 6; i++) {
    const r = await callFn({});
    early.push(r.ms);
    console.log(`  early#${i + 1}: ${r.ms.toFixed(0)}ms status=${r.status}`);
    await sleep(800);
  }
  out.earlyPath = { stats: stats(early) };

  // ---- 4. Distinct queries for anti-hallucination + CCIA review ----
  console.log("\n=== Distinct queries (anti-hallucination / CCIA) ===");
  out.queries = [];
  for (const q of QUERIES) {
    const r = await callFn(q.body);
    console.log(`\n  --- ${q.label} (${r.ms.toFixed(0)}ms status=${r.status}) ---`);
    console.log(`  source=${r.json?.narasi_source} flagged=${r.json?.narasi_flagged} reason=${r.json?.flagged_reason ?? "-"}`);
    console.log(`  area_filter=${JSON.stringify(r.json?.area_filter)}`);
    console.log(`  NARASI: ${r.json?.narasi}`);
    out.queries.push({
      label: q.label, ms: +r.ms.toFixed(2), status: r.status,
      narasi: r.json?.narasi, narasi_source: r.json?.narasi_source,
      narasi_flagged: r.json?.narasi_flagged, flagged_reason: r.json?.flagged_reason,
      area_filter: r.json?.area_filter, ranking: r.json?.ranking,
      simulasi_dipakai: r.json?.simulasi_dipakai,
    });
    await sleep(1500);
  }

  // ---- 5. With simulasi payload (SMART / +N jiwa citation) ----
  console.log("\n=== With simulasi_what_if payload ===");
  const sim = await callFn(SIM_PAYLOAD);
  console.log(`  ${sim.ms.toFixed(0)}ms status=${sim.status} source=${sim.json?.narasi_source} flagged=${sim.json?.narasi_flagged} reason=${sim.json?.flagged_reason ?? "-"}`);
  console.log(`  simulasi_dipakai=${JSON.stringify(sim.json?.simulasi_dipakai)}`);
  console.log(`  NARASI: ${sim.json?.narasi}`);
  out.withSimulasi = {
    ms: +sim.ms.toFixed(2), status: sim.status, narasi: sim.json?.narasi,
    narasi_source: sim.json?.narasi_source, narasi_flagged: sim.json?.narasi_flagged,
    flagged_reason: sim.json?.flagged_reason, simulasi_dipakai: sim.json?.simulasi_dipakai,
  };

  // ---- 6. Regression: malformed body -> 400, invalid -> template? ----
  console.log("\n=== Regression: error handling ===");
  const malformed = await callFn("not-json"); // note: callFn JSON.stringifies -> becomes "\"not-json\"" valid json string
  const rawMalformed = await (async () => {
    const t0 = performance.now();
    const res = await fetch(FN_URL, { method: "POST", headers: H, body: "not-json-at-all{" });
    const text = await res.text();
    return { ms: performance.now() - t0, status: res.status, text };
  })();
  console.log(`  malformed-raw: ${rawMalformed.ms.toFixed(0)}ms status=${rawMalformed.status} body=${rawMalformed.text}`);
  const noQuery = await callFn({ area_filter: "Mustika Jaya" });
  console.log(`  missing-query: ${noQuery.ms.toFixed(0)}ms status=${noQuery.status} body=${JSON.stringify(noQuery.json)}`);
  out.regression = {
    malformedRaw: { status: rawMalformed.status, body: rawMalformed.text },
    missingQuery: { status: noQuery.status, body: noQuery.json },
  };

  out.finished = new Date().toISOString();

  const fs = await import("node:fs");
  const p = new URL(import.meta.url).pathname.replace(/\/[^/]+$/, "") + "/ai-insight-latency-result.json";
  fs.writeFileSync(process.platform === "win32" ? p.replace(/^\//, "") : p, JSON.stringify(out, null, 2));

  console.log("\n\n================ SUMMARY ================");
  console.log("REST DB query:", JSON.stringify(out.restDbQuery.stats));
  console.log("Early-400 path (overhead):", JSON.stringify(out.earlyPath.stats));
  console.log("COLD start:", out.coldStart.ms, "ms");
  console.log("Warm burst (all 10):", JSON.stringify(out.warmBurst.statsAll));
  console.log("Warm burst (excl #1):", JSON.stringify(out.warmBurst.statsExclFirst));
  console.log("=======================================");
  console.log("Full result JSON written next to this script.");
}

main().catch((e) => { console.error(e); process.exit(1); });

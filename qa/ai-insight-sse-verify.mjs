// qa/ai-insight-sse-verify.mjs
// End-to-end verification of Edge Function `ai-insight` AFTER the SSE-streaming rewrite.
// Measures time-to-first-delta (TTFD) + total stream duration, checks SSE contract
// fields on `done`/`error`, truncation / stop_reason, CCIA presence, area_filter
// matching, anti-hallucination (flagged) behaviour, and captures every narasi for
// manual number tracing.
//
//   node qa/ai-insight-sse-verify.mjs
//
// Node >=18 (global fetch). No deps. Writes qa/ai-insight-sse-verify-result.json

const FN_URL = "https://vpymlmaebvfmpowomsec.supabase.co/functions/v1/ai-insight";
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
const looksTruncated = (t) => {
  if (typeof t !== "string" || !t.trim()) return true;
  return !/[.!?][")"»]?\s*$/.test(t.trim().slice(-3));
};
const MD_PATTERNS = [
  ["bold **", /\*\*/],
  ["hr ---", /(^|\n)\s*-{3,}\s*(\n|$)/],
  ["heading #", /(^|\n)#{1,6}\s/],
  ["bullet", /(^|\n)\s*[-*]\s+\S/],
  ["numbered", /(^|\n)\s*\d+\.\s+\S/],
  ["CCIA label", /\b(Condition|Cause|Impact|Action|Kondisi|Penyebab|Dampak|Aksi)\s*:/],
];
const mdLeaks = (t) => MD_PATTERNS.filter(([, re]) => re.test(t || "")).map(([n]) => n);
const cciaHits = (t) => {
  const s = (t || "").toLowerCase();
  return {
    condition: /skor ketimpangan|peringkat|ranking|akses transit|aksesibilitas/.test(s),
    cause: /composite accessibility|inverse|kerentanan sosial|ahp/.test(s),
    impact: /tanpa intervensi|tanpa tindakan|dampak|kesenjangan|melebar|mobilitas/.test(s),
    action: /rekomendasi|bangun|feeder|pengumpan|halte|koridor|trayek/.test(s),
  };
};

// --- SSE client: returns per-call timing + parsed events ---
async function callSSE(body, { maxTime = 45000 } = {}) {
  const t0 = performance.now();
  const ctrl = new AbortController();
  const to = setTimeout(() => ctrl.abort(), maxTime);
  let res;
  try {
    res = await fetch(FN_URL, {
      method: "POST",
      headers: H,
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
  } catch (e) {
    clearTimeout(to);
    return { error: String(e), ms: performance.now() - t0 };
  }
  const ct = res.headers.get("content-type") || "";
  // Non-SSE (error path) -> plain JSON
  if (!ct.includes("text/event-stream")) {
    const text = await res.text();
    clearTimeout(to);
    let json = null;
    try { json = JSON.parse(text); } catch { /* keep text */ }
    return { ms: performance.now() - t0, status: res.status, contentType: ct, json, text, sse: false };
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  const deltas = [];
  let ttfd = null;
  let doneEvt = null;
  let errorEvt = null;
  let deltaCount = 0;

  const handleBlock = (rawBlock) => {
    const block = rawBlock.replace(/\r/g, "");
    if (!block.trim()) return;
    let eventName = "message";
    const dataLines = [];
    for (const line of block.split("\n")) {
      if (line.startsWith("event:")) eventName = line.slice(6).trim();
      else if (line.startsWith("data:")) dataLines.push(line.slice(5).replace(/^ /, ""));
    }
    if (!dataLines.length) return;
    let payload;
    try { payload = JSON.parse(dataLines.join("\n")); } catch { return; }
    if (eventName === "delta") {
      if (ttfd === null) ttfd = performance.now() - t0;
      deltaCount++;
      if (typeof payload.text === "string") deltas.push(payload.text);
    } else if (eventName === "done") doneEvt = payload;
    else if (eventName === "error") errorEvt = payload;
  };

  while (true) {
    let chunk;
    try {
      chunk = await reader.read();
    } catch (e) {
      errorEvt = errorEvt || { error: "stream read aborted: " + String(e) };
      break;
    }
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    let sep;
    while ((sep = buffer.indexOf("\n\n")) !== -1) {
      handleBlock(buffer.slice(0, sep));
      buffer = buffer.slice(sep + 2);
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) handleBlock(buffer);
  clearTimeout(to);

  const total = performance.now() - t0;
  const concat = deltas.join("");
  return {
    ms: total,
    ttfd,
    totalStream: total,
    status: res.status,
    contentType: ct,
    sse: true,
    deltaCount,
    concat,
    done: doneEvt,
    error: errorEvt,
    concatMatchesNarasi:
      doneEvt && typeof doneEvt.narasi === "string"
        ? doneEvt.narasi.trim() === concat.trim()
        : null,
  };
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

const CONTENT_QUERIES = [
  { tag: "kota-umum", body: { query: "Kelurahan mana yang paling tertinggal akses transitnya di Kota Bekasi?" } },
  { tag: "prd-mustikajaya", body: WARM_BODY },
  { tag: "bekasi-timur", body: { query: "Prioritas halte baru di Bekasi Timur?", area_filter: "Bekasi Timur" } },
  { tag: "rawalumbu", body: { query: "Bagaimana kondisi ketimpangan transit di Rawa Lumbu?", area_filter: "Rawa Lumbu" } },
  { tag: "with-simulasi", body: SIM_PAYLOAD },
];

const PANCINGAN = [
  { tag: "pancing-persen", body: { query: "Berapa persen penduduk Cimuning yang tidak terlayani transit? Sebutkan angka persisnya." } },
  { tag: "pancing-proyeksi", body: { query: "Kalau bangun 3 halte di Mustika Jaya, berapa ribu jiwa tambahan yang terlayani? Beri proyeksi angkanya." } },
];

const N_COLD = 3;
const COLD_IDLE_MS = 70_000;
const N_WARM = 12;

async function main() {
  const out = { started: new Date().toISOString(), cold: [], warm: [], content: [], pancingan: [], contract: {} };

  // ---------- CONTRACT: non-200 empty query ----------
  console.log("=== Contract: empty query -> expect HTTP 400 JSON ===");
  {
    const r = await callSSE({ query: "" });
    out.contract.emptyQuery = {
      status: r.status, sse: r.sse, contentType: r.contentType,
      body: r.json ?? r.text,
      pass: r.status === 400 && r.sse === false && r.json && typeof r.json.error === "string",
    };
    console.log("  ", JSON.stringify(out.contract.emptyQuery));
  }
  await sleep(800);

  // ---------- CONTRACT: bad JSON body ----------
  console.log("=== Contract: malformed JSON body -> expect HTTP 400 JSON ===");
  {
    const t0 = performance.now();
    const res = await fetch(FN_URL, { method: "POST", headers: H, body: "{not json" });
    const text = await res.text();
    let json = null; try { json = JSON.parse(text); } catch { /* */ }
    out.contract.badBody = {
      status: res.status, ms: +(performance.now() - t0).toFixed(0),
      isJson: !!json, body: json ?? text.slice(0, 200),
      pass: res.status === 400 && !!json && typeof json.error === "string",
    };
    console.log("  ", JSON.stringify(out.contract.badBody));
  }
  await sleep(800);

  // ---------- CONTRACT: unknown kecamatan -> matched:false ----------
  console.log("=== Contract: unknown area_filter 'Kecamatan Ngawi' -> matched:false ===");
  {
    const r = await callSSE({ query: "Prioritas halte di Kecamatan Ngawi?", area_filter: "Kecamatan Ngawi" });
    const af = r.done?.area_filter || {};
    out.contract.unknownArea = {
      status: r.status, sse: r.sse, ttfd: r.ttfd && +r.ttfd.toFixed(0), total: +r.ms.toFixed(0),
      area_filter: af, narasi_source: r.done?.narasi_source,
      pass: r.sse === true && af.matched === false && af.requested === "Kecamatan Ngawi" && typeof af.note === "string",
    };
    console.log("  ", JSON.stringify(out.contract.unknownArea));
  }
  await sleep(1000);

  // ---------- CONTRACT: full done-payload field presence ----------
  console.log("=== Contract: done payload field presence (PRD query) ===");
  {
    const r = await callSSE(WARM_BODY);
    const d = r.done || {};
    const required = ["narasi", "narasi_source", "narasi_flagged", "flagged_reason",
      "narasi_note", "stop_reason", "ranking", "area_filter", "simulasi_dipakai"];
    const missing = required.filter((k) => !(k in d));
    const afKeys = ["requested", "applied", "matched", "note"];
    const afMissing = afKeys.filter((k) => !(k in (d.area_filter || {})));
    out.contract.donePayload = {
      status: r.status, deltaCount: r.deltaCount,
      concatMatchesNarasi: r.concatMatchesNarasi,
      missingFields: missing, areaFilterMissing: afMissing,
      stop_reason: d.stop_reason, narasi_source: d.narasi_source,
      rankingLen: (d.ranking || []).length,
      pass: missing.length === 0 && afMissing.length === 0 && r.concatMatchesNarasi === true,
    };
    console.log("  ", JSON.stringify(out.contract.donePayload));
  }
  await sleep(1000);

  // ---------- COLD probes ----------
  for (let i = 0; i < N_COLD; i++) {
    console.log(`\n=== COLD ${i + 1}/${N_COLD}: idle ${COLD_IDLE_MS / 1000}s then 1 call ===`);
    await sleep(COLD_IDLE_MS);
    const r = await callSSE(WARM_BODY);
    const d = r.done || {};
    const rec = {
      ttfd: r.ttfd != null ? +r.ttfd.toFixed(0) : null,
      total: +r.ms.toFixed(0), status: r.status, deltaCount: r.deltaCount,
      source: d.narasi_source, stop_reason: d.stop_reason, flagged: d.narasi_flagged,
      words: wc(d.narasi), truncated: looksTruncated(d.narasi), md: mdLeaks(d.narasi),
      matched: d.area_filter?.matched, concatOk: r.concatMatchesNarasi,
    };
    out.cold.push(rec);
    out.content.push({ tag: `cold#${i + 1}`, narasi: d.narasi, done: d, ttfd: rec.ttfd, total: rec.total });
    console.log("  ", JSON.stringify(rec));
  }

  // ---------- WARM burst ----------
  console.log(`\n=== WARM burst x${N_WARM} (PRD query, 1.2s spacing) ===`);
  for (let i = 0; i < N_WARM; i++) {
    const r = await callSSE(WARM_BODY);
    const d = r.done || {};
    const rec = {
      ttfd: r.ttfd != null ? +r.ttfd.toFixed(0) : null,
      total: +r.ms.toFixed(0), status: r.status, deltaCount: r.deltaCount,
      source: d.narasi_source, stop_reason: d.stop_reason, flagged: d.narasi_flagged,
      flagged_reason: d.flagged_reason,
      words: wc(d.narasi), truncated: looksTruncated(d.narasi), md: mdLeaks(d.narasi),
      matched: d.area_filter?.matched, concatOk: r.concatMatchesNarasi,
      kecInRanking: [...new Set((d.ranking || []).map((x) => x.kecamatan))],
    };
    out.warm.push(rec);
    out.content.push({ tag: `warm#${i + 1}`, narasi: d.narasi, done: d, ttfd: rec.ttfd, total: rec.total });
    console.log("  ", JSON.stringify(rec));
    await sleep(1200);
  }

  // ---------- CONTENT queries (distinct) ----------
  console.log(`\n=== CONTENT queries (${CONTENT_QUERIES.length}) ===`);
  for (const c of CONTENT_QUERIES) {
    const r = await callSSE(c.body);
    const d = r.done || {};
    const ccia = cciaHits(d.narasi);
    const rec = {
      tag: c.tag, ttfd: r.ttfd != null ? +r.ttfd.toFixed(0) : null, total: +r.ms.toFixed(0),
      status: r.status, source: d.narasi_source, stop_reason: d.stop_reason,
      flagged: d.narasi_flagged, flagged_reason: d.flagged_reason,
      words: wc(d.narasi), truncated: looksTruncated(d.narasi), md: mdLeaks(d.narasi),
      ccia, cciaAll: Object.values(ccia).every(Boolean),
      area_filter: d.area_filter, simulasi_dipakai: d.simulasi_dipakai,
      kecInRanking: [...new Set((d.ranking || []).map((x) => x.kecamatan))],
      coordLeak: /-6[.,]29|106[.,]99|lintang|bujur|koordinat|latitude|longitude/i.test(d.narasi || ""),
      cites400: /4[.\s]?821/.test(d.narasi || ""),
      cites800: /15[.\s]?230/.test(d.narasi || ""),
      concatOk: r.concatMatchesNarasi,
    };
    out.content.push({ tag: c.tag, narasi: d.narasi, done: d, ...rec });
    out.pancinganBaseRanking = out.pancinganBaseRanking || d.ranking;
    console.log("  ", JSON.stringify(rec));
    await sleep(1200);
  }

  // ---------- PANCINGAN (bait) queries ----------
  console.log(`\n=== PANCINGAN queries (${PANCINGAN.length}) — expect refusal or narasi_flagged ===`);
  for (const c of PANCINGAN) {
    const r = await callSSE(c.body);
    const d = r.done || {};
    const rec = {
      tag: c.tag, ttfd: r.ttfd != null ? +r.ttfd.toFixed(0) : null, total: +r.ms.toFixed(0),
      status: r.status, source: d.narasi_source, flagged: d.narasi_flagged,
      flagged_reason: d.flagged_reason,
      hasPercent: /%|persen/i.test(d.narasi || ""),
      numberTokens: (d.narasi || "").match(/\d+[.,]\d+/g) || [],
      words: wc(d.narasi), truncated: looksTruncated(d.narasi),
    };
    out.pancingan.push({ ...rec, narasi: d.narasi, done: d });
    console.log("  ", JSON.stringify(rec));
    await sleep(1200);
  }

  // ---------- Aggregates ----------
  const warm200 = out.warm.filter((w) => w.status === 200);
  const warmTtfd = warm200.map((w) => w.ttfd).filter((x) => x != null);
  const warmTotal = warm200.map((w) => w.total);
  const warmExcl1Ttfd = warmTtfd.slice(1);
  const warmExcl1Total = warmTotal.slice(1);
  const coldTtfd = out.cold.map((c) => c.ttfd).filter((x) => x != null);
  const coldTotal = out.cold.map((c) => c.total);

  out.agg = {
    warmTTFD_all: stats(warmTtfd),
    warmTTFD_exclFirst: stats(warmExcl1Ttfd),
    warmTotal_all: stats(warmTotal),
    warmTotal_exclFirst: stats(warmExcl1Total),
    coldTTFD: stats(coldTtfd),
    coldTotal: stats(coldTotal),
    warmTTFD_median_under5s: stats(warmExcl1Ttfd).median < 5000,
    warmTTFD_p90_under5s: stats(warmExcl1Ttfd).p90 < 5000,
    coldTTFD_median_under5s: stats(coldTtfd).median < 5000,
    truncatedCount: out.content.filter((x) => x.truncated).length,
    contentTotal: out.content.length,
    mdLeakCount: out.content.filter((x) => (x.md || []).length).length,
    stopReasons: [...new Set(out.content.map((x) => x.done?.stop_reason))],
    nonEndTurn: out.content.filter((x) => x.done && x.done.stop_reason && x.done.stop_reason !== "end_turn").map((x) => x.tag),
    concatMismatch: out.content.filter((x) => x.concatOk === false).map((x) => x.tag),
    flaggedTags: out.content.filter((x) => x.done?.narasi_flagged).map((x) => x.tag),
    wordStats: stats(out.content.map((x) => wc(x.narasi)).filter(Boolean)),
  };

  out.finished = new Date().toISOString();
  const fs = await import("node:fs");
  const path = new URL(import.meta.url).pathname.replace(/\/[^/]+$/, "") + "/ai-insight-sse-verify-result.json";
  fs.writeFileSync(process.platform === "win32" ? path.replace(/^\//, "") : path, JSON.stringify(out, null, 2));

  console.log("\n\n================ SUMMARY ================");
  console.log("WARM TTFD all      :", JSON.stringify(out.agg.warmTTFD_all));
  console.log("WARM TTFD excl#1   :", JSON.stringify(out.agg.warmTTFD_exclFirst));
  console.log("WARM total all     :", JSON.stringify(out.agg.warmTotal_all));
  console.log("WARM total excl#1  :", JSON.stringify(out.agg.warmTotal_exclFirst));
  console.log("COLD TTFD          :", JSON.stringify(out.agg.coldTTFD), out.cold.map((c) => c.ttfd));
  console.log("COLD total         :", JSON.stringify(out.agg.coldTotal), out.cold.map((c) => c.total));
  console.log("warm TTFD median<5s:", out.agg.warmTTFD_median_under5s, "| p90<5s:", out.agg.warmTTFD_p90_under5s);
  console.log("cold TTFD median<5s:", out.agg.coldTTFD_median_under5s);
  console.log("stop_reasons       :", JSON.stringify(out.agg.stopReasons), "| non-end_turn:", JSON.stringify(out.agg.nonEndTurn));
  console.log("truncated          :", out.agg.truncatedCount, "/", out.agg.contentTotal);
  console.log("markdown leaks     :", out.agg.mdLeakCount, "/", out.agg.contentTotal);
  console.log("concat!=narasi     :", JSON.stringify(out.agg.concatMismatch));
  console.log("flagged tags       :", JSON.stringify(out.agg.flaggedTags));
  console.log("word stats         :", JSON.stringify(out.agg.wordStats));
  console.log("contract.emptyQuery:", out.contract.emptyQuery.pass);
  console.log("contract.badBody   :", out.contract.badBody.pass);
  console.log("contract.unknownAr :", out.contract.unknownArea.pass);
  console.log("contract.donePayld :", out.contract.donePayload.pass);
  console.log("pancingan flagged/refusal:",
    JSON.stringify(out.pancingan.map((p) => ({ tag: p.tag, flagged: p.flagged, hasPercent: p.hasPercent, tokens: p.numberTokens }))));
  console.log("Full JSON: qa/ai-insight-sse-verify-result.json");
}

main().catch((e) => { console.error(e); process.exit(1); });

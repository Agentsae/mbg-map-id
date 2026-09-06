// supabase/functions/test-batch/index.ts
// GeoTransit Insight — Tim MBG
//
// ⚠️ INI ADALAH EKSPERIMEN/PoC, BUKAN FITUR PRODUKSI. ⚠️
// Tujuan: menguji teknis Anthropic **Message Batches API** (bukan Messages API biasa
// yang dipakai `ai-insight`) sebagai kandidat arsitektur pre-generate narasi AI untuk
// konten yang TIDAK butuh real-time — mis. "Top 3 Rekomendasi AI" di dashboard dan
// "rekomendasi intervensi" per kelurahan di Transit Equity Index Dashboard. Batch API
// resmi 50% lebih murah dibanding Messages API, tapi async (tidak instan) — makanya
// TIDAK COCOK untuk endpoint AI Spatial Consultant interaktif (`ai-insight`, acceptance
// criteria PRD < 5 detik). Jangan wire function ini ke frontend, dan jangan anggap ini
// pengganti arsitektur pre-generate+cache yang sesungguhnya (itu keputusan desain
// terpisah: butuh tabel cache, cron/worker polling, dsb — belum dibangun di sini).
//
// Dua aksi via body JSON `{ "action": "create" | "status", ... }`:
//   - action=create : ambil 1-3 baris skor_equity (REAL kalau ada, dummy kalau tidak),
//                     susun request narasi singkat per kelurahan, POST ke
//                     /v1/messages/batches, kembalikan { batch_id, created_at, ... }
//                     dari response Anthropic apa adanya (bukan menyimpan state lokal).
//   - action=status : GET /v1/messages/batches/{batch_id}. Kalau processing_status
//                     belum "ended", kembalikan status apa adanya (client polling ulang
//                     nanti). Kalau sudah "ended", fetch `results_url`, parse JSONL,
//                     kembalikan narasi tiap request + created_at/ended_at asli dari
//                     Anthropic (dipakai utk hitung durasi submit->selesai, TANPA perlu
//                     state lokal — timestamp datang dari Anthropic sendiri).
//
// Model: claude-haiku-4-5-20251001 — SAMA dengan `ai-insight`, konsisten dengan
// keputusan proyek (lihat CLAUDE.md). Jangan diganti kecuali test ini gagal karena
// alasan spesifik model (kalau begitu, catat alasannya di laporan, jangan diam-diam
// diganti di kode).
//
// PRINSIP AI DUA LAPISAN (CLAUDE.md) tetap berlaku di sini: prompt HANYA meminta Claude
// MENJELASKAN skor yang sudah ada di kolom skor_final/rekomendasi_intervensi, bukan
// menghitung/menentukan skor baru — walau ini cuma PoC teknis, bukan alasan melonggarkan
// prinsip itu.
//
// Deploy: npx supabase functions deploy test-batch --project-ref=vpymlmaebvfmpowomsec
// Secret dipakai: ANTHROPIC_API_KEY, SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY (semua
// sudah ada di project ini, dipakai bersama ai-insight — tidak perlu secret baru).

import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

const MODEL = "claude-haiku-4-5-20251001";
const ANTHROPIC_VERSION = "2023-06-01";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// deno-lint-ignore no-explicit-any
function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// System prompt ringkas — sengaja lebih pendek dari `ai-insight` (PoC ini hanya
// menguji mekanisme Batch API + kewarasan narasi, bukan mereplikasi kerangka CCIA
// penuh). Prinsip anti-halusinasi tetap sama: Claude hanya boleh mengutip angka yang
// diberikan, tidak boleh menghitung/menambah skor sendiri.
const SYSTEM_PROMPT = `Kamu adalah AI Spatial Consultant untuk Dishub & Bappeda Kota Bekasi.
Tugasmu MENJELASKAN skor yang sudah dihitung model spasial deterministik (bukan menghitung
atau menebak skor sendiri). Tulis narasi singkat 2-4 kalimat, Bahasa Indonesia, untuk pembaca
pejabat non-teknis, tentang satu kelurahan: sebutkan skor ketimpangan aksesnya (angka desimal,
pemisah koma, makin tinggi = makin tertinggal/dirugikan secara akses transit — BUKAN makin
adil), lalu jelaskan rekomendasi intervensi yang diberikan (kutip apa adanya, jangan mengarang
angka penerima manfaat baru). Kalau kelompok_terdampak atau rekomendasi_intervensi kosong,
nyatakan eksplisit bahwa detailnya belum tersedia — jangan mengarang.`;

// Ambil 1-3 baris contoh dari skor_equity (REAL dulu, fallback dummy) — sama seperti
// pola fallback bertingkat di ai-insight/index.ts, disederhanakan karena ini cuma PoC.
async function ambilContohKelurahan(limit = 3) {
  const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

  let { data, error } = await supabase
    .from("skor_equity")
    .select(
      "skor_final, ranking, kelompok_terdampak, rekomendasi_intervensi, batas_administrasi(nama_kelurahan, nama_kecamatan)"
    )
    .ilike("sumber", "REAL%")
    .order("ranking", { ascending: true })
    .limit(limit);
  if (error) throw error;

  let sumberLabel = "REAL";
  if (!data || data.length === 0) {
    const dummy = await supabase
      .from("skor_equity")
      .select(
        "skor_final, ranking, kelompok_terdampak, rekomendasi_intervensi, batas_administrasi(nama_kelurahan, nama_kecamatan)"
      )
      .order("ranking", { ascending: true })
      .limit(limit);
    if (dummy.error) throw dummy.error;
    data = dummy.data;
    sumberLabel = "DUMMY (tabel skor_equity belum ada baris REAL saat test ini dijalankan)";
  }

  // Kalau tabel benar-benar kosong total, pakai 2 baris dummy hardcode HANYA untuk
  // memastikan tes teknis Batch API tetap bisa jalan (bukan data asli Kota Bekasi —
  // ditandai eksplisit di sumberLabel supaya laporan tidak salah kutip ini sbg data riil).
  if (!data || data.length === 0) {
    sumberLabel = "DUMMY HARDCODE (tabel skor_equity kosong total)";
    data = [
      {
        skor_final: 0.71,
        ranking: 1,
        kelompok_terdampak: "lansia, difabel",
        rekomendasi_intervensi: "Tambah 1 unit feeder BisKita radius 500m dari simpul permukiman padat.",
        batas_administrasi: { nama_kelurahan: "(contoh dummy)", nama_kecamatan: "(contoh dummy)" },
      },
    ] as unknown as typeof data;
  }

  // deno-lint-ignore no-explicit-any
  const cleaned = (data as any[]).map((r) => ({
    kelurahan: r.batas_administrasi?.nama_kelurahan ?? "(tanpa nama)",
    kecamatan: r.batas_administrasi?.nama_kecamatan ?? null,
    skor_ketimpangan: r.skor_final,
    ranking: r.ranking,
    kelompok_terdampak: r.kelompok_terdampak,
    rekomendasi_intervensi: r.rekomendasi_intervensi,
  }));
  return [cleaned, sumberLabel] as const;
}

// deno-lint-ignore no-explicit-any
async function handleCreate(): Promise<Response> {
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse(
      { error: "ANTHROPIC_API_KEY belum diset di Supabase secrets — tidak bisa test Batch API." },
      500
    );
  }

  const [rows, sumberLabel] = await ambilContohKelurahan(3);

  // deno-lint-ignore no-explicit-any
  const requests = (rows as any[]).map((r, i) => ({
    custom_id: `test-batch-req-${i + 1}`,
    params: {
      model: MODEL,
      max_tokens: 300,
      system: SYSTEM_PROMPT,
      messages: [
        {
          role: "user",
          content:
            `Data kelurahan (JSON, sudah dihitung model spasial, jangan dihitung ulang):\n` +
            `${JSON.stringify(r, null, 2)}`,
        },
      ],
    },
  }));

  const createRes = await fetch("https://api.anthropic.com/v1/messages/batches", {
    method: "POST",
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
      "content-type": "application/json",
    },
    body: JSON.stringify({ requests }),
  });

  const bodyText = await createRes.text();
  if (!createRes.ok) {
    // Balas apa adanya (termasuk pesan error persis dari Anthropic, mis. "credit
    // balance too low") — JANGAN mencoba workaround apa pun di sini, cukup laporkan.
    return jsonResponse(
      {
        ok: false,
        stage: "create",
        http_status: createRes.status,
        anthropic_error_body: bodyText,
      },
      502
    );
  }

  let batch: unknown;
  try {
    batch = JSON.parse(bodyText);
  } catch {
    return jsonResponse(
      { ok: false, stage: "create", error: "Respons create bukan JSON valid", raw: bodyText },
      502
    );
  }

  return jsonResponse({
    ok: true,
    stage: "create",
    sumber_data_kelurahan: sumberLabel,
    jumlah_request_dalam_batch: requests.length,
    batch, // apa adanya dari Anthropic: id, processing_status, created_at, request_counts, dst
    catatan: "Panggil ulang function ini dengan { action: 'status', batch_id: batch.id } untuk polling.",
  });
}

async function handleStatus(batchId: string): Promise<Response> {
  if (!ANTHROPIC_API_KEY) {
    return jsonResponse(
      { error: "ANTHROPIC_API_KEY belum diset di Supabase secrets." },
      500
    );
  }
  if (!batchId) {
    return jsonResponse({ error: "Field 'batch_id' wajib diisi untuk action=status" }, 400);
  }

  const statusRes = await fetch(`https://api.anthropic.com/v1/messages/batches/${batchId}`, {
    headers: {
      "x-api-key": ANTHROPIC_API_KEY,
      "anthropic-version": ANTHROPIC_VERSION,
    },
  });

  const statusText = await statusRes.text();
  if (!statusRes.ok) {
    return jsonResponse(
      { ok: false, stage: "status", http_status: statusRes.status, anthropic_error_body: statusText },
      502
    );
  }

  // deno-lint-ignore no-explicit-any
  let batch: any;
  try {
    batch = JSON.parse(statusText);
  } catch {
    return jsonResponse(
      { ok: false, stage: "status", error: "Respons status bukan JSON valid", raw: statusText },
      502
    );
  }

  if (batch.processing_status !== "ended") {
    return jsonResponse({
      ok: true,
      stage: "status",
      done: false,
      batch, // termasuk created_at & request_counts (in_progress/succeeded/dst) apa adanya
    });
  }

  // Sudah "ended" — ambil hasil dari results_url (JSONL, satu baris per request).
  let narasiList: unknown[] = [];
  if (batch.results_url) {
    const resultsRes = await fetch(batch.results_url, {
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": ANTHROPIC_VERSION,
      },
    });
    const resultsText = await resultsRes.text();
    narasiList = resultsText
      .split("\n")
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
      .map((line) => {
        try {
          const parsed = JSON.parse(line);
          const type = parsed?.result?.type;
          const textBlock =
            type === "succeeded"
              ? parsed.result.message?.content?.find((b: { type: string }) => b.type === "text")
                  ?.text
              : null;
          return {
            custom_id: parsed.custom_id,
            result_type: type,
            narasi: textBlock ?? null,
            error: type !== "succeeded" ? parsed.result : undefined,
          };
        } catch {
          return { parse_error: true, raw_line: line };
        }
      });
  }

  const submitted = batch.created_at ? new Date(batch.created_at).getTime() : null;
  const ended = batch.ended_at ? new Date(batch.ended_at).getTime() : null;
  const durasi_detik = submitted && ended ? Math.round((ended - submitted) / 1000) : null;

  return jsonResponse({
    ok: true,
    stage: "status",
    done: true,
    created_at: batch.created_at,
    ended_at: batch.ended_at,
    durasi_detik, // waktu dari submit sampai processing_status="ended", dari timestamp Anthropic asli
    request_counts: batch.request_counts,
    narasi_hasil: narasiList,
  });
}

Deno.serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // deno-lint-ignore no-explicit-any
  let body: any = {};
  try {
    if (req.method === "POST") body = await req.json();
  } catch {
    return jsonResponse({ error: "Body request bukan JSON yang valid" }, 400);
  }

  const action = body?.action ?? "create";

  try {
    if (action === "create") return await handleCreate();
    if (action === "status") return await handleStatus(body?.batch_id);
    return jsonResponse({ error: `action tidak dikenal: '${action}' (pakai 'create' atau 'status')` }, 400);
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[test-batch] error: ${msg}`);
    return jsonResponse({ ok: false, error: msg }, 500);
  }
});

// supabase/functions/ai-insight/index.ts
// GeoTransit Insight — Tim MBG
//
// Deploy: supabase functions deploy ai-insight
// Set secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
//
// Alur (lihat CLAUDE.md):
//   1. Terima { query, area_filter } dari frontend
//   2. Query skor_cai/skor_equity dari Supabase (skor sudah pasti, dihitung offline)
//   3. Kirim skor tsb ke Claude API, minta narasi
//   4. Validasi: angka di narasi harus cocok dengan angka input
//   5. Kembalikan { narasi, ranking } ke frontend

import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Model cepat & murah — cocok untuk tugas narasi ringkas dengan target
// acceptance criteria PRD "< 5 detik". Naikkan ke claude-sonnet-5 kalau
// butuh kualitas interpretasi yang lebih dalam (trade-off: lebih lambat).
const MODEL = "claude-haiku-4-5-20251001";

Deno.serve(async (req) => {
  try {
    const { query, area_filter } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "Field 'query' wajib diisi" }), { status: 400 });
    }
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY belum diset sebagai secret" }), { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // 1. Ambil skor yang sudah dihitung offline — Claude hanya boleh
    //    MENJELASKAN angka ini, tidak boleh menghitung/menebak sendiri.
    let queryBuilder = supabase
      .from("skor_equity")
      .select("skor_final, ranking, batas_administrasi(nama_kelurahan)")
      .order("ranking", { ascending: true })
      .limit(5);

    // TODO: terapkan area_filter kalau ada (mis. filter per kecamatan)

    const { data: skorRows, error } = await queryBuilder;
    if (error) throw error;

    if (!skorRows || skorRows.length === 0) {
      return new Response(
        JSON.stringify({
          narasi: "Data skor belum tersedia — jalankan pipeline compute_scores lalu upload ke Supabase terlebih dahulu.",
          ranking: [],
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    const promptData = skorRows.map((r: any) => ({
      kelurahan: r.batas_administrasi?.nama_kelurahan,
      skor_equity: r.skor_final,
      ranking: r.ranking,
    }));

    const systemPrompt = `Kamu adalah asisten analisis spasial untuk Dishub Kota Bekasi.
Jelaskan skor Transit Equity Index berikut dalam bahasa yang mudah dipahami
pejabat non-teknis, sertakan alasan berbasis angka yang diberikan.
JANGAN mengubah, membulatkan berlebihan, atau menambah angka apa pun di luar data ini.
Jawab dalam Bahasa Indonesia, maksimal 4 kalimat.`;

    // Claude Messages API — lihat https://docs.claude.com/en/api/messages
    const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "x-api-key": ANTHROPIC_API_KEY,
        "anthropic-version": "2023-06-01",
        "content-type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 512,
        system: systemPrompt,
        messages: [
          {
            role: "user",
            content:
              `Pertanyaan pengguna: ${query}\n\n` +
              `Data skor:\n${JSON.stringify(promptData, null, 2)}`,
          },
        ],
      }),
    });

    if (!claudeRes.ok) {
      const errText = await claudeRes.text();
      throw new Error(`Claude API error: ${claudeRes.status} ${errText}`);
    }

    const claudeJson = await claudeRes.json();
    // Messages API mengembalikan content sebagai array block, ambil block bertipe "text"
    const narasi =
      claudeJson.content?.find((b: any) => b.type === "text")?.text ?? "(tidak ada respons)";

    // 2. Validasi sederhana: pastikan tidak ada angka aneh yang tidak
    //    muncul di data asli (cek dasar, bukan jaminan penuh)
    const skorValues = promptData.map((d) => d.skor_equity.toString());
    const containsKnownScore = skorValues.some((v) => narasi.includes(v));
    if (!containsKnownScore) {
      console.warn("[ai-insight] Narasi tidak menyebut angka skor asli — perlu direview manual.");
    }

    return new Response(
      JSON.stringify({
        narasi,
        ranking: promptData.map((d) => ({ kelurahan: d.kelurahan, skor: d.skor_equity })),
      }),
      { headers: { "Content-Type": "application/json" } }
    );
  } catch (err) {
    console.error(err);
    // err bisa berupa Error biasa, atau object error mentah dari Supabase
    // (mis. PostgrestError) — String(err) pada object polos menghasilkan
    // "[object Object]" yang tidak berguna, jadi ambil .message kalau ada.
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    return new Response(JSON.stringify({ error: message }), { status: 500 });
  }
});

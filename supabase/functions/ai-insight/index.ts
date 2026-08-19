// supabase/functions/ai-insight/index.ts
// GeoTransit Insight — Tim MBG
//
// Deploy: supabase functions deploy ai-insight
// Set secret: supabase secrets set GEMINI_API_KEY=xxxxx
//
// Alur (lihat FRAMEWORK_GeoTransitInsight.md Bagian 6):
//   1. Terima { query, area_filter } dari frontend
//   2. Query skor_cai/skor_equity dari Supabase (skor sudah pasti, dihitung offline)
//   3. Kirim skor tsb ke Gemini API, minta narasi
//   4. Validasi: angka di narasi harus cocok dengan angka input
//   5. Kembalikan { narasi, ranking } ke frontend

import { createClient } from "npm:@supabase/supabase-js@2";

const GEMINI_API_KEY = Deno.env.get("GEMINI_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

Deno.serve(async (req) => {
  try {
    const { query, area_filter } = await req.json();

    if (!query) {
      return new Response(JSON.stringify({ error: "Field 'query' wajib diisi" }), { status: 400 });
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // 1. Ambil skor yang sudah dihitung offline — JANGAN pernah minta Gemini
    //    menghitung/menebak angka ini sendiri.
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
          narasi: "Data skor belum tersedia — jalankan etl/compute_scores.py dan upload_to_supabase.py terlebih dahulu.",
          ranking: [],
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // 2. Susun prompt terstruktur — Gemini hanya boleh MENJELASKAN angka ini,
    //    tidak boleh menambah/mengubahnya (lihat instruksi system prompt).
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

    const geminiRes = await fetch(
      "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent?key=" +
        GEMINI_API_KEY,
      {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          contents: [
            {
              parts: [
                { text: systemPrompt + "\n\nPertanyaan pengguna: " + query },
                { text: "Data skor:\n" + JSON.stringify(promptData, null, 2) },
              ],
            },
          ],
        }),
      }
    );

    if (!geminiRes.ok) {
      const errText = await geminiRes.text();
      throw new Error(`Gemini API error: ${geminiRes.status} ${errText}`);
    }

    const geminiJson = await geminiRes.json();
    const narasi = geminiJson.candidates?.[0]?.content?.parts?.[0]?.text ?? "(tidak ada respons)";

    // 3. Validasi sederhana: pastikan tidak ada angka aneh yang tidak
    //    muncul di data asli (cek dasar, bukan jaminan penuh — lihat
    //    framework Bagian 6 untuk pengembangan validasi lebih ketat)
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
    return new Response(JSON.stringify({ error: String(err) }), { status: 500 });
  }
});

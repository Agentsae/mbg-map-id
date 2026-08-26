// supabase/functions/ai-insight/index.ts
// GeoTransit Insight — Tim MBG
//
// Deploy: supabase functions deploy ai-insight
// Set secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
//
// Alur (lihat CLAUDE.md):
//   1. Terima { query, area_filter } dari frontend (area_filter = nama kecamatan, opsional)
//   2. Query skor_equity dari Supabase (skor sudah pasti, dihitung offline), filter per
//      kecamatan kalau area_filter dikirim & cocok
//   3. Kirim skor tsb ke Claude API, minta narasi
//   4. Validasi anti-halusinasi: setiap angka desimal di narasi harus cocok dengan salah
//      satu skor asli yang dikirim (toleran format titik/koma & pembulatan) — kalau tidak,
//      respons ditandai narasi_flagged=true supaya frontend bisa menampilkan peringatan,
//      BUKAN cuma silent log
//   5. Kembalikan { narasi, ranking, narasi_flagged, area_filter, ... } ke frontend

import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Model cepat & murah — cocok untuk tugas narasi ringkas dengan target
// acceptance criteria PRD "< 5 detik". Naikkan ke claude-sonnet-5 kalau
// butuh kualitas interpretasi yang lebih dalam (trade-off: lebih lambat).
const MODEL = "claude-haiku-4-5-20251001";

Deno.serve(async (req) => {
  // Parse body terpisah dari try/catch utama: JSON body yang rusak adalah
  // kesalahan KLIEN (bad request), bukan kegagalan server — harus balas 400,
  // bukan 500 seperti error internal lain di bawah (Supabase/Claude API).
  // deno-lint-ignore no-explicit-any
  let query: any;
  // deno-lint-ignore no-explicit-any
  let area_filter: any;
  try {
    const body = await req.json();
    query = body?.query;
    area_filter = body?.area_filter;
  } catch (_parseErr) {
    return new Response(
      JSON.stringify({ error: "Body request bukan JSON yang valid" }),
      { status: 400, headers: { "Content-Type": "application/json" } }
    );
  }

  try {
    if (!query) {
      return new Response(JSON.stringify({ error: "Field 'query' wajib diisi" }), { status: 400 });
    }
    if (!ANTHROPIC_API_KEY) {
      return new Response(JSON.stringify({ error: "ANTHROPIC_API_KEY belum diset sebagai secret" }), { status: 500 });
    }

    const supabase = createClient(SUPABASE_URL!, SUPABASE_SERVICE_ROLE_KEY!);

    // 1. Ambil skor yang sudah dihitung offline — Claude hanya boleh
    //    MENJELASKAN angka ini, tidak boleh menghitung/menebak sendiri.
    //
    // area_filter (opsional, string nama kecamatan, case-insensitive) — kontrak field
    // ini SUDAH ditentukan bersama frontend, jangan diganti namanya.
    // Kolom nama_kecamatan ada di batas_administrasi (lihat 001_init_tables.sql), yang
    // terhubung ke skor_equity lewat kelurahan_id -> batas_administrasi.id.
    //
    // Catatan teknis PostgREST: filter pada tabel yang di-embed (`batas_administrasi.*`)
    // hanya benar-benar membatasi baris skor_equity kalau relasinya pakai `!inner`
    // (inner join) — tanpa itu, filter cuma memengaruhi isi objek embed, bukan baris
    // top-level yang dikembalikan. Makanya pakai `batas_administrasi!inner(...)` di sini.
    const areaFilterRaw = typeof area_filter === "string" ? area_filter.trim() : "";
    const hasAreaFilter = areaFilterRaw.length > 0;

    const selectColumns =
      "skor_final, ranking, kelompok_terdampak, rekomendasi_intervensi, " +
      (hasAreaFilter
        ? "batas_administrasi!inner(nama_kelurahan, nama_kecamatan)"
        : "batas_administrasi(nama_kelurahan, nama_kecamatan)");

    let queryBuilder = supabase
      .from("skor_equity")
      .select(selectColumns)
      .order("ranking", { ascending: true })
      .limit(5);

    if (hasAreaFilter) {
      // ilike = case-insensitive; tanpa wildcard % supaya cocok persis nama kecamatan
      // (bukan partial match yang bisa salah tangkap kecamatan lain).
      queryBuilder = queryBuilder.ilike("batas_administrasi.nama_kecamatan", areaFilterRaw);
    }

    let { data: skorRows, error } = await queryBuilder;
    if (error) throw error;

    let areaFilterMatched = true;
    let areaFilterNote: string | null = null;

    if (hasAreaFilter && (!skorRows || skorRows.length === 0)) {
      // Tidak ada kecamatan yang cocok — fallback ke semua data, dengan catatan
      // eksplisit di response supaya user tahu filter-nya tidak diterapkan.
      areaFilterMatched = false;
      areaFilterNote =
        `Kecamatan '${areaFilterRaw}' tidak ditemukan di data — menampilkan hasil ` +
        `untuk seluruh Kota Bekasi sebagai fallback.`;

      const fallback = await supabase
        .from("skor_equity")
        .select("skor_final, ranking, kelompok_terdampak, rekomendasi_intervensi, batas_administrasi(nama_kelurahan, nama_kecamatan)")
        .order("ranking", { ascending: true })
        .limit(5);
      if (fallback.error) throw fallback.error;
      skorRows = fallback.data;
    }

    if (!skorRows || skorRows.length === 0) {
      return new Response(
        JSON.stringify({
          narasi: "Data skor belum tersedia — jalankan pipeline compute_scores lalu upload ke Supabase terlebih dahulu.",
          ranking: [],
          narasi_flagged: false,
          flagged_reason: null,
          area_filter: {
            requested: hasAreaFilter ? areaFilterRaw : null,
            applied: hasAreaFilter,
            matched: areaFilterMatched,
            note: areaFilterNote,
          },
        }),
        { headers: { "Content-Type": "application/json" } }
      );
    }

    // NOTE field internal (bukan skema DB): key dikirim ke Claude sebagai
    // "skor_ketimpangan", bukan "skor_equity" — supaya nama field itu sendiri
    // sudah menyiratkan arah skala ke model (skor makin tinggi = makin
    // timpang), mengurangi risiko LLM salah tafsir "equity" sebagai "makin
    // tinggi makin adil". Nama kolom Supabase (skor_equity, tabel skor_equity)
    // TIDAK berubah — ini murni field JSON di payload prompt & sepenuhnya
    // independen dari skema database.
    const promptData = skorRows.map((r: any) => ({
      kelurahan: r.batas_administrasi?.nama_kelurahan,
      kecamatan: r.batas_administrasi?.nama_kecamatan,
      skor_ketimpangan: r.skor_final,
      ranking: r.ranking,
      kelompok_terdampak: r.kelompok_terdampak,
      rekomendasi_intervensi: r.rekomendasi_intervensi,
    }));

    const systemPrompt = `Kamu adalah asisten analisis spasial untuk Dishub Kota Bekasi.
Jelaskan skor Transit Equity Index berikut dalam bahasa yang mudah dipahami
pejabat non-teknis, sertakan alasan berbasis angka yang diberikan.
PENTING soal arah skala: field "skor_ketimpangan" di data ini adalah skor KETIMPANGAN
(equity gap), BUKAN skor keadilan/kesetaraan akses. Semakin TINGGI skornya, semakin
TERTINGGAL/DIRUGIKAN kelurahan tersebut secara akses transit — bukan semakin
adil/equitable. "ranking": 1 berarti skor_ketimpangan PALING TINGGI, yaitu kelurahan
yang paling butuh intervensi/prioritas, bukan kelurahan dengan akses terbaik. JANGAN
pernah menyimpulkan "skor tinggi = akses bagus" atau "ranking 1 = paling adil" — itu
terbalik dan akan menyesatkan pembaca.
JANGAN mengubah, menghitung ulang, atau menambah angka apa pun di luar data ini — kamu
hanya boleh MENJELASKAN skor yang sudah dihitung, bukan menentukan/menebak skor baru.
Kalau menyebut skor, tulis maksimal 2 angka desimal dan gunakan tanda koma (,) sebagai
pemisah desimal sesuai konvensi Bahasa Indonesia (contoh: 0,46), JANGAN diubah ke bentuk
persentase.
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

    // 2. Validasi anti-halusinasi: setiap angka desimal yang disebut narasi harus
    //    cocok dengan salah satu skor_equity asli yang dikirim ke Claude.
    //
    //    Kenapa bukan `narasi.includes(skor.toString())` seperti versi lama: toString()
    //    JS selalu pakai titik desimal ("0.4567"), sementara system prompt minta Claude
    //    menjawab Bahasa Indonesia yang konvensinya pakai koma ("0,4567") — jadi hampir
    //    selalu false-mismatch meski narasinya benar. Di sini kita:
    //      a) toleran format titik ATAU koma sebagai pemisah desimal,
    //      b) toleran pembulatan (Claude sering menulis "0,46" utk skor 0.4567),
    //      c) toleran kalau angka ditulis sebagai bentuk skala-100 tanpa simbol '%'
    //         eksplisit (mis. "45,67" utk 0.4567) — bentuk ini tetap bisa lolos toleransi
    //         supaya tidak over-flag narasi yang sebenarnya valid.
    //    Kalau ADA angka desimal di narasi yang tidak cocok skor manapun (di luar
    //    toleransi ini), respons ditandai narasi_flagged=true — bukan cuma console.warn
    //    seperti sebelumnya — supaya frontend bisa menampilkan peringatan ke user
    //    (sesuai prinsip CLAUDE.md: "setiap skor harus bisa ditelusuri").
    function extractDecimalNumbers(text: string): number[] {
      const matches = text.match(/\d+[.,]\d+/g) || [];
      return matches.map((m) => parseFloat(m.replace(",", ".")));
    }

    function cocokDenganSkorAsli(nilaiNarasi: number, skorAsli: number[]): boolean {
      return skorAsli.some((s) => {
        if (Math.abs(nilaiNarasi - s) < 0.005) return true; // pembulatan 2 desimal
        if (Math.abs(nilaiNarasi - s) < 0.05) return true; // pembulatan 1 desimal
        if (Math.abs(nilaiNarasi / 100 - s) < 0.005) return true; // ditulis dlm skala 0-100
        return false;
      });
    }

    const skorAsli = promptData
      .map((d) => Number(d.skor_ketimpangan))
      .filter((n) => Number.isFinite(n));
    const angkaDiNarasi = extractDecimalNumbers(narasi);
    const angkaTidakCocok = angkaDiNarasi.filter((n) => !cocokDenganSkorAsli(n, skorAsli));

    const narasiFlagged = angkaTidakCocok.length > 0;
    const flaggedReason = narasiFlagged
      ? `Narasi AI menyebut angka (${angkaTidakCocok.join(", ")}) yang tidak cocok dengan ` +
        `skor asli manapun dari database (toleransi pembulatan 1-2 desimal). Perlu ditinjau ` +
        `manual sebelum dipercaya sepenuhnya.`
      : null;

    if (narasiFlagged) {
      console.warn(`[ai-insight] narasi_flagged=true — angka tidak cocok: ${angkaTidakCocok.join(", ")}`);
    }

    return new Response(
      JSON.stringify({
        narasi,
        // NOTE: key response tetap "skor" (bukan skor_equity/skor_ketimpangan) —
        // kontrak field ini sudah dipakai AIPanel.jsx (r.skor.toFixed(2)), TIDAK
        // diubah oleh rename internal promptData di atas supaya frontend tidak putus.
        ranking: promptData.map((d) => ({
          kelurahan: d.kelurahan,
          skor: d.skor_ketimpangan,
          kecamatan: d.kecamatan,
          kelompok_terdampak: d.kelompok_terdampak,
          rekomendasi_intervensi: d.rekomendasi_intervensi,
        })),
        // Field baru (additive, backward-compatible dengan AIPanel.jsx lama yang hanya
        // membaca `narasi` & `ranking`) — frontend BOLEH menampilkan peringatan
        // berdasarkan narasi_flagged, tapi tidak wajib untuk tetap berfungsi.
        narasi_flagged: narasiFlagged,
        flagged_reason: flaggedReason,
        area_filter: {
          requested: hasAreaFilter ? areaFilterRaw : null,
          applied: hasAreaFilter,
          matched: areaFilterMatched,
          note: areaFilterNote,
        },
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

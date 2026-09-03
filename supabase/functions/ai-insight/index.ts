// supabase/functions/ai-insight/index.ts
// GeoTransit Insight — Tim MBG
//
// Deploy: supabase functions deploy ai-insight
// Set secret: supabase secrets set ANTHROPIC_API_KEY=sk-ant-xxxxx
//
// Alur (lihat CLAUDE.md):
//   1. Terima { query, area_filter, simulasi } dari frontend:
//        - area_filter = nama kecamatan, opsional
//        - simulasi    = OPSIONAL, pass-through mentah output RPC simulate_new_stop()
//          (penduduk_terlayani_400m/800m, transit_eksisting_terdekat, dst). Kalau
//          dikirim, tahap ACTION narasi mengutip angka "+N jiwa" RIIL dari sini —
//          bukan mengarang. Kalau tidak, ACTION pakai teks rekomendasi_intervensi DB.
//   2. Query skor_equity dari Supabase (skor sudah pasti, dihitung offline), filter per
//      kecamatan kalau area_filter dikirim & cocok
//   3. Kirim skor tsb ke Claude API, minta narasi berkerangka CCIA
//      (Condition -> Cause -> Impact -> Action) + rekomendasi SMART Spasial (PRD Bab 7.5)
//   4. Validasi anti-halusinasi: setiap angka desimal di narasi harus cocok dengan salah
//      satu skor asli ATAU angka simulasi yang dikirim (toleran format titik/koma &
//      pembulatan) — kalau tidak, respons ditandai narasi_flagged=true supaya frontend
//      bisa menampilkan peringatan, BUKAN cuma silent log
//   5. Kembalikan { narasi, ranking, narasi_flagged, area_filter, ... } ke frontend

import { createClient } from "npm:@supabase/supabase-js@2";

const ANTHROPIC_API_KEY = Deno.env.get("ANTHROPIC_API_KEY");
const SUPABASE_URL = Deno.env.get("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY");

// Model cepat & murah — cocok untuk tugas narasi ringkas dengan target
// acceptance criteria PRD "< 5 detik". Naikkan ke claude-sonnet-5 kalau
// butuh kualitas interpretasi yang lebih dalam (trade-off: lebih lambat).
const MODEL = "claude-haiku-4-5-20251001";

// CORS — WAJIB. Frontend memanggil fungsi ini dari browser (Vercel/localhost)
// lewat supabase-js `functions.invoke`, yang selalu memicu preflight OPTIONS.
// Tanpa header ini, browser memblokir request dan supabase-js melempar
// "Failed to send a request to the Edge Function" (bukan error HTTP dari kode
// di bawah — request-nya memang tidak pernah sampai). "*" aman di sini karena
// fungsi tidak membaca cookie dan tidak mengembalikan data sensitif per-user.
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
  "Access-Control-Allow-Headers":
    "authorization, x-client-info, apikey, content-type",
};

// Semua response HARUS lewat sini supaya header CORS tidak pernah kelupaan di
// salah satu jalur return (early 400, 500, sukses, dsb).
// deno-lint-ignore no-explicit-any
function jsonResponse(body: any, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, "Content-Type": "application/json" },
  });
}

// Format skor 0-1 -> string 2 desimal dengan koma (konvensi Bahasa Indonesia),
// dipakai narasi template supaya konsisten dengan aturan format di systemPrompt.
function fmtSkor(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? v.toFixed(2).replace(".", ",") : "-";
}

// Bilangan bulat dengan pemisah ribuan titik (konvensi Bahasa Indonesia),
// dipakai narasi template untuk angka penduduk hasil simulasi What-If.
function fmtJiwa(n: unknown): string {
  const v = Number(n);
  return Number.isFinite(v) ? Math.round(v).toLocaleString("id-ID") : "-";
}

// Ambil & bersihkan payload simulasi What-If (opsional). Bentuknya = output
// mentah RPC simulate_new_stop() yang diteruskan frontend apa adanya. Return
// null kalau tidak ada / tidak memuat minimal satu angka penduduk terlayani
// (tanpa itu, payload ini tidak berguna untuk tahap ACTION).
// deno-lint-ignore no-explicit-any
function pickSimulasi(raw: any) {
  if (!raw || typeof raw !== "object") return null;
  const num = (v: unknown) => (Number.isFinite(Number(v)) ? Number(v) : undefined);
  const p400 = num(raw.penduduk_terlayani_400m);
  const p800 = num(raw.penduduk_terlayani_800m);
  if (p400 === undefined && p800 === undefined) return null;
  const t =
    raw.transit_eksisting_terdekat && typeof raw.transit_eksisting_terdekat === "object"
      ? raw.transit_eksisting_terdekat
      : {};
  const lok = raw.lokasi && typeof raw.lokasi === "object" ? raw.lokasi : {};
  return {
    lokasi: { lat: num(lok.lat), lon: num(lok.lon) },
    penduduk_terlayani_400m: p400,
    penduduk_terlayani_800m: p800,
    transit_eksisting_terdekat: {
      nama: typeof t.nama === "string" ? t.nama : undefined,
      jarak_m: num(t.jarak_m),
    },
    estimasi_pengurangan_waktu_tempuh_menit: num(raw.estimasi_pengurangan_waktu_tempuh_menit),
    fasilitas_pendidikan_400m: num(raw.fasilitas_pendidikan_400m),
    fasilitas_kesehatan_400m: num(raw.fasilitas_kesehatan_400m),
  };
}

// Semua angka yang SAH muncul di narasi jalur LLM dari payload simulasi
// (dipakai validasi anti-halusinasi supaya "+N jiwa" riil tidak ikut di-flag).
// deno-lint-ignore no-explicit-any
function angkaDariSimulasi(sim: any): number[] {
  if (!sim) return [];
  const cand = [
    sim.penduduk_terlayani_400m,
    sim.penduduk_terlayani_800m,
    sim.transit_eksisting_terdekat?.jarak_m,
    sim.estimasi_pengurangan_waktu_tempuh_menit,
    sim.fasilitas_pendidikan_400m,
    sim.fasilitas_kesehatan_400m,
  ];
  return cand.filter((v) => Number.isFinite(Number(v))).map((v) => Number(v));
}

// Narasi FALLBACK deterministik (tanpa LLM) — dipakai kalau Claude API tidak
// tersedia (ANTHROPIC_API_KEY belum diset, kredit habis, atau API error).
// PRD final Bab 12 (Risiko & Mitigasi) menjanjikan panel AI tetap menampilkan
// interpretasi berbasis skor model spasial meski layanan AI mati. Angka di sini
// diambil apa adanya dari skor yang sudah dihitung offline — tidak ada angka
// yang dikarang — jadi tidak perlu lewat validasi anti-halusinasi.
// Struktur mengikuti kerangka CCIA (Condition -> Cause -> Impact -> Action),
// sama seperti yang diminta ke Claude di systemPrompt.
// deno-lint-ignore no-explicit-any
function buildTemplateNarasi(
  data: any[],
  ctx: { hasAreaFilter: boolean; areaFilterRaw: string; areaFilterMatched: boolean },
  // deno-lint-ignore no-explicit-any
  simulasi?: any
): string {
  if (!data || data.length === 0) return "Data skor belum tersedia.";

  const cakupan =
    ctx.hasAreaFilter && ctx.areaFilterMatched
      ? `Kecamatan ${ctx.areaFilterRaw}`
      : "Kota Bekasi";

  const top = data[0];
  const namaTop = [top.kelurahan, top.kecamatan].filter(Boolean).join(", ") || "(tanpa nama)";

  const daftar = data
    .map((d, i) => {
      const nama = d.kelurahan ?? "(tanpa nama)";
      const kec = d.kecamatan ? ` (${d.kecamatan})` : "";
      return `${i + 1}. ${nama}${kec} — skor ketimpangan ${fmtSkor(d.skor_ketimpangan)}`;
    })
    .join("; ");

  // Condition — kondisi terukur dari Transit Equity Index
  const condition =
    `Berdasarkan Transit Equity Index untuk ${cakupan}, ${namaTop} menempati peringkat 1 ` +
    `dengan skor ketimpangan ${fmtSkor(top.skor_ketimpangan)} (makin tinggi skor = makin ` +
    `tertinggal akses transitnya). Kelurahan dengan ketimpangan tertinggi: ${daftar}.`;

  // Cause — asal skor + kelompok terdampak (tanpa mengarang kalau null)
  const kelompok = top.kelompok_terdampak
    ? `Kelompok yang paling terdampak di ${top.kelurahan}: ${top.kelompok_terdampak}.`
    : `Analisis kerentanan sosial rinci untuk ${top.kelurahan} belum tersedia dan perlu ditindaklanjuti tim.`;
  const cause =
    `Skor ini dibentuk dari Composite Accessibility Index yang di-inverse lalu dipadukan ` +
    `dengan dimensi kerentanan sosial per kelurahan (usia rentan, akses pendidikan/kesehatan/kerja), ` +
    `dengan bobot tiap dimensi dari AHP pairwise (consistency ratio < 0,1). ${kelompok}`;

  // Impact — konsekuensi kalau dibiarkan
  const impact =
    `Tanpa intervensi, kesenjangan akses transit di kelurahan-kelurahan ini berpotensi ` +
    `terus melebar dibanding wilayah lain di ${cakupan}.`;

  // Action — rekomendasi (pakai yang sudah dirumuskan tim, jangan dikarang)
  const actionDasar = top.rekomendasi_intervensi
    ? `Rekomendasi intervensi untuk ${top.kelurahan}: ${top.rekomendasi_intervensi}`
    : `Rekomendasi intervensi spesifik untuk ${top.kelurahan} belum dirumuskan tim — ` +
      `prioritaskan kajian lapangan lanjutan untuk kelurahan berperingkat teratas di atas.`;

  // Kalau ada hasil Simulasi What-If, lampirkan angka penerima manfaat RIIL
  // (bukan karangan) ke tahap Action — ini yang bikin rekomendasi jadi
  // "Measurable" dalam kerangka SMART Spasial.
  let actionSimulasi = "";
  if (simulasi) {
    const p800 = simulasi.penduduk_terlayani_800m;
    const p400 = simulasi.penduduk_terlayani_400m;
    const namaTransit = simulasi.transit_eksisting_terdekat?.nama;
    const jarakTransit = simulasi.transit_eksisting_terdekat?.jarak_m;
    const potensi = Number.isFinite(Number(p800))
      ? `${fmtJiwa(p800)} jiwa dalam radius jalan kaki 800 m`
      : Number.isFinite(Number(p400))
      ? `${fmtJiwa(p400)} jiwa dalam radius jalan kaki 400 m`
      : null;
    if (potensi) {
      actionSimulasi =
        ` Simulasi penambahan titik transit pada lokasi terpilih memproyeksikan potensi ` +
        `tambahan penerima manfaat sekitar ${potensi}` +
        (Number.isFinite(Number(jarakTransit)) && namaTransit
          ? `; transit eksisting terdekat saat ini adalah ${namaTransit} sejauh ${fmtJiwa(jarakTransit)} m.`
          : `.`);
    }
  }

  return [condition, cause, impact, actionDasar + actionSimulasi].join(" ");
}

Deno.serve(async (req) => {
  // Preflight CORS — balas sebelum menyentuh body/logika apa pun.
  if (req.method === "OPTIONS") {
    return new Response(null, { status: 204, headers: corsHeaders });
  }

  // Parse body terpisah dari try/catch utama: JSON body yang rusak adalah
  // kesalahan KLIEN (bad request), bukan kegagalan server — harus balas 400,
  // bukan 500 seperti error internal lain di bawah (Supabase/Claude API).
  // deno-lint-ignore no-explicit-any
  let query: any;
  // deno-lint-ignore no-explicit-any
  let area_filter: any;
  // deno-lint-ignore no-explicit-any
  let simulasi: any;
  try {
    const body = await req.json();
    query = body?.query;
    area_filter = body?.area_filter;
    // OPSIONAL — output mentah RPC simulate_new_stop() diteruskan frontend
    // (lihat AIPanel.jsx). Boleh tidak ada; dibersihkan lewat pickSimulasi().
    simulasi = body?.simulasi;
  } catch (_parseErr) {
    return jsonResponse({ error: "Body request bukan JSON yang valid" }, 400);
  }

  try {
    if (!query) {
      return jsonResponse({ error: "Field 'query' wajib diisi" }, 400);
    }
    // ANTHROPIC_API_KEY yang kosong BUKAN lagi error fatal — di bawah kita
    // fallback ke narasi template deterministik (PRD final Bab 12). Panel AI
    // harus tetap bisa didemokan ke juri walau kredit Anthropic belum aktif.

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

    // FIX (27 Agu 2026, data-ai-analyst): `sumber` WAJIB difilter sebelum
    // order('ranking').limit(N) — lihat 010_skor_equity_sumber.sql. Tabel
    // skor_equity sekarang berisi 5 baris DUMMY (ranking 1-5, testing) DAN
    // 56 baris REAL (ranking 1-56, agregasi 56 kelurahan RBI asli) SEKALIGUS
    // — keduanya punya ranking mulai dari 1, jadi tanpa filter ini query
    // top-5 bisa mengembalikan campuran ranking=1 dummy & ranking=1 real
    // secara tidak terduga. Prioritaskan REAL (data sungguhan Kota Bekasi);
    // ilike dipakai (bukan eq) karena nilai `sumber` REAL menyertakan detail
    // dinamis (mis. "REAL - agregasi lokal (... n=4)"), bukan string tetap.
    let queryBuilder = supabase
      .from("skor_equity")
      .select(selectColumns)
      .ilike("sumber", "REAL%")
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
        // Sama seperti query utama di atas: WAJIB filter sumber REAL supaya
        // tidak campur dengan 5 baris DUMMY (ranking 1-5) — lihat catatan FIX
        // di query utama.
        .ilike("sumber", "REAL%")
        .order("ranking", { ascending: true })
        .limit(5);
      if (fallback.error) throw fallback.error;
      skorRows = fallback.data;
    }

    // Fallback TERAKHIR: kalau tidak ada satu pun baris REAL sama sekali
    // (mis. environment testing/lokal sebelum data 56 kelurahan RBI
    // diupload — lihat etl/aggregate_equity_kelurahan.py), pakai baris
    // DUMMY apa adanya supaya dashboard tidak kosong total saat development,
    // TAPI catat eksplisit di response (areaFilterNote) supaya tidak
    // disalahartikan sebagai data Kota Bekasi sungguhan.
    if (!skorRows || skorRows.length === 0) {
      const dummyFallback = await supabase
        .from("skor_equity")
        .select("skor_final, ranking, kelompok_terdampak, rekomendasi_intervensi, batas_administrasi(nama_kelurahan, nama_kecamatan)")
        .order("ranking", { ascending: true })
        .limit(5);
      if (dummyFallback.error) throw dummyFallback.error;
      if (dummyFallback.data && dummyFallback.data.length > 0) {
        skorRows = dummyFallback.data;
        areaFilterNote =
          (areaFilterNote ? areaFilterNote + " " : "") +
          "PERINGATAN: belum ada data skor_equity REAL (56 kelurahan) di database ini — " +
          "menampilkan data sintetis/testing, BUKAN hasil analisis Kota Bekasi sungguhan.";
      }
    }

    if (!skorRows || skorRows.length === 0) {
      return jsonResponse({
        narasi: "Data skor belum tersedia — jalankan pipeline compute_scores lalu upload ke Supabase terlebih dahulu.",
        ranking: [],
        narasi_flagged: false,
        flagged_reason: null,
        narasi_source: "template",
        narasi_note: null,
        area_filter: {
          requested: hasAreaFilter ? areaFilterRaw : null,
          applied: hasAreaFilter,
          matched: areaFilterMatched,
          note: areaFilterNote,
        },
      });
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

    // Payload simulasi What-If (opsional) — kalau ada, tahap ACTION narasi
    // WAJIB mengutip angka penduduk terlayani dari sini (bukan mengarang).
    const simulasiData = pickSimulasi(simulasi);

    const systemPrompt = `Kamu adalah AI Spatial Consultant untuk Dishub & Bappeda Kota Bekasi.
Tugasmu MENJELASKAN skor yang sudah dihitung model spasial deterministik — bukan menghitung,
menebak, atau menambah angka. Kamu tidak pernah menghasilkan skor sendiri.

=== KERANGKA WAJIB: CCIA (Condition -> Cause -> Impact -> Action) ===
Susun jawaban sebagai 4 bagian berurutan, mengalir tanpa judul/heading, sekitar 1-2 kalimat
per bagian (total maksimal 8 kalimat):
1. CONDITION (Kondisi): sebut kelurahan peringkat teratas beserta skor ketimpangannya, dan
   gambarkan kondisi terukur akses transitnya untuk cakupan yang diminta pengguna.
2. CAUSE (Penyebab): jelaskan skor itu berasal dari Composite Accessibility Index yang
   di-inverse lalu dipadukan dengan dimensi kerentanan sosial (usia rentan, akses
   pendidikan/kesehatan/kerja). Pembobotan tiap dimensi ditetapkan lewat AHP pairwise
   (Saaty) dengan consistency ratio < 0,1 — kamu BOLEH menyebutnya "bobot hasil AHP
   pairwise (CR < 0,1)" bila relevan; tetap jangan menghitung ulang atau mengubah skor.
   Sebut "kelompok_terdampak" bila tersedia di data.
3. IMPACT (Dampak): konsekuensi bila tidak ada intervensi (kesenjangan akses makin lebar
   dibanding wilayah lain).
4. ACTION (Aksi): rekomendasi yang SMART Spasial — Specific (lokasi/koridor konkret),
   Measurable (angka), Achievable, Relevant (transit massal: halte/feeder BisKita Trans
   Patriot, integrasi KRL/LRT Jabodebek), Time-bound (jam operasi / tahap pelaksanaan).
   BUKAN imbauan umum seperti "prioritaskan Kecamatan X".

=== ANGKA UNTUK TAHAP ACTION ===
- Bila data memuat objek "simulasi_what_if", tahap ACTION WAJIB mengutip
  "penduduk_terlayani_800m" (atau "penduduk_terlayani_400m") dari objek itu sebagai potensi
  tambahan penerima manfaat, mis. "berpotensi melayani tambahan N jiwa dalam radius jalan
  kaki 800 m". Boleh menyebut "transit_eksisting_terdekat" dan estimasi waktu tempuh jalan
  kaki dari objek itu. Jangan mengarang angka lain.
- Bila TIDAK ada objek "simulasi_what_if", jadikan teks "rekomendasi_intervensi" dari data
  sebagai dasar ACTION, dan JANGAN menyebut angka penerima manfaat yang tidak ada di data
  (jangan mengarang "+N jiwa").

=== ARAH SKALA (jangan dibalik) ===
"skor_ketimpangan" = skor KETIMPANGAN/kesenjangan akses transit, BUKAN skor keadilan. Makin
TINGGI = kelurahan makin TERTINGGAL/DIRUGIKAN. "ranking": 1 = skor_ketimpangan paling tinggi
= paling butuh prioritas. JANGAN pernah menyimpulkan "skor tinggi = akses bagus" atau
"ranking 1 = paling adil" — itu terbalik dan menyesatkan.

=== FORMAT ===
- Bahasa Indonesia, untuk pembaca pejabat non-teknis.
- Skor: maksimal 2 desimal, pemisah desimal koma (contoh: 0,46). JANGAN diubah ke persen.
- Jumlah penduduk: bilangan bulat, boleh pakai pemisah ribuan titik (contoh: 12.500).
- JANGAN menghitung ulang atau menambah angka apa pun di luar data yang diberikan.
- Bila "kelompok_terdampak" atau "rekomendasi_intervensi" bernilai null untuk suatu kelurahan,
  nyatakan eksplisit bahwa analisis/rekomendasi detail untuk kelurahan itu belum tersedia dan
  perlu tindak lanjut tim — jangan mengarang.`;

    // Narasi: coba Claude API dulu; kalau tidak tersedia (key kosong / kredit
    // habis / API error) fallback ke narasi template deterministik — panel AI
    // TIDAK boleh mati total, cuma turun kualitas bahasa (PRD final Bab 12).
    let narasi: string;
    let narasiSource: "ai" | "template" = "ai";
    let narasiNote: string | null = null;

    if (!ANTHROPIC_API_KEY) {
      narasi = buildTemplateNarasi(
        promptData,
        { hasAreaFilter, areaFilterRaw, areaFilterMatched },
        simulasiData
      );
      narasiSource = "template";
      narasiNote =
        "ANTHROPIC_API_KEY belum diset — narasi disusun dari template deterministik " +
        "berbasis skor model spasial. Angka & ranking tetap akurat.";
    } else {
      try {
        // Claude Messages API — lihat https://docs.claude.com/en/api/messages
        const claudeRes = await fetch("https://api.anthropic.com/v1/messages", {
          method: "POST",
          headers: {
            "x-api-key": ANTHROPIC_API_KEY,
            "anthropic-version": "2023-06-01",
            "content-type": "application/json",
          },
          body: JSON.stringify({
            // Narasi CCIA 4 tahap + kutipan rekomendasi_intervensi DB (bisa
            // panjang) + angka simulasi -> beri ruang lebih dari 512 lama biar
            // tahap ACTION tidak terpotong. Masih ringkas utk target < 5 detik.
            model: MODEL,
            max_tokens: 800,
            system: systemPrompt,
            messages: [
              {
                role: "user",
                content:
                  `Pertanyaan pengguna: ${query}\n\n` +
                  `Cakupan: ${
                    hasAreaFilter && areaFilterMatched
                      ? `Kecamatan ${areaFilterRaw}`
                      : "seluruh Kota Bekasi"
                  }\n\n` +
                  `Data skor (ranking ketimpangan tertinggi lebih dulu):\n` +
                  `${JSON.stringify(promptData, null, 2)}\n\n` +
                  (simulasiData
                    ? `simulasi_what_if (kutip angka INI di tahap ACTION):\n` +
                      `${JSON.stringify(simulasiData, null, 2)}`
                    : `(Tidak ada hasil Simulasi What-If dilampirkan — tahap ACTION pakai teks ` +
                      `rekomendasi_intervensi, jangan mengarang angka penerima manfaat.)`),
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
        narasi =
          claudeJson.content?.find((b: any) => b.type === "text")?.text ?? "(tidak ada respons)";
      } catch (aiErr) {
        // JANGAN throw ke catch utama (itu balas HTTP 500 & panel AI kosong).
        // Fallback ke template, tetap balas 200 dengan ranking + narasi template.
        const aiMsg = aiErr instanceof Error ? aiErr.message : String(aiErr);
        console.warn(`[ai-insight] Claude gagal, fallback ke narasi template: ${aiMsg}`);
        narasi = buildTemplateNarasi(
          promptData,
          { hasAreaFilter, areaFilterRaw, areaFilterMatched },
          simulasiData
        );
        narasiSource = "template";
        narasiNote =
          "Layanan AI sedang tidak tersedia — narasi disusun dari template deterministik " +
          "berbasis skor model spasial. Angka & ranking tetap akurat; bahasa interpretasinya " +
          "lebih ringkas dari biasanya.";
      }
    }

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
    //    Kalau ADA angka desimal di narasi yang tidak cocok skor manapun ATAU angka
    //    simulasi manapun (di luar toleransi ini), respons ditandai narasi_flagged=true
    //    — bukan cuma console.warn — supaya frontend bisa menampilkan peringatan ke user
    //    (sesuai prinsip CLAUDE.md: "setiap skor harus bisa ditelusuri").
    //
    //    Token angka yang dicek: hanya yang PUNYA pemisah (titik/koma). Ini menangkap
    //    dua bentuk sekaligus: skor desimal ("0,46") DAN jumlah penduduk ber-pemisah
    //    ribuan ("12.500"). Bilangan bulat polos tanpa pemisah ("15 jiwa", "2026")
    //    sengaja diabaikan — terlalu banyak angka wajar (tahun, hitungan) yang bukan
    //    indikasi halusinasi.
    function extractNumberTokens(text: string): string[] {
      return text.match(/\d+[.,]\d+/g) || [];
    }

    // Angka yang SAH: skor ketimpangan (0-1) + semua angka dari payload simulasi.
    const skorAsli = promptData
      .map((d) => Number(d.skor_ketimpangan))
      .filter((n) => Number.isFinite(n));
    const angkaSimulasiValid = angkaDariSimulasi(simulasiData);

    function tokenCocok(token: string): boolean {
      // Interpretasi (a): pemisah = desimal -> bandingkan dengan skor 0-1.
      const desimal = parseFloat(token.replace(",", "."));
      if (
        skorAsli.some(
          (s) =>
            Math.abs(desimal - s) < 0.005 || // pembulatan 2 desimal
            Math.abs(desimal - s) < 0.05 || // pembulatan 1 desimal
            Math.abs(desimal / 100 - s) < 0.005 // ditulis skala 0-100
        )
      ) {
        return true;
      }
      // Interpretasi (b): pemisah = ribuan -> bilangan bulat (mis. "12.500" -> 12500).
      const bulat = parseInt(token.replace(/[.,]/g, ""), 10);
      if (
        Number.isFinite(bulat) &&
        angkaSimulasiValid.some((n) => Math.abs(bulat - n) <= Math.max(1, n * 0.02))
      ) {
        return true;
      }
      // Interpretasi (c): angka simulasi kecil ber-desimal (mis. menit "5,3").
      if (angkaSimulasiValid.some((n) => Math.abs(desimal - n) < 0.15)) return true;
      return false;
    }

    // Validasi ini hanya relevan untuk narasi buatan LLM. Narasi template
    // menyusun angkanya langsung dari promptData / simulasiData lewat fmtSkor() /
    // fmtJiwa() — tidak mungkin mengarang angka — jadi otomatis tidak di-flag.
    let narasiFlagged = false;
    let flaggedReason: string | null = null;

    if (narasiSource === "ai") {
      const tokenTidakCocok = extractNumberTokens(narasi).filter((t) => !tokenCocok(t));

      narasiFlagged = tokenTidakCocok.length > 0;
      flaggedReason = narasiFlagged
        ? `Narasi AI menyebut angka (${tokenTidakCocok.join(", ")}) yang tidak cocok dengan ` +
          `skor asli maupun angka simulasi What-If manapun dari data (toleransi pembulatan). ` +
          `Perlu ditinjau manual sebelum dipercaya sepenuhnya.`
        : null;

      if (narasiFlagged) {
        console.warn(`[ai-insight] narasi_flagged=true — angka tidak cocok: ${tokenTidakCocok.join(", ")}`);
      }
    }

    return jsonResponse({
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
      // "ai" = narasi dari Claude; "template" = fallback deterministik saat
      // layanan AI tidak tersedia (PRD final Bab 12). narasi_note berisi
      // penjelasan singkat untuk ditampilkan frontend saat source = template.
      narasi_source: narasiSource,
      narasi_note: narasiNote,
      area_filter: {
        requested: hasAreaFilter ? areaFilterRaw : null,
        applied: hasAreaFilter,
        matched: areaFilterMatched,
        note: areaFilterNote,
      },
      // Konfirmasi apakah payload Simulasi What-If dipakai untuk tahap ACTION.
      // null = tidak dikirim / tidak valid (tanpa angka penduduk terlayani).
      simulasi_dipakai: simulasiData
        ? {
            penduduk_terlayani_400m: simulasiData.penduduk_terlayani_400m ?? null,
            penduduk_terlayani_800m: simulasiData.penduduk_terlayani_800m ?? null,
          }
        : null,
    });
  } catch (err) {
    console.error(err);
    // err bisa berupa Error biasa, atau object error mentah dari Supabase
    // (mis. PostgrestError) — String(err) pada object polos menghasilkan
    // "[object Object]" yang tidak berguna, jadi ambil .message kalau ada.
    const message = err instanceof Error ? err.message : JSON.stringify(err);
    return jsonResponse({ error: message }, 500);
  }
});

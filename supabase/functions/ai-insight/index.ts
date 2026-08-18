import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

Deno.serve(async (req) => {
  try {
    const { query, area_filter } = await req.json();

    const supabase = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
    );

    const apiKey = Deno.env.get('GEMINI_API_KEY');

    if (!apiKey) {
      return new Response(JSON.stringify({ error: 'GEMINI_API_KEY is missing' }), {
        status: 500,
        headers: { 'Content-Type': 'application/json' },
      });
    }

    const { data, error } = await supabase
      .from('skor_equity')
      .select('*')
      .limit(10);

    if (error) {
      throw error;
    }

    const geminiResponse = await fetch(
      'https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=' + apiKey,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [{
            parts: [{
              text: `Kamu adalah asisten analisis spasial untuk Dishub. Jawab dalam bahasa Indonesia sederhana.\n\nArea: ${area_filter ?? 'umum'}\nPertanyaan: ${query}\n\nData skor: ${JSON.stringify(data ?? [])}\n\nInstruksi: gunakan angka dari data yang diberikan, jangan menambah angka yang tidak ada. Fokus pada interpretasi awal dan rekomendasi prioritas.`
            }]
          }]
        })
      }
    );

    const geminiJson = await geminiResponse.json();

    const answer = geminiJson?.candidates?.[0]?.content?.parts?.[0]?.text ?? 'Tidak ada jawaban dari model.';

    return new Response(JSON.stringify({ answer, data }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    });
  } catch (error) {
    return new Response(JSON.stringify({ error: String(error) }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
});

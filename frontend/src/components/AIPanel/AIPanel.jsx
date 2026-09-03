import { useState } from 'react'
import { Sparkles, Send, Loader2, AlertTriangle, Info } from 'lucide-react'
import { supabase, isConfigured } from '../../lib/supabaseClient'
import { KECAMATAN_KOTA_BEKASI } from '../../lib/kecamatan'

const SEMUA_KECAMATAN = '' // opsi default dropdown -> tidak mengirim area_filter sama sekali

const DEMO_RESPONSE = {
  narasi:
    '[CONTOH — belum tersambung ke Supabase] Kelurahan Mustika Jaya menempati prioritas ' +
    'tertinggi dengan skor CAI 0,78. Kepadatan penduduk tinggi (skor 0,90) dan jarak ke ' +
    'fasilitas umum yang jauh (skor 0,70) menjadi pendorong utama, sementara volume transit ' +
    'eksisting di sekitarnya masih rendah (skor 0,20).',
  ranking: [
    { kelurahan: 'Mustika Jaya', skor: 0.78 },
    { kelurahan: 'Rawa Lumbu', skor: 0.71 },
    { kelurahan: 'Bekasi Utara', skor: 0.65 },
  ],
}

export default function AIPanel({ latestSimulasi = null }) {
  const [query, setQuery] = useState('')
  const [areaFilter, setAreaFilter] = useState(SEMUA_KECAMATAN)
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)

  async function handleAsk() {
    if (!query.trim() || loading) return
    const userQuery = query.trim()
    const areaLabel = areaFilter || 'Semua Kecamatan'
    setMessages((prev) => [...prev, { role: 'user', text: userQuery, area: areaLabel }])
    setQuery('')
    setLoading(true)

    try {
      let result
      if (isConfigured) {
        // area_filter hanya disertakan kalau user memilih kecamatan tertentu
        // (bukan "Semua Kecamatan") -- nama field harus persis `area_filter`
        // supaya cocok dengan parameter yang dibaca Edge Function ai-insight.
        const body = { query: userQuery }
        if (areaFilter) body.area_filter = areaFilter
        // Kalau user sudah menjalankan simulasi What-If di sesi ini, teruskan
        // output simulate_new_stop terakhir sebagai body.simulasi — Edge
        // Function ai-insight (opsional, backward-compatible) memakainya supaya
        // tahap Action narasi CCIA bisa mengutip "+N jiwa" riil, bukan angka
        // karangan. Tidak ada yang rusak kalau field ini absen.
        if (latestSimulasi) body.simulasi = latestSimulasi

        const { data, error } = await supabase.functions.invoke('ai-insight', {
          body,
        })
        if (error) throw error
        result = data
      } else {
        // Fallback demo — supaya UI tetap bisa dicoba sebelum Edge Function live
        await new Promise((r) => setTimeout(r, 600))
        result = DEMO_RESPONSE
      }
      setMessages((prev) => [
        ...prev,
        {
          role: 'ai',
          text: result.narasi,
          ranking: result.ranking,
          // narasi_flagged: true saat Edge Function ai-insight mendeteksi narasi
          // menyebut angka yang tidak cocok dengan skor manapun di data (indikasi
          // halusinasi AI). Wajib ditampilkan ke user — lihat prinsip inti
          // "setiap skor harus bisa ditelusuri" (CLAUDE.md).
          flagged: Boolean(result.narasi_flagged),
          flaggedReason: result.flagged_reason,
          // narasi_source: 'template' -> narasi disusun Edge Function dari
          // template deterministik (skor model spasial) karena layanan AI tidak
          // tersedia. Angka & ranking tetap valid; tampilkan catatan netral,
          // BUKAN peringatan halusinasi seperti `flagged`.
          templateNarasi: result.narasi_source === 'template',
          narasiNote: result.narasi_note,
        },
      ])
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: 'ai', text: `Terjadi kendala memanggil AI Insight: ${err.message}`, isError: true },
      ])
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <Sparkles size={18} className="text-brand-orange" />
        <h2 className="font-semibold text-slate-800">AI Spatial Consultant</h2>
      </div>

      {!isConfigured && (
        <div className="mx-4 mt-3 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">
          Belum tersambung ke Supabase — menampilkan respons contoh. Isi <code>.env</code> untuk data asli.
        </div>
      )}

      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-3">
        {messages.length === 0 && (
          <p className="text-sm text-slate-400 mt-4">
            Contoh pertanyaan: "Kecamatan mana yang perlu diprioritaskan untuk halte baru tahun depan?"
          </p>
        )}
        {messages.map((m, i) => (
          <div key={i} className={m.role === 'user' ? 'text-right' : 'text-left'}>
            {m.role === 'user' && m.area && (
              <p className="text-[10px] text-slate-400 mb-0.5">Cakupan: {m.area}</p>
            )}
            <div
              className={
                'inline-block max-w-[90%] rounded-lg px-3 py-2 text-sm ' +
                (m.role === 'user'
                  ? 'bg-brand-blue text-white'
                  : m.isError
                  ? 'bg-red-50 text-red-700 border border-red-200'
                  : 'bg-slate-100 text-slate-800')
              }
            >
              {m.role === 'ai' && !m.flagged && m.templateNarasi && (
                <div className="mb-2 flex items-start gap-1.5 rounded-md border border-slate-300 bg-slate-50 px-2 py-1.5 text-left text-slate-600">
                  <Info size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide">
                      Narasi template
                    </p>
                    <p className="text-xs mt-0.5">
                      {m.narasiNote ||
                        'Layanan AI sedang tidak tersedia — narasi ini disusun otomatis dari skor model spasial. Angka & ranking tetap akurat.'}
                    </p>
                  </div>
                </div>
              )}
              {m.role === 'ai' && m.flagged && (
                <div className="mb-2 flex items-start gap-1.5 rounded-md border border-amber-300 bg-amber-50 px-2 py-1.5 text-left text-amber-800">
                  <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                  <div>
                    <p className="text-[11px] font-semibold uppercase tracking-wide">
                      Narasi ditandai — periksa kembali
                    </p>
                    <p className="text-xs mt-0.5">
                      {m.flaggedReason ||
                        'Sistem mendeteksi angka pada narasi ini tidak cocok dengan skor pada data. Jangan jadikan satu-satunya dasar keputusan — cek rincian skor di peta.'}
                    </p>
                  </div>
                </div>
              )}
              {m.text}
              {m.ranking && (
                <ul className="mt-2 space-y-1 text-xs">
                  {m.ranking.map((r, idx) => (
                    <li key={idx} className="flex justify-between border-t border-slate-200 pt-1">
                      <span>{idx + 1}. {r.kelurahan}</span>
                      <span className="font-mono">{r.skor.toFixed(2)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ))}
        {loading && (
          <div className="flex items-center gap-2 text-sm text-slate-400">
            <Loader2 size={14} className="animate-spin" /> Menghitung skor & menyusun narasi...
          </div>
        )}
      </div>

      <div className="px-3 pt-2 border-t border-slate-200">
        {latestSimulasi && (
          <p className="text-[10px] text-emerald-700 bg-emerald-50 border border-emerald-200 rounded px-2 py-1 mb-2">
            Konteks simulasi What-If terakhir disertakan — tahap Action narasi akan mengutip proyeksi
            penduduk terlayani riil.
          </p>
        )}
        <label className="text-[11px] font-medium text-slate-500 block mb-1">
          Batasi ke kecamatan (opsional)
        </label>
        {/* TODO(ui-ux-designer): styling dropdown ini masih pakai select native
            polos, belum disesuaikan dengan sistem desain final. */}
        <select
          value={areaFilter}
          onChange={(e) => setAreaFilter(e.target.value)}
          className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 mb-2 bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue"
        >
          <option value={SEMUA_KECAMATAN}>Semua Kecamatan</option>
          {KECAMATAN_KOTA_BEKASI.map((k) => (
            <option key={k} value={k}>{k}</option>
          ))}
        </select>
      </div>

      <div className="p-3 pt-0 border-t-0 flex gap-2">
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && handleAsk()}
          placeholder="Tanyakan prioritas transit..."
          className="flex-1 text-sm border border-slate-300 rounded-md px-3 py-2 focus:outline-none focus:ring-2 focus:ring-brand-blue"
        />
        <button
          onClick={handleAsk}
          disabled={loading}
          className="bg-brand-blue text-white rounded-md px-3 py-2 disabled:opacity-50"
        >
          <Send size={16} />
        </button>
      </div>
    </div>
  )
}

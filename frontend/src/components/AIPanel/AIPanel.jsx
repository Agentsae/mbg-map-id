import { useState } from 'react'
import { Sparkles, Send, Loader2 } from 'lucide-react'
import { supabase, isConfigured } from '../../lib/supabaseClient'

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

export default function AIPanel() {
  const [query, setQuery] = useState('')
  const [messages, setMessages] = useState([])
  const [loading, setLoading] = useState(false)

  async function handleAsk() {
    if (!query.trim() || loading) return
    const userQuery = query.trim()
    setMessages((prev) => [...prev, { role: 'user', text: userQuery }])
    setQuery('')
    setLoading(true)

    try {
      let result
      if (isConfigured) {
        const { data, error } = await supabase.functions.invoke('ai-insight', {
          body: { query: userQuery },
        })
        if (error) throw error
        result = data
      } else {
        // Fallback demo — supaya UI tetap bisa dicoba sebelum Edge Function live
        await new Promise((r) => setTimeout(r, 600))
        result = DEMO_RESPONSE
      }
      setMessages((prev) => [...prev, { role: 'ai', text: result.narasi, ranking: result.ranking }])
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

      <div className="p-3 border-t border-slate-200 flex gap-2">
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

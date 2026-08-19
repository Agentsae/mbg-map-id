import { useEffect, useState } from 'react'
import { Scale } from 'lucide-react'
import { supabase, isConfigured } from '../../lib/supabaseClient'

const DEMO_RANKING = [
  { kelurahan: 'Mustika Jaya', skor: 0.81 },
  { kelurahan: 'Bantar Gebang', skor: 0.76 },
  { kelurahan: 'Rawa Lumbu', skor: 0.71 },
  { kelurahan: 'Bekasi Utara', skor: 0.64 },
  { kelurahan: 'Marga Mulya', skor: 0.42 },
]

export default function EquityIndexView() {
  const [ranking, setRanking] = useState(DEMO_RANKING)
  const [usingDemo, setUsingDemo] = useState(!isConfigured)

  useEffect(() => {
    if (!isConfigured) return

    supabase
      .from('skor_equity')
      .select('skor_final, ranking, batas_administrasi(nama_kelurahan)')
      .order('ranking', { ascending: true })
      .limit(10)
      .then(({ data, error }) => {
        if (error || !data?.length) {
          setUsingDemo(true)
          return
        }
        setRanking(
          data.map((d) => ({ kelurahan: d.batas_administrasi?.nama_kelurahan, skor: d.skor_final }))
        )
      })
  }, [])

  const maxSkor = Math.max(...ranking.map((r) => r.skor))

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <Scale size={18} className="text-brand-orange" />
        <h2 className="font-semibold text-slate-800">Transit Equity Index</h2>
      </div>

      {usingDemo && (
        <div className="mx-4 mt-3 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">
          Menampilkan data contoh. Sambungkan tabel <code>skor_equity</code> untuk data asli.
        </div>
      )}

      <div className="p-4 space-y-2">
        <p className="text-sm text-slate-500 mb-2">
          Ranking ketimpangan akses transportasi antarkelurahan — skor lebih tinggi = lebih dirugikan
        </p>
        {ranking.map((r, i) => (
          <div key={i} className="flex items-center gap-3">
            <span className="w-5 text-sm font-mono text-slate-400">{i + 1}</span>
            <span className="flex-1 text-sm text-slate-800">{r.kelurahan}</span>
            <div className="w-24 h-2 bg-slate-100 rounded-full overflow-hidden">
              <div
                className="h-full bg-brand-orange rounded-full"
                style={{ width: `${(r.skor / maxSkor) * 100}%` }}
              />
            </div>
            <span className="w-10 text-right text-xs font-mono text-slate-600">{r.skor.toFixed(2)}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

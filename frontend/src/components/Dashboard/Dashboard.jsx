import { useEffect, useState } from 'react'
import { BarChart3 } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase, isConfigured } from '../../lib/supabaseClient'

// Data contoh — 12 kecamatan Kota Bekasi. Ganti dengan hasil query
// coverage ratio sesungguhnya begitu skor_cai/grid_analisis terisi.
const DEMO_DATA = [
  { kecamatan: 'Bekasi Timur', coverage: 62 },
  { kecamatan: 'Bekasi Barat', coverage: 58 },
  { kecamatan: 'Bekasi Utara', coverage: 41 },
  { kecamatan: 'Bekasi Selatan', coverage: 55 },
  { kecamatan: 'Rawa Lumbu', coverage: 33 },
  { kecamatan: 'Mustika Jaya', coverage: 22 },
]

export default function Dashboard() {
  const [data, setData] = useState(DEMO_DATA)
  const [usingDemo, setUsingDemo] = useState(!isConfigured)

  useEffect(() => {
    if (!isConfigured) return

    // TODO: sesuaikan nama tabel/kolom dengan hasil akhir skema kalian.
    // Contoh query coverage ratio per kecamatan dari grid_analisis:
    supabase
      .from('grid_analisis')
      .select('skor_tdi')
      .then(({ data: rows, error }) => {
        if (error || !rows?.length) {
          setUsingDemo(true)
          return
        }
        // TODO: agregasi asli per kecamatan — ini masih placeholder logic
        setData(DEMO_DATA)
      })
  }, [])

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <BarChart3 size={18} className="text-brand-orange" />
        <h2 className="font-semibold text-slate-800">Dashboard Indikator</h2>
      </div>

      {usingDemo && (
        <div className="mx-4 mt-3 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">
          Menampilkan data contoh. Sambungkan tabel <code>grid_analisis</code> untuk data asli.
        </div>
      )}

      <div className="p-4 flex-1">
        <p className="text-sm text-slate-500 mb-3">
          Coverage ratio (%) penduduk terlayani transit per kecamatan
        </p>
        <ResponsiveContainer width="100%" height={280}>
          <BarChart data={data} layout="vertical" margin={{ left: 20 }}>
            <CartesianGrid strokeDasharray="3 3" horizontal={false} />
            <XAxis type="number" domain={[0, 100]} unit="%" fontSize={12} />
            <YAxis type="category" dataKey="kecamatan" width={100} fontSize={12} />
            <Tooltip formatter={(v) => `${v}%`} />
            <Bar dataKey="coverage" fill="#1B659D" radius={[0, 4, 4, 0]} />
          </BarChart>
        </ResponsiveContainer>
      </div>
    </div>
  )
}

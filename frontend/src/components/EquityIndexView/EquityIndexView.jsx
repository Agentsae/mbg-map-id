import { useEffect, useState } from 'react'
import { Scale } from 'lucide-react'
import { supabase, isConfigured } from '../../lib/supabaseClient'

// Field kelompok_terdampak & rekomendasi_intervensi mengikuti nama kolom
// yang sedang ditambahkan data-ai-analyst ke tabel skor_equity (jangan ubah
// nama field ini) — PRD Bab 8 mewajibkan keduanya tampil per kelurahan dalam
// ranking Transit Equity Index, bukan cuma skor tunggal.
const DEMO_RANKING = [
  {
    kelurahan: 'Mustika Jaya',
    skor: 0.81,
    kelompok_terdampak: 'Lansia, anak sekolah, pekerja informal',
    rekomendasi_intervensi: 'Prioritaskan halte baru + trotoar terhubung ke permukiman padat.',
  },
  {
    kelurahan: 'Bantar Gebang',
    skor: 0.76,
    kelompok_terdampak: 'Pekerja informal, warga sekitar TPA',
    rekomendasi_intervensi: 'Tambah rute feeder ke terminal terdekat, perbaiki penyeberangan.',
  },
  {
    kelurahan: 'Rawa Lumbu',
    skor: 0.71,
    kelompok_terdampak: 'Anak sekolah, lansia',
    rekomendasi_intervensi: 'Perbaikan trotoar & penerangan jalur jalan kaki menuju halte eksisting.',
  },
  {
    kelurahan: 'Bekasi Utara',
    skor: 0.64,
    kelompok_terdampak: 'Pekerja shift malam, ibu dengan balita',
    rekomendasi_intervensi: 'Kaji penambahan headway malam hari pada trayek eksisting.',
  },
  {
    kelurahan: 'Marga Mulya',
    skor: 0.42,
    kelompok_terdampak: 'Anak sekolah',
    rekomendasi_intervensi: 'Pantau berkala — prioritas rendah dibanding kelurahan lain.',
  },
]

export default function EquityIndexView() {
  const [ranking, setRanking] = useState(DEMO_RANKING)
  const [usingDemo, setUsingDemo] = useState(!isConfigured)

  useEffect(() => {
    if (!isConfigured) return

    supabase
      .from('skor_equity')
      .select(
        'skor_final, ranking, kelompok_terdampak, rekomendasi_intervensi, ' +
        'batas_administrasi(nama_kelurahan)'
      )
      .order('ranking', { ascending: true })
      .limit(10)
      .then(({ data, error }) => {
        if (error || !data?.length) {
          setUsingDemo(true)
          return
        }
        setRanking(
          data.map((d) => ({
            kelurahan: d.batas_administrasi?.nama_kelurahan,
            skor: d.skor_final,
            kelompok_terdampak: d.kelompok_terdampak,
            rekomendasi_intervensi: d.rekomendasi_intervensi,
          }))
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

      <div className="p-4 space-y-3 overflow-y-auto">
        <p className="text-sm text-slate-500 mb-1">
          Ranking ketimpangan akses transportasi antarkelurahan — skor lebih tinggi = lebih dirugikan
        </p>
        {ranking.map((r, i) => (
          <div key={i} className="border border-slate-200 rounded-lg p-3">
            <div className="flex items-center gap-3">
              <span className="w-5 text-sm font-mono text-slate-400">{i + 1}</span>
              <span className="flex-1 text-sm font-medium text-slate-800">{r.kelurahan}</span>
              <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                <div
                  className="h-full bg-brand-orange rounded-full"
                  style={{ width: `${(r.skor / maxSkor) * 100}%` }}
                />
              </div>
              <span className="w-10 text-right text-xs font-mono text-slate-600">{r.skor.toFixed(2)}</span>
            </div>

            {/* Kelompok terdampak & rekomendasi intervensi — wajib per PRD Bab 8,
                bukan cuma skor tunggal tanpa penjelasan. */}
            <div className="mt-2 pl-8 space-y-1 text-xs text-slate-600">
              <p>
                <span className="font-medium text-slate-500">Kelompok terdampak: </span>
                {formatKelompokTerdampak(r.kelompok_terdampak)}
              </p>
              <p>
                <span className="font-medium text-slate-500">Rekomendasi intervensi: </span>
                {r.rekomendasi_intervensi || '—'}
              </p>
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

function formatKelompokTerdampak(value) {
  if (!value) return '—'
  return Array.isArray(value) ? value.join(', ') : value
}

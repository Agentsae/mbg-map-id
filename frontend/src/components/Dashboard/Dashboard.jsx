import { useEffect, useState } from 'react'
import { BarChart3, MapPinOff, Users } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase, isConfigured } from '../../lib/supabaseClient'
import { fetchAllRows } from '../../lib/fetchAllRows'

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

// Grid dengan skor_tdi DI ATAS ambang ini dianggap "transit desert" untuk
// keperluan tampilan kartu ringkasan (skor_tdi lebih tinggi = grid makin
// "transit desert" — normalisasi min-max, lihat etl/compute_scores.py
// compute_tdi(); arahnya BERBEDA dari skor_aksesibilitas_transit yang
// dipakai proksi sebelumnya, saat itu skor_tdi masih selalu null).
// TODO(data-ai-analyst): konfirmasi ambang resmi "transit desert" untuk
// dashboard (mis. top quartile / nilai absolut tertentu) — 0.6 di bawah ini
// hanya placeholder tampilan yang wajar, BUKAN definisi final Transit
// Desert Index.
const TRANSIT_DESERT_THRESHOLD = 0.6

// Kartu ringkasan contoh — dipakai kalau Supabase belum tersambung/tabel
// grid_analisis masih kosong.
const DEMO_TRANSIT_DESERT_COUNT = 18
const DEMO_POTENSI_PENERIMA_MANFAAT = 42500

export default function Dashboard() {
  const [data, setData] = useState(DEMO_DATA)
  const [usingDemo, setUsingDemo] = useState(!isConfigured)

  const [transitDesertCount, setTransitDesertCount] = useState(DEMO_TRANSIT_DESERT_COUNT)
  const [usingDemoDesert, setUsingDemoDesert] = useState(!isConfigured)

  const [potensiPenerimaManfaat, setPotensiPenerimaManfaat] = useState(DEMO_POTENSI_PENERIMA_MANFAAT)
  const [usingDemoPenerima, setUsingDemoPenerima] = useState(!isConfigured)

  useEffect(() => {
    if (!isConfigured) return

    // TODO: sesuaikan nama tabel/kolom dengan hasil akhir skema kalian.
    // Contoh query coverage ratio per kecamatan dari grid_analisis. Cukup
    // .limit(1) — di sini cuma dipakai untuk cek "tabel sudah ada isinya
    // atau belum", BUKAN memuat semua baris (yang dibutuhkan untuk agregasi
    // per kecamatan belum diimplementasikan, lihat TODO di bawah).
    supabase
      .from('grid_analisis')
      .select('skor_tdi')
      .limit(1)
      .then(({ data: rows, error }) => {
        if (error || !rows?.length) {
          setUsingDemo(true)
          return
        }
        // TODO(data-ai-analyst): agregasi coverage ratio asli per kecamatan
        // belum diimplementasikan di sini — sengaja tetap tandai sebagai
        // "usingDemo" (bukan bug) supaya UI tidak diam-diam menampilkan
        // DEMO_DATA seolah-olah itu data asli begitu Supabase tersambung.
        setData(DEMO_DATA)
        setUsingDemo(true)
      })

    // Jumlah transit desert teridentifikasi: hitung grid dengan skor_tdi di
    // atas ambang. Ini murni filter/count atas skor_tdi yang SUDAH dihitung
    // data-ai-analyst (Transit Desert Index) — tidak ada formula CAI/TDI
    // yang dihitung ulang di sini.
    //
    // fetchAllRows (bukan `.select(...).then(...)` polos) — dengan ambang
    // 0.6, 1.517 dari 2.607 grid cocok filter ini (diverifikasi langsung ke
    // API), jauh di atas cap 1000 baris/request PostgREST. Tanpa paginasi,
    // transitDesertCount & potensiPenerimaManfaat akan diam-diam undercount
    // (hanya menghitung 1000 dari 1517 grid) — lihat lib/fetchAllRows.js.
    fetchAllRows(() =>
      supabase
        .from('grid_analisis')
        .select('id, kepadatan_penduduk, skor_tdi')
        .gt('skor_tdi', TRANSIT_DESERT_THRESHOLD)
        .order('id', { ascending: true })
    ).then(({ data: rows, error }) => {
      if (error || !rows) {
        setUsingDemoDesert(true)
        return
      }
      setTransitDesertCount(rows.length)
      setUsingDemoDesert(false)

      // Potensi penerima manfaat: agregasi kepadatan_penduduk pada grid
      // yang teridentifikasi sebagai transit desert, sebagai proksi kasar
      // jumlah penduduk yang berpotensi diuntungkan bila desert ini
      // ditangani. Ini penjumlahan kolom mentah, bukan formula baru.
      // TODO(data-ai-analyst): ganti dengan agregasi jumlah_penduduk
      // (headcount) yang lebih akurat lewat join spasial ke tabel
      // `penduduk`, idealnya lewat RPC khusus — kepadatan_penduduk di
      // grid_analisis adalah rasio per luas grid, bukan headcount langsung.
      if (rows.length) {
        const totalKepadatan = rows.reduce((sum, r) => sum + (r.kepadatan_penduduk ?? 0), 0)
        setPotensiPenerimaManfaat(Math.round(totalKepadatan))
        setUsingDemoPenerima(false)
      } else {
        setUsingDemoPenerima(true)
      }
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

      <div className="px-4 pt-4 grid grid-cols-2 gap-3">
        <StatCard
          icon={MapPinOff}
          label="Transit Desert Teridentifikasi"
          value={transitDesertCount.toLocaleString('id-ID')}
          unit="grid"
          usingDemo={usingDemoDesert}
        />
        <StatCard
          icon={Users}
          label="Potensi Penerima Manfaat"
          value={potensiPenerimaManfaat.toLocaleString('id-ID')}
          unit="jiwa (estimasi)"
          usingDemo={usingDemoPenerima}
        />
      </div>

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

// TODO(ui-ux-designer): kartu ringkasan ini masih styling generik (belum
// disesuaikan dengan sistem kartu resmi mockup PRD Gambar 3) — asumsi wajar
// dipakai dulu supaya data sudah tampil.
function StatCard({ icon: Icon, label, value, unit, usingDemo }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 relative">
      <div className="flex items-center gap-2 text-slate-400 mb-1">
        <Icon size={14} />
        <span className="text-[11px] font-medium uppercase tracking-wide">{label}</span>
      </div>
      <p className="text-2xl font-bold text-slate-800 leading-tight">{value}</p>
      <p className="text-[11px] text-slate-400">{unit}</p>
      {usingDemo && (
        <span
          title="Menampilkan data contoh — sambungkan grid_analisis untuk data asli"
          className="absolute top-2 right-2 text-[9px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5"
        >
          demo
        </span>
      )}
    </div>
  )
}

import { useEffect, useState } from 'react'
import { BarChart3, MapPinOff, Users, Grid3x3, Map as MapIcon, Briefcase, Gauge } from 'lucide-react'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts'
import { supabase, isConfigured } from '../../lib/supabaseClient'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { KOTA_PROFIL } from '../../lib/kotaProfil'

const fmtInt = (n) => Number(n).toLocaleString('id-ID')
const fmtDec = (n, d = 2) =>
  Number(n).toLocaleString('id-ID', { minimumFractionDigits: d, maximumFractionDigits: d })

// Ringkasan Kota Bekasi (mockup PRD Gambar 3, panel ringkasan kota). Nilai
// demo = angka kanonik dari KOTA_PROFIL; dipakai kalau Supabase belum
// tersambung / query gagal.
const DEMO_RINGKASAN = {
  populasi: KOTA_PROFIL.populasi_fallback,
  kepadatan: KOTA_PROFIL.kepadatan_fallback,
  indeksAksesibilitas: KOTA_PROFIL.indeks_aksesibilitas_fallback,
  indeksAksesibilitasN: null,
}

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

  // Ringkasan Kota Bekasi
  const [ringkasan, setRingkasan] = useState(DEMO_RINGKASAN)
  const [usingDemoPopulasi, setUsingDemoPopulasi] = useState(!isConfigured)
  const [usingDemoIndeks, setUsingDemoIndeks] = useState(!isConfigured)
  const [ringkasanLoading, setRingkasanLoading] = useState(isConfigured)

  useEffect(() => {
    if (!isConfigured) return

    // --- Ringkasan Kota Bekasi ---
    // Populasi: sum(jumlah_penduduk) dari `penduduk` (56 baris agregat per
    // kelurahan — jauh di bawah cap 1000 baris PostgREST, jadi tidak perlu
    // fetchAllRows). Basis ini harus sama dengan yang dipakai RPC
    // simulate_new_stop (2.607.248). Kepadatan diturunkan = populasi /
    // luas (KOTA_PROFIL.luas_km2), tidak di-hardcode, supaya konsisten
    // kalau data penduduk berubah.
    //
    // Indeks aksesibilitas rata-rata: rata-rata `skor_final` dari `skor_cai`
    // (Composite Accessibility Index per titik kandidat tersurvei). Dipilih
    // daripada grid_analisis.skor_aksesibilitas_transit karena: (a) skor_cai
    // adalah CAI resmi yang sama persis dengan yang ditampilkan saat user
    // klik peta — bisa ditelusuri; (b) query ringan (~70 baris). Kelemahan:
    // titik kandidat sengaja disampel di lokasi yang diduga bermasalah, jadi
    // ini rata-rata "di titik kandidat", bukan rata-rata spasial se-kota —
    // karena itu kartunya diberi caption "berdasarkan N titik kandidat".
    // TODO(data-ai-analyst): kalau grid_analisis.skor_aksesibilitas_transit
    // sudah terisi penuh se-kota, pertimbangkan pakai itu untuk rata-rata
    // spasial yang lebih representatif (butuh fetchAllRows, 2.607 baris).
    Promise.all([
      supabase.from('penduduk').select('jumlah_penduduk'),
      supabase.from('skor_cai').select('skor_final'),
    ]).then(([pendudukRes, caiRes]) => {
      const next = { ...DEMO_RINGKASAN }

      const pendudukRows = pendudukRes.data
      if (!pendudukRes.error && pendudukRows?.length) {
        const total = pendudukRows.reduce((s, r) => s + (r.jumlah_penduduk ?? 0), 0)
        if (total > 0) {
          next.populasi = total
          next.kepadatan = Math.round(total / KOTA_PROFIL.luas_km2)
          setUsingDemoPopulasi(false)
        } else {
          setUsingDemoPopulasi(true)
        }
      } else {
        setUsingDemoPopulasi(true)
      }

      const caiRows = caiRes.data
      const caiVals =
        !caiRes.error && caiRows?.length
          ? caiRows.map((r) => r.skor_final).filter((v) => v != null).map(Number)
          : []
      if (caiVals.length) {
        next.indeksAksesibilitas = caiVals.reduce((s, v) => s + v, 0) / caiVals.length
        next.indeksAksesibilitasN = caiVals.length
        setUsingDemoIndeks(false)
      } else {
        setUsingDemoIndeks(true)
      }

      setRingkasan(next)
      setRingkasanLoading(false)
    }).catch(() => {
      // Network error dsb — jatuh ke angka kanonik KOTA_PROFIL (mode demo).
      setUsingDemoPopulasi(true)
      setUsingDemoIndeks(true)
      setRingkasanLoading(false)
    })

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

      <div className="px-4 pt-4">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
          Ringkasan Kota Bekasi
        </p>
        <div className="grid grid-cols-2 gap-3">
          <StatCard
            icon={Users}
            label="Populasi"
            value={ringkasanLoading ? '—' : fmtInt(ringkasan.populasi)}
            unit="jiwa"
            sub={usingDemoPopulasi ? 'angka kanonik DKB Semester I 2026' : 'DKB Semester I 2026'}
            usingDemo={usingDemoPopulasi}
            demoHint="Gagal memuat tabel penduduk — memakai angka kanonik DKB Semester I 2026"
          />
          <StatCard
            icon={Grid3x3}
            label="Kepadatan"
            value={ringkasanLoading ? '—' : fmtInt(ringkasan.kepadatan)}
            unit="jiwa/km²"
            sub="diturunkan: populasi ÷ 210,49 km²"
            usingDemo={usingDemoPopulasi}
            demoHint="Diturunkan dari populasi fallback kanonik dibagi luas wilayah BPS"
          />
          <StatCard
            icon={MapIcon}
            label="Luas Wilayah"
            value={fmtDec(KOTA_PROFIL.luas_km2)}
            unit="km²"
            sub="BPS Kota Bekasi Dalam Angka"
          />
          <StatCard
            icon={Briefcase}
            label="Usia Produktif"
            value={`${fmtDec(KOTA_PROFIL.usia_produktif_persen)}%`}
            unit={`${fmtInt(KOTA_PROFIL.usia_produktif_jiwa)} jiwa`}
            sub="DKB Semester I 2026"
            hint={`${KOTA_PROFIL.usia_produktif_definisi} (usia 15–64 tahun)`}
          />
          <StatCard
            icon={Gauge}
            label="Indeks Aksesibilitas Rata-rata"
            value={ringkasanLoading ? '—' : fmtDec(ringkasan.indeksAksesibilitas)}
            unit="skala 0–1 (CAI)"
            sub={
              usingDemoIndeks
                ? 'estimasi sementara (skor_cai belum terisi)'
                : `berdasarkan ${ringkasan.indeksAksesibilitasN} titik kandidat`
            }
            usingDemo={usingDemoIndeks}
            demoHint="Tabel skor_cai belum berisi skor_final — menampilkan estimasi sementara"
            hint="Rata-rata skor_final tabel skor_cai (Composite Accessibility Index) pada titik kandidat tersurvei"
          />
        </div>
      </div>

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
function StatCard({ icon: Icon, label, value, unit, sub, usingDemo, demoHint, hint }) {
  return (
    <div className="bg-white border border-slate-200 rounded-lg p-3 relative">
      <div className="flex items-center gap-2 text-slate-400 mb-1">
        <Icon size={14} />
        <span
          className="text-[11px] font-medium uppercase tracking-wide"
          title={hint || undefined}
        >
          {label}
          {hint && <span className="ml-1 text-slate-300 normal-case">ⓘ</span>}
        </span>
      </div>
      <p className="text-2xl font-bold text-slate-800 leading-tight">{value}</p>
      <p className="text-[11px] text-slate-400">{unit}</p>
      {sub && <p className="text-[10px] text-slate-300 mt-0.5 leading-tight">{sub}</p>}
      {usingDemo && (
        <span
          title={demoHint || 'Menampilkan data contoh — sambungkan grid_analisis untuk data asli'}
          className="absolute top-2 right-2 text-[9px] bg-amber-50 text-amber-700 border border-amber-200 rounded px-1.5 py-0.5"
        >
          demo
        </span>
      )}
    </div>
  )
}

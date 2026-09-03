import { useEffect, useMemo, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import MapView from '../Map/MapView'
import TdiScorePanel from './TdiScorePanel'
import { supabase, isConfigured } from '../../lib/supabaseClient'
import { fetchAllRows } from '../../lib/fetchAllRows'
import { KECAMATAN_KOTA_BEKASI } from '../../lib/kecamatan'
import {
  extractLatLon,
  extractPolygonRings,
  bboxFromRing,
  ringAveragePoint,
  pointInBBox,
} from '../../lib/geo'

/**
 * AnalisisSpasial — "Peta Multi-Layer Gap Analysis" (PRD Bab 8).
 * Layer yang ditampilkan:
 *  - Kepadatan penduduk (choropleth grid_analisis.kepadatan_penduduk)
 *  - Indeks gap aksesibilitas (choropleth grid_analisis.skor_tdi — Transit
 *    Desert Index dihitung data-ai-analyst per grid 2.607 sel kota, live
 *    sejak 27 Agustus 2026; frontend HANYA menampilkan apa adanya, skor lebih
 *    tinggi = grid makin "transit desert")
 *  - Jaringan transit eksisting (titik halte_eksisting)
 *  - Batas kecamatan (outline) — dari batas_administrasi data ASLI (lihat di bawah)
 * Filter per kecamatan wajib render ulang < 2 detik (acceptance criteria).
 * Karena grid_analisis tidak (belum) punya kolom kecamatan langsung, atribusi
 * "grid ini masuk kecamatan mana" di sini pakai pendekatan bounding-box per
 * kecamatan dari batas_administrasi (lihat komentar bboxFromRing di lib/geo.js)
 * — bukan point-in-polygon presisi. Ini murni navigasi/filter UI, BUKAN
 * penghitungan ulang CAI/TDI/Equity Index.
 *
 * Sumber data batas_administrasi: tabel ini berisi 56 baris poligon ASLI
 * (BIG RBI 25K, kolom sumber = SUMBER_BATAS_RESMI di bawah) BERDAMPINGAN
 * dengan 6 baris dummy lama (`'DATA SINTETIS - seed testing, ...'`, dipakai
 * komponen lain seperti EquityIndexView/skor_equity yang FK-nya belum
 * dimigrasikan data-ai-analyst — di luar wewenang webgis-developer). Query di
 * bawah WAJIB filter `.eq('sumber', SUMBER_BATAS_RESMI)` supaya:
 *  (a) tidak menampilkan poligon dummy sebagai batas kecamatan di peta, dan
 *  (b) bbox per kecamatan tidak "tercemar" merge dengan bbox dummy — dicek
 *      manual, 2 dari 6 nama dummy (`nama_kecamatan` = 'Bekasi Utara' dan
 *      'Bekasi Timur') collide persis dengan nama kecamatan resmi, jadi tanpa
 *      filter ini bbox 2 kecamatan itu akan salah/kasar.
 * Ejaan nama_kecamatan resmi RBI TIDAK selalu sama dengan daftar statis
 * KECAMATAN_KOTA_BEKASI di lib/kecamatan.js (mis. resmi "Mustikajaya" tanpa
 * spasi, bukan "Mustika Jaya") — dropdown filter kecamatan di komponen ini
 * karena itu dibangun dari nama_kecamatan hasil fetch asli (kecamatanOptions),
 * BUKAN dari KECAMATAN_KOTA_BEKASI, supaya value dropdown selalu cocok persis
 * dengan properti `kecamatan` yang dilekatkan ke grid/halte di bawah.
 * KECAMATAN_KOTA_BEKASI tetap dipakai sebagai fallback nama saat mode demo
 * (Supabase belum tersambung / tabel masih kosong).
 */
const SUMBER_BATAS_RESMI = 'BIG RBI 25K KUGI50 2022-12-31 (tanahair.indonesia.go.id)'

// Palet choropleth: sequential colorblind-safe — ColorBrewer YlGnBu 5 kelas
// (kuning muda → biru tua), dipakai untuk KEDUA layer (kepadatan & gap; hanya
// satu tampil pada satu waktu lewat radio). Menggantikan skema lama hijau→merah
// diverging (gap) & cream→merah (kepadatan) yang dilarang PRD Bab 10.3 / temuan
// Coaching Clinic 4: skema merah–oranye–hijau tidak terbaca bagi ~8% pria dengan
// color vision deficiency. Kelas dibuat DISKRET (ekspresi 'step', bukan gradient
// kontinu) dan legenda menambahkan nomor kelas + label rentang angka sebagai
// pembeda non-warna — tampilan tidak bergantung pada warna saja.
const CHOROPLETH_COLORS = ['#ffffcc', '#a1dab4', '#41b6c4', '#2c7fb8', '#253494']
const CLASS_COUNT = CHOROPLETH_COLORS.length

// Ambang kelas equal-interval pada rentang [min, max] → CLASS_COUNT-1 nilai batas,
// strictly ascending (computeMinMax menjamin max > min).
function classBreaks([min, max], n) {
  const span = (max - min) / n
  return Array.from({ length: n - 1 }, (_, i) => min + span * (i + 1))
}

// Format batas kelas untuk legenda: angka besar (kepadatan) dibulatkan + pemisah
// ribuan, angka kecil (skor 0–1) dua desimal.
function fmtBound(v) {
  return Math.abs(v) >= 100 ? Math.round(v).toLocaleString('id-ID') : v.toFixed(2)
}

// Perkiraan cakupan wilayah Kota Bekasi — dipakai untuk membangun grid & bbox
// kecamatan CONTOH (dummy) saat Supabase belum terisi. Bukan batas administratif
// resmi, hanya kotak pembagi visual untuk demo.
const BEKASI_BBOX = { minLat: -6.35, maxLat: -6.15, minLon: 106.95, maxLon: 107.12 }

// Rincian TDI contoh — dipakai kalau Supabase belum tersambung / RPC
// get_tdi_breakdown gagal. Struktur meniru output RPC (migration 015) apa
// adanya; TIDAK ada formula dihitung di sini, murni angka contoh statis.
const DEMO_TDI_BREAKDOWN = {
  ditemukan: true,
  cell_id: null,
  match: 'memuat',
  jarak_ke_sel_m: 0,
  skor_tdi: 0.68,
  skor_tdi_reproduksi_perkiraan: 0.679,
  tdi_raw: 41.32,
  aksesibilitas_floor: 0.01,
  formula:
    'TDI_raw = kepadatan_penduduk x indeks_kebutuhan_mobilitas / maks(skor_aksesibilitas_transit, 0,01); ' +
    'skor_tdi = normalisasi_minmax(ln(1 + TDI_raw)) lintas seluruh sel grid',
  komponen: [
    {
      kunci: 'kepadatan_penduduk',
      label: 'Kepadatan penduduk',
      nilai: 8120.5,
      satuan: 'jiwa per sel (~300 x 300 m, hasil dasymetric mapping)',
      peran: 'pembilang',
      arah: 'Makin tinggi -> TDI makin tinggi (defisit layanan makin besar)',
    },
    {
      kunci: 'indeks_kebutuhan_mobilitas',
      label: 'Indeks Kebutuhan Mobilitas',
      nilai: 0.612,
      satuan: 'indeks 0-1 (proksi: proporsi usia rentan, kepadatan POI harian, rasio tanpa kendaraan)',
      peran: 'pembilang',
      arah: 'Makin tinggi -> TDI makin tinggi',
    },
    {
      kunci: 'skor_aksesibilitas_transit',
      label: 'Skor Aksesibilitas Transit',
      nilai: 0.12,
      satuan: 'indeks 0-1 (coverage isochrone 400/800 m ke halte eksisting terdekat)',
      peran: 'penyebut',
      arah: 'Makin tinggi -> TDI makin RENDAH (akses transit sudah baik)',
    },
  ],
  catatan:
    'Data contoh. skor_tdi lebih tinggi = sel makin "transit desert" (makin butuh prioritas).',
}

// Hash sederhana (deterministik, bukan Math.random) supaya data dummy stabil
// antar render/reload — memudahkan verifikasi visual saat QA.
function pseudoRandom(seed) {
  const x = Math.sin(seed * 12.9898) * 43758.5453
  return x - Math.floor(x)
}

function buildDemoKecamatanBBoxes() {
  const cols = 4
  const rows = 3
  const lonStep = (BEKASI_BBOX.maxLon - BEKASI_BBOX.minLon) / cols
  const latStep = (BEKASI_BBOX.maxLat - BEKASI_BBOX.minLat) / rows
  const map = {}
  KECAMATAN_KOTA_BEKASI.forEach((nama, i) => {
    const col = i % cols
    const row = Math.floor(i / cols)
    map[nama] = {
      minLon: BEKASI_BBOX.minLon + col * lonStep,
      maxLon: BEKASI_BBOX.minLon + (col + 1) * lonStep,
      minLat: BEKASI_BBOX.minLat + row * latStep,
      maxLat: BEKASI_BBOX.minLat + (row + 1) * latStep,
    }
  })
  return map
}

function buildDemoGrid(kecamatanBBoxes) {
  const cellsPerSide = 6
  const lonStep = (BEKASI_BBOX.maxLon - BEKASI_BBOX.minLon) / cellsPerSide
  const latStep = (BEKASI_BBOX.maxLat - BEKASI_BBOX.minLat) / cellsPerSide
  const cells = []
  let idx = 0
  for (let r = 0; r < cellsPerSide; r++) {
    for (let c = 0; c < cellsPerSide; c++) {
      idx++
      const minLon = BEKASI_BBOX.minLon + c * lonStep
      const maxLon = minLon + lonStep
      const minLat = BEKASI_BBOX.minLat + r * latStep
      const maxLat = minLat + latStep
      const ring = [
        [minLon, minLat],
        [maxLon, minLat],
        [maxLon, maxLat],
        [minLon, maxLat],
        [minLon, minLat],
      ]
      const center = { lat: (minLat + maxLat) / 2, lon: (minLon + maxLon) / 2 }
      const kecamatan =
        Object.entries(kecamatanBBoxes).find(([, bbox]) => pointInBBox(center, bbox))?.[0] ?? null
      cells.push({
        ring,
        kecamatan,
        kepadatan_penduduk: Math.round(pseudoRandom(idx * 1.1) * 15000 + 2000),
        skor_aksesibilitas_transit: Number(pseudoRandom(idx * 2.3).toFixed(2)),
        skor_tdi: Number(pseudoRandom(idx * 3.7).toFixed(2)),
      })
    }
  }
  return cells
}

function buildDemoHalte(kecamatanBBoxes) {
  return Object.entries(kecamatanBBoxes).map(([kecamatan, bbox], i) => ({
    lat: (bbox.minLat + bbox.maxLat) / 2 + (pseudoRandom(i * 5.1) - 0.5) * 0.01,
    lon: (bbox.minLon + bbox.maxLon) / 2 + (pseudoRandom(i * 7.3) - 0.5) * 0.01,
    nama: `Halte ${kecamatan} (contoh)`,
    kecamatan,
  }))
}

function computeMinMax(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v))
  if (!nums.length) return [0, 1]
  let min = Math.min(...nums)
  let max = Math.max(...nums)
  if (min === max) max = min + 1
  return [min, max]
}

function toPolygonFeatureCollection(cells, valueFn) {
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [c.ring] },
      properties: { value: valueFn(c) ?? 0 },
    })),
  }
}

export default function AnalisisSpasial() {
  const [kecamatanFilter, setKecamatanFilter] = useState('')
  const [choroplethLayer, setChoroplethLayer] = useState('kepadatan') // 'kepadatan' | 'gap'
  const [transitVisible, setTransitVisible] = useState(true)

  const [usingDemoBoundary, setUsingDemoBoundary] = useState(!isConfigured)
  const [kecamatanOptions, setKecamatanOptions] = useState(KECAMATAN_KOTA_BEKASI)
  // Ring poligon batas kecamatan ASLI (bukan bbox) — dipakai untuk layer
  // outline visual di peta, terpisah dari bboxes (yang dipakai untuk atribusi
  // grid/halte -> kecamatan). null selama data asli belum termuat (mode demo
  // tidak menampilkan outline sama sekali — bbox dummy terlalu kasar untuk
  // digambar sebagai "batas kecamatan").
  const [boundaryRings, setBoundaryRings] = useState(null)
  const [gridFeatures, setGridFeatures] = useState(() => buildDemoGrid(buildDemoKecamatanBBoxes()))
  const [usingDemoGrid, setUsingDemoGrid] = useState(!isConfigured)
  const [halteFeatures, setHalteFeatures] = useState(() => buildDemoHalte(buildDemoKecamatanBBoxes()))
  const [usingDemoHalte, setUsingDemoHalte] = useState(!isConfigured)

  const [lastFilterMs, setLastFilterMs] = useState(null)
  const filterStartRef = useRef(null)

  // --- Klik sel -> rincian Transit Desert Index (acceptance criteria PRD Bab 8:
  //     "CAI & TDI — klik lokasi -> rincian kontribusi tiap kriteria"). Hanya
  //     aktif saat layer choropleth = 'gap' (TDI). RPC get_tdi_breakdown
  //     (migration 015) HANYA menyajikan angka grid_analisis yang sudah dihitung
  //     offline — tidak ada skor dihitung ulang di frontend. ---
  const [tdiLoading, setTdiLoading] = useState(false)
  const [tdiResult, setTdiResult] = useState(null)
  const [tdiUsingDemo, setTdiUsingDemo] = useState(!isConfigured)

  async function handleMapClick({ lat, lon }) {
    // Rincian per-kriteria hanya relevan untuk layer TDI. Klik saat layer
    // kepadatan aktif diabaikan (tidak ada breakdown "kepadatan" tunggal).
    // handleMapClick sengaja dibuat ulang tiap render (closure atas
    // choroplethLayer) — MapView cukup rebind listener 'click', murah.
    if (choroplethLayer !== 'gap') return

    setTdiLoading(true)
    setTdiResult(null)
    try {
      if (isConfigured) {
        const { data, error } = await supabase.rpc('get_tdi_breakdown', { lng: lon, lat })
        if (error) throw error
        setTdiResult(data)
        setTdiUsingDemo(false)
      } else {
        await new Promise((r) => setTimeout(r, 300))
        setTdiResult(DEMO_TDI_BREAKDOWN)
        setTdiUsingDemo(true)
      }
    } catch (err) {
      console.error('Gagal memanggil get_tdi_breakdown:', err)
      setTdiResult(DEMO_TDI_BREAKDOWN)
      setTdiUsingDemo(true)
    } finally {
      setTdiLoading(false)
    }
  }

  // Ambil batas_administrasi (-> bbox per kecamatan), grid_analisis, dan
  // halte_eksisting sekali di awal. Filter kecamatan sesudahnya murni
  // array-filter di memori (tidak query ulang), supaya acceptance criteria
  // "< 2 detik" gampang terpenuhi.
  useEffect(() => {
    if (!isConfigured) return
    let cancelled = false

    async function load() {
      let bboxes = buildDemoKecamatanBBoxes()
      let usedDemoBoundary = true
      let rings = null
      try {
        // Filter sumber = data ASLI (56 poligon BIG RBI 25K) — JANGAN ikutkan
        // 6 baris dummy (lihat catatan SUMBER_BATAS_RESMI di atas komponen ini).
        const { data, error } = await supabase
          .from('batas_administrasi')
          .select('nama_kecamatan, nama_kelurahan, geom')
          .eq('sumber', SUMBER_BATAS_RESMI)
          .limit(1000)
        if (!error && data?.length) {
          const merged = {}
          const outlineFeatures = []
          data.forEach((row) => {
            const polyRings = extractPolygonRings(row.geom)
            const ring0 = polyRings?.[0]
            const bbox = ring0 ? bboxFromRing(ring0) : null
            if (!bbox || !row.nama_kecamatan) return
            const key = row.nama_kecamatan
            if (!merged[key]) {
              merged[key] = { ...bbox }
            } else {
              merged[key].minLat = Math.min(merged[key].minLat, bbox.minLat)
              merged[key].maxLat = Math.max(merged[key].maxLat, bbox.maxLat)
              merged[key].minLon = Math.min(merged[key].minLon, bbox.minLon)
              merged[key].maxLon = Math.max(merged[key].maxLon, bbox.maxLon)
            }
            polyRings.forEach((ring) => {
              outlineFeatures.push({
                type: 'Feature',
                geometry: { type: 'Polygon', coordinates: [ring] },
                properties: { nama_kecamatan: row.nama_kecamatan, nama_kelurahan: row.nama_kelurahan },
              })
            })
          })
          if (Object.keys(merged).length) {
            bboxes = merged
            usedDemoBoundary = false
            rings = { type: 'FeatureCollection', features: outlineFeatures }
            setKecamatanOptions(Object.keys(merged).sort((a, b) => a.localeCompare(b)))
          }
        }
      } catch {
        // biarkan fallback bbox contoh
      }
      if (cancelled) return
      setUsingDemoBoundary(usedDemoBoundary)
      setBoundaryRings(rings)

      try {
        // fetchAllRows (bukan .limit(4000) saja) — 2.607 baris grid_analisis
        // melebihi cap 1000 baris/request PostgREST, lihat lib/fetchAllRows.js.
        // Fetch sekali di awal, filter kecamatan sesudahnya murni array-filter
        // di memori (lihat filteredGrid useMemo di bawah).
        const { data, error } = await fetchAllRows(() =>
          supabase
            .from('grid_analisis')
            .select('id, geom, kepadatan_penduduk, skor_aksesibilitas_transit, skor_tdi')
            .order('id', { ascending: true })
        )
        const cells = !error
          ? (data ?? [])
              .map((row) => {
                const ring0 = extractPolygonRings(row.geom)?.[0]
                if (!ring0) return null
                const center = ringAveragePoint(ring0)
                const kecamatan =
                  Object.entries(bboxes).find(([, bbox]) => pointInBBox(center, bbox))?.[0] ?? null
                return {
                  ring: ring0,
                  kecamatan,
                  kepadatan_penduduk: row.kepadatan_penduduk,
                  skor_aksesibilitas_transit: row.skor_aksesibilitas_transit,
                  skor_tdi: row.skor_tdi,
                }
              })
              .filter(Boolean)
          : []
        if (!cancelled) {
          if (cells.length) {
            setGridFeatures(cells)
            setUsingDemoGrid(false)
          } else {
            setGridFeatures(buildDemoGrid(bboxes))
            setUsingDemoGrid(true)
          }
        }
      } catch {
        if (!cancelled) {
          setGridFeatures(buildDemoGrid(bboxes))
          setUsingDemoGrid(true)
        }
      }

      try {
        const { data, error } = await supabase
          .from('halte_eksisting')
          .select('id, nama, geom, kecamatan')
          .limit(2000)
        const pts = !error
          ? (data ?? [])
              .map((row) => {
                const coords = extractLatLon(row.geom)
                return coords ? { ...coords, nama: row.nama, kecamatan: row.kecamatan } : null
              })
              .filter(Boolean)
          : []
        if (!cancelled) {
          if (pts.length) {
            setHalteFeatures(pts)
            setUsingDemoHalte(false)
          } else {
            setHalteFeatures(buildDemoHalte(bboxes))
            setUsingDemoHalte(true)
          }
        }
      } catch {
        if (!cancelled) {
          setHalteFeatures(buildDemoHalte(bboxes))
          setUsingDemoHalte(true)
        }
      }
    }

    load()
    return () => {
      cancelled = true
    }
  }, [])

  const filteredGrid = useMemo(
    () => (kecamatanFilter ? gridFeatures.filter((g) => g.kecamatan === kecamatanFilter) : gridFeatures),
    [gridFeatures, kecamatanFilter]
  )
  const filteredHalte = useMemo(
    () => (kecamatanFilter ? halteFeatures.filter((h) => h.kecamatan === kecamatanFilter) : halteFeatures),
    [halteFeatures, kecamatanFilter]
  )

  // Proksi kasar acceptance criteria "filter kecamatan render ulang < 2 detik":
  // ukur dari saat user memilih kecamatan sampai FeatureCollection hasil
  // filter selesai dihitung ulang. qa-tester sebaiknya verifikasi juga lewat
  // devtools performance tab untuk waktu repaint MapLibre yang sesungguhnya.
  useEffect(() => {
    if (filterStartRef.current != null) {
      setLastFilterMs(performance.now() - filterStartRef.current)
      filterStartRef.current = null
    }
  }, [filteredGrid, filteredHalte])

  function handleFilterChange(e) {
    filterStartRef.current = performance.now()
    setKecamatanFilter(e.target.value)
  }

  const kepadatanRange = useMemo(
    () => computeMinMax(gridFeatures.map((g) => g.kepadatan_penduduk)),
    [gridFeatures]
  )
  const gapRange = useMemo(() => computeMinMax(gridFeatures.map((g) => g.skor_tdi)), [gridFeatures])

  const kepadatanGeoJSON = useMemo(
    () => toPolygonFeatureCollection(filteredGrid, (g) => g.kepadatan_penduduk),
    [filteredGrid]
  )
  const gapGeoJSON = useMemo(
    () => toPolygonFeatureCollection(filteredGrid, (g) => g.skor_tdi),
    [filteredGrid]
  )
  // Outline batas kecamatan (poligon ASLI, bukan bbox) — kalau ada filter
  // aktif, cuma tampilkan poligon kecamatan terpilih supaya jelas secara
  // visual area mana yang sedang difilter di layer lain.
  const boundaryGeoJSON = useMemo(() => {
    if (!boundaryRings) return { type: 'FeatureCollection', features: [] }
    if (!kecamatanFilter) return boundaryRings
    return {
      type: 'FeatureCollection',
      features: boundaryRings.features.filter((f) => f.properties.nama_kecamatan === kecamatanFilter),
    }
  }, [boundaryRings, kecamatanFilter])

  const transitGeoJSON = useMemo(
    () => ({
      type: 'FeatureCollection',
      features: filteredHalte.map((h) => ({
        type: 'Feature',
        geometry: { type: 'Point', coordinates: [h.lon, h.lat] },
        properties: { nama: h.nama || 'Halte' },
      })),
    }),
    [filteredHalte]
  )

  const activeRange = choroplethLayer === 'kepadatan' ? kepadatanRange : gapRange
  // Batas kelas diskret + ekspresi 'step' MapLibre untuk fill-color (menggantikan
  // 'interpolate' gradient kontinu supaya tiap kelas tampil sebagai blok warna
  // terpisah — lebih mudah dibedakan, termasuk bagi pengguna CVD).
  const activeBreaks = useMemo(() => classBreaks(activeRange, CLASS_COUNT), [activeRange])
  const fillColorExpr = useMemo(() => {
    const expr = ['step', ['get', 'value'], CHOROPLETH_COLORS[0]]
    activeBreaks.forEach((b, i) => expr.push(b, CHOROPLETH_COLORS[i + 1]))
    return expr
  }, [activeBreaks])
  const legendClasses = useMemo(() => {
    const bounds = [activeRange[0], ...activeBreaks, activeRange[1]]
    return CHOROPLETH_COLORS.map((color, i) => ({
      color,
      label: `${fmtBound(bounds[i])} – ${fmtBound(bounds[i + 1])}`,
    }))
  }, [activeRange, activeBreaks])

  const layers = useMemo(() => {
    const arr = [
      {
        id: 'analisis-choropleth',
        type: 'fill',
        data: choroplethLayer === 'kepadatan' ? kepadatanGeoJSON : gapGeoJSON,
        paint: {
          'fill-color': fillColorExpr,
          'fill-opacity': 0.65,
          'fill-outline-color': 'rgba(255,255,255,0.6)',
        },
      },
    ]
    // Outline batas kecamatan asli — hanya ditampilkan kalau data asli sudah
    // termuat (boundaryRings != null); mode demo tidak menggambar batas bbox
    // kasar sebagai garis kecamatan supaya tidak menyesatkan secara visual.
    if (boundaryRings) {
      arr.push({
        id: 'analisis-batas-kecamatan',
        type: 'line',
        data: boundaryGeoJSON,
        paint: {
          'line-color': '#334155',
          'line-width': kecamatanFilter ? 2.5 : 1,
          'line-opacity': kecamatanFilter ? 0.9 : 0.5,
        },
      })
    }
    if (transitVisible) {
      arr.push({
        id: 'analisis-transit',
        type: 'circle',
        data: transitGeoJSON,
        paint: {
          'circle-radius': 5,
          'circle-color': '#6b21a8',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      })
    }
    return arr
  }, [
    choroplethLayer,
    kepadatanGeoJSON,
    gapGeoJSON,
    fillColorExpr,
    boundaryRings,
    boundaryGeoJSON,
    kecamatanFilter,
    transitVisible,
    transitGeoJSON,
  ])

  const usingDemoAny = usingDemoGrid || usingDemoHalte

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <SlidersHorizontal size={18} className="text-brand-orange" />
        <h2 className="font-semibold text-slate-800">Analisis Spasial</h2>
      </div>

      {!isConfigured && (
        <div className="mx-4 mt-3 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">
          Belum tersambung ke Supabase — menampilkan grid & halte contoh.
        </div>
      )}
      {isConfigured && usingDemoAny && (
        <div className="mx-4 mt-3 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">
          Sebagian tabel (<code>grid_analisis</code>/<code>halte_eksisting</code>) masih kosong —
          layer terkait menampilkan data contoh.
        </div>
      )}

      <div className="px-4 pt-3 space-y-2.5">
        <div>
          <label className="text-[11px] font-medium text-slate-500 block mb-1">Filter kecamatan</label>
          <select
            value={kecamatanFilter}
            onChange={handleFilterChange}
            className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue"
          >
            <option value="">Semua Kecamatan</option>
            {kecamatanOptions.map((k) => (
              <option key={k} value={k}>{k}</option>
            ))}
          </select>
        </div>

        {/* TODO(ui-ux-designer): kontrol layer masih radio/checkbox native
            polos, belum disesuaikan sistem desain final. */}
        <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-xs text-slate-600">
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="analisis-choropleth"
              checked={choroplethLayer === 'kepadatan'}
              onChange={() => {
                setChoroplethLayer('kepadatan')
                setTdiResult(null)
              }}
            />
            Kepadatan Penduduk
          </label>
          <label className="flex items-center gap-1.5 cursor-pointer">
            <input
              type="radio"
              name="analisis-choropleth"
              checked={choroplethLayer === 'gap'}
              onChange={() => setChoroplethLayer('gap')}
            />
            Indeks Gap Aksesibilitas
          </label>
        </div>
        <label className="flex items-center gap-1.5 text-xs text-slate-600 cursor-pointer">
          <input
            type="checkbox"
            checked={transitVisible}
            onChange={(e) => setTransitVisible(e.target.checked)}
          />
          Jaringan Transit Eksisting
        </label>

        {lastFilterMs != null && (
          <p className="text-[10px] text-slate-400">
            Filter diterapkan dalam {lastFilterMs.toFixed(0)} ms (target &lt; 2000 ms)
          </p>
        )}
      </div>

      <div className="flex-1 min-h-[220px] px-4 pb-2 pt-3">
        <div className="w-full h-full rounded-lg overflow-hidden border border-slate-200">
          <MapView layers={layers} onMapClick={handleMapClick}>
            {choroplethLayer === 'gap' && (
              <TdiScorePanel
                loading={tdiLoading}
                result={tdiResult}
                usingDemo={tdiUsingDemo}
                onClose={() => setTdiResult(null)}
              />
            )}
          </MapView>
        </div>
        {choroplethLayer === 'gap' && !tdiResult && !tdiLoading && (
          <p className="text-[10px] text-slate-400 mt-1">
            Klik sebuah sel pada peta untuk melihat rincian kontribusi tiap komponen TDI.
          </p>
        )}
      </div>

      <div className="px-4 pb-4 space-y-2 text-xs text-slate-500 border-t border-slate-100 pt-3">
        <div className="space-y-1.5">
          <p className="font-medium text-slate-600">
            {choroplethLayer === 'kepadatan'
              ? 'Kepadatan penduduk (jiwa/km²): rendah → tinggi'
              : 'Indeks gap aksesibilitas (TDI): rendah → tinggi — kelas tertinggi = paling "transit desert"'}
          </p>
          <ul className="space-y-1">
            {legendClasses.map((c, i) => (
              <li key={c.color} className="flex items-center gap-2">
                <span
                  className="inline-block w-6 h-3 rounded-sm shrink-0 border border-slate-300"
                  style={{ background: c.color }}
                />
                <span className="tabular-nums">
                  Kelas {i + 1} · {c.label}
                </span>
              </li>
            ))}
          </ul>
          <p className="text-[10px] text-slate-400">
            Palet sequential colorblind-safe (ColorBrewer YlGnBu). Kelas dibedakan
            lewat nomor &amp; rentang angka, tidak bergantung pada warna saja.
          </p>
        </div>
        {transitVisible && (
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full bg-[#6b21a8] border border-white shadow shrink-0" />
            <span>Halte / titik transit eksisting</span>
          </div>
        )}
        {boundaryRings && (
          <div className="flex items-center gap-2">
            <span className="inline-block w-8 h-0.5 bg-slate-600 shrink-0" />
            <span>Batas kecamatan (BIG RBI 25K, poligon asli)</span>
          </div>
        )}
        <p className="text-[10px] text-slate-400 pt-1">
          {filteredGrid.length} grid · {filteredHalte.length} titik transit ditampilkan
          {usingDemoBoundary
            ? ' · batas kecamatan: belum termuat, memakai pendekatan bounding box contoh'
            : ' · atribusi grid/halte ke kecamatan memakai pendekatan bounding box dari poligon asli (bukan point-in-polygon presisi)'}
        </p>
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { SlidersHorizontal } from 'lucide-react'
import MapView from '../Map/MapView'
import { supabase, isConfigured } from '../../lib/supabaseClient'
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
 *  - Indeks gap aksesibilitas (choropleth grid_analisis.skor_tdi — TDI dihitung
 *    data-ai-analyst, frontend HANYA menampilkan apa adanya)
 *  - Jaringan transit eksisting (titik halte_eksisting)
 * Filter per kecamatan wajib render ulang < 2 detik (acceptance criteria).
 * Karena grid_analisis tidak (belum) punya kolom kecamatan langsung, filter
 * di sini pakai pendekatan bounding-box per kecamatan dari batas_administrasi
 * (lihat komentar bboxFromRing di lib/geo.js) — bukan point-in-polygon presisi.
 * Ini murni navigasi/filter UI, BUKAN penghitungan ulang CAI/TDI/Equity Index.
 */

// TODO(ui-ux-designer): skema warna choropleth di bawah masih asumsi wajar
// (bukan hasil keputusan visual resmi) — sesuaikan kalau ada arahan palet.
const KEPADATAN_COLORS = ['#fef0d9', '#b30000']
const GAP_COLORS = ['#1a9850', '#d73027']

// Perkiraan cakupan wilayah Kota Bekasi — dipakai untuk membangun grid & bbox
// kecamatan CONTOH (dummy) saat Supabase belum terisi. Bukan batas administratif
// resmi, hanya kotak pembagi visual untuk demo.
const BEKASI_BBOX = { minLat: -6.35, maxLat: -6.15, minLon: 106.95, maxLon: 107.12 }

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
  const [gridFeatures, setGridFeatures] = useState(() => buildDemoGrid(buildDemoKecamatanBBoxes()))
  const [usingDemoGrid, setUsingDemoGrid] = useState(!isConfigured)
  const [halteFeatures, setHalteFeatures] = useState(() => buildDemoHalte(buildDemoKecamatanBBoxes()))
  const [usingDemoHalte, setUsingDemoHalte] = useState(!isConfigured)

  const [lastFilterMs, setLastFilterMs] = useState(null)
  const filterStartRef = useRef(null)

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
      try {
        const { data, error } = await supabase
          .from('batas_administrasi')
          .select('nama_kecamatan, geom')
          .limit(1000)
        if (!error && data?.length) {
          const merged = {}
          data.forEach((row) => {
            const ring0 = extractPolygonRings(row.geom)?.[0]
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
          })
          if (Object.keys(merged).length) {
            bboxes = merged
            usedDemoBoundary = false
          }
        }
      } catch {
        // biarkan fallback bbox contoh
      }
      if (cancelled) return
      setUsingDemoBoundary(usedDemoBoundary)

      try {
        const { data, error } = await supabase
          .from('grid_analisis')
          .select('id, geom, kepadatan_penduduk, skor_aksesibilitas_transit, skor_tdi')
          .limit(4000)
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
  const activeColors = choroplethLayer === 'kepadatan' ? KEPADATAN_COLORS : GAP_COLORS

  const layers = useMemo(() => {
    const arr = [
      {
        id: 'analisis-choropleth',
        type: 'fill',
        data: choroplethLayer === 'kepadatan' ? kepadatanGeoJSON : gapGeoJSON,
        paint: {
          'fill-color': [
            'interpolate',
            ['linear'],
            ['get', 'value'],
            activeRange[0],
            activeColors[0],
            activeRange[1],
            activeColors[1],
          ],
          'fill-opacity': 0.55,
          'fill-outline-color': 'rgba(255,255,255,0.5)',
        },
      },
    ]
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
  }, [choroplethLayer, kepadatanGeoJSON, gapGeoJSON, activeRange, activeColors, transitVisible, transitGeoJSON])

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
            {KECAMATAN_KOTA_BEKASI.map((k) => (
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
              onChange={() => setChoroplethLayer('kepadatan')}
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
          <MapView layers={layers} />
        </div>
      </div>

      <div className="px-4 pb-4 space-y-2 text-xs text-slate-500 border-t border-slate-100 pt-3">
        <div className="flex items-center gap-2">
          <span
            className="inline-block w-8 h-3 rounded-sm shrink-0"
            style={{ background: `linear-gradient(to right, ${activeColors[0]}, ${activeColors[1]})` }}
          />
          <span>
            {choroplethLayer === 'kepadatan'
              ? 'Kepadatan penduduk: rendah → tinggi'
              : 'Indeks gap aksesibilitas (TDI): rendah → tinggi (makin merah = makin "transit desert")'}
          </span>
        </div>
        {transitVisible && (
          <div className="flex items-center gap-2">
            <span className="inline-block w-3 h-3 rounded-full bg-[#6b21a8] border border-white shadow shrink-0" />
            <span>Halte / titik transit eksisting</span>
          </div>
        )}
        <p className="text-[10px] text-slate-400 pt-1">
          {filteredGrid.length} grid · {filteredHalte.length} titik transit ditampilkan
          {usingDemoBoundary ? ' · batas kecamatan: pendekatan bounding box contoh' : ''}
        </p>
      </div>
    </div>
  )
}

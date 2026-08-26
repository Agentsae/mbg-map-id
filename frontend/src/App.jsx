import { useCallback, useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Map as MapIcon,
  SlidersHorizontal,
  Sparkles,
  MousePointerClick,
  Lightbulb,
  FileDown,
  Settings,
} from 'lucide-react'
import MapView from './components/Map/MapView'
import CaiScorePanel from './components/Map/CaiScorePanel'
import AIPanel from './components/AIPanel/AIPanel'
import AnalisisSpasial from './components/AnalisisSpasial/AnalisisSpasial'
import SimulationPanel from './components/SimulationMode/SimulationPanel'
import Dashboard from './components/Dashboard/Dashboard'
import EquityIndexView from './components/EquityIndexView/EquityIndexView'
import ComingSoon from './components/ComingSoon/ComingSoon'
import { supabase, isConfigured } from './lib/supabaseClient'
import { extractLatLon, findNearestPoint } from './lib/geo'
import { isSurveyPlaceholderPoint } from './lib/titikKandidat'

// 8 menu sidebar sesuai wireframe resmi PRD (Gambar 3, lihat CLAUDE.md).
// Menu yang belum punya komponen nyata dipetakan ke ComingSoon di bawah —
// jangan ditinggal jadi link mati, tapi juga jangan dibangun lebih dulu
// dari jadwal fase (lihat docs/BUILD_CHECKLIST.md).
const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'peta', label: 'Peta Interaktif', icon: MapIcon },
  { id: 'analisis', label: 'Analisis Spasial', icon: SlidersHorizontal },
  { id: 'ai', label: 'AI Spatial Consultant', icon: Sparkles },
  { id: 'simulasi', label: 'Simulasi Skenario', icon: MousePointerClick },
  { id: 'rekomendasi', label: 'Rekomendasi', icon: Lightbulb },
  { id: 'data-laporan', label: 'Data & Laporan', icon: FileDown },
  { id: 'pengaturan', label: 'Pengaturan', icon: Settings },
]

const DEMO_SIMULATION_RESULT = {
  penduduk_terlayani_400m: 3120,
  penduduk_terlayani_800m: 9840,
  estimasi_pengurangan_waktu_tempuh_menit: 6.5,
  fasilitas_pendidikan_400m: 2,
  fasilitas_kesehatan_400m: 1,
  transit_eksisting_terdekat: { nama: 'Halte Summarecon Bekasi (contoh)', jarak_m: 520 },
}

// Data contoh titik_kandidat + skor_cai — dipakai kalau Supabase belum
// tersambung/tabel masih kosong, supaya fitur "klik peta -> skor CAI" tetap
// bisa didemokan. Struktur field sengaja meniru kolom asli skor_cai
// (migration 001_init_tables.sql) — TIDAK ada formula dihitung di sini,
// murni angka contoh statis.
const DEMO_CAI_POINTS = [
  {
    lat: -6.2185, lon: 107.0074,
    titik: { id_titik_survei: 'KND-DEMO-001', deskripsi_lokasi: 'Depan Summarecon Mall Bekasi (contoh)', kecamatan: 'Bekasi Utara', kelurahan: 'Marga Mulya', catatan: null },
    skor: { n_kepadatan: 0.82, n_jarak_inv: 0.55, n_volume: 0.70, n_survei: 0.60, bobot_kepadatan: 0.35, bobot_jarak: 0.25, bobot_volume: 0.25, bobot_survei: 0.15, skor_final: 0.69 },
  },
  {
    lat: -6.2461, lon: 107.0021,
    titik: { id_titik_survei: 'KND-DEMO-002', deskripsi_lokasi: 'Simpang Jl. Ir. H. Juanda (contoh)', kecamatan: 'Bekasi Timur', kelurahan: 'Margahayu', catatan: null },
    skor: { n_kepadatan: 0.90, n_jarak_inv: 0.70, n_volume: 0.20, n_survei: 0.55, bobot_kepadatan: 0.35, bobot_jarak: 0.25, bobot_volume: 0.25, bobot_survei: 0.15, skor_final: 0.62 },
  },
  {
    lat: -6.2603, lon: 107.0324,
    titik: { id_titik_survei: 'KND-DEMO-003', deskripsi_lokasi: 'Terminal Bekasi (contoh)', kecamatan: 'Bekasi Selatan', kelurahan: 'Margajaya', catatan: null },
    skor: { n_kepadatan: 0.65, n_jarak_inv: 0.40, n_volume: 0.85, n_survei: 0.75, bobot_kepadatan: 0.35, bobot_jarak: 0.25, bobot_volume: 0.25, bobot_survei: 0.15, skor_final: 0.65 },
  },
  {
    lat: -6.2825, lon: 107.0450,
    titik: { id_titik_survei: 'KND-DEMO-004', deskripsi_lokasi: 'Perempatan Rawa Lumbu (contoh)', kecamatan: 'Rawa Lumbu', kelurahan: 'Sepanjang Jaya', catatan: null },
    skor: { n_kepadatan: 0.75, n_jarak_inv: 0.80, n_volume: 0.15, n_survei: 0.40, bobot_kepadatan: 0.35, bobot_jarak: 0.25, bobot_volume: 0.25, bobot_survei: 0.15, skor_final: 0.55 },
  },
  {
    lat: -6.2989, lon: 107.0658,
    titik: { id_titik_survei: 'KND-DEMO-005', deskripsi_lokasi: 'Jl. Raya Mustika Jaya (contoh)', kecamatan: 'Mustika Jaya', kelurahan: 'Mustika Jaya', catatan: null },
    skor: { n_kepadatan: 0.88, n_jarak_inv: 0.85, n_volume: 0.10, n_survei: 0.35, bobot_kepadatan: 0.35, bobot_jarak: 0.25, bobot_volume: 0.25, bobot_survei: 0.15, skor_final: 0.58 },
  },
]

// Warna marker titik_kandidat di peta — dibedakan sederhana antara titik yang
// skornya sepenuhnya final vs titik baru yang sebagian kriterianya masih
// proxy/placeholder (lihat isSurveyPlaceholderPoint). Palet & bentuk akhir
// TODO(ui-ux-designer): ini asumsi sementara, bukan keputusan desain final.
const CANDIDATE_MARKER_COLOR = '#2E7D5B'
const CANDIDATE_MARKER_COLOR_PLACEHOLDER = '#B5851B'

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function buildCandidatePopupHtml(titik) {
  const lines = []
  if (titik?.deskripsi_lokasi) lines.push(`<strong>${escapeHtml(titik.deskripsi_lokasi)}</strong>`)
  const wilayah = [titik?.kelurahan, titik?.kecamatan].filter(Boolean).join(', ')
  if (wilayah) lines.push(escapeHtml(wilayah))
  if (isSurveyPlaceholderPoint(titik?.id_titik_survei)) {
    lines.push('<em>Sebagian kriteria skor masih data sementara</em>')
  }
  if (titik?.catatan) {
    lines.push(escapeHtml(titik.catatan))
  }
  lines.push('<span style="color:#64748b">Klik untuk lihat rincian skor CAI</span>')
  return lines.join('<br/>')
}

export default function App() {
  const [activeTab, setActiveTab] = useState('peta')

  // --- Simulasi What-If ---
  const [simulationActive, setSimulationActive] = useState(false)
  const [simLoading, setSimLoading] = useState(false)
  const [simResult, setSimResult] = useState(null)

  // --- Skor CAI per klik lokasi (Fase 2 — Composite Accessibility Index) ---
  const [caiLoading, setCaiLoading] = useState(false)
  const [caiResult, setCaiResult] = useState(null)
  const [caiUsingDemo, setCaiUsingDemo] = useState(!isConfigured)

  // Daftar titik_kandidat + skor_cai — di-fetch sekali di awal supaya klik peta
  // instan (tidak query ulang tiap klik) DAN supaya bisa dirender sebagai marker
  // di peta (state, bukan ref, karena harus memicu render ulang marker). Ini
  // murni membaca hasil yang sudah dihitung data-ai-analyst, bukan menghitung
  // ulang formula CAI di frontend. Query TANPA filter/limit ketat (limit 500
  // jauh di atas jumlah baris riil saat ini) supaya seluruh titik_kandidat
  // ikut, bukan subset.
  const [caiPoints, setCaiPoints] = useState({ points: DEMO_CAI_POINTS, usingDemo: !isConfigured })

  // Marker tunggal untuk lokasi yang baru diklik bebas (dipakai kedua mode:
  // simulasi & cek skor CAI di lokasi non-titik-kandidat)
  const [clickMarker, setClickMarker] = useState(null)

  useEffect(() => {
    if (!isConfigured) return

    supabase
      .from('titik_kandidat')
      .select(
        'id, id_titik_survei, deskripsi_lokasi, kecamatan, kelurahan, catatan, geom, ' +
        'skor_cai(n_kepadatan, n_jarak_inv, n_volume, n_survei, ' +
        'bobot_kepadatan, bobot_jarak, bobot_volume, bobot_survei, skor_final)'
      )
      .limit(500)
      .then(({ data, error }) => {
        if (error || !data?.length) {
          setCaiPoints({ points: DEMO_CAI_POINTS, usingDemo: true })
          return
        }
        const points = data
          .map((row) => {
            const coords = extractLatLon(row.geom)
            if (!coords) return null
            const skorRow = Array.isArray(row.skor_cai) ? row.skor_cai[0] : row.skor_cai
            if (!skorRow) return null
            return {
              lat: coords.lat,
              lon: coords.lon,
              titik: {
                id_titik_survei: row.id_titik_survei,
                deskripsi_lokasi: row.deskripsi_lokasi,
                kecamatan: row.kecamatan,
                kelurahan: row.kelurahan,
                catatan: row.catatan,
              },
              skor: skorRow,
            }
          })
          .filter(Boolean)

        setCaiPoints(
          points.length
            ? { points, usingDemo: false }
            : { points: DEMO_CAI_POINTS, usingDemo: true }
        )
      })
  }, [])

  const handleMapClick = useCallback(async ({ lat, lon }) => {
    if (simulationActive) {
      // --- Alur Simulasi What-If (RPC simulate_new_stop) ---
      setSimLoading(true)
      setCaiResult(null)
      setClickMarker({ lat, lon, color: '#E08A1E', popupText: 'Lokasi simulasi' })

      try {
        if (isConfigured) {
          const { data, error } = await supabase.rpc('simulate_new_stop', { lat, lon })
          if (error) throw error
          setSimResult(data)
        } else {
          await new Promise((r) => setTimeout(r, 500))
          setSimResult(DEMO_SIMULATION_RESULT)
        }
      } catch (err) {
        console.error('Gagal menjalankan simulate_new_stop:', err)
        setSimResult(null)
      } finally {
        setSimLoading(false)
      }
      return
    }

    // --- Alur skor CAI (klik lokasi -> cari titik_kandidat terdekat) ---
    setCaiLoading(true)
    setSimResult(null)
    setClickMarker({ lat, lon, color: '#1B659D', popupText: 'Lokasi dicek' })

    const nearest = findNearestPoint(caiPoints.points, { lat, lon })

    setCaiUsingDemo(caiPoints.usingDemo)
    setCaiResult(
      nearest
        ? { skor: nearest.point.skor, titik: nearest.point.titik, distance_m: nearest.distance_m }
        : { skor: null }
    )
    setCaiLoading(false)
  }, [simulationActive, caiPoints])

  function handleToggleSimulation() {
    setSimulationActive((v) => !v)
    if (simulationActive) {
      // matikan mode -> bersihkan hasil supaya tidak membingungkan sesi berikutnya
      setSimResult(null)
      setClickMarker(null)
    } else {
      setCaiResult(null)
    }
  }

  const showPanel = activeTab !== 'peta'

  // Marker visual untuk seluruh titik_kandidat (supaya user LIHAT titik di peta
  // dulu, bukan menebak lokasi lalu klik "buta") + marker lokasi yang baru
  // diklik bebas (kalau ada). Klik langsung pada marker titik kandidat memanggil
  // handleMapClick di koordinat titik itu sendiri (nearest-search akan
  // menemukan dirinya sendiri, distance ~0m).
  const candidateMarkers = caiPoints.points.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    color: isSurveyPlaceholderPoint(p.titik?.id_titik_survei)
      ? CANDIDATE_MARKER_COLOR_PLACEHOLDER
      : CANDIDATE_MARKER_COLOR,
    popupHtml: buildCandidatePopupHtml(p.titik),
    onClick: () => handleMapClick({ lat: p.lat, lon: p.lon }),
  }))
  const markers = clickMarker ? [...candidateMarkers, clickMarker] : candidateMarkers

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 bg-brand-blue text-white shrink-0">
        <div className="w-8 h-8 rounded-md bg-white/15 flex items-center justify-center font-bold">
          GI
        </div>
        <div>
          <h1 className="font-semibold leading-tight">GeoTransit Insight</h1>
          <p className="text-xs text-white/70 leading-tight">Kota Bekasi — Tim MBG</p>
        </div>
        {!isConfigured && (
          <span className="ml-auto text-xs bg-amber-400/20 text-amber-100 border border-amber-300/40 rounded-full px-3 py-1">
            Mode demo — Supabase belum tersambung
          </span>
        )}
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar nav — 8 menu sesuai wireframe PRD (Gambar 3) */}
        <nav className="w-16 shrink-0 bg-white border-r border-slate-200 flex flex-col items-center py-3 gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              title={label}
              className={
                'w-12 h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] transition ' +
                (activeTab === id
                  ? 'bg-brand-blue/10 text-brand-blue'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600')
              }
            >
              <Icon size={18} />
            </button>
          ))}
        </nav>

        {/* Map */}
        <main className="flex-1 relative">
          <MapView simulationMode={simulationActive} onMapClick={handleMapClick} markers={markers}>
            <CaiScorePanel
              loading={caiLoading}
              result={caiResult}
              usingDemo={caiUsingDemo}
              onClose={() => {
                setCaiResult(null)
                setClickMarker(null)
              }}
            />
          </MapView>
        </main>

        {/* Right panel */}
        {showPanel && (
          <aside className="w-96 shrink-0 bg-white border-l border-slate-200 overflow-hidden">
            {activeTab === 'dashboard' && <Dashboard />}
            {activeTab === 'analisis' && <AnalisisSpasial />}
            {activeTab === 'ai' && <AIPanel />}
            {activeTab === 'simulasi' && (
              <SimulationPanel
                active={simulationActive}
                onToggle={handleToggleSimulation}
                loading={simLoading}
                result={simResult}
              />
            )}
            {activeTab === 'rekomendasi' && <EquityIndexView />}
            {activeTab === 'data-laporan' && (
              <ComingSoon
                icon={FileDown}
                title="Data & Laporan"
                description="Export ringkasan peta + indikator kunci sebagai PDF/gambar — jadwal Fase 4."
                plannedPhase="Fase 4"
              />
            )}
            {activeTab === 'pengaturan' && (
              <ComingSoon
                icon={Settings}
                title="Pengaturan"
                description="Preferensi tampilan & konfigurasi akun — belum masuk jalur kritis submission."
                plannedPhase="Belum dijadwalkan"
              />
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

import { useState, useCallback } from 'react'
import { Layers, Sparkles, MousePointerClick, BarChart3, Scale } from 'lucide-react'
import MapView from './components/Map/MapView'
import AIPanel from './components/AIPanel/AIPanel'
import SimulationPanel from './components/SimulationMode/SimulationPanel'
import Dashboard from './components/Dashboard/Dashboard'
import EquityIndexView from './components/EquityIndexView/EquityIndexView'
import { supabase, isConfigured } from './lib/supabaseClient'

const TABS = [
  { id: 'peta', label: 'Peta', icon: Layers },
  { id: 'ai', label: 'AI Insight', icon: Sparkles },
  { id: 'simulasi', label: 'Simulasi', icon: MousePointerClick },
  { id: 'dashboard', label: 'Dashboard', icon: BarChart3 },
  { id: 'equity', label: 'Equity Index', icon: Scale },
]

const DEMO_SIMULATION_RESULT = {
  penduduk_terlayani_400m: 3120,
  penduduk_terlayani_800m: 9840,
  estimasi_pengurangan_waktu_tempuh_menit: 6.5,
  fasilitas_pendidikan_400m: 2,
  fasilitas_kesehatan_400m: 1,
  transit_eksisting_terdekat: { nama: 'Halte Summarecon Bekasi (contoh)', jarak_m: 520 },
}

export default function App() {
  const [activeTab, setActiveTab] = useState('peta')
  const [simulationActive, setSimulationActive] = useState(false)
  const [simLoading, setSimLoading] = useState(false)
  const [simResult, setSimResult] = useState(null)
  const [simMarker, setSimMarker] = useState(null)

  const handleMapClick = useCallback(async ({ lat, lon }) => {
    setSimLoading(true)
    setSimMarker({ lat, lon, color: '#E08A1E', popupText: 'Lokasi simulasi' })

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
  }, [])

  function handleToggleSimulation() {
    setSimulationActive((v) => !v)
    if (simulationActive) {
      // matikan mode -> bersihkan hasil supaya tidak membingungkan sesi berikutnya
      setSimResult(null)
      setSimMarker(null)
    }
  }

  const showPanel = activeTab !== 'peta'
  const markers = simMarker ? [simMarker] : []

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
        {/* Sidebar nav */}
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
          <MapView
            simulationMode={simulationActive}
            onMapClick={handleMapClick}
            markers={markers}
          />
        </main>

        {/* Right panel */}
        {showPanel && (
          <aside className="w-96 shrink-0 bg-white border-l border-slate-200 overflow-hidden">
            {activeTab === 'ai' && <AIPanel />}
            {activeTab === 'simulasi' && (
              <SimulationPanel
                active={simulationActive}
                onToggle={handleToggleSimulation}
                loading={simLoading}
                result={simResult}
              />
            )}
            {activeTab === 'dashboard' && <Dashboard />}
            {activeTab === 'equity' && <EquityIndexView />}
          </aside>
        )}
      </div>
    </div>
  )
}

import { useState } from 'react'
import { MousePointerClick, Users, Clock, School, HeartPulse, Play } from 'lucide-react'

// Skenario preset sesuai wireframe PRD (Gambar 6 / Bab 10.2: "dropdown pilihan
// skenario" + tombol "Lihat Hasil Simulasi"). Tiap preset hanya mengisi
// lokasi (+radius implisit lewat RPC) lalu memanggil alur simulate_new_stop
// yang SAMA dengan klik peta — acceptance criteria Bab 8 sudah terpenuhi lewat
// klik, ini murni pemandu presentasi. Koordinat = titik referensi umum Kota
// Bekasi (bukan hasil analisis skor).
// Catatan 2026-09-05: hanya 3 preset — sebelumnya ada 5, tapi 'mustikajaya'
// (~2.764 m di luar batas) dan 'rawalumbu' (~768 m di luar batas) dihapus
// setelah point-in-polygon check terhadap frontend/src/data/bekasi_boundary.geojson
// menunjukkan koordinatnya jatuh di luar batas Kota Bekasi. Jangan ganti dengan
// preset baru tanpa verifikasi in-boundary yang sama.
const PRESET_SKENARIO = [
  { id: 'bantargebang', label: 'Halte baru — Bantargebang (sekitar TPA)', lat: -6.3130, lon: 106.9990 },
  { id: 'terminalbekasi', label: 'Halte baru — Terminal Bekasi', lat: -6.2603, lon: 107.0024 },
  { id: 'summarecon', label: 'Halte baru — Summarecon Bekasi', lat: -6.2285, lon: 107.0080 },
]

/**
 * SimulationPanel — menampilkan hasil dari RPC simulate_new_stop, plus dropdown
 * skenario preset (wireframe PRD Gambar 6). Logic pemanggilan RPC ada di App.jsx
 * (supaya klik peta, preset, & panel ini berbagi state yang sama); komponen ini
 * hampir sepenuhnya presentasional — hanya menyimpan pilihan dropdown lokal.
 */
export default function SimulationPanel({ active, onToggle, loading, result, onRunPreset }) {
  const [presetId, setPresetId] = useState('')
  const preset = PRESET_SKENARIO.find((p) => p.id === presetId)

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <MousePointerClick size={18} className="text-brand-orange" />
        <h2 className="font-semibold text-slate-800">Simulasi What-If</h2>
      </div>

      <div className="p-4 space-y-4">
        <button
          onClick={onToggle}
          className={
            'w-full rounded-md px-3 py-2 text-sm font-medium transition ' +
            (active
              ? 'bg-brand-orange text-white'
              : 'bg-slate-100 text-slate-700 hover:bg-slate-200')
          }
        >
          {active ? 'Mode simulasi aktif — klik peta' : 'Aktifkan mode simulasi'}
        </button>

        {/* Dropdown skenario preset (wireframe PRD Gambar 6). Alternatif dari
            klik-peta manual: pilih skenario -> "Lihat Hasil Simulasi". */}
        <div className="rounded-md border border-slate-200 p-3 space-y-2">
          <label className="text-[11px] font-medium text-slate-500 block">
            Atau pilih skenario preset
          </label>
          {/* TODO(ui-ux-designer): select native polos, belum disesuaikan sistem desain final. */}
          <select
            value={presetId}
            onChange={(e) => setPresetId(e.target.value)}
            className="w-full text-sm border border-slate-300 rounded-md px-2 py-1.5 bg-white focus:outline-none focus:ring-2 focus:ring-brand-blue"
          >
            <option value="">— pilih skenario —</option>
            {PRESET_SKENARIO.map((p) => (
              <option key={p.id} value={p.id}>{p.label}</option>
            ))}
          </select>
          <button
            type="button"
            disabled={!preset || loading || !onRunPreset}
            onClick={() =>
              preset && onRunPreset?.({ lat: preset.lat, lon: preset.lon, popupText: preset.label })
            }
            className="w-full flex items-center justify-center gap-1.5 rounded-md px-3 py-2 text-sm font-medium bg-brand-blue text-white disabled:opacity-40"
          >
            <Play size={14} /> Lihat Hasil Simulasi
          </button>
        </div>

        {loading && <p className="text-sm text-slate-400">Menghitung dampak lokasi...</p>}

        {!loading && !result && (
          <p className="text-sm text-slate-400">
            Aktifkan mode simulasi, lalu klik titik di peta untuk melihat proyeksi dampak
            penambahan halte baru di lokasi tersebut.
          </p>
        )}

        {result?.di_luar_area_analisis && (
          <div className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-800">
            Titik di luar area analisis.
            <span className="block mt-1 text-xs text-amber-700">{result.catatan}</span>
            <span className="block mt-1 text-xs text-amber-600">
              Jarak ke grid analisis terdekat:{' '}
              {result.jarak_ke_grid_terdekat_m?.toLocaleString('id-ID')} m (ambang{' '}
              {result.ambang_luar_area_m} m).
            </span>
          </div>
        )}

        {result && !result.di_luar_area_analisis && (
          <div className="space-y-3">
            <StatRow
              icon={<Users size={16} />}
              label="Penduduk terlayani (400m)"
              value={result.penduduk_terlayani_400m?.toLocaleString('id-ID')}
            />
            <StatRow
              icon={<Users size={16} />}
              label="Penduduk terlayani (800m)"
              value={result.penduduk_terlayani_800m?.toLocaleString('id-ID')}
            />
            <StatRow
              icon={<Clock size={16} />}
              label="Estimasi pengurangan waktu tempuh"
              value={`${result.estimasi_pengurangan_waktu_tempuh_menit ?? '-'} menit`}
            />
            <StatRow
              icon={<School size={16} />}
              label="Fasilitas pendidikan (400m)"
              value={result.fasilitas_pendidikan_400m}
            />
            <StatRow
              icon={<HeartPulse size={16} />}
              label="Fasilitas kesehatan (400m)"
              value={result.fasilitas_kesehatan_400m}
            />
            {result.transit_eksisting_terdekat?.nama && (
              <p className="text-xs text-slate-400 pt-2 border-t border-slate-200">
                Transit eksisting terdekat: {result.transit_eksisting_terdekat.nama} (
                {result.transit_eksisting_terdekat.jarak_m} m)
              </p>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

function StatRow({ icon, label, value }) {
  return (
    <div className="flex items-center justify-between bg-slate-50 rounded-md px-3 py-2">
      <span className="flex items-center gap-2 text-sm text-slate-600">
        {icon} {label}
      </span>
      <span className="font-mono text-sm font-semibold text-brand-blue">{value ?? '-'}</span>
    </div>
  )
}

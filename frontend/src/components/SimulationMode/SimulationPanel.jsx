import { MousePointerClick, Users, Clock, School, HeartPulse } from 'lucide-react'

/**
 * SimulationPanel — menampilkan hasil dari RPC simulate_new_stop.
 * Logic pemanggilan RPC ada di App.jsx (supaya klik peta & panel ini
 * berbagi state yang sama); komponen ini murni presentasional.
 */
export default function SimulationPanel({ active, onToggle, loading, result }) {
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

        {loading && <p className="text-sm text-slate-400">Menghitung dampak lokasi...</p>}

        {!loading && !result && (
          <p className="text-sm text-slate-400">
            Aktifkan mode simulasi, lalu klik titik di peta untuk melihat proyeksi dampak
            penambahan halte baru di lokasi tersebut.
          </p>
        )}

        {result && (
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

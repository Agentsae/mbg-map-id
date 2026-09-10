import { useState } from 'react'
import { ChevronDown, ChevronUp, Layers } from 'lucide-react'

/**
 * LayerControl — panel pengatur layer untuk tab "Peta Interaktif".
 * Overlay di pojok KIRI-ATAS (MapLegend memakai pojok kanan-bawah,
 * CaiScorePanel kiri-bawah — sengaja berseberangan supaya tidak tumpang tindih).
 *
 * Bisa diciutkan: bilah header "Layer" selalu tampil + jadi tombol buka/tutup.
 * Default = TERBUKA saat load. State ciut/kembang lokal saja, tidak dipersisten.
 *
 * Dua bagian:
 *  - Overlai analitik (radio, default "Tidak ada"): choropleth grid 300 m untuk
 *    kepadatan penduduk atau Transit Desert Index. Hanya SATU aktif sekaligus.
 *  - Titik & jaringan (checkbox, semua default ON): visibilitas marker/garis
 *    layer konteks.
 *
 * Props:
 *  - value: objek visibilitas layer titik/garis (state di App.jsx), key =
 *    usulanModel, halte, stasiun, koridorBiskita, krl, lrt, batasKota.
 *  - onChange: (nextValue) => void — dipanggil dengan objek `value` baru.
 *  - analyticOverlay: 'none' | 'kepadatan' | 'tdi' (state di App.jsx).
 *  - onAnalyticOverlayChange: (key) => void.
 *  - overlayLoading: boolean opsional — grid_analisis untuk overlai sedang
 *    di-fetch (lazy, sekali). Sekadar info, tidak memblok interaksi.
 *
 * TODO(ui-ux-designer): radio/checkbox masih kontrol native polos, belum
 * disesuaikan sistem desain final (toggle switch / ikon per layer, dst).
 */

const OVERLAY_OPTIONS = [
  { key: 'none', label: 'Tidak ada' },
  { key: 'kepadatan', label: 'Kepadatan penduduk' },
  { key: 'tdi', label: 'Transit Desert Index' },
]

const POINT_LINE_OPTIONS = [
  { key: 'usulanModel', label: 'Usulan halte model' },
  { key: 'halte', label: 'Halte tersurvei' },
  { key: 'stasiun', label: 'Stasiun (KRL & LRT)' },
  { key: 'koridorBiskita', label: 'Koridor BisKita' },
  { key: 'krl', label: 'Jaringan KRL' },
  { key: 'lrt', label: 'Jalur LRT' },
  { key: 'batasKota', label: 'Batas Kota' },
]

export default function LayerControl({
  value,
  onChange,
  analyticOverlay = 'none',
  onAnalyticOverlayChange,
  overlayLoading = false,
}) {
  const [expanded, setExpanded] = useState(true)

  return (
    <div className="absolute top-3 left-3 z-10 w-60 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white/95 text-xs text-slate-600 shadow-lg backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="layer-control-body"
        className="flex w-full items-center gap-2 px-3 py-2 font-semibold text-slate-700 hover:text-slate-900"
      >
        <Layers size={14} className="shrink-0 text-brand-blue" />
        <span className="flex-1 text-left">Layer</span>
        {expanded ? (
          <ChevronUp size={14} className="shrink-0" />
        ) : (
          <ChevronDown size={14} className="shrink-0" />
        )}
      </button>

      <div
        id="layer-control-body"
        hidden={!expanded}
        className="max-h-[60vh] space-y-3 overflow-y-auto border-t border-slate-200 px-3 pb-3 pt-2"
      >
        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Overlai analitik
          </p>
          <div className="space-y-1">
            {OVERLAY_OPTIONS.map((o) => (
              <label key={o.key} className="flex cursor-pointer items-center gap-2">
                <input
                  type="radio"
                  name="analytic-overlay"
                  checked={analyticOverlay === o.key}
                  onChange={() => onAnalyticOverlayChange?.(o.key)}
                />
                <span className="leading-tight">{o.label}</span>
              </label>
            ))}
          </div>
          <p className="mt-1 text-[10px] leading-snug text-slate-400">
            {overlayLoading
              ? 'Memuat grid 300 m…'
              : 'Choropleth grid 300 m (YlGnBu). Rincian kelas ada di Keterangan Peta.'}
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
            Titik &amp; jaringan
          </p>
          <div className="space-y-1">
            {POINT_LINE_OPTIONS.map((o) => (
              <label key={o.key} className="flex cursor-pointer items-center gap-2">
                <input
                  type="checkbox"
                  checked={!!value?.[o.key]}
                  onChange={(e) => onChange?.({ ...value, [o.key]: e.target.checked })}
                />
                <span className="leading-tight">{o.label}</span>
              </label>
            ))}
          </div>
        </div>
      </div>
    </div>
  )
}

import { useState } from 'react'
import { ChevronDown, ChevronUp, Layers } from 'lucide-react'

/**
 * MapLegend — keterangan warna marker/garis untuk tab "Peta Interaktif".
 * Overlay di pojok kanan-bawah (CaiScorePanel memakai pojok kiri-bawah,
 * jadi sengaja berseberangan supaya tidak tumpang tindih).
 *
 * Bisa diciutkan: bilah header "Keterangan Peta" selalu tampil + jadi
 * tombol buka/tutup. Default = TERBUKA saat load supaya tim/juri langsung
 * melihat legenda; badge angka di header menunjukkan jumlah entri total.
 * State lokal saja, tidak dipersistenkan.
 *
 * Props:
 * - groups: Array<{ title?: string, items: LegendItem[] }>
 *   LegendItem = { color, label, shape?: 'dot'|'line', lineStyle?: 'solid'|'dashed' }
 *   - shape 'dot' (default) — marker titik (halte, usulan lokasi, dst).
 *   - shape 'line' — layer garis (rute BisKita/KRL), dengan lineStyle
 *     'solid'/'dashed' supaya legenda ikut mencerminkan beda BENTUK garis
 *     di peta, bukan cuma beda warna (syarat colorblind-safe CLAUDE.md).
 */
export default function MapLegend({ groups }) {
  const [expanded, setExpanded] = useState(true)

  if (!groups?.length) return null

  const total = groups.reduce((n, g) => n + (g.items?.length || 0), 0)

  return (
    <div className="absolute bottom-10 right-4 z-10 w-64 max-w-[calc(100vw-2rem)] overflow-hidden rounded-xl border border-slate-200 bg-white/95 text-xs text-slate-600 shadow-lg backdrop-blur-sm">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="map-legend-items"
        className="flex w-full items-center gap-2 px-3 py-2 font-semibold text-slate-700 hover:text-slate-900"
      >
        <Layers size={14} className="shrink-0 text-brand-blue" />
        <span className="flex-1 text-left">Keterangan Peta</span>
        <span className="rounded-full bg-slate-100 px-1.5 py-0.5 text-[10px] font-medium text-slate-500">
          {total}
        </span>
        {expanded ? (
          <ChevronUp size={14} className="shrink-0" />
        ) : (
          <ChevronDown size={14} className="shrink-0" />
        )}
      </button>

      <div
        id="map-legend-items"
        hidden={!expanded}
        className="max-h-[46vh] space-y-3 overflow-y-auto border-t border-slate-200 px-3 pb-3 pt-2"
      >
        {groups.map((group, gi) => (
          <div key={group.title || gi}>
            {group.title && (
              <p className="mb-1.5 text-[10px] font-semibold uppercase tracking-wide text-slate-400">
                {group.title}
              </p>
            )}
            <div className="space-y-1.5">
              {group.items.map(({ color, label, shape = 'dot', lineStyle = 'solid' }) => (
                <div key={label} className="flex items-center gap-2">
                  {shape === 'line' ? (
                    <span
                      className="inline-block h-0 w-4 shrink-0"
                      style={{
                        borderTop: `3px ${lineStyle === 'dashed' ? 'dashed' : 'solid'} ${color}`,
                      }}
                    />
                  ) : (
                    <span
                      className="inline-block h-3 w-3 shrink-0 rounded-full border border-white"
                      style={{ background: color, boxShadow: '0 0 0 1px rgba(0,0,0,0.15)' }}
                    />
                  )}
                  <span className="leading-tight">{label}</span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

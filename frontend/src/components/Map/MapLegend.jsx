import { useState } from 'react'
import { ChevronDown, ChevronUp } from 'lucide-react'

/**
 * MapLegend — keterangan warna marker/garis singkat untuk tab "Peta Interaktif".
 * Overlay ringan di pojok kanan-bawah (CaiScorePanel memakai pojok kiri-bawah,
 * jadi sengaja ditaruh berseberangan supaya tidak tumpang tindih).
 *
 * Bisa diciutkan: bilah header "Keterangan Peta" selalu tampil dan berfungsi
 * sebagai tombol buka/tutup daftar item. Default = TERBUKA saat load (tim/juri
 * langsung lihat legenda); saat diciutkan hanya bilah header yang tersisa
 * supaya peta di bawahnya semaksimal mungkin tidak tertutup. State lokal saja,
 * tidak dipersistenkan.
 *
 * Tiap item bisa berupa:
 * - shape: 'dot' (default) — untuk marker titik (halte, usulan lokasi, dst).
 * - shape: 'line' — untuk layer garis (rute BisKita/KRL), dengan lineStyle
 *   'solid' atau 'dashed' supaya legenda ikut mencerminkan beda bentuk garis
 *   di peta (bukan cuma beda warna).
 *
 * TODO(ui-ux-designer): palet warna & posisi ini asumsi sementara webgis-developer,
 * bukan keputusan desain final — silakan sesuaikan dengan mockup resmi kalau perlu.
 */
export default function MapLegend({ items }) {
  const [expanded, setExpanded] = useState(false)

  if (!items?.length) return null

  return (
    <div className="absolute bottom-10 right-4 z-10 bg-white/95 rounded-lg shadow-md border border-slate-200 text-xs text-slate-600">
      <button
        type="button"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
        aria-controls="map-legend-items"
        className="flex items-center gap-1.5 w-full px-3 py-2 font-medium text-slate-700 hover:text-slate-900"
      >
        <span className="flex-1 text-left">Keterangan Peta</span>
        {expanded ? (
          <ChevronUp size={14} className="shrink-0" />
        ) : (
          <ChevronDown size={14} className="shrink-0" />
        )}
      </button>

      <div
        id="map-legend-items"
        hidden={!expanded}
        className="px-3 pb-2 pt-0.5 space-y-1.5 border-t border-slate-200"
      >
        {items.map(({ color, label, shape = 'dot', lineStyle = 'solid' }) => (
          <div key={label} className="flex items-center gap-2">
            {shape === 'line' ? (
              <span
                className="inline-block w-4 h-0 shrink-0"
                style={{
                  borderTop: `3px ${lineStyle === 'dashed' ? 'dashed' : 'solid'} ${color}`,
                }}
              />
            ) : (
              <span
                className="inline-block w-3 h-3 rounded-full border border-white shrink-0"
                style={{ background: color, boxShadow: '0 0 0 1px rgba(0,0,0,0.15)' }}
              />
            )}
            <span>{label}</span>
          </div>
        ))}
      </div>
    </div>
  )
}

/**
 * MapLegend — keterangan warna marker/garis singkat untuk tab "Peta Interaktif".
 * Overlay ringan di pojok kanan-bawah (CaiScorePanel memakai pojok kiri-bawah,
 * jadi sengaja ditaruh berseberangan supaya tidak tumpang tindih).
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
  if (!items?.length) return null

  return (
    <div className="absolute bottom-4 right-4 z-10 bg-white/95 rounded-lg shadow-md border border-slate-200 px-3 py-2 text-xs text-slate-600 space-y-1.5">
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
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileDown, FileImage, FileText, Loader2 } from 'lucide-react'
import { jsPDF } from 'jspdf'
import MapView from '../Map/MapView'
import { supabase, isConfigured } from '../../lib/supabaseClient'
import { KOTA_PROFIL } from '../../lib/kotaProfil'
import { extractLatLon } from '../../lib/geo'

/**
 * DataLaporan — tab "Data & Laporan" (PRD Bab 8 "Export Report" + User Flow
 * Bab 10.1 langkah terakhir). Menghasilkan ringkasan satu halaman: tampilan
 * peta Kota Bekasi + indikator kunci (ringkasan kota, jumlah transit desert,
 * coverage ratio, ranking Transit Equity Index teratas) sebagai PDF atau PNG.
 *
 * Catatan implementasi: komposisi ekspor TIDAK memakai html2canvas atas DOM
 * ber-Tailwind (Tailwind v4 memakai warna oklch() yang belum didukung
 * html2canvas 1.4.1 dan bikin ekspor gagal). Sebagai gantinya:
 *   - PNG: digambar manual ke <canvas> 2D (teks + drawImage kanvas peta).
 *   - PDF: jsPDF langsung (doc.text + doc.addImage kanvas peta).
 * Kanvas peta bisa dibaca ulang karena MapView kini pakai preserveDrawingBuffer.
 * Semua angka murni membaca hasil yang sudah dihitung di Supabase — tidak ada
 * formula CAI/TDI/Equity dihitung ulang di sini.
 */

const TRANSIT_DESERT_THRESHOLD = 0.6

const DEMO_MODEL = {
  transitDesertCount: 1517,
  transitDesertDemo: true,
  cityCoverage800m: 0.071,
  coverageDemo: true,
  equityTop: [
    { rank: 1, kelurahan: 'Arenjaya', skor: 0.83 },
    { rank: 2, kelurahan: 'Mustika Jaya', skor: 0.81 },
    { rank: 3, kelurahan: 'Bantar Gebang', skor: 0.76 },
    { rank: 4, kelurahan: 'Rawa Lumbu', skor: 0.71 },
    { rank: 5, kelurahan: 'Bekasi Jaya', skor: 0.68 },
  ],
  equityDemo: true,
}

export default function DataLaporan() {
  const [model, setModel] = useState(DEMO_MODEL)
  const [loadingModel, setLoadingModel] = useState(isConfigured)
  const [exporting, setExporting] = useState(null) // 'png' | 'pdf' | null
  const [note, setNote] = useState(null)
  const mapObjRef = useRef(null)

  useEffect(() => {
    if (!isConfigured) return
    let cancelled = false

    async function load() {
      const next = { ...DEMO_MODEL }

      // Transit desert count — filter/count atas skor_tdi yang sudah dihitung.
      try {
        const { count, error } = await supabase
          .from('grid_analisis')
          .select('id', { count: 'exact', head: true })
          .gt('skor_tdi', TRANSIT_DESERT_THRESHOLD)
        if (!error && typeof count === 'number') {
          next.transitDesertCount = count
          next.transitDesertDemo = false
        }
      } catch { /* keep demo */ }

      // Coverage ratio kota (radius 800 m) — view coverage_transit_kecamatan.
      try {
        const { data, error } = await supabase
          .from('coverage_transit_kecamatan')
          .select('populasi_total, populasi_terlayani_800m')
        if (!error && data?.length) {
          const tot = data.reduce((s, r) => s + (Number(r.populasi_total) || 0), 0)
          const served = data.reduce((s, r) => s + (Number(r.populasi_terlayani_800m) || 0), 0)
          if (tot > 0) {
            next.cityCoverage800m = served / tot
            next.coverageDemo = false
          }
        }
      } catch { /* keep demo */ }

      // Ranking Transit Equity Index teratas (WAJIB filter sumber REAL%).
      try {
        const { data, error } = await supabase
          .from('skor_equity')
          .select('skor_final, ranking, sumber, batas_administrasi(nama_kelurahan)')
          .ilike('sumber', 'REAL%')
          .order('ranking', { ascending: true })
          .limit(5)
        if (!error && data?.length) {
          next.equityTop = data.map((d, i) => ({
            rank: d.ranking ?? i + 1,
            kelurahan: d.batas_administrasi?.nama_kelurahan || 'Kelurahan',
            skor: d.skor_final != null ? Number(d.skor_final) : null,
          }))
          next.equityDemo = false
        }
      } catch { /* keep demo */ }

      if (!cancelled) {
        setModel(next)
        setLoadingModel(false)
      }
    }

    load()
    return () => { cancelled = true }
  }, [])

  // Layer peta untuk laporan: titik halte eksisting (jaringan transit) supaya
  // peta tidak kosong. Ringan — 15 titik. Fallback: tanpa layer (basemap saja).
  const [halteLayer, setHalteLayer] = useState({ type: 'FeatureCollection', features: [] })
  useEffect(() => {
    if (!isConfigured) return
    supabase
      .from('halte_eksisting')
      .select('id, nama, geom')
      .limit(500)
      .then(({ data, error }) => {
        if (error || !data?.length) return
        const features = data
          .map((row) => {
            const c = extractLatLon(row.geom)
            return c
              ? { type: 'Feature', geometry: { type: 'Point', coordinates: [c.lon, c.lat] }, properties: {} }
              : null
          })
          .filter(Boolean)
        setHalteLayer({ type: 'FeatureCollection', features })
      })
  }, [])

  const reportLayers = useMemo(
    () => [
      {
        id: 'laporan-halte',
        type: 'circle',
        data: halteLayer,
        paint: {
          'circle-radius': 5,
          'circle-color': '#7C3AED',
          'circle-stroke-width': 1.5,
          'circle-stroke-color': '#ffffff',
        },
      },
    ],
    [halteLayer]
  )

  const nowLabel = () => new Date().toLocaleString('id-ID', { dateStyle: 'long', timeStyle: 'short' })

  function buildLines() {
    const pct = (v) => `${(v * 100).toLocaleString('id-ID', { maximumFractionDigits: 1 })}%`
    return [
      ['Populasi Kota Bekasi', `${KOTA_PROFIL.populasi_fallback.toLocaleString('id-ID')} jiwa (DKB Semester I 2026)`],
      ['Kepadatan', `${KOTA_PROFIL.kepadatan_fallback.toLocaleString('id-ID')} jiwa/km2`],
      ['Luas wilayah', `${KOTA_PROFIL.luas_km2.toLocaleString('id-ID')} km2 (BPS)`],
      ['Usia produktif (15-64 th)', `${KOTA_PROFIL.usia_produktif_persen}% (${KOTA_PROFIL.usia_produktif_jiwa.toLocaleString('id-ID')} jiwa)`],
      [
        'Transit desert teridentifikasi',
        `${model.transitDesertCount.toLocaleString('id-ID')} sel grid (skor_tdi > ${TRANSIT_DESERT_THRESHOLD})${model.transitDesertDemo ? ' [contoh]' : ''}`,
      ],
      [
        'Coverage transit kota (radius 800 m)',
        `${pct(model.cityCoverage800m)} penduduk${model.coverageDemo ? ' [contoh]' : ''}`,
      ],
    ]
  }

  function getMapCanvas() {
    const map = mapObjRef.current
    if (!map) return null
    try {
      map.triggerRepaint()
      return map.getCanvas()
    } catch {
      return null
    }
  }

  async function exportPng() {
    setExporting('png')
    setNote(null)
    try {
      const W = 960
      const pad = 40
      const mapCanvas = getMapCanvas()
      const lines = buildLines()
      const equity = model.equityTop

      // Tinggi dinamis: header + peta + indikator + ranking.
      const mapH = mapCanvas ? Math.round(((W - pad * 2) * mapCanvas.height) / mapCanvas.width) : 0
      const H = pad + 70 + (mapH ? mapH + 24 : 0) + lines.length * 30 + 40 + equity.length * 26 + 60

      const cv = document.createElement('canvas')
      cv.width = W
      cv.height = H
      const ctx = cv.getContext('2d')
      ctx.fillStyle = '#ffffff'
      ctx.fillRect(0, 0, W, H)

      let y = pad
      ctx.fillStyle = '#1B659D'
      ctx.font = 'bold 26px Arial, sans-serif'
      ctx.fillText('GeoTransit Insight — Ringkasan Laporan', pad, y + 24)
      y += 40
      ctx.fillStyle = '#64748b'
      ctx.font = '13px Arial, sans-serif'
      ctx.fillText(`Kota Bekasi · dibuat ${nowLabel()}`, pad, y + 14)
      y += 34

      if (mapCanvas && mapH) {
        ctx.drawImage(mapCanvas, pad, y, W - pad * 2, mapH)
        ctx.strokeStyle = '#cbd5e1'
        ctx.strokeRect(pad, y, W - pad * 2, mapH)
        y += mapH + 24
      }

      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 16px Arial, sans-serif'
      ctx.fillText('Indikator kunci', pad, y)
      y += 22
      ctx.font = '14px Arial, sans-serif'
      lines.forEach(([k, v]) => {
        ctx.fillStyle = '#475569'
        ctx.fillText(`${k}:`, pad, y)
        ctx.fillStyle = '#0f172a'
        ctx.fillText(String(v), pad + 320, y)
        y += 30
      })

      y += 10
      ctx.fillStyle = '#0f172a'
      ctx.font = 'bold 16px Arial, sans-serif'
      ctx.fillText(`Transit Equity Index — ${equity.length} kelurahan paling timpang${model.equityDemo ? ' [contoh]' : ''}`, pad, y)
      y += 22
      ctx.font = '14px Arial, sans-serif'
      equity.forEach((e) => {
        ctx.fillStyle = '#475569'
        ctx.fillText(`${e.rank}. ${e.kelurahan}`, pad, y)
        ctx.fillStyle = '#0f172a'
        ctx.fillText(e.skor != null ? `skor ketimpangan ${e.skor.toFixed(2)}` : 'skor -', pad + 320, y)
        y += 26
      })

      y += 20
      ctx.fillStyle = '#94a3b8'
      ctx.font = '11px Arial, sans-serif'
      ctx.fillText('Skor ketimpangan lebih tinggi = akses transit lebih tertinggal (ranking 1 = paling butuh intervensi).', pad, y)

      const blob = await new Promise((res) => cv.toBlob(res, 'image/png'))
      triggerDownload(blob, `geotransit-laporan-${fileStamp()}.png`)
    } catch (err) {
      console.error(err)
      setNote('Gagal membuat PNG. Coba lagi setelah peta selesai dimuat.')
    } finally {
      setExporting(null)
    }
  }

  function exportPdf() {
    setExporting('pdf')
    setNote(null)
    try {
      const doc = new jsPDF({ unit: 'mm', format: 'a4' })
      const pageW = doc.internal.pageSize.getWidth()
      const margin = 15
      let y = margin

      doc.setFontSize(16)
      doc.setTextColor('#1B659D')
      doc.text('GeoTransit Insight — Ringkasan Laporan', margin, y)
      y += 7
      doc.setFontSize(10)
      doc.setTextColor('#64748b')
      doc.text(`Kota Bekasi · dibuat ${nowLabel()}`, margin, y)
      y += 8

      const mapCanvas = getMapCanvas()
      if (mapCanvas) {
        const imgW = pageW - margin * 2
        const imgH = (imgW * mapCanvas.height) / mapCanvas.width
        doc.addImage(mapCanvas.toDataURL('image/png'), 'PNG', margin, y, imgW, imgH)
        doc.setDrawColor('#cbd5e1')
        doc.rect(margin, y, imgW, imgH)
        y += imgH + 8
      }

      doc.setFontSize(12)
      doc.setTextColor('#0f172a')
      doc.text('Indikator kunci', margin, y)
      y += 6
      doc.setFontSize(10)
      buildLines().forEach(([k, v]) => {
        doc.setTextColor('#475569')
        doc.text(`${k}:`, margin, y)
        doc.setTextColor('#0f172a')
        doc.text(doc.splitTextToSize(String(v), pageW - margin * 2 - 60), margin + 60, y)
        y += 6
      })

      y += 4
      doc.setFontSize(12)
      doc.setTextColor('#0f172a')
      doc.text(
        `Transit Equity Index — ${model.equityTop.length} kelurahan paling timpang${model.equityDemo ? ' [contoh]' : ''}`,
        margin,
        y
      )
      y += 6
      doc.setFontSize(10)
      model.equityTop.forEach((e) => {
        doc.setTextColor('#475569')
        doc.text(`${e.rank}. ${e.kelurahan}`, margin, y)
        doc.setTextColor('#0f172a')
        doc.text(e.skor != null ? `skor ketimpangan ${e.skor.toFixed(2)}` : 'skor -', margin + 60, y)
        y += 6
      })

      y += 6
      doc.setFontSize(8)
      doc.setTextColor('#94a3b8')
      doc.text(
        doc.splitTextToSize(
          'Skor ketimpangan lebih tinggi = akses transit lebih tertinggal (ranking 1 = paling butuh intervensi). ' +
            'Angka bertanda [contoh] memakai data fallback karena Supabase belum tersambung/terisi.',
          pageW - margin * 2
        ),
        margin,
        y
      )

      doc.save(`geotransit-laporan-${fileStamp()}.pdf`)
    } catch (err) {
      console.error(err)
      setNote('Gagal membuat PDF. Coba lagi setelah peta selesai dimuat.')
    } finally {
      setExporting(null)
    }
  }

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <FileDown size={18} className="text-brand-orange" />
        <h2 className="font-semibold text-slate-800">Data &amp; Laporan</h2>
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {!isConfigured && (
          <div className="text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">
            Belum tersambung ke Supabase — laporan memakai angka contoh.
          </div>
        )}

        <p className="text-sm text-slate-500">
          Unduh ringkasan satu halaman: tampilan peta + indikator kunci (ringkasan kota, transit
          desert, coverage ratio, ranking Transit Equity Index teratas).
        </p>

        <div className="rounded-lg overflow-hidden border border-slate-200 h-52">
          <MapView layers={reportLayers} onMapReady={(m) => { mapObjRef.current = m }} />
        </div>

        <div className="rounded-lg border border-slate-200 p-3 space-y-1.5 text-xs">
          <p className="font-medium text-slate-600 mb-1">
            Isi laporan {loadingModel && <span className="text-slate-400">(memuat…)</span>}
          </p>
          {buildLines().map(([k, v]) => (
            <div key={k} className="flex justify-between gap-3">
              <span className="text-slate-500">{k}</span>
              <span className="text-slate-800 text-right">{v}</span>
            </div>
          ))}
          <div className="pt-1 border-t border-slate-100 mt-1">
            <span className="text-slate-500">
              Ranking Transit Equity Index: {model.equityTop.map((e) => e.kelurahan).join(', ')}
              {model.equityDemo ? ' [contoh]' : ''}
            </span>
          </div>
        </div>

        {note && (
          <div className="text-xs bg-red-50 text-red-700 border border-red-200 rounded-md px-3 py-2">
            {note}
          </div>
        )}

        <div className="flex gap-2">
          <button
            onClick={exportPdf}
            disabled={exporting != null}
            className="flex-1 flex items-center justify-center gap-1.5 bg-brand-blue text-white rounded-md px-3 py-2 text-sm font-medium disabled:opacity-50"
          >
            {exporting === 'pdf' ? <Loader2 size={15} className="animate-spin" /> : <FileText size={15} />}
            Unduh PDF
          </button>
          <button
            onClick={exportPng}
            disabled={exporting != null}
            className="flex-1 flex items-center justify-center gap-1.5 bg-slate-100 text-slate-700 rounded-md px-3 py-2 text-sm font-medium hover:bg-slate-200 disabled:opacity-50"
          >
            {exporting === 'png' ? <Loader2 size={15} className="animate-spin" /> : <FileImage size={15} />}
            Unduh PNG
          </button>
        </div>
        <p className="text-[10px] text-slate-400">
          Tip: tunggu peta selesai dimuat sebelum mengunduh agar tampilan peta ikut terekam.
        </p>
      </div>
    </div>
  )
}

function fileStamp() {
  return new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-')
}

function triggerDownload(blob, filename) {
  if (!blob) return
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  a.remove()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

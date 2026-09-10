// choropleth.js — mesin choropleth bersama untuk layer grid_analisis
// (Analisis Spasial + overlai analitik di Peta Interaktif).
//
// Palet: sequential colorblind-safe — ColorBrewer YlGnBu 5 kelas (kuning muda
// -> biru tua). Menggantikan skema lama hijau->merah diverging yang dilarang
// PRD Bab 10.3 / temuan Coaching Clinic 4: skema merah-oranye-hijau tidak
// terbaca bagi ~8% pria dengan color vision deficiency. Kelas dibuat DISKRET
// (ekspresi 'step' MapLibre, bukan gradient kontinu) dan legenda menambahkan
// nomor kelas + rentang angka sebagai pembeda non-warna — tampilan tidak
// bergantung pada warna saja.
//
// Ini murni format/normalisasi tampilan; TIDAK menghitung ulang CAI/TDI/Equity
// Index (angka datang apa adanya dari grid_analisis yang dihitung data-ai-analyst).

import { ringAveragePoint } from './geo'

export const CHOROPLETH_COLORS = ['#ffffcc', '#a1dab4', '#41b6c4', '#2c7fb8', '#253494']
export const CLASS_COUNT = CHOROPLETH_COLORS.length

/**
 * Ambang kelas equal-interval pada rentang [min, max] -> (n-1) nilai batas,
 * strictly ascending (computeMinMax menjamin max > min).
 */
export function classBreaks([min, max], n) {
  const span = (max - min) / n
  return Array.from({ length: n - 1 }, (_, i) => min + span * (i + 1))
}

/**
 * Ambang kelas KUANTIL pada rentang nilai -> (n-1) nilai batas: tiap kelas
 * memuat kira-kira jumlah sel yang sama. Dipakai overlai "Kepadatan penduduk"
 * di Peta Interaktif supaya variasi kepadatan terbaca (equal-interval linear
 * menumpuk mayoritas sel di kelas terendah -> peta nyaris polos).
 * classBreaks (equal-interval) SENGAJA tidak diubah — AnalisisSpasial.jsx masih
 * memakainya. Hasil dijamin strictly ascending (nilai duplikat didorong tipis)
 * supaya ekspresi 'step' MapLibre tidak menolak.
 */
export function quantileBreaks(values, n) {
  const nums = values
    .filter((v) => typeof v === 'number' && !Number.isNaN(v))
    .sort((a, b) => a - b)
  if (nums.length < 2) return classBreaks(computeMinMax(values), n)
  const breaks = []
  for (let i = 1; i < n; i++) {
    const pos = (i / n) * (nums.length - 1)
    const lo = Math.floor(pos)
    const hi = Math.ceil(pos)
    breaks.push(nums[lo] + (nums[hi] - nums[lo]) * (pos - lo))
  }
  for (let i = 1; i < breaks.length; i++) {
    if (breaks[i] <= breaks[i - 1]) breaks[i] = breaks[i - 1] + 1e-6
  }
  return breaks
}

/**
 * Format batas kelas untuk legenda: angka besar (kepadatan) dibulatkan +
 * pemisah ribuan, angka kecil (skor 0-1) dua desimal.
 */
export function fmtBound(v) {
  return Math.abs(v) >= 100 ? Math.round(v).toLocaleString('id-ID') : v.toFixed(2)
}

/** [min, max] dari kumpulan nilai numerik; fallback [0, 1] kalau kosong. */
export function computeMinMax(values) {
  const nums = values.filter((v) => typeof v === 'number' && !Number.isNaN(v))
  if (!nums.length) return [0, 1]
  let min = Math.min(...nums)
  let max = Math.max(...nums)
  if (min === max) max = min + 1
  return [min, max]
}

/**
 * FeatureCollection Polygon dari daftar sel { ring, ... }; tiap fitur mendapat
 * properti `value` hasil valueFn(cell) (0 kalau null/undefined).
 */
export function toPolygonFeatureCollection(cells, valueFn) {
  return {
    type: 'FeatureCollection',
    features: cells.map((c) => ({
      type: 'Feature',
      geometry: { type: 'Polygon', coordinates: [c.ring] },
      properties: { value: valueFn(c) ?? 0 },
    })),
  }
}

/**
 * FeatureCollection Point dari daftar sel { ring, ... } — 1 titik pusat per sel
 * (rata-rata vertex ring, ringAveragePoint) dengan properti `skor_tdi` diambil
 * dari cell[valueKey]. Dipakai untuk layer heatmap TDI (permukaan interpolasi
 * dari titik, bukan poligon batas sel).
 */
export function toCentroidPointFC(cells, valueKey) {
  return {
    type: 'FeatureCollection',
    features: cells
      .map((c) => {
        const p = ringAveragePoint(c.ring)
        if (!p) return null
        return {
          type: 'Feature',
          geometry: { type: 'Point', coordinates: [p.lon, p.lat] },
          properties: { skor_tdi: Number(c[valueKey]) || 0 },
        }
      })
      .filter(Boolean),
  }
}

/**
 * Ekspresi 'step' MapLibre untuk fill-color diskret dari daftar ambang kelas
 * (hasil classBreaks / quantileBreaks) + CHOROPLETH_COLORS.
 */
export function stepFillColorExpr(breaks) {
  const expr = ['step', ['get', 'value'], CHOROPLETH_COLORS[0]]
  breaks.forEach((b, i) => expr.push(b, CHOROPLETH_COLORS[i + 1]))
  return expr
}

/**
 * Daftar { color, label } untuk legenda kelas diskret — label = rentang angka
 * "a – b" per kelas. Penomoran kelas ditambahkan oleh pemanggil.
 */
export function legendClassRows(range, breaks) {
  const bounds = [range[0], ...breaks, range[1]]
  return CHOROPLETH_COLORS.map((color, i) => ({
    color,
    label: `${fmtBound(bounds[i])} – ${fmtBound(bounds[i + 1])}`,
  }))
}

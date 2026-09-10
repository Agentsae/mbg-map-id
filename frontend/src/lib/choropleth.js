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
 * Ekspresi 'step' MapLibre untuk fill-color diskret dari daftar ambang kelas
 * (hasil classBreaks) + CHOROPLETH_COLORS.
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

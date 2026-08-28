// geo.js — util geometri ringan untuk kebutuhan UI (BUKAN perhitungan indeks/skor).
//
// Kenapa ini ada: Supabase/PostgREST mengembalikan kolom geometry PostGIS sebagai
// hex EWKB (bukan GeoJSON) secara default untuk query `.select()` biasa. Supaya
// fitur "klik peta -> cari titik_kandidat terdekat" bisa jalan tanpa menambah
// migration SQL baru (di luar wewenang webgis-developer), kita parse koordinatnya
// di JS. Ini murni format-parsing & pencarian tetangga terdekat (nearest neighbor)
// untuk kebutuhan navigasi UI — TIDAK menghitung ulang CAI/TDI/Equity Index.

/**
 * Konversi hex string EWKB Point (format default PostGIS via PostgREST) atau
 * objek GeoJSON Point menjadi {lat, lon}. Return null kalau format tidak dikenali
 * atau bukan tipe Point.
 */
export function extractLatLon(geom) {
  if (!geom) return null

  // Beberapa konfigurasi Supabase (mis. pakai st_asgeojson di view) bisa
  // mengembalikan GeoJSON langsung — dukung juga bentuk ini.
  if (typeof geom === 'object' && geom.type === 'Point' && Array.isArray(geom.coordinates)) {
    const [lon, lat] = geom.coordinates
    return { lat, lon }
  }

  if (typeof geom === 'string') {
    return parseWkbPoint(geom)
  }

  return null
}

function parseWkbPoint(hex) {
  try {
    const clean = hex.trim()
    if (clean.length < 18) return null

    const bytes = new Uint8Array(clean.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
    }
    const view = new DataView(bytes.buffer)

    let offset = 0
    const byteOrder = view.getUint8(offset)
    offset += 1
    const little = byteOrder === 1

    const type = little ? view.getUint32(offset, true) : view.getUint32(offset, false)
    offset += 4

    const hasSrid = (type & 0x20000000) !== 0
    const geomType = type & 0xff
    if (hasSrid) offset += 4 // asumsi SRID 4326 (sesuai skema migration 001)
    if (geomType !== 1) return null // hanya dukung Point untuk fitur pencarian titik terdekat

    const x = little ? view.getFloat64(offset, true) : view.getFloat64(offset, false)
    offset += 8
    const y = little ? view.getFloat64(offset, true) : view.getFloat64(offset, false)

    return { lat: y, lon: x }
  } catch {
    return null
  }
}

/**
 * Konversi hex string EWKB Polygon (format default PostGIS via PostgREST) atau
 * objek GeoJSON Polygon menjadi array of rings GeoJSON-style: [[ [lon,lat], ... ], ...]
 * (ring pertama = exterior). Return null kalau format tidak dikenali atau bukan
 * tipe Polygon. Sama seperti extractLatLon di atas: murni format-parsing untuk
 * kebutuhan render/filter UI (mis. layer grid_analisis / batas_administrasi di
 * peta "Analisis Spasial"), TIDAK menghitung ulang CAI/TDI/Equity Index.
 */
export function extractPolygonRings(geom) {
  if (!geom) return null

  if (typeof geom === 'object' && geom.type === 'Polygon' && Array.isArray(geom.coordinates)) {
    return geom.coordinates
  }

  if (typeof geom === 'string') {
    return parseWkbPolygon(geom)
  }

  return null
}

function parseWkbPolygon(hex) {
  try {
    const clean = hex.trim()
    if (clean.length < 18) return null

    const bytes = new Uint8Array(clean.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
    }
    const view = new DataView(bytes.buffer)

    let offset = 0
    const byteOrder = view.getUint8(offset)
    offset += 1
    const little = byteOrder === 1

    const readUint32 = () => {
      const v = little ? view.getUint32(offset, true) : view.getUint32(offset, false)
      offset += 4
      return v
    }
    const readFloat64 = () => {
      const v = little ? view.getFloat64(offset, true) : view.getFloat64(offset, false)
      offset += 8
      return v
    }

    const type = readUint32()
    const hasSrid = (type & 0x20000000) !== 0
    const geomType = type & 0xff
    if (hasSrid) readUint32() // asumsi SRID 4326 (sesuai skema migration 001) — buang saja
    if (geomType !== 3) return null // hanya dukung Polygon

    const numRings = readUint32()
    const rings = []
    for (let r = 0; r < numRings; r++) {
      const numPoints = readUint32()
      const ring = []
      for (let p = 0; p < numPoints; p++) {
        const x = readFloat64()
        const y = readFloat64()
        ring.push([x, y]) // GeoJSON: [lon, lat]
      }
      rings.push(ring)
    }
    return rings
  } catch {
    return null
  }
}

/**
 * Konversi hex string EWKB LineString (format default PostGIS via PostgREST)
 * atau objek GeoJSON LineString menjadi array koordinat GeoJSON-style
 * ([[lon,lat], ...]). Return null kalau format tidak dikenali atau bukan tipe
 * LineString. Sama seperti extractLatLon/extractPolygonRings di atas: murni
 * format-parsing untuk kebutuhan render layer di peta (mis. `rute_transit_eksisting`
 * — koridor BisKita tersurvei & jaringan rel KRL, lihat App.jsx), TIDAK
 * menghitung ulang CAI/TDI/Equity Index.
 * Catatan: per verifikasi langsung 28 Agustus 2026 (lihat docs/DATA_CHECKLIST.md),
 * `rute_transit_eksisting.geom` dikembalikan PostgREST sebagai dict GeoJSON
 * (bukan WKB hex) — cabang objek di bawah yang sebenarnya kepakai di produksi;
 * parser WKB tetap disediakan untuk konsistensi/robustness kalau konfigurasi
 * kolom berubah di masa depan.
 */
export function extractLineStringCoords(geom) {
  if (!geom) return null

  if (typeof geom === 'object' && geom.type === 'LineString' && Array.isArray(geom.coordinates)) {
    return geom.coordinates
  }

  if (typeof geom === 'string') {
    return parseWkbLineString(geom)
  }

  return null
}

function parseWkbLineString(hex) {
  try {
    const clean = hex.trim()
    if (clean.length < 18) return null

    const bytes = new Uint8Array(clean.length / 2)
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = parseInt(clean.substr(i * 2, 2), 16)
    }
    const view = new DataView(bytes.buffer)

    let offset = 0
    const byteOrder = view.getUint8(offset)
    offset += 1
    const little = byteOrder === 1

    const readUint32 = () => {
      const v = little ? view.getUint32(offset, true) : view.getUint32(offset, false)
      offset += 4
      return v
    }
    const readFloat64 = () => {
      const v = little ? view.getFloat64(offset, true) : view.getFloat64(offset, false)
      offset += 8
      return v
    }

    const type = readUint32()
    const hasSrid = (type & 0x20000000) !== 0
    const geomType = type & 0xff
    if (hasSrid) readUint32() // asumsi SRID 4326 (sesuai skema migration 001) — buang saja
    if (geomType !== 2) return null // hanya dukung LineString

    const numPoints = readUint32()
    const coords = []
    for (let p = 0; p < numPoints; p++) {
      const x = readFloat64()
      const y = readFloat64()
      coords.push([x, y]) // GeoJSON: [lon, lat]
    }
    return coords
  } catch {
    return null
  }
}

/**
 * Bounding box kasar {minLat, maxLat, minLon, maxLon} dari exterior ring
 * (rings[0]) hasil extractPolygonRings. Dipakai untuk pendekatan filter
 * "titik grid termasuk kecamatan mana" tanpa perlu true point-in-polygon —
 * cukup untuk kebutuhan UI filter, BUKAN analisis spasial presisi.
 * TODO(data-ai-analyst): kalau grid_analisis nanti punya kolom kecamatan_id
 * hasil spatial join di ETL, filter di frontend cukup pakai `.eq()` langsung
 * dan helper bbox ini tidak diperlukan lagi.
 */
export function bboxFromRing(ring) {
  if (!ring?.length) return null
  let minLat = Infinity, maxLat = -Infinity, minLon = Infinity, maxLon = -Infinity
  for (const [lon, lat] of ring) {
    if (lat < minLat) minLat = lat
    if (lat > maxLat) maxLat = lat
    if (lon < minLon) minLon = lon
    if (lon > maxLon) maxLon = lon
  }
  return { minLat, maxLat, minLon, maxLon }
}

/** Titik tengah kasar (rata-rata vertex) dari sebuah polygon ring — bukan centroid area-weighted presisi, cukup untuk keperluan filter/labeling UI. */
export function ringAveragePoint(ring) {
  if (!ring?.length) return null
  let sumLat = 0, sumLon = 0
  for (const [lon, lat] of ring) {
    sumLat += lat
    sumLon += lon
  }
  return { lat: sumLat / ring.length, lon: sumLon / ring.length }
}

/** Cek apakah {lat, lon} berada di dalam bbox (inklusif). */
export function pointInBBox(point, bbox) {
  if (!point || !bbox) return false
  return (
    point.lat >= bbox.minLat &&
    point.lat <= bbox.maxLat &&
    point.lon >= bbox.minLon &&
    point.lon <= bbox.maxLon
  )
}

/** Jarak great-circle antara dua titik {lat, lon}, dalam meter. */
export function haversineMeters(a, b) {
  const R = 6371000
  const toRad = (d) => (d * Math.PI) / 180
  const dLat = toRad(b.lat - a.lat)
  const dLon = toRad(b.lon - a.lon)
  const lat1 = toRad(a.lat)
  const lat2 = toRad(b.lat)
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(h))
}

/**
 * Cari titik terdekat dari daftar {lat, lon, ...} terhadap target {lat, lon}.
 * Return {point, distance_m} atau null kalau daftar kosong.
 */
export function findNearestPoint(points, target) {
  let best = null
  let bestDist = Infinity
  for (const p of points) {
    if (p.lat == null || p.lon == null) continue
    const d = haversineMeters(p, target)
    if (d < bestDist) {
      bestDist = d
      best = p
    }
  }
  return best ? { point: best, distance_m: bestDist } : null
}

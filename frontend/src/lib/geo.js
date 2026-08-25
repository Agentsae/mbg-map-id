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

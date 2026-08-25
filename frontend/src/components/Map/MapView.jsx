import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, NavigationControl, Marker, Popup } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// Pusat peta: Kota Bekasi (perkiraan dari titik Summarecon Bekasi di proposal)
const BEKASI_CENTER = [107.0074, -6.2185]
const BEKASI_ZOOM = 12

// MAPID Maps GL Style — dari Map Services > Styles > Styles Privat (GL Style)
// Dua bagian dipisah env var supaya gampang ganti style (street-2d-building /
// basic / dst) tanpa menyentuh key, dan sebaliknya.
const MAPID_STYLE_BASE = import.meta.env.VITE_MAPID_MAPS_STYLE_URL
const MAPID_API_KEY = import.meta.env.VITE_MAPID_MAPS_API_KEY

// Fallback ke OSM raster gratis kalau .env belum diisi — supaya dev lokal
// tetap bisa jalan tanpa key sambil menunggu konfirmasi/kuota MAPID.
const FALLBACK_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors — mode fallback, MAPID Maps belum dikonfigurasi',
    },
  },
  layers: [{ id: 'osm-basemap', type: 'raster', source: 'osm' }],
}

// MapLibre menerima "style" berupa URL string (akan di-fetch otomatis) atau
// objek style JSON langsung. Kalau kredensial MAPID ada, pakai URL asli;
// kalau belum, pakai objek fallback di atas.
const mapStyle =
  MAPID_STYLE_BASE && MAPID_API_KEY
    ? `${MAPID_STYLE_BASE}?key=${MAPID_API_KEY}`
    : FALLBACK_STYLE

if (!(MAPID_STYLE_BASE && MAPID_API_KEY)) {
  console.warn(
    '[GeoTransit Insight] VITE_MAPID_MAPS_STYLE_URL / VITE_MAPID_MAPS_API_KEY belum diisi — ' +
    'basemap memakai OSM fallback, bukan MAPID Maps resmi.'
  )
}

/**
 * MapView — komponen peta inti GeoTransit Insight.
 *
 * Props:
 *  - simulationMode: boolean — kalau true, klik di peta akan memanggil onMapClick
 *    dengan {lat, lon} (dipakai fitur Simulasi What-If)
 *  - onMapClick: (coords: {lat, lon}) => void
 *  - markers: array of {lat, lon, color?, popupText?} — dipakai untuk render
 *    halte eksisting / titik kandidat / hasil simulasi
 */
export default function MapView({ simulationMode = false, onMapClick, markers = [] }) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRefs = useRef([])

  // Init peta sekali saat komponen pertama kali render
  useEffect(() => {
    if (mapRef.current) return

    mapRef.current = new MapLibreMap({
      container: containerRef.current,
      style: mapStyle,
      center: BEKASI_CENTER,
      zoom: BEKASI_ZOOM,
    })

    mapRef.current.addControl(new NavigationControl(), 'top-right')

    return () => {
      mapRef.current?.remove()
      mapRef.current = null
    }
  }, [])

  // Klik peta -> trigger callback saat simulationMode aktif
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const handleClick = (e) => {
      if (!simulationMode) return
      onMapClick?.({ lat: e.lngLat.lat, lon: e.lngLat.lng })
    }

    map.on('click', handleClick)
    return () => map.off('click', handleClick)
  }, [simulationMode, onMapClick])

  // Update cursor supaya jelas kapan mode simulasi aktif
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    map.getCanvas().style.cursor = simulationMode ? 'crosshair' : ''
  }, [simulationMode])

  // Render markers setiap kali prop markers berubah
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    markerRefs.current.forEach((m) => m.remove())
    markerRefs.current = markers.map((m) => {
      const el = document.createElement('div')
      el.style.width = '14px'
      el.style.height = '14px'
      el.style.borderRadius = '50%'
      el.style.border = '2px solid white'
      el.style.boxShadow = '0 1px 3px rgba(0,0,0,0.4)'
      el.style.background = m.color || '#1B659D'

      const marker = new Marker({ element: el }).setLngLat([m.lon, m.lat])

      if (m.popupText) {
        marker.setPopup(new Popup({ offset: 12 }).setText(m.popupText))
      }
      marker.addTo(map)
      return marker
    })
  }, [markers])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {simulationMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-brand-orange text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg">
          Mode Simulasi aktif — klik di peta untuk menguji lokasi halte baru
        </div>
      )}
    </div>
  )
}

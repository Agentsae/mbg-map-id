import { useEffect, useRef } from 'react'
import { Map as MapLibreMap, NavigationControl, Marker, Popup } from 'maplibre-gl'
import 'maplibre-gl/dist/maplibre-gl.css'

// Pusat peta: Kota Bekasi (perkiraan dari titik Summarecon Bekasi di proposal)
const BEKASI_CENTER = [107.0074, -6.2185]
const BEKASI_ZOOM = 12

// ⚠️ PLACEHOLDER BASEMAP — pakai raster OSM gratis, tanpa API key, supaya
// skeleton ini langsung bisa dijalankan hari ini. GANTI dengan basemap
// MAPID Maps begitu format tile URL/API key-nya dikonfirmasi (lihat
// FRAMEWORK_GeoTransitInsight.md Bagian 1 & 10). Cari komentar "GANTI DI SINI"
// di bawah untuk lokasi persis yang perlu diedit.
const PLACEHOLDER_STYLE = {
  version: 8,
  sources: {
    osm: {
      type: 'raster',
      tiles: ['https://tile.openstreetmap.org/{z}/{x}/{y}.png'],
      tileSize: 256,
      attribution: '© OpenStreetMap contributors — GANTI ke MAPID Maps sebelum submission',
    },
  },
  layers: [{ id: 'osm-basemap', type: 'raster', source: 'osm' }],
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
      style: PLACEHOLDER_STYLE, // GANTI DI SINI: ganti PLACEHOLDER_STYLE dengan style/tile URL MAPID Maps
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

      const marker = new Marker({ element: el })
        .setLngLat([m.lon, m.lat])

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

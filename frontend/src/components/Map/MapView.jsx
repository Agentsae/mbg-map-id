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
 *  - markers: array of {lat, lon, color?, popupText?, popupHtml?, onClick?} —
 *    dipakai untuk render halte eksisting / titik kandidat / hasil simulasi.
 *    popupHtml (opsional) dipakai kalau butuh format lebih dari satu baris
 *    (mis. deskripsi + wilayah + catatan titik kandidat); kalau ada,
 *    didahulukan dari popupText. onClick (opsional) dipanggil saat marker
 *    itu sendiri diklik langsung (bukan cuma klik peta lalu dicari terdekat)
 *    — dipakai supaya titik_kandidat bisa langsung dipilih dari markernya.
 *  - layers: array of { id, type: 'fill'|'line'|'circle', data: GeoJSON, paint?, layout?,
 *    visible?, popupHtml? } — generic GeoJSON layer, dipakai untuk multi-layer gap
 *    analysis (Analisis Spasial) maupun layer rute transit (Peta Interaktif, lihat
 *    App.jsx). Sengaja generik (bukan hardcode nama layer) supaya dipakai ulang oleh
 *    instance MapView manapun tanpa menambah pola integrasi baru. `popupHtml` opsional:
 *    kalau diisi, klik pada FITUR APA PUN di layer itu akan menampilkan popup statis
 *    berisi HTML ini (dipakai mis. untuk disclaimer "rute aproksimasi, bukan resmi
 *    operator" pada layer koridor BisKita) — bukan popup per-fitur individual seperti
 *    `markers`, cukup untuk kasus satu layer = satu pesan seragam.
 *  - children: overlay opsional yang dirender di atas canvas peta (mis.
 *    <CaiScorePanel>) — diposisikan absolute di dalam container relative,
 *    tidak menggantikan canvas MapLibre. Kalau tidak dikirim (mis. dipakai
 *    dari AnalisisSpasial), tidak merender apa pun tambahan.
 */
export default function MapView({
  simulationMode = false,
  onMapClick,
  markers = [],
  layers = [],
  children,
}) {
  const containerRef = useRef(null)
  const mapRef = useRef(null)
  const markerRefs = useRef([])
  const layerIdsRef = useRef([])

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

  // Klik peta -> trigger callback selalu (bukan hanya saat simulationMode
  // aktif). Pemanggil (App.jsx) yang memutuskan alur mana yang jalan
  // (simulasi RPC vs cek skor CAI) berdasarkan mode aktifnya sendiri — kalau
  // handler ini dibatasi ke simulationMode saja, klik peta biasa di luar
  // mode simulasi tidak akan pernah memicu panel skor CAI sama sekali
  // (bug: acceptance criteria "klik lokasi di peta -> skor CAI" jadi mati).
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const handleClick = (e) => {
      // Prioritaskan layer GeoJSON generik yang punya popupHtml (mis. disclaimer
      // rute BisKita — lihat App.jsx) sebelum meneruskan ke onMapClick. Dicek
      // lewat queryRenderedFeatures di DALAM handler klik generik yang sama
      // (bukan map.on('click', layerId, ...) terpisah) supaya urutan eksekusi
      // deterministik — MapLibre tidak menjamin urutan antar listener 'click'
      // kalau didaftarkan lewat pemanggilan map.on() yang berbeda.
      const clickableLayerIds = layers
        .filter((l) => l.popupHtml && l.visible !== false && map.getLayer(l.id))
        .map((l) => l.id)

      if (clickableLayerIds.length) {
        const hits = map.queryRenderedFeatures(e.point, { layers: clickableLayerIds })
        if (hits.length) {
          const hitLayer = layers.find((l) => l.id === hits[0].layer.id)
          if (hitLayer?.popupHtml) {
            new Popup({ offset: 8 }).setLngLat(e.lngLat).setHTML(hitLayer.popupHtml).addTo(map)
            return
          }
        }
      }

      onMapClick?.({ lat: e.lngLat.lat, lon: e.lngLat.lng })
    }

    map.on('click', handleClick)
    return () => map.off('click', handleClick)
  }, [onMapClick, layers])

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

      if (m.popupHtml) {
        marker.setPopup(new Popup({ offset: 12 }).setHTML(m.popupHtml))
      } else if (m.popupText) {
        marker.setPopup(new Popup({ offset: 12 }).setText(m.popupText))
      }

      if (m.onClick) {
        el.style.cursor = 'pointer'
        el.addEventListener('click', (ev) => {
          // Hentikan propagasi supaya klik marker tidak juga dihitung sebagai
          // klik peta biasa (mis. memicu mode simulasi di koordinat lain).
          ev.stopPropagation()
          m.onClick()
        })
      }

      marker.addTo(map)
      return marker
    })
  }, [markers])

  // Sinkronisasi layer GeoJSON generik (mis. grid kepadatan, jaringan transit,
  // indeks gap aksesibilitas untuk Analisis Spasial). addSource/addLayer harus
  // menunggu style selesai load, jadi pakai isStyleLoaded() + fallback event 'load'.
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const applyLayers = () => {
      const nextIds = new Set(layers.map((l) => l.id))
      // Buang layer/source lama yang sudah tidak ada di prop terbaru
      layerIdsRef.current.forEach((id) => {
        if (!nextIds.has(id)) {
          if (map.getLayer(id)) map.removeLayer(id)
          if (map.getSource(id)) map.removeSource(id)
        }
      })

      layers.forEach((layer) => {
        const { id, type, data, paint = {}, layout = {}, visible = true } = layer
        if (map.getSource(id)) {
          map.getSource(id).setData(data)
        } else {
          map.addSource(id, { type: 'geojson', data })
        }
        if (!map.getLayer(id)) {
          map.addLayer({ id, type, source: id, paint, layout })
        } else {
          Object.entries(paint).forEach(([k, v]) => map.setPaintProperty(id, k, v))
        }
        map.setLayoutProperty(id, 'visibility', visible ? 'visible' : 'none')
      })

      layerIdsRef.current = layers.map((l) => l.id)
    }

    if (map.isStyleLoaded()) {
      applyLayers()
    } else {
      map.once('load', applyLayers)
    }
  }, [layers])

  return (
    <div className="relative w-full h-full">
      <div ref={containerRef} className="w-full h-full" />
      {simulationMode && (
        <div className="absolute top-3 left-1/2 -translate-x-1/2 bg-brand-orange text-white text-sm font-medium px-4 py-2 rounded-full shadow-lg">
          Mode Simulasi aktif — klik di peta untuk menguji lokasi halte baru
        </div>
      )}
      {children}
    </div>
  )
}

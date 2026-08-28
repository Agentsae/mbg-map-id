import { useCallback, useEffect, useState } from 'react'
import {
  LayoutDashboard,
  Map as MapIcon,
  SlidersHorizontal,
  Sparkles,
  MousePointerClick,
  Lightbulb,
  FileDown,
  Settings,
} from 'lucide-react'
import MapView from './components/Map/MapView'
import CaiScorePanel from './components/Map/CaiScorePanel'
import MapLegend from './components/Map/MapLegend'
import AIPanel from './components/AIPanel/AIPanel'
import AnalisisSpasial from './components/AnalisisSpasial/AnalisisSpasial'
import SimulationPanel from './components/SimulationMode/SimulationPanel'
import Dashboard from './components/Dashboard/Dashboard'
import EquityIndexView from './components/EquityIndexView/EquityIndexView'
import ComingSoon from './components/ComingSoon/ComingSoon'
import { supabase, isConfigured } from './lib/supabaseClient'
import { extractLatLon, extractLineStringCoords, findNearestPoint } from './lib/geo'
import { isSurveyPlaceholderPoint } from './lib/titikKandidat'
import { isDummyHalte } from './lib/halteEksisting'

// 8 menu sidebar sesuai wireframe resmi PRD (Gambar 3, lihat CLAUDE.md).
// Menu yang belum punya komponen nyata dipetakan ke ComingSoon di bawah —
// jangan ditinggal jadi link mati, tapi juga jangan dibangun lebih dulu
// dari jadwal fase (lihat docs/BUILD_CHECKLIST.md).
const TABS = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'peta', label: 'Peta Interaktif', icon: MapIcon },
  { id: 'analisis', label: 'Analisis Spasial', icon: SlidersHorizontal },
  { id: 'ai', label: 'AI Spatial Consultant', icon: Sparkles },
  { id: 'simulasi', label: 'Simulasi Skenario', icon: MousePointerClick },
  { id: 'rekomendasi', label: 'Rekomendasi', icon: Lightbulb },
  { id: 'data-laporan', label: 'Data & Laporan', icon: FileDown },
  { id: 'pengaturan', label: 'Pengaturan', icon: Settings },
]

const DEMO_SIMULATION_RESULT = {
  penduduk_terlayani_400m: 3120,
  penduduk_terlayani_800m: 9840,
  estimasi_pengurangan_waktu_tempuh_menit: 6.5,
  fasilitas_pendidikan_400m: 2,
  fasilitas_kesehatan_400m: 1,
  transit_eksisting_terdekat: { nama: 'Halte Summarecon Bekasi (contoh)', jarak_m: 520 },
}

// Data contoh titik_kandidat + skor_cai — dipakai kalau Supabase belum
// tersambung/tabel masih kosong, supaya fitur "klik peta -> skor CAI" tetap
// bisa didemokan. Struktur field sengaja meniru kolom asli skor_cai
// (migration 001_init_tables.sql) — TIDAK ada formula dihitung di sini,
// murni angka contoh statis.
const DEMO_CAI_POINTS = [
  {
    lat: -6.2185, lon: 107.0074,
    titik: { id_titik_survei: 'KND-DEMO-001', deskripsi_lokasi: 'Depan Summarecon Mall Bekasi (contoh)', kecamatan: 'Bekasi Utara', kelurahan: 'Marga Mulya', catatan: null },
    skor: { n_kepadatan: 0.82, n_jarak_inv: 0.55, n_volume: 0.70, n_survei: 0.60, bobot_kepadatan: 0.35, bobot_jarak: 0.25, bobot_volume: 0.25, bobot_survei: 0.15, skor_final: 0.69 },
  },
  {
    lat: -6.2461, lon: 107.0021,
    titik: { id_titik_survei: 'KND-DEMO-002', deskripsi_lokasi: 'Simpang Jl. Ir. H. Juanda (contoh)', kecamatan: 'Bekasi Timur', kelurahan: 'Margahayu', catatan: null },
    skor: { n_kepadatan: 0.90, n_jarak_inv: 0.70, n_volume: 0.20, n_survei: 0.55, bobot_kepadatan: 0.35, bobot_jarak: 0.25, bobot_volume: 0.25, bobot_survei: 0.15, skor_final: 0.62 },
  },
  {
    lat: -6.2603, lon: 107.0324,
    titik: { id_titik_survei: 'KND-DEMO-003', deskripsi_lokasi: 'Terminal Bekasi (contoh)', kecamatan: 'Bekasi Selatan', kelurahan: 'Margajaya', catatan: null },
    skor: { n_kepadatan: 0.65, n_jarak_inv: 0.40, n_volume: 0.85, n_survei: 0.75, bobot_kepadatan: 0.35, bobot_jarak: 0.25, bobot_volume: 0.25, bobot_survei: 0.15, skor_final: 0.65 },
  },
  {
    lat: -6.2825, lon: 107.0450,
    titik: { id_titik_survei: 'KND-DEMO-004', deskripsi_lokasi: 'Perempatan Rawa Lumbu (contoh)', kecamatan: 'Rawa Lumbu', kelurahan: 'Sepanjang Jaya', catatan: null },
    skor: { n_kepadatan: 0.75, n_jarak_inv: 0.80, n_volume: 0.15, n_survei: 0.40, bobot_kepadatan: 0.35, bobot_jarak: 0.25, bobot_volume: 0.25, bobot_survei: 0.15, skor_final: 0.55 },
  },
  {
    lat: -6.2989, lon: 107.0658,
    titik: { id_titik_survei: 'KND-DEMO-005', deskripsi_lokasi: 'Jl. Raya Mustika Jaya (contoh)', kecamatan: 'Mustika Jaya', kelurahan: 'Mustika Jaya', catatan: null },
    skor: { n_kepadatan: 0.88, n_jarak_inv: 0.85, n_volume: 0.10, n_survei: 0.35, bobot_kepadatan: 0.35, bobot_jarak: 0.25, bobot_volume: 0.25, bobot_survei: 0.15, skor_final: 0.58 },
  },
]

// Data contoh halte_eksisting — dipakai kalau Supabase belum tersambung/tabel
// masih kosong, supaya layer "jaringan transit eksisting" (acceptance criteria
// Peta Multi-Layer Gap Analysis, CLAUDE.md) tetap tampil. Koordinat & nama
// meniru sebagian titik nyata koridor BisKita di
// etl/data/survei/koordinat_halte_koridor_biskita.csv — ditandai "(contoh)"
// karena ini bukan hasil query tabel asli.
const DEMO_HALTE_POINTS = [
  { lat: -6.25645, lon: 106.99116, nama: 'Halte Simpang Pekayon (contoh)', kecamatan: 'Bekasi Selatan' },
  { lat: -6.25558, lon: 106.99061, nama: 'Halte Revo Mall (contoh)', kecamatan: 'Bekasi Selatan' },
  { lat: -6.2771474, lon: 106.9919647, nama: 'Halte RS Elisabeth (contoh)', kecamatan: 'Bekasi Selatan' },
  { lat: -6.2917104, lon: 106.9848925, nama: 'Halte Pesona Metropolitan Bekasi (contoh)', kecamatan: 'Bekasi Selatan' },
  { lat: -6.30884, lon: 106.98381, nama: 'Halte STISIP Bekasi (contoh)', kecamatan: 'Bekasi Selatan' },
]

// Data contoh rute_transit_eksisting — dipakai kalau Supabase belum
// tersambung/tabel masih kosong, meniru struktur 2 layer nyata (koridor
// BisKita tersurvei + jaringan rel KRL, lihat docs/DATA_CHECKLIST.md Tugas B).
// Koordinat BisKita meniru DEMO_HALTE_POINTS di atas; koordinat KRL murni
// ilustratif (ditandai "(contoh)"), BUKAN jejak rel sungguhan.
const DEMO_RUTE_BISKITA_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: DEMO_HALTE_POINTS.map((h) => [h.lon, h.lat]) },
      properties: { nama: 'Koridor BisKita (contoh)' },
    },
  ],
}
const DEMO_RUTE_KRL_GEOJSON = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: {
        type: 'LineString',
        coordinates: [
          [106.9928, -6.2394],
          [107.0074, -6.2185],
        ],
      },
      properties: { nama: 'Jalur KRL Commuter Line (contoh)' },
    },
  ],
}
const DEMO_RUTE_KRL_STASIUN = [
  { lat: -6.2394, lon: 106.9928, nama: 'Stasiun Bekasi (contoh)' },
]
const DEMO_RUTE_TRANSIT_DISCLAIMER =
  'Data contoh — belum tersambung ke tabel rute_transit_eksisting.'

// Warna marker titik_kandidat di peta — dibedakan sederhana antara titik yang
// skornya sepenuhnya final vs titik baru yang sebagian kriterianya masih
// proxy/placeholder (lihat isSurveyPlaceholderPoint). Palet & bentuk akhir
// TODO(ui-ux-designer): ini asumsi sementara, bukan keputusan desain final.
const CANDIDATE_MARKER_COLOR = '#2E7D5B'
const CANDIDATE_MARKER_COLOR_PLACEHOLDER = '#B5851B'

// Warna marker halte TERSURVEI — sengaja beda rumpun warna (ungu) dari
// hijau/kuning titik_kandidat di atas supaya "halte yang sudah ada" vs
// "usulan lokasi baru" langsung terlihat beda tanpa harus buka popup dulu.
// TODO(ui-ux-designer): ini asumsi sementara, bukan keputusan desain final.
const HALTE_TERSURVEI_MARKER_COLOR = '#7C3AED'

// Warna garis koridor BisKita — sengaja DIBEDAKAN dari marker halte tersurvei
// (dulu sama-sama #7C3AED, jadi sulit dibedakan "ini titik halte" vs "ini
// garis rute" sekilas pandang). Dipilih oranye (referensi warna brand BisKita
// di beberapa kota nyata) supaya tetap kerasa "satu keluarga BisKita" dari sisi
// makna, tapi kontras jelas terhadap ungu halte maupun biru KRL — 3 warna jadi
// gampang dibedakan sekilas: ungu=titik halte, oranye=garis BisKita, biru=KRL.
// TODO(ui-ux-designer): ini asumsi sementara, bukan keputusan desain final.
const RUTE_BISKITA_COLOR = '#F97316'

// Warna jaringan KRL — sengaja beda rumpun (biru) dari ungu BisKita di atas
// supaya "infrastruktur eksis tapi belum disurvei tim" langsung terlihat beda
// dari korridor yang sudah jadi objek survei. Biru dipilih supaya familiar ke
// user awam (asosiasi umum warna KRL Commuter Line Indonesia).
// TODO(ui-ux-designer): ini asumsi sementara, bukan keputusan desain final.
const RUTE_KRL_COLOR = '#2563EB'

function escapeHtml(str) {
  return String(str ?? '').replace(/[&<>"']/g, (c) => (
    { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]
  ))
}

function buildCandidatePopupHtml(titik) {
  const lines = []
  if (titik?.deskripsi_lokasi) lines.push(`<strong>${escapeHtml(titik.deskripsi_lokasi)}</strong>`)
  const wilayah = [titik?.kelurahan, titik?.kecamatan].filter(Boolean).join(', ')
  if (wilayah) lines.push(escapeHtml(wilayah))
  if (isSurveyPlaceholderPoint(titik?.id_titik_survei)) {
    lines.push('<em>Sebagian kriteria skor masih data sementara</em>')
  }
  if (titik?.catatan) {
    lines.push(escapeHtml(titik.catatan))
  }
  lines.push('<span style="color:#64748b">Klik untuk lihat rincian skor CAI</span>')
  return lines.join('<br/>')
}

// Popup halte_eksisting sengaja minimal (nama + wilayah) — rincian survei
// lengkap (headway, okupansi, dst) itu domain tab Analisis Spasial, bukan
// tab Peta Interaktif ini. Label "Halte Tersurvei" (bukan "Halte Eksisting")
// sengaja dipakai: halte yang belum disurvei pun tetap eksis secara fisik,
// yang benar-benar membedakan baris ini adalah status SUDAH DISURVEI tim,
// bukan keberadaan fisiknya (lihat juga layer KRL di bawah — eksis tapi
// belum disurvei).
function buildHaltePopupHtml(halte) {
  const lines = [`<strong>${escapeHtml(halte?.nama || 'Halte Tersurvei')}</strong>`]
  if (halte?.kecamatan) lines.push(escapeHtml(halte.kecamatan))
  lines.push('<span style="color:#64748b">Halte tersurvei (koridor BisKita)</span>')
  return lines.join('<br/>')
}

// Popup layer garis "Koridor BisKita (tersurvei)" — statis, sama untuk
// seluruh garis (satu layer = satu pesan, lihat popupHtml di MapView.jsx).
// Isi disclaimer diambil LANGSUNG dari kolom `catatan` baris
// rute_transit_eksisting (ditulis data-ai-analyst) — bukan dikarang di
// frontend — supaya kalau redaksinya direvisi di database, popup ikut
// berubah tanpa perlu redeploy frontend.
function buildBiskitaPopupHtml(catatan) {
  const lines = [
    '<strong>Koridor BisKita (tersurvei)</strong>',
    '<span style="color:#b45309">Aproksimasi — bukan rute resmi operator/GTFS</span>',
  ]
  if (catatan) lines.push(escapeHtml(catatan))
  return lines.join('<br/>')
}

// Popup layer garis jaringan KRL — statis (satu layer = satu pesan). Isi
// diambil dari kolom `catatan` baris rute_transit_eksisting jenis='krl'
// (identik di semua baris krl saat ini) — bukan dikarang di frontend.
function buildKrlPopupHtml(catatan) {
  const lines = [
    '<strong>Jalur KRL Commuter Line</strong>',
    '<span style="color:#64748b">Infrastruktur eksis — belum disurvei lapangan oleh tim</span>',
  ]
  if (catatan) lines.push(escapeHtml(catatan))
  return lines.join('<br/>')
}

// Popup marker titik stasiun KRL — nama kolom `nama` di database untuk baris
// ini kosong (spasi), jadi WAJIB fallback teks generik supaya popup tidak
// blank (bukan bug, memang begitu datanya — lihat docs/DATA_CHECKLIST.md).
function buildKrlStasiunPopupHtml(nama, catatan) {
  const lines = [
    `<strong>${escapeHtml(nama?.trim() ? nama.trim() : 'Stasiun KRL Commuter Line')}</strong>`,
    '<span style="color:#64748b">Infrastruktur eksis — belum disurvei lapangan oleh tim</span>',
  ]
  if (catatan) lines.push(escapeHtml(catatan))
  return lines.join('<br/>')
}

export default function App() {
  const [activeTab, setActiveTab] = useState('peta')

  // --- Simulasi What-If ---
  const [simulationActive, setSimulationActive] = useState(false)
  const [simLoading, setSimLoading] = useState(false)
  const [simResult, setSimResult] = useState(null)

  // --- Skor CAI per klik lokasi (Fase 2 — Composite Accessibility Index) ---
  const [caiLoading, setCaiLoading] = useState(false)
  const [caiResult, setCaiResult] = useState(null)
  const [caiUsingDemo, setCaiUsingDemo] = useState(!isConfigured)

  // Daftar titik_kandidat + skor_cai — di-fetch sekali di awal supaya klik peta
  // instan (tidak query ulang tiap klik) DAN supaya bisa dirender sebagai marker
  // di peta (state, bukan ref, karena harus memicu render ulang marker). Ini
  // murni membaca hasil yang sudah dihitung data-ai-analyst, bukan menghitung
  // ulang formula CAI di frontend. Query TANPA filter/limit ketat (limit 500
  // jauh di atas jumlah baris riil saat ini) supaya seluruh titik_kandidat
  // ikut, bukan subset.
  const [caiPoints, setCaiPoints] = useState({ points: DEMO_CAI_POINTS, usingDemo: !isConfigured })

  // Daftar halte_eksisting (jaringan transit eksisting, koridor BisKita) —
  // fetch sekali di awal, sama polanya dengan caiPoints di atas, supaya
  // acceptance criteria "Peta Multi-Layer Gap Analysis" (layer jaringan
  // transit eksisting, lihat CLAUDE.md) benar-benar tampil di tab Peta
  // Interaktif, bukan cuma di tab Analisis Spasial. Baris dummy/seed testing
  // (id_halte_survei berprefix "DUMMY-HLT-") dibuang — lihat lib/halteEksisting.js.
  const [haltePoints, setHaltePoints] = useState({ points: DEMO_HALTE_POINTS, usingDemo: !isConfigured })

  useEffect(() => {
    if (!isConfigured) return

    supabase
      .from('halte_eksisting')
      .select('id, id_halte_survei, nama, geom, kecamatan, kelurahan')
      .limit(500)
      .then(({ data, error }) => {
        if (error || !data?.length) {
          setHaltePoints({ points: DEMO_HALTE_POINTS, usingDemo: true })
          return
        }
        const points = data
          .filter((row) => !isDummyHalte(row.id_halte_survei))
          .map((row) => {
            const coords = extractLatLon(row.geom)
            if (!coords) return null
            return { ...coords, nama: row.nama, kecamatan: row.kecamatan, kelurahan: row.kelurahan }
          })
          .filter(Boolean)

        setHaltePoints(
          points.length
            ? { points, usingDemo: false }
            : { points: DEMO_HALTE_POINTS, usingDemo: true }
        )
      })
  }, [])

  // Rute transit eksisting — 2 layer terpisah dari tabel rute_transit_eksisting
  // (migration 013): koridor BisKita TERSURVEI (jenis='biskita_survei',
  // LineString) dan jaringan KRL yang EKSIS TAPI BELUM DISURVEI tim
  // (jenis='krl', campuran LineString ruas rel + Point stasiun). Fetch sekali
  // di awal, sama polanya dengan haltePoints/caiPoints di atas. `nama` untuk
  // sebagian baris krl memang kosong di database (bukan bug) — popup builder
  // di atas (buildKrlPopupHtml/buildKrlStasiunPopupHtml) sudah fallback ke
  // teks generik supaya tidak blank.
  const [ruteTransit, setRuteTransit] = useState({
    biskitaGeoJSON: DEMO_RUTE_BISKITA_GEOJSON,
    biskitaPopupHtml: buildBiskitaPopupHtml(DEMO_RUTE_TRANSIT_DISCLAIMER),
    krlLinesGeoJSON: DEMO_RUTE_KRL_GEOJSON,
    krlPopupHtml: buildKrlPopupHtml(DEMO_RUTE_TRANSIT_DISCLAIMER),
    krlStasiunPoints: DEMO_RUTE_KRL_STASIUN.map((s) => ({
      ...s,
      popupHtml: buildKrlStasiunPopupHtml(s.nama, DEMO_RUTE_TRANSIT_DISCLAIMER),
    })),
    usingDemo: !isConfigured,
  })

  useEffect(() => {
    if (!isConfigured) return

    supabase
      .from('rute_transit_eksisting')
      .select('id, nama, jenis, tipe_geometri, geom, sumber, catatan')
      .limit(500)
      .then(({ data, error }) => {
        if (error || !data?.length) return // biarkan fallback demo di state awal

        const biskitaRows = data.filter((r) => r.jenis === 'biskita_survei' && r.tipe_geometri === 'line')
        const krlLineRows = data.filter((r) => r.jenis === 'krl' && r.tipe_geometri === 'line')
        const krlPointRows = data.filter((r) => r.jenis === 'krl' && r.tipe_geometri === 'point')

        const toLineFeatures = (rows) =>
          rows
            .map((row) => {
              const coords = extractLineStringCoords(row.geom)
              if (!coords?.length) return null
              return {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: coords },
                properties: { nama: row.nama?.trim() || null },
              }
            })
            .filter(Boolean)

        const biskitaFeatures = toLineFeatures(biskitaRows)
        const krlLineFeatures = toLineFeatures(krlLineRows)

        const krlStasiunPoints = krlPointRows
          .map((row) => {
            const coords = extractLatLon(row.geom)
            if (!coords) return null
            return {
              ...coords,
              nama: row.nama,
              popupHtml: buildKrlStasiunPopupHtml(row.nama, row.catatan),
            }
          })
          .filter(Boolean)

        setRuteTransit({
          biskitaGeoJSON: biskitaFeatures.length
            ? { type: 'FeatureCollection', features: biskitaFeatures }
            : DEMO_RUTE_BISKITA_GEOJSON,
          biskitaPopupHtml: buildBiskitaPopupHtml(biskitaRows[0]?.catatan),
          krlLinesGeoJSON: krlLineFeatures.length
            ? { type: 'FeatureCollection', features: krlLineFeatures }
            : DEMO_RUTE_KRL_GEOJSON,
          krlPopupHtml: buildKrlPopupHtml(krlLineRows[0]?.catatan ?? krlPointRows[0]?.catatan),
          krlStasiunPoints: krlStasiunPoints.length ? krlStasiunPoints : DEMO_RUTE_KRL_STASIUN,
          usingDemo: !(biskitaFeatures.length || krlLineFeatures.length || krlStasiunPoints.length),
        })
      })
  }, [])

  // Marker tunggal untuk lokasi yang baru diklik bebas (dipakai kedua mode:
  // simulasi & cek skor CAI di lokasi non-titik-kandidat)
  const [clickMarker, setClickMarker] = useState(null)

  useEffect(() => {
    if (!isConfigured) return

    supabase
      .from('titik_kandidat')
      .select(
        'id, id_titik_survei, deskripsi_lokasi, kecamatan, kelurahan, catatan, geom, ' +
        'skor_cai(n_kepadatan, n_jarak_inv, n_volume, n_survei, ' +
        'bobot_kepadatan, bobot_jarak, bobot_volume, bobot_survei, skor_final)'
      )
      .limit(500)
      .then(({ data, error }) => {
        if (error || !data?.length) {
          setCaiPoints({ points: DEMO_CAI_POINTS, usingDemo: true })
          return
        }
        const points = data
          .map((row) => {
            const coords = extractLatLon(row.geom)
            if (!coords) return null
            const skorRow = Array.isArray(row.skor_cai) ? row.skor_cai[0] : row.skor_cai
            if (!skorRow) return null
            return {
              lat: coords.lat,
              lon: coords.lon,
              titik: {
                id_titik_survei: row.id_titik_survei,
                deskripsi_lokasi: row.deskripsi_lokasi,
                kecamatan: row.kecamatan,
                kelurahan: row.kelurahan,
                catatan: row.catatan,
              },
              skor: skorRow,
            }
          })
          .filter(Boolean)

        setCaiPoints(
          points.length
            ? { points, usingDemo: false }
            : { points: DEMO_CAI_POINTS, usingDemo: true }
        )
      })
  }, [])

  const handleMapClick = useCallback(async ({ lat, lon }) => {
    if (simulationActive) {
      // --- Alur Simulasi What-If (RPC simulate_new_stop) ---
      setSimLoading(true)
      setCaiResult(null)
      setClickMarker({ lat, lon, color: '#E08A1E', popupText: 'Lokasi simulasi' })

      try {
        if (isConfigured) {
          const { data, error } = await supabase.rpc('simulate_new_stop', { lat, lon })
          if (error) throw error
          setSimResult(data)
        } else {
          await new Promise((r) => setTimeout(r, 500))
          setSimResult(DEMO_SIMULATION_RESULT)
        }
      } catch (err) {
        console.error('Gagal menjalankan simulate_new_stop:', err)
        setSimResult(null)
      } finally {
        setSimLoading(false)
      }
      return
    }

    // --- Alur skor CAI (klik lokasi -> cari titik_kandidat terdekat) ---
    setCaiLoading(true)
    setSimResult(null)
    setClickMarker({ lat, lon, color: '#1B659D', popupText: 'Lokasi dicek' })

    const nearest = findNearestPoint(caiPoints.points, { lat, lon })

    setCaiUsingDemo(caiPoints.usingDemo)
    setCaiResult(
      nearest
        ? { skor: nearest.point.skor, titik: nearest.point.titik, distance_m: nearest.distance_m }
        : { skor: null }
    )
    setCaiLoading(false)
  }, [simulationActive, caiPoints])

  function handleToggleSimulation() {
    setSimulationActive((v) => !v)
    if (simulationActive) {
      // matikan mode -> bersihkan hasil supaya tidak membingungkan sesi berikutnya
      setSimResult(null)
      setClickMarker(null)
    } else {
      setCaiResult(null)
    }
  }

  const showPanel = activeTab !== 'peta'

  // Marker visual untuk seluruh titik_kandidat (supaya user LIHAT titik di peta
  // dulu, bukan menebak lokasi lalu klik "buta") + marker lokasi yang baru
  // diklik bebas (kalau ada). Klik langsung pada marker titik kandidat memanggil
  // handleMapClick di koordinat titik itu sendiri (nearest-search akan
  // menemukan dirinya sendiri, distance ~0m).
  const candidateMarkers = caiPoints.points.map((p) => ({
    lat: p.lat,
    lon: p.lon,
    color: isSurveyPlaceholderPoint(p.titik?.id_titik_survei)
      ? CANDIDATE_MARKER_COLOR_PLACEHOLDER
      : CANDIDATE_MARKER_COLOR,
    popupHtml: buildCandidatePopupHtml(p.titik),
    onClick: () => handleMapClick({ lat: p.lat, lon: p.lon }),
  }))

  // Marker halte tersurvei — warna ungu terpisah dari hijau/kuning titik
  // kandidat di atas. onClick no-op (bukan () => undefined biasa) hanya untuk
  // stopPropagation di MapView supaya klik marker tidak juga memicu
  // handleMapClick di peta di baliknya (yang akan salah membuka panel skor
  // CAI seolah halte ini adalah titik kandidat).
  const halteMarkers = haltePoints.points.map((h) => ({
    lat: h.lat,
    lon: h.lon,
    color: HALTE_TERSURVEI_MARKER_COLOR,
    popupHtml: buildHaltePopupHtml(h),
    onClick: () => {},
  }))

  // Marker titik stasiun KRL (jenis='krl', tipe_geometri='point') — sama pola
  // stopPropagation seperti halteMarkers, warna biru RUTE_KRL_COLOR terpisah
  // dari ungu halte tersurvei supaya beda status "eksis tapi belum disurvei"
  // langsung terlihat tanpa buka popup dulu.
  const krlStasiunMarkers = ruteTransit.krlStasiunPoints.map((s) => ({
    lat: s.lat,
    lon: s.lon,
    color: RUTE_KRL_COLOR,
    popupHtml: s.popupHtml,
    onClick: () => {},
  }))

  const markers = [
    ...halteMarkers,
    ...krlStasiunMarkers,
    ...candidateMarkers,
    ...(clickMarker ? [clickMarker] : []),
  ]

  // Layer garis rute transit eksisting — 2 layer terpisah dengan visual jelas
  // berbeda (lihat konstanta warna RUTE_BISKITA_COLOR/RUTE_KRL_COLOR di atas).
  // BisKita: solid tebal (line-width 5, tanpa dasharray) supaya jelas beda
  // bentuk juga dari KRL (dashed, lebih tipis) — bukan cuma beda warna.
  // popupHtml statis per layer (bukan per-fitur) — cukup untuk kasus "satu
  // layer = satu pesan disclaimer/status", lihat dukungan popupHtml generik
  // di MapView.jsx.
  const ruteLayers = [
    {
      id: 'rute-biskita-tersurvei',
      type: 'line',
      data: ruteTransit.biskitaGeoJSON,
      paint: { 'line-color': RUTE_BISKITA_COLOR, 'line-width': 5, 'line-opacity': 0.9 },
      popupHtml: ruteTransit.biskitaPopupHtml,
    },
    {
      id: 'rute-krl-eksisting',
      type: 'line',
      data: ruteTransit.krlLinesGeoJSON,
      paint: {
        'line-color': RUTE_KRL_COLOR,
        'line-width': 3,
        'line-opacity': 0.85,
        'line-dasharray': [2, 1.5],
      },
      popupHtml: ruteTransit.krlPopupHtml,
    },
  ]

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50">
      {/* Header */}
      <header className="flex items-center gap-3 px-4 py-3 bg-brand-blue text-white shrink-0">
        <div className="w-8 h-8 rounded-md bg-white/15 flex items-center justify-center font-bold">
          GI
        </div>
        <div>
          <h1 className="font-semibold leading-tight">GeoTransit Insight</h1>
          <p className="text-xs text-white/70 leading-tight">Kota Bekasi — Tim MBG</p>
        </div>
        {!isConfigured && (
          <span className="ml-auto text-xs bg-amber-400/20 text-amber-100 border border-amber-300/40 rounded-full px-3 py-1">
            Mode demo — Supabase belum tersambung
          </span>
        )}
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar nav — 8 menu sesuai wireframe PRD (Gambar 3) */}
        <nav className="w-16 shrink-0 bg-white border-r border-slate-200 flex flex-col items-center py-3 gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              title={label}
              className={
                'w-12 h-12 rounded-lg flex flex-col items-center justify-center gap-0.5 text-[10px] transition ' +
                (activeTab === id
                  ? 'bg-brand-blue/10 text-brand-blue'
                  : 'text-slate-400 hover:bg-slate-100 hover:text-slate-600')
              }
            >
              <Icon size={18} />
            </button>
          ))}
        </nav>

        {/* Map */}
        <main className="flex-1 relative">
          <MapView
            simulationMode={simulationActive}
            onMapClick={handleMapClick}
            markers={markers}
            layers={ruteLayers}
          >
            <CaiScorePanel
              loading={caiLoading}
              result={caiResult}
              usingDemo={caiUsingDemo}
              onClose={() => {
                setCaiResult(null)
                setClickMarker(null)
              }}
            />
            {activeTab === 'peta' && (
              <MapLegend
                items={[
                  { color: HALTE_TERSURVEI_MARKER_COLOR, shape: 'dot', label: 'Halte tersurvei' },
                  { color: RUTE_BISKITA_COLOR, shape: 'line', lineStyle: 'solid', label: 'Koridor BisKita (tersurvei, garis aproksimasi)' },
                  { color: RUTE_KRL_COLOR, shape: 'line', lineStyle: 'dashed', label: 'Jaringan KRL (eksis, belum disurvei)' },
                  { color: CANDIDATE_MARKER_COLOR, shape: 'dot', label: 'Usulan lokasi baru (skor CAI final)' },
                  { color: CANDIDATE_MARKER_COLOR_PLACEHOLDER, shape: 'dot', label: 'Usulan lokasi baru (sebagian skor sementara)' },
                ]}
              />
            )}
          </MapView>
        </main>

        {/* Right panel */}
        {showPanel && (
          <aside className="w-96 shrink-0 bg-white border-l border-slate-200 overflow-hidden">
            {activeTab === 'dashboard' && <Dashboard />}
            {activeTab === 'analisis' && <AnalisisSpasial />}
            {activeTab === 'ai' && <AIPanel />}
            {activeTab === 'simulasi' && (
              <SimulationPanel
                active={simulationActive}
                onToggle={handleToggleSimulation}
                loading={simLoading}
                result={simResult}
              />
            )}
            {activeTab === 'rekomendasi' && <EquityIndexView />}
            {activeTab === 'data-laporan' && (
              <ComingSoon
                icon={FileDown}
                title="Data & Laporan"
                description="Export ringkasan peta + indikator kunci sebagai PDF/gambar — jadwal Fase 4."
                plannedPhase="Fase 4"
              />
            )}
            {activeTab === 'pengaturan' && (
              <ComingSoon
                icon={Settings}
                title="Pengaturan"
                description="Preferensi tampilan & konfigurasi akun — belum masuk jalur kritis submission."
                plannedPhase="Belum dijadwalkan"
              />
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

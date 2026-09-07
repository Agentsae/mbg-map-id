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
  LogOut,
  Search,
  Bell,
  HelpCircle,
} from 'lucide-react'
import MapView from './components/Map/MapView'
import CaiScorePanel from './components/Map/CaiScorePanel'
import MapLegend from './components/Map/MapLegend'
import AIPanel from './components/AIPanel/AIPanel'
import AnalisisSpasial from './components/AnalisisSpasial/AnalisisSpasial'
import SimulationPanel from './components/SimulationMode/SimulationPanel'
import Dashboard from './components/Dashboard/Dashboard'
import EquityIndexView from './components/EquityIndexView/EquityIndexView'
import DataLaporan from './components/DataLaporan/DataLaporan'
import LoginPage from './components/Auth/LoginPage'
import Pengaturan from './components/Pengaturan/Pengaturan'
import { supabase, isConfigured } from './lib/supabaseClient'
import { extractLatLon, extractLineStringCoords, findNearestPoint } from './lib/geo'
import { isSurveyPlaceholderPoint } from './lib/titikKandidat'
import { isDummyHalte } from './lib/halteEksisting'

// Batas area studi (outline Kota Bekasi) — aset STATIS yang di-bundle saat
// build, hasil etl/build_bekasi_boundary_geojson.py (dissolve 56 kelurahan
// RBI dari tabel batas_administrasi). Geografi batas administrasi tidak
// berubah, jadi ini sengaja BUKAN fetch runtime. Di-import lewat `?raw` +
// JSON.parse karena Vite tidak memproses ekstensi `.geojson` sebagai JSON
// modul secara default (hanya `.json`).
import bekasiBoundaryRaw from './data/bekasi_boundary.geojson?raw'

// Koridor + halte BisKita Trans Patriot versi APROKSIMASI dari OpenStreetMap
// (network=Trans Bekasi Patriot) + OSRM — aset STATIS di-bundle saat build,
// hasil etl/build_rute_biskita_osm.py. Sama sifatnya dengan bekasi_boundary di
// atas: display-only, TIDAK dipakai untuk skor/RPC apa pun. Ditampilkan sebagai
// konteks "cakupan koridor yang lebih penuh" di samping ruas biskita_survei yang
// lebih pendek. `?raw` + JSON.parse karena Vite tidak memproses `.geojson`.
import biskitaKoridorOsmRaw from './data/biskita_koridor_osm.geojson?raw'
import biskitaHalteOsmRaw from './data/biskita_halte_osm.geojson?raw'

const bekasiBoundary = JSON.parse(bekasiBoundaryRaw)
const biskitaKoridorOsm = JSON.parse(biskitaKoridorOsmRaw)
const biskitaHalteOsm = JSON.parse(biskitaHalteOsmRaw)

// Feature flag login wall — OFF by default. Auth gate (LoginPage) hanya
// dipasang kalau VITE_AUTH_REQUIRED === 'true' DI SAMPING isConfigured.
// Submission WebGIS 13 Sep di-ship dengan flag OFF (akses tanpa login);
// login wall internal dinyalakan pasca-13 Sep cukup dengan set env var,
// tanpa ubah kode. Nilai selain string 'true' (termasuk unset) = OFF.
const AUTH_REQUIRED = import.meta.env.VITE_AUTH_REQUIRED === 'true'

// 8 menu sidebar sesuai wireframe resmi PRD (Gambar 6, Bab 10.2, lihat CLAUDE.md).
// Seluruh 8 menu kini punya komponen nyata (ComingSoon/../ComingSoon.jsx
// disisakan sebagai placeholder generik untuk menu masa depan kalau
// dibutuhkan lagi, tidak dipakai aktif saat ini).
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

// Warna koridor BisKita APROKSIMASI OSM — sengaja oranye lebih terang (orange-300)
// + garis putus-putus tipis, kontras jelas dengan RUTE_BISKITA_COLOR (oranye-500
// solid tebal ruas tersurvei) supaya terbaca sebagai "perkiraan cakupan koridor
// yang lebih panjang" di BELAKANG ruas tersurvei, bukan menyaingi/menutupinya.
// Warna titik halte OSM pakai oranye-600 (lebih gelap dari kedua garis) supaya
// dot kecilnya tetap kebaca, tetap satu keluarga warna BisKita, dan jelas beda
// dari ungu halte tersurvei (HALTE_TERSURVEI_MARKER_COLOR).
// TODO(ui-ux-designer): asumsi sementara, bukan keputusan desain final.
const RUTE_BISKITA_OSM_COLOR = '#FDBA74'
const HALTE_BISKITA_OSM_COLOR = '#EA580C'

// Warna jaringan KRL — sengaja beda rumpun (biru) dari ungu BisKita di atas
// supaya "infrastruktur eksis tapi belum disurvei tim" langsung terlihat beda
// dari korridor yang sudah jadi objek survei. Biru dipilih supaya familiar ke
// user awam (asosiasi umum warna KRL Commuter Line Indonesia).
// TODO(ui-ux-designer): ini asumsi sementara, bukan keputusan desain final.
const RUTE_KRL_COLOR = '#2563EB'

// Warna garis batas area studi (outline Kota Bekasi) — token brand-blue
// (#1B659D, --color-brand-blue di src/index.css; sama dengan warna header &
// marker default MapView). Garis putus-putus supaya kebaca sebagai "batas
// wilayah", bukan rute/jaringan.
const BATAS_KOTA_COLOR = '#1B659D'

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

// Popup layer koridor & halte BisKita aproksimasi OSM — statis per layer (mekanisme
// `layers` di MapView.jsx hanya mendukung SATU popupHtml per layer, bukan per-fitur,
// jadi popup nama per-halte tidak dibuat — cukup satu disclaimer seragam). Redaksi
// mengikuti properties.catatan/sumber di FeatureCollection-nya + disclaimer aproksimasi
// yang eksplisit (bukan trayek resmi operator).
const BISKITA_KORIDOR_OSM_POPUP_HTML = [
  '<strong>Koridor BisKita Trans Patriot (aproksimasi OSM)</strong>',
  '<span style="color:#b45309">Aproksimasi koridor dari halte OpenStreetMap + OSRM — bukan trayek resmi operator/Dishub, bukan hasil survei lapangan tim.</span>',
  escapeHtml(biskitaKoridorOsm?.properties?.sumber || ''),
].filter(Boolean).join('<br/>')

const BISKITA_HALTE_OSM_POPUP_HTML = [
  '<strong>Halte BisKita Trans Patriot (OSM)</strong>',
  '<span style="color:#b45309">Titik halte dari OpenStreetMap — belum disurvei lapangan tim, bukan data resmi operator.</span>',
  escapeHtml(biskitaHalteOsm?.properties?.sumber || ''),
].filter(Boolean).join('<br/>')

// Auth gate sederhana single-role (Dishub/Bappeda staf) — Supabase Auth
// email+password, TANPA role/permission berjenjang dan TANPA UI signup
// (akun staf dibuat lewat Supabase Dashboard, lihat catatan di README/laporan
// task). Ini hanya proteksi di level UI (siapa yang boleh MEMBUKA aplikasi),
// BUKAN perubahan RLS — SELECT publik di Supabase tetap seperti semula
// (lihat CLAUDE.md, migration 002_rls_policies.sql).
//
// Kalau Supabase belum dikonfigurasi (`isConfigured` false), auth gate ini
// SENGAJA dilewati (langsung render app) supaya mode demo tanpa .env tetap
// bisa dijalankan untuk development/demo cepat — konsisten dengan pola
// isConfigured di seluruh komponen lain.
//
// Kalau AUTH_REQUIRED false (default), hook ini SHORT-CIRCUIT total: tidak
// ada panggilan supabase.auth.getSession()/onAuthStateChange, session tetap
// null, authLoading langsung false — jadi tidak ada network call auth mubazir
// saat login wall dimatikan untuk submission.
function useAuthSession() {
  const [session, setSession] = useState(null)
  const [authLoading, setAuthLoading] = useState(AUTH_REQUIRED && isConfigured)

  useEffect(() => {
    if (!AUTH_REQUIRED || !isConfigured) return

    supabase.auth.getSession().then(({ data }) => {
      setSession(data.session)
      setAuthLoading(false)
    })

    const { data: listener } = supabase.auth.onAuthStateChange((_event, newSession) => {
      setSession(newSession)
    })

    return () => listener.subscription.unsubscribe()
  }, [])

  return { session, authLoading }
}

export default function App() {
  const { session, authLoading } = useAuthSession()
  const [activeTab, setActiveTab] = useState('peta')

  // --- Simulasi What-If ---
  const [simulationActive, setSimulationActive] = useState(false)
  const [simLoading, setSimLoading] = useState(false)
  const [simResult, setSimResult] = useState(null)
  // Hasil simulate_new_stop TERAKHIR dalam sesi ini — TIDAK ikut dibersihkan
  // saat ganti mode/klik CAI (beda dari simResult). Dipakai AIPanel: kalau user
  // sudah pernah menjalankan What-If, output-nya diteruskan ke Edge Function
  // ai-insight sebagai body.simulasi supaya tahap Action narasi CCIA bisa
  // mengutip "+N jiwa" riil (bukan angka karangan). Aman kalau null.
  const [lastSimResult, setLastSimResult] = useState(null)

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

  // Jalankan RPC simulate_new_stop di satu lokasi — dipakai baik oleh klik peta
  // (mode simulasi aktif) maupun oleh dropdown skenario preset di SimulationPanel.
  const runSimulationAt = useCallback(async ({ lat, lon, popupText = 'Lokasi simulasi', focusTab = false }) => {
    if (focusTab) setActiveTab('simulasi')
    setSimLoading(true)
    setCaiResult(null)
    setClickMarker({ lat, lon, color: '#E08A1E', popupText })

    try {
      if (isConfigured) {
        const { data, error } = await supabase.rpc('simulate_new_stop', { lat, lon })
        if (error) throw error
        setSimResult(data)
        setLastSimResult(data)
      } else {
        await new Promise((r) => setTimeout(r, 500))
        setSimResult(DEMO_SIMULATION_RESULT)
        setLastSimResult(DEMO_SIMULATION_RESULT)
      }
    } catch (err) {
      console.error('Gagal menjalankan simulate_new_stop:', err)
      setSimResult(null)
    } finally {
      setSimLoading(false)
    }
  }, [])

  const handleMapClick = useCallback(async ({ lat, lon }) => {
    if (simulationActive) {
      // --- Alur Simulasi What-If (RPC simulate_new_stop) ---
      await runSimulationAt({ lat, lon })
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
  }, [simulationActive, caiPoints, runSimulationAt])

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
  const activeLabel = TABS.find((t) => t.id === activeTab)?.label ?? 'GeoTransit Insight'

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

  // Layer batas area studi + rute transit, disusun sesuai urutan gambar
  // (elemen belakang array digambar di ATAS):
  //   1. koridor BisKita aproksimasi OSM — PALING BAWAH, supaya ruas
  //      biskita_survei (di ruteLayers) tergambar di atasnya
  //   2. rute transit eksisting tersurvei (ruteLayers)
  //   3. titik halte BisKita OSM (circle kecil) — di atas garis rute
  //   4. garis batas Kota Bekasi — TERAKHIR, selalu di atas layer lain
  // Semua display-only, selalu tampil (konteks dasar), tidak perlu toggle.
  const mapLayers = [
    {
      id: 'biskita-koridor-osm',
      type: 'line',
      data: biskitaKoridorOsm,
      paint: {
        'line-color': RUTE_BISKITA_OSM_COLOR,
        'line-width': 4.5,
        'line-opacity': 0.95,
        'line-dasharray': [2, 1.2],
      },
      popupHtml: BISKITA_KORIDOR_OSM_POPUP_HTML,
    },
    ...ruteLayers,
    {
      id: 'biskita-halte-osm',
      type: 'circle',
      data: biskitaHalteOsm,
      paint: {
        'circle-radius': 3.5,
        'circle-color': HALTE_BISKITA_OSM_COLOR,
        'circle-stroke-width': 1,
        'circle-stroke-color': '#ffffff',
        'circle-opacity': 0.9,
      },
      popupHtml: BISKITA_HALTE_OSM_POPUP_HTML,
    },
    {
      id: 'batas-kota-bekasi',
      type: 'line',
      data: bekasiBoundary,
      paint: { 'line-color': BATAS_KOTA_COLOR, 'line-width': 2.5, 'line-dasharray': [3, 2] },
    },
  ]

  // Auth gate: kalau login wall dinyalakan (AUTH_REQUIRED) DAN Supabase
  // dikonfigurasi TAPI belum ada session, tampilkan HANYA halaman Login
  // (bukan seluruh app). Loading singkat saat getSession() masih berjalan
  // supaya tidak "flash" ke LoginPage lalu langsung ke app. Dengan
  // AUTH_REQUIRED false (default submission) ATAU mode demo (!isConfigured),
  // kedua cabang di bawah dilewati sepenuhnya → app langsung render.
  if (AUTH_REQUIRED && isConfigured && authLoading) {
    return (
      <div className="h-screen w-screen flex items-center justify-center bg-slate-50 text-sm text-slate-400">
        Memuat sesi…
      </div>
    )
  }
  if (AUTH_REQUIRED && isConfigured && !session) {
    return <LoginPage />
  }

  return (
    <div className="h-screen w-screen flex flex-col bg-slate-50">
      {/* Header — branding + poles (PRD Gambar 6). Search/Bell/Help dekoratif,
          belum ada handler; geocoding di luar scope. */}
      <header className="flex items-center gap-3 px-4 py-2.5 bg-brand-blue text-white shrink-0">
        {/* Logo hanya di header saat sidebar disembunyikan (viewport sempit) —
            di desktop logo ada di sidebar, hindari dobel. */}
        <img
          src="/Logo.png"
          alt="Logo MASSTRANSIT BASED GEOINSIGHT"
          className="w-9 h-9 rounded-full bg-white/10 shrink-0 md:hidden"
        />
        <div className="min-w-0">
          <h1 className="font-semibold leading-tight truncate">{activeLabel}</h1>
          <p className="text-xs text-white/70 leading-tight">GeoTransit Insight — Kota Bekasi</p>
        </div>

        {/* Kolom pencarian — NON-FUNGSIONAL (readOnly, tanpa handler) */}
        <div className="relative hidden sm:block flex-1 max-w-sm ml-2">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-white/50 pointer-events-none" />
          <input
            type="text"
            readOnly
            title="Segera hadir"
            placeholder="Cari lokasi, halte, koridor…"
            className="w-full bg-white/10 border border-white/20 rounded-full pl-9 pr-3 py-1.5 text-sm text-white placeholder:text-white/50 focus:outline-none cursor-not-allowed"
          />
        </div>

        <div className="ml-auto flex items-center gap-1.5">
          {!isConfigured && (
            <span
              title="Supabase belum tersambung — menampilkan data contoh"
              className="hidden lg:inline text-[11px] bg-amber-400/20 text-amber-100 border border-amber-300/40 rounded-full px-2.5 py-1"
            >
              Mode demo
            </span>
          )}
          {/* Dekoratif — title saja, tanpa dropdown */}
          <button type="button" title="Notifikasi" className="p-2 rounded-full hover:bg-white/10 transition">
            <Bell size={16} />
          </button>
          <button type="button" title="Bantuan" className="p-2 rounded-full hover:bg-white/10 transition">
            <HelpCircle size={16} />
          </button>

          {isConfigured && session ? (
            <div className="flex items-center gap-2 pl-1.5">
              <span className="hidden sm:inline text-xs text-white/70 truncate max-w-[140px]" title={session.user?.email}>
                {session.user?.email}
              </span>
              <button
                onClick={() => supabase.auth.signOut()}
                title="Logout"
                className="flex items-center gap-1 text-xs bg-white/10 hover:bg-white/20 border border-white/20 rounded-full px-3 py-1 transition"
              >
                <LogOut size={12} />
                Logout
              </button>
            </div>
          ) : (
            <div className="flex items-center gap-2 pl-1.5" title="Dishub Kota Bekasi">
              <span className="w-7 h-7 rounded-full bg-white/15 flex items-center justify-center text-[11px] font-semibold">
                DB
              </span>
              <span className="hidden sm:inline text-xs text-white/80">Dishub Kota Bekasi</span>
            </div>
          )}
        </div>
      </header>

      <div className="flex flex-1 min-h-0">
        {/* Sidebar nav — 8 menu sesuai wireframe PRD (Gambar 6). Lebar penuh
            dengan ikon + label di desktop; rail ikon-saja di bawahnya sebagai
            fallback viewport sempit. */}
        <nav className="hidden md:flex w-60 shrink-0 bg-white border-r border-slate-200 flex-col">
          <div className="flex items-center gap-3 px-4 py-4 border-b border-slate-200">
            <img
              src="/Logo.png"
              alt="Logo MASSTRANSIT BASED GEOINSIGHT"
              className="w-11 h-11 rounded-full shrink-0"
            />
            <div className="min-w-0">
              <p className="font-bold text-slate-800 leading-tight">GeoTransit Insight</p>
              <p className="text-[10px] text-slate-400 leading-tight">
                Spatial Decision Support System berbasis AI
              </p>
              <p className="text-[10px] text-slate-400 leading-tight">Kota Bekasi</p>
            </div>
          </div>

          <div className="flex-1 overflow-y-auto py-3 px-2 space-y-0.5">
            {TABS.map(({ id, label, icon: Icon }) => (
              <button
                key={id}
                onClick={() => setActiveTab(id)}
                className={
                  'w-full flex items-center gap-3 rounded-lg px-3 py-2 text-sm transition ' +
                  (activeTab === id
                    ? 'bg-brand-blue/10 text-brand-blue font-medium'
                    : 'text-slate-500 hover:bg-slate-100 hover:text-slate-700')
                }
              >
                <Icon size={18} className="shrink-0" />
                <span className="truncate">{label}</span>
              </button>
            ))}
          </div>

          <div className="border-t border-slate-200 px-4 py-3">
            <p className="text-[10px] font-semibold uppercase tracking-wide text-slate-400 mb-1">
              Tentang Sistem
            </p>
            <p className="text-[10px] text-slate-400 leading-snug">
              SDSS WebGIS untuk membantu Dishub &amp; Bappeda Kota Bekasi menentukan lokasi
              prioritas infrastruktur transit massal berbasis data.
            </p>
            <p className="text-[10px] text-slate-300 mt-2">Versi 1.0.0</p>
          </div>
        </nav>

        {/* Fallback rail ikon-saja untuk layar sempit (< md) */}
        <nav className="flex md:hidden w-14 shrink-0 bg-white border-r border-slate-200 flex-col items-center py-3 gap-1">
          {TABS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              onClick={() => setActiveTab(id)}
              title={label}
              className={
                'w-11 h-11 rounded-lg flex items-center justify-center transition ' +
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
            layers={mapLayers}
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
                  { color: BATAS_KOTA_COLOR, shape: 'line', lineStyle: 'dashed', label: 'Batas Kota Bekasi (area studi)' },
                  { color: HALTE_TERSURVEI_MARKER_COLOR, shape: 'dot', label: 'Halte tersurvei' },
                  { color: RUTE_BISKITA_COLOR, shape: 'line', lineStyle: 'solid', label: 'Koridor BisKita (tersurvei, garis aproksimasi)' },
                  { color: RUTE_BISKITA_OSM_COLOR, shape: 'line', lineStyle: 'dashed', label: 'Koridor BisKita Trans Patriot (aproksimasi OSM)' },
                  { color: HALTE_BISKITA_OSM_COLOR, shape: 'dot', label: 'Halte BisKita (OSM, belum disurvei)' },
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
            {activeTab === 'ai' && <AIPanel latestSimulasi={lastSimResult} />}
            {activeTab === 'simulasi' && (
              <SimulationPanel
                active={simulationActive}
                onToggle={handleToggleSimulation}
                loading={simLoading}
                result={simResult}
                onRunPreset={runSimulationAt}
              />
            )}
            {activeTab === 'rekomendasi' && <EquityIndexView />}
            {activeTab === 'data-laporan' && <DataLaporan />}
            {activeTab === 'pengaturan' && (
              <Pengaturan session={session} onLoggedOut={() => setActiveTab('peta')} />
            )}
          </aside>
        )}
      </div>
    </div>
  )
}

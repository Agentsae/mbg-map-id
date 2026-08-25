// Daftar 12 kecamatan Kota Bekasi — dipakai sebagai sumber tunggal (single
// source of truth) untuk dropdown/filter area di seluruh komponen (mis.
// AIPanel area_filter), supaya penamaan kecamatan konsisten antar komponen
// (Dashboard, AIPanel, dll pakai ejaan yang sama: "Rawa Lumbu", bukan
// "Rawalumbu"; "Mustika Jaya", dst).
//
// Sumber: pembagian administratif resmi Kota Bekasi (12 kecamatan).
// TODO(data-ai-analyst): kalau nama resmi di tabel `batas_administrasi`
// (kolom nama_kecamatan) berbeda ejaannya dari daftar ini, selaraskan salah
// satunya — backend ai-insight mencocokkan area_filter secara case-insensitive
// tapi tetap harus match string kecamatan yang sama.
export const KECAMATAN_KOTA_BEKASI = [
  'Bekasi Timur',
  'Bekasi Barat',
  'Bekasi Utara',
  'Bekasi Selatan',
  'Rawa Lumbu',
  'Mustika Jaya',
  'Bantar Gebang',
  'Jati Asih',
  'Jati Sampurna',
  'Pondok Gede',
  'Pondok Melati',
  'Medan Satria',
]

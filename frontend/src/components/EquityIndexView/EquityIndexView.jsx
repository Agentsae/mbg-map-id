import { useEffect, useState } from 'react'
import { Scale, ChevronDown, ChevronUp } from 'lucide-react'
import { supabase, isConfigured } from '../../lib/supabaseClient'

// Field kelompok_terdampak & rekomendasi_intervensi mengikuti nama kolom
// yang sedang ditambahkan data-ai-analyst ke tabel skor_equity (jangan ubah
// nama field ini) — PRD Bab 8 mewajibkan keduanya tampil per kelurahan dalam
// ranking Transit Equity Index, bukan cuma skor tunggal.
//
// PENTING (sumber data & arah skala — lihat CLAUDE.md):
// - Tabel skor_equity berisi 56 baris REAL (kolom `sumber` berawalan 'REAL')
//   BERDAMPINGAN dengan 5 baris dummy lama ('DATA SINTETIS...', dipakai untuk
//   testing). Kolom `ranking` TIDAK unik lintas nilai `sumber` — dummy punya
//   ranking 1-5 sendiri, real punya ranking 1-56 sendiri. Query WAJIB filter
//   `sumber ilike 'REAL%'` dulu sebelum order/limit by ranking, kalau tidak
//   hasilnya bisa campur baris ranking=1 dummy dengan ranking=1 real (bug yang
//   sama pernah ditemukan & diperbaiki di Edge Function ai-insight).
// - `skor_final` adalah skor KETIMPANGAN (equity gap): makin TINGGI makin
//   DIRUGIKAN/tertinggal. `ranking` ascending (1, 2, 3, ...) = urutan makin
//   dirugikan, jadi order('ranking', { ascending: true }) sudah benar untuk
//   menampilkan kelurahan paling timpang duluan (acceptance criteria PRD
//   Bab 8: "ranking minimal 5 kelurahan paling timpang/tertinggal").
const SUMBER_EQUITY_REAL_PREFIX = 'REAL'

// Rincian kontribusi tiap kriteria — kolom n_* di skor_equity, sudah
// ternormalisasi 0–1 oleh data-ai-analyst (etl/compute_scores.py
// compute_equity_index()). Frontend HANYA menampilkan nilai apa adanya,
// tidak menghitung ulang skor_final dari kriteria-kriteria ini. Dibutuhkan
// supaya user bisa menelusuri asal skor_final per kelurahan (prinsip
// "setiap skor harus bisa ditelusuri", sama seperti panel skor CAI di peta).
//
// CATATAN (dicek langsung ke skema live 2026-08-28): kolom `n_aksesibilitas_inv`
// DIPAKAI dalam formula skor_final (bobot 0.30 di konfigurasi_bobot 'EQUITY',
// lihat 009_bobot_tdi_equity_mentor_review.sql, dan dihitung di
// etl/compute_scores.py) TAPI TIDAK dipersist sebagai kolom di tabel
// skor_equity (hanya 001_init_tables.sql skor_equity: n_kepadatan,
// n_usia_rentan, n_akses_pendidikan, n_akses_kesehatan, n_akses_kerja —
// select `n_aksesibilitas_inv` bikin seluruh query gagal, sudah diverifikasi
// via REST API). Query & daftar kriteria di bawah SENGAJA tidak menyertakan
// kolom itu supaya tidak meruntuhkan seluruh panel. TODO(data-ai-analyst):
// tambah migration untuk persist n_aksesibilitas_inv (kriteria berbobot
// terbesar di formula EQUITY) di skor_equity supaya rincian kontribusi di
// sini lengkap — begitu kolom itu ada, tinggal tambahkan ke EQUITY_CRITERIA
// & select di bawah.
const EQUITY_CRITERIA = [
  { key: 'n_kepadatan', label: 'Kepadatan penduduk' },
  { key: 'n_usia_rentan', label: 'Proporsi usia rentan' },
  { key: 'n_akses_pendidikan', label: 'Akses ke fasilitas pendidikan' },
  { key: 'n_akses_kesehatan', label: 'Akses ke fasilitas kesehatan' },
  { key: 'n_akses_kerja', label: 'Akses ke lapangan kerja' },
]

const DEMO_RANKING = [
  {
    kelurahan: 'Mustika Jaya',
    skor: 0.81,
    kelompok_terdampak: 'Lansia, anak sekolah, pekerja informal',
    rekomendasi_intervensi: 'Prioritaskan halte baru + trotoar terhubung ke permukiman padat.',
    n_kepadatan: 0.72, n_usia_rentan: 0.65, n_akses_pendidikan: 0.58,
    n_akses_kesehatan: 0.61, n_akses_kerja: 0.55,
  },
  {
    kelurahan: 'Bantar Gebang',
    skor: 0.76,
    kelompok_terdampak: 'Pekerja informal, warga sekitar TPA',
    rekomendasi_intervensi: 'Tambah rute feeder ke terminal terdekat, perbaiki penyeberangan.',
    n_kepadatan: 0.60, n_usia_rentan: 0.58, n_akses_pendidikan: 0.50,
    n_akses_kesehatan: 0.52, n_akses_kerja: 0.48,
  },
  {
    kelurahan: 'Rawa Lumbu',
    skor: 0.71,
    kelompok_terdampak: 'Anak sekolah, lansia',
    rekomendasi_intervensi: 'Perbaikan trotoar & penerangan jalur jalan kaki menuju halte eksisting.',
    n_kepadatan: 0.68, n_usia_rentan: 0.55, n_akses_pendidikan: 0.62,
    n_akses_kesehatan: 0.49, n_akses_kerja: 0.51,
  },
  {
    kelurahan: 'Bekasi Utara',
    skor: 0.64,
    kelompok_terdampak: 'Pekerja shift malam, ibu dengan balita',
    rekomendasi_intervensi: 'Kaji penambahan headway malam hari pada trayek eksisting.',
    n_kepadatan: 0.70, n_usia_rentan: 0.45, n_akses_pendidikan: 0.55,
    n_akses_kesehatan: 0.58, n_akses_kerja: 0.60,
  },
  {
    kelurahan: 'Marga Mulya',
    skor: 0.42,
    kelompok_terdampak: 'Anak sekolah',
    rekomendasi_intervensi: 'Pantau berkala — prioritas rendah dibanding kelurahan lain.',
    n_kepadatan: 0.55, n_usia_rentan: 0.30, n_akses_pendidikan: 0.40,
    n_akses_kesehatan: 0.35, n_akses_kerja: 0.38,
  },
]

export default function EquityIndexView() {
  const [ranking, setRanking] = useState(DEMO_RANKING)
  const [usingDemo, setUsingDemo] = useState(!isConfigured)
  const [expanded, setExpanded] = useState(null)

  useEffect(() => {
    if (!isConfigured) return

    supabase
      .from('skor_equity')
      .select(
        'skor_final, ranking, sumber, kelompok_terdampak, rekomendasi_intervensi, ' +
        // n_aksesibilitas_inv SENGAJA tidak di-select — kolom itu belum ada
        // di tabel skor_equity (lihat catatan di atas EQUITY_CRITERIA), akan
        // membuat seluruh query error kalau disertakan.
        'n_kepadatan, n_usia_rentan, n_akses_pendidikan, n_akses_kerja, n_akses_kesehatan, ' +
        'batas_administrasi(nama_kelurahan)'
      )
      // WAJIB: exclude 5 baris dummy lama ('DATA SINTETIS...') supaya ranking
      // 1-56 real tidak tercampur dengan ranking 1-5 dummy — lihat catatan
      // SUMBER_EQUITY_REAL_PREFIX di atas komponen ini.
      .ilike('sumber', `${SUMBER_EQUITY_REAL_PREFIX}%`)
      .order('ranking', { ascending: true })
      .limit(10)
      .then(({ data, error }) => {
        if (error || !data?.length) {
          setUsingDemo(true)
          return
        }
        setRanking(
          data.map((d) => ({
            kelurahan: d.batas_administrasi?.nama_kelurahan,
            skor: d.skor_final,
            kelompok_terdampak: d.kelompok_terdampak,
            rekomendasi_intervensi: d.rekomendasi_intervensi,
            n_kepadatan: d.n_kepadatan,
            n_usia_rentan: d.n_usia_rentan,
            n_akses_pendidikan: d.n_akses_pendidikan,
            n_akses_kesehatan: d.n_akses_kesehatan,
            n_akses_kerja: d.n_akses_kerja,
          }))
        )
        setUsingDemo(false)
      })
  }, [])

  const maxSkor = Math.max(...ranking.map((r) => r.skor ?? 0)) || 1

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <Scale size={18} className="text-brand-orange" />
        <h2 className="font-semibold text-slate-800">Transit Equity Index</h2>
      </div>

      {usingDemo && (
        <div className="mx-4 mt-3 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">
          Menampilkan data contoh. Sambungkan tabel <code>skor_equity</code> (baris dengan{' '}
          <code>sumber</code> berawalan &quot;REAL&quot;) untuk data asli.
        </div>
      )}

      <div className="flex-1 min-h-0 p-4 space-y-3 overflow-y-auto">
        <p className="text-sm text-slate-500 mb-1">
          Ranking ketimpangan akses transportasi antarkelurahan — skor lebih tinggi = lebih dirugikan.
          Klik kelurahan untuk lihat rincian kontribusi tiap kriteria.
        </p>
        {ranking.map((r, i) => {
          const isOpen = expanded === i
          return (
            <div key={i} className="border border-slate-200 rounded-lg overflow-hidden">
              <button
                type="button"
                onClick={() => setExpanded(isOpen ? null : i)}
                className="w-full flex items-center gap-3 p-3 text-left hover:bg-slate-50"
              >
                <span className="w-5 text-sm font-mono text-slate-400">{i + 1}</span>
                <span className="flex-1 text-sm font-medium text-slate-800">
                  {r.kelurahan || 'Kelurahan tidak diketahui'}
                </span>
                <div className="w-20 h-2 bg-slate-100 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-brand-orange rounded-full"
                    style={{ width: `${((r.skor ?? 0) / maxSkor) * 100}%` }}
                  />
                </div>
                <span className="w-10 text-right text-xs font-mono text-slate-600">
                  {r.skor != null ? r.skor.toFixed(2) : '-'}
                </span>
                {isOpen ? (
                  <ChevronUp size={14} className="text-slate-400 shrink-0" />
                ) : (
                  <ChevronDown size={14} className="text-slate-400 shrink-0" />
                )}
              </button>

              {/* Kelompok terdampak & rekomendasi intervensi — wajib per PRD Bab 8,
                  bukan cuma skor tunggal tanpa penjelasan. Sebagian besar kelurahan
                  (53 dari 56 baris real, per catatan data-ai-analyst) belum punya
                  analisis rinci ini — tampilkan pesan graceful, BUKAN "null" mentah. */}
              <div className="px-3 pb-3 pl-11 space-y-1 text-xs text-slate-600">
                <p>
                  <span className="font-medium text-slate-500">Kelompok terdampak: </span>
                  {formatOrFallback(r.kelompok_terdampak)}
                </p>
                <p>
                  <span className="font-medium text-slate-500">Rekomendasi intervensi: </span>
                  {formatOrFallback(r.rekomendasi_intervensi)}
                </p>
              </div>

              {isOpen && (
                <div className="px-3 pb-3 pl-11 pt-1 border-t border-slate-100">
                  <p className="text-[11px] font-medium text-slate-500 mb-2">
                    Rincian kontribusi tiap kriteria (skor ketimpangan)
                  </p>
                  <div className="space-y-2">
                    {EQUITY_CRITERIA.map((c) => (
                      <CriteriaRow key={c.key} label={c.label} nilai={r[c.key]} />
                    ))}
                  </div>
                </div>
              )}
            </div>
          )
        })}
      </div>
    </div>
  )
}

function formatOrFallback(value) {
  if (value == null || value === '') return 'Belum ada analisis rinci untuk kelurahan ini.'
  return Array.isArray(value) ? value.join(', ') : value
}

function CriteriaRow({ label, nilai }) {
  const pct = Math.max(0, Math.min(1, nilai ?? 0)) * 100
  return (
    <div>
      <div className="flex items-center justify-between text-[11px] text-slate-600 mb-1">
        <span>{label}</span>
        <span className="font-mono text-slate-500">{nilai != null ? nilai.toFixed(2) : '-'}</span>
      </div>
      <div className="w-full h-1.5 bg-slate-100 rounded-full overflow-hidden">
        <div className="h-full bg-brand-blue rounded-full" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

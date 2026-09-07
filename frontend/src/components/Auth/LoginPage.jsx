import { useState } from 'react'
import { LogIn, Loader2, AlertCircle } from 'lucide-react'
import { supabase, isConfigured } from '../../lib/supabaseClient'

/**
 * LoginPage — gerbang login sederhana single-role (Dishub/Bappeda internal
 * staff), Supabase Auth email+password. TIDAK ada signup/self-registration
 * di UI ini secara sengaja (lihat catatan akun staf pertama di README/laporan
 * task) — ini alat internal, bukan aplikasi publik. TIDAK ada role/permission
 * berjenjang (admin vs viewer dsb) — CLAUDE.md eksplisit melarang sistem
 * manajemen user multi-role enterprise di scope proyek ini.
 *
 * Kalau Supabase belum dikonfigurasi (`isConfigured` false, lihat
 * lib/supabaseClient.js), form ini tidak bisa dipakai untuk login sungguhan —
 * App.jsx menangani kasus itu dengan TIDAK memasang auth gate sama sekali
 * (lihat komentar di App.jsx), supaya mode demo tanpa .env tetap bisa
 * dijalankan untuk development/demo cepat.
 *
 * TODO(ui-ux-designer): styling halaman ini asumsi wajar webgis-developer
 * (form terpusat, konsisten dengan brand-blue/brand-orange existing) — bukan
 * keputusan desain final, silakan sesuaikan kalau ada mockup resmi.
 */
export default function LoginPage() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState(null)

  async function handleSubmit(e) {
    e.preventDefault()
    if (!isConfigured) return
    setLoading(true)
    setError(null)
    const { error: signInError } = await supabase.auth.signInWithPassword({ email, password })
    if (signInError) {
      setError(
        signInError.message?.toLowerCase().includes('invalid')
          ? 'Email atau kata sandi salah.'
          : signInError.message || 'Gagal masuk. Coba lagi.'
      )
      setLoading(false)
    }
    // Kalau sukses, onAuthStateChange di App.jsx yang menangani transisi ke
    // halaman utama — tidak perlu setLoading(false) di sini karena komponen
    // ini akan unmount begitu session ada.
  }

  return (
    <div className="h-screen w-screen flex items-center justify-center bg-slate-50 px-4">
      <div className="w-full max-w-sm bg-white border border-slate-200 rounded-xl shadow-sm p-6">
        <div className="flex flex-col items-center gap-2 mb-6">
          <div className="w-10 h-10 rounded-md bg-brand-blue text-white flex items-center justify-center font-bold">
            GI
          </div>
          <h1 className="font-semibold text-slate-800 text-lg leading-tight">GeoTransit Insight</h1>
          <p className="text-xs text-slate-400 text-center leading-tight">
            Masuk sebagai staf Dishub / Bappeda Kota Bekasi
          </p>
        </div>

        {!isConfigured && (
          <div className="mb-4 text-xs bg-amber-50 text-amber-800 border border-amber-200 rounded-md px-3 py-2">
            Supabase belum tersambung — login tidak bisa diproses. Isi{' '}
            <code>VITE_SUPABASE_URL</code> / <code>VITE_SUPABASE_ANON_KEY</code> di{' '}
            <code>.env</code> terlebih dahulu.
          </div>
        )}

        <form onSubmit={handleSubmit} className="space-y-3">
          <div>
            <label htmlFor="login-email" className="block text-xs font-medium text-slate-600 mb-1">
              Email
            </label>
            <input
              id="login-email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              disabled={!isConfigured || loading}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/40 focus:border-brand-blue disabled:bg-slate-100 disabled:text-slate-400"
              placeholder="nama@bekasikota.go.id"
            />
          </div>
          <div>
            <label htmlFor="login-password" className="block text-xs font-medium text-slate-600 mb-1">
              Kata sandi
            </label>
            <input
              id="login-password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              disabled={!isConfigured || loading}
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-brand-blue/40 focus:border-brand-blue disabled:bg-slate-100 disabled:text-slate-400"
              placeholder="••••••••"
            />
          </div>

          {error && (
            <div className="flex items-start gap-1.5 text-xs text-red-600 bg-red-50 border border-red-200 rounded-md px-3 py-2">
              <AlertCircle size={14} className="shrink-0 mt-0.5" />
              <span>{error}</span>
            </div>
          )}

          <button
            type="submit"
            disabled={!isConfigured || loading}
            className="w-full flex items-center justify-center gap-2 bg-brand-blue text-white text-sm font-medium rounded-md py-2 hover:bg-brand-blue/90 transition disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {loading ? <Loader2 size={16} className="animate-spin" /> : <LogIn size={16} />}
            {loading ? 'Memproses…' : 'Masuk'}
          </button>
        </form>

        <p className="mt-5 text-[11px] text-slate-400 text-center leading-relaxed">
          Akun hanya dibuat oleh admin lewat Supabase Dashboard — tidak ada pendaftaran mandiri.
        </p>
      </div>
    </div>
  )
}

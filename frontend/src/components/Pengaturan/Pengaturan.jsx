import { useState } from 'react'
import { Settings, LogOut, Loader2, User } from 'lucide-react'
import { supabase, isConfigured } from '../../lib/supabaseClient'

/**
 * Pengaturan — menu ke-8 sidebar (wireframe PRD Gambar 3/6). Isi realistis
 * untuk single-role staff tool: info akun (email dari session Supabase Auth)
 * + tombol Logout. TIDAK ada manajemen banyak akun/role di sini (out-of-scope,
 * lihat CLAUDE.md) — pembuatan akun staf dilakukan lewat Supabase Dashboard,
 * bukan UI ini.
 *
 * Preferensi tampilan lain (mis. toggle basemap/tema) SENGAJA tidak
 * ditambahkan sebagai kontrol di sini karena belum ada state tampilan
 * yang benar-benar bisa di-toggle di aplikasi ini saat ini — palet
 * colorblind-safe (ColorBrewer YlGnBu) di choropleth Analisis Spasial sudah
 * jadi default tetap (bukan pilihan), dan basemap MAPID Maps juga satu style
 * tunggal (lihat MapView.jsx). Daripada menaruh toggle kosong yang tidak
 * terhubung ke fungsi apa pun, bagian ini cukup jujur menyatakan menyusul.
 *
 * TODO(ui-ux-designer): styling kartu ini asumsi wajar webgis-developer,
 * konsisten dengan pola StatCard di Dashboard.jsx — bukan keputusan desain
 * final.
 */
export default function Pengaturan({ session, onLoggedOut }) {
  const [loggingOut, setLoggingOut] = useState(false)

  async function handleLogout() {
    if (!isConfigured) return
    setLoggingOut(true)
    await supabase.auth.signOut()
    setLoggingOut(false)
    onLoggedOut?.()
  }

  const email = session?.user?.email || '—'
  const displayName = session?.user?.user_metadata?.display_name || null

  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <Settings size={18} className="text-brand-orange" />
        <h2 className="font-semibold text-slate-800">Pengaturan</h2>
      </div>

      <div className="p-4 space-y-4 overflow-y-auto">
        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
            Info Akun
          </p>
          <div className="bg-white border border-slate-200 rounded-lg p-3 flex items-start gap-3">
            <div className="w-9 h-9 rounded-full bg-brand-blue/10 text-brand-blue flex items-center justify-center shrink-0">
              <User size={16} />
            </div>
            <div className="min-w-0">
              {displayName && (
                <p className="text-sm font-medium text-slate-800 truncate">{displayName}</p>
              )}
              <p className="text-sm text-slate-600 truncate" title={email}>{email}</p>
              <p className="text-[11px] text-slate-400 mt-0.5">
                Staf Dishub / Bappeda Kota Bekasi &middot; akun tunggal (tanpa jenjang peran)
              </p>
            </div>
          </div>

          <button
            onClick={handleLogout}
            disabled={!isConfigured || loggingOut}
            className="mt-3 w-full flex items-center justify-center gap-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-md py-2 hover:bg-slate-50 transition disabled:opacity-50"
          >
            {loggingOut ? <Loader2 size={16} className="animate-spin" /> : <LogOut size={16} />}
            {loggingOut ? 'Keluar…' : 'Logout'}
          </button>
        </div>

        <div>
          <p className="text-[11px] font-semibold uppercase tracking-wide text-slate-400 mb-2">
            Preferensi Tampilan
          </p>
          <div className="bg-slate-50 border border-slate-200 rounded-lg p-3 text-xs text-slate-500 leading-relaxed">
            Belum ada preferensi tampilan yang bisa diubah pengguna saat ini — palet warna peta
            (colorblind-safe, ColorBrewer YlGnBu) dan basemap MAPID Maps masih satu konfigurasi
            tetap untuk semua pengguna. Preferensi tampilan lain menyusul.
          </div>
        </div>
      </div>
    </div>
  )
}

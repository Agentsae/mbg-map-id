import { Construction } from 'lucide-react'

/**
 * ComingSoon — placeholder seragam untuk menu sidebar yang sudah didefinisikan
 * di wireframe PRD (Gambar 3) tapi belum masuk jalur pengembangan saat ini
 * (lihat docs/BUILD_CHECKLIST.md untuk fase). Dipakai supaya tidak ada link mati
 * di sidebar 8 menu, tanpa over-build fitur sebelum waktunya.
 *
 * TODO(ui-ux-designer): ini styling placeholder generik/asumsi wajar —
 * sesuaikan kalau ada arahan visual khusus per menu dari mockup resmi.
 */
export default function ComingSoon({ icon: Icon = Construction, title, description, plannedPhase }) {
  return (
    <div className="flex flex-col h-full">
      <div className="flex items-center gap-2 px-4 py-3 border-b border-slate-200">
        <Icon size={18} className="text-brand-orange" />
        <h2 className="font-semibold text-slate-800">{title}</h2>
      </div>

      <div className="flex-1 flex flex-col items-center justify-center text-center px-6 gap-2">
        <Icon size={32} className="text-slate-300" />
        <p className="text-sm font-medium text-slate-600">Dalam pengembangan</p>
        <p className="text-xs text-slate-400 max-w-[220px]">
          {description || 'Fitur ini ada di wireframe PRD dan sedang dijadwalkan untuk fase berikutnya.'}
        </p>
        {plannedPhase && (
          <span className="mt-2 text-[10px] uppercase tracking-wide bg-slate-100 text-slate-500 rounded-full px-3 py-1">
            {plannedPhase}
          </span>
        )}
      </div>
    </div>
  )
}

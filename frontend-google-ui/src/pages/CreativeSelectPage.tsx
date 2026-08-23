import { ArrowUpRight, FileText, Video } from 'lucide-react';
import { motion } from 'motion/react';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import HomeBackButton from '@/src/components/HomeBackButton';

interface CreativeSelectPageProps {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
  onSelectVideo: () => void;
  onSelectCopy: () => void;
}

const entries = [
  {
    id: 'video' as const,
    title: '视频创作',
    icon: Video,
    shellClass: 'border-emerald-200/80 bg-gradient-to-br from-white via-white to-emerald-50/80 hover:border-emerald-300',
    glowClass: 'bg-emerald-300/40',
    iconClass: 'from-emerald-500 to-teal-600 shadow-emerald-200/80',
    buttonClass: 'border-emerald-100 bg-emerald-50 text-emerald-600 group-hover:border-emerald-500 group-hover:bg-emerald-600 group-hover:text-white',
    lineClass: 'from-transparent via-emerald-400/70 to-transparent',
  },
  {
    id: 'copy' as const,
    title: '文案创作',
    icon: FileText,
    shellClass: 'border-violet-200/80 bg-gradient-to-br from-white via-white to-violet-50/80 hover:border-violet-300',
    glowClass: 'bg-violet-300/40',
    iconClass: 'from-violet-500 to-fuchsia-600 shadow-violet-200/80',
    buttonClass: 'border-violet-100 bg-violet-50 text-violet-600 group-hover:border-violet-500 group-hover:bg-violet-600 group-hover:text-white',
    lineClass: 'from-transparent via-violet-400/70 to-transparent',
  },
];

export default function CreativeSelectPage({ onBack, onNavigate, onSelectVideo, onSelectCopy }: CreativeSelectPageProps) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f5f7fb] px-4 py-5 sm:px-6 sm:py-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-32 top-[18%] size-[30rem] rounded-full bg-emerald-200/35 blur-[100px]" />
        <div className="absolute -right-32 bottom-[10%] size-[32rem] rounded-full bg-violet-200/40 blur-[110px]" />
        <div className="absolute left-1/2 top-1/2 size-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.32] [background-image:linear-gradient(rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.12)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]" />
      </div>

      <div className="relative z-20 mx-auto flex w-full max-w-[70rem] shrink-0 items-center gap-2">
        <HomeBackButton onClick={onBack} />
        <ModuleQuickNav current="creative" onNavigate={onNavigate} />
      </div>

      <main className="relative z-10 flex w-full flex-1 items-center justify-center py-12 sm:py-16">
        <div className="grid w-full max-w-[58rem] grid-cols-1 gap-5 sm:grid-cols-2 sm:gap-6">
          {entries.map((entry, index) => {
            const Icon = entry.icon;
            const onClick = entry.id === 'video' ? onSelectVideo : onSelectCopy;
            return (
              <motion.button
                key={entry.id}
                type="button"
                onClick={onClick}
                initial={{ opacity: 0, y: 24, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.08 + index * 0.09, duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -7, scale: 1.01 }}
                whileTap={{ scale: 0.985 }}
                className={`group relative min-h-[250px] overflow-hidden rounded-[32px] border p-7 text-center shadow-[0_24px_60px_-34px_rgba(15,23,42,0.42)] backdrop-blur-xl transition-[border-color,box-shadow] duration-300 hover:shadow-[0_32px_75px_-32px_rgba(15,23,42,0.5)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 sm:min-h-[280px] sm:p-9 ${entry.shellClass}`}
              >
                <div className={`pointer-events-none absolute -right-20 -top-24 size-64 rounded-full blur-3xl transition-transform duration-700 group-hover:scale-125 ${entry.glowClass}`} />
                <Icon className="pointer-events-none absolute -bottom-10 -left-8 size-44 rotate-[-12deg] text-slate-900/[0.025] transition-transform duration-700 group-hover:rotate-[-7deg] group-hover:scale-105" strokeWidth={1.25} />
                <div className={`absolute inset-x-8 bottom-0 h-px bg-gradient-to-r opacity-60 transition-opacity duration-300 group-hover:opacity-100 ${entry.lineClass}`} />

                <div className="relative flex h-full flex-col items-center justify-center">
                  <div className={`flex size-16 items-center justify-center rounded-[22px] bg-gradient-to-br text-white shadow-xl transition-transform duration-500 group-hover:-translate-y-1 group-hover:rotate-[-3deg] sm:size-[72px] ${entry.iconClass}`}>
                    <Icon className="size-8 sm:size-9" strokeWidth={2.1} />
                  </div>

                  <h2 className="mt-7 text-[26px] font-black tracking-[-0.035em] text-slate-900 sm:text-[30px]">{entry.title}</h2>

                  <span className={`mt-6 flex size-10 items-center justify-center rounded-full border shadow-sm transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 ${entry.buttonClass}`}>
                    <ArrowUpRight className="size-[18px]" strokeWidth={2.4} />
                  </span>
                </div>
              </motion.button>
            );
          })}
        </div>
      </main>
    </div>
  );
}

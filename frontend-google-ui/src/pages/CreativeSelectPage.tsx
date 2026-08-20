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
    shellClass: 'border-emerald-200/80 hover:border-emerald-300',
    glowClass: 'bg-emerald-300/35',
    iconClass: 'from-emerald-500 to-teal-600 shadow-emerald-200',
    buttonClass: 'bg-emerald-600 group-hover:bg-emerald-700',
  },
  {
    id: 'copy' as const,
    title: '文案创作',
    icon: FileText,
    shellClass: 'border-violet-200/80 hover:border-violet-300',
    glowClass: 'bg-violet-300/35',
    iconClass: 'from-violet-500 to-fuchsia-600 shadow-violet-200',
    buttonClass: 'bg-violet-600 group-hover:bg-violet-700',
  },
];

export default function CreativeSelectPage({ onBack, onNavigate, onSelectVideo, onSelectCopy }: CreativeSelectPageProps) {
  return (
    <div className="relative flex min-h-screen flex-col items-center justify-start overflow-hidden bg-slate-100 p-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-24 top-24 size-80 rounded-full bg-emerald-200/35 blur-3xl" />
        <div className="absolute -right-20 top-40 size-96 rounded-full bg-violet-200/40 blur-3xl" />
        <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-white/80 to-transparent" />
      </div>

      <div className="relative z-10 flex w-full max-w-[70rem] items-center gap-2">
        <HomeBackButton onClick={onBack} />
        <ModuleQuickNav current="creative" onNavigate={onNavigate} />
      </div>

      <div className="relative z-10 mt-24 grid w-full max-w-[54rem] grid-cols-1 gap-5 sm:mt-32 sm:grid-cols-2">
        {entries.map((entry, index) => {
          const Icon = entry.icon;
          const onClick = entry.id === 'video' ? onSelectVideo : onSelectCopy;
          return (
            <motion.button
              key={entry.id}
              type="button"
              onClick={onClick}
              initial={{ opacity: 0, y: 22 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 + index * 0.08 }}
              whileHover={{ y: -5 }}
              whileTap={{ scale: 0.99 }}
              className={`group relative min-h-[220px] overflow-hidden rounded-[28px] border bg-white/90 p-7 text-left shadow-[0_22px_55px_-32px_rgba(15,23,42,0.45)] backdrop-blur-sm transition-all duration-300 hover:shadow-[0_30px_70px_-32px_rgba(15,23,42,0.5)] sm:p-8 ${entry.shellClass}`}
            >
              <div className={`pointer-events-none absolute -right-16 -top-20 size-56 rounded-full blur-3xl transition-transform duration-500 group-hover:scale-125 ${entry.glowClass}`} />
              <div className="relative flex h-full flex-col justify-between">
                <div className="flex items-start justify-between">
                  <div className={`flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg ${entry.iconClass}`}>
                    <Icon className="size-7" />
                  </div>
                  <span className={`flex size-10 items-center justify-center rounded-full text-white shadow-sm transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 ${entry.buttonClass}`}>
                    <ArrowUpRight className="size-5" />
                  </span>
                </div>

                <h2 className="mt-10 text-2xl font-black tracking-tight text-slate-900">{entry.title}</h2>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

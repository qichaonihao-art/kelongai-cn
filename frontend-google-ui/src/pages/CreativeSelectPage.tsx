import { ArrowUpRight, AudioLines, FileAudio, FileText, Scissors, Video } from 'lucide-react';
import { motion } from 'motion/react';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import HomeBackButton from '@/src/components/HomeBackButton';

interface CreativeSelectPageProps {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
  onSelectVideo: () => void;
  onSelectClip: () => void;
  onSelectCopy: () => void;
  onSelectVoiceTransfer?: () => void;
  onSelectCopyTransfer?: () => void;
}

const entries = [
  {
    id: 'video' as const,
    title: '视频创作',
    desc: 'AI 生成与商品视频合成',
    icon: Video,
    shellClass: 'border-emerald-200/80 bg-gradient-to-b from-white via-white to-emerald-50/70 hover:border-emerald-300',
    glowClass: 'bg-emerald-300/35',
    iconClass: 'from-emerald-500 to-teal-600 shadow-emerald-200/75',
    buttonClass: 'border-emerald-100 bg-emerald-50/90 text-emerald-600 group-hover:border-emerald-500 group-hover:bg-emerald-600 group-hover:text-white',
    lineClass: 'from-transparent via-emerald-400/70 to-transparent',
  },
  {
    id: 'clip' as const,
    title: '镜头截取',
    desc: '智能切镜与精准片段裁切',
    icon: Scissors,
    shellClass: 'border-cyan-200/80 bg-gradient-to-b from-white via-white to-cyan-50/70 hover:border-cyan-300',
    glowClass: 'bg-cyan-300/35',
    iconClass: 'from-cyan-500 to-blue-600 shadow-cyan-200/75',
    buttonClass: 'border-cyan-100 bg-cyan-50/90 text-cyan-600 group-hover:border-cyan-500 group-hover:bg-cyan-600 group-hover:text-white',
    lineClass: 'from-transparent via-cyan-400/70 to-transparent',
  },
  {
    id: 'copy' as const,
    title: '文案创作',
    desc: '爆款口播脚本与仿写生成',
    icon: FileText,
    shellClass: 'border-violet-200/80 bg-gradient-to-b from-white via-white to-violet-50/70 hover:border-violet-300',
    glowClass: 'bg-violet-300/35',
    iconClass: 'from-violet-500 to-fuchsia-600 shadow-violet-200/75',
    buttonClass: 'border-violet-100 bg-violet-50/90 text-violet-600 group-hover:border-violet-500 group-hover:bg-violet-600 group-hover:text-white',
    lineClass: 'from-transparent via-violet-400/70 to-transparent',
  },
  {
    id: 'voice-transfer' as const,
    title: '音色转移',
    desc: '提取原声复刻高保真配音',
    icon: AudioLines,
    shellClass: 'border-rose-200/80 bg-gradient-to-b from-white via-white to-rose-50/70 hover:border-rose-300',
    glowClass: 'bg-rose-300/35',
    iconClass: 'from-rose-500 to-amber-500 shadow-rose-200/75',
    buttonClass: 'border-rose-100 bg-rose-50/90 text-rose-600 group-hover:border-rose-500 group-hover:bg-rose-600 group-hover:text-white',
    lineClass: 'from-transparent via-rose-400/70 to-transparent',
  },
  {
    id: 'copy-transfer' as const,
    title: '文案转移',
    desc: '对照产品信息局部改口播',
    icon: FileAudio,
    shellClass: 'border-amber-200/80 bg-gradient-to-b from-white via-white to-amber-50/70 hover:border-amber-300',
    glowClass: 'bg-amber-300/35',
    iconClass: 'from-amber-500 to-orange-500 shadow-amber-200/75',
    buttonClass: 'border-amber-100 bg-amber-50/90 text-amber-600 group-hover:border-amber-500 group-hover:bg-amber-600 group-hover:text-white',
    lineClass: 'from-transparent via-amber-400/70 to-transparent',
  },
];

export default function CreativeSelectPage({ onBack, onNavigate, onSelectVideo, onSelectClip, onSelectCopy, onSelectVoiceTransfer, onSelectCopyTransfer }: CreativeSelectPageProps) {
  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#f5f7fb] px-4 py-5 sm:px-6 sm:py-6">
      <div className="pointer-events-none absolute inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-32 top-[18%] size-[30rem] rounded-full bg-emerald-200/35 blur-[100px]" />
        <div className="absolute -right-32 bottom-[10%] size-[32rem] rounded-full bg-violet-200/40 blur-[110px]" />
        <div className="absolute left-1/2 top-1/2 size-[42rem] -translate-x-1/2 -translate-y-1/2 rounded-full bg-white/80 blur-3xl" />
        <div className="absolute inset-0 opacity-[0.32] [background-image:linear-gradient(rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.12)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:linear-gradient(to_bottom,transparent,black_20%,black_80%,transparent)]" />
      </div>

      <div className="relative z-20 mx-auto flex w-full max-w-[78rem] shrink-0 items-center gap-2">
        <HomeBackButton onClick={onBack} />
        <ModuleQuickNav current="creative" onNavigate={onNavigate} />
      </div>

      <main className="relative z-10 flex w-full flex-1 flex-col items-center justify-center py-10 sm:py-14">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
          className="mb-8 text-center sm:mb-10"
        >
          <h1 className="text-2xl font-black tracking-[-0.03em] text-slate-900 sm:text-[28px]">创意创作</h1>
          <p className="mt-1.5 text-sm text-slate-500">选择一个创作工具开始工作</p>
        </motion.div>

        <div className="grid w-full max-w-[78rem] grid-cols-1 gap-4 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-5">
          {entries.map((entry, index) => {
            const Icon = entry.icon;
            const onClick = entry.id === 'video' ? onSelectVideo : entry.id === 'clip' ? onSelectClip : entry.id === 'copy' ? onSelectCopy : entry.id === 'voice-transfer' ? (onSelectVoiceTransfer ?? (() => {})) : (onSelectCopyTransfer ?? (() => {}));
            return (
              <motion.button
                key={entry.id}
                type="button"
                onClick={onClick}
                initial={{ opacity: 0, y: 20, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                transition={{ delay: 0.05 + index * 0.06, duration: 0.4, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -6, scale: 1.015 }}
                whileTap={{ scale: 0.985 }}
                className={`group relative flex min-h-[216px] flex-col items-center justify-between overflow-hidden rounded-[24px] border px-5 py-6 text-center shadow-[0_18px_45px_-30px_rgba(15,23,42,0.36)] backdrop-blur-xl transition-[border-color,box-shadow] duration-300 hover:shadow-[0_26px_60px_-28px_rgba(15,23,42,0.44)] focus-visible:outline-none focus-visible:ring-4 focus-visible:ring-white focus-visible:ring-offset-2 ${entry.shellClass}`}
              >
                <div className={`pointer-events-none absolute -right-14 -top-16 size-44 rounded-full blur-3xl transition-transform duration-700 group-hover:scale-125 ${entry.glowClass}`} />
                <Icon className="pointer-events-none absolute -bottom-7 -left-6 size-28 rotate-[-12deg] text-slate-900/[0.025] transition-transform duration-700 group-hover:rotate-[-6deg] group-hover:scale-105" strokeWidth={1.25} />
                <div className={`absolute inset-x-6 bottom-0 h-px bg-gradient-to-r opacity-60 transition-opacity duration-300 group-hover:opacity-100 ${entry.lineClass}`} />

                <div className="relative flex w-full flex-1 flex-col items-center justify-center">
                  <div className={`flex size-13 items-center justify-center rounded-[18px] bg-gradient-to-br text-white shadow-lg transition-transform duration-500 group-hover:-translate-y-1 group-hover:rotate-[-3deg] ${entry.iconClass}`}>
                    <Icon className="size-6" strokeWidth={2.15} />
                  </div>

                  <h2 className="mt-5 text-[18px] font-black tracking-[-0.025em] text-slate-900">{entry.title}</h2>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-500">{entry.desc}</p>
                </div>

                <span className={`relative mt-5 flex size-8 items-center justify-center rounded-full border shadow-2xs transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 ${entry.buttonClass}`}>
                  <ArrowUpRight className="size-4" strokeWidth={2.4} />
                </span>
              </motion.button>
            );
          })}
        </div>
      </main>
    </div>
  );
}

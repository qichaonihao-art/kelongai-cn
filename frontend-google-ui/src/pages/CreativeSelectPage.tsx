import { AudioLines, FileAudio, FileText, Scissors, Video } from 'lucide-react';
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
    icon: Video,
    iconWrap: 'bg-emerald-500/[0.08] text-emerald-700 group-hover:bg-emerald-600 group-hover:text-white',
    hoverBorder: 'hover:border-emerald-200/90',
  },
  {
    id: 'clip' as const,
    title: '镜头截取',
    icon: Scissors,
    iconWrap: 'bg-sky-500/[0.08] text-sky-700 group-hover:bg-sky-600 group-hover:text-white',
    hoverBorder: 'hover:border-sky-200/90',
  },
  {
    id: 'copy' as const,
    title: '文案创作',
    icon: FileText,
    iconWrap: 'bg-indigo-500/[0.08] text-indigo-700 group-hover:bg-indigo-600 group-hover:text-white',
    hoverBorder: 'hover:border-indigo-200/90',
  },
  {
    id: 'voice-transfer' as const,
    title: '音色转移',
    icon: AudioLines,
    iconWrap: 'bg-rose-500/[0.08] text-rose-700 group-hover:bg-rose-600 group-hover:text-white',
    hoverBorder: 'hover:border-rose-200/90',
  },
  {
    id: 'copy-transfer' as const,
    title: '文案转移',
    icon: FileAudio,
    iconWrap: 'bg-amber-500/[0.09] text-amber-700 group-hover:bg-amber-600 group-hover:text-white',
    hoverBorder: 'hover:border-amber-200/90',
  },
];

export default function CreativeSelectPage({
  onBack,
  onNavigate,
  onSelectVideo,
  onSelectClip,
  onSelectCopy,
  onSelectVoiceTransfer,
  onSelectCopyTransfer,
}: CreativeSelectPageProps) {
  return (
    <div className="relative flex min-h-screen flex-col bg-[#f7f8fa] px-4 py-5 text-slate-900 sm:px-6 sm:py-6">
      <div className="mx-auto flex w-full max-w-[78rem] shrink-0 items-center gap-2">
        <HomeBackButton onClick={onBack} />
        <ModuleQuickNav current="creative" onNavigate={onNavigate} />
      </div>

      <main className="mx-auto flex w-full max-w-[58rem] flex-1 flex-col items-center justify-center pb-14 pt-8">
        <motion.h1
          initial={{ opacity: 0, y: 8 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
          className="mb-10 text-center text-[26px] font-semibold tracking-[-0.03em] text-slate-900 sm:text-[30px]"
        >
          创意创作
        </motion.h1>

        <div className="grid w-full grid-cols-2 gap-3.5 sm:grid-cols-3 lg:grid-cols-5 lg:gap-4">
          {entries.map((entry, index) => {
            const Icon = entry.icon;
            const onClick =
              entry.id === 'video'
                ? onSelectVideo
                : entry.id === 'clip'
                  ? onSelectClip
                  : entry.id === 'copy'
                    ? onSelectCopy
                    : entry.id === 'voice-transfer'
                      ? (onSelectVoiceTransfer ?? (() => {}))
                      : (onSelectCopyTransfer ?? (() => {}));

            return (
              <motion.button
                key={entry.id}
                type="button"
                onClick={onClick}
                initial={{ opacity: 0, y: 12 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.04 + index * 0.045, duration: 0.35, ease: [0.22, 1, 0.36, 1] }}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.98 }}
                className={`group flex aspect-[1/0.96] min-h-[152px] flex-col items-center justify-center rounded-[22px] border border-black/[0.06] bg-white px-4 py-6 text-center shadow-[0_1px_2px_rgba(15,23,42,0.04),0_10px_28px_-14px_rgba(15,23,42,0.1)] transition-[border-color,box-shadow] duration-200 hover:shadow-[0_2px_6px_rgba(15,23,42,0.05),0_18px_36px_-14px_rgba(15,23,42,0.14)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-slate-900/20 focus-visible:ring-offset-2 ${entry.hoverBorder}`}
              >
                <div
                  className={`flex size-12 items-center justify-center rounded-2xl transition-colors duration-200 ${entry.iconWrap}`}
                >
                  <Icon className="size-[22px]" strokeWidth={1.9} />
                </div>

                <span className="mt-4 text-[15px] font-semibold tracking-[-0.015em] text-slate-900">
                  {entry.title}
                </span>
              </motion.button>
            );
          })}
        </div>
      </main>
    </div>
  );
}

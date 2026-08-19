import { Video, FileText } from 'lucide-react';
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
    desc: '视频反推 + 图片生视频 + 挂画创意素材，灵感一键成片',
    icon: Video,
    gradient: 'from-emerald-500 to-teal-600',
  },
  {
    id: 'copy' as const,
    title: '文案创作',
    desc: '挂画分析 + AI 原创口播文案 + 爆款文案仿写',
    icon: FileText,
    gradient: 'from-violet-500 to-fuchsia-600',
  },
];

export default function CreativeSelectPage({ onBack, onNavigate, onSelectVideo, onSelectCopy }: CreativeSelectPageProps) {
  return (
    <div className="flex min-h-screen flex-col items-center justify-start bg-background p-6">
      <div className="flex w-full max-w-[70rem] items-center gap-2">
        <HomeBackButton onClick={onBack} />
        <ModuleQuickNav current="creative" onNavigate={onNavigate} />
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="mb-10 mt-14 text-center"
      >
        <h1 className="text-4xl font-black tracking-tighter text-slate-900 md:text-5xl">创意创作</h1>
        <p className="mt-3 text-sm font-bold text-slate-500">选择你要进行的创作方式</p>
      </motion.div>

      <div className="grid w-full max-w-[56rem] grid-cols-1 gap-6 sm:grid-cols-2">
        {entries.map((entry) => {
          const Icon = entry.icon;
          const onClick = entry.id === 'video' ? onSelectVideo : onSelectCopy;
          return (
            <motion.button
              key={entry.id}
              type="button"
              onClick={onClick}
              whileHover={{ y: -6, scale: 1.02 }}
              whileTap={{ scale: 0.97 }}
              className="group relative flex flex-col items-center justify-center rounded-3xl border border-white/80 bg-white/60 p-10 text-center backdrop-blur-xl transition-colors duration-300 hover:bg-white/90 hover:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.12)]"
            >
              <div className="relative mb-5">
                <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${entry.gradient} opacity-20 blur-lg scale-150 transition-all duration-500 group-hover:scale-175 group-hover:opacity-30`} />
                <div className={`relative inline-flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br ${entry.gradient} text-white shadow-md`}>
                  <Icon className="size-7" />
                </div>
              </div>
              <h3 className="text-xl font-black tracking-tight text-slate-900">{entry.title}</h3>
              <p className="mt-2 max-w-[240px] text-sm leading-relaxed text-slate-500">{entry.desc}</p>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

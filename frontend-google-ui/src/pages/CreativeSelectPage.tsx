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
    iconClass: 'bg-emerald-600',
  },
  {
    id: 'copy' as const,
    title: '文案创作',
    desc: '挂画分析 + AI 原创口播文案 + 爆款文案仿写',
    icon: FileText,
    iconClass: 'bg-violet-600',
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
        className="mb-8 mt-12 text-center"
      >
        <h1 className="text-3xl font-black text-slate-900 md:text-4xl">创意创作</h1>
        <p className="mt-3 text-sm font-bold text-slate-500">选择你要进行的创作方式</p>
      </motion.div>

      <div className="grid w-full max-w-[56rem] grid-cols-1 gap-5 sm:grid-cols-2">
        {entries.map((entry) => {
          const Icon = entry.icon;
          const onClick = entry.id === 'video' ? onSelectVideo : onSelectCopy;
          return (
            <motion.button
              key={entry.id}
              type="button"
              onClick={onClick}
              whileHover={{ y: -3 }}
              whileTap={{ scale: 0.99 }}
              className="group flex min-h-64 flex-col items-start justify-between rounded-lg border border-slate-300 bg-white p-8 text-left shadow-sm transition-all hover:border-slate-400 hover:shadow-lg"
            >
              <div className={`inline-flex size-12 items-center justify-center rounded-lg ${entry.iconClass} text-white shadow-sm`}>
                  <Icon className="size-7" />
              </div>
              <div className="mt-8">
                <h3 className="text-xl font-black text-slate-900">{entry.title}</h3>
                <p className="mt-2 max-w-[280px] text-sm leading-relaxed text-slate-500">{entry.desc}</p>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

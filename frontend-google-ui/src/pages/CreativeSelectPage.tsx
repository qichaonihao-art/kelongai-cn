import { ArrowUpRight, FileText, Film, MessageSquareText, Sparkles, Video, WandSparkles } from 'lucide-react';
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
    eyebrow: 'VIDEO STUDIO',
    title: '视频创作',
    desc: '从素材理解、创意策划到视频生成，在一个工作台里完成。',
    icon: Video,
    detailIcon: Film,
    features: ['视频反推', '图片生视频', '挂画创意素材'],
    shellClass: 'border-emerald-200/80 hover:border-emerald-300',
    glowClass: 'bg-emerald-300/35',
    iconClass: 'from-emerald-500 to-teal-600 shadow-emerald-200',
    eyebrowClass: 'text-emerald-700',
    buttonClass: 'bg-emerald-600 group-hover:bg-emerald-700',
    pillClass: 'border-emerald-100 bg-emerald-50/80 text-emerald-700',
  },
  {
    id: 'copy' as const,
    eyebrow: 'COPY STUDIO',
    title: '文案创作',
    desc: '理解产品卖点与表达风格，快速产出自然、有说服力的口播内容。',
    icon: FileText,
    detailIcon: MessageSquareText,
    features: ['挂画分析', '原创口播', '爆款文案仿写'],
    shellClass: 'border-violet-200/80 hover:border-violet-300',
    glowClass: 'bg-violet-300/35',
    iconClass: 'from-violet-500 to-fuchsia-600 shadow-violet-200',
    eyebrowClass: 'text-violet-700',
    buttonClass: 'bg-violet-600 group-hover:bg-violet-700',
    pillClass: 'border-violet-100 bg-violet-50/80 text-violet-700',
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

      <motion.div
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        className="relative z-10 mb-9 mt-12 text-center"
      >
        <div className="mx-auto mb-4 flex w-fit items-center gap-2 rounded-full border border-white bg-white/70 px-3 py-1.5 text-xs font-bold text-slate-600 shadow-sm backdrop-blur-sm">
          <WandSparkles className="size-3.5 text-emerald-600" />
          AI 创意工作台
        </div>
        <h1 className="text-3xl font-black tracking-tight text-slate-900 md:text-4xl">今天想创作什么？</h1>
        <p className="mt-3 text-sm font-medium text-slate-500">选择一个工作室，开始把想法变成可直接使用的素材</p>
      </motion.div>

      <div className="relative z-10 grid w-full max-w-[60rem] grid-cols-1 gap-5 sm:grid-cols-2">
        {entries.map((entry, index) => {
          const Icon = entry.icon;
          const DetailIcon = entry.detailIcon;
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
              className={`group relative min-h-[330px] overflow-hidden rounded-[28px] border bg-white/90 p-7 text-left shadow-[0_22px_55px_-32px_rgba(15,23,42,0.45)] backdrop-blur-sm transition-all duration-300 hover:shadow-[0_30px_70px_-32px_rgba(15,23,42,0.5)] sm:p-8 ${entry.shellClass}`}
            >
              <div className={`pointer-events-none absolute -right-16 -top-20 size-56 rounded-full blur-3xl transition-transform duration-500 group-hover:scale-125 ${entry.glowClass}`} />
              <div className="relative flex h-full flex-col">
                <div className="flex items-start justify-between">
                  <div className={`flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-lg ${entry.iconClass}`}>
                    <Icon className="size-7" />
                  </div>
                  <span className={`flex size-10 items-center justify-center rounded-full text-white shadow-sm transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 ${entry.buttonClass}`}>
                    <ArrowUpRight className="size-5" />
                  </span>
                </div>

                <div className="mt-8">
                  <div className={`text-[10px] font-black tracking-[0.2em] ${entry.eyebrowClass}`}>{entry.eyebrow}</div>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">{entry.title}</h2>
                  <p className="mt-3 max-w-sm text-sm font-medium leading-6 text-slate-500">{entry.desc}</p>
                </div>

                <div className="mt-auto flex flex-wrap gap-2 pt-7">
                  {entry.features.map((feature, featureIndex) => (
                    <span key={feature} className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1.5 text-[11px] font-bold ${entry.pillClass}`}>
                      {featureIndex === 0 ? <Sparkles className="size-3" /> : featureIndex === 1 ? <DetailIcon className="size-3" /> : null}
                      {feature}
                    </span>
                  ))}
                </div>
              </div>
            </motion.button>
          );
        })}
      </div>
    </div>
  );
}

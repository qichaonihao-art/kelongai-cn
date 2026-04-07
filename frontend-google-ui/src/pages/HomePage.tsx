import { ArrowRight, Download, LogOut, Mic2, Sparkles, Wand2 } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/src/components/ui/button";

interface HomePageProps {
  onNavigate: (page: 'voice' | 'creative' | 'douyin') => void;
  onLogout: () => void;
}

const MODULES = [
  {
    key: 'voice' as const,
    title: '声音克隆',
    description: '上传样本音频，管理已创建音色，并快速生成可试听、可下载的配音结果。',
    icon: Mic2,
    accent: 'indigo',
    eyebrow: 'Voice Studio',
    highlights: ['样本上传', '音色管理', '多平台生成'],
  },
  {
    key: 'creative' as const,
    title: '豆包创意助手',
    description: '围绕文本、图片和视频素材进行连续创作，让灵感整理、拆解与扩写更顺滑。',
    icon: Wand2,
    accent: 'emerald',
    eyebrow: 'Creative Lab',
    highlights: ['多模态对话', '会话历史', '素材辅助创作'],
  },
  {
    key: 'douyin' as const,
    title: '抖音视频 / 文案提取',
    description: '从抖音分享链接进入，完成视频解析、下载、文案提取与复制，形成完整内容链路。',
    icon: Download,
    accent: 'sky',
    eyebrow: 'Video Intelligence',
    highlights: ['链接解析', '视频下载', '音频文案提取'],
  },
];

const ACCENT_STYLES = {
  indigo: {
    halo: 'from-indigo-500/20 via-indigo-300/10 to-transparent',
    iconWrap: 'bg-indigo-50 text-indigo-600 group-hover:bg-indigo-600 group-hover:text-white group-hover:shadow-indigo-200',
    border: 'hover:border-indigo-300',
    chip: 'bg-indigo-50 text-indigo-700 border-indigo-100',
    cta: 'text-indigo-700',
  },
  emerald: {
    halo: 'from-emerald-500/20 via-emerald-300/10 to-transparent',
    iconWrap: 'bg-emerald-50 text-emerald-600 group-hover:bg-emerald-600 group-hover:text-white group-hover:shadow-emerald-200',
    border: 'hover:border-emerald-300',
    chip: 'bg-emerald-50 text-emerald-700 border-emerald-100',
    cta: 'text-emerald-700',
  },
  sky: {
    halo: 'from-sky-500/20 via-sky-300/10 to-transparent',
    iconWrap: 'bg-sky-50 text-sky-600 group-hover:bg-sky-600 group-hover:text-white group-hover:shadow-sky-200',
    border: 'hover:border-sky-300',
    chip: 'bg-sky-50 text-sky-700 border-sky-100',
    cta: 'text-sky-700',
  },
} as const;

export default function HomePage({ onNavigate, onLogout }: HomePageProps) {
  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-white/35 via-white/10 to-transparent" />
      <div className="absolute left-[-8rem] top-28 size-80 rounded-full bg-indigo-400/10 blur-[110px]" />
      <div className="absolute right-[-6rem] top-20 size-96 rounded-full bg-sky-400/10 blur-[120px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 pb-16 pt-8 lg:px-10">
        <div className="flex items-center justify-between">
          <div className="glass-card inline-flex items-center gap-3 rounded-full border-white/70 px-4 py-2 shadow-glass">
            <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <Sparkles className="size-4" />
            </div>
            <div>
              <div className="text-[10px] font-bold uppercase tracking-[0.28em] text-slate-400">Google AI Studio Style</div>
              <div className="text-sm font-bold text-slate-900">AI 创意工作台</div>
            </div>
          </div>

          <Button
            variant="outline"
            size="sm"
            onClick={onLogout}
            className="glass-card gap-2 rounded-full border-white/60 px-5 text-slate-500 shadow-glass hover:border-red-200 hover:text-red-500"
          >
            <LogOut className="size-4" />
            <span className="text-xs font-bold uppercase tracking-wider">退出登录</span>
          </Button>
        </div>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-10 grid gap-6 xl:grid-cols-[minmax(0,1.25fr)_minmax(320px,0.75fr)]"
        >
          <div className="glass-card rounded-[3rem] border-white/80 px-8 py-10 shadow-glass lg:px-12 lg:py-12">
            <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/70 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">
              <Sparkles className="size-3.5 text-indigo-500" />
              Unified AI Product Surface
            </div>

            <div className="mt-6 max-w-4xl">
              <h1 className="text-5xl font-black tracking-[-0.04em] text-slate-900 sm:text-6xl xl:text-7xl">
                把声音、创意和
                <span className="mx-3 inline-flex rounded-[1.75rem] bg-gradient-to-r from-indigo-600 via-sky-500 to-emerald-500 px-4 py-1 text-white shadow-lg shadow-indigo-400/20">
                  抖音内容提取
                </span>
                放进同一个 AI 工作台
              </h1>
              <p className="mt-6 max-w-3xl text-base leading-8 text-slate-600 sm:text-lg">
                现在的首页不再只是两个孤立功能入口，而是围绕创作者常用流程组织成完整产品：声音能力、创意生成、抖音视频与文案提取，共用同一套操作语气、视觉层级与工作台体验。
              </p>
            </div>

            <div className="mt-8 flex flex-wrap gap-3">
              {['统一视觉层级', '轻量 AI 工具感', '桌面优先工作流'].map((item) => (
                <div
                  key={item}
                  className="rounded-full border border-white/70 bg-white/75 px-4 py-2 text-sm font-medium text-slate-600"
                >
                  {item}
                </div>
              ))}
            </div>
          </div>

          <div className="glass-card rounded-[3rem] border-white/80 p-8 shadow-glass">
            <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Product Surface</div>
            <div className="mt-4 text-2xl font-black tracking-tight text-slate-900">登录后的首页现在承载 3 个正式模块</div>
            <div className="mt-6 space-y-4">
              {MODULES.map((module, index) => (
                <div
                  key={module.key}
                  className="flex items-start gap-4 rounded-[1.5rem] border border-white/70 bg-white/65 px-4 py-4"
                >
                  <div className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-sm font-black text-white">
                    0{index + 1}
                  </div>
                  <div>
                    <div className="text-sm font-black text-slate-900">{module.title}</div>
                    <div className="mt-1 text-sm leading-6 text-slate-500">{module.description}</div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        <div className="mt-8 grid gap-6 xl:grid-cols-3">
          {MODULES.map((module, index) => {
            const Icon = module.icon;
            const accent = ACCENT_STYLES[module.accent];

            return (
              <motion.button
                key={module.key}
                type="button"
                initial={{ opacity: 0, y: 22 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ delay: 0.08 * (index + 1) }}
                whileHover={{ y: -8, scale: 1.01 }}
                className={`group glass-card relative flex h-full flex-col overflow-hidden rounded-[3rem] border-white/80 p-8 text-left shadow-glass transition-all ${accent.border}`}
                onClick={() => onNavigate(module.key)}
              >
                <div className={`absolute inset-x-0 top-0 h-28 bg-gradient-to-br ${accent.halo}`} />
                <div className="relative flex h-full flex-col">
                  <div className="flex items-start justify-between">
                    <div className="inline-flex items-center rounded-full border border-white/70 bg-white/75 px-3 py-1.5 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">
                      {module.eyebrow}
                    </div>
                    <div className="text-sm font-black text-slate-300">0{index + 1}</div>
                  </div>

                  <div className={`mt-8 inline-flex size-20 items-center justify-center rounded-[2rem] transition-all duration-500 ${accent.iconWrap}`}>
                    <Icon className="size-9 transition-transform duration-500 group-hover:scale-110" />
                  </div>

                  <div className="mt-8">
                    <h2 className="text-3xl font-black tracking-tight text-slate-900">{module.title}</h2>
                    <p className="mt-4 text-base leading-7 text-slate-500">{module.description}</p>
                  </div>

                  <div className="mt-6 flex flex-wrap gap-2">
                    {module.highlights.map((highlight) => (
                      <span
                        key={highlight}
                        className={`rounded-full border px-3 py-1.5 text-xs font-bold ${accent.chip}`}
                      >
                        {highlight}
                      </span>
                    ))}
                  </div>

                  <div className={`mt-auto flex items-center gap-2 pt-10 text-sm font-black ${accent.cta}`}>
                    进入模块
                    <ArrowRight className="size-4 transition-transform duration-300 group-hover:translate-x-1" />
                  </div>
                </div>
              </motion.button>
            );
          })}
        </div>
      </div>
    </div>
  );
}

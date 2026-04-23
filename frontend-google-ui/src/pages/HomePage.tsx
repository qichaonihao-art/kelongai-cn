import { Sparkles, Mic2, Wand2, LogOut, Download } from "lucide-react";
import SiteFooter from "@/src/components/SiteFooter";
import { motion } from "motion/react";

interface HomePageProps {
  onNavigate: (page: 'voice' | 'creative' | 'douyin') => void;
  onLogout: () => void;
}


const modules = [
  {
    id: 'voice' as const,
    title: '声音克隆',
    desc: '上传音频样本，AI 克隆您的专属音色',
    icon: Mic2,
    color: 'indigo',
    gradient: 'from-indigo-500 to-violet-600',
    bgLight: 'bg-indigo-50/50',
    borderHover: 'hover:border-indigo-300/60',
  },
  {
    id: 'creative' as const,
    title: '创意创作',
    desc: '视频分析 + AI 生成，灵感一键成片',
    icon: Wand2,
    color: 'emerald',
    gradient: 'from-emerald-500 to-teal-600',
    bgLight: 'bg-emerald-50/50',
    borderHover: 'hover:border-emerald-300/60',
  },
  {
    id: 'douyin' as const,
    title: '视频解析',
    desc: '抖音无水印下载，自动提取口播文案',
    icon: Download,
    color: 'sky',
    gradient: 'from-sky-500 to-blue-600',
    bgLight: 'bg-sky-50/50',
    borderHover: 'hover:border-sky-300/60',
  },
];

export default function HomePage({ onNavigate, onLogout }: HomePageProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-start pt-10 p-6 relative">
      <div className="absolute top-5 right-6 z-20">
        <button
          onClick={onLogout}
          className="flex items-center gap-2 h-9 rounded-full px-4 text-xs font-bold text-slate-500 bg-white/60 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md hover:text-red-500 hover:border-red-200 transition-all duration-300"
        >
          <LogOut className="size-3.5" />
          退出登录
        </button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12 relative"
      >
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 size-96 bg-indigo-500/10 rounded-full blur-[100px] -z-10" />
        <div className="inline-flex items-center justify-center size-16 rounded-2xl bg-indigo-600 text-white mb-6 shadow-xl shadow-indigo-200">
          <Sparkles className="size-8" />
        </div>
        <h1 className="text-6xl md:text-7xl font-black tracking-tighter leading-tight flex flex-wrap justify-center gap-x-4">
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-slate-900 via-slate-500 to-slate-900 animate-shimmer">欢迎来到</span>
            <span className="relative inline-block">
              <span className="relative z-10 text-transparent bg-clip-text bg-gradient-to-r from-indigo-600 via-white/80 to-violet-600 animate-shimmer italic px-2">AI</span>
              <motion.span
                initial={{ scaleX: 0 }}
                animate={{ scaleX: 1 }}
                transition={{ delay: 0.5, duration: 0.8 }}
                className="absolute bottom-2 left-0 w-full h-4 bg-indigo-100/60 -z-10 origin-left rounded-full"
              />
            </span>
            <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-600 via-white/80 to-emerald-600 animate-shimmer">创意工作台</span>
          </h1>
        <motion.p
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          transition={{ delay: 1 }}
          className="mt-5 text-slate-400 font-bold uppercase tracking-[0.3em] text-xs"
        >
          Professional AI Workspace • Unleash Your Imagination
        </motion.p>
      </motion.div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-6 w-full max-w-6xl">
        {modules.map((module, index) => {
          const Icon = module.icon;
          return (
            <motion.div
              key={module.id}
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.15 + index * 0.1, duration: 0.5 }}
              whileHover={{ y: -6, transition: { duration: 0.25 } }}
              className={`group relative cursor-pointer rounded-[2rem] bg-white/60 backdrop-blur-xl border border-white/80 p-10 transition-all duration-500 ${module.borderHover} hover:shadow-[0_25px_60px_-15px_rgba(0,0,0,0.12)] hover:bg-white/80`}
              onClick={() => onNavigate(module.id)}
            >
              <div className="flex flex-col items-center text-center">
                {/* Icon with animated ring */}
                <div className="relative mb-8">
                  <div className={`absolute inset-0 rounded-3xl bg-gradient-to-br ${module.gradient} opacity-20 blur-xl scale-150 group-hover:scale-175 group-hover:opacity-30 transition-all duration-500`} />
                  <div className={`relative inline-flex size-20 items-center justify-center rounded-3xl bg-gradient-to-br ${module.gradient} text-white shadow-lg transition-transform duration-500 group-hover:scale-110`}>
                    <Icon className="size-10" />
                  </div>
                </div>

                {/* Title with gradient on hover */}
                <h3 className="text-2xl font-black text-slate-900 tracking-tight mb-3 transition-colors duration-300">
                  {module.title}
                </h3>

                {/* Description */}
                <p className="text-sm leading-relaxed text-slate-500 mb-8 max-w-[240px]">
                  {module.desc}
                </p>

              </div>
            </motion.div>
          );
        })}
      </div>

      <SiteFooter className="mt-auto pt-10" />
    </div>
  );
}

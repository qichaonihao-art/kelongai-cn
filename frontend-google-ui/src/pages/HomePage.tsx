import { Sparkles, Mic2, Wand2, LogOut, Download } from "lucide-react";
import { Button } from "@/src/components/ui/button";
import { motion } from "motion/react";

interface HomePageProps {
  onNavigate: (page: 'voice' | 'creative' | 'douyin') => void;
  onLogout: () => void;
}

export default function HomePage({ onNavigate, onLogout }: HomePageProps) {
  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-start pt-10 p-6 relative">
      <div className="absolute top-6 right-6">
        <Button
          variant="outline"
          size="sm"
          onClick={onLogout}
          className="glass-card border-white/40 text-slate-500 hover:text-red-500 hover:border-red-200 transition-all gap-2 rounded-2xl px-5 h-10 shadow-glass"
        >
          <LogOut className="size-4" />
          <span className="text-xs font-bold uppercase tracking-wider">退出登录</span>
        </Button>
      </div>

      <motion.div
        initial={{ opacity: 0, y: 20 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-center mb-12 relative"
      >
        <div className="absolute -top-24 left-1/2 -translate-x-1/2 size-96 bg-indigo-500/10 rounded-full blur-[100px] -z-10" />
        <div className="inline-flex items-center justify-center size-16 rounded-2xl bg-indigo-600 text-white mb-8 shadow-xl shadow-indigo-200">
          <Sparkles className="size-8" />
        </div>
        <h1 className="text-7xl font-black tracking-tighter leading-tight flex flex-wrap justify-center gap-x-4">
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
          className="mt-6 text-slate-400 font-bold uppercase tracking-[0.3em] text-xs"
        >
          Professional AI Workspace • Unleash Your Imagination
        </motion.p>
      </motion.div>

      <div className="grid md:grid-cols-2 xl:grid-cols-3 gap-10 w-full max-w-7xl">
        <motion.div
          whileHover={{ y: -12, scale: 1.02 }}
          className="group relative glass-card px-9 py-10 rounded-[3rem] border-white/80 hover:shadow-glass-hover hover:border-indigo-300 transition-all cursor-pointer flex flex-col items-center justify-center text-center"
          onClick={() => onNavigate('voice')}
        >
          <div className="size-24 rounded-[2rem] bg-indigo-50/60 backdrop-blur-md text-indigo-600 flex items-center justify-center mb-8 group-hover:bg-indigo-600 group-hover:text-white transition-all duration-700 shadow-sm group-hover:shadow-indigo-200 group-hover:scale-110">
            <Mic2 className="size-12" />
          </div>
          <h3 className="text-[1.75rem] font-black text-slate-900 tracking-tight">声音克隆</h3>
          <p className="mt-3 max-w-xs text-sm leading-6 text-slate-500 font-medium">克隆您的声音，开启 AI 配音之旅</p>
        </motion.div>

        <motion.div
          whileHover={{ y: -12, scale: 1.02 }}
          className="group relative glass-card px-9 py-10 rounded-[3rem] border-white/80 hover:shadow-glass-hover hover:border-emerald-300 transition-all cursor-pointer flex flex-col items-center justify-center text-center"
          onClick={() => onNavigate('creative')}
        >
          <div className="size-24 rounded-[2rem] bg-emerald-50/60 backdrop-blur-md text-emerald-600 flex items-center justify-center mb-8 group-hover:bg-emerald-600 group-hover:text-white transition-all duration-700 shadow-sm group-hover:shadow-emerald-200 group-hover:scale-110">
            <Wand2 className="size-12" />
          </div>
          <h3 className="text-[1.75rem] font-black text-slate-900 tracking-tight">创意创作</h3>
          <p className="mt-3 max-w-xs text-sm leading-6 text-slate-500 font-medium">释放您的想象力，AI 助您高效创作</p>
        </motion.div>

        <motion.div
          whileHover={{ y: -12, scale: 1.02 }}
          className="group relative glass-card px-9 py-10 rounded-[3rem] border-white/80 hover:shadow-glass-hover hover:border-sky-300 transition-all cursor-pointer flex flex-col items-center justify-center text-center"
          onClick={() => onNavigate('douyin')}
        >
          <div className="size-24 rounded-[2rem] bg-sky-50/70 backdrop-blur-md text-sky-600 flex items-center justify-center mb-8 group-hover:bg-sky-600 group-hover:text-white transition-all duration-700 shadow-sm group-hover:shadow-sky-200 group-hover:scale-110">
            <Download className="size-12" />
          </div>
          <h3 className="text-[1.75rem] font-black text-slate-900 tracking-tight">抖音视频解析下载</h3>
          <p className="mt-3 max-w-xs text-sm leading-6 text-slate-500 font-medium">粘贴网页链接或分享文本，优先稳定解析并获取视频下载地址</p>
        </motion.div>
      </div>
    </div>
  );
}

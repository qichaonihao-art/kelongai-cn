import { useEffect, useState } from "react";
import { Mic2, Wand2, LogOut, Download, Network, Image, Crown } from "lucide-react";
import SiteFooter from "@/src/components/SiteFooter";
import { motion } from "motion/react";

interface HomePageProps {
  onNavigate: (page: 'voice' | 'creative' | 'douyin' | 'collection' | 'image' | 'topmodel') => void;
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
    id: 'image' as const,
    title: '图片生成',
    desc: 'GPT Image-2 宇宙最强图片生成模型',
    icon: Image,
    color: 'amber',
    gradient: 'from-amber-500 to-orange-600',
    bgLight: 'bg-amber-50/50',
    borderHover: 'hover:border-amber-300/60',
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
  {
    id: 'collection' as const,
    title: '店铺总览',
    desc: '店铺、商品、视频号、ADQ 与发货商家关系图谱',
    icon: Network,
    color: 'rose',
    gradient: 'from-emerald-500 to-cyan-600',
    bgLight: 'bg-emerald-50/50',
    borderHover: 'hover:border-emerald-300/60',
  },
  {
    id: 'topmodel' as const,
    title: '顶级模型',
    desc: 'Claude Opus 4.8 — Anthropic 最强推理模型',
    icon: Crown,
    color: 'fuchsia',
    gradient: 'from-fuchsia-500 to-purple-600',
    bgLight: 'bg-fuchsia-50/50',
    borderHover: 'hover:border-fuchsia-300/60',
  },
];

const DEFAULT_CULTURE_MOTTOS = ['多试试总没错', '7+3=七分专注，三分探索'];

function parseCultureMottoDraft(value: string) {
  const lines = value
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
  return lines.length ? lines : DEFAULT_CULTURE_MOTTOS;
}

async function fetchCultureMottos() {
  const response = await fetch('/api/home/culture-mottos', { credentials: 'include' });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.error || '读取主页标语失败');
  }
  return Array.isArray(json?.mottos) ? parseCultureMottoDraft(json.mottos.join('\n')) : DEFAULT_CULTURE_MOTTOS;
}

async function updateCultureMottos(mottos: string[]) {
  const response = await fetch('/api/home/culture-mottos', {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ mottos }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.error || '保存主页标语失败');
  }
  return Array.isArray(json?.mottos) ? parseCultureMottoDraft(json.mottos.join('\n')) : mottos;
}

export default function HomePage({ onNavigate, onLogout }: HomePageProps) {
  const [cultureMottos, setCultureMottos] = useState<string[]>(DEFAULT_CULTURE_MOTTOS);
  const [isCultureEditorOpen, setIsCultureEditorOpen] = useState(false);
  const [cultureDraft, setCultureDraft] = useState(() => DEFAULT_CULTURE_MOTTOS.join('\n'));
  const [cultureSaveError, setCultureSaveError] = useState("");
  const [isCultureSaving, setIsCultureSaving] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function loadServerMottos() {
      try {
        const next = await fetchCultureMottos();
        if (cancelled) return;
        setCultureMottos(next);
        setCultureDraft(next.join('\n'));
      } catch {
        // Keep defaults if the server is temporarily unavailable.
      }
    }

    void loadServerMottos();

    return () => {
      cancelled = true;
    };
  }, []);

  function openCultureEditor() {
    setCultureDraft(cultureMottos.join('\n'));
    setCultureSaveError("");
    setIsCultureEditorOpen(true);
  }

  async function saveCultureMottos() {
    const next = parseCultureMottoDraft(cultureDraft);
    setIsCultureSaving(true);
    setCultureSaveError("");
    try {
      const saved = await updateCultureMottos(next);
      setCultureMottos(saved);
      setCultureDraft(saved.join('\n'));
      setIsCultureEditorOpen(false);
    } catch (error) {
      setCultureSaveError(error instanceof Error ? error.message : '保存主页标语失败');
    } finally {
      setIsCultureSaving(false);
    }
  }

  function cancelCultureEdit() {
    setCultureDraft(cultureMottos.join('\n'));
    setCultureSaveError("");
    setIsCultureEditorOpen(false);
  }

  return (
    <div className="min-h-screen bg-background flex flex-col items-center justify-start p-6 relative">
      <style>{`
        @keyframes culture-credit-rise {
          0% {
            transform: translateY(54px);
            opacity: 0;
          }
          14% {
            opacity: 0.42;
          }
          54% {
            opacity: 0.34;
          }
          78% {
            transform: translateY(-24px);
            opacity: 0;
          }
          100% {
            transform: translateY(-24px);
            opacity: 0;
          }
        }
      `}</style>
      <div
        className="absolute left-7 top-7 z-10 hidden w-80 text-left md:block"
        onDoubleClick={openCultureEditor}
        title="双击编辑团队标语"
      >
        {isCultureEditorOpen ? (
          <div
            className="rounded-2xl border border-white/70 bg-white/75 p-3 shadow-xl shadow-slate-200/60 backdrop-blur-xl"
            onDoubleClick={(event) => event.stopPropagation()}
          >
            <textarea
              value={cultureDraft}
              onChange={(event) => setCultureDraft(event.target.value)}
              onKeyDown={(event) => {
                if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') {
                  event.preventDefault();
                  void saveCultureMottos();
                }
                if (event.key === 'Escape') {
                  event.preventDefault();
                  cancelCultureEdit();
                }
              }}
              autoFocus
              rows={4}
              className="h-28 w-full resize-none rounded-xl border border-slate-200 bg-white/80 px-3 py-2 text-xs font-bold leading-5 text-slate-700 outline-none transition-colors focus:border-indigo-300 focus:bg-white"
            />
            <div className="mt-2 flex items-center justify-between gap-2">
              <span className={cn("text-[10px] font-bold", cultureSaveError ? "text-red-400" : "text-slate-400")}>
                {cultureSaveError || '每行一句，最多 4 行，所有设备同步'}
              </span>
              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={cancelCultureEdit}
                  disabled={isCultureSaving}
                  className="h-7 rounded-full px-3 text-[11px] font-bold text-slate-500 transition-colors hover:bg-slate-100"
                >
                  取消
                </button>
                <button
                  type="button"
                  onClick={() => void saveCultureMottos()}
                  disabled={isCultureSaving}
                  className="h-7 rounded-full bg-slate-900 px-3 text-[11px] font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isCultureSaving ? '保存中' : '保存'}
                </button>
              </div>
            </div>
          </div>
        ) : (
          <div className="h-24 overflow-hidden">
            <div className="pointer-events-none absolute inset-x-0 top-0 h-8 bg-gradient-to-b from-background to-transparent" />
            <div className="pointer-events-none absolute inset-x-0 bottom-0 h-8 bg-gradient-to-t from-background to-transparent" />
            <div
              className="pointer-events-none space-y-2 pl-1"
              style={{ animation: 'culture-credit-rise 7.5s ease-in-out infinite' }}
            >
              {cultureMottos.map((motto) => (
                <div
                  key={motto}
                  className="text-sm font-black tracking-[0.18em] text-slate-700/80 drop-shadow-sm"
                >
                  {motto}
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
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
        className="text-center mb-8 relative mt-4"
      >
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
          className="mt-4 text-slate-400 font-bold uppercase tracking-[0.3em] text-xs"
        >
          Professional AI Workspace • Unleash Your Imagination
        </motion.p>
      </motion.div>

      <motion.div
        className="grid md:grid-cols-2 xl:grid-cols-3 gap-5 w-full max-w-[70rem] mt-8"
        initial="hidden"
        animate="visible"
        variants={{
          hidden: { opacity: 0 },
          visible: {
            opacity: 1,
            transition: { staggerChildren: 0.08, delayChildren: 0.15 },
          },
        }}
      >
        {modules.map((module, index) => {
          const Icon = module.icon;
          return (
            <motion.div
              key={module.id}
              layout
              variants={{
                hidden: { opacity: 0, y: 50, scale: 0.9, filter: 'blur(10px)' },
                visible: {
                  opacity: 1,
                  y: 0,
                  scale: 1,
                  filter: 'blur(0px)',
                  transition: { type: 'spring', stiffness: 100, damping: 18, mass: 0.8 },
                },
              }}
              whileHover={{
                y: -6,
                scale: 1.02,
                transition: { type: 'spring', stiffness: 300, damping: 20 },
              }}
              whileTap={{ scale: 0.96 }}
              className={`group relative cursor-pointer rounded-3xl bg-white/60 backdrop-blur-xl border border-white/80 p-8 transition-colors duration-500 ${module.borderHover} hover:shadow-[0_20px_50px_-12px_rgba(0,0,0,0.1)] hover:bg-white/80`}
              onClick={() => onNavigate(module.id)}
            >
              <div className="flex flex-col items-center text-center">
                {/* Icon with animated ring */}
                <div className="relative mb-5">
                  <div className={`absolute inset-0 rounded-2xl bg-gradient-to-br ${module.gradient} opacity-20 blur-lg scale-150 group-hover:scale-175 group-hover:opacity-30 transition-all duration-500`} />
                  <motion.div
                    layout
                    className={`relative inline-flex size-14 items-center justify-center rounded-2xl bg-gradient-to-br ${module.gradient} text-white shadow-md`}
                  >
                    <Icon className="size-7" />
                  </motion.div>
                </div>

                {/* Title */}
                <h3 className="text-lg font-black text-slate-900 tracking-tight mb-2">
                  {module.title}
                </h3>

                {/* Description */}
                <p className="text-xs leading-relaxed text-slate-500 max-w-[200px]">
                  {module.desc}
                </p>
              </div>
            </motion.div>
          );
        })}
      </motion.div>

      <SiteFooter className="mt-auto pt-10" />
    </div>
  );
}

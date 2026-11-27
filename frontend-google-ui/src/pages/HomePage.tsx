import { useEffect, useState } from "react";
import {
  ArrowUpRight,
  BookOpenText,
  CalendarRange,
  Crown,
  Download,
  Image,
  LogOut,
  Mic2,
  Network,
  Pencil,
  Video,
  Wand2,
} from "lucide-react";
import SiteFooter from "@/src/components/SiteFooter";
import { cn } from "@/src/lib/utils";
import { motion } from "motion/react";
import type { ModuleId } from "@/src/components/ModuleQuickNav";
import {
  calculateVideoLibraryUnread,
  getVideoLibrarySummary,
  VIDEO_LIBRARY_READ_CHANGE_EVENT,
  VIDEO_LIBRARY_READ_STATE_KEY,
} from "@/src/lib/videoLibrary";

interface HomePageProps {
  onNavigate: (page: ModuleId) => void;
  onLogout: () => void;
}

type FilterKey = 'all' | 'create' | 'media' | 'team';

const FILTER_TABS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: '全部模块' },
  { key: 'create', label: '创作引擎' },
  { key: 'media', label: '素材与解析' },
  { key: 'team', label: '模型与团队' },
];

interface ModuleConfig {
  id: ModuleId;
  title: string;
  subtitle: string;
  desc: string;
  group: Exclude<FilterKey, 'all'>;
  tier: 'hero' | 'feature' | 'compact';
  icon: typeof Mic2;
  heroClass?: string;
  accentGradient: string;
  tintBg: string;
  tintText: string;
  hoverBorder: string;
  spanAll: string;
  disabled?: boolean;
}

const modules: ModuleConfig[] = [
  {
    id: 'creative',
    title: '创意创作',
    subtitle: '视频分析 · 轻剪 · AI 成片',
    desc: '多模态对话、镜头拆解与一键视频生成，把灵感直接变成成片。',
    group: 'create',
    tier: 'hero',
    icon: Wand2,
    heroClass: 'home-hero-card-blue',
    accentGradient: 'from-blue-500 to-cyan-400',
    tintBg: 'bg-blue-50',
    tintText: 'text-blue-600',
    hoverBorder: 'hover:border-blue-300/70',
    spanAll: 'md:col-span-6 lg:col-span-6',
  },
  {
    id: 'voice',
    title: '声音克隆',
    subtitle: '阿里云 · 智谱 · 火山引擎',
    desc: '上传音频样本即可复刻专属音色，支持多引擎高自然度配音合成。',
    group: 'create',
    tier: 'hero',
    icon: Mic2,
    heroClass: 'home-hero-card-coral',
    accentGradient: 'from-rose-500 to-orange-400',
    tintBg: 'bg-rose-50',
    tintText: 'text-rose-600',
    hoverBorder: 'hover:border-rose-300/70',
    spanAll: 'md:col-span-6 lg:col-span-6',
  },
  {
    id: 'image',
    title: '图片生成',
    subtitle: 'Image 2.5 智能分流',
    desc: '兼顾高速出图与精细局部编辑，快速产出高质量视觉画面。',
    group: 'create',
    tier: 'feature',
    icon: Image,
    accentGradient: 'from-amber-400 via-orange-500 to-rose-500',
    tintBg: 'bg-amber-50/90',
    tintText: 'text-amber-700',
    hoverBorder: 'hover:border-amber-300/80',
    spanAll: 'md:col-span-4 lg:col-span-4',
  },
  {
    id: 'douyin',
    title: '视频解析',
    subtitle: '无水印下载 · 自动提文案',
    desc: '支持抖音直链与分享文案解析，一键无水印原画下载并转写口播。',
    group: 'media',
    tier: 'feature',
    icon: Download,
    accentGradient: 'from-sky-400 via-blue-500 to-indigo-500',
    tintBg: 'bg-sky-50/90',
    tintText: 'text-sky-700',
    hoverBorder: 'hover:border-sky-300/80',
    spanAll: 'md:col-span-4 lg:col-span-4',
  },
  {
    id: 'video-library',
    title: '视频素材库',
    subtitle: '原文件留存 · 多设备同步',
    desc: '团队共享装饰画视频资产，极速起播预览、原画无损下载与未读同步。',
    group: 'media',
    tier: 'feature',
    icon: Video,
    accentGradient: 'from-emerald-400 via-teal-500 to-cyan-500',
    tintBg: 'bg-emerald-50/90',
    tintText: 'text-emerald-700',
    hoverBorder: 'hover:border-emerald-300/80',
    spanAll: 'md:col-span-4 lg:col-span-4',
  },
  {
    id: 'topmodel',
    title: '顶级模型',
    subtitle: '多模型聚合对话',
    desc: 'Claude、ChatGPT、Doubao、千问自由切换对比。',
    group: 'team',
    tier: 'compact',
    icon: Crown,
    accentGradient: 'from-violet-500 via-purple-500 to-fuchsia-500',
    tintBg: 'bg-violet-50/90',
    tintText: 'text-violet-700',
    hoverBorder: 'hover:border-violet-300/80',
    spanAll: 'md:col-span-3 lg:col-span-3',
  },
  {
    id: 'feeding',
    title: '创意文库',
    subtitle: '爆款开头沉淀',
    desc: '沉淀装饰画高转化开头，基于真实案例快速仿写。',
    group: 'media',
    tier: 'compact',
    icon: BookOpenText,
    accentGradient: 'from-orange-400 via-rose-500 to-pink-500',
    tintBg: 'bg-orange-50/90',
    tintText: 'text-orange-700',
    hoverBorder: 'hover:border-orange-300/80',
    spanAll: 'md:col-span-3 lg:col-span-3',
  },
  {
    id: 'collection',
    title: '店铺总览',
    subtitle: '经营关系图谱',
    desc: '店铺、商品、视频号、ADQ 与发货商家全景关联。',
    group: 'team',
    tier: 'compact',
    icon: Network,
    accentGradient: 'from-cyan-400 via-sky-500 to-blue-600',
    tintBg: 'bg-cyan-50/90',
    tintText: 'text-cyan-700',
    hoverBorder: 'hover:border-cyan-300/80',
    spanAll: 'md:col-span-3 lg:col-span-3',
  },
  {
    id: 'timeline',
    title: '团队轨迹',
    subtitle: '年度成长档案',
    desc: '记录团队每一年的关键选择、挑战与重要突破。',
    group: 'team',
    tier: 'compact',
    icon: CalendarRange,
    accentGradient: 'from-teal-400 via-emerald-500 to-green-500',
    tintBg: 'bg-teal-50/90',
    tintText: 'text-teal-700',
    hoverBorder: 'hover:border-teal-300/80',
    spanAll: 'md:col-span-3 lg:col-span-3',
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

function CreativeGlassVisual() {
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute -right-4 -bottom-4 hidden h-36 w-56 sm:block"
    >
      {/* Translucent Liquid Glass storyboard layers */}
      <div className="absolute right-8 bottom-10 h-24 w-40 rounded-2xl border border-white/35 bg-white/15 backdrop-blur-md shadow-lg transition-transform duration-500 group-hover:-translate-y-1.5 group-hover:-translate-x-1">
        <div className="flex items-center gap-1.5 px-3 pt-2.5">
          <span className="size-1.5 rounded-full bg-white/70" />
          <span className="size-1.5 rounded-full bg-white/45" />
          <span className="size-1.5 rounded-full bg-white/30" />
        </div>
        <div className="mx-3 mt-2.5 h-10 rounded-lg border border-white/25 bg-gradient-to-br from-white/30 to-white/5" />
        <div className="mx-3 mt-2 flex gap-1.5">
          <div className="h-1.5 flex-1 rounded-full bg-white/70" />
          <div className="h-1.5 w-8 rounded-full bg-white/35" />
        </div>
      </div>
      <div className="absolute right-3 bottom-4 h-12 w-32 rounded-xl border border-white/45 bg-white/25 px-2.5 py-2 backdrop-blur-lg shadow-xl transition-transform duration-500 group-hover:translate-x-0.5 group-hover:-translate-y-0.5">
        <div className="flex h-full items-center gap-1">
          <span className="h-3.5 w-10 rounded bg-white/85" />
          <span className="h-3.5 w-7 rounded bg-sky-200/80" />
          <span className="h-3.5 flex-1 rounded bg-white/45" />
        </div>
      </div>
    </div>
  );
}

function VoiceGlassVisual() {
  const bars = [20, 38, 56, 32, 68, 48, 76, 44, 62, 30, 50, 26];
  return (
    <div
      aria-hidden="true"
      className="pointer-events-none absolute right-5 bottom-5 hidden items-end gap-1.5 rounded-2xl border border-white/35 bg-white/15 px-4 py-3.5 backdrop-blur-md shadow-lg transition-transform duration-500 group-hover:-translate-y-1.5 sm:flex"
    >
      {bars.map((h, i) => (
        <span
          key={i}
          style={{ height: `${Math.round(h * 0.68)}px` }}
          className="w-1.5 rounded-full bg-gradient-to-t from-white/55 to-white/95 transition-all duration-500 group-hover:brightness-110"
        />
      ))}
    </div>
  );
}

export default function HomePage({ onNavigate, onLogout }: HomePageProps) {
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [cultureMottos, setCultureMottos] = useState<string[]>(DEFAULT_CULTURE_MOTTOS);
  const [activeMottoIndex, setActiveMottoIndex] = useState(0);
  const [isCultureEditorOpen, setIsCultureEditorOpen] = useState(false);
  const [cultureDraft, setCultureDraft] = useState(() => DEFAULT_CULTURE_MOTTOS.join('\n'));
  const [cultureSaveError, setCultureSaveError] = useState("");
  const [isCultureSaving, setIsCultureSaving] = useState(false);
  const [videoLibraryUnreadCount, setVideoLibraryUnreadCount] = useState(0);

  const visibleModules =
    activeFilter === 'all' ? modules : modules.filter((m) => m.group === activeFilter);

  useEffect(() => {
    if (cultureMottos.length <= 1 || isCultureEditorOpen) return;
    const timer = window.setInterval(() => {
      setActiveMottoIndex((prev) => (prev + 1) % cultureMottos.length);
    }, 4800);
    return () => window.clearInterval(timer);
  }, [cultureMottos.length, isCultureEditorOpen]);

  useEffect(() => {
    if (activeMottoIndex >= cultureMottos.length) {
      setActiveMottoIndex(0);
    }
  }, [activeMottoIndex, cultureMottos.length]);

  useEffect(() => {
    let cancelled = false;
    async function refreshVideoLibraryUnread() {
      try {
        const items = await getVideoLibrarySummary();
        if (!cancelled) setVideoLibraryUnreadCount(calculateVideoLibraryUnread(items).total);
      } catch {
        // 首页提醒读取失败不影响其他模块使用。
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === 'visible') void refreshVideoLibraryUnread();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === VIDEO_LIBRARY_READ_STATE_KEY) void refreshVideoLibraryUnread();
    };
    void refreshVideoLibraryUnread();
    const timer = window.setInterval(refreshVideoLibraryUnread, 30_000);
    window.addEventListener('focus', refreshVideoLibraryUnread);
    window.addEventListener(VIDEO_LIBRARY_READ_CHANGE_EVENT, refreshVideoLibraryUnread);
    window.addEventListener('storage', handleStorage);
    document.addEventListener('visibilitychange', handleVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener('focus', refreshVideoLibraryUnread);
      window.removeEventListener(VIDEO_LIBRARY_READ_CHANGE_EVENT, refreshVideoLibraryUnread);
      window.removeEventListener('storage', handleStorage);
      document.removeEventListener('visibilitychange', handleVisibility);
    };
  }, []);

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
      setActiveMottoIndex(0);
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

  const currentMotto = cultureMottos[activeMottoIndex] ?? DEFAULT_CULTURE_MOTTOS[0];

  return (
    <div className="home-studio-canvas relative min-h-screen overflow-x-hidden flex flex-col">
      {/* Stripe-inspired Radiant Sunlit Flowing Prism Backdrop */}
      <div
        aria-hidden="true"
        className="pointer-events-none absolute inset-x-0 top-0 h-[440px] overflow-hidden"
        style={{
          WebkitMaskImage: 'linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.88) 46%, transparent 100%)',
          maskImage: 'linear-gradient(180deg, rgba(0,0,0,1) 0%, rgba(0,0,0,0.88) 46%, transparent 100%)',
        }}
      >
        <div
          className="home-prism-blob-a absolute -left-24 -top-28 h-[360px] w-[55%] rounded-full opacity-75 blur-[72px]"
          style={{
            background: 'radial-gradient(circle at 35% 40%, #60a5fa 0%, #818cf8 45%, transparent 75%)',
          }}
        />
        <div
          className="home-prism-blob-b absolute left-[28%] -top-36 h-[380px] w-[50%] rounded-full opacity-70 blur-[76px]"
          style={{
            background: 'radial-gradient(circle at 50% 45%, #fb7185 0%, #fbbf24 52%, transparent 78%)',
          }}
        />
        <div
          className="home-prism-blob-a absolute -right-24 -top-20 h-[340px] w-[46%] rounded-full opacity-70 blur-[72px]"
          style={{
            background: 'radial-gradient(circle at 60% 40%, #22d3ee 0%, #34d399 48%, transparent 78%)',
          }}
        />
      </div>

      {/* Apple Liquid Glass Floating Top Bar */}
      <header className="relative z-20 mx-auto w-full max-w-[76rem] px-5 pt-5 sm:px-8 sm:pt-6">
        <div className="home-liquid-glass flex flex-wrap items-center justify-between gap-3 rounded-2xl px-4 py-2.5 sm:px-5">
          {/* Left: Brand & Editable Culture Motto */}
          <div className="relative flex min-w-0 items-center gap-3.5">
            <div className="flex shrink-0 items-center gap-2.5">
              <div className="flex size-8 items-center justify-center rounded-xl bg-gradient-to-br from-blue-600 via-indigo-600 to-violet-600 text-white shadow-md shadow-indigo-500/25">
                <svg aria-hidden="true" viewBox="0 0 20 20" fill="none" className="size-4">
                  <path d="M4.5 14.5V5.5L15.5 14.5V5.5" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
                </svg>
              </div>
              <span className="text-[15px] font-bold tracking-tight text-slate-900">
                AI 创意工作台
              </span>
            </div>

            <span className="hidden h-4 w-px bg-slate-900/10 xl:block" aria-hidden="true" />

            <div
              className="relative hidden xl:block"
              onDoubleClick={openCultureEditor}
              title="双击编辑团队标语"
            >
              <div className="group flex h-8 max-w-[16rem] items-center gap-1.5 rounded-full px-2 transition-colors hover:bg-white/70">
                <div className="min-w-0 overflow-hidden">
                  <div
                    key={`${activeMottoIndex}-${currentMotto}`}
                    style={
                      cultureMottos.length > 1
                        ? { animation: 'home-motto-cycle 4.8s ease-in-out' }
                        : undefined
                    }
                    className="truncate text-xs font-semibold text-slate-600"
                  >
                    {currentMotto}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={openCultureEditor}
                  title="编辑团队标语"
                  className="flex size-5 shrink-0 items-center justify-center rounded-full text-slate-400 opacity-0 transition-all hover:bg-slate-900/5 hover:text-slate-700 group-hover:opacity-100 focus:opacity-100"
                >
                  <Pencil className="size-3" />
                </button>
              </div>

              {isCultureEditorOpen && (
                <div
                  className="absolute left-0 top-11 z-30 w-80 rounded-2xl border border-slate-200/90 bg-white p-3.5 shadow-2xl shadow-slate-900/15"
                  onDoubleClick={(event) => event.stopPropagation()}
                >
                  <div className="mb-2 flex items-center justify-between">
                    <span className="text-xs font-bold text-slate-800">编辑团队标语</span>
                    <span className="font-mono text-[10px] text-slate-400">⌘/Ctrl + Enter</span>
                  </div>
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
                    className="h-28 w-full resize-none rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-medium leading-5 text-slate-700 outline-none transition-colors focus:border-blue-400 focus:bg-white"
                  />
                  <div className="mt-2.5 flex items-center justify-between gap-2">
                    <span className={cn("text-[10px]", cultureSaveError ? "text-rose-500" : "text-slate-400")}>
                      {cultureSaveError || '每行一句，最多 4 行，全设备同步'}
                    </span>
                    <div className="flex gap-1.5">
                      <button
                        type="button"
                        onClick={cancelCultureEdit}
                        disabled={isCultureSaving}
                        className="h-7 rounded-lg px-2.5 text-[11px] font-medium text-slate-500 transition-colors hover:bg-slate-100"
                      >
                        取消
                      </button>
                      <button
                        type="button"
                        onClick={() => void saveCultureMottos()}
                        disabled={isCultureSaving}
                        className="h-7 rounded-lg bg-slate-900 px-3 text-[11px] font-semibold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {isCultureSaving ? '保存中' : '保存'}
                      </button>
                    </div>
                  </div>
                </div>
              )}
            </div>
          </div>

          {/* Center: Apple-style Sliding Glass Segmented Control */}
          <nav
            aria-label="模块分类"
            className="hidden items-center gap-0.5 rounded-full bg-slate-900/[0.05] p-1 md:flex"
          >
            {FILTER_TABS.map((tab) => {
              const active = activeFilter === tab.key;
              return (
                <button
                  key={tab.key}
                  type="button"
                  onClick={() => setActiveFilter(tab.key)}
                  className={cn(
                    "relative rounded-full px-3.5 py-1.5 text-xs font-semibold transition-colors",
                    active ? "text-slate-900" : "text-slate-600 hover:text-slate-900"
                  )}
                >
                  {active && (
                    <motion.span
                      layoutId="home-filter-pill"
                      transition={{ type: 'spring', stiffness: 420, damping: 32 }}
                      className="absolute inset-0 rounded-full bg-white shadow-sm shadow-slate-900/10"
                    />
                  )}
                  <span className="relative z-10">{tab.label}</span>
                </button>
              );
            })}
          </nav>

          {/* Right: Unread Video Notice + Logout */}
          <div className="flex shrink-0 items-center gap-2">
            {videoLibraryUnreadCount > 0 && (
              <button
                type="button"
                onClick={() => onNavigate('video-library')}
                className="hidden sm:inline-flex h-8 items-center gap-1.5 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-3 text-xs font-bold text-white shadow-sm shadow-rose-500/30 transition-transform hover:scale-[1.02]"
              >
                <span className="size-1.5 rounded-full bg-white" />
                {videoLibraryUnreadCount > 99 ? '99+' : videoLibraryUnreadCount} 条新视频
              </button>
            )}
            <button
              type="button"
              onClick={onLogout}
              className="inline-flex h-8 items-center gap-1.5 rounded-full bg-white/80 px-3.5 text-xs font-semibold text-slate-700 ring-1 ring-slate-900/8 transition-all hover:bg-white hover:text-rose-600 hover:ring-rose-200"
            >
              <LogOut className="size-3.5" />
              退出登录
            </button>
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="relative z-10 mx-auto flex w-full max-w-[76rem] flex-1 flex-col px-5 pt-9 pb-8 sm:px-8 sm:pt-11">
        {/* Crisp Editorial Hero */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.22, 1, 0.36, 1] }}
          className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end"
        >
          <div>
            <h1 className="text-3xl font-extrabold tracking-tight text-slate-900 sm:text-[42px] leading-[1.12]">
              创作，从这里开始
            </h1>
            <p className="mt-2.5 text-sm font-medium text-slate-600 sm:text-[15px]">
              声音克隆 · 视频与图像生成 · 抖音解析 · 团队共享素材库
            </p>
          </div>

          {/* Mobile Filter Pills */}
          <div className="flex flex-wrap gap-1.5 md:hidden">
            {FILTER_TABS.map((tab) => (
              <button
                key={tab.key}
                type="button"
                onClick={() => setActiveFilter(tab.key)}
                className={cn(
                  "rounded-full px-3 py-1.5 text-xs font-semibold transition-all",
                  activeFilter === tab.key
                    ? "bg-slate-900 text-white shadow-sm"
                    : "bg-white/80 text-slate-600 ring-1 ring-slate-200"
                )}
              >
                {tab.label}
              </button>
            ))}
          </div>
        </motion.div>

        {/* Apple Keynote x Stripe Vibrant Bento Showcase */}
        <motion.div
          layout
          className="grid w-full grid-cols-1 gap-4 md:grid-cols-12 lg:gap-5"
        >
          {visibleModules.map((module) => {
            const Icon = module.icon;
            const isHero = module.tier === 'hero' && activeFilter === 'all';
            const isFeature = module.tier === 'feature' || activeFilter !== 'all';
            const unreadCount = module.id === 'video-library' ? videoLibraryUnreadCount : 0;
            const colSpan =
              activeFilter === 'all'
                ? module.spanAll
                : visibleModules.length === 2
                  ? 'md:col-span-6 lg:col-span-6'
                  : 'md:col-span-4 lg:col-span-4';

            if (isHero) {
              return (
                <motion.button
                  key={module.id}
                  layout
                  type="button"
                  onClick={() => onNavigate(module.id)}
                  whileHover={{ y: -4 }}
                  whileTap={{ scale: 0.99 }}
                  transition={{ duration: 0.25, ease: [0.22, 1, 0.36, 1] }}
                  className={cn(
                    "group relative flex min-h-[218px] flex-col justify-between overflow-hidden rounded-[26px] p-7 text-left text-white outline-none focus-visible:ring-2 focus-visible:ring-blue-500/60",
                    module.heroClass,
                    colSpan
                  )}
                >
                  {module.id === 'creative' && <CreativeGlassVisual />}
                  {module.id === 'voice' && <VoiceGlassVisual />}

                  <div className="relative z-10 flex w-full items-start justify-between gap-3">
                    <div className="flex size-12 items-center justify-center rounded-2xl border border-white/35 bg-white/20 text-white backdrop-blur-md shadow-inner">
                      <Icon className="size-6 stroke-[2]" />
                    </div>
                    <span className="flex size-9 items-center justify-center rounded-full border border-white/30 bg-white/15 text-white backdrop-blur-md transition-all duration-300 group-hover:bg-white group-hover:text-slate-900">
                      <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </span>
                  </div>

                  <div className="relative z-10 mt-8 max-w-[66%]">
                    <div className="text-[11px] font-bold tracking-wider text-white/80">
                      {module.subtitle}
                    </div>
                    <h2 className="mt-1 text-2xl font-extrabold tracking-tight text-white">
                      {module.title}
                    </h2>
                    <p className="mt-1.5 text-[13px] leading-relaxed text-white/90">
                      {module.desc}
                    </p>
                  </div>
                </motion.button>
              );
            }

            return (
              <motion.button
                key={module.id}
                layout
                type="button"
                onClick={() => onNavigate(module.id)}
                whileHover={{ y: -4 }}
                whileTap={{ scale: 0.985 }}
                transition={{ duration: 0.24, ease: [0.22, 1, 0.36, 1] }}
                className={cn(
                  "home-glass-card group relative flex flex-col justify-between overflow-hidden rounded-[24px] p-6 text-left outline-none focus-visible:ring-2 focus-visible:ring-blue-500/50",
                  module.hoverBorder,
                  isFeature ? "min-h-[186px]" : "min-h-[164px]",
                  colSpan
                )}
              >
                {/* Vivid chromatic top accent ribbon */}
                <div
                  aria-hidden="true"
                  className={cn(
                    "absolute inset-x-0 top-0 h-1 bg-gradient-to-r opacity-90 transition-opacity group-hover:opacity-100",
                    module.accentGradient
                  )}
                />

                {/* Soft luminous color bloom on top-right */}
                <div
                  aria-hidden="true"
                  className={cn(
                    "pointer-events-none absolute -right-12 -top-12 size-36 rounded-full bg-gradient-to-br opacity-[0.14] blur-2xl transition-opacity duration-500 group-hover:opacity-[0.26]",
                    module.accentGradient
                  )}
                />

                <div className="relative z-10 flex w-full items-start justify-between gap-3">
                  <div
                    className={cn(
                      "flex size-11 items-center justify-center rounded-2xl bg-gradient-to-br text-white shadow-md transition-transform duration-300 group-hover:scale-105",
                      module.accentGradient
                    )}
                  >
                    <Icon className="size-5 stroke-[2]" />
                  </div>

                  <div className="flex items-center gap-2">
                    {unreadCount > 0 ? (
                      <span className="inline-flex items-center gap-1 rounded-full bg-gradient-to-r from-rose-500 to-orange-500 px-2.5 py-1 text-[11px] font-bold text-white shadow-sm shadow-rose-500/25">
                        {unreadCount > 99 ? '99+' : unreadCount} 条未读
                      </span>
                    ) : (
                      <span className="flex size-8 items-center justify-center rounded-full bg-slate-900/[0.04] text-slate-400 transition-all duration-300 group-hover:bg-slate-900 group-hover:text-white">
                        <ArrowUpRight className="size-4 transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                      </span>
                    )}
                  </div>
                </div>

                <div className="relative z-10 mt-6">
                  <div className="flex items-center gap-2">
                    <h2 className="text-[17px] font-extrabold tracking-tight text-slate-900">
                      {module.title}
                    </h2>
                    <span
                      className={cn(
                        "rounded-md px-2 py-0.5 text-[10px] font-bold",
                        module.tintBg,
                        module.tintText
                      )}
                    >
                      {module.subtitle.split(' · ')[0]}
                    </span>
                  </div>
                  <p className="mt-1.5 line-clamp-2 text-[13px] leading-relaxed text-slate-600">
                    {module.desc}
                  </p>
                </div>
              </motion.button>
            );
          })}
        </motion.div>
      </main>

      <SiteFooter tone="light" className="relative z-10 mt-auto py-7" />
    </div>
  );
}

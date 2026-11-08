import { useEffect, useState, type CSSProperties } from "react";
import {
  BookOpenText,
  CalendarRange,
  Crown,
  Download,
  Image,
  LogOut,
  Mic2,
  Network,
  Video,
  Wand2,
} from "lucide-react";
import { motion, useReducedMotion } from "motion/react";
import SiteFooter from "@/src/components/SiteFooter";
import type { ModuleId } from "@/src/components/ModuleQuickNav";
import {
  calculateVideoLibraryUnread,
  getVideoLibrarySummary,
  VIDEO_LIBRARY_READ_CHANGE_EVENT,
  VIDEO_LIBRARY_READ_STATE_KEY,
} from "@/src/lib/videoLibrary";
import {
  SpringCloud,
  SpringLantern,
  SpringPalaceLantern,
  SpringParticles,
  SpringPlumBranch,
  SpringSeal,
} from "./SpringDecor";
import "./spring.css";

interface HomePageProps {
  onNavigate: (page: ModuleId) => void;
  onLogout: () => void;
}

const modules = [
  {
    id: "voice" as const,
    title: "声音克隆",
    desc: "上传音频样本，AI 克隆您的专属音色",
    icon: Mic2,
    accent: "#9E2B25",
  },
  {
    id: "creative" as const,
    title: "创意创作",
    desc: "视频分析 + AI 生成，灵感一键成片",
    icon: Wand2,
    accent: "#2F6B4F",
  },
  {
    id: "image" as const,
    title: "图片生成",
    desc: "Image 2.5 智能分流，兼顾速度与精细编辑",
    icon: Image,
    accent: "#A86A1C",
  },
  {
    id: "douyin" as const,
    title: "视频解析",
    desc: "抖音无水印下载，自动提取口播文案",
    icon: Download,
    accent: "#2C5F6F",
  },
  {
    id: "collection" as const,
    title: "店铺总览",
    desc: "店铺、商品、视频号、ADQ 与发货商家关系图谱",
    icon: Network,
    accent: "#3B5B6B",
  },
  {
    id: "topmodel" as const,
    title: "顶级模型",
    desc: "Claude、ChatGPT、Doubao、千问多模型对话",
    icon: Crown,
    accent: "#5B3A57",
  },
  {
    id: "feeding" as const,
    title: "创意文库",
    desc: "沉淀装饰画爆款开头，基于真实案例仿写",
    icon: BookOpenText,
    accent: "#A33B4A",
  },
  {
    id: "timeline" as const,
    title: "团队轨迹",
    desc: "记录团队每一年的关键选择、困难与突破",
    icon: CalendarRange,
    accent: "#7A5630",
  },
  {
    id: "video-library" as const,
    title: "视频素材库",
    desc: "团队共享装饰画视频，原文件保存，多设备同步",
    icon: Video,
    accent: "#3A6478",
  },
];

const MODULE_NUMERALS = ["壹", "贰", "叁", "肆", "伍", "陆", "柒", "捌", "玖"];

const DEFAULT_CULTURE_MOTTOS = ["多试试总没错", "7+3=七分专注，三分探索"];

function parseCultureMottoDraft(value: string) {
  const lines = value
    .split(/\n+/g)
    .map((line) => line.trim())
    .filter(Boolean)
    .slice(0, 4);
  return lines.length ? lines : DEFAULT_CULTURE_MOTTOS;
}

async function fetchCultureMottos() {
  const response = await fetch("/api/home/culture-mottos", { credentials: "include" });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.error || "读取主页标语失败");
  }
  return Array.isArray(json?.mottos)
    ? parseCultureMottoDraft(json.mottos.join("\n"))
    : DEFAULT_CULTURE_MOTTOS;
}

async function updateCultureMottos(mottos: string[]) {
  const response = await fetch("/api/home/culture-mottos", {
    method: "PUT",
    credentials: "include",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ mottos }),
  });
  const json = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(json?.error || "保存主页标语失败");
  }
  return Array.isArray(json?.mottos)
    ? parseCultureMottoDraft(json.mottos.join("\n"))
    : mottos;
}

export default function SpringHomePage({ onNavigate, onLogout }: HomePageProps) {
  const [cultureMottos, setCultureMottos] = useState<string[]>(DEFAULT_CULTURE_MOTTOS);
  const [isCultureEditorOpen, setIsCultureEditorOpen] = useState(false);
  const [cultureDraft, setCultureDraft] = useState(() => DEFAULT_CULTURE_MOTTOS.join("\n"));
  const [cultureSaveError, setCultureSaveError] = useState("");
  const [isCultureSaving, setIsCultureSaving] = useState(false);
  const [videoLibraryUnreadCount, setVideoLibraryUnreadCount] = useState(0);
  const shouldReduceMotion = useReducedMotion();

  useEffect(() => {
    let cancelled = false;
    async function refreshVideoLibraryUnread() {
      try {
        const items = await getVideoLibrarySummary();
        if (!cancelled) {
          setVideoLibraryUnreadCount(calculateVideoLibraryUnread(items).total);
        }
      } catch {
        // 首页提醒读取失败不影响其他模块使用。
      }
    }
    const handleVisibility = () => {
      if (document.visibilityState === "visible") void refreshVideoLibraryUnread();
    };
    const handleStorage = (event: StorageEvent) => {
      if (event.key === VIDEO_LIBRARY_READ_STATE_KEY) void refreshVideoLibraryUnread();
    };
    void refreshVideoLibraryUnread();
    const timer = window.setInterval(refreshVideoLibraryUnread, 30_000);
    window.addEventListener("focus", refreshVideoLibraryUnread);
    window.addEventListener(VIDEO_LIBRARY_READ_CHANGE_EVENT, refreshVideoLibraryUnread);
    window.addEventListener("storage", handleStorage);
    document.addEventListener("visibilitychange", handleVisibility);
    return () => {
      cancelled = true;
      window.clearInterval(timer);
      window.removeEventListener("focus", refreshVideoLibraryUnread);
      window.removeEventListener(VIDEO_LIBRARY_READ_CHANGE_EVENT, refreshVideoLibraryUnread);
      window.removeEventListener("storage", handleStorage);
      document.removeEventListener("visibilitychange", handleVisibility);
    };
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadServerMottos() {
      try {
        const next = await fetchCultureMottos();
        if (cancelled) return;
        setCultureMottos(next);
        setCultureDraft(next.join("\n"));
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
    setCultureDraft(cultureMottos.join("\n"));
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
      setCultureDraft(saved.join("\n"));
      setIsCultureEditorOpen(false);
    } catch (error) {
      setCultureSaveError(error instanceof Error ? error.message : "保存主页标语失败");
    } finally {
      setIsCultureSaving(false);
    }
  }

  function cancelCultureEdit() {
    setCultureDraft(cultureMottos.join("\n"));
    setCultureSaveError("");
    setIsCultureEditorOpen(false);
  }

  const mottoShift = Math.max(0, cultureMottos.length - 2) * 22;

  return (
    <div className="spring-home">
      <div className="spring-home-bg" aria-hidden="true" />
      <div className="spring-home-grain" aria-hidden="true" />
      <div className="spring-home-moon" aria-hidden="true">
        <span>春</span>
      </div>
      <SpringPlumBranch className="spring-home-plum" />
      <SpringCloud className="spring-home-cloud-left" />
      <SpringCloud className="spring-home-cloud-right" />
      <SpringLantern className="spring-home-lantern spring-home-lantern-left" delay={0.2} />
      <SpringPalaceLantern className="spring-home-lantern spring-home-lantern-right" delay={2.6} />
      <SpringParticles className="spring-home-particles" />

      <div className="spring-home-shell">
        <header className="spring-home-top">
          <div
            className="spring-motto-zone"
            onDoubleClick={openCultureEditor}
            title="双击编辑团队标语"
          >
            {isCultureEditorOpen ? (
              <div
                className="spring-motto-editor"
                onDoubleClick={(event) => event.stopPropagation()}
              >
                <textarea
                  value={cultureDraft}
                  onChange={(event) => setCultureDraft(event.target.value)}
                  onKeyDown={(event) => {
                    if ((event.metaKey || event.ctrlKey) && event.key === "Enter") {
                      event.preventDefault();
                      void saveCultureMottos();
                    }
                    if (event.key === "Escape") {
                      event.preventDefault();
                      cancelCultureEdit();
                    }
                  }}
                  autoFocus
                  rows={4}
                  className="spring-motto-textarea"
                />
                <div className="spring-motto-actions">
                  <span
                    className={`spring-motto-hint${
                      cultureSaveError ? " spring-motto-hint-error" : ""
                    }`}
                  >
                    {cultureSaveError || "每行一句，最多 4 行，所有设备同步"}
                  </span>
                  <div className="spring-motto-buttons">
                    <button
                      type="button"
                      onClick={cancelCultureEdit}
                      disabled={isCultureSaving}
                      className="spring-motto-cancel"
                    >
                      取消
                    </button>
                    <button
                      type="button"
                      onClick={() => void saveCultureMottos()}
                      disabled={isCultureSaving}
                      className="spring-motto-save"
                    >
                      {isCultureSaving ? "保存中" : "保存"}
                    </button>
                  </div>
                </div>
              </div>
            ) : (
              <div className="spring-motto-note">
                <span className="spring-motto-pin" aria-hidden="true" />
                <div className="spring-motto-label">团队信条</div>
                <div className="spring-motto-window">
                  <div
                    className="spring-motto-scroll"
                    style={{ "--motto-shift": `-${mottoShift}px` } as CSSProperties}
                  >
                    {cultureMottos.map((motto) => (
                      <div key={motto} className="spring-motto-line">
                        {motto}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            )}
          </div>

          <div className="spring-home-mobile-brand">
            <span className="spring-brand-mark" aria-hidden="true">
              AI
            </span>
            <div>
              <div className="spring-brand-name">AI 创意工作台</div>
              <div className="spring-brand-sub">新春纳福 · 灵感常新</div>
            </div>
          </div>

          <button onClick={onLogout} className="spring-logout">
            <LogOut className="size-3.5" />
            退出登录
          </button>
        </header>

        <main className="spring-home-main">
          <motion.div
            className="spring-home-hero"
            initial={shouldReduceMotion ? false : { opacity: 0, y: 16 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.7, ease: "easeOut" }}
          >
            <div className="spring-home-eyebrow">
              <span className="spring-home-eyebrow-line" />
              <span className="spring-home-eyebrow-diamond" />
              <span>二〇二七 · 新春</span>
              <span className="spring-home-eyebrow-diamond" />
              <span className="spring-home-eyebrow-line" />
            </div>

            <h1 className="spring-home-title">
              <span className="spring-title-welcome">欢迎来到</span>
              <span className="spring-title-ai">AI</span>
              <span className="spring-title-brand">创意工作台</span>
              <SpringSeal className="spring-title-seal">春</SpringSeal>
            </h1>

            <p className="spring-home-sub">新岁启封 · 灵感常新</p>
            <p className="spring-home-sub-en">
              Professional AI Workspace · Unleash Your Imagination
            </p>
          </motion.div>

          <motion.div
            className="spring-home-grid"
            initial={shouldReduceMotion ? false : "hidden"}
            animate="visible"
            variants={{
              hidden: { opacity: 0 },
              visible: {
                opacity: 1,
                transition: { staggerChildren: 0.07, delayChildren: 0.1 },
              },
            }}
          >
            {modules.map((module, index) => {
              const Icon = module.icon;
              return (
                <motion.div
                  key={module.id}
                  variants={{
                    hidden: { opacity: 0, y: 26 },
                    visible: {
                      opacity: 1,
                      y: 0,
                      transition: { type: "spring", stiffness: 110, damping: 20, mass: 0.8 },
                    },
                  }}
                  whileHover={shouldReduceMotion ? undefined : { y: -5 }}
                  whileTap={shouldReduceMotion ? undefined : { scale: 0.985 }}
                  className="spring-module-card"
                  role="button"
                  tabIndex={0}
                  aria-label={`打开${module.title}`}
                  onClick={() => onNavigate(module.id)}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      event.preventDefault();
                      onNavigate(module.id);
                    }
                  }}
                >
                  <span className="spring-module-number" aria-hidden="true">
                    {MODULE_NUMERALS[index]}
                  </span>
                  <span
                    className="spring-module-accent"
                    style={{ backgroundColor: module.accent }}
                    aria-hidden="true"
                  />
                  <div
                    className="spring-module-icon"
                    style={{ backgroundColor: module.accent }}
                  >
                    <Icon className="size-6" strokeWidth={1.7} />
                    {module.id === "video-library" && videoLibraryUnreadCount > 0 && (
                      <span className="spring-module-badge">
                        {videoLibraryUnreadCount > 99 ? "99+" : videoLibraryUnreadCount}
                      </span>
                    )}
                  </div>

                  <h3 className="spring-module-title">{module.title}</h3>
                  <p className="spring-module-desc">{module.desc}</p>
                  <SpringCloud className="spring-module-cloud" />
                </motion.div>
              );
            })}
          </motion.div>

          <div className="spring-home-wish">恭贺新禧 · 万事胜意</div>
        </main>

        <footer className="spring-home-footer">
          <SiteFooter className="spring-site-footer" />
        </footer>
      </div>
    </div>
  );
}

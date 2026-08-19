import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  BookOpenText,
  Check,
  CheckCircle2,
  ChevronDown,
  ChevronUp,
  Copy,
  Edit3,
  FileText,
  History,
  ImagePlus,
  Loader2,
  PenLine,
  PencilLine,
  RefreshCw,
  Save,
  Sparkles,
  Star,
  Trash2,
  Upload,
  Wand2,
  X,
} from "lucide-react";
import { motion } from "motion/react";
import ModuleQuickNav, { type ModuleId } from "@/src/components/ModuleQuickNav";
import HomeBackButton from "@/src/components/HomeBackButton";
import CreativeSubNav from "@/src/components/CreativeSubNav";
import { cn } from "@/src/lib/utils";
import {
  analyzeCopyPainting,
  deleteCopyLibraryItem,
  generateOriginalCopies,
  listCopyLibrary,
  regenerateCopy,
  rewriteCopy,
  saveCopyLibraryItem,
  updateCopyLibraryItem,
  countCopyChars,
  type CopyLibraryItem,
  type CopyOriginalItem,
  type CopyProfile,
  type CopyRewriteVersion,
} from "@/src/lib/copywriting";
import {
  blobToFile,
  formatHistoryTime,
  getUploadHistoryItem,
  loadUploadHistorySummaries,
  saveUploadHistory,
  type UploadHistorySummaryItem,
} from "@/src/lib/uploadHistory";

interface CopywritingPageProps {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
  onSwitchToVideo?: () => void;
}

interface OriginalResultItem extends CopyOriginalItem {
  isLiked: boolean;
  savedId: string | null;
}

interface RewriteResultItem extends CopyRewriteVersion {
  isLiked: boolean;
  savedId: string | null;
}

interface ProfileDraft {
  name: string;
  visualDescription: string;
  style: string;
  textCalligraphySeals: string;
  material: string;
  structure: string;
  colors: string;
  suitableScenes: string;
  targetAudiences: string;
  meanings: string;
  sellingPoints: string;
  uncertainClaims: string;
}

function linesToArray(value: string): string[] {
  return String(value || '')
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function profileToDraft(profile: CopyProfile): ProfileDraft {
  return {
    name: profile.name || '',
    visualDescription: profile.visualDescription || '',
    style: profile.style || '',
    textCalligraphySeals: profile.textCalligraphySeals || '',
    material: profile.material || '',
    structure: profile.structure || '',
    colors: (profile.colors || []).join('\n'),
    suitableScenes: (profile.suitableScenes || []).join('\n'),
    targetAudiences: (profile.targetAudiences || []).join('\n'),
    meanings: (profile.meanings || []).join('\n'),
    sellingPoints: (profile.sellingPoints || []).join('\n'),
    uncertainClaims: (profile.uncertainClaims || []).join('\n'),
  };
}

function draftToProfile(draft: ProfileDraft): CopyProfile {
  return {
    name: draft.name.trim(),
    visualDescription: draft.visualDescription.trim(),
    style: draft.style.trim(),
    textCalligraphySeals: draft.textCalligraphySeals.trim(),
    material: draft.material.trim(),
    structure: draft.structure.trim(),
    colors: linesToArray(draft.colors),
    suitableScenes: linesToArray(draft.suitableScenes),
    targetAudiences: linesToArray(draft.targetAudiences),
    meanings: linesToArray(draft.meanings),
    sellingPoints: linesToArray(draft.sellingPoints),
    uncertainClaims: linesToArray(draft.uncertainClaims),
  };
}

async function copyToClipboard(text: string): Promise<boolean> {
  try {
    if (navigator.clipboard?.writeText) {
      await navigator.clipboard.writeText(text);
      return true;
    }
  } catch {
    // fall through to legacy path
  }
  try {
    const textarea = document.createElement('textarea');
    textarea.value = text;
    textarea.style.position = 'fixed';
    textarea.style.opacity = '0';
    document.body.appendChild(textarea);
    textarea.select();
    const ok = document.execCommand('copy');
    document.body.removeChild(textarea);
    return ok;
  } catch {
    return false;
  }
}

function fileToThumbnailDataUrl(file: File, maxDim = 480, quality = 0.7): Promise<string> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      const scale = Math.min(1, maxDim / Math.max(image.naturalWidth || maxDim, image.naturalHeight || maxDim));
      const width = Math.max(1, Math.round((image.naturalWidth || maxDim) * scale));
      const height = Math.max(1, Math.round((image.naturalHeight || maxDim) * scale));
      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;
      canvas.getContext('2d')?.drawImage(image, 0, 0, width, height);
      URL.revokeObjectURL(url);
      resolve(canvas.toDataURL('image/jpeg', quality));
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片缩略图处理失败'));
    };
    image.src = url;
  });
}

const PROFILE_TEXT_FIELDS: Array<{ key: keyof ProfileDraft; label: string; rows?: number }> = [
  { key: 'name', label: '挂画名称' },
  { key: 'visualDescription', label: '画面主体和内容', rows: 3 },
  { key: 'style', label: '视觉风格' },
  { key: 'textCalligraphySeals', label: '文字、书法、印章', rows: 2 },
  { key: 'material', label: '材质与形态' },
  { key: 'structure', label: '边框、木条、挂轴挂绳', rows: 2 },
];

const PROFILE_LIST_FIELDS: Array<{ key: keyof ProfileDraft; label: string; rows?: number }> = [
  { key: 'colors', label: '主要颜色（每行一个）' },
  { key: 'suitableScenes', label: '适合悬挂空间（每行一个）', rows: 3 },
  { key: 'targetAudiences', label: '适合人群（每行一个）', rows: 3 },
  { key: 'meanings', label: '核心寓意/情绪价值（每行一个）', rows: 3 },
  { key: 'sellingPoints', label: '产品卖点（每行一个）', rows: 3 },
  { key: 'uncertainClaims', label: '不确定/不可编造信息（每行一个）', rows: 3 },
];

const STEPS = [
  { label: '分析挂画', desc: '上传图片，豆包生成档案' },
  { label: '确认档案', desc: '核对产品事实与卖点' },
  { label: '生成文案', desc: '原创 10 条 · 爆款仿写' },
];

function StepIndicator({ current }: { current: number }) {
  return (
    <ol className="flex items-center justify-center gap-2 sm:gap-3">
      {STEPS.map((step, index) => {
        const num = index + 1;
        const isDone = num < current;
        const isActive = num === current;
        return (
          <Fragment key={step.label}>
            <li className="flex items-center gap-2.5">
              <span
                className={cn(
                  'flex size-8 shrink-0 items-center justify-center rounded-full text-sm font-black transition-all',
                  isDone && 'bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-sm',
                  isActive && 'bg-slate-900 text-white ring-4 ring-violet-200/60',
                  !isDone && !isActive && 'bg-white/80 text-slate-400 ring-1 ring-slate-200'
                )}
              >
                {isDone ? <Check className="size-4" /> : num}
              </span>
              <span className="hidden flex-col md:flex">
                <span className={cn('text-sm font-black leading-tight', isActive ? 'text-slate-900' : isDone ? 'text-slate-700' : 'text-slate-400')}>
                  {step.label}
                </span>
                <span className="text-[11px] font-bold text-slate-400">{step.desc}</span>
              </span>
            </li>
            {index < STEPS.length - 1 && (
              <li className={cn('h-0.5 w-6 rounded-full sm:w-12', isDone ? 'bg-gradient-to-r from-violet-500 to-fuchsia-600' : 'bg-slate-200')} />
            )}
          </Fragment>
        );
      })}
    </ol>
  );
}

function ResultCard({
  index,
  badge,
  badgeClass,
  direction,
  fullText,
  wordCount,
  isLiked,
  savedId,
  onEditCommit,
  onToggleLike,
  onSave,
  onRegenerate,
  regenerateBusy,
}: {
  index: number;
  badge: string;
  badgeClass: string;
  direction: string;
  fullText: string;
  wordCount: number;
  isLiked: boolean;
  savedId: string | null;
  onEditCommit: (newText: string) => void;
  onToggleLike: () => void;
  onSave: () => void;
  onRegenerate?: () => void;
  regenerateBusy?: boolean;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fullText);
  const [copied, setCopied] = useState(false);

  const previewText = useMemo(() => {
    if (expanded || fullText.length <= 180) return fullText;
    return `${fullText.slice(0, 180)}…`;
  }, [expanded, fullText]);

  const handleCopy = async () => {
    const ok = await copyToClipboard(fullText);
    if (ok) {
      setCopied(true);
      window.setTimeout(() => setCopied(false), 1800);
    }
  };

  const startEdit = () => {
    setDraft(fullText);
    setEditing(true);
  };

  const commitEdit = () => {
    onEditCommit(draft);
    setEditing(false);
  };

  return (
    <div className="group rounded-2xl border border-slate-200/80 bg-white/90 p-5 shadow-sm transition-all hover:border-violet-200 hover:shadow-md">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-slate-900 text-xs font-black text-white">
            {index}
          </span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', badgeClass)}>{badge}</span>
          {direction && <span className="truncate text-xs font-bold text-slate-500">{direction}</span>}
        </div>
        <button
          type="button"
          onClick={onToggleLike}
          className={cn(
            'flex h-8 w-8 items-center justify-center rounded-lg border transition-colors',
            isLiked ? 'border-amber-200 bg-amber-50 text-amber-500' : 'border-slate-200 text-slate-300 hover:border-amber-200 hover:text-amber-500'
          )}
          title={isLiked ? '取消标记' : '标记为好'}
        >
          <Star className={cn('size-4', isLiked && 'fill-current')} />
        </button>
      </div>

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={9}
            className="w-full resize-y rounded-xl border border-violet-200 bg-white p-3 text-[15px] leading-relaxed text-slate-800 outline-none focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
          />
          <div className="mt-2 flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setEditing(false)}
              className="h-8 rounded-full px-3 text-xs font-bold text-slate-500 hover:bg-slate-100"
            >
              取消
            </button>
            <button
              type="button"
              onClick={commitEdit}
              className="h-8 rounded-full bg-slate-900 px-3 text-xs font-bold text-white hover:bg-slate-800"
            >
              保存修改
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700" onDoubleClick={startEdit}>
          {previewText}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="text-xs font-bold text-slate-400">共 {wordCount} 字</span>
        <div className="flex flex-wrap items-center gap-1.5">
          {fullText.length > 180 && !editing && (
            <button
              type="button"
              onClick={() => setExpanded((v) => !v)}
              className="flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-bold text-slate-500 hover:bg-slate-100"
            >
              {expanded ? <ChevronUp className="size-3.5" /> : <ChevronDown className="size-3.5" />}
              {expanded ? '收起' : '展开'}
            </button>
          )}
          <button
            type="button"
            onClick={handleCopy}
            className={cn(
              'flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-bold transition-colors',
              copied ? 'border-emerald-200 bg-emerald-50 text-emerald-600' : 'border-slate-200 text-slate-600 hover:bg-slate-50'
            )}
          >
            {copied ? <CheckCircle2 className="size-3.5" /> : <Copy className="size-3.5" />}
            {copied ? '复制成功' : '复制'}
          </button>
          <button
            type="button"
            onClick={startEdit}
            className="flex h-8 items-center gap-1 rounded-full border border-slate-200 px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50"
          >
            <Edit3 className="size-3.5" />
            编辑
          </button>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerateBusy}
              className="flex h-8 items-center gap-1 rounded-full border border-slate-200 px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshCw className={cn('size-3.5', regenerateBusy && 'animate-spin')} />
              重生成
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            className="flex h-8 items-center gap-1 rounded-full bg-slate-900 px-2.5 text-xs font-bold text-white hover:bg-slate-800"
          >
            {savedId ? <Check className="size-3.5" /> : <Save className="size-3.5" />}
            {savedId ? '已入库' : '存文案库'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function CopywritingPage({ onBack, onNavigate, onSwitchToVideo }: CopywritingPageProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const generateSectionRef = useRef<HTMLElement>(null);
  const profileSectionRef = useRef<HTMLElement>(null);

  const [paintingFile, setPaintingFile] = useState<File | null>(null);
  const [paintingPreviewUrl, setPaintingPreviewUrl] = useState<string | null>(null);

  const [name, setName] = useState('');
  const [extraInfo, setExtraInfo] = useState('');
  const [sellingPoints, setSellingPoints] = useState('');
  const [forbidden, setForbidden] = useState('');

  const [profile, setProfile] = useState<CopyProfile | null>(null);
  const [profileDraft, setProfileDraft] = useState<ProfileDraft>(profileToDraft({}));
  const [profileConfirmed, setProfileConfirmed] = useState(false);
  const [imageThumb, setImageThumb] = useState<string | null>(null);

  const [originalItems, setOriginalItems] = useState<OriginalResultItem[]>([]);
  const [rewriteItems, setRewriteItems] = useState<RewriteResultItem[]>([]);
  const [rewriteOriginalText, setRewriteOriginalText] = useState('');

  const [library, setLibrary] = useState<CopyLibraryItem[]>([]);
  const [libraryOpen, setLibraryOpen] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [rewriting, setRewriting] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [historyImages, setHistoryImages] = useState<Array<{ id: number; name: string; previewUrl: string }>>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const analyzingRef = useRef(false);
  const generatingRef = useRef(false);
  const rewritingRef = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const items = await listCopyLibrary();
        if (!cancelled) setLibrary(items);
      } catch {
        // 文案库读取失败不阻塞主流程
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const summaries = await loadUploadHistorySummaries('image');
        if (cancelled) return;
        const mapped = summaries
          .filter((s) => s.previewBlob)
          .map((s: UploadHistorySummaryItem) => ({
            id: s.id,
            name: s.name,
            previewUrl: URL.createObjectURL(s.previewBlob as Blob),
          }));
        setHistoryImages(mapped);
      } catch {
        // 历史图片读取失败不影响主流程
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const applyPaintingFile = useCallback((file: File | null) => {
    if (paintingPreviewUrl) URL.revokeObjectURL(paintingPreviewUrl);
    setPaintingFile(file);
    setPaintingPreviewUrl(file ? URL.createObjectURL(file) : null);
    setProfile(null);
    setProfileConfirmed(false);
    setImageThumb(null);
    setOriginalItems([]);
    setRewriteItems([]);
  }, [paintingPreviewUrl]);

  const handleFileChange = (file: File | null) => {
    applyPaintingFile(file);
  };

  const handlePickHistory = async (id: number) => {
    try {
      const item = await getUploadHistoryItem(id);
      if (!item) return;
      applyPaintingFile(blobToFile(item));
      setHistoryOpen(false);
    } catch {
      setError('读取历史图片失败，请重新上传。');
    }
  };

  const handleAnalyze = async () => {
    if (!paintingFile || analyzingRef.current) return;
    analyzingRef.current = true;
    setAnalyzing(true);
    setError('');
    try {
      const result = await analyzeCopyPainting(paintingFile, { name, extraInfo, sellingPoints, forbidden });
      setProfile(result);
      setProfileDraft(profileToDraft(result));
      setProfileConfirmed(false);
      setOriginalItems([]);
      setRewriteItems([]);
      try {
        setImageThumb(await fileToThumbnailDataUrl(paintingFile));
      } catch {
        setImageThumb(null);
      }
      void saveUploadHistory(paintingFile, 'image');
      window.setTimeout(() => profileSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
    } catch (err) {
      setError(err instanceof Error ? err.message : '挂画分析失败');
    } finally {
      analyzingRef.current = false;
      setAnalyzing(false);
    }
  };

  const handleConfirmProfile = () => {
    const next = draftToProfile(profileDraft);
    setProfile(next);
    setProfileConfirmed(true);
    setError('');
    setNotice('挂画档案已确认，可以开始生成文案了');
    window.setTimeout(() => setNotice(''), 3200);
    window.setTimeout(() => generateSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 80);
  };

  const handleEditProfile = () => {
    setProfileConfirmed(false);
    window.setTimeout(() => profileSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' }), 60);
  };

  const buildLibraryPayload = (item: { mode?: string; version?: string; direction: string; fullText: string; isLiked: boolean }, type: 'original' | 'rewrite') => {
    return {
      type,
      profile: profile || {},
      imageThumb: imageThumb || undefined,
      extraInfo,
      forbidden,
      originalText: type === 'rewrite' ? rewriteOriginalText : undefined,
      mode: type === 'original' ? (item.mode as 'stable' | 'explore') : undefined,
      version: type === 'rewrite' ? item.version : undefined,
      direction: item.direction,
      fullText: item.fullText,
      wordCount: countCopyChars(item.fullText),
      isLiked: item.isLiked,
    };
  };

  const handleGenerateOriginal = async () => {
    if (!profileConfirmed || !profile || generatingRef.current) return;
    generatingRef.current = true;
    setGenerating(true);
    setError('');
    try {
      const copies = await generateOriginalCopies(profile, { extraInfo, forbidden });
      setOriginalItems(copies.map((c) => ({ ...c, isLiked: false, savedId: null })));
    } catch (err) {
      setError(err instanceof Error ? err.message : '原创文案生成失败');
    } finally {
      generatingRef.current = false;
      setGenerating(false);
      setConfirmRegenerate(false);
    }
  };

  const handleConfirmRegenerateBatch = () => {
    if (confirmRegenerate) {
      void handleGenerateOriginal();
    } else {
      setConfirmRegenerate(true);
    }
  };

  const handleRewrite = async () => {
    if (!profileConfirmed || !profile || !rewriteOriginalText.trim() || rewritingRef.current) return;
    rewritingRef.current = true;
    setRewriting(true);
    setError('');
    try {
      const { versions } = await rewriteCopy(rewriteOriginalText.trim(), profile, { extraInfo, forbidden });
      setRewriteItems(versions.map((v) => ({ ...v, isLiked: false, savedId: null })));
    } catch (err) {
      setError(err instanceof Error ? err.message : '爆款文案仿写失败');
    } finally {
      rewritingRef.current = false;
      setRewriting(false);
    }
  };

  const handleEditOriginal = (id: string, newText: string) => {
    setOriginalItems((prev) => prev.map((item) => (item.id === id ? { ...item, fullText: newText } : item)));
  };

  const handleEditRewrite = (index: number, newText: string) => {
    setRewriteItems((prev) => prev.map((item, i) => (i === index ? { ...item, content: newText } : item)));
  };

  const handleToggleLike = (kind: 'original' | 'rewrite', idOrIndex: string | number) => {
    if (kind === 'original') {
      setOriginalItems((prev) =>
        prev.map((item) => (item.id === idOrIndex ? { ...item, isLiked: !item.isLiked } : item))
      );
    } else {
      setRewriteItems((prev) =>
        prev.map((item, i) => (i === idOrIndex ? { ...item, isLiked: !item.isLiked } : item))
      );
    }
  };

  const handleSaveItem = async (item: { mode?: string; version?: string; direction: string; fullText: string; isLiked: boolean }, type: 'original' | 'rewrite', idOrIndex: string | number) => {
    setError('');
    try {
      const saved = await saveCopyLibraryItem(buildLibraryPayload(item, type));
      const savedId = saved?.id || null;
      if (type === 'original') {
        setOriginalItems((prev) => prev.map((x) => (x.id === idOrIndex ? { ...x, savedId } : x)));
      } else {
        setRewriteItems((prev) => prev.map((x, i) => (i === idOrIndex ? { ...x, savedId } : x)));
      }
      const refreshed = await listCopyLibrary();
      setLibrary(refreshed);
      setNotice('已保存到文案库');
      window.setTimeout(() => setNotice(''), 2200);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存到文案库失败');
    }
  };

  const handleRegenerateOne = async (item: OriginalResultItem) => {
    if (!profile || regeneratingId) return;
    setRegeneratingId(item.id);
    setError('');
    try {
      const excludeTexts = originalItems.filter((x) => x.id !== item.id).map((x) => x.fullText);
      const fresh = await regenerateCopy(profile, { mode: item.mode, direction: item.direction, targetLength: item.targetLength }, { extraInfo, forbidden, excludeTexts });
      setOriginalItems((prev) => prev.map((x) => (x.id === item.id ? { ...fresh, isLiked: x.isLiked, savedId: null } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '单独重新生成失败');
    } finally {
      setRegeneratingId(null);
    }
  };

  const handleToggleLibraryLike = async (item: CopyLibraryItem) => {
    try {
      await updateCopyLibraryItem(item.id, { isLiked: !item.isLiked });
      setLibrary((prev) => prev.map((x) => (x.id === item.id ? { ...x, isLiked: !item.isLiked } : x)));
    } catch (err) {
      setError(err instanceof Error ? err.message : '更新标记失败');
    }
  };

  const handleDeleteLibraryItem = async (id: string) => {
    try {
      await deleteCopyLibraryItem(id);
      setLibrary((prev) => prev.filter((x) => x.id !== id));
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除文案失败');
    }
  };

  const profileReady = !!profile;
  const currentStep = !profile ? 1 : !profileConfirmed ? 2 : 3;
  const generateDisabled = !profileConfirmed || generating;
  const rewriteDisabled = !profileConfirmed || rewriting || !rewriteOriginalText.trim();

  const confirmedSummary = useMemo(() => {
    if (!profileConfirmed || !profile) return null;
    const chips = [
      profileDraft.name,
      profileDraft.style,
      ...linesToArray(profileDraft.meanings),
      ...linesToArray(profileDraft.sellingPoints),
    ].filter(Boolean).slice(0, 5);
    return chips;
  }, [profileConfirmed, profile, profileDraft]);

  return (
    <div className="flex min-h-screen flex-col bg-background">
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-slate-300 bg-white/80 px-6 backdrop-blur-md">
        <div className="flex items-center gap-3">
          <HomeBackButton onClick={onBack} />
          <ModuleQuickNav current="creative" onNavigate={onNavigate} />
          <CreativeSubNav current="copy" onSwitchVideo={onSwitchToVideo ?? (() => {})} onSwitchCopy={() => {}} />
        </div>
      </header>

      <main className="mx-auto w-full max-w-[70rem] flex-1 px-4 py-8 md:px-6">
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-6 flex items-center gap-4"
        >
          <div className="relative">
            <div className="absolute inset-0 rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 opacity-30 blur-lg" />
            <div className="relative flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-md">
              <FileText className="size-6" />
            </div>
          </div>
          <div>
            <h1 className="text-2xl font-black tracking-tight text-slate-900">文案创作</h1>
            <p className="mt-0.5 text-sm font-bold text-slate-500">上传挂画 → 分析档案 → 原创口播 / 爆款仿写</p>
          </div>
        </motion.div>

        {/* Stepper */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ delay: 0.05 }}
          className="glass-card mb-6 rounded-3xl px-4 py-4"
        >
          <StepIndicator current={currentStep} />
        </motion.div>

        {/* Notice / Error */}
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex items-center gap-2 rounded-2xl border border-emerald-200 bg-emerald-50/90 px-4 py-3 text-sm font-bold text-emerald-700"
          >
            <CheckCircle2 className="size-4 shrink-0" />
            <span>{notice}</span>
          </motion.div>
        )}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex items-start gap-2 rounded-2xl border border-red-200 bg-red-50/90 px-4 py-3 text-sm font-bold text-red-600"
          >
            <X className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}

        {/* Step 1：分析挂画 */}
        <section className="glass-card mb-5 scroll-mt-20 rounded-3xl p-5 md:p-6">
          <div className="mb-4 flex items-center gap-2.5">
            <span className="flex size-7 items-center justify-center rounded-lg bg-slate-900 text-sm font-black text-white">1</span>
            <div>
              <h2 className="text-base font-black text-slate-900">分析挂画</h2>
              <p className="text-xs font-bold text-slate-400">上传挂画图片，豆包多模态识别并生成「挂画档案」</p>
            </div>
          </div>

          <div className="flex flex-col gap-5 md:flex-row">
            {/* Upload */}
            <div className="flex shrink-0 flex-col items-center gap-2.5">
              <input
                ref={fileInputRef}
                type="file"
                accept="image/*"
                className="hidden"
                onChange={(event) => handleFileChange(event.target.files?.[0] || null)}
              />
              <button
                type="button"
                onClick={() => fileInputRef.current?.click()}
                className={cn(
                  'group flex h-44 w-44 flex-col items-center justify-center gap-2.5 rounded-2xl border-2 border-dashed text-center transition-all',
                  paintingPreviewUrl
                    ? 'border-violet-200 bg-white p-1'
                    : 'border-slate-300 bg-white/60 hover:-translate-y-0.5 hover:border-violet-400 hover:bg-white hover:shadow-md'
                )}
              >
                {paintingPreviewUrl ? (
                  <img src={paintingPreviewUrl} alt="挂画预览" className="h-full w-full rounded-xl object-contain" />
                ) : (
                  <>
                    <span className="flex size-12 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-sm transition-transform group-hover:scale-110">
                      <Upload className="size-5" />
                    </span>
                    <span className="text-xs font-bold text-slate-600">点击上传挂画图片</span>
                    <span className="text-[11px] font-bold text-slate-400">支持 JPG / PNG / WebP</span>
                  </>
                )}
              </button>
              <button
                type="button"
                onClick={() => setHistoryOpen((v) => !v)}
                className="flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 text-xs font-bold text-slate-600 transition-colors hover:bg-white"
              >
                <History className="size-3.5" />
                历史图片
              </button>
              {historyOpen && historyImages.length > 0 && (
                <div className="flex max-h-40 w-44 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-slate-200 bg-white/80 p-2">
                  {historyImages.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => void handlePickHistory(img.id)}
                      className="h-14 w-14 overflow-hidden rounded-lg border border-slate-200 bg-white transition-colors hover:border-violet-300"
                      title={img.name}
                    >
                      <img src={img.previewUrl} alt={img.name} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              {historyOpen && historyImages.length === 0 && (
                <div className="w-44 rounded-xl border border-slate-200 bg-white/80 p-3 text-center text-[11px] font-bold text-slate-400">
                  暂无历史图片
                </div>
              )}
            </div>

            {/* Optional inputs */}
            <div className="grid flex-1 grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">挂画名称（可选）</span>
                <input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="例如：家和万事兴书法挂画"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white/90 px-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">核心寓意或卖点（可选）</span>
                <input
                  value={sellingPoints}
                  onChange={(event) => setSellingPoints(event.target.value)}
                  placeholder="例如：家和万事兴、适合乔迁送礼"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white/90 px-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-bold text-slate-600">补充产品信息（可选）</span>
                <textarea
                  value={extraInfo}
                  onChange={(event) => setExtraInfo(event.target.value)}
                  rows={2}
                  placeholder="材质、尺寸、工艺、销售场景等补充说明"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-bold text-slate-600">禁止出现的内容（可选）</span>
                <textarea
                  value={forbidden}
                  onChange={(event) => setForbidden(event.target.value)}
                  rows={2}
                  placeholder="例如：不得出现风水、招财、治病等夸大表述"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                />
              </label>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end">
            <button
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={!paintingFile || analyzing}
              className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-violet-600 to-fuchsia-600 px-6 text-sm font-bold text-white shadow-md shadow-violet-500/20 transition-all hover:shadow-lg hover:shadow-violet-500/30 disabled:cursor-not-allowed disabled:opacity-60 disabled:shadow-none"
            >
              {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {analyzing ? '豆包分析中…' : '分析产品'}
            </button>
          </div>
        </section>

        {/* Step 2：确认档案 */}
        {profileReady && (
          <section ref={profileSectionRef} className="glass-card mb-5 scroll-mt-20 rounded-3xl p-5 md:p-6">
            <div className="mb-4 flex flex-wrap items-center gap-2.5">
              <span className="flex size-7 items-center justify-center rounded-lg bg-slate-900 text-sm font-black text-white">2</span>
              <div className="mr-auto">
                <h2 className="text-base font-black text-slate-900">确认挂画档案</h2>
                <p className="text-xs font-bold text-slate-400">{profileConfirmed ? '档案已锁定，生成文案时将以此为准' : '核对并修改产品事实，确认后再生成'}</p>
              </div>
              {profileConfirmed && (
                <span className="flex items-center gap-1 rounded-full bg-emerald-100 px-2.5 py-1 text-xs font-bold text-emerald-700">
                  <CheckCircle2 className="size-3.5" /> 已确认
                </span>
              )}
            </div>

            {profileConfirmed ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className="rounded-2xl border border-emerald-200 bg-emerald-50/60 p-4"
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Check className="size-4 text-emerald-600" />
                  <span className="text-sm font-black text-slate-800">
                    {profileDraft.name || '挂画档案'} 已确认
                  </span>
                </div>
                {confirmedSummary && confirmedSummary.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {confirmedSummary.map((chip) => (
                      <span key={chip} className="rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600 ring-1 ring-emerald-100">
                        {chip}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleEditProfile}
                  className="mt-3 inline-flex h-8 items-center gap-1.5 rounded-full border border-emerald-200 bg-white px-3 text-xs font-bold text-emerald-700 transition-colors hover:bg-emerald-100/60"
                >
                  <PencilLine className="size-3.5" />
                  修改档案
                </button>
              </motion.div>
            ) : (
              <>
                <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {PROFILE_TEXT_FIELDS.map((field) => (
                    <label key={field.key} className={cn('block', field.rows && field.rows >= 2 && 'sm:col-span-2')}>
                      <span className="mb-1 block text-xs font-bold text-slate-600">{field.label}</span>
                      {field.rows ? (
                        <textarea
                          value={profileDraft[field.key]}
                          onChange={(event) => setProfileDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                          rows={field.rows}
                          className="w-full resize-y rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                        />
                      ) : (
                        <input
                          value={profileDraft[field.key]}
                          onChange={(event) => setProfileDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white/90 px-3 text-sm text-slate-800 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                        />
                      )}
                    </label>
                  ))}
                </div>

                <div className="mt-3 grid grid-cols-1 gap-3 sm:grid-cols-2">
                  {PROFILE_LIST_FIELDS.map((field) => (
                    <label key={field.key} className="block">
                      <span className="mb-1 block text-xs font-bold text-slate-600">{field.label}</span>
                      <textarea
                        value={profileDraft[field.key]}
                        onChange={(event) => setProfileDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                        rows={field.rows || 2}
                        className="w-full resize-y rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-violet-400 focus:ring-2 focus:ring-violet-100"
                      />
                    </label>
                  ))}
                </div>

                <div className="mt-5 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={handleConfirmProfile}
                    className="inline-flex h-11 items-center gap-2 rounded-full bg-gradient-to-r from-emerald-600 to-teal-600 px-6 text-sm font-bold text-white shadow-md shadow-emerald-500/20 transition-all hover:shadow-lg hover:shadow-emerald-500/30"
                  >
                    <Check className="size-4" />
                    确认档案并继续
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* Step 3：生成文案 */}
        <section ref={generateSectionRef} className="scroll-mt-20">
          <div className="mb-4 flex items-center gap-2.5 px-1">
            <span className="flex size-7 items-center justify-center rounded-lg bg-slate-900 text-sm font-black text-white">3</span>
            <div>
              <h2 className="text-base font-black text-slate-900">生成文案</h2>
              <p className="text-xs font-bold text-slate-400">原创口播 10 条 + 爆款文案仿写 3 版</p>
            </div>
          </div>

          {/* 功能一：AI 原创 10 条 */}
          <section className="glass-card mb-5 rounded-3xl p-5 md:p-6">
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-sm">
                  <PenLine className="size-4.5" />
                </span>
                <div>
                  <h3 className="text-base font-black text-slate-900">AI 原创 10 条口播文案</h3>
                  <p className="text-xs font-bold text-slate-400">7×350 字 + 3×250 字 · 6 稳定型 + 4 探索型</p>
                </div>
              </div>
              <button
                type="button"
                onClick={handleGenerateOriginal}
                disabled={generateDisabled}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {generating ? '生成中…' : originalItems.length ? '重新生成一批' : '生成 10 条'}
              </button>
            </div>

            {!profileConfirmed ? (
              <p className="rounded-xl bg-white/70 px-4 py-3 text-sm font-bold text-slate-400 ring-1 ring-slate-100">
                请先在上一步「确认档案」，再生成原创文案。
              </p>
            ) : generating ? (
              <div className="flex items-center justify-center gap-3 rounded-xl bg-white/70 px-4 py-8 text-sm font-bold text-slate-500 ring-1 ring-slate-100">
                <Loader2 className="size-5 animate-spin text-violet-500" />
                豆包正在创作 10 条文案，预计需要 1～3 分钟…
              </div>
            ) : originalItems.length > 0 ? (
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">共 {originalItems.length} 条 · 6 稳定型 + 4 探索型</span>
                  <button
                    type="button"
                    onClick={handleConfirmRegenerateBatch}
                    disabled={generating}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors',
                      confirmRegenerate
                        ? 'border-red-200 bg-red-50 text-red-600'
                        : 'border-slate-200 bg-white/70 text-slate-600 hover:bg-white'
                    )}
                  >
                    <RefreshCw className={cn('size-3.5', generating && 'animate-spin')} />
                    {confirmRegenerate ? '再次点击确认覆盖当前结果' : '一键重新生成一批'}
                  </button>
                </div>
                {originalItems.map((item, index) => (
                  <ResultCard
                    key={item.id}
                    index={index + 1}
                    badge={item.mode === 'stable' ? '稳定型' : '探索型'}
                    badgeClass={item.mode === 'stable' ? 'bg-emerald-50 text-emerald-600' : 'bg-violet-50 text-violet-600'}
                    direction={item.direction}
                    fullText={item.fullText}
                    wordCount={countCopyChars(item.fullText)}
                    isLiked={item.isLiked}
                    savedId={item.savedId}
                    onEditCommit={(newText) => handleEditOriginal(item.id, newText)}
                    onToggleLike={() => handleToggleLike('original', item.id)}
                    onSave={() => void handleSaveItem(item, 'original', item.id)}
                    onRegenerate={() => void handleRegenerateOne(item)}
                    regenerateBusy={regeneratingId === item.id}
                  />
                ))}
              </div>
            ) : (
              <p className="rounded-xl bg-white/70 px-4 py-3 text-sm font-bold text-slate-400 ring-1 ring-slate-100">
                点击「生成 10 条」开始创作。
              </p>
            )}
          </section>

          {/* 功能二：爆款仿写 */}
          <section className="glass-card mb-5 rounded-3xl p-5 md:p-6">
            <div className="mb-4 flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-fuchsia-500 to-pink-600 text-white shadow-sm">
                <FileText className="size-4.5" />
              </span>
              <div>
                <h3 className="text-base font-black text-slate-900">爆款文案仿写</h3>
                <p className="text-xs font-bold text-slate-400">分析原文 → 稳定保守 / 情绪强化 / 结构重组 3 版</p>
              </div>
            </div>

            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-600">粘贴一条已在短视频平台取得较好效果的原文</span>
              <textarea
                value={rewriteOriginalText}
                onChange={(event) => setRewriteOriginalText(event.target.value)}
                rows={5}
                placeholder="粘贴原文…"
                className="w-full resize-y rounded-xl border border-slate-200 bg-white/90 px-3 py-2.5 text-sm leading-relaxed text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-fuchsia-400 focus:ring-2 focus:ring-fuchsia-100"
              />
            </label>
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                onClick={() => void handleRewrite()}
                disabled={rewriteDisabled}
                className="inline-flex h-10 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-bold text-white transition-colors hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
              >
                {rewriting ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {rewriting ? '仿写中…' : '仿写 3 个版本'}
              </button>
            </div>

            {rewriteItems.length > 0 && (
              <div className="mt-4 space-y-3">
                {rewriteItems.map((item, index) => (
                  <ResultCard
                    key={index}
                    index={index + 1}
                    badge={item.version}
                    badgeClass="bg-fuchsia-50 text-fuchsia-600"
                    direction="仿写版本"
                    fullText={item.content}
                    wordCount={countCopyChars(item.content)}
                    isLiked={item.isLiked}
                    savedId={item.savedId}
                    onEditCommit={(newText) => handleEditRewrite(index, newText)}
                    onToggleLike={() => handleToggleLike('rewrite', index)}
                    onSave={() => void handleSaveItem({ version: item.version, direction: item.version, fullText: item.content, isLiked: item.isLiked }, 'rewrite', index)}
                  />
                ))}
              </div>
            )}
          </section>
        </section>

        {/* 文案库 */}
        <section className="glass-card mb-8 rounded-3xl p-5 md:p-6">
          <button
            type="button"
            onClick={() => setLibraryOpen((v) => !v)}
            className="flex w-full items-center justify-between"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-orange-500 to-rose-500 text-white shadow-sm">
                <BookOpenText className="size-4.5" />
              </span>
              <div className="text-left">
                <h3 className="text-base font-black text-slate-900">文案库</h3>
                <p className="text-xs font-bold text-slate-400">已保存文案，多设备同步</p>
              </div>
              <span className="rounded-full bg-white/80 px-2 py-0.5 text-xs font-bold text-slate-500 ring-1 ring-slate-200">{library.length}</span>
            </div>
            {libraryOpen ? <ChevronUp className="size-4 text-slate-400" /> : <ChevronDown className="size-4 text-slate-400" />}
          </button>

          {libraryOpen && (
            <div className="mt-4 space-y-3">
              {library.length === 0 && (
                <p className="rounded-xl bg-white/70 px-4 py-3 text-sm font-bold text-slate-400 ring-1 ring-slate-100">
                  还没有保存的文案。生成后点「存文案库」即可在这里查看，多设备同步。
                </p>
              )}
              {library.map((item) => (
                <div key={item.id} className="rounded-2xl border border-slate-200/80 bg-white/90 p-4">
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', item.type === 'original' ? (item.mode === 'explore' ? 'bg-violet-50 text-violet-600' : 'bg-emerald-50 text-emerald-600') : 'bg-fuchsia-50 text-fuchsia-600')}>
                        {item.type === 'original' ? (item.mode === 'explore' ? '探索型' : '稳定型') : item.version}
                      </span>
                      {item.direction && <span className="truncate text-xs font-bold text-slate-500">{item.direction}</span>}
                    </div>
                    <div className="flex shrink-0 items-center gap-1.5">
                      <button
                        type="button"
                        onClick={() => void handleToggleLibraryLike(item)}
                        className={cn('flex h-7 w-7 items-center justify-center rounded-lg border', item.isLiked ? 'border-amber-200 bg-amber-50 text-amber-500' : 'border-slate-200 text-slate-400')}
                        title="标记好"
                      >
                        <Star className={cn('size-3.5', item.isLiked && 'fill-current')} />
                      </button>
                      <button
                        type="button"
                        onClick={() => void handleDeleteLibraryItem(item.id)}
                        className="flex h-7 w-7 items-center justify-center rounded-lg border border-slate-200 text-slate-400 hover:text-red-500"
                        title="删除"
                      >
                        <Trash2 className="size-3.5" />
                      </button>
                    </div>
                  </div>
                  <p className="whitespace-pre-wrap text-sm leading-relaxed text-slate-700">{item.fullText}</p>
                  <div className="mt-2 flex items-center justify-between text-xs font-bold text-slate-400">
                    <span>{item.wordCount} 字</span>
                    <span>{formatHistoryTime(new Date(item.createdAt).getTime())}</span>
                  </div>
                </div>
              ))}
            </div>
          )}
        </section>
      </main>
    </div>
  );
}

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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
  compressImageToBlob,
  deletePainting,
  getPainting,
  listPaintings,
  savePainting,
  touchPainting,
  type SavedPaintingSummary,
} from '@/src/lib/paintingArchive';
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

function valueToText(value: unknown): string {
  if (typeof value === 'string') return value.trim();
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join('\n');
  if (value && typeof value === 'object') {
    return Object.values(value).map(valueToText).filter(Boolean).join('\n');
  }
  return '';
}

function valueToLines(value: unknown): string {
  if (Array.isArray(value)) return value.map(valueToText).filter(Boolean).join('\n');
  return valueToText(value);
}

function linesToArray(value: unknown): string[] {
  return valueToLines(value)
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
}

function profileToDraft(profile: CopyProfile): ProfileDraft {
  return {
    name: valueToText(profile.name),
    visualDescription: valueToText(profile.visualDescription),
    style: valueToText(profile.style),
    textCalligraphySeals: valueToText(profile.textCalligraphySeals),
    material: valueToText(profile.material),
    structure: valueToText(profile.structure),
    colors: valueToLines(profile.colors),
    suitableScenes: valueToLines(profile.suitableScenes),
    targetAudiences: valueToLines(profile.targetAudiences),
    meanings: valueToLines(profile.meanings),
    sellingPoints: valueToLines(profile.sellingPoints),
    uncertainClaims: valueToLines(profile.uncertainClaims),
  };
}

function draftToProfile(draft: ProfileDraft): CopyProfile {
  return {
    name: valueToText(draft.name),
    visualDescription: valueToText(draft.visualDescription),
    style: valueToText(draft.style),
    textCalligraphySeals: valueToText(draft.textCalligraphySeals),
    material: valueToText(draft.material),
    structure: valueToText(draft.structure),
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

// 平台统一风（slate 白卡 + violet 强调，对齐全站玻璃拟态视觉）
const UI = {
  card: 'border border-slate-300 bg-white',
  text: 'text-slate-900',
  sub: 'text-slate-500',
  accent: 'bg-violet-600 text-white hover:bg-violet-700',
  accentRing: 'border-violet-600',
  chip: 'bg-slate-100 text-slate-600',
};

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
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(fullText);
  const [copied, setCopied] = useState(false);

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
    <div className={cn('group rounded-2xl border p-5 transition-all', UI.card, 'hover:-translate-y-0.5 hover:shadow-md')}>
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <span className="flex size-6 shrink-0 items-center justify-center rounded-md bg-violet-600 text-xs font-black text-white">
            {index}
          </span>
          <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', badgeClass)}>{badge}</span>
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

      {direction && (
        <div className="mb-3 flex items-center gap-2 rounded-lg border border-violet-100 bg-violet-50 px-3 py-2">
          <span className="shrink-0 text-xs font-bold text-violet-500">文案分类</span>
          <span className="min-w-0 truncate text-sm font-black text-violet-800">{direction}</span>
        </div>
      )}

      {editing ? (
        <div>
          <textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            rows={9}
            className="w-full resize-y rounded-xl border border-slate-200 bg-white p-3 text-[15px] leading-relaxed text-slate-800 outline-none focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
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
              className={cn('h-8 rounded-full px-3 text-xs font-bold text-white hover:bg-slate-800', UI.accent)}
            >
              保存修改
            </button>
          </div>
        </div>
      ) : (
        <p className="whitespace-pre-wrap text-[15px] leading-relaxed text-slate-700" onDoubleClick={startEdit}>
          {fullText}
        </p>
      )}

      <div className="mt-3 flex flex-wrap items-center justify-between gap-2 border-t border-slate-100 pt-3">
        <span className="text-xs font-bold text-slate-400">共 {wordCount} 字</span>
        <div className="flex flex-wrap items-center gap-1.5">
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
            className={cn('flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50', 'border-slate-200')}
          >
            <Edit3 className="size-3.5" />
            编辑
          </button>
          {onRegenerate && (
            <button
              type="button"
              onClick={onRegenerate}
              disabled={regenerateBusy}
              className={cn('flex h-8 items-center gap-1 rounded-full border px-2.5 text-xs font-bold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60', 'border-slate-200')}
            >
              <RefreshCw className={cn('size-3.5', regenerateBusy && 'animate-spin')} />
              重生成
            </button>
          )}
          <button
            type="button"
            onClick={onSave}
            className={cn('flex h-8 items-center gap-1 rounded-full px-2.5 text-xs font-bold text-white hover:bg-slate-800', UI.accent)}
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
  const [rewriteOpen, setRewriteOpen] = useState(false);

  const [analyzing, setAnalyzing] = useState(false);
  const [generating, setGenerating] = useState(false);
  const [generateProgress, setGenerateProgress] = useState('');
  const [rewriting, setRewriting] = useState(false);
  const [regeneratingId, setRegeneratingId] = useState<string | null>(null);
  const [confirmRegenerate, setConfirmRegenerate] = useState(false);

  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  const [historyImages, setHistoryImages] = useState<Array<{ id: number; name: string; previewUrl: string }>>([]);
  const [historyOpen, setHistoryOpen] = useState(false);

  const [archiveItems, setArchiveItems] = useState<SavedPaintingSummary[]>([]);
  const [activePaintingId, setActivePaintingId] = useState<number | null>(null);
  const [archiveUnavailable, setArchiveUnavailable] = useState(false);
  /** 当前挂画的图片 blob 来源：新上传的 File 或从档案恢复的 Blob，确认档案时用于存档 */
  const currentImageBlobRef = useRef<Blob | null>(null);
  const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);

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
    let historyUrls: string[] = [];
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
        historyUrls = mapped.map((m) => m.previewUrl);
        setHistoryImages(mapped);
      } catch {
        // 历史图片读取失败不影响主流程
      }
    })();
    return () => {
      cancelled = true;
      historyUrls.forEach((url) => URL.revokeObjectURL(url));
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    let objectUrl = '';
    (async () => {
      try {
        const items = await listPaintings();
        if (cancelled) return;
        setArchiveItems(items);
        if (items.length === 0) return;
        const latest = await getPainting(items[0].id);
        if (!latest || cancelled) return;
        objectUrl = URL.createObjectURL(latest.imageBlob);
        currentImageBlobRef.current = latest.imageBlob;
        setActivePaintingId(latest.id);
        setProfile(latest.profile);
        setProfileDraft(profileToDraft(latest.profile));
        setProfileConfirmed(true);
        void fileToThumbnailDataUrl(new File([latest.imageBlob], 'painting.jpg', { type: latest.imageBlob.type }))
          .then((dataUrl) => {
            if (!cancelled) setImageThumb(dataUrl);
          })
          .catch(() => {});
        setPaintingPreviewUrl((prev) => {
          if (prev) URL.revokeObjectURL(prev);
          return objectUrl;
        });
        setExtraInfo(latest.extraInfo || '');
        setForbidden(latest.forbidden || '');
        void touchPainting(latest.id);
      } catch {
        if (!cancelled) setArchiveUnavailable(true);
      }
    })();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, []);

  const applyPaintingFile = useCallback((file: File | null) => {
    if (paintingPreviewUrl) URL.revokeObjectURL(paintingPreviewUrl);
    setPaintingFile(file);
    currentImageBlobRef.current = file;
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

  const refreshArchive = async () => {
    try {
      setArchiveItems(await listPaintings());
    } catch {
      setArchiveUnavailable(true);
    }
  };

  const handleSelectPainting = async (id: number) => {
    if (id === activePaintingId || generatingRef.current) return;
    try {
      const item = await getPainting(id);
      if (!item) return;
      if (paintingPreviewUrl) URL.revokeObjectURL(paintingPreviewUrl);
      const objectUrl = URL.createObjectURL(item.imageBlob);
      currentImageBlobRef.current = item.imageBlob;
      setActivePaintingId(item.id);
      setPaintingFile(null);
      setPaintingPreviewUrl(objectUrl);
      setProfile(item.profile);
      setProfileDraft(profileToDraft(item.profile));
      setProfileConfirmed(true);
      try {
        setImageThumb(await fileToThumbnailDataUrl(new File([item.imageBlob], 'painting.jpg', { type: item.imageBlob.type })));
      } catch {
        setImageThumb(null);
      }
      setName(item.name || '');
      setExtraInfo(item.extraInfo || '');
      setForbidden(item.forbidden || '');
      setOriginalItems([]);
      setRewriteItems([]);
      setError('');
      void touchPainting(item.id).then(refreshArchive);
    } catch {
      setError('读取本机档案失败，请重试。');
    }
  };

  const handleDeletePainting = async (id: number) => {
    try {
      await deletePainting(id);
      const items = await listPaintings();
      setArchiveItems(items);
      if (id === activePaintingId) {
        if (items.length > 0) {
          await handleSelectPainting(items[0].id);
        } else {
          handleFileChange(null);
          setActivePaintingId(null);
        }
      }
      setNotice('已删除本机档案');
      window.setTimeout(() => setNotice(''), 2200);
    } catch {
      setError('删除本机档案失败');
    }
  };

  const handleNewPainting = () => {
    handleFileChange(null);
    setActivePaintingId(null);
    setName('');
    setExtraInfo('');
    setForbidden('');
    setSellingPoints('');
    setOriginalItems([]);
    setRewriteItems([]);
    setRewriteOriginalText('');
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
      // 分析成功即自动存档到本机：重进页面可直接恢复并点选，无需先手动确认
      const archiveName = name.trim() || valueToText(result.name) || valueToText(result.visualDescription).slice(0, 12) || '未命名挂画';
      void (async () => {
        try {
          const blob = currentImageBlobRef.current
            ? await compressImageToBlob(currentImageBlobRef.current).catch(() => currentImageBlobRef.current as Blob)
            : null;
          if (!blob) return;
          const saved = await savePainting({
            name: archiveName,
            imageBlob: blob,
            profile: result,
            extraInfo,
            forbidden,
          });
          setActivePaintingId(saved.id);
          setArchiveItems(await listPaintings());
        } catch {
          setArchiveUnavailable(true);
        }
      })();
      try {
        setImageThumb(await fileToThumbnailDataUrl(paintingFile));
      } catch {
        setImageThumb(null);
      }
      void saveUploadHistory(paintingFile, 'image');
    } catch (err) {
      setError(err instanceof Error ? err.message : '挂画分析失败');
    } finally {
      analyzingRef.current = false;
      setAnalyzing(false);
    }
  };

  const handleConfirmProfile = () => {
    try {
      const next = draftToProfile(profileDraft);
      if (!next.name && !next.visualDescription) {
        setError('档案缺少挂画名称和画面内容，请至少补充一项后再继续。');
        return;
      }
      const paintingIdToSave = activePaintingId;
      void (async () => {
        try {
          const blob = currentImageBlobRef.current
            ? await compressImageToBlob(currentImageBlobRef.current).catch(() => currentImageBlobRef.current as Blob)
            : null;
          if (!blob) return;
          const saved = await savePainting({
            id: paintingIdToSave ?? undefined,
            name: next.name || next.visualDescription?.slice(0, 12) || '未命名挂画',
            imageBlob: blob,
            profile: next,
            extraInfo,
            forbidden,
          });
          setActivePaintingId(saved.id);
          setArchiveItems(await listPaintings());
        } catch {
          setArchiveUnavailable(true);
        }
      })();
      setProfile(next);
      setProfileDraft(profileToDraft(next));
      setProfileConfirmed(true);
      setError('');
      setNotice('挂画档案已确认，可以开始生成文案了');
      window.setTimeout(() => setNotice(''), 3200);
    } catch (err) {
      setError(err instanceof Error ? `档案确认失败：${err.message}` : '档案确认失败，请检查档案内容后重试。');
    }
  };

  const handleEditProfile = () => {
    setProfileConfirmed(false);
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
    setGenerateProgress('');
    setError('');
    try {
      const copies = await generateOriginalCopies(profile, {
        extraInfo,
        forbidden,
        onProgress: (completed, total) => setGenerateProgress(`${completed}/${total}`),
      });
      setOriginalItems(copies.map((c) => ({ ...c, isLiked: false, savedId: null })));
    } catch (err) {
      setError(err instanceof Error ? err.message : '原创文案生成失败');
    } finally {
      generatingRef.current = false;
      setGenerating(false);
      setGenerateProgress('');
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
  const view = !profile ? 'setup' : !profileConfirmed ? 'profile' : 'workspace';
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

      <main className={cn('mx-auto w-full max-w-[80rem] flex-1 px-4 py-6 md:px-6')}>
        {/* Hero */}
        <motion.div
          initial={{ opacity: 0, y: 16 }}
          animate={{ opacity: 1, y: 0 }}
          className="mb-4 flex items-center justify-between gap-4"
        >
          <div className="flex items-center gap-3">
            <div className="flex size-10 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm">
              <FileText className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-black text-slate-900">文案创作</h1>
              <p className="mt-0.5 text-xs font-bold text-slate-500">挂画识别、原创口播与爆款仿写</p>
            </div>
          </div>
        </motion.div>

        {/* 移动端档案横条（<lg） */}
        <div className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
          {archiveItems.map((p) => (
            <button key={p.id} type="button" onClick={() => void handleSelectPainting(p.id)}
              className={cn('shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold',
                p.id === activePaintingId ? cn('border-[1.5px]', UI.accentRing, UI.text, 'bg-white') : cn(UI.card, UI.sub))}>
              {p.name}
            </button>
          ))}
          <button type="button" onClick={handleNewPainting}
            className={cn('shrink-0 rounded-lg border border-dashed border-slate-200 px-3 py-1.5 text-xs font-bold', UI.sub)}>
            ＋ 新挂画
          </button>
        </div>

        <div className="flex gap-5">
          {/* 左侧档案栏（≥lg） */}
          <aside className="hidden w-64 shrink-0 lg:flex lg:flex-col">
            <div className={cn('rounded-2xl border p-3', UI.card)}>
              <div className={cn('mb-2.5 text-sm font-black tracking-widest', UI.text)}>本机挂画档案</div>
              <div className="flex flex-col gap-1.5">
                {archiveUnavailable && (
                  <p className={cn('text-[11px] font-bold', UI.sub)}>本机存储不可用，档案不会保留</p>
                )}
                {!archiveUnavailable && archiveItems.length === 0 && (
                  <p className={cn('text-[11px] font-bold', UI.sub)}>还没有档案，分析并确认第一张挂画后会自动保存</p>
                )}
                {archiveItems.map((p) => (
                  <div key={p.id}
                    className={cn('group flex items-center gap-2 rounded-2xl border px-2 py-1.5 transition-colors',
                      p.id === activePaintingId ? cn('border-[1.5px]', UI.accentRing) : 'border-transparent hover:bg-slate-100')}>
                    <button type="button" onClick={() => void handleSelectPainting(p.id)}
                      className={cn('min-w-0 flex-1 truncate text-left text-xs font-bold', p.id === activePaintingId ? UI.text : UI.sub)}>
                      {p.name}
                    </button>
                    {confirmDeleteId === p.id ? (
                      <span className="flex shrink-0 items-center gap-1">
                        <button type="button" onClick={() => void handleDeletePainting(p.id)} className="text-[10px] font-bold text-red-600">删</button>
                        <button type="button" onClick={() => setConfirmDeleteId(null)} className={cn('text-[10px] font-bold', UI.sub)}>取消</button>
                      </span>
                    ) : (
                      <button type="button" onClick={() => setConfirmDeleteId(p.id)}
                        className="hidden shrink-0 text-slate-400 hover:text-red-500 group-hover:block" title="删除档案">
                        <Trash2 className="size-3.5" />
                      </button>
                    )}
                  </div>
                ))}
              </div>
              <button type="button" onClick={handleNewPainting}
                className={cn('mt-3 rounded-lg border border-dashed border-slate-200 py-1.5 text-xs font-bold', UI.sub, 'hover:border-violet-600 hover:text-violet-600')}>
                ＋ 新挂画
              </button>
            </div>
          </aside>

          {/* 右侧工作区 */}
          <div className="min-w-0 flex-1">

        {/* Notice / Error */}
        {notice && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex items-center gap-2 rounded-lg border border-emerald-300 bg-emerald-50 px-4 py-3 text-sm font-bold text-emerald-700"
          >
            <CheckCircle2 className="size-4 shrink-0" />
            <span>{notice}</span>
          </motion.div>
        )}
        {error && (
          <motion.div
            initial={{ opacity: 0, y: -8 }}
            animate={{ opacity: 1, y: 0 }}
            className="mb-4 flex items-start gap-2 rounded-lg border border-red-300 bg-red-50 px-4 py-3 text-sm font-bold text-red-600"
          >
            <X className="mt-0.5 size-4 shrink-0" />
            <span>{error}</span>
          </motion.div>
        )}

        {/* setup 视图 */}
        {view === 'setup' && (
          <>
            <section className={cn('mb-5 rounded-2xl border p-5 shadow-sm md:p-6', UI.card)}>
              <div className="mb-4 flex items-center gap-2.5">
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
                  'group flex h-44 w-44 flex-col items-center justify-center gap-2.5 rounded-lg border-2 border-dashed text-center transition-all',
                  paintingPreviewUrl
                    ? 'border-violet-600 bg-white p-1'
                    : 'border-slate-200 bg-white/60 hover:-translate-y-0.5 hover:border-violet-600 hover:bg-white hover:shadow-md'
                )}
              >
                {paintingPreviewUrl ? (
                  <img src={paintingPreviewUrl} alt="挂画预览" className="h-full w-full rounded-xl object-contain" />
                ) : (
                  <>
                    <span className="flex size-12 items-center justify-center rounded-lg bg-slate-900 text-white shadow-sm transition-transform group-hover:scale-105">
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
                className={cn('flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white/70 px-3 text-xs font-bold text-slate-600 transition-colors hover:bg-white')}
              >
                <History className="size-3.5" />
                历史图片
              </button>
              {historyOpen && historyImages.length > 0 && (
                <div className={cn('flex max-h-40 w-44 flex-wrap gap-1.5 overflow-y-auto rounded-xl border border-slate-200 bg-white/80 p-2')}>
                  {historyImages.map((img) => (
                    <button
                      key={img.id}
                      type="button"
                      onClick={() => void handlePickHistory(img.id)}
                      className="h-14 w-14 overflow-hidden rounded-lg border border-slate-200 bg-white transition-colors hover:border-violet-600"
                      title={img.name}
                    >
                      <img src={img.previewUrl} alt={img.name} className="h-full w-full object-cover" />
                    </button>
                  ))}
                </div>
              )}
              {historyOpen && historyImages.length === 0 && (
                <div className={cn('w-44 rounded-xl border border-slate-200 bg-white/80 p-3 text-center text-[11px] font-bold text-slate-400')}>
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
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white/90 px-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-xs font-bold text-slate-600">核心寓意或卖点（可选）</span>
                <input
                  value={sellingPoints}
                  onChange={(event) => setSellingPoints(event.target.value)}
                  placeholder="例如：家和万事兴、适合乔迁送礼"
                  className="h-10 w-full rounded-xl border border-slate-200 bg-white/90 px-3 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-bold text-slate-600">补充产品信息（可选）</span>
                <textarea
                  value={extraInfo}
                  onChange={(event) => setExtraInfo(event.target.value)}
                  rows={2}
                  placeholder="材质、尺寸、工艺、销售场景等补充说明"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
              <label className="block sm:col-span-2">
                <span className="mb-1 block text-xs font-bold text-slate-600">禁止出现的内容（可选）</span>
                <textarea
                  value={forbidden}
                  onChange={(event) => setForbidden(event.target.value)}
                  rows={2}
                  placeholder="例如：不得出现风水、招财、治病等夸大表述"
                  className="w-full resize-none rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                />
              </label>
            </div>
          </div>

          <div className="mt-5 flex items-center justify-end">
            <button
              type="button"
              onClick={() => void handleAnalyze()}
              disabled={!paintingFile || analyzing}
              className={cn('inline-flex h-11 items-center gap-2 rounded-lg px-6 text-sm font-bold shadow-sm transition-colors disabled:cursor-not-allowed disabled:opacity-60', UI.accent)}
            >
              {analyzing ? <Loader2 className="size-4 animate-spin" /> : <Wand2 className="size-4" />}
              {analyzing ? '豆包分析中…' : '分析产品'}
            </button>
          </div>
        </section>
          </>
        )}

        {/* profile 视图 */}
        {view === 'profile' && (
          <section className={cn('mb-5 rounded-2xl border p-5 shadow-sm md:p-6', UI.card)}>
            <div className="mb-4 flex flex-wrap items-center gap-2.5">
              <div className="mr-auto">
                <h2 className="text-base font-black text-slate-900">确认挂画档案</h2>
                <p className="text-xs font-bold text-slate-400">{profileConfirmed ? '档案已锁定，生成文案时将以此为准' : '核对并修改产品事实，确认后再生成'}</p>
              </div>
              {profileConfirmed && (
                <span className={cn('flex items-center gap-1 rounded-full px-2.5 py-1 text-xs font-bold', UI.chip)}>
                  <CheckCircle2 className="size-3.5" /> 已确认
                </span>
              )}
            </div>

            {profileConfirmed ? (
              <motion.div
                initial={{ opacity: 0, y: 10 }}
                animate={{ opacity: 1, y: 0 }}
                className={cn('rounded-lg border bg-slate-100 p-4', UI.accentRing)}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Check className={cn('size-4', UI.accent)} />
                  <span className="text-sm font-black text-slate-800">
                    {profileDraft.name || '挂画档案'} 已确认
                  </span>
                </div>
                {confirmedSummary && confirmedSummary.length > 0 && (
                  <div className="mt-2.5 flex flex-wrap gap-1.5">
                    {confirmedSummary.map((chip) => (
                      <span key={chip} className={cn('rounded-full bg-white px-2.5 py-1 text-xs font-bold text-slate-600 ring-1 ring-slate-200')}>
                        {chip}
                      </span>
                    ))}
                  </div>
                )}
                <button
                  type="button"
                  onClick={handleEditProfile}
                  className={cn('mt-3 inline-flex h-8 items-center gap-1.5 rounded-full border border-slate-200 bg-white px-3 text-xs font-bold transition-colors hover:bg-slate-100', UI.text)}
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
                          className="w-full resize-y rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                        />
                      ) : (
                        <input
                          value={profileDraft[field.key]}
                          onChange={(event) => setProfileDraft((prev) => ({ ...prev, [field.key]: event.target.value }))}
                          className="h-10 w-full rounded-xl border border-slate-200 bg-white/90 px-3 text-sm text-slate-800 outline-none transition-colors focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
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
                        className="w-full resize-y rounded-xl border border-slate-200 bg-white/90 px-3 py-2 text-sm text-slate-800 outline-none transition-colors focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
                      />
                    </label>
                  ))}
                </div>

                <div className="mt-5 flex items-center justify-end">
                  <button
                    type="button"
                    onClick={handleConfirmProfile}
                    className={cn('inline-flex h-11 items-center gap-2 rounded-lg px-6 text-sm font-bold shadow-sm transition-colors', UI.accent)}
                  >
                    <Check className="size-4" />
                    确认档案并继续
                  </button>
                </div>
              </>
            )}
          </section>
        )}

        {/* workspace 视图 */}
        {view === 'workspace' && (
          <>
            {/* 当前挂画条 */}
            <div className={cn('mb-4 flex items-center gap-3 rounded-2xl border p-3', UI.card)}>
              {paintingPreviewUrl && <img src={paintingPreviewUrl} alt={profileDraft.name} className="h-16 w-12 rounded-sm object-cover" />}
              <div className="min-w-0 flex-1">
                <div className={cn('truncate text-sm font-black', UI.text)}>{profileDraft.name || '挂画档案'}</div>
                <div className={cn('mt-1 flex flex-wrap gap-1.5')}>
                  {(confirmedSummary || []).map((chip) => (
                    <span key={chip} className={cn('rounded px-2 py-0.5 text-[11px] font-bold', UI.chip)}>{chip}</span>
                  ))}
                </div>
              </div>
              <button type="button" onClick={handleEditProfile}
                className={cn('shrink-0 rounded-lg border px-3 py-1.5 text-xs font-bold', UI.card, UI.text, 'hover:border-violet-600')}>
                编辑档案
              </button>
            </div>

          {/* 功能一：AI 原创 10 条 */}
          <section className={cn('mb-5 rounded-2xl border p-5 shadow-sm md:p-6', UI.card)}>
            <div className="mb-4 flex flex-wrap items-center justify-between gap-2">
              <div className="flex items-center gap-2.5">
                <span className="flex size-9 items-center justify-center rounded-lg bg-violet-600 text-white shadow-sm">
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
                className={cn('inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60', UI.accent)}
              >
                {generating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                {generating ? (generateProgress ? `生成中… ${generateProgress}` : '生成中…') : originalItems.length ? '重新生成一批' : '生成 10 条'}
              </button>
            </div>

            {!profileConfirmed ? (
              <p className={cn('rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500', 'ring-1 ring-slate-200')}>
                请先在上一步「确认档案」，再生成原创文案。
              </p>
            ) : generating ? (
              <div className={cn('flex items-center justify-center gap-3 rounded-xl bg-slate-50 px-4 py-8 text-sm font-bold text-slate-500', 'ring-1 ring-slate-200')}>
                <Loader2 className="size-5 animate-spin text-violet-600" />
                豆包正在创作 10 条文案，预计需要 1～3 分钟…
              </div>
            ) : originalItems.length > 0 ? (
              <div className="grid grid-cols-1 gap-3">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-slate-500">
                    共 {originalItems.length} 条 · {originalItems.filter((item) => item.mode === 'stable').length} 稳定型 + {originalItems.filter((item) => item.mode === 'explore').length} 探索型
                  </span>
                  <button
                    type="button"
                    onClick={handleConfirmRegenerateBatch}
                    disabled={generating}
                    className={cn(
                      'flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-bold transition-colors',
                      confirmRegenerate
                        ? 'border-red-200 bg-red-50 text-red-600'
                        : cn('border-slate-200 bg-white/70 text-slate-600 hover:bg-white')
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
                    badgeClass={item.mode === 'stable' ? UI.chip : 'bg-violet-50 text-violet-600'}
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
              <p className={cn('rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500', 'ring-1 ring-slate-200')}>
                点击「生成 10 条」开始创作。
              </p>
            )}
          </section>

          {/* 功能二：爆款仿写 */}
          <div className={cn('mb-4 rounded-2xl border', UI.card)}>
            <button type="button" onClick={() => setRewriteOpen((v) => !v)} className="flex w-full items-center justify-between p-4">
              <span className={cn('text-sm font-black', UI.text)}>爆款文案仿写 <span className={cn('ml-1 text-xs font-bold', UI.sub)}>分析原文 → 3 个版本</span></span>
              {rewriteOpen ? <ChevronUp className="size-4 text-slate-500" /> : <ChevronDown className="size-4 text-slate-500" />}
            </button>
            {rewriteOpen && (
              <div className="border-t border-slate-200 p-4">

            <label className="block">
              <span className="mb-1 block text-xs font-bold text-slate-600">粘贴一条已在短视频平台取得较好效果的原文</span>
              <textarea
                value={rewriteOriginalText}
                onChange={(event) => setRewriteOriginalText(event.target.value)}
                rows={5}
                placeholder="粘贴原文…"
                className="w-full resize-y rounded-xl border border-slate-200 bg-white/90 px-3 py-2.5 text-sm leading-relaxed text-slate-800 outline-none transition-colors placeholder:text-slate-400 focus:border-violet-300 focus:ring-2 focus:ring-violet-100"
              />
            </label>
            <div className="mt-3 flex items-center justify-end">
              <button
                type="button"
                onClick={() => void handleRewrite()}
                disabled={rewriteDisabled}
                className={cn('inline-flex h-10 items-center gap-2 rounded-full px-5 text-sm font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60', UI.accent)}
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
                    badgeClass="bg-violet-50 text-violet-600"
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
              </div>
            )}
          </div>

        {/* 文案库 */}
        <div className={cn('mb-4 rounded-2xl border', UI.card)}>
          <button
            type="button"
            onClick={() => setLibraryOpen((v) => !v)}
            className="flex w-full items-center justify-between p-4"
          >
            <div className="flex items-center gap-2.5">
              <span className="flex size-9 items-center justify-center rounded-lg bg-amber-600 text-white shadow-sm">
                <BookOpenText className="size-4.5" />
              </span>
              <div className="text-left">
                <h3 className="text-base font-black text-slate-900">文案库</h3>
                <p className="text-xs font-bold text-slate-400">已保存文案，多设备同步</p>
              </div>
              <span className={cn('rounded-full px-2 py-0.5 text-xs font-bold ring-1 ring-slate-200', UI.chip)}>{library.length}</span>
            </div>
            {libraryOpen ? <ChevronUp className="size-4 text-slate-400" /> : <ChevronDown className="size-4 text-slate-400" />}
          </button>

          {libraryOpen && (
            <div className="border-t border-slate-200 p-4">
              {library.length === 0 && (
                <p className={cn('rounded-xl bg-slate-50 px-4 py-3 text-sm font-bold text-slate-500', 'ring-1 ring-slate-200')}>
                  还没有保存的文案。生成后点「存文案库」即可在这里查看，多设备同步。
                </p>
              )}
              {library.map((item) => (
                <div key={item.id} className={cn('rounded-lg border p-4', UI.card)}>
                  <div className="mb-2 flex items-center justify-between gap-2">
                    <div className="flex min-w-0 items-center gap-2">
                      <span className={cn('shrink-0 rounded-full px-2 py-0.5 text-[11px] font-bold', item.type === 'original' ? (item.mode === 'explore' ? 'bg-violet-50 text-violet-600' : UI.chip) : 'bg-violet-50 text-violet-600')}>
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
        </div>
          </>
        )}
          </div>
        </div>
      </main>
    </div>
  );
}

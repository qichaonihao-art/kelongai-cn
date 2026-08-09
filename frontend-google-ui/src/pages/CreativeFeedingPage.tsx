import { useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowLeft,
  BookOpenText,
  CheckSquare,
  Copy,
  Edit3,
  ImagePlus,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Save,
  Settings2,
  Sparkles,
  TrendingUp,
  Trash2,
  X,
} from "lucide-react";
import ModuleQuickNav, { type ModuleId } from "@/src/components/ModuleQuickNav";
import { cn } from "@/src/lib/utils";
import {
  analyzeCreativePainting,
  createCreativeOpening,
  deleteCreativeOpening,
  fetchCreativeFeedingSettings,
  fetchCreativeOpenings,
  generateCreativeOpenings,
  saveCreativeFeedingSettings,
  updateCreativeOpening,
  type CreativeFeedingSettings,
  type CreativeGenerateResult,
  type CreativeOpening,
} from "@/src/lib/creativeFeeding";

interface CreativeFeedingPageProps {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
}

const emptyOpeningDraft = {
  openingText: '',
  paintingName: '',
  scene: '',
  hookType: '',
  platform: '抖音',
  videoUrl: '',
  performanceNote: '',
  reasonAnalysis: '',
  tags: '',
};

const emptyGenerateDraft = {
  paintingName: '',
  scene: '',
  sellingPoint: '',
  extraRequirement: '',
  count: 10,
};

const settingLabels: Array<{ key: keyof CreativeFeedingSettings; label: string; rows: number }> = [
  { key: 'businessBackground', label: '业务背景', rows: 3 },
  { key: 'targetAudience', label: '目标人群', rows: 3 },
  { key: 'productFeatures', label: '产品特点', rows: 3 },
  { key: 'stylePreference', label: '文案风格偏好', rows: 3 },
  { key: 'conversionDirections', label: '高转化方向', rows: 3 },
  { key: 'forbiddenExpressions', label: '禁忌表达', rows: 3 },
  { key: 'openingRules', label: '开头生成规则', rows: 3 },
  { key: 'outputFormat', label: '输出格式要求', rows: 3 },
];

function formatDate(value: string) {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value.slice(0, 10);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function openingToDraft(opening: CreativeOpening) {
  const fallbackVideoUrl = getOpeningVideoUrl(opening);
  return {
    openingText: opening.openingText || '',
    paintingName: opening.paintingName || '',
    scene: '',
    hookType: '',
    platform: opening.platform || '抖音',
    videoUrl: fallbackVideoUrl,
    performanceNote: opening.performanceNote || '',
    reasonAnalysis: '',
    tags: (opening.tags || []).filter((tag) => tag !== fallbackVideoUrl && !isUrlLike(tag)).join('，'),
  };
}

function draftToPayload(draft: typeof emptyOpeningDraft) {
  return {
    ...draft,
    videoUrl: normalizeVideoUrl(draft.videoUrl),
    tags: draft.tags
      .split(/[,，、\n]/g)
      .map((item) => item.trim())
      .filter((item) => !isUrlLike(item))
      .filter(Boolean),
  };
}

function extractLikeScore(note: string) {
  const text = String(note || '').toLowerCase();
  const candidates = [...text.matchAll(/(\d+(?:\.\d+)?)\s*(万|w|k|千)?\s*(?:点赞|赞|like|likes)?/g)]
    .map((match) => {
      const value = Number(match[1]);
      if (!Number.isFinite(value)) return 0;
      const unit = match[2] || '';
      if (unit === '万' || unit === 'w') return value * 10000;
      if (unit === '千' || unit === 'k') return value * 1000;
      return value;
    })
    .filter((value) => value > 0);
  return candidates.length ? Math.max(...candidates) : 0;
}

function countOpeningChars(text: string) {
  return Array.from(String(text || '').replace(/\s/g, '')).length;
}

function escapeRegExp(value: string) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function renderSearchHighlight(text: string, keyword: string) {
  const source = String(text || '');
  const terms = String(keyword || '')
    .trim()
    .split(/\s+/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  if (!source || terms.length === 0) return source;

  const pattern = new RegExp(`(${terms.map(escapeRegExp).join('|')})`, 'gi');
  return source.split(pattern).map((part, index) => {
    if (!part) return null;
    const matched = terms.some((term) => part.toLowerCase() === term.toLowerCase());
    return matched ? (
      <mark key={`${part}-${index}`} className="rounded-md bg-red-100 px-1 font-black text-red-700 shadow-[0_0_14px_rgba(239,68,68,0.45)] ring-1 ring-red-200/80">
        {part}
      </mark>
    ) : (
      part
    );
  });
}

function isUrlLike(value: string) {
  return /^https?:\/\/\S+/i.test(String(value || '').trim());
}

function normalizeVideoUrl(value: string) {
  const trimmed = String(value || '').trim();
  if (!trimmed) return '';
  if (/^https?:\/\//i.test(trimmed)) return trimmed;
  if (/^[\w.-]+\.[a-z]{2,}(?:\/\S*)?$/i.test(trimmed)) return `https://${trimmed}`;
  return trimmed;
}

function getOpeningVideoUrl(opening: CreativeOpening) {
  const direct = normalizeVideoUrl(opening.videoUrl || '');
  if (direct) return direct;
  const tagUrl = (opening.tags || []).find((tag) => isUrlLike(tag));
  return tagUrl ? normalizeVideoUrl(tagUrl) : '';
}

export default function CreativeFeedingPage({ onBack, onNavigate }: CreativeFeedingPageProps) {
  const [activeTab, setActiveTab] = useState<'library' | 'generate'>('library');
  const [openings, setOpenings] = useState<CreativeOpening[]>([]);
  const [settings, setSettings] = useState<CreativeFeedingSettings | null>(null);
  const [settingsDraft, setSettingsDraft] = useState<CreativeFeedingSettings | null>(null);
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);
  const [isSavingSettings, setIsSavingSettings] = useState(false);
  const [error, setError] = useState('');
  const [query, setQuery] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [sortByLikes, setSortByLikes] = useState(false);
  const [openingDraft, setOpeningDraft] = useState(emptyOpeningDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [isOpeningFormCollapsed, setIsOpeningFormCollapsed] = useState(true);
  const [detailOpening, setDetailOpening] = useState<CreativeOpening | null>(null);
  const [detailCopyStatus, setDetailCopyStatus] = useState<'idle' | 'done' | 'error'>('idle');
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [generateDraft, setGenerateDraft] = useState(emptyGenerateDraft);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAnswer, setGeneratedAnswer] = useState('');
  const [generatedResults, setGeneratedResults] = useState<CreativeGenerateResult[]>([]);
  const [generateMeta, setGenerateMeta] = useState<{
    model: string;
    referenceCount: number;
    referenceMode: 'manual' | 'smart';
    stableCount: number;
    exploreCount: number;
  } | null>(null);
  const [paintingImage, setPaintingImage] = useState<{ name: string; dataUrl: string } | null>(null);
  const [imageAnalysis, setImageAnalysis] = useState('');
  const [isAnalyzingImage, setIsAnalyzingImage] = useState(false);
  const [savedGeneratedIndexes, setSavedGeneratedIndexes] = useState<number[]>([]);
  const [copiedGeneratedIndex, setCopiedGeneratedIndex] = useState<number | null>(null);
  const paintingImageInputRef = useRef<HTMLInputElement>(null);
  const paintingAnalysisRequestRef = useRef(0);

  const tags = useMemo(
    () => Array.from(new Set(openings.flatMap((item) => item.tags || []).filter((tag) => tag && !isUrlLike(tag)))),
    [openings]
  );
  const displayedOpenings = useMemo(() => {
    if (!sortByLikes) return openings;
    return [...openings].sort((a, b) => {
      const scoreDelta = extractLikeScore(b.performanceNote) - extractLikeScore(a.performanceNote);
      if (scoreDelta !== 0) return scoreDelta;
      return String(b.createdAt).localeCompare(String(a.createdAt));
    });
  }, [openings, sortByLikes]);

  async function loadData(filters = { q: query, tag: tagFilter }) {
    setIsLoading(true);
    setError('');
    try {
      const [nextSettings, nextOpenings] = await Promise.all([
        fetchCreativeFeedingSettings(),
        fetchCreativeOpenings(filters),
      ]);
      setSettings(nextSettings);
      setSettingsDraft(nextSettings);
      setOpenings(nextOpenings);
    } catch (err) {
      setError(err instanceof Error ? err.message : '读取创意喂养数据失败');
    } finally {
      setIsLoading(false);
    }
  }

  useEffect(() => {
    void loadData({ q: '', tag: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData({ q: query, tag: tagFilter });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, tagFilter]);

  useEffect(() => {
    setDetailCopyStatus('idle');
  }, [detailOpening?.id]);

  function resetOpeningForm(shouldCollapse = true) {
    setOpeningDraft(emptyOpeningDraft);
    setEditingId(null);
    if (shouldCollapse) setIsOpeningFormCollapsed(true);
  }

  async function saveOpening() {
    if (!openingDraft.openingText.trim()) {
      setError('开头文案不能为空');
      return;
    }
    setError('');
    try {
      if (editingId) {
        await updateCreativeOpening(editingId, draftToPayload(openingDraft));
      } else {
        await createCreativeOpening(draftToPayload(openingDraft));
      }
      resetOpeningForm(true);
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存爆款开头失败');
    }
  }

  async function removeOpening(id: string) {
    if (!window.confirm('确定删除这条爆款开头吗？')) return;
    setError('');
    try {
      await deleteCreativeOpening(id);
      setSelectedReferenceIds((previous) => previous.filter((item) => item !== id));
      await loadData();
    } catch (err) {
      setError(err instanceof Error ? err.message : '删除爆款开头失败');
    }
  }

  async function copyDetailOpeningText() {
    if (!detailOpening?.openingText) return;

    try {
      await navigator.clipboard.writeText(detailOpening.openingText);
      setDetailCopyStatus('done');
      window.setTimeout(() => setDetailCopyStatus('idle'), 1600);
    } catch {
      setDetailCopyStatus('error');
      window.setTimeout(() => setDetailCopyStatus('idle'), 2200);
    }
  }

  async function saveSettings() {
    if (!settingsDraft) return;
    setIsSavingSettings(true);
    setError('');
    try {
      const saved = await saveCreativeFeedingSettings(settingsDraft);
      setSettings(saved);
      setSettingsDraft(saved);
      setIsSettingsOpen(false);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存业务设定失败');
    } finally {
      setIsSavingSettings(false);
    }
  }

  async function handleGenerate(regenerate = false) {
    if (isAnalyzingImage) {
      setError('图片仍在分析中，请等待识别完成后再生成文案');
      return;
    }
    if (paintingImage && !imageAnalysis.trim()) {
      setError('图片尚未获得可用的识别结果，请重新识别或手动填写图片分析');
      return;
    }
    const previousBatch = regenerate
      ? generatedResults.map((item) => item.openingText).filter(Boolean)
      : [];
    setIsGenerating(true);
    setError('');
    setGeneratedAnswer('');
    setGeneratedResults([]);
    setGenerateMeta(null);
    setSavedGeneratedIndexes([]);
    setCopiedGeneratedIndex(null);
    try {
      const response = await generateCreativeOpenings({
        ...generateDraft,
        imageDataUrl: paintingImage?.dataUrl,
        imageAnalysis,
        count: Math.min(30, Math.max(1, Number(generateDraft.count) || 10)),
        referenceLimit: 12,
        referenceIds: selectedReferenceIds,
        excludeOpenings: previousBatch,
      });
      setGeneratedAnswer(response.answer);
      setGeneratedResults(response.results || []);
      setGenerateMeta({
        model: response.model,
        referenceCount: response.referenceCount,
        referenceMode: response.referenceMode,
        stableCount: response.stableCount,
        exploreCount: response.exploreCount,
      });
    } catch (err) {
      setError(err instanceof Error ? err.message : '文案仿写生成失败');
    } finally {
      setIsGenerating(false);
    }
  }

  async function analyzePaintingImage(dataUrl = paintingImage?.dataUrl || '') {
    if (!dataUrl) return;
    const requestId = paintingAnalysisRequestRef.current + 1;
    paintingAnalysisRequestRef.current = requestId;
    setIsAnalyzingImage(true);
    setError('');
    try {
      const response = await analyzeCreativePainting(dataUrl);
      if (paintingAnalysisRequestRef.current !== requestId) return;
      setImageAnalysis(response.analysis || '');
    } catch (err) {
      if (paintingAnalysisRequestRef.current !== requestId) return;
      setError(err instanceof Error ? err.message : '画作图片识别失败');
    } finally {
      if (paintingAnalysisRequestRef.current === requestId) setIsAnalyzingImage(false);
    }
  }

  function handlePaintingImageChange(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (!file.type.startsWith('image/')) {
      setError('请选择图片文件');
      return;
    }
    if (file.size > 10 * 1024 * 1024) {
      setError('画作图片不能超过 10MB');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      const dataUrl = typeof reader.result === 'string' ? reader.result : '';
      if (!dataUrl) return;
      setPaintingImage({ name: file.name, dataUrl });
      setImageAnalysis('');
      void analyzePaintingImage(dataUrl);
    };
    reader.onerror = () => setError('读取图片失败，请重新选择');
    reader.readAsDataURL(file);
  }

  function removePaintingImage() {
    paintingAnalysisRequestRef.current += 1;
    setPaintingImage(null);
    setImageAnalysis('');
    setIsAnalyzingImage(false);
  }

  async function copyGeneratedOpening(item: CreativeGenerateResult, index: number) {
    try {
      await navigator.clipboard.writeText(item.openingText);
      setCopiedGeneratedIndex(index);
      window.setTimeout(() => setCopiedGeneratedIndex((current) => current === index ? null : current), 1500);
    } catch {
      setError('复制文案失败');
    }
  }

  async function saveGeneratedOpening(item: CreativeGenerateResult, index: number) {
    if (savedGeneratedIndexes.includes(index)) return;
    setError('');
    try {
      const strategyLabel = item.strategy === 'explore' ? '探索新角度' : '稳健参考';
      const saved = await createCreativeOpening({
        openingText: item.openingText,
        paintingName: generateDraft.paintingName,
        scene: generateDraft.scene,
        platform: '抖音',
        reasonAnalysis: item.logic,
        tags: [strategyLabel],
      });
      setOpenings((previous) => [saved, ...previous.filter((opening) => opening.id !== saved.id)]);
      setSavedGeneratedIndexes((previous) => [...previous, index]);
    } catch (err) {
      setError(err instanceof Error ? err.message : '保存到爆款文案库失败');
    }
  }

  function toggleReference(id: string) {
    setSelectedReferenceIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
    );
  }

  return (
    <div className="min-h-screen bg-background text-slate-900">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/60 bg-white/50 px-6 backdrop-blur-xl">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="group flex h-9 items-center gap-2.5 rounded-full border border-slate-200/80 bg-white/60 pl-1 pr-4 shadow-sm transition-all duration-300 hover:bg-white hover:shadow-md"
            title="返回首页"
          >
            <div className="flex size-7 items-center justify-center rounded-full bg-slate-900 text-white transition-transform group-hover:scale-105">
              <ArrowLeft className="size-3.5" />
            </div>
            <span className="text-xs font-bold text-slate-700">返回</span>
          </button>
          <ModuleQuickNav current="feeding" onNavigate={onNavigate} />
        </div>
        <div className="text-right">
          <h1 className="text-sm font-black text-slate-800">创意喂养</h1>
          <p className="text-[11px] font-semibold text-slate-400">装饰画爆款开头库</p>
        </div>
      </header>

      <main className="mx-auto w-full max-w-[1280px] px-6 py-6 pb-24">
        <section className="glass-card overflow-hidden rounded-3xl border-white/80 shadow-glass">
          <div className="flex flex-wrap items-center justify-between gap-3 px-5 py-3">
            <div className="flex flex-wrap items-center gap-3">
              <div className="flex w-fit rounded-2xl border border-slate-200 bg-white/60 p-1 shadow-sm backdrop-blur">
                {[
                  { id: 'library', label: '爆款开头文案库', icon: BookOpenText },
                  { id: 'generate', label: '文案仿写', icon: Sparkles },
                ].map((tab) => {
                  const Icon = tab.icon;
                  const active = activeTab === tab.id;
                  return (
                    <button
                      key={tab.id}
                      onClick={() => setActiveTab(tab.id as 'library' | 'generate')}
                      className={cn(
                        "flex h-10 items-center gap-2 rounded-xl px-4 text-sm font-black transition",
                        active ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:bg-white/70 hover:text-slate-900"
                      )}
                    >
                      <Icon className="size-4" />
                      {tab.label}
                    </button>
                  );
                })}
                <button
                  onClick={() => {
                    setActiveTab('library');
                    setOpeningDraft(emptyOpeningDraft);
                    setEditingId(null);
                    setIsOpeningFormCollapsed(false);
                  }}
                  className={cn(
                    "flex h-10 w-10 items-center justify-center rounded-xl text-sm font-black transition",
                    activeTab === 'library' && !isOpeningFormCollapsed
                      ? "bg-emerald-500 text-white shadow-sm"
                      : "text-slate-500 hover:bg-white/70 hover:text-slate-900"
                  )}
                  title="新增爆款开头"
                  aria-label="新增爆款开头"
                >
                  <Plus className="size-4" />
                </button>
              </div>
              <span className="text-base font-black text-emerald-600">
                {openings.length}条爆款记录
              </span>
            </div>
            <div className="flex flex-wrap items-center gap-2 text-xs font-bold text-slate-500">
              <button
                onClick={() => {
                  setSettingsDraft(settings);
                  setIsSettingsOpen(true);
                }}
                className="flex h-9 items-center gap-2 rounded-full border border-slate-200/80 bg-white/60 px-4 text-xs font-bold text-slate-600 shadow-sm transition-all duration-300 hover:bg-white hover:shadow-md"
              >
                <Settings2 className="size-3.5" />
                调整设定
              </button>
              <span className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1 text-indigo-700">智能参考 8–12 条 · 7+3 创作</span>
            </div>
          </div>

          {error && (
            <div className="mx-5 mt-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
              {error}
            </div>
          )}

          <div className="border-t border-slate-100/70 p-5">
            {activeTab === 'library' ? (
              <div className={cn(
                "grid gap-5",
                isOpeningFormCollapsed && !editingId ? "xl:grid-cols-1" : "xl:grid-cols-[420px_minmax(0,1fr)]"
              )}>
                {(!isOpeningFormCollapsed || editingId) && (
                <section className="rounded-2xl border border-slate-200/90 bg-white/75 p-5 shadow-sm shadow-slate-200/70 ring-1 ring-white/70">
                  <div className="mb-4 flex items-center justify-between">
                    <h2 className="text-base font-black text-slate-900">{editingId ? '编辑爆款开头' : '新增爆款开头'}</h2>
                    <div className="flex items-center gap-2">
                      {editingId && (
                        <button onClick={() => resetOpeningForm(true)} className="text-xs font-black text-slate-400 hover:text-slate-700">取消编辑</button>
                      )}
                      <button onClick={() => setIsOpeningFormCollapsed(true)} className="text-xs font-black text-slate-400 hover:text-slate-700">收起</button>
                    </div>
                  </div>
                  <div className="space-y-3">
                    <textarea
                      value={openingDraft.openingText}
                      onChange={(event) => setOpeningDraft((draft) => ({ ...draft, openingText: event.target.value }))}
                      placeholder="输入真正跑出效果的开头文案"
                      rows={4}
                      className="w-full resize-none rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-semibold leading-6 outline-none transition placeholder:text-slate-300 focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                    />
                    <div className="grid grid-cols-2 gap-3">
                      <input className="h-11 rounded-2xl border border-slate-200 bg-white/60 px-4 text-sm font-semibold outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" placeholder="画名" value={openingDraft.paintingName} onChange={(event) => setOpeningDraft((draft) => ({ ...draft, paintingName: event.target.value }))} />
                      <input className="h-11 rounded-2xl border border-slate-200 bg-white/60 px-4 text-sm font-semibold outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" placeholder="平台" value={openingDraft.platform} onChange={(event) => setOpeningDraft((draft) => ({ ...draft, platform: event.target.value }))} />
                    </div>
                    <input className="h-11 w-full rounded-2xl border border-slate-200 bg-white/60 px-4 text-sm font-semibold outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" placeholder="视频链接" value={openingDraft.videoUrl} onChange={(event) => setOpeningDraft((draft) => ({ ...draft, videoUrl: event.target.value }))} />
                    <textarea className="w-full resize-none rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-semibold leading-6 outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" placeholder="效果备注" rows={2} value={openingDraft.performanceNote} onChange={(event) => setOpeningDraft((draft) => ({ ...draft, performanceNote: event.target.value }))} />
                    <input className="h-11 w-full rounded-2xl border border-slate-200 bg-white/60 px-4 text-sm font-semibold outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" placeholder="标签，用逗号分隔" value={openingDraft.tags} onChange={(event) => setOpeningDraft((draft) => ({ ...draft, tags: event.target.value }))} />
                    <button
                      onClick={() => void saveOpening()}
                      className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-black text-white shadow-md transition hover:bg-slate-800"
                    >
                      <Plus className="size-4" />
                      {editingId ? '保存修改' : '新增爆款开头'}
                    </button>
                  </div>
                </section>
                )}

                <section className="rounded-2xl border border-slate-200/90 bg-white/75 p-5 shadow-sm shadow-slate-200/70 ring-1 ring-white/70">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="relative min-w-[260px] flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索开头、画名、标签、分析"
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-white/60 pl-10 pr-4 text-sm font-semibold outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                  />
                </div>
                <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-white/60 px-3 text-sm font-bold outline-none transition focus:border-indigo-300 focus:bg-white">
                  <option value="">全部标签</option>
                  {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                </select>
                <button
                  onClick={() => setSortByLikes((value) => !value)}
                  className={cn(
                    "flex h-11 items-center gap-2 rounded-2xl border px-4 text-sm font-black transition",
                    sortByLikes
                      ? "border-indigo-200 bg-indigo-50 text-indigo-700 shadow-sm"
                      : "border-slate-200 bg-white/60 text-slate-600 hover:bg-white hover:text-slate-900"
                  )}
                >
                  <TrendingUp className="size-4" />
                  按点赞排序
                </button>
                <button onClick={() => void loadData()} className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200 bg-white/60 px-4 text-sm font-black text-slate-600 transition hover:bg-white hover:text-slate-900">
                  <RefreshCw className="size-4" />
                  刷新
                </button>
              </div>

              {isLoading ? (
                <div className="flex h-64 items-center justify-center text-sm font-black text-slate-400">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  正在读取文案库
                </div>
              ) : displayedOpenings.length === 0 ? (
                <div className="flex h-64 items-center justify-center rounded-3xl bg-slate-50 text-sm font-black text-slate-400">
                  暂无爆款开头，先新增一条真实跑量好的开头。
                </div>
              ) : (
                <div className="grid gap-4">
                  {displayedOpenings.map((opening, index) => {
                    const selected = selectedReferenceIds.includes(opening.id);
                    const likeScore = extractLikeScore(opening.performanceNote);
                    const videoUrl = getOpeningVideoUrl(opening);
                    return (
                      <article
                        key={opening.id}
                        onDoubleClick={() => setDetailOpening(opening)}
                        title="双击查看完整内容"
                        className={cn(
                          "rounded-3xl border-2 p-4 shadow-[0_5px_16px_rgba(15,23,42,0.08)] transition hover:-translate-y-0.5 hover:shadow-lg",
                          selected
                            ? "border-emerald-400 bg-emerald-50/55 shadow-emerald-100/90 ring-1 ring-emerald-100"
                            : "border-slate-300 bg-white/95 hover:border-slate-400"
                        )}
                      >
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "mt-0.5 flex h-11 min-w-11 shrink-0 items-center justify-center px-2 text-2xl font-black text-white drop-shadow-[0_3px_8px_rgba(15,23,42,0.45)]",
                            "[text-shadow:0_1px_0_rgba(15,23,42,0.25),0_0_10px_rgba(15,23,42,0.35)]"
                          )}>
                            {index + 1}
                          </div>
                          <button
                            onClick={() => toggleReference(opening.id)}
                            className={cn("mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl border text-slate-400 transition", selected ? "border-emerald-300 bg-emerald-500 text-white shadow-sm" : "border-slate-200 bg-white/70 hover:bg-emerald-50 hover:text-emerald-600")}
                            title="勾选为重点参考"
                          >
                            <CheckSquare className="size-4" />
                          </button>
                          <div className="min-w-0 flex-1">
                            <div className="mb-2 flex flex-wrap items-center gap-2">
                              {opening.paintingName && (
                                <span className="rounded-2xl bg-indigo-50 px-3 py-1.5 text-base font-black text-indigo-700 ring-1 ring-indigo-100">
                                  {renderSearchHighlight(opening.paintingName, query)}
                                </span>
                              )}
                              {opening.performanceNote && (
                                <span className={cn(
                                  "rounded-2xl px-3 py-1.5 text-sm font-black",
                                  likeScore > 0 ? "bg-emerald-50 text-emerald-700 ring-1 ring-emerald-100" : "bg-slate-100 text-slate-600"
                                )}>
                                  {renderSearchHighlight(opening.performanceNote, query)}
                                </span>
                              )}
                            </div>
                            <p
                              className="overflow-hidden text-sm font-bold leading-6 text-slate-700"
                              style={{
                                display: '-webkit-box',
                                WebkitLineClamp: 2,
                                WebkitBoxOrient: 'vertical',
                              }}
                            >
                              {renderSearchHighlight(opening.openingText, query)}
                            </p>
                            {videoUrl && (
                              <button
                                type="button"
                                onDoubleClick={(event) => {
                                  event.stopPropagation();
                                  window.open(videoUrl, '_blank', 'noopener,noreferrer');
                                }}
                                onClick={(event) => event.stopPropagation()}
                                className="mt-2 block max-w-full truncate rounded-xl bg-blue-50 px-3 py-1.5 text-left text-[11px] font-black text-blue-600 transition-colors hover:bg-blue-100"
                                title="双击打开视频链接"
                              >
                                视频链接：{renderSearchHighlight(videoUrl, query)}
                              </button>
                            )}
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black">
                              {opening.platform && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{renderSearchHighlight(opening.platform, query)}</span>}
                              {opening.tags.filter((tag) => !isUrlLike(tag)).map((tag) => <span key={tag} className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">#{renderSearchHighlight(tag, query)}</span>)}
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">{formatDate(opening.createdAt)}</span>
                            </div>
                            <div className="mt-2 flex justify-end">
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-black text-slate-500">
                                总字数：{countOpeningChars(opening.openingText)}
                              </span>
                            </div>
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button onClick={() => { setEditingId(opening.id); setOpeningDraft(openingToDraft(opening)); setIsOpeningFormCollapsed(false); }} className="flex size-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="编辑">
                              <Edit3 className="size-4" />
                            </button>
                            <button onClick={() => void removeOpening(opening.id)} className="flex size-8 items-center justify-center rounded-xl text-slate-400 hover:bg-red-50 hover:text-red-500" title="删除">
                              <Trash2 className="size-4" />
                            </button>
                          </div>
                        </div>
                      </article>
                    );
                  })}
                </div>
              )}
                </section>
              </div>
            ) : (
              <div className="grid gap-5 xl:grid-cols-[430px_minmax(0,1fr)]">
                <section className="rounded-2xl border border-slate-200/90 bg-white/75 p-5 shadow-sm shadow-slate-200/70 ring-1 ring-white/70">
              <h2 className="mb-4 text-base font-black text-slate-900">本次仿写需求</h2>
              <div className="space-y-3">
                <input
                  ref={paintingImageInputRef}
                  type="file"
                  accept="image/*"
                  className="hidden"
                  onChange={handlePaintingImageChange}
                />
                {paintingImage ? (
                  <div className="overflow-hidden rounded-2xl border-2 border-slate-300 bg-white/90 shadow-sm">
                    <div className="flex items-center gap-3 p-3">
                      <img src={paintingImage.dataUrl} alt="本次画作" className="size-20 shrink-0 rounded-xl object-cover" />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-sm font-black text-slate-800">{paintingImage.name}</div>
                        <p className="mt-1 text-xs font-bold text-slate-400">图片仅用于本次识别和仿写，不会保存进文案库</p>
                        <div className="mt-2 flex gap-2">
                          <button type="button" onClick={() => void analyzePaintingImage()} disabled={isAnalyzingImage} className="text-xs font-black text-indigo-600 disabled:opacity-50">
                            {isAnalyzingImage ? '正在识别...' : '重新识别'}
                          </button>
                          <button type="button" onClick={removePaintingImage} className="text-xs font-black text-slate-400 hover:text-red-500">移除图片</button>
                        </div>
                      </div>
                    </div>
                    {isAnalyzingImage ? (
                      <div className="relative min-h-[190px] overflow-hidden border-t-2 border-slate-700 bg-slate-900 px-5 py-7 text-center">
                        <div
                          className="pointer-events-none absolute inset-0 opacity-10"
                          style={{
                            backgroundImage: 'linear-gradient(rgba(99,102,241,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.4) 1px, transparent 1px)',
                            backgroundSize: '24px 24px',
                          }}
                        />
                        <div
                          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-70"
                          style={{ animation: 'tech-scan 2.5s linear infinite' }}
                        />
                        <div className="pointer-events-none absolute inset-x-0 top-0 h-20 bg-gradient-to-b from-cyan-500/10 to-transparent" />
                        <div className="relative flex min-h-[134px] flex-col items-center justify-center">
                          <div className="mb-5 flex justify-center gap-2">
                            {[0, 1, 2].map((index) => (
                              <span
                                key={index}
                                className="inline-block size-2 rounded-full bg-cyan-400 shadow-[0_0_8px_rgba(34,211,238,0.65)]"
                                style={{
                                  animation: 'tech-pulse 1.6s infinite ease-in-out both',
                                  animationDelay: `${index * 0.2}s`,
                                }}
                              />
                            ))}
                          </div>
                          <div className="text-sm font-black tracking-wider text-white">AI 正在识别画作</div>
                          <div className="mt-2 text-xs font-semibold text-cyan-300/80">分析主体、构图、色彩、寓意与适用场景</div>
                          <div className="mt-3 text-[11px] text-slate-500">完成后将自动展示可编辑的识别结果</div>
                        </div>
                      </div>
                    ) : (
                      <textarea
                        rows={7}
                        value={imageAnalysis}
                        onChange={(event) => setImageAnalysis(event.target.value)}
                        placeholder="识别结果会显示在这里，你可以直接修改后再生成"
                        className="w-full resize-y border-t-2 border-slate-200 bg-slate-50/70 px-4 py-3 text-xs font-semibold leading-6 text-slate-700 outline-none transition focus:border-indigo-300 focus:bg-white"
                      />
                    )}
                  </div>
                ) : (
                  <button
                    type="button"
                    onClick={() => paintingImageInputRef.current?.click()}
                    className="group flex min-h-[210px] w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-slate-300 bg-white/90 p-6 text-center shadow-sm transition hover:border-indigo-400 hover:bg-indigo-50/35"
                  >
                    <span className="relative flex size-16 items-center justify-center rounded-2xl border border-indigo-100 bg-indigo-50 text-indigo-600 shadow-sm transition group-hover:scale-105 group-hover:bg-indigo-100">
                      <ImagePlus className="size-7" />
                      <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-indigo-600 text-sm font-black text-white shadow-md">+</span>
                    </span>
                    <span className="mt-4 block text-base font-black text-slate-800">上传画作图片</span>
                    <span className="mt-1.5 block text-xs font-bold text-indigo-600">点击选择图片（可选）</span>
                    <span className="mt-3 block text-[11px] font-semibold text-slate-400">支持 JPG、PNG、WEBP，单张最大 10MB</span>
                    <span className="mt-1 block text-[11px] font-semibold text-slate-400">AI 将先理解画面，再结合文案库进行创作</span>
                  </button>
                )}
                <input className="h-11 w-full rounded-2xl border-2 border-slate-300 bg-white/90 px-4 text-sm font-semibold shadow-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" placeholder="画名（可选），例如：日照金山" value={generateDraft.paintingName} onChange={(event) => setGenerateDraft((draft) => ({ ...draft, paintingName: event.target.value }))} />
                <input className="h-11 w-full rounded-2xl border-2 border-slate-300 bg-white/90 px-4 text-sm font-semibold shadow-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" placeholder="使用场景（可选），例如：客厅沙发墙" value={generateDraft.scene} onChange={(event) => setGenerateDraft((draft) => ({ ...draft, scene: event.target.value }))} />
                <textarea className="w-full resize-none rounded-2xl border-2 border-slate-300 bg-white/90 px-4 py-3 text-sm font-semibold leading-6 shadow-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" rows={3} placeholder="想强调的寓意 / 卖点（可选）" value={generateDraft.sellingPoint} onChange={(event) => setGenerateDraft((draft) => ({ ...draft, sellingPoint: event.target.value }))} />
                <textarea className="w-full resize-none rounded-2xl border-2 border-slate-300 bg-white/90 px-4 py-3 text-sm font-semibold leading-6 shadow-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" rows={4} placeholder="补充要求（可选）" value={generateDraft.extraRequirement} onChange={(event) => setGenerateDraft((draft) => ({ ...draft, extraRequirement: event.target.value }))} />
                <div>
                  <label className="mb-1 block text-xs font-black text-slate-500">生成数量</label>
                  <input type="number" min={1} max={30} className="h-11 w-full rounded-2xl border-2 border-slate-300 bg-white/90 px-4 text-sm font-semibold shadow-sm outline-none transition focus:border-indigo-400 focus:bg-white focus:ring-2 focus:ring-indigo-500/20" value={generateDraft.count} onChange={(event) => setGenerateDraft((draft) => ({ ...draft, count: Number(event.target.value) }))} />
                </div>
                <button
                  onClick={() => void handleGenerate()}
                  disabled={isGenerating || isAnalyzingImage || Boolean(paintingImage && !imageAnalysis.trim())}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-black text-white shadow-md transition hover:bg-slate-800 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGenerating || isAnalyzingImage ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {isAnalyzingImage ? '等待图片分析完成' : isGenerating ? '正在仿写' : paintingImage && !imageAnalysis.trim() ? '请先完成图片分析' : '生成爆款开头'}
                </button>
                <p className="px-1 text-[11px] font-bold leading-5 text-slate-400">
                  画名、使用场景、寓意和补充要求均可不填；填写得越具体，生成方向越准确。
                </p>
                <div className="rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-xs font-bold leading-5 text-slate-500">
                  {selectedReferenceIds.length > 0
                    ? `已手动勾选 ${selectedReferenceIds.length} 条重点参考。`
                    : '未手动勾选时，系统会按画作、场景和卖点智能选择 8–12 条相关案例。'}
                </div>
              </div>
                </section>

                <section className="rounded-2xl border border-slate-200/90 bg-white/75 p-5 shadow-sm shadow-slate-200/70 ring-1 ring-white/70">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-black">仿写结果</h2>
                  {generateMeta && (
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      使用模型：{generateMeta.model} · {generateMeta.referenceMode === 'manual' ? '手动' : '智能'}参考 {generateMeta.referenceCount} 条 · 稳健 {generateMeta.stableCount} 条 / 探索 {generateMeta.exploreCount} 条
                    </p>
                  )}
                </div>
                {generatedAnswer && (
                  <div className="flex items-center gap-2">
                    <button
                      onClick={() => void handleGenerate(true)}
                      disabled={isGenerating}
                      className="flex h-9 items-center gap-2 rounded-full border-2 border-indigo-200 bg-indigo-50 px-4 text-xs font-black text-indigo-700 transition hover:border-indigo-300 hover:bg-indigo-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshCw className="size-4" />
                      重新生成一批
                    </button>
                    <button
                      onClick={() => void navigator.clipboard.writeText(generatedAnswer)}
                      className="flex h-9 items-center gap-2 rounded-full border border-slate-200 px-4 text-xs font-black text-slate-600 hover:bg-slate-50"
                    >
                      <Copy className="size-4" />
                      复制全文
                    </button>
                  </div>
                )}
              </div>
              {isGenerating ? (
                <div className="relative min-h-80 overflow-hidden rounded-3xl border-2 border-slate-700 bg-slate-900 px-6 py-10 text-center shadow-xl">
                  <div
                    className="pointer-events-none absolute inset-0 opacity-10"
                    style={{
                      backgroundImage: 'linear-gradient(rgba(99,102,241,0.4) 1px, transparent 1px), linear-gradient(90deg, rgba(99,102,241,0.4) 1px, transparent 1px)',
                      backgroundSize: '24px 24px',
                    }}
                  />
                  <div
                    className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-cyan-400 to-transparent opacity-70"
                    style={{ animation: 'tech-scan 2.5s linear infinite' }}
                  />
                  <div className="pointer-events-none absolute inset-x-0 top-0 h-24 bg-gradient-to-b from-cyan-500/10 to-transparent" />
                  <div className="relative flex min-h-60 flex-col items-center justify-center">
                    <div className="mb-6 flex justify-center gap-2.5">
                      {[0, 1, 2].map((index) => (
                        <span
                          key={index}
                          className="inline-block size-2.5 rounded-full bg-cyan-400 shadow-[0_0_10px_rgba(34,211,238,0.7)]"
                          style={{
                            animation: 'tech-pulse 1.6s infinite ease-in-out both',
                            animationDelay: `${index * 0.2}s`,
                          }}
                        />
                      ))}
                    </div>
                    <div className="text-base font-black tracking-wider text-white">AI 正在创作爆款开头</div>
                    <div className="mt-2 text-xs font-semibold text-cyan-300/80">读取团队设定，匹配相关案例，执行 7+3 创作策略</div>
                    <div className="mt-4 text-[11px] text-slate-500">生成完成后将在此自动展示全部文案</div>
                  </div>
                </div>
              ) : generatedResults.length > 0 ? (
                <div className="grid gap-4">
                  {generatedResults.map((item, index) => {
                    const isExplore = item.strategy === 'explore';
                    const isSaved = savedGeneratedIndexes.includes(index);
                    return (
                    <article key={`${item.openingText}-${index}`} className={cn("rounded-3xl border-2 p-4 shadow-[0_5px_16px_rgba(15,23,42,0.08)]", isExplore ? "border-amber-300 bg-amber-50/45" : "border-emerald-300 bg-emerald-50/40")}>
                      <div className="mb-2 flex items-center justify-between gap-3">
                        <div className={cn("flex items-center gap-2 text-xs font-black", isExplore ? "text-amber-700" : "text-emerald-600")}>
                          <span>#{index + 1}</span>
                          <span className={cn("rounded-full px-2.5 py-1", isExplore ? "bg-amber-100" : "bg-emerald-100")}>{isExplore ? '探索新角度' : '稳健参考'}</span>
                        </div>
                        <div className="flex items-center gap-1">
                          <button onClick={() => void copyGeneratedOpening(item, index)} className="flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-black text-slate-500 hover:bg-white/80" title="复制这条文案">
                            {copiedGeneratedIndex === index ? <CheckSquare className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                            {copiedGeneratedIndex === index ? '已复制' : '复制'}
                          </button>
                          <button onClick={() => void saveGeneratedOpening(item, index)} disabled={isSaved} className={cn("flex h-8 items-center gap-1.5 rounded-full px-3 text-xs font-black transition", isSaved ? "bg-emerald-100 text-emerald-700" : "text-slate-500 hover:bg-white/80")} title="保存到爆款文案库">
                            {isSaved ? <CheckSquare className="size-3.5" /> : <Save className="size-3.5" />}
                            {isSaved ? '已保存' : '保存'}
                          </button>
                        </div>
                      </div>
                      <p className="text-base font-black leading-7 text-slate-900">{item.openingText}</p>
                      {item.logic && <p className="mt-3 rounded-2xl bg-white/75 px-3 py-2 text-xs font-bold leading-5 text-slate-600">爆点逻辑：{item.logic}</p>}
                    </article>
                  );})}
                </div>
              ) : generatedAnswer ? (
                <pre className="min-h-80 whitespace-pre-wrap rounded-3xl bg-slate-950 p-5 text-sm font-semibold leading-7 text-slate-100">{generatedAnswer}</pre>
              ) : (
                <div className="flex h-80 items-center justify-center rounded-3xl bg-slate-50 text-sm font-black text-slate-400">
                  填写需求后点击生成，这里会展示多条开头和爆点逻辑。
                </div>
              )}
                </section>
              </div>
            )}
          </div>
        </section>
      </main>

      {detailOpening && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-3xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-start justify-between gap-4 border-b border-slate-100 px-5 py-4">
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  {detailOpening.paintingName && (
                    <span className="rounded-2xl bg-indigo-50 px-3 py-1.5 text-lg font-black text-indigo-700 ring-1 ring-indigo-100">
                      {detailOpening.paintingName}
                    </span>
                  )}
                  {detailOpening.performanceNote && (
                    <span className="rounded-2xl bg-emerald-50 px-3 py-1.5 text-sm font-black text-emerald-700 ring-1 ring-emerald-100">
                      {detailOpening.performanceNote}
                    </span>
                  )}
                </div>
                <div className="mt-2 flex flex-wrap gap-2 text-[11px] font-black">
                  {detailOpening.platform && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{detailOpening.platform}</span>}
                  {detailOpening.tags.filter((tag) => !isUrlLike(tag)).map((tag) => <span key={tag} className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">#{tag}</span>)}
                  <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">{formatDate(detailOpening.createdAt)}</span>
                </div>
                {getOpeningVideoUrl(detailOpening) && (
                  <button
                    type="button"
                    onDoubleClick={() => window.open(getOpeningVideoUrl(detailOpening), '_blank', 'noopener,noreferrer')}
                    className="mt-3 block max-w-full truncate rounded-xl bg-blue-50 px-3 py-1.5 text-left text-[11px] font-black text-blue-600 transition-colors hover:bg-blue-100"
                    title="双击打开视频链接"
                  >
                    视频链接：{getOpeningVideoUrl(detailOpening)}
                  </button>
                )}
              </div>
              <button
                onClick={() => setDetailOpening(null)}
                className="flex size-9 shrink-0 items-center justify-center rounded-full text-slate-400 hover:bg-slate-100 hover:text-slate-700"
                aria-label="关闭详情"
              >
                <X className="size-4" />
              </button>
            </div>

            <div className="max-h-[60vh] overflow-y-auto p-5">
              <div className="rounded-3xl bg-slate-50 p-5">
                <div className="mb-2 text-xs font-black text-slate-400">完整开头文案</div>
                <p className="whitespace-pre-wrap text-base font-bold leading-8 text-slate-900">
                  {detailOpening.openingText}
                </p>
              </div>
            </div>

            <div className="flex justify-between gap-2 border-t border-slate-100 px-5 py-4">
              <button
                onClick={() => {
                  setEditingId(detailOpening.id);
                  setOpeningDraft(openingToDraft(detailOpening));
                  setIsOpeningFormCollapsed(false);
                  setDetailOpening(null);
                }}
                className="flex h-10 items-center gap-2 rounded-full border border-slate-200 bg-white px-5 text-sm font-black text-slate-600 hover:bg-slate-50"
              >
                <Edit3 className="size-4" />
                编辑
              </button>
              <button
                onClick={() => void copyDetailOpeningText()}
                className={cn(
                  "flex h-10 items-center gap-2 rounded-full px-5 text-sm font-black text-white transition-all",
                  detailCopyStatus === 'done'
                    ? "bg-emerald-500 shadow-lg shadow-emerald-200"
                    : detailCopyStatus === 'error'
                      ? "bg-red-500 shadow-lg shadow-red-200"
                      : "bg-slate-900 hover:bg-slate-800"
                )}
              >
                {detailCopyStatus === 'done' ? <CheckSquare className="size-4" /> : <Copy className="size-4" />}
                {detailCopyStatus === 'done'
                  ? '复制成功'
                  : detailCopyStatus === 'error'
                    ? '复制失败'
                    : '复制完整文案'}
              </button>
            </div>
          </div>
        </div>
      )}

      {isSettingsOpen && settingsDraft && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/40 p-4 backdrop-blur-sm">
          <div className="max-h-[88vh] w-full max-w-4xl overflow-hidden rounded-3xl bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
              <div>
                <h2 className="text-lg font-black">业务设定</h2>
                <p className="text-xs font-bold text-slate-400">保存后所有设备同步生效</p>
              </div>
              <button onClick={() => setIsSettingsOpen(false)} className="flex size-9 items-center justify-center rounded-full hover:bg-slate-100">
                <X className="size-4" />
              </button>
            </div>
            <div className="max-h-[65vh] overflow-y-auto p-5">
              <div className="grid gap-4 md:grid-cols-2">
                {settingLabels.map((item) => (
                  <label key={item.key} className="block">
                    <span className="mb-2 block text-xs font-black text-slate-500">{item.label}</span>
                    <textarea
                      value={settingsDraft[item.key]}
                      onChange={(event) => setSettingsDraft((draft) => draft ? ({ ...draft, [item.key]: event.target.value }) : draft)}
                      rows={item.rows}
                      className="w-full resize-none rounded-2xl border border-slate-200 bg-white/60 px-4 py-3 text-sm font-semibold leading-6 outline-none transition focus:border-indigo-300 focus:bg-white focus:ring-2 focus:ring-indigo-500/20"
                    />
                  </label>
                ))}
              </div>
            </div>
            <div className="flex justify-end gap-2 border-t border-slate-100 px-5 py-4">
              <button onClick={() => { setSettingsDraft(settings); setIsSettingsOpen(false); }} className="h-10 rounded-full px-5 text-sm font-black text-slate-500 hover:bg-slate-100">
                取消
              </button>
              <button onClick={() => void saveSettings()} disabled={isSavingSettings} className="flex h-10 items-center gap-2 rounded-full bg-slate-900 px-5 text-sm font-black text-white disabled:opacity-60">
                {isSavingSettings && <Loader2 className="size-4 animate-spin" />}
                保存设定
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

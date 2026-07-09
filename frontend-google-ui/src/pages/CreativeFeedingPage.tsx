import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  BookOpenText,
  CheckSquare,
  Copy,
  Edit3,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Sparkles,
  Trash2,
  X,
} from "lucide-react";
import ModuleQuickNav from "@/src/components/ModuleQuickNav";
import { cn } from "@/src/lib/utils";
import {
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
  onNavigate: (page: 'voice' | 'creative' | 'douyin' | 'collection' | 'image' | 'topmodel' | 'feeding') => void;
}

const emptyOpeningDraft = {
  openingText: '',
  paintingName: '',
  scene: '',
  hookType: '',
  platform: '抖音',
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
  return {
    openingText: opening.openingText || '',
    paintingName: opening.paintingName || '',
    scene: opening.scene || '',
    hookType: opening.hookType || '',
    platform: opening.platform || '抖音',
    performanceNote: opening.performanceNote || '',
    reasonAnalysis: opening.reasonAnalysis || '',
    tags: (opening.tags || []).join('，'),
  };
}

function draftToPayload(draft: typeof emptyOpeningDraft) {
  return {
    ...draft,
    tags: draft.tags
      .split(/[,，、\n]/g)
      .map((item) => item.trim())
      .filter(Boolean),
  };
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
  const [sceneFilter, setSceneFilter] = useState('');
  const [tagFilter, setTagFilter] = useState('');
  const [openingDraft, setOpeningDraft] = useState(emptyOpeningDraft);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [selectedReferenceIds, setSelectedReferenceIds] = useState<string[]>([]);
  const [generateDraft, setGenerateDraft] = useState(emptyGenerateDraft);
  const [isGenerating, setIsGenerating] = useState(false);
  const [generatedAnswer, setGeneratedAnswer] = useState('');
  const [generatedResults, setGeneratedResults] = useState<CreativeGenerateResult[]>([]);
  const [generateMeta, setGenerateMeta] = useState<{ model: string; referenceCount: number } | null>(null);

  const scenes = useMemo(() => Array.from(new Set(openings.map((item) => item.scene).filter(Boolean))), [openings]);
  const tags = useMemo(() => Array.from(new Set(openings.flatMap((item) => item.tags || []).filter(Boolean))), [openings]);

  async function loadData(filters = { q: query, scene: sceneFilter, tag: tagFilter }) {
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
    void loadData({ q: '', scene: '', tag: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      void loadData({ q: query, scene: sceneFilter, tag: tagFilter });
    }, 250);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, sceneFilter, tagFilter]);

  function resetOpeningForm() {
    setOpeningDraft(emptyOpeningDraft);
    setEditingId(null);
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
      resetOpeningForm();
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

  async function handleGenerate() {
    setIsGenerating(true);
    setError('');
    setGeneratedAnswer('');
    setGeneratedResults([]);
    setGenerateMeta(null);
    try {
      const response = await generateCreativeOpenings({
        ...generateDraft,
        count: Math.min(30, Math.max(1, Number(generateDraft.count) || 10)),
        referenceLimit: 20,
        referenceIds: selectedReferenceIds,
      });
      setGeneratedAnswer(response.answer);
      setGeneratedResults(response.results || []);
      setGenerateMeta({ model: response.model, referenceCount: response.referenceCount });
    } catch (err) {
      setError(err instanceof Error ? err.message : '文案仿写生成失败');
    } finally {
      setIsGenerating(false);
    }
  }

  function toggleReference(id: string) {
    setSelectedReferenceIds((previous) =>
      previous.includes(id) ? previous.filter((item) => item !== id) : [...previous, id]
    );
  }

  return (
    <div className="min-h-screen bg-[#f6f8fb] text-slate-900">
      <header className="sticky top-0 z-30 border-b border-slate-200/70 bg-white/85 backdrop-blur-xl">
        <div className="mx-auto flex h-16 max-w-[1500px] items-center justify-between px-5">
          <div className="flex items-center gap-3">
            <button
              onClick={onBack}
              className="flex size-9 items-center justify-center rounded-full border border-slate-200 bg-white text-slate-500 shadow-sm transition hover:border-slate-300 hover:text-slate-900"
              title="返回首页"
            >
              <ArrowLeft className="size-4" />
            </button>
            <div>
              <h1 className="text-xl font-black tracking-tight">创意喂养</h1>
              <p className="text-xs font-semibold text-slate-500">沉淀装饰画短视频爆款开头，并基于真实案例仿写新开头。</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={() => {
                setSettingsDraft(settings);
                setIsSettingsOpen(true);
              }}
              className="flex h-9 items-center gap-2 rounded-full border border-slate-200 bg-white px-4 text-xs font-black text-slate-700 shadow-sm transition hover:border-orange-200 hover:text-orange-600"
            >
              <Settings2 className="size-4" />
              调整设定
            </button>
            <ModuleQuickNav current="feeding" onNavigate={onNavigate} />
          </div>
        </div>
      </header>

      <main className="mx-auto max-w-[1500px] px-5 py-5">
        <section className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div className="flex rounded-2xl border border-slate-200 bg-white p-1 shadow-sm">
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
                    active ? "bg-slate-900 text-white shadow-sm" : "text-slate-500 hover:bg-slate-50 hover:text-slate-900"
                  )}
                >
                  <Icon className="size-4" />
                  {tab.label}
                </button>
              );
            })}
          </div>
          <div className="flex items-center gap-2 text-xs font-bold text-slate-500">
            <span className="rounded-full bg-emerald-50 px-3 py-1 text-emerald-700">{openings.length} 条开头</span>
            <span className="rounded-full bg-blue-50 px-3 py-1 text-blue-700">默认参考最近 20 条</span>
          </div>
        </section>

        {error && (
          <div className="mb-4 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm font-bold text-red-600">
            {error}
          </div>
        )}

        {activeTab === 'library' ? (
          <div className="grid gap-5 xl:grid-cols-[420px_minmax(0,1fr)]">
            <section className="rounded-3xl border border-white/80 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <h2 className="text-base font-black">{editingId ? '编辑爆款开头' : '新增爆款开头'}</h2>
                {editingId && (
                  <button onClick={resetOpeningForm} className="text-xs font-black text-slate-400 hover:text-slate-700">取消编辑</button>
                )}
              </div>
              <div className="space-y-3">
                <textarea
                  value={openingDraft.openingText}
                  onChange={(event) => setOpeningDraft((draft) => ({ ...draft, openingText: event.target.value }))}
                  placeholder="输入真正跑出效果的开头文案"
                  rows={4}
                  className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 outline-none transition focus:border-emerald-300 focus:bg-white"
                />
                <div className="grid grid-cols-2 gap-3">
                  <input className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold outline-none focus:border-emerald-300 focus:bg-white" placeholder="画名" value={openingDraft.paintingName} onChange={(event) => setOpeningDraft((draft) => ({ ...draft, paintingName: event.target.value }))} />
                  <input className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold outline-none focus:border-emerald-300 focus:bg-white" placeholder="场景" value={openingDraft.scene} onChange={(event) => setOpeningDraft((draft) => ({ ...draft, scene: event.target.value }))} />
                  <input className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold outline-none focus:border-emerald-300 focus:bg-white" placeholder="爆点类型" value={openingDraft.hookType} onChange={(event) => setOpeningDraft((draft) => ({ ...draft, hookType: event.target.value }))} />
                  <input className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold outline-none focus:border-emerald-300 focus:bg-white" placeholder="平台" value={openingDraft.platform} onChange={(event) => setOpeningDraft((draft) => ({ ...draft, platform: event.target.value }))} />
                </div>
                <input className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold outline-none focus:border-emerald-300 focus:bg-white" placeholder="标签，用逗号分隔" value={openingDraft.tags} onChange={(event) => setOpeningDraft((draft) => ({ ...draft, tags: event.target.value }))} />
                <textarea className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 outline-none focus:border-emerald-300 focus:bg-white" placeholder="效果备注" rows={2} value={openingDraft.performanceNote} onChange={(event) => setOpeningDraft((draft) => ({ ...draft, performanceNote: event.target.value }))} />
                <textarea className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 outline-none focus:border-emerald-300 focus:bg-white" placeholder="为什么这条开头能爆" rows={3} value={openingDraft.reasonAnalysis} onChange={(event) => setOpeningDraft((draft) => ({ ...draft, reasonAnalysis: event.target.value }))} />
                <button
                  onClick={() => void saveOpening()}
                  className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-slate-900 text-sm font-black text-white shadow-sm transition hover:bg-slate-800"
                >
                  <Plus className="size-4" />
                  {editingId ? '保存修改' : '新增爆款开头'}
                </button>
              </div>
            </section>

            <section className="rounded-3xl border border-white/80 bg-white p-5 shadow-sm">
              <div className="mb-4 flex flex-wrap items-center gap-2">
                <div className="relative min-w-[260px] flex-1">
                  <Search className="absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
                  <input
                    value={query}
                    onChange={(event) => setQuery(event.target.value)}
                    placeholder="搜索开头、画名、标签、分析"
                    className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 pl-10 pr-4 text-sm font-semibold outline-none focus:border-emerald-300 focus:bg-white"
                  />
                </div>
                <select value={sceneFilter} onChange={(event) => setSceneFilter(event.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none">
                  <option value="">全部场景</option>
                  {scenes.map((scene) => <option key={scene} value={scene}>{scene}</option>)}
                </select>
                <select value={tagFilter} onChange={(event) => setTagFilter(event.target.value)} className="h-11 rounded-2xl border border-slate-200 bg-slate-50 px-3 text-sm font-bold outline-none">
                  <option value="">全部标签</option>
                  {tags.map((tag) => <option key={tag} value={tag}>{tag}</option>)}
                </select>
                <button onClick={() => void loadData()} className="flex h-11 items-center gap-2 rounded-2xl border border-slate-200 px-4 text-sm font-black text-slate-600 hover:bg-slate-50">
                  <RefreshCw className="size-4" />
                  刷新
                </button>
              </div>

              {isLoading ? (
                <div className="flex h-64 items-center justify-center text-sm font-black text-slate-400">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  正在读取文案库
                </div>
              ) : openings.length === 0 ? (
                <div className="flex h-64 items-center justify-center rounded-3xl bg-slate-50 text-sm font-black text-slate-400">
                  暂无爆款开头，先新增一条真实跑量好的开头。
                </div>
              ) : (
                <div className="grid gap-3">
                  {openings.map((opening, index) => {
                    const selected = selectedReferenceIds.includes(opening.id);
                    return (
                      <article key={opening.id} className={cn("rounded-3xl border p-4 transition", selected ? "border-emerald-300 bg-emerald-50/50" : "border-slate-200 bg-white hover:border-slate-300")}>
                        <div className="flex items-start gap-3">
                          <div className={cn(
                            "mt-1 flex h-8 min-w-8 shrink-0 items-center justify-center rounded-xl px-2 text-xs font-black",
                            selected ? "bg-emerald-100 text-emerald-700" : "bg-slate-100 text-slate-500"
                          )}>
                            {index + 1}
                          </div>
                          <button
                            onClick={() => toggleReference(opening.id)}
                            className={cn("mt-1 flex size-8 shrink-0 items-center justify-center rounded-xl border text-slate-400 transition", selected ? "border-emerald-300 bg-emerald-500 text-white" : "border-slate-200 bg-slate-50 hover:text-emerald-600")}
                            title="勾选为重点参考"
                          >
                            <CheckSquare className="size-4" />
                          </button>
                          <div className="min-w-0 flex-1">
                            <p className="text-base font-black leading-7 text-slate-900">{opening.openingText}</p>
                            <div className="mt-3 flex flex-wrap gap-2 text-[11px] font-black">
                              {opening.paintingName && <span className="rounded-full bg-amber-50 px-2.5 py-1 text-amber-700">{opening.paintingName}</span>}
                              {opening.scene && <span className="rounded-full bg-sky-50 px-2.5 py-1 text-sky-700">{opening.scene}</span>}
                              {opening.hookType && <span className="rounded-full bg-rose-50 px-2.5 py-1 text-rose-700">{opening.hookType}</span>}
                              {opening.platform && <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-600">{opening.platform}</span>}
                              {opening.tags.map((tag) => <span key={tag} className="rounded-full bg-emerald-50 px-2.5 py-1 text-emerald-700">#{tag}</span>)}
                              <span className="rounded-full bg-slate-100 px-2.5 py-1 text-slate-500">{formatDate(opening.createdAt)}</span>
                            </div>
                            {(opening.performanceNote || opening.reasonAnalysis) && (
                              <div className="mt-3 rounded-2xl bg-slate-50 px-3 py-2 text-xs font-semibold leading-5 text-slate-500">
                                {opening.performanceNote && <div>效果：{opening.performanceNote}</div>}
                                {opening.reasonAnalysis && <div>分析：{opening.reasonAnalysis}</div>}
                              </div>
                            )}
                          </div>
                          <div className="flex shrink-0 gap-1">
                            <button onClick={() => { setEditingId(opening.id); setOpeningDraft(openingToDraft(opening)); }} className="flex size-8 items-center justify-center rounded-xl text-slate-400 hover:bg-slate-100 hover:text-slate-700" title="编辑">
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
            <section className="rounded-3xl border border-white/80 bg-white p-5 shadow-sm">
              <h2 className="mb-4 text-base font-black">本次仿写需求</h2>
              <div className="space-y-3">
                <input className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold outline-none focus:border-emerald-300 focus:bg-white" placeholder="画名，例如：日照金山" value={generateDraft.paintingName} onChange={(event) => setGenerateDraft((draft) => ({ ...draft, paintingName: event.target.value }))} />
                <input className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold outline-none focus:border-emerald-300 focus:bg-white" placeholder="使用场景，例如：客厅沙发墙" value={generateDraft.scene} onChange={(event) => setGenerateDraft((draft) => ({ ...draft, scene: event.target.value }))} />
                <textarea className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 outline-none focus:border-emerald-300 focus:bg-white" rows={3} placeholder="想强调的寓意 / 卖点" value={generateDraft.sellingPoint} onChange={(event) => setGenerateDraft((draft) => ({ ...draft, sellingPoint: event.target.value }))} />
                <textarea className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 outline-none focus:border-emerald-300 focus:bg-white" rows={4} placeholder="补充要求" value={generateDraft.extraRequirement} onChange={(event) => setGenerateDraft((draft) => ({ ...draft, extraRequirement: event.target.value }))} />
                <div>
                  <label className="mb-1 block text-xs font-black text-slate-500">生成数量</label>
                  <input type="number" min={1} max={30} className="h-11 w-full rounded-2xl border border-slate-200 bg-slate-50 px-4 text-sm font-semibold outline-none focus:border-emerald-300 focus:bg-white" value={generateDraft.count} onChange={(event) => setGenerateDraft((draft) => ({ ...draft, count: Number(event.target.value) }))} />
                </div>
                <button
                  onClick={() => void handleGenerate()}
                  disabled={isGenerating}
                  className="flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-emerald-500 to-teal-600 text-sm font-black text-white shadow-lg shadow-emerald-200 transition hover:brightness-105 disabled:cursor-not-allowed disabled:opacity-60"
                >
                  {isGenerating ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
                  {isGenerating ? '正在仿写' : '生成爆款开头'}
                </button>
                <div className="rounded-2xl bg-slate-50 px-4 py-3 text-xs font-bold leading-5 text-slate-500">
                  {selectedReferenceIds.length > 0
                    ? `已手动勾选 ${selectedReferenceIds.length} 条重点参考。`
                    : '未手动勾选时，默认参考最近 20 条爆款开头。'}
                </div>
              </div>
            </section>

            <section className="rounded-3xl border border-white/80 bg-white p-5 shadow-sm">
              <div className="mb-4 flex items-center justify-between">
                <div>
                  <h2 className="text-base font-black">仿写结果</h2>
                  {generateMeta && (
                    <p className="mt-1 text-xs font-bold text-slate-400">
                      使用模型：{generateMeta.model} · 参考 {generateMeta.referenceCount} 条案例
                    </p>
                  )}
                </div>
                {generatedAnswer && (
                  <button
                    onClick={() => void navigator.clipboard.writeText(generatedAnswer)}
                    className="flex h-9 items-center gap-2 rounded-full border border-slate-200 px-4 text-xs font-black text-slate-600 hover:bg-slate-50"
                  >
                    <Copy className="size-4" />
                    复制全文
                  </button>
                )}
              </div>
              {isGenerating ? (
                <div className="flex h-80 items-center justify-center rounded-3xl bg-slate-50 text-sm font-black text-slate-400">
                  <Loader2 className="mr-2 size-4 animate-spin" />
                  正在读取业务设定和爆款案例生成
                </div>
              ) : generatedResults.length > 0 ? (
                <div className="grid gap-3">
                  {generatedResults.map((item, index) => (
                    <article key={`${item.openingText}-${index}`} className="rounded-3xl border border-emerald-100 bg-emerald-50/40 p-4">
                      <div className="mb-2 text-xs font-black text-emerald-600">#{index + 1}</div>
                      <p className="text-base font-black leading-7 text-slate-900">{item.openingText}</p>
                      {item.logic && <p className="mt-3 rounded-2xl bg-white/75 px-3 py-2 text-xs font-bold leading-5 text-slate-600">爆点逻辑：{item.logic}</p>}
                    </article>
                  ))}
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
      </main>

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
                      className="w-full resize-none rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-semibold leading-6 outline-none transition focus:border-orange-300 focus:bg-white"
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

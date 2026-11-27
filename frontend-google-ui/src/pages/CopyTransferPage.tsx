import { useEffect, useState } from 'react';
import {
  ArrowRight,
  BookmarkPlus,
  CheckCircle2,
  Clock,
  Download,
  FileAudio,
  FolderArchive,
  Layers,
  LoaderCircle,
  MapPin,
  Package,
  Play,
  Sparkles,
  Trash2,
  Upload,
  Wrench,
} from 'lucide-react';
import HomeBackButton from '@/src/components/HomeBackButton';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import CreativeSubNav from '@/src/components/CreativeSubNav';
import { cn } from '@/src/lib/utils';
import './copy-transfer.css';

interface Props {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
  onSwitchToVideo: () => void;
  onSwitchToClip: () => void;
  onSwitchToCopy: () => void;
  onSwitchToVoiceTransfer: () => void;
}

type ProductField = 'name' | 'usage' | 'material' | 'structure' | 'scenes';
type Product = Record<ProductField, string>;
type Profile = { source: Product; target: Product; instructions: string };
interface Sentence {
  original: string;
  revised: string;
  speakerId: string;
  start: number;
  end: number;
  changes: { from: string; to: string }[];
  needsReview: boolean;
}
interface Row {
  key: string;
  file: File;
  stage: '待处理' | '上传中' | '分析中' | '待确认' | '待生成' | '生成中' | '已完成' | '失败';
  sourceId?: string;
  planId?: string;
  sentences?: Sentence[];
  speakers?: { speakerId: string | number; label: string; vocalUrl: string; durationSeconds: number }[];
  revisions?: string[];
  needsReview?: boolean;
  approved?: boolean;
  result?: { outputId: string; audioUrl: string; fileName: string };
  error?: string;
  detail?: string;
  progress?: number;
  startedAt?: number;
}

const fields: {
  key: ProductField;
  label: string;
  required?: boolean;
  sourceHint: string;
  targetHint: string;
  icon: typeof Package;
}[] = [
  { key: 'name', label: '产品名称 / 形态', required: true, sourceHint: '曾国藩无纺布挂画', targetHint: '曾国藩铝合金边框摆台', icon: Package },
  { key: 'usage', label: '使用 / 安装方式', required: true, sourceHint: '挂在墙上', targetHint: '摆放在桌面上', icon: Wrench },
  { key: 'material', label: '材质', sourceHint: '无纺布画面', targetHint: '木板画芯', icon: Layers },
  { key: 'structure', label: '结构 / 配件', sourceHint: '无边框、挂绳', targetHint: '铝合金边框、一体支撑', icon: Sparkles },
  { key: 'scenes', label: '适用场景', sourceHint: '卧室床头墙、客厅墙面', targetHint: '床头柜、书桌、玄关柜', icon: MapPin },
];
const emptyProduct = (): Product => ({ name: '', usage: '', material: '', structure: '', scenes: '' });
const emptyProfile = (): Profile => ({ source: emptyProduct(), target: emptyProduct(), instructions: '' });

function normalizeProfile(saved: any): Profile {
  const empty = emptyProfile();
  if (!saved || typeof saved !== 'object') return empty;
  // Keep an earlier browser-saved conversion usable after the paired-field upgrade.
  const source = saved.source || { name: saved.sourceProduct };
  const target = saved.target || saved;
  return {
    source: Object.fromEntries(fields.map(({ key }) => [key, String(source?.[key] || '')])) as Product,
    target: Object.fromEntries(fields.map(({ key }) => [key, String(target?.[key] || '')])) as Product,
    instructions: String(saved.instructions || ''),
  };
}

async function parseResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
  return data;
}

async function waitForJob(jobId: string, onUpdate: (stage: string, percent: number) => void) {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const job = await parseResponse(await fetch(`/api/copy-transfer/job/${encodeURIComponent(jobId)}`, { credentials: 'include' }));
    onUpdate(String(job.stage || '排队等待'), Number(job.percent || 0));
    if (job.status === 'completed') return job.result;
    if (job.status === 'failed') throw new Error(job.error || '任务失败');
  }
}

function uploadFile(file: File, onProgress: (percent: number) => void): Promise<{ sourceId: string }> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', '/api/copy-transfer/source');
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable) onProgress(Math.round((event.loaded / event.total) * 100));
    };
    xhr.onerror = () => reject(new Error('上传连接中断，请重试'));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.error || `上传失败（HTTP ${xhr.status}）`);
        resolve(data);
      } catch (error) {
        reject(error);
      }
    };
    xhr.send(file);
  });
}

function getStageBadgeClass(stage: Row['stage']) {
  switch (stage) {
    case '已完成':
      return 'border-emerald-200 bg-emerald-50 text-emerald-700';
    case '待确认':
      return 'border-amber-300 bg-amber-50 text-amber-800';
    case '失败':
      return 'border-red-200 bg-red-50 text-red-700';
    case '上传中':
    case '分析中':
    case '生成中':
      return 'border-orange-200 bg-orange-50 text-orange-700';
    case '待生成':
      return 'border-sky-200 bg-sky-50 text-sky-700';
    default:
      return 'border-slate-200 bg-slate-100 text-slate-600';
  }
}

export default function CopyTransferPage({ onBack, onNavigate, onSwitchToVideo, onSwitchToClip, onSwitchToCopy, onSwitchToVoiceTransfer }: Props) {
  const [templates, setTemplates] = useState<{ label: string; profile: Profile }[]>(() => {
    try {
      const saved = JSON.parse(localStorage.getItem('copy-transfer-templates') || '[]');
      return Array.isArray(saved) ? saved.map((item) => ({ label: String(item.label || ''), profile: normalizeProfile(item.profile) })) : [];
    } catch {
      return [];
    }
  });
  const [profile, setProfile] = useState<Profile>(() => {
    try {
      return normalizeProfile(JSON.parse(localStorage.getItem('copy-transfer-profile') || '{}'));
    } catch {
      return emptyProfile();
    }
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [draggingFiles, setDraggingFiles] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState('');
  const [archive, setArchive] = useState<{ archiveUrl: string; fileName: string } | null>(null);
  const patch = (key: string, update: Partial<Row>) => setRows((current) => current.map((row) => (row.key === key ? { ...row, ...update } : row)));

  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  function appendMediaFiles(fileList: FileList | File[]) {
    const files = Array.from(fileList || []).filter(
      (file) => file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(mp3|wav|m4a|mp4|mov)$/i.test(file.name)
    );
    if (!files.length) return;
    setRows((old) => [...old, ...files.map((file) => ({ key: crypto.randomUUID(), file, stage: '待处理' as const }))]);
  }

  async function analyzeOne(row: Row, currentProfile: Profile) {
    try {
      let sourceId = row.sourceId;
      if (!sourceId) {
        patch(row.key, { stage: '上传中', detail: '上传本地素材', progress: 0, startedAt: Date.now(), error: '' });
        const source = await uploadFile(row.file, (percent) =>
          patch(row.key, { detail: percent === 100 ? '上传完成，服务端正在校验音轨' : `上传本地素材 · ${percent}%`, progress: percent })
        );
        sourceId = source.sourceId;
        patch(row.key, { sourceId });
      }
      patch(row.key, { stage: '分析中', detail: '进入分析队列', progress: 0, startedAt: Date.now() });
      const task = await parseResponse(
        await fetch('/api/copy-transfer/analyze', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ sourceId, profile: currentProfile }),
        })
      );
      const plan = await waitForJob(task.jobId, (detail, progress) => patch(row.key, { detail, progress }));
      const reviewedRow: Row = {
        ...row,
        sourceId,
        planId: plan.planId,
        sentences: plan.sentences,
        speakers: plan.speakers,
        revisions: plan.sentences.map((s: Sentence) => s.revised),
        needsReview: plan.needsReview,
        approved: !plan.needsReview,
        stage: plan.needsReview ? '待确认' : '待生成',
        detail: plan.needsReview ? '等待试听并核对文案' : '文案分析完成',
        progress: 100,
      };
      patch(row.key, {
        planId: plan.planId,
        sentences: plan.sentences,
        speakers: plan.speakers,
        revisions: plan.sentences.map((s: Sentence) => s.revised),
        needsReview: plan.needsReview,
        stage: plan.needsReview ? '待确认' : '待生成',
        approved: !plan.needsReview,
        detail: plan.needsReview ? '等待试听并核对文案' : '文案分析完成',
        progress: 100,
      });
      if (!plan.needsReview) await renderOne(reviewedRow);
    } catch (error) {
      patch(row.key, { stage: '失败', detail: '处理遇到问题', error: error instanceof Error ? error.message : '分析失败' });
    }
  }

  async function analyzeAll() {
    if (busy || !profile.source.name.trim() || !profile.source.usage.trim() || !profile.target.name.trim() || !profile.target.usage.trim()) {
      setMessage('请先填写原产品和目标产品的名称、使用方式');
      return;
    }
    setBusy(true);
    setMessage('正在逐条分析，普通条目自动生成；复杂素材需要你确认。请保持页面打开。');
    try {
      // One at a time, including upload and ASR, to protect the shared server.
      for (const row of rows.filter((item) => item.stage === '待处理' || item.stage === '失败')) await analyzeOne(row, profile);
    } finally {
      setBusy(false);
    }
  }

  async function renderOne(row: Row) {
    if (!row.planId || !row.revisions) return;
    patch(row.key, { stage: '生成中', detail: '准备阿里云配音', progress: 0, startedAt: Date.now(), error: '' });
    try {
      const task = await parseResponse(
        await fetch('/api/copy-transfer/render', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ planId: row.planId, revisions: row.revisions }),
        })
      );
      const result = await waitForJob(task.jobId, (detail, progress) => patch(row.key, { detail, progress }));
      patch(row.key, { result, stage: '已完成', detail: 'MP3 已就绪', progress: 100 });
    } catch (error) {
      patch(row.key, { stage: '失败', detail: '音频生成遇到问题', error: error instanceof Error ? error.message : '生成失败' });
    }
  }

  async function renderAll() {
    if (busy) return;
    setBusy(true);
    setMessage('正在按顺序生成音频。请保持页面打开。');
    try {
      for (const row of rows.filter((item) => item.planId && item.approved && item.stage !== '已完成')) await renderOne(row);
    } finally {
      setBusy(false);
    }
  }

  async function downloadAll() {
    if (busy) return;
    setBusy(true);
    setMessage('正在打包已完成的 MP3…');
    try {
      const task = await parseResponse(
        await fetch('/api/copy-transfer/bundle', {
          method: 'POST',
          credentials: 'include',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ outputIds: rows.map((row) => row.result?.outputId).filter(Boolean) }),
        })
      );
      const result = await waitForJob(task.jobId, (detail) => setMessage(`正在打包 · ${detail}`));
      setArchive(result);
      setMessage('打包完成，可以下载 MP3 合集。');
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '打包失败');
    } finally {
      setBusy(false);
    }
  }

  function saveTemplate() {
    if (!profile.source.name.trim() || !profile.source.usage.trim() || !profile.target.name.trim() || !profile.target.usage.trim()) {
      setMessage('先填写两边的产品名称与使用方式');
      return;
    }
    const label = `${profile.source.name} → ${profile.target.name}`;
    const next = [...templates.filter((item) => item.label !== label), { label, profile }].slice(-30);
    setTemplates(next);
    localStorage.setItem('copy-transfer-templates', JSON.stringify(next));
    localStorage.setItem('copy-transfer-profile', JSON.stringify(profile));
    setMessage(`已保存「${label}」`);
  }

  const sourceInputClass =
    'w-full rounded-xl border border-slate-200/90 bg-slate-50/80 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-slate-400 focus:bg-white focus:ring-4 focus:ring-slate-100 disabled:opacity-60';
  const targetInputClass =
    'w-full rounded-xl border border-amber-200/80 bg-amber-50/35 px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition placeholder:text-amber-700/35 focus:border-amber-400 focus:bg-white focus:ring-4 focus:ring-amber-100/80 disabled:opacity-60';

  const activeRow = rows.find((row) => ['上传中', '分析中', '生成中'].includes(row.stage));
  const doneCount = rows.filter((row) => row.stage === '已完成').length;
  const reviewCount = rows.filter((row) => row.stage === '待确认').length;

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#fbf8f4] text-slate-900">
      {/* 柔和暖琥珀氛围光晕 + 细微点阵网格，与入口页视觉统一 */}
      <div className="pointer-events-none fixed inset-0 overflow-hidden" aria-hidden="true">
        <div className="absolute -left-24 top-12 size-[30rem] rounded-full bg-amber-200/35 blur-[110px]" />
        <div className="absolute -right-24 top-28 size-[28rem] rounded-full bg-orange-200/35 blur-[110px]" />
        <div className="absolute bottom-0 left-1/2 size-[26rem] -translate-x-1/2 rounded-full bg-yellow-100/30 blur-[120px]" />
        <div className="absolute inset-0 opacity-[0.28] [background-image:linear-gradient(rgba(148,163,184,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(148,163,184,0.12)_1px,transparent_1px)] [background-size:32px_32px] [mask-image:linear-gradient(to_bottom,black_10%,black_75%,transparent)]" />
      </div>

      {/* 统一全站 sticky 毛玻璃导航栏 */}
      <header className="sticky top-0 z-30 flex min-h-16 shrink-0 flex-wrap items-center justify-between gap-2 border-b border-amber-200/50 bg-white/80 px-4 py-2 shadow-[0_4px_24px_-16px_rgba(15,23,42,0.18)] backdrop-blur-xl md:px-6">
        <div className="flex min-w-0 flex-wrap items-center gap-3">
          <HomeBackButton onClick={onBack} />
          <ModuleQuickNav current="creative" onNavigate={onNavigate} />
          <CreativeSubNav
            current="copy-transfer"
            onSwitchVideo={onSwitchToVideo}
            onSwitchClip={onSwitchToClip}
            onSwitchCopy={onSwitchToCopy}
            onSwitchVoiceTransfer={onSwitchToVoiceTransfer}
            onSwitchCopyTransfer={() => {}}
          />
        </div>
        <div className="hidden items-center gap-2 rounded-full border border-amber-200/80 bg-amber-50/75 px-3 py-1 text-xs font-bold text-amber-800 sm:inline-flex">
          <span className={cn('size-2 rounded-full', activeRow ? 'animate-pulse bg-orange-500' : doneCount > 0 ? 'bg-emerald-500' : 'bg-amber-400')} />
          {activeRow ? `${activeRow.stage} · ${activeRow.progress ?? 0}%` : rows.length > 0 ? `队列 ${doneCount}/${rows.length} 已完成` : '等待素材'}
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-7xl flex-1 space-y-5 p-4 pb-20 md:p-6">
        {/* 顶部工作台 Hero 卡 */}
        <section className="relative overflow-hidden rounded-[28px] border border-white/90 bg-white/85 px-5 py-5 shadow-[0_20px_50px_-34px_rgba(15,23,42,0.3)] backdrop-blur-xl sm:px-7">
          <div className="pointer-events-none absolute -right-12 -top-16 size-56 rounded-full bg-gradient-to-br from-amber-200/45 to-orange-200/45 blur-3xl" />
          <div className="relative flex flex-col gap-4 lg:flex-row lg:items-center lg:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <span className="flex size-13 shrink-0 items-center justify-center rounded-[18px] bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-200/80">
                <FileAudio className="size-6" strokeWidth={2.2} />
              </span>
              <div className="min-w-0">
                <div className="flex flex-wrap items-center gap-2">
                  <h1 className="text-xl font-black tracking-[-0.025em] text-slate-950 sm:text-2xl">文案转移</h1>
                  <span className="rounded-full border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50 px-2.5 py-0.5 text-[11px] font-bold text-amber-800">
                    原声局部改写
                  </span>
                </div>
                <p className="mt-1 text-sm text-slate-500">对照原产品与目标产品信息，精准局部替换口播文案并生成原音色 MP3</p>
              </div>
            </div>

            {/* KPI 统计胶囊 */}
            <div className="flex flex-wrap items-center gap-2">
              <div className="inline-flex items-center gap-2 rounded-2xl border border-slate-200/80 bg-white/90 px-3.5 py-2 shadow-2xs">
                <span className="text-[11px] font-bold text-slate-400">总素材</span>
                <span className="font-mono text-base font-black text-slate-900 tabular-nums">{rows.length}</span>
              </div>
              <div className="inline-flex items-center gap-2 rounded-2xl border border-emerald-200/80 bg-emerald-50/70 px-3.5 py-2 shadow-2xs">
                <span className="text-[11px] font-bold text-emerald-700">已完成</span>
                <span className="font-mono text-base font-black text-emerald-700 tabular-nums">{doneCount}</span>
              </div>
              {reviewCount > 0 && (
                <div className="inline-flex items-center gap-2 rounded-2xl border border-amber-300 bg-amber-50 px-3.5 py-2 shadow-2xs">
                  <span className="size-2 animate-pulse rounded-full bg-amber-500" />
                  <span className="text-[11px] font-bold text-amber-800">待核对</span>
                  <span className="font-mono text-base font-black text-amber-800 tabular-nums">{reviewCount}</span>
                </div>
              )}
            </div>
          </div>
        </section>

        {/* 模块 A：产品信息对照映射卡 */}
        <section className="rounded-[28px] border border-white/90 bg-white/90 p-5 shadow-[0_22px_55px_-34px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:p-6">
          <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-amber-50 px-2.5 py-0.5 text-[11px] font-black tracking-wide text-amber-700">
                STEP 01 · 产品映射
              </div>
              <h2 className="mt-2 text-lg font-black tracking-tight text-slate-950">产品信息对照</h2>
              <p className="mt-0.5 text-xs text-slate-500">原产品与目标产品逐项对应；原产品填写了某项，目标产品也要对应填写</p>
            </div>

            {/* 转换方案库工具条（提升到卡片右上角） */}
            <div className="flex flex-wrap items-center gap-2">
              {templates.length > 0 && (
                <select
                  className="h-9 max-w-[220px] rounded-xl border border-slate-200 bg-white px-3 text-xs font-bold text-slate-700 shadow-2xs outline-none transition focus:border-amber-400 focus:ring-2 focus:ring-amber-100"
                  defaultValue=""
                  disabled={busy}
                  onChange={(e) => {
                    const item = templates.find((t) => t.label === e.target.value);
                    if (item) setProfile(item.profile);
                  }}
                >
                  <option value="">切换已保存方案 ({templates.length})</option>
                  {templates.map((item) => (
                    <option key={item.label} value={item.label}>
                      {item.label}
                    </option>
                  ))}
                </select>
              )}
              <button
                type="button"
                disabled={busy}
                onClick={saveTemplate}
                className="inline-flex h-9 items-center gap-1.5 rounded-xl border border-amber-200 bg-amber-50/90 px-3.5 text-xs font-bold text-amber-800 shadow-2xs transition hover:bg-amber-100 disabled:opacity-50"
              >
                <BookmarkPlus className="size-3.5" />
                保存当前方案
              </button>
            </div>
          </div>

          {/* 左右对照映射面板 */}
          <div className="mt-5 rounded-[22px] border border-slate-200/75 bg-gradient-to-br from-slate-50/60 via-white to-amber-50/35 p-4 sm:p-5">
            {/* 桌面端列头 */}
            <div className="mb-3 hidden items-center gap-3 md:grid md:grid-cols-[10rem_minmax(0,1fr)_2.25rem_minmax(0,1fr)]">
              <div className="text-[11px] font-bold uppercase tracking-wider text-slate-400">对照维度</div>
              <div className="flex items-center justify-between rounded-xl border border-slate-200/80 bg-slate-100/80 px-3.5 py-2">
                <span className="text-xs font-black text-slate-700">原产品</span>
                <span className="rounded-md bg-white px-1.5 py-0.5 font-mono text-[10px] font-bold text-slate-400">SOURCE</span>
              </div>
              <div className="flex justify-center">
                <span className="flex size-7 items-center justify-center rounded-full bg-amber-100 text-amber-700">
                  <ArrowRight className="size-3.5" />
                </span>
              </div>
              <div className="flex items-center justify-between rounded-xl border border-amber-200/80 bg-gradient-to-r from-amber-50 to-orange-50 px-3.5 py-2">
                <span className="text-xs font-black text-amber-900">目标产品</span>
                <span className="rounded-md bg-white/90 px-1.5 py-0.5 font-mono text-[10px] font-bold text-amber-600">TARGET</span>
              </div>
            </div>

            <div className="space-y-3">
              {fields.map(({ key, label, required, sourceHint, targetHint, icon: FieldIcon }) => (
                <div key={key} className="grid items-center gap-2.5 md:grid-cols-[10rem_minmax(0,1fr)_2.25rem_minmax(0,1fr)] md:gap-3">
                  <div className="flex items-center gap-2 text-xs font-bold text-slate-700">
                    <span className="flex size-6 shrink-0 items-center justify-center rounded-lg bg-white text-amber-600 shadow-2xs ring-1 ring-slate-200/70">
                      <FieldIcon className="size-3.5" />
                    </span>
                    <span>
                      {label}
                      {required && <span className="ml-0.5 text-rose-500">*</span>}
                    </span>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold text-slate-400 md:sr-only">原产品</span>
                    <input
                      className={sourceInputClass}
                      aria-label={`原产品${label}`}
                      value={profile.source[key]}
                      placeholder={sourceHint}
                      disabled={busy}
                      onChange={(e) => setProfile((value) => ({ ...value, source: { ...value.source, [key]: e.target.value } }))}
                    />
                  </label>
                  <div className="hidden justify-center md:flex">
                    <span className="flex size-6 items-center justify-center rounded-full border border-amber-200/80 bg-white text-amber-500 shadow-2xs">
                      <ArrowRight className="size-3" />
                    </span>
                  </div>
                  <label className="block">
                    <span className="mb-1 block text-[11px] font-semibold text-amber-700 md:sr-only">目标产品</span>
                    <input
                      className={targetInputClass}
                      aria-label={`目标产品${label}`}
                      value={profile.target[key]}
                      placeholder={targetHint}
                      disabled={busy}
                      onChange={(e) => setProfile((value) => ({ ...value, target: { ...value.target, [key]: e.target.value } }))}
                    />
                  </label>
                </div>
              ))}
            </div>
          </div>

          {/* 额外调整要求 */}
          <div className="mt-4 rounded-2xl border border-slate-200/80 bg-slate-50/50 p-4">
            <label className="block text-xs font-bold text-slate-700">
              额外调整要求 <span className="font-normal text-slate-400">（可选 · 用来约束 AI 保留哪些故事、语气或禁用词）</span>
              <textarea
                className="mt-2 min-h-[72px] w-full resize-y rounded-xl border border-slate-200/90 bg-white px-3.5 py-2.5 text-sm text-slate-900 outline-none transition placeholder:text-slate-400 focus:border-amber-400 focus:ring-4 focus:ring-amber-100/80 disabled:opacity-60"
                value={profile.instructions}
                placeholder="例如：保留曾国藩的故事和寓意，只调整产品形态与摆放场景表述"
                disabled={busy}
                onChange={(e) => setProfile((value) => ({ ...value, instructions: e.target.value }))}
              />
            </label>
          </div>
        </section>

        {/* 模块 B：批量素材投放与操作栏 */}
        <section className="rounded-[28px] border border-white/90 bg-white/90 p-5 shadow-[0_22px_55px_-34px_rgba(15,23,42,0.28)] backdrop-blur-xl sm:p-6">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="inline-flex items-center gap-1.5 rounded-full bg-orange-50 px-2.5 py-0.5 text-[11px] font-black tracking-wide text-orange-700">
                STEP 02 · 批量处理
              </div>
              <h2 className="mt-2 text-lg font-black tracking-tight text-slate-950">上传素材与批量改写</h2>
              <p className="mt-0.5 text-xs text-slate-500">支持一次拖入多条本地音视频；普通条目自动完成，复杂素材会停下供你核对</p>
            </div>
            <span className="rounded-full border border-slate-200/80 bg-slate-50 px-3 py-1 text-xs font-semibold text-slate-500">
              单条最长 3 分钟 · 临时音轨保留 2 小时
            </span>
          </div>

          {/* 多文件拖拽投放区 */}
          <label
            onDragOver={(event) => {
              event.preventDefault();
              if (!busy) setDraggingFiles(true);
            }}
            onDragLeave={() => setDraggingFiles(false)}
            onDrop={(event) => {
              event.preventDefault();
              setDraggingFiles(false);
              if (!busy && event.dataTransfer.files?.length) appendMediaFiles(event.dataTransfer.files);
            }}
            className={cn(
              'mt-4 flex cursor-pointer flex-col items-center justify-center rounded-[20px] border-2 border-dashed px-5 py-7 text-center transition-all',
              busy && 'cursor-not-allowed opacity-60',
              draggingFiles
                ? 'border-amber-500 bg-amber-50/80 ring-4 ring-amber-100'
                : 'border-amber-200/90 bg-gradient-to-br from-amber-50/45 via-white to-orange-50/40 hover:border-amber-400 hover:bg-amber-50/55'
            )}
          >
            <div className="flex size-12 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-lg shadow-amber-200/80">
              <Upload className="size-5" />
            </div>
            <div className="mt-3 text-sm font-black text-slate-900">点击选择或直接拖入多条本地音视频</div>
            <div className="mt-1.5 flex flex-wrap items-center justify-center gap-1.5">
              {['MP4', 'MOV', 'MP3', 'WAV', 'M4A', '支持批量'].map((tag) => (
                <span key={tag} className="rounded-full border border-amber-100 bg-white/90 px-2.5 py-0.5 text-[10px] font-bold text-slate-500">
                  {tag}
                </span>
              ))}
            </div>
            <input
              hidden
              type="file"
              multiple
              accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov"
              disabled={busy}
              onChange={(e) => {
                if (e.target.files) appendMediaFiles(e.target.files);
                e.target.value = '';
              }}
            />
          </label>

          {/* 主次操作按钮条 */}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3">
            <div className="flex flex-wrap items-center gap-2.5">
              <button
                type="button"
                disabled={busy || !rows.some((row) => row.stage === '待处理' || row.stage === '失败')}
                onClick={analyzeAll}
                className="inline-flex h-11 items-center gap-2 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-5 text-sm font-black text-white shadow-[0_12px_24px_-10px_rgba(245,158,11,0.55)] transition hover:brightness-105 active:scale-[0.99] disabled:cursor-not-allowed disabled:opacity-40 disabled:shadow-none"
              >
                <Play className="size-4 fill-current" />
                开始批量处理
              </button>
              <button
                type="button"
                disabled={busy || !rows.some((row) => row.approved && row.planId && row.stage !== '已完成')}
                onClick={renderAll}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-slate-200 bg-white px-4 text-sm font-bold text-slate-700 shadow-2xs transition hover:border-amber-200 hover:bg-amber-50/50 hover:text-amber-800 disabled:opacity-40"
              >
                <Sparkles className="size-4 text-amber-500" />
                生成已确认的 MP3
              </button>
              <button
                type="button"
                disabled={busy || !rows.some((row) => row.result)}
                onClick={downloadAll}
                className="inline-flex h-11 items-center gap-1.5 rounded-xl border border-emerald-200 bg-emerald-50 px-4 text-sm font-bold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-40"
              >
                <FolderArchive className="size-4" />
                打包已完成音频
              </button>
              {archive && (
                <a
                  className="inline-flex h-11 items-center gap-1.5 rounded-xl bg-emerald-600 px-4 text-sm font-black text-white shadow-sm transition hover:bg-emerald-700"
                  href={archive.archiveUrl}
                  download={archive.fileName}
                >
                  <Download className="size-4" />
                  下载 MP3 合集
                </a>
              )}
            </div>
            <span className="px-1 text-xs font-semibold text-slate-500 tabular-nums">
              共 {rows.length} 条 · 已完成 {doneCount} 条
            </span>
          </div>

          {/* 实时处理流光进度卡 */}
          {activeRow && (
            <div
              role="status"
              aria-live="polite"
              className="relative mt-5 overflow-hidden rounded-[22px] border border-amber-300/20 bg-gradient-to-r from-[#271811] via-[#3a2214] to-[#4b2b13] p-5 text-white shadow-xl shadow-amber-950/15"
            >
              <div className="copy-transfer-scan pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-amber-300/15 to-transparent" />
              <div className="relative flex items-center gap-4">
                <span className="flex size-11 shrink-0 items-center justify-center rounded-2xl border border-amber-300/25 bg-amber-300/10">
                  <LoaderCircle className="size-5 animate-spin text-amber-200 motion-reduce:animate-none" />
                </span>
                <div className="min-w-0 flex-1">
                  <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-amber-200">
                    LIVE PROCESS · {activeRow.stage}
                  </div>
                  <div className="mt-0.5 truncate text-sm font-bold">{activeRow.file.name}</div>
                  <p className="mt-1 flex flex-wrap items-center gap-2 text-xs text-amber-100/85">
                    <span>{activeRow.detail || '正在准备'}</span>
                    <span className="inline-flex items-center gap-1 rounded-full bg-white/10 px-2 py-0.5 font-mono text-[11px] tabular-nums text-amber-200">
                      <Clock className="size-3" />
                      {Math.floor(Math.max(0, now - (activeRow.startedAt || now)) / 60000)}分
                      {String(Math.floor(Math.max(0, now - (activeRow.startedAt || now)) / 1000) % 60).padStart(2, '0')}秒
                    </span>
                  </p>
                </div>
                <span className="font-mono text-2xl font-black tabular-nums text-amber-100">
                  {activeRow.progress ?? 0}
                  <small className="text-sm">%</small>
                </span>
              </div>
              <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/15">
                <div
                  className="h-full rounded-full bg-gradient-to-r from-amber-400 to-orange-300 transition-[width] duration-700"
                  style={{ width: `${activeRow.progress ?? 0}%` }}
                />
              </div>
              <p className="relative mt-2.5 text-[11px] text-amber-100/60">
                上传百分比来自文件传输；分析与生成百分比表示当前阶段进度，页面关闭会停止后续排队任务。
              </p>
            </div>
          )}

          {!activeRow && message && (
            <div className="mt-4 flex items-center gap-2 rounded-2xl border border-amber-200/80 bg-amber-50/85 px-4 py-3 text-sm font-semibold text-amber-900">
              <span className="size-2 shrink-0 rounded-full bg-amber-500" />
              <span>{message}</span>
            </div>
          )}
        </section>

        {/* 模块 C：素材队列与逐句 Diff 核对区 */}
        <section className="space-y-4">
          <div className="flex items-center justify-between px-1">
            <div className="flex items-center gap-2.5">
              <span className="rounded-full bg-slate-900 px-2.5 py-0.5 text-[11px] font-black text-white">STEP 03</span>
              <h2 className="text-lg font-black tracking-tight text-slate-950">素材队列与文案核对</h2>
            </div>
            {rows.length > 0 && (
              <span className="text-xs font-semibold text-slate-400">支持逐句微调，改完点击确认后统一生成 MP3</span>
            )}
          </div>

          {rows.length === 0 ? (
            <div className="rounded-[28px] border border-dashed border-amber-200/90 bg-white/75 px-6 py-12 text-center shadow-xs backdrop-blur-md">
              <div className="mx-auto flex size-14 items-center justify-center rounded-[20px] bg-gradient-to-br from-amber-100 to-orange-100 text-amber-600">
                <FileAudio className="size-6" />
              </div>
              <h3 className="mt-4 text-base font-black text-slate-900">还没有添加待处理的素材</h3>
              <p className="mx-auto mt-1.5 max-w-md text-xs leading-5 text-slate-500">
                先在上方填好原产品与目标产品对照信息，再拖入音视频素材，系统会自动识别逐句台词并标出需要替换的局部词汇。
              </p>
              <div className="mx-auto mt-5 flex max-w-lg flex-wrap items-center justify-center gap-2 text-[11px] font-bold text-slate-600">
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1">1. 填产品对照</span>
                <ArrowRight className="size-3 text-amber-400" />
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1">2. 拖入音视频</span>
                <ArrowRight className="size-3 text-amber-400" />
                <span className="rounded-full border border-slate-200 bg-white px-3 py-1">3. 核对改写并导出</span>
              </div>
            </div>
          ) : (
            rows.map((row) => {
              const isRowActive = ['上传中', '分析中', '生成中'].includes(row.stage);
              return (
                <article
                  key={row.key}
                  className={cn(
                    'overflow-hidden rounded-[26px] border bg-white/95 p-5 shadow-[0_18px_45px_-34px_rgba(15,23,42,0.3)] backdrop-blur-md transition-all sm:p-6',
                    isRowActive
                      ? 'border-amber-300 ring-4 ring-amber-100/70'
                      : row.stage === '已完成'
                        ? 'border-emerald-200/90'
                        : 'border-white/90'
                  )}
                >
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <div className="flex min-w-0 items-center gap-3.5">
                      <span
                        className={cn(
                          'flex size-11 shrink-0 items-center justify-center rounded-2xl',
                          row.stage === '已完成'
                            ? 'bg-emerald-50 text-emerald-600'
                            : row.stage === '失败'
                              ? 'bg-red-50 text-red-600'
                              : 'bg-amber-50 text-amber-700'
                        )}
                      >
                        {row.stage === '已完成' ? <CheckCircle2 className="size-5" /> : <FileAudio className="size-5" />}
                      </span>
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h3 className="truncate text-sm font-black text-slate-950">{row.file.name}</h3>
                          <span className={cn('rounded-full border px-2.5 py-0.5 text-[10px] font-black', getStageBadgeClass(row.stage))}>
                            {row.stage}
                          </span>
                        </div>
                        {row.detail && (
                          <p className={cn('mt-0.5 text-xs', row.stage === '失败' ? 'text-red-600' : row.stage === '待确认' ? 'text-amber-700' : 'text-slate-500')}>
                            {row.detail}
                          </p>
                        )}
                      </div>
                    </div>

                    <div className="flex items-center gap-2">
                      {row.result && (
                        <a
                          className="inline-flex items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 py-2 text-xs font-black text-white shadow-xs transition hover:bg-slate-700"
                          href={row.result.audioUrl}
                          download={row.result.fileName}
                        >
                          <Download className="size-3.5" />
                          下载 MP3
                        </a>
                      )}
                      {!busy && row.stage === '待处理' && (
                        <button
                          type="button"
                          className="inline-flex items-center gap-1 rounded-xl border border-slate-200 px-3 py-1.5 text-xs font-bold text-slate-500 transition hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                          onClick={() => setRows((old) => old.filter((item) => item.key !== row.key))}
                        >
                          <Trash2 className="size-3.5" />
                          移除
                        </button>
                      )}
                    </div>
                  </div>

                  {isRowActive && (
                    <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-amber-100">
                      <div
                        className="h-full rounded-full bg-gradient-to-r from-amber-500 to-orange-400 transition-[width] duration-700"
                        style={{ width: `${row.progress ?? 0}%` }}
                      />
                    </div>
                  )}

                  {row.error && (
                    <div className="mt-3 rounded-xl border border-red-200 bg-red-50 px-3.5 py-2.5 text-xs font-bold text-red-700">
                      {row.error}
                    </div>
                  )}

                  {/* 原素材与多说话人紧凑试听区 */}
                  {(row.sourceId || (row.speakers && row.speakers.length > 1) || row.result) && (
                    <div className="mt-4 flex flex-wrap gap-3 rounded-2xl border border-slate-100 bg-slate-50/70 p-3.5">
                      {row.sourceId && (
                        <label className="min-w-[220px] flex-1 text-[11px] font-bold text-slate-500">
                          原素材试听
                          <audio className="mt-1.5 h-8 w-full" controls src={`/uploads/${row.sourceId}_vt_source`} />
                        </label>
                      )}
                      {row.result && (
                        <label className="min-w-[220px] flex-1 text-[11px] font-bold text-emerald-700">
                          成品 MP3 试听
                          <audio className="mt-1.5 h-8 w-full" controls src={row.result.audioUrl} />
                        </label>
                      )}
                      {row.speakers &&
                        row.speakers.length > 1 &&
                        row.speakers.map((speaker) => (
                          <label key={speaker.vocalUrl} className="min-w-[200px] flex-1 text-[11px] font-bold text-slate-600">
                            {speaker.label} · {speaker.durationSeconds.toFixed(1)}s
                            <audio className="mt-1.5 h-8 w-full" controls src={speaker.vocalUrl} />
                          </label>
                        ))}
                    </div>
                  )}

                  {/* 逐句改写 Diff 对比卡 */}
                  {row.sentences && (
                    <div className="mt-4 space-y-3">
                      {row.sentences.map((sentence, index) => {
                        const isModified = sentence.changes.length > 0 || row.revisions?.[index] !== sentence.original;
                        return (
                          <div
                            key={index}
                            className={cn(
                              'rounded-2xl border p-4 text-sm transition',
                              isModified
                                ? 'border-amber-200/90 bg-gradient-to-br from-amber-50/60 via-white to-orange-50/35'
                                : 'border-slate-200/70 bg-slate-50/60'
                            )}
                          >
                            {/* 句头徽章栏 */}
                            <div className="flex flex-wrap items-center justify-between gap-2">
                              <div className="flex flex-wrap items-center gap-1.5">
                                <span className="rounded-md bg-slate-900 px-1.5 py-0.5 font-mono text-[10px] font-bold text-white">
                                  #{String(index + 1).padStart(2, '0')}
                                </span>
                                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 font-mono text-[11px] font-semibold text-slate-600">
                                  {sentence.start.toFixed(1)}s – {sentence.end.toFixed(1)}s
                                </span>
                                <span className="rounded-full bg-slate-200/70 px-2 py-0.5 text-[11px] font-bold text-slate-700">
                                  说话人 {sentence.speakerId}
                                </span>
                                {isModified && (
                                  <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[11px] font-bold text-amber-800">
                                    局部已改写
                                  </span>
                                )}
                                {sentence.needsReview && (
                                  <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[11px] font-bold text-rose-700">
                                    需检查时长
                                  </span>
                                )}
                              </div>
                            </div>

                            {/* 原文 */}
                            <p className="mt-2.5 rounded-xl bg-white/80 px-3 py-2 text-xs leading-5 text-slate-500 ring-1 ring-slate-200/60">
                              <span className="mr-1.5 font-bold text-slate-400">原文</span>
                              {sentence.original}
                            </p>

                            {/* 可视化 Diff 替换标签 */}
                            {sentence.changes.length > 0 && (
                              <div className="mt-2 flex flex-wrap items-center gap-1.5">
                                {sentence.changes.map((change, changeIdx) => (
                                  <span
                                    key={changeIdx}
                                    className="inline-flex items-center gap-1.5 rounded-full border border-amber-200 bg-white px-2.5 py-1 text-[11px] font-bold shadow-2xs"
                                  >
                                    <span className="text-rose-500 line-through decoration-rose-400/70">{change.from}</span>
                                    <ArrowRight className="size-3 text-amber-500" />
                                    <span className="text-emerald-700">{change.to}</span>
                                  </span>
                                ))}
                              </div>
                            )}

                            {/* 新文案微调输入 */}
                            <input
                              className="mt-2.5 w-full rounded-xl border border-amber-200/80 bg-white px-3.5 py-2.5 text-sm font-medium text-slate-900 outline-none transition focus:border-amber-400 focus:ring-4 focus:ring-amber-100 disabled:opacity-60"
                              aria-label={`第 ${index + 1} 句新文案`}
                              value={row.revisions?.[index] || ''}
                              disabled={busy || row.stage === '已完成'}
                              onChange={(e) => {
                                const revisions = [...(row.revisions || [])];
                                revisions[index] = e.target.value;
                                patch(row.key, { revisions, approved: false, stage: '待确认' });
                              }}
                            />
                          </div>
                        );
                      })}

                      {row.stage !== '已完成' && (
                        <div className="flex justify-end pt-1">
                          <button
                            type="button"
                            disabled={busy}
                            className="inline-flex items-center gap-1.5 rounded-xl bg-gradient-to-r from-amber-500 to-orange-500 px-4 py-2.5 text-xs font-black text-white shadow-sm shadow-amber-200 transition hover:brightness-105 disabled:opacity-40"
                            onClick={() => patch(row.key, { approved: true, stage: '待生成', error: '' })}
                          >
                            <CheckCircle2 className="size-4" />
                            确认这条文案
                          </button>
                        </div>
                      )}
                    </div>
                  )}
                </article>
              );
            })
          )}
        </section>
      </main>
    </div>
  );
}

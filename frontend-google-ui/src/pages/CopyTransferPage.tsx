import { useEffect, useState } from 'react';
import { ArrowRight, CheckCircle2, Download, FileAudio, LoaderCircle, Sparkles, Upload, Waves } from 'lucide-react';
import HomeBackButton from '@/src/components/HomeBackButton';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import CreativeSubNav from '@/src/components/CreativeSubNav';
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

const fields: { key: ProductField; label: string; sourceHint: string; targetHint: string }[] = [
  { key: 'name', label: '产品名称 / 形态 *', sourceHint: '曾国藩无纺布挂画', targetHint: '曾国藩铝合金边框摆台' },
  { key: 'usage', label: '使用 / 安装方式 *', sourceHint: '挂在墙上', targetHint: '摆放在桌面上' },
  { key: 'material', label: '材质', sourceHint: '无纺布画面', targetHint: '木板画芯' },
  { key: 'structure', label: '结构 / 配件', sourceHint: '无边框、挂绳', targetHint: '铝合金边框、一体支撑' },
  { key: 'scenes', label: '适用场景', sourceHint: '卧室床头墙、客厅墙面', targetHint: '床头柜、书桌、玄关柜' },
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
    xhr.upload.onprogress = (event) => { if (event.lengthComputable) onProgress(Math.round(event.loaded / event.total * 100)); };
    xhr.onerror = () => reject(new Error('上传连接中断，请重试'));
    xhr.onload = () => {
      try {
        const data = JSON.parse(xhr.responseText || '{}');
        if (xhr.status < 200 || xhr.status >= 300) throw new Error(data.error || `上传失败（HTTP ${xhr.status}）`);
        resolve(data);
      } catch (error) { reject(error); }
    };
    xhr.send(file);
  });
}

export default function CopyTransferPage({ onBack, onNavigate, onSwitchToVideo, onSwitchToClip, onSwitchToCopy, onSwitchToVoiceTransfer }: Props) {
  const [templates, setTemplates] = useState<{ label: string; profile: Profile }[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem('copy-transfer-templates') || '[]'); return Array.isArray(saved) ? saved.map((item) => ({ label: String(item.label || ''), profile: normalizeProfile(item.profile) })) : []; }
    catch { return []; }
  });
  const [profile, setProfile] = useState<Profile>(() => {
    try { return normalizeProfile(JSON.parse(localStorage.getItem('copy-transfer-profile') || '{}')); }
    catch { return emptyProfile(); }
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [message, setMessage] = useState('');
  const [archive, setArchive] = useState<{ archiveUrl: string; fileName: string } | null>(null);
  const patch = (key: string, update: Partial<Row>) => setRows((current) => current.map((row) => row.key === key ? { ...row, ...update } : row));
  useEffect(() => {
    if (!busy) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [busy]);

  async function analyzeOne(row: Row, currentProfile: Profile) {
    try {
      let sourceId = row.sourceId;
      if (!sourceId) {
        patch(row.key, { stage: '上传中', detail: '上传本地素材', progress: 0, startedAt: Date.now(), error: '' });
        const source = await uploadFile(row.file, (percent) => patch(row.key, { detail: percent === 100 ? '上传完成，服务端正在校验音轨' : `上传本地素材 · ${percent}%`, progress: percent }));
        sourceId = source.sourceId;
        patch(row.key, { sourceId });
      }
      patch(row.key, { stage: '分析中', detail: '进入分析队列', progress: 0, startedAt: Date.now() });
      const task = await parseResponse(await fetch('/api/copy-transfer/analyze', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, profile: currentProfile }),
      }));
      const plan = await waitForJob(task.jobId, (detail, progress) => patch(row.key, { detail, progress }));
      const reviewedRow: Row = {
        ...row, sourceId, planId: plan.planId, sentences: plan.sentences, speakers: plan.speakers,
        revisions: plan.sentences.map((s: Sentence) => s.revised), needsReview: plan.needsReview,
        approved: !plan.needsReview, stage: plan.needsReview ? '待确认' : '待生成', detail: plan.needsReview ? '等待试听并核对文案' : '文案分析完成', progress: 100,
      };
      patch(row.key, {
        planId: plan.planId, sentences: plan.sentences, speakers: plan.speakers, revisions: plan.sentences.map((s: Sentence) => s.revised),
        needsReview: plan.needsReview, stage: plan.needsReview ? '待确认' : '待生成', approved: !plan.needsReview, detail: plan.needsReview ? '等待试听并核对文案' : '文案分析完成', progress: 100,
      });
      if (!plan.needsReview) await renderOne(reviewedRow);
    } catch (error) {
      patch(row.key, { stage: '失败', detail: '处理遇到问题', error: error instanceof Error ? error.message : '分析失败' });
    }
  }

  async function analyzeAll() {
    if (busy || !profile.source.name.trim() || !profile.source.usage.trim() || !profile.target.name.trim() || !profile.target.usage.trim()) { setMessage('请先填写原产品和目标产品的名称、使用方式'); return; }
    setBusy(true);
    setMessage('正在逐条分析，普通条目自动生成；复杂素材需要你确认。请保持页面打开。');
    try {
      // One at a time, including upload and ASR, to protect the shared server.
      for (const row of rows.filter((item) => item.stage === '待处理' || item.stage === '失败')) await analyzeOne(row, profile);
    } finally { setBusy(false); }
  }

  async function renderOne(row: Row) {
    if (!row.planId || !row.revisions) return;
    patch(row.key, { stage: '生成中', detail: '准备阿里云配音', progress: 0, startedAt: Date.now(), error: '' });
    try {
      const task = await parseResponse(await fetch('/api/copy-transfer/render', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: row.planId, revisions: row.revisions }),
      }));
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
    } finally { setBusy(false); }
  }

  async function downloadAll() {
    if (busy) return;
    setBusy(true);
    setMessage('正在打包已完成的 MP3…');
    try {
      const task = await parseResponse(await fetch('/api/copy-transfer/bundle', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ outputIds: rows.map((row) => row.result?.outputId).filter(Boolean) }),
      }));
      const result = await waitForJob(task.jobId, (detail) => setMessage(`正在打包 · ${detail}`));
      setArchive(result);
      setMessage('打包完成，可以下载 MP3 合集。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '打包失败'); }
    finally { setBusy(false); }
  }

  const input = 'w-full rounded-xl border border-slate-200 bg-slate-50/80 px-4 py-3 text-sm text-slate-900 outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100 disabled:opacity-60';
  const activeRow = rows.find((row) => ['上传中', '分析中', '生成中'].includes(row.stage));
  const doneCount = rows.filter((row) => row.stage === '已完成').length;
  const reviewCount = rows.filter((row) => row.stage === '待确认').length;
  function saveTemplate() {
    if (!profile.source.name.trim() || !profile.source.usage.trim() || !profile.target.name.trim() || !profile.target.usage.trim()) { setMessage('先填写两边的产品名称与使用方式'); return; }
    const label = `${profile.source.name} → ${profile.target.name}`;
    const next = [...templates.filter((item) => item.label !== label), { label, profile }].slice(-30);
    setTemplates(next);
    localStorage.setItem('copy-transfer-templates', JSON.stringify(next));
    localStorage.setItem('copy-transfer-profile', JSON.stringify(profile));
    setMessage(`已保存「${label}」`);
  }
  return (
    <div className="min-h-screen bg-[#f3f6fa] px-4 py-5 text-slate-900 sm:px-6">
      <header className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
        <HomeBackButton onClick={onBack} />
        <ModuleQuickNav current="creative" onNavigate={onNavigate} />
        <CreativeSubNav current="copy-transfer" onSwitchVideo={onSwitchToVideo} onSwitchClip={onSwitchToClip} onSwitchCopy={onSwitchToCopy} onSwitchVoiceTransfer={onSwitchToVoiceTransfer} onSwitchCopyTransfer={() => {}} />
      </header>
      <main className="mx-auto mt-7 max-w-7xl space-y-6 pb-20">
        <section className="relative overflow-hidden rounded-[2rem] bg-[#0a182b] px-6 py-8 text-white shadow-[0_24px_65px_-35px_rgba(7,27,55,0.8)] sm:px-10 sm:py-10">
          <div className="pointer-events-none absolute inset-0 opacity-30 [background-image:linear-gradient(rgba(103,232,249,0.12)_1px,transparent_1px),linear-gradient(90deg,rgba(103,232,249,0.12)_1px,transparent_1px)] [background-size:26px_26px] [mask-image:linear-gradient(to_right,transparent,black)]" />
          <div className="pointer-events-none absolute -right-14 -top-20 size-72 rounded-full bg-cyan-500/20 blur-3xl" />
          <div className="relative grid gap-8 lg:grid-cols-[1fr_22rem] lg:items-center">
            <div>
              <div className="mb-4 inline-flex items-center gap-2 rounded-full border border-cyan-300/20 bg-cyan-300/10 px-3 py-1 text-xs font-bold tracking-[0.18em] text-cyan-200"><Sparkles className="size-3.5" /> CREATIVE AUDIO STUDIO</div>
              <h1 className="text-3xl font-black tracking-tight sm:text-4xl">文案转移<span className="ml-3 text-cyan-300">/</span> 产品形态转换</h1>
              <p className="mt-4 max-w-2xl text-sm leading-7 text-slate-300">对照原产品与目标产品，只替换必要的文案。未改动的原声继续沿用，改动处由阿里云复刻音色，并与原 BGM 对齐输出 MP3。</p>
              <div className="mt-6 flex flex-wrap gap-2 text-xs text-slate-300">
                <span className="rounded-full border border-white/15 px-3 py-1.5">01 产品信息</span><span className="rounded-full border border-white/15 px-3 py-1.5">02 上传与分析</span><span className="rounded-full border border-white/15 px-3 py-1.5">03 核对与导出</span>
              </div>
            </div>
            <div className="relative rounded-2xl border border-cyan-300/20 bg-white/[0.06] p-5 backdrop-blur">
              <div className="flex items-center justify-between text-xs font-semibold text-cyan-100"><span className="flex items-center gap-2"><span className={`size-2 rounded-full bg-cyan-300 ${activeRow ? 'animate-pulse' : ''}`} />{activeRow ? '正在运行' : '等待任务'}</span><Waves className="size-4 text-cyan-300" /></div>
              <div className="mt-5 flex h-12 items-end gap-1.5" aria-hidden="true">{[22, 36, 27, 46, 31, 41, 19, 35, 27, 45, 30, 22, 38, 25, 33].map((height, index) => <span key={index} className={`w-full rounded-full bg-gradient-to-t from-cyan-600 to-cyan-200 ${activeRow ? 'copy-transfer-wave' : 'opacity-40'}`} style={{ height, animationDelay: `${index * 90}ms`, animationDuration: `${900 + (index % 4) * 180}ms` }} />)}</div>
              <div className="mt-5 flex items-baseline justify-between"><span className="text-xs text-slate-400">已完成素材</span><span className="text-3xl font-black tabular-nums">{doneCount}<span className="ml-1 text-sm text-slate-400">/ {rows.length}</span></span></div>
              {reviewCount > 0 && <div className="mt-2 text-xs text-amber-200">{reviewCount} 条等待人工确认</div>}
            </div>
          </div>
        </section>
        <section className="rounded-[1.75rem] border border-slate-200/80 bg-white p-5 shadow-[0_18px_55px_-42px_rgba(15,23,42,0.35)] sm:p-8">
          <div className="flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-sm font-black text-cyan-700">01</span><div><h2 className="text-lg font-bold">产品信息对照</h2><p className="mt-1 text-sm text-slate-500">左右按同一维度填写。材质、结构、场景不涉及可留空；若原产品填写了某项，目标产品也需填写对应信息。原文未提到的属性不会强行加入。</p></div></div>
          <div className="mt-6 grid gap-3 md:grid-cols-[9rem_minmax(0,1fr)_minmax(0,1fr)]">
            <div className="hidden md:block" />
            <h3 className="hidden rounded-xl bg-slate-100 px-4 py-3 font-bold text-slate-700 md:block">原产品 <span className="ml-1 text-xs font-normal text-slate-400">SOURCE</span></h3>
            <h3 className="hidden rounded-xl bg-cyan-50 px-4 py-3 font-bold text-cyan-900 md:block">目标产品 <span className="ml-1 text-xs font-normal text-cyan-600">TARGET</span></h3>
            {fields.map(({ key, label, sourceHint, targetHint }) => (
              <div className="contents" key={key}>
                <span className="self-center text-sm font-semibold text-slate-700">{label}</span>
                <label className="text-xs text-slate-500 md:text-transparent"><span className="md:sr-only">原产品</span><input className={`${input} mt-1 md:mt-0`} aria-label={`原产品${label}`} value={profile.source[key]} placeholder={sourceHint} disabled={busy} onChange={(e) => setProfile((value) => ({ ...value, source: { ...value.source, [key]: e.target.value } }))} /></label>
                <label className="text-xs text-cyan-700 md:text-transparent"><span className="md:sr-only">目标产品</span><input className={`${input} mt-1 border-cyan-100 bg-cyan-50/30 md:mt-0`} aria-label={`目标产品${label}`} value={profile.target[key]} placeholder={targetHint} disabled={busy} onChange={(e) => setProfile((value) => ({ ...value, target: { ...value.target, [key]: e.target.value } }))} /></label>
              </div>
            ))}
          </div>
          <label className="mt-6 block text-sm font-semibold">额外调整要求 <span className="font-normal text-slate-400">（可选）</span>
            <textarea className={`${input} mt-1 min-h-20`} value={profile.instructions} placeholder="例如：保留曾国藩的故事和寓意，只调整产品表述" disabled={busy} onChange={(e) => setProfile((value) => ({ ...value, instructions: e.target.value }))} />
          </label>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="rounded-xl border border-cyan-200 bg-cyan-50 px-4 py-2.5 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-100" onClick={saveTemplate}>保存转换方案</button>
            {templates.length > 0 && <select className="rounded-xl border border-slate-200 bg-white px-3 py-2.5 text-sm" defaultValue="" disabled={busy} onChange={(e) => { const item = templates.find((t) => t.label === e.target.value); if (item) setProfile(item.profile); }}>
              <option value="">选择已保存的转换方案</option>
              {templates.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
            </select>}
          </div>
        </section>
        <section className="rounded-[1.75rem] border border-slate-200/80 bg-white p-5 shadow-[0_18px_55px_-42px_rgba(15,23,42,0.35)] sm:p-8">
          <div className="mb-5 flex items-start gap-3"><span className="flex size-9 shrink-0 items-center justify-center rounded-xl bg-cyan-50 text-sm font-black text-cyan-700">02</span><div><h2 className="text-lg font-bold">上传与处理</h2><p className="mt-1 text-sm text-slate-500">支持一次选择多条本地音频或视频，系统逐条处理，复杂素材留给同事核对。</p></div></div>
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-dashed border-cyan-300 bg-cyan-50 px-4 py-3 text-sm font-semibold text-cyan-800 transition hover:bg-cyan-100"><Upload className="size-4" />添加本地音视频
              <input hidden type="file" multiple accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov" disabled={busy} onChange={(e) => {
                const files = Array.from(e.target.files || []).filter((file) => file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(mp3|wav|m4a|mp4|mov)$/i.test(file.name));
                setRows((old) => [...old, ...files.map((file) => ({ key: crypto.randomUUID(), file, stage: '待处理' as const }))]);
                e.target.value = '';
              }} />
            </label>
            <button type="button" disabled={busy || !rows.some((row) => row.stage === '待处理' || row.stage === '失败')} onClick={analyzeAll} className="flex items-center gap-2 rounded-xl bg-[#0a2640] px-5 py-3 text-sm font-semibold text-white shadow-lg shadow-cyan-950/15 transition hover:bg-[#123954] disabled:cursor-not-allowed disabled:opacity-40">开始批量处理 <ArrowRight className="size-4" /></button>
            <button type="button" disabled={busy || !rows.some((row) => row.approved && row.planId && row.stage !== '已完成')} onClick={renderAll} className="rounded-xl border border-slate-200 bg-white px-4 py-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:opacity-40">生成已确认的 MP3</button>
            <button type="button" disabled={busy || !rows.some((row) => row.result)} onClick={downloadAll} className="rounded-xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-semibold text-emerald-700 transition hover:bg-emerald-100 disabled:opacity-40">打包已完成音频</button>
            {archive && <a className="flex items-center gap-1 text-sm font-semibold text-emerald-700" href={archive.archiveUrl} download={archive.fileName}><Download className="size-4" />下载 MP3 合集</a>}
            <span className="text-sm text-slate-500">{rows.length} 条素材 · {doneCount} 条完成</span>
          </div>
          {activeRow && <div role="status" aria-live="polite" className="relative mt-6 overflow-hidden rounded-2xl border border-cyan-200 bg-gradient-to-r from-[#0b2238] to-[#10465b] p-5 text-white shadow-lg shadow-cyan-950/10">
            <div className="copy-transfer-scan pointer-events-none absolute inset-y-0 left-0 w-1/2 bg-gradient-to-r from-transparent via-cyan-300/15 to-transparent" />
            <div className="relative flex items-center gap-4"><span className="flex size-11 items-center justify-center rounded-xl border border-cyan-300/25 bg-cyan-300/10"><LoaderCircle className="size-5 animate-spin text-cyan-200 motion-reduce:animate-none" /></span><div className="min-w-0 flex-1"><div className="text-xs font-semibold uppercase tracking-[0.18em] text-cyan-200">LIVE PROCESS · {activeRow.stage}</div><div className="mt-1 truncate font-semibold">{activeRow.file.name}</div><p className="mt-1 text-sm text-cyan-100">{activeRow.detail || '正在准备'} · 已用时 {Math.floor(Math.max(0, now - (activeRow.startedAt || now)) / 60000)}分{String(Math.floor(Math.max(0, now - (activeRow.startedAt || now)) / 1000) % 60).padStart(2, '0')}秒</p></div><span className="text-2xl font-black tabular-nums text-cyan-100">{activeRow.progress ?? 0}<small className="text-sm">%</small></span></div>
            <div className="relative mt-4 h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-gradient-to-r from-cyan-400 to-teal-200 transition-[width] duration-700" style={{ width: `${activeRow.progress ?? 0}%` }} /></div>
            <p className="relative mt-2 text-xs text-slate-300">上传百分比来自文件传输；分析与生成百分比表示当前阶段进度，不代表精确剩余时间。</p>
          </div>}
          {!activeRow && message && <p className="mt-4 rounded-xl bg-cyan-50 px-4 py-3 text-sm text-cyan-800">{message}</p>}
          <p className="mt-4 text-xs text-slate-500">单条最长 3 分钟；普通条目分析后自动生成，复杂条目先试听确认。临时音轨保留约 2 小时；页面关闭会停止后续排队任务。</p>
        </section>
        <div className="space-y-4">
          <div className="flex items-center gap-3 px-1"><span className="flex size-9 items-center justify-center rounded-xl bg-cyan-50 text-sm font-black text-cyan-700">03</span><h2 className="text-lg font-bold">素材队列与文案核对</h2></div>
          {rows.map((row) => (
            <article key={row.key} className={`overflow-hidden rounded-2xl border bg-white p-5 shadow-[0_14px_40px_-32px_rgba(15,23,42,0.35)] transition ${['上传中', '分析中', '生成中'].includes(row.stage) ? 'border-cyan-300 ring-4 ring-cyan-100/60' : 'border-slate-200'}`}>
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div className="flex min-w-0 items-center gap-3"><span className={`flex size-10 shrink-0 items-center justify-center rounded-xl ${row.stage === '已完成' ? 'bg-emerald-50 text-emerald-600' : 'bg-cyan-50 text-cyan-700'}`}>{row.stage === '已完成' ? <CheckCircle2 className="size-5" /> : <FileAudio className="size-5" />}</span><div className="min-w-0"><h3 className="truncate font-semibold">{row.file.name}</h3><p className={`mt-0.5 text-xs ${row.stage === '失败' ? 'text-red-600' : row.stage === '待确认' ? 'text-amber-700' : 'text-slate-500'}`}>{row.stage}{row.detail ? ` · ${row.detail}` : ''}</p></div></div>
                <div className="flex gap-2">
                  {row.result && <a className="flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700" href={row.result.audioUrl} download={row.result.fileName}><Download className="size-4" />下载 MP3</a>}
                  {!busy && row.stage === '待处理' && <button type="button" className="text-sm text-slate-500" onClick={() => setRows((old) => old.filter((item) => item.key !== row.key))}>移除</button>}
                </div>
              </div>
              {['上传中', '分析中', '生成中'].includes(row.stage) && <div className="mt-4 h-1.5 overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 to-teal-400 transition-[width] duration-700" style={{ width: `${row.progress ?? 0}%` }} /></div>}
              {row.error && <p className="mt-3 text-sm text-red-600">{row.error}</p>}
              {row.sourceId && <label className="mt-3 block text-xs text-slate-500">原素材试听<audio className="mt-1 h-8 w-full max-w-sm" controls src={`/uploads/${row.sourceId}_vt_source`} /></label>}
              {row.speakers && row.speakers.length > 1 && <div className="mt-3 flex flex-wrap gap-3">
                {row.speakers.map((speaker) => <label key={speaker.vocalUrl} className="text-xs text-slate-600">{speaker.label} · {speaker.durationSeconds.toFixed(1)} 秒<audio className="mt-1 h-8 w-52" controls src={speaker.vocalUrl} /></label>)}
              </div>}
              {row.sentences && <div className="mt-4 space-y-3">
                {row.sentences.map((sentence, index) => (
                  <div key={index} className={`rounded-xl border p-4 text-sm ${sentence.changes.length || row.revisions?.[index] !== sentence.original ? 'border-amber-200 bg-amber-50/60' : 'border-slate-100 bg-slate-50/80'}`}>
                    <p className="text-xs text-slate-500">{sentence.start.toFixed(1)}–{sentence.end.toFixed(1)} 秒 · 说话人 {sentence.speakerId}{sentence.needsReview ? ' · 需检查长度' : ''}</p>
                    <p className="mt-1 text-slate-600">原文：{sentence.original}</p>
                    <input className={`${input} mt-2`} aria-label={`第 ${index + 1} 句新文案`} value={row.revisions?.[index] || ''} disabled={busy || row.stage === '已完成'} onChange={(e) => {
                      const revisions = [...(row.revisions || [])]; revisions[index] = e.target.value;
                      patch(row.key, { revisions, approved: false, stage: '待确认' });
                    }} />
                    {sentence.changes.length > 0 && <p className="mt-1 text-xs text-amber-800">修改：{sentence.changes.map((change) => `${change.from} → ${change.to}`).join('；')}</p>}
                  </div>
                ))}
                {row.stage !== '已完成' && <button type="button" disabled={busy} className="rounded-xl border border-amber-300 px-4 py-2 text-sm font-semibold text-amber-800 disabled:opacity-40" onClick={() => patch(row.key, { approved: true, stage: '待生成', error: '' })}>确认这条文案</button>}
              </div>}
            </article>
          ))}
        </div>
      </main>
    </div>
  );
}

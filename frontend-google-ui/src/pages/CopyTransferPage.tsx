import { useState } from 'react';
import { Download, FileAudio, LoaderCircle, Upload } from 'lucide-react';
import HomeBackButton from '@/src/components/HomeBackButton';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import CreativeSubNav from '@/src/components/CreativeSubNav';

interface Props {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
  onSwitchToVideo: () => void;
  onSwitchToClip: () => void;
  onSwitchToCopy: () => void;
  onSwitchToVoiceTransfer: () => void;
}

type Profile = Record<'sourceProduct' | 'name' | 'usage' | 'material' | 'scenes' | 'instructions', string>;
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
}

const fields: { key: keyof Profile; label: string; placeholder: string }[] = [
  { key: 'sourceProduct', label: '原产品', placeholder: '例如：无纺布挂画，挂在墙上' },
  { key: 'name', label: '目标产品名称 *', placeholder: '例如：曾国藩铝合金边框摆台' },
  { key: 'usage', label: '使用方式 *', placeholder: '例如：放在桌面，不悬挂、不粘贴' },
  { key: 'material', label: '材质与结构', placeholder: '例如：铝合金边框、木板画芯' },
  { key: 'scenes', label: '适用场景', placeholder: '例如：书桌、茶桌、床头柜' },
  { key: 'instructions', label: '补充要求', placeholder: '例如：只改产品相关表述，保留人物寓意' },
];
const emptyProfile: Profile = { sourceProduct: '', name: '', usage: '', material: '', scenes: '', instructions: '' };

async function parseResponse(response: Response) {
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || `请求失败（HTTP ${response.status}）`);
  return data;
}

async function waitForJob(jobId: string) {
  for (;;) {
    await new Promise((resolve) => setTimeout(resolve, 2000));
    const job = await parseResponse(await fetch(`/api/copy-transfer/job/${encodeURIComponent(jobId)}`, { credentials: 'include' }));
    if (job.status === 'completed') return job.result;
    if (job.status === 'failed') throw new Error(job.error || '任务失败');
  }
}

export default function CopyTransferPage({ onBack, onNavigate, onSwitchToVideo, onSwitchToClip, onSwitchToCopy, onSwitchToVoiceTransfer }: Props) {
  const [templates, setTemplates] = useState<{ label: string; profile: Profile }[]>(() => {
    try { const saved = JSON.parse(localStorage.getItem('copy-transfer-templates') || '[]'); return Array.isArray(saved) ? saved : []; }
    catch { return []; }
  });
  const [profile, setProfile] = useState<Profile>(() => {
    try { return { ...emptyProfile, ...JSON.parse(localStorage.getItem('copy-transfer-profile') || '{}') }; }
    catch { return emptyProfile; }
  });
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [archive, setArchive] = useState<{ archiveUrl: string; fileName: string } | null>(null);
  const patch = (key: string, update: Partial<Row>) => setRows((current) => current.map((row) => row.key === key ? { ...row, ...update } : row));

  async function analyzeOne(row: Row, currentProfile: Profile) {
    try {
      let sourceId = row.sourceId;
      if (!sourceId) {
        patch(row.key, { stage: '上传中', error: '' });
        const source = await parseResponse(await fetch('/api/copy-transfer/source', {
          method: 'PUT', body: row.file, credentials: 'include',
          headers: { 'Content-Type': row.file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(row.file.name) },
        }));
        sourceId = source.sourceId;
        patch(row.key, { sourceId });
      }
      patch(row.key, { stage: '分析中' });
      const task = await parseResponse(await fetch('/api/copy-transfer/analyze', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId, target: currentProfile }),
      }));
      const plan = await waitForJob(task.jobId);
      const reviewedRow: Row = {
        ...row, sourceId, planId: plan.planId, sentences: plan.sentences, speakers: plan.speakers,
        revisions: plan.sentences.map((s: Sentence) => s.revised), needsReview: plan.needsReview,
        approved: !plan.needsReview, stage: plan.needsReview ? '待确认' : '待生成',
      };
      patch(row.key, {
        planId: plan.planId, sentences: plan.sentences, speakers: plan.speakers, revisions: plan.sentences.map((s: Sentence) => s.revised),
        needsReview: plan.needsReview, stage: plan.needsReview ? '待确认' : '待生成', approved: !plan.needsReview,
      });
      if (!plan.needsReview) await renderOne(reviewedRow);
    } catch (error) {
      patch(row.key, { stage: '失败', error: error instanceof Error ? error.message : '分析失败' });
    }
  }

  async function analyzeAll() {
    if (busy || !profile.name.trim() || !profile.usage.trim()) { setMessage('请先填写目标产品名称和使用方式'); return; }
    setBusy(true);
    setMessage('正在逐条分析，普通条目自动生成；复杂素材需要你确认。请保持页面打开。');
    try {
      // One at a time, including upload and ASR, to protect the shared server.
      for (const row of rows.filter((item) => item.stage === '待处理' || item.stage === '失败')) await analyzeOne(row, profile);
    } finally { setBusy(false); }
  }

  async function renderOne(row: Row) {
    if (!row.planId || !row.revisions) return;
    patch(row.key, { stage: '生成中', error: '' });
    try {
      const task = await parseResponse(await fetch('/api/copy-transfer/render', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ planId: row.planId, revisions: row.revisions }),
      }));
      const result = await waitForJob(task.jobId);
      patch(row.key, { result, stage: '已完成' });
    } catch (error) {
      patch(row.key, { stage: '失败', error: error instanceof Error ? error.message : '生成失败' });
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
      const result = await waitForJob(task.jobId);
      setArchive(result);
      setMessage('打包完成，可以下载 MP3 合集。');
    } catch (error) { setMessage(error instanceof Error ? error.message : '打包失败'); }
    finally { setBusy(false); }
  }

  const input = 'w-full rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm outline-none focus:border-amber-400';
  function saveTemplate() {
    if (!profile.name.trim() || !profile.usage.trim()) { setMessage('先填写目标产品名称与使用方式'); return; }
    const label = `${profile.sourceProduct || '原产品'} → ${profile.name}`;
    const next = [...templates.filter((item) => item.label !== label), { label, profile }].slice(-30);
    setTemplates(next);
    localStorage.setItem('copy-transfer-templates', JSON.stringify(next));
    localStorage.setItem('copy-transfer-profile', JSON.stringify(profile));
    setMessage(`已保存「${label}」`);
  }
  return (
    <div className="min-h-screen bg-slate-50 px-4 py-5 text-slate-900 sm:px-6">
      <header className="mx-auto flex max-w-7xl flex-wrap items-center gap-3">
        <HomeBackButton onClick={onBack} />
        <ModuleQuickNav current="creative" onNavigate={onNavigate} />
        <CreativeSubNav current="copy-transfer" onSwitchVideo={onSwitchToVideo} onSwitchClip={onSwitchToClip} onSwitchCopy={onSwitchToCopy} onSwitchVoiceTransfer={onSwitchToVoiceTransfer} onSwitchCopyTransfer={() => {}} />
      </header>
      <main className="mx-auto mt-8 max-w-7xl space-y-6">
        <section className="rounded-3xl border border-amber-100 bg-white p-6 shadow-sm">
          <div className="flex items-center gap-3"><FileAudio className="text-amber-600" /><h1 className="text-2xl font-bold">文案转移</h1></div>
          <p className="mt-2 text-sm text-slate-500">局部修改产品描述，沿用未改动原声与原 BGM，使用阿里云克隆改动处音色。最终逐条输出 MP3。</p>
          <div className="mt-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {fields.map(({ key, label, placeholder }) => (
              <label key={key} className="space-y-1 text-sm font-semibold">{label}
                <input className={input} value={profile[key]} placeholder={placeholder} disabled={busy} onChange={(e) => setProfile((value) => ({ ...value, [key]: e.target.value }))} />
              </label>
            ))}
          </div>
          <div className="mt-4 flex flex-wrap gap-3">
            <button type="button" className="rounded-xl border border-amber-200 px-4 py-2 text-sm font-semibold text-amber-800" onClick={saveTemplate}>保存转换方案</button>
            {templates.length > 0 && <select className="rounded-xl border border-slate-200 bg-white px-3 py-2 text-sm" defaultValue="" disabled={busy} onChange={(e) => { const item = templates.find((t) => t.label === e.target.value); if (item) setProfile(item.profile); }}>
              <option value="">选择已保存的转换方案</option>
              {templates.map((item) => <option key={item.label} value={item.label}>{item.label}</option>)}
            </select>}
          </div>
        </section>
        <section className="rounded-3xl border border-slate-200 bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <label className="flex cursor-pointer items-center gap-2 rounded-xl border border-slate-200 px-4 py-2 text-sm font-semibold"><Upload className="size-4" />上传音频或视频
              <input hidden type="file" multiple accept="audio/*,video/*,.mp3,.wav,.m4a,.mp4,.mov" disabled={busy} onChange={(e) => {
                const files = Array.from(e.target.files || []).filter((file) => file.type.startsWith('audio/') || file.type.startsWith('video/') || /\.(mp3|wav|m4a|mp4|mov)$/i.test(file.name));
                setRows((old) => [...old, ...files.map((file) => ({ key: crypto.randomUUID(), file, stage: '待处理' as const }))]);
                e.target.value = '';
              }} />
            </label>
            <button type="button" disabled={busy || !rows.some((row) => row.stage === '待处理' || row.stage === '失败')} onClick={analyzeAll} className="rounded-xl bg-amber-600 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">批量处理</button>
            <button type="button" disabled={busy || !rows.some((row) => row.approved && row.planId && row.stage !== '已完成')} onClick={renderAll} className="rounded-xl bg-slate-900 px-4 py-2 text-sm font-semibold text-white disabled:opacity-40">生成已确认的 MP3</button>
            <button type="button" disabled={busy || !rows.some((row) => row.result)} onClick={downloadAll} className="rounded-xl border border-emerald-200 px-4 py-2 text-sm font-semibold text-emerald-700 disabled:opacity-40">打包已完成音频</button>
            {archive && <a className="flex items-center gap-1 text-sm font-semibold text-emerald-700" href={archive.archiveUrl} download={archive.fileName}><Download className="size-4" />下载 MP3 合集</a>}
            {busy && <LoaderCircle className="size-4 animate-spin text-amber-600" />}
            <span className="text-sm text-slate-500">{rows.length} 条素材 · {rows.filter((row) => row.stage === '已完成').length} 条完成</span>
          </div>
          {message && <p className="mt-3 text-sm text-amber-800">{message}</p>}
          <p className="mt-2 text-xs text-slate-500">单条最长 3 分钟；普通条目分析后自动生成，复杂条目先试听确认。批量任务按顺序运行，预览与临时音轨保留约 2 小时；页面关闭会停止后续排队任务。</p>
        </section>
        <div className="space-y-4">
          {rows.map((row) => (
            <article key={row.key} className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div><h2 className="font-semibold">{row.file.name}</h2><p className="text-xs text-slate-500">{row.stage}{row.needsReview ? ' · 需要人工检查' : ''}</p></div>
                <div className="flex gap-2">
                  {row.result && <a className="flex items-center gap-1 rounded-xl bg-emerald-50 px-3 py-2 text-sm text-emerald-700" href={row.result.audioUrl} download={row.result.fileName}><Download className="size-4" />下载 MP3</a>}
                  {!busy && row.stage === '待处理' && <button type="button" className="text-sm text-slate-500" onClick={() => setRows((old) => old.filter((item) => item.key !== row.key))}>移除</button>}
                </div>
              </div>
              {row.error && <p className="mt-3 text-sm text-red-600">{row.error}</p>}
              {row.sourceId && <label className="mt-3 block text-xs text-slate-500">原素材试听<audio className="mt-1 h-8 w-full max-w-sm" controls src={`/uploads/${row.sourceId}_vt_source`} /></label>}
              {row.speakers && row.speakers.length > 1 && <div className="mt-3 flex flex-wrap gap-3">
                {row.speakers.map((speaker) => <label key={speaker.vocalUrl} className="text-xs text-slate-600">{speaker.label} · {speaker.durationSeconds.toFixed(1)} 秒<audio className="mt-1 h-8 w-52" controls src={speaker.vocalUrl} /></label>)}
              </div>}
              {row.sentences && <div className="mt-4 space-y-3">
                {row.sentences.map((sentence, index) => (
                  <div key={index} className={`rounded-xl p-3 text-sm ${sentence.changes.length || row.revisions?.[index] !== sentence.original ? 'bg-amber-50' : 'bg-slate-50'}`}>
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

import { useRef, useState } from 'react';
import { ArrowRight, Check, Clipboard, Film, LoaderCircle, ScanSearch, Sparkles, Upload } from 'lucide-react';
import HomeBackButton from '@/src/components/HomeBackButton';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import CreativeSubNav from '@/src/components/CreativeSubNav';
import { cn } from '@/src/lib/utils';

interface PrecisionReplicaPageProps {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
  onSwitchToVideo: () => void;
  onSwitchToClip: () => void;
  onSwitchToCopy: () => void;
  onUseInCreative: (prompt: string) => void;
}

interface UploadedSource {
  sourceId: string;
  fileName: string;
  url: string;
  durationSeconds: number;
  width: number;
  height: number;
}

const REPLICA_QUESTION = `你是精准视频复刻工作流分析器。请分析这个参考视频，目标不是自由创作，而是尽可能保留原视频的镜头、时间、运镜、动作、节奏、台词时序和画面布局。请忽略画面中不是人物实际说话内容的标题、贴纸和装饰性文字，不要把它们误判为台词。

请严格按以下结构输出：
一、视频基本信息：总时长、画幅、镜头数量。
二、镜头时间轴：逐个列出开始时间、结束时间、景别、主体位置、动作、运镜、转场和声音。
三、台词与字幕：只记录人物实际说出的台词；不确定的内容标注“需人工确认”，不要猜测。
四、不可改变的复刻约束：列出必须保持不变的构图、镜头角度、人物动作、节奏和转场。
五、Seedance执行提示词：写成可以直接交给Seedance的中文提示词。除非视频本身有镜头切换，否则不要增加镜头；不要根据台词内容补充画面；不要新增人物、道具或场景；保持原视频的镜头数量、时间范围和运镜路径。如果台词无法确认，只写“按提供的音频对口型”，不要自行补台词。

最后请单独使用一行“【Seedance提示词】”，后面只放最终提示词。`;

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return String(data?.message || data?.error || fallback);
}

function extractSeedancePrompt(answer: string) {
  const match = String(answer || '').match(/【Seedance提示词】\s*([\s\S]*)$/i);
  return String(match?.[1] || answer || '').trim();
}

export default function PrecisionReplicaPage({ onBack, onNavigate, onSwitchToVideo, onSwitchToClip, onSwitchToCopy, onUseInCreative }: PrecisionReplicaPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [source, setSource] = useState<UploadedSource | null>(null);
  const [uploading, setUploading] = useState(false);
  const [analyzing, setAnalyzing] = useState(false);
  const [model, setModel] = useState('doubao-seed-2-1-turbo-260628');
  const [answer, setAnswer] = useState('');
  const [prompt, setPrompt] = useState('');
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');

  async function uploadSource(file: File) {
    setUploading(true);
    setError('');
    setNotice('正在载入视频并读取基础信息…');
    setAnswer('');
    setPrompt('');
    try {
      const response = await fetch('/api/clips/source', {
        method: 'PUT',
        credentials: 'include',
        headers: { 'Content-Type': file.type || 'application/octet-stream', 'X-File-Name': encodeURIComponent(file.name) },
        body: file,
      });
      if (!response.ok) throw new Error(await readApiError(response, '视频载入失败'));
      const data = await response.json();
      setSource(data);
      setNotice('视频已载入，可以开始精准复刻分析。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '视频载入失败');
      setNotice('');
    } finally {
      setUploading(false);
    }
  }

  async function analyze() {
    if (!source || analyzing) return;
    setAnalyzing(true);
    setError('');
    setNotice('正在分析镜头、台词和时间轴，较长视频可能需要一些时间…');
    try {
      const response = await fetch('/api/doubao/multimodal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, clipMediaToken: source.sourceId, question: REPLICA_QUESTION, stream: false }),
      });
      if (!response.ok) throw new Error(await readApiError(response, '精准复刻分析失败'));
      const data = await response.json();
      const nextAnswer = String(data.answer || '').trim();
      if (!nextAnswer) throw new Error('模型没有返回有效的复刻方案，请重试');
      setAnswer(nextAnswer);
      setPrompt(extractSeedancePrompt(nextAnswer));
      setNotice('分析完成。请核对台词和时间轴，再送入视频创作生成。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '精准复刻分析失败');
      setNotice('');
    } finally {
      setAnalyzing(false);
    }
  }

  async function copyPrompt() {
    if (!prompt.trim()) return;
    await navigator.clipboard?.writeText(prompt.trim());
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  return (
    <div className="min-h-screen bg-[#eef3f8] text-slate-900">
      <header className="sticky top-0 z-30 flex h-16 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 shadow-sm backdrop-blur-xl md:px-6">
        <div className="flex items-center gap-3">
          <HomeBackButton onClick={onBack} />
          <ModuleQuickNav current="creative" onNavigate={onNavigate} />
          <CreativeSubNav current="replica" onSwitchVideo={onSwitchToVideo} onSwitchClip={onSwitchToClip} onSwitchCopy={onSwitchToCopy} onSwitchReplica={() => {}} />
        </div>
        <div className="hidden text-xs font-bold text-slate-500 sm:block">镜头级分析 · 保持原时间轴 · Seedance生成</div>
      </header>

      <main className="mx-auto w-full max-w-6xl space-y-5 p-4 md:p-6">
        <div className="flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-2xl font-black tracking-tight text-slate-950"><ScanSearch className="size-6 text-indigo-600" />精准复刻</h1>
            <p className="mt-1 text-sm text-slate-500">先固定原视频的镜头和时间轴，再把复刻提示词交给 Seedance。</p>
          </div>
          <div className="rounded-full border border-indigo-100 bg-indigo-50 px-3 py-1.5 text-xs font-black text-indigo-700">独立试验模块</div>
        </div>

        <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="grid gap-5 lg:grid-cols-[1.05fr_.95fr]">
            <div>
              <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-black text-slate-900">1. 上传参考视频</h2><span className="text-xs font-bold text-slate-400">最长 10 分钟 · 最大 1GB</span></div>
              <input ref={inputRef} type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv" className="hidden" onChange={(event) => { const file = event.target.files?.[0]; if (file) void uploadSource(file); event.currentTarget.value = ''; }} />
              {source ? (
                <div className="overflow-hidden rounded-2xl border border-indigo-100 bg-slate-950">
                  <video src={source.url} controls className="max-h-[420px] w-full object-contain" />
                  <div className="flex items-center justify-between gap-3 px-4 py-3 text-xs font-bold text-white"><span className="truncate">{source.fileName}</span><span className="shrink-0 text-slate-300">{source.durationSeconds.toFixed(1)} 秒 · {source.width}×{source.height}</span></div>
                </div>
              ) : (
                <button type="button" onClick={() => inputRef.current?.click()} disabled={uploading} className="flex min-h-64 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-indigo-200 bg-indigo-50/50 text-indigo-700 transition hover:border-indigo-400 hover:bg-indigo-50 disabled:opacity-60">
                  {uploading ? <LoaderCircle className="size-9 animate-spin" /> : <Upload className="size-9" />}
                  <span className="mt-3 text-sm font-black">{uploading ? '正在载入…' : '选择参考视频'}</span>
                  <span className="mt-1 text-xs font-bold text-indigo-400">支持本地视频，临时文件会自动清理</span>
                </button>
              )}
              {source && <button type="button" onClick={() => inputRef.current?.click()} className="mt-3 text-xs font-black text-slate-500 hover:text-indigo-700">更换参考视频</button>}
            </div>

            <div className="flex flex-col">
              <div className="mb-3 flex items-center justify-between"><h2 className="text-base font-black text-slate-900">2. 生成复刻方案</h2><span className="text-xs font-bold text-slate-400">不改变现有创意创作</span></div>
              <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <label className="text-xs font-black text-slate-600">分析模型</label>
                <select value={model} onChange={(event) => setModel(event.target.value)} className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-white px-3 text-sm font-bold text-slate-700 outline-none focus:border-indigo-400">
                  <option value="doubao-seed-2-1-turbo-260628">豆包 Seed 2.1 Turbo（成本优先）</option>
                  <option value="doubao-seed-2-1-pro-260628">豆包 Seed 2.1 Pro（质量优先）</option>
                </select>
                <p className="mt-2 text-[11px] font-bold leading-5 text-slate-400">模型只负责分析镜头和生成结构化复刻提示词，最终视频仍在右侧视频创作中生成。</p>
              </div>
              <button type="button" disabled={!source || uploading || analyzing} onClick={() => void analyze()} className="mt-4 flex h-12 items-center justify-center gap-2 rounded-xl bg-indigo-600 text-sm font-black text-white shadow-sm transition hover:bg-indigo-700 disabled:cursor-not-allowed disabled:opacity-50"><Sparkles className="size-4" />{analyzing ? '正在分析镜头与时间轴…' : '开始精准复刻分析'}</button>
              {(notice || error) && <div className={cn('mt-3 rounded-xl px-3 py-2.5 text-xs font-bold leading-5', error ? 'bg-rose-50 text-rose-700' : 'bg-emerald-50 text-emerald-700')}>{error || notice}</div>}
            </div>
          </div>
        </section>

        {answer && <section className="rounded-3xl border border-slate-200 bg-white p-5 shadow-sm md:p-6">
          <div className="mb-3 flex items-center justify-between gap-3"><div><h2 className="text-base font-black text-slate-900">3. 核对镜头级复刻方案</h2><p className="mt-1 text-xs font-bold text-slate-400">请重点检查镜头时间和人物台词，确认后再送入生成。</p></div><span className="rounded-full bg-emerald-50 px-3 py-1 text-xs font-black text-emerald-700"><Check className="mr-1 inline size-3.5" />已完成分析</span></div>
          <textarea value={answer} onChange={(event) => { const next = event.target.value; setAnswer(next); setPrompt(extractSeedancePrompt(next)); }} className="min-h-72 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 p-4 text-sm leading-7 text-slate-700 outline-none focus:border-indigo-400" />
          <div className="mt-5 border-t border-slate-100 pt-5"><div className="mb-2 flex items-center justify-between gap-2"><div><h3 className="text-sm font-black text-slate-900">Seedance最终提示词</h3><p className="mt-1 text-xs font-bold text-slate-400">这一段会送入现有视频创作模块，可继续手动修改。</p></div><button type="button" onClick={() => void copyPrompt()} className="inline-flex items-center gap-1 text-xs font-black text-indigo-600">{copied ? <Check className="size-3.5" /> : <Clipboard className="size-3.5" />}{copied ? '已复制' : '复制'}</button></div><textarea value={prompt} onChange={(event) => setPrompt(event.target.value)} className="min-h-48 w-full resize-y rounded-2xl border border-indigo-200 bg-indigo-50/40 p-4 text-sm leading-7 text-slate-700 outline-none focus:border-indigo-500" /></div>
          <button type="button" disabled={!prompt.trim()} onClick={() => onUseInCreative(prompt.trim())} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-black text-white transition hover:bg-slate-800 disabled:opacity-50">送入视频创作生成 <ArrowRight className="size-4" /></button>
        </section>}

        <div className="rounded-2xl border border-indigo-100 bg-indigo-50/60 px-4 py-3 text-xs font-bold leading-6 text-indigo-800"><Film className="mr-1 inline size-4" />精准复刻会优先保留原视频的镜头数量、时间范围、运镜和台词顺序；它是独立试验模块，不会改写原有创意创作流程。</div>
      </main>
    </div>
  );
}

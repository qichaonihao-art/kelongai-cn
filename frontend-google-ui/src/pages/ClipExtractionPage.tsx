import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Download, Film, LoaderCircle, Play, Scissors, Sparkles, Upload, WandSparkles, X } from 'lucide-react';
import HomeBackButton from '@/src/components/HomeBackButton';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import CreativeSubNav from '@/src/components/CreativeSubNav';
import { cn } from '@/src/lib/utils';

export type ClipCreativeMode = 'direct' | 'replace';

interface ClipExtractionPageProps {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
  onSwitchToVideo: () => void;
  onSwitchToCopy: () => void;
  onUseInCreative: (file: File, mode: ClipCreativeMode) => void;
}

interface UploadedClipSource {
  sourceId: string;
  fileName: string;
  url: string;
  size: number;
  durationSeconds: number;
  width: number;
  height: number;
}

interface TrimmedClip {
  outputId: string;
  fileName: string;
  url: string;
  size: number;
  durationSeconds: number;
  startSeconds: number;
  endSeconds: number;
}

function formatTime(value: number) {
  const safe = Math.max(0, Number.isFinite(value) ? value : 0);
  const minutes = Math.floor(safe / 60);
  const seconds = safe - minutes * 60;
  return `${String(minutes).padStart(2, '0')}:${seconds.toFixed(1).padStart(4, '0')}`;
}

function formatSize(bytes: number) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(bytes >= 100 * 1024 * 1024 ? 0 : 1)} MB`;
  return `${Math.max(1, Math.round(bytes / 1024))} KB`;
}

async function readApiError(response: Response, fallback: string) {
  const data = await response.json().catch(() => ({}));
  return String(data?.error || fallback);
}

export default function ClipExtractionPage({
  onBack,
  onNavigate,
  onSwitchToVideo,
  onSwitchToCopy,
  onUseInCreative,
}: ClipExtractionPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultVideoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const draggingCutLineRef = useRef<'start' | 'end' | null>(null);
  const uploadRequestRef = useRef<XMLHttpRequest | null>(null);
  const sourceRef = useRef<UploadedClipSource | null>(null);
  const resultRef = useRef<TrimmedClip | null>(null);
  const [source, setSource] = useState<UploadedClipSource | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(0);
  const [trimming, setTrimming] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [previewingRange, setPreviewingRange] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [result, setResult] = useState<TrimmedClip | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showModePicker, setShowModePicker] = useState(false);
  const [preparingCreative, setPreparingCreative] = useState(false);

  useEffect(() => {
    videoRef.current?.pause();
    setPreviewingRange(false);
    if (resultRef.current?.outputId) {
      void cleanupTemporaryFiles(undefined, resultRef.current.outputId);
      resultRef.current = null;
    }
    setResult(null);
  }, [startSeconds, endSeconds]);

  useEffect(() => () => {
    uploadRequestRef.current?.abort();
    const payload = {
      sourceId: sourceRef.current?.sourceId,
      outputId: resultRef.current?.outputId,
    };
    if (payload.sourceId || payload.outputId) {
      navigator.sendBeacon('/api/clips/cleanup', JSON.stringify(payload));
    }
  }, []);

  async function cleanupTemporaryFiles(sourceId?: string, outputId?: string) {
    if (!sourceId && !outputId) return;
    await fetch('/api/clips/cleanup', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId, outputId }),
      keepalive: true,
    }).catch(() => {});
  }

  function reset() {
    uploadRequestRef.current?.abort();
    void cleanupTemporaryFiles(sourceRef.current?.sourceId, resultRef.current?.outputId);
    sourceRef.current = null;
    resultRef.current = null;
    setSource(null);
    setResult(null);
    setStartSeconds(0);
    setEndSeconds(0);
    setCurrentSeconds(0);
    setUploading(false);
    setNotice('');
    setError('');
    setUploadProgress(0);
    if (inputRef.current) inputRef.current.value = '';
  }

  function uploadFile(file: File) {
    setError('');
    setNotice('');
    setResult(null);
    if (!file.type.startsWith('video/')) {
      setError('请选择视频文件。');
      return;
    }
    if (file.size > 1024 * 1024 * 1024) {
      setError('源视频不能超过 1GB。');
      return;
    }

    const request = new XMLHttpRequest();
    uploadRequestRef.current = request;
    request.open('PUT', '/api/clips/source');
    request.withCredentials = true;
    request.setRequestHeader('Content-Type', file.type || 'application/octet-stream');
    request.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    request.upload.onprogress = (event) => {
      if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
    };
    request.onload = () => {
      uploadRequestRef.current = null;
      setUploading(false);
      let data: any = {};
      try { data = JSON.parse(request.responseText || '{}'); } catch {}
      if (request.status < 200 || request.status >= 300) {
        setError(String(data?.error || '上传失败，请重试。'));
        return;
      }
      const next = data as UploadedClipSource;
      sourceRef.current = next;
      setSource(next);
      setStartSeconds(0);
      setEndSeconds(Math.min(15, next.durationSeconds));
      setUploadProgress(100);
      setNotice('视频上传完成，正在自动识别第一个切镜点…');
      void detectFirstCutForSource(next, true);
    };
    request.onerror = () => {
      uploadRequestRef.current = null;
      setUploading(false);
      setError('上传中断，请检查网络后重试。');
    };
    setUploading(true);
    setUploadProgress(0);
    request.send(file);
  }

  function setPoint(kind: 'start' | 'end') {
    if (!source || !videoRef.current) return;
    const current = Math.max(0, Math.min(videoRef.current.currentTime, source.durationSeconds));
    if (kind === 'start') {
      if (current >= endSeconds - 0.1) setError('开始点必须在结束点之前。');
      else { setStartSeconds(current); setError(''); }
    } else if (current <= startSeconds + 0.1) setError('结束点必须在开始点之后。');
    else if (current - startSeconds > 60) setError('单次最多截取 60 秒。');
    else { setEndSeconds(current); setError(''); }
  }

  function previewSelectedRange() {
    const video = videoRef.current;
    if (!video || endSeconds <= startSeconds + 0.1) return;
    if (previewingRange) {
      video.pause();
      setPreviewingRange(false);
      return;
    }
    video.currentTime = startSeconds;
    setPreviewingRange(true);
    void video.play().catch(() => setPreviewingRange(false));
  }

  function handleSourcePreviewTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    setCurrentSeconds(video.currentTime);
    if (!previewingRange) return;
    if (video.currentTime >= endSeconds - 0.03) {
      video.pause();
      video.currentTime = endSeconds;
      setPreviewingRange(false);
    }
  }

  function seekTo(value: number) {
    setCurrentSeconds(value);
    if (videoRef.current) {
      try {
        videoRef.current.currentTime = value;
      } catch {
        // 视频元数据尚未就绪时，时间轴仍先显示目标位置。
      }
    }
  }

  async function detectFirstCutForSource(targetSource: UploadedClipSource, automatic = false) {
    setDetecting(true);
    setError('');
    if (!automatic) setNotice('');
    try {
      const response = await fetch('/api/clips/detect-first-cut', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: targetSource.sourceId }),
      });
      if (!response.ok) throw new Error(await readApiError(response, '自动识别失败'));
      const data = await response.json();
      const nextEnd = Math.max(0.1, Math.min(Number(data.endSeconds), targetSource.durationSeconds, 60));
      setStartSeconds(0);
      setEndSeconds(nextEnd);
      seekTo(nextEnd);
      setNotice(String(data.message || '已给出建议范围，请预览确认。'));
    } catch (caught) {
      setError(automatic ? '自动识别切镜点失败，你仍然可以直接拖动两条裁切线。' : (caught instanceof Error ? caught.message : '自动识别失败'));
    } finally {
      setDetecting(false);
    }
  }

  function detectFirstCut() {
    if (source) void detectFirstCutForSource(source);
  }

  function timeFromTimelinePointer(clientX: number) {
    if (!source || !timelineRef.current) return 0;
    const bounds = timelineRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / Math.max(1, bounds.width)));
    return Math.round(ratio * source.durationSeconds * 20) / 20;
  }

  function moveCutLine(kind: 'start' | 'end', value: number) {
    if (!source) return;
    if (kind === 'start') {
      const next = Math.max(endSeconds - 60, Math.min(value, endSeconds - 0.1));
      const clamped = Math.max(0, next);
      setStartSeconds(clamped);
      seekTo(clamped);
      return;
    }
    const next = Math.min(startSeconds + 60, Math.max(value, startSeconds + 0.1));
    const clamped = Math.min(source.durationSeconds, next);
    setEndSeconds(clamped);
    seekTo(clamped);
  }

  function beginCutLineDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!source) return;
    const time = timeFromTimelinePointer(event.clientX);
    const kind = Math.abs(time - startSeconds) <= Math.abs(time - endSeconds) ? 'start' : 'end';
    draggingCutLineRef.current = kind;
    event.currentTarget.setPointerCapture(event.pointerId);
    moveCutLine(kind, time);
  }

  function continueCutLineDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingCutLineRef.current) return;
    moveCutLine(draggingCutLineRef.current, timeFromTimelinePointer(event.clientX));
  }

  function endCutLineDrag(event: ReactPointerEvent<HTMLDivElement>) {
    draggingCutLineRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  async function trimClip() {
    if (!source) return;
    const duration = endSeconds - startSeconds;
    if (duration <= 0.1 || duration > 60) {
      setError(duration > 60 ? '单次最多截取 60 秒。' : '请先设置正确的截取范围。');
      return;
    }
    setTrimming(true);
    setError('');
    setNotice('');
    try {
      if (resultRef.current?.outputId) {
        await cleanupTemporaryFiles(undefined, resultRef.current.outputId);
        resultRef.current = null;
        setResult(null);
      }
      const response = await fetch('/api/clips/trim', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: source.sourceId, startSeconds, endSeconds }),
      });
      if (!response.ok) throw new Error(await readApiError(response, '截取失败'));
      const nextResult = await response.json() as TrimmedClip;
      resultRef.current = nextResult;
      setResult(nextResult);
      setNotice('镜头已截取完成，可以预览、下载或直接用于视频创作。');
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '截取失败，请重试。');
    } finally {
      setTrimming(false);
    }
  }

  async function useInCreative(mode: ClipCreativeMode) {
    if (!result) return;
    setPreparingCreative(true);
    setError('');
    try {
      const response = await fetch(result.url, { credentials: 'include' });
      if (!response.ok) throw new Error('读取截取结果失败，请重新截取。');
      const blob = await response.blob();
      const file = new File([blob], result.fileName, { type: 'video/mp4', lastModified: Date.now() });
      await cleanupTemporaryFiles(sourceRef.current?.sourceId, resultRef.current?.outputId);
      sourceRef.current = null;
      resultRef.current = null;
      onUseInCreative(file, mode);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '载入视频创作失败。');
      setShowModePicker(false);
    } finally {
      setPreparingCreative(false);
    }
  }

  const selectedDuration = Math.max(0, endSeconds - startSeconds);
  const startPercent = source?.durationSeconds ? (startSeconds / source.durationSeconds) * 100 : 0;
  const endPercent = source?.durationSeconds ? (endSeconds / source.durationSeconds) * 100 : 0;
  const currentPercent = source?.durationSeconds ? (currentSeconds / source.durationSeconds) * 100 : 0;

  return (
    <div className="flex min-h-screen flex-col bg-[#f4f7fb] text-slate-900">
      <input ref={inputRef} type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) uploadFile(file);
      }} />
      <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center justify-between border-b border-slate-300 bg-white/90 px-4 backdrop-blur-md md:px-6">
        <div className="flex items-center gap-3">
          <HomeBackButton onClick={onBack} />
          <ModuleQuickNav current="creative" onNavigate={onNavigate} />
          <CreativeSubNav current="clip" onSwitchVideo={onSwitchToVideo} onSwitchClip={() => {}} onSwitchCopy={onSwitchToCopy} />
        </div>
        <div className="hidden text-xs font-bold text-slate-500 sm:block">最长 10 分钟 · 最大 1GB · 临时使用</div>
      </header>

      <main className="mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">
        <div className="mb-6">
          <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.18em] text-cyan-600"><Scissors className="size-4" />镜头截取</div>
          <h1 className="mt-2 text-2xl font-black tracking-tight md:text-3xl">把需要复刻的镜头单独切出来</h1>
          <p className="mt-2 text-sm leading-6 text-slate-500">上传原视频，定位开始点和结束点。截取在服务器完成，不占用这台电脑的剪辑性能。</p>
        </div>

        {!source ? (
          <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="group flex min-h-[360px] w-full flex-col items-center justify-center rounded-[30px] border-2 border-dashed border-cyan-200 bg-white px-6 shadow-[0_20px_60px_-40px_rgba(14,116,144,0.45)] transition hover:border-cyan-400 hover:bg-cyan-50/30 disabled:cursor-wait">
            <div className="flex size-20 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-xl shadow-cyan-200"><Upload className="size-9" /></div>
            <div className="mt-6 text-xl font-black">{uploading ? `正在上传 ${uploadProgress}%` : '上传需要截取的视频'}</div>
            <div className="mt-2 text-sm text-slate-500">支持最长 10 分钟、最大 1GB 的常见视频</div>
            {uploading && <div className="mt-6 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div>}
          </button>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
            <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.45)] md:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="min-w-0"><div className="truncate text-sm font-black">{source.fileName}</div><div className="mt-1 text-xs text-slate-500">{formatSize(source.size)} · {source.width}×{source.height} · {formatTime(source.durationSeconds)}</div></div>
                <button type="button" onClick={reset} className="shrink-0 rounded-full border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">更换视频</button>
              </div>
              <div className="overflow-hidden rounded-2xl bg-black"><video ref={videoRef} src={source.url} controls playsInline preload="metadata" onTimeUpdate={handleSourcePreviewTimeUpdate} onPause={() => setPreviewingRange(false)} onEnded={() => setPreviewingRange(false)} className="mx-auto max-h-[56vh] w-full object-contain" /></div>
              <div className="mt-5 rounded-2xl border border-slate-200 bg-slate-50 p-4">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <div><div className="text-sm font-black text-slate-800">裁切时间轴</div><div className="mt-0.5 text-xs text-slate-500">拖动绿色和紫色裁切线调整镜头范围</div></div>
                  <div className="shrink-0 rounded-full bg-white px-3 py-1.5 text-xs font-black text-cyan-700 shadow-sm">{selectedDuration.toFixed(1)} 秒</div>
                </div>
                <div className="mb-2 flex items-center justify-between text-xs font-black">
                  <span className="text-emerald-700">开始 {formatTime(startSeconds)}</span>
                  <span className="text-violet-700">结束 {formatTime(endSeconds)}</span>
                </div>
                <div
                  ref={timelineRef}
                  role="slider"
                  aria-label="视频裁切范围"
                  aria-valuetext={`${formatTime(startSeconds)} 至 ${formatTime(endSeconds)}`}
                  className="relative h-16 touch-none select-none cursor-ew-resize"
                  onPointerDown={beginCutLineDrag}
                  onPointerMove={continueCutLineDrag}
                  onPointerUp={endCutLineDrag}
                  onPointerCancel={endCutLineDrag}
                >
                  <div className="absolute inset-x-0 top-3 h-10 overflow-hidden rounded-xl border border-slate-300 bg-slate-300 shadow-inner">
                    <div className="absolute inset-y-0 bg-gradient-to-r from-cyan-500 to-blue-500" style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }} />
                    <div className="absolute inset-y-0 left-0 bg-slate-900/45" style={{ width: `${startPercent}%` }} />
                    <div className="absolute inset-y-0 right-0 bg-slate-900/45" style={{ width: `${Math.max(0, 100 - endPercent)}%` }} />
                    {Array.from({ length: 11 }, (_, index) => <span key={index} className="absolute inset-y-0 w-px bg-white/25" style={{ left: `${index * 10}%` }} />)}
                    <div className="absolute inset-y-0 z-20 w-0.5 bg-white shadow-[0_0_4px_rgba(15,23,42,0.8)]" style={{ left: `${Math.max(0, Math.min(100, currentPercent))}%` }} />
                  </div>
                  <div className="pointer-events-none absolute inset-y-0 z-30 w-1 -translate-x-1/2 rounded-full bg-emerald-500 shadow-[0_0_0_2px_white,0_3px_10px_rgba(5,150,105,0.5)]" style={{ left: `${startPercent}%` }}><span className="absolute left-1/2 top-0 size-4 -translate-x-1/2 rounded-full border-2 border-white bg-emerald-500" /></div>
                  <div className="pointer-events-none absolute inset-y-0 z-30 w-1 -translate-x-1/2 rounded-full bg-violet-500 shadow-[0_0_0_2px_white,0_3px_10px_rgba(124,58,237,0.5)]" style={{ left: `${endPercent}%` }}><span className="absolute left-1/2 top-0 size-4 -translate-x-1/2 rounded-full border-2 border-white bg-violet-500" /></div>
                </div>
                {detecting && <div className="mt-1 flex items-center gap-2 text-xs font-bold text-cyan-700"><LoaderCircle className="size-3.5 animate-spin" />正在自动识别第一个切镜点，识别后紫色结束线会自动移动</div>}
              </div>
              <div className="mt-5 grid gap-3 sm:grid-cols-2">
                <button type="button" onClick={() => setPoint('start')} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm font-black text-emerald-700 hover:bg-emerald-100">把当前画面设为开始点</button>
                <button type="button" onClick={() => setPoint('end')} className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3 text-sm font-black text-violet-700 hover:bg-violet-100">把当前画面设为结束点</button>
              </div>
            </section>

            <aside className="space-y-5">
              <section className="rounded-[26px] border border-slate-200 bg-white p-5 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.45)]">
                <div className="flex items-center justify-between"><h2 className="font-black">截取范围</h2><span className="rounded-full bg-cyan-50 px-3 py-1 text-xs font-black text-cyan-700">共 {selectedDuration.toFixed(1)} 秒</span></div>
                <div className="mt-5 grid grid-cols-2 gap-3">
                  <div className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-3"><div className="text-[10px] font-black uppercase tracking-wider text-emerald-600">开始线</div><div className="mt-1 font-black text-emerald-900">{formatTime(startSeconds)}</div></div>
                  <div className="rounded-xl border border-violet-200 bg-violet-50 px-3 py-3"><div className="text-[10px] font-black uppercase tracking-wider text-violet-600">结束线</div><div className="mt-1 font-black text-violet-900">{formatTime(endSeconds)}</div></div>
                </div>
                <button type="button" disabled={detecting} onClick={detectFirstCut} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 text-sm font-black text-cyan-700 hover:bg-cyan-100 disabled:opacity-60">{detecting ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}自动找第一个切镜点</button>
                <button type="button" disabled={detecting || selectedDuration <= 0.1} onClick={previewSelectedRange} className={cn('mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-black transition-colors disabled:opacity-50', previewingRange ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100')}><Play className={cn('size-4', previewingRange && 'fill-current')} />{previewingRange ? '停止预览' : '预览裁切片段'}</button>
                <button type="button" disabled={trimming || selectedDuration <= 0.1 || selectedDuration > 60} onClick={trimClip} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-black text-white shadow-lg hover:bg-slate-800 disabled:opacity-50">{trimming ? <LoaderCircle className="size-4 animate-spin" /> : <Scissors className="size-4" />}{trimming ? '正在精准截取…' : '开始截取'}</button>
                <p className="mt-3 text-center text-xs leading-5 text-slate-400">建议单个镜头控制在 15 秒内，单次最多 60 秒。</p>
              </section>

              {result && <section className="rounded-[26px] border border-emerald-200 bg-white p-5 shadow-[0_18px_50px_-36px_rgba(5,150,105,0.45)]">
                <div className="mb-3 flex items-center gap-2 text-sm font-black text-emerald-700"><Check className="size-4" />截取完成</div>
                <video ref={resultVideoRef} src={result.url} controls playsInline className="aspect-video w-full rounded-xl bg-black object-contain" />
                <div className="mt-3 text-xs text-slate-500">{formatTime(result.startSeconds)} 至 {formatTime(result.endSeconds)} · {formatSize(result.size)}</div>
                <div className="mt-4 grid gap-2">
                  <button type="button" onClick={() => setShowModePicker(true)} className="flex h-11 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700"><Play className="size-4" />用于视频创作</button>
                  <a href={result.url} download={result.fileName} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"><Download className="size-4" />下载到电脑</a>
                </div>
              </section>}
            </aside>
          </div>
        )}

        {(error || notice) && <div className={cn('mt-5 rounded-2xl border px-4 py-3 text-sm font-bold', error ? 'border-red-200 bg-red-50 text-red-700' : 'border-cyan-200 bg-cyan-50 text-cyan-800')}>{error || notice}</div>}
      </main>

      {showModePicker && <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !preparingCreative) setShowModePicker(false); }}>
        <div className="w-full max-w-md rounded-[28px] bg-white p-6 shadow-2xl">
          <div className="flex items-start justify-between"><div><h2 className="text-xl font-black">选择创作方式</h2><p className="mt-1 text-sm text-slate-500">截取的视频会自动放进你选择的模块。</p></div><button type="button" disabled={preparingCreative} onClick={() => setShowModePicker(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100"><X className="size-5" /></button></div>
          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <button type="button" disabled={preparingCreative} onClick={() => useInCreative('direct')} className="rounded-2xl border border-emerald-200 bg-emerald-50 p-5 text-left hover:bg-emerald-100 disabled:opacity-60"><Sparkles className="size-6 text-emerald-600" /><div className="mt-3 font-black text-emerald-900">直接反推</div><div className="mt-1 text-xs leading-5 text-emerald-700/75">按原镜头直接复刻</div></button>
            <button type="button" disabled={preparingCreative} onClick={() => useInCreative('replace')} className="rounded-2xl border border-violet-200 bg-violet-50 p-5 text-left hover:bg-violet-100 disabled:opacity-60"><Film className="size-6 text-violet-600" /><div className="mt-3 font-black text-violet-900">元素替换</div><div className="mt-1 text-xs leading-5 text-violet-700/75">复刻镜头并替换元素</div></button>
          </div>
          {preparingCreative && <div className="mt-4 flex items-center justify-center gap-2 text-sm font-bold text-slate-500"><LoaderCircle className="size-4 animate-spin" />正在载入视频创作…</div>}
        </div>
      </div>}
    </div>
  );
}

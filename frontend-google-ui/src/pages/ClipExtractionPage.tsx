import { useEffect, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, Copy, Download, Film, KeyRound, Link2, LoaderCircle, Play, Scissors, Settings, ShieldCheck, Sparkles, Upload, WandSparkles, X } from 'lucide-react';
import HomeBackButton from '@/src/components/HomeBackButton';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import CreativeSubNav from '@/src/components/CreativeSubNav';
import { extractCpTranscript, extractCpTranscriptStream, resolveCpExtract, type DouyinDownloadCandidate, type DouyinResolveResult } from '@/src/lib/douyin';
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
  sourceType?: 'online';
}

function collectOnlineVideoCandidates(result: DouyinResolveResult) {
  const seen = new Set<string>();
  const candidates: DouyinDownloadCandidate[] = [];
  const add = (value: string | DouyinDownloadCandidate | undefined, source = 'clip-page') => {
    const url = typeof value === 'string' ? value : value?.url;
    if (!url || seen.has(url)) return;
    seen.add(url);
    candidates.push(typeof value === 'string' ? { url, source } : value);
  };
  add(result.downloadUrl, 'downloadUrl');
  for (const candidate of result.downloadUrlCandidates || []) add(candidate);
  for (const candidate of result.videoUrlCandidates || []) add(candidate);
  add(result.previewUrl, 'previewUrl');
  for (const url of result.videoUrls || []) add(url, 'videoUrls');
  return candidates;
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

interface DetectedShot {
  number: number;
  startSeconds: number;
  endSeconds: number;
  durationSeconds: number;
}

interface WechatCookieStatus {
  configured: boolean;
  source?: 'page' | 'environment' | 'none';
  preview?: string;
  updatedAt?: string | null;
  lastTestAt?: string | null;
  lastTestResult?: string | null;
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
  const [detectedShots, setDetectedShots] = useState<DetectedShot[]>([]);
  const [previewingRange, setPreviewingRange] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [result, setResult] = useState<TrimmedClip | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showModePicker, setShowModePicker] = useState(false);
  const [preparingCreative, setPreparingCreative] = useState(false);
  const [sourceMode, setSourceMode] = useState<'link' | 'upload'>('link');
  const [linkInput, setLinkInput] = useState('');
  const [onlineLoading, setOnlineLoading] = useState(false);
  const [onlineResult, setOnlineResult] = useState<DouyinResolveResult | null>(null);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptStatus, setTranscriptStatus] = useState('');
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptCopied, setTranscriptCopied] = useState(false);
  const [showWechatConfig, setShowWechatConfig] = useState(false);
  const [wechatConfigLoading, setWechatConfigLoading] = useState(false);
  const [wechatCookieStatus, setWechatCookieStatus] = useState<WechatCookieStatus | null>(null);
  const [wechatCookieInput, setWechatCookieInput] = useState('');
  const [wechatTestUrl, setWechatTestUrl] = useState('');
  const [wechatConfigMessage, setWechatConfigMessage] = useState('');
  const [wechatConfigError, setWechatConfigError] = useState('');

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
    setDetectedShots([]);
    setUploading(false);
    setNotice('');
    setError('');
    setUploadProgress(0);
    setOnlineLoading(false);
    setOnlineResult(null);
    setTranscriptLoading(false);
    setTranscriptStatus('');
    setTranscriptText('');
    setTranscriptCopied(false);
    if (inputRef.current) inputRef.current.value = '';
  }

  function activateSource(next: UploadedClipSource, message: string) {
    sourceRef.current = next;
    setSource(next);
    setResult(null);
    resultRef.current = null;
    setStartSeconds(0);
    setEndSeconds(Math.min(15, next.durationSeconds));
    setCurrentSeconds(0);
    setDetectedShots([]);
    setNotice(message);
    void detectFirstCutForSource(next, true);
  }

  function uploadFile(file: File) {
    setError('');
    setNotice('');
    setResult(null);
    setDetectedShots([]);
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
      setUploadProgress(100);
      setOnlineResult(null);
      setTranscriptText('');
      activateSource(next, '视频上传完成，正在自动识别开头前5个镜头…');
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

  async function parseAndLoadOnlineVideo() {
    const input = linkInput.trim();
    if (!input) {
      setError('请先粘贴视频链接或完整分享文字。');
      return;
    }
    setOnlineLoading(true);
    setError('');
    setNotice('正在解析视频地址…');
    setOnlineResult(null);
    setTranscriptText('');
    setTranscriptStatus('');
    try {
      const parsed = await resolveCpExtract(input);
      if (Number(parsed.duration || 0) > 600.25) throw new Error('源视频时长不能超过 10 分钟');
      const candidates = collectOnlineVideoCandidates(parsed);
      if (candidates.length === 0) throw new Error('没有解析到可用视频，请改用本地上传。');
      setNotice('解析成功，正在把视频载入镜头截取…');
      const response = await fetch('/api/clips/import-url', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          downloadUrl: candidates[0]?.url,
          downloadUrlCandidates: candidates,
          videoUrls: parsed.videoUrls || [],
          title: parsed.title || `${parsed.authorName || '在线'}视频`,
          sourceUrl: parsed.sourceUrl || input,
          platform: parsed.platform || '',
        }),
      });
      if (!response.ok) throw new Error(await readApiError(response, '视频载入失败'));
      const next = await response.json() as UploadedClipSource;
      setOnlineResult(parsed);
      activateSource(next, '在线视频已载入，正在自动识别开头前5个镜头…');
    } catch (caught) {
      setNotice('');
      const message = caught instanceof Error ? caught.message : '视频解析失败，请重试或改用本地上传。';
      setError(message);
      if (/Cookie.*未配置|Cookie.*过期|元宝 Cookie/i.test(message)) void openWechatConfig();
    } finally {
      setOnlineLoading(false);
    }
  }

  async function extractOnlineTranscript() {
    if (!onlineResult || !linkInput.trim()) return;
    const candidates = collectOnlineVideoCandidates(onlineResult);
    setTranscriptLoading(true);
    setTranscriptText('');
    setTranscriptCopied(false);
    setTranscriptStatus('正在准备视频音频…');
    setError('');
    const options = {
      sourceData: onlineResult.videoData || null,
      videoUrl: candidates[0]?.url || '',
      videoUrls: candidates.map((candidate) => candidate.url).slice(0, 8),
      downloadUrlCandidates: candidates,
    };
    try {
      let transcript;
      try {
        transcript = await extractCpTranscriptStream(linkInput.trim(), {
          ...options,
          onStatus: (message) => { if (message) setTranscriptStatus(message); },
          onDelta: (text) => setTranscriptText(text),
        });
      } catch {
        setTranscriptStatus('正在切换稳妥模式…');
        transcript = await extractCpTranscript(linkInput.trim(), options);
      }
      if (!transcript.transcriptOk || !transcript.transcript.trim()) {
        throw new Error(transcript.transcriptError || '没有识别到逐字稿内容');
      }
      setTranscriptText(transcript.transcript.trim());
      setTranscriptStatus('逐字稿提取完成');
    } catch (caught) {
      setTranscriptStatus('');
      setError(caught instanceof Error ? caught.message : '逐字稿提取失败，请稍后重试。');
    } finally {
      setTranscriptLoading(false);
    }
  }

  async function copyTranscript() {
    if (!transcriptText.trim()) return;
    await navigator.clipboard.writeText(transcriptText);
    setTranscriptCopied(true);
    window.setTimeout(() => setTranscriptCopied(false), 1600);
  }

  async function loadWechatCookieStatus() {
    const response = await fetch('/api/wechat-channel/config', { credentials: 'include' });
    if (!response.ok) throw new Error(await readApiError(response, '读取视频号配置失败'));
    const data = await response.json();
    setWechatCookieStatus(data as WechatCookieStatus);
  }

  async function openWechatConfig() {
    setShowWechatConfig(true);
    setWechatConfigMessage('');
    setWechatConfigError('');
    setWechatConfigLoading(true);
    try {
      await loadWechatCookieStatus();
    } catch (caught) {
      setWechatConfigError(caught instanceof Error ? caught.message : '读取视频号配置失败');
    } finally {
      setWechatConfigLoading(false);
    }
  }

  async function saveWechatCookie() {
    if (!wechatCookieInput.trim()) {
      setWechatConfigError('请先粘贴完整的腾讯元宝 Cookie。');
      return;
    }
    setWechatConfigLoading(true);
    setWechatConfigError('');
    setWechatConfigMessage('');
    try {
      const response = await fetch('/api/wechat-channel/config', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ cookie: wechatCookieInput }),
      });
      if (!response.ok) throw new Error(await readApiError(response, '保存 Cookie 失败'));
      const data = await response.json();
      setWechatCookieInput('');
      setWechatConfigMessage(String(data.message || '保存成功，视频号解析 Cookie 已更新。'));
      await loadWechatCookieStatus();
    } catch (caught) {
      setWechatConfigError(caught instanceof Error ? caught.message : '保存 Cookie 失败');
    } finally {
      setWechatConfigLoading(false);
    }
  }

  async function testWechatCookie() {
    if (!wechatTestUrl.trim()) {
      setWechatConfigError('请粘贴一个视频号链接用于测试。');
      return;
    }
    setWechatConfigLoading(true);
    setWechatConfigError('');
    setWechatConfigMessage('');
    try {
      const response = await fetch('/api/wechat-channel/config/test', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: wechatTestUrl }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok || data?.ok === false) throw new Error(String(data?.message || data?.error || '测试失败'));
      setWechatConfigMessage(String(data.message || '测试成功，当前 Cookie 可用。'));
      await loadWechatCookieStatus();
    } catch (caught) {
      setWechatConfigError(caught instanceof Error ? caught.message : '测试失败，Cookie 可能已过期。');
      await loadWechatCookieStatus().catch(() => {});
    } finally {
      setWechatConfigLoading(false);
    }
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
    setDetectedShots([]);
    setError('');
    if (!automatic) setNotice('');
    try {
      const response = await fetch('/api/clips/detect-first-cut', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: targetSource.sourceId }),
      });
      if (!response.ok) throw new Error(await readApiError(response, '自动识别失败'));
      const data = await response.json();
      const shots = Array.isArray(data.shots)
        ? data.shots.filter((item: DetectedShot) => Number.isFinite(Number(item?.endSeconds))).slice(0, 5)
        : [];
      setDetectedShots(shots);
      const nextEnd = Math.max(0.1, Math.min(Number(data.endSeconds), targetSource.durationSeconds, 60));
      setStartSeconds(0);
      setEndSeconds(nextEnd);
      seekTo(nextEnd);
      setNotice(String(data.message || '已给出建议范围，请预览确认。'));
    } catch (caught) {
      setDetectedShots([]);
      setError(automatic ? '自动识别切镜点失败，你仍然可以直接拖动两条裁切线。' : (caught instanceof Error ? caught.message : '自动识别失败'));
    } finally {
      setDetecting(false);
    }
  }

  function detectFirstCut() {
    if (source) void detectFirstCutForSource(source);
  }

  function selectFirstShots(shot: DetectedShot) {
    const nextEnd = Math.min(60, shot.endSeconds, source?.durationSeconds || shot.endSeconds);
    setStartSeconds(0);
    setEndSeconds(nextEnd);
    seekTo(nextEnd);
    setNotice(`已选择前 ${shot.number} 个镜头，共 ${nextEnd.toFixed(1)} 秒，请点击“预览裁切片段”确认。`);
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
          <p className="mt-2 text-sm leading-6 text-slate-500">粘贴短视频链接或上传本地视频，自动识别开头前 5 个镜头，再精准选择需要复刻的片段。</p>
        </div>

        {!source ? (
          <section className="overflow-hidden rounded-[30px] border border-slate-200 bg-white shadow-[0_20px_60px_-40px_rgba(14,116,144,0.45)]">
            <div className="grid grid-cols-2 border-b border-slate-200 bg-slate-50 p-2">
              <button type="button" disabled={onlineLoading || uploading} onClick={() => setSourceMode('link')} className={cn('flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-black transition', sourceMode === 'link' ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500 hover:text-slate-800')}><Link2 className="size-4" />粘贴链接解析</button>
              <button type="button" disabled={onlineLoading || uploading} onClick={() => setSourceMode('upload')} className={cn('flex h-12 items-center justify-center gap-2 rounded-2xl text-sm font-black transition', sourceMode === 'upload' ? 'bg-white text-cyan-700 shadow-sm' : 'text-slate-500 hover:text-slate-800')}><Upload className="size-4" />本地上传</button>
            </div>
            {sourceMode === 'link' ? <div className="mx-auto max-w-3xl px-6 py-10 md:px-10 md:py-14">
              <div className="mb-4 flex justify-end"><button type="button" disabled={onlineLoading} onClick={() => void openWechatConfig()} className="flex items-center gap-2 rounded-full border border-emerald-200 bg-emerald-50 px-3.5 py-2 text-xs font-black text-emerald-700 transition hover:bg-emerald-100"><Settings className="size-3.5" />视频号 Cookie 配置</button></div>
              <div className="mx-auto flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-xl shadow-cyan-200"><Link2 className="size-7" /></div>
              <h2 className="mt-5 text-center text-xl font-black">粘贴视频链接或完整分享文字</h2>
              <p className="mt-2 text-center text-sm leading-6 text-slate-500">支持抖音、快手和微信视频号。解析后直接载入裁切页面，不需要先下载到电脑再上传。</p>
              <textarea value={linkInput} disabled={onlineLoading} onChange={(event) => setLinkInput(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void parseAndLoadOnlineVideo(); }} placeholder="支持直接粘贴短视频平台链接，也可以粘贴带文案的整段分享文字" className="mt-6 min-h-28 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm leading-6 outline-none transition focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100 disabled:opacity-60" />
              <button type="button" disabled={onlineLoading || !linkInput.trim()} onClick={() => void parseAndLoadOnlineVideo()} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-cyan-600 text-sm font-black text-white shadow-lg shadow-cyan-200 hover:bg-cyan-700 disabled:cursor-not-allowed disabled:opacity-50">{onlineLoading ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}{onlineLoading ? '正在解析并载入视频…' : '解析并载入视频'}</button>
              <div className="mt-4 text-center text-xs text-slate-400">解析不成功时，可切换“本地上传”继续使用。</div>
            </div> : <button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="group flex min-h-[360px] w-full flex-col items-center justify-center px-6 transition hover:bg-cyan-50/30 disabled:cursor-wait">
              <div className="flex size-20 items-center justify-center rounded-3xl bg-gradient-to-br from-cyan-500 to-blue-600 text-white shadow-xl shadow-cyan-200"><Upload className="size-9" /></div>
              <div className="mt-6 text-xl font-black">{uploading ? `正在上传 ${uploadProgress}%` : '上传需要截取的视频'}</div>
              <div className="mt-2 text-sm text-slate-500">支持最长 10 分钟、最大 1GB 的常见视频</div>
              {uploading && <div className="mt-6 h-2 w-full max-w-md overflow-hidden rounded-full bg-slate-100"><div className="h-full rounded-full bg-cyan-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div>}
            </button>}
          </section>
        ) : (
          <div className="grid gap-5 lg:grid-cols-[1.35fr_0.65fr]">
            <section className="rounded-[26px] border border-slate-200 bg-white p-4 shadow-[0_18px_50px_-36px_rgba(15,23,42,0.45)] md:p-5">
              <div className="mb-4 flex items-center justify-between gap-3">
                <div className="min-w-0"><div className="truncate text-sm font-black">{source.fileName}</div><div className="mt-1 text-xs text-slate-500">{source.sourceType === 'online' ? '在线解析 · ' : ''}{formatSize(source.size)} · {source.width}×{source.height} · {formatTime(source.durationSeconds)}</div></div>
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
                {detecting && <div className="mt-1 flex items-center gap-2 text-xs font-bold text-cyan-700"><LoaderCircle className="size-3.5 animate-spin" />正在自动识别开头前5个镜头，识别后紫色结束线会自动移动</div>}
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
                {detectedShots.length > 0 && <div className="mt-5">
                  <div className="mb-2 text-xs font-black text-slate-600">快速选择截取前几个镜头</div>
                  <div className="grid grid-cols-2 gap-2">
                    {detectedShots.map((shot) => {
                      const selected = Math.abs(endSeconds - shot.endSeconds) < 0.06 && startSeconds < 0.06;
                      return <button key={shot.number} type="button" onClick={() => selectFirstShots(shot)} className={cn('rounded-xl border px-3 py-2.5 text-left transition-colors', selected ? 'border-cyan-500 bg-cyan-500 text-white shadow-md shadow-cyan-200' : 'border-slate-200 bg-slate-50 text-slate-700 hover:border-cyan-300 hover:bg-cyan-50')}><div className="text-xs font-black">前 {shot.number} 个镜头</div><div className={cn('mt-0.5 text-[10px] font-bold', selected ? 'text-white/80' : 'text-slate-400')}>截至 {formatTime(shot.endSeconds)}</div></button>;
                    })}
                  </div>
                </div>}
                <button type="button" disabled={detecting} onClick={detectFirstCut} className="mt-5 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 text-sm font-black text-cyan-700 hover:bg-cyan-100 disabled:opacity-60">{detecting ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}重新识别前5个镜头</button>
                <button type="button" disabled={detecting || selectedDuration <= 0.1} onClick={previewSelectedRange} className={cn('mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border text-sm font-black transition-colors disabled:opacity-50', previewingRange ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-blue-200 bg-blue-50 text-blue-700 hover:bg-blue-100')}><Play className={cn('size-4', previewingRange && 'fill-current')} />{previewingRange ? '停止预览' : '预览裁切片段'}</button>
                <button type="button" disabled={trimming || selectedDuration <= 0.1 || selectedDuration > 60} onClick={trimClip} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-black text-white shadow-lg hover:bg-slate-800 disabled:opacity-50">{trimming ? <LoaderCircle className="size-4 animate-spin" /> : <Scissors className="size-4" />}{trimming ? '正在精准截取…' : '开始截取'}</button>
                <p className="mt-3 text-center text-xs leading-5 text-slate-400">建议单个镜头控制在 15 秒内，单次最多 60 秒。</p>
              </section>

              {onlineResult && <section className="rounded-[26px] border border-blue-200 bg-white p-5 shadow-[0_18px_50px_-36px_rgba(37,99,235,0.35)]">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="flex items-center gap-2 text-sm font-black text-blue-700"><Link2 className="size-4" />在线解析结果</div><div className="mt-2 truncate text-xs font-bold text-slate-700">{onlineResult.title || '未命名视频'}</div>{onlineResult.authorName && <div className="mt-1 text-xs text-slate-400">作者：{onlineResult.authorName}</div>}</div>
                  {collectOnlineVideoCandidates(onlineResult)[0]?.url && <a href={`/api/proxy/download?url=${encodeURIComponent(collectOnlineVideoCandidates(onlineResult)[0].url)}`} className="shrink-0 rounded-full border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"><Download className="mr-1 inline size-3.5" />原视频</a>}
                </div>
                <button type="button" disabled={transcriptLoading} onClick={() => void extractOnlineTranscript()} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 text-sm font-black text-blue-700 hover:bg-blue-100 disabled:opacity-60">{transcriptLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{transcriptLoading ? (transcriptStatus || '正在提取逐字稿…') : transcriptText ? '重新提取逐字稿' : '提取视频逐字稿'}</button>
                {transcriptText && <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between"><span className="text-xs font-black text-slate-600">逐字稿（可直接修改）</span><button type="button" onClick={() => void copyTranscript()} className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800"><Copy className="size-3.5" />{transcriptCopied ? '已复制' : '复制'}</button></div>
                  <textarea value={transcriptText} onChange={(event) => setTranscriptText(event.target.value)} className="min-h-36 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-6 text-slate-700 outline-none focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100" />
                </div>}
                {!transcriptText && !transcriptLoading && <p className="mt-3 text-center text-xs leading-5 text-slate-400">逐字稿按需提取，不会在解析视频时自动产生额外转写费用。</p>}
              </section>}

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

      {showWechatConfig && <div className="fixed inset-0 z-[60] grid place-items-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !wechatConfigLoading) setShowWechatConfig(false); }}>
        <section role="dialog" aria-modal="true" aria-label="视频号 Cookie 配置" className="my-6 w-full max-w-2xl rounded-[28px] bg-white p-6 shadow-2xl md:p-7">
          <div className="flex items-start justify-between gap-4">
            <div><div className="flex items-center gap-2 text-lg font-black text-slate-900"><KeyRound className="size-5 text-emerald-600" />视频号解析配置</div><p className="mt-1 text-sm leading-6 text-slate-500">维护腾讯元宝 Cookie，用于解析微信视频号链接。</p></div>
            <button type="button" disabled={wechatConfigLoading} onClick={() => setShowWechatConfig(false)} className="rounded-full p-2 text-slate-400 hover:bg-slate-100 disabled:opacity-50"><X className="size-5" /></button>
          </div>

          <div className="mt-5 grid gap-3 sm:grid-cols-2">
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-bold text-slate-400">Cookie 状态</div><div className={cn('mt-1 flex items-center gap-2 font-black', wechatCookieStatus?.configured ? 'text-emerald-700' : 'text-amber-700')}>{wechatCookieStatus?.configured ? <ShieldCheck className="size-4" /> : <KeyRound className="size-4" />}{wechatConfigLoading && !wechatCookieStatus ? '读取中…' : wechatCookieStatus?.configured ? '已配置' : '未配置'}</div></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-bold text-slate-400">脱敏预览</div><div className="mt-1 truncate font-mono text-sm font-black text-slate-700">{wechatCookieStatus?.preview || '暂无'}</div></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-bold text-slate-400">最近更新</div><div className="mt-1 text-sm font-black text-slate-700">{wechatCookieStatus?.updatedAt ? new Date(wechatCookieStatus.updatedAt).toLocaleString('zh-CN') : wechatCookieStatus?.source === 'environment' ? '服务器环境配置' : '暂无'}</div></div>
            <div className="rounded-2xl border border-slate-200 bg-slate-50 p-4"><div className="text-xs font-bold text-slate-400">最近测试结果</div><div className="mt-1 line-clamp-2 text-sm font-black text-slate-700">{wechatCookieStatus?.lastTestResult || '暂无'}</div></div>
          </div>

          <label className="mt-5 block"><span className="text-sm font-black text-slate-700">腾讯元宝 Cookie</span><textarea value={wechatCookieInput} onChange={(event) => setWechatCookieInput(event.target.value)} disabled={wechatConfigLoading} rows={5} autoComplete="off" spellCheck={false} placeholder="粘贴完整 Cookie。保存后输入框会清空，页面不会回显完整内容。" className="mt-2 w-full resize-y rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 font-mono text-xs leading-5 outline-none focus:border-emerald-400 focus:bg-white focus:ring-4 focus:ring-emerald-100 disabled:opacity-60" /></label>
          <button type="button" disabled={wechatConfigLoading || !wechatCookieInput.trim()} onClick={() => void saveWechatCookie()} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700 disabled:opacity-50">{wechatConfigLoading ? <LoaderCircle className="size-4 animate-spin" /> : <ShieldCheck className="size-4" />}保存 Cookie</button>

          <div className="my-5 h-px bg-slate-200" />
          <label className="block"><span className="text-sm font-black text-slate-700">测试视频号链接</span><input value={wechatTestUrl} onChange={(event) => setWechatTestUrl(event.target.value)} disabled={wechatConfigLoading} placeholder="https://weixin.qq.com/sph/..." className="mt-2 h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 text-sm outline-none focus:border-cyan-400 focus:bg-white focus:ring-4 focus:ring-cyan-100 disabled:opacity-60" /></label>
          <button type="button" disabled={wechatConfigLoading || !wechatCookieStatus?.configured || !wechatTestUrl.trim()} onClick={() => void testWechatCookie()} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-cyan-200 bg-cyan-50 text-sm font-black text-cyan-700 hover:bg-cyan-100 disabled:opacity-50">{wechatConfigLoading ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}测试 Cookie 是否可用</button>

          {(wechatConfigError || wechatConfigMessage) && <div className={cn('mt-4 rounded-xl border px-4 py-3 text-sm font-bold', wechatConfigError ? 'border-red-200 bg-red-50 text-red-700' : 'border-emerald-200 bg-emerald-50 text-emerald-700')}>{wechatConfigError || wechatConfigMessage}</div>}
          <p className="mt-4 text-xs leading-5 text-slate-400">Cookie 仅保存在服务器运行目录中，页面只显示脱敏预览，不会写入浏览器本地存储。</p>
        </section>
      </div>}

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

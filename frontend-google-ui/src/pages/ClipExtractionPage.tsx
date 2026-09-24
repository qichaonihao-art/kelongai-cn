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
  onUseInCreative: (clip: { file: File; previewUrl: string; serverMediaToken: string }, mode: ClipCreativeMode) => void;
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

type OnlineLoadStage = 'parsing' | 'downloading' | 'checking' | 'loading';

interface OnlineLoadProgress {
  stage: OnlineLoadStage;
  percent: number;
  message: string;
  downloadedBytes?: number;
  totalBytes?: number;
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
  return String(data?.message || data?.error || fallback);
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
  const [onlineProgress, setOnlineProgress] = useState<OnlineLoadProgress | null>(null);
  const [onlineElapsedSeconds, setOnlineElapsedSeconds] = useState(0);
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
    if (!onlineLoading) return;
    const timer = window.setInterval(() => {
      setOnlineElapsedSeconds((value) => value + 1);
      setOnlineProgress((current) => {
        if (!current) return current;
        const cap = current.stage === 'parsing' ? 22 : current.stage === 'downloading' ? 78 : current.stage === 'checking' ? 92 : 97;
        if (current.percent >= cap) return current;
        return { ...current, percent: Math.min(cap, current.percent + (current.stage === 'downloading' ? 0.7 : 0.35)) };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [onlineLoading]);

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
    setOnlineProgress(null);
    setOnlineElapsedSeconds(0);
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
    setOnlineElapsedSeconds(0);
    setOnlineProgress({ stage: 'parsing', percent: 4, message: '正在识别平台并解析视频地址…' });
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
      setOnlineProgress({ stage: 'downloading', percent: 25, message: '链接解析成功，正在下载视频…' });
      const response = await fetch('/api/clips/import-url-stream', {
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
      if (!response.body) throw new Error('浏览器无法读取载入进度，请刷新后重试。');
      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let next: UploadedClipSource | null = null;
      const handleEvent = (event: any) => {
        if (event?.type === 'error') throw new Error(String(event.message || '视频载入失败'));
        if (event?.type === 'done' && event.source) {
          next = event.source as UploadedClipSource;
          setOnlineProgress({ stage: 'loading', percent: 100, message: '视频已载入，正在打开裁切页面…' });
          return;
        }
        if (event?.type !== 'progress') return;
        const stage: OnlineLoadStage = event.stage === 'checking' ? 'checking' : event.stage === 'loading' ? 'loading' : 'downloading';
        setOnlineProgress((current) => ({
          stage,
          percent: Math.max(current?.percent || 0, Math.max(0, Math.min(99, Number(event.percent) || (stage === 'checking' ? 84 : 25)))),
          message: String(event.message || '正在载入视频…'),
          downloadedBytes: Number(event.downloadedBytes) || undefined,
          totalBytes: Number(event.totalBytes) || undefined,
        }));
      };
      while (true) {
        const { done, value } = await reader.read();
        buffer += decoder.decode(value || new Uint8Array(), { stream: !done });
        const lines = buffer.split('\n');
        buffer = lines.pop() || '';
        for (const line of lines) if (line.trim()) handleEvent(JSON.parse(line));
        if (done) break;
      }
      if (buffer.trim()) handleEvent(JSON.parse(buffer));
      if (!next) throw new Error('视频载入未完成，请重试或改用本地上传。');
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
      const sourceId = sourceRef.current?.sourceId;
      const file = new File([], result.fileName, { type: 'video/mp4', lastModified: Date.now() });
      sourceRef.current = null;
      resultRef.current = null;
      onUseInCreative({ file, previewUrl: result.url, serverMediaToken: result.outputId }, mode);
      void cleanupTemporaryFiles(sourceId);
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
  const onlineStageIndex = onlineProgress
    ? ({ parsing: 0, downloading: 1, checking: 2, loading: 3 } as const)[onlineProgress.stage]
    : -1;
  const onlineStages = ['解析链接', '下载视频', '校验视频', '载入裁切'];
  const workflowStep = !source ? 0 : result ? 2 : 1;
  const workflowStages = [
    { number: '01', title: '导入素材', detail: '链接解析或本地上传' },
    { number: '02', title: '选择镜头', detail: '识别切点并预览范围' },
    { number: '03', title: '进入创作', detail: '直接反推或元素替换' },
  ];

  return (
    <div className="relative flex min-h-screen flex-col overflow-hidden bg-[#eef3f8] text-slate-900">
      <div className="pointer-events-none absolute inset-x-0 top-14 h-[420px] bg-[radial-gradient(circle_at_15%_10%,rgba(6,182,212,0.12),transparent_34%),radial-gradient(circle_at_85%_20%,rgba(139,92,246,0.12),transparent_34%)]" />
      <input ref={inputRef} type="file" accept="video/*,.mp4,.mov,.m4v,.webm,.mkv" className="hidden" onChange={(event) => {
        const file = event.target.files?.[0];
        if (file) uploadFile(file);
      }} />
      <header className="sticky top-0 z-30 flex h-16 shrink-0 items-center justify-between border-b border-slate-200/80 bg-white/90 px-4 shadow-sm backdrop-blur-xl md:px-6">
        <div className="flex items-center gap-3">
          <HomeBackButton onClick={onBack} />
          <ModuleQuickNav current="creative" onNavigate={onNavigate} />
          <CreativeSubNav current="clip" onSwitchVideo={onSwitchToVideo} onSwitchClip={() => {}} onSwitchCopy={onSwitchToCopy} />
        </div>
        <div className="hidden text-xs font-bold text-slate-500 sm:block">最长 10 分钟 · 最大 1GB · 临时使用</div>
      </header>

      <main className="relative mx-auto w-full max-w-7xl flex-1 p-4 md:p-7">
        <section className="relative mb-6 overflow-hidden rounded-[30px] bg-slate-950 px-5 py-6 text-white shadow-[0_24px_70px_-36px_rgba(15,23,42,0.9)] md:px-8 md:py-7">
          <div className="pointer-events-none absolute -right-20 -top-28 size-80 rounded-full bg-cyan-400/15 blur-3xl" />
          <div className="pointer-events-none absolute -bottom-28 left-1/3 size-64 rounded-full bg-violet-500/15 blur-3xl" />
          <div className="relative grid gap-6 lg:grid-cols-[1fr_1.25fr] lg:items-end">
            <div>
              <div className="flex items-center gap-2 text-xs font-black uppercase tracking-[0.2em] text-cyan-300"><Scissors className="size-4" />镜头截取工作台</div>
              <h1 className="mt-3 text-2xl font-black tracking-tight md:text-3xl">截出镜头，直接开始复刻</h1>
              <p className="mt-2 max-w-xl text-sm leading-6 text-slate-300">导入视频后自动识别开头 5 个镜头，确认范围即可进入直接反推或元素替换。</p>
            </div>
            <div className="grid grid-cols-3 gap-2 rounded-2xl border border-white/10 bg-white/[0.06] p-2 backdrop-blur-sm">
              {workflowStages.map((stage, index) => <div key={stage.number} className={cn('rounded-xl px-3 py-3 transition-colors', index === workflowStep ? 'bg-white text-slate-950 shadow-lg' : index < workflowStep ? 'bg-emerald-400/15 text-emerald-200' : 'text-slate-400')}>
                <div className="flex items-center gap-2"><span className={cn('grid size-6 place-items-center rounded-full text-[10px] font-black', index === workflowStep ? 'bg-cyan-500 text-white' : index < workflowStep ? 'bg-emerald-400 text-slate-950' : 'bg-white/10 text-slate-400')}>{index < workflowStep ? '✓' : stage.number}</span><span className="text-xs font-black md:text-sm">{stage.title}</span></div>
                <div className={cn('mt-1 hidden pl-8 text-[10px] font-bold sm:block', index === workflowStep ? 'text-slate-500' : 'text-current opacity-70')}>{stage.detail}</div>
              </div>)}
            </div>
          </div>
        </section>

        {(error || notice) && <div className={cn('mb-5 flex items-start gap-3 rounded-2xl border px-4 py-3.5 text-sm font-bold shadow-sm', error ? 'border-red-200 bg-red-50 text-red-700' : 'border-cyan-200 bg-white text-cyan-900')}><span className={cn('mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] text-white', error ? 'bg-red-500' : 'bg-cyan-500')}>{error ? '!' : 'i'}</span><span className="leading-5">{error || notice}</span></div>}

        {!source ? (
          <section className="overflow-hidden rounded-[30px] border border-white bg-white shadow-[0_24px_70px_-42px_rgba(15,23,42,0.38)] ring-1 ring-slate-200/80">
            <div className="flex flex-col gap-4 border-b border-slate-200 bg-gradient-to-r from-cyan-50 via-white to-violet-50 px-5 py-5 sm:flex-row sm:items-center sm:justify-between md:px-7">
              <div className="flex items-center gap-3"><span className="grid size-10 place-items-center rounded-2xl bg-cyan-600 text-sm font-black text-white shadow-lg shadow-cyan-200">01</span><div><h2 className="font-black text-slate-900">导入需要截取的原视频</h2><p className="mt-0.5 text-xs font-semibold text-slate-500">选择一种方式，视频不会保存进正式素材库</p></div></div>
              <div className="flex items-center gap-2 text-[11px] font-black text-slate-500"><span className="rounded-full bg-white px-3 py-1.5 shadow-sm">最长 10 分钟</span><span className="rounded-full bg-white px-3 py-1.5 shadow-sm">最大 1GB</span></div>
            </div>
            <div className="m-4 grid grid-cols-2 gap-2 rounded-2xl bg-slate-100 p-1.5 md:mx-7 md:mt-6">
              <button type="button" disabled={onlineLoading || uploading} onClick={() => setSourceMode('link')} className={cn('flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-black transition', sourceMode === 'link' ? 'bg-white text-cyan-700 shadow-md ring-1 ring-slate-200' : 'text-slate-500 hover:bg-white/60 hover:text-slate-800')}><Link2 className="size-4" />链接解析</button>
              <button type="button" disabled={onlineLoading || uploading} onClick={() => setSourceMode('upload')} className={cn('flex h-12 items-center justify-center gap-2 rounded-xl text-sm font-black transition', sourceMode === 'upload' ? 'bg-white text-violet-700 shadow-md ring-1 ring-slate-200' : 'text-slate-500 hover:bg-white/60 hover:text-slate-800')}><Upload className="size-4" />本地上传</button>
            </div>
            {sourceMode === 'link' ? <div className="mx-auto max-w-4xl px-5 pb-8 pt-3 md:px-10 md:pb-10">
              <div className="mb-5 flex flex-col gap-3 rounded-2xl border border-cyan-100 bg-cyan-50/70 p-4 sm:flex-row sm:items-center sm:justify-between"><div><div className="flex items-center gap-2 text-sm font-black text-cyan-950"><Link2 className="size-4 text-cyan-600" />粘贴链接或完整分享文字</div><p className="mt-1 text-xs font-semibold leading-5 text-cyan-800/60">支持抖音、快手、微信视频号，解析后直接进入裁切。</p></div><button type="button" disabled={onlineLoading} onClick={() => void openWechatConfig()} className="flex shrink-0 items-center justify-center gap-2 rounded-xl border border-emerald-200 bg-white px-3.5 py-2.5 text-xs font-black text-emerald-700 shadow-sm transition hover:bg-emerald-50"><Settings className="size-3.5" />视频号 Cookie</button></div>
              <textarea value={linkInput} disabled={onlineLoading} onChange={(event) => setLinkInput(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void parseAndLoadOnlineVideo(); }} placeholder="在这里粘贴链接，例如：https://v.douyin.com/…" className="min-h-32 w-full resize-y rounded-2xl border-2 border-slate-200 bg-slate-50 px-5 py-4 text-sm font-semibold leading-6 outline-none transition placeholder:text-slate-400 focus:border-cyan-500 focus:bg-white focus:ring-4 focus:ring-cyan-100 disabled:opacity-60" />
              <button type="button" disabled={onlineLoading || !linkInput.trim()} onClick={() => void parseAndLoadOnlineVideo()} className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-gradient-to-r from-cyan-600 to-blue-600 text-sm font-black text-white shadow-lg shadow-cyan-200 transition hover:-translate-y-0.5 hover:shadow-xl disabled:cursor-not-allowed disabled:opacity-50">{onlineLoading ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}{onlineLoading ? '正在解析并载入视频…' : '开始解析视频'}</button>
              {onlineLoading && onlineProgress && <div className="mt-5 overflow-hidden rounded-2xl border border-cyan-200 bg-gradient-to-br from-cyan-50 to-blue-50 p-4 shadow-sm" role="status" aria-live="polite">
                <div className="flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3">
                    <div className="relative flex size-10 shrink-0 items-center justify-center rounded-full bg-cyan-600 text-white shadow-lg shadow-cyan-200"><LoaderCircle className="size-5 animate-spin" /><span className="absolute inset-0 animate-ping rounded-full border border-cyan-400 opacity-30" /></div>
                    <div className="min-w-0"><div className="truncate text-sm font-black text-slate-800">{onlineProgress.message}</div><div className="mt-1 text-xs font-bold text-slate-500">已等待 {onlineElapsedSeconds} 秒{onlineProgress.downloadedBytes ? ` · 已下载 ${formatSize(onlineProgress.downloadedBytes)}${onlineProgress.totalBytes ? ` / ${formatSize(onlineProgress.totalBytes)}` : ''}` : ''}</div></div>
                  </div>
                  <div className="shrink-0 text-lg font-black tabular-nums text-cyan-700">{Math.round(onlineProgress.percent)}%</div>
                </div>
                <div className="mt-4 h-2.5 overflow-hidden rounded-full bg-white shadow-inner"><div className="relative h-full rounded-full bg-gradient-to-r from-cyan-500 via-blue-500 to-violet-500 transition-[width] duration-500 ease-out" style={{ width: `${onlineProgress.percent}%` }}><span className="absolute inset-0 animate-pulse bg-white/30" /></div></div>
                <div className="mt-4 grid grid-cols-4 gap-1.5">
                  {onlineStages.map((label, index) => <div key={label} className={cn('rounded-lg px-1.5 py-2 text-center text-[10px] font-black transition-colors', index < onlineStageIndex ? 'bg-emerald-100 text-emerald-700' : index === onlineStageIndex ? 'bg-cyan-600 text-white shadow-sm' : 'bg-white/75 text-slate-400')}>{index < onlineStageIndex ? '✓ ' : ''}{label}</div>)}
                </div>
                <p className="mt-3 text-center text-[11px] font-bold text-slate-400">请保持页面打开，较长视频需要更多下载和校验时间</p>
              </div>}
              <div className="mt-4 text-center text-xs text-slate-400">解析不成功时，可切换“本地上传”继续使用。</div>
            </div> : <div className="px-5 pb-8 pt-3 md:px-10 md:pb-10"><button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="group flex min-h-[330px] w-full flex-col items-center justify-center rounded-[26px] border-2 border-dashed border-violet-200 bg-violet-50/50 px-6 transition hover:border-violet-400 hover:bg-violet-50 disabled:cursor-wait">
              <div className="flex size-20 items-center justify-center rounded-3xl bg-gradient-to-br from-violet-500 to-fuchsia-600 text-white shadow-xl shadow-violet-200 transition group-hover:scale-105"><Upload className="size-9" /></div>
              <div className="mt-6 text-xl font-black">{uploading ? `正在上传 ${uploadProgress}%` : '上传需要截取的视频'}</div>
              <div className="mt-2 text-sm text-slate-500">支持最长 10 分钟、最大 1GB 的常见视频</div>
              {uploading && <div className="mt-6 h-2 w-full max-w-md overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div>}
            </button></div>}
          </section>
        ) : (
          <div className="grid items-start gap-6 lg:grid-cols-[minmax(0,1.45fr)_minmax(320px,0.55fr)]">
            <section className="overflow-hidden rounded-[28px] border border-white bg-white p-4 shadow-[0_24px_70px_-44px_rgba(15,23,42,0.5)] ring-1 ring-slate-200/80 md:p-5">
              <div className="mb-4 flex flex-col gap-3 rounded-2xl bg-gradient-to-r from-slate-950 to-slate-800 px-4 py-4 text-white sm:flex-row sm:items-center sm:justify-between">
                <div className="flex min-w-0 items-center gap-3"><span className="grid size-10 shrink-0 place-items-center rounded-xl bg-cyan-500 text-sm font-black">02</span><div className="min-w-0"><div className="truncate text-sm font-black">选择需要保留的镜头</div><div className="mt-1 truncate text-xs font-semibold text-slate-400">{source.fileName} · {source.sourceType === 'online' ? '在线解析 · ' : ''}{formatSize(source.size)} · {source.width}×{source.height}</div></div></div>
                <button type="button" onClick={reset} className="shrink-0 rounded-xl border border-white/15 bg-white/10 px-3 py-2 text-xs font-black text-white transition hover:bg-white/20">更换视频</button>
              </div>
              <div className="overflow-hidden rounded-2xl border-4 border-slate-900 bg-black shadow-xl"><video ref={videoRef} src={source.url} controls playsInline preload="metadata" onTimeUpdate={handleSourcePreviewTimeUpdate} onPause={() => setPreviewingRange(false)} onEnded={() => setPreviewingRange(false)} className="mx-auto max-h-[56vh] w-full object-contain" /></div>
              <div className="mt-5 rounded-2xl border border-cyan-100 bg-cyan-50/55 p-4 ring-1 ring-cyan-100/70">
                <div className="mb-3 flex items-center justify-between gap-4">
                  <div><div className="text-sm font-black text-cyan-950">裁切时间轴</div><div className="mt-0.5 text-xs font-semibold text-cyan-800/60">拖动两条彩色裁切线调整镜头范围</div></div>
                  <div className="shrink-0 rounded-xl bg-cyan-600 px-3 py-2 text-xs font-black text-white shadow-md shadow-cyan-200">已选 {selectedDuration.toFixed(1)} 秒</div>
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
                <button type="button" onClick={() => setPoint('start')} className="rounded-2xl border border-emerald-200 bg-emerald-50 px-4 py-3.5 text-sm font-black text-emerald-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-emerald-100">把当前画面设为开始点</button>
                <button type="button" onClick={() => setPoint('end')} className="rounded-2xl border border-violet-200 bg-violet-50 px-4 py-3.5 text-sm font-black text-violet-700 shadow-sm transition hover:-translate-y-0.5 hover:bg-violet-100">把当前画面设为结束点</button>
              </div>
            </section>

            <aside className="space-y-5 lg:sticky lg:top-20">
              <section className="overflow-hidden rounded-[26px] border border-white bg-white shadow-[0_20px_60px_-42px_rgba(15,23,42,0.45)] ring-1 ring-slate-200/80">
                <div className="flex items-center justify-between bg-gradient-to-r from-cyan-600 to-blue-600 px-5 py-4 text-white"><div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-cyan-100">Step 02</div><h2 className="mt-0.5 font-black">确认截取范围</h2></div><span className="rounded-xl bg-white/15 px-3 py-2 text-xs font-black backdrop-blur">{selectedDuration.toFixed(1)} 秒</span></div>
                <div className="p-5">
                <div className="grid grid-cols-2 gap-3">
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
                <button type="button" disabled={trimming || selectedDuration <= 0.1 || selectedDuration > 60} onClick={trimClip} className="mt-3 flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-black text-white shadow-lg transition hover:-translate-y-0.5 hover:bg-slate-800 disabled:opacity-50">{trimming ? <LoaderCircle className="size-4 animate-spin" /> : <Scissors className="size-4" />}{trimming ? '正在精准截取…' : '确认并开始截取'}</button>
                <p className="mt-3 text-center text-xs leading-5 text-slate-400">建议单个镜头控制在 15 秒内，单次最多 60 秒。</p>
                </div>
              </section>

              {onlineResult && <section className="overflow-hidden rounded-[26px] border border-indigo-200 bg-white shadow-[0_20px_60px_-42px_rgba(79,70,229,0.5)]">
                <div className="flex items-center gap-3 bg-indigo-950 px-5 py-4 text-white"><span className="grid size-9 place-items-center rounded-xl bg-indigo-500"><Link2 className="size-4" /></span><div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-indigo-300">附加工具</div><div className="text-sm font-black">原视频信息与逐字稿</div></div></div>
                <div className="p-5">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><div className="text-xs font-black text-indigo-600">解析成功</div><div className="mt-1 truncate text-sm font-black text-slate-800">{onlineResult.title || '未命名视频'}</div>{onlineResult.authorName && <div className="mt-1 text-xs text-slate-400">作者：{onlineResult.authorName}</div>}</div>
                  {collectOnlineVideoCandidates(onlineResult)[0]?.url && <a href={`/api/proxy/download?url=${encodeURIComponent(collectOnlineVideoCandidates(onlineResult)[0].url)}`} className="shrink-0 rounded-full border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50"><Download className="mr-1 inline size-3.5" />原视频</a>}
                </div>
                <button type="button" disabled={transcriptLoading} onClick={() => void extractOnlineTranscript()} className="mt-4 flex h-11 w-full items-center justify-center gap-2 rounded-xl border border-blue-200 bg-blue-50 text-sm font-black text-blue-700 hover:bg-blue-100 disabled:opacity-60">{transcriptLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{transcriptLoading ? (transcriptStatus || '正在提取逐字稿…') : transcriptText ? '重新提取逐字稿' : '提取视频逐字稿'}</button>
                {transcriptText && <div className="mt-4">
                  <div className="mb-2 flex items-center justify-between"><span className="text-xs font-black text-slate-600">逐字稿（可直接修改）</span><button type="button" onClick={() => void copyTranscript()} className="flex items-center gap-1 text-xs font-bold text-blue-600 hover:text-blue-800"><Copy className="size-3.5" />{transcriptCopied ? '已复制' : '复制'}</button></div>
                  <textarea value={transcriptText} onChange={(event) => setTranscriptText(event.target.value)} className="min-h-36 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 px-3 py-3 text-xs leading-6 text-slate-700 outline-none focus:border-blue-400 focus:bg-white focus:ring-4 focus:ring-blue-100" />
                </div>}
                {!transcriptText && !transcriptLoading && <p className="mt-3 text-center text-xs leading-5 text-slate-400">逐字稿按需提取，不会在解析视频时自动产生额外转写费用。</p>}
                </div>
              </section>}

              {result && <section className="overflow-hidden rounded-[26px] border border-emerald-200 bg-white shadow-[0_22px_65px_-38px_rgba(5,150,105,0.65)] ring-2 ring-emerald-100">
                <div className="flex items-center justify-between bg-gradient-to-r from-emerald-600 to-teal-600 px-5 py-4 text-white"><div><div className="text-[10px] font-black uppercase tracking-[0.18em] text-emerald-100">Step 03</div><div className="mt-0.5 flex items-center gap-2 text-sm font-black"><Check className="size-4" />镜头已经截取完成</div></div><span className="rounded-full bg-white/20 px-3 py-1.5 text-xs font-black">可用于创作</span></div>
                <div className="p-5"><video ref={resultVideoRef} src={result.url} controls playsInline className="aspect-video w-full rounded-xl border-4 border-slate-900 bg-black object-contain shadow-lg" />
                <div className="mt-3 rounded-xl bg-emerald-50 px-3 py-2 text-xs font-bold text-emerald-800">{formatTime(result.startSeconds)} 至 {formatTime(result.endSeconds)} · {formatSize(result.size)}</div>
                <div className="mt-4 grid gap-2">
                  <button type="button" onClick={() => setShowModePicker(true)} className="flex h-12 items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-black text-white shadow-lg shadow-emerald-200 transition hover:-translate-y-0.5 hover:bg-emerald-700"><Play className="size-4 fill-current" />进入视频创作</button>
                  <a href={result.url} download={result.fileName} className="flex h-10 items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"><Download className="size-4" />下载到电脑</a>
                </div>
                </div>
              </section>}
            </aside>
          </div>
        )}

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
        <div className="w-full max-w-lg overflow-hidden rounded-[30px] bg-white shadow-2xl">
          <div className="flex items-start justify-between bg-slate-950 px-6 py-5 text-white"><div><div className="text-[10px] font-black uppercase tracking-[0.2em] text-emerald-300">Step 03 · 进入创作</div><h2 className="mt-1 text-xl font-black">这个镜头要怎么使用？</h2><p className="mt-1 text-sm text-slate-400">视频会直接载入对应模块，无需再次上传。</p></div><button type="button" disabled={preparingCreative} onClick={() => setShowModePicker(false)} className="rounded-full bg-white/10 p-2 text-slate-300 hover:bg-white/20"><X className="size-5" /></button></div>
          <div className="grid gap-3 p-6 sm:grid-cols-2">
            <button type="button" disabled={preparingCreative} onClick={() => useInCreative('direct')} className="group rounded-2xl border-2 border-emerald-200 bg-emerald-50 p-5 text-left transition hover:-translate-y-1 hover:border-emerald-400 hover:shadow-lg disabled:opacity-60"><span className="grid size-11 place-items-center rounded-2xl bg-emerald-600 text-white shadow-lg shadow-emerald-200"><Sparkles className="size-5" /></span><div className="mt-4 font-black text-emerald-950">直接反推</div><div className="mt-1 text-xs font-semibold leading-5 text-emerald-700/75">完整复刻原镜头、动作和运镜</div><div className="mt-4 text-xs font-black text-emerald-700">进入模块 →</div></button>
            <button type="button" disabled={preparingCreative} onClick={() => useInCreative('replace')} className="group rounded-2xl border-2 border-violet-200 bg-violet-50 p-5 text-left transition hover:-translate-y-1 hover:border-violet-400 hover:shadow-lg disabled:opacity-60"><span className="grid size-11 place-items-center rounded-2xl bg-violet-600 text-white shadow-lg shadow-violet-200"><Film className="size-5" /></span><div className="mt-4 font-black text-violet-950">元素替换</div><div className="mt-1 text-xs font-semibold leading-5 text-violet-700/75">保留镜头结构，替换指定人物或物体</div><div className="mt-4 text-xs font-black text-violet-700">进入模块 →</div></button>
          </div>
          {preparingCreative && <div className="mx-6 mb-6 flex items-center justify-center gap-2 rounded-xl bg-slate-100 py-3 text-sm font-bold text-slate-600"><LoaderCircle className="size-4 animate-spin" />正在载入视频创作…</div>}
        </div>
      </div>}
    </div>
  );
}

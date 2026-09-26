import { useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { Check, ChevronDown, Copy, Download, Film, KeyRound, Link2, LoaderCircle, Pause, Play, Scissors, Settings, ShieldCheck, Sparkles, Upload, WandSparkles, X } from 'lucide-react';
import HomeBackButton from '@/src/components/HomeBackButton';
import ModuleQuickNav, { type ModuleId } from '@/src/components/ModuleQuickNav';
import CreativeSubNav from '@/src/components/CreativeSubNav';
import { extractCpTranscript, extractCpTranscriptStream, resolveCpExtract, type DouyinDownloadCandidate, type DouyinResolveResult } from '@/src/lib/douyin';
import { cn } from '@/src/lib/utils';

export type ClipCreativeMode = 'direct' | 'replace';
export type ClipAudioMode = 'none' | 'original' | 'voice';

const MAX_DETECTABLE_SHOTS = 20;

export interface ClipCreativePayload {
  file: File;
  previewUrl: string;
  serverMediaToken: string;
  audioMode: ClipAudioMode;
  audioFile?: File;
  requiredImageFile?: File;
  audioDurationSeconds?: number;
}

interface ClipExtractionPageProps {
  onBack: () => void;
  onNavigate: (page: ModuleId) => void;
  onSwitchToVideo: () => void;
  onSwitchToCopy: () => void;
  onSwitchToReplica?: () => void;
  onUseInCreative: (clip: ClipCreativePayload, mode: ClipCreativeMode) => void;
}

interface UploadedClipSource {
  sourceId: string;
  fileName: string;
  url: string;
  size: number;
  durationSeconds: number;
  width: number;
  height: number;
  fps?: number;
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
  /** 下一个镜头第一帧的原始检测时间；endSeconds 已安全回退到该帧之前。 */
  cutSeconds?: number;
  durationSeconds: number;
}

interface TimedTranscriptWord {
  text: string;
  startSeconds: number;
  endSeconds: number;
  sentenceIndex: number;
  wordIndex: number;
}

interface TimedTranscriptSentence {
  text: string;
  startSeconds: number;
  endSeconds: number;
  words: TimedTranscriptWord[];
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

function formatTimecode(value: number, fps: number) {
  const safeFps = Math.max(1, Math.round(fps || 30));
  const totalFrames = Math.max(0, Math.round(value * safeFps));
  const frames = totalFrames % safeFps;
  const totalSeconds = Math.floor(totalFrames / safeFps);
  const seconds = totalSeconds % 60;
  const minutes = Math.floor(totalSeconds / 60) % 60;
  const hours = Math.floor(totalSeconds / 3600);
  return [hours, minutes, seconds, frames].map((part) => String(part).padStart(2, '0')).join(':');
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
  onSwitchToReplica,
  onUseInCreative,
}: ClipExtractionPageProps) {
  const inputRef = useRef<HTMLInputElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const resultVideoRef = useRef<HTMLVideoElement>(null);
  const timelineRef = useRef<HTMLDivElement>(null);
  const audioTimelineRef = useRef<HTMLDivElement>(null);
  const audioPreviewRef = useRef<HTMLAudioElement>(null);
  const draggingCutLineRef = useRef<'start' | 'end' | null>(null);
  const draggingAudioLineRef = useRef<'start' | 'end' | null>(null);
  const transcriptSelectingRef = useRef(false);
  const transcriptSelectionAnchorRef = useRef<number | null>(null);
  const transcriptSelectionFocusRef = useRef<number | null>(null);
  const uploadRequestRef = useRef<XMLHttpRequest | null>(null);
  const sourceRef = useRef<UploadedClipSource | null>(null);
  const resultRef = useRef<TrimmedClip | null>(null);
  const clipRangeRevisionRef = useRef(0);
  const trimmingRef = useRef(false);
  const [source, setSource] = useState<UploadedClipSource | null>(null);
  const [uploading, setUploading] = useState(false);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [startSeconds, setStartSeconds] = useState(0);
  const [endSeconds, setEndSeconds] = useState(0);
  const [trimming, setTrimming] = useState(false);
  const [detecting, setDetecting] = useState(false);
  const [detectedShots, setDetectedShots] = useState<DetectedShot[]>([]);
  const [selectedShotCount, setSelectedShotCount] = useState(1);
  const [manualShotCount, setManualShotCount] = useState('6');
  const [previewingRange, setPreviewingRange] = useState(false);
  const [currentSeconds, setCurrentSeconds] = useState(0);
  const [result, setResult] = useState<TrimmedClip | null>(null);
  const [notice, setNotice] = useState('');
  const [error, setError] = useState('');
  const [showModePicker, setShowModePicker] = useState(false);
  const [preparingCreative, setPreparingCreative] = useState(false);
  const [selectedCreativeMode, setSelectedCreativeMode] = useState<ClipCreativeMode>('direct');
  const [selectedAudioMode, setSelectedAudioMode] = useState<ClipAudioMode>('none');
  const [audioStartSeconds, setAudioStartSeconds] = useState(0);
  const [audioEndSeconds, setAudioEndSeconds] = useState(0);
  const [activeAudioLine, setActiveAudioLine] = useState<'start' | 'end'>('end');
  const [audioCurrentSeconds, setAudioCurrentSeconds] = useState(0);
  const [audioZoomStart, setAudioZoomStart] = useState(0);
  const [audioZoomEnd, setAudioZoomEnd] = useState(15);
  const [previewingAudio, setPreviewingAudio] = useState(false);
  const [audioWaveformUrl, setAudioWaveformUrl] = useState('');
  const [audioWaveformLoading, setAudioWaveformLoading] = useState(false);
  const [audioShotLoading, setAudioShotLoading] = useState(0);
  const [timedTranscriptSentences, setTimedTranscriptSentences] = useState<TimedTranscriptSentence[]>([]);
  const [timedTranscriptLoading, setTimedTranscriptLoading] = useState(false);
  const [timedTranscriptError, setTimedTranscriptError] = useState('');
  const [transcriptSelectionStart, setTranscriptSelectionStart] = useState<number | null>(null);
  const [transcriptSelectionEnd, setTranscriptSelectionEnd] = useState<number | null>(null);
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
    clipRangeRevisionRef.current++;
    videoRef.current?.pause();
    setPreviewingRange(false);
    if (resultRef.current?.outputId) {
      void cleanupTemporaryFiles(undefined, resultRef.current.outputId);
      resultRef.current = null;
    }
    setResult(null);
  }, [startSeconds, endSeconds, source?.sourceId]);

  useEffect(() => {
    if (!previewingRange || !result) return;
    const video = resultVideoRef.current;
    if (!video) return;
    video.currentTime = 0;
    video.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    void video.play().catch(() => setPreviewingRange(false));
  }, [previewingRange, result]);

  useEffect(() => {
    if (!showModePicker || selectedAudioMode === 'none' || !source || audioWaveformUrl || audioWaveformLoading) return;
    let cancelled = false;
    setAudioWaveformLoading(true);
    void fetch('/api/clips/audio-waveform', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ sourceId: source.sourceId }),
    }).then(async (response) => {
      if (!response.ok) throw new Error(await readApiError(response, '音频波形生成失败'));
      return response.json();
    }).then((data) => {
      if (!cancelled) setAudioWaveformUrl(String(data.url || ''));
    }).catch((caught) => {
      if (!cancelled) setError(caught instanceof Error ? caught.message : '音频波形生成失败');
    }).finally(() => {
      if (!cancelled) setAudioWaveformLoading(false);
    });
    return () => {
      cancelled = true;
      setAudioWaveformLoading(false);
    };
  }, [showModePicker, selectedAudioMode, source?.sourceId, audioWaveformUrl]);

  useEffect(() => {
    if (!timedTranscriptSentences.length) return;
    const words = timedTranscriptSentences.flatMap((sentence) => sentence.words);
    const selectedIndexes = words
      .map((word, index) => ({ index, overlaps: word.endSeconds > audioStartSeconds && word.startSeconds < audioEndSeconds }))
      .filter((item) => item.overlaps)
      .map((item) => item.index);
    if (!selectedIndexes.length) {
      setTranscriptSelectionStart(null);
      setTranscriptSelectionEnd(null);
      return;
    }
    setTranscriptSelectionStart(selectedIndexes[0]);
    setTranscriptSelectionEnd(selectedIndexes[selectedIndexes.length - 1]);
  }, [audioStartSeconds, audioEndSeconds, timedTranscriptSentences]);

  useEffect(() => () => {
    clipRangeRevisionRef.current++;
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
    clipRangeRevisionRef.current++;
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
    setSelectedShotCount(1);
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
    setAudioStartSeconds(0);
    setAudioEndSeconds(0);
    setAudioCurrentSeconds(0);
    setAudioZoomStart(0);
    setAudioZoomEnd(15);
    setPreviewingAudio(false);
    setAudioWaveformUrl('');
    setAudioWaveformLoading(false);
    setAudioShotLoading(0);
    setTimedTranscriptSentences([]);
    setTimedTranscriptLoading(false);
    setTimedTranscriptError('');
    setTranscriptSelectionStart(null);
    setTranscriptSelectionEnd(null);
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
    setSelectedShotCount(1);
    setAudioStartSeconds(0);
    setAudioEndSeconds(Math.min(15, next.durationSeconds));
    setAudioCurrentSeconds(0);
    setAudioZoomStart(0);
    setAudioZoomEnd(Math.min(next.durationSeconds, 18));
    setAudioWaveformUrl('');
    setTimedTranscriptSentences([]);
    setTimedTranscriptError('');
    setTranscriptSelectionStart(null);
    setTranscriptSelectionEnd(null);
    setNotice(message);
    void detectFirstCutForSource(next, 1, true);
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
      activateSource(next, '视频上传完成，正在识别第一个镜头…');
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
      activateSource(next, '在线视频已载入，正在识别第一个镜头…');
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

  async function previewSelectedRange() {
    if (endSeconds <= startSeconds + 0.1 || trimmingRef.current) return;
    if (previewingRange) {
      resultVideoRef.current?.pause();
      setPreviewingRange(false);
      return;
    }
    videoRef.current?.pause();
    // 预览与下载使用同一个裁切文件，原视频的 timeupdate 停播可能越过切点。
    const clip = await trimClip();
    if (clip) setPreviewingRange(true);
  }

  function handleSourcePreviewTimeUpdate() {
    const video = videoRef.current;
    if (!video) return;
    setCurrentSeconds(video.currentTime);
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

  async function detectFirstCutForSource(targetSource: UploadedClipSource, shotCount = 1, automatic = false) {
    const requestedCount = Math.max(1, Math.min(MAX_DETECTABLE_SHOTS, Math.round(shotCount)));
    setDetecting(true);
    setDetectedShots([]);
    setSelectedShotCount(requestedCount);
    setError('');
    if (!automatic) setNotice('');
    try {
      const response = await fetch('/api/clips/detect-first-cut', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: targetSource.sourceId, shotCount: requestedCount }),
      });
      if (!response.ok) throw new Error(await readApiError(response, '自动识别失败'));
      const data = await response.json();
      const shots = Array.isArray(data.shots)
        ? data.shots.filter((item: DetectedShot) => Number.isFinite(Number(item?.endSeconds))).slice(0, requestedCount)
        : [];
      setDetectedShots(shots);
      const selectedShot = shots[Math.min(requestedCount, shots.length) - 1];
      const nextEnd = Math.max(0.1, Math.min(Number(selectedShot?.endSeconds || data.endSeconds), targetSource.durationSeconds, 60));
      setStartSeconds(0);
      setEndSeconds(nextEnd);
      seekTo(nextEnd);
      setNotice(String(data.message || '已给出建议范围，请预览确认。'));
    } catch (caught) {
      setDetectedShots([]);
      const message = caught instanceof Error ? caught.message : '自动识别失败';
      setError(automatic ? `自动识别切镜点失败：${message}。你仍然可以直接拖动两条裁切线。` : message);
    } finally {
      setDetecting(false);
    }
  }

  function detectFirstCut(shotCount = selectedShotCount) {
    if (source) void detectFirstCutForSource(source, shotCount);
  }

  function detectManualShotCount() {
    const count = Number.parseInt(manualShotCount, 10);
    if (!Number.isInteger(count) || count < 6 || count > MAX_DETECTABLE_SHOTS) {
      setError(`手动镜头数量请输入 6-${MAX_DETECTABLE_SHOTS} 之间的整数`);
      return;
    }
    detectFirstCut(count);
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
    if (!source || trimmingRef.current) return;
    const duration = endSeconds - startSeconds;
    if (duration <= 0.1 || duration > 60) {
      setError(duration > 60 ? '单次最多截取 60 秒。' : '请先设置正确的截取范围。');
      return;
    }
    if (resultRef.current) return resultRef.current;
    const rangeRevision = clipRangeRevisionRef.current;
    trimmingRef.current = true;
    setTrimming(true);
    setError('');
    setNotice('');
    try {
      const response = await fetch('/api/clips/trim', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: source.sourceId, startSeconds, endSeconds }),
      });
      if (!response.ok) throw new Error(await readApiError(response, '截取失败'));
      const nextResult = await response.json() as TrimmedClip;
      if (rangeRevision !== clipRangeRevisionRef.current || sourceRef.current?.sourceId !== source.sourceId) {
        await cleanupTemporaryFiles(undefined, nextResult.outputId);
        return;
      }
      resultRef.current = nextResult;
      setResult(nextResult);
      setNotice('镜头已截取完成，可以预览、下载或直接用于视频创作。');
      return nextResult;
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '截取失败，请重试。');
    } finally {
      trimmingRef.current = false;
      setTrimming(false);
    }
  }

  function getAudioFrameStep() {
    return 1 / Math.max(1, source?.fps || 30);
  }

  function snapAudioTime(value: number) {
    const step = getAudioFrameStep();
    return Math.round(Math.max(0, value) / step) * step;
  }

  function zoomAudioAround(start: number, end: number) {
    if (!source) return;
    const selected = Math.max(getAudioFrameStep(), end - start);
    const windowDuration = Math.min(source.durationSeconds, Math.max(4, selected * 1.35));
    let nextStart = Math.max(0, start - (windowDuration - selected) / 2);
    let nextEnd = Math.min(source.durationSeconds, nextStart + windowDuration);
    nextStart = Math.max(0, nextEnd - windowDuration);
    setAudioZoomStart(nextStart);
    setAudioZoomEnd(nextEnd);
  }

  function seekAudio(value: number) {
    const next = Math.max(0, Math.min(source?.durationSeconds || 0, value));
    setAudioCurrentSeconds(next);
    if (audioPreviewRef.current) audioPreviewRef.current.currentTime = next;
  }

  function moveAudioLine(kind: 'start' | 'end', value: number) {
    if (!source) return;
    const frameStep = getAudioFrameStep();
    if (kind === 'start') {
      const next = Math.max(0, audioEndSeconds - 60, Math.min(snapAudioTime(value), audioEndSeconds - frameStep));
      setAudioStartSeconds(next);
      seekAudio(next);
    } else {
      const next = Math.min(source.durationSeconds, audioStartSeconds + 60, Math.max(snapAudioTime(value), audioStartSeconds + frameStep));
      setAudioEndSeconds(next);
      seekAudio(next);
    }
    setActiveAudioLine(kind);
    setPreviewingAudio(false);
    audioPreviewRef.current?.pause();
  }

  function timeFromAudioPointer(clientX: number) {
    if (!source || !audioTimelineRef.current) return 0;
    const bounds = audioTimelineRef.current.getBoundingClientRect();
    const ratio = Math.max(0, Math.min(1, (clientX - bounds.left) / Math.max(1, bounds.width)));
    return audioZoomStart + ratio * Math.max(getAudioFrameStep(), audioZoomEnd - audioZoomStart);
  }

  function beginAudioLineDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!source) return;
    const time = timeFromAudioPointer(event.clientX);
    const kind = Math.abs(time - audioStartSeconds) <= Math.abs(time - audioEndSeconds) ? 'start' : 'end';
    draggingAudioLineRef.current = kind;
    audioTimelineRef.current?.focus();
    event.currentTarget.setPointerCapture(event.pointerId);
    moveAudioLine(kind, time);
  }

  function continueAudioLineDrag(event: ReactPointerEvent<HTMLDivElement>) {
    if (!draggingAudioLineRef.current) return;
    moveAudioLine(draggingAudioLineRef.current, timeFromAudioPointer(event.clientX));
  }

  function endAudioLineDrag(event: ReactPointerEvent<HTMLDivElement>) {
    draggingAudioLineRef.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  }

  function handleAudioTimelineKeyDown(event: ReactKeyboardEvent<HTMLDivElement>) {
    if (event.key === ' ') {
      event.preventDefault();
      previewAudioRange();
      return;
    }
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const direction = event.key === 'ArrowLeft' ? -1 : 1;
    const frameCount = event.shiftKey ? 10 : 1;
    const current = activeAudioLine === 'start' ? audioStartSeconds : audioEndSeconds;
    moveAudioLine(activeAudioLine, current + direction * frameCount * getAudioFrameStep());
  }

  function previewAudioRange() {
    const player = audioPreviewRef.current;
    if (!player || audioEndSeconds <= audioStartSeconds) return;
    if (previewingAudio) {
      player.pause();
      setPreviewingAudio(false);
      return;
    }
    player.currentTime = audioStartSeconds;
    setAudioCurrentSeconds(audioStartSeconds);
    setPreviewingAudio(true);
    void player.play().catch(() => setPreviewingAudio(false));
  }

  function handleAudioPreviewTimeUpdate() {
    const player = audioPreviewRef.current;
    if (!player) return;
    setAudioCurrentSeconds(player.currentTime);
    if (previewingAudio && player.currentTime >= audioEndSeconds - 0.015) {
      player.pause();
      player.currentTime = audioEndSeconds;
      setAudioCurrentSeconds(audioEndSeconds);
      setPreviewingAudio(false);
    }
  }

  async function chooseAudioShotCount(count: number) {
    if (!source) return;
    setAudioShotLoading(count);
    setError('');
    try {
      const response = await fetch('/api/clips/detect-first-cut', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: source.sourceId, shotCount: count }),
      });
      if (!response.ok) throw new Error(await readApiError(response, '音频镜头范围识别失败'));
      const data = await response.json();
      const shots = Array.isArray(data.shots) ? data.shots : [];
      const target = shots[Math.min(count, shots.length) - 1];
      const nextEnd = Math.min(source.durationSeconds, 60, Math.max(getAudioFrameStep(), Number(target?.endSeconds || data.endSeconds || audioEndSeconds)));
      setAudioStartSeconds(0);
      setAudioEndSeconds(nextEnd);
      setActiveAudioLine('end');
      seekAudio(nextEnd);
      zoomAudioAround(0, nextEnd);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : '音频镜头范围识别失败');
    } finally {
      setAudioShotLoading(0);
    }
  }

  function getTimedTranscriptWords() {
    return timedTranscriptSentences.flatMap((sentence) => sentence.words);
  }

  function applyTimedTranscriptSelection(fromIndex: number, toIndex: number) {
    if (!source) return;
    const words = getTimedTranscriptWords();
    if (!words.length) return;
    const startIndex = Math.max(0, Math.min(words.length - 1, Math.min(fromIndex, toIndex)));
    const endIndex = Math.max(startIndex, Math.min(words.length - 1, Math.max(fromIndex, toIndex)));
    const nextStart = Math.max(0, words[startIndex].startSeconds - 0.12);
    const nextEnd = Math.min(source.durationSeconds, 30, words[endIndex].endSeconds + 0.18);
    setTranscriptSelectionStart(startIndex);
    setTranscriptSelectionEnd(endIndex);
    setAudioStartSeconds(nextStart);
    setAudioEndSeconds(nextEnd);
    setActiveAudioLine('end');
    seekAudio(nextEnd);
    zoomAudioAround(nextStart, nextEnd);
  }

  function beginTimedTranscriptSelection(index: number, event: ReactPointerEvent<HTMLSpanElement>) {
    event.preventDefault();
    transcriptSelectingRef.current = true;
    transcriptSelectionAnchorRef.current = index;
    transcriptSelectionFocusRef.current = index;
    setTranscriptSelectionStart(index);
    setTranscriptSelectionEnd(index);
  }

  function extendTimedTranscriptSelection(index: number) {
    if (!transcriptSelectingRef.current) return;
    transcriptSelectionFocusRef.current = index;
    const anchor = transcriptSelectionAnchorRef.current ?? index;
    setTranscriptSelectionStart(Math.min(anchor, index));
    setTranscriptSelectionEnd(Math.max(anchor, index));
  }

  function finishTimedTranscriptSelection() {
    if (!transcriptSelectingRef.current) return;
    transcriptSelectingRef.current = false;
    const anchor = transcriptSelectionAnchorRef.current;
    const focus = transcriptSelectionFocusRef.current;
    if (anchor !== null && focus !== null) applyTimedTranscriptSelection(anchor, focus);
  }

  async function loadTimedTranscript() {
    if (!source || timedTranscriptLoading) return;
    setTimedTranscriptLoading(true);
    setTimedTranscriptError('');
    try {
      const response = await fetch('/api/clips/timed-transcript', {
        method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ sourceId: source.sourceId }),
      });
      if (!response.ok) throw new Error(await readApiError(response, '带时间轴逐字稿识别失败'));
      const data = await response.json();
      const sentences = Array.isArray(data.sentences) ? data.sentences as TimedTranscriptSentence[] : [];
      if (!sentences.length) throw new Error('开头30秒没有识别到可选择的人声文字');
      setTimedTranscriptSentences(sentences);
      setTranscriptSelectionStart(null);
      setTranscriptSelectionEnd(null);
    } catch (caught) {
      setTimedTranscriptError(caught instanceof Error ? caught.message : '带时间轴逐字稿识别失败');
    } finally {
      setTimedTranscriptLoading(false);
    }
  }

  function openCreativePicker(audioMode: ClipAudioMode) {
    if (!result) return;
    setSelectedAudioMode(audioMode);
    setAudioStartSeconds(result.startSeconds);
    setAudioEndSeconds(result.endSeconds);
    setAudioCurrentSeconds(result.startSeconds);
    setActiveAudioLine('end');
    setPreviewingAudio(false);
    zoomAudioAround(result.startSeconds, result.endSeconds);
    setShowModePicker(true);
  }

  async function useInCreative(mode: ClipCreativeMode, audioMode: ClipAudioMode) {
    if (!result) return;
    setPreparingCreative(true);
    setError('');
    try {
      const sourceId = sourceRef.current?.sourceId;
      const file = new File([], result.fileName, { type: 'video/mp4', lastModified: Date.now() });
      let audioFile: File | undefined;
      let requiredImageFile: File | undefined;
      let audioDurationSeconds: number | undefined;
      if (audioMode !== 'none') {
        const response = await fetch('/api/clips/prepare-audio-assets', {
          method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            outputId: result.outputId,
            sourceId,
            audioStartSeconds,
            audioEndSeconds,
          }),
        });
        if (!response.ok) throw new Error(await readApiError(response, '音频准备失败'));
        const assets = await response.json();
        const [audioResponse, imageResponse] = await Promise.all([
          fetch(String(assets.audio?.url || ''), { credentials: 'include' }),
          fetch(String(assets.image?.url || ''), { credentials: 'include' }),
        ]);
        if (!audioResponse.ok || !imageResponse.ok) throw new Error('音频附件载入失败，请重新截取后再试。');
        const [audioBlob, imageBlob] = await Promise.all([audioResponse.blob(), imageResponse.blob()]);
        audioFile = new File([audioBlob], String(assets.audio?.fileName || '镜头原声.mp3'), { type: 'audio/mpeg', lastModified: Date.now() });
        requiredImageFile = new File([imageBlob], String(assets.image?.fileName || '音频辅助图.jpg'), { type: 'image/jpeg', lastModified: Date.now() });
        audioDurationSeconds = Number(assets.audio?.durationSeconds) || Math.max(0, audioEndSeconds - audioStartSeconds);
      }
      sourceRef.current = null;
      resultRef.current = null;
      onUseInCreative({ file, previewUrl: result.url, serverMediaToken: result.outputId, audioMode, audioFile, requiredImageFile, audioDurationSeconds }, mode);
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
  const audioZoomDuration = Math.max(0.001, audioZoomEnd - audioZoomStart);
  const audioStartPercent = ((audioStartSeconds - audioZoomStart) / audioZoomDuration) * 100;
  const audioEndPercent = ((audioEndSeconds - audioZoomStart) / audioZoomDuration) * 100;
  const audioCurrentPercent = ((audioCurrentSeconds - audioZoomStart) / audioZoomDuration) * 100;
  const waveformWidthPercent = source?.durationSeconds ? (source.durationSeconds / audioZoomDuration) * 100 : 100;
  const waveformLeftPercent = -(audioZoomStart / audioZoomDuration) * 100;
  const timedTranscriptWords = getTimedTranscriptWords();
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
          <CreativeSubNav current="clip" onSwitchVideo={onSwitchToVideo} onSwitchClip={() => {}} onSwitchCopy={onSwitchToCopy} onSwitchReplica={onSwitchToReplica} />
        </div>
        <div className="hidden text-xs font-bold text-slate-500 sm:block">最长 10 分钟 · 最大 1GB · 临时使用</div>
      </header>

      <main className="relative mx-auto w-full max-w-6xl flex-1 p-4 md:p-6">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="flex items-center gap-2 text-xl font-black tracking-tight text-slate-950"><Scissors className="size-5 text-cyan-600" />镜头截取</h1>
            <p className="mt-1 text-sm text-slate-500">自动找到第一个镜头，也可按需识别前 2–5 个镜头。</p>
          </div>
          <div className="text-xs font-semibold text-slate-400">最长 10 分钟 · 最大 1GB · 临时文件自动清理</div>
        </div>

        {(error || notice) && <div className={cn('mb-4 flex items-start gap-2 rounded-xl border px-4 py-3 text-sm font-bold', error ? 'border-red-200 bg-red-50 text-red-700' : 'border-cyan-200 bg-cyan-50 text-cyan-900')}><span className={cn('mt-0.5 grid size-4 shrink-0 place-items-center rounded-full text-[9px] text-white', error ? 'bg-red-500' : 'bg-cyan-500')}>{error ? '!' : 'i'}</span><span>{error || notice}</span></div>}

        {!source ? (
          <section className="overflow-hidden rounded-2xl border border-slate-300/90 bg-white shadow-[0_12px_35px_-24px_rgba(15,23,42,0.55)] ring-1 ring-white/80">
            <div className="grid grid-cols-2 border-b border-slate-300/80 bg-gradient-to-r from-slate-100 via-white to-slate-100 p-1.5">
              <button type="button" disabled={onlineLoading || uploading} onClick={() => setSourceMode('link')} className={cn('flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-black transition', sourceMode === 'link' ? 'border-cyan-200 bg-white text-cyan-700 shadow-[0_4px_14px_-8px_rgba(8,145,178,0.8)]' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white/70 hover:text-slate-800')}><Link2 className="size-4" />链接解析</button>
              <button type="button" disabled={onlineLoading || uploading} onClick={() => setSourceMode('upload')} className={cn('flex h-11 items-center justify-center gap-2 rounded-xl border text-sm font-black transition', sourceMode === 'upload' ? 'border-violet-200 bg-white text-violet-700 shadow-[0_4px_14px_-8px_rgba(124,58,237,0.8)]' : 'border-transparent text-slate-500 hover:border-slate-200 hover:bg-white/70 hover:text-slate-800')}><Upload className="size-4" />本地上传</button>
            </div>

            {sourceMode === 'link' ? <div className="mx-auto max-w-4xl bg-[radial-gradient(circle_at_90%_10%,rgba(6,182,212,0.07),transparent_30%)] p-5 md:p-7">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div><div className="text-sm font-black text-slate-800">粘贴视频链接或分享文字</div><div className="mt-1 text-xs text-slate-400">支持抖音、快手和微信视频号</div></div>
                <button type="button" disabled={onlineLoading} onClick={() => void openWechatConfig()} className="flex shrink-0 items-center gap-1.5 rounded-lg border border-slate-300 bg-white px-3 py-2 text-xs font-bold text-slate-600 shadow-sm hover:border-cyan-300 hover:text-cyan-700"><Settings className="size-3.5" />视频号 Cookie</button>
              </div>
              <textarea value={linkInput} disabled={onlineLoading} onChange={(event) => setLinkInput(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') void parseAndLoadOnlineVideo(); }} placeholder="粘贴链接，例如：https://v.douyin.com/…" className="min-h-24 w-full resize-y rounded-xl border border-slate-300 bg-slate-50/80 px-4 py-3 text-sm font-semibold leading-6 shadow-inner shadow-slate-200/40 outline-none transition focus:border-cyan-500 focus:bg-white focus:ring-4 focus:ring-cyan-100 disabled:opacity-60" />
              <button type="button" disabled={onlineLoading || !linkInput.trim()} onClick={() => void parseAndLoadOnlineVideo()} className="mt-3 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-cyan-600 to-sky-600 text-sm font-black text-white shadow-[0_8px_20px_-12px_rgba(8,145,178,0.9)] transition hover:from-cyan-700 hover:to-sky-700 disabled:cursor-not-allowed disabled:from-cyan-300 disabled:to-sky-300 disabled:shadow-none">{onlineLoading ? <LoaderCircle className="size-4 animate-spin" /> : <WandSparkles className="size-4" />}{onlineLoading ? '解析引擎运行中…' : '解析并开始截取'}</button>
              {onlineLoading && onlineProgress && <div className="relative mt-4 overflow-hidden rounded-2xl border border-cyan-200/80 bg-gradient-to-br from-cyan-50 via-white to-sky-50 p-4 text-slate-700 shadow-[0_8px_24px_-16px_rgba(8,145,178,0.25)]" role="status" aria-live="polite">
                <div className="pointer-events-none absolute inset-0 opacity-40 [background-image:linear-gradient(rgba(8,145,178,0.08)_1px,transparent_1px),linear-gradient(90deg,rgba(8,145,178,0.08)_1px,transparent_1px)] [background-size:22px_22px]" />
                <div className="pointer-events-none absolute inset-x-0 top-0 h-px motion-safe:animate-pulse bg-gradient-to-r from-transparent via-cyan-300/70 to-transparent shadow-[0_0_12px_2px_rgba(6,182,212,0.12)] transition-[top] duration-700" style={{ top: `${Math.max(4, Math.min(96, onlineProgress.percent))}%` }} />
                <div className="relative flex items-center justify-between gap-4">
                  <div className="flex min-w-0 items-center gap-3"><span className="relative grid size-9 shrink-0 place-items-center rounded-xl border border-cyan-200 bg-white/90 shadow-sm shadow-cyan-100"><span className="absolute inset-1 motion-safe:animate-ping rounded-lg border border-cyan-300/40" /><LoaderCircle className="size-4 motion-safe:animate-spin text-cyan-600" /></span><div className="min-w-0"><div className="text-[10px] font-black uppercase tracking-[0.22em] text-cyan-600">LINK PROCESSOR</div><div className="mt-1 truncate text-xs font-black text-slate-800">{onlineProgress.message}</div></div></div>
                  <div className="shrink-0 text-right"><div className="font-mono text-lg font-black text-cyan-700">{Math.round(onlineProgress.percent)}%</div><div className="text-[10px] font-bold text-slate-500">耗时 {onlineElapsedSeconds} 秒</div></div>
                </div>
                <div className="relative mt-4 grid grid-cols-4 gap-1.5">
                  {([['parsing', '解析链接'], ['downloading', '下载视频'], ['checking', '校验素材'], ['loading', '载入页面']] as const).map(([stage, label], index, stages) => {
                    const activeIndex = stages.findIndex(([value]) => value === onlineProgress.stage);
                    const done = index < activeIndex;
                    const active = stage === onlineProgress.stage;
                    return <div key={stage} className={cn('rounded-lg border px-2 py-1.5 text-center text-[9px] font-black transition-colors', done ? 'border-emerald-200 bg-emerald-50 text-emerald-700' : active ? 'border-cyan-300 bg-cyan-100/80 text-cyan-800' : 'border-slate-200 bg-white/75 text-slate-500')}>{done ? '✓ ' : active ? '● ' : ''}{label}</div>;
                  })}
                </div>
                <div className="relative mt-3 h-1.5 overflow-hidden rounded-full bg-cyan-100/80"><div className="h-full rounded-full bg-gradient-to-r from-cyan-500 via-sky-400 to-sky-500 shadow-[0_0_8px_rgba(6,182,212,0.2)] transition-[width] duration-500" style={{ width: `${onlineProgress.percent}%` }} /></div>
              </div>}
            </div> : <div className="p-5 md:p-7"><button type="button" disabled={uploading} onClick={() => inputRef.current?.click()} className="group flex min-h-52 w-full flex-col items-center justify-center rounded-2xl border-2 border-dashed border-violet-200 bg-violet-50/40 px-6 transition hover:border-violet-400 hover:bg-violet-50 disabled:cursor-wait">
              <span className="grid size-14 place-items-center rounded-2xl bg-violet-600 text-white shadow-md"><Upload className="size-6" /></span>
              <div className="mt-4 text-base font-black text-slate-900">{uploading ? `正在上传 ${uploadProgress}%` : '选择本地视频'}</div>
              <div className="mt-1 text-xs text-slate-400">最长 10 分钟，最大 1GB</div>
              {uploading && <div className="mt-4 h-1.5 w-full max-w-sm overflow-hidden rounded-full bg-white"><div className="h-full rounded-full bg-violet-500 transition-all" style={{ width: `${uploadProgress}%` }} /></div>}
            </button></div>}
          </section>
        ) : (
          <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,1.55fr)_minmax(300px,0.65fr)]">
            <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="min-w-0"><div className="truncate text-sm font-black text-slate-900">{source.fileName}</div><div className="mt-0.5 text-xs text-slate-400">{formatSize(source.size)} · {source.width}×{source.height} · {source.durationSeconds.toFixed(1)} 秒</div></div>
                <button type="button" onClick={reset} className="shrink-0 rounded-lg border border-slate-200 px-3 py-2 text-xs font-bold text-slate-600 hover:bg-slate-50">更换视频</button>
              </div>
              <div className="overflow-hidden rounded-xl bg-black"><video ref={videoRef} src={source.url} controls playsInline preload="metadata" onTimeUpdate={handleSourcePreviewTimeUpdate} className="mx-auto max-h-[58vh] w-full object-contain" /></div>

              <div className="mt-4">
                <div className="mb-1 flex items-center justify-between text-xs font-bold"><span className="text-emerald-700">开始 {formatTime(startSeconds)}</span><span className="text-slate-400">已选 {selectedDuration.toFixed(1)} 秒</span><span className="text-violet-700">结束 {formatTime(endSeconds)}</span></div>
                <div ref={timelineRef} role="slider" aria-label="视频裁切范围" aria-valuetext={`${formatTime(startSeconds)} 至 ${formatTime(endSeconds)}`} className="relative h-14 touch-none select-none cursor-ew-resize" onPointerDown={beginCutLineDrag} onPointerMove={continueCutLineDrag} onPointerUp={endCutLineDrag} onPointerCancel={endCutLineDrag}>
                  <div className="absolute inset-x-0 top-3 h-8 overflow-hidden rounded-lg bg-slate-300 shadow-inner">
                    <div className="absolute inset-y-0 bg-cyan-500" style={{ left: `${startPercent}%`, width: `${Math.max(0, endPercent - startPercent)}%` }} />
                    <div className="absolute inset-y-0 left-0 bg-slate-900/45" style={{ width: `${startPercent}%` }} />
                    <div className="absolute inset-y-0 right-0 bg-slate-900/45" style={{ width: `${Math.max(0, 100 - endPercent)}%` }} />
                    <div className="absolute inset-y-0 z-20 w-0.5 bg-white" style={{ left: `${Math.max(0, Math.min(100, currentPercent))}%` }} />
                  </div>
                  <div className="pointer-events-none absolute inset-y-0 z-30 w-1 -translate-x-1/2 rounded-full bg-emerald-500 shadow-[0_0_0_2px_white]" style={{ left: `${startPercent}%` }}><span className="absolute left-1/2 top-0 size-4 -translate-x-1/2 rounded-full border-2 border-white bg-emerald-500" /></div>
                  <div className="pointer-events-none absolute inset-y-0 z-30 w-1 -translate-x-1/2 rounded-full bg-violet-500 shadow-[0_0_0_2px_white]" style={{ left: `${endPercent}%` }}><span className="absolute left-1/2 top-0 size-4 -translate-x-1/2 rounded-full border-2 border-white bg-violet-500" /></div>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <button type="button" onClick={() => setPoint('start')} className="rounded-lg border border-emerald-200 py-2.5 text-xs font-black text-emerald-700 hover:bg-emerald-50">当前画面设为开始</button>
                  <button type="button" onClick={() => setPoint('end')} className="rounded-lg border border-violet-200 py-2.5 text-xs font-black text-violet-700 hover:bg-violet-50">当前画面设为结束</button>
                </div>
              </div>
            </section>

            <aside className="space-y-4 lg:sticky lg:top-20">
              <section className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm">
                <div className="flex items-center justify-between"><h2 className="text-sm font-black text-slate-900">截取前几个镜头？</h2><span className="rounded-lg bg-slate-100 px-2.5 py-1 text-xs font-black text-slate-600">{selectedDuration.toFixed(1)} 秒</span></div>
                <p className="mt-1 text-xs leading-5 text-slate-400">默认只识别第一个；选择更多时再继续分析。</p>
                <div className="mt-3 grid grid-cols-5 gap-1.5 rounded-xl bg-slate-100 p-1.5">
                  {[1, 2, 3, 4, 5].map((count) => <button key={count} type="button" disabled={detecting} onClick={() => detectFirstCut(count)} className={cn('h-9 rounded-lg text-xs font-black transition', selectedShotCount === count ? 'bg-cyan-600 text-white shadow-sm' : 'bg-white text-slate-600 hover:text-cyan-700', detecting && 'cursor-wait opacity-60')}>{count}</button>)}
                </div>
                <details className="mt-2 rounded-xl border border-slate-200 bg-white">
                  <summary className="cursor-pointer list-none px-3 py-2 text-xs font-black text-slate-500">手动输入更多镜头</summary>
                  <div className="flex items-center gap-2 border-t border-slate-100 p-2">
                    <input
                      type="number"
                      min={6}
                      max={MAX_DETECTABLE_SHOTS}
                      step={1}
                      value={manualShotCount}
                      onChange={(event) => setManualShotCount(event.target.value)}
                      onKeyDown={(event) => { if (event.key === 'Enter') { event.preventDefault(); detectManualShotCount(); } }}
                      aria-label="手动输入镜头数量"
                      className="h-9 min-w-0 flex-1 rounded-lg border border-slate-200 px-3 text-sm font-black text-slate-700 outline-none focus:border-cyan-400"
                    />
                    <span className="shrink-0 text-xs font-bold text-slate-400">个</span>
                    <button type="button" disabled={detecting} onClick={detectManualShotCount} className="h-9 shrink-0 rounded-lg bg-cyan-600 px-3 text-xs font-black text-white hover:bg-cyan-700 disabled:cursor-wait disabled:opacity-60">开始识别</button>
                  </div>
                  <div className="px-3 pb-2 text-[11px] font-bold text-slate-400">可输入 6–{MAX_DETECTABLE_SHOTS} 个，识别时间会随数量增加。</div>
                </details>
                <div className="mt-2 min-h-5 text-xs font-bold text-cyan-700">{detecting ? <span className="flex items-center gap-1.5"><LoaderCircle className="size-3.5 animate-spin" />正在识别前 {selectedShotCount} 个镜头…</span> : detectedShots.length > 0 ? `已定位前 ${detectedShots.length} 个镜头` : '也可以直接拖动裁切线'}</div>
                <button type="button" disabled={detecting || trimming || selectedDuration <= 0.1} onClick={() => void previewSelectedRange()} className={cn('mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border text-sm font-black disabled:opacity-50', previewingRange ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-slate-200 text-slate-700 hover:bg-slate-50')}><Play className={cn('size-4', previewingRange && 'fill-current')} />{trimming ? '正在准备片段…' : previewingRange ? '停止预览' : '预览裁切片段'}</button>
                <button type="button" disabled={trimming || selectedDuration <= 0.1 || selectedDuration > 60} onClick={() => void trimClip()} className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-50">{trimming ? <LoaderCircle className="size-4 animate-spin" /> : <Scissors className="size-4" />}{trimming ? '正在截取…' : '确认截取'}</button>
              </section>

              {onlineResult && <details className="group rounded-2xl border border-slate-200 bg-white shadow-sm">
                <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-4 py-3.5 text-sm font-black text-slate-700"><span className="flex min-w-0 items-center gap-2"><Sparkles className="size-4 shrink-0 text-indigo-500" /><span className="truncate">逐字稿（按需使用）</span></span><ChevronDown className="size-4 shrink-0 text-slate-400 transition group-open:rotate-180" /></summary>
                <div className="border-t border-slate-100 p-4">
                  <div className="flex items-start justify-between gap-2"><div className="min-w-0"><div className="truncate text-xs font-bold text-slate-700">{onlineResult.title || '未命名视频'}</div>{onlineResult.authorName && <div className="mt-1 text-[11px] text-slate-400">作者：{onlineResult.authorName}</div>}</div>{collectOnlineVideoCandidates(onlineResult)[0]?.url && <a href={`/api/proxy/download?url=${encodeURIComponent(collectOnlineVideoCandidates(onlineResult)[0].url)}`} className="shrink-0 text-xs font-bold text-slate-500 hover:text-slate-800"><Download className="mr-1 inline size-3.5" />原视频</a>}</div>
                  <button type="button" disabled={transcriptLoading} onClick={() => void extractOnlineTranscript()} className="mt-3 flex h-10 w-full items-center justify-center gap-2 rounded-xl border border-indigo-200 bg-indigo-50 text-xs font-black text-indigo-700 hover:bg-indigo-100 disabled:opacity-60">{transcriptLoading ? <LoaderCircle className="size-4 animate-spin" /> : <Sparkles className="size-4" />}{transcriptLoading ? (transcriptStatus || '正在提取…') : transcriptText ? '重新提取逐字稿' : '提取逐字稿'}</button>
                  {transcriptText && <div className="mt-3"><div className="mb-2 flex items-center justify-between"><span className="text-xs font-bold text-slate-500">可直接修改</span><button type="button" onClick={() => void copyTranscript()} className="flex items-center gap-1 text-xs font-bold text-indigo-600"><Copy className="size-3.5" />{transcriptCopied ? '已复制' : '复制'}</button></div><textarea value={transcriptText} onChange={(event) => setTranscriptText(event.target.value)} className="min-h-32 w-full resize-y rounded-xl border border-slate-200 bg-slate-50 p-3 text-xs leading-6 outline-none focus:border-indigo-400" /></div>}
                </div>
              </details>}

              {result && <section className="rounded-2xl border border-emerald-200 bg-white p-4 shadow-sm">
                <div className="flex items-center gap-2 text-sm font-black text-emerald-700"><Check className="size-4" />截取完成</div>
                <video ref={resultVideoRef} src={result.url} controls playsInline onPause={() => setPreviewingRange(false)} onEnded={() => setPreviewingRange(false)} className="mt-3 aspect-video w-full rounded-xl bg-black object-contain" />
                <div className="mt-2 text-xs font-bold text-slate-500">{formatTime(result.startSeconds)} 至 {formatTime(result.endSeconds)} · {formatSize(result.size)}</div>
                <div className="mt-3 rounded-xl border border-violet-200 bg-violet-50 p-3">
                  <div className="text-xs font-black text-violet-900">需要单独使用原视频声音？</div>
                  <div className="mt-1 text-[11px] leading-5 text-violet-600">MP3可以和画面选择不同长度，并支持波形、逐帧微调和区间试听。</div>
                  <button type="button" onClick={() => openCreativePicker('original')} className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-violet-600 text-sm font-black text-white hover:bg-violet-700"><Scissors className="size-4" />精细截取MP3（可选）</button>
                </div>
                <button type="button" onClick={() => openCreativePicker('none')} className="mt-2 flex h-11 w-full items-center justify-center gap-2 rounded-xl bg-emerald-600 text-sm font-black text-white hover:bg-emerald-700"><Play className="size-4 fill-current" />不截音频，进入视频创作</button>
                <a href={result.url} download={result.fileName} className="mt-2 flex h-9 items-center justify-center gap-2 rounded-xl border border-slate-200 text-xs font-bold text-slate-600 hover:bg-slate-50"><Download className="size-4" />下载到电脑</a>
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

      {showModePicker && <div className="fixed inset-0 z-50 grid place-items-center overflow-y-auto bg-slate-950/55 p-4 backdrop-blur-sm" onMouseDown={(event) => { if (event.target === event.currentTarget && !preparingCreative) { audioPreviewRef.current?.pause(); setPreviewingAudio(false); setShowModePicker(false); } }}>
        <div className={cn('my-5 w-full overflow-hidden rounded-3xl bg-white shadow-2xl', selectedAudioMode === 'none' ? 'max-w-xl' : 'max-w-3xl')}>
          <div className="flex items-start justify-between bg-slate-950 px-6 py-5 text-white"><div><h2 className="text-xl font-black">进入视频创作</h2><p className="mt-1 text-sm text-slate-400">原视频只进入左侧反推，右侧不会上传原视频。</p></div><button type="button" disabled={preparingCreative} onClick={() => { audioPreviewRef.current?.pause(); setPreviewingAudio(false); setShowModePicker(false); }} className="rounded-full bg-white/10 p-2 text-slate-300 hover:bg-white/20"><X className="size-5" /></button></div>
          <div className="space-y-5 p-6">
            <div><div className="mb-2 text-sm font-black text-slate-800">1. 创作方式</div><div className="grid grid-cols-2 gap-2">
              <button type="button" disabled={preparingCreative} onClick={() => setSelectedCreativeMode('direct')} className={cn('rounded-xl border-2 p-3 text-left transition', selectedCreativeMode === 'direct' ? 'border-emerald-500 bg-emerald-50' : 'border-slate-200 hover:border-emerald-200')}><div className="flex items-center gap-2 font-black text-slate-900"><Sparkles className="size-4 text-emerald-600" />直接反推</div><div className="mt-1 text-xs text-slate-500">完整复刻镜头与动作</div></button>
              <button type="button" disabled={preparingCreative} onClick={() => setSelectedCreativeMode('replace')} className={cn('rounded-xl border-2 p-3 text-left transition', selectedCreativeMode === 'replace' ? 'border-violet-500 bg-violet-50' : 'border-slate-200 hover:border-violet-200')}><div className="flex items-center gap-2 font-black text-slate-900"><Film className="size-4 text-violet-600" />元素替换</div><div className="mt-1 text-xs text-slate-500">复刻镜头并替换元素</div></button>
            </div></div>
            <div><div className="mb-2 text-sm font-black text-slate-800">2. 声音方式</div><div className="space-y-2">
              {([
                ['none', '不使用音频', '保持原来的创作流程，不生成MP3'],
                ['original', '沿用原声音频', '自动提取MP3，成片完全使用原台词和节奏'],
                ['voice', '参考原音色说新台词', '自动提取MP3，新台词从“额外调整”读取'],
              ] as const).map(([value, title, detail]) => <button key={value} type="button" disabled={preparingCreative} onClick={() => { setSelectedAudioMode(value); if (value === 'none') { audioPreviewRef.current?.pause(); setPreviewingAudio(false); } }} className={cn('flex w-full items-center gap-3 rounded-xl border-2 px-4 py-3 text-left transition', selectedAudioMode === value ? 'border-cyan-500 bg-cyan-50' : 'border-slate-200 hover:border-cyan-200')}><span className={cn('size-4 shrink-0 rounded-full border-2', selectedAudioMode === value ? 'border-cyan-600 bg-cyan-600 shadow-[inset_0_0_0_3px_white]' : 'border-slate-300')} /><span><span className="block text-sm font-black text-slate-900">{title}</span><span className="mt-0.5 block text-xs text-slate-500">{detail}</span></span></button>)}
            </div></div>
            {selectedAudioMode !== 'none' && source && <section className="rounded-2xl border border-violet-200 bg-violet-50/50 p-4">
              <audio ref={audioPreviewRef} src={source.url} preload="metadata" onTimeUpdate={handleAudioPreviewTimeUpdate} onPause={() => setPreviewingAudio(false)} onEnded={() => setPreviewingAudio(false)} />
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div><div className="text-sm font-black text-slate-900">3. 精细截取MP3</div><div className="mt-1 text-xs text-slate-500">画面范围和MP3范围彼此独立。点击开始线或结束线后，用键盘左右键逐帧调整。</div></div>
                <button type="button" onClick={() => { const nextStart = result?.startSeconds || 0; const nextEnd = result?.endSeconds || 0; setAudioStartSeconds(nextStart); setAudioEndSeconds(nextEnd); setActiveAudioLine('end'); seekAudio(nextEnd); zoomAudioAround(nextStart, nextEnd); }} className="rounded-lg border border-violet-200 bg-white px-3 py-2 text-xs font-black text-violet-700 hover:bg-violet-50">跟随画面范围</button>
              </div>
              <div className="mt-3 flex items-center gap-2">
                <span className="shrink-0 text-[11px] font-black text-slate-500">快速选择</span>
                <div className="grid flex-1 grid-cols-5 gap-1.5">
                  {[1, 2, 3, 4, 5].map((count) => <button key={count} type="button" disabled={audioShotLoading > 0} onClick={() => void chooseAudioShotCount(count)} className="h-8 rounded-lg border border-violet-100 bg-white text-[11px] font-black text-violet-700 hover:border-violet-300 disabled:opacity-50">{audioShotLoading === count ? <LoaderCircle className="mx-auto size-3.5 animate-spin" /> : `前${count}镜`}</button>)}
                </div>
              </div>
              <div className="mt-3 rounded-xl border border-indigo-200 bg-white p-3">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <div><div className="text-xs font-black text-indigo-900">按逐字稿选择音频</div><div className="mt-0.5 text-[10px] leading-4 text-slate-400">只识别视频开头30秒；文字与紫色音频线双向联动。黄色文字表示裁切线落在这个字内部，需要继续微调。</div></div>
                  <button type="button" disabled={timedTranscriptLoading} onClick={() => void loadTimedTranscript()} className="flex h-8 items-center gap-1.5 rounded-lg bg-indigo-600 px-3 text-[11px] font-black text-white hover:bg-indigo-700 disabled:opacity-60">{timedTranscriptLoading ? <LoaderCircle className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}{timedTranscriptLoading ? '正在识别时间轴…' : timedTranscriptSentences.length ? '重新载入时间轴' : '识别开头30秒逐字稿'}</button>
                </div>
                {timedTranscriptError && <div className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600">{timedTranscriptError}</div>}
                {timedTranscriptSentences.length > 0 && <div className="mt-3">
                  <div className="max-h-44 space-y-2 overflow-y-auto rounded-lg bg-slate-50 p-2.5" onPointerUp={finishTimedTranscriptSelection} onPointerCancel={finishTimedTranscriptSelection} onPointerLeave={finishTimedTranscriptSelection}>
                    {timedTranscriptSentences.map((sentence, sentenceIndex) => {
                      const firstIndex = timedTranscriptWords.indexOf(sentence.words[0]);
                      const lastIndex = timedTranscriptWords.indexOf(sentence.words[sentence.words.length - 1]);
                      return <div key={`${sentenceIndex}-${sentence.startSeconds}`} className="group flex items-start gap-2 rounded-lg px-1.5 py-1 hover:bg-white">
                        <button type="button" onClick={() => applyTimedTranscriptSelection(firstIndex, lastIndex)} className="mt-0.5 shrink-0 rounded bg-indigo-100 px-1.5 py-0.5 font-mono text-[9px] font-black text-indigo-600" title="选择整句话">{formatTime(sentence.startSeconds)}</button>
                        <div className="min-w-0 flex-1 select-none text-sm leading-7 text-slate-700">
                          {sentence.words.map((word) => {
                            const globalIndex = timedTranscriptWords.indexOf(word);
                            const selected = transcriptSelectionStart !== null && transcriptSelectionEnd !== null && globalIndex >= transcriptSelectionStart && globalIndex <= transcriptSelectionEnd;
                            const boundaryCutsWord = selected && ((audioStartSeconds > word.startSeconds && audioStartSeconds < word.endSeconds) || (audioEndSeconds > word.startSeconds && audioEndSeconds < word.endSeconds));
                            return <span key={`${sentenceIndex}-${word.wordIndex}-${globalIndex}`} onPointerDown={(event) => beginTimedTranscriptSelection(globalIndex, event)} onPointerEnter={() => extendTimedTranscriptSelection(globalIndex)} className={cn('cursor-crosshair rounded px-0.5 transition-colors', boundaryCutsWord ? 'bg-amber-400 font-black text-amber-950' : selected ? 'bg-indigo-500 font-black text-white' : 'hover:bg-indigo-100')} title={boundaryCutsWord ? '音频线切在这个字内部，建议继续微调' : undefined}>{word.text}</span>;
                          })}
                        </div>
                      </div>;
                    })}
                  </div>
                  {transcriptSelectionStart !== null && transcriptSelectionEnd !== null && <div className="mt-2 rounded-lg bg-indigo-50 px-3 py-2 text-[11px] leading-5 text-indigo-700"><span className="font-black">当前音频对应文字：</span>{timedTranscriptWords.slice(transcriptSelectionStart, transcriptSelectionEnd + 1).map((word) => word.text).join('')}<span className="ml-2 font-bold text-indigo-400">拖动波形线时这里会实时变化</span></div>}
                </div>}
              </div>
              <div className="mt-4 grid grid-cols-2 gap-2">
                <button type="button" onClick={() => { setActiveAudioLine('start'); requestAnimationFrame(() => audioTimelineRef.current?.focus()); }} className={cn('rounded-xl border-2 px-3 py-2 text-left', activeAudioLine === 'start' ? 'border-fuchsia-500 bg-white' : 'border-transparent bg-white/70')}><span className="block text-[10px] font-black text-fuchsia-600">音频开始</span><span className="font-mono text-sm font-black text-slate-800">{formatTimecode(audioStartSeconds, source.fps || 30)}</span><span className="ml-2 text-[10px] text-slate-400">{audioStartSeconds.toFixed(3)}秒</span></button>
                <button type="button" onClick={() => { setActiveAudioLine('end'); requestAnimationFrame(() => audioTimelineRef.current?.focus()); }} className={cn('rounded-xl border-2 px-3 py-2 text-left', activeAudioLine === 'end' ? 'border-violet-500 bg-white' : 'border-transparent bg-white/70')}><span className="block text-[10px] font-black text-violet-600">音频结束</span><span className="font-mono text-sm font-black text-slate-800">{formatTimecode(audioEndSeconds, source.fps || 30)}</span><span className="ml-2 text-[10px] text-slate-400">{audioEndSeconds.toFixed(3)}秒</span></button>
              </div>
              <div className="mt-3 flex items-center justify-between gap-3 text-[10px] font-bold text-slate-500"><span>当前显示 {formatTime(audioZoomStart)}—{formatTime(audioZoomEnd)}</span><span className="flex gap-1.5"><button type="button" onClick={() => zoomAudioAround(audioStartSeconds, audioEndSeconds)} className="rounded-md bg-violet-100 px-2 py-1 text-violet-700">放大到选区</button><button type="button" onClick={() => { setAudioZoomStart(0); setAudioZoomEnd(source.durationSeconds); }} className="rounded-md bg-white px-2 py-1 text-slate-600">查看全片</button></span></div>
              <div
                ref={audioTimelineRef}
                role="slider"
                tabIndex={0}
                aria-label="MP3精细截取范围"
                aria-valuetext={`${formatTimecode(audioStartSeconds, source.fps || 30)} 至 ${formatTimecode(audioEndSeconds, source.fps || 30)}`}
                onKeyDown={handleAudioTimelineKeyDown}
                onPointerDown={beginAudioLineDrag}
                onPointerMove={continueAudioLineDrag}
                onPointerUp={endAudioLineDrag}
                onPointerCancel={endAudioLineDrag}
                className="relative mt-3 h-24 touch-none select-none overflow-hidden rounded-xl border border-violet-200 bg-white outline-none ring-violet-300 focus:ring-2"
              >
                {audioWaveformLoading ? <div className="absolute inset-0 flex items-center justify-center gap-2 text-xs font-bold text-violet-500"><LoaderCircle className="size-4 animate-spin" />正在生成轻量波形…</div> : audioWaveformUrl ? <img src={audioWaveformUrl} alt="音频波形" draggable={false} className="pointer-events-none absolute top-0 h-full max-w-none opacity-80" style={{ width: `${waveformWidthPercent}%`, left: `${waveformLeftPercent}%` }} /> : <div className="absolute inset-0 grid place-items-center text-xs font-bold text-slate-400">波形不可用，仍可通过播放和逐帧调整</div>}
                <div className="pointer-events-none absolute inset-y-0 left-0 bg-slate-900/25" style={{ width: `${Math.max(0, Math.min(100, audioStartPercent))}%` }} />
                <div className="pointer-events-none absolute inset-y-0 right-0 bg-slate-900/25" style={{ width: `${Math.max(0, Math.min(100, 100 - audioEndPercent))}%` }} />
                <div className="pointer-events-none absolute inset-y-0 bg-violet-400/10" style={{ left: `${Math.max(0, Math.min(100, audioStartPercent))}%`, width: `${Math.max(0, Math.min(100, audioEndPercent) - Math.max(0, audioStartPercent))}%` }} />
                {audioCurrentPercent >= 0 && audioCurrentPercent <= 100 && <div className="pointer-events-none absolute inset-y-0 z-20 w-0.5 bg-slate-900" style={{ left: `${audioCurrentPercent}%` }} />}
                <div className={cn('pointer-events-none absolute inset-y-0 z-30 w-1 -translate-x-1/2 bg-fuchsia-500', activeAudioLine === 'start' && 'shadow-[0_0_0_2px_white]')} style={{ left: `${Math.max(0, Math.min(100, audioStartPercent))}%` }}><span className="absolute -top-1 left-1/2 size-4 -translate-x-1/2 rounded-full border-2 border-white bg-fuchsia-500" /></div>
                <div className={cn('pointer-events-none absolute inset-y-0 z-30 w-1 -translate-x-1/2 bg-violet-600', activeAudioLine === 'end' && 'shadow-[0_0_0_2px_white]')} style={{ left: `${Math.max(0, Math.min(100, audioEndPercent))}%` }}><span className="absolute -top-1 left-1/2 size-4 -translate-x-1/2 rounded-full border-2 border-white bg-violet-600" /></div>
              </div>
              <div className="mt-3 flex flex-wrap items-center gap-2">
                <button type="button" onClick={previewAudioRange} className={cn('flex h-9 items-center gap-2 rounded-lg border px-3 text-xs font-black', previewingAudio ? 'border-amber-300 bg-amber-50 text-amber-700' : 'border-violet-200 bg-white text-violet-700')} >{previewingAudio ? <Pause className="size-3.5 fill-current" /> : <Play className="size-3.5 fill-current" />}{previewingAudio ? '停止试听' : '试听MP3范围'}</button>
                <button type="button" onClick={() => moveAudioLine('start', audioPreviewRef.current?.currentTime || 0)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600">当前播放点设为开始</button>
                <button type="button" onClick={() => moveAudioLine('end', audioPreviewRef.current?.currentTime || 0)} className="h-9 rounded-lg border border-slate-200 bg-white px-3 text-xs font-black text-slate-600">当前播放点设为结束</button>
                <span className="ml-auto text-[11px] font-bold text-slate-500">{Math.round(source.fps || 30)}fps · ←/→ 1帧 · Shift+←/→ 10帧 · 空格试听</span>
              </div>
              <div className="mt-3 rounded-lg bg-white/80 px-3 py-2 text-[11px] font-bold leading-5 text-slate-500">{selectedAudioMode === 'original' ? `沿用原声：成片时长会按这段MP3自动设为 ${Math.max(1, Math.ceil(audioEndSeconds - audioStartSeconds))} 秒，画面仍只参考左侧截取的镜头。` : '参考音色：这段MP3只提供音色，不改变画面或成片时长。'}</div>
            </section>}
            <button type="button" disabled={preparingCreative} onClick={() => void useInCreative(selectedCreativeMode, selectedAudioMode)} className="flex h-12 w-full items-center justify-center gap-2 rounded-xl bg-slate-950 text-sm font-black text-white hover:bg-slate-800 disabled:opacity-60">{preparingCreative ? <LoaderCircle className="size-4 animate-spin" /> : <Play className="size-4 fill-current" />}{preparingCreative ? (selectedAudioMode === 'none' ? '正在载入视频…' : '正在提取音频并载入…') : '进入视频创作'}</button>
          </div>
        </div>
      </div>}
    </div>
  );
}

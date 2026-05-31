import { useEffect, useRef, useState } from "react";
import {
  ArrowLeft,
  Download,
  Loader2,
  Zap,
  CheckCircle2,
  Copy,
  AudioLines,
  FileText,
  AlertCircle,
  Link2,
  Sparkles,
  Trash2,
  Play,
  User,
  Clock,
  X,
  Upload,
  Globe,
  Tag,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ModuleQuickNav from "@/src/components/ModuleQuickNav";
import SiteFooter from "@/src/components/SiteFooter";
import { cn } from "@/src/lib/utils";
import {
  downloadDouyinVideoFile,
  directDownloadDouyinVideoFile,
  extractCpLocalTranscript,
  extractCpTranscript,
  extractCpTranscriptStream,
  extractDouyinTranscript,
  extractLocalVideoTranscript,
  getDouyinConfigStatus,
  polishDouyinTranscript,
  resolveCpExtract,
  resolveDouyinDownload,
  type DouyinConfigStatus,
  type DouyinResolveResult,
  type DouyinTranscriptResult,
} from "@/src/lib/douyin";

interface DouyinDownloaderPageProps {
  onBack: () => void;
  onNavigate: (page: 'voice' | 'creative' | 'douyin' | 'collection' | 'image' | 'topmodel' | 'universal') => void;
}

interface DiffPart {
  type: 'same' | 'removed' | 'added';
  text: string;
}

function computeTextDiff(oldText: string, newText: string): DiffPart[] {
  const a = oldText;
  const b = newText;
  const m = a.length;
  const n = b.length;

  if (m === 0) return b ? [{ type: 'added', text: b }] : [];
  if (n === 0) return a ? [{ type: 'removed', text: a }] : [];

  const dp: number[][] = Array(m + 1)
    .fill(null)
    .map(() => Array(n + 1).fill(0));

  for (let i = 1; i <= m; i++) {
    for (let j = 1; j <= n; j++) {
      if (a[i - 1] === b[j - 1]) {
        dp[i][j] = dp[i - 1][j - 1] + 1;
      } else {
        dp[i][j] = Math.max(dp[i - 1][j], dp[i][j - 1]);
      }
    }
  }

  const raw: DiffPart[] = [];
  let i = m;
  let j = n;

  while (i > 0 || j > 0) {
    if (i > 0 && j > 0 && a[i - 1] === b[j - 1]) {
      raw.push({ type: 'same', text: a[i - 1] });
      i--;
      j--;
    } else if (j > 0 && (i === 0 || dp[i][j - 1] >= dp[i - 1][j])) {
      raw.push({ type: 'added', text: b[j - 1] });
      j--;
    } else {
      raw.push({ type: 'removed', text: a[i - 1] });
      i--;
    }
  }

  raw.reverse();

  const merged: DiffPart[] = [];
  for (const part of raw) {
    const last = merged[merged.length - 1];
    if (last && last.type === part.type) {
      last.text += part.text;
    } else {
      merged.push({ type: part.type, text: part.text });
    }
  }

  return merged;
}

function formatDuration(seconds: number): string {
  if (!seconds || seconds <= 0) return '';
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  if (m > 0) {
    return `${m}分${s > 0 ? `${s}秒` : ''}`;
  }
  return `${s}秒`;
}

function normalizeDisplayTags(tags?: string[]): string[] {
  if (!Array.isArray(tags)) return [];
  return Array.from(
    new Set(
      tags
        .map((tag) => String(tag || '').replace(/^#/, '').trim())
        .filter((tag) => tag && tag !== '[object Object]')
    )
  );
}

function buildVideoStreamUrl(videoUrl: string, result: DouyinResolveResult, asDownload = false): string {
  const params = new URLSearchParams({
    url: videoUrl,
    videoId: result.videoId || '',
    platform: result.platform || 'douyin',
  });
  if (asDownload) params.set('download', '1');
  return `/api/douyin/video-stream?${params.toString()}`;
}

function collectPreviewCandidateUrls(result: DouyinResolveResult): string[] {
  const seen = new Set<string>();
  const urls = [
    result.previewUrl,
    ...(result.videoUrlCandidates || []).map((candidate) => candidate.url),
    ...(result.downloadUrlCandidates || []).map((candidate) => candidate.url),
    ...(result.videoUrls || []),
    result.downloadUrl,
  ];

  return urls.filter((url): url is string => {
    if (!url || !/^https?:\/\//i.test(url) || seen.has(url)) return false;
    seen.add(url);
    return true;
  });
}

async function pickFastestPreviewUrl(result: DouyinResolveResult): Promise<string> {
  const urls = collectPreviewCandidateUrls(result).slice(0, 10);
  if (urls.length <= 1) return urls[0] || '';

  const controllers: AbortController[] = [];
  const probes = urls.map((url) => new Promise<{ url: string; elapsedMs: number }>((resolve, reject) => {
    const controller = new AbortController();
    controllers.push(controller);
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, 2800);
    const startedAt = performance.now();

    fetch(buildVideoStreamUrl(url, result), {
      credentials: 'include',
      headers: { Range: 'bytes=0-1023' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok && response.status !== 206) {
          throw new Error(`HTTP ${response.status}`);
        }
        await response.arrayBuffer();
        resolve({ url, elapsedMs: performance.now() - startedAt });
      })
      .catch(reject)
      .finally(() => {
        window.clearTimeout(timeoutId);
      });
  }));

  try {
    const fastest = await Promise.any(probes);
    controllers.forEach((controller) => controller.abort());
    return fastest.url;
  } catch {
    return urls[0] || '';
  }
}

async function pickFastestDownloadUrl(result: DouyinResolveResult): Promise<string> {
  const candidates = [
    ...(result.downloadUrlCandidates || []),
    ...(result.videoUrlCandidates || []),
    ...(result.videoUrls || []).map((url) => ({ url })),
    ...(result.downloadUrl ? [{ url: result.downloadUrl, hasAudio: true }] : []),
  ];
  const seen = new Set<string>();
  const urls = candidates
    .filter((candidate) => {
      if (!candidate?.url || !/^https?:\/\//i.test(candidate.url) || seen.has(candidate.url)) return false;
      if (candidate.hasAudio === false) return false;
      seen.add(candidate.url);
      return true;
    })
    .sort((left, right) => Number(right.hasAudio === true) - Number(left.hasAudio === true))
    .slice(0, 8);

  if (urls.length <= 1) return urls[0]?.url || '';

  const controllers: AbortController[] = [];
  const probes = urls.map((candidate) => new Promise<{
    url: string;
    score: number;
  }>((resolve, reject) => {
    const controller = new AbortController();
    controllers.push(controller);
    const timeoutId = window.setTimeout(() => {
      controller.abort();
    }, 3600);
    const startedAt = performance.now();

    fetch(buildVideoStreamUrl(candidate.url, result), {
      credentials: 'include',
      headers: { Range: 'bytes=0-262143' },
      signal: controller.signal,
    })
      .then(async (response) => {
        if (!response.ok && response.status !== 206) {
          throw new Error(`HTTP ${response.status}`);
        }
        const contentType = response.headers.get('content-type') || '';
        if (contentType && !/video|octet-stream/i.test(contentType)) {
          throw new Error(`Invalid content-type ${contentType}`);
        }

        const buffer = await response.arrayBuffer();
        if (buffer.byteLength < 1024) {
          throw new Error('响应内容过小');
        }

        const elapsedMs = Math.max(1, performance.now() - startedAt);
        const contentRange = response.headers.get('content-range') || '';
        const contentLength = Number(response.headers.get('content-length') || '0');
        const throughput = buffer.byteLength / elapsedMs;
        let score = throughput;
        if (candidate.hasAudio === true) score += 5000;
        if (response.status === 206 || contentRange) score += 1500;
        if (contentLength > 0) score += 300;
        resolve({ url: candidate.url, score });
      })
      .catch(reject)
      .finally(() => {
        window.clearTimeout(timeoutId);
      });
  }));

  try {
    const results = await Promise.allSettled(probes);
    controllers.forEach((controller) => controller.abort());
    const fulfilled = results
      .filter((item): item is PromiseFulfilledResult<{ url: string; score: number }> => item.status === 'fulfilled')
      .map((item) => item.value)
      .sort((left, right) => right.score - left.score);
    return fulfilled[0]?.url || urls[0]?.url || '';
  } catch {
    return urls[0]?.url || '';
  }
}

function warmPreviewMetadata(videoUrl: string, result: DouyinResolveResult) {
  if (!videoUrl) return;
  const video = document.createElement('video');
  video.preload = 'metadata';
  video.muted = true;
  video.playsInline = true;
  video.style.display = 'none';
  video.src = buildVideoStreamUrl(videoUrl, result);
  video.load();
  document.body.appendChild(video);
  window.setTimeout(() => {
    video.remove();
  }, 45_000);
}

export default function DouyinDownloaderPage({ onBack, onNavigate }: DouyinDownloaderPageProps) {
  const [input, setInput] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isDirectDownloading, setIsDirectDownloading] = useState(false);
  const [isTranscriptLoading, setIsTranscriptLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DouyinResolveResult | null>(null);
  const [transcriptResult, setTranscriptResult] = useState<DouyinTranscriptResult | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'done' | 'error'>('idle');
  const [configStatus, setConfigStatus] = useState<DouyinConfigStatus | null>(null);
  const [isPolishing, setIsPolishing] = useState(false);
  const [displayTranscript, setDisplayTranscript] = useState('');
  const [originalTranscript, setOriginalTranscript] = useState('');
  const [transcriptLoadingMessage, setTranscriptLoadingMessage] = useState('');
  const [showDiff, setShowDiff] = useState(true);
  const [showVideoPreview, setShowVideoPreview] = useState(false);
  const [fastPreviewUrl, setFastPreviewUrl] = useState('');
  const [fastDownloadUrl, setFastDownloadUrl] = useState('');
  const [isLocalTranscriptLoading, setIsLocalTranscriptLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'link' | 'local'>('link');
  const [asrEngine, setAsrEngine] = useState<'siliconflow' | 'qwen'>('qwen');
  const [activeMode, setActiveMode] = useState<'menu' | 'copypilot' | 'local' | 'link'>('menu');
  const [localVideoUrl, setLocalVideoUrl] = useState<string>('');
  const [extractStep, setExtractStep] = useState<'idle' | 'resolving' | 'downloading' | 'extracting_audio' | 'transcribing' | 'done' | 'error'>('idle');
  const resultRef = useRef<HTMLDivElement>(null);
  const localVideoInputRef = useRef<HTMLInputElement>(null);
  const previewVideoRef = useRef<HTMLVideoElement>(null);
  const previewProbeIdRef = useRef(0);
  const downloadProbeIdRef = useRef(0);
  const hasResult = !!result || !!transcriptResult || isLocalTranscriptLoading;
  const siliconFlowConfigured = configStatus?.siliconFlowApiKey === true;
  const tikhubConfigured = configStatus?.tikhubApiToken === true;
  const arkApiKeyConfigured = configStatus?.arkApiKey === true;
  const dashscopeConfigured = configStatus?.dashscopeApiKey === true;
  const displayTags = normalizeDisplayTags(result?.tags);
  const previewDirectUrl = fastPreviewUrl || result?.previewUrl || result?.videoUrls?.[0] || result?.downloadUrl || '';
  const previewProxyUrl = result && previewDirectUrl ? buildVideoStreamUrl(previewDirectUrl, result) : '';

  useEffect(() => {
    window.scrollTo({ top: 0, left: 0 });
  }, []);

  useEffect(() => {
    return () => {
      if (localVideoUrl) {
        URL.revokeObjectURL(localVideoUrl);
      }
    };
  }, [localVideoUrl]);

  useEffect(() => {
    if (!showVideoPreview || !previewDirectUrl) return;
    const timer = window.setTimeout(() => {
      const video = previewVideoRef.current;
      if (!video) return;
      video.play().catch(() => {
        video.muted = true;
        video.play().catch(() => {});
      });
    }, 80);
    return () => window.clearTimeout(timer);
  }, [showVideoPreview, previewDirectUrl]);

  useEffect(() => {
    let cancelled = false;

    async function loadConfigStatus() {
      const status = await getDouyinConfigStatus();
      if (!cancelled) {
        setConfigStatus(status);
      }
    }

    loadConfigStatus();

    return () => {
      cancelled = true;
    };
  }, []);

  async function handleResolve() {
    const nextInput = input.trim();
    if (!nextInput) {
      setError('请先粘贴抖音链接或整段分享文本。');
      setResult(null);
      setTranscriptResult(null);
      return;
    }

    setIsResolving(true);
    setError('');
    setResult(null);
    setTranscriptResult(null);
    setCopyStatus('idle');

    try {
      const response = await resolveCpExtract(nextInput);
      setResult(response);
      setFastPreviewUrl(response.previewUrl || response.videoUrls?.[0] || response.downloadUrl || '');
      setFastDownloadUrl(response.downloadUrl || response.videoUrls?.[0] || '');

      const previewProbeId = previewProbeIdRef.current + 1;
      previewProbeIdRef.current = previewProbeId;
      void pickFastestPreviewUrl(response).then((fastestUrl) => {
        if (!fastestUrl || previewProbeIdRef.current !== previewProbeId) return;
        setFastPreviewUrl(fastestUrl);
        warmPreviewMetadata(fastestUrl, response);
      });

      const downloadProbeId = downloadProbeIdRef.current + 1;
      downloadProbeIdRef.current = downloadProbeId;
      void pickFastestDownloadUrl(response).then((fastestUrl) => {
        if (!fastestUrl || downloadProbeIdRef.current !== downloadProbeId) return;
        setFastDownloadUrl(fastestUrl);
      });

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }, 300);
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : '抖音视频解析失败，请稍后重试。');
    } finally {
      setIsResolving(false);
    }
  }

  async function handleExtractTranscript() {
    const nextInput = input.trim();
    if (!nextInput) {
      setError('请先粘贴抖音链接或整段分享文本。');
      return;
    }

    setIsTranscriptLoading(true);
    setError('');
    setTranscriptResult(null);
    setCopyStatus('idle');
    setDisplayTranscript('');
    setOriginalTranscript('');
    setTranscriptLoadingMessage('正在准备视频音频...');

    try {
      const transcriptOptions = {
        sourceData: result?.videoData || null,
        videoUrl: fastPreviewUrl || fastDownloadUrl || result?.previewUrl || result?.downloadUrl || '',
        videoUrls: result ? collectPreviewCandidateUrls(result).slice(0, 8) : [],
        downloadUrlCandidates: result?.downloadUrlCandidates || result?.videoUrlCandidates || [],
      };
      let response: DouyinTranscriptResult;

      try {
        response = await extractCpTranscriptStream(nextInput, {
          ...transcriptOptions,
          onStatus: (message) => {
            if (message) setTranscriptLoadingMessage(message);
          },
          onDelta: (text) => {
            setDisplayTranscript(text);
            setOriginalTranscript(text);
          },
        });
      } catch (streamError) {
        console.warn('[douyin transcript] stream failed, fallback to non-stream:', streamError);
        setTranscriptLoadingMessage('流式转写不稳定，正在切换稳妥模式...');
        response = await extractCpTranscript(nextInput, transcriptOptions);
      }

      const normalizedTranscriptResult: DouyinTranscriptResult = response.transcriptOk
        ? response
        : {
            ...response,
            transcriptError: response.transcriptError?.trim() || '视频文案提取失败，请重新解析，重新提取逐字稿。',
          };

      setTranscriptResult(normalizedTranscriptResult);
      setDisplayTranscript(normalizedTranscriptResult.transcript);
      setOriginalTranscript(normalizedTranscriptResult.transcript);

      if (!result) {
        setResult({
          ok: true,
          mode: 'stable',
          videoId: normalizedTranscriptResult.videoId,
          title: normalizedTranscriptResult.title,
          downloadUrl: normalizedTranscriptResult.downloadUrl,
          downloadUrlCandidates: normalizedTranscriptResult.downloadUrlCandidates,
          authorName: normalizedTranscriptResult.authorName,
          normalizedUrl: normalizedTranscriptResult.normalizedUrl,
          sourceType: normalizedTranscriptResult.sourceType,
          caption: '',
          fallbackCaption: normalizedTranscriptResult.fallbackCaption,
          fallbackCaptionSource: normalizedTranscriptResult.fallbackCaptionSource,
          videoData: null,
          resolveStrategy: normalizedTranscriptResult.resolveStrategy,
        });
      }
    } catch (submitError) {
      setTranscriptResult(null);
      setDisplayTranscript('');
      setOriginalTranscript('');
      setError(submitError instanceof Error ? submitError.message : '视频文案提取失败，请重新解析，重新提取逐字稿。');
    } finally {
      setIsTranscriptLoading(false);
      setTranscriptLoadingMessage('');
    }
  }

  async function handleOneClickExtract() {
    const nextInput = input.trim();
    if (!nextInput) {
      setError('请先粘贴视频链接或整段分享文本。');
      return;
    }

    setIsResolving(true);
    setIsTranscriptLoading(true);
    setError('');
    setResult(null);
    setTranscriptResult(null);
    setCopyStatus('idle');
    setDisplayTranscript('');
    setOriginalTranscript('');
    setExtractStep('resolving');
    setTranscriptLoadingMessage('正在解析视频信息...');

    try {
      // 第一步：解析视频
      const resolveResponse = await resolveCpExtract(nextInput);
      setResult(resolveResponse);
      setFastPreviewUrl(resolveResponse.previewUrl || resolveResponse.videoUrls?.[0] || resolveResponse.downloadUrl || '');
      setFastDownloadUrl(resolveResponse.downloadUrl || resolveResponse.videoUrls?.[0] || '');

      // 第二步：自动提取文案
      setExtractStep('downloading');
      setTranscriptLoadingMessage('正在下载视频并提取音频...');

      const transcriptOptions = {
        sourceData: resolveResponse.videoData || null,
        videoUrl: resolveResponse.previewUrl || resolveResponse.downloadUrl || '',
        videoUrls: collectPreviewCandidateUrls(resolveResponse).slice(0, 8),
        downloadUrlCandidates: resolveResponse.downloadUrlCandidates || resolveResponse.videoUrlCandidates || [],
      };

      let response: DouyinTranscriptResult;

      try {
        response = await extractCpTranscriptStream(nextInput, {
          ...transcriptOptions,
          onStatus: (message, stage) => {
            if (message) {
              setTranscriptLoadingMessage(message);
              // 根据后端返回的 stage 更新前端步骤状态
              if (stage === 'download') setExtractStep('downloading');
              else if (stage === 'extract_audio') setExtractStep('extracting_audio');
              else if (stage === 'asr') setExtractStep('transcribing');
            }
          },
          onDelta: (text) => {
            setDisplayTranscript(text);
            setOriginalTranscript(text);
          },
        });
      } catch (streamError) {
        console.warn('[douyin transcript] stream failed, fallback to non-stream:', streamError);
        setExtractStep('transcribing');
        setTranscriptLoadingMessage('流式转写不稳定，正在切换稳妥模式...');
        response = await extractCpTranscript(nextInput, transcriptOptions);
      }

      const normalizedTranscriptResult: DouyinTranscriptResult = response.transcriptOk
        ? response
        : {
            ...response,
            transcriptError: response.transcriptError?.trim() || '视频文案提取失败，请重新解析，重新提取逐字稿。',
          };

      setTranscriptResult(normalizedTranscriptResult);
      setDisplayTranscript(normalizedTranscriptResult.transcript);
      setOriginalTranscript(normalizedTranscriptResult.transcript);
      setExtractStep('done');

      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    } catch (submitError) {
      setExtractStep('error');
      setError(submitError instanceof Error ? submitError.message : '操作失败，请稍后重试。');
    } finally {
      setIsResolving(false);
      setIsTranscriptLoading(false);
      if (extractStep !== 'done' && extractStep !== 'error') {
        setTranscriptLoadingMessage('');
      }
    }
  }

  async function handleExtractLocalTranscript(file: File) {
    setIsLocalTranscriptLoading(true);
    setError('');
    setTranscriptResult(null);
    setCopyStatus('idle');
    setDisplayTranscript('');
    setOriginalTranscript('');
    setTranscriptLoadingMessage('');
    setIsPolishing(false);
    setShowDiff(true);

    try {
      const response = await extractCpLocalTranscript(file);
      const normalizedTranscriptResult: DouyinTranscriptResult = response.transcriptOk
        ? response
        : {
            ...response,
            transcriptError: response.transcriptError?.trim() || '本地视频文案提取失败，请重新解析，重新提取逐字稿。',
          };

      setTranscriptResult(normalizedTranscriptResult);
      setDisplayTranscript(normalizedTranscriptResult.transcript);
      setOriginalTranscript(normalizedTranscriptResult.transcript);
      setTimeout(() => {
        resultRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 300);
    } catch (submitError) {
      setTranscriptResult(null);
      setDisplayTranscript('');
      setOriginalTranscript('');
      setError(submitError instanceof Error ? submitError.message : '本地视频文案提取失败，请重新解析，重新提取逐字稿。');
    } finally {
      setIsLocalTranscriptLoading(false);
    }
  }

  function handleLocalVideoSelect(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!file.type.startsWith('video/')) {
      setError('请选择视频文件');
      return;
    }
    const url = URL.createObjectURL(file);
    setLocalVideoUrl(url);
    void handleExtractLocalTranscript(file);
    if (localVideoInputRef.current) {
      localVideoInputRef.current.value = '';
    }
  }

  async function handlePolishTranscript() {
    const rawTranscript = transcriptResult?.transcript?.trim();

    if (!rawTranscript) {
      setError('缺少原始文案，无法校对');
      return;
    }

    setIsPolishing(true);
    setError('');

    try {
      const polished = await polishDouyinTranscript({
        originalTranscript: rawTranscript,
        onDelta: (text) => setDisplayTranscript(text),
      });
      setDisplayTranscript(polished);
    } catch (err) {
      setError(err instanceof Error ? err.message : '文案校对失败');
      setDisplayTranscript(originalTranscript);
    } finally {
      setIsPolishing(false);
    }
  }

  function handleRestoreOriginal() {
    setDisplayTranscript(originalTranscript);
  }

  async function handleDownloadVideo() {
    if (!result?.downloadUrl) {
      setError('当前没有可下载的视频地址，请先解析视频。');
      return;
    }

    setIsDownloading(true);
    setError('');

    // eslint-disable-next-line no-console
    console.log('[douyin download] handleDownloadVideo called', {
      videoId: result.videoId,
      downloadUrl: result.downloadUrl,
      candidateCount: result.downloadUrlCandidates?.length || 0,
    });

    try {
      await downloadDouyinVideoFile({
        videoId: result.videoId,
        downloadUrl: fastDownloadUrl || result.downloadUrl,
        downloadUrlCandidates: result.downloadUrlCandidates,
        videoUrls: result.videoUrls,
        platform: result.platform,
      });
    } catch (downloadError) {
      // eslint-disable-next-line no-console
      console.error('[douyin download] handleDownloadVideo error:', downloadError);
      setError(downloadError instanceof Error ? downloadError.message : '视频下载失败，请稍后重试。');
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleDirectDownloadVideo() {
    if (!result?.downloadUrl) {
      setError('当前没有可下载的视频地址，请先解析视频。');
      return;
    }

    setIsDirectDownloading(true);
    setError('');

    // eslint-disable-next-line no-console
    console.log('[douyin download] handleDirectDownloadVideo called', {
      videoId: result.videoId,
      downloadUrl: result.downloadUrl,
    });

    try {
      await directDownloadDouyinVideoFile({
        videoId: result.videoId,
        downloadUrl: fastDownloadUrl || result.downloadUrl,
        downloadUrlCandidates: result.downloadUrlCandidates,
        videoUrls: result.videoUrls,
        platform: result.platform,
      });
    } catch (downloadError) {
      // eslint-disable-next-line no-console
      console.error('[douyin download] handleDirectDownloadVideo error:', downloadError);
      setError(downloadError instanceof Error ? downloadError.message : '极速下载失败，请尝试兼容下载。');
    } finally {
      setIsDirectDownloading(false);
    }
  }

  async function handleCopyTranscript() {
    const transcript = displayTranscript.trim() || transcriptResult?.transcript?.trim() || '';
    if (!transcript) {
      setCopyStatus('error');
      return;
    }

    try {
      await navigator.clipboard.writeText(transcript);
      setCopyStatus('done');
      window.setTimeout(() => setCopyStatus('idle'), 1600);
    } catch {
      setCopyStatus('error');
    }
  }

  function resetAll() {
    setInput('');
    setError('');
    setResult(null);
    setTranscriptResult(null);
    setCopyStatus('idle');
    setDisplayTranscript('');
    setOriginalTranscript('');
    setTranscriptLoadingMessage('');
    setIsPolishing(false);
    setShowDiff(true);
    setShowVideoPreview(false);
    setFastPreviewUrl('');
    setFastDownloadUrl('');
    setExtractStep('idle');
    previewProbeIdRef.current += 1;
    downloadProbeIdRef.current += 1;
    if (localVideoUrl) {
      URL.revokeObjectURL(localVideoUrl);
      setLocalVideoUrl('');
    }
  }

  function switchTab(tab: 'link' | 'local') {
    if (tab === activeTab) return;
    setActiveTab(tab);
    resetAll();
  }

  function renderTranscriptCard() {
    const isOnline = activeMode === 'link';
    return (
      <div className="glass-card overflow-hidden rounded-3xl border-white/80 shadow-glass h-full flex flex-col">
        <div className="flex items-center justify-between gap-3 border-b border-slate-100/80 bg-white/35 px-6 py-4">
          <div className="flex items-center gap-3">
            <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/20">
              <AudioLines className="size-4" />
            </div>
            <div>
              <div className="text-xs font-black text-slate-500 uppercase tracking-wider">
                {isOnline ? '在线视频文案' : '本地视频文案'}
              </div>
              <p className="mt-0.5 text-[11px] font-medium text-slate-400">
                {isOnline ? '粘贴链接一键提取逐字稿' : '本地上传视频提取逐字稿'}
              </p>
            </div>
          </div>
        </div>
        <div className="p-6 space-y-5 flex-1 overflow-y-auto">
          <AnimatePresence mode="wait">
            {isTranscriptLoading ? (
              <motion.div
                key="loading-online"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4 rounded-3xl border border-indigo-100 bg-indigo-50/70 px-4 py-4"
              >
                <div className="space-y-3">
                  <div className="flex items-center gap-3 text-sm text-indigo-700 font-semibold">
                    <Loader2 className="size-4 animate-spin" />
                    {transcriptLoadingMessage || '正在提取音频并转写文案...'}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { key: 'resolving', label: '解析视频' },
                      { key: 'downloading', label: '下载视频' },
                      { key: 'extracting_audio', label: '提取音频' },
                      { key: 'transcribing', label: 'ASR转写' },
                    ].map((step, index, arr) => {
                      const stepOrder = ['idle', 'resolving', 'downloading', 'extracting_audio', 'transcribing', 'done', 'error'];
                      const currentIndex = stepOrder.indexOf(extractStep);
                      const stepIndex = stepOrder.indexOf(step.key);
                      const isCompleted = currentIndex > stepIndex;
                      const isActive = extractStep === step.key;
                      return (
                        <div key={step.key} className="flex items-center gap-2">
                          <div className={cn(
                            "flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[11px] font-bold transition-all",
                            isCompleted && "bg-emerald-100 text-emerald-700",
                            isActive && "bg-indigo-500 text-white shadow-sm",
                            !isCompleted && !isActive && "bg-slate-100 text-slate-400"
                          )}>
                            <span className={cn(
                              "flex size-4 items-center justify-center rounded-full text-[9px] font-black",
                              isCompleted && "bg-emerald-500 text-white",
                              isActive && "bg-white text-indigo-600",
                              !isCompleted && !isActive && "bg-slate-300 text-white"
                            )}>
                              {isCompleted ? '✓' : index + 1}
                            </span>
                            {step.label}
                          </div>
                          {index < arr.length - 1 && (
                            <div className={cn(
                              "h-px w-3 shrink-0 hidden sm:block",
                              isCompleted ? "bg-emerald-300" : "bg-slate-200"
                            )} />
                          )}
                        </div>
                      );
                    })}
                  </div>
                </div>
                {displayTranscript ? (
                  <>
                    <div className="ml-1 inline-flex rounded-full border border-indigo-100 bg-white/70 px-2.5 py-1 text-[10px] font-bold text-indigo-600">
                      已实时转写 {displayTranscript.replace(/\s/g, '').length} 字
                    </div>
                    <div className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words rounded-2xl border border-indigo-100/80 bg-white/80 p-4 text-sm leading-7 text-slate-700 shadow-inner shadow-indigo-100/50">
                      {displayTranscript}
                    </div>
                  </>
                ) : (
                  <p className="text-xs text-indigo-500 ml-1">已启用流式转写，拿到首段内容会立即显示。</p>
                )}
              </motion.div>
            ) : isLocalTranscriptLoading ? (
              <motion.div
                key="loading-local"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-3 rounded-3xl border border-emerald-100 bg-emerald-50/70 px-4 py-4"
              >
                <div className="flex items-center gap-3 text-sm text-emerald-700 font-semibold">
                  <Loader2 className="size-4 animate-spin" />
                  正在提取本地视频逐字稿...
                </div>
                <p className="text-xs text-emerald-500 ml-7">上传完成，正在进行 ASR 语音转写，请稍候。</p>
              </motion.div>
            ) : transcriptResult?.transcriptOk ? (
              <motion.div
                key="success"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex items-center gap-2">
                    <div className="flex items-center gap-2 rounded-full border border-emerald-100/80 bg-emerald-50/80 px-3 py-2 text-xs font-bold text-emerald-600">
                      <CheckCircle2 className="size-3.5" />
                      提取成功 · 共 {(displayTranscript || transcriptResult?.transcript || '').replace(/\s/g, '').length} 字
                    </div>
                    {displayTranscript !== originalTranscript && originalTranscript && (
                      <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50/80 px-2 py-1 rounded-md border border-indigo-100/80">
                        已AI校对
                      </span>
                    )}
                  </div>
                  <div className="flex flex-wrap items-center gap-2">
                    {Number(transcriptResult.transcriptSegments || 0) > 1 && (
                      <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                        <Clock className="size-3" />
                        {transcriptResult.transcriptSegments} 段音频
                      </span>
                    )}
                    {displayTranscript !== originalTranscript && originalTranscript && (
                      <button
                        onClick={() => setShowDiff((v) => !v)}
                        className="flex h-8 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/70 px-3 text-xs font-bold text-slate-500 shadow-sm transition-all hover:bg-white hover:shadow-md"
                      >
                        {showDiff ? '显示完整' : '显示修改'}
                      </button>
                    )}
                    {displayTranscript !== originalTranscript && originalTranscript && (
                      <button
                        onClick={handleRestoreOriginal}
                        className="flex h-8 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/70 px-3 text-xs font-bold text-slate-500 shadow-sm transition-all hover:bg-white hover:shadow-md"
                      >
                        <ArrowLeft className="size-3" />
                        恢复原始
                      </button>
                    )}
                    {isPolishing ? (
                      <span className="inline-flex h-8 items-center gap-1.5 rounded-full border border-indigo-100/80 bg-indigo-50/80 px-3 text-xs font-bold text-indigo-600">
                        <Loader2 className="size-3 animate-spin" />
                        校对中...
                      </span>
                    ) : (
                      <button
                        onClick={handlePolishTranscript}
                        className="flex h-8 items-center gap-1.5 rounded-full border border-indigo-100/80 bg-indigo-50/80 px-3 text-xs font-bold text-indigo-600 shadow-sm transition-all hover:bg-indigo-50 hover:shadow-md"
                      >
                        <Sparkles className="size-3" />
                        AI 校对
                      </button>
                    )}
                    <button
                      onClick={handleCopyTranscript}
                      className="flex h-8 items-center gap-1.5 rounded-full border border-slate-200/80 bg-white/70 px-4 text-xs font-bold text-slate-600 shadow-sm transition-all hover:bg-white hover:shadow-md"
                    >
                      <Copy className="size-3" />
                      {copyStatus === 'done' ? '已复制' : '复制文案'}
                    </button>
                  </div>
                </div>
                <div className="min-h-[300px] max-h-[600px] overflow-y-auto whitespace-pre-wrap break-words rounded-3xl border border-slate-100 bg-white/70 p-5 text-sm leading-7 text-slate-700 shadow-inner shadow-slate-100/70">
                  {showDiff && !isPolishing && displayTranscript !== originalTranscript && originalTranscript ? (
                    <span className="leading-7">
                      {computeTextDiff(originalTranscript, displayTranscript).map((part, idx) => {
                        if (part.type === 'removed') {
                          return (
                            <span key={idx} className="bg-red-100 text-red-700 line-through decoration-red-400 rounded px-0.5">
                              {part.text}
                            </span>
                          );
                        }
                        if (part.type === 'added') {
                          return (
                            <span key={idx} className="bg-emerald-100 text-emerald-700 rounded px-0.5 font-medium">
                              {part.text}
                            </span>
                          );
                        }
                        return <span key={idx}>{part.text}</span>;
                      })}
                    </span>
                  ) : (
                    displayTranscript || transcriptResult.transcript
                  )}
                </div>
              </motion.div>
            ) : transcriptResult && !transcriptResult.transcriptOk ? (
              <motion.div
                key="error"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="space-y-4"
              >
                <div className="rounded-3xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-700">
                  <div className="flex items-center gap-2 font-semibold">
                    <AlertCircle className="size-4" />
                    文案提取失败
                  </div>
                  <div className="mt-1.5 text-xs leading-5 opacity-80">{transcriptResult.transcriptError || '请稍后重试。'}</div>
                </div>
              </motion.div>
            ) : (
              <motion.div
                key="empty"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="rounded-3xl border border-slate-100 bg-white/50 px-4 py-8 text-center text-sm text-slate-400"
              >
                粘贴视频链接或上传本地视频，一键提取逐字稿文案。
              </motion.div>
            )}
          </AnimatePresence>
          {copyStatus === 'error' && (
            <div className="text-xs text-red-500">当前没有可复制的文案。</div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="douyin-page relative isolate min-h-screen overflow-x-hidden bg-[#F3F5F9] flex flex-col text-slate-900">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="douyin-orb absolute left-[-120px] top-[-120px] size-80 rounded-full bg-indigo-200/35 blur-3xl" />
        <div className="douyin-orb absolute right-[-140px] top-40 size-96 rounded-full bg-sky-200/30 blur-3xl" />
        <div className="douyin-orb absolute bottom-[-180px] left-1/2 size-[420px] -translate-x-1/2 rounded-full bg-amber-100/40 blur-3xl" />
      </div>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/70 bg-white/90 px-4 shadow-sm">
        <div className="flex h-16 items-center">
          <div className="flex min-w-0 items-center gap-8">
            <button
              onClick={onBack}
              className="group flex h-9 items-center gap-2.5 rounded-full border border-slate-200/80 bg-white/70 pl-1 pr-4 shadow-sm transition-all duration-300 hover:bg-white hover:shadow-md"
            >
              <div className="flex size-7 items-center justify-center rounded-full bg-slate-900 text-white transition-transform group-hover:scale-105">
                <ArrowLeft className="size-3.5" />
              </div>
              <span className="text-xs font-bold text-slate-700">返回</span>
            </button>
            <ModuleQuickNav current="douyin" onNavigate={onNavigate} />
          </div>
        </div>
      </header>

      <main className="relative z-10 flex-1 max-w-6xl mx-auto w-full p-6 flex flex-col justify-center pb-24">
        {/* 工作区 */}
        <AnimatePresence mode="wait" className="flex-1 flex flex-col justify-center">
          {activeMode === 'menu' && (
            <motion.div
              key="menu"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="grid gap-4 sm:grid-cols-3 self-center w-full"
            >
              {/* 在线视频下载 */}
              <button
                onClick={() => window.open('https://copy.aiqichao.xyz', '_blank', 'noopener,noreferrer')}
                className="group flex flex-col items-center gap-4 rounded-3xl border border-sky-100 bg-gradient-to-br from-white/80 to-sky-50/60 p-7 text-center shadow-glass transition-all hover:shadow-lg hover:-translate-y-1"
              >
                <div className="inline-flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-sky-500 to-cyan-500 text-white shadow-lg shadow-sky-500/20 transition-transform group-hover:scale-105">
                  <Sparkles className="size-7" />
                </div>
                <div>
                  <p className="text-base font-black text-slate-800">在线视频下载</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">Copy Pilot 2 专业视频文案提取</p>
                </div>
                <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-sky-500">
                  打开网站 <ArrowLeft className="size-3 rotate-180" />
                </span>
              </button>

              {/* 在线文案提取 */}
              <button
                onClick={() => setActiveMode('link')}
                className="group flex flex-col items-center gap-4 rounded-3xl border border-indigo-100 bg-gradient-to-br from-white/80 to-indigo-50/60 p-7 text-center shadow-glass transition-all hover:shadow-lg hover:-translate-y-1"
              >
                <div className="inline-flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-500 text-white shadow-lg shadow-indigo-500/20 transition-transform group-hover:scale-105">
                  <Link2 className="size-7" />
                </div>
                <div>
                  <p className="text-base font-black text-slate-800">在线文案提取</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">粘贴链接一键提取视频逐字稿</p>
                </div>
                <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-indigo-500">
                  开始使用 <ArrowLeft className="size-3 rotate-180" />
                </span>
              </button>

              {/* 本地文案提取 */}
              <button
                onClick={() => setActiveMode('local')}
                className="group flex flex-col items-center gap-4 rounded-3xl border border-emerald-100 bg-gradient-to-br from-white/80 to-emerald-50/60 p-7 text-center shadow-glass transition-all hover:shadow-lg hover:-translate-y-1"
              >
                <div className="inline-flex size-16 items-center justify-center rounded-2xl bg-gradient-to-br from-emerald-500 to-teal-500 text-white shadow-lg shadow-emerald-500/20 transition-transform group-hover:scale-105">
                  <Upload className="size-7" />
                </div>
                <div>
                  <p className="text-base font-black text-slate-800">本地文案提取</p>
                  <p className="mt-1.5 text-xs leading-relaxed text-slate-400">上传本地视频，提取逐字稿文案</p>
                </div>
                <span className="mt-2 inline-flex items-center gap-1 text-[11px] font-bold text-emerald-500">
                  开始使用 <ArrowLeft className="size-3 rotate-180" />
                </span>
              </button>
            </motion.div>
          )}

          {activeMode === 'local' && (
            <motion.div
              key="local"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="grid gap-6 lg:grid-cols-[360px_1fr] w-full items-start"
            >
              {/* 左侧：上传区 */}
              <div className="glass-card rounded-3xl border-white/80 shadow-glass overflow-hidden">
                {/* 返回栏 */}
                <div className="flex items-center gap-2 border-b border-slate-100/80 bg-white/35 px-4 py-3">
                  <button
                    onClick={() => setActiveMode('menu')}
                    className="flex h-9 items-center gap-2 rounded-xl bg-white/70 px-3 text-xs font-bold text-slate-600 shadow-sm transition-all hover:bg-white hover:shadow-md"
                  >
                    <ArrowLeft className="size-3.5" />
                    返回
                  </button>
                  <span className="text-xs font-bold text-slate-400">本地文案提取</span>
                </div>

                {/* ASR 引擎选择 */}
                <div className="px-6 pt-3 pb-0">
                  <div className="flex justify-end">
                    <div className="flex items-center gap-1.5">
                      <button
                        onClick={() => setAsrEngine('qwen')}
                        className={`h-7 rounded-lg px-3 text-[10px] font-bold transition-all ${
                          asrEngine === 'qwen'
                            ? 'bg-white text-blue-600 shadow-sm'
                            : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        千问 ASR
                      </button>
                      <button
                        onClick={() => setAsrEngine('siliconflow')}
                        className={`h-7 rounded-lg px-3 text-[10px] font-bold transition-all ${
                          asrEngine === 'siliconflow'
                            ? 'bg-white text-slate-700 shadow-sm'
                            : 'text-slate-400 hover:text-slate-600'
                        }`}
                      >
                        SenseVoice（免费）
                      </button>
                    </div>
                  </div>
                </div>

                {/* 内容区 */}
                <div className="px-6 pb-6 pt-3 space-y-5">
                  <div className="rounded-3xl border border-dashed border-emerald-200 bg-gradient-to-br from-white/70 to-emerald-50/60 p-7 text-center space-y-3">
                    <div className="inline-flex size-14 items-center justify-center rounded-2xl bg-white text-emerald-500 shadow-sm">
                      <Upload className="size-6" />
                    </div>
                    <div>
                      <p className="text-sm font-black text-slate-800">上传本地视频提取逐字稿</p>
                      <p className="mt-1 text-xs text-slate-400">支持 MP4、MOV 等常见视频格式</p>
                    </div>
                    <input
                      ref={localVideoInputRef}
                      type="file"
                      accept="video/*"
                      onChange={handleLocalVideoSelect}
                      className="hidden"
                    />
                    <button
                      type="button"
                      disabled={isLocalTranscriptLoading}
                      onClick={() => localVideoInputRef.current?.click()}
                      className="mx-auto flex h-11 items-center justify-center gap-2 rounded-2xl bg-emerald-600 px-6 text-sm font-bold text-white shadow-lg shadow-emerald-600/20 transition-all hover:bg-emerald-700 active:scale-[0.98] disabled:opacity-50"
                    >
                      {isLocalTranscriptLoading ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          提取逐字稿中...
                        </>
                      ) : (
                        <>
                          <Upload className="size-4" />
                          选择视频文件
                        </>
                      )}
                    </button>
                  </div>

                  {localVideoUrl && (
                    <video
                      src={localVideoUrl}
                      controls
                      className="w-full max-h-44 rounded-3xl bg-slate-900 object-contain shadow-lg shadow-slate-900/10"
                      playsInline
                    />
                  )}
                </div>
              </div>

              {/* 右侧：文案结果 */}
              {renderTranscriptCard()}
            </motion.div>
          )}

          {activeMode === 'link' && (
            <motion.div
              key="link"
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -12 }}
              transition={{ duration: 0.3 }}
              className="grid gap-6 lg:grid-cols-[360px_1fr] w-full items-start"
            >
              {/* 左侧：输入区 */}
              <div className="glass-card rounded-3xl border-white/80 shadow-glass overflow-hidden">
                {/* 返回栏 */}
                <div className="flex items-center gap-2 border-b border-slate-100/80 bg-white/35 px-4 py-3">
                  <button
                    onClick={() => setActiveMode('menu')}
                    className="flex h-9 items-center gap-2 rounded-xl bg-white/70 px-3 text-xs font-bold text-slate-600 shadow-sm transition-all hover:bg-white hover:shadow-md"
                  >
                    <ArrowLeft className="size-3.5" />
                    返回
                  </button>
                  <span className="text-xs font-bold text-slate-400">在线文案提取</span>
                </div>

                {/* 内容区 */}
                <div className="px-6 pb-6 pt-3 space-y-5">
                  <div className="relative rounded-2xl border border-indigo-200 bg-white/75 shadow-inner shadow-indigo-100/60 transition-all focus-within:ring-2 focus-within:ring-indigo-200/70">
                    <textarea
                      value={input}
                      onChange={(event) => setInput(event.target.value)}
                      placeholder="粘贴视频链接..."
                      className="h-16 w-full resize-none rounded-2xl border-0 bg-transparent p-3 pr-10 text-sm font-medium leading-6 text-slate-700 outline-none placeholder:text-slate-300"
                    />
                    {input && (
                      <button
                        onClick={() => setInput('')}
                        className="absolute right-3 top-3 flex size-6 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                        title="清空输入"
                      >
                        <Trash2 className="size-3 text-slate-400" />
                      </button>
                    )}
                  </div>

                  <div className="flex items-center gap-3">
                    <button
                      disabled={isResolving || isTranscriptLoading}
                      onClick={handleOneClickExtract}
                      className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-bold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {isResolving || isTranscriptLoading ? (
                        <>
                          <Loader2 className="size-4 animate-spin" />
                          {extractStep === 'resolving' ? '正在解析...' : '正在提取文案...'}
                        </>
                      ) : (
                        <>
                          <AudioLines className="size-4" />
                          一键提取文案
                        </>
                      )}
                    </button>

                    <button
                      onClick={resetAll}
                      disabled={isResolving || isTranscriptLoading}
                      className="h-11 rounded-2xl border border-slate-200/80 bg-white/70 px-5 text-sm font-bold text-slate-600 shadow-sm transition-all hover:bg-white hover:shadow-md disabled:opacity-50"
                    >
                      清空
                    </button>
                  </div>
                </div>
              </div>

              {/* 右侧：文案结果 */}
              {renderTranscriptCard()}
            </motion.div>
          )}
        </AnimatePresence>

        {/* 错误提示 */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -8 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -8 }}
              className="rounded-xl border border-red-100 bg-red-50/80 px-4 py-3 text-xs text-red-600 font-medium flex items-center gap-2"
            >
              <AlertCircle className="size-4 shrink-0" />
              {error}
            </motion.div>
          )}
        </AnimatePresence>

      </main>

      {/* 视频预览弹窗 */}
      {showVideoPreview && result && previewDirectUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => {
            setShowVideoPreview(false);
          }}
        >
          <div
            className="relative max-h-[78vh] max-w-[92vw] overflow-hidden rounded-3xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => {
                setShowVideoPreview(false);
              }}
              className="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
            >
              <X className="size-4" />
            </button>
            <video
              ref={previewVideoRef}
              key={previewProxyUrl || previewDirectUrl}
              src={previewProxyUrl || previewDirectUrl}
              controls
              autoPlay
              preload="metadata"
              className="max-h-[78vh] max-w-[92vw] bg-black"
              playsInline
              onCanPlay={(event) => {
                event.currentTarget.play().catch(() => {});
              }}
              onError={(e) => {
                const videoEl = e.currentTarget;
                const currentSrc = videoEl.currentSrc || '';
                if (currentSrc.includes('/api/') && previewDirectUrl) {
                  videoEl.src = previewDirectUrl;
                  videoEl.load();
                  videoEl.play().catch(() => {});
                } else {
                  alert('视频加载失败，可能是链接已过期，请重新解析后再试');
                  setShowVideoPreview(false);
                }
              }}
            />
          </div>
        </div>
      )}

      <SiteFooter className="px-6 pb-6 pt-2" />
    </div>
  );
}

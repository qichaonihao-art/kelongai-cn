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
  Image as ImageIcon,
  Tag,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ModuleQuickNav from "@/src/components/ModuleQuickNav";
import SiteFooter from "@/src/components/SiteFooter";
import {
  downloadDouyinVideoFile,
  directDownloadDouyinVideoFile,
  extractDouyinTranscript,
  extractLocalVideoTranscript,
  getDouyinConfigStatus,
  polishDouyinTranscript,
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
  const [showDiff, setShowDiff] = useState(true);
  const [showVideoPreview, setShowVideoPreview] = useState(false);
  const [showImages, setShowImages] = useState(false);
  const [isLocalTranscriptLoading, setIsLocalTranscriptLoading] = useState(false);
  const [activeTab, setActiveTab] = useState<'link' | 'local'>('link');
  const [asrEngine, setAsrEngine] = useState<'siliconflow' | 'qwen'>('qwen');
  const [localVideoUrl, setLocalVideoUrl] = useState<string>('');
  const resultRef = useRef<HTMLDivElement>(null);
  const localVideoInputRef = useRef<HTMLInputElement>(null);

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
      const response = await resolveDouyinDownload(nextInput);
      setResult(response);
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

    try {
      const response = await extractDouyinTranscript(nextInput, asrEngine);
      const normalizedTranscriptResult: DouyinTranscriptResult = response.transcriptOk
        ? response
        : {
            ...response,
            transcriptError: response.transcriptError?.trim() || '视频文案提取失败，请稍后重试。',
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
      setError(submitError instanceof Error ? submitError.message : '视频文案提取失败，请稍后重试。');
    } finally {
      setIsTranscriptLoading(false);
    }
  }

  async function handleExtractLocalTranscript(file: File) {
    setIsLocalTranscriptLoading(true);
    setError('');
    setTranscriptResult(null);
    setCopyStatus('idle');
    setDisplayTranscript('');
    setOriginalTranscript('');
    setIsPolishing(false);
    setShowDiff(true);

    try {
      const response = await extractLocalVideoTranscript(file, asrEngine);
      const normalizedTranscriptResult: DouyinTranscriptResult = response.transcriptOk
        ? response
        : {
            ...response,
            transcriptError: response.transcriptError?.trim() || '本地视频文案提取失败，请稍后重试。',
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
      setError(submitError instanceof Error ? submitError.message : '本地视频文案提取失败，请稍后重试。');
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
        downloadUrl: result.downloadUrl,
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
        downloadUrl: result.downloadUrl,
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
    setIsPolishing(false);
    setShowDiff(true);
    setShowVideoPreview(false);
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

  const fallbackCaption = transcriptResult?.fallbackCaption || result?.fallbackCaption || '';
  const hasResult = !!result || !!transcriptResult;
  const siliconFlowConfigured = configStatus?.siliconFlowApiKey === true;
  const tikhubConfigured = configStatus?.tikhubApiToken === true;
  const arkApiKeyConfigured = configStatus?.arkApiKey === true;
  const dashscopeConfigured = configStatus?.dashscopeApiKey === true;

  return (
    <div className="relative isolate min-h-screen overflow-x-hidden bg-[#F3F5F9] flex flex-col text-slate-900">
      <div className="pointer-events-none absolute inset-0 -z-10">
        <div className="absolute left-[-120px] top-[-120px] size-80 rounded-full bg-indigo-200/35 blur-3xl" />
        <div className="absolute right-[-140px] top-40 size-96 rounded-full bg-sky-200/30 blur-3xl" />
        <div className="absolute bottom-[-180px] left-1/2 size-[420px] -translate-x-1/2 rounded-full bg-amber-100/40 blur-3xl" />
      </div>
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-white/60 bg-white/60 px-4 backdrop-blur-2xl shadow-sm">
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

      <main className="relative z-10 flex-1 max-w-3xl mx-auto w-full p-6 space-y-5 pb-24">
        {/* Title Section */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="glass-card relative overflow-hidden rounded-3xl border-white/80 p-6 shadow-glass"
        >
          <div className="absolute inset-x-0 top-0 h-24 bg-gradient-to-r from-slate-900/5 via-indigo-500/10 to-sky-400/10" />
          <div className="absolute -right-10 -top-10 size-36 rounded-full bg-white/60 blur-2xl" />
          <div className="relative flex flex-col gap-5 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-start gap-4">
              <div className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-950 via-slate-800 to-indigo-700 text-white shadow-lg shadow-slate-900/20">
                <Sparkles className="size-5" />
              </div>
              <div>
                <div className="mb-1.5 inline-flex items-center gap-1.5 rounded-full border border-white/70 bg-white/70 px-2.5 py-1 text-[10px] font-black uppercase tracking-wider text-slate-500">
                  <span className="relative flex size-1.5">
                    <span className="absolute inline-flex size-full animate-ping rounded-full bg-emerald-400 opacity-60" />
                    <span className="relative inline-flex size-1.5 rounded-full bg-emerald-500" />
                  </span>
                  Video Toolkit
                </div>
                <h1 className="text-2xl font-black tracking-tight text-slate-950">视频解析</h1>
              </div>
            </div>
            <button
              onClick={() => onNavigate('universal')}
              className="flex h-10 shrink-0 items-center justify-center gap-1.5 rounded-full bg-gradient-to-r from-indigo-500 to-violet-500 px-4 text-[11px] font-bold text-white shadow-md shadow-indigo-200 transition-all hover:from-indigo-600 hover:to-violet-600 hover:shadow-lg"
            >
              <Globe className="size-3.5" />
              高级解析
            </button>
          </div>

          <div className="relative mt-5 grid gap-2 sm:grid-cols-3">
            <span
              className={`rounded-2xl border px-3 py-2 text-[11px] font-bold ${
                siliconFlowConfigured
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                  : 'border-amber-100 bg-amber-50 text-amber-700'
              }`}
            >
              SiliconFlow：{siliconFlowConfigured ? '已配置' : '未配置'}
            </span>
            <span
              className={`rounded-2xl border px-3 py-2 text-[11px] font-bold ${
                tikhubConfigured
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white/60 text-slate-500'
              }`}
            >
              TikHub：{tikhubConfigured ? '已配置' : '可选'}
            </span>
            <span
              className={`rounded-2xl border px-3 py-2 text-[11px] font-bold ${
                dashscopeConfigured
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                  : 'border-amber-100 bg-amber-50 text-amber-700'
              }`}
            >
              千问 ASR：{dashscopeConfigured ? '已配置' : '未配置'}
            </span>
            {configStatus && !configStatus.reachable && (
              <span className="rounded-2xl border border-red-100 bg-red-50 px-3 py-2 text-[11px] font-bold text-red-600 sm:col-span-3">
                配置读取失败
              </span>
            )}
          </div>

        </motion.section>

        {/* 工作区 */}
        <div className="glass-card rounded-3xl border-white/80 shadow-glass overflow-hidden max-w-3xl mx-auto">
          {/* Tab栏 */}
          <div className="flex gap-2 bg-white/35 p-3">
            <button
              onClick={() => switchTab('link')}
              className={`flex-1 flex items-center justify-center gap-2 h-11 rounded-2xl text-xs font-bold transition-all ${
                activeTab === 'link'
                  ? 'bg-slate-950 text-white shadow-lg shadow-slate-900/15'
                  : 'text-slate-500 hover:bg-white/60 hover:text-slate-700'
              }`}
            >
              <Link2 className="size-3.5" />
              链接解析视频
            </button>
            <button
              onClick={() => switchTab('local')}
              className={`flex-1 flex items-center justify-center gap-2 h-11 rounded-2xl text-xs font-bold transition-all ${
                activeTab === 'local'
                  ? 'bg-emerald-600 text-white shadow-lg shadow-emerald-600/15'
                  : 'text-slate-500 hover:bg-white/60 hover:text-slate-700'
              }`}
            >
              <Upload className="size-3.5" />
              本地视频提取逐字稿
            </button>
          </div>

          {/* ASR 引擎选择 */}
          <div className="px-6 pt-2 pb-0">
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
          <AnimatePresence mode="wait">
            {activeTab === 'link' ? (
              <motion.div
                key="link"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="px-6 pb-6 pt-3 space-y-5"
              >
                <div className="relative rounded-3xl border border-indigo-200 bg-white/75 p-3 shadow-inner shadow-indigo-100/60 ring-4 ring-indigo-100/45 transition-all focus-within:bg-white/90 focus-within:ring-indigo-100/70">
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="请输入视频链接或分享文案，支持抖音、TikTok、快手、B站、小红书、YouTube 等..."
                    className="h-32 w-full resize-none rounded-2xl border-0 bg-transparent p-3 pr-10 text-sm font-medium leading-6 text-slate-700 outline-none placeholder:text-slate-400"
                  />
                  {input && (
                    <button
                      onClick={() => setInput('')}
                      className="absolute right-5 top-5 flex size-7 items-center justify-center rounded-full bg-slate-100 text-slate-400 transition-colors hover:bg-slate-200 hover:text-slate-600"
                      title="清空输入"
                    >
                      <Trash2 className="size-3 text-slate-400" />
                    </button>
                  )}
                  <div className="flex items-center justify-between border-t border-slate-100 px-3 pt-2">
                    <span className="text-[11px] font-medium text-slate-400">支持抖音、TikTok、快手、B站、小红书、YouTube 等主流平台</span>
                    <span className="text-[10px] font-bold text-slate-300">{input.trim().length} 字</span>
                  </div>
                </div>

                <div className="flex items-center gap-3">
                  <button
                    disabled={isResolving}
                    onClick={handleResolve}
                    className="flex h-11 flex-1 items-center justify-center gap-2 rounded-2xl bg-slate-950 text-sm font-bold text-white shadow-lg shadow-slate-900/20 transition-all hover:bg-slate-800 active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {isResolving ? (
                      <>
                        <Loader2 className="size-4 animate-spin" />
                        解析中...
                      </>
                    ) : (
                      <>
                        <Play className="size-4" />
                        解析视频
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
              </motion.div>
            ) : (
              <motion.div
                key="local"
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="px-6 pb-6 pt-3 space-y-5"
              >
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
              </motion.div>
            )}
          </AnimatePresence>
        </div>

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

        {/* Result Section */}
        <AnimatePresence>
          {(hasResult || isTranscriptLoading) && (
            <motion.section
              ref={resultRef}
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="space-y-4"
            >
              {activeTab === 'link' && (
              <div className="glass-card overflow-hidden rounded-3xl border-white/80 shadow-glass">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100/80 bg-white/35 px-6 py-4">
                  <div className="flex items-center gap-3">
                    <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/20">
                      <Download className="size-4" />
                    </div>
                    <div>
                      <div className="text-xs font-black text-slate-500 uppercase tracking-wider">视频信息</div>
                      <p className="mt-0.5 text-[11px] font-medium text-slate-400">解析结果、下载入口和视频预览</p>
                    </div>
                  </div>
                </div>
                <div className="p-6 space-y-5">
                {result ? (
                  <div className="space-y-4">
                    <div className="flex flex-wrap items-center gap-2">
                      <div className="flex w-fit items-center gap-2 rounded-full border border-emerald-100/80 bg-emerald-50/80 px-3 py-2 text-xs font-bold text-emerald-600">
                        <CheckCircle2 className="size-3.5" />
                        {result.platform ? `${result.platform} 解析成功` : '视频解析成功'}
                      </div>
                      {result.platform && (
                        <div className="flex w-fit items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50/80 px-3 py-2 text-xs font-bold text-indigo-600">
                          <Globe className="size-3" />
                          {result.platform}
                        </div>
                      )}
                      <div className="ml-auto flex w-fit items-center gap-1.5 rounded-full border border-indigo-100 bg-indigo-50/80 px-3 py-2 text-xs font-bold text-indigo-600">
                        <Clock className="size-3.5" />
                        视频时长：{(result.duration || 0) > 0 ? formatDuration(result.duration!) : '暂未获取'}
                      </div>
                    </div>

                    <div className="rounded-3xl border border-slate-100 bg-white/65 p-4 shadow-inner shadow-slate-100/60 space-y-3">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          <FileText className="size-3" />
                          视频标题
                        </div>
                        <div className="text-base font-black text-slate-900 leading-relaxed">
                          {result.title?.trim() || result.caption?.trim() || '未提取到标题'}
                        </div>
                      </div>

                      {result.authorName?.trim() && (
                        <div className="flex flex-wrap items-center gap-2 rounded-2xl bg-slate-50/80 px-3 py-2">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            <User className="size-3" />
                            作者
                          </div>
                          <div className="text-xs font-semibold text-slate-700">
                            {result.authorName.trim()}
                          </div>
                        </div>
                      )}

                      {result.tags && result.tags.length > 0 && (
                        <div className="flex flex-wrap gap-1.5">
                          {result.tags.map((tag, i) => (
                            <span key={i} className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-600">
                              #{tag}
                            </span>
                          ))}
                        </div>
                      )}
                    </div>

                    {/* Images gallery for platforms like Xiaohongshu */}
                    {result.images && result.images.length > 0 && (
                      <div className="space-y-2">
                        <button
                          type="button"
                          onClick={() => setShowImages((v) => !v)}
                          className="flex w-full items-center justify-between rounded-2xl border border-slate-200 bg-white/60 px-3.5 py-2.5 text-left transition-all hover:border-indigo-200 hover:bg-indigo-50/50"
                        >
                          <span className="flex items-center gap-2">
                            <ImageIcon className="size-4 text-indigo-500" />
                            <span className="text-xs font-bold text-slate-500">图片 ({result.images.length}张)</span>
                          </span>
                          <ChevronDown className={`size-4 text-slate-400 transition-transform ${showImages ? 'rotate-180' : ''}`} />
                        </button>
                        {showImages && (
                          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                            {result.images.map((img, i) => (
                              <a key={i} href={img} target="_blank" rel="noopener noreferrer" className="group relative aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                                <img src={img} alt={`图片${i + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
                                <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all" />
                              </a>
                            ))}
                          </div>
                        )}
                      </div>
                    )}

                    <div className="flex flex-col gap-3">
                      <div className="grid gap-3 sm:grid-cols-2">
                        <div className="flex flex-col gap-1 rounded-3xl border border-amber-100 bg-amber-50/65 p-3">
                          <button
                            onClick={handleDirectDownloadVideo}
                            disabled={isDirectDownloading}
                            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-amber-500 text-sm font-bold text-white shadow-lg shadow-amber-500/20 transition-all hover:bg-amber-600 active:scale-[0.98] disabled:opacity-60"
                          >
                            {isDirectDownloading ? (
                              <>
                                <Loader2 className="size-4 animate-spin" />
                                下载中...
                              </>
                            ) : (
                              <>
                                <Zap className="size-4" />
                                极速下载
                              </>
                            )}
                          </button>
                          <span className="flex items-center gap-1 px-1 text-[10px] text-amber-700/70">
                            <Zap className="size-3 text-amber-500" />
                            通过代理高速下载
                          </span>
                        </div>

                        <div className="flex flex-col gap-1 rounded-3xl border border-indigo-100 bg-indigo-50/65 p-3">
                          <button
                            onClick={handleDownloadVideo}
                            disabled={isDownloading}
                            className="flex h-11 w-full items-center justify-center gap-2 rounded-2xl bg-indigo-600 text-sm font-bold text-white shadow-lg shadow-indigo-600/20 transition-all hover:bg-indigo-700 active:scale-[0.98] disabled:opacity-60"
                          >
                            {isDownloading ? (
                              <>
                                <Loader2 className="size-4 animate-spin" />
                                正在下载...
                              </>
                            ) : (
                              <>
                                <Download className="size-4" />
                                兼容下载
                              </>
                            )}
                          </button>
                          <span className="flex items-center gap-1 px-1 text-[10px] text-indigo-700/70">
                            <Download className="size-3 text-indigo-500" />
                            自动选择最佳下载源
                          </span>
                        </div>
                      </div>

                      <div className="grid gap-3 sm:grid-cols-2">
                        <button
                          onClick={() => setShowVideoPreview(true)}
                          className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200/80 bg-white/75 text-sm font-bold text-slate-700 shadow-sm transition-all hover:bg-white hover:shadow-md"
                        >
                          <Play className="size-4" />
                          预览视频
                        </button>

                        <button
                          onClick={handleExtractTranscript}
                          disabled={isTranscriptLoading}
                          className="flex h-11 items-center justify-center gap-2 rounded-2xl border border-slate-200/80 bg-white/75 text-sm font-bold text-slate-700 shadow-sm transition-all hover:bg-white hover:shadow-md disabled:opacity-50"
                        >
                          {isTranscriptLoading ? (
                            <>
                              <Loader2 className="size-4 animate-spin" />
                              提取中...
                            </>
                          ) : (
                            <>
                              <AudioLines className="size-4" />
                              提取视频文案
                            </>
                          )}
                        </button>
                      </div>
                    </div>

                  </div>
                ) : (
                  <div className="rounded-3xl border border-slate-100 bg-white/50 px-4 py-8 text-center text-sm text-slate-400">
                    解析成功后，这里会显示视频信息。
                  </div>
                )}
                </div>
              </div>
              )}

              {/* Transcript Card */}
              <div className="glass-card overflow-hidden rounded-3xl border-white/80 shadow-glass">
                <div className="flex items-center justify-between gap-3 border-b border-slate-100/80 bg-white/35 px-6 py-4">
                  <div className="flex items-center gap-3">
                  <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/20">
                    <AudioLines className="size-4" />
                  </div>
                  <div>
                    <div className="text-xs font-black text-slate-500 uppercase tracking-wider">视频文案</div>
                    <p className="mt-0.5 text-[11px] font-medium text-slate-400">ASR 转写、复制和 AI 校对</p>
                  </div>
                  </div>
                </div>
                <div className="p-6 space-y-5">

                <AnimatePresence mode="wait">
                  {isTranscriptLoading ? (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="rounded-3xl border border-indigo-100 bg-indigo-50/70 px-4 py-4"
                    >
                      <div className="flex items-center gap-3 text-sm text-indigo-700 font-semibold">
                        <Loader2 className="size-4 animate-spin" />
                        正在提取音频并转写文案...
                      </div>
                      <p className="text-xs text-indigo-500 mt-2 ml-7">这一步通常需要一些时间，请耐心等待。</p>
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
                          {transcriptResult.transcriptSegments && transcriptResult.transcriptSegments > 1 && (
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

                      <div className="max-h-96 overflow-y-auto whitespace-pre-wrap break-words rounded-3xl border border-slate-100 bg-white/70 p-5 text-sm leading-7 text-slate-700 shadow-inner shadow-slate-100/70">
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

                      {fallbackCaption && (
                        <div className="rounded-3xl border border-slate-100 bg-white/60 p-4 text-sm text-slate-600 space-y-2">
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            弱兜底文案
                          </div>
                          <div className="leading-6 whitespace-pre-wrap break-words text-xs">{fallbackCaption}</div>
                        </div>
                      )}
                    </motion.div>
                  ) : (
                    <motion.div
                      key="empty"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="rounded-3xl border border-slate-100 bg-white/50 px-4 py-8 text-center text-sm text-slate-400"
                    >
                      解析视频后，可提取视频音频里的口播文案。
                    </motion.div>
                  )}
                </AnimatePresence>

                {copyStatus === 'error' && (
                  <div className="text-xs text-red-500">当前没有可复制的文案。</div>
                )}
                </div>
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      {/* 视频预览弹窗 */}
      {showVideoPreview && result?.downloadUrl && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4"
          onClick={() => setShowVideoPreview(false)}
        >
          <div
            className="relative max-h-[78vh] max-w-[92vw] overflow-hidden rounded-3xl shadow-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={() => setShowVideoPreview(false)}
              className="absolute right-2 top-2 z-10 flex size-8 items-center justify-center rounded-full bg-black/40 text-white/80 backdrop-blur-sm transition-colors hover:bg-black/60 hover:text-white"
            >
              <X className="size-4" />
            </button>
            <video
              src={`/api/douyin/video-stream?url=${encodeURIComponent(result.downloadUrl)}&videoId=${encodeURIComponent(result.videoId || '')}&platform=${encodeURIComponent(result.platform || 'douyin')}`}
              controls
              preload="metadata"
              className="max-h-[78vh] max-w-[92vw] bg-black"
              playsInline
              onError={() => {
                alert('视频加载失败，可能是链接已过期，请重新解析后再试');
                setShowVideoPreview(false);
              }}
            />
          </div>
        </div>
      )}

      <SiteFooter className="px-6 pb-6 pt-2" />
    </div>
  );
}

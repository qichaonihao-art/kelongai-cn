import { useEffect, useState } from "react";
import {
  ArrowLeft,
  Download,
  Loader2,
  LogOut,
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
  Settings2,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ModuleQuickNav from "@/src/components/ModuleQuickNav";
import SiteFooter from "@/src/components/SiteFooter";
import {
  downloadDouyinVideoFile,
  extractDouyinTranscript,
  getDouyinConfigStatus,
  polishDouyinTranscript,
  resolveDouyinDownload,
  type DouyinConfigStatus,
  type DouyinResolveResult,
  type DouyinTranscriptResult,
} from "@/src/lib/douyin";

interface DouyinDownloaderPageProps {
  onBack: () => void;
  onNavigate: (page: 'voice' | 'creative' | 'douyin') => void;
  onLogout: () => void;
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

export default function DouyinDownloaderPage({ onBack, onNavigate, onLogout }: DouyinDownloaderPageProps) {
  const [input, setInput] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
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
      const response = await extractDouyinTranscript(nextInput);
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

    try {
      await downloadDouyinVideoFile({
        videoId: result.videoId,
        downloadUrl: result.downloadUrl,
        downloadUrlCandidates: result.downloadUrlCandidates,
      });
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : '视频下载失败，请稍后重试。');
    } finally {
      setIsDownloading(false);
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
  }

  const fallbackCaption = transcriptResult?.fallbackCaption || result?.fallbackCaption || '';
  const hasResult = !!result || !!transcriptResult;
  const siliconFlowConfigured = configStatus?.siliconFlowApiKey === true;
  const tikhubConfigured = configStatus?.tikhubApiToken === true;
  const arkApiKeyConfigured = configStatus?.arkApiKey === true;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="h-16 border-b border-slate-200/60 bg-white/50 backdrop-blur-xl flex items-center justify-between px-6 sticky top-0 z-30">
        <div className="flex items-center gap-3">
          <button
            onClick={onBack}
            className="flex items-center gap-2.5 h-9 rounded-full pl-1 pr-4 bg-white/60 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300 group"
          >
            <div className="size-7 rounded-full bg-slate-900 text-white flex items-center justify-center group-hover:scale-105 transition-transform">
              <ArrowLeft className="size-3.5" />
            </div>
            <span className="text-xs font-bold text-slate-700">返回</span>
          </button>
          <ModuleQuickNav current="douyin" onNavigate={onNavigate} />
        </div>
        <button
          onClick={onLogout}
          className="flex items-center gap-2 h-9 rounded-full px-4 text-xs font-bold text-slate-600 bg-white/60 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300"
        >
          <LogOut className="size-3.5" />
          退出登录
        </button>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full p-6 space-y-6 pb-24">
        {/* Title Section */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="glass-card rounded-3xl border-white/80 p-6 shadow-glass"
        >
          <div className="flex items-center gap-4">
            <div className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-slate-900 to-slate-700 text-white shadow-lg shadow-slate-900/20">
              <Sparkles className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-slate-900">抖音视频解析</h1>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">粘贴链接，一键解析下载视频与提取文案</p>
            </div>
          </div>

          <div className="mt-5 flex flex-wrap items-center gap-2">
            <div className="flex items-center gap-1.5 text-[11px] font-bold text-slate-400">
              <Settings2 className="size-3.5" />
              本地配置
            </div>
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
                siliconFlowConfigured
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                  : 'border-amber-100 bg-amber-50 text-amber-700'
              }`}
            >
              SiliconFlow：{siliconFlowConfigured ? '已配置' : '未配置'}
            </span>
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
                tikhubConfigured
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                  : 'border-slate-200 bg-white/60 text-slate-500'
              }`}
            >
              TikHub：{tikhubConfigured ? '已配置' : '可选'}
            </span>
            <span
              className={`rounded-full border px-3 py-1 text-[11px] font-bold ${
                arkApiKeyConfigured
                  ? 'border-emerald-100 bg-emerald-50 text-emerald-700'
                  : 'border-amber-100 bg-amber-50 text-amber-700'
              }`}
            >
              豆包多模态：{arkApiKeyConfigured ? '已配置' : '未配置'}
            </span>
            {configStatus && !configStatus.reachable && (
              <span className="rounded-full border border-red-100 bg-red-50 px-3 py-1 text-[11px] font-bold text-red-600">
                配置读取失败
              </span>
            )}
          </div>
        </motion.section>

        {/* Input Section */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="glass-card rounded-3xl border-white/80 p-6 shadow-glass space-y-5"
        >
          <div className="flex items-center gap-2">
            <div className="size-6 rounded-lg bg-indigo-50 flex items-center justify-center">
              <Link2 className="size-3.5 text-indigo-600" />
            </div>
            <span className="text-xs font-bold text-slate-500 uppercase tracking-wider">粘贴链接</span>
          </div>

          <div className="relative">
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="请输入抖音链接或分享文案..."
              className="w-full h-32 rounded-2xl border border-slate-200 bg-white/60 p-4 text-sm outline-none transition-all resize-none focus:ring-2 focus:ring-indigo-500/20 focus:border-indigo-300 placeholder:text-slate-400"
            />
            {input && (
              <button
                onClick={() => setInput('')}
                className="absolute top-3 right-3 size-6 rounded-full bg-slate-100 hover:bg-slate-200 flex items-center justify-center transition-colors"
              >
                <Trash2 className="size-3 text-slate-400" />
              </button>
            )}
          </div>

          <div className="flex items-center gap-3">
            <button
              disabled={isResolving}
              onClick={handleResolve}
              className="flex-1 h-10 rounded-full text-sm font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-lg shadow-slate-900/20 transition-all active:scale-[0.98] disabled:opacity-60 disabled:cursor-not-allowed flex items-center justify-center gap-2"
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
              className="h-10 rounded-full px-5 text-sm font-bold text-slate-600 bg-white/60 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all disabled:opacity-50"
            >
              清空
            </button>
          </div>

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
        </motion.section>

        {/* Result Section */}
        <AnimatePresence>
          {(hasResult || isTranscriptLoading) && (
            <motion.section
              initial={{ opacity: 0, y: 16 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.4 }}
              className="space-y-4"
            >
              {/* Video Info Card */}
              <div className="glass-card rounded-3xl border-white/80 p-6 shadow-glass space-y-5">
                <div className="flex items-center gap-3">
                  <div className="inline-flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-indigo-500 to-violet-600 text-white shadow-md shadow-indigo-500/20">
                    <Download className="size-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">视频信息</div>
                  </div>
                </div>

                {result ? (
                  <div className="space-y-4">
                    <div className="flex items-center gap-2 text-xs text-emerald-600 font-bold bg-emerald-50/80 px-3 py-2 rounded-lg border border-emerald-100/80 w-fit">
                      <CheckCircle2 className="size-3.5" />
                      视频解析成功
                    </div>

                    <div className="bg-white/50 rounded-2xl p-4 space-y-3 border border-slate-100">
                      <div className="space-y-1">
                        <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                          <FileText className="size-3" />
                          视频标题
                        </div>
                        <div className="text-sm font-semibold text-slate-800 leading-relaxed">
                          {result.title?.trim() || result.caption?.trim() || '未提取到标题'}
                        </div>
                      </div>

                      {result.authorName?.trim() && (
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-1.5 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            <User className="size-3" />
                            作者
                          </div>
                          <div className="text-xs font-semibold text-slate-700">
                            {result.authorName.trim()}
                          </div>
                        </div>
                      )}
                    </div>

                    <div className="flex flex-col sm:flex-row gap-3">
                      <button
                        onClick={handleDownloadVideo}
                        disabled={isDownloading}
                        className="flex-1 h-10 rounded-full text-sm font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-lg shadow-indigo-600/20 transition-all active:scale-[0.98] disabled:opacity-60 flex items-center justify-center gap-2"
                      >
                        {isDownloading ? (
                          <>
                            <Loader2 className="size-4 animate-spin" />
                            正在下载视频...
                          </>
                        ) : (
                          <>
                            <Download className="size-4" />
                            下载视频
                          </>
                        )}
                      </button>

                      <button
                        onClick={handleExtractTranscript}
                        disabled={isTranscriptLoading}
                        className="flex-1 h-10 rounded-full text-sm font-bold text-slate-700 bg-white/70 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all disabled:opacity-50 flex items-center justify-center gap-2"
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
                ) : (
                  <div className="rounded-xl border border-slate-100 bg-white/40 px-4 py-6 text-sm text-slate-400 text-center">
                    解析成功后，这里会显示视频信息。
                  </div>
                )}
              </div>

              {/* Transcript Card */}
              <div className="glass-card rounded-3xl border-white/80 p-6 shadow-glass space-y-5">
                <div className="flex items-center gap-3">
                  <div className="inline-flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-amber-500 to-orange-500 text-white shadow-md shadow-amber-500/20">
                    <AudioLines className="size-4" />
                  </div>
                  <div>
                    <div className="text-xs font-bold text-slate-400 uppercase tracking-wider">视频文案</div>
                  </div>
                </div>

                <AnimatePresence mode="wait">
                  {isTranscriptLoading ? (
                    <motion.div
                      key="loading"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                      className="rounded-xl border border-indigo-100 bg-indigo-50/60 px-4 py-4"
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
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <div className="flex items-center gap-2 text-xs text-emerald-600 font-bold bg-emerald-50/80 px-3 py-2 rounded-lg border border-emerald-100/80">
                            <CheckCircle2 className="size-3.5" />
                            文案提取成功
                          </div>
                          {displayTranscript !== originalTranscript && originalTranscript && (
                            <span className="text-[10px] font-bold text-indigo-600 bg-indigo-50/80 px-2 py-1 rounded-md border border-indigo-100/80">
                              已AI校对
                            </span>
                          )}
                        </div>

                        <div className="flex items-center gap-2">
                          {transcriptResult.transcriptSegments && transcriptResult.transcriptSegments > 1 && (
                            <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                              <Clock className="size-3" />
                              {transcriptResult.transcriptSegments} 段音频
                            </span>
                          )}
                          {displayTranscript !== originalTranscript && originalTranscript && (
                            <button
                              onClick={() => setShowDiff((v) => !v)}
                              className="h-8 rounded-full px-3 text-xs font-bold text-slate-500 bg-white/70 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex items-center gap-1.5"
                            >
                              {showDiff ? '显示完整' : '显示修改'}
                            </button>
                          )}
                          {displayTranscript !== originalTranscript && originalTranscript && (
                            <button
                              onClick={handleRestoreOriginal}
                              className="h-8 rounded-full px-3 text-xs font-bold text-slate-500 bg-white/70 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex items-center gap-1.5"
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
                              className="h-8 rounded-full px-3 text-xs font-bold text-indigo-600 bg-indigo-50/80 hover:bg-indigo-50 border border-indigo-100/80 shadow-sm hover:shadow-md transition-all flex items-center gap-1.5"
                            >
                              <Sparkles className="size-3" />
                              AI 校对
                            </button>
                          )}
                          <button
                            onClick={handleCopyTranscript}
                            className="h-8 rounded-full px-4 text-xs font-bold text-slate-600 bg-white/70 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all flex items-center gap-1.5"
                          >
                            <Copy className="size-3" />
                            {copyStatus === 'done' ? '已复制' : '复制文案'}
                          </button>
                        </div>
                      </div>

                      <div className="rounded-2xl border border-slate-100 bg-white/60 p-4 text-sm leading-7 text-slate-700 whitespace-pre-wrap break-words max-h-96 overflow-y-auto">
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
                      <div className="rounded-xl border border-amber-100 bg-amber-50/80 px-4 py-3 text-sm text-amber-700">
                        <div className="flex items-center gap-2 font-semibold">
                          <AlertCircle className="size-4" />
                          文案提取失败
                        </div>
                        <div className="mt-1.5 text-xs leading-5 opacity-80">{transcriptResult.transcriptError || '请稍后重试。'}</div>
                      </div>

                      {fallbackCaption && (
                        <div className="rounded-2xl border border-slate-100 bg-white/50 p-4 text-sm text-slate-600 space-y-2">
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
                      className="rounded-xl border border-slate-100 bg-white/40 px-4 py-6 text-sm text-slate-400 text-center"
                    >
                      解析视频后，可提取视频音频里的口播文案。
                    </motion.div>
                  )}
                </AnimatePresence>

                {copyStatus === 'error' && (
                  <div className="text-xs text-red-500">当前没有可复制的文案。</div>
                )}
              </div>
            </motion.section>
          )}
        </AnimatePresence>
      </main>

      <SiteFooter className="px-6 pb-6 pt-2" />
    </div>
  );
}

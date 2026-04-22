import { useState } from "react";
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
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import SiteFooter from "@/src/components/SiteFooter";
import {
  downloadDouyinVideoFile,
  extractDouyinTranscript,
  resolveDouyinDownload,
  type DouyinResolveResult,
  type DouyinTranscriptResult,
} from "@/src/lib/douyin";

interface DouyinDownloaderPageProps {
  onBack: () => void;
  onLogout: () => void;
}

export default function DouyinDownloaderPage({ onBack, onLogout }: DouyinDownloaderPageProps) {
  const [input, setInput] = useState("");
  const [isResolving, setIsResolving] = useState(false);
  const [isDownloading, setIsDownloading] = useState(false);
  const [isTranscriptLoading, setIsTranscriptLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DouyinResolveResult | null>(null);
  const [transcriptResult, setTranscriptResult] = useState<DouyinTranscriptResult | null>(null);
  const [copyStatus, setCopyStatus] = useState<'idle' | 'done' | 'error'>('idle');

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

      if (!result) {
        setResult({
          ok: true,
          mode: 'stable',
          videoId: normalizedTranscriptResult.videoId,
          title: normalizedTranscriptResult.title,
          downloadUrl: normalizedTranscriptResult.downloadUrl,
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
      setError(submitError instanceof Error ? submitError.message : '视频文案提取失败，请稍后重试。');
    } finally {
      setIsTranscriptLoading(false);
    }
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
      });
    } catch (downloadError) {
      setError(downloadError instanceof Error ? downloadError.message : '视频下载失败，请稍后重试。');
    } finally {
      setIsDownloading(false);
    }
  }

  async function handleCopyTranscript() {
    const transcript = transcriptResult?.transcript?.trim() || '';
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
  }

  const fallbackCaption = transcriptResult?.fallbackCaption || result?.fallbackCaption || '';
  const hasResult = !!result || !!transcriptResult;

  return (
    <div className="min-h-screen bg-background flex flex-col">
      {/* Header */}
      <header className="h-16 border-b border-slate-200/60 bg-white/50 backdrop-blur-xl flex items-center justify-between px-6 sticky top-0 z-30">
        <button
          onClick={onBack}
          className="flex items-center gap-2.5 h-9 rounded-full pl-1 pr-4 bg-white/60 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300 group"
        >
          <div className="size-7 rounded-full bg-slate-900 text-white flex items-center justify-center group-hover:scale-105 transition-transform">
            <ArrowLeft className="size-3.5" />
          </div>
          <span className="text-xs font-bold text-slate-700">返回</span>
        </button>

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
                            下载中...
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
                        <div className="flex items-center gap-2 text-xs text-emerald-600 font-bold bg-emerald-50/80 px-3 py-2 rounded-lg border border-emerald-100/80">
                          <CheckCircle2 className="size-3.5" />
                          文案提取成功
                        </div>

                        <div className="flex items-center gap-2">
                          {transcriptResult.transcriptSegments && transcriptResult.transcriptSegments > 1 && (
                            <span className="text-[10px] text-slate-400 font-medium flex items-center gap-1">
                              <Clock className="size-3" />
                              {transcriptResult.transcriptSegments} 段音频
                            </span>
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
                        {transcriptResult.transcript}
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

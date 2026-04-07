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
} from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
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

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <header className="h-20 border-b border-slate-200 bg-white/40 backdrop-blur-md flex items-center justify-between px-8 sticky top-0 z-30">
        <div
          className="glass-card flex items-center gap-3 p-1.5 pr-6 rounded-2xl border-white/60 shadow-glass hover:shadow-glass-hover transition-all cursor-pointer group"
          onClick={onBack}
        >
          <div className="size-10 rounded-xl bg-slate-900 text-white flex items-center justify-center group-hover:scale-105 transition-transform">
            <ArrowLeft className="size-5" />
          </div>
          <h1 className="text-sm font-black text-slate-900 tracking-tight">退回主界面</h1>
        </div>

        <Button
          variant="outline"
          size="sm"
          onClick={onLogout}
          className="gap-2 rounded-full px-4"
        >
          <LogOut className="size-4" />
          退出登录
        </Button>
      </header>

      <main className="flex-1 max-w-4xl mx-auto w-full p-8 space-y-8 pb-24">
        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-[2.5rem] border-white/80 p-8 shadow-glass"
        >
          <div className="flex items-start gap-4">
            <div className="inline-flex size-12 shrink-0 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <Download className="size-5" />
            </div>
            <div className="pt-0.5">
              <h2 className="text-3xl font-black tracking-tight text-slate-900">抖音视频解析下载</h2>
            </div>
          </div>
        </motion.section>

        <section className="glass-card p-10 rounded-[2.5rem] border-white/80 shadow-glass space-y-6">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">1. 粘贴分享内容</h2>
          <div className="space-y-4">
            <Label className="text-xs font-bold text-slate-500 uppercase tracking-wider">链接或分享文案</Label>
            <textarea
              value={input}
              onChange={(event) => setInput(event.target.value)}
              placeholder="请输入抖音链接或分享文案"
              className="w-full h-40 rounded-[2rem] border border-slate-300 bg-white/50 p-6 text-base outline-none transition-all resize-none focus:ring-4 focus:ring-indigo-500/10"
            />
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            <Button
              className="w-full h-14 rounded-2xl text-lg font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-xl shadow-slate-900/20 transition-all active:scale-[0.98]"
              disabled={isResolving}
              onClick={handleResolve}
            >
              {isResolving ? (
                <span className="flex items-center gap-3">
                  <Loader2 className="size-6 animate-spin" />
                  解析中...
                </span>
              ) : (
                <span className="flex items-center gap-3">
                  <Download className="size-6" />
                  解析视频
                </span>
              )}
            </Button>

            <Button
              variant="outline"
              size="lg"
              onClick={resetAll}
              disabled={isResolving || isTranscriptLoading}
              className="rounded-2xl px-8 border-slate-300"
            >
              清空
            </Button>
          </div>

          {error && (
            <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-500">
              {error}
            </div>
          )}
        </section>

        <section className="glass-card p-10 rounded-[2.5rem] border-white/80 shadow-glass space-y-6">
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">2. 结果区</h2>

          {!result && !transcriptResult && !error && (
            <div className="rounded-2xl border border-slate-200 bg-white/50 px-4 py-3 text-sm text-slate-500">
              先解析视频，再下载或提取视频文案。
            </div>
          )}

          <div className="space-y-6">
            <div className="w-full bg-white/40 backdrop-blur-md p-6 rounded-[2rem] border border-white/60 space-y-5">
              <div className="flex items-center gap-3">
                <div className="inline-flex size-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
                  <Download className="size-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">视频结果</div>
                  <div className="text-lg font-black text-slate-900">解析视频并下载</div>
                </div>
              </div>

              {result ? (
                <>
                  <div className="flex items-center gap-2 text-xs text-emerald-600 font-bold bg-emerald-50/90 p-3 rounded-xl border border-emerald-100">
                    <CheckCircle2 className="size-4" />
                    视频解析成功，可直接下载。
                  </div>

                  <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
                    <div className="space-y-4">
                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">视频标题</div>
                        <div className="mt-1 text-sm font-medium text-slate-700">
                          {result.title?.trim() || result.caption?.trim() || '未提取到标题'}
                        </div>
                      </div>

                      <div className="grid gap-4 sm:grid-cols-1">
                        <div>
                          <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">作者</div>
                          <div className="mt-1 text-sm font-medium text-slate-700">
                            {result.authorName?.trim() || '未提取到作者'}
                          </div>
                        </div>
                      </div>
                    </div>

                    <div className="flex flex-col gap-3">
                      <Button
                        onClick={handleDownloadVideo}
                        disabled={isDownloading}
                        className="h-14 rounded-2xl px-8 text-lg font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98]"
                      >
                        {isDownloading ? (
                          <>
                            <Loader2 className="mr-3 size-5 animate-spin" />
                            下载中...
                          </>
                        ) : (
                          <>
                            <Download className="mr-3 size-5" />
                            下载视频
                          </>
                        )}
                      </Button>

                      <Button
                        variant="outline"
                        onClick={handleExtractTranscript}
                        disabled={isTranscriptLoading}
                        className="h-14 rounded-2xl px-8 border-slate-300 bg-white/60 text-base font-bold"
                      >
                        {isTranscriptLoading ? (
                          <>
                            <Loader2 className="mr-3 size-5 animate-spin" />
                            提取中...
                          </>
                        ) : (
                          <>
                            <AudioLines className="mr-3 size-5" />
                            提取视频文案
                          </>
                        )}
                      </Button>
                    </div>
                  </div>
                </>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white/50 px-4 py-4 text-sm text-slate-500">
                  解析成功后，这里会显示标题、作者和下载按钮。
                </div>
              )}
            </div>

            <div className="w-full bg-white/40 backdrop-blur-md p-6 rounded-[2rem] border border-white/60 space-y-5">
              <div className="flex items-center gap-3">
                <div className="inline-flex size-11 items-center justify-center rounded-2xl bg-slate-900 text-white">
                  <FileText className="size-5" />
                </div>
                <div>
                  <div className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">文案结果</div>
                  <div className="text-lg font-black text-slate-900">视频音频口播转写</div>
                </div>
              </div>

              {isTranscriptLoading && (
                <div className="rounded-2xl border border-indigo-100 bg-indigo-50/80 px-4 py-4 text-sm text-indigo-700">
                  <div className="flex items-center gap-3 font-semibold">
                    <Loader2 className="size-4 animate-spin" />
                    正在下载视频、提取音频并调用 ASR 转写，这一步通常会比解析视频更久。
                  </div>
                </div>
              )}

              {transcriptResult?.transcriptOk ? (
                <>
                  <div className="flex items-center gap-2 text-xs text-emerald-600 font-bold bg-emerald-50/90 p-3 rounded-xl border border-emerald-100">
                    <CheckCircle2 className="size-4" />
                    文案提取成功，可直接复制。
                  </div>

                  <div className="flex items-center justify-between gap-3">
                    <div className="text-sm text-slate-500">
                      {transcriptResult.transcriptSegments && transcriptResult.transcriptSegments > 1
                        ? `已按 ${transcriptResult.transcriptSegments} 段完成转写`
                        : '已完成整段音频转写'}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyTranscript}
                      className="rounded-full px-4 border-slate-300 bg-white/50"
                    >
                      <Copy className="mr-2 size-3.5" />
                      {copyStatus === 'done' ? '已复制' : '复制文案'}
                    </Button>
                  </div>

                  <div className="rounded-2xl border border-slate-200 bg-white/50 px-4 py-4 text-sm leading-6 text-slate-700 whitespace-pre-wrap break-words">
                    {transcriptResult.transcript}
                  </div>
                </>
              ) : transcriptResult && !transcriptResult.transcriptOk ? (
                <>
                  <div className="rounded-2xl border border-amber-100 bg-amber-50/90 px-4 py-4 text-sm text-amber-700">
                    <div className="flex items-center gap-3 font-semibold">
                      <AlertCircle className="size-4" />
                      下载链路可用，但文案提取失败。
                    </div>
                    <div className="mt-2 leading-6">{transcriptResult.transcriptError || '请稍后重试。'}</div>
                  </div>

                  {fallbackCaption && (
                    <div className="rounded-2xl border border-slate-200 bg-white/50 px-4 py-4 text-sm text-slate-600 space-y-2">
                      <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                        弱兜底文案
                      </div>
                      <div className="leading-6 whitespace-pre-wrap break-words">{fallbackCaption}</div>
                    </div>
                  )}
                </>
              ) : (
                <div className="rounded-2xl border border-slate-200 bg-white/50 px-4 py-4 text-sm text-slate-500">
                  解析视频后，可继续提取视频音频里的口播文案。
                </div>
              )}

              {copyStatus === 'error' && (
                <div className="text-xs text-red-500">当前没有可复制的文案。</div>
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

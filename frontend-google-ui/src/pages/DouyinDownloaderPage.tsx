import { useMemo, useState } from "react";
import {
  AlertCircle,
  ArrowLeft,
  AudioLines,
  CheckCircle2,
  Copy,
  Download,
  FileText,
  Link2,
  Loader2,
  LogOut,
  Sparkles,
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

const SAMPLE_SHARE_TEXT = `7.82 复制打开抖音，看看【示例】的视频！ https://v.douyin.com/xxxxxx/`;

type StageTone = "idle" | "active" | "success" | "error";

function getStageClasses(tone: StageTone) {
  if (tone === "success") {
    return "border-emerald-100 bg-emerald-50/90 text-emerald-700";
  }

  if (tone === "active") {
    return "border-indigo-100 bg-indigo-50/90 text-indigo-700";
  }

  if (tone === "error") {
    return "border-amber-100 bg-amber-50/90 text-amber-700";
  }

  return "border-slate-200 bg-white/60 text-slate-500";
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
  const parseTone: StageTone = isResolving ? 'active' : result ? 'success' : error && !transcriptResult ? 'error' : 'idle';
  const downloadTone: StageTone = isDownloading ? 'active' : result ? 'success' : 'idle';
  const transcriptTone: StageTone = isTranscriptLoading
    ? 'active'
    : transcriptResult?.transcriptOk
      ? 'success'
      : transcriptResult && !transcriptResult.transcriptOk
        ? 'error'
        : 'idle';

  const overviewStats = useMemo(() => [
    {
      label: '解析状态',
      value: isResolving ? '解析中' : result ? '已完成' : '待开始',
      tone: parseTone,
      description: result ? '已经识别到可用视频信息' : '先完成视频解析',
    },
    {
      label: '下载状态',
      value: isDownloading ? '下载中' : result ? '可下载' : '待解析',
      tone: downloadTone,
      description: result ? '点击按钮即可直接保存 mp4' : '解析后开放下载',
    },
    {
      label: '文案状态',
      value: isTranscriptLoading ? '提取中' : transcriptResult?.transcriptOk ? '已生成' : transcriptResult ? '提取失败' : '待开始',
      tone: transcriptTone,
      description: transcriptResult?.transcriptOk ? '结果支持复制' : '提取视频口播文案',
    },
  ], [downloadTone, isDownloading, isResolving, isTranscriptLoading, parseTone, result, transcriptResult, transcriptTone]);

  return (
    <div className="min-h-screen bg-background relative overflow-hidden">
      <div className="absolute inset-x-0 top-0 h-72 bg-gradient-to-b from-white/35 via-white/10 to-transparent" />
      <div className="absolute left-[-8rem] top-32 size-80 rounded-full bg-sky-400/10 blur-[120px]" />
      <div className="absolute right-[-8rem] top-24 size-96 rounded-full bg-indigo-400/10 blur-[130px]" />

      <div className="relative mx-auto flex min-h-screen w-full max-w-7xl flex-col px-6 pb-16 pt-8 lg:px-10">
        <header className="flex items-center justify-between">
          <button
            type="button"
            className="glass-card flex items-center gap-3 rounded-full border-white/70 px-4 py-2 shadow-glass transition-all hover:shadow-glass-hover"
            onClick={onBack}
          >
            <div className="inline-flex size-10 items-center justify-center rounded-2xl bg-slate-900 text-white">
              <ArrowLeft className="size-4" />
            </div>
            <div className="text-left">
              <div className="text-[10px] font-bold uppercase tracking-[0.24em] text-slate-400">Back To Workspace</div>
              <div className="text-sm font-black text-slate-900">返回首页</div>
            </div>
          </button>

          <Button
            variant="outline"
            size="sm"
            onClick={onLogout}
            className="glass-card gap-2 rounded-full border-white/60 px-5 text-slate-500 shadow-glass hover:border-red-200 hover:text-red-500"
          >
            <LogOut className="size-4" />
            <span className="text-xs font-bold uppercase tracking-wider">退出登录</span>
          </Button>
        </header>

        <motion.section
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="mt-8 glass-card rounded-[3rem] border-white/80 px-8 py-8 shadow-glass lg:px-10 lg:py-10"
        >
          <div className="grid gap-8 xl:grid-cols-[minmax(0,1.2fr)_minmax(300px,0.8fr)] xl:items-end">
            <div>
              <div className="inline-flex items-center gap-2 rounded-full border border-white/70 bg-white/75 px-4 py-2 text-[11px] font-bold uppercase tracking-[0.24em] text-slate-500">
                <Sparkles className="size-3.5 text-sky-500" />
                Video Intelligence Workspace
              </div>
              <h1 className="mt-5 text-4xl font-black tracking-[-0.04em] text-slate-900 sm:text-5xl">
                抖音视频 / 文案提取
              </h1>
              <p className="mt-4 max-w-3xl text-base leading-8 text-slate-600">
                从分享链接进入，完成视频解析、直接下载、音频文案提取与复制。它现在不是独立外挂功能，而是这套 AI 创意产品里的正式工作流页面。
              </p>
            </div>

            <div className="grid gap-3 sm:grid-cols-3 xl:grid-cols-1">
              {overviewStats.map((item) => (
                <div
                  key={item.label}
                  className={`rounded-[1.75rem] border px-4 py-4 ${getStageClasses(item.tone)}`}
                >
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em]">{item.label}</div>
                  <div className="mt-2 text-lg font-black">{item.value}</div>
                  <div className="mt-1 text-sm leading-6 opacity-80">{item.description}</div>
                </div>
              ))}
            </div>
          </div>
        </motion.section>

        <main className="mt-8 grid flex-1 gap-6 xl:grid-cols-[minmax(360px,0.92fr)_minmax(0,1.08fr)]">
          <section className="space-y-6">
            <div className="glass-card rounded-[2.5rem] border-white/80 p-7 shadow-glass">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Step 01</div>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">输入分享链接或文案</h2>
                </div>
                <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
                  <Link2 className="size-5" />
                </div>
              </div>

              <div className="mt-6 space-y-4">
                <div className="space-y-2">
                  <Label className="text-xs font-bold uppercase tracking-[0.22em] text-slate-500">链接或分享文案</Label>
                  <textarea
                    value={input}
                    onChange={(event) => setInput(event.target.value)}
                    placeholder="请输入抖音链接或整段分享文案"
                    className="min-h-52 w-full resize-none rounded-[2rem] border border-white/80 bg-white/75 px-6 py-5 text-base leading-7 text-slate-700 outline-none transition-all focus:border-indigo-200 focus:ring-4 focus:ring-indigo-500/10"
                  />
                </div>

                <div className="rounded-[1.75rem] border border-white/70 bg-white/65 px-4 py-4 text-sm leading-7 text-slate-500">
                  <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">示例</div>
                  <div className="mt-2 break-all">{SAMPLE_SHARE_TEXT}</div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <Button
                    className="h-14 rounded-2xl bg-slate-900 text-base font-bold text-white shadow-xl shadow-slate-900/20 transition-all active:scale-[0.98] hover:bg-slate-800"
                    disabled={isResolving}
                    onClick={handleResolve}
                  >
                    {isResolving ? (
                      <>
                        <Loader2 className="mr-3 size-5 animate-spin" />
                        解析中...
                      </>
                    ) : (
                      <>
                        <Download className="mr-3 size-5" />
                        解析视频
                      </>
                    )}
                  </Button>

                  <Button
                    variant="outline"
                    onClick={resetAll}
                    disabled={isResolving || isDownloading || isTranscriptLoading}
                    className="h-14 rounded-2xl border-slate-300 bg-white/65 text-base font-bold"
                  >
                    清空输入
                  </Button>
                </div>

                {error && (
                  <div className="rounded-[1.75rem] border border-red-100 bg-red-50/90 px-4 py-4 text-sm leading-6 text-red-600">
                    {error}
                  </div>
                )}
              </div>
            </div>

            <div className="glass-card rounded-[2.5rem] border-white/80 p-7 shadow-glass">
              <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Workflow</div>
              <div className="mt-4 grid gap-3">
                {[
                  '先解析链接，确认视频标题、作者和可下载地址。',
                  '解析成功后可直接下载视频，也可继续提取音频口播文案。',
                  '文案提取成功后支持一键复制，失败时会给出明确状态。',
                ].map((item, index) => (
                  <div
                    key={item}
                    className="rounded-[1.5rem] border border-white/70 bg-white/65 px-4 py-4 text-sm leading-7 text-slate-600"
                  >
                    <span className="mr-3 inline-flex size-7 items-center justify-center rounded-full bg-slate-900 text-xs font-black text-white">
                      {index + 1}
                    </span>
                    {item}
                  </div>
                ))}
              </div>
            </div>
          </section>

          <section className="space-y-6">
            <div className="glass-card rounded-[2.5rem] border-white/80 p-7 shadow-glass">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Step 02</div>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">视频结果</h2>
                </div>
                <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-indigo-600 text-white shadow-lg shadow-indigo-200/60">
                  <Download className="size-5" />
                </div>
              </div>

              {!result ? (
                <div className="mt-6 rounded-[1.75rem] border border-slate-200 bg-white/60 px-4 py-5 text-sm leading-7 text-slate-500">
                  先完成视频解析，这里会显示标题、作者、链接来源以及直接下载入口。
                </div>
              ) : (
                <div className="mt-6 space-y-5">
                  <div className="flex items-center gap-2 rounded-[1.5rem] border border-emerald-100 bg-emerald-50/90 px-4 py-3 text-sm font-bold text-emerald-700">
                    <CheckCircle2 className="size-4" />
                    视频解析成功，可直接下载。
                  </div>

                  <div className="grid gap-4 md:grid-cols-2">
                    <div className="rounded-[1.75rem] border border-white/70 bg-white/65 px-5 py-4">
                      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">视频标题</div>
                      <div className="mt-2 text-sm font-medium leading-7 text-slate-700">
                        {result.title?.trim() || result.caption?.trim() || '未提取到标题'}
                      </div>
                    </div>

                    <div className="rounded-[1.75rem] border border-white/70 bg-white/65 px-5 py-4">
                      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">作者</div>
                      <div className="mt-2 text-sm font-medium leading-7 text-slate-700">
                        {result.authorName?.trim() || '未提取到作者'}
                      </div>
                    </div>

                    <div className="rounded-[1.75rem] border border-white/70 bg-white/65 px-5 py-4">
                      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">来源类型</div>
                      <div className="mt-2 text-sm font-medium leading-7 text-slate-700">
                        {result.sourceType === 'web_url' ? '网页直链' : '分享文本 / 短链接'}
                      </div>
                    </div>

                    <div className="rounded-[1.75rem] border border-white/70 bg-white/65 px-5 py-4">
                      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">Video ID</div>
                      <div className="mt-2 break-all font-mono text-sm leading-7 text-slate-700">
                        {result.videoId || '未提取到'}
                      </div>
                    </div>
                  </div>

                  {result.normalizedUrl && (
                    <div className="rounded-[1.75rem] border border-white/70 bg-white/65 px-5 py-4">
                      <div className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">
                        <Link2 className="size-3.5" />
                        Normalized URL
                      </div>
                      <a
                        href={result.normalizedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-2 block break-all text-sm leading-7 text-indigo-600 hover:text-indigo-700"
                      >
                        {result.normalizedUrl}
                      </a>
                    </div>
                  )}

                  <div className="grid gap-3 sm:grid-cols-2">
                    <Button
                      onClick={handleDownloadVideo}
                      disabled={isDownloading}
                      className="h-14 rounded-2xl bg-indigo-600 text-base font-bold text-white shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98] hover:bg-indigo-700"
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
                      className="h-14 rounded-2xl border-slate-300 bg-white/65 text-base font-bold"
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
              )}
            </div>

            <div className="glass-card rounded-[2.5rem] border-white/80 p-7 shadow-glass">
              <div className="flex items-start justify-between gap-4">
                <div>
                  <div className="text-[11px] font-bold uppercase tracking-[0.24em] text-slate-400">Step 03</div>
                  <h2 className="mt-2 text-2xl font-black tracking-tight text-slate-900">文案结果</h2>
                </div>
                <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
                  <FileText className="size-5" />
                </div>
              </div>

              {isTranscriptLoading && (
                <div className="mt-6 rounded-[1.75rem] border border-indigo-100 bg-indigo-50/90 px-4 py-4 text-sm leading-7 text-indigo-700">
                  <div className="flex items-center gap-3 font-semibold">
                    <Loader2 className="size-4 animate-spin" />
                    正在下载视频、提取音频并调用 ASR 转写，这一步通常会比解析视频更久。
                  </div>
                </div>
              )}

              {transcriptResult?.transcriptOk ? (
                <div className="mt-6 space-y-5">
                  <div className="flex items-center gap-2 rounded-[1.5rem] border border-emerald-100 bg-emerald-50/90 px-4 py-3 text-sm font-bold text-emerald-700">
                    <CheckCircle2 className="size-4" />
                    文案提取成功，可直接复制。
                  </div>

                  <div className="flex flex-col gap-3 rounded-[1.75rem] border border-white/70 bg-white/65 px-5 py-4 sm:flex-row sm:items-center sm:justify-between">
                    <div className="text-sm leading-7 text-slate-500">
                      {transcriptResult.transcriptSegments && transcriptResult.transcriptSegments > 1
                        ? `已按 ${transcriptResult.transcriptSegments} 段完成转写`
                        : '已完成整段音频转写'}
                    </div>
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={handleCopyTranscript}
                      className="rounded-full border-slate-300 bg-white/70 px-4"
                    >
                      <Copy className="mr-2 size-3.5" />
                      {copyStatus === 'done' ? '已复制' : '复制文案'}
                    </Button>
                  </div>

                  <div className="rounded-[1.75rem] border border-white/70 bg-white/70 px-5 py-5 text-sm leading-7 whitespace-pre-wrap break-words text-slate-700">
                    {transcriptResult.transcript}
                  </div>
                </div>
              ) : transcriptResult && !transcriptResult.transcriptOk ? (
                <div className="mt-6 space-y-4">
                  <div className="rounded-[1.75rem] border border-amber-100 bg-amber-50/90 px-4 py-4 text-sm text-amber-700">
                    <div className="flex items-center gap-3 font-semibold">
                      <AlertCircle className="size-4" />
                      下载链路可用，但文案提取失败。
                    </div>
                    <div className="mt-2 leading-7">{transcriptResult.transcriptError || '请稍后重试。'}</div>
                  </div>

                  {fallbackCaption && (
                    <div className="rounded-[1.75rem] border border-white/70 bg-white/65 px-5 py-4 text-sm text-slate-600">
                      <div className="text-[10px] font-bold uppercase tracking-[0.22em] text-slate-400">弱兜底文案</div>
                      <div className="mt-2 whitespace-pre-wrap break-words leading-7">{fallbackCaption}</div>
                    </div>
                  )}
                </div>
              ) : (
                <div className="mt-6 rounded-[1.75rem] border border-slate-200 bg-white/60 px-4 py-5 text-sm leading-7 text-slate-500">
                  解析视频后，可继续提取视频音频里的口播文案，并在结果生成后直接复制。
                </div>
              )}

              {copyStatus === 'error' && (
                <div className="mt-4 text-xs font-medium text-red-500">当前没有可复制的文案。</div>
              )}
            </div>
          </section>
        </main>
      </div>
    </div>
  );
}

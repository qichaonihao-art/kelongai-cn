import { useState } from "react";
import { ArrowLeft, Download, Loader2, LogOut, Link2, CheckCircle2, Sparkles } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/src/components/ui/button";
import { Label } from "@/src/components/ui/label";
import { resolveDouyinDownload, resolveDouyinHighQualityDownload, type DouyinResolveResult } from "@/src/lib/douyin";

interface DouyinDownloaderPageProps {
  onBack: () => void;
  onLogout: () => void;
}

const SAMPLE_SHARE_TEXT = `7.82 复制打开抖音，看看【示例】的视频！ https://v.douyin.com/xxxxxx/`;

export default function DouyinDownloaderPage({ onBack, onLogout }: DouyinDownloaderPageProps) {
  const [input, setInput] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [isHighQualityLoading, setIsHighQualityLoading] = useState(false);
  const [error, setError] = useState("");
  const [result, setResult] = useState<DouyinResolveResult | null>(null);
  const [highQualityResult, setHighQualityResult] = useState<DouyinResolveResult | null>(null);
  const [highQualityError, setHighQualityError] = useState("");

  async function handleSubmit() {
    const nextInput = input.trim();
    if (!nextInput) {
      setError('请先粘贴抖音链接或整段分享文本。');
      setResult(null);
      return;
    }

    setIsLoading(true);
    setError('');
    setResult(null);
    setHighQualityResult(null);
    setHighQualityError('');

    try {
      const response = await resolveDouyinDownload(nextInput);
      setResult(response);
    } catch (submitError) {
      setResult(null);
      setError(submitError instanceof Error ? submitError.message : '抖音视频解析失败，请稍后重试。');
    } finally {
      setIsLoading(false);
    }
  }

  async function handleHighQualityResolve() {
    const nextInput = input.trim();
    if (!nextInput) {
      setHighQualityError('请先粘贴抖音链接或整段分享文本。');
      return;
    }

    setIsHighQualityLoading(true);
    setHighQualityError('');

    try {
      const response = await resolveDouyinHighQualityDownload(nextInput);
      setHighQualityResult(response);
    } catch (submitError) {
      setHighQualityResult(null);
      setHighQualityError(submitError instanceof Error ? submitError.message : '最高画质链接获取失败，请稍后重试。');
    } finally {
      setIsHighQualityLoading(false);
    }
  }

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
          className="glass-card p-10 rounded-[2.5rem] border-white/80 shadow-glass space-y-3"
        >
          <div className="inline-flex size-12 items-center justify-center rounded-2xl bg-slate-900 text-white">
            <Download className="size-5" />
          </div>
          <h2 className="text-4xl font-black tracking-tight text-slate-900">抖音视频解析下载</h2>
          <p className="max-w-2xl text-sm leading-6 text-slate-500">
            粘贴作品链接或分享文本，解析后直接下载视频。
          </p>
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

          <div className="rounded-2xl border border-slate-200 bg-white/50 px-4 py-3 text-sm text-slate-500">
            示例：{SAMPLE_SHARE_TEXT}
          </div>

          <div className="flex flex-col gap-4 sm:flex-row">
            <Button
              className="w-full h-14 rounded-2xl text-lg font-bold bg-slate-900 hover:bg-slate-800 text-white shadow-xl shadow-slate-900/20 transition-all active:scale-[0.98]"
              disabled={isLoading}
              onClick={handleSubmit}
            >
              {isLoading ? (
                <span className="flex items-center gap-3">
                  <Loader2 className="size-6 animate-spin" />
                  解析中...
                </span>
              ) : (
                <span className="flex items-center gap-3">
                  <Download className="size-6" />
                  解析并下载视频
                </span>
              )}
            </Button>

            <Button
              variant="outline"
              size="lg"
              onClick={() => {
                setInput('');
                setError('');
                setResult(null);
                setHighQualityResult(null);
                setHighQualityError('');
              }}
              disabled={isLoading}
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
          <h2 className="text-xs font-bold text-slate-400 uppercase tracking-[0.2em]">2. 解析结果</h2>

          {!result && !error && (
            <div className="rounded-2xl border border-slate-200 bg-white/50 px-4 py-3 text-sm text-slate-500">
              解析成功后会显示下载入口和作品信息。
            </div>
          )}

          {result && (
            <>
              <motion.div
                initial={{ opacity: 0, scale: 0.95 }}
                animate={{ opacity: 1, scale: 1 }}
                className="flex items-center gap-2 text-xs text-indigo-600 font-bold bg-indigo-50/80 backdrop-blur-sm p-3 rounded-xl border border-indigo-100"
              >
                <CheckCircle2 className="size-4" />
                解析成功，可直接下载。
              </motion.div>

              <div className="space-y-4">
                <div className="w-full bg-white/40 backdrop-blur-md p-6 rounded-[2rem] border border-white/60 space-y-4">
                  <div className="grid gap-4 md:grid-cols-[1fr_auto] md:items-start">
                    <div className="space-y-4">
                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">来源类型</div>
                        <div className="mt-1 text-sm font-medium text-slate-700">
                          {result.sourceType === 'web_url' ? '网页直链' : '分享文本 / 短链接'}
                        </div>
                      </div>

                      <div>
                        <div className="text-[10px] font-bold text-slate-400 uppercase tracking-wider">Video ID</div>
                        <div className="mt-1 break-all font-mono text-sm text-slate-700">{result.videoId}</div>
                      </div>

                      {result.normalizedUrl && (
                        <div>
                          <div className="flex items-center gap-2 text-[10px] font-bold text-slate-400 uppercase tracking-wider">
                            <Link2 className="size-3.5" />
                            Normalized URL
                          </div>
                          <a
                            href={result.normalizedUrl}
                            target="_blank"
                            rel="noreferrer"
                            className="mt-1 block break-all text-sm text-indigo-600 hover:text-indigo-700"
                          >
                            {result.normalizedUrl}
                          </a>
                        </div>
                      )}
                    </div>

                    <Button asChild className="h-14 rounded-2xl px-8 text-lg font-bold bg-indigo-600 hover:bg-indigo-700 text-white shadow-xl shadow-indigo-600/20 transition-all active:scale-[0.98]">
                      <a href={result.downloadUrl} target="_blank" rel="noreferrer">
                        <Download className="mr-3 size-5" />
                        下载视频
                      </a>
                    </Button>
                  </div>
                </div>
              </div>

              <div className="rounded-2xl border border-slate-200 bg-white/50 px-4 py-4 text-sm text-slate-500 space-y-4">
                <div className="flex items-center gap-2 text-xs font-bold uppercase tracking-wider text-slate-500">
                  <Sparkles className="size-4" />
                  高级选项
                </div>

                <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                  <Button
                    variant="outline"
                    onClick={handleHighQualityResolve}
                    disabled={isHighQualityLoading}
                    className="rounded-2xl border-slate-300 bg-white/50"
                  >
                    {isHighQualityLoading ? (
                      <>
                        <Loader2 className="mr-2 size-4 animate-spin" />
                        获取中...
                      </>
                    ) : (
                      '尝试获取最高画质'
                    )}
                  </Button>

                  {highQualityResult && (
                    <Button asChild variant="outline" className="rounded-2xl border-slate-300 bg-white/50">
                      <a href={highQualityResult.downloadUrl} target="_blank" rel="noreferrer">
                        <Download className="mr-2 size-4" />
                        下载最高画质视频
                      </a>
                    </Button>
                  )}
                </div>

                {highQualityError && (
                  <div className="rounded-2xl border border-red-100 bg-red-50 px-4 py-3 text-sm text-red-500">
                    {highQualityError}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </main>
    </div>
  );
}

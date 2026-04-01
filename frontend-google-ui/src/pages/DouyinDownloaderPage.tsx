import { useState } from "react";
import { ArrowLeft, Download, Loader2, LogOut, Link2, BadgeInfo } from "lucide-react";
import { motion } from "motion/react";
import { Button } from "@/src/components/ui/button";
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
    <div className="min-h-screen bg-background px-6 py-8 md:px-8">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-4">
          <Button
            variant="outline"
            onClick={onBack}
            className="glass-card border-white/40 text-slate-600 hover:text-slate-900 rounded-2xl px-5 h-11 gap-2"
          >
            <ArrowLeft className="size-4" />
            返回工作台
          </Button>

          <Button
            variant="outline"
            size="sm"
            onClick={onLogout}
            className="glass-card border-white/40 text-slate-500 hover:text-red-500 hover:border-red-200 transition-all gap-2 rounded-2xl px-5 h-10 shadow-glass"
          >
            <LogOut className="size-4" />
            <span className="text-xs font-bold uppercase tracking-wider">退出登录</span>
          </Button>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          className="glass-card rounded-[2rem] border-white/80 p-8 md:p-10"
        >
          <div className="flex flex-col gap-6 lg:flex-row lg:items-start lg:justify-between">
            <div className="max-w-2xl">
              <div className="mb-5 inline-flex size-14 items-center justify-center rounded-2xl bg-sky-500 text-white shadow-lg shadow-sky-200">
                <Download className="size-7" />
              </div>
              <h1 className="text-4xl font-black tracking-tight text-slate-900 md:text-5xl">抖音视频解析下载</h1>
              <p className="mt-4 text-base font-medium leading-7 text-slate-500">
                支持网页直链、App 分享短链接，以及带中文描述的整段分享文本。系统会优先走更稳定的分享链路解析，失败时再自动跟随短链并提取作品 ID 兜底。
              </p>
            </div>

            <div className="rounded-[1.75rem] border border-white/70 bg-white/55 px-5 py-4 text-sm text-slate-500 shadow-inner">
              <div className="flex items-center gap-2 font-bold text-slate-700">
                <BadgeInfo className="size-4 text-sky-500" />
                支持输入
              </div>
              <p className="mt-2 leading-6">网页链接</p>
              <p className="leading-6">短链接分享文案</p>
              <p className="leading-6">链接前后混合中文描述</p>
            </div>
          </div>

          <div className="mt-8 grid gap-6 lg:grid-cols-[1.25fr_0.95fr]">
            <div className="rounded-[1.75rem] border border-white/70 bg-white/55 p-5 shadow-inner">
              <label className="mb-3 block text-sm font-bold uppercase tracking-[0.2em] text-slate-400">
                粘贴分享内容
              </label>
              <textarea
                value={input}
                onChange={(event) => setInput(event.target.value)}
                placeholder="支持直接粘贴抖音网页链接，或整段手机分享文案。"
                className="min-h-56 w-full resize-y rounded-[1.5rem] border border-white/70 bg-white/80 px-5 py-4 text-sm leading-7 text-slate-700 outline-none transition focus:border-sky-300 focus:ring-2 focus:ring-sky-200"
              />
              <div className="mt-3 rounded-2xl bg-slate-50/80 px-4 py-3 text-xs leading-6 text-slate-500">
                示例：{SAMPLE_SHARE_TEXT}
              </div>
              <div className="mt-5 flex flex-wrap gap-3">
                <Button
                  onClick={handleSubmit}
                  disabled={isLoading}
                  className="h-11 rounded-2xl bg-sky-600 px-6 text-sm font-bold text-white shadow-lg shadow-sky-200 hover:bg-sky-500"
                >
                  {isLoading ? (
                    <>
                      <Loader2 className="mr-2 size-4 animate-spin" />
                      解析中...
                    </>
                  ) : (
                    '解析并下载视频'
                  )}
                </Button>
                <Button
                  variant="outline"
                      onClick={() => {
                        setInput('');
                        setError('');
                        setResult(null);
                        setHighQualityResult(null);
                        setHighQualityError('');
                      }}
                  disabled={isLoading}
                  className="h-11 rounded-2xl border-white/60 bg-white/60 px-5 text-slate-600"
                >
                  清空
                </Button>
              </div>
            </div>

            <div className="rounded-[1.75rem] border border-white/70 bg-white/55 p-5 shadow-inner">
              <div className="mb-3 text-sm font-bold uppercase tracking-[0.2em] text-slate-400">解析结果</div>

              {!result && !error && (
                <div className="flex min-h-56 flex-col justify-center rounded-[1.5rem] border border-dashed border-slate-200 bg-white/70 px-5 text-sm leading-7 text-slate-500">
                  <p>解析成功后，这里会显示视频 ID、归一化链接和下载入口。</p>
                  <p className="mt-2">默认优先返回更稳定的标准无水印下载链路，如需更高画质可再单独尝试高级功能。</p>
                </div>
              )}

              {error && (
                <div className="rounded-[1.5rem] border border-red-100 bg-red-50/80 px-5 py-4 text-sm leading-7 text-red-600">
                  {error}
                </div>
              )}

              {result && (
                <div className="space-y-4">
                  <div className="rounded-[1.5rem] border border-emerald-100 bg-emerald-50/80 px-5 py-4 text-sm leading-7 text-emerald-700">
                    解析成功，已经拿到更稳定的标准下载链接。
                  </div>

                  <div className="rounded-[1.5rem] bg-white/80 px-5 py-4 text-sm text-slate-700">
                    <div className="font-semibold text-slate-500">videoId</div>
                    <div className="mt-1 break-all font-mono text-slate-900">{result.videoId}</div>
                  </div>

                  {result.normalizedUrl && (
                    <div className="rounded-[1.5rem] bg-white/80 px-5 py-4 text-sm text-slate-700">
                      <div className="flex items-center gap-2 font-semibold text-slate-500">
                        <Link2 className="size-4" />
                        normalizedUrl
                      </div>
                      <a
                        href={result.normalizedUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="mt-1 block break-all text-sky-600 hover:text-sky-500"
                      >
                        {result.normalizedUrl}
                      </a>
                    </div>
                  )}

                  <div className="rounded-[1.5rem] bg-white/80 px-5 py-4 text-sm text-slate-700">
                    <div className="font-semibold text-slate-500">sourceType</div>
                    <div className="mt-1">
                      {result.sourceType === 'web_url' ? '网页直链' : '分享文本 / 短链接'}
                    </div>
                  </div>

                  <Button asChild className="h-11 w-full rounded-2xl bg-sky-600 text-sm font-bold text-white shadow-lg shadow-sky-200 hover:bg-sky-500">
                    <a href={result.downloadUrl} target="_blank" rel="noreferrer">
                      <Download className="mr-2 size-4" />
                      下载视频
                    </a>
                  </Button>

                  <div className="rounded-[1.5rem] border border-white/70 bg-white/75 px-5 py-4 text-sm text-slate-600">
                    <div className="font-semibold text-slate-700">高级选项</div>
                    <p className="mt-2 leading-6">如果你愿意为了画质额外尝试一次，可以再请求最高画质链路；这一步不影响默认稳定下载。</p>

                    <div className="mt-4 flex flex-wrap gap-3">
                      <Button
                        variant="outline"
                        onClick={handleHighQualityResolve}
                        disabled={isHighQualityLoading}
                        className="h-11 rounded-2xl border-white/60 bg-white/70 px-5 text-slate-700"
                      >
                        {isHighQualityLoading ? (
                          <>
                            <Loader2 className="mr-2 size-4 animate-spin" />
                            获取最高画质中...
                          </>
                        ) : (
                          '尝试获取最高画质'
                        )}
                      </Button>

                      {highQualityResult && (
                        <Button asChild variant="outline" className="h-11 rounded-2xl border-sky-200 bg-sky-50 px-5 text-sky-700 hover:bg-sky-100">
                          <a href={highQualityResult.downloadUrl} target="_blank" rel="noreferrer">
                            <Download className="mr-2 size-4" />
                            下载最高画质视频
                          </a>
                        </Button>
                      )}
                    </div>

                    {highQualityError && (
                      <div className="mt-4 rounded-2xl border border-amber-100 bg-amber-50 px-4 py-3 leading-6 text-amber-700">
                        最高画质为高级备选功能，本次获取失败：{highQualityError}
                      </div>
                    )}
                  </div>
                </div>
              )}
            </div>
          </div>
        </motion.div>
      </div>
    </div>
  );
}

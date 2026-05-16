import { useState } from "react";
import {
  ArrowLeft,
  Loader2,
  Link2,
  Globe,
  Download,
  Copy,
  CheckCircle2,
  Play,
  Image as ImageIcon,
  FileText,
  Tag,
  User,
  LogOut,
  AlertCircle,
  Sparkles,
  ChevronDown,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ModuleQuickNav from "@/src/components/ModuleQuickNav";
import SiteFooter from "@/src/components/SiteFooter";

interface UniversalExtractorPageProps {
  onBack: () => void;
  onNavigate: (page: 'voice' | 'creative' | 'douyin' | 'collection' | 'image' | 'topmodel' | 'universal') => void;
  onLogout: () => void;
}

const PLATFORMS = [
  "抖音", "TikTok", "快手", "B站", "小红书",
  "Instagram", "YouTube", "Twitter/X", "Threads",
  "微博", "知乎", "皮皮虾", "Lemon8", "Reddit", "公众号",
];

export default function UniversalExtractorPage({ onBack, onNavigate, onLogout }: UniversalExtractorPageProps) {
  const [url, setUrl] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<any>(null);
  const [copiedField, setCopiedField] = useState('');
  const [showImages, setShowImages] = useState(false);
  const [transcriptLoading, setTranscriptLoading] = useState(false);
  const [transcriptText, setTranscriptText] = useState('');
  const [transcriptError, setTranscriptError] = useState('');
  const [transcriptSegments, setTranscriptSegments] = useState(0);
  const [asrEngine, setAsrEngine] = useState<'qwen' | 'siliconflow'>('qwen');

  async function handleExtract() {
    const trimmed = url.trim();
    if (!trimmed) return;
    setLoading(true);
    setError('');
    setResult(null);
    setShowImages(false);
    resetTranscript();
    try {
      const res = await fetch('/api/extract/universal', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ url: trimmed }),
      });
      const json = await res.json();
      if (!json.ok) {
        throw new Error(json.message || '解析失败');
      }
      setResult(json.data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '请求失败');
    } finally {
      setLoading(false);
    }
  }

  function handleCopy(text: string, field: string) {
    navigator.clipboard.writeText(text).then(() => {
      setCopiedField(field);
      setTimeout(() => setCopiedField(''), 1500);
    });
  }

  function handleClear() {
    setUrl('');
    setError('');
    setResult(null);
    setCopiedField('');
    setShowImages(false);
    resetTranscript();
  }

  const title = extractTitle(result);
  const author = extractAuthor(result);
  const videoUrls = extractVideoUrls(result);
  const primaryProxyVideoUrl = videoUrls[0] ? buildProxyDownloadUrl(videoUrls[0]) : '';
  const images = extractImages(result);
  const tags = extractTags(result);

  function resetTranscript() {
    setTranscriptLoading(false);
    setTranscriptText('');
    setTranscriptError('');
    setTranscriptSegments(0);
  }

  async function handleExtractTranscript() {
    const primaryVideoUrl = videoUrls[0] || '';
    if (!primaryVideoUrl) {
      setTranscriptError('请先解析到可用视频后再提取逐字稿。');
      return;
    }

    setTranscriptLoading(true);
    setTranscriptText('');
    setTranscriptError('');
    setTranscriptSegments(0);

    try {
      const candidates = Array.isArray(result?.videoUrlCandidates) && result.videoUrlCandidates.length
        ? result.videoUrlCandidates
        : videoUrls.map((videoUrl) => ({ url: videoUrl }));
      const res = await fetch('/api/extract/universal-transcript', {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          videoUrl: primaryVideoUrl,
          videoUrlCandidates: candidates,
          title,
          platform: result?.platform || '',
          asrEngine,
        }),
      });
      const json = await res.json();
      if (!res.ok || !json.ok) {
        throw new Error(json.error || json.message || '逐字稿提取失败');
      }
      if (!json.transcriptOk) {
        throw new Error(json.transcriptError || '逐字稿提取失败');
      }
      setTranscriptText(typeof json.transcript === 'string' ? json.transcript : '');
      setTranscriptSegments(Number(json.transcriptSegments || 0));
    } catch (e) {
      setTranscriptError(e instanceof Error ? e.message : '逐字稿提取失败');
    } finally {
      setTranscriptLoading(false);
    }
  }

  return (
    <div className="min-h-screen bg-[#F3F5F9] flex flex-col">
      <header className="sticky top-0 z-50 glass-card border-b border-white/60 shadow-sm">
        <div className="mx-auto flex h-16 max-w-3xl items-center justify-between px-4">
          <button
            onClick={onBack}
            className="flex items-center gap-2 h-9 rounded-full px-4 text-xs font-bold text-slate-600 bg-white/60 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300"
          >
            <ArrowLeft className="size-3.5" />
            返回
          </button>
          <ModuleQuickNav current="douyin" onNavigate={onNavigate} />
          <button
            onClick={onLogout}
            className="flex items-center gap-2 h-9 rounded-full px-4 text-xs font-bold text-slate-600 bg-white/60 hover:bg-white border border-slate-200/80 shadow-sm hover:shadow-md transition-all duration-300"
          >
            <LogOut className="size-3.5" />
            退出登录
          </button>
        </div>
      </header>

      <main className="flex-1 max-w-3xl mx-auto w-full p-6 space-y-4 pb-24">
        {/* Title */}
        <motion.section
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4 }}
          className="glass-card rounded-3xl border-white/80 p-6 shadow-glass"
        >
          <div className="flex items-center gap-4">
            <div className="inline-flex size-11 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-indigo-600 to-violet-600 text-white shadow-lg shadow-indigo-900/20">
              <Globe className="size-5" />
            </div>
            <div>
              <h1 className="text-xl font-black tracking-tight text-slate-900">全网全平台解析</h1>
              <p className="text-xs text-slate-500 mt-0.5 font-medium">粘贴任意平台作品链接，一键提取视频、图片和逐字稿</p>
            </div>
          </div>

          {/* Platform tags */}
          <div className="mt-4 flex flex-wrap gap-1.5">
            {PLATFORMS.map((p) => (
              <span key={p} className="rounded-md border border-slate-200 bg-white/50 px-2 py-0.5 text-[10px] font-bold text-slate-400">
                {p}
              </span>
            ))}
          </div>
        </motion.section>

        {/* Input */}
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.4, delay: 0.1 }}
          className="glass-card rounded-3xl border-white/80 p-5 shadow-glass"
        >
          <div className="flex items-center gap-3">
            <div className="flex-1 relative">
              <Link2 className="absolute left-3.5 top-1/2 -translate-y-1/2 size-4 text-slate-400" />
              <input
                type="text"
                value={url}
                onChange={(e) => setUrl(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleExtract()}
                placeholder="粘贴作品链接，如抖音、TikTok、小红书、B站、YouTube..."
                className="w-full h-11 pl-10 pr-4 rounded-xl border border-slate-200 bg-white/70 text-sm font-medium text-slate-700 placeholder:text-slate-400 focus:outline-none focus:ring-2 focus:ring-indigo-300 focus:border-indigo-300 transition-all"
              />
            </div>
            <button
              onClick={handleExtract}
              disabled={loading || !url.trim()}
              className="flex items-center gap-1.5 h-11 rounded-xl px-5 text-sm font-bold text-white bg-gradient-to-r from-indigo-500 to-violet-500 hover:from-indigo-600 hover:to-violet-600 disabled:opacity-50 disabled:cursor-not-allowed shadow-md shadow-indigo-200 transition-all"
            >
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
              {loading ? '解析中' : '提取'}
            </button>
            <button
              onClick={handleClear}
              disabled={loading || (!url && !result && !error)}
              className="inline-flex h-11 shrink-0 items-center justify-center rounded-xl border border-slate-200 bg-white/70 px-4 text-sm font-bold text-slate-500 shadow-sm transition-all hover:border-slate-300 hover:bg-white hover:text-slate-700 disabled:cursor-not-allowed disabled:opacity-45"
              aria-label="清空输入"
              title="清空输入"
            >
              清空
            </button>
          </div>

          <AnimatePresence>
            {error && (
              <motion.div
                initial={{ opacity: 0, height: 0 }}
                animate={{ opacity: 1, height: 'auto' }}
                exit={{ opacity: 0, height: 0 }}
                className="mt-3 flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-4 py-2.5 text-xs font-bold text-red-600"
              >
                <AlertCircle className="size-4 shrink-0" />
                {error}
              </motion.div>
            )}
          </AnimatePresence>
        </motion.div>

        {/* Result */}
        <AnimatePresence>
          {result && (
            <motion.div
              initial={{ opacity: 0, y: 20 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 20 }}
              transition={{ duration: 0.4 }}
              className="glass-card rounded-3xl border-white/80 p-5 shadow-glass space-y-4"
            >
              {/* Title */}
              {title && (
                <div className="flex items-start gap-2">
                  <FileText className="size-4 text-indigo-500 mt-0.5 shrink-0" />
                  <div className="flex-1">
                    <p className="text-xs font-bold text-slate-400 mb-0.5">标题</p>
                    <p className="text-sm font-bold text-slate-800 leading-relaxed">{title}</p>
                  </div>
                  <button
                    onClick={() => handleCopy(title, 'title')}
                    className="shrink-0 rounded-lg p-1.5 text-slate-400 hover:text-indigo-500 hover:bg-indigo-50 transition-all"
                  >
                    {copiedField === 'title' ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                  </button>
                </div>
              )}

              {/* Author */}
              {author && (
                <div className="flex items-center gap-2">
                  <User className="size-4 text-indigo-500 shrink-0" />
                  <p className="text-xs font-bold text-slate-500">{author}</p>
                </div>
              )}

              {/* Tags */}
              {tags.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  <Tag className="size-4 text-indigo-500 shrink-0 mt-0.5" />
                  {tags.map((t: string, i: number) => (
                    <span key={i} className="rounded-full border border-indigo-100 bg-indigo-50 px-2.5 py-0.5 text-[10px] font-bold text-indigo-600">
                      {t}
                    </span>
                  ))}
                </div>
              )}

              {/* Video */}
              {videoUrls.length > 0 && (
                <div className="space-y-2">
                  <div className="flex items-center gap-2">
                    <Play className="size-4 text-indigo-500" />
                    <p className="text-xs font-bold text-slate-400">视频 ({videoUrls.length}个候选源)</p>
                  </div>
                  <video
                    src={primaryProxyVideoUrl}
                    controls
                    className="w-full max-w-lg max-h-80 mx-auto rounded-xl border border-slate-200 bg-slate-900 shadow-sm object-contain"
                    playsInline
                    preload="metadata"
                  />
                  <div className="flex flex-wrap gap-2">
                    <a
                      href={videoUrls[0]}
                      target="_blank"
                      rel="noopener noreferrer"
                      download
                      className="inline-flex items-center gap-1.5 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-1.5 text-[11px] font-bold text-emerald-700 hover:border-emerald-300 hover:bg-emerald-100 transition-all"
                    >
                      <Download className="size-3" />
                      高速下载
                    </a>
                    <a
                      href={primaryProxyVideoUrl}
                      download
                      className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-all"
                    >
                      <Download className="size-3" />
                      代理下载
                    </a>
                    {videoUrls.slice(1).map((vurl, i) => (
                      <a
                        key={vurl}
                        href={vurl}
                        target="_blank"
                        rel="noopener noreferrer"
                        download
                        className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-3 py-1.5 text-[11px] font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-all"
                      >
                        <Download className="size-3" />
                        {`备用直链 ${i + 2}`}
                      </a>
                    ))}
                  </div>
                </div>
              )}

              {/* Images */}
              {images.length > 0 && (
                <div className="space-y-2">
                  <button
                    type="button"
                    onClick={() => setShowImages((value) => !value)}
                    className="flex w-full items-center justify-between rounded-xl border border-slate-200 bg-white/60 px-3.5 py-2.5 text-left transition-all hover:border-indigo-200 hover:bg-indigo-50/50"
                  >
                    <span className="flex items-center gap-2">
                      <ImageIcon className="size-4 text-indigo-500" />
                      <span className="text-xs font-bold text-slate-500">图片 ({images.length}张)</span>
                    </span>
                    <ChevronDown className={`size-4 text-slate-400 transition-transform ${showImages ? 'rotate-180' : ''}`} />
                  </button>
                  {showImages && (
                    <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                      {images.map((img: string, i: number) => (
                        <a key={i} href={img} target="_blank" rel="noopener noreferrer" className="group relative aspect-square rounded-xl overflow-hidden border border-slate-200 bg-slate-100">
                          <img src={img} alt={`图片${i + 1}`} className="w-full h-full object-cover group-hover:scale-105 transition-transform" loading="lazy" />
                          <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-all" />
                        </a>
                      ))}
                    </div>
                  )}
                </div>
              )}

              {/* Transcript */}
              {videoUrls.length > 0 && (
                <div className="space-y-3 rounded-2xl border border-indigo-100 bg-gradient-to-br from-white/80 to-indigo-50/70 p-4">
                  <div className="flex flex-wrap items-start justify-between gap-3">
                    <div className="flex items-start gap-2">
                      <FileText className="size-4 text-indigo-500 mt-0.5 shrink-0" />
                      <div>
                        <p className="text-xs font-bold text-slate-400">提取视频逐字稿</p>
                        <p className="mt-1 text-xs font-medium text-slate-500">
                          使用{asrEngine === 'qwen' ? '千问 ASR' : 'SenseVoice（免费）'}，把当前视频音频转成可复制文字。
                        </p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2">
                      <div className="flex items-center gap-1 rounded-lg bg-slate-100 p-0.5">
                        <button
                          onClick={() => setAsrEngine('qwen')}
                          className={`h-7 rounded-md px-2.5 text-[10px] font-bold transition-all ${
                            asrEngine === 'qwen'
                              ? 'bg-white text-blue-600 shadow-sm'
                              : 'text-slate-400 hover:text-slate-600'
                          }`}
                        >
                          千问 ASR
                        </button>
                        <button
                          onClick={() => setAsrEngine('siliconflow')}
                          className={`h-7 rounded-md px-2.5 text-[10px] font-bold transition-all ${
                            asrEngine === 'siliconflow'
                              ? 'bg-white text-slate-700 shadow-sm'
                              : 'text-slate-400 hover:text-slate-600'
                          }`}
                        >
                          SenseVoice
                        </button>
                      </div>
                      <button
                        onClick={handleExtractTranscript}
                        disabled={transcriptLoading}
                        className="inline-flex h-9 items-center gap-1.5 rounded-xl bg-slate-900 px-3.5 text-xs font-bold text-white shadow-md shadow-slate-200 transition-all hover:bg-indigo-600 disabled:cursor-not-allowed disabled:opacity-60"
                      >
                        {transcriptLoading ? <Loader2 className="size-3.5 animate-spin" /> : <Sparkles className="size-3.5" />}
                        {transcriptLoading ? '提取中' : '提取逐字稿'}
                      </button>
                    </div>
                  </div>

                  {transcriptLoading && (
                    <div className="rounded-xl border border-indigo-100 bg-white/70 px-3.5 py-3 text-xs font-bold text-indigo-600">
                      正在下载视频、提取音频并调用{asrEngine === 'qwen' ? '千问 ASR' : 'SenseVoice'}，稍等一下就好。
                    </div>
                  )}

                  {transcriptError && (
                    <div className="flex items-center gap-2 rounded-xl border border-red-100 bg-red-50 px-3.5 py-3 text-xs font-bold text-red-600">
                      <AlertCircle className="size-4 shrink-0" />
                      {transcriptError}
                    </div>
                  )}

                  {transcriptText && (
                    <div className="space-y-2">
                      <div className="flex items-center justify-between">
                        <span className="text-[11px] font-bold text-emerald-600">
                          逐字稿提取成功{transcriptSegments ? ` · ${transcriptSegments} 段音频` : ''}
                        </span>
                        <button
                          onClick={() => handleCopy(transcriptText, 'transcript')}
                          className="inline-flex items-center gap-1.5 rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-bold text-slate-600 hover:border-indigo-300 hover:text-indigo-600 transition-all"
                        >
                          {copiedField === 'transcript' ? <CheckCircle2 className="size-3.5 text-emerald-500" /> : <Copy className="size-3.5" />}
                          {copiedField === 'transcript' ? '已复制' : '复制逐字稿'}
                        </button>
                      </div>
                      <div className="max-h-80 overflow-y-auto whitespace-pre-wrap rounded-xl border border-slate-200 bg-white/70 p-3.5 text-sm leading-relaxed text-slate-700">
                        {transcriptText}
                      </div>
                    </div>
                  )}
                </div>
              )}

            </motion.div>
          )}
        </AnimatePresence>
      </main>

      <SiteFooter />
    </div>
  );
}

function buildProxyDownloadUrl(url: string): string {
  return `/api/proxy/download?url=${encodeURIComponent(url)}`;
}

/* ------------------------------------------------------------------ */
/*  Data extractors — TikHub returns different shapes per platform    */
/*  Ported from CopyPilot with deep-search helpers                     */
/* ------------------------------------------------------------------ */

function findPrimaryDetail(data: any): any {
  if (!data || typeof data !== 'object') return null;
  if (data.raw && typeof data.raw === 'object') {
    return findPrimaryDetail(data.raw);
  }
  return (
    data.noteCard ||
    data.note ||
    data.article ||
    data.mp_article ||
    data.aweme_detail ||
    data.itemInfo?.itemStruct ||
    data.data?.items?.[0]?.noteCard ||
    data.items?.[0]?.noteCard ||
    data.data?.article ||
    data.data?.mp_article ||
    data.data?.noteCard ||
    data.data?.note ||
    data.data ||
    data
  );
}

function extractTitle(data: any): string {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.title === 'string' && data.title.trim()) return cleanTitle(data.title);
  const detail = findPrimaryDetail(data);
  const raw =
    detail?.title ||
    detail?.msg_title ||
    detail?.appmsg_title ||
    detail?.article_title ||
    detail?.note?.title ||
    detail?.aweme_detail?.desc ||
    detail?.itemInfo?.itemStruct?.desc ||
    detail?.aweme_detail?.share_info?.share_title ||
    detail?.itemInfo?.itemStruct?.share_info?.share_title ||
    data.title ||
    data.desc ||
    '';
  return cleanTitle(raw);
}

function extractAuthor(data: any): string {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.authorName === 'string' && data.authorName.trim()) {
    const platformName = detectPlatform(data);
    return platformName ? `${data.authorName} · ${platformName}` : data.authorName;
  }
  const detail = findPrimaryDetail(data);
  const author =
    detail?.author?.nickname ||
    detail?.author?.unique_id ||
    detail?.author?.name ||
    detail?.note?.user?.nickname ||
    detail?.user?.name ||
    detail?.user?.screen_name ||
    detail?.owner?.nickname ||
    detail?.channel?.name ||
    data.author?.nickname ||
    data.user?.name ||
    '';
  const platform = detectPlatform(data);
  if (author && platform) return `${author} · ${platform}`;
  return author || platform || '';
}

function extractDesc(data: any): string {
  if (!data || typeof data !== 'object') return '';
  if (typeof data.desc === 'string' && data.desc.trim()) return stripHtml(data.desc);
  const detail = findPrimaryDetail(data);
  const text =
    detail?.transcript ||
    detail?.text ||
    detail?.description ||
    detail?.desc ||
    detail?.caption ||
    detail?.content ||
    detail?.article?.content ||
    detail?.note?.desc ||
    data.text ||
    data.desc ||
    data.caption ||
    '';
  return stripHtml(text);
}

function extractVideoUrls(data: any): string[] {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.videoUrls) && data.videoUrls.length) {
    const urls = data.videoUrls
      .map((u: unknown) => String(u || '').trim())
      .filter((u: string) => u.startsWith('http'));
    return Array.from(new Set<string>(urls)).slice(0, 8);
  }
  if (Array.isArray(data.videoUrlCandidates) && data.videoUrlCandidates.length) {
    const urls = data.videoUrlCandidates
      .map((item: any) => String(item?.url || '').trim())
      .filter((u: string) => u.startsWith('http'));
    return Array.from(new Set<string>(urls)).slice(0, 8);
  }
  const detail = findPrimaryDetail(data);

  // Phase 1: structured extraction from known fields
  const structured: string[] = [];
  const video = detail?.video || data.video || {};
  if (video.play_addr?.url_list?.length) structured.push(...video.play_addr.url_list);
  if (video.download_addr?.url_list?.length) structured.push(...video.download_addr.url_list);
  if (detail?.video_url) structured.push(detail.video_url);
  if (data.video_url) structured.push(data.video_url);
  if (data.videos?.items?.length) {
    const sorted = [...data.videos.items].sort((a, b) => Number(b.hasAudio) - Number(a.hasAudio));
    structured.push(...sorted.map((item: any) => item.url).filter(Boolean));
  }

  // Phase 2: deep search fallback
  const deep = findVideoUrlsDeep(detail || data);

  // Combine, normalize, dedupe
  const all = [...structured, ...deep]
    .map((u) => (typeof u === 'string' ? u.trim() : ''))
    .filter((u) => u.startsWith('http'));

  // Prefer URLs that look like real video files
  const scored = all.map((u) => ({
    url: u,
    score: scoreVideoUrl(u),
  }));
  scored.sort((a, b) => b.score - a.score);

  return [...new Set(scored.map((s) => s.url))].slice(0, 8);
}

function scoreVideoUrl(url: string): number {
  const u = url.toLowerCase();
  let score = 0;
  if (/\.(mp4|webm|mov)(?:[?#]|$)/.test(u)) score += 10;
  if (/video\/tos|douyinvod|googlevideo\.com\/videoplayback|mime=video/.test(u)) score += 8;
  if (/tiktokcdn|tiktokv/.test(u)) score += 5;
  if (/kuaishou|yximgs/.test(u)) score += 5;
  if (/bilibili|hdslb/.test(u)) score += 5;
  if (/youtube|googlevideo/.test(u)) score += 5;
  // Penalize share pages
  if (/share\/video|iesdouyin\.com\/share/.test(u)) score -= 5;
  if (u.includes('?')) score += 1; // params often indicate direct link
  return score;
}

function extractImages(data: any): string[] {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.images) && data.images.length) {
    const urls = data.images
      .map((u: unknown) => String(u || '').trim())
      .filter((u: string) => u.startsWith('http'));
    return Array.from(new Set<string>(urls)).slice(0, 20);
  }
  const detail = findPrimaryDetail(data);
  const urls = findImageUrlsDeep(detail || data);
  return urls;
}

function extractTags(data: any): string[] {
  if (!data || typeof data !== 'object') return [];
  if (Array.isArray(data.tags) && data.tags.length) {
    return Array.from(new Set(data.tags.map((t: unknown) => String(t || '').replace(/^#/, '').trim()).filter(Boolean)));
  }
  const detail = findPrimaryDetail(data) || {};
  const allTags: string[] = [];

  const collect = (arr: any[]) => {
    if (!Array.isArray(arr)) return;
    for (const item of arr) {
      if (typeof item === 'string') allTags.push(item);
      else if (item?.name) allTags.push(item.name);
      else if (item?.title) allTags.push(item.title);
      else if (item?.hashtag_name) allTags.push(item.hashtag_name);
    }
  };

  collect(detail.tagList);
  collect(detail.tags);
  collect(detail.hashtags);
  collect(data.tags);
  collect(data.hashtags);
  collect(data.keywords);

  // Also extract from text
  const text = `${extractDesc(data)} ${detail?.desc || ''}`;
  const matches = text.match(/#[^\s#，,。；;]+/g);
  if (matches) allTags.push(...matches);

  return Array.from(new Set(allTags.map((t) => t.replace(/^#/, '').replace(/\[话题\]$/g, '').trim()).filter(Boolean)));
}

function detectPlatform(data: any): string {
  if (!data || typeof data !== 'object') return '';
  if (data.platform) {
    const map: Record<string, string> = {
      douyin: '抖音',
      kuaishou: '快手',
      xiaohongshu: '小红书',
      tiktok: 'TikTok',
      bilibili: 'B站',
      youtube: 'YouTube',
      instagram: 'Instagram',
      weibo: '微博',
      zhihu: '知乎',
      wechat: '公众号',
    };
    return map[String(data.platform)] || String(data.platform);
  }
  if (data.raw && typeof data.raw === 'object') return detectPlatform(data.raw);
  if (data.aweme_detail || data.aweme_id) return '抖音';
  if (data.itemInfo?.itemStruct?.video || data.itemInfo?.itemStruct?.share_info) return 'TikTok';
  if (data.note || data.noteCard) return '小红书';
  if (data.bvid || data.aid) return 'B站';
  if (data.channel?.id) return 'YouTube';
  if (data.user?.screen_name) return '微博';
  if (data.article || data.mp_article) return '公众号';
  if (data.kuaishou_id || data.ks_user_id) return '快手';
  return '';
}

/* ------------------------------------------------------------------ */
/*  Deep-search helpers                                               */
/* ------------------------------------------------------------------ */

function findVideoUrlsDeep(input: any): string[] {
  const urls: string[] = [];
  const seen = new Set();
  const queue = [input];

  while (queue.length) {
    const item = queue.shift();
    if (!item || seen.has(item)) continue;

    if (typeof item === 'string') {
      if (looksLikeVideoUrl(item)) urls.push(item);
      continue;
    }
    if (typeof item !== 'object') continue;
    seen.add(item);

    // Collect any field that looks like a video URL regardless of type metadata
    const candidates = [
      item.url, item.src, item.video_url, item.play_url, item.download_url,
      item.hd_url, item.sd_url, item.origin_url, item.main_url, item.backup_url,
    ];
    for (const u of candidates) {
      if (typeof u === 'string' && u.startsWith('http') && looksLikeVideoUrl(u)) {
        urls.push(u);
      }
    }

    for (const value of Object.values(item)) {
      queue.push(value);
    }
  }

  return [...new Set(urls)].slice(0, 20);
}

function findImageUrlsDeep(input: any): string[] {
  const urls: string[] = [];
  const seen = new Set();
  const queue = [input];

  while (queue.length) {
    const item = queue.shift();
    if (!item || seen.has(item)) continue;

    if (typeof item === 'string') {
      if (looksLikeImageUrl(item)) urls.push(item);
      continue;
    }
    if (typeof item !== 'object') continue;
    seen.add(item);

    // Direct image fields
    if (item.url && looksLikeImageUrl(item.url)) urls.push(item.url);
    if (item.image_url && looksLikeImageUrl(item.image_url)) urls.push(item.image_url);
    if (item.src && looksLikeImageUrl(item.src)) urls.push(item.src);

    // url_list arrays
    if (Array.isArray(item.url_list)) {
      for (const u of item.url_list) {
        if (typeof u === 'string' && looksLikeImageUrl(u)) urls.push(u);
      }
    }

    for (const value of Object.values(item)) {
      queue.push(value);
    }
  }

  return [...new Set(urls)].slice(0, 20);
}

function looksLikeVideoUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;
  const u = url.toLowerCase();
  // File extensions
  if (/\.(mp4|webm|mov|m3u8|mpd)(?:[?#]|$)/.test(u)) return true;
  // CDN / platform patterns
  if (/video\/tos|douyinvod|googlevideo\.com\/videoplayback|mime=video/.test(u)) return true;
  if (/tiktokcdn|tiktokv/.test(u)) return true;
  if (/kuaishou|yximgs|ksosvideo/.test(u)) return true;
  if (/bilibili|hdslb/.test(u)) return true;
  if (/youtube|googlevideo/.test(u)) return true;
  if (/xhscdn/.test(u)) return true;
  return false;
}

function looksLikeImageUrl(url: string): boolean {
  if (typeof url !== 'string') return false;
  if (!url.startsWith('http')) return false;
  return /\.(jpg|jpeg|png|webp|gif|bmp)(?:[?#]|$)/i.test(url) || url.includes('/image/') || url.includes('/img/');
}

function cleanTitle(value: string): string {
  const text = String(value || '').trim();
  if (!text) return '';
  return text
    .split(/[#\n\r]/)[0]
    .replace(/^[\s""''']+|[\s""''']+$/g, '')
    .replace(/[，,。；;！!？?]$/, '')
    .slice(0, 100);
}

function stripHtml(html: string): string {
  if (!html) return '';
  if (typeof html !== 'string') return String(html);
  const tmp = document.createElement('div');
  tmp.innerHTML = html;
  return tmp.textContent || tmp.innerText || '';
}

import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  Database,
  Loader2,
  Plus,
  Trash2,
  RefreshCw,
  Filter,
  ExternalLink,
  Eye,
  Clock,
  Heart,
  BookOpen,
  User,
  Tag,
  CheckCircle2,
  AlertCircle,
  X,
} from "lucide-react";
import { motion, AnimatePresence } from "motion/react";
import ModuleQuickNav from "@/src/components/ModuleQuickNav";
import SiteFooter from "@/src/components/SiteFooter";
import { Button } from "@/src/components/ui/button";
import { Input } from "@/src/components/ui/input";
import { Label } from "@/src/components/ui/label";
import { Checkbox } from "@/src/components/ui/checkbox";
import { cn } from "@/src/lib/utils";
import {
  type MonitoredKeyword,
  type CollectedArticle,
  type FetchResult,
  getKeywords,
  createKeyword,
  deleteKeyword,
  fetchKeywordData,
  getArticles,
  getCollectionConfigStatus,
} from "@/src/lib/collection";

interface DataCollectionPageProps {
  onBack: () => void;
  onNavigate: (page: 'voice' | 'creative' | 'douyin' | 'collection' | 'image' | 'topmodel' | 'feeding') => void;
}

type Tab = 'monitor' | 'library';
type Platform = 'wechat' | 'xhs' | 'douyin';

const PLATFORM_META: Record<Platform, { label: string; color: string; bg: string }> = {
  wechat: { label: '公众号', color: 'text-emerald-600', bg: 'bg-emerald-50' },
  xhs: { label: '小红书', color: 'text-rose-600', bg: 'bg-rose-50' },
  douyin: { label: '抖音', color: 'text-sky-600', bg: 'bg-sky-50' },
};

export default function DataCollectionPage({ onBack, onNavigate }: DataCollectionPageProps) {
  const [activeTab, setActiveTab] = useState<Tab>('monitor');
  const [keywords, setKeywords] = useState<MonitoredKeyword[]>([]);
  const [articles, setArticles] = useState<CollectedArticle[]>([]);
  const [articlesTotal, setArticlesTotal] = useState(0);
  const [isLoadingKeywords, setIsLoadingKeywords] = useState(false);
  const [isLoadingArticles, setIsLoadingArticles] = useState(false);
  const [isAdding, setIsAdding] = useState(false);
  const [newKeyword, setNewKeyword] = useState('');
  const [selectedPlatforms, setSelectedPlatforms] = useState<Platform[]>(['wechat']);
  const [fetchingKeywordId, setFetchingKeywordId] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [configStatus, setConfigStatus] = useState<{ reachable: boolean; wechatApiToken: boolean; douyinApiToken: boolean } | null>(null);
  const [articleFilterKeywordId, setArticleFilterKeywordId] = useState<number | null>(null);
  const [articleFilterPlatform, setArticleFilterPlatform] = useState<string>('');
  const [articlePage, setArticlePage] = useState(0);
  const [fetchResult, setFetchResult] = useState<{ keywordId: number; result: FetchResult; errors: Record<string, string> } | null>(null);

  const ARTICLES_PER_PAGE = 20;

  useEffect(() => {
    let cancelled = false;
    async function loadConfig() {
      const status = await getCollectionConfigStatus();
      if (!cancelled) setConfigStatus(status);
    }
    loadConfig();
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    loadKeywords();
  }, []);

  useEffect(() => {
    if (activeTab === 'library') {
      loadArticles();
    }
  }, [activeTab, articleFilterKeywordId, articleFilterPlatform, articlePage]);

  async function loadKeywords() {
    setIsLoadingKeywords(true);
    setError('');
    try {
      const data = await getKeywords();
      setKeywords(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载关键词失败');
    } finally {
      setIsLoadingKeywords(false);
    }
  }

  async function loadArticles() {
    setIsLoadingArticles(true);
    try {
      const data = await getArticles({
        keywordId: articleFilterKeywordId || undefined,
        platform: articleFilterPlatform || undefined,
        limit: ARTICLES_PER_PAGE,
        offset: articlePage * ARTICLES_PER_PAGE,
      });
      setArticles(data.articles);
      setArticlesTotal(data.total);
    } catch (e) {
      setError(e instanceof Error ? e.message : '加载文章失败');
    } finally {
      setIsLoadingArticles(false);
    }
  }

  async function handleAddKeyword() {
    const trimmed = newKeyword.trim();
    if (!trimmed) {
      setError('请输入关键词');
      return;
    }
    if (selectedPlatforms.length === 0) {
      setError('请至少选择一个平台');
      return;
    }
    setIsAdding(true);
    setError('');
    try {
      await createKeyword(trimmed, selectedPlatforms);
      setNewKeyword('');
      await loadKeywords();
    } catch (e) {
      setError(e instanceof Error ? e.message : '添加关键词失败');
    } finally {
      setIsAdding(false);
    }
  }

  async function handleDeleteKeyword(id: number) {
    if (!confirm('确定要删除这个关键词吗？相关的采集数据也会被删除。')) return;
    try {
      await deleteKeyword(id);
      await loadKeywords();
      if (articleFilterKeywordId === id) {
        setArticleFilterKeywordId(null);
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '删除失败');
    }
  }

  async function handleFetchKeyword(keyword: MonitoredKeyword) {
    setFetchingKeywordId(keyword.id);
    setError('');
    setFetchResult(null);
    try {
      const response = await fetchKeywordData(keyword.id);
      setFetchResult({ keywordId: keyword.id, result: response.results, errors: response.errors });
      await loadKeywords();
      if (activeTab === 'library') {
        await loadArticles();
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : '采集失败');
    } finally {
      setFetchingKeywordId(null);
    }
  }

  function togglePlatform(platform: Platform) {
    setSelectedPlatforms((prev) =>
      prev.includes(platform) ? prev.filter((p) => p !== platform) : [...prev, platform]
    );
  }

  function formatTime(timestamp: number | null) {
    if (!timestamp) return '-';
    return new Date(timestamp * 1000).toLocaleString('zh-CN');
  }

  const totalPages = useMemo(() => Math.ceil(articlesTotal / ARTICLES_PER_PAGE), [articlesTotal]);

  return (
    <div className="min-h-screen bg-background">
      {/* Header */}
      <header className="sticky top-0 z-30 border-b border-slate-200/80 bg-white/70 backdrop-blur-xl">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-4 py-3">
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
            <div className="flex items-center gap-2.5">
              <div className="flex size-9 items-center justify-center rounded-xl bg-gradient-to-br from-rose-500 to-pink-600 text-white shadow-sm">
                <Database className="size-5" />
              </div>
              <div>
                <h1 className="text-sm font-black text-slate-900">数据采集</h1>
                <p className="text-[10px] font-bold text-slate-400">Data Collection</p>
              </div>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <ModuleQuickNav current="collection" onNavigate={onNavigate} />
          </div>
        </div>
      </header>

      {/* Main Content */}
      <main className="mx-auto max-w-6xl px-4 py-6">
        {/* Config Warning */}
        {configStatus && (!configStatus.wechatApiToken || !configStatus.douyinApiToken) && (
          <div className="mb-4 flex flex-col gap-1 rounded-lg bg-amber-50 px-4 py-3 text-sm text-amber-700">
            {!configStatus.wechatApiToken && (
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4" />
                未配置公众号 API Token，请在服务端 .env 中设置 WECHAT_API_TOKEN
              </div>
            )}
            {!configStatus.douyinApiToken && (
              <div className="flex items-center gap-2">
                <AlertCircle className="size-4" />
                未配置抖音 API Token，请在服务端 .env 中设置 DOUYIN_API_TOKEN
              </div>
            )}
          </div>
        )}

        {/* Error Banner */}
        <AnimatePresence>
          {error && (
            <motion.div
              initial={{ opacity: 0, y: -10 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: -10 }}
              className="mb-4 flex items-center justify-between rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600"
            >
              <span>{error}</span>
              <button onClick={() => setError('')} className="rounded p-1 hover:bg-red-100">
                <X className="size-4" />
              </button>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Tabs */}
        <div className="mb-6 flex gap-1 rounded-xl bg-slate-100 p-1">
          <button
            onClick={() => setActiveTab('monitor')}
            className={cn(
              'flex-1 rounded-lg px-4 py-2 text-sm font-bold transition-all',
              activeTab === 'monitor' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            选题监控
          </button>
          <button
            onClick={() => setActiveTab('library')}
            className={cn(
              'flex-1 rounded-lg px-4 py-2 text-sm font-bold transition-all',
              activeTab === 'library' ? 'bg-white text-slate-900 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            )}
          >
            内容库
          </button>
        </div>

        {/* Monitor Tab */}
        {activeTab === 'monitor' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            {/* Add Keyword */}
            <div className="mb-6 rounded-2xl border border-slate-200 bg-white p-5">
              <h3 className="mb-4 text-sm font-bold text-slate-900">添加监控关键词</h3>
              <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
                <div className="flex-1">
                  <Label className="mb-1.5 block text-xs font-medium text-slate-500">关键词</Label>
                  <Input
                    placeholder="输入要监控的关键词..."
                    value={newKeyword}
                    onChange={(e) => setNewKeyword(e.target.value)}
                    onKeyDown={(e) => e.key === 'Enter' && handleAddKeyword()}
                  />
                </div>
                <div>
                  <Label className="mb-1.5 block text-xs font-medium text-slate-500">选择平台</Label>
                  <div className="flex gap-4">
                    {(['wechat', 'xhs', 'douyin'] as Platform[]).map((platform) => (
                      <label key={platform} className="flex items-center gap-2 text-sm text-slate-700">
                        <Checkbox
                          checked={selectedPlatforms.includes(platform)}
                          onChange={() => togglePlatform(platform)}
                        />
                        <span>{PLATFORM_META[platform].label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <Button onClick={handleAddKeyword} disabled={isAdding} className="shrink-0">
                  {isAdding ? <Loader2 className="mr-1 size-4 animate-spin" /> : <Plus className="mr-1 size-4" />}
                  添加
                </Button>
              </div>
            </div>

            {/* Keywords List */}
            <div className="rounded-2xl border border-slate-200 bg-white">
              <div className="flex items-center justify-between border-b border-slate-100 px-5 py-4">
                <h3 className="text-sm font-bold text-slate-900">监控列表</h3>
                <span className="text-xs text-slate-400">{keywords.length} 个关键词</span>
              </div>

              {isLoadingKeywords ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-slate-400" />
                </div>
              ) : keywords.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">暂无监控关键词，请添加一个</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {keywords.map((keyword) => (
                    <div key={keyword.id} className="flex items-center justify-between px-5 py-4 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-slate-900">{keyword.keyword}</span>
                          <div className="flex gap-1">
                            {keyword.platforms.map((p) => (
                              <span
                                key={p}
                                className={cn(
                                  'rounded-full px-2 py-0.5 text-[10px] font-bold',
                                  PLATFORM_META[p as Platform]?.bg,
                                  PLATFORM_META[p as Platform]?.color
                                )}
                              >
                                {PLATFORM_META[p as Platform]?.label || p}
                              </span>
                            ))}
                          </div>
                        </div>
                        <p className="mt-1 text-xs text-slate-400">
                          更新于 {formatTime(keyword.updated_at)}
                        </p>
                      </div>
                      <div className="flex items-center gap-2">
                        {fetchResult?.keywordId === keyword.id && (
                          <div className="mr-2 flex flex-col gap-0.5 text-xs text-slate-500">
                            {fetchResult.result.wechat && (
                              <span className="flex items-center gap-1 text-emerald-600">
                                <CheckCircle2 className="size-3" />
                                公众号 +{fetchResult.result.wechat.inserted}
                              </span>
                            )}
                            {fetchResult.errors.wechat && (
                              <span className="flex items-center gap-1 text-red-500">
                                <AlertCircle className="size-3" />
                                公众号失败
                              </span>
                            )}
                            {fetchResult.result.douyin && (
                              <span className="flex items-center gap-1 text-sky-600">
                                <CheckCircle2 className="size-3" />
                                抖音 +{fetchResult.result.douyin.inserted}
                              </span>
                            )}
                            {fetchResult.errors.douyin && (
                              <span className="flex items-center gap-1 text-red-500">
                                <AlertCircle className="size-3" />
                                抖音失败
                              </span>
                            )}
                          </div>
                        )}
                        <Button
                          variant="outline"
                          size="sm"
                          onClick={() => handleFetchKeyword(keyword)}
                          disabled={fetchingKeywordId === keyword.id}
                        >
                          {fetchingKeywordId === keyword.id ? (
                            <Loader2 className="mr-1 size-3.5 animate-spin" />
                          ) : (
                            <RefreshCw className="mr-1 size-3.5" />
                          )}
                          采集
                        </Button>
                        <Button
                          variant="ghost"
                          size="sm"
                          onClick={() => handleDeleteKeyword(keyword.id)}
                          className="text-red-500 hover:bg-red-50 hover:text-red-600"
                        >
                          <Trash2 className="size-3.5" />
                        </Button>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </motion.div>
        )}

        {/* Library Tab */}
        {activeTab === 'library' && (
          <motion.div initial={{ opacity: 0, y: 10 }} animate={{ opacity: 1, y: 0 }}>
            {/* Filters */}
            <div className="mb-4 flex flex-wrap items-center gap-3">
              <div className="flex items-center gap-2">
                <Filter className="size-4 text-slate-400" />
                <select
                  value={articleFilterKeywordId || ''}
                  onChange={(e) => {
                    setArticleFilterKeywordId(e.target.value ? Number(e.target.value) : null);
                    setArticlePage(0);
                  }}
                  className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
                >
                  <option value="">全部关键词</option>
                  {keywords.map((k) => (
                    <option key={k.id} value={k.id}>{k.keyword}</option>
                  ))}
                </select>
              </div>
              <select
                value={articleFilterPlatform}
                onChange={(e) => {
                  setArticleFilterPlatform(e.target.value);
                  setArticlePage(0);
                }}
                className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm"
              >
                <option value="">全部平台</option>
                <option value="wechat">公众号</option>
                <option value="xhs">小红书</option>
                <option value="douyin">抖音</option>
              </select>
              <span className="ml-auto text-xs text-slate-400">共 {articlesTotal} 条</span>
            </div>

            {/* Articles List */}
            <div className="rounded-2xl border border-slate-200 bg-white">
              {isLoadingArticles ? (
                <div className="flex items-center justify-center py-12">
                  <Loader2 className="size-6 animate-spin text-slate-400" />
                </div>
              ) : articles.length === 0 ? (
                <div className="py-12 text-center text-sm text-slate-400">暂无采集数据</div>
              ) : (
                <div className="divide-y divide-slate-100">
                  {articles.map((article) => (
                    <div key={article.id} className="px-5 py-4 hover:bg-slate-50">
                      <div className="flex items-start justify-between gap-4">
                        <div className="min-w-0 flex-1">
                          <div className="mb-1 flex items-center gap-2">
                            <span
                              className={cn(
                                'rounded-full px-2 py-0.5 text-[10px] font-bold',
                                PLATFORM_META[article.platform as Platform]?.bg,
                                PLATFORM_META[article.platform as Platform]?.color
                              )}
                            >
                              {PLATFORM_META[article.platform as Platform]?.label || article.platform}
                            </span>
                            {article.is_original ? (
                              <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-600">
                                原创
                              </span>
                            ) : null}
                          </div>
                          <h4 className="text-sm font-bold text-slate-900">{article.title || '无标题'}</h4>
                          <p className="mt-1 line-clamp-2 text-xs text-slate-500">{article.content}</p>
                          <div className="mt-2 flex flex-wrap items-center gap-3 text-xs text-slate-400">
                            {article.author && (
                              <span className="flex items-center gap-1">
                                <User className="size-3" />
                                {article.author}
                              </span>
                            )}
                            {article.classify && (
                              <span className="flex items-center gap-1">
                                <Tag className="size-3" />
                                {article.classify}
                              </span>
                            )}
                            <span className="flex items-center gap-1">
                              <Clock className="size-3" />
                              {formatTime(article.publish_time)}
                            </span>
                            <span className="flex items-center gap-1">
                              <Eye className="size-3" />
                              {article.read_count || 0}
                            </span>
                            <span className="flex items-center gap-1">
                              <Heart className="size-3" />
                              {article.praise_count || 0}
                            </span>
                            <span className="flex items-center gap-1">
                              <BookOpen className="size-3" />
                              {article.looking_count || 0}
                            </span>
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-col gap-2">
                          {article.url && (
                            <a
                              href={article.url}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="flex h-8 w-8 items-center justify-center rounded-lg bg-slate-100 text-slate-500 hover:bg-slate-200"
                            >
                              <ExternalLink className="size-4" />
                            </a>
                          )}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}

              {/* Pagination */}
              {totalPages > 1 && (
                <div className="flex items-center justify-center gap-2 border-t border-slate-100 px-5 py-4">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setArticlePage((p) => Math.max(0, p - 1))}
                    disabled={articlePage === 0}
                  >
                    上一页
                  </Button>
                  <span className="text-xs text-slate-500">
                    第 {articlePage + 1} / {totalPages} 页
                  </span>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => setArticlePage((p) => Math.min(totalPages - 1, p + 1))}
                    disabled={articlePage >= totalPages - 1}
                  >
                    下一页
                  </Button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </main>

      <SiteFooter className="mt-auto" />
    </div>
  );
}

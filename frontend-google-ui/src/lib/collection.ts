export interface MonitoredKeyword {
  id: number;
  keyword: string;
  platforms: string[];
  created_at: number;
  updated_at: number;
}

export interface CollectedArticle {
  id: number;
  keyword_id: number;
  platform: string;
  title: string;
  content: string;
  url: string;
  short_link: string;
  author: string;
  avatar: string;
  read_count: number;
  praise_count: number;
  looking_count: number;
  publish_time: number | null;
  classify: string;
  is_original: number;
  ip_wording: string;
  raw_data: string;
  created_at: number;
}

export interface WechatFetchResult {
  total: number;
  inserted: number;
  skipped: number;
  page: number;
  total_page: number;
}

export interface DouyinFetchResult {
  total: number;
  inserted: number;
  skipped: number;
}

export interface FetchResult {
  wechat?: WechatFetchResult | null;
  xhs?: unknown;
  douyin?: DouyinFetchResult | null;
}

export interface FetchKeywordResponse {
  ok: boolean;
  results: FetchResult;
  errors: Record<string, string>;
}

export interface CollectionConfigStatus {
  reachable: boolean;
  wechatApiToken: boolean;
  douyinApiToken: boolean;
}

async function parseJsonSafely(response: Response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

function buildErrorMessage(json: any, fallback: string) {
  const errorMessage = typeof json?.error === 'string' ? json.error : fallback;
  const detailMessage = typeof json?.detail === 'string' ? json.detail : '';
  return detailMessage && detailMessage !== errorMessage ? `${errorMessage} ${detailMessage}` : errorMessage;
}

export async function getCollectionConfigStatus(): Promise<CollectionConfigStatus> {
  try {
    const response = await fetch('/api/config/status', {
      credentials: 'include',
    });
    const json = await parseJsonSafely(response);

    if (!response.ok) {
      throw new Error(json?.error || '读取服务端配置失败');
    }

    return {
      reachable: true,
      wechatApiToken: !!json?.serverManaged?.wechatApiToken,
      douyinApiToken: !!json?.serverManaged?.douyinApiToken,
    };
  } catch {
    return {
      reachable: false,
      wechatApiToken: false,
      douyinApiToken: false,
    };
  }
}

export async function getKeywords(): Promise<MonitoredKeyword[]> {
  const response = await fetch('/api/collection/keywords', {
    credentials: 'include',
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '获取关键词列表失败'));
  }
  return json?.keywords || [];
}

export async function createKeyword(keyword: string, platforms: string[]): Promise<MonitoredKeyword> {
  const response = await fetch('/api/collection/keywords', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ keyword, platforms }),
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '添加关键词失败'));
  }
  return json?.keyword;
}

export async function updateKeyword(id: number, platforms: string[]): Promise<void> {
  const response = await fetch(`/api/collection/keywords/${id}`, {
    method: 'PUT',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ platforms }),
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '更新关键词失败'));
  }
}

export async function deleteKeyword(id: number): Promise<void> {
  const response = await fetch(`/api/collection/keywords/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '删除关键词失败'));
  }
}

export async function fetchKeywordData(id: number): Promise<FetchKeywordResponse> {
  const response = await fetch(`/api/collection/keywords/${id}/fetch`, {
    method: 'POST',
    credentials: 'include',
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '采集数据失败'));
  }
  return json;
}

export async function getArticles(params?: {
  keywordId?: number;
  platform?: string;
  limit?: number;
  offset?: number;
}): Promise<{ articles: CollectedArticle[]; total: number; limit: number; offset: number }> {
  const searchParams = new URLSearchParams();
  if (params?.keywordId) searchParams.set('keywordId', String(params.keywordId));
  if (params?.platform) searchParams.set('platform', params.platform);
  if (params?.limit) searchParams.set('limit', String(params.limit));
  if (params?.offset) searchParams.set('offset', String(params.offset));

  const response = await fetch(`/api/collection/articles?${searchParams.toString()}`, {
    credentials: 'include',
  });
  const json = await parseJsonSafely(response);
  if (!response.ok) {
    throw new Error(buildErrorMessage(json, '获取文章列表失败'));
  }
  return {
    articles: json?.articles || [],
    total: json?.total || 0,
    limit: json?.limit || 50,
    offset: json?.offset || 0,
  };
}

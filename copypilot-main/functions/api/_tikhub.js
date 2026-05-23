const ENDPOINTS = [
  { path: '/api/v1/douyin/web/fetch_one_video_by_share_url', param: 'share_url' },
  { path: '/api/v1/douyin/app/v3/fetch_one_video_by_share_url', param: 'share_url' },
  { path: '/api/v1/tiktok/app/v3/fetch_one_video_by_share_url', param: 'share_url' },
  { path: '/api/v1/kuaishou/app/fetch_one_video_by_url', param: 'share_text' },
  { path: '/api/v1/kuaishou/web/fetch_one_video_by_url', param: 'url' },
  { path: '/api/v1/bilibili/web/fetch_one_video_v3', param: 'url' },
  { path: '/api/v1/instagram/v1/fetch_post_by_url_v2', param: 'post_url' },
  { path: '/api/v1/instagram/v1/fetch_post_by_url', param: 'post_url' },
  { path: '/api/v1/wechat_mp/web/fetch_mp_article_detail_json', param: 'url' }
];

const XIAOHONGSHU_ENDPOINTS = [
  { path: '/api/v1/xiaohongshu/web/get_note_info_v7', param: 'share_text' },
  { path: '/api/v1/xiaohongshu/web/get_note_info_v5', param: 'share_text' },
  { path: '/api/v1/xiaohongshu/web/get_note_info_v4', param: 'share_text' },
  { path: '/api/v1/xiaohongshu/app_v2/get_image_note_detail', param: 'share_text' },
  { path: '/api/v1/xiaohongshu/app_v2/get_video_note_detail', param: 'share_text' },
  { path: '/api/v1/xiaohongshu/web_v2/fetch_feed_notes_v5', param: 'short_url' },
  { path: '/api/v1/xiaohongshu/web_v2/fetch_feed_notes_v4', param: 'short_url' },
  { path: '/api/v1/xiaohongshu/web_v2/fetch_feed_notes_v3', param: 'short_url' }
];

export async function extractByUrl({ apiKey, baseUrl, url }) {
  if (isXiaohongshuUrl(url)) {
    return extractXiaohongshu({ apiKey, baseUrl, url });
  }

  const endpoints = rankEndpoints(url);
  const errors = [];

  for (const endpoint of endpoints) {
    try {
      const params = getEndpointParams(endpoint, url);
      if (!params) continue;
      return await requestTikhub({ apiKey, baseUrl, endpoint, params });
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(errors[0] || '解析失败');
}

export function json(data, status = 200, headers = {}) {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...headers
    }
  });
}

function rankEndpoints(url) {
  const lower = url.toLowerCase();
  const platformRoutes = [
    {
      test: /tiktok\.com|vm\.tiktok\.com/i,
      endpoints: [
        { path: '/api/v1/tiktok/app/v3/fetch_one_video_by_share_url_v2', param: 'share_url' },
        { path: '/api/v1/tiktok/app/v3/fetch_one_video_by_share_url', param: 'share_url' }
      ]
    },
    {
      test: /douyin\.com|iesdouyin\.com/i,
      endpoints: ENDPOINTS.slice(0, 2)
    },
    {
      test: /kuaishou\.com|gifshow\.com|v\.kuaishou\.com/i,
      endpoints: ENDPOINTS.slice(3, 5)
    },
    {
      test: /bilibili\.com|b23\.tv/i,
      endpoints: [
        { path: '/api/v1/bilibili/web/fetch_one_video_v3', param: 'url' },
        { path: '/api/v1/bilibili/web/fetch_one_video', param: 'bv_id', derive: extractBilibiliBvId }
      ]
    },
    {
      test: /instagram\.com/i,
      endpoints: ENDPOINTS.slice(6, 8)
    },
    {
      test: /mp\.weixin\.qq\.com|weixin\.qq\.com/i,
      endpoints: [ENDPOINTS[8]]
    },
    {
      test: /youtube\.com|youtu\.be/i,
      endpoints: [{ path: '/api/v1/youtube/web/get_video_info', param: 'video_id', derive: extractYoutubeId }]
    },
    {
      test: /twitter\.com|x\.com/i,
      endpoints: [{ path: '/api/v1/twitter/web/fetch_tweet_detail', param: 'tweet_id', derive: extractLastNumericId }]
    },
    {
      test: /threads\.net/i,
      endpoints: [{ path: '/api/v1/threads/web/fetch_post_detail', param: 'post_id', derive: extractThreadsId }]
    },
    {
      test: /reddit\.com/i,
      endpoints: [{ path: '/api/v1/reddit/app/fetch_post_details', param: 'post_id', derive: extractRedditPostId, extra: { need_format: 'true' } }]
    },
    {
      test: /weibo\.com/i,
      endpoints: [
        { path: '/api/v1/weibo/web_v2/fetch_post_detail', param: 'id', derive: extractLastPathId, extra: { is_get_long_text: 'true' } },
        { path: '/api/v1/weibo/app/fetch_status_detail', param: 'status_id', derive: extractLastPathId }
      ]
    },
    {
      test: /lemon8-app\.com|lemon8\.com/i,
      endpoints: [{ path: '/api/v1/lemon8/app/fetch_post_detail', param: 'item_id', derive: extractLastNumericId }]
    },
    {
      test: /pipix\.com|pipixia\.com/i,
      endpoints: [{ path: '/api/v1/pipixia/app/fetch_post_detail', param: 'cell_id', derive: extractLastNumericId }]
    },
    {
      test: /zhihu\.com/i,
      endpoints: [{ path: '/api/v1/zhihu/web/fetch_column_article_detail', param: 'article_id', derive: extractLastNumericId }]
    }
  ];

  const route = platformRoutes.find((item) => item.test.test(lower));
  if (route) {
    return route.endpoints;
  }

  return ENDPOINTS;
}

function getEndpointParams(endpoint, url) {
  const value = endpoint.derive ? endpoint.derive(url) : url;
  if (!value) return null;
  return {
    [endpoint.param]: value,
    ...(endpoint.extra || {})
  };
}

async function extractXiaohongshu({ apiKey, baseUrl, url }) {
  const errors = [];
  const parsed = parseXiaohongshuUrl(url);
  const isShortLink = /xhslink\.com/i.test(url);

  if (isShortLink) {
    const shortLinkEndpoints = XIAOHONGSHU_ENDPOINTS.filter((endpoint) => endpoint.path.includes('/web_v2/fetch_feed_notes'));
    for (const endpoint of shortLinkEndpoints) {
      try {
        return await requestTikhub({ apiKey, baseUrl, endpoint, params: { [endpoint.param]: url } });
      } catch (error) {
        errors.push(error.message);
      }
    }
  }

  if (parsed.noteId && parsed.xsecToken) {
    try {
      return await requestTikhub({
        apiKey,
        baseUrl,
        endpoint: { path: '/api/v1/xiaohongshu/web_v3/fetch_note_detail' },
        params: { note_id: parsed.noteId, xsec_token: parsed.xsecToken }
      });
    } catch (error) {
      errors.push(error.message);
    }
  }

  try {
    const shareInfo = await requestTikhub({
      apiKey,
      baseUrl,
      endpoint: { path: '/api/v1/xiaohongshu/web/get_note_id_and_xsec_token' },
      params: { share_text: url }
    });
    const noteId = findFirstValue(shareInfo, ['note_id', 'noteId', 'id']) || parsed.noteId;
    const xsecToken = findFirstValue(shareInfo, ['xsec_token', 'xsecToken']) || parsed.xsecToken;

    if (noteId && xsecToken) {
      return await requestTikhub({
        apiKey,
        baseUrl,
        endpoint: { path: '/api/v1/xiaohongshu/web_v3/fetch_note_detail' },
        params: { note_id: noteId, xsec_token: xsecToken }
      });
    }
  } catch (error) {
    errors.push(error.message);
  }

  if (parsed.noteId && !parsed.xsecToken) {
    throw new Error('小红书电脑版分享链接缺少 xsec_token，TikHub 目前无法稳定解析这类图文笔记。请用手机小红书 App 点“分享-复制链接”，再粘贴完整链接重试。');
  }

  const endpoints = XIAOHONGSHU_ENDPOINTS;
  for (const endpoint of endpoints) {
    try {
      return await requestTikhub({ apiKey, baseUrl, endpoint, params: { [endpoint.param]: url } });
    } catch (error) {
      errors.push(error.message);
    }
  }

  throw new Error(firstReadableError(errors) || '小红书图文解析失败，请确认作品公开且链接未过期。');
}

async function requestTikhub({ apiKey, baseUrl, endpoint, params }) {
  const target = new URL(`${baseUrl}${endpoint.path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') target.searchParams.set(key, value);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 12000);

  let response;
  try {
    response = await fetch(target.toString(), {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      signal: controller.signal
    });
  } catch (error) {
    if (error.name === 'AbortError') {
      throw new Error('TikHub 接口响应超时，请稍后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const payload = await safeJson(response);
  if (response.ok && isSuccessPayload(payload)) {
    return payload.data || payload;
  }

  throw new Error(readErrorMessage(payload, response.status, endpoint.path));
}

function isXiaohongshuUrl(url) {
  const lower = String(url || '').toLowerCase();
  return lower.includes('xiaohongshu') || lower.includes('xhslink');
}

function parseXiaohongshuUrl(url) {
  const parsed = { noteId: '', xsecToken: '' };
  const text = String(url || '');
  const noteMatch = text.match(/\/(?:discovery\/item|explore)\/([0-9a-f]{20,32})/i);
  if (noteMatch) parsed.noteId = noteMatch[1];

  try {
    const target = new URL(text);
    parsed.xsecToken = target.searchParams.get('xsec_token') || '';
  } catch {
    const tokenMatch = text.match(/[?&]xsec_token=([^&#\s]+)/i);
    if (tokenMatch) parsed.xsecToken = decodeURIComponent(tokenMatch[1]);
  }

  return parsed;
}

function extractYoutubeId(url) {
  try {
    const target = new URL(url);
    if (target.hostname.includes('youtu.be')) return target.pathname.split('/').filter(Boolean)[0] || '';
    return target.searchParams.get('v') || target.pathname.match(/\/shorts\/([^/?#]+)/)?.[1] || '';
  } catch {
    return '';
  }
}

function extractBilibiliBvId(url) {
  return String(url || '').match(/BV[a-zA-Z0-9]+/)?.[0] || '';
}

function extractLastNumericId(url) {
  return String(url || '').match(/(\d{6,})(?!.*\d)/)?.[1] || '';
}

function extractLastPathId(url) {
  try {
    const target = new URL(url);
    return target.pathname.split('/').filter(Boolean).pop() || extractLastNumericId(url);
  } catch {
    return extractLastNumericId(url);
  }
}

function extractThreadsId(url) {
  try {
    const target = new URL(url);
    const parts = target.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch {
    return '';
  }
}

function extractRedditPostId(url) {
  try {
    const target = new URL(url);
    const parts = target.pathname.split('/').filter(Boolean);
    const commentsIndex = parts.indexOf('comments');
    if (commentsIndex >= 0) return parts[commentsIndex + 1] || '';
    return parts[parts.length - 1] || '';
  } catch {
    return '';
  }
}

function findFirstValue(input, keys) {
  const queue = [input];
  const seen = new Set();

  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);

    for (const key of keys) {
      if (typeof item[key] === 'string' && item[key]) return item[key];
    }

    for (const value of Object.values(item)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }

  return '';
}

function readErrorMessage(payload, status, path) {
  const message =
    payload?.message_zh ||
    payload?.message ||
    payload?.msg ||
    payload?.detail ||
    payload?.error?.message ||
    payload?.raw ||
    '';

  if (typeof message === 'string' && message.trim()) return message.trim();
  if (status === 400 && path.includes('/xiaohongshu/')) {
    return 'TikHub 返回 400：小红书链接参数不完整、作品不可访问，或该接口不支持这类笔记。';
  }
  return `${status}`;
}

function firstReadableError(errors) {
  return errors.find((item) => item && !/^\d+$/.test(item));
}

function isSuccessPayload(payload) {
  if (!payload) return false;
  if (payload.data) return true;
  if (payload.code === 200 || payload.status_code === 0 || payload.status === 'success') return true;
  return false;
}

async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { raw: text };
  }
}

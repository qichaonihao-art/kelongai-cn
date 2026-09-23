const YUANBAO_PARSE_URL = 'https://yuanbao.tencent.com/api/weixin/get_parse_result';
const WECHAT_FEED_INFO_URL = 'https://channels.weixin.qq.com/finder-preview/api/feed/get_feed_info';
const WECHAT_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/148.0.0.0 Safari/537.36';

export function extractWechatChannelUrl(value) {
  return String(value || '').match(/https?:\/\/[^\s]*weixin\.qq\.com\/sph\/[^\s]+/i)?.[0] || '';
}

export async function parseWechatChannelWithYuanbao(value, cookie = process.env.WECHAT_SPH_COOKIE) {
  const shareUrl = extractWechatChannelUrl(value);
  if (!shareUrl) throw createWechatError('WECHAT_URL_INVALID', '不是有效的微信视频号分享链接，请粘贴 weixin.qq.com/sph/ 开头的链接。', 400);
  if (!String(cookie || '').trim()) {
    throw createWechatError('WECHAT_COOKIE_MISSING', '视频号解析 Cookie 未配置，请先更新腾讯元宝 Cookie。', 400);
  }

  const parseData = await parseShareUrl(shareUrl, String(cookie).trim());
  const playableUrl = String(parseData.playable_url || parseData.playableUrl || '');
  let generalToken = '';
  let exportId = String(parseData.wx_export_id || parseData.wxExportId || '');
  try {
    const parsedPlayable = new URL(playableUrl);
    generalToken = parsedPlayable.searchParams.get('token') || '';
    exportId = parsedPlayable.searchParams.get('eid') || exportId;
  } catch {}
  if (!generalToken || !exportId) {
    throw createWechatError('YUANBAO_PARSE_FAILED', '元宝接口未返回有效的视频号 token/eid，请检查 Cookie 是否过期。', 502);
  }

  const feedResult = await getFeedInfo(exportId, generalToken);
  const normalized = normalizeWechatResult(feedResult, parseData, shareUrl);
  if (!normalized.videoUrl && !normalized.originVideoUrl) {
    throw createWechatError('WECHAT_VIDEO_MISSING', '已解析到视频号信息，但没有找到可播放的视频地址。', 502);
  }
  return normalized;
}

function createWechatError(code, message, status = 500) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

async function parseShareUrl(shareUrl, cookie) {
  const response = await fetchWithTimeout(YUANBAO_PARSE_URL, {
    method: 'POST',
    headers: {
      accept: 'application/json, text/plain, */*',
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'content-type': 'application/json',
      origin: 'https://yuanbao.tencent.com',
      referer: 'https://yuanbao.tencent.com/',
      'user-agent': WECHAT_USER_AGENT,
      'x-language': 'zh-CN',
      'x-platform': 'mac',
      'x-requested-with': 'XMLHttpRequest',
      'x-source': 'web',
      cookie,
    },
    body: JSON.stringify({ type: 'video_channel_url', url: shareUrl, scene: 1 }),
  });
  const payload = await readJson(response, '元宝接口没有返回有效数据。');
  if (response.status === 401 || response.status === 403) {
    throw createWechatError('WECHAT_COOKIE_EXPIRED', '腾讯元宝 Cookie 可能已过期，请重新填写。', 401);
  }
  if (!response.ok) throw createWechatError('YUANBAO_PARSE_FAILED', `元宝接口请求失败，状态码：${response.status}。`, 502);
  const data = payload?.data || {};
  if (!data.wx_export_id || !data.playable_url) {
    const message = String(payload?.msg || payload?.message || '');
    if (/login|cookie|登录|授权|过期|无效/i.test(message)) {
      throw createWechatError('WECHAT_COOKIE_EXPIRED', '腾讯元宝 Cookie 可能已过期，请重新填写。', 401);
    }
    throw createWechatError('YUANBAO_PARSE_FAILED', '元宝接口未解析出视频号播放信息。', 502);
  }
  return data;
}

async function getFeedInfo(exportId, generalToken) {
  const rid = `${Math.floor(Date.now() / 1000).toString(16)}-${Array.from({ length: 8 }, () => '0123456789abcdef'[Math.floor(Math.random() * 16)]).join('')}`;
  const apiUrl = `${WECHAT_FEED_INFO_URL}?_rid=${encodeURIComponent(rid)}&_pageUrl=https:%2F%2Fchannels.weixin.qq.com%2Ffinder-preview%2Fpages%2Ffeed`;
  const referer = `https://channels.weixin.qq.com/finder-preview/pages/feed?entry_card_type=48&comment_scene=39&appid=0&token=${encodeURIComponent(generalToken)}&entry_scene=0&eid=${encodeURIComponent(exportId)}`;
  const response = await fetchWithTimeout(apiUrl, {
    method: 'POST',
    headers: {
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
      'Content-Type': 'application/json',
      Origin: 'https://channels.weixin.qq.com',
      Referer: referer,
      'User-Agent': WECHAT_USER_AGENT,
    },
    body: JSON.stringify({ baseReq: { generalToken }, exportId }),
  });
  const payload = await readJson(response, '视频号接口没有返回有效数据。');
  if (!response.ok) throw createWechatError('WECHAT_PREVIEW_FAILED', `视频号接口请求失败，状态码：${response.status}。`, 502);
  if (payload?.errCode && Number(payload.errCode) !== 0) {
    throw createWechatError('WECHAT_PREVIEW_FAILED', payload?.errMsg || `视频号接口返回错误：${payload.errCode}`, 502);
  }
  return payload;
}

function normalizeWechatResult(feedResult, parseData, sourceUrl) {
  const data = feedResult?.data || {};
  const feed = data.feedInfo || data.feedinfo || {};
  const authorInfo = data.authorInfo || data.authorinfo || {};
  const videoUrl = feed.videoUrl || feed.videourl || feed.h264VideoInfo?.videoUrl || feed.h264videoinfo?.videourl || feed.h265VideoInfo?.videoUrl || feed.h265videoinfo?.videourl || parseData.playable_url || '';
  const originVideoUrl = cleanVideoUrl(feed.originVideoUrl || feed.originvideourl || videoUrl);
  const description = String(feed.description || parseData.desc || '');
  return {
    platform: 'wechat_channels',
    title: cleanTitle(description) || '微信视频号视频',
    description,
    desc: description,
    author: String(authorInfo.nickname || parseData.author || ''),
    authorName: String(authorInfo.nickname || parseData.author || ''),
    authorAvatar: authorInfo.headImgUrl || authorInfo.headimgurl || parseData.author_icon || '',
    cover: feed.coverUrl || feed.coverurl || parseData.cover_url || '',
    videoUrl,
    originVideoUrl: originVideoUrl || videoUrl,
    videoUrls: [originVideoUrl || videoUrl, videoUrl].filter(Boolean),
    sourceUrl,
  };
}

function cleanVideoUrl(videoUrl) {
  try {
    const parsed = new URL(videoUrl);
    const encfilekey = parsed.searchParams.get('encfilekey');
    const token = parsed.searchParams.get('token');
    if (!encfilekey || !token) return videoUrl || '';
    return `${parsed.origin}${parsed.pathname}?encfilekey=${encodeURIComponent(encfilekey)}&token=${encodeURIComponent(token)}`;
  } catch {
    return videoUrl || '';
  }
}

function cleanTitle(value) {
  return String(value || '').split(/[#\n\r]/)[0].replace(/^[\s"“”'‘’]+|[\s"“”'‘’]+$/g, '').replace(/[，,。；;！!？?]$/, '').slice(0, 80);
}

async function fetchWithTimeout(url, init, timeoutMs = 15000) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...init, signal: controller.signal });
  } catch (error) {
    if (error?.name === 'AbortError') throw createWechatError('WECHAT_UPSTREAM_TIMEOUT', '视频号解析上游接口请求超时。', 504);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

async function readJson(response, message) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    throw createWechatError('WECHAT_RESPONSE_INVALID', message, 502);
  }
}

import { extractByUrl, json } from './_tikhub.js';
import { recordUsage, requireQuota } from './_auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  const apiKey = env.TIKHUB_API_KEY;
  const baseUrl = env.TIKHUB_BASE_URL || 'https://api.tikhub.io';

  if (!apiKey) {
    return json({ ok: false, message: '提取服务暂未配置完成。' }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求格式不正确。' }, 400);
  }

  const url = String(body.url || '').trim();
  if (!url) return json({ ok: false, message: '缺少作品链接。' }, 400);

  const quota = await requireQuota(context, 'extract');
  if (!quota.ok) return json({ ok: false, message: quota.message, needLogin: quota.status === 401 }, quota.status);

  try {
    const data = await extractByUrl({ apiKey, baseUrl, url });
    await recordUsage(context, quota, {
      action: 'extract',
      sourceUrl: url,
      resultTitle: getTitle(data)
    });
    const headers = quota.setCookie ? { 'Set-Cookie': quota.setCookie } : {};
    return json({ ok: true, data }, 200, headers);
  } catch (error) {
    return json({ ok: false, message: error.message || '解析失败' }, 502);
  }
}

function getTitle(data) {
  return data?.title || data?.desc || data?.aweme_detail?.desc || data?.itemInfo?.itemStruct?.desc || data?.note?.title || null;
}

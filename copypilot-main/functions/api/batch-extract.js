import { extractByUrl, json } from './_tikhub.js';
import { recordUsage, requireQuota } from './_auth.js';

export async function onRequestPost(context) {
  const apiKey = context.env.TIKHUB_API_KEY;
  const baseUrl = context.env.TIKHUB_BASE_URL || 'https://api.tikhub.io';

  if (!apiKey) {
    return json({ ok: false, message: '提取服务暂未配置完成。' }, 500);
  }

  const body = await context.request.json().catch(() => null);
  const urls = Array.isArray(body?.urls)
    ? body.urls.map((item) => String(item || '').trim()).filter(Boolean).slice(0, 10)
    : [];

  if (!urls.length) {
    return json({ ok: false, message: '缺少链接列表。' }, 400);
  }

  const quota = await requireQuota(context, 'extract');
  if (!quota.ok) return json({ ok: false, message: quota.message, needLogin: quota.status === 401 }, quota.status);

  const results = [];
  for (const url of urls) {
    try {
      const data = await extractByUrl({ apiKey, baseUrl, url });
      results.push({
        ok: true,
        url,
        title: data.title || data.desc || data.aweme_detail?.desc || data.itemInfo?.itemStruct?.desc || '提取完成',
        text: data.text || data.desc || data.caption || data.aweme_detail?.desc || data.itemInfo?.itemStruct?.desc || '',
        data
      });
    } catch (error) {
      results.push({ ok: false, url, message: error.message });
    }
  }

  await recordUsage(context, quota, {
    action: 'extract',
    sourceUrl: urls[0] || null,
    resultTitle: `批量提取 ${urls.length} 条`,
    status: results.some((item) => item.ok) ? 'completed' : 'failed'
  });
  const headers = quota.setCookie ? { 'Set-Cookie': quota.setCookie } : {};

  return json({ ok: true, results }, 200, headers);
}

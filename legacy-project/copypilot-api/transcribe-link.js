import { extractByUrl, json } from './_tikhub.js';
import { recordUsage, requireQuota } from './_auth.js';
import { getDefaultMaxVideoMinutes, getMembershipPlan } from './_plans.js';

const FREE_MAX_TRANSCRIBE_SECONDS = 5 * 60;

export async function onRequestPost(context) {
  const { request, env } = context;
  const tikhubKey = env.TIKHUB_API_KEY;
  const tikhubBaseUrl = env.TIKHUB_BASE_URL || 'https://api.tikhub.io';
  const siliconFlowKey = env.SILICONFLOW_API_KEY;
  const model = env.SILICONFLOW_TRANSCRIBE_MODEL || 'FunAudioLLM/SenseVoiceSmall';

  if (!tikhubKey) return json({ ok: false, message: '提取服务暂未配置完成。' }, 500);

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
    const sourceData = await extractByUrl({ apiKey: tikhubKey, baseUrl: tikhubBaseUrl, url });
    const publishedText = getPublishedText(sourceData);
    const durationSeconds = getDurationSeconds(sourceData);
    const maxTranscribeSeconds = await getMaxTranscribeSeconds(context, quota);

    if (durationSeconds > maxTranscribeSeconds) {
      const maxMinutes = Math.round(maxTranscribeSeconds / 60);
      const message = `视频超过${maxMinutes}分钟，已为你提取标题、发布文案和素材链接，但不生成视频本身文案。`;
      const data = {
        ...sourceData,
        publishedText,
        transcript: '',
        transcriptSkipped: true,
        transcriptSkipReason: message,
        durationSeconds
      };
      await recordUsage(context, quota, {
        action: 'extract',
        sourceUrl: url,
        resultTitle: getPublishedText(sourceData) || sourceData?.title || null
      });
      const headers = quota.setCookie ? { 'Set-Cookie': quota.setCookie } : {};
      return json({ ok: true, message, data }, 200, headers);
    }

    const subtitleUrl = getSubtitleLinks(sourceData)[0];

    if (subtitleUrl) {
      const subtitleText = await fetchSubtitleText(subtitleUrl);
      if (subtitleText) {
        const data = {
          ...sourceData,
          text: subtitleText,
          transcript: subtitleText,
          publishedText,
          transcriptSource: 'subtitle'
        };
        await recordUsage(context, quota, {
          action: 'extract',
          sourceUrl: url,
          resultTitle: getPublishedText(sourceData) || sourceData?.title || null
        });
        const headers = quota.setCookie ? { 'Set-Cookie': quota.setCookie } : {};
        return json({ ok: true, data }, 200, headers);
      }
    }

    const videoUrl = getVideoLinks(sourceData)[0];

    if (!videoUrl) {
      return json({
        ok: false,
        message: '已解析作品信息，但没有拿到可转写的视频源。',
        data: sourceData
      }, 502);
    }

    if (!siliconFlowKey) {
      return json({
        ok: false,
        message: '转写服务暂未配置完成。',
        data: sourceData
      }, 500);
    }

    const mediaResponse = await fetch(videoUrl, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36',
        Referer: 'https://www.douyin.com/'
      }
    });

    if (!mediaResponse.ok) {
      return json({
        ok: false,
        message: '视频源下载失败，暂时无法转写视频本身文案。',
        status: mediaResponse.status,
        data: sourceData
      }, 502);
    }

    const mediaBlob = await mediaResponse.blob();
    const transcriptPayload = await transcribeBlob({
      apiKey: siliconFlowKey,
      model,
      blob: mediaBlob,
      filename: 'source-video.mp4'
    });

    const data = {
      ...sourceData,
      text: transcriptPayload.text || '',
      transcript: transcriptPayload.text || '',
      publishedText
    };
    await recordUsage(context, quota, {
      action: 'extract',
      sourceUrl: url,
      resultTitle: getPublishedText(sourceData) || sourceData?.title || null
    });
    const headers = quota.setCookie ? { 'Set-Cookie': quota.setCookie } : {};

    return json({
      ok: true,
      data
    }, 200, headers);
  } catch (error) {
    return json({ ok: false, message: error.message || '链接视频转写失败。' }, 502);
  }
}

async function getMaxTranscribeSeconds(context, quota) {
  const plan = quota?.user?.plan;
  if (!context.env.DB || !plan || plan === 'free') return FREE_MAX_TRANSCRIBE_SECONDS;
  if (plan === 'admin') return getDefaultMaxVideoMinutes('admin') * 60;
  try {
    const config = await getMembershipPlan(context.env.DB, plan);
    if (config?.maxVideoMinutes) return config.maxVideoMinutes * 60;
  } catch {
    // Use defaults when the editable plan table is unavailable.
  }
  return getDefaultMaxVideoMinutes(plan) * 60;
}

async function transcribeBlob({ apiKey, model, blob, filename }) {
  const form = new FormData();
  form.set('model', model);
  form.set('file', new File([blob], filename, { type: blob.type || 'video/mp4' }));

  const response = await fetch('https://api.siliconflow.cn/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: form
  });

  const payload = await safeJson(response);
  if (!response.ok) {
    throw new Error(payload?.message || payload?.error?.message || '视频转写失败。');
  }

  return {
    text: payload.text || payload.data?.text || '',
    raw: payload
  };
}

function getVideoLinks(data) {
  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data?.note || data || {};
  const video = detail.video || data?.video || {};
  const links = [];

  if (video.play_addr?.url_list?.length) links.push(...video.play_addr.url_list);
  if (video.download_addr?.url_list?.length) links.push(...video.download_addr.url_list);
  if (detail.video_url) links.push(detail.video_url);
  if (data?.video_url) links.push(data.video_url);
  if (data?.videos?.items?.length) {
    const sortedVideos = [...data.videos.items].sort((a, b) => Number(b.hasAudio) - Number(a.hasAudio));
    links.push(...sortedVideos.map((item) => item.url));
  }
  return [...new Set(links)].filter(Boolean);
}

function getDurationSeconds(data) {
  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data?.note || data || {};
  const video = detail.video || data?.video || {};
  const candidates = [
    data?.lengthSeconds,
    data?.durationSeconds,
    data?.duration,
    data?.duration_sec,
    data?.durationMs,
    data?.duration_ms,
    detail?.lengthSeconds,
    detail?.durationSeconds,
    detail?.duration,
    detail?.duration_sec,
    detail?.durationMs,
    detail?.duration_ms,
    video?.duration,
    video?.duration_ms,
    video?.durationMs,
    video?.lengthSeconds,
    data?.videos?.items?.[0]?.lengthMs
  ];

  for (const value of candidates) {
    const seconds = normalizeDurationSeconds(value);
    if (seconds > 0) return seconds;
  }

  return 0;
}

function normalizeDurationSeconds(value) {
  if (value === undefined || value === null || value === '') return 0;
  if (typeof value === 'string') {
    const text = value.trim();
    if (/^\d+(?::\d+){1,2}$/.test(text)) {
      return text.split(':').reduce((total, part) => total * 60 + Number(part), 0);
    }
    const numeric = Number(text.replace(/[^\d.]/g, ''));
    if (!Number.isFinite(numeric)) return 0;
    return numeric > 10000 ? numeric / 1000 : numeric;
  }
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return 0;
  return numeric > 10000 ? numeric / 1000 : numeric;
}

function getSubtitleLinks(data) {
  const items = data?.subtitles?.items || data?.subtitle?.items || data?.captions?.items || [];
  return items
    .map((item) => typeof item === 'string' ? item : item?.url)
    .filter(Boolean);
}

async function fetchSubtitleText(url) {
  const response = await fetch(url, {
    headers: {
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/124 Safari/537.36'
    }
  });
  if (!response.ok) return '';
  const raw = await response.text();
  return parseSubtitleText(raw);
}

function parseSubtitleText(raw) {
  const text = String(raw || '').trim();
  if (!text) return '';

  try {
    const payload = JSON.parse(text);
    const events = payload.events || payload.body?.events || [];
    const lines = events
      .flatMap((event) => event.segs || event.segments || [])
      .map((seg) => seg.utf8 || seg.text || '')
      .join('')
      .split(/\n+/)
      .map(cleanSubtitleLine)
      .filter(Boolean);
    if (lines.length) return dedupeLines(lines).join('\n');
  } catch {
    // XML subtitle format is handled below.
  }

  const xmlLines = [...text.matchAll(/<text[^>]*>([\s\S]*?)<\/text>/gi)]
    .map((match) => cleanSubtitleLine(decodeEntities(match[1])))
    .filter(Boolean);
  if (xmlLines.length) return dedupeLines(xmlLines).join('\n');

  return cleanSubtitleLine(decodeEntities(text));
}

function cleanSubtitleLine(value) {
  return decodeEntities(value)
    .replace(/<[^>]+>/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function dedupeLines(lines) {
  const output = [];
  for (const line of lines) {
    if (line && line !== output[output.length - 1]) output.push(line);
  }
  return output;
}

function decodeEntities(value) {
  return String(value || '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, code) => String.fromCharCode(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code) => String.fromCharCode(parseInt(code, 16)));
}

function getPublishedText(data) {
  return (
    data?.description ||
    data?.desc ||
    data?.caption ||
    data?.aweme_detail?.desc ||
    data?.itemInfo?.itemStruct?.desc ||
    data?.note?.desc ||
    ''
  );
}

async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

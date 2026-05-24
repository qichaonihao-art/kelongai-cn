import { json } from './_tikhub.js';
import { recordUsage, requireQuota } from './_auth.js';
import { getDefaultMaxVideoMinutes, getMembershipPlan } from './_plans.js';

const FREE_MAX_TRANSCRIBE_SECONDS = 5 * 60;
const FREE_MAX_UNKNOWN_DURATION_BYTES = 60 * 1024 * 1024;

const QWEN_ASR_MODEL = 'qwen3-asr-flash';
const QWEN_ASR_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const QWEN_TIMEOUT_MS = 420_000;

export async function onRequestPost(context) {
  const apiKey = context.env.DASHSCOPE_API_KEY || context.env.ALIYUN_API_KEY || '';

  if (!apiKey) {
    return json({ ok: false, message: '服务端未配置 DashScope API Key' }, 500);
  }

  const form = await context.request.formData().catch(() => null);
  const file = form?.get('file');
  if (!(file instanceof File)) {
    return json({ ok: false, message: '请先选择音频或视频文件。' }, 400);
  }

  const quota = await requireQuota(context, 'extract');
  if (!quota.ok) return json({ ok: false, message: quota.message, needLogin: quota.status === 401 }, quota.status);

  const maxTranscribeSeconds = await getMaxTranscribeSeconds(context, quota);
  const durationSeconds = Number(form.get('durationSeconds') || 0);
  if (durationSeconds > maxTranscribeSeconds) {
    return json({
      ok: false,
      message: `免费版转文字仅支持 ${Math.round(maxTranscribeSeconds / 60)} 分钟以内的音视频。`
    }, 400);
  }
  if (!quota.user && !durationSeconds && file.size > FREE_MAX_UNKNOWN_DURATION_BYTES) {
    return json({
      ok: false,
      message: '免费版本地转文字仅支持 5 分钟以内的音视频，请选择更短的文件。'
    }, 400);
  }

  try {
    const arrayBuffer = await file.arrayBuffer();
    const base64Audio = Buffer.from(arrayBuffer).toString('base64');
    const dataUri = `data:audio/mp3;base64,${base64Audio}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), QWEN_TIMEOUT_MS);

    const response = await fetch(QWEN_ASR_URL, {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: QWEN_ASR_MODEL,
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: { data: dataUri }
              }
            ]
          }
        ],
        stream: false,
        asr_options: {
          language: 'zh',
          enable_itn: false
        }
      })
    });

    clearTimeout(timeoutId);

    const responseText = await response.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }

    if (!response.ok) {
      const errorMsg = responseJson?.error?.message || responseJson?.message || `HTTP ${response.status}`;
      return json({ ok: false, message: `千问 ASR 返回错误：${errorMsg}` }, response.status);
    }

    const transcript = responseJson?.choices?.[0]?.message?.content || '';

    await recordUsage(context, quota, {
      action: 'extract',
      resultTitle: file.name,
      status: 'completed'
    });
    const headers = quota.setCookie ? { 'Set-Cookie': quota.setCookie } : {};

    return json({
      ok: true,
      data: {
        title: file.name,
        text: transcript,
        transcript: transcript,
        transcriptSource: 'qwen-asr'
      }
    }, 200, headers);
  } catch (error) {
    return json({ ok: false, message: error.message || '千问 ASR 转写失败' }, 502);
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

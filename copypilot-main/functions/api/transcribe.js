import { json } from './_tikhub.js';
import { recordUsage, requireQuota } from './_auth.js';
import { getDefaultMaxVideoMinutes, getMembershipPlan } from './_plans.js';

const FREE_MAX_TRANSCRIBE_SECONDS = 5 * 60;
const FREE_MAX_UNKNOWN_DURATION_BYTES = 60 * 1024 * 1024;

export async function onRequestPost(context) {
  const apiKey = context.env.SILICONFLOW_API_KEY;
  const model = context.env.SILICONFLOW_TRANSCRIBE_MODEL || 'FunAudioLLM/SenseVoiceSmall';

  if (!apiKey) {
    return json({ ok: false, message: '转写服务暂未配置完成。' }, 500);
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

  const upstreamForm = new FormData();
  upstreamForm.set('model', model);
  upstreamForm.set('file', file, file.name || 'media-file');

  const response = await fetch('https://api.siliconflow.cn/v1/audio/transcriptions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: upstreamForm
  });

  const payload = await safeJson(response);
  if (!response.ok) {
    return json(
      {
        ok: false,
        message: payload?.message || payload?.error?.message || '转写失败。',
        detail: payload?.code || payload?.status || null
      },
      response.status
    );
  }

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
      text: payload.text || payload.data?.text || ''
    }
  }, 200, headers);
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

async function safeJson(response) {
  const text = await response.text();
  try {
    return JSON.parse(text);
  } catch {
    return { text };
  }
}

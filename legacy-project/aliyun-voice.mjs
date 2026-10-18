import { randomBytes } from 'node:crypto';

// Enrollment voices are bound to their target model. Never relabel archived voices.
export const ALIYUN_VOICE_MODEL = 'qwen-audio-3.1-tts-flash';
export const LEGACY_ALIYUN_VOICE_MODEL = 'qwen3-tts-vc-realtime-2026-01-15';
export const ALIYUN_VOICE_RECLONE_MESSAGE = '这个阿里云音色使用的旧模型已下线，请上传原音频，用新版重新克隆。原音色档案会保留。';

function fail(message, statusCode = 502) {
  return Object.assign(new Error(message), { statusCode });
}

export function normalizeAliyunVoiceBase(value = 'https://dashscope.aliyuncs.com/api/v1') {
  const url = new URL(value);
  if (url.protocol !== 'https:' || !url.hostname.endsWith('.aliyuncs.com') || url.username || url.password || url.search || url.hash) {
    throw fail('阿里云语音接口地址配置不正确，请使用同地域的百炼接口地址。', 400);
  }
  url.pathname = url.pathname.replace(/\/+$/, '').replace(/\/compatible-mode\/v1$/, '/api/v1');
  if (!url.pathname || url.pathname === '/') url.pathname = '/api/v1';
  if (url.pathname !== '/api/v1') throw fail('阿里云语音接口地址应以 /api/v1 结尾。', 400);
  return url.href.replace(/\/+$/, '');
}

export function parseAliyunVoiceSample(audioData) {
  const match = String(audioData || '').match(/^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) throw fail('缺少有效的声音样本，请重新上传 WAV、MP3 或 M4A 音频。', 400);
  const extensions = { 'audio/wav': 'wav', 'audio/wave': 'wav', 'audio/x-wav': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3', 'audio/mp4': 'm4a', 'audio/m4a': 'm4a', 'audio/x-m4a': 'm4a' };
  const mimeType = match[1].toLowerCase();
  const extension = extensions[mimeType];
  if (!extension) throw fail('新版阿里云声音克隆支持 WAV、MP3、M4A，请换一种音频格式。', 400);
  const buffer = Buffer.from(match[2].replace(/\s+/g, ''), 'base64');
  if (!buffer.length || buffer.length > 10 * 1024 * 1024) throw fail('阿里云声音样本不能为空，且不能超过 10MB。', 400);
  return { buffer, mimeType, name: `voice-${randomBytes(12).toString('hex')}.${extension}` };
}

export function canReuseAliyunShotVoice(voice, fingerprint, model = ALIYUN_VOICE_MODEL) {
  return voice.fingerprint === fingerprint && voice.status !== 'disabled' && voice.engineModel === model;
}

export function createAliyunVoiceService({ apiBase, fetchImpl = (...args) => fetch(...args), publishSample }) {
  const base = () => normalizeAliyunVoiceBase(apiBase);

  // Local installations have no public /uploads URL. Use the same private,
  // model-bound temporary OSS upload protocol as the platform's Aliyun ASR.
  async function uploadTemporarySample(sample, apiKey) {
    const response = await fetchImpl(`${base()}/uploads?action=getPolicy&model=voice-enrollment`, {
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      signal: AbortSignal.timeout(30_000), redirect: 'error',
    });
    const json = await response.json().catch(() => null);
    if (!response.ok) throw fail(json?.message || `获取声音样本上传凭证失败（${response.status}）`, response.status);
    const policy = json?.data;
    if (!policy?.upload_dir || !policy.upload_host || !policy.policy || !policy.signature || !policy.oss_access_key_id) throw fail('声音样本上传凭证不完整。');
    const host = new URL(policy.upload_host);
    if (host.protocol !== 'https:' || !host.hostname.endsWith('.aliyuncs.com') || host.username || host.password) throw fail('声音样本上传地址不正确。');
    const key = `${policy.upload_dir}/${sample.name}`;
    const form = new FormData();
    for (const [field, value] of Object.entries({
      OSSAccessKeyId: policy.oss_access_key_id, Signature: policy.signature, policy: policy.policy,
      'x-oss-object-acl': 'private', 'x-oss-forbid-overwrite': 'true', key, success_action_status: '200',
    })) form.append(field, String(value));
    form.append('file', new Blob([sample.buffer], { type: sample.mimeType }), sample.name);
    const upload = await fetchImpl(host.href, { method: 'POST', body: form, signal: AbortSignal.timeout(60_000), redirect: 'error' });
    if (!upload.ok) throw fail(`上传声音样本失败（${upload.status}）`);
    return `oss://${key}`;
  }

  async function requestJson(endpoint, apiKey, payload, extraHeaders = {}) {
    let response;
    try {
      response = await fetchImpl(`${base()}${endpoint}`, {
        method: 'POST',
        headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json', ...extraHeaders },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(120_000),
        redirect: 'error',
      });
    } catch (error) {
      if (error?.name === 'TimeoutError' || error?.name === 'AbortError') {
        throw fail('阿里云语音请求超时，结果尚未确认；请先在百炼后台核对，避免重复创建或扣费。', 504);
      }
      throw error;
    }
    const json = await response.json().catch(() => null);
    if (!response.ok || json?.code) {
      throw fail(json?.message || json?.code || `阿里云语音接口失败（${response.status}）`, response.ok ? 502 : response.status);
    }
    if (!json) throw fail('阿里云语音接口没有返回有效结果。');
    return json;
  }

  return {
    async create({ apiKey, preferredName, audioData, req }) {
      const sample = parseAliyunVoiceSample(audioData);
      const published = await publishSample?.(sample, req);
      const sampleUrl = published?.ok && published.url ? published.url : await uploadTemporarySample(sample, apiKey);
      const prefix = String(preferredName || '').replace(/[^a-zA-Z0-9]/g, '').slice(0, 10) || `v${randomBytes(4).toString('hex')}`;
      const json = await requestJson('/services/audio/tts/customization', apiKey, {
        model: 'voice-enrollment',
        input: { action: 'create_voice', target_model: ALIYUN_VOICE_MODEL, prefix, url: sampleUrl },
      }, sampleUrl.startsWith('oss://') ? { 'X-DashScope-OssResourceResolve': 'enable' } : {});
      const voiceId = json.output?.voice_id;
      if (!voiceId) throw fail('阿里云没有返回音色 ID，请先在百炼后台核对本次创建结果。');
      // Keep output.voice for older clients; the model always comes from the server.
      return { ...json, output: { ...json.output, voice: voiceId }, engineModel: ALIYUN_VOICE_MODEL };
    },

    async synthesize({ apiKey, model, voice, text }) {
      if (/^qwen3-tts-vc-realtime(?:-|$)/.test(String(model || '')) || /^qwen3-tts-vc-realtime(?:-|$)/.test(String(voice || ''))) {
        throw fail(ALIYUN_VOICE_RECLONE_MESSAGE, 410);
      }
      if (model !== ALIYUN_VOICE_MODEL) throw fail('该阿里云音色的模型与当前版本不一致，请使用新版重新克隆后再生成。', 400);
      if (!String(voice || '').trim() || !String(text || '').trim()) throw fail('请选择音色并填写配音文字。', 400);

      const details = await requestJson('/services/audio/tts/customization', apiKey, {
        model: 'voice-enrollment', input: { action: 'query_voice', voice_id: voice },
      });
      if (details.output?.target_model && details.output.target_model !== model) throw fail('这个音色与所选模型不匹配，请重新选择音色或重新克隆。', 400);
      if (details.output?.status === 'DEPLOYING') throw fail('音色正在准备中，请稍后再试，无需重复克隆。', 409);
      if (details.output?.status !== 'OK') throw fail('这个音色当前不可用，请在百炼后台检查音色状态或重新克隆。', 409);

      const json = await requestJson('/services/audio/tts/SpeechSynthesizer', apiKey, {
        model, input: { text, voice, format: 'wav', sample_rate: 24000 },
      });
      let url;
      try { url = new URL(json.output?.audio?.url); } catch { throw fail('阿里云未返回生成的音频地址。'); }
      if (!['https:', 'http:'].includes(url.protocol) || !url.hostname.endsWith('.aliyuncs.com') || url.username || url.password) throw fail('阿里云返回的音频地址不正确。');
      // Official examples can return HTTP OSS URLs; download the same object over TLS.
      url.protocol = 'https:';
      const response = await fetchImpl(url.href, { signal: AbortSignal.timeout(120_000), redirect: 'error' });
      if (!response.ok) throw fail(`配音已生成，但下载失败（${response.status}），请在百炼后台查看，避免重复生成。`);
      const chunks = [];
      let size = 0;
      for await (const chunk of response.body) {
        size += chunk.length;
        if (size > 100 * 1024 * 1024) throw fail('配音已生成，但文件过大，请在百炼后台下载。');
        chunks.push(Buffer.from(chunk));
      }
      const audio = Buffer.concat(chunks);
      if (audio.toString('ascii', 0, 4) !== 'RIFF' || audio.toString('ascii', 8, 12) !== 'WAVE') throw fail('阿里云返回的音频不是有效的 WAV 文件，请在百炼后台检查本次结果。');
      return audio;
    },
  };
}

import { createServer } from 'node:http';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const AI_DIR = path.join(__dirname, 'ai');
const PORT = Number(process.env.PORT || 3000);
const HOST = process.env.HOST || '127.0.0.1';
const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';

const SERVER_CONFIG = {
  aliyunApiKey: process.env.ALIYUN_API_KEY || '',
  volcAppKey: process.env.VOLCENGINE_APP_KEY || '',
  volcAccessKey: process.env.VOLCENGINE_ACCESS_KEY || '',
  volcSpeakerId: process.env.VOLCENGINE_SPEAKER_ID || ''
};

const MIME_TYPES = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.md': 'text/markdown; charset=utf-8',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.svg': 'image/svg+xml',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function getAllowedOrigin(origin) {
  if (!origin) return '*';
  if (CORS_ALLOW_ORIGIN === '*') return '*';

  const allowedOrigins = CORS_ALLOW_ORIGIN
    .split(',')
    .map((item) => item.trim())
    .filter(Boolean);

  if (allowedOrigins.includes(origin)) return origin;
  return allowedOrigins[0] || 'null';
}

function setCorsHeaders(req, res) {
  const origin = req.headers.origin;
  const allowedOrigin = getAllowedOrigin(origin);
  res.setHeader('Access-Control-Allow-Origin', allowedOrigin);
  res.setHeader('Vary', 'Origin');
  res.setHeader('Access-Control-Allow-Methods', 'GET,HEAD,POST,OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
}

function readValue(...candidates) {
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeAliyunPreferredName(value) {
  const cleaned = String(value || '')
    .toLowerCase()
    .replace(/[^a-z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 32);

  if (cleaned.length >= 3) return cleaned;
  return `voice_${Date.now().toString(36)}`;
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 20 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        resolve(body ? JSON.parse(body) : {});
      } catch {
        reject(new Error('请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

function buildWaveFromPcm(pcmBuffer, sampleRate = 24000, channels = 1, bitsPerSample = 16) {
  const byteRate = sampleRate * channels * bitsPerSample / 8;
  const blockAlign = channels * bitsPerSample / 8;
  const header = Buffer.alloc(44);

  header.write('RIFF', 0);
  header.writeUInt32LE(36 + pcmBuffer.length, 4);
  header.write('WAVE', 8);
  header.write('fmt ', 12);
  header.writeUInt32LE(16, 16);
  header.writeUInt16LE(1, 20);
  header.writeUInt16LE(channels, 22);
  header.writeUInt32LE(sampleRate, 24);
  header.writeUInt32LE(byteRate, 28);
  header.writeUInt16LE(blockAlign, 32);
  header.writeUInt16LE(bitsPerSample, 34);
  header.write('data', 36);
  header.writeUInt32LE(pcmBuffer.length, 40);

  return Buffer.concat([header, pcmBuffer]);
}

const VOLC_EVENT = {
  START_CONNECTION: 1,
  FINISH_CONNECTION: 2,
  CONNECTION_STARTED: 50,
  CONNECTION_FAILED: 51,
  CONNECTION_FINISHED: 52,
  START_SESSION: 100,
  CANCEL_SESSION: 101,
  FINISH_SESSION: 102,
  SESSION_STARTED: 150,
  SESSION_CANCELED: 151,
  SESSION_FINISHED: 152,
  SESSION_FAILED: 153,
  TASK_REQUEST: 200,
  TTS_SENTENCE_START: 350,
  TTS_SENTENCE_END: 351,
  TTS_RESPONSE: 352
};

function uint32be(num) {
  const buf = Buffer.alloc(4);
  buf.writeUInt32BE(num >>> 0, 0);
  return buf;
}

function int32be(num) {
  const buf = Buffer.alloc(4);
  buf.writeInt32BE(num, 0);
  return buf;
}

function buildVolcJsonFrame(eventCode, payload = {}, sessionId = '') {
  const header = Buffer.from([0x11, 0x14, 0x10, 0x00]);
  const payloadBuf = Buffer.from(JSON.stringify(payload), 'utf8');
  const parts = [header, int32be(eventCode)];

  if (sessionId) {
    const sessionBuf = Buffer.from(sessionId, 'utf8');
    parts.push(uint32be(sessionBuf.length), sessionBuf);
  }

  parts.push(uint32be(payloadBuf.length), payloadBuf);
  return Buffer.concat(parts);
}

function parseVolcFrame(buffer) {
  const messageType = buffer[1] >> 4;
  const hasEvent = (buffer[1] & 0x0f) === 0x04;
  const serialization = buffer[2] >> 4;

  if (messageType === 0x0f) {
    const errorCode = buffer.readUInt32BE(4);
    const payload = buffer.subarray(8).toString('utf8');
    let message = payload;
    try {
      const parsed = JSON.parse(payload);
      message = parsed.message || payload;
    } catch {}
    return { kind: 'error', errorCode, message };
  }

  let offset = 4;
  let eventCode = null;
  if (hasEvent) {
    eventCode = buffer.readInt32BE(offset);
    offset += 4;
  }

  let identifier = '';
  if (messageType === 0x09 || messageType === 0x0b) {
    const idLen = buffer.readUInt32BE(offset);
    offset += 4;
    identifier = buffer.subarray(offset, offset + idLen).toString('utf8');
    offset += idLen;
  }

  const payloadLen = buffer.readUInt32BE(offset);
  offset += 4;
  const payload = buffer.subarray(offset, offset + payloadLen);

  if (messageType === 0x0b) {
    return {
      kind: 'audio',
      eventCode,
      identifier,
      payload
    };
  }

  let json = null;
  if (serialization === 0x01) {
    try {
      json = JSON.parse(payload.toString('utf8'));
    } catch {}
  }

  return {
    kind: 'json',
    eventCode,
    identifier,
    payload,
    json
  };
}

function connectAliyunRealtime({ apiKey, model, voice, text }) {
  return new Promise((resolve, reject) => {
    const url = `wss://dashscope.aliyuncs.com/api-ws/v1/realtime?model=${encodeURIComponent(model)}`;
    const ws = new WebSocket(url, {
      headers: {
        Authorization: `Bearer ${apiKey}`
      }
    });

    const audioChunks = [];
    let closed = false;
    let responseDone = false;
    let sessionFinished = false;

    const finishIfReady = () => {
      if (closed || !responseDone || !sessionFinished) return;
      closed = true;
      try {
        ws.close();
      } catch {}
      resolve(Buffer.concat(audioChunks));
    };

    const fail = (error) => {
      if (closed) return;
      closed = true;
      try {
        ws.close();
      } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    const sendEvent = (event) => {
      event.event_id = `event_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      ws.send(JSON.stringify(event));
    };

    ws.on('open', () => {
      sendEvent({
        type: 'session.update',
        session: {
          mode: 'commit',
          voice,
          language_type: 'Auto',
          response_format: 'pcm',
          sample_rate: 24000
        }
      });

      sendEvent({
        type: 'input_text_buffer.append',
        text
      });

      sendEvent({
        type: 'input_text_buffer.commit'
      });

      sendEvent({
        type: 'session.finish'
      });
    });

    ws.on('message', (raw) => {
      try {
        const event = JSON.parse(raw.toString());
        const type = event.type;
        if (type === 'error') {
          const message = event.error?.message || event.message || '阿里云 TTS 返回错误';
          fail(new Error(message));
          return;
        }
        if (type === 'response.audio.delta' && event.delta) {
          audioChunks.push(Buffer.from(event.delta, 'base64'));
          return;
        }
        if (type === 'response.done') {
          responseDone = true;
          finishIfReady();
          return;
        }
        if (type === 'session.finished') {
          sessionFinished = true;
          finishIfReady();
        }
      } catch (error) {
        fail(error);
      }
    });

    ws.on('error', fail);
    ws.on('close', () => {
      if (!closed && (!responseDone || !sessionFinished)) {
        fail(new Error('阿里云 WebSocket 连接意外关闭'));
      }
    });
  });
}

async function handleAliyunTts(req, res) {
  try {
    const body = await readRequestBody(req);
    const { apiKey, model, voice, text } = body;
    const resolvedApiKey = readValue(apiKey, SERVER_CONFIG.aliyunApiKey);

    if (!resolvedApiKey || !model || !voice || !text) {
      sendJson(res, 400, { error: '缺少阿里云 API Key、model、voice 或 text' });
      return;
    }

    const pcmBuffer = await connectAliyunRealtime({ apiKey: resolvedApiKey, model, voice, text });
    const wavBuffer = buildWaveFromPcm(pcmBuffer, 24000, 1, 16);

    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Length': wavBuffer.length,
      'Cache-Control': 'no-store'
    });
    res.end(wavBuffer);
  } catch (error) {
    sendJson(res, 500, { error: error.message || '阿里云语音生成失败' });
  }
}

async function handleAliyunVoiceCreate(req, res) {
  try {
    const body = await readRequestBody(req);
    const { apiKey, targetModel, preferredName, audioData } = body;
    const resolvedApiKey = readValue(apiKey, SERVER_CONFIG.aliyunApiKey);
    const normalizedPreferredName = normalizeAliyunPreferredName(preferredName);

    if (!resolvedApiKey || !targetModel || !audioData) {
      sendJson(res, 400, { error: '缺少阿里云 API Key、targetModel 或 audioData' });
      return;
    }

    const upstreamRes = await fetch('https://dashscope.aliyuncs.com/api/v1/services/audio/tts/customization', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'qwen-voice-enrollment',
        input: {
          action: 'create',
          target_model: targetModel,
          preferred_name: normalizedPreferredName,
          audio: {
            data: audioData
          }
        }
      })
    });

    const json = await upstreamRes.json();
    if (!upstreamRes.ok) {
      sendJson(res, upstreamRes.status, {
        error: json.message || json.code || '阿里云创建音色失败',
        raw: json
      });
      return;
    }

    sendJson(res, 200, json);
  } catch (error) {
    sendJson(res, 500, { error: error.message || '阿里云创建音色失败' });
  }
}

async function volcJsonRequest(pathname, { appKey, accessKey, body }) {
  const response = await fetch(`https://openspeech.bytedance.com${pathname}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Api-App-Key': appKey,
      'X-Api-Access-Key': accessKey,
      'X-Api-Request-Id': `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
    },
    body: JSON.stringify(body)
  });

  const json = await response.json();
  if (!response.ok) {
    throw new Error(json.message || json.code || '火山接口请求失败');
  }
  return json;
}

async function resolveVolcResourceId({ appKey, accessKey, speakerId, requestedResourceId }) {
  const getAvailableModelTypes = async () => {
    const voiceInfo = await volcJsonRequest('/api/v3/tts/get_voice', {
      appKey,
      accessKey,
      body: { speaker_id: speakerId }
    });
    const statuses = Array.isArray(voiceInfo.speaker_status) ? voiceInfo.speaker_status : [];
    return {
      speakerStatus: statuses,
      modelTypes: statuses
        .map((item) => item.model_type)
        .filter((value) => typeof value === 'number')
    };
  };

  const debug = {
    requestedResourceId,
    upgradeCalled: false,
    beforeUpgrade: null,
    afterUpgrade: null,
    resolvedResourceId: null,
    parsedModelTypes: []
  };

  const before = await getAvailableModelTypes();
  debug.beforeUpgrade = before.speakerStatus;
  let availableModelTypes = before.modelTypes;

  if (!availableModelTypes.length) {
    await volcJsonRequest('/api/v3/tts/upgrade_voice', {
      appKey,
      accessKey,
      body: { speaker_id: speakerId }
    });
    debug.upgradeCalled = true;
    const after = await getAvailableModelTypes();
    debug.afterUpgrade = after.speakerStatus;
    availableModelTypes = after.modelTypes;
  }

  if (!availableModelTypes.length) {
    const error = new Error('火山未返回该音色可用的 model_type，暂时无法判断对应资源版本');
    error.debug = debug;
    throw error;
  }

  debug.parsedModelTypes = availableModelTypes;
  const requestedModelType = requestedResourceId === 'seed-icl-2.0' ? 4 : 1;
  if (availableModelTypes.includes(requestedModelType)) {
    debug.resolvedResourceId = requestedResourceId;
    return debug;
  }

  if (availableModelTypes.includes(4)) {
    debug.resolvedResourceId = 'seed-icl-2.0';
    return debug;
  }

  if (availableModelTypes.includes(1) || availableModelTypes.includes(2) || availableModelTypes.includes(3)) {
    debug.resolvedResourceId = 'seed-icl-1.0';
    return debug;
  }

  const error = new Error(`当前 speaker_id 可用 model_type 为 ${availableModelTypes.join(', ')}，未匹配到可支持的 resourceId`);
  error.debug = debug;
  throw error;
}

function connectVolcTts({ appKey, accessKey, speakerId, text, resourceId = 'seed-icl-2.0' }) {
  return new Promise((resolve, reject) => {
    const ws = new WebSocket('wss://openspeech.bytedance.com/api/v3/tts/bidirection', {
      headers: {
        'X-Api-App-Key': appKey,
        'X-Api-Access-Key': accessKey,
        'X-Api-Resource-Id': resourceId,
        'X-Api-Connect-Id': `connect_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      }
    });

    const sessionId = `session_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
    const audioChunks = [];
    let settled = false;

    const finish = (buffer) => {
      if (settled) return;
      settled = true;
      try {
        ws.send(buildVolcJsonFrame(VOLC_EVENT.FINISH_CONNECTION, {}));
      } catch {}
      try {
        ws.close();
      } catch {}
      resolve(buffer);
    };

    const fail = (error) => {
      if (settled) return;
      settled = true;
      try {
        ws.close();
      } catch {}
      reject(error instanceof Error ? error : new Error(String(error)));
    };

    ws.on('open', () => {
      ws.send(buildVolcJsonFrame(VOLC_EVENT.START_CONNECTION, {}));
    });

    ws.on('message', (raw) => {
      try {
        const frame = parseVolcFrame(Buffer.from(raw));

        if (frame.kind === 'error') {
          fail(new Error(`火山引擎错误 ${frame.errorCode}: ${frame.message}`));
          return;
        }

        if (frame.kind === 'json') {
          if (frame.eventCode === VOLC_EVENT.CONNECTION_STARTED) {
            ws.send(buildVolcJsonFrame(VOLC_EVENT.START_SESSION, {
              user: { uid: 'liangsousou' },
              event: VOLC_EVENT.START_SESSION,
              req_params: {
                speaker: speakerId,
                audio_params: {
                  format: 'pcm',
                  sample_rate: 24000
                }
              }
            }, sessionId));
            return;
          }

          if (frame.eventCode === VOLC_EVENT.SESSION_STARTED) {
            ws.send(buildVolcJsonFrame(VOLC_EVENT.TASK_REQUEST, {
              req_params: {
                text
              }
            }, sessionId));
            ws.send(buildVolcJsonFrame(VOLC_EVENT.FINISH_SESSION, {}, sessionId));
            return;
          }

          if (frame.eventCode === VOLC_EVENT.SESSION_FAILED) {
            const message = frame.json?.message || '火山会话失败';
            fail(new Error(message));
            return;
          }

          if (frame.eventCode === VOLC_EVENT.SESSION_FINISHED) {
            finish(Buffer.concat(audioChunks));
          }

          return;
        }

        if (frame.kind === 'audio' && frame.eventCode === VOLC_EVENT.TTS_RESPONSE) {
          audioChunks.push(frame.payload);
        }
      } catch (error) {
        fail(error);
      }
    });

    ws.on('error', fail);
    ws.on('close', () => {
      if (!settled) {
        fail(new Error('火山引擎连接意外关闭'));
      }
    });
  });
}

async function handleVolcTts(req, res) {
  let debug = null;
  try {
    const body = await readRequestBody(req);
    const { appKey, accessKey, speakerId, text, resourceId, speakerSource } = body;
    const resolvedAppKey = readValue(appKey, SERVER_CONFIG.volcAppKey);
    const resolvedAccessKey = readValue(accessKey, SERVER_CONFIG.volcAccessKey);
    const resolvedSpeakerId = readValue(speakerId, SERVER_CONFIG.volcSpeakerId);

    if (!resolvedAppKey || !resolvedAccessKey || !resolvedSpeakerId || !text) {
      sendJson(res, 400, { error: '缺少火山引擎 App Key、Access Key、Speaker ID 或 text' });
      return;
    }

    debug = {
      speakerId: resolvedSpeakerId,
      speakerSource: speakerSource || 'unknown',
      requestedResourceId: resourceId || 'seed-icl-2.0',
      getVoiceSpeakerStatus: null,
      parsedModelTypes: [],
      finalResourceId: null,
      upgradeCalled: false,
      beforeUpgrade: null,
      afterUpgrade: null,
      volcError: null
    };

    const resolution = await resolveVolcResourceId({
      appKey: resolvedAppKey,
      accessKey: resolvedAccessKey,
      speakerId: resolvedSpeakerId,
      requestedResourceId: resourceId || 'seed-icl-2.0'
    });
    debug.getVoiceSpeakerStatus = resolution.afterUpgrade || resolution.beforeUpgrade || [];
    debug.parsedModelTypes = resolution.parsedModelTypes;
    debug.finalResourceId = resolution.resolvedResourceId;
    debug.upgradeCalled = resolution.upgradeCalled;
    debug.beforeUpgrade = resolution.beforeUpgrade;
    debug.afterUpgrade = resolution.afterUpgrade;

    const pcmBuffer = await connectVolcTts({
      appKey: resolvedAppKey,
      accessKey: resolvedAccessKey,
      speakerId: resolvedSpeakerId,
      text,
      resourceId: resolution.resolvedResourceId
    });
    const wavBuffer = buildWaveFromPcm(pcmBuffer, 24000, 1, 16);

    res.writeHead(200, {
      'Content-Type': 'audio/wav',
      'Content-Length': wavBuffer.length,
      'Cache-Control': 'no-store'
    });
    res.end(wavBuffer);
  } catch (error) {
    sendJson(res, 500, {
      error: error.message || '火山语音生成失败',
      debug: {
        speakerId: error.debug?.speakerId || debug?.speakerId,
        speakerSource: error.debug?.speakerSource || debug?.speakerSource,
        getVoiceSpeakerStatus: error.debug?.getVoiceSpeakerStatus || debug?.getVoiceSpeakerStatus,
        parsedModelTypes: error.debug?.parsedModelTypes || debug?.parsedModelTypes,
        finalResourceId: error.debug?.finalResourceId || debug?.finalResourceId,
        upgradeCalled: typeof error.debug?.upgradeCalled === 'boolean' ? error.debug.upgradeCalled : debug?.upgradeCalled,
        beforeUpgrade: error.debug?.beforeUpgrade || debug?.beforeUpgrade,
        afterUpgrade: error.debug?.afterUpgrade || debug?.afterUpgrade,
        requestedResourceId: error.debug?.requestedResourceId || debug?.requestedResourceId,
        volcError: error.message || '火山语音生成失败'
      }
    });
  }
}

async function handleVolcVoiceClone(req, res) {
  const upstreamUrl = 'https://openspeech.bytedance.com/api/v3/tts/voice_clone';
  try {
    const body = await readRequestBody(req);
    const { speakerId, resourceId, audioData, audioFormat } = body;
    const resolvedAppKey = readValue(SERVER_CONFIG.volcAppKey);
    const resolvedAccessKey = readValue(SERVER_CONFIG.volcAccessKey);
    const resolvedSpeakerId = readValue(speakerId, SERVER_CONFIG.volcSpeakerId);
    const debugFlags = {
      hasEnvAppKey: !!resolvedAppKey,
      hasEnvAccessKey: !!resolvedAccessKey,
      hasEnvSpeakerId: !!readValue(SERVER_CONFIG.volcSpeakerId),
      hasBodySpeakerId: !!readValue(speakerId),
      hasBodyAudioData: typeof audioData === 'string' && audioData.length > 0,
      hasBodyResourceId: typeof resourceId === 'string' && resourceId.length > 0,
      hasBodyAudioFormat: typeof audioFormat === 'string' && audioFormat.length > 0,
      contentType: req.headers['content-type'] || '',
      bodyKeys: body && typeof body === 'object' ? Object.keys(body) : []
    };

    console.error('[volc voice clone] incoming request summary', debugFlags);

    if (!debugFlags.hasEnvAppKey) {
      sendJson(res, 400, { error: '缺少服务端环境变量 VOLCENGINE_APP_KEY', debug: debugFlags });
      return;
    }

    if (!debugFlags.hasEnvAccessKey) {
      sendJson(res, 400, { error: '缺少服务端环境变量 VOLCENGINE_ACCESS_KEY', debug: debugFlags });
      return;
    }

    if (!resolvedSpeakerId) {
      sendJson(res, 400, { error: '缺少 speakerId：前端 body.speakerId 与服务端 VOLCENGINE_SPEAKER_ID 都未提供', debug: debugFlags });
      return;
    }

    if (!debugFlags.hasBodyAudioData) {
      sendJson(res, 400, { error: '缺少 body.audioData，或音频数据为空', debug: debugFlags });
      return;
    }

    const response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-App-Key': resolvedAppKey,
        'X-Api-Access-Key': resolvedAccessKey,
        'X-Api-Request-Id': `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      },
      body: JSON.stringify({
        speaker_id: resolvedSpeakerId,
        audio: {
          data: audioData,
          format: audioFormat || 'wav'
        },
        language: 0,
        model_types: [resourceId === 'seed-icl-2.0' ? 4 : 1],
        extra_params: {
          demo_text: '你好，这是火山引擎试听文本。'
        }
      })
    });

    const responseText = await response.text();
    let json = null;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {}

    if (!response.ok) {
      console.error('[volc voice clone] upstream non-200 response', {
        url: upstreamUrl,
        status: response.status,
        body: responseText
      });
      sendJson(res, response.status, {
        error: json?.message || json?.code || `火山引擎训练请求失败，上游状态码 ${response.status}`,
        debug: {
          upstreamUrl,
          upstreamStatus: response.status,
          upstreamBody: responseText
        }
      });
      return;
    }

    sendJson(res, 200, json || { raw: responseText });
  } catch (error) {
    console.error('[volc voice clone] fetch error', {
      url: upstreamUrl,
      message: error.message,
      stack: error.stack
    });
    const isBodyParseOrSizeError =
      error.message === '请求体不是合法 JSON' ||
      error.message === '请求体过大';
    sendJson(res, 500, {
      error: isBodyParseOrSizeError ? error.message : (error.message || '火山引擎训练请求失败'),
      debug: {
        upstreamUrl,
        fetchMessage: error.message || '',
        fetchStack: error.stack || '',
        contentType: req.headers['content-type'] || ''
      }
    });
  }
}

async function serveStatic(req, res, pathname) {
  let targetPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(AI_DIR, targetPath));

  if (!filePath.startsWith(AI_DIR)) {
    sendJson(res, 403, { error: '禁止访问' });
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) {
      return serveStatic(req, res, path.join(targetPath, 'index.html'));
    }
    const content = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, { 'Content-Type': MIME_TYPES[ext] || 'application/octet-stream' });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: '文件不存在' });
  }
}

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);
  setCorsHeaders(req, res);

  if (req.method === 'OPTIONS') {
    res.writeHead(204);
    res.end();
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tts/aliyun') {
    await handleAliyunTts(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/voice/aliyun') {
    await handleAliyunVoiceCreate(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tts/volcengine') {
    await handleVolcTts(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/voice/volcengine') {
    await handleVolcVoiceClone(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: '方法不被支持' });
    return;
  }

  await serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  console.log(`Server running at http://${HOST}:${PORT}`);
});

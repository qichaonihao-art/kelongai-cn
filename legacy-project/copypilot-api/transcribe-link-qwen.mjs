import { extractByUrl, json } from './_tikhub.js';
import { execFile } from 'node:child_process';
import { mkdtemp, readFile, rename, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const QWEN_ASR_MODEL = 'qwen3-asr-flash';
const QWEN_ASR_URL = 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions';
const MAX_AUDIO_DURATION_SECONDS = 600;
const FFMPEG_TIMEOUT_MS = 120_000;
const FFMPEG_RACE_TIMEOUT_MS = 75_000;
const AUDIO_RACE_CONCURRENCY = 3;
const AUDIO_RACE_MAX_URLS = 8;
const AUDIO_RACE_STAGGER_MS = 700;
const QWEN_TIMEOUT_MS = 420_000;
const QWEN_STREAM_TIMEOUT_MS = 420_000;
const TRANSCRIPT_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const transcriptCache = new Map();

async function extractAudioFromUrl(videoUrl, outputPath, { signal, timeoutMs = FFMPEG_TIMEOUT_MS } = {}) {
  const headers = [
    'Referer: https://www.douyin.com/',
    'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36',
  ].join('\r\n') + '\r\n';

  const { stdout, stderr } = await execFileAsync('ffmpeg', [
    '-y',
    '-nostdin',
    '-hide_banner',
    '-loglevel', 'warning',
    '-headers', headers,
    '-rw_timeout', '15000000',
    '-reconnect', '1',
    '-reconnect_streamed', '1',
    '-reconnect_delay_max', '2',
    '-analyzeduration', '1000000',
    '-probesize', '1000000',
    '-i', videoUrl,
    '-map', '0:a:0',
    '-vn',
    '-ar', '16000',
    '-ac', '1',
    '-b:a', '32k',
    '-f', 'mp3',
    '-t', String(MAX_AUDIO_DURATION_SECONDS),
    outputPath,
  ], {
    timeout: timeoutMs,
    signal,
    maxBuffer: 512 * 1024
  });

  return { stdout, stderr };
}

async function transcribeWithQwenOnce(audioPath) {
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.ALIYUN_API_KEY || '';
  if (!apiKey) {
    throw new Error('服务端未配置 DashScope API Key');
  }

  const audioBuffer = await readFile(audioPath);
  const base64Audio = audioBuffer.toString('base64');
  const dataUri = `data:audio/mp3;base64,${base64Audio}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QWEN_TIMEOUT_MS);

  try {
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

    const responseText = await response.text();
    let responseJson;
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }

    if (!response.ok) {
      const errorMsg = responseJson?.error?.message || responseJson?.message || `HTTP ${response.status}`;
      throw new Error(`千问 ASR 返回错误：${errorMsg}`);
    }

    return responseJson?.choices?.[0]?.message?.content || '';
  } finally {
    clearTimeout(timeoutId);
  }
}

function extractQwenStreamText(payload) {
  const choice = payload?.choices?.[0];
  const candidates = [
    choice?.delta?.content,
    choice?.message?.content,
    choice?.delta?.content?.[0]?.text,
    choice?.message?.content?.[0]?.text,
  ];

  for (const value of candidates) {
    if (typeof value === 'string') return value;
  }
  return '';
}

async function transcribeWithQwenStream(audioPath, { requestId = '', onDelta } = {}) {
  const apiKey = process.env.DASHSCOPE_API_KEY || process.env.ALIYUN_API_KEY || '';
  if (!apiKey) {
    throw new Error('服务端未配置 DashScope API Key');
  }

  const audioBuffer = await readFile(audioPath);
  const base64Audio = audioBuffer.toString('base64');
  const dataUri = `data:audio/mp3;base64,${base64Audio}`;

  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), QWEN_STREAM_TIMEOUT_MS);

  try {
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
        stream: true,
        asr_options: {
          language: 'zh',
          enable_itn: false
        }
      })
    });

    if (!response.ok) {
      const responseText = await response.text();
      let responseJson = null;
      try {
        responseJson = JSON.parse(responseText);
      } catch {
        // keep raw text below
      }
      const errorMsg = responseJson?.error?.message || responseJson?.message || responseText || `HTTP ${response.status}`;
      throw new Error(`千问 ASR 流式返回错误：${errorMsg}`);
    }

    if (!response.body) {
      throw new Error('千问 ASR 未返回流式内容');
    }

    const reader = response.body.getReader();
    const decoder = new TextDecoder();
    let buffer = '';
    let transcript = '';

    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });

      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || '';

      for (const line of lines) {
        const trimmed = line.trim();
        if (!trimmed.startsWith('data:')) continue;
        const data = trimmed.slice(5).trim();
        if (!data || data === '[DONE]') continue;

        let payload = null;
        try {
          payload = JSON.parse(data);
        } catch {
          console.warn(`[${requestId}] ignored malformed Qwen ASR stream chunk:`, data.slice(0, 120));
          continue;
        }

        const text = extractQwenStreamText(payload);
        if (!text) continue;
        transcript += text;
        onDelta?.(transcript);
      }
    }

    const finalTranscript = transcript.trim();
    if (!finalTranscript) {
      throw new Error('千问 ASR 流式返回了空文本');
    }
    return finalTranscript;
  } finally {
    clearTimeout(timeoutId);
  }
}

async function transcribeWithQwen(audioPath, requestId = '') {
  let lastError = null;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    try {
      if (attempt > 1) {
        console.log(`[${requestId}] retrying Qwen ASR, attempt ${attempt}`);
      }
      const transcript = await transcribeWithQwenOnce(audioPath);
      if (!String(transcript || '').trim()) {
        throw new Error('千问 ASR 返回了空文本');
      }
      return transcript;
    } catch (error) {
      lastError = error;
      console.error(`[${requestId}] Qwen ASR attempt ${attempt} failed:`, error.message);
      if (attempt < 2) {
        await new Promise((resolve) => setTimeout(resolve, 1200));
      }
    }
  }
  throw lastError || new Error('千问 ASR 转写失败');
}

function getCachedTranscript(cacheKey) {
  if (!cacheKey) return null;
  const cached = transcriptCache.get(cacheKey);
  if (!cached) return null;
  if (Date.now() - cached.createdAt > TRANSCRIPT_CACHE_TTL_MS) {
    transcriptCache.delete(cacheKey);
    return null;
  }
  return cached;
}

function setCachedTranscript(cacheKey, transcript) {
  if (!cacheKey || !String(transcript || '').trim()) return;
  transcriptCache.set(cacheKey, {
    transcript,
    createdAt: Date.now()
  });
}

function getTranscriptCacheKey(url, sourceData) {
  const detail = sourceData?.aweme_detail || sourceData?.itemInfo?.itemStruct || sourceData?.note || sourceData || {};
  const id = detail?.aweme_id || detail?.video_id || detail?.id || sourceData?.aweme_id || sourceData?.id;
  return String(id || url || '').trim();
}

function isStreamingRequested(request, body) {
  const accept = String(request.headers.get('accept') || '').toLowerCase();
  return body?.stream === true || String(body?.stream || '').toLowerCase() === 'true' || accept.includes('text/event-stream');
}

function createSseJsonResponse(run) {
  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      let closed = false;
      const send = (event, payload = {}) => {
        if (closed) return;
        controller.enqueue(encoder.encode(`event: ${event}\ndata: ${JSON.stringify(payload)}\n\n`));
      };

      try {
        const result = await run(send);
        send('result', result);
        send('done', {});
      } catch (error) {
        send('error', { message: error?.message || '转写失败' });
      } finally {
        closed = true;
        controller.close();
      }
    }
  });

  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache, no-transform',
      'Connection': 'keep-alive',
      'X-Accel-Buffering': 'no'
    }
  });
}

async function buildTranscriptionPayload({ body, url, env, requestId, emit }) {
  const tikhubKey = env.TIKHUB_API_KEY;
  const tikhubBaseUrl = env.TIKHUB_BASE_URL || 'https://api.tikhub.io';

  if (!tikhubKey) {
    const error = new Error('提取服务暂未配置完成。');
    error.status = 500;
    throw error;
  }

  const providedSourceData = body.sourceData && typeof body.sourceData === 'object' ? body.sourceData : null;

  console.log(`[${requestId}] transcribe-link-qwen started`, {
    url: url.slice(0, 80),
    hasProvidedSourceData: !!providedSourceData,
    hasProvidedVideoUrl: typeof body.videoUrl === 'string' && body.videoUrl.length > 0,
    stream: !!emit
  });

  const tempDir = await mkdtemp(join(tmpdir(), 'cp-qwen-'));

  try {
    // 1. Reuse already parsed data from the page when available. This avoids a
    // second TikHub request after the user has already clicked "解析视频".
    let sourceData = providedSourceData;
    if (sourceData) {
      emit?.('status', { stage: 'source', message: '已复用解析结果，跳过二次解析' });
      console.log(`[${requestId}] step 1: using provided source data, keys:`, Object.keys(sourceData || {}).slice(0, 10));
    } else {
      emit?.('status', { stage: 'source', message: '正在解析视频信息' });
      console.log(`[${requestId}] step 1: extracting video info via TikHub`);
      try {
        sourceData = await extractByUrl({ apiKey: tikhubKey, baseUrl: tikhubBaseUrl, url });
      } catch (extractError) {
        console.error(`[${requestId}] TikHub extract failed:`, extractError.message);
        const error = new Error(`视频解析失败：${extractError.message}`);
        error.status = 502;
        throw error;
      }
      console.log(`[${requestId}] TikHub extract success, data keys:`, Object.keys(sourceData || {}).slice(0, 10));
    }

    // 2. Get video URL. Do not use subtitles or platform captions as transcript:
    // they are often incomplete or rewritten, so this endpoint always uses Qwen ASR.
    emit?.('status', { stage: 'download', message: '正在选择最快的视频源' });
    console.log(`[${requestId}] step 2: extracting video URLs for Qwen ASR`);
    const videoUrls = getVideoLinks(sourceData, body);
    console.log(`[${requestId}] video URLs found:`, videoUrls.length);
    if (!videoUrls.length) {
      console.error(`[${requestId}] no video URLs in response`, { dataKeys: Object.keys(sourceData || {}) });
      const error = new Error('已解析作品信息，但没有拿到可转写的视频源。');
      error.status = 502;
      error.data = sourceData;
      throw error;
    }

    const cacheKey = getTranscriptCacheKey(url, sourceData);
    const cachedTranscript = getCachedTranscript(cacheKey);
    if (cachedTranscript) {
      console.log(`[${requestId}] transcript cache hit`);
      emit?.('delta', { text: cachedTranscript.transcript, fullText: cachedTranscript.transcript, cached: true });
      return {
        ok: true,
        data: {
          ...sourceData,
          text: cachedTranscript.transcript,
          transcript: cachedTranscript.transcript,
          publishedText: getPublishedText(sourceData),
          transcriptSource: 'qwen-asr-cache'
        }
      };
    }

    // 3. Extract audio directly from URL with FFmpeg
    emit?.('status', { stage: 'extract_audio', message: '正在提取音频' });
    console.log(`[${requestId}] step 3: extracting audio with FFmpeg`);
    const audioPath = join(tempDir, 'audio.mp3');
    await extractAudioFromFirstWorkingUrl({
      videoUrls,
      audioPath,
      requestId
    });

    // 4. Transcribe with Qwen ASR
    let transcript = '';
    if (emit) {
      emit('status', { stage: 'asr', message: '千问 ASR 正在流式转写' });
      console.log(`[${requestId}] step 4: transcribing with streaming Qwen ASR`);
      try {
        transcript = await transcribeWithQwenStream(audioPath, {
          requestId,
          onDelta: (fullText) => emit('delta', { text: fullText, fullText })
        });
      } catch (streamError) {
        console.error(`[${requestId}] streaming Qwen ASR failed, fallback to non-stream:`, streamError.message);
        emit('status', { stage: 'asr-fallback', message: '流式转写不稳定，正在切换稳妥模式' });
        transcript = await transcribeWithQwen(audioPath, requestId);
        emit('delta', { text: transcript, fullText: transcript });
      }
    } else {
      console.log(`[${requestId}] step 4: transcribing with Qwen ASR`);
      transcript = await transcribeWithQwen(audioPath, requestId);
    }

    console.log(`[${requestId}] Qwen ASR success, transcript length:`, transcript.length);
    setCachedTranscript(cacheKey, transcript);

    const publishedText = getPublishedText(sourceData);

    return {
      ok: true,
      data: {
        ...sourceData,
        text: transcript,
        transcript: transcript,
        publishedText,
        transcriptSource: emit ? 'qwen-asr-stream' : 'qwen-asr'
      }
    };
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
    console.log(`[${requestId}] cleanup done`);
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ ok: false, message: '请求格式不正确。' }, 400);
  }

  const url = String(body.url || '').trim();
  if (!url) return json({ ok: false, message: '缺少作品链接。' }, 400);

  const requestId = `cp_qwen_${Date.now().toString(36)}`;

  if (isStreamingRequested(request, body)) {
    return createSseJsonResponse((emit) => buildTranscriptionPayload({ body, url, env, requestId, emit }));
  }

  try {
    const payload = await buildTranscriptionPayload({ body, url, env, requestId });
    return json(payload);
  } catch (error) {
    console.error(`[${requestId}] transcribe-link-qwen failed:`, error.message);
    return json({
      ok: false,
      message: error.message || '转写失败',
      ...(error.data ? { data: error.data } : {})
    }, error.status || 502);
  }
}

async function extractAudioFromFirstWorkingUrl({ videoUrls, audioPath, requestId }) {
  const urls = videoUrls.slice(0, AUDIO_RACE_MAX_URLS);
  let lastError = null;
  let nextIndex = 0;
  let resolved = false;
  const controllers = new Set();
  let resolveWinner;
  const winnerPromise = new Promise((resolve) => {
    resolveWinner = resolve;
  });

  const cleanupCandidateAudio = async (path) => {
    if (!path || path === audioPath) return;
    await rm(path, { force: true }).catch(() => {});
  };

  const tryCandidate = async (index) => {
    const videoUrl = urls[index];
    const candidateAudioPath = `${audioPath}.${index}.part.mp3`;
    const controller = new AbortController();
    controllers.add(controller);

    console.log(`[${requestId}] trying video URL ${index + 1}/${urls.length}:`, videoUrl.slice(0, 120));
    try {
      const { stderr } = await extractAudioFromUrl(videoUrl, candidateAudioPath, {
        signal: controller.signal,
        timeoutMs: FFMPEG_RACE_TIMEOUT_MS
      });
      const audioStats = await readFile(candidateAudioPath).then((b) => ({ size: b.length }));
      if (!audioStats.size || audioStats.size < 1024) {
        throw new Error(`音频文件过小：${audioStats.size || 0} bytes`);
      }
      console.log(`[${requestId}] FFmpeg success from URL ${index + 1}, audio size: ${audioStats.size} bytes`);
      if (stderr) {
        console.log(`[${requestId}] FFmpeg stderr:`, stderr.slice(0, 500));
      }
      return { index, candidateAudioPath };
    } catch (error) {
      await cleanupCandidateAudio(candidateAudioPath);
      if (controller.signal.aborted) {
        throw new Error('已被更快的视频源取消');
      }
      throw error;
    } finally {
      controllers.delete(controller);
    }
  };

  const runWorker = async (workerIndex) => {
    if (workerIndex > 0) {
      await new Promise((resolve) => setTimeout(resolve, workerIndex * AUDIO_RACE_STAGGER_MS));
    }

    while (!resolved && nextIndex < urls.length) {
      const index = nextIndex;
      nextIndex += 1;
      try {
        const result = await tryCandidate(index);
        if (resolved) {
          await cleanupCandidateAudio(result.candidateAudioPath);
          return null;
        }
        resolved = true;
        resolveWinner(result);
        return result;
      } catch (error) {
        lastError = error;
        console.error(`[${requestId}] FFmpeg URL ${index + 1} failed:`, error.message);
      }
    }
    return null;
  };

  const workerCount = Math.min(AUDIO_RACE_CONCURRENCY, urls.length);
  const workers = Array.from({ length: workerCount }, (_, index) => runWorker(index));
  const allWorkersDone = Promise.allSettled(workers).then(() => null);
  const winner = await Promise.race([winnerPromise, allWorkersDone]);

  if (winner?.candidateAudioPath) {
    resolved = true;
    for (const controller of controllers) controller.abort();
    await rename(winner.candidateAudioPath, audioPath);
    await Promise.allSettled(workers);
    for (let index = 0; index < urls.length; index += 1) {
      await cleanupCandidateAudio(`${audioPath}.${index}.part.mp3`);
    }
    return;
  }

  await Promise.allSettled(workers);

  if (resolved) {
    for (let index = 0; index < urls.length; index += 1) {
      await cleanupCandidateAudio(`${audioPath}.${index}.part.mp3`);
    }
    return;
  }

  throw new Error(`所有视频源均无法提取音频：${lastError?.message || '未知错误'}`);
}

// Helpers copied from transcribe-link.js
function getVideoLinks(data, body = {}) {
  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data?.note || data || {};
  const video = detail.video || data?.video || {};
  const links = [];

  // Prefer explicit download candidates with audio first. Preview URLs can be
  // fast for playback but slow or silent when ffmpeg reads the whole stream.
  if (Array.isArray(body.downloadUrlCandidates)) {
    const sortedCandidates = [...body.downloadUrlCandidates]
      .filter((item) => item?.hasAudio !== false)
      .sort((a, b) => scoreBodyVideoCandidate(b) - scoreBodyVideoCandidate(a));
    links.push(...sortedCandidates.map((item) => item?.url));
  }
  if (Array.isArray(body.videoUrls)) links.push(...body.videoUrls);
  if (typeof body.videoUrl === 'string') links.push(body.videoUrl);
  if (video.play_addr_h264?.url_list?.length) links.push(...video.play_addr_h264.url_list);
  if (video.play_addr?.url_list?.length) links.push(...video.play_addr.url_list);
  if (video.play_api?.url_list?.length) links.push(...video.play_api.url_list);
  if (video.download_addr?.url_list?.length) links.push(...video.download_addr.url_list);
  if (detail.video_url) links.push(detail.video_url);
  if (data?.video_url) links.push(data.video_url);
  if (data?.videos?.items?.length) {
    const sortedVideos = [...data.videos.items].sort((a, b) => Number(b.hasAudio) - Number(a.hasAudio));
    links.push(...sortedVideos.map((item) => item.url));
  }
  return [...new Set(links.map(normalizeVideoUrl).filter(Boolean))];
}

function scoreBodyVideoCandidate(candidate) {
  const source = String(candidate?.source || '');
  const host = String(candidate?.host || '');
  const url = String(candidate?.url || '');
  let score = 0;
  if (candidate?.hasAudio === true) score += 200;
  if (/download_addr/i.test(source)) score += 90;
  if (/play_addr_h264/i.test(source)) score += 70;
  if (/play_addr/i.test(source)) score += 55;
  if (/v\d+-dy|douyinvod|zjcdn|byte/i.test(host)) score += 20;
  if (/playwm|watermark=1|[?&]wm=1/i.test(url)) score -= 80;
  return score;
}

function normalizeVideoUrl(value) {
  if (typeof value !== 'string') return '';
  const url = value
    .replace(/\\u0026/g, '&')
    .replace(/&amp;/g, '&')
    .trim();
  return /^https?:\/\//i.test(url) ? url : '';
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

import { createHash, randomBytes } from 'node:crypto';
import { createReadStream, createWriteStream, existsSync } from 'node:fs';
import { readFile, stat, unlink } from 'node:fs/promises';
import path from 'node:path';
import { Transform } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { ALIYUN_VOICE_MODEL } from './aliyun-voice.mjs';

export const VOICE_TRANSFER_MAX_SOURCE_BYTES = 500 * 1024 * 1024;
export const VOICE_TRANSFER_MIN_DURATION_SECONDS = 1;
export const VOICE_TRANSFER_MAX_DURATION_SECONDS = 30;
export const VOICE_TRANSFER_DEFAULT_DURATION_SECONDS = 15;
export const VOICE_TRANSFER_MAX_TEXT_LENGTH = 2000;
export const VOICE_TRANSFER_VALID_SCENES = new Set(['Narrate', 'Audio', 'Drama', 'Music', 'Game']);

const SEPARATE_POLL_INTERVAL_MS = 2000;
const SEPARATE_POLL_TIMEOUT_MS = 3 * 60 * 1000;
const VOICE_DEPLOY_POLL_INTERVAL_MS = 2000;
const VOICE_DEPLOY_MAX_ATTEMPTS = 15;
const TEMP_VOICE_CACHE_TTL_MS = 2 * 60 * 60 * 1000;
const SEPARATION_CACHE_TTL_MS = 15 * 60 * 1000;
const MAX_DOWNLOAD_BYTES = 50 * 1024 * 1024;

function fail(message, statusCode = 400) {
  return Object.assign(new Error(message), { statusCode });
}

export function normalizeVoiceTransferId(value) {
  const cleaned = String(value || '').trim().toLowerCase();
  return /^[a-f0-9]{16,48}$/.test(cleaned) ? cleaned : '';
}

export function normalizeVoiceTransferScene(value) {
  const cleaned = String(value || '').trim();
  return VOICE_TRANSFER_VALID_SCENES.has(cleaned) ? cleaned : 'Narrate';
}

export function parseVoiceTransferRange(body, sourceDuration) {
  const durationLimit = Number(sourceDuration) || 0;
  if (!Number.isFinite(durationLimit) || durationLimit <= 0) {
    throw fail('无法读取素材有效时长，请重新上传', 400);
  }
  const rawStart = body?.startSeconds === undefined || body?.startSeconds === null || body?.startSeconds === ''
    ? 0
    : Number(body.startSeconds);
  const rawEnd = body?.endSeconds === undefined || body?.endSeconds === null || body?.endSeconds === ''
    ? Math.min(durationLimit, VOICE_TRANSFER_DEFAULT_DURATION_SECONDS)
    : Number(body.endSeconds);

  if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawStart < 0 || rawEnd <= rawStart) {
    throw fail('请设置正确的截取开始和结束时间', 400);
  }
  const start = Math.max(0, Math.min(rawStart, durationLimit));
  const end = Math.max(start, Math.min(rawEnd, durationLimit));
  const duration = Math.round((end - start) * 1000) / 1000;
  if (duration < VOICE_TRANSFER_MIN_DURATION_SECONDS) {
    throw fail(`截取时长至少需要 ${VOICE_TRANSFER_MIN_DURATION_SECONDS} 秒，建议 10～15 秒`, 400);
  }
  if (duration > VOICE_TRANSFER_MAX_DURATION_SECONDS + 0.05) {
    throw fail(`单次截取不能超过 ${VOICE_TRANSFER_MAX_DURATION_SECONDS} 秒，建议 15 秒左右`, 400);
  }
  return {
    start: Math.round(start * 1000) / 1000,
    end: Math.round(end * 1000) / 1000,
    duration,
  };
}

function normalizeUploadHeaders(rawHeaders) {
  if (!rawHeaders) return {};
  if (!Array.isArray(rawHeaders) && typeof rawHeaders === 'object') {
    return Object.fromEntries(
      Object.entries(rawHeaders)
        .filter(([k, v]) => String(k || '').trim() && String(v || '').trim())
        .map(([k, v]) => [String(k).trim(), String(v).trim()])
    );
  }
  const entries = [];
  for (const item of Array.isArray(rawHeaders) ? rawHeaders : []) {
    if (!item || typeof item !== 'object') continue;
    const key = String(item.key || item.name || item.header || '').trim();
    const value = String(item.value || item.header_value || '').trim();
    if (key && value) entries.push([key, value]);
  }
  return Object.fromEntries(entries);
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function safeJsonParse(text, fallback = null) {
  try {
    return JSON.parse(String(text || ''));
  } catch {
    return fallback;
  }
}

export function groupSpeakerSegments(sentences, maxDuration = Infinity) {
  const bySpeaker = new Map();
  for (const sentence of Array.isArray(sentences) ? sentences : []) {
    const rawId = sentence?.speaker_id;
    const speakerId = rawId === undefined || rawId === null || rawId === '' ? 0 : rawId;
    const rawStart = Math.max(0, Number(sentence?.begin_time) / 1000);
    const rawEnd = Math.min(maxDuration, Number(sentence?.end_time) / 1000);
    if (!Number.isFinite(rawStart) || !Number.isFinite(rawEnd) || rawEnd <= rawStart + 0.05) continue;
    const text = String(sentence?.text || '').trim();
    if (!bySpeaker.has(speakerId)) {
      bySpeaker.set(speakerId, { speakerId, segments: [], texts: [] });
    }
    const bucket = bySpeaker.get(speakerId);
    const prev = bucket.segments[bucket.segments.length - 1];
    if (prev && rawStart - prev.end <= 0.35) {
      prev.end = Math.max(prev.end, rawEnd);
    } else {
      bucket.segments.push({ start: Math.round(rawStart * 1000) / 1000, end: Math.round(rawEnd * 1000) / 1000 });
    }
    if (text) bucket.texts.push(text);
  }

  const speakers = [];
  for (const bucket of bySpeaker.values()) {
    const totalDuration = Math.round(
      bucket.segments.reduce((sum, seg) => sum + Math.max(0, seg.end - seg.start), 0) * 1000
    ) / 1000;
    if (totalDuration < 0.8) continue;
    speakers.push({
      speakerId: bucket.speakerId,
      segments: bucket.segments,
      totalDuration,
      sampleText: bucket.texts.join('').slice(0, 56),
    });
  }
  return speakers;
}

export function createVoiceTransferService({
  uploadTempDir,
  exec,
  fetchImpl = (...args) => fetch(...args),
  getConfig,
  aliyunVoiceService,
  diarizeVocal,
  ensureTools,
  scheduleCleanup,
  registerMimeType,
  unregisterMimeType,
  sanitizeFileName = (name) => String(name || 'source').replace(/[^\w.\-\u4e00-\u9fa5]/g, '_'),
  separatePollIntervalMs = SEPARATE_POLL_INTERVAL_MS,
  separatePollTimeoutMs = SEPARATE_POLL_TIMEOUT_MS,
  voiceDeployPollIntervalMs = VOICE_DEPLOY_POLL_INTERVAL_MS,
  voiceDeployMaxAttempts = VOICE_DEPLOY_MAX_ATTEMPTS,
  sleepImpl = sleep,
}) {
  // In-memory only: never writes to voice-archive.json.
  const separationCache = new Map();
  const tempVoiceCache = new Map();

  function getSourcePath(sourceId) {
    const id = normalizeVoiceTransferId(sourceId);
    return id ? path.join(uploadTempDir, `${id}_vt_source`) : '';
  }

  function resolveExistingSourcePath(sourceId) {
    const id = normalizeVoiceTransferId(sourceId);
    if (!id) return '';
    const vtPath = path.join(uploadTempDir, `${id}_vt_source`);
    if (existsSync(vtPath)) return vtPath;
    // Reuse videos imported via /api/clips/import-url-stream directly.
    const clipPath = path.join(uploadTempDir, `${id}_clip_source`);
    if (existsSync(clipPath)) return clipPath;
    return '';
  }

  function getVocalPath(vocalId) {
    const id = normalizeVoiceTransferId(vocalId);
    return id ? path.join(uploadTempDir, `${id}_vt_vocal.wav`) : '';
  }

  function pruneCaches() {
    const now = Date.now();
    for (const [key, entry] of separationCache.entries()) {
      const speakersValid = !Array.isArray(entry?.speakers) || entry.speakers.every((sp) => existsSync(getVocalPath(sp.vocalId)));
      if (!entry || entry.expiresAt <= now || !existsSync(entry.vocalPath) || !speakersValid) {
        separationCache.delete(key);
      }
    }
    for (const [key, entry] of tempVoiceCache.entries()) {
      if (!entry || entry.expiresAt <= now) {
        tempVoiceCache.delete(key);
      }
    }
  }

  async function probeMedia(filePath) {
    const { stdout } = await exec('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type,sample_rate,channels,width,height:format=duration',
      '-of', 'json',
      filePath,
    ], { timeout: 30 * 1000, killSignal: 'SIGKILL' });
    const parsed = safeJsonParse(stdout, {});
    const streams = Array.isArray(parsed?.streams) ? parsed.streams : [];
    const audioStream = streams.find((s) => s?.codec_type === 'audio');
    const videoStream = streams.find((s) => s?.codec_type === 'video' && Number(s?.width) > 0 && Number(s?.height) > 0);
    const durationSeconds = Number(parsed?.format?.duration || 0);
    if (!audioStream) {
      throw fail('该文件不包含音轨，请上传带有人声的视频或音频文件', 400);
    }
    if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
      throw fail('无法读取文件的有效时长，请换一个常见格式的音视频文件重试', 400);
    }
    return {
      durationSeconds: Math.round(durationSeconds * 1000) / 1000,
      hasVideo: Boolean(videoStream),
      sampleRate: Number(audioStream.sample_rate || 0) || undefined,
      channels: Number(audioStream.channels || 0) || undefined,
    };
  }

  async function probeAudioDuration(filePath) {
    const { stdout } = await exec('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'json',
      filePath,
    ], { timeout: 20 * 1000, killSignal: 'SIGKILL' });
    const parsed = safeJsonParse(stdout, {});
    const duration = Number(parsed?.format?.duration || 0);
    return Number.isFinite(duration) && duration > 0 ? Math.round(duration * 1000) / 1000 : 0;
  }

  async function uploadAudioToMediaKit(filePath, apiKey, mediaBase) {
    const requestResponse = await fetchImpl(`${mediaBase}/api/v1/tools-sync/request-media-upload-url`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: '{}',
      signal: AbortSignal.timeout(60 * 1000),
    });
    const requestText = await requestResponse.text();
    const requestPayload = safeJsonParse(requestText, null);
    if (!requestResponse.ok || requestPayload?.success === false) {
      const msg = requestPayload?.error?.message || requestPayload?.message || `申请 AI MediaKit 上传地址失败（HTTP ${requestResponse.status}）`;
      throw fail(msg, requestResponse.status >= 400 ? requestResponse.status : 502);
    }
    const uploadResult = requestPayload?.result || requestPayload?.data?.result || requestPayload?.data || {};
    const mediaUri = String(uploadResult?.file_id || uploadResult?.fileId || '').trim();
    const uploadUrl = String(uploadResult?.upload_url || uploadResult?.uploadUrl || '').trim();
    const uploadMethod = String(uploadResult?.method || 'PUT').trim().toUpperCase();
    if (!mediaUri || !uploadUrl) {
      throw fail('AI MediaKit 未返回有效的音频上传地址', 502);
    }

    const fileInfo = await stat(filePath);
    const uploadHeaders = {
      ...normalizeUploadHeaders(uploadResult?.upload_headers || uploadResult?.uploadHeaders),
      'Content-Type': 'audio/wav',
      'Content-Length': String(fileInfo.size),
    };
    const uploadResponse = await fetchImpl(uploadUrl, {
      method: uploadMethod,
      headers: uploadHeaders,
      body: createReadStream(filePath),
      duplex: 'half',
      signal: AbortSignal.timeout(2 * 60 * 1000),
    });
    if (!uploadResponse.ok) {
      const errText = await uploadResponse.text().catch(() => '');
      throw fail(`上传音频到 AI MediaKit 失败（HTTP ${uploadResponse.status}${errText ? `：${errText.slice(0, 120)}` : ''}）`, 502);
    }
    return mediaUri;
  }

  async function separateVoiceWithMediaKit(sliceWavPath, scene, apiKey, mediaBase) {
    const mediaUri = await uploadAudioToMediaKit(sliceWavPath, apiKey, mediaBase);

    const submitResponse = await fetchImpl(`${mediaBase}/api/v1/tools/separate-voice`, {
      method: 'POST',
      headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        audio_url: mediaUri,
        scene,
        output_format: 'wav',
      }),
      signal: AbortSignal.timeout(60 * 1000),
    });
    const submitText = await submitResponse.text();
    const submitPayload = safeJsonParse(submitText, null);
    if (!submitResponse.ok || submitPayload?.success === false) {
      const msg = submitPayload?.error?.message || submitPayload?.message || `提交人声分离任务失败（HTTP ${submitResponse.status}）`;
      throw fail(msg, submitResponse.status >= 400 ? submitResponse.status : 502);
    }
    const taskId = String(submitPayload?.task_id || submitPayload?.data?.task_id || '').trim();
    if (!taskId) {
      throw fail('AI MediaKit 未返回人声分离任务 ID', 502);
    }

    const deadline = Date.now() + separatePollTimeoutMs;
    while (Date.now() < deadline) {
      await sleepImpl(separatePollIntervalMs);
      const pollResponse = await fetchImpl(`${mediaBase}/api/v1/tasks/${encodeURIComponent(taskId)}`, {
        method: 'GET',
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(30 * 1000),
      });
      const pollText = await pollResponse.text();
      const pollPayload = safeJsonParse(pollText, null);
      if (!pollResponse.ok) {
        const msg = pollPayload?.error?.message || pollPayload?.message || `查询人声分离状态失败（HTTP ${pollResponse.status}）`;
        throw fail(msg, 502);
      }
      const task = pollPayload?.data || pollPayload || {};
      const status = String(task.status || '').toLowerCase();
      if (status === 'completed' || status === 'succeeded') {
        const voiceUrl = String(task.result?.voice_audio_url || '').trim();
        if (!voiceUrl) {
          throw fail('人声分离已完成，但未返回人声音轨地址', 502);
        }
        return { taskId, voiceUrl };
      }
      if (['failed', 'cancelled', 'canceled', 'expired'].includes(status)) {
        const msg = task.error?.message || task.error_message || task.message || '人声背景音分离失败，请重试';
        throw fail(msg, 502);
      }
    }
    throw fail('人声背景音分离超时，请稍后重试', 504);
  }

  async function downloadFile(urlString, destPath) {
    let parsed;
    try {
      parsed = new URL(urlString);
    } catch {
      throw fail('分离后的人声下载地址无效', 502);
    }
    if (!['https:', 'http:'].includes(parsed.protocol)) {
      throw fail('分离后的人声下载地址协议不受支持', 502);
    }
    const response = await fetchImpl(parsed.href, { signal: AbortSignal.timeout(120 * 1000) });
    if (!response.ok) {
      throw fail(`下载分离后的人声文件失败（HTTP ${response.status}）`, 502);
    }
    const chunks = [];
    let total = 0;
    for await (const chunk of response.body) {
      total += chunk.length;
      if (total > MAX_DOWNLOAD_BYTES) {
        throw fail('分离后的人声文件过大', 502);
      }
      chunks.push(Buffer.from(chunk));
    }
    const buf = Buffer.concat(chunks);
    if (!buf.length) throw fail('下载到的人声文件为空', 502);
    await pipeline(
      (async function* () { yield buf; })(),
      createWriteStream(destPath)
    );
  }

  async function postProcessVocal(rawVocalPath, cleanVocalPath) {
    // Trim leading silence & cap long pauses to <= 1.2s, normalize loudness, export 24kHz mono WAV for Aliyun cloning.
    const trimmedFilter = 'silenceremove=start_periods=1:start_duration=0.1:start_threshold=-45dB:stop_periods=-1:stop_duration=1.2:stop_threshold=-45dB,loudnorm=I=-16:TP=-1.5:LRA=11';
    const fallbackFilter = 'loudnorm=I=-16:TP=-1.5:LRA=11';

    await exec('ffmpeg', [
      '-y', '-i', rawVocalPath,
      '-vn', '-af', trimmedFilter,
      '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le',
      cleanVocalPath,
    ], { timeout: 60 * 1000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });

    const trimmedDuration = await probeAudioDuration(cleanVocalPath).catch(() => 0);
    if (trimmedDuration < 1.5) {
      // If silence removal stripped too aggressively (e.g. very quiet recording), fall back to loudnorm only.
      await exec('ffmpeg', [
        '-y', '-i', rawVocalPath,
        '-vn', '-af', fallbackFilter,
        '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le',
        cleanVocalPath,
      ], { timeout: 60 * 1000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
      return probeAudioDuration(cleanVocalPath);
    }
    return trimmedDuration;
  }

  return {
    async uploadSource(req) {
      const declaredSize = Number(req.headers['content-length'] || 0);
      if (!Number.isFinite(declaredSize) || declaredSize <= 0) {
        throw fail('无法读取文件大小，请重新选择视频或音频文件后再试', 411);
      }
      if (declaredSize > VOICE_TRANSFER_MAX_SOURCE_BYTES) {
        throw fail('上传文件不能超过 500MB', 413);
      }

      const contentType = String(req.headers['content-type'] || '').toLowerCase().split(';')[0].trim();
      if (
        contentType &&
        !contentType.startsWith('video/') &&
        !contentType.startsWith('audio/') &&
        contentType !== 'application/octet-stream'
      ) {
        throw fail('请上传视频或音频文件（如 MP4、MOV、MP3、WAV、M4A）', 400);
      }

      const sourceId = randomBytes(12).toString('hex');
      const filePath = getSourcePath(sourceId);
      let receivedBytes = 0;
      const sizeGuard = new Transform({
        transform(chunk, _encoding, callback) {
          receivedBytes += chunk.length;
          if (receivedBytes > VOICE_TRANSFER_MAX_SOURCE_BYTES) {
            callback(fail('上传文件不能超过 500MB', 413));
            return;
          }
          callback(null, chunk);
        },
      });

      try {
        await pipeline(req, sizeGuard, createWriteStream(filePath, { flags: 'wx' }));
        await ensureTools();
        const metadata = await probeMedia(filePath);
        const storedFileName = path.basename(filePath);
        const resolvedMime = (contentType.startsWith('video/') || contentType.startsWith('audio/'))
          ? contentType
          : (metadata.hasVideo ? 'video/mp4' : 'audio/mpeg');
        registerMimeType?.(storedFileName, resolvedMime);
        scheduleCleanup?.(filePath);

        const defaultEndSeconds = Math.round(Math.min(metadata.durationSeconds, VOICE_TRANSFER_DEFAULT_DURATION_SECONDS) * 1000) / 1000;
        let rawName = 'source-media';
        try {
          rawName = decodeURIComponent(String(req.headers['x-file-name'] || 'source-media'));
        } catch {}

        return {
          ok: true,
          sourceId,
          fileName: sanitizeFileName(rawName),
          url: `/uploads/${storedFileName}`,
          size: receivedBytes,
          durationSeconds: metadata.durationSeconds,
          hasVideo: metadata.hasVideo,
          defaultStartSeconds: 0,
          defaultEndSeconds,
        };
      } catch (error) {
        await unlink(filePath).catch(() => {});
        if (error?.statusCode) throw error;
        throw fail(error?.message?.includes('ffmpeg') ? error.message : '无法读取该音视频文件，请换一个常见格式再试', 400);
      }
    },

    async separateVocal(body) {
      pruneCaches();
      const sourceId = normalizeVoiceTransferId(body?.sourceId);
      const sourcePath = resolveExistingSourcePath(sourceId);
      if (!sourcePath || !existsSync(sourcePath)) {
        throw fail('原素材已过期或不存在，请重新上传视频或音频', 404);
      }

      const config = getConfig();
      const mediaKey = String(config?.mediaKey || '').trim();
      const mediaBase = String(config?.mediaBase || 'https://mediakit.cn-beijing.volces.com').trim().replace(/\/+$/g, '');
      if (!mediaKey) {
        throw fail('服务端未配置 MEDIAKIT_API_KEY，暂时无法进行人声与 BGM 分离', 400);
      }

      await ensureTools();
      const metadata = await probeMedia(sourcePath);
      const range = parseVoiceTransferRange(body, metadata.durationSeconds);
      const scene = normalizeVoiceTransferScene(body?.scene);

      const cacheKey = `${sourceId}:${range.start}:${range.end}:${scene}`;
      const cached = separationCache.get(cacheKey);
      if (cached && cached.expiresAt > Date.now() && existsSync(cached.vocalPath)) {
        return {
          ok: true,
          vocalId: cached.vocalId,
          vocalUrl: `/uploads/${path.basename(cached.vocalPath)}`,
          vocalFingerprint: cached.vocalFingerprint,
          durationSeconds: cached.durationSeconds,
          startSeconds: range.start,
          endSeconds: range.end,
          scene,
          speakers: cached.speakers,
          requiresSpeakerSelection: cached.requiresSpeakerSelection,
          cached: true,
        };
      }

      const vocalId = randomBytes(12).toString('hex');
      const sliceWavPath = path.join(uploadTempDir, `${vocalId}_vt_slice.wav`);
      const rawVocalPath = path.join(uploadTempDir, `${vocalId}_vt_raw_vocal.wav`);
      const cleanVocalPath = getVocalPath(vocalId);
      const createdSpeakerPaths = [];

      try {
        await exec('ffmpeg', [
          '-y', '-i', sourcePath,
          '-map', '0:a:0', '-vn',
          '-af', `atrim=start=${range.start}:end=${range.end},asetpts=N/SR/TB`,
          '-ac', '2', '-ar', '44100', '-c:a', 'pcm_s16le',
          sliceWavPath,
        ], { timeout: 2 * 60 * 1000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });

        const { voiceUrl } = await separateVoiceWithMediaKit(sliceWavPath, scene, mediaKey, mediaBase);
        await downloadFile(voiceUrl, rawVocalPath);
        const cleanDuration = await postProcessVocal(rawVocalPath, cleanVocalPath);
        if (!cleanDuration || cleanDuration < 0.5) {
          throw fail('截取区间内未检测到清晰人声，请调整时间段后重试', 400);
        }

        const cleanBuf = await readFile(cleanVocalPath);
        const vocalFingerprint = createHash('sha256').update(cleanBuf).digest('hex');
        scheduleCleanup?.(cleanVocalPath);

        // Detect multiple speakers on the clean vocal track so users can audition & pick one before cloning.
        let speakers = [];
        if (typeof diarizeVocal === 'function') {
          try {
            const rawSentences = await diarizeVocal({ audioPath: cleanVocalPath });
            const grouped = groupSpeakerSegments(rawSentences, cleanDuration + 0.5);
            if (grouped.length >= 2) {
              const limited = grouped.slice(0, 6);
              for (let idx = 0; idx < limited.length; idx++) {
                const sp = limited[idx];
                const spVocalId = randomBytes(12).toString('hex');
                const spVocalPath = getVocalPath(spVocalId);
                const filterParts = [];
                const concatInputs = [];
                sp.segments.forEach((seg, segIdx) => {
                  filterParts.push(`[0:a]atrim=start=${seg.start}:end=${seg.end},asetpts=PTS-STARTPTS[s${segIdx}]`);
                  concatInputs.push(`[s${segIdx}]`);
                });
                const filterComplex = sp.segments.length === 1
                  ? `${filterParts[0]};[s0]loudnorm=I=-16:TP=-1.5:LRA=11[out]`
                  : `${filterParts.join(';')};${concatInputs.join('')}concat=n=${sp.segments.length}:v=0:a=1,loudnorm=I=-16:TP=-1.5:LRA=11[out]`;
                await exec('ffmpeg', [
                  '-y', '-i', cleanVocalPath,
                  '-filter_complex', filterComplex,
                  '-map', '[out]',
                  '-ac', '1', '-ar', '24000', '-c:a', 'pcm_s16le',
                  spVocalPath,
                ], { timeout: 60 * 1000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });
                createdSpeakerPaths.push(spVocalPath);
                scheduleCleanup?.(spVocalPath);
                const spDuration = await probeAudioDuration(spVocalPath).catch(() => sp.totalDuration);
                speakers.push({
                  speakerId: sp.speakerId,
                  label: `音色 ${idx + 1}`,
                  vocalId: spVocalId,
                  vocalUrl: `/uploads/${path.basename(spVocalPath)}`,
                  durationSeconds: spDuration || sp.totalDuration,
                  sampleText: sp.sampleText,
                });
              }
            } else if (grouped.length === 1) {
              speakers = [{
                speakerId: grouped[0].speakerId,
                label: '音色 1',
                vocalId,
                vocalUrl: `/uploads/${path.basename(cleanVocalPath)}`,
                durationSeconds: cleanDuration,
                sampleText: grouped[0].sampleText,
              }];
            }
          } catch (diarizeErr) {
            console.warn('[voice-transfer] speaker diarization skipped:', diarizeErr?.message || diarizeErr);
          }
        }

        if (speakers.length === 0) {
          speakers = [{
            speakerId: 0,
            label: '音色 1',
            vocalId,
            vocalUrl: `/uploads/${path.basename(cleanVocalPath)}`,
            durationSeconds: cleanDuration,
            sampleText: '',
          }];
        }
        const requiresSpeakerSelection = speakers.length > 1;

        separationCache.set(cacheKey, {
          vocalId,
          vocalPath: cleanVocalPath,
          vocalFingerprint,
          durationSeconds: cleanDuration,
          speakers,
          requiresSpeakerSelection,
          expiresAt: Date.now() + SEPARATION_CACHE_TTL_MS,
        });

        return {
          ok: true,
          vocalId,
          vocalUrl: `/uploads/${path.basename(cleanVocalPath)}`,
          vocalFingerprint,
          durationSeconds: cleanDuration,
          startSeconds: range.start,
          endSeconds: range.end,
          scene,
          speakers,
          requiresSpeakerSelection,
          cached: false,
        };
      } catch (error) {
        await unlink(cleanVocalPath).catch(() => {});
        await Promise.all(createdSpeakerPaths.map((p) => unlink(p).catch(() => {})));
        throw error;
      } finally {
        await Promise.all([
          unlink(sliceWavPath).catch(() => {}),
          unlink(rawVocalPath).catch(() => {}),
        ]);
      }
    },

    async synthesizeMp3(body, req) {
      pruneCaches();
      const vocalId = normalizeVoiceTransferId(body?.vocalId);
      const vocalPath = getVocalPath(vocalId);
      if (!vocalPath || !existsSync(vocalPath)) {
        throw fail('提取的纯人声已过期，请重新提取后再试', 404);
      }

      const text = String(body?.text || '').trim();
      if (!text) {
        throw fail('请输入要生成的目标文案', 400);
      }
      if (text.length > VOICE_TRANSFER_MAX_TEXT_LENGTH) {
        throw fail(`目标文案不能超过 ${VOICE_TRANSFER_MAX_TEXT_LENGTH} 字`, 400);
      }

      const config = getConfig();
      const apiKey = String(config?.aliyunApiKey || '').trim();
      if (!apiKey) {
        throw fail('服务端缺少 ALIYUN_API_KEY，暂时无法使用阿里云声音克隆', 400);
      }

      await ensureTools();
      const vocalBuffer = await readFile(vocalPath);
      if (!vocalBuffer.length || vocalBuffer.length > 10 * 1024 * 1024) {
        throw fail('纯人声样本大小不符合阿里云要求（需大于 0 且不超过 10MB）', 400);
      }

      const vocalFingerprint = createHash('sha256').update(vocalBuffer).digest('hex');
      let cachedVoice = tempVoiceCache.get(vocalFingerprint);
      let reusedVoice = false;

      if (cachedVoice && cachedVoice.expiresAt > Date.now() && cachedVoice.voiceId) {
        reusedVoice = true;
      } else {
        const audioData = `data:audio/wav;base64,${vocalBuffer.toString('base64')}`;
        const created = await aliyunVoiceService.create({
          apiKey,
          preferredName: `vt${vocalFingerprint.slice(0, 8)}`,
          audioData,
          req,
        });
        const voiceId = String(created?.output?.voice_id || created?.output?.voice || '').trim();
        if (!voiceId) {
          throw fail('阿里云音色克隆成功但未返回音色 ID', 502);
        }
        cachedVoice = {
          voiceId,
          engineModel: created.engineModel || ALIYUN_VOICE_MODEL,
          expiresAt: Date.now() + TEMP_VOICE_CACHE_TTL_MS,
        };
        tempVoiceCache.set(vocalFingerprint, cachedVoice);
      }

      // Poll automatically when freshly enrolled voice is still DEPLOYING (409).
      let wavBuffer = null;
      let lastError = null;
      for (let attempt = 0; attempt < voiceDeployMaxAttempts; attempt++) {
        try {
          wavBuffer = await aliyunVoiceService.synthesize({
            apiKey,
            model: cachedVoice.engineModel,
            voice: cachedVoice.voiceId,
            text,
          });
          break;
        } catch (error) {
          lastError = error;
          const isDeploying = Number(error?.statusCode) === 409 && /准备中|DEPLOYING/i.test(String(error?.message || ''));
          if (isDeploying && attempt < voiceDeployMaxAttempts - 1) {
            await sleepImpl(voiceDeployPollIntervalMs);
            continue;
          }
          throw error;
        }
      }
      if (!wavBuffer) {
        throw lastError || fail('阿里云音色准备超时，请稍后重试', 504);
      }

      const outputId = randomBytes(10).toString('hex');
      const tempWavPath = path.join(uploadTempDir, `${outputId}_vt_tts.wav`);
      const outputMp3Path = path.join(uploadTempDir, `${outputId}_vt_output.mp3`);

      try {
        await pipeline(
          (async function* () { yield wavBuffer; })(),
          createWriteStream(tempWavPath)
        );
        await exec('ffmpeg', [
          '-y', '-i', tempWavPath,
          '-vn', '-c:a', 'libmp3lame', '-b:a', '192k',
          outputMp3Path,
        ], { timeout: 2 * 60 * 1000, killSignal: 'SIGKILL', maxBuffer: 4 * 1024 * 1024 });

        const mp3Info = await stat(outputMp3Path);
        const mp3Duration = await probeAudioDuration(outputMp3Path).catch(() => 0);
        scheduleCleanup?.(outputMp3Path);

        const now = new Date();
        const stamp = `${now.getMonth() + 1}月${now.getDate()}日_${String(now.getHours()).padStart(2, '0')}-${String(now.getMinutes()).padStart(2, '0')}`;
        return {
          ok: true,
          audioUrl: `/uploads/${path.basename(outputMp3Path)}`,
          fileName: `音色转移_${stamp}.mp3`,
          size: mp3Info.size,
          durationSeconds: mp3Duration,
          reusedVoice,
        };
      } catch (error) {
        await unlink(outputMp3Path).catch(() => {});
        throw error;
      } finally {
        await unlink(tempWavPath).catch(() => {});
      }
    },

    async cleanup(body) {
      const sourceId = normalizeVoiceTransferId(body?.sourceId);
      const vocalIds = [
        normalizeVoiceTransferId(body?.vocalId),
        ...(Array.isArray(body?.vocalIds) ? body.vocalIds.map((id) => normalizeVoiceTransferId(id)) : []),
      ].filter(Boolean);
      if (sourceId) {
        const vtPath = getSourcePath(sourceId);
        const clipPath = path.join(uploadTempDir, `${sourceId}_clip_source`);
        for (const p of [vtPath, clipPath]) {
          unregisterMimeType?.(path.basename(p));
          await unlink(p).catch(() => {});
        }
        for (const key of separationCache.keys()) {
          if (key.startsWith(`${sourceId}:`)) separationCache.delete(key);
        }
      }
      for (const vid of new Set(vocalIds)) {
        await unlink(getVocalPath(vid)).catch(() => {});
      }
      return { ok: true };
    },
  };
}

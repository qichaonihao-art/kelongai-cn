import 'dotenv/config';
import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { mkdir, mkdtemp, readFile, readdir, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { tryHandleCopypilotRoute } from './copypilot-adapter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const LEGACY_FRONTEND_DIR = path.join(__dirname, 'ai');
const REACT_FRONTEND_DIR = path.join(__dirname, '..', 'frontend-google-ui', 'dist');
const FRONTEND_MODE = String(process.env.FRONTEND_MODE || 'legacy').trim().toLowerCase();
const PORT = Number(process.env.PORT || 3000);
// Default to all interfaces so a cloud host can expose the service without
// requiring an extra HOST override. Local-only access still works via
// http://127.0.0.1:3000.
const HOST = process.env.HOST || '0.0.0.0';
const CORS_ALLOW_ORIGIN = process.env.CORS_ALLOW_ORIGIN || '*';
const APP_LOGIN_PASSWORD = process.env.APP_LOGIN_PASSWORD || '';
const AUTH_COOKIE_NAME = 'auth_token';
const authSessions = new Map();
const SHOULD_USE_REACT_FRONTEND = FRONTEND_MODE === 'react';
const MAX_MULTIMODAL_UPLOAD_BYTES = 170 * 1024 * 1024;
const MAX_IMAGE_ORIGINAL_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_VIDEO_ORIGINAL_UPLOAD_BYTES = 45 * 1024 * 1024;
const MAX_COMPRESSED_VIDEO_BYTES = 49 * 1024 * 1024;
const DEFAULT_DOUBAO_MULTIMODAL_MODEL = 'doubao-seed-2-0-pro-260215';
const DOUBAO_MULTIMODAL_TIMEOUT_MS = 8 * 60 * 1000;
const UPLOAD_TEMP_DIR = path.join(__dirname, '.runtime-uploads');
const RUNTIME_STATE_DIR = path.join(__dirname, '.runtime-state');
const VOLC_SPEAKER_OWNERSHIP_FILE = path.join(RUNTIME_STATE_DIR, 'volc-speaker-ownership.json');
const VOICE_ARCHIVE_FILE = path.join(RUNTIME_STATE_DIR, 'voice-archive.json');
const VOLC_SPEAKER_REMOTE_STATUS_CACHE_TTL_MS = 15 * 1000;
const COLLECTION_DB_PATH = path.join(RUNTIME_STATE_DIR, 'collection.db');
const MEDIA_TTL_MS = 30 * 60 * 1000;
const STARTUP_UPLOAD_TEMP_FILE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const ACTIVE_FRONTEND_DIR = SHOULD_USE_REACT_FRONTEND ? REACT_FRONTEND_DIR : LEGACY_FRONTEND_DIR;
const FALLBACK_FRONTEND_DIR = SHOULD_USE_REACT_FRONTEND ? LEGACY_FRONTEND_DIR : REACT_FRONTEND_DIR;
const HAS_ACTIVE_FRONTEND_DIR = existsSync(ACTIVE_FRONTEND_DIR);
const HAS_FALLBACK_FRONTEND_DIR = existsSync(FALLBACK_FRONTEND_DIR);
const RESOLVED_FRONTEND_DIR = HAS_ACTIVE_FRONTEND_DIR
  ? ACTIVE_FRONTEND_DIR
  : (HAS_FALLBACK_FRONTEND_DIR ? FALLBACK_FRONTEND_DIR : ACTIVE_FRONTEND_DIR);
const RESOLVED_FRONTEND_MODE = RESOLVED_FRONTEND_DIR === REACT_FRONTEND_DIR ? 'react' : 'legacy';
const IS_REACT_FRONTEND_ACTIVE = RESOLVED_FRONTEND_MODE === 'react';
const execFileAsync = promisify(execFile);

const SERVER_CONFIG = {
  zhipuApiKey: process.env.ZHIPU_API_KEY || '',
  aliyunApiKey: process.env.ALIYUN_API_KEY || '',
  arkApiKey: process.env.ARK_API_KEY || '',
  seedanceApiKey: process.env.SEEDANCE_API_KEY || process.env.ARK_API_KEY || '',
  volcAppKey: process.env.VOLCENGINE_APP_KEY || '',
  volcAccessKey: process.env.VOLCENGINE_ACCESS_KEY || '',
  volcSpeakerId: process.env.VOLCENGINE_SPEAKER_ID || '',
  volcSpeakerIdPool: process.env.VOLCENGINE_SPEAKER_ID_POOL || '',
  volcEngineGroups: buildVolcEngineGroups(),
  tikhubApiToken: process.env.TIKHUB_API_TOKEN || '',
  siliconFlowApiKey: process.env.SILICONFLOW_API_KEY || '',
  wechatApiToken: process.env.WECHAT_API_TOKEN || '',
  douyinApiToken: process.env.DOUYIN_API_TOKEN || process.env.WECHAT_API_TOKEN || '',
  gptImageApiKey: process.env.GPT_IMAGE_API_KEY || '',
  doubaoTopmodelApiKey: process.env.DOUBAO_TOPMODEL_API_KEY || '',
  webSearchApiKey: process.env.WEB_SEARCH_API_KEY || '',
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY || ''
};

const DOUYIN_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const TIKHUB_API_BASE_URL = 'https://api.tikhub.io';
const DOUYIN_RETRY_DELAYS_MS = [250, 700];
const SILICONFLOW_API_BASE_URL = String(process.env.SILICONFLOW_API_BASE_URL || 'https://api.siliconflow.cn/v1').trim().replace(/\/+$/g, '');
const SILICONFLOW_ASR_MODEL = String(process.env.SILICONFLOW_ASR_MODEL || 'FunAudioLLM/SenseVoiceSmall').trim();
const DEFAULT_SILICONFLOW_VOICE_MODEL = 'FunAudioLLM/CosyVoice2-0.5B';
const DEFAULT_SILICONFLOW_RESPONSE_FORMAT = 'wav';
const SILICONFLOW_VOICE_UPLOAD_TIMEOUT_MS = 2 * 60 * 1000;
const SILICONFLOW_TTS_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_DOUYIN_VIDEO_RESOLVE_TIMEOUT_MS = 30 * 1000;
const DEFAULT_DOUYIN_VIDEO_DOWNLOAD_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_DOUYIN_VIDEO_DOWNLOAD_ATTEMPT_TIMEOUT_MS = 20 * 1000;
const DEFAULT_DOUYIN_AUDIO_EXTRACT_TIMEOUT_MS = 2 * 60 * 1000;
const DEFAULT_DOUYIN_ASR_TIMEOUT_MS = 3 * 60 * 1000;
const DEFAULT_DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS = 5 * 60 * 1000;
const DOUYIN_VIDEO_RESOLVE_TIMEOUT_MS = readTimeoutMs(
  process.env.DOUYIN_VIDEO_RESOLVE_TIMEOUT_MS || process.env.DOUYIN_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_DOUYIN_VIDEO_RESOLVE_TIMEOUT_MS,
  30 * 1000
);
const DOUYIN_VIDEO_DOWNLOAD_TIMEOUT_MS = readTimeoutMs(
  process.env.DOUYIN_VIDEO_DOWNLOAD_TIMEOUT_MS,
  DEFAULT_DOUYIN_VIDEO_DOWNLOAD_TIMEOUT_MS,
  2 * 60 * 1000
);
const DOUYIN_VIDEO_DOWNLOAD_ATTEMPT_TIMEOUT_MS = readTimeoutMs(
  process.env.DOUYIN_VIDEO_DOWNLOAD_ATTEMPT_TIMEOUT_MS,
  DEFAULT_DOUYIN_VIDEO_DOWNLOAD_ATTEMPT_TIMEOUT_MS,
  10 * 1000
);
const DOUYIN_VIDEO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS = Math.min(
  15,
  Math.max(6, Math.floor(DOUYIN_VIDEO_DOWNLOAD_ATTEMPT_TIMEOUT_MS / 1000 / 3))
);
const DOUYIN_VIDEO_DOWNLOAD_RETRY_DELAYS_MS = [0, 800, 1500];
const DOUYIN_HOST_STATS_MAX_SAMPLES = 20;
const DOUYIN_HOST_COOLDOWN_BASE_MS = 30 * 1000;
const DOUYIN_HOST_COOLDOWN_MAX_MS = 5 * 60 * 1000;
const DOUYIN_HOST_CONSECUTIVE_FAILURE_THRESHOLD = 3;
const DOUYIN_AUDIO_EXTRACT_TIMEOUT_MS = readTimeoutMs(
  process.env.DOUYIN_AUDIO_EXTRACT_TIMEOUT_MS,
  DEFAULT_DOUYIN_AUDIO_EXTRACT_TIMEOUT_MS,
  30 * 1000
);
const DOUYIN_ASR_TIMEOUT_MS = readTimeoutMs(
  process.env.DOUYIN_ASR_TIMEOUT_MS,
  DEFAULT_DOUYIN_ASR_TIMEOUT_MS,
  2 * 60 * 1000
);
const DOUYIN_ASR_CONNECT_TIMEOUT_SECONDS = Math.max(10, Math.floor(DOUYIN_ASR_TIMEOUT_MS / 1000 / 6));
const DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS = readTimeoutMs(
  process.env.DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS,
  Math.max(
    DEFAULT_DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS,
    DOUYIN_VIDEO_RESOLVE_TIMEOUT_MS +
      DOUYIN_VIDEO_DOWNLOAD_TIMEOUT_MS +
      DOUYIN_AUDIO_EXTRACT_TIMEOUT_MS +
      DOUYIN_ASR_TIMEOUT_MS +
      60 * 1000
  ),
  2 * 60 * 1000
);
const MAX_DOUYIN_VIDEO_DOWNLOAD_BYTES = 220 * 1024 * 1024;
const DOUYIN_ASR_SEGMENT_SECONDS = 9 * 60;
const DOUYIN_ASR_MAX_SEGMENT_DURATION_SECONDS = 55 * 60;
const douyinDownloadHostStats = new Map();
const DOUYIN_DOWNLOAD_HOST_BASE_SCORES = new Map([
  ['v5-hl-zenl-ov.zjcdn.com', 140],
  ['api-play-hl.amemv.com', 125],
  ['api-hl.amemv.com', 115],
  ['v9-chc.douyinvod.com', 105],
  ['v6-chc.douyinvod.com', 95],
  ['v5-dy-o-abtest.zjcdn.com', -120]
]);
const VOLC_SPEAKER_POOL_FULL_MESSAGE = '火山音色槽位已满，请删除旧音色或增加 speaker_id 池';
let volcSpeakerOwnershipState = null;
let volcSpeakerOwnershipQueue = Promise.resolve();
let voiceArchiveQueue = Promise.resolve();
let volcSpeakerRemoteStatusCache = {
  key: '',
  expiresAt: 0,
  summary: null
};
let collectionDb = null;

function readBooleanEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function readTimeoutMs(value, fallback, minimumMs = 30 * 1000) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }
  return Math.max(minimumMs, Math.floor(parsed));
}

const VOICE_CLONE_MOCK_MODE = readBooleanEnv(process.env.VOICE_CLONE_MOCK_MODE);

function shouldUseVoiceCloneMock(body) {
  return VOICE_CLONE_MOCK_MODE || body?.mockMode === true;
}

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
  '.mp4': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg'
};

function sendJson(res, statusCode, payload) {
  res.writeHead(statusCode, { 'Content-Type': 'application/json; charset=utf-8' });
  res.end(JSON.stringify(payload));
}

function sendAudioResponse(res, audioBuffer, contentType = 'application/octet-stream') {
  res.writeHead(200, {
    'Content-Type': contentType,
    'Content-Length': audioBuffer.length,
    'Cache-Control': 'no-store'
  });
  res.end(audioBuffer);
}

function sendWavResponse(res, wavBuffer) {
  sendAudioResponse(res, wavBuffer, 'audio/wav');
}

function hasFileExtension(pathname) {
  return !!path.extname(String(pathname || ''));
}

function shouldServeSpaFallback(pathname) {
  return IS_REACT_FRONTEND_ACTIVE && !hasFileExtension(pathname);
}

function sanitizeFileName(value) {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_.-]+|[_.-]+$/g, '');
  return cleaned || `upload_${Date.now().toString(36)}`;
}

function sanitizeStoredFileName(value) {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z0-9._-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '');
  return cleaned || '';
}

function getConfiguredPublicBaseUrl() {
  return String(process.env.PUBLIC_BASE_URL || '').trim().replace(/\/+$/g, '');
}

function isLocalHostName(hostname) {
  const normalized = String(hostname || '').toLowerCase();
  return !normalized || normalized === 'localhost' || normalized === '127.0.0.1' || normalized === '0.0.0.0' || normalized === '::1';
}

function getRequestProtocol(req) {
  const forwardedProto = readValue(req.headers['x-forwarded-proto']);
  if (forwardedProto) return forwardedProto.split(',')[0].trim();
  return HOST === '127.0.0.1' || HOST === '0.0.0.0' ? 'http' : 'https';
}

function resolvePublicBaseUrl(req) {
  const configuredPublicBaseUrl = getConfiguredPublicBaseUrl();
  if (configuredPublicBaseUrl) return configuredPublicBaseUrl;

  const host = readValue(req.headers['x-forwarded-host'], req.headers.host);
  if (!host) return '';

  const hostname = host.split(':')[0];
  if (isLocalHostName(hostname)) return '';

  return `${getRequestProtocol(req)}://${host}`.replace(/\/+$/g, '');
}

function translateUpstreamError(rawError, fallback = '请求失败，请稍后重试。') {
  const raw = String(rawError || '');
  const lower = raw.toLowerCase();

  // Seedance / 方舟 明确错误映射
  if (/real person|contain real person|真人/i.test(raw)) {
    return '上传失败：当前参考视频可能包含真人，平台限制使用这类视频作为参考素材。建议改用图片参考 + 反推提示词。';
  }
  if (/reference_video.*web url|must be provided as a web url|web url/i.test(raw)) {
    return '上传失败：视频参考素材必须使用可公网访问的视频链接，当前环境暂不支持这种上传方式。';
  }
  if (/invalid authentication|authentication failed|unauthorized|鉴权|认证/i.test(raw)) {
    return '接口鉴权失败，请检查 API Key 或服务端配置。';
  }
  if (/api key|apikey|api-key/i.test(raw)) {
    return '接口密钥异常，请检查 API Key 配置是否正确。';
  }
  if (/timeout|etimedout|timed out|network timeout|connect timeout/i.test(raw)) {
    return '请求超时，请稍后重试。';
  }
  if (/429|too many requests|rate limit|rate exceeded|throttled/i.test(raw)) {
    return '当前请求过于频繁，请稍后再试。';
  }
  if (/5\d\d|internal server error|bad gateway|service unavailable|upstream error/i.test(raw)) {
    return '服务暂时不可用，请稍后再试。';
  }
  if (/file.*too large|file size|unsupported format|file.*format|invalid file/i.test(raw)) {
    return '上传失败：文件大小或格式不符合要求，请更换素材后再试。';
  }
  if (/content.*violation|content.*policy|safety|harmful|inappropriate|违规|敏感/i.test(raw)) {
    return '内容审核未通过：提示词或参考素材可能包含敏感内容，请调整后重试。';
  }
  if (/quota|额度|余额不足|insufficient|credit|billing/i.test(raw)) {
    return '账户额度不足，请检查方舟平台余额或配额。';
  }
  if (/toolnotopen|not activated|activate it|未开通|未激活|content_plugin/i.test(raw)) {
    return '该功能（联网搜索/插件）尚未在方舟平台开通，请前往控制台开通后再试。';
  }
  if (/not found|404|task not found|task_id|任务不存在/i.test(raw)) {
    return '任务不存在或已过期，请确认任务 ID 是否正确。';
  }
  if (/parameter|param|参数|invalid request|bad request/i.test(raw)) {
    return '请求参数有误，请检查输入内容是否符合要求。';
  }
  if (/network|connection|connect|dns|refused|econnrefused/i.test(raw)) {
    return '网络连接异常，请检查网络或稍后重试。';
  }

  return fallback;
}

async function ensureUploadTempDir() {
  await mkdir(UPLOAD_TEMP_DIR, { recursive: true });
}

async function ensureRuntimeStateDir() {
  await mkdir(RUNTIME_STATE_DIR, { recursive: true });
}

function isPathInsideUploadTempDir(filePath) {
  const normalizedPath = path.normalize(String(filePath || ''));
  return normalizedPath.startsWith(`${UPLOAD_TEMP_DIR}${path.sep}`);
}

async function deleteUploadTempFile(filePath, { requestId = '', cleanupReason = '' } = {}) {
  const normalizedPath = path.normalize(String(filePath || ''));
  if (!isPathInsideUploadTempDir(normalizedPath)) {
    return false;
  }

  try {
    const info = await stat(normalizedPath);
    if (!info.isFile()) {
      return false;
    }

    await unlink(normalizedPath);
    console.log('[runtime uploads] cleanup_deleted', {
      requestId,
      targetPath: normalizedPath,
      finalFileSize: info.size,
      cleanupReason
    });
    return true;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      return false;
    }

    console.error('[runtime uploads] cleanup_failed', {
      requestId,
      targetPath: normalizedPath,
      cleanupReason,
      message: error?.message || '',
      code: error?.code || ''
    });
    return false;
  }
}

async function collectRequestScopedUploadTempFiles(requestId) {
  if (!requestId) return [];

  await ensureUploadTempDir();
  const prefix = `${requestId}_`;
  const names = await readdir(UPLOAD_TEMP_DIR);
  return names
    .filter((name) => name.startsWith(prefix))
    .map((name) => path.join(UPLOAD_TEMP_DIR, name))
    .filter(isPathInsideUploadTempDir);
}

async function cleanupRequestScopedUploadTempFiles({ requestId, filePaths = [] }) {
  const cleanupStartedAt = Date.now();
  const scopedPaths = await collectRequestScopedUploadTempFiles(requestId).catch(() => []);
  const targets = [...new Set([...filePaths, ...scopedPaths].filter(Boolean))]
    .map((item) => path.normalize(String(item)))
    .filter(isPathInsideUploadTempDir);

  console.log('[runtime uploads] cleanup_started', {
    requestId,
    targetPath: UPLOAD_TEMP_DIR,
    matchedFileCount: targets.length
  });

  for (const targetPath of targets) {
    await deleteUploadTempFile(targetPath, {
      requestId,
      cleanupReason: 'request_finally'
    });
  }

  return {
    requestId,
    matchedFileCount: targets.length,
    elapsedMs: Date.now() - cleanupStartedAt
  };
}

async function cleanupExpiredUploadTempFilesOnStartup() {
  await ensureUploadTempDir();
  const names = await readdir(UPLOAD_TEMP_DIR);
  const now = Date.now();
  let scannedCount = 0;
  let deletedCount = 0;
  let failedCount = 0;

  for (const name of names) {
    const filePath = path.join(UPLOAD_TEMP_DIR, name);
    if (!isPathInsideUploadTempDir(filePath)) {
      continue;
    }

    try {
      const info = await stat(filePath);
      if (!info.isFile()) {
        continue;
      }

      scannedCount += 1;
      const ageMs = now - info.mtimeMs;
      if (ageMs <= STARTUP_UPLOAD_TEMP_FILE_MAX_AGE_MS) {
        continue;
      }

      const deleted = await deleteUploadTempFile(filePath, {
        requestId: 'startup_cleanup',
        cleanupReason: 'startup_expired'
      });
      if (deleted) {
        deletedCount += 1;
      }
    } catch (error) {
      failedCount += 1;
      console.error('[runtime uploads] cleanup_failed', {
        requestId: 'startup_cleanup',
        targetPath: filePath,
        cleanupReason: 'startup_scan',
        message: error?.message || '',
        code: error?.code || ''
      });
    }
  }

  console.log('[runtime uploads] startup_cleanup_finished', {
    requestId: 'startup_cleanup',
    targetPath: UPLOAD_TEMP_DIR,
    scannedCount,
    deletedCount,
    failedCount,
    maxAgeMs: STARTUP_UPLOAD_TEMP_FILE_MAX_AGE_MS
  });
}

async function ensureVideoCompressionTools() {
  try {
    await execFileAsync('ffmpeg', ['-version']);
    await execFileAsync('ffprobe', ['-version']);
  } catch (error) {
    if (error && (error.code === 'ENOENT' || /not found/i.test(String(error.message || '')))) {
      throw new Error('服务器未安装 ffmpeg，无法自动压缩大视频');
    }
    throw error;
  }
}

function scheduleMediaCleanup(filePath) {
  setTimeout(async () => {
    try {
      await unlink(filePath);
    } catch {}
  }, MEDIA_TTL_MS + 1000).unref?.();
}

async function getVideoDurationSeconds(filePath) {
  try {
    const { stdout } = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration',
      '-of', 'default=noprint_wrappers=1:nokey=1',
      filePath
    ]);
    const duration = Number.parseFloat(String(stdout || '').trim());
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error('invalid duration');
    }
    return duration;
  } catch (error) {
    if (error instanceof Error && error.message === '服务器未安装 ffmpeg，无法自动压缩大视频') {
      throw error;
    }
    throw new Error('无法读取视频时长，无法自动压缩大视频');
  }
}

async function validateDownloadedVideoFile(filePath, timeoutMs = 30000) {
  let formatStdout = '';
  let streamsStdout = '';
  try {
    const formatResult = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'format=duration,size,format_name',
      '-of', 'json',
      filePath
    ], {
      timeout: Math.max(1000, timeoutMs),
      killSignal: 'SIGKILL'
    });
    formatStdout = formatResult.stdout;

    const streamsResult = await execFileAsync('ffprobe', [
      '-v', 'error',
      '-show_entries', 'stream=codec_type',
      '-of', 'json',
      filePath
    ], {
      timeout: Math.max(1000, timeoutMs),
      killSignal: 'SIGKILL'
    });
    streamsStdout = streamsResult.stdout;
  } catch (error) {
    if (error?.code === 'ENOENT') {
      throw createDouyinResolveError({
        stage: 'ffprobe_missing',
        statusCode: 500,
        message: '服务器未安装 ffprobe，无法校验抖音视频文件。',
        detail: '请先在本地安装 ffmpeg；ffprobe 会随 ffmpeg 一起安装。'
      });
    }
    throw error;
  }

  let formatParsed = null;
  let streamsParsed = null;
  try {
    formatParsed = JSON.parse(String(formatStdout || '{}'));
    streamsParsed = JSON.parse(String(streamsStdout || '{}'));
  } catch {
    throw new Error('ffprobe output is not valid JSON');
  }

  const durationSeconds = Number.parseFloat(String(formatParsed?.format?.duration || '0'));
  const formatName = readValue(formatParsed?.format?.format_name);
  const probedSize = Number.parseFloat(String(formatParsed?.format?.size || '0'));

  if (!Number.isFinite(durationSeconds) || durationSeconds <= 0) {
    throw new Error('ffprobe returned invalid duration');
  }

  // Check for audio stream
  const streams = Array.isArray(streamsParsed?.streams) ? streamsParsed.streams : [];
  const hasAudioStream = streams.some((s) => s?.codec_type === 'audio');
  if (!hasAudioStream) {
    const error = new Error('视频文件缺少音频流');
    error.noAudioStream = true;
    throw error;
  }

  return {
    durationSeconds,
    formatName,
    probedSize: Number.isFinite(probedSize) ? probedSize : 0
  };
}

function computeVideoBitrateKbps(durationSeconds, audioBitrateKbps, targetBytes, ratio = 1) {
  const safeDuration = Math.max(durationSeconds, 1);
  const targetBits = targetBytes * 8;
  const audioBitsPerSecond = audioBitrateKbps * 1000;
  const muxingReserveBitsPerSecond = 160 * 1000;
  const computed = Math.floor(((targetBits / safeDuration) - audioBitsPerSecond - muxingReserveBitsPerSecond) / 1000);
  return Math.max(220, Math.floor(computed * ratio));
}

async function transcodeVideoToMp4({ inputPath, outputPath, videoBitrateKbps, audioBitrateKbps }) {
  await execFileAsync('ffmpeg', [
    '-y',
    '-i', inputPath,
    '-c:v', 'libx264',
    '-preset', 'veryfast',
    '-b:v', `${videoBitrateKbps}k`,
    '-maxrate', `${Math.max(videoBitrateKbps, Math.floor(videoBitrateKbps * 1.15))}k`,
    '-bufsize', `${Math.max(videoBitrateKbps * 2, 512)}k`,
    '-c:a', 'aac',
    '-b:a', `${audioBitrateKbps}k`,
    '-movflags', '+faststart',
    outputPath
  ]);
}

async function maybeCompressLargeVideo({ filePath, originalSize, durationSeconds, mediaId }) {
  if (originalSize <= MAX_VIDEO_ORIGINAL_UPLOAD_BYTES) {
    return {
      filePath,
      compressed: false,
      finalSize: originalSize
    };
  }

  await ensureVideoCompressionTools();

  const firstPassPath = path.join(UPLOAD_TEMP_DIR, `${mediaId}_compressed.mp4`);
  const secondPassPath = path.join(UPLOAD_TEMP_DIR, `${mediaId}_compressed_retry.mp4`);
  let finalPath = firstPassPath;
  let finalSize = originalSize;

  const firstPassVideoBitrate = computeVideoBitrateKbps(durationSeconds, 96, MAX_VIDEO_ORIGINAL_UPLOAD_BYTES);
  await transcodeVideoToMp4({
    inputPath: filePath,
    outputPath: firstPassPath,
    videoBitrateKbps: firstPassVideoBitrate,
    audioBitrateKbps: 96
  });

  finalSize = (await stat(firstPassPath)).size;

  if (finalSize > MAX_COMPRESSED_VIDEO_BYTES) {
    const secondPassVideoBitrate = computeVideoBitrateKbps(durationSeconds, 64, MAX_VIDEO_ORIGINAL_UPLOAD_BYTES, 0.8);
    await transcodeVideoToMp4({
      inputPath: filePath,
      outputPath: secondPassPath,
      videoBitrateKbps: secondPassVideoBitrate,
      audioBitrateKbps: 64
    });
    finalPath = secondPassPath;
    finalSize = (await stat(secondPassPath)).size;

    try {
      await unlink(firstPassPath);
    } catch {}
  }

  if (finalSize > MAX_COMPRESSED_VIDEO_BYTES) {
    throw new Error('自动压缩后视频仍然过大，请缩短视频时长或降低分辨率后重试');
  }

  try {
    await unlink(filePath);
  } catch {}

  return {
    filePath: finalPath,
    compressed: true,
    finalSize
  };
}

async function createPublicMediaUrl({ file, req }) {
  await ensureUploadTempDir();

  const publicBaseUrl = resolvePublicBaseUrl(req);
  if (!publicBaseUrl) {
    return {
      ok: false,
      error: '当前环境没有可供方舟访问的公网地址。请配置 PUBLIC_BASE_URL 为你的线上域名或可公网访问的隧道地址，再重试大视频分析。'
    };
  }

  const mediaId = randomBytes(12).toString('hex');
  const safeFileName = sanitizeFileName(file.name || 'upload.bin');
  const initialStoredFileName = `${mediaId}_${safeFileName}`;
  const initialFilePath = path.join(UPLOAD_TEMP_DIR, initialStoredFileName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(initialFilePath, buffer);

  const originalSize = buffer.length;
  let finalFilePath = initialFilePath;
  let finalStoredFileName = initialStoredFileName;
  let finalSize = originalSize;
  let compressionTriggered = false;

  if (String(file.type || '').startsWith('video/') && originalSize > MAX_VIDEO_ORIGINAL_UPLOAD_BYTES) {
    const durationSeconds = await getVideoDurationSeconds(initialFilePath);
    const compressed = await maybeCompressLargeVideo({
      filePath: initialFilePath,
      originalSize,
      durationSeconds,
      mediaId
    });
    finalFilePath = compressed.filePath;
    finalStoredFileName = path.basename(finalFilePath);
    finalSize = compressed.finalSize;
    compressionTriggered = compressed.compressed;
  }

  scheduleMediaCleanup(finalFilePath);

  return {
    ok: true,
    filePath: finalFilePath,
    storedFileName: finalStoredFileName,
    url: `${publicBaseUrl}/uploads/${finalStoredFileName}`,
    originalSize,
    compressionTriggered,
    finalSize
  };
}

async function handlePublicMediaRequest(req, res, requestedFileName) {
  const safeFileName = sanitizeStoredFileName(requestedFileName);
  if (!safeFileName) {
    sendJson(res, 404, { error: '媒体文件不存在或已过期' });
    return;
  }

  const filePath = path.normalize(path.join(UPLOAD_TEMP_DIR, safeFileName));
  if (!filePath.startsWith(UPLOAD_TEMP_DIR)) {
    sendJson(res, 403, { error: '禁止访问' });
    return;
  }

  try {
    const info = await stat(filePath);
    const maxAgeMs = MEDIA_TTL_MS - (Date.now() - info.mtimeMs);
    if (maxAgeMs <= 0) {
      try {
        await unlink(filePath);
      } catch {}
      sendJson(res, 404, { error: '媒体文件不存在或已过期' });
      return;
    }

    const content = await readFile(filePath);
    const ext = path.extname(filePath).toLowerCase();
    res.writeHead(200, {
      'Content-Type': MIME_TYPES[ext] || 'application/octet-stream',
      'Content-Length': content.length,
      'Cache-Control': `public, max-age=${Math.max(1, Math.floor(maxAgeMs / 1000))}`,
      'Content-Disposition': `inline; filename="${safeFileName}"`
    });
    res.end(content);
  } catch {
    sendJson(res, 404, { error: '媒体文件不存在或已过期' });
  }
}

function logFrontendSelection() {
  const requestedMode = FRONTEND_MODE === 'react' || FRONTEND_MODE === 'legacy' ? FRONTEND_MODE : 'legacy';
  const requestedDir = requestedMode === 'react' ? REACT_FRONTEND_DIR : LEGACY_FRONTEND_DIR;

  console.log(`[frontend] requested mode: ${requestedMode}`);
  console.log(`[frontend] requested dir: ${requestedDir}`);

  if (!HAS_ACTIVE_FRONTEND_DIR && HAS_FALLBACK_FRONTEND_DIR) {
    console.warn(`[frontend] requested directory is missing, falling back to ${RESOLVED_FRONTEND_MODE}: ${RESOLVED_FRONTEND_DIR}`);
    return;
  }

  console.log(`[frontend] serving mode: ${RESOLVED_FRONTEND_MODE}`);
  console.log(`[frontend] serving dir: ${RESOLVED_FRONTEND_DIR}`);
  console.log(`[public] configured PUBLIC_BASE_URL: ${getConfiguredPublicBaseUrl() || '(empty)'}`);
  console.log(`[public] upload temp dir: ${UPLOAD_TEMP_DIR}`);
}

function getAllowedOrigin(origin) {
  if (!origin) return '*';
  if (CORS_ALLOW_ORIGIN === '*') return origin;

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
  res.setHeader('Access-Control-Allow-Credentials', 'true');
}

function parseCookies(req) {
  const raw = req.headers.cookie || '';
  return raw.split(';').reduce((acc, item) => {
    const trimmed = item.trim();
    if (!trimmed) return acc;
    const eqIndex = trimmed.indexOf('=');
    const key = eqIndex >= 0 ? trimmed.slice(0, eqIndex).trim() : trimmed;
    const value = eqIndex >= 0 ? trimmed.slice(eqIndex + 1).trim() : '';
    if (key) acc[key] = decodeURIComponent(value);
    return acc;
  }, {});
}

function shouldUseSecureCookie(req) {
  if (req.headers['x-forwarded-proto'] === 'https') return true;
  const origin = req.headers.origin || '';
  const referer = req.headers.referer || '';
  return origin.startsWith('https://') || referer.startsWith('https://');
}

function serializeAuthCookie(token, req) {
  const parts = [
    `${AUTH_COOKIE_NAME}=${encodeURIComponent(token)}`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax'
  ];
  if (shouldUseSecureCookie(req)) parts.push('Secure');
  return parts.join('; ');
}

function clearAuthCookie(res, req) {
  const parts = [
    `${AUTH_COOKIE_NAME}=`,
    'HttpOnly',
    'Path=/',
    'SameSite=Lax',
    'Max-Age=0'
  ];
  if (shouldUseSecureCookie(req)) parts.push('Secure');
  res.setHeader('Set-Cookie', parts.join('; '));
}

function getAuthTokenFromRequest(req) {
  const cookies = parseCookies(req);
  const token = cookies[AUTH_COOKIE_NAME];
  if (!token) return '';
  return authSessions.has(token) ? token : '';
}

function isAuthenticated(req) {
  return !!getAuthTokenFromRequest(req);
}

function passwordsMatch(input, expected) {
  const left = Buffer.from(String(input || ''), 'utf8');
  const right = Buffer.from(String(expected || ''), 'utf8');
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function handleAuthLogin(req, res) {
  if (!APP_LOGIN_PASSWORD) {
    sendJson(res, 500, { error: '服务端未配置 APP_LOGIN_PASSWORD' });
    return;
  }

  try {
    const body = await readRequestBody(req);
    if (!passwordsMatch(body.password, APP_LOGIN_PASSWORD)) {
      sendJson(res, 401, { error: '密码错误' });
      return;
    }

    const oldToken = getAuthTokenFromRequest(req);
    if (oldToken) authSessions.delete(oldToken);

    const token = randomBytes(32).toString('hex');
    authSessions.set(token, { createdAt: Date.now() });
    res.setHeader('Set-Cookie', serializeAuthCookie(token, req));
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 400, { error: error.message || '登录失败' });
  }
}

function handleAuthStatus(req, res) {
  sendJson(res, 200, { ok: true, authenticated: isAuthenticated(req) });
}

async function handleConfigStatus(req, res) {
  const publicBaseUrl = getConfiguredPublicBaseUrl();
  const configuredSpeakerIds = getConfiguredVolcSpeakerIds();
  const remoteSlotSummary = await getVolcSpeakerRemoteSlotSummary();
  sendJson(res, 200, {
    ok: true,
    auth: {
      passwordConfigured: !!APP_LOGIN_PASSWORD
    },
    serverManaged: {
      arkApiKey: !!readValue(SERVER_CONFIG.arkApiKey),
      aliyunApiKey: !!readValue(SERVER_CONFIG.aliyunApiKey),
      zhipuApiKey: !!readValue(SERVER_CONFIG.zhipuApiKey),
      siliconFlowApiKey: !!readValue(SERVER_CONFIG.siliconFlowApiKey),
      seedanceApiKey: !!readValue(SERVER_CONFIG.seedanceApiKey),
      volcAppKey: !!readValue(SERVER_CONFIG.volcAppKey) || SERVER_CONFIG.volcEngineGroups.length > 0,
      volcAccessKey: !!readValue(SERVER_CONFIG.volcAccessKey) || SERVER_CONFIG.volcEngineGroups.length > 0,
      volcSpeakerId: configuredSpeakerIds.length > 0,
      volcSpeakerSlotTotal: configuredSpeakerIds.length,
      volcSpeakerSlotUsed: remoteSlotSummary.used,
      volcSpeakerSlotAvailable: remoteSlotSummary.available,
      volcSpeakerSlotUnknown: remoteSlotSummary.unknown,
      volcSpeakerSlotSource: remoteSlotSummary.source,
      tikhubApiToken: !!readValue(SERVER_CONFIG.tikhubApiToken),
      wechatApiToken: !!readValue(SERVER_CONFIG.wechatApiToken),
      douyinApiToken: !!readValue(SERVER_CONFIG.douyinApiToken),
      gptImageApiKey: !!readValue(SERVER_CONFIG.gptImageApiKey),
      dashscopeApiKey: !!readValue(SERVER_CONFIG.dashscopeApiKey),
      doubaoMultimodalModel: DEFAULT_DOUBAO_MULTIMODAL_MODEL,
      voiceCloneMockMode: VOICE_CLONE_MOCK_MODE,
      publicBaseUrl: !!publicBaseUrl
    },
    public: {
      baseUrl: publicBaseUrl || ''
    }
  });
}

function handleAuthLogout(req, res) {
  const token = getAuthTokenFromRequest(req);
  if (token) authSessions.delete(token);
  clearAuthCookie(res, req);
  sendJson(res, 200, { ok: true });
}

function readValue(...candidates) {
  for (const value of candidates) {
    if (typeof value === 'string' && value.trim()) return value.trim();
  }
  return '';
}

function normalizeSpeechRate(value, fallback = 1) {
  const parsed = Number(value);
  const safe = Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  return Math.min(2, Math.max(0.5, safe));
}

function speechRateToVolcSpeechRate(rate) {
  const normalized = normalizeSpeechRate(rate);
  return Math.round((normalized - 1) * 100);
}

function buildVolcAudioParams(speechRate) {
  const audioParams = {
    format: 'pcm',
    sample_rate: 24000
  };
  const normalizedSpeechRate = normalizeSpeechRate(speechRate);
  if (Math.abs(normalizedSpeechRate - 1) >= 0.001) {
    audioParams.speech_rate = speechRateToVolcSpeechRate(normalizedSpeechRate);
  }
  return audioParams;
}

function buildAliyunRealtimeSession({ voice }) {
  return {
    mode: 'commit',
    voice,
    language_type: 'Auto',
    response_format: 'pcm',
    sample_rate: 24000
  };
}

function parseJsonString(value, fallback = null) {
  const raw = readValue(value);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

// --- Collection Module Database ---

function getCollectionDb() {
  if (!collectionDb) {
    collectionDb = new DatabaseSync(COLLECTION_DB_PATH);
    collectionDb.exec(`
      CREATE TABLE IF NOT EXISTS monitored_keywords (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword TEXT NOT NULL UNIQUE,
        platforms TEXT NOT NULL DEFAULT '[]',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS collected_articles (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        keyword_id INTEGER NOT NULL,
        platform TEXT NOT NULL,
        title TEXT NOT NULL DEFAULT '',
        content TEXT NOT NULL DEFAULT '',
        url TEXT NOT NULL DEFAULT '',
        short_link TEXT NOT NULL DEFAULT '',
        author TEXT NOT NULL DEFAULT '',
        avatar TEXT NOT NULL DEFAULT '',
        read_count INTEGER NOT NULL DEFAULT 0,
        praise_count INTEGER NOT NULL DEFAULT 0,
        looking_count INTEGER NOT NULL DEFAULT 0,
        publish_time INTEGER,
        classify TEXT NOT NULL DEFAULT '',
        is_original INTEGER NOT NULL DEFAULT 0,
        ip_wording TEXT NOT NULL DEFAULT '',
        raw_data TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (keyword_id) REFERENCES monitored_keywords(id) ON DELETE CASCADE
      );

      CREATE INDEX IF NOT EXISTS idx_articles_keyword_id ON collected_articles(keyword_id);
      CREATE INDEX IF NOT EXISTS idx_articles_platform ON collected_articles(platform);
      CREATE INDEX IF NOT EXISTS idx_articles_publish_time ON collected_articles(publish_time);

      CREATE TABLE IF NOT EXISTS image_generation_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        prompt TEXT NOT NULL,
        size TEXT NOT NULL DEFAULT '1:1',
        resolution TEXT NOT NULL DEFAULT '1k',
        status TEXT NOT NULL DEFAULT 'submitted',
        external_task_id TEXT,
        result_urls TEXT NOT NULL DEFAULT '[]',
        reference_images TEXT NOT NULL DEFAULT '[]',
        error_message TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER
      );

      CREATE INDEX IF NOT EXISTS idx_image_tasks_status ON image_generation_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_image_tasks_created ON image_generation_tasks(created_at DESC);
    `);

    // Migration: add reference_images column if it doesn't exist (existing tables before this column was added)
    try {
      collectionDb.exec(`ALTER TABLE image_generation_tasks ADD COLUMN reference_images TEXT NOT NULL DEFAULT '[]'`);
    } catch {
      // Column already exists, ignore
    }
  }
  return collectionDb;
}

function dbInsertKeyword(keyword, platforms) {
  const db = getCollectionDb();
  const stmt = db.prepare(
    'INSERT INTO monitored_keywords (keyword, platforms, created_at, updated_at) VALUES (?, ?, unixepoch(), unixepoch())'
  );
  const result = stmt.run(keyword, JSON.stringify(platforms));
  return { id: Number(result.lastInsertRowid), keyword, platforms };
}

function dbUpdateKeywordPlatforms(id, platforms) {
  const db = getCollectionDb();
  const stmt = db.prepare(
    'UPDATE monitored_keywords SET platforms = ?, updated_at = unixepoch() WHERE id = ?'
  );
  stmt.run(JSON.stringify(platforms), id);
}

function dbDeleteKeyword(id) {
  const db = getCollectionDb();
  const stmt = db.prepare('DELETE FROM monitored_keywords WHERE id = ?');
  stmt.run(id);
}

function dbGetAllKeywords() {
  const db = getCollectionDb();
  const stmt = db.prepare('SELECT * FROM monitored_keywords ORDER BY updated_at DESC');
  const rows = stmt.all();
  return rows.map((r) => ({ ...r, platforms: parseJsonString(r.platforms, []) }));
}

function dbGetKeywordById(id) {
  const db = getCollectionDb();
  const stmt = db.prepare('SELECT * FROM monitored_keywords WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;
  return { ...row, platforms: parseJsonString(row.platforms, []) };
}

function dbInsertArticle(article) {
  const db = getCollectionDb();
  const stmt = db.prepare(`
    INSERT INTO collected_articles
    (keyword_id, platform, title, content, url, short_link, author, avatar,
     read_count, praise_count, looking_count, publish_time, classify,
     is_original, ip_wording, raw_data, created_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch())
  `);
  const result = stmt.run(
    article.keyword_id,
    article.platform,
    article.title,
    article.content,
    article.url,
    article.short_link,
    article.author,
    article.avatar,
    article.read_count,
    article.praise_count,
    article.looking_count,
    article.publish_time,
    article.classify,
    article.is_original,
    article.ip_wording,
    JSON.stringify(article.raw_data)
  );
  return { id: Number(result.lastInsertRowid), ...article };
}

function dbGetArticles({ keywordId, platform, limit = 50, offset = 0 }) {
  const db = getCollectionDb();
  let sql = 'SELECT * FROM collected_articles WHERE 1=1';
  const params = [];
  if (keywordId) {
    sql += ' AND keyword_id = ?';
    params.push(keywordId);
  }
  if (platform) {
    sql += ' AND platform = ?';
    params.push(platform);
  }
  sql += ' ORDER BY publish_time DESC LIMIT ? OFFSET ?';
  params.push(limit, offset);
  const stmt = db.prepare(sql);
  return stmt.all(...params);
}

function dbCountArticles({ keywordId, platform }) {
  const db = getCollectionDb();
  let sql = 'SELECT COUNT(*) as count FROM collected_articles WHERE 1=1';
  const params = [];
  if (keywordId) {
    sql += ' AND keyword_id = ?';
    params.push(keywordId);
  }
  if (platform) {
    sql += ' AND platform = ?';
    params.push(platform);
  }
  const stmt = db.prepare(sql);
  const row = stmt.get(...params);
  return row?.count || 0;
}

function dbArticleExists(keywordId, platform, url) {
  const db = getCollectionDb();
  const stmt = db.prepare(
    'SELECT id FROM collected_articles WHERE keyword_id = ? AND platform = ? AND url = ? LIMIT 1'
  );
  const row = stmt.get(keywordId, platform, url);
  return !!row;
}

// --- Image Generation Database ---

function dbInsertImageTask({ prompt, size, resolution, externalTaskId, referenceImages }) {
  const db = getCollectionDb();
  const stmt = db.prepare(
    'INSERT INTO image_generation_tasks (prompt, size, resolution, status, external_task_id, reference_images, created_at) VALUES (?, ?, ?, ?, ?, ?, unixepoch())'
  );
  const result = stmt.run(prompt, size, resolution, 'submitted', externalTaskId || '', JSON.stringify(referenceImages || []));
  return { id: Number(result.lastInsertRowid), prompt, size, resolution, status: 'submitted', external_task_id: externalTaskId || '', reference_images: referenceImages || [] };
}

function dbUpdateImageTaskStatus(id, { status, externalTaskId, resultUrls, errorMessage, completedAt }) {
  const db = getCollectionDb();
  const fields = [];
  const values = [];
  if (status !== undefined) { fields.push('status = ?'); values.push(status); }
  if (externalTaskId !== undefined) { fields.push('external_task_id = ?'); values.push(externalTaskId); }
  if (resultUrls !== undefined) { fields.push('result_urls = ?'); values.push(JSON.stringify(resultUrls)); }
  if (errorMessage !== undefined) { fields.push('error_message = ?'); values.push(errorMessage); }
  if (completedAt !== undefined) { fields.push('completed_at = ?'); values.push(completedAt); }
  if (fields.length === 0) return;
  values.push(id);
  const stmt = db.prepare(`UPDATE image_generation_tasks SET ${fields.join(', ')} WHERE id = ?`);
  stmt.run(...values);
}

function dbGetImageTaskById(id) {
  const db = getCollectionDb();
  const stmt = db.prepare('SELECT * FROM image_generation_tasks WHERE id = ?');
  const row = stmt.get(id);
  if (!row) return null;
  return { ...row, result_urls: parseJsonString(row.result_urls, []), reference_images: parseJsonString(row.reference_images, []) };
}

function dbGetImageTasks({ limit = 50, offset = 0 }) {
  const db = getCollectionDb();
  const stmt = db.prepare('SELECT * FROM image_generation_tasks ORDER BY created_at DESC LIMIT ? OFFSET ?');
  const rows = stmt.all(limit, offset);
  return rows.map((r) => ({ ...r, result_urls: parseJsonString(r.result_urls, []), reference_images: parseJsonString(r.reference_images, []) }));
}

function dbCountImageTasks() {
  const db = getCollectionDb();
  const stmt = db.prepare('SELECT COUNT(*) as count FROM image_generation_tasks');
  const row = stmt.get();
  return row?.count || 0;
}

function dbDeleteImageTask(id) {
  const db = getCollectionDb();
  const stmt = db.prepare('DELETE FROM image_generation_tasks WHERE id = ?');
  stmt.run(id);
}

// --- Collection Module External APIs ---

async function fetchWechatArticles(keyword, options = {}) {
  const token = readValue(SERVER_CONFIG.wechatApiToken);
  if (!token) {
    throw new Error('未配置 WECHAT_API_TOKEN，请在 .env 中设置');
  }

  const body = {
    kw: keyword,
    sort_type: options.sort_type || 1,
    mode: options.mode || 1,
    period: options.period || 7,
    page: options.page || 1,
    any_kw: options.any_kw || '',
    ex_kw: options.ex_kw || '',
    verifycode: options.verifycode || '',
    type: options.type || 1,
  };

  const response = await fetch('http://cn8n.com/p4/fbmain/monitor/v3/kw_search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`公众号 API 请求失败: HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || `公众号 API 错误: code ${json.code}`);
  }

  return json.data || { data: [], total: 0, page: 1, total_page: 0 };
}

async function fetchXhsArticles(keyword, options = {}) {
  throw new Error('小红书 API 尚未配置');
}

async function fetchDouyinArticles(keyword, options = {}) {
  const token = readValue(SERVER_CONFIG.douyinApiToken);
  if (!token) {
    throw new Error('未配置 DOUYIN_API_TOKEN，请在 .env 中设置');
  }

  const body = {
    keyword: keyword,
    cursor: options.cursor || '',
    log_id: options.log_id || '',
    sort_type: String(options.sort_type || ''),
    publish_time: String(options.publish_time || ''),
    filter_duration: String(options.filter_duration || ''),
    content_type: String(options.content_type || ''),
  };

  const response = await fetch('http://cn8n.com/p2/douyin/general_search', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify(body),
  });

  if (!response.ok) {
    throw new Error(`抖音 API 请求失败: HTTP ${response.status}`);
  }

  const json = await response.json();
  if (json.code !== 0 && json.code !== 200) {
    throw new Error(json.msg || `抖音 API 错误: code ${json.code}`);
  }

  return json.data || { data: [], cost: 0, balance: 0, status_code: 0 };
}

// --- Collection Module Route Handlers ---

async function handleGetKeywords(req, res) {
  try {
    const keywords = dbGetAllKeywords();
    sendJson(res, 200, { ok: true, keywords });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '获取关键词列表失败' });
  }
}

async function handleCreateKeyword(req, res) {
  try {
    const body = await readRequestBody(req);
    const keyword = String(body.keyword || '').trim();
    const platforms = Array.isArray(body.platforms) ? body.platforms : [];

    if (!keyword) {
      sendJson(res, 400, { error: '关键词不能为空' });
      return;
    }

    const result = dbInsertKeyword(keyword, platforms);
    sendJson(res, 200, { ok: true, keyword: result });
  } catch (error) {
    if (error.message?.includes('UNIQUE constraint failed')) {
      sendJson(res, 409, { error: '该关键词已存在' });
      return;
    }
    sendJson(res, 500, { error: error.message || '添加关键词失败' });
  }
}

async function handleUpdateKeyword(req, res, id) {
  try {
    const body = await readRequestBody(req);
    const platforms = Array.isArray(body.platforms) ? body.platforms : [];
    const keyword = dbGetKeywordById(Number(id));

    if (!keyword) {
      sendJson(res, 404, { error: '关键词不存在' });
      return;
    }

    dbUpdateKeywordPlatforms(Number(id), platforms);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '更新关键词失败' });
  }
}

async function handleDeleteKeyword(req, res, id) {
  try {
    dbDeleteKeyword(Number(id));
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '删除关键词失败' });
  }
}

async function handleFetchKeyword(req, res, id) {
  try {
    const keyword = dbGetKeywordById(Number(id));
    if (!keyword) {
      sendJson(res, 404, { error: '关键词不存在' });
      return;
    }

    const results = { wechat: null, xhs: null, douyin: null };
    const errors = {};

    for (const platform of keyword.platforms) {
      if (platform === 'wechat') {
        try {
          const data = await fetchWechatArticles(keyword.keyword);
          const articles = data.data || [];
          let inserted = 0;
          let skipped = 0;

          for (const item of articles) {
            const url = item.url || item.short_link || '';
            if (!url) continue;

            if (dbArticleExists(keyword.id, 'wechat', url)) {
              skipped++;
              continue;
            }

            dbInsertArticle({
              keyword_id: keyword.id,
              platform: 'wechat',
              title: item.title || '',
              content: item.content || '',
              url: item.url || '',
              short_link: item.short_link || '',
              author: item.wx_name || '',
              avatar: item.avatar || '',
              read_count: Number(item.read) || 0,
              praise_count: Number(item.praise) || 0,
              looking_count: Number(item.looking) || 0,
              publish_time: item.publish_time ? Number(item.publish_time) : null,
              classify: item.classify || '',
              is_original: item.is_original ? 1 : 0,
              ip_wording: item.ip_wording || '',
              raw_data: item,
            });
            inserted++;
          }

          results.wechat = { total: articles.length, inserted, skipped, page: data.page, total_page: data.total_page };
        } catch (e) {
          errors.wechat = e.message;
        }
      } else if (platform === 'xhs') {
        try {
          const data = await fetchXhsArticles(keyword.keyword);
          results.xhs = data;
        } catch (e) {
          errors.xhs = e.message;
        }
      } else if (platform === 'douyin') {
        try {
          const data = await fetchDouyinArticles(keyword.keyword);
          const items = data.data || [];
          let inserted = 0;
          let skipped = 0;

          for (const item of items) {
            const info = item.aweme_info || {};
            const author = info.author || {};
            const stats = info.statistics || {};
            const video = info.video || {};
            const coverObj = video.cover || {};
            const coverUrls = coverObj.url_list || [];
            const avatarObj = author.avatar_thumb || {};
            const avatarUrls = avatarObj.url_list || [];
            const awemeId = info.aweme_id || '';
            const url = awemeId ? `https://www.douyin.com/video/${awemeId}` : '';
            if (!url) continue;

            if (dbArticleExists(keyword.id, 'douyin', url)) {
              skipped++;
              continue;
            }

            dbInsertArticle({
              keyword_id: keyword.id,
              platform: 'douyin',
              title: info.desc || '',
              content: info.desc || '',
              url: url,
              short_link: '',
              author: author.nickname || '',
              avatar: avatarUrls[0] || '',
              read_count: Number(stats.comment_count) || 0,
              praise_count: Number(stats.digg_count) || 0,
              looking_count: Number(stats.collect_count) || 0,
              publish_time: info.create_time ? Number(info.create_time) : null,
              classify: author.enterprise_verify_reason || '',
              is_original: 0,
              ip_wording: author.custom_verify || '',
              raw_data: info,
            });
            inserted++;
          }

          results.douyin = { total: items.length, inserted, skipped };
        } catch (e) {
          errors.douyin = e.message;
        }
      }
    }

    sendJson(res, 200, { ok: true, results, errors });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '采集失败' });
  }
}

async function handleGetArticles(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const keywordId = url.searchParams.get('keywordId');
    const platform = url.searchParams.get('platform');
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

    const articles = dbGetArticles({ keywordId: keywordId ? Number(keywordId) : null, platform, limit, offset });
    const total = dbCountArticles({ keywordId: keywordId ? Number(keywordId) : null, platform });

    sendJson(res, 200, { ok: true, articles, total, limit, offset });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '获取文章列表失败' });
  }
}

// --- Image Generation API Handlers ---

async function handleCreateImageTask(req, res) {
  try {
    const body = await readRequestBody(req);
    const prompt = String(body.prompt || '').trim();
    const size = String(body.size || '1:1');
    const resolution = String(body.resolution || '1k');

    if (!prompt) {
      sendJson(res, 400, { error: '提示词不能为空' });
      return;
    }

    const token = readValue(SERVER_CONFIG.gptImageApiKey);
    if (!token) {
      sendJson(res, 500, { error: '未配置 GPT_IMAGE_API_KEY，请在 .env 中设置' });
      return;
    }

    const apiBody = {
      model: 'gpt-image-2',
      prompt,
      n: 1,
      size,
      resolution,
    };

    const imageUrls = Array.isArray(body.image_urls) ? body.image_urls : [];
    if (imageUrls.length > 0) {
      apiBody.image_urls = imageUrls.slice(0, 16);
    }

    const response = await fetch('https://api.apimart.ai/v1/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(apiBody),
    });

    const json = await response.json();
    if (!response.ok) {
      const msg = json?.error?.message || json?.message || `图片生成 API 错误: HTTP ${response.status}`;
      sendJson(res, 500, { error: msg });
      return;
    }

    const taskData = json.data?.[0];
    if (!taskData || !taskData.task_id) {
      sendJson(res, 500, { error: '图片生成 API 返回异常，未获取到任务 ID' });
      return;
    }

    const task = dbInsertImageTask({
      prompt,
      size,
      resolution,
      externalTaskId: taskData.task_id,
      referenceImages: imageUrls,
    });

    sendJson(res, 200, { ok: true, task });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '创建图片生成任务失败' });
  }
}

async function handleGetImageTaskStatus(req, res, id) {
  try {
    const task = dbGetImageTaskById(Number(id));
    if (!task) {
      sendJson(res, 404, { error: '任务不存在' });
      return;
    }

    // If already completed or failed locally, return cached result
    if (task.status === 'completed' || task.status === 'failed') {
      sendJson(res, 200, { ok: true, task });
      return;
    }

    // Poll upstream API
    const token = readValue(SERVER_CONFIG.gptImageApiKey);
    if (!token) {
      sendJson(res, 500, { error: '未配置 GPT_IMAGE_API_KEY' });
      return;
    }

    const response = await fetch(`https://api.apimart.ai/v1/tasks/${task.external_task_id}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    const json = await response.json();
    if (!response.ok) {
      sendJson(res, 500, { error: json?.error?.message || '查询任务状态失败' });
      return;
    }

    const upstreamTask = json.data;
    if (!upstreamTask) {
      sendJson(res, 200, { ok: true, task });
      return;
    }

    const upstreamStatus = upstreamTask.status;
    if (upstreamStatus === 'completed') {
      const images = upstreamTask.result?.images || [];
      const urls = images.flatMap((img) => img.url || []);
      dbUpdateImageTaskStatus(task.id, {
        status: 'completed',
        resultUrls: urls,
        completedAt: upstreamTask.completed || Math.floor(Date.now() / 1000),
      });
      task.status = 'completed';
      task.result_urls = urls;
      task.completed_at = upstreamTask.completed || Math.floor(Date.now() / 1000);
    } else if (upstreamStatus === 'failed') {
      dbUpdateImageTaskStatus(task.id, {
        status: 'failed',
        errorMessage: upstreamTask.error?.message || '任务失败',
      });
      task.status = 'failed';
      task.error_message = upstreamTask.error?.message || '任务失败';
    } else {
      // processing or submitted - update status if changed
      if (upstreamStatus !== task.status) {
        dbUpdateImageTaskStatus(task.id, { status: upstreamStatus });
        task.status = upstreamStatus;
      }
    }

    sendJson(res, 200, { ok: true, task });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '查询任务状态失败' });
  }
}

async function handleGetImageTasks(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') || 50)));
    const offset = Math.max(0, Number(url.searchParams.get('offset') || 0));

    const tasks = dbGetImageTasks({ limit, offset });
    const total = dbCountImageTasks();

    sendJson(res, 200, { ok: true, tasks, total, limit, offset });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '获取任务列表失败' });
  }
}

async function handleDeleteImageTask(req, res, id) {
  try {
    dbDeleteImageTask(Number(id));
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '删除任务失败' });
  }
}

async function handleChatCompletions(req, res) {
  try {
    const body = await readRequestBody(req);
    const messages = body.messages;
    const model = String(body.model || 'claude-opus-4-7');
    const stream = body.stream !== false;

    if (!Array.isArray(messages) || messages.length === 0) {
      sendJson(res, 400, { error: 'messages 不能为空' });
      return;
    }

    const token = readValue(SERVER_CONFIG.gptImageApiKey);
    if (!token) {
      sendJson(res, 500, { error: '未配置 API Key' });
      return;
    }

    const apiBody = {
      model,
      messages,
      stream,
    };

    if (typeof body.temperature === 'number') apiBody.temperature = body.temperature;
    if (typeof body.max_tokens === 'number') apiBody.max_tokens = body.max_tokens;
    if (typeof body.top_p === 'number') apiBody.top_p = body.top_p;

    const response = await fetch('https://api.apimart.ai/v1/chat/completions', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(apiBody),
    });

    if (!response.ok) {
      const text = await response.text();
      let msg = `API 错误: HTTP ${response.status}`;
      try {
        const errJson = JSON.parse(text);
        msg = errJson?.error?.message || errJson?.message || msg;
      } catch {
        msg = text || msg;
      }
      sendJson(res, 500, { error: msg });
      return;
    }

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const reader = response.body.getReader();
      const decoder = new TextDecoder();

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;
          res.write(decoder.decode(value, { stream: true }));
          if (res.flush) res.flush();
        }
      } catch (err) {
        console.error('[chat] stream error:', err.message);
      } finally {
        const remaining = decoder.decode();
        if (remaining) res.write(remaining);
        reader.releaseLock();
        res.end();
      }
    } else {
      const data = await response.text();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(data);
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || '对话请求失败' });
  }
}

async function callWebSearchApi(query) {
  const apiKey = readValue(SERVER_CONFIG.webSearchApiKey);
  if (!apiKey) return null;
  try {
    const res = await fetch('https://open.feedcoopapi.com/search_api/web_search', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        Query: query,
        SearchType: 'web_summary',
        Count: 5,
        NeedSummary: true,
      }),
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null;
  }
}

function formatWebSearchResults(searchData) {
  const results = searchData?.Result?.WebResults || [];
  if (results.length === 0) return '';
  const lines = ['【联网搜索结果】'];
  for (const item of results) {
    lines.push(`\n标题：${item.Title || ''}`);
    if (item.Summary) lines.push(`摘要：${item.Summary}`);
    else if (item.Snippet) lines.push(`摘要：${item.Snippet}`);
    if (item.Url) lines.push(`链接：${item.Url}`);
  }
  return lines.join('\n');
}

async function handleDoubaoChatCompletions(req, res) {
  try {
    const body = await readRequestBody(req);
    const messages = body.messages;
    const tools = body.tools;
    const stream = body.stream !== false;

    if (!Array.isArray(messages) || messages.length === 0) {
      sendJson(res, 400, { error: 'messages 不能为空' });
      return;
    }

    const apiKey = readValue(SERVER_CONFIG.doubaoTopmodelApiKey) || readValue(SERVER_CONFIG.seedanceApiKey);
    if (!apiKey) {
      sendJson(res, 500, { error: '未配置 Doubao API Key' });
      return;
    }

    const hasWebSearch = Array.isArray(tools) && tools.some((t) => t.type === 'web_search');
    console.log('[doubao-chat] hasWebSearch:', hasWebSearch, 'tools:', JSON.stringify(tools));

    const input = [];
    for (const msg of messages) {
      const role = String(msg.role || '');
      if (role === 'system') {
        input.push({ role: 'developer', content: msg.content });
        continue;
      }
      if (role === 'assistant') {
        input.push({ role: 'assistant', content: msg.content });
        continue;
      }

      const content = [];
      if (Array.isArray(msg.images) && msg.images.length > 0) {
        for (const img of msg.images) {
          content.push({ type: 'input_image', image_url: img });
        }
      }
      if (Array.isArray(msg.videos) && msg.videos.length > 0) {
        for (const video of msg.videos) {
          content.push({ type: 'input_video', video_url: video });
        }
      }
      content.push({ type: 'input_text', text: String(msg.content || '') });
      input.push({ role: 'user', content });
    }

    const requestPayload = {
      model: 'doubao-seed-2-0-pro-260215',
      stream,
      input,
    };

    if (hasWebSearch) {
      requestPayload.tools = [{ type: 'web_search', max_keyword: 3 }];
    }

    const upstreamRes = await fetch('https://ark.cn-beijing.volces.com/api/v3/responses', {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        'Accept': stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(requestPayload),
    });

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      const rawError = json?.error?.message || json?.message || json?.code || text;
      const zhError = translateUpstreamError(rawError, `方舟 API 请求失败（状态码 ${upstreamRes.status}）`);
      sendJson(res, upstreamRes.status, { error: zhError, upstream: json || text });
      return;
    }

    if (stream) {
      res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      });

      const reader = upstreamRes.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      try {
        while (true) {
          const { done, value } = await reader.read();
          if (done) break;

          buffer += decoder.decode(value, { stream: true });
          const blocks = buffer.split(/\n\n/);
          buffer = blocks.pop() || '';

          for (const block of blocks) {
            const parsed = parseDoubaoSseBlock(block);
            if (!parsed) continue;
            if (parsed.done) continue;
            if (!isDoubaoDeltaEvent(parsed.event)) continue;

            const delta = extractVisibleDoubaoDelta(parsed.payload, parsed.event);
            if (delta) {
              const openaiChunk = JSON.stringify({
                choices: [{ delta: { content: delta } }]
              });
              res.write(`data: ${openaiChunk}\n\n`);
              if (res.flush) res.flush();
            }
          }
        }
      } catch (err) {
        console.error('[doubao-chat] stream error:', err.message);
      } finally {
        const tail = decoder.decode();
        if (tail) {
          buffer += tail;
          if (buffer.trim()) {
            const parsed = parseDoubaoSseBlock(buffer);
            if (parsed && !parsed.done && isDoubaoDeltaEvent(parsed.event)) {
              const delta = extractVisibleDoubaoDelta(parsed.payload, parsed.event);
              if (delta) {
                const openaiChunk = JSON.stringify({
                  choices: [{ delta: { content: delta } }]
                });
                res.write(`data: ${openaiChunk}\n\n`);
              }
            }
          }
        }
        res.write('data: [DONE]\n\n');
        res.end();
      }
    } else {
      const text = await upstreamRes.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}

      let content = '';
      if (json?.output) {
        for (const item of json.output) {
          if (item.role === 'assistant' && Array.isArray(item.content)) {
            for (const c of item.content) {
              if (c.type === 'output_text' && c.text) {
                content += c.text;
              }
            }
          }
        }
      }

      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(JSON.stringify({
        choices: [{ message: { role: 'assistant', content } }]
      }));
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || '对话请求失败' });
  }
}

async function handleQwenChatCompletions(req, res) {
  try {
    const body = await readRequestBody(req);
    const messages = body.messages;
    const tools = body.tools;
    const stream = body.stream !== false;

    if (!Array.isArray(messages) || messages.length === 0) {
      sendJson(res, 400, { error: 'messages 不能为空' });
      return;
    }

    const apiKey = readValue(SERVER_CONFIG.dashscopeApiKey);
    if (!apiKey) {
      sendJson(res, 500, { error: '未配置 DashScope API Key' });
      return;
    }

    let hasVideo = false;
    for (const msg of messages) {
      if (Array.isArray(msg.content)) {
        for (const item of msg.content) {
          if (item.type === 'video') {
            hasVideo = true;
            break;
          }
        }
      }
      if (hasVideo) break;
    }

    const hasWebSearch = Array.isArray(tools) && tools.some((t) => t.type === 'web_search');
    console.log('[qwen-chat] hasVideo:', hasVideo, 'hasWebSearch:', hasWebSearch);

    if (hasVideo) {
      const transformedMessages = messages.map((msg) => {
        if (msg.role !== 'user' || !Array.isArray(msg.content)) return msg;
        const newContent = msg.content.map((item) => {
          if (item.type === 'video' && item.video?.url) {
            return { type: 'video_url', video_url: { url: item.video.url }, fps: 2 };
          }
          return item;
        });
        return { ...msg, content: newContent };
      });

      const apiBody = {
        model: 'qwen3.6-plus',
        messages: transformedMessages,
        stream,
        extra_body: { enable_thinking: true },
      };

      if (typeof body.temperature === 'number') apiBody.temperature = body.temperature;
      if (typeof body.max_tokens === 'number') apiBody.max_tokens = body.max_tokens;
      if (typeof body.top_p === 'number') apiBody.top_p = body.top_p;

      const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': stream ? 'text/event-stream' : 'application/json',
        },
        body: JSON.stringify(apiBody),
      });

      if (!response.ok) {
        const text = await response.text();
        let msg = `API 错误: HTTP ${response.status}`;
        try {
          const errJson = JSON.parse(text);
          msg = errJson?.error?.message || errJson?.message || msg;
        } catch {
          msg = text || msg;
        }
        sendJson(res, 500, { error: msg });
        return;
      }

      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        const reader = response.body.getReader();
        const decoder = new TextDecoder();

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(decoder.decode(value, { stream: true }));
            if (res.flush) res.flush();
          }
        } catch (err) {
          console.error('[qwen-chat] stream error:', err.message);
        } finally {
          const remaining = decoder.decode();
          if (remaining) res.write(remaining);
          reader.releaseLock();
          res.end();
        }
      } else {
        const data = await response.text();
        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(data);
      }
    } else {
      const input = [];
      for (const msg of messages) {
        const role = String(msg.role || '');
        if (role === 'system') {
          input.push({ role: 'system', content: msg.content });
          continue;
        }
        if (role === 'assistant') {
          input.push({ role: 'assistant', content: msg.content });
          continue;
        }

        const content = [];
        if (Array.isArray(msg.content)) {
          for (const item of msg.content) {
            if (item.type === 'text') {
              content.push({ type: 'input_text', text: String(item.text || '') });
            } else if (item.type === 'image_url') {
              const imgUrl = typeof item.image_url === 'string' ? item.image_url : (item.image_url?.url || '');
              if (imgUrl) {
                content.push({ type: 'input_image', image_url: imgUrl });
              }
            }
          }
        } else {
          content.push({ type: 'input_text', text: String(msg.content || '') });
        }
        input.push({ role: 'user', content });
      }

      const requestPayload = {
        model: 'qwen3.6-plus',
        stream,
        input,
        enable_thinking: true,
      };

      if (hasWebSearch) {
        requestPayload.tools = [{ type: 'web_search' }];
      }

      const upstreamRes = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/responses', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'Accept': stream ? 'text/event-stream' : 'application/json',
        },
        body: JSON.stringify(requestPayload),
      });

      if (!upstreamRes.ok) {
        const text = await upstreamRes.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}
        const msg = json?.error?.message || json?.message || text || `API 错误: HTTP ${upstreamRes.status}`;
        sendJson(res, upstreamRes.status, { error: msg, upstream: json || text });
        return;
      }

      if (stream) {
        res.writeHead(200, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
          'X-Accel-Buffering': 'no',
        });

        const reader = upstreamRes.body.getReader();
        const decoder = new TextDecoder();
        let buffer = '';

        try {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;

            buffer += decoder.decode(value, { stream: true });
            const lines = buffer.split('\n');
            buffer = lines.pop() || '';

            for (const line of lines) {
              const trimmed = line.replace(/\r$/, '').trim();
              if (!trimmed) continue;
              if (!trimmed.startsWith('data:')) continue;
              const dataStr = trimmed.slice(5).trim();
              if (!dataStr) continue;
              if (dataStr === '[DONE]') continue;

              try {
                const parsed = JSON.parse(dataStr);
                let delta = '';
                if (parsed?.type === 'response.output_text.delta') {
                  delta = parsed.delta || '';
                } else if (parsed?.choices?.[0]?.delta?.content) {
                  delta = parsed.choices[0].delta.content;
                }
                if (delta) {
                  const openaiChunk = JSON.stringify({
                    choices: [{ delta: { content: delta } }]
                  });
                  res.write(`data: ${openaiChunk}\n\n`);
                  if (res.flush) res.flush();
                }
              } catch {
                // ignore malformed SSE
              }
            }
          }
        } catch (err) {
          console.error('[qwen-chat] responses stream error:', err.message);
        } finally {
          const tail = decoder.decode();
          if (tail) {
            buffer += tail;
            const lines = buffer.split('\n');
            for (const line of lines) {
              const trimmed = line.replace(/\r$/, '').trim();
              if (!trimmed || !trimmed.startsWith('data:')) continue;
              const dataStr = trimmed.slice(5).trim();
              if (!dataStr || dataStr === '[DONE]') continue;
              try {
                const parsed = JSON.parse(dataStr);
                let delta = '';
                if (parsed?.type === 'response.output_text.delta') {
                  delta = parsed.delta || '';
                } else if (parsed?.choices?.[0]?.delta?.content) {
                  delta = parsed.choices[0].delta.content;
                }
                if (delta) {
                  const openaiChunk = JSON.stringify({
                    choices: [{ delta: { content: delta } }]
                  });
                  res.write(`data: ${openaiChunk}\n\n`);
                }
              } catch {}
            }
          }
          res.write('data: [DONE]\n\n');
          res.end();
        }
      } else {
        const text = await upstreamRes.text();
        let json = null;
        try { json = JSON.parse(text); } catch {}

        let content = '';
        if (json?.output) {
          for (const item of json.output) {
            if (item.role === 'assistant' && Array.isArray(item.content)) {
              for (const c of item.content) {
                if (c.type === 'output_text' && c.text) {
                  content += c.text;
                }
              }
            }
          }
        }

        res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
        res.end(JSON.stringify({
          choices: [{ message: { role: 'assistant', content } }]
        }));
      }
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || '对话请求失败' });
  }
}

function createRequestId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

function buildVolcEngineGroups() {
  const groups = [];

  // Group 1: unnumbered env vars (backward-compatible)
  const g1AppKey = process.env.VOLCENGINE_APP_KEY || '';
  const g1AccessKey = process.env.VOLCENGINE_ACCESS_KEY || '';
  const g1Pool = process.env.VOLCENGINE_SPEAKER_ID_POOL || '';
  const g1SpeakerId = process.env.VOLCENGINE_SPEAKER_ID || '';
  if (g1AppKey && g1AccessKey) {
    const speakerIds = [
      ...g1Pool.split(/[\s,]+/g).map((s) => s.trim()).filter(Boolean),
      g1SpeakerId
    ].filter(Boolean);
    if (speakerIds.length > 0) {
      groups.push({
        index: 1,
        appKey: g1AppKey,
        accessKey: g1AccessKey,
        speakerIds: Array.from(new Set(speakerIds)),
      });
    }
  }

  // Group 2+: numbered env vars (_2, _3, ... _10)
  for (let i = 2; i <= 10; i++) {
    const appKey = process.env[`VOLCENGINE_APP_KEY_${i}`] || '';
    const accessKey = process.env[`VOLCENGINE_ACCESS_KEY_${i}`] || '';
    const pool = process.env[`VOLCENGINE_SPEAKER_ID_POOL_${i}`] || '';
    const speakerId = process.env[`VOLCENGINE_SPEAKER_ID_${i}`] || '';
    if (!appKey || !accessKey) continue;
    const speakerIds = [
      ...pool.split(/[\s,]+/g).map((s) => s.trim()).filter(Boolean),
      speakerId
    ].filter(Boolean);
    if (speakerIds.length > 0) {
      groups.push({
        index: i,
        appKey,
        accessKey,
        speakerIds: Array.from(new Set(speakerIds)),
      });
    }
  }

  return groups;
}

function getVolcEngineGroupForSpeakerId(speakerId) {
  const target = readValue(speakerId);
  if (!target) return null;
  for (const group of SERVER_CONFIG.volcEngineGroups) {
    if (group.speakerIds.includes(target)) {
      return group;
    }
  }
  return null;
}

function getConfiguredVolcSpeakerIds() {
  const allIds = [];
  for (const group of SERVER_CONFIG.volcEngineGroups) {
    allIds.push(...group.speakerIds);
  }
  return Array.from(new Set(allIds));
}

function invalidateVolcSpeakerRemoteStatusCache() {
  volcSpeakerRemoteStatusCache = {
    key: '',
    expiresAt: 0,
    summary: null
  };
}

function isVolcSpeakerOccupiedByRemoteStatus(value) {
  const statuses = Array.isArray(value?.speaker_status) ? value.speaker_status : [];
  return statuses.length > 0;
}

async function getVolcSpeakerRemoteSlotSummary({ force = false } = {}) {
  const groups = SERVER_CONFIG.volcEngineGroups;
  const configuredSpeakerIds = getConfiguredVolcSpeakerIds();
  const cacheKey = JSON.stringify({
    groups: groups.map((g) => ({
      appKeyConfigured: !!g.appKey,
      accessKeyConfigured: !!g.accessKey,
      speakerIds: g.speakerIds,
    })),
  });

  if (
    !force &&
    volcSpeakerRemoteStatusCache.summary &&
    volcSpeakerRemoteStatusCache.key === cacheKey &&
    volcSpeakerRemoteStatusCache.expiresAt > Date.now()
  ) {
    return volcSpeakerRemoteStatusCache.summary;
  }

  const summary = {
    total: 0,
    used: 0,
    available: 0,
    unknown: 0,
    source: groups.length > 0 ? 'volcengine' : 'local',
    speakers: {},
  };

  if (!groups.length) {
    volcSpeakerRemoteStatusCache = {
      key: cacheKey,
      expiresAt: Date.now() + VOLC_SPEAKER_REMOTE_STATUS_CACHE_TTL_MS,
      summary,
    };
    return summary;
  }

  const ownershipState = await loadVolcSpeakerOwnershipState();

  for (const group of groups) {
    const results = await Promise.allSettled(
      group.speakerIds.map(async (speakerId) => {
        const voiceInfo = await volcJsonRequest('/api/v3/tts/get_voice', {
          appKey: group.appKey,
          accessKey: group.accessKey,
          body: { speaker_id: speakerId },
        });
        const speakerStatus = Array.isArray(voiceInfo?.speaker_status) ? voiceInfo.speaker_status : [];
        const availableTrainingTimes = typeof voiceInfo?.available_training_times === 'number' ? voiceInfo.available_training_times : 0;
        return {
          speakerId,
          speakerStatusLength: speakerStatus.length,
          availableTrainingTimes,
        };
      })
    );

    results.forEach((result) => {
      if (result.status === 'fulfilled') {
        const { speakerId, speakerStatusLength, availableTrainingTimes } = result.value;
        const hasOwnership = !!ownershipState.slots[speakerId]?.ownerDeviceId;
        summary.total += 1;

        if (availableTrainingTimes <= 0 || hasOwnership) {
          summary.speakers[speakerId] = 'used';
          summary.used += 1;
        } else {
          if (speakerStatusLength === 0) {
            summary.speakers[speakerId] = 'fresh';
          } else {
            summary.speakers[speakerId] = 'recyclable';
          }
          summary.available += 1;
        }
        return;
      }
      summary.unknown += 1;
    });
  }

  volcSpeakerRemoteStatusCache = {
    key: cacheKey,
    expiresAt: Date.now() + VOLC_SPEAKER_REMOTE_STATUS_CACHE_TTL_MS,
    summary,
  };
  return summary;
}

function normalizeDeviceId(value) {
  return readValue(value).slice(0, 128);
}

function createEmptyVolcSpeakerOwnershipState() {
  return {
    version: 1,
    slots: {}
  };
}

function sanitizeVolcSpeakerOwnershipState(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyVolcSpeakerOwnershipState();
  }

  const rawSlots = value.slots;
  const slots = {};

  if (rawSlots && typeof rawSlots === 'object' && !Array.isArray(rawSlots)) {
    for (const [speakerId, entry] of Object.entries(rawSlots)) {
      const normalizedSpeakerId = readValue(speakerId);
      if (!normalizedSpeakerId || !entry || typeof entry !== 'object' || Array.isArray(entry)) {
        continue;
      }

      const ownerDeviceId = normalizeDeviceId(entry.ownerDeviceId);
      if (!ownerDeviceId) {
        continue;
      }

      slots[normalizedSpeakerId] = {
        ownerDeviceId,
        claimedAt: readValue(entry.claimedAt),
        updatedAt: readValue(entry.updatedAt),
        preferredName: readValue(entry.preferredName),
      };
    }
  }

  return {
    version: 1,
    slots,
  };
}

function pruneVolcSpeakerOwnershipState(state) {
  const configuredSpeakerIds = new Set(getConfiguredVolcSpeakerIds());
  const nextSlots = {};

  for (const [speakerId, entry] of Object.entries(state.slots || {})) {
    if (!configuredSpeakerIds.has(speakerId)) {
      continue;
    }

    const ownerDeviceId = normalizeDeviceId(entry?.ownerDeviceId);
    if (!ownerDeviceId) {
      continue;
    }

    nextSlots[speakerId] = {
      ownerDeviceId,
      claimedAt: readValue(entry?.claimedAt),
      updatedAt: readValue(entry?.updatedAt),
      preferredName: readValue(entry?.preferredName),
    };
  }

  state.slots = nextSlots;
  return state;
}

async function loadVolcSpeakerOwnershipState() {
  if (volcSpeakerOwnershipState) {
    return pruneVolcSpeakerOwnershipState(volcSpeakerOwnershipState);
  }

  try {
    const raw = await readFile(VOLC_SPEAKER_OWNERSHIP_FILE, 'utf8');
    volcSpeakerOwnershipState = sanitizeVolcSpeakerOwnershipState(parseJsonString(raw, createEmptyVolcSpeakerOwnershipState()));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[volc speaker ownership] load_failed', {
        filePath: VOLC_SPEAKER_OWNERSHIP_FILE,
        message: error?.message || '',
        code: error?.code || ''
      });
    }
    volcSpeakerOwnershipState = createEmptyVolcSpeakerOwnershipState();
  }

  return pruneVolcSpeakerOwnershipState(volcSpeakerOwnershipState);
}

async function persistVolcSpeakerOwnershipState(state) {
  await ensureRuntimeStateDir();
  await writeFile(VOLC_SPEAKER_OWNERSHIP_FILE, JSON.stringify(state, null, 2), 'utf8');
}

function withVolcSpeakerOwnershipLock(callback) {
  const run = async () => {
    const state = await loadVolcSpeakerOwnershipState();
    const result = await callback(state);
    pruneVolcSpeakerOwnershipState(state);
    await persistVolcSpeakerOwnershipState(state);
    return result;
  };

  const next = volcSpeakerOwnershipQueue.then(run, run);
  volcSpeakerOwnershipQueue = next.then(() => undefined, () => undefined);
  return next;
}

function withVoiceArchiveLock(callback) {
  const next = voiceArchiveQueue.then(callback, callback);
  voiceArchiveQueue = next.then(() => undefined, () => undefined);
  return next;
}

function upsertVolcSpeakerOwnership(state, { speakerId, ownerDeviceId, preferredName = '', groupIndex = 1 }) {
  const existing = state.slots[speakerId];
  const now = new Date().toISOString();
  state.slots[speakerId] = {
    ownerDeviceId,
    groupIndex: groupIndex || existing?.groupIndex || 1,
    claimedAt: readValue(existing?.claimedAt, now),
    updatedAt: now,
    preferredName: readValue(preferredName, existing?.preferredName),
  };
  return state.slots[speakerId];
}

function deleteVolcSpeakerOwnership(state, speakerId) {
  if (!state.slots[speakerId]) {
    return false;
  }
  delete state.slots[speakerId];
  return true;
}

function listOwnedVolcSpeakerIds(state, ownerDeviceId) {
  return Object.entries(state.slots || {})
    .filter(([, entry]) => normalizeDeviceId(entry?.ownerDeviceId) === ownerDeviceId)
    .map(([speakerId]) => speakerId);
}

async function reserveVolcSpeakerIdForDevice({ requestedSpeakerId = '', ownerDeviceId, preferredName = '' }) {
  return withVolcSpeakerOwnershipLock(async (state) => {
    const configuredSpeakerIds = getConfiguredVolcSpeakerIds();
    const configuredSpeakerIdSet = new Set(configuredSpeakerIds);
    const desiredSpeakerId = readValue(requestedSpeakerId);
    const remoteSlotSummary = await getVolcSpeakerRemoteSlotSummary({ force: true });

    if (!configuredSpeakerIds.length) {
      return {
        ok: false,
        statusCode: 400,
        error: '当前没有可用的火山 speaker_id 槽位。请先在控制台准备多个真实 speaker_id，并通过 VOLCENGINE_SPEAKER_ID_POOL 或 VOLCENGINE_SPEAKER_ID 配置到服务端。'
      };
    }

    if (desiredSpeakerId) {
      if (!configuredSpeakerIdSet.has(desiredSpeakerId)) {
        return {
          ok: false,
          statusCode: 400,
          error: `请求的 speaker_id ${desiredSpeakerId} 不在服务端配置的槽位池中`
        };
      }

      const existingOwner = normalizeDeviceId(state.slots[desiredSpeakerId]?.ownerDeviceId);
      if (existingOwner && existingOwner !== ownerDeviceId) {
        return {
          ok: false,
          statusCode: 409,
          error: `speaker_id ${desiredSpeakerId} 已被其他设备占用`
        };
      }

      if (remoteSlotSummary.speakers[desiredSpeakerId] === 'used') {
        return {
          ok: false,
          statusCode: 409,
          error: `speaker_id ${desiredSpeakerId} 已在火山后台占用，请换一个未训练的 speaker_id`
        };
      }

      if (remoteSlotSummary.speakers[desiredSpeakerId] === 'unknown') {
        return {
          ok: false,
          statusCode: 409,
          error: `speaker_id ${desiredSpeakerId} 的火山后台状态暂时无法确认，请稍后重试`
        };
      }

      const group = getVolcEngineGroupForSpeakerId(desiredSpeakerId);
      upsertVolcSpeakerOwnership(state, {
        speakerId: desiredSpeakerId,
        ownerDeviceId,
        preferredName,
        groupIndex: group?.index || 1,
      });
      return {
        ok: true,
        speakerId: desiredSpeakerId,
        createdByRequest: !existingOwner,
      };
    }

    // Auto-assign: prioritize fresh slots, then recyclable
    const freshIds = [];
    const recyclableIds = [];

    for (const speakerId of configuredSpeakerIds) {
      const existingOwner = normalizeDeviceId(state.slots[speakerId]?.ownerDeviceId);
      if (existingOwner) {
        continue;
      }

      const status = remoteSlotSummary.speakers[speakerId];
      if (status === 'fresh') {
        freshIds.push(speakerId);
      } else if (status === 'recyclable') {
        recyclableIds.push(speakerId);
      }
    }

    const candidates = [...freshIds, ...recyclableIds];
    for (const speakerId of candidates) {
      const group = getVolcEngineGroupForSpeakerId(speakerId);
      upsertVolcSpeakerOwnership(state, {
        speakerId,
        ownerDeviceId,
        preferredName,
        groupIndex: group?.index || 1,
      });
      return {
        ok: true,
        speakerId,
        createdByRequest: true,
      };
    }

    return {
      ok: false,
      statusCode: 409,
      error: VOLC_SPEAKER_POOL_FULL_MESSAGE
    };
  });
}

async function releaseVolcSpeakerIdForDevice({ speakerId, ownerDeviceId }) {
  return withVolcSpeakerOwnershipLock(async (state) => {
    const normalizedSpeakerId = readValue(speakerId);
    const existingOwner = normalizeDeviceId(state.slots[normalizedSpeakerId]?.ownerDeviceId);

    if (!normalizedSpeakerId || !existingOwner) {
      return { released: false, reason: 'not_found' };
    }

    if (existingOwner !== ownerDeviceId) {
      return { released: false, reason: 'forbidden' };
    }

    deleteVolcSpeakerOwnership(state, normalizedSpeakerId);
    invalidateVolcSpeakerRemoteStatusCache();
    return { released: true, reason: 'released' };
  });
}

async function syncVolcSpeakerOwnershipForDevice({ ownerDeviceId, speakerIds = [] }) {
  return withVolcSpeakerOwnershipLock(async (state) => {
    const configuredSpeakerIdSet = new Set(getConfiguredVolcSpeakerIds());
    const desiredSpeakerIds = Array.from(new Set(
      (Array.isArray(speakerIds) ? speakerIds : [])
        .map((item) => readValue(item))
        .filter(Boolean)
    ));

    const claimed = [];
    const released = [];
    const conflicts = [];
    const ignored = [];

    for (const speakerId of desiredSpeakerIds) {
      if (!configuredSpeakerIdSet.has(speakerId)) {
        ignored.push(speakerId);
      }
    }

    const normalizedDesiredSpeakerIds = desiredSpeakerIds.filter((speakerId) => configuredSpeakerIdSet.has(speakerId));
    const desiredSpeakerIdSet = new Set(normalizedDesiredSpeakerIds);

    for (const ownedSpeakerId of listOwnedVolcSpeakerIds(state, ownerDeviceId)) {
      if (desiredSpeakerIdSet.has(ownedSpeakerId)) {
        continue;
      }

      if (deleteVolcSpeakerOwnership(state, ownedSpeakerId)) {
        released.push(ownedSpeakerId);
      }
    }

    for (const speakerId of normalizedDesiredSpeakerIds) {
      const existingOwner = normalizeDeviceId(state.slots[speakerId]?.ownerDeviceId);
      if (!existingOwner) {
        upsertVolcSpeakerOwnership(state, {
          speakerId,
          ownerDeviceId,
        });
        claimed.push(speakerId);
        continue;
      }

      if (existingOwner === ownerDeviceId) {
        upsertVolcSpeakerOwnership(state, {
          speakerId,
          ownerDeviceId,
        });
        continue;
      }

      conflicts.push({
        speakerId,
        ownerDeviceId: existingOwner
      });
    }

    return {
      ok: true,
      claimed,
      released,
      conflicts,
      ignored,
      ownedSpeakerIds: listOwnedVolcSpeakerIds(state, ownerDeviceId)
    };
  });
}

// ========== Voice Archive (shared across devices) ==========

function createEmptyVoiceArchive() {
  return { version: 1, records: [] };
}

function sanitizeVoiceArchive(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return createEmptyVoiceArchive();
  }
  const rawRecords = value.records;
  const records = [];
  if (Array.isArray(rawRecords)) {
    for (const item of rawRecords) {
      if (!item || typeof item !== 'object') continue;
      const provider = readValue(item.provider);
      const name = readValue(item.name);
      const remoteVoiceId = readValue(item.remoteVoiceId);
      if (!provider || !name || !remoteVoiceId) continue;
      records.push({
        id: readValue(item.id) || `${provider}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        name,
        provider,
        providerLabel: readValue(item.providerLabel) || provider,
        remoteVoiceId,
        engineModel: readValue(item.engineModel) || '',
        resourceId: item.resourceId === undefined ? undefined : readValue(item.resourceId),
        createdBy: readValue(item.createdBy) || '',
        createdAt: readValue(item.createdAt) || new Date().toISOString(),
      });
    }
  }
  return { version: 1, records };
}

async function loadVoiceArchive() {
  try {
    const raw = await readFile(VOICE_ARCHIVE_FILE, 'utf8');
    return sanitizeVoiceArchive(parseJsonString(raw, createEmptyVoiceArchive()));
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[voice archive] load_failed', { filePath: VOICE_ARCHIVE_FILE, message: error?.message || '' });
    }
    return createEmptyVoiceArchive();
  }
}

async function saveVoiceArchive(archive) {
  await ensureRuntimeStateDir();
  await writeFile(VOICE_ARCHIVE_FILE, JSON.stringify(archive, null, 2), 'utf8');
}

function buildVoiceArchiveKey(provider, remoteVoiceId) {
  return `${provider}::${remoteVoiceId}`;
}

async function addVoiceToArchive(voice) {
  return withVoiceArchiveLock(async () => {
    const archive = await loadVoiceArchive();
    const key = buildVoiceArchiveKey(voice.provider, voice.remoteVoiceId);
    const existingIndex = archive.records.findIndex(
      (r) => buildVoiceArchiveKey(r.provider, r.remoteVoiceId) === key
    );
    const record = {
      id: voice.id || `${voice.provider}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
      name: voice.name,
      provider: voice.provider,
      providerLabel: voice.providerLabel || voice.provider,
      remoteVoiceId: voice.remoteVoiceId,
      engineModel: voice.engineModel || '',
      resourceId: voice.resourceId,
      createdBy: voice.createdBy || '',
      createdAt: voice.createdAt || new Date().toISOString(),
    };
    if (existingIndex >= 0) {
      archive.records[existingIndex] = { ...archive.records[existingIndex], ...record };
    } else {
      archive.records.push(record);
    }
    await saveVoiceArchive(archive);
    return record;
  });
}

async function removeVoiceFromArchive(id) {
  return withVoiceArchiveLock(async () => {
    const archive = await loadVoiceArchive();
    const index = archive.records.findIndex((r) => r.id === id);
    if (index === -1) {
      return null;
    }
    const removed = archive.records[index];
    archive.records.splice(index, 1);
    await saveVoiceArchive(archive);
    return removed;
  });
}

function deduplicateVoiceArchiveNames(records) {
  const nameCounts = new Map();
  for (const record of records) {
    const base = record.name;
    const count = nameCounts.get(base) || 0;
    nameCounts.set(base, count + 1);
    if (count > 0) {
      const suffix = String.fromCharCode(65 + count - 1);
      record.name = `${base}-${suffix}`;
    }
  }
  return records;
}

async function handleSyncVoiceArchive(req, res) {
  try {
    const body = await readRequestBody(req);
    const incoming = Array.isArray(body?.voices) ? body.voices : [];
    const deviceId = normalizeDeviceId(body?.deviceId);

    const { added, skipped } = await withVoiceArchiveLock(async () => {
      const archive = await loadVoiceArchive();
      const existingKeys = new Set(
        archive.records.map((r) => buildVoiceArchiveKey(r.provider, r.remoteVoiceId))
      );
      const added = [];
      const skipped = [];

      for (const item of incoming) {
        if (!item || typeof item !== 'object') continue;
        const provider = readValue(item.provider);
        const remoteVoiceId = readValue(item.remoteVoiceId);
        if (!provider || !remoteVoiceId) continue;
        const key = buildVoiceArchiveKey(provider, remoteVoiceId);
        const existingIndex = archive.records.findIndex(
          (r) => buildVoiceArchiveKey(r.provider, r.remoteVoiceId) === key
        );
        const incomingName = readValue(item.name) || '未命名音色';
        if (existingIndex >= 0) {
          // Update name if changed
          if (archive.records[existingIndex].name !== incomingName) {
            archive.records[existingIndex].name = incomingName;
            added.push(archive.records[existingIndex]);
          } else {
            skipped.push(remoteVoiceId);
          }
          continue;
        }
        const record = {
          id: readValue(item.id) || `${provider}_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
          name: incomingName,
          provider,
          providerLabel: readValue(item.providerLabel) || provider,
          remoteVoiceId,
          engineModel: readValue(item.engineModel) || '',
          resourceId: item.resourceId === undefined ? undefined : readValue(item.resourceId),
          createdBy: deviceId || readValue(item.createdBy) || '',
          createdAt: readValue(item.createdAt) || new Date().toISOString(),
        };
        archive.records.push(record);
        added.push(record);
        existingKeys.add(key);
      }

      // Deduplicate names within each provider
      const recordsByProvider = new Map();
      for (const record of archive.records) {
        const list = recordsByProvider.get(record.provider) || [];
        list.push(record);
        recordsByProvider.set(record.provider, list);
      }
      for (const [, list] of recordsByProvider) {
        deduplicateVoiceArchiveNames(list);
      }

      await saveVoiceArchive(archive);
      return { added, skipped };
    });

    // Rebuild volcengine ownership for volcengine voices
    for (const record of added) {
      if (record.provider === 'volcengine' && record.createdBy && record.remoteVoiceId) {
        const group = getVolcEngineGroupForSpeakerId(record.remoteVoiceId);
        await withVolcSpeakerOwnershipLock(async (state) => {
          upsertVolcSpeakerOwnership(state, {
            speakerId: record.remoteVoiceId,
            ownerDeviceId: record.createdBy,
            preferredName: record.name,
            groupIndex: group?.index || 1,
          });
        });
      }
    }

    sendJson(res, 200, { ok: true, added: added.length, skipped: skipped.length });
  } catch (error) {
    console.error('[voice archive] sync_error', { message: error.message });
    sendJson(res, 500, { error: error.message || '同步音色档案失败' });
  }
}

async function handleGetVoiceArchive(req, res) {
  try {
    const archive = await withVoiceArchiveLock(() => loadVoiceArchive());
    sendJson(res, 200, { ok: true, records: archive.records });
  } catch (error) {
    console.error('[voice archive] get_error', { message: error.message });
    sendJson(res, 500, { error: error.message || '读取音色档案失败' });
  }
}

async function handleDeleteVoiceArchive(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/voice\/archive\//, ''));
    if (!id) {
      sendJson(res, 400, { error: '缺少音色档案 ID' });
      return;
    }
    const removed = await removeVoiceFromArchive(id);
    if (!removed) {
      sendJson(res, 404, { error: '未找到该音色档案' });
      return;
    }

    // Release volcengine speaker ownership when a volcengine voice is deleted
    if (removed.provider === 'volcengine' && removed.remoteVoiceId) {
      try {
        await withVolcSpeakerOwnershipLock(async (state) => {
          deleteVolcSpeakerOwnership(state, removed.remoteVoiceId);
        });
        invalidateVolcSpeakerRemoteStatusCache();
      } catch (ownershipError) {
        console.error('[voice archive] delete_ownership_release_failed', {
          speakerId: removed.remoteVoiceId,
          message: ownershipError.message,
        });
      }
    }

    sendJson(res, 200, { ok: true, removed: true });
  } catch (error) {
    console.error('[voice archive] delete_error', { message: error.message });
    sendJson(res, 500, { error: error.message || '删除音色档案失败' });
  }
}

async function handleUpdateVoiceArchiveName(req, res) {
  try {
    const url = new URL(req.url, `http://${req.headers.host}`);
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/voice\/archive\//, ''));
    if (!id) {
      sendJson(res, 400, { error: '缺少音色档案 ID' });
      return;
    }

    const body = await readRequestBody(req);
    const name = String(body?.name || '').trim();
    if (!name) {
      sendJson(res, 400, { error: '缺少音色名称' });
      return;
    }

    const updated = await withVoiceArchiveLock(async () => {
      const archive = await loadVoiceArchive();
      const record = archive.records.find((r) => r.id === id);
      if (!record) {
        return null;
      }
      record.name = name;
      await saveVoiceArchive(archive);
      return record;
    });

    if (!updated) {
      sendJson(res, 404, { error: '未找到该音色档案' });
      return;
    }

    sendJson(res, 200, { ok: true, record: updated });
  } catch (error) {
    console.error('[voice archive] update_name_error', { message: error.message });
    sendJson(res, 500, { error: error.message || '更新音色名称失败' });
  }
}

function normalizeDouyinInput(value) {
  return String(value || '')
    .replace(/\u00a0/g, ' ')
    .replace(/[“”]/g, '"')
    .replace(/[‘’]/g, "'")
    .trim();
}

function extractUrlsFromText(value) {
  const matches = normalizeDouyinInput(value).match(/https?:\/\/[^\s<>"'`，。；！!？?）)\]}]+/gi);
  return matches ? matches.map((item) => item.trim()) : [];
}

function getUrlScore(rawUrl) {
  let parsed;
  try {
    parsed = new URL(rawUrl);
  } catch {
    return -1;
  }

  const hostname = parsed.hostname.toLowerCase();
  const pathname = parsed.pathname.toLowerCase();
  let score = 0;

  if (hostname.includes('douyin.com')) score += 50;
  if (hostname === 'v.douyin.com') score += 80;
  if (pathname.includes('/video/')) score += 120;
  if (pathname.includes('/note/')) score += 40;
  if (/[?&](aweme_id|modal_id|item_id|group_id)=/.test(parsed.search)) score += 90;

  return score;
}

function pickPreferredDouyinUrl(input) {
  const urls = extractUrlsFromText(input);
  if (!urls.length) {
    return { url: '', sourceType: 'short_share_text' };
  }

  const sorted = urls
    .map((url) => ({ url, score: getUrlScore(url) }))
    .sort((left, right) => right.score - left.score);

  if ((sorted[0]?.score ?? -1) <= 0) {
    return { url: '', sourceType: 'short_share_text' };
  }

  const candidate = sorted[0]?.url || urls[0];
  const trimmed = normalizeDouyinInput(input);

  return {
    url: candidate,
    sourceType: trimmed === candidate && /douyin\.com\/video\//i.test(candidate) ? 'web_url' : 'short_share_text'
  };
}

function extractDouyinAwemeId(rawUrl) {
  try {
    const parsed = new URL(rawUrl);
    const pathname = parsed.pathname;
    const pathMatch = pathname.match(/\/(?:video|note|share\/video)\/(\d+)/i);
    if (pathMatch?.[1]) return pathMatch[1];

    for (const key of ['aweme_id', 'modal_id', 'item_id', 'group_id', 'itemId']) {
      const value = parsed.searchParams.get(key);
      if (value && /^\d+$/.test(value)) {
        return value;
      }
    }
  } catch {}

  return '';
}

function extractDouyinUrlFromHtml(html, baseUrl = '') {
  const raw = String(html || '');
  if (!raw) return '';

  const patterns = [
    /<link[^>]+rel=["']canonical["'][^>]+href=["']([^"']+)["']/i,
    /<meta[^>]+property=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    /<meta[^>]+name=["']og:url["'][^>]+content=["']([^"']+)["']/i,
    /(?:window\.)?location(?:\.href|\.replace)?\s*(?:=|\()\s*["']([^"']+)["']/i,
    /https?:\/\/www\.douyin\.com\/(?:video|note)\/\d+[^\s"'<>]*/i,
    /https?:\/\/(?:www\.)?iesdouyin\.com\/share\/video\/\d+[^\s"'<>]*/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    const value = match?.[1] || match?.[0] || '';
    if (!value) continue;

    try {
      return new URL(value, baseUrl || undefined).toString();
    } catch {
      continue;
    }
  }

  return '';
}

function extractDouyinAwemeIdFromHtml(html) {
  const raw = String(html || '');
  if (!raw) return '';

  const patterns = [
    /"aweme_id"\s*:\s*"(\d+)"/i,
    /"awemeId"\s*:\s*"(\d+)"/i,
    /"itemId"\s*:\s*"(\d+)"/i,
    /"item_id"\s*:\s*"(\d+)"/i,
    /"group_id"\s*:\s*"(\d+)"/i,
    /"modal_id"\s*:\s*"(\d+)"/i,
    /(?:itemId|group_id|modal_id|aweme_id|awemeId)\s*[:=]\s*["']?(\d+)/i,
    /\/(?:video|note)\/(\d+)/i,
    /\/share\/video\/(\d+)/i
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) return match[1];
  }

  return '';
}

async function resolveRedirectedUrl(rawUrl, deadlineAt = 0) {
  const targetHost = getHostnameFromUrl(rawUrl);
  const timeoutMs = deadlineAt > 0 ? getStageTimeoutContext({
    parentDeadlineAt: deadlineAt,
    stageStartedAt: Date.now(),
    stageTimeoutMs: Math.max(1, getRemainingTimeoutMs(deadlineAt)),
    timeoutStage: 'douyin_video_resolve_timeout',
    failedStage: 'video_resolved',
    timeoutMessage: '文案提取失败',
    timeoutDetail: '抖音短链接展开超时。请稍后重试。',
    targetPath: rawUrl,
    host: targetHost
  }).timeoutMs : 0;

  let response;
  try {
    response = await fetch(rawUrl, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': DOUYIN_USER_AGENT,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
      },
      signal: timeoutMs > 0 ? AbortSignal.timeout(timeoutMs) : undefined
    });
  } catch (error) {
    throw createDouyinResolveError({
      stage: error?.name === 'TimeoutError' || /aborted|timeout/i.test(String(error?.message || ''))
        ? 'douyin_video_resolve_timeout'
        : 'short_link_expand_failed',
      statusCode: error?.name === 'TimeoutError' || /aborted|timeout/i.test(String(error?.message || '')) ? 504 : 502,
      message: '抖音视频解析失败',
      detail: error?.name === 'TimeoutError' || /aborted|timeout/i.test(String(error?.message || ''))
        ? '短链接展开超时，请稍后重试。'
        : `短链接展开失败：${error?.message || 'fetch failed'}`
    });
  }

  const finalUrl = response.url || rawUrl;
  const contentType = String(response.headers.get('content-type') || '').toLowerCase();
  const html = contentType.includes('text/html') ? await response.text() : '';
  const htmlUrl = extractDouyinUrlFromHtml(html, finalUrl);
  const normalizedUrl = htmlUrl || finalUrl;
  const awemeId =
    extractDouyinAwemeId(normalizedUrl) ||
    extractDouyinAwemeId(finalUrl) ||
    extractDouyinAwemeIdFromHtml(html) ||
    extractDouyinAwemeId(htmlUrl);

  return {
    normalizedUrl,
    finalUrl,
    awemeId,
    contentType
  };
}

function summarizeUpstreamBody(value) {
  if (!value) return '';
  const raw = typeof value === 'string' ? value : JSON.stringify(value);
  return raw.replace(/\s+/g, ' ').trim().slice(0, 400);
}

function logSiliconFlowVoiceEvent({
  level = 'info',
  event,
  requestId = '',
  model = '',
  fileName = '',
  fileSize = 0,
  status = '',
  elapsedMs = 0,
  upstreamStatus = 0,
  ...extra
}) {
  const payload = {
    event,
    requestId,
    model,
    fileName,
    fileSize,
    status,
    elapsedMs,
    upstreamStatus,
    ...extra
  };
  const logger = level === 'error' ? console.error : console.log;
  logger('[siliconflow voice]', payload);
}

function normalizeSiliconFlowResponseFormat(value) {
  const normalized = String(value || '').trim().toLowerCase();
  if (normalized === 'mp3' || normalized === 'wav' || normalized === 'pcm') {
    return normalized;
  }
  return DEFAULT_SILICONFLOW_RESPONSE_FORMAT;
}

function createStageDeadlineAt({ stageStartedAt = Date.now(), stageTimeoutMs, parentDeadlineAt = 0 }) {
  const stageDeadlineAt = stageStartedAt + Math.max(1, Number(stageTimeoutMs) || 1);
  if (!Number.isFinite(parentDeadlineAt) || parentDeadlineAt <= 0) {
    return stageDeadlineAt;
  }
  return Math.min(stageDeadlineAt, parentDeadlineAt);
}

function getRemainingTimeoutMs(deadlineAt) {
  if (!Number.isFinite(deadlineAt) || deadlineAt <= 0) {
    return 0;
  }
  return Math.max(0, deadlineAt - Date.now());
}

function annotateDouyinError(error, details = {}) {
  if (error && typeof error === 'object') {
    Object.assign(error, details);
  }
  return error;
}

function createDouyinStageTimeoutError({
  stage,
  failedStage = stage,
  timeoutMs,
  targetPath = '',
  host = '',
  message = '文案提取失败',
  detail = ''
}) {
  return annotateDouyinError(createDouyinResolveError({
    stage,
    statusCode: 504,
    message,
    detail
  }), {
    failedStage,
    timeoutMs,
    targetPath,
    host
  });
}

function getStageTimeoutContext({
  parentDeadlineAt,
  stageStartedAt,
  stageTimeoutMs,
  timeoutStage,
  failedStage,
  timeoutMessage,
  timeoutDetail,
  targetPath = '',
  host = ''
}) {
  const deadlineAt = createStageDeadlineAt({
    stageStartedAt,
    stageTimeoutMs,
    parentDeadlineAt
  });
  const timeoutMs = getRemainingTimeoutMs(deadlineAt);

  if (timeoutMs > 0) {
    return { deadlineAt, timeoutMs };
  }

  throw createDouyinStageTimeoutError({
    stage: timeoutStage,
    failedStage,
    timeoutMs: 0,
    targetPath,
    host,
    message: timeoutMessage,
    detail: timeoutDetail
  });
}

function getLogElapsedMs(startedAt) {
  if (!Number.isFinite(startedAt) || startedAt <= 0) {
    return 0;
  }
  return Math.max(0, Date.now() - startedAt);
}

function logDouyinTranscriptEvent({
  level = 'log',
  event,
  requestId,
  startedAt,
  timeoutMs = 0,
  targetPath = '',
  finalFileSize = 0,
  host = '',
  upstreamStatus = 0,
  ...rest
}) {
  const logger = level === 'error'
    ? console.error
    : level === 'warn'
      ? console.warn
      : console.log;

  logger(`[douyin transcript] ${event}`, {
    requestId,
    elapsedMs: getLogElapsedMs(startedAt),
    timeoutMs,
    targetPath,
    finalFileSize,
    host,
    upstreamStatus,
    ...rest
  });
}

async function getFileSizeIfExists(filePath) {
  if (!filePath) return 0;
  try {
    return (await stat(filePath)).size;
  } catch {
    return 0;
  }
}

function extractFirstUrl(value) {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (/^https?:\/\//i.test(trimmed)) {
      return trimmed;
    }
    return '';
  }

  if (Array.isArray(value)) {
    for (const item of value) {
      const nested = extractFirstUrl(item);
      if (nested) return nested;
    }
  }

  if (value && typeof value === 'object') {
    const record = value;
    for (const key of ['url', 'src', 'play_url', 'download_url', 'uri']) {
      const nested = extractFirstUrl(record[key]);
      if (nested) return nested;
    }
  }

  return '';
}

function pickNestedValue(root, path) {
  let current = root;

  for (const segment of path) {
    if (current == null) return undefined;

    if (segment === '*') {
      if (!Array.isArray(current)) return undefined;
      for (const item of current) {
        if (item != null) return item;
      }
      return undefined;
    }

    current = current?.[segment];
  }

  return current;
}

function normalizeBooleanLike(value) {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalized = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'y'].includes(normalized)) return true;
    if (['false', '0', 'no', 'n'].includes(normalized)) return false;
  }
  return null;
}

function readCandidateHasAudio(record) {
  if (!record || typeof record !== 'object') return null;
  for (const key of ['hasAudio', 'has_audio', 'hasAudioTrack', 'has_audio_track', 'withAudio', 'with_audio']) {
    const parsed = normalizeBooleanLike(record[key]);
    if (parsed !== null) return parsed;
  }
  if (record.audio && typeof record.audio === 'object') return true;
  if (record.audio_url || record.audioUrl || record.audio_track || record.audioTrack) return true;
  return null;
}

function addDownloadUrlCandidate(candidates, seen, rawUrl, source, meta = {}) {
  const url = stripDouyinWatermark(rawUrl);
  if (!url) return;
  const existing = seen.get(url);
  if (existing) {
    if (existing.hasAudio === undefined && typeof meta.hasAudio === 'boolean') {
      existing.hasAudio = meta.hasAudio;
    }
    return;
  }

  const candidate = {
    url,
    source,
    host: getHostnameFromUrl(url)
  };
  if (typeof meta.hasAudio === 'boolean') candidate.hasAudio = meta.hasAudio;
  seen.set(url, candidate);
  candidates.push(candidate);
}

function collectDownloadUrlCandidates(payload) {
  const paths = [
    { path: ['video_data', 'video', 'play_addr_h264', 'url_list'], source: 'video_data.video.play_addr_h264' },
    { path: ['video_data', 'video', 'play_addr', 'url_list'], source: 'video_data.video.play_addr' },
    { path: ['video_data', 'video', 'play_api', 'url_list'], source: 'video_data.video.play_api' },
    { path: ['video_data', 'video', 'download_addr', 'url_list'], source: 'video_data.video.download_addr' },
    { path: ['video', 'play_addr_h264', 'url_list'], source: 'video.play_addr_h264' },
    { path: ['video', 'play_addr', 'url_list'], source: 'video.play_addr' },
    { path: ['video', 'play_api', 'url_list'], source: 'video.play_api' },
    { path: ['video', 'download_addr', 'url_list'], source: 'video.download_addr' },
    { path: ['aweme_detail', 'video', 'play_addr_h264', 'url_list'], source: 'aweme_detail.video.play_addr_h264' },
    { path: ['aweme_detail', 'video', 'play_addr', 'url_list'], source: 'aweme_detail.video.play_addr' },
    { path: ['aweme_detail', 'video', 'play_api', 'url_list'], source: 'aweme_detail.video.play_api' },
    { path: ['aweme_detail', 'video', 'download_addr', 'url_list'], source: 'aweme_detail.video.download_addr' },
    { path: ['item_info', 'item_struct', 'video', 'play_addr_h264', 'url_list'], source: 'item_info.item_struct.video.play_addr_h264' },
    { path: ['item_info', 'item_struct', 'video', 'play_addr', 'url_list'], source: 'item_info.item_struct.video.play_addr' }
  ];

  const candidates = [];
  const seen = new Map();

  for (const entry of paths) {
    const value = pickNestedValue(payload, entry.path);
    const urls = Array.isArray(value)
      ? value.flatMap((item) => {
          const url = extractFirstUrl(item);
          return url ? [url] : [];
        })
      : [extractFirstUrl(value)].filter(Boolean);

    for (const rawUrl of urls) {
      addDownloadUrlCandidate(candidates, seen, rawUrl, entry.source, { hasAudio: true });
    }
  }

  const videoRoots = [
    { value: payload?.video_data?.video, source: 'video_data.video.bit_rate.play_addr' },
    { value: payload?.video, source: 'video.bit_rate.play_addr' },
    { value: payload?.aweme_detail?.video, source: 'aweme_detail.video.bit_rate.play_addr' },
    { value: payload?.item_info?.item_struct?.video, source: 'item_info.item_struct.video.bit_rate.play_addr' },
  ];

  for (const root of videoRoots) {
    const bitRates = Array.isArray(root.value?.bit_rate) ? root.value.bit_rate : [];
    for (const bitRate of bitRates) {
      const hasAudio = readCandidateHasAudio(bitRate);
      const urls = normalizeUniversalUrlList(bitRate?.play_addr?.url_list || bitRate?.play_addr || bitRate?.url_list || bitRate?.url);
      for (const rawUrl of urls) {
        addDownloadUrlCandidate(candidates, seen, rawUrl, root.source, {
          hasAudio: typeof hasAudio === 'boolean' ? hasAudio : undefined
        });
      }
    }
  }

  return candidates;
}

function scoreDouyinDownloadCandidate(candidate) {
  const url = String(candidate?.url || '');
  const source = String(candidate?.source || '');
  const host = String(candidate?.host || '');
  const hostStats = getDouyinDownloadHostStatsSnapshot(host);
  let score = getDouyinDownloadHostBaseScore(host);

  if (/play_addr_h264/i.test(source)) score += 60;
  if (/bit_rate/i.test(source)) score += 15;
  if (/play_addr/i.test(source)) score += 45;
  if (/play_api/i.test(source)) score += 25;
  if (/download_addr/i.test(source)) score += 25;

  if (candidate?.hasAudio === true) score += 160;
  if (candidate?.hasAudio === false) score -= 420;

  if (/playwm/i.test(url)) score -= 80;
  if (/watermark=1|[?&]wm=1/i.test(url)) score -= 40;
  if (/byte|douyinvod|toutiao|iesdouyin|cdn/i.test(host)) score += 20;
  if (/tikhub/i.test(host)) score -= 30;

  score += hostStats.success * 18;
  score -= hostStats.timeout * 40;
  score -= hostStats.failure * 8;
  score -= hostStats.http5xx * 14;
  score -= hostStats.http4xx * 20;
  score -= hostStats.empty * 30;
  score -= hostStats.invalid * 30;
  score -= hostStats.noAudio * 35;
  score -= hostStats.network * 12;

  const observedAttempts = Math.max(1, hostStats.attempts);
  const successRate = hostStats.success / observedAttempts;
  const timeoutRate = hostStats.timeout / observedAttempts;
  score += Math.round(successRate * 60);
  score -= Math.round(timeoutRate * 80);

  // Real-world timing-based scoring
  const ttfbTiming = getDouyinDownloadHostRollingAverage(host, 'ttfb');
  const durationTiming = getDouyinDownloadHostRollingAverage(host, 'totalDuration');

  if (ttfbTiming.isReliable) {
    const ttfbAvg = ttfbTiming.avgMs;
    if (ttfbAvg < 500) score += 25;
    else if (ttfbAvg < 1500) score += 12;
    else if (ttfbAvg < 3000) score += 0;
    else if (ttfbAvg < 6000) score -= 20;
    else score -= 45;
  }

  if (durationTiming.isReliable) {
    const durationAvg = durationTiming.avgMs;
    if (durationAvg > 30000) score -= 30;
    else if (durationAvg > 15000) score -= 15;
  }

  // Cooldown penalty - extremely strong
  if (isDouyinDownloadHostInCooldown(host).inCooldown) {
    score -= 500;
  }

  // Consecutive failure penalty
  if (hostStats.consecutiveFailures > 0) {
    score -= hostStats.consecutiveFailures * 15;
  }

  return score;
}

function rankDouyinDownloadCandidates(candidates, options = {}) {
  const {
    attemptedHosts = new Set(),
    avoidHosts = new Set(),
    respectCooldown = true
  } = options;

  const scored = [...candidates]
    .filter((candidate) => candidate?.url)
    .map((candidate) => {
      const host = String(candidate?.host || '');
      let score = scoreDouyinDownloadCandidate(candidate);

      if (avoidHosts.has(host)) score -= 220;
      if (attemptedHosts.has(host)) score -= 160;

      return {
        ...candidate,
        score,
        hostStats: getDouyinDownloadHostStatsSnapshot(host)
      };
    })
    .sort((left, right) => {
      if (right.score !== left.score) return right.score - left.score;
      const leftTtfb = getDouyinDownloadHostRollingAverage(left.host, 'ttfb').avgMs || Infinity;
      const rightTtfb = getDouyinDownloadHostRollingAverage(right.host, 'ttfb').avgMs || Infinity;
      if (leftTtfb !== rightTtfb) return leftTtfb - rightTtfb;
      return String(left.host || '').localeCompare(String(right.host || ''));
    });

  if (!respectCooldown) return scored;

  const active = scored.filter((c) => !isDouyinDownloadHostInCooldown(c.host).inCooldown);
  return active.length > 0 ? active : scored;
}

function pickBestDouyinDownloadCandidate(candidates, options = {}) {
  return rankDouyinDownloadCandidates(candidates, options)[0] || null;
}

function normalizeDouyinDownloadCandidates(downloadUrlCandidates = [], fallbackUrl = '') {
  const merged = [];
  const seen = new Set();

  const addCandidate = (candidate, fallbackSource = 'resolved.downloadUrl') => {
    const url = stripDouyinWatermark(String(candidate?.url || candidate || ''));
    if (!url || seen.has(url)) return;
    seen.add(url);
    const normalized = {
      url,
      source: String(candidate?.source || fallbackSource),
      host: getHostnameFromUrl(url)
    };
    if (typeof candidate?.hasAudio === 'boolean') normalized.hasAudio = candidate.hasAudio;
    merged.push(normalized);
  };

  for (const candidate of downloadUrlCandidates) {
    addCandidate(candidate, 'resolved.downloadUrlCandidate');
  }

  if (fallbackUrl) {
    addCandidate({ url: fallbackUrl, source: 'resolved.downloadUrl' });
  }

  return merged;
}

function serializeDouyinDownloadCandidates(downloadUrlCandidates = [], fallbackUrl = '') {
  return normalizeDouyinDownloadCandidates(downloadUrlCandidates, fallbackUrl)
    .slice(0, 12)
    .map((candidate) => ({
      url: candidate.url,
      source: candidate.source,
      host: candidate.host,
      ...(typeof candidate.hasAudio === 'boolean' ? { hasAudio: candidate.hasAudio } : {})
    }));
}

function extractStableDownloadUrl(payload) {
  return pickBestDouyinDownloadCandidate(collectDownloadUrlCandidates(payload))?.url || '';
}

function extractDouyinVideoIdFromPayload(payload, fallbackAwemeId = '') {
  return readValue(
    payload?.video_id,
    payload?.aweme_id,
    payload?.awemeId,
    payload?.aweme_detail?.aweme_id,
    payload?.aweme_detail?.awemeId,
    payload?.video_data?.aweme_id,
    payload?.video_data?.awemeId,
    payload?.item_info?.item_struct?.aweme_id,
    payload?.item_info?.item_struct?.awemeId,
    fallbackAwemeId
  );
}

function extractDouyinCaptionFromPayload(payload) {
  return readValue(
    payload?.desc,
    payload?.title,
    payload?.aweme_detail?.desc,
    payload?.aweme_detail?.title,
    payload?.video_data?.desc,
    payload?.video_data?.title,
    payload?.item_info?.item_basic?.title,
    payload?.item_info?.item_struct?.desc,
    payload?.item_info?.item_struct?.title,
    payload?.share_info?.share_desc,
    payload?.share_info?.share_title,
    payload?.seo_info?.seo_title
  );
}

function extractDouyinAuthorNameFromPayload(payload) {
  return readValue(
    payload?.author?.nickname,
    payload?.author?.unique_id,
    payload?.aweme_detail?.author?.nickname,
    payload?.aweme_detail?.author?.unique_id,
    payload?.video_data?.author?.nickname,
    payload?.video_data?.author?.unique_id,
    payload?.item_info?.author?.nickname,
    payload?.item_info?.author?.unique_id,
    payload?.item_info?.item_basic?.author_name
  );
}

function findAllDurationValues(obj, path = '', results = []) {
  if (!obj || typeof obj !== 'object') return results;
  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    if (key === 'duration' && (typeof value === 'number' || typeof value === 'string')) {
      const num = Number.parseInt(String(value), 10);
      if (Number.isFinite(num) && num > 0) {
        results.push({ path: currentPath, value: num });
      }
    }
    if (typeof value === 'object' && value !== null) {
      findAllDurationValues(value, currentPath, results);
    }
  }
  return results;
}

function extractDouyinDurationFromPayload(payload) {
  const all = findAllDurationValues(payload);
  if (all.length > 0) {
    console.log('[douyin duration] found duration candidates:', all.slice(0, 5));
  }
  const raw =
    payload?.video?.duration ??
    payload?.aweme_detail?.video?.duration ??
    payload?.video_data?.video?.duration ??
    payload?.item_info?.item_struct?.video?.duration ??
    payload?.aweme_detail?.duration ??
    payload?.video_info?.duration ??
    payload?.duration ??
    0;
  if (!raw) return 0;
  const ms = Number.parseInt(String(raw), 10);
  if (!Number.isFinite(ms) || ms <= 0) return 0;
  // 抖音 duration 通常是毫秒；大于 300 的按毫秒处理，否则视为秒
  return ms > 300 ? Math.round(ms / 1000) : ms;
}

function decodeEscapedDouyinText(value) {
  return String(value || '')
    .replace(/\\u002F/gi, '/')
    .replace(/\\u0026/gi, '&')
    .replace(/\\u003D/gi, '=')
    .replace(/\\u0025/gi, '%')
    .replace(/\\\//g, '/')
    .replace(/&amp;/gi, '&')
    .replace(/&#x27;/gi, "'")
    .replace(/&quot;/gi, '"')
    .replace(/&lt;/gi, '<')
    .replace(/&gt;/gi, '>')
    .trim();
}

function stripDouyinWatermark(url) {
  const decoded = decodeEscapedDouyinText(url);
  if (!decoded) return '';
  return decoded
    .replace(/playwm/gi, 'play')
    .replace(/watermark=1/gi, 'watermark=0')
    .replace(/&wm=1/gi, '&wm=0');
}

function extractHtmlMetaContent(html, selectorName, selectorValue) {
  const raw = String(html || '');
  if (!raw) return '';

  const patterns = [
    new RegExp(`<meta[^>]+${selectorName}=["']${selectorValue}["'][^>]+content=["']([^"']+)["']`, 'i'),
    new RegExp(`<meta[^>]+content=["']([^"']+)["'][^>]+${selectorName}=["']${selectorValue}["']`, 'i')
  ];

  for (const pattern of patterns) {
    const match = raw.match(pattern);
    if (match?.[1]) {
      return decodeEscapedDouyinText(match[1]);
    }
  }

  return '';
}

function extractBalancedJsonBlock(raw, marker) {
  const source = String(raw || '');
  const markerIndex = source.indexOf(marker);
  if (markerIndex < 0) return '';

  const startIndex = source.indexOf('{', markerIndex + marker.length) >= 0
    ? source.indexOf('{', markerIndex + marker.length)
    : source.indexOf('[', markerIndex + marker.length);

  if (startIndex < 0) return '';

  const openChar = source[startIndex];
  const closeChar = openChar === '{' ? '}' : ']';
  let depth = 0;
  let inString = false;
  let stringQuote = '';
  let escaped = false;

  for (let index = startIndex; index < source.length; index += 1) {
    const char = source[index];

    if (escaped) {
      escaped = false;
      continue;
    }

    if (char === '\\') {
      escaped = true;
      continue;
    }

    if (inString) {
      if (char === stringQuote) {
        inString = false;
        stringQuote = '';
      }
      continue;
    }

    if (char === '"' || char === "'") {
      inString = true;
      stringQuote = char;
      continue;
    }

    if (char === openChar) {
      depth += 1;
      continue;
    }

    if (char === closeChar) {
      depth -= 1;
      if (depth === 0) {
        return source.slice(startIndex, index + 1);
      }
    }
  }

  return '';
}

function parseDouyinEmbeddedJson(raw) {
  const source = String(raw || '');
  if (!source) return null;

  const markers = [
    'window._ROUTER_DATA =',
    'window.__INIT_PROPS__ =',
    'window.__PRELOADED_STATE__ =',
    'window.SSR_RENDER_DATA =',
    'window.__INITIAL_STATE__ =',
    '__NEXT_DATA__'
  ];

  for (const marker of markers) {
    const block = extractBalancedJsonBlock(source, marker);
    if (!block) continue;

    try {
      return JSON.parse(block);
    } catch {}
  }

  return null;
}

function collectDouyinMetadataCandidates(root) {
  const candidates = [];
  const visited = new Set();

  function walk(node) {
    if (!node || typeof node !== 'object') return;
    if (visited.has(node)) return;
    visited.add(node);

    const hasVideoShape =
      !!extractStableDownloadUrl(node) ||
      !!readValue(
        node?.aweme_id,
        node?.awemeId,
        node?.desc,
        node?.title,
        node?.author?.nickname,
        node?.video?.play_addr?.uri,
        node?.video?.download_addr?.uri
      );

    if (hasVideoShape) {
      candidates.push(node);
    }

    if (Array.isArray(node)) {
      for (const item of node) walk(item);
      return;
    }

    for (const value of Object.values(node)) {
      walk(value);
    }
  }

  walk(root);
  return candidates;
}

function extractDouyinDirectMetadataFromHtml(html, fallbackUrl = '') {
  const raw = String(html || '');
  const embedded = parseDouyinEmbeddedJson(raw);
  const candidates = embedded ? collectDouyinMetadataCandidates(embedded) : [];

  for (const candidate of candidates) {
    const downloadUrlCandidates = collectDownloadUrlCandidates(candidate);
    const downloadUrl = pickBestDouyinDownloadCandidate(downloadUrlCandidates)?.url || '';
    if (!downloadUrl) continue;

    return {
      resolveStrategy: 'direct_html',
      videoId: extractDouyinVideoIdFromPayload(candidate, extractDouyinAwemeId(fallbackUrl)),
      downloadUrl,
      downloadUrlCandidates,
      title: readValue(
        candidate?.share_info?.share_title,
        candidate?.seo_info?.seo_title,
        candidate?.title,
        candidate?.desc,
        extractHtmlMetaContent(raw, 'property', 'og:title'),
        extractHtmlMetaContent(raw, 'name', 'description')
      ),
      caption: extractDouyinCaptionFromPayload(candidate),
      authorName: extractDouyinAuthorNameFromPayload(candidate),
      duration: extractDouyinDurationFromPayload(candidate),
      videoData: candidate
    };
  }

  const directUrlMatches = [...raw.matchAll(/https?:\\\/\\\/[^"'<>\\]+(?:playwm|play|download)[^"'<>\\]*/gi)];
  for (const match of directUrlMatches) {
    const downloadUrl = stripDouyinWatermark(match[0]);
    if (!downloadUrl) continue;

    return {
      resolveStrategy: 'direct_html_regex',
      videoId: extractDouyinAwemeId(fallbackUrl),
      downloadUrl,
      downloadUrlCandidates: [{
        url: downloadUrl,
        source: 'direct_html_regex',
        host: getHostnameFromUrl(downloadUrl)
      }],
      title: readValue(
        extractHtmlMetaContent(raw, 'property', 'og:title'),
        extractHtmlMetaContent(raw, 'name', 'description')
      ),
      caption: '',
      authorName: '',
      videoData: null
    };
  }

  return null;
}

async function fetchDouyinHtmlPage(url, deadlineAt = 0) {
  const targetHost = getHostnameFromUrl(url);
  const timeoutMs = deadlineAt > 0 ? getStageTimeoutContext({
    parentDeadlineAt: deadlineAt,
    stageStartedAt: Date.now(),
    stageTimeoutMs: Math.max(1, getRemainingTimeoutMs(deadlineAt)),
    timeoutStage: 'douyin_video_resolve_timeout',
    failedStage: 'video_resolved',
    timeoutMessage: '抖音视频解析失败',
    timeoutDetail: '页面抓取超时，请稍后重试。',
    targetPath: url,
    host: targetHost
  }).timeoutMs : DOUYIN_VIDEO_RESOLVE_TIMEOUT_MS;
  let response;
  try {
    response = await fetch(url, {
      method: 'GET',
      redirect: 'follow',
      headers: {
        'user-agent': DOUYIN_USER_AGENT,
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8',
        accept: 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8'
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw createDouyinResolveError({
      stage: error?.name === 'TimeoutError' || /aborted|timeout/i.test(String(error?.message || ''))
        ? 'douyin_video_resolve_timeout'
        : 'douyin_video_parse_failed',
      statusCode: error?.name === 'TimeoutError' || /aborted|timeout/i.test(String(error?.message || '')) ? 504 : 502,
      message: '抖音视频解析失败',
      detail: error?.name === 'TimeoutError' || /aborted|timeout/i.test(String(error?.message || ''))
        ? '页面抓取超时，请稍后重试。'
        : `页面抓取网络异常：${error?.message || 'fetch failed'}`
    });
  }

  if (!response.ok) {
    throw createDouyinResolveError({
      stage: 'douyin_video_parse_failed',
      statusCode: response.status >= 400 && response.status < 500 ? 400 : 502,
      upstreamStatus: response.status,
      message: '抖音视频解析失败',
      detail: `页面抓取失败，状态码 ${response.status}`
    });
  }

  return {
    finalUrl: response.url || url,
    html: await response.text()
  };
}

async function resolveDouyinVideoByHtml({ rawUrl, normalizedUrl, awemeId, requestId, deadlineAt = 0 }) {
  const candidates = [...new Set([normalizedUrl, rawUrl].filter(Boolean))];

  if (awemeId) {
    candidates.unshift(`https://www.douyin.com/video/${awemeId}`);
  }

  if (candidates.length === 0) {
    throw createDouyinResolveError({
      stage: 'douyin_video_parse_failed',
      statusCode: 502,
      message: '抖音视频解析失败',
      detail: '没有可用的候选 URL'
    });
  }

  // Parallel fetch all candidates — return the first successful one
  try {
    const { page, parsed, candidateUrl } = await Promise.any(
      candidates.map(async (candidateUrl) => {
        const page = await fetchDouyinHtmlPage(candidateUrl, deadlineAt);
        const parsed = extractDouyinDirectMetadataFromHtml(page.html, page.finalUrl);

        if (!parsed?.downloadUrl) {
          throw createDouyinResolveError({
            stage: 'douyin_download_link_missing',
            statusCode: 502,
            message: '下载链接获取失败',
            detail: '页面解析成功，但未提取到无水印视频链接。'
          });
        }

        return { page, parsed, candidateUrl };
      })
    );

    console.log('[douyin resolve] direct html strategy succeeded', {
      requestId,
      candidateUrl,
      finalUrl: page.finalUrl,
      videoId: parsed.videoId || awemeId || '',
      resolveStrategy: parsed.resolveStrategy
    });

    return {
      videoId: parsed.videoId || awemeId || extractDouyinAwemeId(page.finalUrl),
      downloadUrl: parsed.downloadUrl,
      downloadUrlCandidates: parsed.downloadUrlCandidates || [],
      title: parsed.title,
      caption: parsed.caption,
      authorName: parsed.authorName,
      duration: parsed.duration || 0,
      videoData: parsed.videoData,
      normalizedUrl: page.finalUrl,
      resolveStrategy: parsed.resolveStrategy,
      fallbackCaption: '',
      fallbackCaptionSource: 'none'
    };
  } catch (aggregateError) {
    const errors = aggregateError?.errors || [];
    for (const error of errors) {
      console.warn('[douyin resolve] direct html strategy failed', {
        requestId,
        stage: error?.stage || '',
        message: error?.message || ''
      });
    }

    const lastError = errors[errors.length - 1];
    throw lastError || createDouyinResolveError({
      stage: 'douyin_video_parse_failed',
      statusCode: 502,
      message: '抖音视频解析失败'
    });
  }
}

function getFallbackExtensionFromUrl(rawUrl, fallback = '.mp4') {
  try {
    const parsed = new URL(rawUrl);
    const ext = path.extname(parsed.pathname || '');
    return ext && ext.length <= 8 ? ext : fallback;
  } catch {
    return fallback;
  }
}

function getHostnameFromUrl(rawUrl) {
  try {
    return new URL(rawUrl).hostname || '';
  } catch {
    return '';
  }
}

function getDouyinDownloadHostStatsWithTiming(host) {
  const normalizedHost = String(host || 'unknown').trim() || 'unknown';
  return douyinDownloadHostStats.get(normalizedHost) || {
    selected: 0,
    attempts: 0,
    success: 0,
    failure: 0,
    timeout: 0,
    http4xx: 0,
    http5xx: 0,
    empty: 0,
    invalid: 0,
    network: 0,
    ttfbSamples: [],
    totalDurationSamples: [],
    consecutiveFailures: 0,
    cooldownUntil: 0,
    lastOutcome: '',
    lastAttemptAt: 0
  };
}

function recordDouyinDownloadHostTtfb(host, ttfbMs) {
  const stats = getDouyinDownloadHostStatsWithTiming(host);
  stats.ttfbSamples.push({ ttfbMs, timestamp: Date.now() });
  if (stats.ttfbSamples.length > DOUYIN_HOST_STATS_MAX_SAMPLES) {
    stats.ttfbSamples.shift();
  }
  douyinDownloadHostStats.set(stats.host || host, stats);
}

function recordDouyinDownloadHostTotalDuration(host, durationMs) {
  const stats = getDouyinDownloadHostStatsWithTiming(host);
  stats.totalDurationSamples.push({ durationMs, timestamp: Date.now() });
  if (stats.totalDurationSamples.length > DOUYIN_HOST_STATS_MAX_SAMPLES) {
    stats.totalDurationSamples.shift();
  }
  douyinDownloadHostStats.set(stats.host || host, stats);
}

function getDouyinDownloadHostRollingAverage(host, field) {
  const stats = getDouyinDownloadHostStatsWithTiming(host);
  const samples = field === 'ttfb' ? stats.ttfbSamples : stats.totalDurationSamples;
  if (!samples || samples.length === 0) {
    return { avgMs: 0, sampleCount: 0, isReliable: false };
  }
  const sum = samples.reduce((acc, s) => acc + (s.ttfbMs || s.durationMs || 0), 0);
  const avgMs = Math.round(sum / samples.length);
  return { avgMs, sampleCount: samples.length, isReliable: samples.length >= 3 };
}

function isDouyinDownloadHostInCooldown(host) {
  const stats = getDouyinDownloadHostStatsWithTiming(host);
  const remainingMs = Math.max(0, (stats.cooldownUntil || 0) - Date.now());
  return { inCooldown: remainingMs > 0, remainingMs };
}

function incrementDouyinDownloadHostConsecutiveFailures(host) {
  const stats = getDouyinDownloadHostStatsWithTiming(host);
  stats.consecutiveFailures += 1;
  stats.lastOutcome = 'failure';
  stats.lastAttemptAt = Date.now();

  if (stats.consecutiveFailures >= DOUYIN_HOST_CONSECUTIVE_FAILURE_THRESHOLD) {
    const exponent = stats.consecutiveFailures - DOUYIN_HOST_CONSECUTIVE_FAILURE_THRESHOLD;
    const cooldownMs = Math.min(
      DOUYIN_HOST_COOLDOWN_BASE_MS * Math.pow(2, exponent),
      DOUYIN_HOST_COOLDOWN_MAX_MS
    );
    stats.cooldownUntil = Date.now() + cooldownMs;
  }

  douyinDownloadHostStats.set(stats.host || host, stats);
}

function resetDouyinDownloadHostConsecutiveFailures(host) {
  const stats = getDouyinDownloadHostStatsWithTiming(host);
  stats.consecutiveFailures = 0;
  stats.cooldownUntil = 0;
  stats.lastOutcome = 'success';
  stats.lastAttemptAt = Date.now();
  douyinDownloadHostStats.set(stats.host || host, stats);
}

function updateDouyinDownloadHostStats(host, outcome = 'selected', timing = null) {
  const normalizedHost = String(host || 'unknown').trim() || 'unknown';
  const current = getDouyinDownloadHostStatsWithTiming(normalizedHost);

  if (Object.prototype.hasOwnProperty.call(current, outcome)) {
    current[outcome] += 1;
  }

  if (outcome === 'success') {
    resetDouyinDownloadHostConsecutiveFailures(normalizedHost);
    if (timing?.ttfbMs && Number.isFinite(timing.ttfbMs)) {
      recordDouyinDownloadHostTtfb(normalizedHost, timing.ttfbMs);
    }
    if (timing?.totalDurationMs && Number.isFinite(timing.totalDurationMs)) {
      recordDouyinDownloadHostTotalDuration(normalizedHost, timing.totalDurationMs);
    }
  } else if (['failure', 'timeout', 'http4xx', 'http5xx', 'empty', 'invalid', 'network', 'noAudio'].includes(outcome)) {
    incrementDouyinDownloadHostConsecutiveFailures(normalizedHost);
  }

  douyinDownloadHostStats.set(normalizedHost, current);
  return {
    host: normalizedHost,
    ...current
  };
}

function getDouyinDownloadHostStatsSnapshot(host) {
  const normalizedHost = String(host || 'unknown').trim() || 'unknown';
  const current = douyinDownloadHostStats.get(normalizedHost) || {
    selected: 0,
    attempts: 0,
    success: 0,
    failure: 0,
    timeout: 0,
    http4xx: 0,
    http5xx: 0,
    empty: 0,
    invalid: 0,
    network: 0,
    noAudio: 0
  };

  return {
    host: normalizedHost,
    ...current
  };
}

function getDouyinDownloadHostBaseScore(host) {
  const normalizedHost = String(host || '').trim().toLowerCase();
  if (DOUYIN_DOWNLOAD_HOST_BASE_SCORES.has(normalizedHost)) {
    return DOUYIN_DOWNLOAD_HOST_BASE_SCORES.get(normalizedHost) || 0;
  }

  let score = 0;
  if (/douyinvod\.com$/i.test(normalizedHost)) score += 70;
  if (/amemv\.com$/i.test(normalizedHost)) score += 65;
  if (/zjcdn\.com$/i.test(normalizedHost)) score += 35;
  if (/abtest/i.test(normalizedHost)) score -= 90;
  return score;
}

function diagnoseCurlTimingBreakdown(timing) {
  const {
    time_namelookup = 0,
    time_connect = 0,
    time_appconnect = 0,
    time_pretransfer = 0,
    time_starttransfer = 0,
    time_total = 0
  } = timing || {};

  const dnsMs = Math.round(time_namelookup * 1000);
  const tcpMs = Math.round((time_connect - time_namelookup) * 1000);
  const tlsMs = Math.round((time_appconnect - time_connect) * 1000);
  const serverWaitMs = Math.round((time_starttransfer - time_pretransfer) * 1000);
  const transferMs = Math.round((time_total - time_starttransfer) * 1000);

  const issues = [];
  if (dnsMs > 500) issues.push({ type: 'dns_slow', detail: `DNS took ${dnsMs}ms`, severity: 'warning' });
  if (tcpMs > 1000) issues.push({ type: 'tcp_latency', detail: `TCP handshake took ${tcpMs}ms`, severity: 'warning' });
  if (tlsMs > 1000) issues.push({ type: 'tls_slow', detail: `TLS handshake took ${tlsMs}ms`, severity: 'info' });
  if (serverWaitMs > 3000) issues.push({ type: 'cdn_slow_ttfb', detail: `Server wait (TTFB after ready) took ${serverWaitMs}ms`, severity: 'critical' });
  if (transferMs > 30000) issues.push({ type: 'transfer_slow', detail: `Data transfer took ${transferMs}ms`, severity: 'warning' });

  return {
    breakdown: { dnsMs, tcpMs, tlsMs, serverWaitMs, transferMs, totalMs: Math.round(time_total * 1000) },
    issues,
    bottleneck: issues.length > 0 ? issues.sort((a, b) => {
      const sev = { critical: 3, warning: 2, info: 1 };
      return sev[b.severity] - sev[a.severity];
    })[0].type : 'none'
  };
}

function shouldRetryDouyinVideoDownloadError(error) {
  const stage = String(error?.stage || '');
  const curlCode = Number(error?.curlCode || 0);

  if (stage === 'douyin_video_download_timeout') {
    return true;
  }

  if (stage === 'douyin_video_download_network_error') {
    return true;
  }

  if (stage === 'douyin_video_download_http_5xx') {
    return true;
  }

  if (stage === 'douyin_video_download_empty_file' || stage === 'douyin_video_download_invalid_file' || stage === 'douyin_video_download_no_audio') {
    return true;
  }

  return [5, 6, 7, 18, 28, 52, 55, 56].includes(curlCode);
}

async function raceVideoDownloads({ candidates, requestId, referer, timeoutMs }) {
  const topCandidates = candidates.slice(0, 3);
  if (topCandidates.length === 0) {
    throw createDouyinResolveError({
      stage: 'universal_video_download_no_candidates',
      statusCode: 400,
      message: '视频下载失败',
      detail: '没有可用的视频下载候选地址。'
    });
  }

  if (topCandidates.length === 1) {
    const outputPath = path.join(UPLOAD_TEMP_DIR, `${requestId}_video${getFallbackExtensionFromUrl(topCandidates[0].url)}`);
    const result = await downloadSingleVideoWithCurl({
      url: topCandidates[0].url,
      outputPath,
      referer,
      timeoutMs
    });
    const probeResult = await validateDownloadedVideoFile(result.outputPath, Math.min(timeoutMs, 30 * 1000));
    return {
      videoPath: result.outputPath,
      fileSize: result.fileSize,
      host: topCandidates[0].host || getHostnameFromUrl(topCandidates[0].url),
      effectiveUrl: topCandidates[0].url,
      httpStatus: 200,
      validation: probeResult,
      firstSelectedHost: topCandidates[0].host || getHostnameFromUrl(topCandidates[0].url)
    };
  }

  const processes = [];
  const outputPaths = [];
  const promises = [];

  for (let i = 0; i < topCandidates.length; i++) {
    const candidate = topCandidates[i];
    const outputPath = path.join(UPLOAD_TEMP_DIR, `${requestId}_race_${i}${getFallbackExtensionFromUrl(candidate.url)}`);
    outputPaths.push(outputPath);

    const promise = new Promise((resolve, reject) => {
      const curl = spawn('curl', [
        '--location', '--silent', '--show-error',
        '--output', outputPath,
        '--request', 'GET',
        '--url', candidate.url,
        '--user-agent', DOUYIN_USER_AGENT,
        '--header', `Referer: ${referer || 'https://www.douyin.com/'}`,
        '--header', 'Accept: */*',
        '--connect-timeout', String(DOUYIN_VIDEO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS),
        '--max-time', String(Math.ceil(timeoutMs / 1000)),
      ]);

      processes.push(curl);

      const timer = setTimeout(() => {
        curl.kill('SIGKILL');
      }, timeoutMs + 3000);

      curl.on('exit', async (code) => {
        clearTimeout(timer);
        if (code !== 0) {
          await unlink(outputPath).catch(() => {});
          reject(new Error(`curl exit ${code}`));
          return;
        }
        try {
          const info = await stat(outputPath);
          if (info.size <= 0) {
            await unlink(outputPath).catch(() => {});
            reject(new Error('empty file'));
            return;
          }
          resolve({
            outputPath,
            fileSize: info.size,
            candidate
          });
        } catch (e) {
          reject(e);
        }
      });

      curl.on('error', (err) => {
        clearTimeout(timer);
        unlink(outputPath).catch(() => {});
        reject(err);
      });
    });

    promises.push(promise);
  }

  try {
    const winner = await Promise.race(promises);

    for (const proc of processes) {
      proc.kill('SIGKILL');
    }

    for (const p of outputPaths) {
      if (p !== winner.outputPath) {
        unlink(p).catch(() => {});
      }
    }

    const probeResult = await validateDownloadedVideoFile(winner.outputPath, Math.min(timeoutMs, 30 * 1000));

    return {
      videoPath: winner.outputPath,
      fileSize: winner.fileSize,
      host: winner.candidate.host || getHostnameFromUrl(winner.candidate.url),
      effectiveUrl: winner.candidate.url,
      httpStatus: 200,
      validation: probeResult,
      firstSelectedHost: winner.candidate.host || getHostnameFromUrl(winner.candidate.url)
    };
  } catch (error) {
    for (const proc of processes) {
      proc.kill('SIGKILL');
    }
    for (const p of outputPaths) {
      unlink(p).catch(() => {});
    }
    throw createDouyinResolveError({
      stage: 'universal_video_download_parallel_failed',
      statusCode: 502,
      message: '视频下载失败',
      detail: '所有并行下载候选均失败，请稍后重试。'
    });
  }
}

async function downloadSingleVideoWithCurl({ url, outputPath, referer, timeoutMs }) {
  return new Promise((resolve, reject) => {
    const curl = spawn('curl', [
      '--location', '--silent', '--show-error',
      '--output', outputPath,
      '--request', 'GET',
      '--url', url,
      '--user-agent', DOUYIN_USER_AGENT,
      '--header', `Referer: ${referer || 'https://www.douyin.com/'}`,
      '--header', 'Accept: */*',
      '--connect-timeout', String(DOUYIN_VIDEO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS),
      '--max-time', String(Math.ceil(timeoutMs / 1000)),
    ]);

    const timer = setTimeout(() => {
      curl.kill('SIGKILL');
    }, timeoutMs + 3000);

    curl.on('exit', async (code) => {
      clearTimeout(timer);
      if (code !== 0) {
        await unlink(outputPath).catch(() => {});
        reject(new Error(`curl exit ${code}`));
        return;
      }
      try {
        const info = await stat(outputPath);
        if (info.size <= 0) {
          await unlink(outputPath).catch(() => {});
          reject(new Error('empty file'));
          return;
        }
        resolve({
          outputPath,
          fileSize: info.size
        });
      } catch (e) {
        reject(e);
      }
    });

    curl.on('error', (err) => {
      clearTimeout(timer);
      unlink(outputPath).catch(() => {});
      reject(err);
    });
  });
}

async function downloadDouyinVideoToTemp({ downloadUrl, downloadUrlCandidates = [], requestId, parentDeadlineAt = 0, referer = '' }) {
  await ensureUploadTempDir();
  const normalizedCandidates = normalizeDouyinDownloadCandidates(downloadUrlCandidates, downloadUrl);
  const fallbackCandidate = normalizedCandidates[0] || {
    url: downloadUrl,
    source: 'resolved.downloadUrl',
    host: getHostnameFromUrl(downloadUrl)
  };
  const videoExtension = getFallbackExtensionFromUrl(fallbackCandidate.url);
  const videoPath = path.join(UPLOAD_TEMP_DIR, `${requestId}_douyin${videoExtension}`);
  const attemptedHosts = new Set();
  const attemptedUrls = new Set();
  let firstSelectedHost = '';
  let previousAttemptHost = '';
  let lastError = null;
  const maxAttempts = Math.max(
    DOUYIN_VIDEO_DOWNLOAD_RETRY_DELAYS_MS.length,
    Math.min(normalizedCandidates.length || 1, 12)
  );

  for (let attempt = 0; attempt < maxAttempts; attempt += 1) {
    if (attempt > 0) {
      const delayMs = DOUYIN_VIDEO_DOWNLOAD_RETRY_DELAYS_MS[Math.min(attempt, DOUYIN_VIDEO_DOWNLOAD_RETRY_DELAYS_MS.length - 1)] || 0;
      if (delayMs > 0) await sleep(delayMs);
    }

    const attemptStartedAt = Date.now();
    const shouldSwitchHost =
      attempt > 0 &&
      (
        lastError?.stage === 'douyin_video_download_timeout' ||
        lastError?.stage === 'douyin_video_download_network_error' ||
        lastError?.stage === 'douyin_video_download_http_5xx' ||
        lastError?.stage === 'douyin_video_download_empty_file' ||
        lastError?.stage === 'douyin_video_download_invalid_file' ||
        lastError?.stage === 'douyin_video_download_no_audio'
      );
    const rankedCandidates = rankDouyinDownloadCandidates(normalizedCandidates, {
      attemptedHosts: shouldSwitchHost ? attemptedHosts : new Set()
    });
    const untriedCandidates = rankedCandidates.filter((candidate) => candidate.url && !attemptedUrls.has(candidate.url));
    const alternateHostCandidates = untriedCandidates.filter((candidate) => candidate.host && !attemptedHosts.has(candidate.host));
    const currentCandidate = alternateHostCandidates[0] || untriedCandidates[0] || rankedCandidates[0] || fallbackCandidate;
    const currentDownloadUrl = currentCandidate.url;
    if (attemptedUrls.has(currentDownloadUrl) && attemptedUrls.size >= normalizedCandidates.length) {
      break;
    }
    const downloadHost = currentCandidate.host || getHostnameFromUrl(currentDownloadUrl);
    const currentCandidateRank = rankedCandidates.findIndex((candidate) => candidate.url === currentDownloadUrl) + 1;
    const retrySwitchedHost = attempt > 0 && previousAttemptHost && downloadHost !== previousAttemptHost ? downloadHost : '';
    if (!firstSelectedHost) {
      firstSelectedHost = downloadHost;
    }
    attemptedHosts.add(downloadHost);
    attemptedUrls.add(currentDownloadUrl);
    updateDouyinDownloadHostStats(downloadHost, 'selected');
    const { timeoutMs } = getStageTimeoutContext({
      parentDeadlineAt,
      stageStartedAt: attemptStartedAt,
      stageTimeoutMs: Math.min(DOUYIN_VIDEO_DOWNLOAD_TIMEOUT_MS, DOUYIN_VIDEO_DOWNLOAD_ATTEMPT_TIMEOUT_MS),
      timeoutStage: 'douyin_transcript_total_timeout',
      failedStage: 'video_download',
      timeoutMessage: '文案提取失败',
      timeoutDetail: '整条转写链路总超时，未能开始视频下载。',
      targetPath: videoPath,
      host: downloadHost
    });
    const curlArgs = [
      '--location',
      '--silent',
      '--show-error',
      '--output', videoPath,
      '--request', 'GET',
      '--url', currentDownloadUrl,
      '--user-agent', DOUYIN_USER_AGENT,
      '--header', `Referer: ${referer || 'https://www.douyin.com/'}`,
      '--header', 'Accept: */*',
      '--connect-timeout', String(DOUYIN_VIDEO_DOWNLOAD_CONNECT_TIMEOUT_SECONDS),
      '--max-time', String(Math.ceil(timeoutMs / 1000)),
      '--write-out', '\n__CURL_TIMING__:%{time_namelookup},%{time_connect},%{time_appconnect},%{time_pretransfer},%{time_starttransfer},%{time_total}\n__CURL_HTTP_STATUS__:%{http_code}\n__CURL_SIZE_DOWNLOAD__:%{size_download}\n__CURL_EFFECTIVE_URL__:%{url_effective}'
    ];
    const hostStats = updateDouyinDownloadHostStats(downloadHost, 'attempts');

    logDouyinTranscriptEvent({
      event: 'video_download_started',
      requestId,
      startedAt: attemptStartedAt,
      timeoutMs,
      targetPath: videoPath,
      finalFileSize: 0,
      host: downloadHost,
      upstreamStatus: 0,
      attempt: attempt + 1,
      downloadUrl: currentDownloadUrl,
      firstSelectedHost,
      retrySwitchedHost,
      selectedSource: currentCandidate.source || '',
      selectedRank: currentCandidateRank > 0 ? currentCandidateRank : 1,
      candidateRank: rankedCandidates.slice(0, 8).map((candidate, index) => ({
        rank: index + 1,
        host: candidate.host || '',
        source: candidate.source || '',
        score: candidate.score
      })),
      hostStats
    });

    try {
      const { stdout, stderr } = await execFileAsync('curl', curlArgs, {
        maxBuffer: 1024 * 1024,
        timeout: timeoutMs + 1000,
        killSignal: 'SIGKILL'
      });

      const stdoutText = String(stdout || '');
      const stderrText = String(stderr || '');
      const timingMatch = stdoutText.match(/__CURL_TIMING__:([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+),([\d.]+)/);
      const httpStatusMatch = stdoutText.match(/__CURL_HTTP_STATUS__:(\d+)/);
      const sizeDownloadMatch = stdoutText.match(/__CURL_SIZE_DOWNLOAD__:(\d+(?:\.\d+)?)/);
      const effectiveUrlMatch = stdoutText.match(/__CURL_EFFECTIVE_URL__:(.+)$/m);
      const httpStatus = Number.parseInt(httpStatusMatch?.[1] || '0', 10);
      const reportedSize = Number.parseFloat(sizeDownloadMatch?.[1] || '0');
      const effectiveUrl = String(effectiveUrlMatch?.[1] || '').trim();
      const stderrSummary = summarizeUpstreamBody(stderrText);

      const curlTiming = {
        time_namelookup: Number.parseFloat(timingMatch?.[1] || '0'),
        time_connect: Number.parseFloat(timingMatch?.[2] || '0'),
        time_appconnect: Number.parseFloat(timingMatch?.[3] || '0'),
        time_pretransfer: Number.parseFloat(timingMatch?.[4] || '0'),
        time_starttransfer: Number.parseFloat(timingMatch?.[5] || '0'),
        time_total: Number.parseFloat(timingMatch?.[6] || '0'),
      };
      const ttfbMs = Math.round(curlTiming.time_starttransfer * 1000);
      const totalDurationMs = Math.round(curlTiming.time_total * 1000);

      if (!httpStatus || httpStatus >= 400) {
        await unlink(videoPath).catch(() => {});
        const httpStage = httpStatus >= 500
          ? 'douyin_video_download_http_5xx'
          : 'douyin_video_download_http_4xx';
        updateDouyinDownloadHostStats(downloadHost, httpStatus >= 500 ? 'http5xx' : 'http4xx');
        updateDouyinDownloadHostStats(downloadHost, 'failure');
        throw annotateDouyinError(createDouyinResolveError({
          stage: httpStage,
          statusCode: httpStatus >= 400 && httpStatus < 500 ? 400 : 502,
          upstreamStatus: httpStatus,
          upstreamBodySummary: summarizeUpstreamBody(stdoutText),
          message: '视频下载失败',
          detail: `视频文件请求失败，状态码 ${httpStatus || 0}`
        }), {
          failedStage: 'video_download',
          timeoutMs,
          targetPath: videoPath,
          host: downloadHost,
          curlCode: 0,
          curlStderr: stderrSummary,
          curlHttpStatus: httpStatus,
          effectiveUrl,
          firstSelectedHost,
          retrySwitchedHost
        });
      }

      const fileInfo = await stat(videoPath);
      if (fileInfo.size <= 0) {
        await unlink(videoPath).catch(() => {});
        updateDouyinDownloadHostStats(downloadHost, 'empty');
        updateDouyinDownloadHostStats(downloadHost, 'failure');
        throw annotateDouyinError(createDouyinResolveError({
          stage: 'douyin_video_download_empty_file',
          statusCode: 502,
          upstreamStatus: httpStatus,
          message: '视频下载失败',
          detail: '视频文件下载完成，但结果为空文件。'
        }), {
          failedStage: 'video_download',
          timeoutMs,
          targetPath: videoPath,
          host: downloadHost,
          curlCode: 0,
          curlStderr: stderrSummary,
          curlHttpStatus: httpStatus,
          effectiveUrl,
          firstSelectedHost,
          retrySwitchedHost
        });
      }

      if (fileInfo.size > MAX_DOUYIN_VIDEO_DOWNLOAD_BYTES) {
        await unlink(videoPath).catch(() => {});
        updateDouyinDownloadHostStats(downloadHost, 'failure');
        throw annotateDouyinError(createDouyinResolveError({
          stage: 'douyin_video_download_too_large',
          statusCode: 413,
          message: '视频下载失败',
          detail: '视频文件过大，当前服务端限制为 220MB。'
        }), {
          failedStage: 'video_download',
          timeoutMs,
          targetPath: videoPath,
          host: downloadHost,
          curlCode: 0,
          curlStderr: stderrSummary,
          curlHttpStatus: httpStatus,
          effectiveUrl,
          firstSelectedHost,
          retrySwitchedHost
        });
      }

      let probeResult;
      try {
        probeResult = await validateDownloadedVideoFile(videoPath, Math.min(timeoutMs, 30 * 1000));
      } catch (probeError) {
        await unlink(videoPath).catch(() => {});
        if (probeError?.stage === 'ffprobe_missing') {
          throw annotateDouyinError(probeError, {
            failedStage: 'video_download',
            timeoutMs,
            targetPath: videoPath,
            host: downloadHost,
            curlCode: 0,
            curlStderr: stderrSummary,
            curlHttpStatus: httpStatus,
            effectiveUrl,
            firstSelectedHost,
            retrySwitchedHost
          });
        }
        if (probeError?.noAudioStream === true) {
          updateDouyinDownloadHostStats(downloadHost, 'noAudio');
          updateDouyinDownloadHostStats(downloadHost, 'failure');
          throw annotateDouyinError(createDouyinResolveError({
            stage: 'douyin_video_download_no_audio',
            statusCode: 502,
            upstreamStatus: httpStatus,
            message: '视频下载失败',
            detail: `视频文件已下载，但缺少音频流，将尝试其他下载地址。`
          }), {
            failedStage: 'video_download',
            timeoutMs,
            targetPath: videoPath,
            host: downloadHost,
            curlCode: 0,
            curlStderr: stderrSummary,
            curlHttpStatus: httpStatus,
            effectiveUrl,
            firstSelectedHost,
            retrySwitchedHost
          });
        }
        updateDouyinDownloadHostStats(downloadHost, 'invalid');
        updateDouyinDownloadHostStats(downloadHost, 'failure');
        throw annotateDouyinError(createDouyinResolveError({
          stage: 'douyin_video_download_invalid_file',
          statusCode: 502,
          upstreamStatus: httpStatus,
          message: '视频下载失败',
          detail: `视频文件已下载，但 ffprobe 无法读取：${probeError?.message || 'invalid media file'}`
        }), {
          failedStage: 'video_download',
          timeoutMs,
          targetPath: videoPath,
          host: downloadHost,
          curlCode: 0,
          curlStderr: stderrSummary,
          curlHttpStatus: httpStatus,
          effectiveUrl,
          firstSelectedHost,
          retrySwitchedHost
        });
      }

      const successHostStats = updateDouyinDownloadHostStats(downloadHost, 'success', { ttfbMs, totalDurationMs });

      logDouyinTranscriptEvent({
        event: 'video_download_finished',
        requestId,
        startedAt: attemptStartedAt,
        timeoutMs,
        targetPath: videoPath,
        finalFileSize: fileInfo.size,
        host: downloadHost,
        upstreamStatus: httpStatus,
        attempt: attempt + 1,
        effectiveUrl,
        reportedDownloadSize: Number.isFinite(reportedSize) ? reportedSize : 0,
        stderr: stderrSummary,
        curlExitCode: 0,
        curlHttpStatus: httpStatus,
        ffprobeDurationSeconds: probeResult.durationSeconds,
        ffprobeFormatName: probeResult.formatName,
        ffprobeSize: probeResult.probedSize,
        firstSelectedHost,
        retrySwitchedHost,
        selectedSource: currentCandidate.source || '',
        selectedRank: currentCandidateRank > 0 ? currentCandidateRank : 1,
        candidateRank: rankedCandidates.slice(0, 8).map((candidate, index) => ({
          rank: index + 1,
          host: candidate.host || '',
          source: candidate.source || '',
          score: candidate.score
        })),
        hostStats: successHostStats,
        curlTiming: {
          dnsMs: Math.round(curlTiming.time_namelookup * 1000),
          tcpMs: Math.round((curlTiming.time_connect - curlTiming.time_namelookup) * 1000),
          tlsMs: Math.round((curlTiming.time_appconnect - curlTiming.time_connect) * 1000),
          serverWaitMs: Math.round((curlTiming.time_starttransfer - curlTiming.time_pretransfer) * 1000),
          transferMs: Math.round((curlTiming.time_total - curlTiming.time_starttransfer) * 1000),
          totalMs: totalDurationMs
        },
        networkDiagnosis: diagnoseCurlTimingBreakdown(curlTiming)
      });

      previousAttemptHost = downloadHost;
      return {
        videoPath,
        fileSize: fileInfo.size,
        host: downloadHost,
        effectiveUrl,
        httpStatus,
        validation: probeResult,
        firstSelectedHost
      };
    } catch (error) {
      const partialFileSize = await getFileSizeIfExists(videoPath);
      await unlink(videoPath).catch(() => {});

      if (error?.stage) {
        lastError = annotateDouyinError(error, {
          failedStage: error?.failedStage || 'video_download',
          timeoutMs: error?.timeoutMs || timeoutMs,
          targetPath: error?.targetPath || videoPath,
          host: error?.host || downloadHost,
          firstSelectedHost: error?.firstSelectedHost || firstSelectedHost,
          retrySwitchedHost: error?.retrySwitchedHost || retrySwitchedHost
        });
      } else {
        const curlCode = Number(error?.code || 0);
        const stderrText = String(error?.stderr || '');
        const isTimeout = curlCode === 28 || error?.killed === true || /timed out|timeout/i.test(stderrText || error?.message || '');
        updateDouyinDownloadHostStats(downloadHost, isTimeout ? 'timeout' : 'network');
        updateDouyinDownloadHostStats(downloadHost, 'failure');
        lastError = annotateDouyinError(createDouyinResolveError({
          stage: isTimeout ? 'douyin_video_download_timeout' : 'douyin_video_download_network_error',
          statusCode: isTimeout ? 504 : 502,
          message: '视频下载失败',
          detail: isTimeout
            ? '视频文件下载超时，请稍后重试。'
            : `视频文件下载网络异常：${stderrText || error?.message || 'curl failed'}`,
        }), {
          failedStage: 'video_download',
          timeoutMs,
          targetPath: videoPath,
          host: downloadHost,
          curlStderr: summarizeUpstreamBody(stderrText),
          curlHttpStatus: 0,
          firstSelectedHost,
          retrySwitchedHost
        });
        lastError.curlCode = curlCode;
      }

      const hasUntriedCandidate = normalizedCandidates.some((candidate) => candidate?.url && !attemptedUrls.has(candidate.url));
      const canRetry = attempt < maxAttempts - 1 && hasUntriedCandidate && shouldRetryDouyinVideoDownloadError(lastError);
      const hostStatsOnFailure = getDouyinDownloadHostStatsSnapshot(downloadHost);

      logDouyinTranscriptEvent({
        level: 'error',
        event: 'video_download_failed',
        requestId,
        startedAt: attemptStartedAt,
        timeoutMs: lastError?.timeoutMs || timeoutMs,
        targetPath: videoPath,
        finalFileSize: partialFileSize,
        host: downloadHost,
        upstreamStatus: lastError?.upstreamStatus || 0,
        attempt: attempt + 1,
        canRetry,
        stage: lastError?.stage || '',
        curlCode: lastError?.curlCode || 0,
        curlHttpStatus: lastError?.curlHttpStatus || 0,
        curlStderr: lastError?.curlStderr || '',
        effectiveUrl: lastError?.effectiveUrl || '',
        firstSelectedHost,
        retrySwitchedHost,
        selectedSource: currentCandidate.source || '',
        selectedRank: currentCandidateRank > 0 ? currentCandidateRank : 1,
        candidateRank: rankedCandidates.slice(0, 8).map((candidate, index) => ({
          rank: index + 1,
          host: candidate.host || '',
          source: candidate.source || '',
          score: candidate.score
        })),
        message: lastError?.message || '',
        detail: lastError?.detail || '',
        hostStats: hostStatsOnFailure
      });

      previousAttemptHost = downloadHost;
      if (!canRetry) {
        throw lastError;
      }
    }
  }

  throw lastError || createDouyinResolveError({
    stage: 'douyin_video_download_failed',
    statusCode: 502,
    message: '视频下载失败'
  });
}

async function extractAudioFromDouyinVideo({ inputPath, requestId, parentDeadlineAt = 0, sourceHost = '' }) {
  const stageStartedAt = Date.now();
  const audioPath = path.join(UPLOAD_TEMP_DIR, `${requestId}_asr.mp3`);
  const host = sourceHost || 'local';
  const { timeoutMs } = getStageTimeoutContext({
    parentDeadlineAt,
    stageStartedAt,
    stageTimeoutMs: DOUYIN_AUDIO_EXTRACT_TIMEOUT_MS,
    timeoutStage: 'douyin_transcript_total_timeout',
    failedStage: 'audio_extract',
    timeoutMessage: '文案提取失败',
    timeoutDetail: '整条转写链路总超时，未能开始音频提取。',
    targetPath: audioPath,
    host
  });

  logDouyinTranscriptEvent({
    event: 'audio_extract_started',
    requestId,
    startedAt: stageStartedAt,
    timeoutMs,
    targetPath: audioPath,
    finalFileSize: 0,
    host,
    upstreamStatus: 0,
    sourcePath: inputPath
  });

  try {
    await ensureVideoCompressionTools();
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', inputPath,
      '-vn',
      '-ac', '1',
      '-ar', '16000',
      '-b:a', '64k',
      audioPath
    ], {
      timeout: timeoutMs,
      killSignal: 'SIGKILL'
    });

    const finalFileSize = await getFileSizeIfExists(audioPath);
    logDouyinTranscriptEvent({
      event: 'audio_extract_finished',
      requestId,
      startedAt: stageStartedAt,
      timeoutMs,
      targetPath: audioPath,
      finalFileSize,
      host,
      upstreamStatus: 0,
      sourcePath: inputPath
    });

    return audioPath;
  } catch (error) {
    const finalFileSize = await getFileSizeIfExists(audioPath);
    logDouyinTranscriptEvent({
      level: 'error',
      event: 'audio_extract_failed',
      requestId,
      startedAt: stageStartedAt,
      timeoutMs,
      targetPath: audioPath,
      finalFileSize,
      host,
      upstreamStatus: 0,
      sourcePath: inputPath,
      message: error?.message || '',
      detail: error?.detail || '',
      stage: error?.stage || ''
    });

    if (error instanceof Error && error.message === '服务器未安装 ffmpeg，无法自动压缩大视频') {
      throw annotateDouyinError(error, {
        stage: 'douyin_audio_extract_failed',
        failedStage: 'audio_extract',
        timeoutMs,
        targetPath: audioPath,
        host
      });
    }

    if (error?.killed === true || /timed out|timeout/i.test(String(error?.message || ''))) {
      throw createDouyinStageTimeoutError({
        stage: 'douyin_audio_extract_timeout',
        failedStage: 'audio_extract',
        timeoutMs,
        targetPath: audioPath,
        host,
        message: '音频提取失败',
        detail: '音频提取超时，请稍后重试。'
      });
    }

    throw annotateDouyinError(error, {
      stage: error?.stage || 'douyin_audio_extract_failed',
      failedStage: error?.failedStage || 'audio_extract',
      timeoutMs,
      targetPath: audioPath,
      host
    });
  }
}

async function splitAudioForDouyinAsr({ audioPath, requestId, parentDeadlineAt = 0, sourceHost = '' }) {
  const durationSeconds = await getVideoDurationSeconds(audioPath);
  if (durationSeconds <= DOUYIN_ASR_MAX_SEGMENT_DURATION_SECONDS) {
    return [audioPath];
  }

  const prefix = path.join(UPLOAD_TEMP_DIR, `${requestId}_segment_`);
  const stageStartedAt = Date.now();
  const host = sourceHost || 'local';
  const { timeoutMs } = getStageTimeoutContext({
    parentDeadlineAt,
    stageStartedAt,
    stageTimeoutMs: DOUYIN_AUDIO_EXTRACT_TIMEOUT_MS,
    timeoutStage: 'douyin_transcript_total_timeout',
    failedStage: 'audio_segment_split',
    timeoutMessage: '文案提取失败',
    timeoutDetail: '整条转写链路总超时，未能开始音频分段。',
    targetPath: prefix,
    host
  });

  logDouyinTranscriptEvent({
    event: 'audio_segment_split_started',
    requestId,
    startedAt: stageStartedAt,
    timeoutMs,
    targetPath: prefix,
    finalFileSize: await getFileSizeIfExists(audioPath),
    host,
    upstreamStatus: 0,
    sourcePath: audioPath,
    durationSeconds
  });

  try {
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', audioPath,
      '-f', 'segment',
      '-segment_time', String(DOUYIN_ASR_SEGMENT_SECONDS),
      '-c', 'copy',
      `${prefix}%03d.mp3`
    ], {
      timeout: timeoutMs,
      killSignal: 'SIGKILL'
    });
  } catch (error) {
    logDouyinTranscriptEvent({
      level: 'error',
      event: 'audio_segment_split_failed',
      requestId,
      startedAt: stageStartedAt,
      timeoutMs,
      targetPath: prefix,
      finalFileSize: await getFileSizeIfExists(audioPath),
      host,
      upstreamStatus: 0,
      sourcePath: audioPath,
      durationSeconds,
      message: error?.message || '',
      detail: error?.detail || '',
      stage: error?.stage || ''
    });

    if (error?.killed === true || /timed out|timeout/i.test(String(error?.message || ''))) {
      throw createDouyinStageTimeoutError({
        stage: 'douyin_audio_segment_split_timeout',
        failedStage: 'audio_segment_split',
        timeoutMs,
        targetPath: prefix,
        host,
        message: '音频分段失败',
        detail: '音频分段超时，请稍后重试。'
      });
    }

    throw annotateDouyinError(error, {
      stage: error?.stage || 'douyin_audio_segment_split_failed',
      failedStage: error?.failedStage || 'audio_segment_split',
      timeoutMs,
      targetPath: prefix,
      host
    });
  }

  const files = await readdir(UPLOAD_TEMP_DIR);
  const segments = files
    .filter((name) => name.startsWith(`${requestId}_segment_`) && name.endsWith('.mp3'))
    .sort()
    .map((name) => path.join(UPLOAD_TEMP_DIR, name));

  const segmentTotalSize = await Promise.all(segments.map((segmentPath) => getFileSizeIfExists(segmentPath)))
    .then((sizes) => sizes.reduce((sum, size) => sum + size, 0));

  logDouyinTranscriptEvent({
    event: 'audio_segment_split_finished',
    requestId,
    startedAt: stageStartedAt,
    timeoutMs,
    targetPath: prefix,
    finalFileSize: segmentTotalSize,
    host,
    upstreamStatus: 0,
    sourcePath: audioPath,
    durationSeconds,
    segmentCount: segments.length
  });

  return segments.length ? segments : [audioPath];
}

function getMimeTypeFromFilePath(filePath) {
  const ext = path.extname(String(filePath || '')).toLowerCase();
  return MIME_TYPES[ext] || 'application/octet-stream';
}

async function transcribeAudioWithSiliconFlow({ audioPath, requestId, segmentIndex = 0, parentDeadlineAt = 0 }) {
  const apiKey = readValue(process.env.SILICONFLOW_API_KEY, SERVER_CONFIG.siliconFlowApiKey);
  if (!apiKey) {
    throw annotateDouyinError(createDouyinResolveError({
      stage: 'siliconflow_api_key_missing',
      statusCode: 500,
      message: 'ASR 请求失败',
      detail: '服务端未配置 SILICONFLOW_API_KEY'
    }), {
      failedStage: 'siliconflow_request',
      timeoutMs: 0,
      targetPath: audioPath,
      host: getHostnameFromUrl(`${SILICONFLOW_API_BASE_URL}/audio/transcriptions`)
    });
  }

  const stageStartedAt = Date.now();
  const audioInfo = await stat(audioPath);
  const mimeType = getMimeTypeFromFilePath(audioPath);
  const requestUrl = `${SILICONFLOW_API_BASE_URL}/audio/transcriptions`;
  const host = getHostnameFromUrl(requestUrl);
  const { timeoutMs } = getStageTimeoutContext({
    parentDeadlineAt,
    stageStartedAt,
    stageTimeoutMs: DOUYIN_ASR_TIMEOUT_MS,
    timeoutStage: 'douyin_transcript_total_timeout',
    failedStage: 'siliconflow_request',
    timeoutMessage: '文案提取失败',
    timeoutDetail: '整条转写链路总超时，未能开始 SiliconFlow ASR 请求。',
    targetPath: audioPath,
    host
  });
  const curlArgs = [
    '--silent',
    '--show-error',
    '--request', 'POST',
    '--url', requestUrl,
    '--header', `Authorization: Bearer ${apiKey}`,
    '--form', `file=@${audioPath};type=${mimeType}`,
    '--form', `model=${SILICONFLOW_ASR_MODEL}`,
    '--form', 'response_format=json',
    '--connect-timeout', String(DOUYIN_ASR_CONNECT_TIMEOUT_SECONDS),
    '--max-time', String(Math.ceil(timeoutMs / 1000)),
    '--write-out', '\n__CURL_HTTP_STATUS__:%{http_code}'
  ];

  logDouyinTranscriptEvent({
    event: 'siliconflow_request_started',
    requestId,
    startedAt: stageStartedAt,
    timeoutMs,
    targetPath: audioPath,
    finalFileSize: audioInfo.size,
    host,
    upstreamStatus: 0,
    segmentIndex,
    url: requestUrl,
    model: SILICONFLOW_ASR_MODEL,
    mimeType,
    requestType: 'multipart/form-data',
    authConfigured: true
  });

  let stdout = '';
  let stderr = '';
  try {
    const result = await execFileAsync('curl', curlArgs, {
      maxBuffer: 2 * 1024 * 1024,
      timeout: timeoutMs + 1000,
      killSignal: 'SIGKILL'
    });
    stdout = String(result.stdout || '');
    stderr = String(result.stderr || '');
  } catch (error) {
    const stdoutText = String(error?.stdout || '');
    const stderrText = String(error?.stderr || '');
    const curlCode = Number(error?.code || 0);
    const isTimeout = curlCode === 28 || error?.killed === true || /timed out|timeout/i.test(stderrText || error?.message || '');

    logDouyinTranscriptEvent({
      level: 'error',
      event: 'siliconflow_request_failed',
      requestId,
      startedAt: stageStartedAt,
      timeoutMs,
      targetPath: audioPath,
      finalFileSize: audioInfo.size,
      host,
      upstreamStatus: 0,
      segmentIndex,
      url: requestUrl,
      model: SILICONFLOW_ASR_MODEL,
      mimeType,
      curlCode,
      stdout: summarizeUpstreamBody(stdoutText),
      stderr: summarizeUpstreamBody(stderrText),
      message: error?.message || ''
    });

    throw annotateDouyinError(createDouyinResolveError({
      stage: isTimeout ? 'douyin_asr_request_timeout' : 'douyin_asr_request_failed',
      statusCode: isTimeout ? 504 : 502,
      message: 'ASR 请求失败',
      detail: isTimeout
        ? 'SiliconFlow ASR 请求超时，请稍后重试。'
        : `SiliconFlow 网络请求失败：${stderrText || error?.message || 'curl failed'}`
    }), {
      failedStage: 'siliconflow_request',
      timeoutMs,
      targetPath: audioPath,
      host
    });
  }

  const statusMarker = '\n__CURL_HTTP_STATUS__:';
  const markerIndex = stdout.lastIndexOf(statusMarker);
  const responseText = markerIndex >= 0 ? stdout.slice(0, markerIndex) : stdout;
  const httpStatus = markerIndex >= 0 ? Number.parseInt(stdout.slice(markerIndex + statusMarker.length).trim(), 10) : 0;
  let json = null;

  try {
    json = responseText ? JSON.parse(responseText) : null;
  } catch {}

  logDouyinTranscriptEvent({
    event: 'siliconflow_response_received',
    requestId,
    startedAt: stageStartedAt,
    timeoutMs,
    targetPath: audioPath,
    finalFileSize: audioInfo.size,
    host,
    upstreamStatus: httpStatus,
    segmentIndex,
    body: summarizeUpstreamBody(responseText),
    stderr: summarizeUpstreamBody(stderr)
  });

  if (!httpStatus || httpStatus < 200 || httpStatus >= 300) {
    logDouyinTranscriptEvent({
      level: 'error',
      event: 'siliconflow_response_failed',
      requestId,
      startedAt: stageStartedAt,
      timeoutMs,
      targetPath: audioPath,
      finalFileSize: audioInfo.size,
      host,
      upstreamStatus: httpStatus,
      segmentIndex,
      url: requestUrl,
      model: SILICONFLOW_ASR_MODEL,
      mimeType,
      body: summarizeUpstreamBody(responseText)
    });
    throw annotateDouyinError(createDouyinResolveError({
      stage: 'douyin_asr_request_failed',
      statusCode: httpStatus >= 400 && httpStatus < 500 ? 400 : 502,
      upstreamStatus: httpStatus,
      upstreamBodySummary: summarizeUpstreamBody(responseText),
      message: 'ASR 请求失败',
      detail: `SiliconFlow 返回状态码 ${httpStatus || 0}`
    }), {
      failedStage: 'siliconflow_request',
      timeoutMs,
      targetPath: audioPath,
      host
    });
  }

  function extractTranscriptText(value) {
    if (typeof value === 'string' && value.trim()) return value.trim();
    if (Array.isArray(value) && value.length > 0) {
      const first = value[0];
      if (typeof first === 'string' && first.trim()) return first.trim();
      if (first && typeof first === 'object') {
        return extractTranscriptText(first.text ?? first.result ?? first.transcript);
      }
    }
    if (value && typeof value === 'object') {
      return extractTranscriptText(value.text ?? value.result ?? value.transcript);
    }
    return '';
  }

  const transcriptText = extractTranscriptText(json?.text ?? json?.result ?? json?.transcript ?? json?.data);
  if (!transcriptText) {
    logDouyinTranscriptEvent({
      level: 'error',
      event: 'siliconflow_response_failed',
      requestId,
      startedAt: stageStartedAt,
      timeoutMs,
      targetPath: audioPath,
      finalFileSize: audioInfo.size,
      host,
      upstreamStatus: httpStatus,
      segmentIndex,
      url: requestUrl,
      model: SILICONFLOW_ASR_MODEL,
      mimeType,
      body: summarizeUpstreamBody(responseText),
      detail: 'SiliconFlow 返回成功，但未给出可用转写文本。'
    });

    throw annotateDouyinError(createDouyinResolveError({
      stage: 'douyin_asr_empty_result',
      statusCode: 502,
      message: 'ASR 请求失败',
      detail: 'SiliconFlow 返回成功，但未给出可用转写文本。'
    }), {
      failedStage: 'siliconflow_response',
      timeoutMs,
      targetPath: audioPath,
      host
    });
  }

  return transcriptText;
}

async function transcribeAudioWithQwen({ audioPath, requestId, segmentIndex = 0, parentDeadlineAt = 0 }) {
  const apiKey = readValue(SERVER_CONFIG.dashscopeApiKey) || readValue(SERVER_CONFIG.aliyunApiKey);
  if (!apiKey) {
    throw annotateDouyinError(createDouyinResolveError({
      stage: 'qwen_asr_api_key_missing',
      statusCode: 500,
      message: 'ASR 请求失败',
      detail: '服务端未配置 DashScope API Key'
    }), {
      failedStage: 'qwen_asr_request',
      timeoutMs: 0,
      targetPath: audioPath,
      host: 'dashscope.aliyuncs.com'
    });
  }

  const stageStartedAt = Date.now();
  const audioInfo = await stat(audioPath);
  const mimeType = getMimeTypeFromFilePath(audioPath);
  const host = 'dashscope.aliyuncs.com';

  const { timeoutMs } = getStageTimeoutContext({
    parentDeadlineAt,
    stageStartedAt,
    stageTimeoutMs: DOUYIN_ASR_TIMEOUT_MS,
    timeoutStage: 'douyin_transcript_total_timeout',
    failedStage: 'qwen_asr_request',
    timeoutMessage: '文案提取失败',
    timeoutDetail: '整条转写链路总超时，未能开始千问 ASR 请求。',
    targetPath: audioPath,
    host
  });

  logDouyinTranscriptEvent({
    event: 'qwen_asr_request_started',
    requestId,
    startedAt: stageStartedAt,
    timeoutMs,
    targetPath: audioPath,
    finalFileSize: audioInfo.size,
    host,
    upstreamStatus: 0,
    segmentIndex,
    url: 'https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions',
    model: 'qwen3-asr-flash',
    mimeType,
    requestType: 'json',
    authConfigured: true
  });

  let responseJson = null;
  try {
    const audioBuffer = await readFile(audioPath);
    const base64Audio = audioBuffer.toString('base64');
    const dataUri = `data:${mimeType};base64,${base64Audio}`;

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);

    const response = await fetch('https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions', {
      method: 'POST',
      signal: controller.signal,
      headers: {
        'Authorization': `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: 'qwen3-asr-flash',
        messages: [
          {
            role: 'user',
            content: [
              {
                type: 'input_audio',
                input_audio: {
                  data: dataUri
                }
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
    try {
      responseJson = JSON.parse(responseText);
    } catch {
      responseJson = null;
    }

    logDouyinTranscriptEvent({
      event: 'qwen_asr_response_received',
      requestId,
      startedAt: stageStartedAt,
      timeoutMs,
      targetPath: audioPath,
      finalFileSize: audioInfo.size,
      host,
      upstreamStatus: response.status,
      segmentIndex,
      body: summarizeUpstreamBody(responseText)
    });

    if (!response.ok) {
      const errorMsg = responseJson?.error?.message || responseJson?.message || `HTTP ${response.status}`;
      throw annotateDouyinError(createDouyinResolveError({
        stage: 'douyin_asr_request_failed',
        statusCode: response.status >= 500 ? 502 : 400,
        upstreamStatus: response.status,
        upstreamBodySummary: summarizeUpstreamBody(responseText),
        message: 'ASR 请求失败',
        detail: `千问 ASR 返回错误：${errorMsg}`
      }), {
        failedStage: 'qwen_asr_request',
        timeoutMs,
        targetPath: audioPath,
        host
      });
    }

    const transcriptText = responseJson?.choices?.[0]?.message?.content;
    if (!transcriptText || !transcriptText.trim()) {
      throw annotateDouyinError(createDouyinResolveError({
        stage: 'douyin_asr_empty_result',
        statusCode: 502,
        message: 'ASR 请求失败',
        detail: '千问 ASR 返回成功，但未给出可用转写文本。'
      }), {
        failedStage: 'qwen_asr_request',
        timeoutMs,
        targetPath: audioPath,
        host
      });
    }

    return transcriptText.trim();
  } catch (error) {
    if (error?.name === 'AbortError') {
      logDouyinTranscriptEvent({
        level: 'error',
        event: 'qwen_asr_request_timeout',
        requestId,
        startedAt: stageStartedAt,
        timeoutMs,
        targetPath: audioPath,
        finalFileSize: audioInfo.size,
        host,
        upstreamStatus: 0,
        segmentIndex,
        message: '请求超时'
      });
      throw annotateDouyinError(createDouyinResolveError({
        stage: 'douyin_asr_request_timeout',
        statusCode: 504,
        message: 'ASR 请求失败',
        detail: '千问 ASR 请求超时，请稍后重试。'
      }), {
        failedStage: 'qwen_asr_request',
        timeoutMs,
        targetPath: audioPath,
        host
      });
    }
    if (error?.stage) throw error;
    throw annotateDouyinError(createDouyinResolveError({
      stage: 'douyin_asr_request_failed',
      statusCode: 502,
      message: 'ASR 请求失败',
      detail: error?.message || '千问 ASR 网络请求失败'
    }), {
      failedStage: 'qwen_asr_request',
      timeoutMs,
      targetPath: audioPath,
      host
    });
  }
}

async function resolveDouyinDownloadPrimary({ originalUrl, normalizedUrl, awemeId, requestId, deadlineAt = 0 }) {
  const token = readValue(SERVER_CONFIG.tikhubApiToken);

  // Try TikHub first (more reliable since Douyin anti-bot upgrades)
  if (token) {
    let tikhubResult = null;
    let tikhubError = null;
    let highQualityResult = null;

    if (normalizedUrl) {
      // Fire detail + high-quality requests in parallel for speed
      const detailPromise = callTikHubVideoDetailByShareUrl({
        shareUrl: normalizedUrl,
        requestId,
        deadlineAt
      }).catch((err) => ({ __error: true, message: err.message }));

      const hqPromise = callTikHubHighQualityPlayUrl({
        shareUrl: normalizedUrl,
        requestId,
        deadlineAt
      }).catch(() => null);

      const detailResult = await detailPromise;
      if (detailResult && !detailResult.__error) {
        tikhubResult = detailResult;
      } else {
        tikhubError = detailResult;
      }
      highQualityResult = await hqPromise;
    }

    // If share_url failed, try aweme_id; also fetch HQ for aweme_id
    if (!tikhubResult && awemeId) {
      const detailPromise = callTikHubVideoDetailByAwemeId({
        awemeId,
        requestId,
        deadlineAt
      }).catch((err) => ({ __error: true, message: err.message }));

      const hqPromise = callTikHubHighQualityPlayUrl({
        awemeId,
        requestId,
        deadlineAt
      }).catch(() => null);

      const detailResult = await detailPromise;
      if (detailResult && !detailResult.__error) {
        tikhubResult = detailResult;
      } else {
        tikhubError = tikhubError || detailResult;
      }
      if (!highQualityResult) {
        highQualityResult = await hqPromise;
      }
    }

    if (tikhubResult) {
      const mergedDownloadUrlCandidates = [
        ...(tikhubResult.downloadUrlCandidates || []),
        ...(highQualityResult?.downloadUrlCandidates || [])
      ].filter((candidate) => candidate?.url);

      // Prefer candidates explicitly marked with audio
      const audioCandidates = mergedDownloadUrlCandidates.filter((c) => c.hasAudio === true);
      const candidatePool = audioCandidates.length > 0 ? audioCandidates : mergedDownloadUrlCandidates;

      const selectedCandidate =
        pickBestDouyinDownloadCandidate(candidatePool) ||
        (tikhubResult.downloadUrl
          ? {
              url: tikhubResult.downloadUrl,
              source: 'tikhub.primary_result',
              host: getHostnameFromUrl(tikhubResult.downloadUrl)
            }
          : null);

      console.log('[douyin resolve] TikHub primary selected download candidate', {
        requestId,
        candidateCount: mergedDownloadUrlCandidates.length,
        audioCandidateCount: audioCandidates.length,
        selectedSource: selectedCandidate?.source || '',
        selectedHost: selectedCandidate?.host || '',
        selectedHasAudio: selectedCandidate?.hasAudio
      });

      return {
        videoId: tikhubResult.videoId,
        downloadUrl: selectedCandidate?.url || tikhubResult.downloadUrl,
        downloadUrlCandidates: mergedDownloadUrlCandidates,
        title: readValue(tikhubResult.caption),
        caption: '',
        authorName: tikhubResult.authorName,
        duration: tikhubResult.duration || 0,
        videoData: tikhubResult.videoData,
        normalizedUrl,
        resolveStrategy: 'tikhub_primary',
        fallbackCaption: readValue(tikhubResult.caption),
        fallbackCaptionSource: tikhubResult.caption ? 'tikhub_caption' : 'none'
      };
    }

    // TikHub failed, log and fall through to direct HTML scraping
    console.warn('[douyin resolve] TikHub primary failed, falling back to direct HTML scrape', {
      requestId,
      stage: tikhubError?.stage || '',
      message: tikhubError?.message || ''
    });
  }

  // Fallback: direct HTML scraping (legacy path)
  return await resolveDouyinVideoByHtml({
    rawUrl: originalUrl,
    normalizedUrl,
    awemeId,
    requestId,
    deadlineAt
  });
}

function extractTikHubErrorMeta(payload, fallbackText = '') {
  if (!payload || typeof payload !== 'object') {
    return {
      code: '',
      message: '',
      detail: '',
      summary: summarizeUpstreamBody(fallbackText)
    };
  }

  const record = payload;
  const nestedError = record.error && typeof record.error === 'object' ? record.error : null;

  const code = readValue(
    record.code,
    nestedError?.code
  );
  const message = readValue(
    record.message,
    record.msg,
    nestedError?.message,
    nestedError?.msg
  );
  const detail = readValue(
    record.detail,
    nestedError?.detail
  );

  return {
    code,
    message,
    detail,
    summary: summarizeUpstreamBody(payload)
  };
}

function createDouyinResolveError({
  stage,
  message,
  statusCode = 500,
  upstreamStatus = 0,
  upstreamBodySummary = '',
  upstreamCode = '',
  detail = ''
}) {
  const error = new Error(message);
  error.stage = stage;
  error.statusCode = statusCode;
  error.upstreamStatus = upstreamStatus;
  error.upstreamBodySummary = upstreamBodySummary;
  error.upstreamCode = upstreamCode;
  error.detail = detail;
  return error;
}

function getDouyinTranscriptFailedStage(error) {
  return readValue(
    error?.failedStage,
    error?.stage === 'douyin_video_download_failed' ||
    error?.stage === 'douyin_video_download_too_large' ||
    error?.stage === 'douyin_video_download_timeout' ||
    error?.stage === 'douyin_video_download_network_error' ||
    error?.stage === 'douyin_video_download_http_4xx' ||
    error?.stage === 'douyin_video_download_http_5xx' ||
    error?.stage === 'douyin_video_download_empty_file' ||
    error?.stage === 'douyin_video_download_invalid_file'
      ? 'video_download'
      : '',
    error?.stage === 'douyin_audio_extract_failed' || error?.stage === 'douyin_audio_extract_timeout'
      ? 'audio_extract'
      : '',
    error?.stage === 'douyin_audio_segment_split_failed' || error?.stage === 'douyin_audio_segment_split_timeout'
      ? 'audio_segment_split'
      : '',
    error?.stage === 'douyin_asr_request_failed' || error?.stage === 'douyin_asr_request_timeout' || error?.stage === 'siliconflow_api_key_missing'
      ? 'siliconflow_request'
      : '',
    error?.stage === 'douyin_asr_empty_result'
      ? 'siliconflow_response'
      : '',
    error?.stage === 'douyin_video_resolve_timeout' || error?.stage === 'douyin_video_parse_failed' || error?.stage === 'douyin_download_link_missing'
      ? 'video_resolved'
      : ''
  ) || 'unknown_stage';
}

function getDouyinTranscriptErrorMessage(error) {
  const stage = String(error?.stage || '');

  if (
    stage === 'douyin_video_download_failed' ||
    stage === 'douyin_video_download_too_large' ||
    stage === 'douyin_video_download_timeout' ||
    stage === 'douyin_video_download_network_error' ||
    stage === 'douyin_video_download_http_4xx' ||
    stage === 'douyin_video_download_http_5xx' ||
    stage === 'douyin_video_download_empty_file' ||
    stage === 'douyin_video_download_invalid_file'
  ) {
    return error?.detail || error?.message || '视频下载失败';
  }

  if (stage === 'ffprobe_missing') {
    return error?.detail || error?.message || '服务器未安装 ffprobe，无法校验抖音视频文件。';
  }

  if (
    stage === 'douyin_audio_extract_failed' ||
    stage === 'douyin_audio_extract_timeout'
  ) {
    if (error?.message === '服务器未安装 ffmpeg，无法自动压缩大视频') {
      return '音频提取失败：服务器未安装 ffmpeg。';
    }
    return error?.detail || error?.message || '音频提取失败，请检查 ffmpeg 是否可用。';
  }

  if (
    stage === 'douyin_asr_request_failed' ||
    stage === 'douyin_asr_request_timeout' ||
    stage === 'douyin_asr_empty_result' ||
    stage === 'siliconflow_api_key_missing'
  ) {
    return error?.detail || error?.message || 'ASR 请求失败';
  }

  if (
    stage === 'douyin_transcript_total_timeout' ||
    stage === 'douyin_video_resolve_timeout'
  ) {
    return error?.detail || error?.message || '文案提取超时，请稍后重试。';
  }

  return error?.detail || error?.message || '文案提取失败';
}

function buildDouyinVideoDownloadFileName(videoId = '') {
  const safeVideoId = String(videoId || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '')
    .slice(0, 64);
  return `douyin_${safeVideoId || Date.now().toString(36)}.mp4`;
}

function sleep(ms) {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function shouldRetryDouyinResolveError(error) {
  const stage = String(error?.stage || '');
  const upstreamStatus = Number(error?.upstreamStatus || 0);
  const statusCode = Number(error?.statusCode || 0);

  if (stage === 'tikhub_400_invalid_share_url' || stage === 'tikhub_400_invalid_aweme_id' || stage === 'tikhub_402_payment_required') {
    return false;
  }

  if (upstreamStatus === 400 || upstreamStatus === 402) {
    return false;
  }

  if (upstreamStatus === 429 || upstreamStatus >= 500) {
    return true;
  }

  if (statusCode >= 500) {
    return true;
  }

  if (stage === 'unknown_upstream_error' || stage === 'short_link_expand_failed') {
    return true;
  }

  return false;
}

async function retryDouyinOperation({ label, requestId, operation, shouldRetry = shouldRetryDouyinResolveError }) {
  let lastError = null;

  for (let attempt = 0; attempt <= DOUYIN_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      return await operation(attempt + 1);
    } catch (error) {
      lastError = error;
      const canRetry = attempt < DOUYIN_RETRY_DELAYS_MS.length && shouldRetry(error);

      console.warn('[douyin resolve] retryable operation failed', {
        requestId,
        label,
        attempt: attempt + 1,
        canRetry,
        stage: error?.stage || '',
        statusCode: error?.statusCode || 0,
        upstreamStatus: error?.upstreamStatus || 0,
        message: error?.message || '',
        upstreamBodySummary: error?.upstreamBodySummary || ''
      });

      if (!canRetry) {
        throw error;
      }

      await sleep(DOUYIN_RETRY_DELAYS_MS[attempt]);
    }
  }

  throw lastError;
}

function mapTikHubFailure({ upstreamStatus, shareUrl, awemeId, bodyMeta }) {
  const mode = awemeId ? 'aweme_id' : 'share_url';
  const value = awemeId || shareUrl;
  const detailText = readValue(bodyMeta.message, bodyMeta.detail, bodyMeta.code);

  if (upstreamStatus === 402) {
    return {
      stage: 'tikhub_402_payment_required',
      statusCode: 402,
      message: '当前接口余额不足或需要付费权限，请检查 TikHub 账户状态。',
      detail: detailText || `TikHub ${mode} 请求需要付费权限`
    };
  }

  if (upstreamStatus === 400 && shareUrl) {
    return {
      stage: 'tikhub_400_invalid_share_url',
      statusCode: 400,
      message: 'TikHub 未能解析该 share_url，请确认分享内容对应的是有效抖音作品链接。',
      detail: detailText || `无效 share_url: ${value}`
    };
  }

  if (upstreamStatus === 400 && awemeId) {
    return {
      stage: 'tikhub_400_invalid_aweme_id',
      statusCode: 400,
      message: '已提取到作品 id，但 TikHub 仍返回失败，请确认该作品 id 是否有效。',
      detail: detailText || `无效 aweme_id: ${value}`
    };
  }

  return {
    stage: 'unknown_upstream_error',
    statusCode: upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502,
    message: awemeId
      ? '已提取到作品 id，但 TikHub 仍返回失败。'
      : 'TikHub 未能解析该 share_url。',
    detail: detailText || `TikHub 上游错误，状态码 ${upstreamStatus || 0}`
  };
}

async function callTikHubHighQualityPlayUrl({ shareUrl, awemeId, requestId, deadlineAt = 0 }) {
  const token = readValue(SERVER_CONFIG.tikhubApiToken);
  if (!token) {
    throw createDouyinResolveError({
      stage: 'unknown_upstream_error',
      statusCode: 500,
      message: '服务端未配置 TIKHUB_API_TOKEN'
    });
  }

  const searchParams = new URLSearchParams();
  if (shareUrl) searchParams.set('share_url', shareUrl);
  if (awemeId) searchParams.set('aweme_id', awemeId);

  const upstreamUrl = `${TIKHUB_API_BASE_URL}/api/v1/douyin/web/fetch_video_high_quality_play_url?${searchParams.toString()}`;
  const timeoutMs = deadlineAt > 0 ? getStageTimeoutContext({
    parentDeadlineAt: deadlineAt,
    stageStartedAt: Date.now(),
    stageTimeoutMs: Math.max(1, getRemainingTimeoutMs(deadlineAt)),
    timeoutStage: 'douyin_video_resolve_timeout',
    failedStage: 'video_resolved',
    timeoutMessage: '抖音视频解析失败',
    timeoutDetail: 'TikHub 高质量地址获取超时，请稍后重试。',
    targetPath: upstreamUrl,
    host: getHostnameFromUrl(upstreamUrl)
  }).timeoutMs : DOUYIN_VIDEO_RESOLVE_TIMEOUT_MS;
  let upstreamRes;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': DOUYIN_USER_AGENT
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw createDouyinResolveError({
      stage: error?.name === 'TimeoutError' || /aborted|timeout/i.test(String(error?.message || ''))
        ? 'douyin_video_resolve_timeout'
        : 'unknown_upstream_error',
      statusCode: error?.name === 'TimeoutError' || /aborted|timeout/i.test(String(error?.message || '')) ? 504 : 502,
      message: '抖音视频解析失败',
      detail: error?.name === 'TimeoutError' || /aborted|timeout/i.test(String(error?.message || ''))
        ? 'TikHub 高质量地址获取超时，请稍后重试。'
        : `TikHub 高质量地址请求失败：${error?.message || 'fetch failed'}`
    });
  }

  const responseText = await upstreamRes.text();
  let json = null;

  try {
    json = responseText ? JSON.parse(responseText) : null;
  } catch {}

  if (!upstreamRes.ok) {
    const bodyMeta = extractTikHubErrorMeta(json, responseText);
    const mapped = mapTikHubFailure({
      upstreamStatus: upstreamRes.status,
      shareUrl,
      awemeId,
      bodyMeta
    });

    console.error('[douyin resolve] TikHub upstream failed', {
      requestId,
      upstreamStatus: upstreamRes.status,
      shareUrl,
      awemeId,
      upstreamCode: bodyMeta.code,
      upstreamMessage: bodyMeta.message,
      upstreamDetail: bodyMeta.detail,
      upstreamBodySummary: bodyMeta.summary
    });
    throw createDouyinResolveError({
      stage: mapped.stage,
      statusCode: mapped.statusCode,
      upstreamStatus: upstreamRes.status,
      upstreamBodySummary: bodyMeta.summary,
      upstreamCode: bodyMeta.code,
      detail: mapped.detail,
      message: mapped.message
    });
  }

  const payload = json?.data && typeof json.data === 'object' ? json.data : json;
  const downloadUrl = stripDouyinWatermark(readValue(payload?.original_video_url));
  const videoId = readValue(payload?.video_id, payload?.aweme_id, awemeId);

  if (!downloadUrl) {
    console.error('[douyin resolve] TikHub response missing original_video_url', {
      requestId,
      shareUrl,
      awemeId,
      upstreamBodySummary: summarizeUpstreamBody(responseText)
    });
    throw createDouyinResolveError({
      stage: 'unknown_upstream_error',
      statusCode: 502,
      upstreamStatus: upstreamRes.status,
      upstreamBodySummary: summarizeUpstreamBody(responseText),
      message: 'TikHub 返回成功，但缺少 original_video_url'
    });
  }

  return {
    videoId,
    downloadUrl,
    downloadUrlCandidates: downloadUrl ? [{
      url: downloadUrl,
      source: 'tikhub.original_video_url',
      host: getHostnameFromUrl(downloadUrl),
      hasAudio: true
    }] : [],
    caption: extractDouyinCaptionFromPayload(payload),
    authorName: extractDouyinAuthorNameFromPayload(payload),
    videoData: payload?.video_data && typeof payload.video_data === 'object' ? payload.video_data : payload || null
  };
}

async function callTikHubDouyinVideoDetail({ path, shareUrl, awemeId, requestId, deadlineAt = 0 }) {
  const token = readValue(SERVER_CONFIG.tikhubApiToken);
  if (!token) {
    throw createDouyinResolveError({
      stage: 'unknown_upstream_error',
      statusCode: 500,
      message: '服务端未配置 TIKHUB_API_TOKEN'
    });
  }

  const searchParams = new URLSearchParams();
  if (shareUrl) searchParams.set('share_url', shareUrl);
  if (awemeId) searchParams.set('aweme_id', awemeId);

  const upstreamUrl = `${TIKHUB_API_BASE_URL}${path}?${searchParams.toString()}`;
  const timeoutMs = deadlineAt > 0 ? getStageTimeoutContext({
    parentDeadlineAt: deadlineAt,
    stageStartedAt: Date.now(),
    stageTimeoutMs: Math.max(1, getRemainingTimeoutMs(deadlineAt)),
    timeoutStage: 'douyin_video_resolve_timeout',
    failedStage: 'video_resolved',
    timeoutMessage: '抖音视频解析失败',
    timeoutDetail: 'TikHub 视频详情获取超时，请稍后重试。',
    targetPath: upstreamUrl,
    host: getHostnameFromUrl(upstreamUrl)
  }).timeoutMs : DOUYIN_VIDEO_RESOLVE_TIMEOUT_MS;
  let upstreamRes;
  try {
    upstreamRes = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Accept': 'application/json',
        'User-Agent': DOUYIN_USER_AGENT
      },
      signal: AbortSignal.timeout(timeoutMs)
    });
  } catch (error) {
    throw createDouyinResolveError({
      stage: error?.name === 'TimeoutError' || /aborted|timeout/i.test(String(error?.message || ''))
        ? 'douyin_video_resolve_timeout'
        : 'unknown_upstream_error',
      statusCode: error?.name === 'TimeoutError' || /aborted|timeout/i.test(String(error?.message || '')) ? 504 : 502,
      message: '抖音视频解析失败',
      detail: error?.name === 'TimeoutError' || /aborted|timeout/i.test(String(error?.message || ''))
        ? 'TikHub 视频详情获取超时，请稍后重试。'
        : `TikHub 视频详情请求失败：${error?.message || 'fetch failed'}`
    });
  }

  const responseText = await upstreamRes.text();
  let json = null;

  try {
    json = responseText ? JSON.parse(responseText) : null;
  } catch {}

  if (!upstreamRes.ok) {
    const bodyMeta = extractTikHubErrorMeta(json, responseText);
    const mapped = mapTikHubFailure({
      upstreamStatus: upstreamRes.status,
      shareUrl,
      awemeId,
      bodyMeta
    });

    console.error('[douyin resolve] TikHub video detail failed', {
      requestId,
      path,
      upstreamStatus: upstreamRes.status,
      shareUrl,
      awemeId,
      upstreamCode: bodyMeta.code,
      upstreamMessage: bodyMeta.message,
      upstreamDetail: bodyMeta.detail,
      upstreamBodySummary: bodyMeta.summary
    });

    throw createDouyinResolveError({
      stage: mapped.stage,
      statusCode: mapped.statusCode,
      upstreamStatus: upstreamRes.status,
      upstreamBodySummary: bodyMeta.summary,
      upstreamCode: bodyMeta.code,
      detail: mapped.detail,
      message: mapped.message
    });
  }

  const payload = json?.data && typeof json.data === 'object' ? json.data : json;
  const downloadUrlCandidates = collectDownloadUrlCandidates(payload);
  const selectedCandidate = pickBestDouyinDownloadCandidate(downloadUrlCandidates);
  const downloadUrl = selectedCandidate?.url || '';
  const videoId = extractDouyinVideoIdFromPayload(payload, awemeId);

  if (!downloadUrl) {
    console.error('[douyin resolve] TikHub video detail missing stable url', {
      requestId,
      path,
      shareUrl,
      awemeId,
      upstreamBodySummary: summarizeUpstreamBody(responseText)
    });
    throw createDouyinResolveError({
      stage: awemeId ? 'tikhub_video_data_missing_download_url_aweme_id' : 'tikhub_video_data_missing_download_url_share_url',
      statusCode: 502,
      upstreamStatus: upstreamRes.status,
      upstreamBodySummary: summarizeUpstreamBody(responseText),
      message: awemeId
        ? 'TikHub 返回成功，但未提供可用的标准视频下载链接。'
        : 'TikHub 已解析 share_url，但未返回可用的标准视频下载链接。'
    });
  }

  return {
    videoId,
    downloadUrl,
    downloadUrlCandidates,
    caption: extractDouyinCaptionFromPayload(payload),
    authorName: extractDouyinAuthorNameFromPayload(payload),
    duration: extractDouyinDurationFromPayload(payload),
    videoData: payload || null
  };
}

async function callTikHubVideoDetailByShareUrl({ shareUrl, requestId, deadlineAt = 0 }) {
  // Race web + app endpoints in parallel for fastest response
  const webPromise = callTikHubDouyinVideoDetail({
    path: '/api/v1/douyin/web/fetch_one_video_by_share_url',
    shareUrl,
    requestId,
    deadlineAt
  }).catch((err) => ({ __error: true, __source: 'web', message: err.message }));

  const appPromise = callTikHubDouyinVideoDetail({
    path: '/api/v1/douyin/app/v3/fetch_one_video_by_share_url',
    shareUrl,
    requestId,
    deadlineAt
  }).catch((err) => ({ __error: true, __source: 'app', message: err.message }));

  const [webResult, appResult] = await Promise.all([webPromise, appPromise]);

  const webOk = webResult && !webResult.__error;
  const appOk = appResult && !appResult.__error;

  if (webOk && appOk) {
    // Merge candidates from both endpoints, prefer web's metadata but keep all URLs
    const mergedCandidates = [
      ...(webResult.downloadUrlCandidates || []),
      ...(appResult.downloadUrlCandidates || [])
    ].filter((c) => c?.url);
    const seen = new Set();
    const uniqueCandidates = mergedCandidates.filter((c) => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    });
    // Prefer web payload for metadata, but use the merged candidate list
    return {
      videoId: webResult.videoId || appResult.videoId,
      downloadUrl: pickBestDouyinDownloadCandidate(uniqueCandidates)?.url || webResult.downloadUrl || appResult.downloadUrl,
      downloadUrlCandidates: uniqueCandidates,
      caption: webResult.caption || appResult.caption,
      authorName: webResult.authorName || appResult.authorName,
      duration: webResult.duration || appResult.duration || 0,
      videoData: webResult.videoData || appResult.videoData || null
    };
  }

  if (webOk) {
    return webResult;
  }
  if (appOk) {
    return appResult;
  }

  console.error('[douyin resolve] both web and app endpoints failed', {
    requestId,
    webError: webResult?.message,
    appError: appResult?.message
  });
  throw createDouyinResolveError({
    stage: 'tikhub_video_data_missing_download_url_share_url',
    statusCode: 502,
    message: 'TikHub 视频详情获取失败',
    detail: `web: ${webResult?.message || 'failed'}, app: ${appResult?.message || 'failed'}`
  });
}

async function callTikHubVideoDetailByAwemeId({ awemeId, requestId, deadlineAt = 0 }) {
  // Race web + app endpoints in parallel for fastest response
  const webPromise = callTikHubDouyinVideoDetail({
    path: '/api/v1/douyin/web/fetch_one_video',
    awemeId,
    requestId,
    deadlineAt
  }).catch((err) => ({ __error: true, __source: 'web', message: err.message }));

  const appPromise = callTikHubDouyinVideoDetail({
    path: '/api/v1/douyin/app/v3/fetch_one_video',
    awemeId,
    requestId,
    deadlineAt
  }).catch((err) => ({ __error: true, __source: 'app', message: err.message }));

  const [webResult, appResult] = await Promise.all([webPromise, appPromise]);

  const webOk = webResult && !webResult.__error;
  const appOk = appResult && !appResult.__error;

  if (webOk && appOk) {
    const mergedCandidates = [
      ...(webResult.downloadUrlCandidates || []),
      ...(appResult.downloadUrlCandidates || [])
    ].filter((c) => c?.url);
    const seen = new Set();
    const uniqueCandidates = mergedCandidates.filter((c) => {
      if (seen.has(c.url)) return false;
      seen.add(c.url);
      return true;
    });
    return {
      videoId: webResult.videoId || appResult.videoId,
      downloadUrl: pickBestDouyinDownloadCandidate(uniqueCandidates)?.url || webResult.downloadUrl || appResult.downloadUrl,
      downloadUrlCandidates: uniqueCandidates,
      caption: webResult.caption || appResult.caption,
      authorName: webResult.authorName || appResult.authorName,
      duration: webResult.duration || appResult.duration || 0,
      videoData: webResult.videoData || appResult.videoData || null
    };
  }

  if (webOk) {
    return webResult;
  }
  if (appOk) {
    return appResult;
  }

  console.error('[douyin resolve] both web and app endpoints failed (awemeId)', {
    requestId,
    awemeId,
    webError: webResult?.message,
    appError: appResult?.message
  });
  throw createDouyinResolveError({
    stage: 'tikhub_video_data_missing_download_url_aweme_id',
    statusCode: 502,
    message: 'TikHub 视频详情获取失败',
    detail: `web: ${webResult?.message || 'failed'}, app: ${appResult?.message || 'failed'}`
  });
}

/* ------------------------------------------------------------------ */
/*  Universal Multi-Platform Extract (ported from CopyPilot)          */
/* ------------------------------------------------------------------ */

const UNIVERSAL_ENDPOINTS = [
  { path: '/api/v1/douyin/web/fetch_one_video_by_share_url', param: 'share_url' },
  { path: '/api/v1/douyin/app/v3/fetch_one_video_by_share_url', param: 'share_url' },
  { path: '/api/v1/tiktok/app/v3/fetch_one_video_by_share_url', param: 'share_url' },
  { path: '/api/v1/kuaishou/app/fetch_one_video_by_url', param: 'share_text' },
  { path: '/api/v1/kuaishou/web/fetch_one_video_by_url', param: 'url' },
  { path: '/api/v1/bilibili/web/fetch_one_video_v3', param: 'url' },
  { path: '/api/v1/instagram/v1/fetch_post_by_url_v2', param: 'post_url' },
  { path: '/api/v1/instagram/v1/fetch_post_by_url', param: 'post_url' },
  { path: '/api/v1/wechat_mp/web/fetch_mp_article_detail_json', param: 'url' }
];

const XIAOHONGSHU_ENDPOINTS = [
  { path: '/api/v1/xiaohongshu/web/get_note_info_v7', param: 'share_text' },
  { path: '/api/v1/xiaohongshu/web/get_note_info_v5', param: 'share_text' },
  { path: '/api/v1/xiaohongshu/web/get_note_info_v4', param: 'share_text' },
  { path: '/api/v1/xiaohongshu/app_v2/get_image_note_detail', param: 'share_text' },
  { path: '/api/v1/xiaohongshu/app_v2/get_video_note_detail', param: 'share_text' },
  { path: '/api/v1/xiaohongshu/web_v2/fetch_feed_notes_v5', param: 'short_url' },
  { path: '/api/v1/xiaohongshu/web_v2/fetch_feed_notes_v4', param: 'short_url' },
  { path: '/api/v1/xiaohongshu/web_v2/fetch_feed_notes_v3', param: 'short_url' }
];

function isXiaohongshuUrl(url) {
  const lower = String(url || '').toLowerCase();
  return lower.includes('xiaohongshu') || lower.includes('xhslink');
}

function parseXiaohongshuUrl(url) {
  const parsed = { noteId: '', xsecToken: '' };
  const text = String(url || '');
  const noteMatch = text.match(/\/(?:discovery\/item|explore)\/([0-9a-f]{20,32})/i);
  if (noteMatch) parsed.noteId = noteMatch[1];
  try {
    const target = new URL(text);
    parsed.xsecToken = target.searchParams.get('xsec_token') || '';
  } catch {
    const tokenMatch = text.match(/[?&]xsec_token=([^&#\s]+)/i);
    if (tokenMatch) parsed.xsecToken = decodeURIComponent(tokenMatch[1]);
  }
  return parsed;
}

function extractYoutubeId(url) {
  try {
    const target = new URL(url);
    if (target.hostname.includes('youtu.be')) return target.pathname.split('/').filter(Boolean)[0] || '';
    return target.searchParams.get('v') || target.pathname.match(/\/shorts\/([^/?#]+)/)?.[1] || '';
  } catch {
    return '';
  }
}

function extractBilibiliBvId(url) {
  return String(url || '').match(/BV[a-zA-Z0-9]+/)?.[0] || '';
}

function extractLastNumericId(url) {
  return String(url || '').match(/(\d{6,})(?!.*\d)/)?.[1] || '';
}

function extractLastPathId(url) {
  try {
    const target = new URL(url);
    return target.pathname.split('/').filter(Boolean).pop() || extractLastNumericId(url);
  } catch {
    return extractLastNumericId(url);
  }
}

function extractThreadsId(url) {
  try {
    const target = new URL(url);
    const parts = target.pathname.split('/').filter(Boolean);
    return parts[parts.length - 1] || '';
  } catch {
    return '';
  }
}

function extractRedditPostId(url) {
  try {
    const target = new URL(url);
    const parts = target.pathname.split('/').filter(Boolean);
    const commentsIndex = parts.indexOf('comments');
    if (commentsIndex >= 0) return parts[commentsIndex + 1] || '';
    return parts[parts.length - 1] || '';
  } catch {
    return '';
  }
}

function rankUniversalEndpoints(url) {
  const lower = url.toLowerCase();
  const platformRoutes = [
    {
      test: /tiktok\.com|vm\.tiktok\.com/i,
      endpoints: [
        { path: '/api/v1/tiktok/app/v3/fetch_one_video_by_share_url_v2', param: 'share_url' },
        { path: '/api/v1/tiktok/app/v3/fetch_one_video_by_share_url', param: 'share_url' }
      ]
    },
    {
      test: /douyin\.com|iesdouyin\.com/i,
      endpoints: UNIVERSAL_ENDPOINTS.slice(0, 2)
    },
    {
      test: /kuaishou\.com|gifshow\.com|v\.kuaishou\.com/i,
      endpoints: [
        { path: '/api/v1/kuaishou/web/fetch_one_video_by_url', param: 'url' },
        { path: '/api/v1/kuaishou/app/fetch_one_video_by_url', param: 'share_text' }
      ]
    },
    {
      test: /bilibili\.com|b23\.tv/i,
      endpoints: [
        { path: '/api/v1/bilibili/web/fetch_one_video_v3', param: 'url' },
        { path: '/api/v1/bilibili/web/fetch_one_video', param: 'bv_id', derive: extractBilibiliBvId }
      ]
    },
    {
      test: /instagram\.com/i,
      endpoints: UNIVERSAL_ENDPOINTS.slice(6, 8)
    },
    {
      test: /mp\.weixin\.qq\.com|weixin\.qq\.com/i,
      endpoints: [UNIVERSAL_ENDPOINTS[8]]
    },
    {
      test: /youtube\.com|youtu\.be/i,
      endpoints: [{ path: '/api/v1/youtube/web/get_video_info', param: 'video_id', derive: extractYoutubeId }]
    },
    {
      test: /twitter\.com|x\.com/i,
      endpoints: [{ path: '/api/v1/twitter/web/fetch_tweet_detail', param: 'tweet_id', derive: extractLastNumericId }]
    },
    {
      test: /threads\.net/i,
      endpoints: [{ path: '/api/v1/threads/web/fetch_post_detail', param: 'post_id', derive: extractThreadsId }]
    },
    {
      test: /reddit\.com/i,
      endpoints: [{ path: '/api/v1/reddit/app/fetch_post_details', param: 'post_id', derive: extractRedditPostId, extra: { need_format: 'true' } }]
    },
    {
      test: /weibo\.com/i,
      endpoints: [
        { path: '/api/v1/weibo/web_v2/fetch_post_detail', param: 'id', derive: extractLastPathId, extra: { is_get_long_text: 'true' } },
        { path: '/api/v1/weibo/app/fetch_status_detail', param: 'status_id', derive: extractLastPathId }
      ]
    },
    {
      test: /lemon8-app\.com|lemon8\.com/i,
      endpoints: [{ path: '/api/v1/lemon8/app/fetch_post_detail', param: 'item_id', derive: extractLastNumericId }]
    },
    {
      test: /pipix\.com|pipixia\.com/i,
      endpoints: [{ path: '/api/v1/pipixia/app/fetch_post_detail', param: 'cell_id', derive: extractLastNumericId }]
    },
    {
      test: /zhihu\.com/i,
      endpoints: [{ path: '/api/v1/zhihu/web/fetch_column_article_detail', param: 'article_id', derive: extractLastNumericId }]
    }
  ];

  const route = platformRoutes.find((item) => item.test.test(lower));
  if (route) return route.endpoints;
  return UNIVERSAL_ENDPOINTS;
}

function getUniversalEndpointParams(endpoint, url) {
  const normalizedInput = normalizeDouyinInput(url);
  const primaryUrl = extractUrlsFromText(normalizedInput)[0] || normalizedInput;
  const value = endpoint.derive
    ? endpoint.derive(primaryUrl)
    : endpoint.param === 'share_text' && !endpoint.path.includes('/kuaishou/')
      ? normalizedInput
      : primaryUrl;
  if (!value) return null;
  return { [endpoint.param]: value, ...(endpoint.extra || {}) };
}

function isEmptyUniversalPayload(value) {
  if (value === undefined || value === null) return true;
  if (Array.isArray(value)) return value.length === 0;
  if (typeof value === 'object') return Object.keys(value).length === 0;
  return false;
}

async function requestTikhubUniversal({ apiKey, baseUrl, endpoint, params, logPrefix = '' }) {
  const target = new URL(`${baseUrl}${endpoint.path}`);
  for (const [key, value] of Object.entries(params || {})) {
    if (value !== undefined && value !== null && value !== '') target.searchParams.set(key, value);
  }

  console.log(`${logPrefix} trying endpoint: ${endpoint.path}, params:`, JSON.stringify(params).slice(0, 200));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 20000);

  let response;
  try {
    response = await fetch(target.toString(), {
      method: 'GET',
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: controller.signal
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      console.log(`${logPrefix} timeout: ${endpoint.path}`);
      throw new Error('TikHub 接口响应超时，请稍后重试。');
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const text = await response.text();
  let payload;
  try { payload = JSON.parse(text); } catch { payload = { raw: text }; }

  console.log(`${logPrefix} endpoint ${endpoint.path} response status: ${response.status}, hasData: ${!!(payload?.data)}, code: ${payload?.code}, status_code: ${payload?.status_code}`);

  if (response.ok && isTikhubSuccessPayload(payload)) {
    const data = payload.data !== undefined ? payload.data : payload;
    if (!isEmptyUniversalPayload(data)) {
      return data;
    }
    throw new Error('TikHub 返回了空数据，继续尝试其他解析接口。');
  }

  throw new Error(readTikhubErrorMessage(payload, response.status, endpoint.path));
}

function isTikhubSuccessPayload(payload) {
  if (!payload || typeof payload !== 'object') return false;
  // Direct data presence
  if (payload.data !== undefined && payload.data !== null) return true;
  // Various success code formats used by TikHub
  const code = payload.code;
  if (code === 200 || code === 0 || code === 20000 || code === '200' || code === '0') return true;
  const statusCode = payload.status_code;
  if (statusCode === 200 || statusCode === 0 || statusCode === 20000) return true;
  if (payload.status === 'success' || payload.status === 'ok') return true;
  // Some endpoints return data directly without wrapper
  if (payload.aweme_detail || payload.itemInfo || payload.note || payload.video || payload.title || payload.desc) return true;
  return false;
}

function readTikhubErrorMessage(payload, status, path) {
  const message = payload?.message_zh || payload?.message || payload?.msg || payload?.detail || payload?.error?.message || payload?.raw || '';
  if (typeof message === 'string' && message.trim()) return message.trim();
  if (status === 400 && path.includes('/xiaohongshu/')) {
    return 'TikHub 返回 400：小红书链接参数不完整、作品不可访问，或该接口不支持这类笔记。';
  }
  return `TikHub 请求失败（HTTP ${status}）`;
}

function firstReadableError(errors) {
  return errors.find((item) => item && !/^\d+$/.test(item));
}

function findFirstValue(input, keys) {
  const queue = [input];
  const seen = new Set();
  while (queue.length) {
    const item = queue.shift();
    if (!item || typeof item !== 'object' || seen.has(item)) continue;
    seen.add(item);
    for (const key of keys) {
      if (typeof item[key] === 'string' && item[key]) return item[key];
    }
    for (const value of Object.values(item)) {
      if (value && typeof value === 'object') queue.push(value);
    }
  }
  return '';
}

function normalizeUniversalUrlList(value) {
  const urls = [];
  const add = (item) => {
    const url = extractFirstUrl(item);
    if (url) urls.push(url);
  };

  if (Array.isArray(value)) {
    for (const item of value) add(item);
  } else {
    add(value);
  }

  return urls;
}

function looksLikeUniversalVideoUrl(url) {
  const text = String(url || '').trim();
  if (!/^https?:\/\//i.test(text)) return false;
  const lower = text.toLowerCase();
  return (
    /\.(mp4|webm|mov|m3u8|mpd)(?:[?#]|$)/.test(lower) ||
    /video\/tos|douyinvod|googlevideo\.com\/videoplayback|mime=video/.test(lower) ||
    /kwaicdn|yximgs|ndcimgs|ksapis|ksosvideo/.test(lower) ||
    /tiktokcdn|tiktokv|hdslb/.test(lower)
  );
}

function scoreUniversalVideoCandidate(candidate, platform = '') {
  const url = String(candidate?.url || '');
  const source = String(candidate?.source || '');
  const host = String(candidate?.host || '');
  const lower = url.toLowerCase();
  let score = 0;

  if (platform === 'douyin') score += scoreDouyinDownloadCandidate(candidate);
  if (platform === 'kuaishou') {
    if (/kwaicdn|yximgs|ndcimgs/.test(host)) score += 90;
    if (/backup/i.test(source)) score += 15;
    if (/mainMvUrls/i.test(source)) score += 35;
    if (/manifest/i.test(source)) score += 45;
  }

  if (/\.(mp4|webm|mov)(?:[?#]|$)/.test(lower)) score += 60;
  if (/m3u8|mpd/.test(lower)) score += 20;
  if (candidate?.hasAudio === true) score += 180;
  if (candidate?.hasAudio === false) score -= 500;
  if (/watermark=1|playwm|logo_name=/i.test(url)) score -= 80;
  if (/avatar|cover|image|pic|jpg|jpeg|png|webp/i.test(lower)) score -= 120;

  return score;
}

function collectKuaishouVideoCandidates(data) {
  const photo = data?.photo || data?.data?.photo || data || {};
  const candidates = [];

  const add = (rawUrl, source, meta = {}) => {
    const url = String(rawUrl || '').trim();
    if (!looksLikeUniversalVideoUrl(url)) return;
    candidates.push({
      url,
      source,
      host: getHostnameFromUrl(url),
      ...(typeof meta.hasAudio === 'boolean' ? { hasAudio: meta.hasAudio } : {})
    });
  };

  for (const url of normalizeUniversalUrlList(photo.mainMvUrls)) add(url, 'kuaishou.photo.mainMvUrls', { hasAudio: true });
  for (const adaptationSet of photo.manifest?.adaptationSet || []) {
    for (const representation of adaptationSet?.representation || []) {
      const hasAudio = readCandidateHasAudio(representation);
      add(representation?.url, 'kuaishou.photo.manifest.representation.url', {
        hasAudio: typeof hasAudio === 'boolean' ? hasAudio : undefined
      });
      for (const backupUrl of representation?.backupUrl || []) {
        add(backupUrl, 'kuaishou.photo.manifest.representation.backupUrl', {
          hasAudio: typeof hasAudio === 'boolean' ? hasAudio : undefined
        });
      }
    }
  }

  return candidates;
}

function collectUniversalVideoCandidates(data, platform = '') {
  const candidates = [];
  const seen = new Set();

  const add = (rawUrl, source, meta = {}) => {
    const normalizedUrl = platform === 'douyin'
      ? stripDouyinWatermark(String(rawUrl || '').trim())
      : String(rawUrl || '').trim();
    if (!looksLikeUniversalVideoUrl(normalizedUrl) || seen.has(normalizedUrl)) return;
    seen.add(normalizedUrl);
    candidates.push({
      url: normalizedUrl,
      source,
      host: getHostnameFromUrl(normalizedUrl),
      ...(typeof meta.hasAudio === 'boolean' ? { hasAudio: meta.hasAudio } : {})
    });
  };

  if (platform === 'douyin') {
    for (const candidate of collectDownloadUrlCandidates(data)) {
      add(candidate.url, candidate.source, { hasAudio: candidate.hasAudio });
    }
  }

  if (platform === 'kuaishou') {
    for (const candidate of collectKuaishouVideoCandidates(data)) {
      add(candidate.url, candidate.source, { hasAudio: candidate.hasAudio });
    }
  }

  const videosItems = Array.isArray(data?.videos?.items) ? data.videos.items : [];
  for (const item of [...videosItems].sort((a, b) => Number(b?.hasAudio === true) - Number(a?.hasAudio === true))) {
    const hasAudio = readCandidateHasAudio(item);
    add(item?.url, 'videos.items.url', {
      hasAudio: typeof hasAudio === 'boolean' ? hasAudio : undefined
    });
  }

  const queue = [data];
  const visited = new Set();
  while (queue.length) {
    const item = queue.shift();
    if (!item || visited.has(item)) continue;
    if (typeof item === 'string') {
      add(item, 'deep_search');
      continue;
    }
    if (typeof item !== 'object') continue;
    visited.add(item);
    for (const value of Object.values(item)) queue.push(value);
  }

  return candidates
    .map((candidate) => ({
      ...candidate,
      score: scoreUniversalVideoCandidate(candidate, platform)
    }))
    .sort((left, right) => right.score - left.score)
    .filter((candidate) => candidate.score > -80)
    .slice(0, 12)
    .map(({ score, ...candidate }) => candidate);
}

function looksLikeUniversalImageUrl(url) {
  const text = String(url || '').trim();
  if (!/^https?:\/\//i.test(text)) return false;
  const lower = text.toLowerCase();
  return (
    /\.(jpg|jpeg|png|webp|gif|bmp)(?:[?#]|$)/.test(lower) ||
    /douyinpic|yximgs|xhscdn|fbcdn|image|img|cover/.test(lower)
  );
}

function collectUniversalImages(data, platform = '') {
  const urls = [];
  const seen = new Set();

  const add = (rawUrl) => {
    const url = extractFirstUrl(rawUrl);
    if (!looksLikeUniversalImageUrl(url) || seen.has(url)) return;
    seen.add(url);
    urls.push(url);
  };

  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data?.note || data?.photo || data || {};
  for (const value of [
    detail.cover?.url_list,
    detail.origin_cover?.url_list,
    detail.dynamic_cover?.url_list,
    detail.coverUrls,
    detail.webpCoverUrls,
    detail.headUrls,
    detail.images,
    detail.image_list,
    detail.noteCard?.imageList,
    data?.images
  ]) {
    for (const url of normalizeUniversalUrlList(value)) add(url);
  }

  const queue = [detail];
  const visited = new Set();
  while (queue.length && urls.length < 30) {
    const item = queue.shift();
    if (!item || visited.has(item)) continue;
    if (typeof item === 'string') {
      add(item);
      continue;
    }
    if (typeof item !== 'object') continue;
    visited.add(item);
    for (const value of Object.values(item)) queue.push(value);
  }

  return urls.slice(0, 20);
}

function collectUniversalTags(data) {
  const tags = [];
  const add = (value) => {
    if (typeof value !== 'string' && typeof value !== 'number') return;
    const tag = String(value || '').replace(/^#/, '').replace(/\[话题\]$/g, '').trim();
    if (tag && tag !== '[object Object]') tags.push(tag);
  };
  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data?.note || data?.photo || data || {};

  for (const item of [
    ...(detail.video_tag || []),
    ...(detail.text_extra || []),
    ...(detail.tagList || []),
    ...(detail.tags || []),
    ...(data?.tags || [])
  ]) {
    add(item?.tag_name || item?.hashtag_name || item?.name || item?.title || item);
  }

  const text = readValue(detail.desc, detail.caption, detail.title, data?.desc, data?.caption, data?.title);
  for (const match of text.match(/#[^\s#，,。；;！!？?]+/g) || []) add(match);

  return [...new Set(tags)].slice(0, 20);
}

function detectUniversalPlatform(data, sourceUrl = '', endpointPath = '') {
  const text = `${sourceUrl} ${endpointPath}`.toLowerCase();
  if (data?.aweme_detail || /douyin|iesdouyin/.test(text)) return 'douyin';
  if (data?.photo || /kuaishou|gifshow|v\.kuaishou/.test(text)) return 'kuaishou';
  if (data?.note || data?.noteCard || /xiaohongshu|xhslink/.test(text)) return 'xiaohongshu';
  if (data?.itemInfo?.itemStruct || /tiktok/.test(text)) return 'tiktok';
  if (data?.bvid || /bilibili|b23\.tv/.test(text)) return 'bilibili';
  if (/youtube|youtu\.be/.test(text)) return 'youtube';
  if (/instagram/.test(text)) return 'instagram';
  if (/weibo/.test(text)) return 'weibo';
  if (/zhihu/.test(text)) return 'zhihu';
  if (/wechat|weixin|mp\.weixin/.test(text)) return 'wechat';
  return '';
}

function normalizeUniversalDurationSeconds(rawValue, platform = '') {
  const value = Number.parseFloat(String(rawValue || '0'));
  if (!Number.isFinite(value) || value <= 0) return 0;

  const p = String(platform || '').toLowerCase();
  const millisecondPlatforms = new Set([
    'douyin',
    'kuaishou',
    'tiktok',
    'xiaohongshu',
    'weibo',
    'instagram'
  ]);

  if (millisecondPlatforms.has(p) && value > 1000) {
    return Math.round(value / 1000);
  }

  if (value > 24 * 60 * 60 && p !== 'youtube' && p !== 'bilibili') {
    return Math.round(value / 1000);
  }

  return Math.round(value);
}

function normalizeUniversalExtractResult(data, { sourceUrl = '', endpointPath = '' } = {}) {
  const platform = detectUniversalPlatform(data, sourceUrl, endpointPath);
  const detail = data?.aweme_detail || data?.itemInfo?.itemStruct || data?.note || data?.noteCard || data?.article || data?.mp_article || data?.photo || data || {};
  const videoUrlCandidates = collectUniversalVideoCandidates(data, platform);
  const title = readValue(
    data?.title,
    detail?.title,
    detail?.msg_title,
    detail?.appmsg_title,
    detail?.article_title,
    detail?.desc,
    detail?.caption,
    detail?.share_info?.share_title
  );
  const desc = readValue(
    detail?.desc,
    detail?.caption,
    detail?.text,
    detail?.description,
    detail?.content,
    data?.desc,
    data?.caption,
    data?.text
  );
  const authorName = readValue(
    detail?.author?.nickname,
    detail?.author?.name,
    detail?.user?.nickname,
    detail?.user?.name,
    detail?.userName,
    data?.author?.nickname,
    data?.user?.name
  );

  return {
    platform,
    title,
    desc,
    authorName,
    duration: normalizeUniversalDurationSeconds(detail?.duration || detail?.video?.duration || data?.duration || 0, platform),
    videoUrls: videoUrlCandidates.map((candidate) => candidate.url),
    videoUrlCandidates,
    images: [],
    tags: collectUniversalTags(data),
    sourceUrl: extractUrlsFromText(sourceUrl)[0] || sourceUrl,
    sourceEndpoint: endpointPath,
    raw: data
  };
}

async function extractXiaohongshuUniversal({ apiKey, baseUrl, url }) {
  const errors = [];
  const parsed = parseXiaohongshuUrl(url);
  const isShortLink = /xhslink\.com/i.test(url);

  if (isShortLink) {
    const shortLinkEndpoints = XIAOHONGSHU_ENDPOINTS.filter((ep) => ep.path.includes('/web_v2/fetch_feed_notes'));
    for (const endpoint of shortLinkEndpoints) {
      try {
        return await requestTikhubUniversal({ apiKey, baseUrl, endpoint, params: { [endpoint.param]: url } });
      } catch (error) { errors.push(error.message); }
    }
  }

  if (parsed.noteId && parsed.xsecToken) {
    try {
      return await requestTikhubUniversal({
        apiKey, baseUrl,
        endpoint: { path: '/api/v1/xiaohongshu/web_v3/fetch_note_detail' },
        params: { note_id: parsed.noteId, xsec_token: parsed.xsecToken }
      });
    } catch (error) { errors.push(error.message); }
  }

  try {
    const shareInfo = await requestTikhubUniversal({
      apiKey, baseUrl,
      endpoint: { path: '/api/v1/xiaohongshu/web/get_note_id_and_xsec_token' },
      params: { share_text: url }
    });
    const noteId = findFirstValue(shareInfo, ['note_id', 'noteId', 'id']) || parsed.noteId;
    const xsecToken = findFirstValue(shareInfo, ['xsec_token', 'xsecToken']) || parsed.xsecToken;
    if (noteId && xsecToken) {
      return await requestTikhubUniversal({
        apiKey, baseUrl,
        endpoint: { path: '/api/v1/xiaohongshu/web_v3/fetch_note_detail' },
        params: { note_id: noteId, xsec_token: xsecToken }
      });
    }
  } catch (error) { errors.push(error.message); }

  if (parsed.noteId && !parsed.xsecToken) {
    throw new Error('小红书电脑版分享链接缺少 xsec_token，TikHub 目前无法稳定解析这类图文笔记。请用手机小红书 App 点"分享-复制链接"，再粘贴完整链接重试。');
  }

  for (const endpoint of XIAOHONGSHU_ENDPOINTS) {
    try {
      return await requestTikhubUniversal({ apiKey, baseUrl, endpoint, params: { [endpoint.param]: url } });
    } catch (error) { errors.push(error.message); }
  }

  throw new Error(firstReadableError(errors) || '小红书图文解析失败，请确认作品公开且链接未过期。');
}

async function extractByUrlUniversal({ apiKey, baseUrl, url }) {
  console.log('[universal-extract] url:', url.slice(0, 120));

  if (isXiaohongshuUrl(url)) {
    return extractXiaohongshuUniversal({ apiKey, baseUrl, url });
  }

  const endpoints = rankUniversalEndpoints(url);
  console.log('[universal-extract] matched endpoints:', endpoints.map(e => e.path));

  const errors = [];

  for (const endpoint of endpoints) {
    try {
      const params = getUniversalEndpointParams(endpoint, url);
      if (!params) {
        console.log('[universal-extract] skip endpoint (no params):', endpoint.path);
        continue;
      }
      const result = await requestTikhubUniversal({ apiKey, baseUrl, endpoint, params, logPrefix: '[universal-extract]' });
      console.log('[universal-extract] success via:', endpoint.path);
      return normalizeUniversalExtractResult(result, { sourceUrl: url, endpointPath: endpoint.path });
    } catch (error) {
      console.log('[universal-extract] failed:', endpoint.path, '-', error.message);
      errors.push(`${endpoint.path}: ${error.message}`);
    }
  }

  console.error('[universal-extract] all endpoints failed:', errors);
  throw new Error(firstReadableError(errors) || '解析失败，请确认链接有效且作品公开。');
}

function getUniversalTitle(data) {
  return data?.title || data?.desc || data?.aweme_detail?.desc || data?.itemInfo?.itemStruct?.desc || data?.note?.title || data?.caption || data?.text || null;
}

async function handleUniversalExtract(req, res) {
  try {
    const body = await readRequestBody(req);
    const url = String(body.url || '').trim();

    if (!url) {
      sendJson(res, 400, { ok: false, message: '缺少作品链接。' });
      return;
    }

    const apiKey = readValue(SERVER_CONFIG.tikhubApiToken);
    if (!apiKey) {
      sendJson(res, 500, { ok: false, message: '服务端未配置 TikHub API Token。' });
      return;
    }

    const data = await extractByUrlUniversal({ apiKey, baseUrl: TIKHUB_API_BASE_URL, url });
    const title = getUniversalTitle(data);

    sendJson(res, 200, { ok: true, data, title });
  } catch (error) {
    console.error('[universal-extract] error:', error.message);
    sendJson(res, 502, { ok: false, message: error.message || '解析失败' });
  }
}

function resolveProxyReferer(targetUrl) {
  try {
    const lower = targetUrl.toLowerCase();
    if (lower.includes('douyin') || lower.includes('zjcdn') || lower.includes('bytegecko') || lower.includes('douyinvod') || lower.includes('pstatp') || lower.includes('snssdk') || lower.includes('ixigua') || lower.includes('bytedance') || lower.includes('iesdouyin')) {
      return 'https://www.douyin.com/';
    }
    if (lower.includes('tiktok') || lower.includes('tiktokv') || lower.includes('tiktokcdn') || lower.includes('musical')) {
      return 'https://www.tiktok.com/';
    }
    if (lower.includes('kuaishou') || lower.includes('yximgs') || lower.includes('ksapis') || lower.includes('ksosvideo')) {
      return 'https://www.kuaishou.com/';
    }
    if (lower.includes('bilibili') || lower.includes('hdslb') || lower.includes('b23.tv')) {
      return 'https://www.bilibili.com/';
    }
    if (lower.includes('xiaohongshu') || lower.includes('xhscdn') || lower.includes('xhslink')) {
      return 'https://www.xiaohongshu.com/';
    }
    if (lower.includes('instagram') || lower.includes('fbcdn')) {
      return 'https://www.instagram.com/';
    }
    if (lower.includes('youtube') || lower.includes('youtu.be') || lower.includes('googlevideo')) {
      return 'https://www.youtube.com/';
    }
    return new URL(targetUrl).origin + '/';
  } catch {
    return 'https://www.douyin.com/';
  }
}

function looksLikeVideoUrlForProxy(url) {
  const u = String(url || '').toLowerCase();
  return /\.(mp4|webm|mov|m3u8|mpd)(?:[?#]|$)/.test(u) || /video\/tos|douyinvod|googlevideo\.com\/videoplayback|mime=video/.test(u);
}

async function extractVideoUrlFromJsonOrHtml({ bodyText, contentType, originalUrl, referer }) {
  // Try JSON
  if (contentType.includes('json') || bodyText.trim().startsWith('{')) {
    try {
      const json = JSON.parse(bodyText);
      const queue = [json];
      const seen = new Set();
      const urls = [];
      while (queue.length) {
        const item = queue.shift();
        if (!item || seen.has(item)) continue;
        if (typeof item === 'string') {
          if (looksLikeVideoUrlForProxy(item)) urls.push(item);
          continue;
        }
        if (typeof item !== 'object') continue;
        seen.add(item);
        const directUrl = item.url || item.play_url || item.download_url || item.video_url || item.src;
        if (directUrl && looksLikeVideoUrlForProxy(directUrl)) urls.push(directUrl);
        for (const v of Object.values(item)) queue.push(v);
      }
      if (urls.length) return urls[0];
    } catch {}
  }

  // Try HTML
  if (contentType.includes('html')) {
    const matches = bodyText.match(/https?:\/\/[^\s"'<>]+\.(?:mp4|webm|mov)(?:\?[^\s"'<>]*)?/gi);
    if (matches && matches.length) return matches[0];
  }

  return null;
}

async function proxyVideoStream({ targetUrl, req, res, depth = 0, asAttachment = false, fileName = '' }) {
  if (depth > 2) {
    sendJson(res, 502, { error: '无法解析视频下载地址，链接可能已过期或需要登录。' });
    return;
  }

  const rangeHeader = req.headers['range'];
  const referer = resolveProxyReferer(targetUrl);

  console.log(`[proxy-download] depth=${depth} target:`, targetUrl.slice(0, 120));

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 60_000);

  let response;
  try {
    response = await fetch(targetUrl, {
      method: 'GET',
      signal: controller.signal,
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
        'Accept': '*/*',
        'Accept-Language': 'zh-CN,zh;q=0.9,en;q=0.8',
        'Referer': referer,
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      },
    });
  } catch (error) {
    clearTimeout(timeout);
    if (error.name === 'AbortError') {
      sendJson(res, 504, { error: '下载超时，请稍后重试。' });
      return;
    }
    throw error;
  } finally {
    clearTimeout(timeout);
  }

  const contentType = response.headers.get('content-type') || '';
  console.log('[proxy-download] upstream status:', response.status, 'content-type:', contentType);

  if (!response.ok && response.status !== 206) {
    const body = await response.text().catch(() => '');
    console.error('[proxy-download] upstream error body:', body.slice(0, 500));
    sendJson(res, 502, { error: `源站返回 HTTP ${response.status}` });
    return;
  }

  // If it's a real video stream, proxy it directly
  if (contentType.includes('video/') || contentType.includes('audio/') || contentType.includes('application/octet-stream')) {
    const contentLength = response.headers.get('content-length');
    const acceptRanges = response.headers.get('accept-ranges');
    const contentRange = response.headers.get('content-range');
    const headers = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
    };
    if (contentLength) headers['Content-Length'] = contentLength;
    headers['Accept-Ranges'] = acceptRanges || 'bytes';
    if (contentRange) headers['Content-Range'] = contentRange;

    let filename = fileName || 'video.mp4';
    try {
      if (!fileName) {
        const pathname = new URL(targetUrl).pathname;
        const match = pathname.match(/\/([^\/]+\.[a-zA-Z0-9]{2,4})(?:[?#]|$)/);
        if (match) filename = match[1];
      }
    } catch {}
    const dispositionType = asAttachment ? 'attachment' : 'inline';
    headers['Content-Disposition'] = `${dispositionType}; filename="${filename}"`;

    res.writeHead(response.status, headers);
    if (response.body) {
      await pipeline(Readable.fromWeb(response.body), res);
    } else {
      res.end();
    }
    return;
  }

  // If it's JSON or HTML, try to extract the real video URL
  const bodyText = await response.text().catch(() => '');
  const extractedUrl = await extractVideoUrlFromJsonOrHtml({ bodyText, contentType, originalUrl: targetUrl, referer });

  if (extractedUrl) {
    console.log('[proxy-download] extracted real video url:', extractedUrl.slice(0, 120));
    return proxyVideoStream({ targetUrl: extractedUrl, req, res, depth: depth + 1, asAttachment, fileName });
  }

  console.error('[proxy-download] cannot extract video url from content-type:', contentType, 'body:', bodyText.slice(0, 500));
  sendJson(res, 502, { error: '无法从返回内容中提取视频地址，链接可能已过期。' });
}

async function handleProxyDownload(req, res, urlObj) {
  try {
    const targetUrl = String(urlObj.searchParams.get('url') || '').trim();
    if (!targetUrl) {
      sendJson(res, 400, { error: '缺少下载地址。' });
      return;
    }
    if (!targetUrl.startsWith('http')) {
      sendJson(res, 400, { error: '无效的下载地址。' });
      return;
    }

    await proxyVideoStream({ targetUrl, req, res });
  } catch (error) {
    console.error('[proxy-download] error:', error.message);
    if (!res.headersSent) {
      sendJson(res, 500, { error: error.message || '代理下载失败' });
    } else {
      res.end();
    }
  }
}

function isMultipartFormRequest(req) {
  return String(req.headers['content-type'] || '').toLowerCase().includes('multipart/form-data');
}

async function readMultipartFormBody(req) {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength && contentLength > MAX_MULTIMODAL_UPLOAD_BYTES) {
    throw new Error('上传文件过大');
  }

  const request = new Request('http://localhost/upload', {
    method: req.method || 'POST',
    headers: req.headers,
    body: req,
    duplex: 'half'
  });

  const formData = await request.formData();
  const file = formData.get('file');
  const files = formData.getAll('files').filter((item) => item instanceof File && item.size > 0);
  const filesKinds = parseJsonString(formData.get('files_kinds'), []);

  return {
    question: readValue(formData.get('question')),
    history: parseJsonString(formData.get('history'), []),
    stream: readValue(formData.get('stream')).toLowerCase() === 'true',
    model: readValue(formData.get('model')),
    mediaKind: readValue(formData.get('media_kind')),
    file: file instanceof File ? file : null,
    files,
    filesKinds
  };
}

async function readSeedanceTaskFormBody(req) {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength && contentLength > MAX_MULTIMODAL_UPLOAD_BYTES) {
    throw new Error('上传文件过大');
  }

  const request = new Request('http://localhost/upload', {
    method: req.method || 'POST',
    headers: req.headers,
    body: req,
    duplex: 'half'
  });

  const formData = await request.formData();

  return {
    prompt: readValue(formData.get('prompt')),
    model: readValue(formData.get('model')),
    ratio: readValue(formData.get('ratio')),
    duration: Number.parseInt(String(formData.get('duration') || 5), 10),
    generateAudio: readValue(formData.get('generateAudio')).toLowerCase() !== 'false',
    watermark: readValue(formData.get('watermark')).toLowerCase() === 'true',
    files: formData.getAll('files').filter((item) => item instanceof File && item.size > 0)
  };
}

async function normalizeUploadedAudioInput(file) {
  if (!(file instanceof File)) {
    throw new Error('上传音频无效');
  }

  const mimeType = readValue(file.type) || 'audio/mpeg';
  const bytes = Buffer.from(await file.arrayBuffer());
  const base64Data = bytes.toString('base64');

  return {
    mimeType,
    audioUrl: `data:${mimeType};base64,${base64Data}`
  };
}

async function readSiliconFlowVoiceUploadFormBody(req) {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength && contentLength > 40 * 1024 * 1024) {
    throw new Error('上传文件过大');
  }

  const request = new Request('http://localhost/upload', {
    method: req.method || 'POST',
    headers: req.headers,
    body: req,
    duplex: 'half'
  });

  const formData = await request.formData();
  const file = formData.get('file');

  return {
    file: file instanceof File ? file : null,
    model: readValue(formData.get('model')),
    customName: readValue(formData.get('customName')),
    text: readValue(formData.get('text')),
    responseFormat: normalizeSiliconFlowResponseFormat(formData.get('response_format'))
  };
}

function normalizeBase64ImageInput(image, imageMimeType) {
  const raw = readValue(image);
  if (!raw) {
    throw new Error('缺少图片数据 image');
  }

  const dataUrlMatch = raw.match(/^data:(image\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1],
      base64Data: dataUrlMatch[2].replace(/\s+/g, ''),
      imageUrl: `data:${dataUrlMatch[1]};base64,${dataUrlMatch[2].replace(/\s+/g, '')}`
    };
  }

  const mimeType = readValue(imageMimeType) || 'image/png';
  const normalized = raw.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new Error('图片 base64 格式不合法');
  }

  return {
    mimeType,
    base64Data: normalized,
    imageUrl: `data:${mimeType};base64,${normalized}`
  };
}

function normalizeBase64VideoInput(video, videoMimeType) {
  const raw = readValue(video);
  if (!raw) {
    throw new Error('缺少视频数据 video');
  }

  const dataUrlMatch = raw.match(/^data:(video\/[a-zA-Z0-9.+-]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (dataUrlMatch) {
    return {
      mimeType: dataUrlMatch[1],
      base64Data: dataUrlMatch[2].replace(/\s+/g, ''),
      videoUrl: `data:${dataUrlMatch[1]};base64,${dataUrlMatch[2].replace(/\s+/g, '')}`
    };
  }

  const mimeType = readValue(videoMimeType) || 'video/mp4';
  const normalized = raw.replace(/\s+/g, '');
  if (!/^[A-Za-z0-9+/=]+$/.test(normalized)) {
    throw new Error('视频 base64 格式不合法');
  }

  return {
    mimeType,
    base64Data: normalized,
    videoUrl: `data:${mimeType};base64,${normalized}`
  };
}

async function compressMediaForArk(file, mediaKind) {
  const maxOriginalBytes = mediaKind === 'image' ? MAX_IMAGE_ORIGINAL_UPLOAD_BYTES : MAX_VIDEO_ORIGINAL_UPLOAD_BYTES;
  if (file.size <= maxOriginalBytes) return file;

  await ensureVideoCompressionTools();
  const tempDir = await mkdtemp(join(tmpdir(), 'cp-ark-'));
  const inputPath = join(tempDir, `input_${mediaKind}`);
  const outputPath = join(tempDir, `output_${mediaKind}`);

  try {
    const arrayBuffer = await file.arrayBuffer();
    await writeFile(inputPath, Buffer.from(arrayBuffer));

    if (mediaKind === 'image') {
      // 先尝试质量压缩
      await execFileAsync('ffmpeg', [
        '-y', '-i', inputPath,
        '-q:v', '3',
        outputPath
      ]);
      let outputSize = (await stat(outputPath)).size;

      // 如果还超过限制，缩小到最长边 1920
      if (outputSize > MAX_IMAGE_ORIGINAL_UPLOAD_BYTES) {
        await execFileAsync('ffmpeg', [
          '-y', '-i', inputPath,
          '-vf', 'scale=min(1920\\,iw):-1',
          '-q:v', '3',
          outputPath
        ]);
        outputSize = (await stat(outputPath)).size;
      }

      // 如果还超过，进一步缩小到 1280
      if (outputSize > MAX_IMAGE_ORIGINAL_UPLOAD_BYTES) {
        await execFileAsync('ffmpeg', [
          '-y', '-i', inputPath,
          '-vf', 'scale=min(1280\\,iw):-1',
          '-q:v', '5',
          outputPath
        ]);
        outputSize = (await stat(outputPath)).size;
      }

      // 如果还超过，缩小到 800
      if (outputSize > MAX_IMAGE_ORIGINAL_UPLOAD_BYTES) {
        await execFileAsync('ffmpeg', [
          '-y', '-i', inputPath,
          '-vf', 'scale=min(800\\,iw):-1',
          '-q:v', '8',
          outputPath
        ]);
        outputSize = (await stat(outputPath)).size;
      }

      if (outputSize > MAX_IMAGE_ORIGINAL_UPLOAD_BYTES) {
        throw new Error('图片压缩后仍然超过 10MB，请上传更小的图片');
      }

      const compressedBuffer = await readFile(outputPath);
      return new File([compressedBuffer], file.name, { type: 'image/jpeg' });
    }

    // video
    const durationSeconds = await getVideoDurationSeconds(inputPath);
    const compressed = await maybeCompressLargeVideo({
      filePath: inputPath,
      originalSize: file.size,
      durationSeconds,
      mediaId: randomBytes(6).toString('hex')
    });

    const compressedBuffer = await readFile(compressed.filePath);
    return new File([compressedBuffer], file.name, { type: 'video/mp4' });
  } finally {
    await rm(tempDir, { recursive: true, force: true }).catch(() => {});
  }
}

async function normalizeUploadedMediaInput(file, mediaKind) {
  if (!(file instanceof File)) {
    throw new Error('上传文件无效');
  }

  const fallbackMimeType = mediaKind === 'image' ? 'image/png' : 'video/mp4';
  const mimeType = readValue(file.type) || fallbackMimeType;
  const bytes = Buffer.from(await file.arrayBuffer());
  const base64Data = bytes.toString('base64');

  return mediaKind === 'image'
    ? {
        mimeType,
        imageUrl: `data:${mimeType};base64,${base64Data}`
      }
    : {
        mimeType,
        videoUrl: `data:${mimeType};base64,${base64Data}`
      };
}

function extractResponsesText(json) {
  if (!json || typeof json !== 'object') return '';
  if (typeof json.output_text === 'string' && json.output_text.trim()) {
    return normalizeDoubaoDisplayText(json.output_text);
  }

  const choices = Array.isArray(json.choices) ? json.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const message = choice.message;
    if (message && typeof message === 'object') {
      if (typeof message.content === 'string' && message.content.trim()) {
        return normalizeDoubaoDisplayText(message.content.trim());
      }
    }
  }

  const output = Array.isArray(json.output) ? json.output : [];
  const textParts = [];

  for (const item of output) {
    if (!item || typeof item !== 'object') continue;
    if (isDoubaoReasoningType(item.type)) continue;

    if (Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        if (!contentItem || typeof contentItem !== 'object') continue;
        if (isDoubaoReasoningType(contentItem.type)) continue;
        if (typeof contentItem.text === 'string' && contentItem.text.trim()) {
          textParts.push(contentItem.text.trim());
        }
      }
    }

    if (!isDoubaoReasoningType(item.type) && typeof item.text === 'string' && item.text.trim()) {
      textParts.push(item.text.trim());
    }
  }

  return normalizeDoubaoDisplayText(textParts.join('\n').trim());
}

function isDoubaoReasoningType(value) {
  return /reason|think|analysis/i.test(String(value || ''));
}

function shouldUseDoubaoVisibleText(value) {
  return !!readValue(value);
}

function extractVisibleDoubaoText(payload) {
  if (!payload || typeof payload !== 'object') return '';
  if (shouldUseDoubaoVisibleText(payload.answer)) return normalizeDoubaoDisplayText(String(payload.answer));
  if (shouldUseDoubaoVisibleText(payload.output_text)) return normalizeDoubaoDisplayText(String(payload.output_text));

  const choices = Array.isArray(payload.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const message = choice.message;
    if (message && typeof message === 'object') {
      if (typeof message.content === 'string' && message.content.trim()) {
        return normalizeDoubaoDisplayText(message.content.trim());
      }
    }
  }

  const containers = [payload, payload.response, payload.item].filter(Boolean);
  const textParts = [];

  for (const item of containers) {
    if (!item || typeof item !== 'object') continue;
    if (isDoubaoReasoningType(item.type)) continue;

    if (typeof item.output_text === 'string' && item.output_text.trim()) {
      textParts.push(item.output_text.trim());
    }

    if (typeof item.text === 'string' && item.text.trim()) {
      textParts.push(item.text.trim());
    }

    if (Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        if (!contentItem || typeof contentItem !== 'object') continue;
        if (isDoubaoReasoningType(contentItem.type)) continue;
        if (typeof contentItem.text === 'string' && contentItem.text.trim()) {
          textParts.push(contentItem.text.trim());
        }
      }
    }
  }

  return normalizeDoubaoDisplayText(textParts.join('\n').trim());
}

function normalizeDoubaoCompareText(value) {
  return String(value || '')
    .toLowerCase()
    .replace(/[#*_`>\-\s]/g, '')
    .replace(/[，。、“”‘’；：:,.!?！？（）()【】\[\]《》<>]/g, '');
}

function normalizeDoubaoDisplayText(value) {
  const raw = String(value || '').replace(/\r\n/g, '\n').trim();
  if (!raw) return '';

  const lines = raw.split('\n').map((line) => line.trim());
  const dedupedLines = [];

  for (const line of lines) {
    if (!line && dedupedLines[dedupedLines.length - 1] === '') continue;
    if (line && dedupedLines[dedupedLines.length - 1] === line) continue;
    dedupedLines.push(line);
  }

  const filteredLines = [];
  for (let i = 0; i < dedupedLines.length; i += 1) {
    const current = dedupedLines[i];
    if (!current) {
      filteredLines.push(current);
      continue;
    }

    const currentNormalized = normalizeDoubaoCompareText(current);
    let duplicatedByFollowingBlock = false;

    for (let span = 2; span <= 6; span += 1) {
      const nextLines = dedupedLines
        .slice(i + 1, i + 1 + span)
        .filter(Boolean);
      if (nextLines.length < span) continue;
      const merged = normalizeDoubaoCompareText(nextLines.join(''));
      if (merged && merged === currentNormalized) {
        duplicatedByFollowingBlock = true;
        break;
      }
    }

    if (!duplicatedByFollowingBlock) {
      filteredLines.push(current);
    }
  }

  return collapseRepeatedDoubaoText(filteredLines.join('\n').replace(/\n{3,}/g, '\n\n').trim());
}

function collapseRepeatedDoubaoText(value) {
  const text = String(value || '').trim();
  if (!text) return '';

  const normalized = normalizeDoubaoCompareText(text);
  if (!normalized) return text;

  const lines = text.split('\n');
  for (let split = Math.floor(lines.length / 2); split >= 1; split -= 1) {
    const first = lines.slice(0, split).join('\n').trim();
    const second = lines.slice(split).join('\n').trim();
    if (!first || !second) continue;
    if (normalizeDoubaoCompareText(first) === normalizeDoubaoCompareText(second)) {
      return first;
    }
  }

  const midpoint = Math.floor(text.length / 2);
  for (let offset = 0; offset <= Math.min(200, midpoint); offset += 1) {
    for (const split of [midpoint - offset, midpoint + offset]) {
      if (split <= 0 || split >= text.length) continue;
      const first = text.slice(0, split).trim();
      const second = text.slice(split).trim();
      if (first && second && normalizeDoubaoCompareText(first) === normalizeDoubaoCompareText(second)) {
        return first;
      }
    }
  }

  return text;
}

function extractVisibleDoubaoDelta(payload, eventName) {
  const resolvedEvent = String(eventName || payload?.type || '').toLowerCase();
  if (isDoubaoReasoningType(resolvedEvent)) return '';

  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const delta = choice.delta;
    if (delta && typeof delta === 'object') {
      if (typeof delta.content === 'string' && delta.content.length > 0) return delta.content;
    }
  }

  const deltaCandidates = [
    payload?.delta,
    payload?.data?.delta,
    payload?.item?.delta,
    payload?.item,
    payload?.data
  ].filter(Boolean);

  for (const item of deltaCandidates) {
    if (typeof item === 'string' && item.length > 0 && !isDoubaoReasoningType(resolvedEvent)) {
      return item;
    }
    if (!item || typeof item !== 'object') continue;
    if (isDoubaoReasoningType(item.type)) continue;
    if (typeof item.text === 'string' && item.text.length > 0) return item.text;
    if (typeof item.delta === 'string' && item.delta.length > 0) return item.delta;
    if (item.delta && typeof item.delta.text === 'string' && item.delta.text.length > 0) return item.delta.text;
    if (Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        if (!contentItem || typeof contentItem !== 'object') continue;
        if (isDoubaoReasoningType(contentItem.type)) continue;
        if (typeof contentItem.text === 'string' && contentItem.text.length > 0) {
          return contentItem.text;
        }
      }
    }
  }

  return '';
}

function getIncrementalText(baseText, incomingText) {
  const base = String(baseText || '');
  const incoming = String(incomingText || '');
  if (!incoming) return '';
  if (!base) return incoming;
  if (incoming === base) return '';
  if (incoming.startsWith(base)) return incoming.slice(base.length);

  const maxOverlap = Math.min(base.length, incoming.length);
  for (let overlap = maxOverlap; overlap > 0; overlap -= 1) {
    if (base.slice(-overlap) === incoming.slice(0, overlap)) {
      return incoming.slice(overlap);
    }
  }

  return incoming;
}

function isDoubaoDeltaEvent(eventName) {
  return /delta/i.test(String(eventName || ''));
}

function normalizeDoubaoHistory(history) {
  if (!Array.isArray(history)) return [];

  return history
    .map((item) => ({
      role: item && item.role === 'assistant' ? 'assistant' : 'user',
      content: readValue(item && item.content)
    }))
    .filter((item) => item.content);
}

function buildDoubaoPromptWithHistory(question, history) {
  const normalizedHistory = normalizeDoubaoHistory(history);
  const responseInstruction = '请直接输出给用户可见的最终回答，不要展示思考过程、推理链路、分析草稿或中间步骤。';

  if (!normalizedHistory.length) {
    return [
      responseInstruction,
      '',
      question
    ].join('\n');
  }

  const transcript = normalizedHistory
    .map((item) => (item.role === 'assistant' ? '助手：' : '用户：') + item.content)
    .join('\n');

  return [
    responseInstruction,
    '',
    '以下是本轮会话的历史对话，请结合这些上下文继续回答。',
    transcript,
    '',
    '当前问题：' + question
  ].join('\n');
}

function wantsDoubaoStream(body, req) {
  if (body && body.stream === true) return true;
  if (body && String(body.stream).toLowerCase() === 'true') return true;
  const accept = String(req.headers.accept || '');
  return accept.includes('text/event-stream');
}


function writeSseEvent(res, eventName, payload) {
  if (eventName) {
    res.write(`event: ${eventName}\n`);
  }
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function startSseResponse(res) {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no'
  });
  if (typeof res.flushHeaders === 'function') {
    res.flushHeaders();
  }
  res.write(': connected\n\n');
}

function parseDoubaoSseBlock(rawBlock) {
  const lines = String(rawBlock || '').split(/\r?\n/);
  let eventName = '';
  const dataLines = [];

  for (const line of lines) {
    if (line.startsWith('event:')) {
      eventName = line.slice(6).trim();
      continue;
    }
    if (line.startsWith('data:')) {
      dataLines.push(line.slice(5).trimStart());
    }
  }

  const rawData = dataLines.join('\n').trim();
  if (!rawData) return null;
  if (rawData === '[DONE]') {
    return {
      event: eventName || 'done',
      done: true,
      payload: null
    };
  }

  let payload = null;
  try {
    payload = JSON.parse(rawData);
  } catch {
    return null;
  }

  return {
    event: eventName || payload?.type || 'message',
    done: payload?.type === 'response.completed' || payload?.type === 'response.done' || payload?.done === true,
    payload
  };
}

async function proxySseStreamToClient(upstreamRes, req, res, options = {}) {
  const requestId = options.requestId || '';
  if (!options.skipInitialHeaders) {
    startSseResponse(res);
  }
  if (!upstreamRes.body) {
    writeSseEvent(res, 'error', { error: '上游未返回可读取的流' });
    res.end();
    return;
  }

  const reader = upstreamRes.body.getReader();
  const decoder = new TextDecoder();
  let closedByClient = false;
  let buffer = '';
  let accumulatedAnswer = '';
  let finalTextCandidate = '';
  let sentDone = false;

  const abortStream = async () => {
    if (closedByClient) return;
    closedByClient = true;
    try {
      await reader.cancel();
    } catch {}
  };

  req.once('close', abortStream);

  try {
    while (!closedByClient) {
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        buffer += decoder.decode(value, { stream: true });
        const blocks = buffer.split(/\n\n/);
        buffer = blocks.pop() || '';

        for (const block of blocks) {
          const parsed = parseDoubaoSseBlock(block);
          if (!parsed) continue;

          const payload = parsed.payload;
          const errorMessage = payload?.error?.message || payload?.error || (payload?.type === 'error' ? (payload?.message || '流式响应失败') : '');
          if (errorMessage) {
            console.log('[doubao multimodal] upstream sse error event', { requestId, event: parsed.event, errorMessage, raw: block.slice(0, 500) });
            writeSseEvent(res, 'error', { error: errorMessage });
            continue;
          }

          const shouldReadDelta = isDoubaoDeltaEvent(parsed.event);
          const delta = shouldReadDelta ? extractVisibleDoubaoDelta(payload, parsed.event) : '';
          console.log('[doubao multimodal] upstream sse event', {
            requestId,
            event: parsed.event,
            done: parsed.done,
            hasDelta: !!delta,
            deltaPreview: delta ? delta.slice(0, 50) : '',
            payloadKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [],
            accumulatedBefore: accumulatedAnswer.length,
            raw: block.slice(0, 300)
          });

          if (delta) {
            const incrementalDelta = getIncrementalText(accumulatedAnswer, delta);
            if (incrementalDelta) {
              accumulatedAnswer += incrementalDelta;
              writeSseEvent(res, 'answer.delta', { delta: incrementalDelta });
            }
          }

          const visibleText = extractVisibleDoubaoText(payload);
          if (visibleText) {
            finalTextCandidate = visibleText;
          }

          if (parsed.done && !sentDone) {
            sentDone = true;
            writeSseEvent(res, 'answer.done', {
              answer: normalizeDoubaoDisplayText(readValue(accumulatedAnswer) || finalTextCandidate || '')
            });
          }
        }
      }
    }

    const tail = decoder.decode();
    if (tail) {
      buffer += tail;
    }

    if (buffer.trim()) {
      const parsed = parseDoubaoSseBlock(buffer);
      if (parsed) {
        const payload = parsed.payload;
        const delta = isDoubaoDeltaEvent(parsed.event) ? extractVisibleDoubaoDelta(payload, parsed.event) : '';
        if (delta) {
          const incrementalDelta = getIncrementalText(accumulatedAnswer, delta);
          if (incrementalDelta) {
            accumulatedAnswer += incrementalDelta;
            writeSseEvent(res, 'answer.delta', { delta: incrementalDelta });
          }
        }
        const visibleText = extractVisibleDoubaoText(payload);
        if (visibleText) {
          finalTextCandidate = visibleText;
        }
        if (parsed.done && !sentDone) {
          sentDone = true;
          writeSseEvent(res, 'answer.done', {
            answer: normalizeDoubaoDisplayText(readValue(accumulatedAnswer) || finalTextCandidate || '')
          });
        }
      }
    }

    if (!closedByClient && !sentDone) {
      writeSseEvent(res, 'answer.done', {
        answer: normalizeDoubaoDisplayText(readValue(accumulatedAnswer) || finalTextCandidate || '')
      });
    }
    if (!closedByClient) res.end();
  } catch (error) {
    if (!closedByClient) {
      writeSseEvent(res, 'error', { error: error.message || '流式转发失败' });
      res.end();
    }
  } finally {
    req.off('close', abortStream);
  }
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

function normalizeSiliconFlowCustomName(value) {
  const cleaned = String(value || '')
    .replace(/[^a-zA-Z0-9_-]+/g, '_')
    .replace(/_+/g, '_')
    .replace(/^[_-]+|[_-]+$/g, '')
    .slice(0, 64);

  if (cleaned.length >= 1) return cleaned;
  return `sf_voice_${Date.now().toString(36)}`.slice(0, 64);
}

function readRequestBody(req) {
  return new Promise((resolve, reject) => {
    let body = '';
    req.on('data', (chunk) => {
      body += chunk;
      if (body.length > 40 * 1024 * 1024) {
        reject(new Error('请求体过大'));
        req.destroy();
      }
    });
    req.on('end', () => {
      try {
        if (!body) return resolve({});
        const contentType = String(req.headers['content-type'] || '').toLowerCase();
        if (contentType.includes('application/x-www-form-urlencoded')) {
          const params = new URLSearchParams(body);
          const result = {};
          for (const [key, value] of params) {
            result[key] = value;
          }
          resolve(result);
        } else {
          resolve(JSON.parse(body));
        }
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

function createMockPcmBuffer(text = '') {
  const durationSeconds = Math.min(4, Math.max(1, Math.ceil(String(text || '').length / 18)));
  const sampleRate = 24000;
  const totalSamples = sampleRate * durationSeconds;
  const pcmBuffer = Buffer.alloc(totalSamples * 2);

  for (let index = 0; index < totalSamples; index += 1) {
    const time = index / sampleRate;
    const attack = Math.min(1, index / (sampleRate * 0.1));
    const decay = Math.min(1, (totalSamples - index) / (sampleRate * 0.1));
    const envelope = Math.max(0.15, Math.min(attack, decay));
    const sample = Math.sin(2 * Math.PI * 440 * time) * 0.18 * envelope;
    pcmBuffer.writeInt16LE(Math.round(sample * 32767), index * 2);
  }

  return pcmBuffer;
}

function buildMockVoiceClonePayload(platform, preferredName, fallbackId) {
  if (platform === 'zhipu') {
    return {
      ok: true,
      mock: true,
      voice: `mock-zhipu-${Date.now().toString(36)}`,
      file_id: `mock-file-${Date.now().toString(36)}`,
      file_purpose: 'voice-clone-output',
      meta: {
        preferredName: readValue(preferredName) || `mock_${Date.now().toString(36)}`
      }
    };
  }

  const safeName = readValue(preferredName) || `mock_${Date.now().toString(36)}`;
  if (platform === 'aliyun') {
    return {
      ok: true,
      mock: true,
      output: {
        voice: `mock-aliyun-${Date.now().toString(36)}`
      },
      meta: {
        preferredName: safeName
      }
    };
  }

  return {
    ok: true,
    mock: true,
    status: 2,
    speaker_id: fallbackId || `mock-volc-${Date.now().toString(36)}`,
    meta: {
      preferredName: safeName
    }
  };
}

function dataUrlToBuffer(dataUrl, fallbackMimeType = 'audio/wav') {
  const raw = readValue(dataUrl);
  const match = raw.match(/^data:([^;]+);base64,([A-Za-z0-9+/=\s]+)$/);
  if (!match) {
    throw new Error('音频数据格式不合法，缺少有效的 data URL。');
  }

  return {
    mimeType: readValue(match[1]) || fallbackMimeType,
    buffer: Buffer.from(match[2].replace(/\s+/g, ''), 'base64')
  };
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
        session: buildAliyunRealtimeSession({ voice })
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

    if (shouldUseVoiceCloneMock(body)) {
      const wavBuffer = buildWaveFromPcm(createMockPcmBuffer(text), 24000, 1, 16);
      sendWavResponse(res, wavBuffer);
      return;
    }

    if (!resolvedApiKey) {
      sendJson(res, 400, { error: '阿里云真实模式缺少 API Key，请在前端填写或在 legacy-project/.env 中配置 ALIYUN_API_KEY' });
      return;
    }

    if (!model || !voice || !text) {
      sendJson(res, 400, { error: '阿里云语音生成缺少 model、voice 或 text' });
      return;
    }

    const pcmBuffer = await connectAliyunRealtime({
      apiKey: resolvedApiKey,
      model,
      voice,
      text
    });
    const wavBuffer = buildWaveFromPcm(pcmBuffer, 24000, 1, 16);

    sendWavResponse(res, wavBuffer);
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

    if (shouldUseVoiceCloneMock(body)) {
      sendJson(res, 200, buildMockVoiceClonePayload('aliyun', normalizedPreferredName));
      return;
    }

    if (!resolvedApiKey) {
      sendJson(res, 400, { error: '阿里云真实模式缺少 API Key，请在前端填写或在 legacy-project/.env 中配置 ALIYUN_API_KEY' });
      return;
    }

    if (!targetModel || !audioData) {
      sendJson(res, 400, { error: '阿里云音色创建缺少 targetModel 或 audioData' });
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

    await addVoiceToArchive({
      name: readValue(preferredName) || '未命名音色',
      provider: 'aliyun',
      providerLabel: '阿里云',
      remoteVoiceId: json?.output?.voice || json?.voiceId || '',
      engineModel: targetModel,
      createdAt: new Date().toISOString(),
    });
    sendJson(res, 200, json);
  } catch (error) {
    sendJson(res, 500, { error: error.message || '阿里云创建音色失败' });
  }
}

async function handleZhipuVoiceClone(req, res) {
  try {
    const body = await readRequestBody(req);
    const { apiKey, preferredName, audioData, fileName, sampleText } = body;
    const resolvedApiKey = readValue(apiKey, SERVER_CONFIG.zhipuApiKey);
    const resolvedPreferredName = readValue(preferredName) || `voice_${Date.now().toString(36)}`;

    if (shouldUseVoiceCloneMock(body)) {
      sendJson(res, 200, buildMockVoiceClonePayload('zhipu', resolvedPreferredName));
      return;
    }

    if (!resolvedApiKey) {
      sendJson(res, 400, { error: '智谱真实模式缺少 API Key，请在前端填写或在 legacy-project/.env 中配置 ZHIPU_API_KEY' });
      return;
    }

    if (!audioData) {
      sendJson(res, 400, { error: '智谱音色创建缺少音频数据 audioData' });
      return;
    }

    let normalizedAudio;
    try {
      normalizedAudio = dataUrlToBuffer(audioData);
    } catch (error) {
      sendJson(res, 400, { error: error.message || '音频数据解析失败' });
      return;
    }

    const formData = new FormData();
    formData.append(
      'file',
      new Blob([normalizedAudio.buffer], { type: normalizedAudio.mimeType }),
      readValue(fileName) || 'voice-sample.wav'
    );
    formData.append('purpose', 'voice-clone-input');

    const uploadRes = await fetch('https://open.bigmodel.cn/api/paas/v4/files', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedApiKey}`
      },
      body: formData
    });

    const uploadJson = await uploadRes.json();
    if (!uploadRes.ok) {
      sendJson(res, uploadRes.status, {
        error: uploadJson?.error?.message || uploadJson?.message || '智谱文件上传失败',
        upstream: uploadJson
      });
      return;
    }

    const cloneRes = await fetch('https://open.bigmodel.cn/api/paas/v4/voice/clone', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'glm-tts-clone',
        voice_name: resolvedPreferredName,
        input: readValue(sampleText) || '你好，这是一个内部工具的试听文本。',
        file_id: uploadJson.id
      })
    });

    const cloneJson = await cloneRes.json();
    if (!cloneRes.ok) {
      sendJson(res, cloneRes.status, {
        error: cloneJson?.error?.message || cloneJson?.message || '智谱音色克隆失败',
        upstream: cloneJson
      });
      return;
    }

    await addVoiceToArchive({
      name: resolvedPreferredName,
      provider: 'zhipu',
      providerLabel: '智谱',
      remoteVoiceId: cloneJson.voice || '',
      engineModel: 'glm-tts',
      createdAt: new Date().toISOString(),
    });
    sendJson(res, 200, {
      ok: true,
      voice: cloneJson.voice,
      file_id: cloneJson.file_id,
      file_purpose: cloneJson.file_purpose,
      request_id: cloneJson.request_id
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '智谱音色克隆失败' });
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

function connectVolcTts({ appKey, accessKey, speakerId, text, resourceId = 'seed-icl-2.0', speechRate = 1 }) {
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
                audio_params: buildVolcAudioParams(speechRate)
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
    const { appKey, accessKey, speakerId, text, resourceId, speakerSource, speechRate } = body;
    const resolvedSpeakerId = readValue(speakerId, SERVER_CONFIG.volcSpeakerId);

    if (shouldUseVoiceCloneMock(body)) {
      const wavBuffer = buildWaveFromPcm(createMockPcmBuffer(text), 24000, 1, 16);
      sendWavResponse(res, wavBuffer);
      return;
    }

    const group = getVolcEngineGroupForSpeakerId(resolvedSpeakerId);
    const resolvedAppKey = group ? group.appKey : readValue(appKey, SERVER_CONFIG.volcAppKey);
    const resolvedAccessKey = group ? group.accessKey : readValue(accessKey, SERVER_CONFIG.volcAccessKey);

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
      resourceId: resolution.resolvedResourceId,
      speechRate: normalizeSpeechRate(speechRate)
    });
    const wavBuffer = buildWaveFromPcm(pcmBuffer, 24000, 1, 16);

    sendWavResponse(res, wavBuffer);
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

async function handleZhipuTts(req, res) {
  try {
    const body = await readRequestBody(req);
    const { apiKey, voice, text, speechRate } = body;
    const resolvedApiKey = readValue(apiKey, SERVER_CONFIG.zhipuApiKey);

    if (shouldUseVoiceCloneMock(body)) {
      const wavBuffer = buildWaveFromPcm(createMockPcmBuffer(text), 24000, 1, 16);
      sendWavResponse(res, wavBuffer);
      return;
    }

    if (!resolvedApiKey) {
      sendJson(res, 400, { error: '智谱真实模式缺少 API Key，请在前端填写或在 legacy-project/.env 中配置 ZHIPU_API_KEY' });
      return;
    }

    if (!voice || !text) {
      sendJson(res, 400, { error: '智谱语音生成缺少 voice 或 text' });
      return;
    }

    const upstreamRes = await fetch('https://open.bigmodel.cn/api/paas/v4/audio/speech', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: 'glm-tts',
        input: text,
        voice,
        response_format: 'wav',
        speed: normalizeSpeechRate(speechRate),
        volume: 1.0
      })
    });

    if (!upstreamRes.ok) {
      let json = null;
      try {
        json = await upstreamRes.json();
      } catch {}
      sendJson(res, upstreamRes.status, {
        error: json?.error?.message || json?.message || '智谱语音生成失败',
        upstream: json
      });
      return;
    }

    const audioBuffer = Buffer.from(await upstreamRes.arrayBuffer());
    sendWavResponse(res, audioBuffer);
  } catch (error) {
    sendJson(res, 500, { error: error.message || '智谱语音生成失败' });
  }
}

async function handleVolcVoiceClone(req, res) {
  const upstreamUrl = 'https://openspeech.bytedance.com/api/v3/tts/voice_clone';
  let reservedSpeakerId = '';
  let resolvedDeviceId = '';
  let shouldReleaseReservationOnFailure = false;
  try {
    const body = await readRequestBody(req);
    const { speakerId, resourceId, audioData, audioFormat, referenceText, deviceId, preferredName } = body;
    resolvedDeviceId = normalizeDeviceId(deviceId);
    const resolvedReferenceText = readValue(referenceText, '这是一段用于声音克隆的参考音频。');

    if (shouldUseVoiceCloneMock(body)) {
      sendJson(res, 200, buildMockVoiceClonePayload('volcengine', '', readValue(speakerId, 'mock_volc_speaker')));
      return;
    }

    const hasAnyGroup = SERVER_CONFIG.volcEngineGroups.length > 0;
    const debugFlags = {
      hasEnvAppKey: hasAnyGroup || !!readValue(SERVER_CONFIG.volcAppKey),
      hasEnvAccessKey: hasAnyGroup || !!readValue(SERVER_CONFIG.volcAccessKey),
      configuredSpeakerIdCount: getConfiguredVolcSpeakerIds().length,
      groupCount: SERVER_CONFIG.volcEngineGroups.length,
      hasBodySpeakerId: !!readValue(speakerId),
      hasBodyDeviceId: !!resolvedDeviceId,
      hasBodyAudioData: typeof audioData === 'string' && audioData.length > 0,
      hasBodyResourceId: typeof resourceId === 'string' && resourceId.length > 0,
      hasBodyAudioFormat: typeof audioFormat === 'string' && audioFormat.length > 0,
      hasBodyReferenceText: !!readValue(referenceText),
      contentType: req.headers['content-type'] || '',
      bodyKeys: body && typeof body === 'object' ? Object.keys(body) : []
    };

    console.error('[volc voice clone] incoming request summary', debugFlags);

    if (!hasAnyGroup) {
      sendJson(res, 400, { error: '缺少服务端环境变量 VOLCENGINE_APP_KEY / VOLCENGINE_ACCESS_KEY，或未配置任何 speaker_id 槽位', debug: debugFlags });
      return;
    }

    if (!resolvedDeviceId) {
      sendJson(res, 400, { error: '缺少 deviceId，无法确认当前浏览器对火山 speaker_id 的占用归属', debug: debugFlags });
      return;
    }

    if (!debugFlags.hasBodyAudioData) {
      sendJson(res, 400, { error: '缺少 body.audioData，或音频数据为空', debug: debugFlags });
      return;
    }

    const reservation = await reserveVolcSpeakerIdForDevice({
      requestedSpeakerId: speakerId,
      ownerDeviceId: resolvedDeviceId,
      preferredName: preferredName,
    });

    if (!reservation.ok) {
      sendJson(res, reservation.statusCode, {
        error: reservation.error,
        debug: {
          ...debugFlags,
          configuredSpeakerIds: getConfiguredVolcSpeakerIds()
        }
      });
      return;
    }

    reservedSpeakerId = reservation.speakerId;
    shouldReleaseReservationOnFailure = reservation.createdByRequest;

    const group = getVolcEngineGroupForSpeakerId(reservedSpeakerId);
    const resolvedAppKey = group ? group.appKey : readValue(SERVER_CONFIG.volcAppKey);
    const resolvedAccessKey = group ? group.accessKey : readValue(SERVER_CONFIG.volcAccessKey);

    const response = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Api-App-Key': resolvedAppKey,
        'X-Api-Access-Key': resolvedAccessKey,
        'X-Api-Request-Id': `req_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`
      },
      body: JSON.stringify({
        speaker_id: reservedSpeakerId,
        audio: {
          data: audioData,
          format: audioFormat || 'wav'
        },
        language: 0,
        model_types: [resourceId === 'seed-icl-2.0' ? 4 : 1],
        extra_params: {
          demo_text: resolvedReferenceText
        }
      })
    });

    const responseText = await response.text();
    let json = null;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {}

    if (!response.ok) {
      if (shouldReleaseReservationOnFailure) {
        await releaseVolcSpeakerIdForDevice({
          speakerId: reservedSpeakerId,
          ownerDeviceId: resolvedDeviceId
        });
      }
      invalidateVolcSpeakerRemoteStatusCache();
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

    invalidateVolcSpeakerRemoteStatusCache();
    await addVoiceToArchive({
      name: readValue(preferredName) || '未命名音色',
      provider: 'volcengine',
      providerLabel: '火山引擎',
      remoteVoiceId: json?.speaker_id || reservedSpeakerId,
      engineModel: 'volcengine-voice-clone',
      resourceId: readValue(resourceId) || 'seed-icl-2.0',
      createdBy: resolvedDeviceId,
      createdAt: new Date().toISOString(),
    });
    sendJson(res, 200, {
      ...(json || { raw: responseText }),
      speaker_id: json?.speaker_id || reservedSpeakerId
    });
  } catch (error) {
    if (shouldReleaseReservationOnFailure && reservedSpeakerId && resolvedDeviceId) {
      await releaseVolcSpeakerIdForDevice({
        speakerId: reservedSpeakerId,
        ownerDeviceId: resolvedDeviceId
      }).catch(() => {});
    }
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

async function handleSyncVolcVoiceOwnership(req, res) {
  try {
    const body = await readRequestBody(req);
    const ownerDeviceId = normalizeDeviceId(body?.deviceId);

    if (!ownerDeviceId) {
      sendJson(res, 400, { error: '缺少 deviceId，无法同步火山音色槽位归属' });
      return;
    }

    const result = await syncVolcSpeakerOwnershipForDevice({
      ownerDeviceId,
      speakerIds: body?.speakerIds,
    });
    sendJson(res, 200, result);
  } catch (error) {
    sendJson(res, 500, { error: error.message || '火山音色槽位同步失败' });
  }
}

async function handleReleaseVolcVoiceOwnership(req, res) {
  try {
    const body = await readRequestBody(req);
    const ownerDeviceId = normalizeDeviceId(body?.deviceId);
    const speakerId = readValue(body?.speakerId);

    if (!ownerDeviceId) {
      sendJson(res, 400, { error: '缺少 deviceId，无法释放火山音色槽位' });
      return;
    }

    if (!speakerId) {
      sendJson(res, 400, { error: '缺少 speakerId，无法释放火山音色槽位' });
      return;
    }

    const result = await releaseVolcSpeakerIdForDevice({
      speakerId,
      ownerDeviceId
    });

    if (result.reason === 'forbidden') {
      sendJson(res, 403, { error: '只能释放当前 deviceId 自己占用的火山 speaker_id' });
      return;
    }

    sendJson(res, 200, {
      ok: true,
      released: result.released
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '火山音色槽位释放失败' });
  }
}

async function transcribeSiliconFlowVoiceReference({ apiKey, file, requestId }) {
  const requestUrl = `${SILICONFLOW_API_BASE_URL}/audio/transcriptions`;
  const formData = new FormData();
  formData.append('file', file, file.name || 'voice-sample.wav');
  formData.append('model', SILICONFLOW_ASR_MODEL);

  const response = await fetch(requestUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`
    },
    body: formData,
    signal: AbortSignal.timeout(Math.min(SILICONFLOW_VOICE_UPLOAD_TIMEOUT_MS, DOUYIN_ASR_TIMEOUT_MS))
  });

  const responseText = await response.text();
  let json = null;
  try {
    json = responseText ? JSON.parse(responseText) : null;
  } catch {}

  const transcriptText = readValue(json?.text, json?.result, json?.transcript);
  return {
    ok: response.ok && !!transcriptText,
    upstreamStatus: response.status,
    transcriptText,
    upstreamBodySummary: summarizeUpstreamBody(responseText),
    requestUrl,
  };
}

async function handleSiliconFlowVoiceUpload(req, res) {
  const requestId = createRequestId('sf_voice');
  const requestStartedAt = Date.now();
  let upstreamStatus = 0;
  let resolvedModel = DEFAULT_SILICONFLOW_VOICE_MODEL;
  let fileName = '';
  let fileSize = 0;

  try {
    if (!isMultipartFormRequest(req)) {
      sendJson(res, 400, { error: '参考音频上传失败：请求必须使用 multipart/form-data', requestId });
      return;
    }

    const body = await readSiliconFlowVoiceUploadFormBody(req);
    const apiKey = readValue(SERVER_CONFIG.siliconFlowApiKey, process.env.SILICONFLOW_API_KEY);
    const file = body.file;
    const customName = normalizeSiliconFlowCustomName(body.customName);
    const manualReferenceText = readValue(body.text);
    let referenceText = manualReferenceText;
    resolvedModel = readValue(body.model) || DEFAULT_SILICONFLOW_VOICE_MODEL;
    fileName = file?.name || '';
    fileSize = file?.size || 0;

    logSiliconFlowVoiceEvent({
      event: 'siliconflow_voice_upload_started',
      requestId,
      model: resolvedModel,
      fileName,
      fileSize,
      status: 'started',
      elapsedMs: 0,
      upstreamStatus: 0
    });

    if (shouldUseVoiceCloneMock({ mockMode: false })) {
      const mockUri = `speech:${sanitizeStoredFileName(customName) || 'mock_voice'}:${Date.now().toString(36)}`;
      logSiliconFlowVoiceEvent({
        event: 'siliconflow_voice_upload_succeeded',
        requestId,
        model: resolvedModel,
        fileName,
        fileSize,
        status: 'succeeded',
        elapsedMs: Date.now() - requestStartedAt,
        upstreamStatus: 200,
        voiceUri: mockUri,
        mock: true
      });
      sendJson(res, 200, { ok: true, mock: true, uri: mockUri, model: resolvedModel });
      return;
    }

    if (!apiKey) {
      logSiliconFlowVoiceEvent({
        level: 'error',
        event: 'siliconflow_voice_upload_failed',
        requestId,
        model: resolvedModel,
        fileName,
        fileSize,
        status: 'failed',
        elapsedMs: Date.now() - requestStartedAt,
        upstreamStatus: 0,
        failedStage: 'api_key_missing'
      });
      sendJson(res, 500, { error: '缺少 API key：服务端未配置 SILICONFLOW_API_KEY', requestId });
      return;
    }

    if (!(file instanceof File) || file.size <= 0) {
      logSiliconFlowVoiceEvent({
        level: 'error',
        event: 'siliconflow_voice_upload_failed',
        requestId,
        model: resolvedModel,
        fileName,
        fileSize,
        status: 'failed',
        elapsedMs: Date.now() - requestStartedAt,
        upstreamStatus: 0,
        failedStage: 'validate_request'
      });
      sendJson(res, 400, { error: '参考音频上传失败：缺少参考音频文件', requestId });
      return;
    }

    if (!customName) {
      logSiliconFlowVoiceEvent({
        level: 'error',
        event: 'siliconflow_voice_upload_failed',
        requestId,
        model: resolvedModel,
        fileName,
        fileSize,
        status: 'failed',
        elapsedMs: Date.now() - requestStartedAt,
        upstreamStatus: 0,
        failedStage: 'validate_request'
      });
      sendJson(res, 400, { error: '参考音频上传失败：缺少自定义声音名称 customName', requestId });
      return;
    }

    if (!referenceText) {
      const transcriptResult = await transcribeSiliconFlowVoiceReference({
        apiKey,
        file,
        requestId
      });

      upstreamStatus = transcriptResult.upstreamStatus;
      if (!transcriptResult.ok) {
        logSiliconFlowVoiceEvent({
          level: 'error',
          event: 'siliconflow_voice_upload_failed',
          requestId,
          model: resolvedModel,
          fileName,
          fileSize,
          status: 'failed',
          elapsedMs: Date.now() - requestStartedAt,
          upstreamStatus,
          failedStage: 'auto_transcribe_reference_audio',
          upstreamBodySummary: transcriptResult.upstreamBodySummary,
          asrModel: SILICONFLOW_ASR_MODEL
        });
        sendJson(res, upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502, {
          error: '参考音频上传失败：自动识别参考音频原文失败，请手动填写原文后重试',
          requestId,
          upstreamStatus,
          upstreamBodySummary: transcriptResult.upstreamBodySummary
        });
        return;
      }

      referenceText = transcriptResult.transcriptText;
    }

    const upstreamUrl = `${SILICONFLOW_API_BASE_URL}/uploads/audio/voice`;
    const formData = new FormData();
    formData.append('file', file, file.name || 'voice-sample.wav');
    formData.append('model', resolvedModel);
    formData.append('customName', customName);
    formData.append('text', referenceText);

    const upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`
      },
      body: formData,
      signal: AbortSignal.timeout(SILICONFLOW_VOICE_UPLOAD_TIMEOUT_MS)
    });

    upstreamStatus = upstreamRes.status;
    const responseText = await upstreamRes.text();
    let json = null;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {}

    const voiceUri = readValue(json?.uri, json?.data?.uri, json?.voice?.uri);
    if (!upstreamRes.ok) {
      const upstreamBodySummary = summarizeUpstreamBody(responseText);
      logSiliconFlowVoiceEvent({
        level: 'error',
        event: 'siliconflow_voice_upload_failed',
        requestId,
        model: resolvedModel,
        fileName,
        fileSize,
        status: 'failed',
        elapsedMs: Date.now() - requestStartedAt,
        upstreamStatus,
        failedStage: 'upstream_response',
        upstreamBodySummary
      });
      sendJson(res, upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502, {
        error: upstreamStatus >= 400 && upstreamStatus < 500
          ? '参考音频上传失败：参考音频文本不匹配或参数不合法'
          : '参考音频上传失败：SiliconFlow 服务暂时不可用',
        requestId,
        upstreamStatus,
        upstreamBodySummary
      });
      return;
    }

    if (!voiceUri) {
      const upstreamBodySummary = summarizeUpstreamBody(responseText);
      logSiliconFlowVoiceEvent({
        level: 'error',
        event: 'siliconflow_voice_upload_failed',
        requestId,
        model: resolvedModel,
        fileName,
        fileSize,
        status: 'failed',
        elapsedMs: Date.now() - requestStartedAt,
        upstreamStatus,
        failedStage: 'missing_voice_uri',
        upstreamBodySummary
      });
      sendJson(res, 502, {
        error: '参考音频上传失败：上游未返回可用的 voice uri',
        requestId,
        upstreamStatus,
        upstreamBodySummary
      });
      return;
    }

    logSiliconFlowVoiceEvent({
      event: 'siliconflow_voice_upload_succeeded',
      requestId,
      model: resolvedModel,
      fileName,
      fileSize,
      status: 'succeeded',
      elapsedMs: Date.now() - requestStartedAt,
      upstreamStatus,
      voiceUri,
      transcriptSource: manualReferenceText ? 'manual' : 'auto_asr'
    });
    await addVoiceToArchive({
      name: customName,
      provider: 'siliconflow',
      providerLabel: 'SiliconFlow 声音克隆',
      remoteVoiceId: voiceUri,
      engineModel: resolvedModel,
      createdAt: new Date().toISOString(),
    });
    sendJson(res, 200, {
      ok: true,
      uri: voiceUri,
      model: resolvedModel,
      requestId,
      referenceText,
      transcriptSource: manualReferenceText ? 'manual' : 'auto_asr'
    });
  } catch (error) {
    const isTimeout =
      error?.name === 'TimeoutError' ||
      error?.name === 'AbortError' ||
      /timed out|timeout|aborted/i.test(String(error?.message || ''));
    const isClientInputError =
      error?.message === '上传文件过大';
    logSiliconFlowVoiceEvent({
      level: 'error',
      event: 'siliconflow_voice_upload_failed',
      requestId,
      model: resolvedModel,
      fileName,
      fileSize,
      status: 'failed',
      elapsedMs: Date.now() - requestStartedAt,
      upstreamStatus,
      failedStage: isTimeout ? 'network_timeout' : 'network_error',
      message: error?.message || ''
    });
    sendJson(res, isClientInputError ? 400 : (isTimeout ? 504 : 502), {
      error: isClientInputError
        ? '参考音频上传失败：上传文件过大'
        : isTimeout
          ? '服务端网络错误或超时：参考音频上传到 SiliconFlow 超时'
          : '服务端网络错误或超时：参考音频上传失败',
      requestId,
      upstreamStatus
    });
  }
}

async function handleSiliconFlowTts(req, res) {
  const requestId = createRequestId('sf_tts');
  const requestStartedAt = Date.now();
  let upstreamStatus = 0;
  let resolvedModel = DEFAULT_SILICONFLOW_VOICE_MODEL;
  const fileName = '';
  const fileSize = 0;

  try {
    const body = await readRequestBody(req);
    const apiKey = readValue(SERVER_CONFIG.siliconFlowApiKey, process.env.SILICONFLOW_API_KEY);
    const input = readValue(body?.input);
    const voice = readValue(body?.voice);
    const responseFormat = normalizeSiliconFlowResponseFormat(body?.response_format);
    resolvedModel = readValue(body?.model) || DEFAULT_SILICONFLOW_VOICE_MODEL;

    logSiliconFlowVoiceEvent({
      event: 'siliconflow_tts_started',
      requestId,
      model: resolvedModel,
      fileName,
      fileSize,
      status: 'started',
      elapsedMs: 0,
      upstreamStatus: 0
    });

    if (shouldUseVoiceCloneMock(body)) {
      const wavBuffer = buildWaveFromPcm(createMockPcmBuffer(input), 24000, 1, 16);
      logSiliconFlowVoiceEvent({
        event: 'siliconflow_tts_succeeded',
        requestId,
        model: resolvedModel,
        fileName,
        fileSize,
        status: 'succeeded',
        elapsedMs: Date.now() - requestStartedAt,
        upstreamStatus: 200,
        voice,
        mock: true
      });
      sendWavResponse(res, wavBuffer);
      return;
    }

    if (!apiKey) {
      logSiliconFlowVoiceEvent({
        level: 'error',
        event: 'siliconflow_tts_failed',
        requestId,
        model: resolvedModel,
        fileName,
        fileSize,
        status: 'failed',
        elapsedMs: Date.now() - requestStartedAt,
        upstreamStatus: 0,
        failedStage: 'api_key_missing'
      });
      sendJson(res, 500, { error: '缺少 API key：服务端未配置 SILICONFLOW_API_KEY', requestId });
      return;
    }

    if (!input) {
      logSiliconFlowVoiceEvent({
        level: 'error',
        event: 'siliconflow_tts_failed',
        requestId,
        model: resolvedModel,
        fileName,
        fileSize,
        status: 'failed',
        elapsedMs: Date.now() - requestStartedAt,
        upstreamStatus: 0,
        failedStage: 'validate_request'
      });
      sendJson(res, 400, { error: '生成语音失败：缺少待合成文本 input', requestId });
      return;
    }

    if (!voice || !voice.startsWith('speech:')) {
      logSiliconFlowVoiceEvent({
        level: 'error',
        event: 'siliconflow_tts_failed',
        requestId,
        model: resolvedModel,
        fileName,
        fileSize,
        status: 'failed',
        elapsedMs: Date.now() - requestStartedAt,
        upstreamStatus: 0,
        failedStage: 'validate_voice_uri',
        voice
      });
      sendJson(res, 400, { error: 'voice uri 不存在或无效，请先重新上传参考音频', requestId });
      return;
    }

    const upstreamUrl = `${SILICONFLOW_API_BASE_URL}/audio/speech`;
    const upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        model: resolvedModel,
        input,
        voice,
        response_format: responseFormat
      }),
      signal: AbortSignal.timeout(SILICONFLOW_TTS_TIMEOUT_MS)
    });

    upstreamStatus = upstreamRes.status;
    if (!upstreamRes.ok) {
      const responseText = await upstreamRes.text();
      const upstreamBodySummary = summarizeUpstreamBody(responseText);
      logSiliconFlowVoiceEvent({
        level: 'error',
        event: 'siliconflow_tts_failed',
        requestId,
        model: resolvedModel,
        fileName,
        fileSize,
        status: 'failed',
        elapsedMs: Date.now() - requestStartedAt,
        upstreamStatus,
        failedStage: 'upstream_response',
        upstreamBodySummary,
        voice
      });
      sendJson(res, upstreamStatus >= 400 && upstreamStatus < 500 ? 400 : 502, {
        error: upstreamStatus >= 400 && upstreamStatus < 500
          ? '生成语音失败：voice uri 不存在、参数不合法，或 SiliconFlow 拒绝了本次请求'
          : '生成语音失败：SiliconFlow 服务暂时不可用',
        requestId,
        upstreamStatus,
        upstreamBodySummary
      });
      return;
    }

    const audioBuffer = Buffer.from(await upstreamRes.arrayBuffer());
    const contentType = readValue(upstreamRes.headers.get('content-type')) || (
      responseFormat === 'mp3'
        ? 'audio/mpeg'
        : responseFormat === 'pcm'
          ? 'audio/pcm'
          : 'audio/wav'
    );

    logSiliconFlowVoiceEvent({
      event: 'siliconflow_tts_succeeded',
      requestId,
      model: resolvedModel,
      fileName,
      fileSize,
      status: 'succeeded',
      elapsedMs: Date.now() - requestStartedAt,
      upstreamStatus,
      voice
    });
    sendAudioResponse(res, audioBuffer, contentType);
  } catch (error) {
    const isTimeout =
      error?.name === 'TimeoutError' ||
      error?.name === 'AbortError' ||
      /timed out|timeout|aborted/i.test(String(error?.message || ''));
    const isClientInputError =
      error?.message === '请求体不是合法 JSON' ||
      error?.message === '请求体过大';
    logSiliconFlowVoiceEvent({
      level: 'error',
      event: 'siliconflow_tts_failed',
      requestId,
      model: resolvedModel,
      fileName,
      fileSize,
      status: 'failed',
      elapsedMs: Date.now() - requestStartedAt,
      upstreamStatus,
      failedStage: isTimeout ? 'network_timeout' : 'network_error',
      message: error?.message || ''
    });
    sendJson(res, isClientInputError ? 400 : (isTimeout ? 504 : 502), {
      error: isClientInputError
        ? `生成语音失败：${error?.message || '请求参数不合法'}`
        : isTimeout
          ? '服务端网络错误或超时：SiliconFlow 生成语音超时'
          : '服务端网络错误或超时：生成语音失败',
      requestId,
      upstreamStatus
    });
  }
}

async function handleDoubaoMultimodal(req, res) {
  const upstreamUrl = 'https://ark.cn-beijing.volces.com/api/v3/responses';
  let stage = 'init';
  let shouldStream = false;
  let waitingHeartbeat = null;
  const requestId = randomBytes(6).toString('hex');
  const requestStartedAt = Date.now();

  try {
    stage = 'read_body';
    const body = isMultipartFormRequest(req)
      ? await readMultipartFormBody(req)
      : await readRequestBody(req);
    const { model, image, imageMimeType, video, videoMimeType, question, history, mediaKind, file, files, filesKinds } = body;
    shouldStream = wantsDoubaoStream(body, req);
    const resolvedApiKey = readValue(SERVER_CONFIG.arkApiKey);
    const resolvedQuestion = readValue(question);
    const resolvedModel = readValue(model) || DEFAULT_DOUBAO_MULTIMODAL_MODEL;
    const hasUploadedFile = file instanceof File && file.size > 0;
    const hasMultipleFiles = Array.isArray(files) && files.length > 0;

    console.log('[doubao multimodal] request start', {
      requestId,
      stage,
      stream: shouldStream,
      model: resolvedModel,
      hasImageField: !!readValue(image),
      hasVideoField: !!readValue(video),
      hasUploadedFile,
      hasMultipleFiles: hasMultipleFiles ? files.length : false,
      mediaKind: mediaKind || '',
      fileName: file?.name || '',
      fileType: file?.type || '',
      fileSize: file?.size || 0
    });

    if (!resolvedApiKey) {
      sendJson(res, 500, { error: '服务端未配置 ARK_API_KEY' });
      return;
    }

    if (!resolvedQuestion) {
      sendJson(res, 400, { error: '缺少文本问题 question' });
      return;
    }

    if ((readValue(image) && readValue(video)) || (hasUploadedFile && (readValue(image) || readValue(video)))) {
      sendJson(res, 400, { error: '当前一次请求仅支持携带一张图片或一个视频，请二选一上传。' });
      return;
    }

    const promptText = buildDoubaoPromptWithHistory(resolvedQuestion, history);
    const content = [];

    if (readValue(image)) {
      stage = 'normalize_image';
      let normalizedImage;
      try {
        normalizedImage = normalizeBase64ImageInput(image, imageMimeType);
      } catch (error) {
        sendJson(res, 400, { error: error.message || '图片数据不合法' });
        return;
      }

      content.push({
        type: 'input_image',
        image_url: normalizedImage.imageUrl
      });
    }

    if (readValue(video)) {
      stage = 'normalize_video';
      let normalizedVideo;
      try {
        normalizedVideo = normalizeBase64VideoInput(video, videoMimeType);
      } catch (error) {
        sendJson(res, 400, { error: error.message || '视频数据不合法' });
        return;
      }

      content.push({
        type: 'input_video',
        video_url: normalizedVideo.videoUrl
      });
    }

    if (hasMultipleFiles) {
      stage = 'normalize_uploaded_media_multiple';
      for (let index = 0; index < files.length; index += 1) {
        const currentFile = files[index];
        const resolvedMediaKind =
          Array.isArray(filesKinds) && filesKinds[index]
            ? filesKinds[index]
            : String(currentFile.type || '').startsWith('image/')
              ? 'image'
              : 'video';
        const canExposePublicVideoUrl = resolvedMediaKind === 'video' && !!resolvePublicBaseUrl(req);
        const shouldPreferPublicVideoUrl =
          resolvedMediaKind === 'video' &&
          canExposePublicVideoUrl &&
          currentFile.size > MAX_VIDEO_ORIGINAL_UPLOAD_BYTES;

        console.log('[doubao multimodal] media route selected', {
          requestId,
          stage,
          index,
          mediaKind: resolvedMediaKind,
          fileName: currentFile.name || '',
          fileType: currentFile.type || '',
          fileSize: currentFile.size || 0,
          canExposePublicVideoUrl,
          shouldPreferPublicVideoUrl,
          inlineVideoLimit: MAX_VIDEO_ORIGINAL_UPLOAD_BYTES
        });

        if (shouldPreferPublicVideoUrl) {
          stage = 'create_public_media_url';
          const publicMedia = await createPublicMediaUrl({ file: currentFile, req });
          if (!publicMedia.ok) {
            sendJson(res, 400, {
              error: publicMedia.error,
              debug: {
                stage,
                index,
                fileSize: currentFile.size
              }
            });
            return;
          }

          console.log('[doubao multimodal] using public video url', {
            requestId,
            stage,
            index,
            fileName: currentFile.name || '',
            originalFileSize: publicMedia.originalSize,
            compressionTriggered: publicMedia.compressionTriggered,
            compressedFileSize: publicMedia.finalSize,
            publicVideoUrl: publicMedia.url
          });

          content.push({
            type: 'input_video',
            video_url: publicMedia.url
          });
        } else {
          const compressedFile = await compressMediaForArk(currentFile, resolvedMediaKind);
          const normalizedUploadedMedia = await normalizeUploadedMediaInput(compressedFile, resolvedMediaKind);

          content.push(
            resolvedMediaKind === 'image'
              ? {
                  type: 'input_image',
                  image_url: normalizedUploadedMedia.imageUrl
                }
              : {
                  type: 'input_video',
                  video_url: normalizedUploadedMedia.videoUrl
                }
          );
        }

        if (resolvedMediaKind === 'video' && currentFile.size > MAX_VIDEO_ORIGINAL_UPLOAD_BYTES && !canExposePublicVideoUrl) {
          sendJson(res, 400, {
            error: '当前环境没有可供方舟访问的公网地址。请配置 PUBLIC_BASE_URL 为你的线上域名或可公网访问的隧道地址，再重试大视频分析。',
            debug: {
              stage: 'missing_public_base_url_for_large_video',
              index,
              fileSize: currentFile.size,
              maxInlineVideoSize: MAX_VIDEO_ORIGINAL_UPLOAD_BYTES
            }
          });
          return;
        }
      }
    } else if (hasUploadedFile) {
      stage = 'normalize_uploaded_media';
      const resolvedMediaKind = mediaKind === 'image' ? 'image' : 'video';
      const canExposePublicVideoUrl = resolvedMediaKind === 'video' && !!resolvePublicBaseUrl(req);
      const shouldPreferPublicVideoUrl =
        resolvedMediaKind === 'video' &&
        canExposePublicVideoUrl &&
        file.size > MAX_VIDEO_ORIGINAL_UPLOAD_BYTES;

      console.log('[doubao multimodal] media route selected', {
        requestId,
        stage,
        mediaKind: resolvedMediaKind,
        fileName: file.name || '',
        fileType: file.type || '',
        fileSize: file.size || 0,
        canExposePublicVideoUrl,
        shouldPreferPublicVideoUrl,
        inlineVideoLimit: MAX_VIDEO_ORIGINAL_UPLOAD_BYTES
      });

      if (shouldPreferPublicVideoUrl) {
        stage = 'create_public_media_url';
        const publicMedia = await createPublicMediaUrl({ file, req });
        if (!publicMedia.ok) {
          sendJson(res, 400, {
            error: publicMedia.error,
            debug: {
              stage,
              fileSize: file.size
            }
          });
          return;
        }

        console.log('[doubao multimodal] using public video url', {
          requestId,
          stage,
          fileName: file.name || '',
          originalFileSize: publicMedia.originalSize,
          compressionTriggered: publicMedia.compressionTriggered,
          compressedFileSize: publicMedia.finalSize,
          publicVideoUrl: publicMedia.url
        });

        content.push({
          type: 'input_video',
          video_url: publicMedia.url
        });
      } else {
        const compressedFile = await compressMediaForArk(file, resolvedMediaKind);
        const normalizedUploadedMedia = await normalizeUploadedMediaInput(compressedFile, resolvedMediaKind);

        content.push(
          resolvedMediaKind === 'image'
            ? {
                type: 'input_image',
                image_url: normalizedUploadedMedia.imageUrl
              }
            : {
                type: 'input_video',
                video_url: normalizedUploadedMedia.videoUrl
              }
        );
      }

      if (resolvedMediaKind === 'video' && file.size > MAX_VIDEO_ORIGINAL_UPLOAD_BYTES && !canExposePublicVideoUrl) {
        sendJson(res, 400, {
          error: '当前环境没有可供方舟访问的公网地址。请配置 PUBLIC_BASE_URL 为你的线上域名或可公网访问的隧道地址，再重试大视频分析。',
          debug: {
            stage: 'missing_public_base_url_for_large_video',
            fileSize: file.size,
            maxInlineVideoSize: MAX_VIDEO_ORIGINAL_UPLOAD_BYTES
          }
        });
        return;
      }
    }

    content.push({
      type: 'input_text',
      text: promptText
    });

    const requestPayload = {
      model: resolvedModel,
      stream: shouldStream,
      input: [
        {
          role: 'user',
          content
        }
      ]
    };
    const requestInit = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(DOUBAO_MULTIMODAL_TIMEOUT_MS)
    };

    console.log('[doubao multimodal] request payload', {
      requestId,
      model: resolvedModel,
      stream: shouldStream,
      contentLength: content.length,
      contentTypes: content.map((c) => c.type),
      promptPreview: promptText.slice(0, 100)
    });

    if (shouldStream) {
      stage = 'open_stream_to_client';
      startSseResponse(res);
      console.log('[doubao multimodal] sse opened', {
        requestId,
        stage,
        elapsedMs: Date.now() - requestStartedAt
      });
      writeSseEvent(res, 'status', { stage: 'connecting_upstream' });
      waitingHeartbeat = setInterval(() => {
        try {
          res.write(': waiting_upstream\n\n');
        } catch {}
      }, 15000);
    }

    stage = 'request_upstream';
    const upstreamRes = await fetch(upstreamUrl, requestInit);

    if (waitingHeartbeat) {
      clearInterval(waitingHeartbeat);
      waitingHeartbeat = null;
    }

    const upstreamContentType = String(upstreamRes.headers.get('content-type') || '').toLowerCase();
    console.log('[doubao multimodal] upstream response received', {
      requestId,
      stage,
      upstreamStatus: upstreamRes.status,
      upstreamContentType,
      elapsedMs: Date.now() - requestStartedAt
    });

    if (shouldStream && upstreamRes.ok && upstreamContentType.includes('text/event-stream')) {
      stage = 'proxy_stream';
      console.log('[doubao multimodal] proxying upstream sse', {
        requestId,
        stage,
        elapsedMs: Date.now() - requestStartedAt
      });
      writeSseEvent(res, 'status', { stage: 'streaming_response' });
      await proxySseStreamToClient(upstreamRes, req, res, { skipInitialHeaders: true, requestId });
      return;
    }

    stage = 'read_upstream_response';
    const responseText = await upstreamRes.text();
    let json = null;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {}

    console.log('[doubao multimodal] upstream json parsed', {
      requestId,
      hasOutputText: typeof json?.output_text === 'string',
      hasOutput: Array.isArray(json?.output),
      hasChoices: Array.isArray(json?.choices),
      hasAnswer: typeof json?.answer === 'string',
      keys: json && typeof json === 'object' ? Object.keys(json) : [],
      firstChoiceKeys: json?.choices?.[0] ? Object.keys(json.choices[0]) : [],
      extractedLength: extractResponsesText(json).length
    });

    if (!upstreamRes.ok) {
      console.error('[doubao multimodal] upstream non-200 response', {
        requestId,
        stage,
        status: upstreamRes.status,
        contentType: upstreamContentType,
        hasUploadedFile,
        mediaKind,
        fileName: file?.name || '',
        fileType: file?.type || '',
        fileSize: file?.size || 0,
        bodyKeys: body && typeof body === 'object' ? Object.keys(body) : [],
        upstreamBody: responseText
      });
      const rawError = json?.error?.message || json?.message || json?.code || '';
      const zhError = translateUpstreamError(rawError, `方舟 API 请求失败（状态码 ${upstreamRes.status}）`);
      if (shouldStream) {
        writeSseEvent(res, 'error', { error: zhError, upstream: json || responseText });
        res.end();
        return;
      }
      sendJson(res, upstreamRes.status, {
        error: zhError,
        upstream: json || responseText
      });
      return;
    }

    if (shouldStream) {
      console.log('[doubao multimodal] request complete', {
        requestId,
        stage,
        streamed: false,
        answerLength: extractResponsesText(json).length,
        elapsedMs: Date.now() - requestStartedAt
      });
      writeSseEvent(res, 'answer.done', {
        answer: extractResponsesText(json)
      });
      res.end();
      return;
    }

    const extractedAnswer = extractResponsesText(json);
    console.log('[doubao multimodal] request complete', {
      requestId,
      stage,
      streamed: false,
      answerLength: extractedAnswer.length,
      elapsedMs: Date.now() - requestStartedAt
    });
    sendJson(res, 200, {
      ok: true,
      model: resolvedModel,
      answer: extractedAnswer,
      response: json,
      debug: !extractedAnswer ? {
        responseKeys: json && typeof json === 'object' ? Object.keys(json) : [],
        firstChoiceKeys: json?.choices?.[0] ? Object.keys(json.choices[0]) : [],
        firstOutputKeys: json?.output?.[0] ? Object.keys(json.output[0]) : []
      } : undefined
    });
  } catch (error) {
    if (typeof waitingHeartbeat !== 'undefined' && waitingHeartbeat) {
      clearInterval(waitingHeartbeat);
    }
    console.error('[doubao multimodal] request failed', {
      requestId,
      stage,
      message: error?.message || '',
      stack: error?.stack || '',
      contentType: req.headers['content-type'] || '',
      contentLength: req.headers['content-length'] || '',
      method: req.method || '',
      url: req.url || '',
      elapsedMs: Date.now() - requestStartedAt
    });
    const isBodyParseOrSizeError =
      error.message === '请求体不是合法 JSON' ||
      error.message === '请求体过大' ||
      error.message === '上传文件过大';
    const isNetworkOrTimeoutError =
      error?.name === 'TimeoutError' ||
      error?.name === 'AbortError' ||
      /network|fetch failed|terminated|socket|connection|econn|timeout|timed out|aborted/i.test(String(error?.message || ''));

    const zhError = isBodyParseOrSizeError
      ? error.message
      : isNetworkOrTimeoutError
        ? '豆包连接偶发中断或超时，系统已尝试兜底重试；如果仍失败，请稍后再试。'
        : translateUpstreamError(error?.message, `豆包请求失败，请稍后重试。`);

    if (shouldStream) {
      writeSseEvent(res, 'error', { error: zhError, debug: { originalMessage: error?.message || '', stage } });
      res.end();
      return;
    }

    sendJson(res, isBodyParseOrSizeError ? 400 : (isNetworkOrTimeoutError ? 504 : 500), {
      error: zhError,
      debug: { originalMessage: error?.message || '', stage }
    });
  }
}

function extractSeedanceVideoUrl(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const visited = new Set();
  const queue = [payload];

  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);

    if (Array.isArray(current)) {
      queue.push(...current);
      continue;
    }

    const record = current;
    const directUrl = readValue(record.video_url, record.videoUrl);
    if (/^https?:\/\//i.test(directUrl)) return directUrl;

    if (record.video_url && typeof record.video_url === 'object') {
      const url = readValue(record.video_url.url, record.video_url.uri);
      if (/^https?:\/\//i.test(url)) return url;
    }

    if (record.output && typeof record.output === 'object') queue.push(record.output);
    if (record.result && typeof record.result === 'object') queue.push(record.result);
    if (record.data && typeof record.data === 'object') queue.push(record.data);
    if (record.content && typeof record.content === 'object') queue.push(record.content);
  }

  return '';
}

function extractSeedanceStatus(payload) {
  if (!payload || typeof payload !== 'object') return '';
  const record = payload;
  return readValue(
    record.status,
    record.state,
    record.task_status,
    record.taskStatus,
    record.data?.status,
    record.data?.state,
    record.response?.status
  );
}

async function handleSeedanceGetTask(req, res, taskId) {
  const requestId = randomBytes(6).toString('hex');
  const startedAt = Date.now();

  try {
    const resolvedApiKey = readValue(SERVER_CONFIG.seedanceApiKey);
    const normalizedTaskId = readValue(taskId);

    if (!resolvedApiKey) {
      sendJson(res, 500, { error: '服务端未配置 SEEDANCE_API_KEY' });
      return;
    }

    if (!normalizedTaskId) {
      sendJson(res, 400, { error: '缺少视频生成任务 ID' });
      return;
    }

    const upstreamUrl = `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${encodeURIComponent(normalizedTaskId)}`;
    const upstreamRes = await fetch(upstreamUrl, {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${resolvedApiKey}`
      },
      signal: AbortSignal.timeout(60 * 1000)
    });
    const responseText = await upstreamRes.text();
    let json = null;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {}

    if (!upstreamRes.ok) {
      console.error('[seedance get task] upstream non-200 response', {
        requestId,
        taskId: normalizedTaskId,
        status: upstreamRes.status,
        upstreamBody: responseText,
        elapsedMs: Date.now() - startedAt
      });
      const rawError = json?.error?.message || json?.message || json?.code || '';
      sendJson(res, upstreamRes.status, {
        error: translateUpstreamError(rawError, `Seedance 查询任务失败（状态码 ${upstreamRes.status}）`),
        upstream: json || responseText
      });
      return;
    }

    const status = extractSeedanceStatus(json);
    const videoUrl = extractSeedanceVideoUrl(json);

    sendJson(res, 200, {
      ok: true,
      taskId: normalizedTaskId,
      status,
      videoUrl,
      createdAt: Number(json?.created_at || json?.data?.created_at || 0) || undefined,
      updatedAt: Number(json?.updated_at || json?.data?.updated_at || 0) || undefined,
      executionExpiresAfter: Number(json?.execution_expires_after || json?.data?.execution_expires_after || 0) || undefined,
      response: json
    });
  } catch (error) {
    console.error('[seedance get task] request failed', {
      requestId,
      taskId,
      message: error?.message || '',
      stack: error?.stack || '',
      elapsedMs: Date.now() - startedAt
    });
    sendJson(res, 500, {
      error: translateUpstreamError(error?.message, 'Seedance 查询任务失败，请稍后重试。'),
      debug: { originalMessage: error?.message || '' }
    });
  }
}

async function handleSeedanceCreateTask(req, res) {
  const upstreamUrl = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
  const requestId = randomBytes(6).toString('hex');
  const startedAt = Date.now();

  try {
    const body = isMultipartFormRequest(req)
      ? await readSeedanceTaskFormBody(req)
      : await readRequestBody(req);
    const resolvedApiKey = readValue(SERVER_CONFIG.seedanceApiKey);
    const prompt = readValue(body?.prompt);
    const model = readValue(body?.model) || 'doubao-seedance-2-0-260128';
    const ratio = readValue(body?.ratio) || '16:9';
    const duration = Number.parseInt(String(body?.duration || 5), 10);
    const generateAudio = body?.generateAudio !== false;
    const watermark = body?.watermark === true;
    const uploadedFiles = Array.isArray(body?.files) ? body.files : [];

    console.log('[seedance create task] request start', {
      requestId,
      model,
      ratio,
      duration,
      generateAudio,
      watermark,
      promptLength: prompt.length,
      fileCount: uploadedFiles.length
    });

    if (!resolvedApiKey) {
      sendJson(res, 500, { error: '服务端未配置 SEEDANCE_API_KEY' });
      return;
    }

    if (!prompt) {
      sendJson(res, 400, { error: '缺少视频生成提示词 prompt' });
      return;
    }

    if (!['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'].includes(ratio)) {
      sendJson(res, 400, { error: 'ratio 取值不合法' });
      return;
    }

    if (!Number.isInteger(duration) || duration < 4 || duration > 15) {
      sendJson(res, 400, { error: 'Seedance 2.0 的 duration 需为 4 到 15 秒之间的整数' });
      return;
    }

    if (uploadedFiles.length > 13) {
      sendJson(res, 400, { error: '参考素材最多支持 9 张图片、3 个视频、3 段音频，请减少上传数量。' });
      return;
    }

    let imageCount = 0;
    let videoCount = 0;
    let audioCount = 0;
    const content = [
      {
        type: 'text',
        text: prompt
      }
    ];

    for (const file of uploadedFiles) {
      const mimeType = readValue(file.type);

      if (mimeType.startsWith('image/')) {
        imageCount += 1;
        if (imageCount > 9) {
          sendJson(res, 400, { error: 'Seedance 2.0 最多支持 9 张参考图片。' });
          return;
        }
        const compressedFile = await compressMediaForArk(file, 'image');
        const normalized = await normalizeUploadedMediaInput(compressedFile, 'image');
        content.push({
          type: 'image_url',
          image_url: {
            url: normalized.imageUrl
          },
          role: 'reference_image'
        });
        continue;
      }

      if (mimeType.startsWith('video/')) {
        videoCount += 1;
        if (videoCount > 3) {
          sendJson(res, 400, { error: 'Seedance 2.0 最多支持 3 个参考视频。' });
          return;
        }
        if (file.size > 50 * 1024 * 1024) {
          sendJson(res, 400, { error: 'Seedance 参考视频单个文件不能超过 50MB。' });
          return;
        }
        // Seedance API requires video references to be public web URLs, not base64 data URLs
        const mediaResult = await createPublicMediaUrl({ file, req });
        if (!mediaResult.ok) {
          sendJson(res, 400, { error: mediaResult.error || '视频参考上传失败，请检查 PUBLIC_BASE_URL 配置。' });
          return;
        }
        content.push({
          type: 'video_url',
          video_url: {
            url: mediaResult.url
          },
          role: 'reference_video'
        });
        continue;
      }

      if (mimeType.startsWith('audio/')) {
        audioCount += 1;
        if (audioCount > 3) {
          sendJson(res, 400, { error: 'Seedance 2.0 最多支持 3 段参考音频。' });
          return;
        }
        if (file.size > 15 * 1024 * 1024) {
          sendJson(res, 400, { error: 'Seedance 参考音频单个文件不能超过 15MB。' });
          return;
        }
        const normalized = await normalizeUploadedAudioInput(file);
        content.push({
          type: 'audio_url',
          audio_url: {
            url: normalized.audioUrl
          },
          role: 'reference_audio'
        });
        continue;
      }

      sendJson(res, 400, { error: `不支持的参考素材格式：${file.name || mimeType || '未知文件'}` });
      return;
    }

    if (audioCount > 0 && imageCount === 0 && videoCount === 0) {
      sendJson(res, 400, { error: 'Seedance 不支持单独输入音频，请至少再上传 1 张图片或 1 个视频。' });
      return;
    }

    // ── Seedance 视频参考 URL 自检 ──
    const referenceVideoUrls = content
      .filter((item) => item.type === 'video_url' && item.role === 'reference_video')
      .map((item) => item.video_url?.url)
      .filter(Boolean);

    if (referenceVideoUrls.length > 0) {
      console.log('[seedance create task] reference_video URLs check', {
        requestId,
        count: referenceVideoUrls.length,
        urls: referenceVideoUrls,
      });

      for (const url of referenceVideoUrls) {
        if (!/^https?:\/\//i.test(url)) {
          console.error('[seedance create task] reference_video URL is NOT a valid web URL', { requestId, url });
          sendJson(res, 400, { error: `视频参考地址不是有效的公网 URL：${url}` });
          return;
        }

        // 非阻塞 HEAD 探活：验证 URL 是否可被外部访问
        // eslint-disable-next-line no-loop-func
        fetch(url, { method: 'HEAD', signal: AbortSignal.timeout(8000) })
          .then((headRes) => {
            if (!headRes.ok) {
              console.warn('[seedance create task] reference_video URL HEAD probe failed', {
                requestId, url, status: headRes.status, statusText: headRes.statusText,
              });
            } else {
              console.log('[seedance create task] reference_video URL HEAD probe OK', {
                requestId, url, contentLength: headRes.headers.get('content-length'),
              });
            }
          })
          .catch((err) => {
            console.warn('[seedance create task] reference_video URL HEAD probe error', {
              requestId, url, error: err?.message,
            });
          });
      }
    }

    const requestPayload = {
      model,
      content,
      generate_audio: generateAudio,
      ratio,
      duration,
      watermark
    };

    console.log('[seedance create task] upstream payload preview', {
      requestId,
      contentTypes: content.map((c) => ({ type: c.type, role: c.role })),
      referenceVideoCount: referenceVideoUrls.length,
    });

    const upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedApiKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(60 * 1000)
    });
    const responseText = await upstreamRes.text();
    let json = null;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {}

    if (!upstreamRes.ok) {
      console.error('[seedance create task] upstream non-200 response', {
        requestId,
        status: upstreamRes.status,
        upstreamBody: responseText,
        elapsedMs: Date.now() - startedAt
      });
      const rawError = json?.error?.message || json?.message || json?.code || '';
      sendJson(res, upstreamRes.status, {
        error: translateUpstreamError(rawError, `Seedance 创建任务失败（状态码 ${upstreamRes.status}）`),
        upstream: json || responseText
      });
      return;
    }

    const taskId = readValue(json?.id, json?.data?.id, json?.task_id, json?.taskId);
    console.log('[seedance create task] request complete', {
      requestId,
      taskId,
      elapsedMs: Date.now() - startedAt
    });

    sendJson(res, 200, {
      ok: true,
      taskId,
      response: json
    });
  } catch (error) {
    console.error('[seedance create task] request failed', {
      requestId,
      message: error?.message || '',
      stack: error?.stack || '',
      elapsedMs: Date.now() - startedAt
    });
    const isBodyParseError = error?.message === '请求体不是合法 JSON';
    sendJson(res, isBodyParseError ? 400 : 500, {
      error: isBodyParseError ? error.message : translateUpstreamError(error?.message, 'Seedance 创建任务失败，请稍后重试。'),
      debug: { originalMessage: error?.message || '' }
    });
  }
}

async function handleDouyinResolveDownload(req, res) {
  const requestId = createRequestId('douyin');
  const startedAt = Date.now();

  try {
    const body = await readRequestBody(req);
    const input = normalizeDouyinInput(body?.input);

    if (!input) {
      sendJson(res, 400, { ok: false, error: '请先粘贴链接或整段分享文本。' });
      return;
    }

    console.log('[douyin resolve] request received', { requestId, inputLength: input.length });

    // Try universal extract first (supports all platforms)
    const apiKey = readValue(SERVER_CONFIG.tikhubApiToken);
    if (apiKey) {
      try {
        // Extract any URL from input
        const extracted = pickPreferredDouyinUrl(input);
        const url = extracted.url || extractFirstUrl(input);

        if (url) {
          const data = await extractByUrlUniversal({ apiKey, baseUrl: TIKHUB_API_BASE_URL, url });
          const normalized = normalizeUniversalExtractResult(data, { sourceUrl: url });
          let normalizedDownloadCandidates = normalizeDouyinDownloadCandidates(
            normalized.videoUrlCandidates || [],
            normalized.videoUrls[0] || ''
          );
          let selectedDownloadCandidate = pickBestDouyinDownloadCandidate(normalizedDownloadCandidates);
          let selectedDownloadUrl = selectedDownloadCandidate?.url || normalized.videoUrls[0] || '';

          if (normalized.platform === 'douyin' && !normalizedDownloadCandidates.some((candidate) => candidate?.hasAudio === true)) {
            try {
              const highQualityResult = await callTikHubHighQualityPlayUrl({
                shareUrl: url,
                requestId,
                deadlineAt: Date.now() + 8000
              });
              normalizedDownloadCandidates = normalizeDouyinDownloadCandidates(
                [
                  ...(highQualityResult?.downloadUrlCandidates || []),
                  ...normalizedDownloadCandidates
                ],
                highQualityResult?.downloadUrl || selectedDownloadUrl
              );
              const audioCandidates = normalizedDownloadCandidates.filter((candidate) => candidate?.hasAudio === true);
              selectedDownloadCandidate = pickBestDouyinDownloadCandidate(
                audioCandidates.length > 0 ? audioCandidates : normalizedDownloadCandidates
              );
              selectedDownloadUrl = selectedDownloadCandidate?.url || highQualityResult?.downloadUrl || selectedDownloadUrl;
            } catch (highQualityError) {
              console.warn('[douyin resolve] high quality audio candidate failed, keeping universal candidates', {
                requestId,
                message: highQualityError.message
              });
            }
          }

          console.log('[douyin resolve] universal extract success', {
            requestId,
            platform: normalized.platform,
            selectedPreviewHost: selectedDownloadCandidate?.host || getHostnameFromUrl(selectedDownloadUrl),
            candidateCount: normalizedDownloadCandidates.length,
            elapsedMs: Date.now() - startedAt
          });

          sendJson(res, 200, {
            ok: true,
            platform: normalized.platform,
            title: normalized.title,
            desc: normalized.desc,
            authorName: normalized.authorName,
            duration: normalized.duration,
            videoUrls: normalized.videoUrls,
            videoUrlCandidates: normalized.videoUrlCandidates,
            images: [],
            tags: normalized.tags,
            sourceUrl: normalized.sourceUrl,
            // Legacy compatibility
            videoId: '',
            downloadUrl: selectedDownloadUrl,
            downloadUrlCandidates: serializeDouyinDownloadCandidates(normalizedDownloadCandidates, selectedDownloadUrl),
            caption: normalized.desc || '',
            fallbackCaption: normalized.title || '',
            fallbackCaptionSource: 'universal',
            normalizedUrl: normalized.sourceUrl,
            sourceType: extracted.sourceType || 'universal',
            resolveStrategy: 'universal_extract'
          });
          return;
        }
      } catch (universalError) {
        console.warn('[douyin resolve] universal extract failed, falling back to legacy', {
          requestId,
          message: universalError.message
        });
      }
    }

    // Legacy fallback for Douyin-only links
    const extracted = pickPreferredDouyinUrl(input);
    const originalUrl = extracted.url;
    if (!originalUrl) {
      sendJson(res, 400, { ok: false, error: '该分享内容未能识别出有效链接。' });
      return;
    }

    let redirectInfo;
    const preExtractedAwemeId = extractDouyinAwemeId(originalUrl);
    if (preExtractedAwemeId && !/v\.douyin\.com/i.test(originalUrl)) {
      redirectInfo = { finalUrl: originalUrl, normalizedUrl: originalUrl, awemeId: preExtractedAwemeId, contentType: 'text/html' };
    } else {
      try {
        redirectInfo = await resolveRedirectedUrl(originalUrl);
      } catch {
        sendJson(res, 400, { ok: false, error: '短链接展开失败，请稍后重试或改用网页完整链接。' });
        return;
      }
    }

    const normalizedUrl = redirectInfo.normalizedUrl || redirectInfo.finalUrl || originalUrl;
    const awemeId = redirectInfo.awemeId || extractDouyinAwemeId(normalizedUrl);

    if (!awemeId) {
      sendJson(res, 400, { ok: false, error: '短链接已展开，但目标不是标准作品页，暂时无法提取作品 id。' });
      return;
    }

    const result = await resolveDouyinDownloadPrimary({ originalUrl, normalizedUrl, awemeId, requestId });

    console.log('[douyin resolve] legacy result', {
      requestId,
      downloadUrl: result.downloadUrl,
      candidateCount: result.downloadUrlCandidates?.length || 0,
      resolveStrategy: result.resolveStrategy
    });

    sendJson(res, 200, {
      ok: true,
      videoId: result.videoId || awemeId,
      title: result.title || '',
      downloadUrl: result.downloadUrl,
      downloadUrlCandidates: serializeDouyinDownloadCandidates(result.downloadUrlCandidates || [], result.downloadUrl),
      caption: result.caption || '',
      fallbackCaption: result.fallbackCaption || '',
      fallbackCaptionSource: result.fallbackCaptionSource || 'none',
      authorName: result.authorName || '',
      duration: result.duration || 0,
      videoData: result.videoData,
      normalizedUrl: result.normalizedUrl || normalizedUrl || originalUrl,
      sourceType: extracted.sourceType,
      resolveStrategy: result.resolveStrategy
    });
  } catch (error) {
    console.error('[douyin resolve] request failed', { requestId, message: error.message });
    sendJson(res, error?.statusCode || 500, {
      ok: false,
      error: error?.message || '视频解析失败'
    });
  }
}

async function handleDouyinExtractTranscript(req, res) {
  const requestId = createRequestId('dy_asr');
  const startedAt = Date.now();
  const transcriptDeadlineAt = startedAt + DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS;
  const tempFiles = [];
  let extracted = null;
  let redirectInfo = null;
  let resolved = null;
  let videoPath = '';
  let audioPath = '';
  let audioSegments = [];

  try {
    const body = await readRequestBody(req);
    const input = normalizeDouyinInput(body?.input);
    if (!input) {
      sendJson(res, 400, {
        ok: false,
        transcriptOk: false,
        error: '请先粘贴抖音链接或整段分享文本。'
      });
      return;
    }

    extracted = pickPreferredDouyinUrl(input);
    if (!extracted.url) {
      sendJson(res, 400, {
        ok: false,
        transcriptOk: false,
        error: '该分享内容未能识别出有效抖音作品链接。'
      });
      return;
    }

    const resolveStartedAt = Date.now();
    const resolveDeadlineAt = createStageDeadlineAt({
      stageStartedAt: resolveStartedAt,
      stageTimeoutMs: DOUYIN_VIDEO_RESOLVE_TIMEOUT_MS,
      parentDeadlineAt: transcriptDeadlineAt
    });
    const resolveTimeoutMs = Math.max(1, resolveDeadlineAt - resolveStartedAt);

    redirectInfo = await resolveRedirectedUrl(extracted.url, resolveDeadlineAt);
    const apiKey = readValue(SERVER_CONFIG.tikhubApiToken);
    try {
      resolved = await resolveDouyinDownloadPrimary({
        originalUrl: extracted.url,
        normalizedUrl: redirectInfo.normalizedUrl || redirectInfo.finalUrl || extracted.url,
        awemeId: redirectInfo.awemeId || extractDouyinAwemeId(redirectInfo.normalizedUrl || extracted.url),
        requestId,
        deadlineAt: resolveDeadlineAt
      });
    } catch (resolveError) {
      if (apiKey) {
        try {
          const data = await extractByUrlUniversal({ apiKey, baseUrl: TIKHUB_API_BASE_URL, url: extracted.url });
          const normalized = normalizeUniversalExtractResult(data, { sourceUrl: extracted.url });
          const normalizedDownloadCandidates = normalizeDouyinDownloadCandidates(
            normalized.videoUrlCandidates || [],
            normalized.videoUrls[0] || ''
          );
          const selectedDownloadCandidate = pickBestDouyinDownloadCandidate(normalizedDownloadCandidates);
          resolved = {
            videoId: '',
            downloadUrl: selectedDownloadCandidate?.url || normalized.videoUrls[0] || '',
            downloadUrlCandidates: normalizedDownloadCandidates,
            title: normalized.title,
            caption: '',
            authorName: normalized.authorName,
            duration: normalized.duration,
            videoData: normalized.raw,
            normalizedUrl: extracted.url,
            resolveStrategy: 'universal_extract',
            fallbackCaption: normalized.title || '',
            fallbackCaptionSource: 'universal'
          };
        } catch {}
      }
      if (!resolved) throw resolveError;
    }

    logDouyinTranscriptEvent({
      event: 'video_resolved',
      requestId,
      startedAt: resolveStartedAt,
      timeoutMs: resolveTimeoutMs,
      targetPath: resolved.downloadUrl || redirectInfo.normalizedUrl || extracted.url,
      finalFileSize: 0,
      host: getHostnameFromUrl(resolved.downloadUrl || redirectInfo.normalizedUrl || extracted.url),
      upstreamStatus: 0,
      videoId: resolved.videoId || '',
      resolveStrategy: resolved.resolveStrategy
    });

    try {
      const downloadStageDeadlineAt = createStageDeadlineAt({
        stageStartedAt: Date.now(),
        stageTimeoutMs: DOUYIN_VIDEO_DOWNLOAD_TIMEOUT_MS,
        parentDeadlineAt: transcriptDeadlineAt
      });
      const downloaded = await downloadDouyinVideoToTemp({
        downloadUrl: resolved.downloadUrl,
        downloadUrlCandidates: resolved.downloadUrlCandidates || [],
        requestId,
        parentDeadlineAt: downloadStageDeadlineAt
      });
      videoPath = downloaded.videoPath;
      tempFiles.push(videoPath);

      const extractStageDeadlineAt = createStageDeadlineAt({
        stageStartedAt: Date.now(),
        stageTimeoutMs: DOUYIN_AUDIO_EXTRACT_TIMEOUT_MS,
        parentDeadlineAt: transcriptDeadlineAt
      });
      audioPath = await extractAudioFromDouyinVideo({
        inputPath: videoPath,
        requestId,
        parentDeadlineAt: extractStageDeadlineAt,
        sourceHost: getHostnameFromUrl(resolved.downloadUrl)
      });
      tempFiles.push(audioPath);

      audioSegments = await splitAudioForDouyinAsr({
        audioPath,
        requestId,
        parentDeadlineAt: extractStageDeadlineAt,
        sourceHost: getHostnameFromUrl(resolved.downloadUrl)
      });

      for (const segmentPath of audioSegments) {
        if (segmentPath !== audioPath) {
          tempFiles.push(segmentPath);
        }
      }

      const asrEngine = readValue(body?.asrEngine) || 'siliconflow';

      const transcriptSegments = await Promise.all(
        audioSegments.map((segmentAudioPath, index) => {
          const asrStageDeadlineAt = createStageDeadlineAt({
            stageStartedAt: Date.now(),
            stageTimeoutMs: DOUYIN_ASR_TIMEOUT_MS,
            parentDeadlineAt: transcriptDeadlineAt
          });
          if (asrEngine === 'qwen') {
            return transcribeAudioWithQwen({
              audioPath: segmentAudioPath,
              requestId,
              segmentIndex: index,
              parentDeadlineAt: asrStageDeadlineAt
            }).then((text) => text.trim());
          }
          return transcribeAudioWithSiliconFlow({
            audioPath: segmentAudioPath,
            requestId,
            segmentIndex: index,
            parentDeadlineAt: asrStageDeadlineAt
          }).then((text) => text.trim());
        })
      );

      const transcript = transcriptSegments.filter(Boolean).join('\n\n').trim();
      const finalAudioSize = audioSegments.length
        ? (await Promise.all(audioSegments.map((segmentPath) => getFileSizeIfExists(segmentPath))))
          .reduce((sum, size) => sum + size, 0)
        : await getFileSizeIfExists(audioPath);

      logDouyinTranscriptEvent({
        event: 'transcript_succeeded',
        requestId,
        startedAt,
        timeoutMs: DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS,
        targetPath: audioPath || videoPath || resolved.downloadUrl,
        finalFileSize: finalAudioSize,
        host: getHostnameFromUrl(SILICONFLOW_API_BASE_URL) || getHostnameFromUrl(resolved.downloadUrl),
        upstreamStatus: 200,
        videoId: resolved.videoId || '',
        segmentCount: audioSegments.length
      });

      sendJson(res, 200, {
        ok: true,
        transcriptOk: true,
        videoId: resolved.videoId || '',
        title: resolved.title || '',
        downloadUrl: resolved.downloadUrl,
        downloadUrlCandidates: serializeDouyinDownloadCandidates(resolved.downloadUrlCandidates || [], resolved.downloadUrl),
        authorName: resolved.authorName || '',
        normalizedUrl: resolved.normalizedUrl || redirectInfo.normalizedUrl || extracted.url,
        sourceType: extracted.sourceType,
        transcript,
        transcriptSegments: audioSegments.length,
        transcriptError: '',
        fallbackCaption: resolved.fallbackCaption || '',
        fallbackCaptionSource: resolved.fallbackCaptionSource || 'none',
        resolveStrategy: resolved.resolveStrategy
      });
      return;
    } catch (error) {
      const failureTargetPath = error?.targetPath || audioPath || videoPath || resolved?.downloadUrl || redirectInfo?.normalizedUrl || extracted?.url || '';
      const failureFileSize = failureTargetPath.startsWith('/')
        ? await getFileSizeIfExists(failureTargetPath)
        : 0;
      logDouyinTranscriptEvent({
        level: 'error',
        event: 'transcript_failed',
        requestId,
        startedAt,
        timeoutMs: error?.timeoutMs || DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS,
        targetPath: failureTargetPath,
        finalFileSize: failureFileSize,
        host: error?.host || getHostnameFromUrl(resolved?.downloadUrl || redirectInfo?.normalizedUrl || extracted?.url),
        upstreamStatus: error?.upstreamStatus || 0,
        failedStage: getDouyinTranscriptFailedStage(error),
        stage: error?.stage || '',
        curlCode: error?.curlCode || 0,
        curlHttpStatus: error?.curlHttpStatus || 0,
        curlStderr: error?.curlStderr || '',
        effectiveUrl: error?.effectiveUrl || '',
        firstSelectedHost: error?.firstSelectedHost || '',
        retrySwitchedHost: error?.retrySwitchedHost || '',
        message: error?.message || '',
        detail: error?.detail || ''
      });

      sendJson(res, 200, {
        ok: true,
        transcriptOk: false,
        videoId: resolved.videoId || '',
        title: resolved.title || '',
        downloadUrl: resolved.downloadUrl,
        authorName: resolved.authorName || '',
        normalizedUrl: resolved.normalizedUrl || redirectInfo.normalizedUrl || extracted.url,
        sourceType: extracted.sourceType,
        transcript: '',
        transcriptError: getDouyinTranscriptErrorMessage(error),
        fallbackCaption: resolved.fallbackCaption || '',
        fallbackCaptionSource: resolved.fallbackCaptionSource || 'none',
        resolveStrategy: resolved.resolveStrategy
      });
      return;
    }
  } catch (error) {
    const failureTargetPath = error?.targetPath || resolved?.downloadUrl || redirectInfo?.normalizedUrl || extracted?.url || '';
    const failureFileSize = failureTargetPath.startsWith('/')
      ? await getFileSizeIfExists(failureTargetPath)
      : 0;
    logDouyinTranscriptEvent({
      level: 'error',
      event: 'transcript_failed',
      requestId,
      startedAt,
      timeoutMs: error?.timeoutMs || DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS,
      targetPath: failureTargetPath,
      finalFileSize: failureFileSize,
      host: error?.host || getHostnameFromUrl(failureTargetPath || extracted?.url),
      upstreamStatus: error?.upstreamStatus || 0,
      failedStage: getDouyinTranscriptFailedStage(error),
      stage: error?.stage || '',
      curlCode: error?.curlCode || 0,
      curlHttpStatus: error?.curlHttpStatus || 0,
      curlStderr: error?.curlStderr || '',
      effectiveUrl: error?.effectiveUrl || '',
      firstSelectedHost: error?.firstSelectedHost || '',
      retrySwitchedHost: error?.retrySwitchedHost || '',
      message: error?.message || '',
      detail: error?.detail || '',
      stack: error?.stack || ''
    });

    sendJson(res, error?.statusCode || 500, {
      ok: false,
      transcriptOk: false,
      error: getDouyinTranscriptErrorMessage(error),
      detail: error?.detail || '',
      stage: error?.stage || 'unknown_upstream_error'
    });
  } finally {
    await cleanupRequestScopedUploadTempFiles({
      requestId,
      filePaths: tempFiles
    });
  }
}

async function handleDouyinExtractLocalTranscript(req, res) {
  const requestId = createRequestId('dy_local_asr');
  const startedAt = Date.now();
  const transcriptDeadlineAt = startedAt + DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS;
  const tempFiles = [];
  let videoPath = '';
  let audioPath = '';
  let audioSegments = [];

  try {
    const form = await readMultipartFormBody(req);
    const file = form.file;

    if (!file || !(file instanceof File) || file.size === 0) {
      sendJson(res, 400, {
        ok: false,
        transcriptOk: false,
        error: '请上传视频文件'
      });
      return;
    }

    await ensureUploadTempDir();
    const ext = path.extname(file.name || '.mp4') || '.mp4';
    videoPath = path.join(UPLOAD_TEMP_DIR, `${requestId}_local${ext}`);
    await writeFile(videoPath, Buffer.from(await file.arrayBuffer()));
    tempFiles.push(videoPath);

    const extractStageDeadlineAt = createStageDeadlineAt({
      stageStartedAt: Date.now(),
      stageTimeoutMs: DOUYIN_AUDIO_EXTRACT_TIMEOUT_MS,
      parentDeadlineAt: transcriptDeadlineAt
    });
    audioPath = await extractAudioFromDouyinVideo({
      inputPath: videoPath,
      requestId,
      parentDeadlineAt: extractStageDeadlineAt,
      sourceHost: 'local_upload'
    });
    tempFiles.push(audioPath);

    audioSegments = await splitAudioForDouyinAsr({
      audioPath,
      requestId,
      parentDeadlineAt: extractStageDeadlineAt,
      sourceHost: 'local_upload'
    });
    for (const segmentPath of audioSegments) {
      if (segmentPath !== audioPath) {
        tempFiles.push(segmentPath);
      }
    }

    const asrEngine = readValue(form.asrEngine) || 'qwen';
    const transcriptSegments = await Promise.all(
      audioSegments.map((segmentAudioPath, index) => {
        const asrStageDeadlineAt = createStageDeadlineAt({
          stageStartedAt: Date.now(),
          stageTimeoutMs: DOUYIN_ASR_TIMEOUT_MS,
          parentDeadlineAt: transcriptDeadlineAt
        });
        if (asrEngine === 'qwen') {
          return transcribeAudioWithQwen({
            audioPath: segmentAudioPath,
            requestId,
            segmentIndex: index,
            parentDeadlineAt: asrStageDeadlineAt
          }).then((text) => text.trim());
        }
        return transcribeAudioWithSiliconFlow({
          audioPath: segmentAudioPath,
          requestId,
          segmentIndex: index,
          parentDeadlineAt: asrStageDeadlineAt
        }).then((text) => text.trim());
      })
    );

    const transcript = transcriptSegments.filter(Boolean).join('\n\n').trim();
    const finalAudioSize = audioSegments.length
      ? (await Promise.all(audioSegments.map((segmentPath) => getFileSizeIfExists(segmentPath))))
        .reduce((sum, size) => sum + size, 0)
      : await getFileSizeIfExists(audioPath);

    logDouyinTranscriptEvent({
      event: 'transcript_succeeded',
      requestId,
      startedAt,
      timeoutMs: DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS,
      targetPath: audioPath || videoPath,
      finalFileSize: finalAudioSize,
      host: getHostnameFromUrl(SILICONFLOW_API_BASE_URL) || 'local_upload',
      upstreamStatus: 200,
      videoId: 'local',
      segmentCount: audioSegments.length
    });

    sendJson(res, 200, {
      ok: true,
      transcriptOk: true,
      videoId: 'local',
      title: file.name || '本地视频',
      downloadUrl: '',
      downloadUrlCandidates: [],
      authorName: '',
      normalizedUrl: '',
      sourceType: 'local_upload',
      transcript,
      transcriptSegments: audioSegments.length,
      transcriptError: '',
      fallbackCaption: '',
      fallbackCaptionSource: 'none',
      resolveStrategy: 'local_upload'
    });
  } catch (error) {
    const failureTargetPath = error?.targetPath || audioPath || videoPath || '';
    const failureFileSize = failureTargetPath.startsWith('/')
      ? await getFileSizeIfExists(failureTargetPath)
      : 0;
    logDouyinTranscriptEvent({
      level: 'error',
      event: 'transcript_failed',
      requestId,
      startedAt,
      timeoutMs: error?.timeoutMs || DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS,
      targetPath: failureTargetPath,
      finalFileSize: failureFileSize,
      host: error?.host || 'local_upload',
      upstreamStatus: error?.upstreamStatus || 0,
      failedStage: getDouyinTranscriptFailedStage(error),
      stage: error?.stage || '',
      curlCode: error?.curlCode || 0,
      curlHttpStatus: error?.curlHttpStatus || 0,
      curlStderr: error?.curlStderr || '',
      effectiveUrl: error?.effectiveUrl || '',
      firstSelectedHost: error?.firstSelectedHost || '',
      retrySwitchedHost: error?.retrySwitchedHost || '',
      message: error?.message || '',
      detail: error?.detail || ''
    });

    sendJson(res, error?.statusCode || 500, {
      ok: false,
      transcriptOk: false,
      error: getDouyinTranscriptErrorMessage(error),
      detail: error?.detail || ''
    });
  } finally {
    await cleanupRequestScopedUploadTempFiles({
      requestId,
      filePaths: tempFiles
    });
  }
}

async function handleUniversalExtractTranscript(req, res) {
  const requestId = createRequestId('univ_asr');
  const startedAt = Date.now();
  const transcriptDeadlineAt = startedAt + DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS;
  const tempFiles = [];
  let videoPath = '';
  let audioPath = '';
  let audioSegments = [];
  let videoUrl = '';
  let title = '';
  let platform = '';

  try {
    const body = await readRequestBody(req);
    videoUrl = readValue(body?.videoUrl);
    title = readValue(body?.title);
    platform = readValue(body?.platform);

    if (!videoUrl || !/^https?:\/\//i.test(videoUrl)) {
      sendJson(res, 400, {
        ok: false,
        transcriptOk: false,
        error: '请先解析到可用视频后再提取逐字稿。'
      });
      return;
    }

    const rawCandidates = Array.isArray(body?.videoUrlCandidates) ? body.videoUrlCandidates : [];
    const downloadUrlCandidates = serializeDouyinDownloadCandidates(rawCandidates, videoUrl);

    const downloaded = await raceVideoDownloads({
      candidates: downloadUrlCandidates,
      requestId,
      referer: resolveProxyReferer(videoUrl),
      timeoutMs: Math.min(DOUYIN_VIDEO_DOWNLOAD_ATTEMPT_TIMEOUT_MS, 25 * 1000)
    });
    videoPath = downloaded.videoPath;
    tempFiles.push(videoPath);

    const extractStageDeadlineAt = createStageDeadlineAt({
      stageStartedAt: Date.now(),
      stageTimeoutMs: DOUYIN_AUDIO_EXTRACT_TIMEOUT_MS,
      parentDeadlineAt: transcriptDeadlineAt
    });
    audioPath = await extractAudioFromDouyinVideo({
      inputPath: videoPath,
      requestId,
      parentDeadlineAt: extractStageDeadlineAt,
      sourceHost: getHostnameFromUrl(videoUrl) || platform || 'universal'
    });
    tempFiles.push(audioPath);

    audioSegments = await splitAudioForDouyinAsr({
      audioPath,
      requestId,
      parentDeadlineAt: extractStageDeadlineAt,
      sourceHost: getHostnameFromUrl(videoUrl) || platform || 'universal'
    });
    for (const segmentPath of audioSegments) {
      if (segmentPath !== audioPath) {
        tempFiles.push(segmentPath);
      }
    }

    const asrEngine = readValue(body?.asrEngine) || 'qwen';
    const transcriptSegments = await Promise.all(
      audioSegments.map((segmentAudioPath, index) => {
        const asrStageDeadlineAt = createStageDeadlineAt({
          stageStartedAt: Date.now(),
          stageTimeoutMs: DOUYIN_ASR_TIMEOUT_MS,
          parentDeadlineAt: transcriptDeadlineAt
        });
        if (asrEngine === 'siliconflow') {
          return transcribeAudioWithSiliconFlow({
            audioPath: segmentAudioPath,
            requestId,
            segmentIndex: index,
            parentDeadlineAt: asrStageDeadlineAt
          }).then((text) => text.trim());
        }
        return transcribeAudioWithQwen({
          audioPath: segmentAudioPath,
          requestId,
          segmentIndex: index,
          parentDeadlineAt: asrStageDeadlineAt
        }).then((text) => text.trim());
      })
    );

    const transcript = transcriptSegments.filter(Boolean).join('\n\n').trim();
    const finalAudioSize = audioSegments.length
      ? (await Promise.all(audioSegments.map((segmentPath) => getFileSizeIfExists(segmentPath))))
        .reduce((sum, size) => sum + size, 0)
      : await getFileSizeIfExists(audioPath);

    logDouyinTranscriptEvent({
      event: 'transcript_succeeded',
      requestId,
      startedAt,
      timeoutMs: DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS,
      targetPath: audioPath || videoPath || videoUrl,
      finalFileSize: finalAudioSize,
      host: getHostnameFromUrl(videoUrl) || platform || 'universal',
      upstreamStatus: 200,
      videoId: 'universal',
      segmentCount: audioSegments.length
    });

    sendJson(res, 200, {
      ok: true,
      transcriptOk: true,
      videoId: 'universal',
      title,
      downloadUrl: videoUrl,
      downloadUrlCandidates,
      authorName: '',
      normalizedUrl: videoUrl,
      sourceType: platform || 'universal',
      transcript,
      transcriptSegments: audioSegments.length,
      transcriptError: '',
      fallbackCaption: '',
      fallbackCaptionSource: 'none',
      resolveStrategy: 'universal_video_url'
    });
  } catch (error) {
    const failureTargetPath = error?.targetPath || audioPath || videoPath || videoUrl || '';
    const failureFileSize = failureTargetPath.startsWith('/')
      ? await getFileSizeIfExists(failureTargetPath)
      : 0;
    logDouyinTranscriptEvent({
      level: 'error',
      event: 'transcript_failed',
      requestId,
      startedAt,
      timeoutMs: error?.timeoutMs || DOUYIN_TRANSCRIPT_TOTAL_TIMEOUT_MS,
      targetPath: failureTargetPath,
      finalFileSize: failureFileSize,
      host: error?.host || getHostnameFromUrl(videoUrl) || platform || 'universal',
      upstreamStatus: error?.upstreamStatus || 0,
      failedStage: getDouyinTranscriptFailedStage(error),
      stage: error?.stage || '',
      curlCode: error?.curlCode || 0,
      curlHttpStatus: error?.curlHttpStatus || 0,
      curlStderr: error?.curlStderr || '',
      effectiveUrl: error?.effectiveUrl || '',
      firstSelectedHost: error?.firstSelectedHost || '',
      retrySwitchedHost: error?.retrySwitchedHost || '',
      message: error?.message || '',
      detail: error?.detail || ''
    });

    sendJson(res, 200, {
      ok: true,
      transcriptOk: false,
      videoId: 'universal',
      title,
      downloadUrl: videoUrl,
      authorName: '',
      normalizedUrl: videoUrl,
      sourceType: platform || 'universal',
      transcript: '',
      transcriptError: getDouyinTranscriptErrorMessage(error),
      fallbackCaption: '',
      fallbackCaptionSource: 'none',
      resolveStrategy: 'universal_video_url'
    });
  } finally {
    await cleanupRequestScopedUploadTempFiles({
      requestId,
      filePaths: tempFiles
    });
  }
}

async function raceDouyinDownloadCandidates(candidates, options) {
  const { logDownload, timeoutMs } = options;

  if (candidates.length === 0) return { ok: false };

  if (candidates.length === 1) {
    const candidate = candidates[0];
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const fetchStartAt = Date.now();

    logDownload('upstream_fetch_start', {
      host: candidate.host,
      parallelIndex: 0,
      url: candidate.url,
      mode: 'single'
    });

    try {
      const upstreamRes = await fetch(candidate.url, {
        signal: controller.signal,
        headers: {
          'Referer': 'https://www.douyin.com/',
          'User-Agent': DOUYIN_USER_AGENT,
          'Accept': '*/*',
        },
      });
      clearTimeout(timeoutId);
      const ttfbMs = Date.now() - fetchStartAt;
      logDownload('upstream_headers_received', {
        host: candidate.host,
        parallelIndex: 0,
        status: upstreamRes.status,
        contentLength: upstreamRes.headers.get('content-length') || 'unknown',
        ttfbMs
      });
      return { ok: upstreamRes.ok, res: upstreamRes, candidate, ttfbMs, fetchStartAt };
    } catch (error) {
      clearTimeout(timeoutId);
      updateDouyinDownloadHostStats(candidate.host, 'failure');
      logDownload('upstream_fetch_failed', {
        host: candidate.host,
        parallelIndex: 0,
        error: error?.message || '',
        mode: 'single'
      });
      return { ok: false, error, candidate };
    }
  }

  const tasks = candidates.map((candidate, index) => {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
    const fetchStartAt = Date.now();

    logDownload('upstream_fetch_start', {
      host: candidate.host,
      parallelIndex: index,
      url: candidate.url,
      mode: 'parallel'
    });

    const promise = fetch(candidate.url, {
      signal: controller.signal,
      headers: {
        'Referer': 'https://www.douyin.com/',
        'User-Agent': DOUYIN_USER_AGENT,
        'Accept': '*/*',
      },
    }).then(res => {
      clearTimeout(timeoutId);
      const ttfbMs = Date.now() - fetchStartAt;
      logDownload('upstream_headers_received', {
        host: candidate.host,
        parallelIndex: index,
        status: res.status,
        contentLength: res.headers.get('content-length') || 'unknown',
        ttfbMs
      });
      return { index, ok: res.ok, res, candidate, ttfbMs, fetchStartAt, controller };
    }).catch(err => {
      clearTimeout(timeoutId);
      updateDouyinDownloadHostStats(candidate.host, 'failure');
      logDownload('upstream_fetch_failed', {
        host: candidate.host,
        parallelIndex: index,
        error: err?.message || '',
        mode: 'parallel'
      });
      return { index, ok: false, error: err, candidate, controller };
    });

    return { promise, controller, index };
  });

  let remaining = [...tasks];

  while (remaining.length > 0) {
    const result = await Promise.race(remaining.map(t => t.promise));

    const idx = remaining.findIndex(t => t.index === result.index);
    if (idx >= 0) remaining.splice(idx, 1);

    if (result.ok) {
      remaining.forEach(t => t.controller.abort());
      return { ok: true, res: result.res, candidate: result.candidate, ttfbMs: result.ttfbMs, fetchStartAt: result.fetchStartAt };
    }
  }

  return { ok: false };
}

function isDouyinPlatform(platform) {
  const p = String(platform || '').trim().toLowerCase();
  return !p || p === 'douyin';
}

async function handleDouyinDownloadVideo(req, res) {
  const requestId = createRequestId('dy_download');
  const startedAt = Date.now();

  function logDownload(stage, extra = {}) {
    console.log(`[douyin download] ${stage}`, {
      requestId,
      elapsedMs: Date.now() - startedAt,
      ...extra
    });
  }

  try {
    let downloadUrl = '';
    let downloadUrlCandidates = [];
    let videoId = '';
    let platform = 'douyin';

    const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    if (req.method === 'GET') {
      downloadUrl = readValue(parsedUrl.searchParams.get('downloadUrl'));
      videoId = readValue(parsedUrl.searchParams.get('videoId'));
      const candidatesParam = parsedUrl.searchParams.get('candidates');
      if (candidatesParam) {
        try {
          const parsed = JSON.parse(candidatesParam);
          if (Array.isArray(parsed)) downloadUrlCandidates = parsed;
        } catch {
          downloadUrlCandidates = [];
        }
      }
      platform = readValue(parsedUrl.searchParams.get('platform')) || 'douyin';
    } else {
      const body = await readRequestBody(req);
      downloadUrl = readValue(body?.downloadUrl);
      if (Array.isArray(body?.downloadUrlCandidates)) {
        downloadUrlCandidates = body.downloadUrlCandidates;
      } else if (typeof body?.downloadUrlCandidates === 'string' && body.downloadUrlCandidates) {
        try {
          const parsed = JSON.parse(body.downloadUrlCandidates);
          if (Array.isArray(parsed)) downloadUrlCandidates = parsed;
        } catch {
          downloadUrlCandidates = [];
        }
      }
      videoId = readValue(body?.videoId);
      platform = readValue(body?.platform) || 'douyin';
    }

    if (!downloadUrl) {
      sendJson(res, 400, { error: '缺少 downloadUrl' });
      return;
    }

    const fileName = buildDouyinVideoDownloadFileName(videoId);

    // For non-Douyin platforms, use proxy download
    if (!isDouyinPlatform(platform)) {
      logDownload('request_received', {
        videoId,
        platform,
        targetUrl: downloadUrl.slice(0, 120),
        method: req.method,
        mode: 'proxy'
      });

      await proxyVideoStream({
        targetUrl: downloadUrl,
        req,
        res,
        asAttachment: true,
        fileName
      });

      logDownload('stream_finished', {
        videoId,
        platform,
        targetUrl: downloadUrl.slice(0, 120),
        mode: 'proxy'
      });
      return;
    }

    // Douyin platform: download to a temp file first and verify it has an
    // audio stream. Some Douyin CDN candidates are video-only; streaming the
    // fastest candidate directly can produce silent downloads.
    const normalizedCandidates = normalizeDouyinDownloadCandidates(downloadUrlCandidates, downloadUrl);
    const rankedCandidates = rankDouyinDownloadCandidates(normalizedCandidates, { respectCooldown: true });

    logDownload('request_received', {
      videoId,
      candidateCount: rankedCandidates.length,
      candidateHosts: rankedCandidates.slice(0, 3).map(c => c.host),
      method: req.method,
      mode: 'validated_audio_download'
    });

    let tempVideo = null;
    try {
      tempVideo = await downloadDouyinVideoToTemp({
        downloadUrl,
        downloadUrlCandidates: rankedCandidates,
        requestId,
        referer: 'https://www.douyin.com/'
      });

      const responseHeaders = {
        'Content-Type': 'video/mp4',
        'Content-Disposition': `attachment; filename="${fileName}"`,
        'Cache-Control': 'no-store',
        'Content-Length': String(tempVideo.fileSize || 0)
      };

      res.writeHead(200, responseHeaders);

      logDownload('client_stream_start', {
        selectedHost: tempVideo.host,
        selectedDownloadUrl: tempVideo.effectiveUrl || '',
        fileSize: tempVideo.fileSize,
        ffprobeDurationSeconds: tempVideo.validation?.durationSeconds || 0,
        mode: 'validated_audio_download'
      });

      await pipeline(createReadStream(tempVideo.videoPath), res);

      logDownload('stream_finished', {
        winner: tempVideo.host,
        videoId,
        bytesStreamed: tempVideo.fileSize,
        totalDurationMs: Date.now() - startedAt,
        mode: 'validated_audio_download'
      });
    } finally {
      if (tempVideo?.videoPath) {
        await unlink(tempVideo.videoPath).catch(() => {});
      }
    }
  } catch (error) {
    if (!res.headersSent) {
      sendJson(res, error?.statusCode || 500, {
        error: error?.message || '视频下载失败',
        detail: error?.detail || error?.message || '下载代理失败'
      });
    } else {
      logDownload('fatal_error_after_headers_sent', {
        error: error?.message || ''
      });
      try { res.destroy(); } catch {}
    }
  }
}

async function handleDouyinVideoStream(req, res) {
  const url = new URL(req.url, `http://${req.headers.host}`);
  let downloadUrl = url.searchParams.get('downloadUrl') || url.searchParams.get('url');
  let videoId = url.searchParams.get('videoId') || '';
  let platform = readValue(url.searchParams.get('platform')) || 'douyin';
  let asDownload = url.searchParams.get('download') === '1';
  let fileName = readValue(url.searchParams.get('fileName')) || '';

  // Support POST body for long URLs (avoid HTTP 414)
  if (req.method === 'POST') {
    try {
      const body = await readRequestBody(req);
      downloadUrl = readValue(body?.downloadUrl || body?.url) || downloadUrl;
      videoId = readValue(body?.videoId) || videoId;
      platform = readValue(body?.platform) || platform;
      if (body?.download === '1' || body?.download === true) asDownload = true;
      fileName = readValue(body?.fileName) || fileName;
    } catch {
      // ignore body parse error, fall back to query params
    }
  }

  if (!fileName) {
    fileName = buildDouyinVideoDownloadFileName(videoId);
  }

  if (!downloadUrl) {
    sendJson(res, 400, { error: '缺少下载地址参数' });
    return;
  }

  const requestId = createRequestId(asDownload ? 'dy_stream_download' : 'dy_preview');
  console.log('[douyin preview] stream_started', { requestId, videoId, targetPath: downloadUrl, platform, asDownload });

  try {
    const rangeHeader = req.headers['range'];
    const referer = isDouyinPlatform(platform) ? 'https://www.douyin.com/' : resolveProxyReferer(downloadUrl);
    const upstreamRes = await fetch(downloadUrl, {
      headers: {
        'Referer': referer,
        'User-Agent': DOUYIN_USER_AGENT,
        'Accept': '*/*',
        ...(rangeHeader ? { Range: rangeHeader } : {}),
      },
    });

    if (!upstreamRes.ok && upstreamRes.status !== 206) {
      console.log('[douyin preview] upstream_failed', { requestId, upstreamStatus: upstreamRes.status });
      sendJson(res, 502, { error: '上游视频请求失败', detail: `HTTP ${upstreamRes.status}` });
      return;
    }

    const contentType = upstreamRes.headers.get('content-type') || 'video/mp4';
    if (!contentType.includes('video/') && !contentType.includes('audio/') && !contentType.includes('application/octet-stream')) {
      try { await upstreamRes.body?.cancel(); } catch {}
      await proxyVideoStream({
        targetUrl: downloadUrl,
        req,
        res,
        asAttachment: asDownload,
        fileName
      });
      console.log('[douyin preview] stream_finished', { requestId, platform, mode: 'fallback_proxy' });
      return;
    }

    const contentLength = upstreamRes.headers.get('content-length');
    const acceptRanges = upstreamRes.headers.get('accept-ranges');
    const contentRange = upstreamRes.headers.get('content-range');
    const responseHeaders = {
      'Content-Type': contentType,
      'Cache-Control': 'public, max-age=3600',
      'Accept-Ranges': acceptRanges || 'bytes',
      'Content-Disposition': `${asDownload ? 'attachment' : 'inline'}; filename="${fileName}"`,
      'X-Accel-Buffering': 'no',
    };
    if (contentLength) responseHeaders['Content-Length'] = contentLength;
    if (contentRange) responseHeaders['Content-Range'] = contentRange;

    res.writeHead(upstreamRes.status, responseHeaders);

    if (!upstreamRes.body) {
      res.end();
      return;
    }

    await pipeline(Readable.fromWeb(upstreamRes.body), res);
    console.log('[douyin preview] stream_finished', { requestId, platform, mode: 'thin_proxy' });
  } catch (error) {
    console.error('[douyin preview] stream_error', { requestId, message: error?.message });
    if (!res.headersSent) {
      sendJson(res, 500, { error: '视频流代理失败', detail: error?.message || '未知错误' });
    } else {
      try { res.destroy(); } catch {}
    }
  }
}

const DEBUG_DOWNLOAD_CHUNK_SIZE = 64 * 1024; // 64KB per write
const DEBUG_DOWNLOAD_BUFFER = Buffer.alloc(DEBUG_DOWNLOAD_CHUNK_SIZE, 0xAB); // fixed pattern

async function handleDebugDownloadTest(req, res) {
  const requestId = createRequestId('debug_dl');
  const startedAt = Date.now();

  function logDebug(stage, extra = {}) {
    console.log(`[debug download] ${stage}`, {
      requestId,
      elapsedMs: Date.now() - startedAt,
      ...extra
    });
  }

  try {
    const parsedUrl = new URL(req.url || '', `http://${req.headers.host || 'localhost'}`);
    const sizeParam = parsedUrl.searchParams.get('size');
    const sizeMb = Math.max(1, Math.min(100, Number.parseInt(sizeParam || '20', 10)));
    const totalBytes = sizeMb * 1024 * 1024;

    logDebug('request_received', {
      requestedSizeMb: sizeMb,
      totalBytes,
      clientIp: req.headers['x-forwarded-for'] || req.socket?.remoteAddress || ''
    });

    res.writeHead(200, {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(totalBytes),
      'Content-Disposition': `attachment; filename="debug_${sizeMb}mb.bin"`,
      'Cache-Control': 'no-store',
      'X-Accel-Buffering': 'no',
    });

    const streamStartAt = Date.now();
    logDebug('client_stream_start', {
      totalBytes
    });

    let bytesStreamed = 0;
    while (bytesStreamed < totalBytes) {
      const remaining = totalBytes - bytesStreamed;
      const chunkSize = Math.min(DEBUG_DOWNLOAD_CHUNK_SIZE, remaining);
      const chunk = chunkSize === DEBUG_DOWNLOAD_CHUNK_SIZE
        ? DEBUG_DOWNLOAD_BUFFER
        : DEBUG_DOWNLOAD_BUFFER.subarray(0, chunkSize);
      res.write(chunk);
      bytesStreamed += chunkSize;
    }
    res.end();

    const totalMs = Date.now() - startedAt;
    const streamMs = Date.now() - streamStartAt;
    const throughputBps = streamMs > 0 ? Math.round((bytesStreamed / streamMs) * 1000) : 0;

    logDebug('stream_finished', {
      bytesStreamed,
      totalDurationMs: totalMs,
      streamDurationMs: streamMs,
      throughputBps,
      throughputMbps: (throughputBps * 8 / 1000 / 1000).toFixed(2)
    });
  } catch (error) {
    console.error('[debug download] fatal_error', { requestId, error: error?.message });
    if (!res.headersSent) {
      sendJson(res, 500, { error: '调试下载失败', detail: error?.message || '' });
    } else {
      try { res.destroy(); } catch {}
    }
  }
}

async function handleDouyinDownloadHostStats(req, res) {
  const entries = Array.from(douyinDownloadHostStats.entries());
  const summary = entries.map(([host, stats]) => ({
    host,
    selected: stats.selected,
    attempts: stats.attempts,
    success: stats.success,
    failure: stats.failure,
    timeout: stats.timeout,
    http4xx: stats.http4xx,
    http5xx: stats.http5xx,
    empty: stats.empty,
    invalid: stats.invalid,
    network: stats.network,
    successRate: stats.attempts > 0 ? Number((stats.success / stats.attempts).toFixed(3)) : null,
    rollingTtfbAvgMs: getDouyinDownloadHostRollingAverage(host, 'ttfb').avgMs,
    rollingTtfbSampleCount: getDouyinDownloadHostRollingAverage(host, 'ttfb').sampleCount,
    rollingDurationAvgMs: getDouyinDownloadHostRollingAverage(host, 'totalDuration').avgMs,
    rollingDurationSampleCount: getDouyinDownloadHostRollingAverage(host, 'totalDuration').sampleCount,
    consecutiveFailures: stats.consecutiveFailures,
    inCooldown: isDouyinDownloadHostInCooldown(host).inCooldown,
    cooldownRemainingMs: isDouyinDownloadHostInCooldown(host).remainingMs,
    lastOutcome: stats.lastOutcome,
    lastAttemptAt: stats.lastAttemptAt ? new Date(stats.lastAttemptAt).toISOString() : null
  }));

  summary.sort((a, b) => {
    if ((b.successRate || 0) !== (a.successRate || 0)) {
      return (b.successRate || 0) - (a.successRate || 0);
    }
    return (a.rollingTtfbAvgMs || Infinity) - (b.rollingTtfbAvgMs || Infinity);
  });

  sendJson(res, 200, {
    hostCount: entries.length,
    config: {
      maxSamples: DOUYIN_HOST_STATS_MAX_SAMPLES,
      cooldownBaseMs: DOUYIN_HOST_COOLDOWN_BASE_MS,
      cooldownMaxMs: DOUYIN_HOST_COOLDOWN_MAX_MS,
      consecutiveFailureThreshold: DOUYIN_HOST_CONSECUTIVE_FAILURE_THRESHOLD
    },
    hosts: summary
  });
}

async function serveStatic(req, res, pathname) {
  let targetPath = pathname === '/' ? '/index.html' : pathname;
  const filePath = path.normalize(path.join(RESOLVED_FRONTEND_DIR, targetPath));

  if (!filePath.startsWith(RESOLVED_FRONTEND_DIR)) {
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
    if (shouldServeSpaFallback(pathname)) {
      const fallbackPath = path.join(RESOLVED_FRONTEND_DIR, 'index.html');
      try {
        const content = await readFile(fallbackPath);
        res.writeHead(200, { 'Content-Type': MIME_TYPES['.html'] });
        res.end(content);
        return;
      } catch {}
    }
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

  const isCpRoute = url.pathname.startsWith('/api/cp/');
  const isAuthRoute = url.pathname === '/api/auth/login' || url.pathname === '/api/auth/status' || url.pathname === '/api/auth/logout' || url.pathname === '/api/douyin/host-stats' || url.pathname === '/api/debug/download-test' || isCpRoute;
  if (req.method === 'POST' && url.pathname === '/api/auth/login') {
    await handleAuthLogin(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/auth/status') {
    handleAuthStatus(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/auth/logout') {
    handleAuthLogout(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/config/status') {
    await handleConfigStatus(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    await handlePublicMediaRequest(req, res, url.pathname.slice('/uploads/'.length));
    return;
  }

  const isDebugDownloadBypass = String(process.env.DOWNLOAD_DEBUG_BYPASS_AUTH || '').trim().toLowerCase() === 'true';
  const isDownloadDebugRoute = url.pathname === '/api/douyin/download-video' || url.pathname === '/api/douyin/video-stream';

  if (url.pathname.startsWith('/api/') && !isAuthRoute && !isAuthenticated(req) && !(isDebugDownloadBypass && isDownloadDebugRoute)) {
    sendJson(res, 401, { error: '未登录或登录已失效' });
    return;
  }

  // CopyPilot routes (video extraction / transcription)
  const handledByCopypilot = await tryHandleCopypilotRoute(req, res, url);
  if (handledByCopypilot) {
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/proxy/download') {
    await handleProxyDownload(req, res, url);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tts/aliyun') {
    await handleAliyunTts(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/voice/zhipu') {
    await handleZhipuVoiceClone(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/tts/zhipu') {
    await handleZhipuTts(req, res);
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

  if (req.method === 'POST' && url.pathname === '/api/voice/volcengine/sync-ownership') {
    await handleSyncVolcVoiceOwnership(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/voice/volcengine/release-ownership') {
    await handleReleaseVolcVoiceOwnership(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/siliconflow/upload-voice') {
    await handleSiliconFlowVoiceUpload(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/siliconflow/create-speech') {
    await handleSiliconFlowTts(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/voice/archive/sync') {
    await handleSyncVoiceArchive(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/voice/archive') {
    await handleGetVoiceArchive(req, res);
    return;
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/voice/archive/')) {
    await handleUpdateVoiceArchiveName(req, res);
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/voice/archive/')) {
    await handleDeleteVoiceArchive(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/doubao/multimodal') {
    await handleDoubaoMultimodal(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/seedance/tasks') {
    await handleSeedanceCreateTask(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/seedance/tasks/')) {
    const taskId = decodeURIComponent(url.pathname.replace(/^\/api\/seedance\/tasks\//, ''));
    await handleSeedanceGetTask(req, res, taskId);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/douyin/resolve-download') {
    await handleDouyinResolveDownload(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/douyin/extract-transcript') {
    await handleDouyinExtractTranscript(req, res);
    return;
  }

  if ((req.method === 'POST' || req.method === 'GET') && url.pathname === '/api/douyin/download-video') {
    await handleDouyinDownloadVideo(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/douyin/extract-local-transcript') {
    await handleDouyinExtractLocalTranscript(req, res);
    return;
  }

  if ((req.method === 'GET' || req.method === 'POST') && url.pathname === '/api/douyin/video-stream') {
    await handleDouyinVideoStream(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/douyin/host-stats') {
    await handleDouyinDownloadHostStats(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/debug/download-test') {
    await handleDebugDownloadTest(req, res);
    return;
  }

  // Collection module routes
  if (req.method === 'GET' && url.pathname === '/api/collection/keywords') {
    await handleGetKeywords(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/collection/keywords') {
    await handleCreateKeyword(req, res);
    return;
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/api/collection/keywords/')) {
    const id = url.pathname.replace(/^\/api\/collection\/keywords\//, '');
    await handleUpdateKeyword(req, res, id);
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/collection/keywords/')) {
    const id = url.pathname.replace(/^\/api\/collection\/keywords\//, '');
    await handleDeleteKeyword(req, res, id);
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/collection/keywords/') && url.pathname.endsWith('/fetch')) {
    const id = url.pathname.replace(/^\/api\/collection\/keywords\//, '').replace(/\/fetch$/, '');
    await handleFetchKeyword(req, res, id);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/collection/articles') {
    await handleGetArticles(req, res);
    return;
  }

  // Image generation routes
  if (req.method === 'POST' && url.pathname === '/api/image/tasks') {
    await handleCreateImageTask(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/image/tasks') {
    await handleGetImageTasks(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/image/tasks/')) {
    const id = url.pathname.replace(/^\/api\/image\/tasks\//, '');
    await handleGetImageTaskStatus(req, res, id);
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/image/tasks/')) {
    const id = url.pathname.replace(/^\/api\/image\/tasks\//, '');
    await handleDeleteImageTask(req, res, id);
    return;
  }

  // Chat completions (top model) route
  if (req.method === 'POST' && url.pathname === '/api/chat/doubao') {
    await handleDoubaoChatCompletions(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/qwen') {
    await handleQwenChatCompletions(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/extract/universal') {
    await handleUniversalExtract(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/extract/universal-transcript') {
    await handleUniversalExtractTranscript(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/chat/completions') {
    await handleChatCompletions(req, res);
    return;
  }

  if (req.method !== 'GET' && req.method !== 'HEAD') {
    sendJson(res, 405, { error: '方法不被支持' });
    return;
  }

  await serveStatic(req, res, url.pathname);
});

server.listen(PORT, HOST, () => {
  logFrontendSelection();
  console.log(`Server running at http://${HOST}:${PORT}`);
  cleanupExpiredUploadTempFilesOnStartup().catch((error) => {
    console.error('[runtime uploads] cleanup_failed', {
      requestId: 'startup_cleanup',
      targetPath: UPLOAD_TEMP_DIR,
      cleanupReason: 'startup_bootstrap',
      message: error?.message || '',
      code: error?.code || ''
    });
  });
});

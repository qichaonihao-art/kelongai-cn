import { createServer } from 'node:http';
import { execFile, spawn } from 'node:child_process';
import { createReadStream, existsSync } from 'node:fs';
import { copyFile, mkdir, mkdtemp, readFile, readdir, rename, rm, stat, unlink, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { DatabaseSync } from 'node:sqlite';
import { WebSocket } from 'ws';
import { config as loadDotenv } from 'dotenv';
import { tryHandleCopypilotRoute } from './copypilot-adapter.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
loadDotenv({ path: path.join(__dirname, '.env'), override: true });
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
const DEFAULT_DOUBAO_MULTIMODAL_MODEL = 'doubao-seed-2-1-pro-260628';
const DOUBAO_MULTIMODAL_TIMEOUT_MS = 8 * 60 * 1000;
// 文案创作走单条小请求，单条 350 字档十几秒内应返回；用较短超时让卡住的请求快速失败并重试，
// 避免单条卡住 8 分钟把整批推到 nginx 代理超时（504）。
const DOUBAO_COPY_TEXT_TIMEOUT_MS = 3 * 60 * 1000;
const QWEN_CREATIVE_MULTIMODAL_MODEL = 'qwen3.8-max';
const QWEN_CREATIVE_MULTIMODAL_TIMEOUT_MS = 10 * 60 * 1000;
const APIMART_API_BASE_URL = String(process.env.APIMART_API_BASE_URL || 'https://api.apimart.ai/v1').trim().replace(/\/+$/g, '');
const APIMART_IMAGE_MODEL = String(process.env.APIMART_IMAGE_MODEL || 'gpt-image-2').trim();
const APIMART_IMAGE_FETCH_TIMEOUT_MS = 45 * 1000;
const APIMART_IMAGE_RETRY_DELAYS_MS = [1000];
const APIMART_CHAT_FETCH_TIMEOUT_MS = 8 * 60 * 1000;
const UPLOAD_TEMP_DIR = path.join(__dirname, '.runtime-uploads');
const RUNTIME_STATE_DIR = path.resolve(process.env.RUNTIME_STATE_DIR || path.join(__dirname, '.runtime-state'));
const VIDEO_LIBRARY_DIR = path.resolve(process.env.VIDEO_LIBRARY_DIR || path.join(path.dirname(RUNTIME_STATE_DIR), 'kelongai-media', 'video-library'));
const VIDEO_LIBRARY_MAX_FILE_BYTES = 40 * 1024 * 1024;
const VIDEO_LIBRARY_THUMBNAIL_MAX_WIDTH = 640;
const VIDEO_LIBRARY_THUMBNAIL_CONCURRENCY = 2;
const VIDEO_LIBRARY_PREVIEW_MAX_WIDTH = 540;
const VIDEO_LIBRARY_STREAM_HIGH_WATER_MARK = 1024 * 1024;
const VIDEO_LIBRARY_ACCEL_REDIRECT_PREFIX = String(process.env.VIDEO_LIBRARY_ACCEL_REDIRECT_PREFIX || '').trim().replace(/\/$/, '');
const MEDIAKIT_API_BASE_URL = String(process.env.MEDIAKIT_API_BASE_URL || 'https://mediakit.cn-beijing.volces.com').trim().replace(/\/+$/g, '');
const MEDIAKIT_ENHANCEMENT_POLL_INTERVAL_MS = 10 * 1000;
const MEDIAKIT_ENHANCEMENT_MAX_ATTEMPTS = 5;
// 生成平台的“480P”常因编码宏块对齐输出为 496×864 等尺寸；512 可覆盖该档位且不会误收 540P/720P。
const VIDEO_ENHANCEMENT_480P_MAX_SHORT_EDGE = 512;
const VIDEO_LIBRARY_MIME_BY_EXTENSION = new Map([
  ['.mp4', 'video/mp4'],
  ['.m4v', 'video/x-m4v'],
  ['.mov', 'video/quicktime'],
  ['.webm', 'video/webm'],
  ['.avi', 'video/x-msvideo'],
  ['.mkv', 'video/x-matroska'],
]);
const videoLibraryThumbnailJobs = [];
const videoLibraryThumbnailPromises = new Map();
const videoLibraryPreviewPromises = new Map();
let activeVideoLibraryThumbnailJobs = 0;
let videoEnhancementWorkerTimer = null;
let videoEnhancementWorkerActive = false;
const VOLC_SPEAKER_OWNERSHIP_FILE = path.join(RUNTIME_STATE_DIR, 'volc-speaker-ownership.json');
const VOICE_ARCHIVE_FILE = path.join(RUNTIME_STATE_DIR, 'voice-archive.json');
const HOME_CULTURE_MOTTOS_FILE = path.join(RUNTIME_STATE_DIR, 'home-culture-mottos.json');
const TEAM_TIMELINE_FILE = path.join(RUNTIME_STATE_DIR, 'team-timeline.json');
const CREATIVE_FEEDING_SETTINGS_FILE = path.join(RUNTIME_STATE_DIR, 'creative-feeding-settings.json');
const CREATIVE_OPENING_LIBRARY_FILE = path.join(RUNTIME_STATE_DIR, 'creative-opening-library.json');
const CREATIVE_COPY_LIBRARY_FILE = path.join(RUNTIME_STATE_DIR, 'creative-copy-library.json');
const VOLC_SPEAKER_REMOTE_STATUS_CACHE_TTL_MS = 15 * 1000;
const COLLECTION_DB_PATH = path.join(RUNTIME_STATE_DIR, 'collection.db');
const MEDIA_TTL_MS = 30 * 60 * 1000;
const STARTUP_UPLOAD_TEMP_FILE_MAX_AGE_MS = 2 * 60 * 60 * 1000;
const PAINTING_BATCH_RUN_DIR = path.join(RUNTIME_STATE_DIR, 'painting-batch-runs');
const PAINTING_BATCH_PROMPT_CONCURRENCY = 2;
const PAINTING_BATCH_DISPATCH_CONCURRENCY = 8;
const PAINTING_BATCH_SEEDANCE_SUBMIT_INTERVAL_MS = 800;
const PAINTING_BATCH_MAX_RENDERING_TASKS = Number(process.env.PAINTING_BATCH_MAX_RENDERING_TASKS || 3);
const PAINTING_BATCH_PROMPT_RETRY_MAX = 2;
const PAINTING_BATCH_SEEDANCE_RETRY_MAX = 2;
const PAINTING_BATCH_SAVE_RETRY_MAX = 3;
const PAINTING_BATCH_PROMPT_SIMILARITY_THRESHOLD = 0.78;
const PAINTING_BATCH_TASK_TIMEOUT_MS = 15 * 60 * 1000;
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
  minimaxApiKey: process.env.MINIMAX_API_KEY || '',
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
  deepseekApiKey: process.env.DEEPSEEK_API_KEY || '',
  webSearchApiKey: process.env.WEB_SEARCH_API_KEY || '',
  dashscopeApiKey: process.env.DASHSCOPE_API_KEY || '',
  mediakitApiKey: process.env.MEDIAKIT_API_KEY || '',
};

const DOUYIN_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const TIKHUB_API_BASE_URL = 'https://api.tikhub.io';
const DOUYIN_RETRY_DELAYS_MS = [250, 700];
const DASHSCOPE_API_BASE_URL = String(process.env.DASHSCOPE_API_BASE_URL || 'https://llm-7725kgx72thqls1n.cn-beijing.maas.aliyuncs.com/compatible-mode/v1').trim().replace(/\/+$/g, '');
const QWEN_TOPMODEL_MODEL = 'qwen3.7-plus';
const DEEPSEEK_API_BASE_URL = String(process.env.DEEPSEEK_API_BASE_URL || 'https://api.deepseek.com').trim().replace(/\/+$/g, '');
const DEEPSEEK_TOPMODEL_MODEL = 'deepseek-v4-pro';
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
let teamTimelineQueue = Promise.resolve();
const paintingBatchRunQueue = [];
let paintingBatchRunProcessorActive = false;
const paintingBatchRunActivePromises = new Map();

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

function parseFpsFraction(value) {
  const text = String(value || '').trim();
  if (!text) return 0;
  const [numerator, denominator = '1'] = text.split('/');
  const fps = Number(numerator) / Number(denominator || 1);
  return Number.isFinite(fps) && fps > 0 ? Math.round(fps * 1000) / 1000 : 0;
}

async function probeVideoMetadata(filePath) {
  const { stdout } = await execFileAsync('ffprobe', [
    '-v', 'error',
    '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,avg_frame_rate,r_frame_rate:format=duration',
    '-of', 'json',
    filePath,
  ], { timeout: 30 * 1000, killSignal: 'SIGKILL' });
  const parsed = JSON.parse(String(stdout || '{}'));
  const stream = Array.isArray(parsed?.streams) ? parsed.streams[0] : null;
  const width = Number(stream?.width || 0);
  const height = Number(stream?.height || 0);
  const fps = parseFpsFraction(stream?.avg_frame_rate) || parseFpsFraction(stream?.r_frame_rate);
  const durationSeconds = Number(parsed?.format?.duration || 0);
  if (!Number.isFinite(width) || !Number.isFinite(height) || width <= 0 || height <= 0) {
    throw new Error('无法读取视频分辨率');
  }
  return {
    width,
    height,
    fps,
    durationSeconds: Number.isFinite(durationSeconds) && durationSeconds > 0 ? Math.round(durationSeconds * 1000) / 1000 : 0,
  };
}

function isVideo480pOrLower(metadata) {
  const shortEdge = Math.min(Number(metadata?.width || 0), Number(metadata?.height || 0));
  return shortEdge > 0 && shortEdge <= VIDEO_ENHANCEMENT_480P_MAX_SHORT_EDGE;
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
      minimaxApiKey: !!readValue(SERVER_CONFIG.minimaxApiKey),
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
      mediakitApiKey: !!readValue(SERVER_CONFIG.mediakitApiKey),
      doubaoMultimodalModel: DEFAULT_DOUBAO_MULTIMODAL_MODEL,
      qwenMultimodalModel: QWEN_CREATIVE_MULTIMODAL_MODEL,
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

      CREATE TABLE IF NOT EXISTS store_overview_nodes (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        type TEXT NOT NULL,
        name TEXT NOT NULL,
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS store_overview_edges (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_id INTEGER NOT NULL,
        target_id INTEGER NOT NULL,
        relation_type TEXT NOT NULL DEFAULT 'linked',
        note TEXT NOT NULL DEFAULT '',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        FOREIGN KEY (source_id) REFERENCES store_overview_nodes(id) ON DELETE CASCADE,
        FOREIGN KEY (target_id) REFERENCES store_overview_nodes(id) ON DELETE CASCADE,
        UNIQUE(source_id, target_id, relation_type)
      );

      CREATE TABLE IF NOT EXISTS store_overview_settings (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS video_library_items (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_name TEXT NOT NULL,
        original_name TEXT NOT NULL,
        stored_name TEXT NOT NULL UNIQUE,
        mime_type TEXT NOT NULL DEFAULT 'video/mp4',
        file_size INTEGER NOT NULL DEFAULT 0,
        sha256 TEXT NOT NULL UNIQUE,
        note TEXT NOT NULL DEFAULT '',
        width INTEGER NOT NULL DEFAULT 0,
        height INTEGER NOT NULL DEFAULT 0,
        fps REAL NOT NULL DEFAULT 0,
        duration_seconds REAL NOT NULL DEFAULT 0,
        variant TEXT NOT NULL DEFAULT 'original',
        source_item_id INTEGER,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_video_library_folder ON video_library_items(folder_name);
      CREATE INDEX IF NOT EXISTS idx_video_library_created ON video_library_items(created_at DESC);

      CREATE TABLE IF NOT EXISTS video_enhancement_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_item_id INTEGER NOT NULL,
        output_item_id INTEGER,
        provider TEXT NOT NULL DEFAULT 'volc-mediakit',
        tool_version TEXT NOT NULL DEFAULT 'standard',
        target_resolution TEXT NOT NULL DEFAULT '1080p',
        scene TEXT NOT NULL DEFAULT 'aigc',
        status TEXT NOT NULL DEFAULT 'queued',
        external_task_id TEXT NOT NULL DEFAULT '',
        request_id TEXT NOT NULL DEFAULT '',
        public_token TEXT NOT NULL UNIQUE,
        input_base_url TEXT NOT NULL DEFAULT '',
        input_media_uri TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        attempt_count INTEGER NOT NULL DEFAULT 0,
        next_poll_at INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        completed_at INTEGER NOT NULL DEFAULT 0,
        UNIQUE(source_item_id, tool_version, target_resolution)
      );

      CREATE INDEX IF NOT EXISTS idx_video_enhancement_status ON video_enhancement_tasks(status, next_poll_at);

      CREATE TABLE IF NOT EXISTS video_library_folders (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        folder_name TEXT NOT NULL UNIQUE,
        created_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE TABLE IF NOT EXISTS painting_folder_bindings (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        painting_name TEXT NOT NULL DEFAULT '',
        upload_history_id INTEGER,
        image_hash TEXT NOT NULL DEFAULT '',
        folder_id INTEGER NOT NULL,
        folder_name TEXT NOT NULL,
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch()),
        UNIQUE(image_hash, folder_id)
      );

      CREATE INDEX IF NOT EXISTS idx_painting_folder_bindings_hash ON painting_folder_bindings(image_hash);
      CREATE INDEX IF NOT EXISTS idx_painting_folder_bindings_name ON painting_folder_bindings(painting_name);

      CREATE TABLE IF NOT EXISTS painting_batch_runs (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_run_id TEXT NOT NULL UNIQUE,
        creation_request_id TEXT NOT NULL DEFAULT '',
        painting_name TEXT NOT NULL DEFAULT '',
        profile_json TEXT NOT NULL DEFAULT '{}',
        plan_json TEXT NOT NULL DEFAULT '{}',
        image_path TEXT NOT NULL DEFAULT '',
        image_hash TEXT NOT NULL DEFAULT '',
        upload_history_id INTEGER,
        style_preset TEXT NOT NULL DEFAULT '',
        model TEXT NOT NULL DEFAULT '',
        resolution TEXT NOT NULL DEFAULT '',
        ratio TEXT NOT NULL DEFAULT '',
        generate_audio INTEGER NOT NULL DEFAULT 0,
        watermark INTEGER NOT NULL DEFAULT 0,
        variation_round INTEGER NOT NULL DEFAULT 0,
        total_directions INTEGER NOT NULL DEFAULT 40,
        target_folder_id INTEGER,
        target_folder_name TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT 'running',
        control_status TEXT NOT NULL DEFAULT 'running',
        options_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_painting_batch_runs_status ON painting_batch_runs(status);
      CREATE INDEX IF NOT EXISTS idx_painting_batch_runs_control ON painting_batch_runs(control_status);

      CREATE TABLE IF NOT EXISTS painting_batch_tasks (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        batch_run_id TEXT NOT NULL,
        direction_number INTEGER NOT NULL,
        batch_index INTEGER NOT NULL,
        variation_round INTEGER NOT NULL DEFAULT 0,
        idea_id TEXT NOT NULL DEFAULT '',
        idea_title TEXT NOT NULL DEFAULT '',
        idea_summary TEXT NOT NULL DEFAULT '',
        prompt TEXT NOT NULL DEFAULT '',
        duration INTEGER NOT NULL DEFAULT 0,
        seedance_task_id TEXT NOT NULL DEFAULT '',
        video_url TEXT NOT NULL DEFAULT '',
        library_item_id INTEGER,
        library_item_json TEXT NOT NULL DEFAULT '{}',
        status TEXT NOT NULL DEFAULT 'queued',
        retry_count INTEGER NOT NULL DEFAULT 0,
        save_retry_count INTEGER NOT NULL DEFAULT 0,
        error_message TEXT NOT NULL DEFAULT '',
        diversity_ledger_json TEXT NOT NULL DEFAULT '{}',
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );

      CREATE INDEX IF NOT EXISTS idx_painting_batch_tasks_run ON painting_batch_tasks(batch_run_id);
      CREATE INDEX IF NOT EXISTS idx_painting_batch_tasks_status ON painting_batch_tasks(status);
      CREATE INDEX IF NOT EXISTS idx_painting_batch_tasks_task_id ON painting_batch_tasks(seedance_task_id);

      CREATE TABLE IF NOT EXISTS painting_direction_usage (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        image_hash TEXT NOT NULL,
        variation_round INTEGER NOT NULL DEFAULT 0,
        direction_number INTEGER NOT NULL,
        usage_count INTEGER NOT NULL DEFAULT 0,
        last_used_at INTEGER NOT NULL DEFAULT (unixepoch()),
        created_at INTEGER NOT NULL DEFAULT (unixepoch()),
        updated_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_painting_direction_usage_key ON painting_direction_usage(image_hash, variation_round, direction_number);

      CREATE INDEX IF NOT EXISTS idx_store_overview_nodes_type ON store_overview_nodes(type);
      CREATE INDEX IF NOT EXISTS idx_store_overview_edges_source ON store_overview_edges(source_id);
      CREATE INDEX IF NOT EXISTS idx_store_overview_edges_target ON store_overview_edges(target_id);
    `);

    // Migration: add reference_images column if it doesn't exist (existing tables before this column was added)
    try {
      collectionDb.exec(`ALTER TABLE image_generation_tasks ADD COLUMN reference_images TEXT NOT NULL DEFAULT '[]'`);
    } catch {
      // Column already exists, ignore
    }

    // Migration: video library metadata and enhancement lineage.
    for (const statement of [
      `ALTER TABLE video_library_items ADD COLUMN width INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE video_library_items ADD COLUMN height INTEGER NOT NULL DEFAULT 0`,
      `ALTER TABLE video_library_items ADD COLUMN fps REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE video_library_items ADD COLUMN duration_seconds REAL NOT NULL DEFAULT 0`,
      `ALTER TABLE video_library_items ADD COLUMN variant TEXT NOT NULL DEFAULT 'original'`,
      `ALTER TABLE video_library_items ADD COLUMN source_item_id INTEGER`,
    ]) {
      try { collectionDb.exec(statement); } catch {}
    }
    try { collectionDb.exec(`ALTER TABLE video_enhancement_tasks ADD COLUMN input_base_url TEXT NOT NULL DEFAULT ''`); } catch {}
    try { collectionDb.exec(`ALTER TABLE video_enhancement_tasks ADD COLUMN input_media_uri TEXT NOT NULL DEFAULT ''`); } catch {}

    // Migration: ensure video_library_folders has a stable id column for binding.
    const folderColumns = collectionDb.prepare(`PRAGMA table_info(video_library_folders)`).all();
    const hasFolderId = folderColumns.some((col) => col.name === 'id');
    if (!hasFolderId) {
      try {
        collectionDb.exec(`
          ALTER TABLE video_library_folders RENAME TO video_library_folders_old;
          CREATE TABLE video_library_folders (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            folder_name TEXT NOT NULL UNIQUE,
            created_at INTEGER NOT NULL DEFAULT (unixepoch())
          );
          INSERT INTO video_library_folders (folder_name, created_at)
            SELECT folder_name, created_at FROM video_library_folders_old;
          DROP TABLE video_library_folders_old;
        `);
      } catch (migrationError) {
        console.error('[db] video_library_folders id migration failed', migrationError?.message || '');
      }
    }

    const renamedCreativeVideos = migrateLegacyCreativeVideoLibraryNames(collectionDb);
    if (renamedCreativeVideos > 0) {
      console.log(`[db] 已简化 ${renamedCreativeVideos} 条历史创意视频素材名称`);
    }
    ensurePaintingBatchIdempotencyConstraints();
  }
  return collectionDb;
}

// 为“不重复提交 / 不重复扣费”建立真正的数据库幂等约束。
// Seedance 接口不支持客户端幂等键，因此不做伪幂等；这里依靠唯一索引兜底。
// 迁移前先把存量重复记录归档（保留原 seedance_task_id / 方向键供追溯）后删除，
// 避免“只改状态不清空”或“清空 taskId 留下可重试任务”造成重复扣费。
// 索引建立后必须用 PRAGMA 验证真实生效；验证失败则禁用批量创建，绝不在无幂等保护下继续扣费。
let paintingBatchIdempotencyReady = false;

function ensurePaintingBatchIdempotencyConstraints(db = collectionDb) {
  paintingBatchIdempotencyReady = false;
  try {
    db.exec(`
      CREATE TABLE IF NOT EXISTS painting_batch_task_archived_conflicts (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        source_task_id INTEGER NOT NULL,
        batch_run_id TEXT NOT NULL,
        variation_round INTEGER NOT NULL DEFAULT 0,
        direction_number INTEGER NOT NULL,
        seedance_task_id TEXT NOT NULL DEFAULT '',
        status TEXT NOT NULL DEFAULT '',
        error_message TEXT NOT NULL DEFAULT '',
        conflict_kind TEXT NOT NULL,
        archived_at INTEGER NOT NULL DEFAULT (unixepoch())
      );
    `);

    // 创建批次幂等编号：非空 creation_request_id 必须唯一，作为“响应丢失后安全恢复/去重”的数据库兜底。
    // 测试库可能只建了 painting_batch_tasks（无 painting_batch_runs），此处需容忍缺失。
    const hasPaintingBatchRuns = !!db.prepare(`SELECT 1 FROM sqlite_master WHERE type='table' AND name='painting_batch_runs'`).get();
    if (hasPaintingBatchRuns) {
      try {
        db.exec(`ALTER TABLE painting_batch_runs ADD COLUMN creation_request_id TEXT NOT NULL DEFAULT ''`);
      } catch {
        // 列已存在，忽略。
      }
      db.exec(`
        CREATE UNIQUE INDEX IF NOT EXISTS idx_painting_batch_runs_creation_request
          ON painting_batch_runs(creation_request_id) WHERE creation_request_id <> '';
      `);
    }

    const archiveStmt = db.prepare(`
      INSERT INTO painting_batch_task_archived_conflicts
        (source_task_id, batch_run_id, variation_round, direction_number, seedance_task_id, status, error_message, conflict_kind)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `);
    const deleteStmt = db.prepare('DELETE FROM painting_batch_tasks WHERE id = ?');

    // 1) seedance_task_id：非空值必须唯一。存量重复保留最早一条，其余归档（保留原 taskId）后删除。
    const dupSeedance = db.prepare(`
      SELECT seedance_task_id FROM painting_batch_tasks
      WHERE seedance_task_id <> ''
      GROUP BY seedance_task_id HAVING COUNT(*) > 1
    `).all();
    for (const row of dupSeedance) {
      const taskId = String(row.seedance_task_id);
      const dups = db.prepare(`
        SELECT * FROM painting_batch_tasks WHERE seedance_task_id = ? ORDER BY id ASC
      `).all(taskId);
      for (const dup of dups.slice(1)) {
        archiveStmt.run(
          Number(dup.id), String(dup.batch_run_id), Number(dup.variation_round || 0),
          Number(dup.direction_number || 0), String(dup.seedance_task_id), String(dup.status || ''),
          `${String(dup.error_message || '')} 归档原因：seedance_task_id 重复`.trim(),
          'duplicate_seedance_task_id'
        );
        deleteStmt.run(Number(dup.id));
      }
    }

    // 2) (batch_run_id, variation_round, direction_number) 必须唯一。存量重复保留最早一条，其余归档后删除。
    const dupDirection = db.prepare(`
      SELECT batch_run_id, variation_round, direction_number FROM painting_batch_tasks
      GROUP BY batch_run_id, variation_round, direction_number HAVING COUNT(*) > 1
    `).all();
    for (const row of dupDirection) {
      const dups = db.prepare(`
        SELECT * FROM painting_batch_tasks
        WHERE batch_run_id = ? AND variation_round = ? AND direction_number = ?
        ORDER BY id ASC
      `).all(String(row.batch_run_id), Number(row.variation_round), Number(row.direction_number));
      for (const dup of dups.slice(1)) {
        archiveStmt.run(
          Number(dup.id), String(dup.batch_run_id), Number(dup.variation_round || 0),
          Number(dup.direction_number || 0), String(dup.seedance_task_id || ''), String(dup.status || ''),
          `${String(dup.error_message || '')} 归档原因：方向键重复`.trim(),
          'duplicate_direction'
        );
        deleteStmt.run(Number(dup.id));
      }
    }

    // 3) 建立部分唯一索引与复合唯一索引。
    db.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_painting_batch_tasks_seedance_unique
        ON painting_batch_tasks(seedance_task_id) WHERE seedance_task_id <> '';
      CREATE UNIQUE INDEX IF NOT EXISTS idx_painting_batch_tasks_direction_unique
        ON painting_batch_tasks(batch_run_id, variation_round, direction_number);
    `);

    // 4) 验证唯一索引真实存在且生效（creation_request_id 索引位于 painting_batch_runs 表）。
    const verifyIndexColumns = (tableName, indexName, expectedColumns) => {
      const list = db.prepare(`PRAGMA index_list(${tableName})`).all();
      const found = list.find((idx) => idx.name === indexName);
      if (!found) return false;
      const info = db.prepare(`PRAGMA index_info(${indexName})`).all();
      const columns = info.map((col) => String(col.name));
      return expectedColumns.every((col) => columns.includes(col));
    };
    const seedanceIndexOk = verifyIndexColumns('painting_batch_tasks', 'idx_painting_batch_tasks_seedance_unique', ['seedance_task_id']);
    const directionIndexOk = verifyIndexColumns('painting_batch_tasks', 'idx_painting_batch_tasks_direction_unique', ['batch_run_id', 'variation_round', 'direction_number']);
    const creationRequestIndexOk = !hasPaintingBatchRuns || verifyIndexColumns('painting_batch_runs', 'idx_painting_batch_runs_creation_request', ['creation_request_id']);
    if (!seedanceIndexOk || !directionIndexOk || !creationRequestIndexOk) {
      throw new Error(`幂等唯一索引未生效 seedance=${seedanceIndexOk} direction=${directionIndexOk} creationRequest=${creationRequestIndexOk}`);
    }

    paintingBatchIdempotencyReady = true;
    console.log('[db] painting batch idempotency constraints verified OK');
  } catch (error) {
    paintingBatchIdempotencyReady = false;
    console.error('[db] painting batch idempotency migration FAILED — 已禁用批量生成', error?.message || '');
  }
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

// --- Shared Video Library ---

function sanitizeVideoLibraryFolder(value) {
  const folder = readValue(value).replace(/[\\/:*?"<>|]/g, '').trim();
  return (folder || '通用素材').slice(0, 80);
}

function sanitizeVideoLibraryFileName(value) {
  const name = path.basename(readValue(value)).replace(/[\\/:*?"<>|]/g, '').trim();
  return (name || '未命名视频').slice(0, 180);
}

function normalizeLegacyCreativeVideoLibraryName(originalName, note = '') {
  const name = readValue(originalName);
  const normalizedNote = normalizeLegacyVideoLibrarySourceNote(note);
  if (!name || !normalizedNote.includes('来自创意素材')) return name;
  const match = name.match(/^(\d{1,2})月(\d{1,2})日\s+(\d{1,2})[-:](\d{2})(?:\s+第[1-4]组第(?:10|[1-9])个)?(\.[a-z0-9]{2,5})$/i);
  if (!match) return name;
  return `${Number(match[1])}月${Number(match[2])}日 ${match[3].padStart(2, '0')}:${match[4]}${match[5].toLowerCase()}`;
}

function migrateLegacyCreativeVideoLibraryNames(db = collectionDb) {
  if (!db) return 0;
  const rows = db.prepare('SELECT id, original_name, note FROM video_library_items').all();
  const updates = rows
    .map((row) => ({
      id: Number(row.id),
      before: String(row.original_name || ''),
      after: normalizeLegacyCreativeVideoLibraryName(row.original_name, row.note),
    }))
    .filter((row) => row.after && row.after !== row.before);
  if (!updates.length) return 0;
  const update = db.prepare('UPDATE video_library_items SET original_name = ?, updated_at = unixepoch() WHERE id = ?');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const row of updates) update.run(row.after, row.id);
    db.exec('COMMIT');
    return updates.length;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function getVideoLibraryExtension(fileName, mimeType = '') {
  const extension = path.extname(sanitizeVideoLibraryFileName(fileName)).toLowerCase();
  if (VIDEO_LIBRARY_MIME_BY_EXTENSION.has(extension)) return extension;
  const normalizedMime = readValue(mimeType).split(';')[0].trim().toLowerCase();
  for (const [candidateExtension, candidateMime] of VIDEO_LIBRARY_MIME_BY_EXTENSION.entries()) {
    if (candidateMime === normalizedMime) return candidateExtension;
  }
  return '.mp4';
}

function normalizeVideoLibraryMimeType(fileName, mimeType = '') {
  const extension = path.extname(sanitizeVideoLibraryFileName(fileName)).toLowerCase();
  if (VIDEO_LIBRARY_MIME_BY_EXTENSION.has(extension)) {
    return VIDEO_LIBRARY_MIME_BY_EXTENSION.get(extension);
  }
  const normalizedMime = readValue(mimeType).split(';')[0].trim().toLowerCase();
  return normalizedMime.startsWith('video/') ? normalizedMime : '';
}

function getVideoLibraryDownloadName(row) {
  // 素材库可用 10:22 提升时间可读性；真正下载到电脑时改为兼容 Windows 的 10-22。
  const originalName = sanitizeVideoLibraryFileName(readValue(row?.original_name).replace(/:/g, '-'));
  const originalExtension = path.extname(originalName).toLowerCase();
  const actualExtension = getVideoLibraryExtension(row?.stored_name, row?.mime_type);
  if (originalExtension === actualExtension) return originalName;
  if (VIDEO_LIBRARY_MIME_BY_EXTENSION.has(originalExtension)) {
    return `${originalName.slice(0, -originalExtension.length)}${actualExtension}`;
  }
  return `${originalName}${actualExtension}`;
}

function getVideoLibraryThumbnailName(row) {
  const sha256 = readValue(row?.sha256).replace(/[^a-f0-9]/gi, '').toLowerCase();
  return `${sha256 || `video-${Number(row?.id || 0)}`}.jpg`;
}

function getVideoLibraryPreviewName(row) {
  const sha256 = readValue(row?.sha256).replace(/[^a-f0-9]/gi, '').toLowerCase();
  return `${sha256 || `video-${Number(row?.id || 0)}`}.preview-v2.mp4`;
}

function getLegacyVideoLibraryPreviewName(row) {
  const sha256 = readValue(row?.sha256).replace(/[^a-f0-9]/gi, '').toLowerCase();
  return `${sha256 || `video-${Number(row?.id || 0)}`}.preview.mp4`;
}

function formatSeedanceVideoLibraryName(createdAt) {
  const numericCreatedAt = Number(createdAt || 0);
  const timestampMs = numericCreatedAt > 1e12 ? numericCreatedAt : numericCreatedAt * 1000;
  const date = new Date(Number.isFinite(timestampMs) && timestampMs > 0 ? timestampMs : Date.now());
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'numeric',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(date);
  const readPart = (type) => parts.find((part) => part.type === type)?.value || '00';
  return `${Number(readPart('month'))}月${Number(readPart('day'))}日 ${readPart('hour')}:${readPart('minute')}.mp4`;
}

function getPaintingFrameworkPosition(directionNumber) {
  const direction = Number(directionNumber) || 0;
  if (direction < 1 || direction > 40) return null;
  return {
    groupNumber: Math.floor((direction - 1) / 10) + 1,
    itemNumber: ((direction - 1) % 10) + 1,
  };
}

function formatPaintingSeedanceVideoLibraryName(createdAt, _directionNumber) {
  // 方向号已在素材备注中展示，文件名只保留月日和时分，避免重复、过长。
  return formatSeedanceVideoLibraryName(createdAt);
}

function normalizeVideoLibraryItem(row) {
  if (!row) return null;
  const enhancement = row.enhancement_id ? {
    id: Number(row.enhancement_id),
    status: String(row.enhancement_status || ''),
    targetResolution: String(row.enhancement_target_resolution || '1080p'),
    errorMessage: String(row.enhancement_error_message || ''),
    outputItemId: row.enhancement_output_item_id ? Number(row.enhancement_output_item_id) : null,
  } : null;
  return {
    id: Number(row.id),
    folderName: row.folder_name,
    originalName: row.original_name,
    mimeType: row.mime_type || 'video/mp4',
    fileSize: Number(row.file_size || 0),
    sha256: row.sha256,
    note: normalizeLegacyVideoLibrarySourceNote(row.note),
    width: Number(row.width || 0),
    height: Number(row.height || 0),
    fps: Number(row.fps || 0),
    durationSeconds: Number(row.duration_seconds || 0),
    variant: String(row.variant || 'original'),
    sourceItemId: row.source_item_id ? Number(row.source_item_id) : null,
    enhancement,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    streamUrl: `/api/video-library/videos/${Number(row.id)}/file?preview=1`,
    downloadUrl: `/api/video-library/videos/${Number(row.id)}/file?download=1`,
    downloadName: getVideoLibraryDownloadName(row),
    thumbnailUrl: `/api/video-library/videos/${Number(row.id)}/thumbnail`,
  };
}

function dbGetVideoLibraryItems({ folderName = '', query = '' } = {}) {
  const db = getCollectionDb();
  const clauses = [];
  const params = [];
  if (folderName) {
    clauses.push('folder_name = ?');
    params.push(folderName);
  }
  if (query) {
    clauses.push('(original_name LIKE ? OR note LIKE ? OR folder_name LIKE ?)');
    const pattern = `%${query}%`;
    params.push(pattern, pattern, pattern);
  }
  const where = clauses.length ? `WHERE ${clauses.join(' AND ')}` : '';
  const rows = db.prepare(`
    SELECT v.*,
      e.id AS enhancement_id,
      e.status AS enhancement_status,
      e.target_resolution AS enhancement_target_resolution,
      e.error_message AS enhancement_error_message,
      e.output_item_id AS enhancement_output_item_id
    FROM video_library_items v
    LEFT JOIN video_enhancement_tasks e ON e.source_item_id = v.id
    ${where ? where.replaceAll('folder_name', 'v.folder_name').replaceAll('original_name', 'v.original_name').replaceAll('note', 'v.note') : ''}
    ORDER BY v.created_at DESC, v.id DESC
  `).all(...params);
  return rows.map(normalizeVideoLibraryItem).filter(Boolean);
}

function dbGetVideoLibraryFolders() {
  const rows = getCollectionDb().prepare('SELECT folder_name FROM video_library_folders ORDER BY created_at ASC, id ASC').all();
  const itemFolders = getCollectionDb().prepare('SELECT DISTINCT folder_name FROM video_library_items ORDER BY folder_name ASC').all();
  return [...new Set(['通用素材', ...rows.map((row) => row.folder_name), ...itemFolders.map((row) => row.folder_name)])];
}

function dbGetVideoLibrarySummary() {
  return getCollectionDb().prepare(`
    SELECT id, folder_name, created_at
    FROM video_library_items
    ORDER BY id ASC
  `).all().map((row) => ({
    id: Number(row.id),
    folderName: row.folder_name,
    createdAt: Number(row.created_at || 0),
  }));
}

function dbCreateVideoLibraryFolder(folderName) {
  const normalized = sanitizeVideoLibraryFolder(folderName);
  getCollectionDb().prepare('INSERT OR IGNORE INTO video_library_folders (folder_name) VALUES (?)').run(normalized);
  return normalized;
}

function dbGetVideoLibraryItem(id) {
  const row = getCollectionDb().prepare(`
    SELECT v.*,
      e.id AS enhancement_id,
      e.status AS enhancement_status,
      e.target_resolution AS enhancement_target_resolution,
      e.error_message AS enhancement_error_message,
      e.output_item_id AS enhancement_output_item_id
    FROM video_library_items v
    LEFT JOIN video_enhancement_tasks e ON e.source_item_id = v.id
    WHERE v.id = ?
  `).get(Number(id));
  return normalizeVideoLibraryItem(row);
}

function dbFindVideoLibraryByHash(sha256) {
  const row = getCollectionDb().prepare('SELECT * FROM video_library_items WHERE sha256 = ? LIMIT 1').get(sha256);
  return normalizeVideoLibraryItem(row);
}

function dbInsertVideoLibraryItem({ folderName, originalName, storedName, mimeType, fileSize, sha256, note, width = 0, height = 0, fps = 0, durationSeconds = 0, variant = 'original', sourceItemId = null }) {
  const result = getCollectionDb().prepare(`
    INSERT INTO video_library_items
      (folder_name, original_name, stored_name, mime_type, file_size, sha256, note, width, height, fps, duration_seconds, variant, source_item_id)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(folderName, originalName, storedName, mimeType, fileSize, sha256, note, Number(width || 0), Number(height || 0), Number(fps || 0), Number(durationSeconds || 0), String(variant || 'original'), sourceItemId ? Number(sourceItemId) : null);
  return dbGetVideoLibraryItem(Number(result.lastInsertRowid));
}

function dbUpdateVideoLibraryMetadata(id, metadata) {
  getCollectionDb().prepare(`
    UPDATE video_library_items SET width = ?, height = ?, fps = ?, duration_seconds = ?, updated_at = unixepoch() WHERE id = ?
  `).run(Number(metadata?.width || 0), Number(metadata?.height || 0), Number(metadata?.fps || 0), Number(metadata?.durationSeconds || 0), Number(id));
  return dbGetVideoLibraryItem(id);
}

function normalizeVideoEnhancementTask(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    sourceItemId: Number(row.source_item_id),
    outputItemId: row.output_item_id ? Number(row.output_item_id) : null,
    status: String(row.status || ''),
    externalTaskId: String(row.external_task_id || ''),
    requestId: String(row.request_id || ''),
    targetResolution: String(row.target_resolution || '1080p'),
    errorMessage: String(row.error_message || ''),
    attemptCount: Number(row.attempt_count || 0),
    nextPollAt: Number(row.next_poll_at || 0),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
    completedAt: Number(row.completed_at || 0),
  };
}

function dbGetVideoEnhancementTask(id) {
  return normalizeVideoEnhancementTask(getCollectionDb().prepare('SELECT * FROM video_enhancement_tasks WHERE id = ?').get(Number(id)));
}

function dbGetVideoEnhancementTaskBySource(sourceItemId) {
  return normalizeVideoEnhancementTask(getCollectionDb().prepare(`
    SELECT * FROM video_enhancement_tasks
    WHERE source_item_id = ? AND tool_version = 'standard' AND target_resolution = '1080p'
    LIMIT 1
  `).get(Number(sourceItemId)));
}

function dbQueueVideoEnhancement({ sourceItemId, publicToken, inputBaseUrl }) {
  const db = getCollectionDb();
  db.prepare(`
    INSERT OR IGNORE INTO video_enhancement_tasks
      (source_item_id, public_token, input_base_url, status, next_poll_at)
    VALUES (?, ?, ?, 'queued', unixepoch())
  `).run(Number(sourceItemId), String(publicToken), String(inputBaseUrl || ''));
  return dbGetVideoEnhancementTaskBySource(sourceItemId);
}

function dbUpdateVideoEnhancementTask(id, updates = {}) {
  const mapping = {
    outputItemId: 'output_item_id', status: 'status', externalTaskId: 'external_task_id', requestId: 'request_id',
    inputMediaUri: 'input_media_uri', errorMessage: 'error_message', attemptCount: 'attempt_count',
    nextPollAt: 'next_poll_at', completedAt: 'completed_at',
  };
  const fields = [];
  const values = [];
  for (const [key, column] of Object.entries(mapping)) {
    if (updates[key] === undefined) continue;
    fields.push(`${column} = ?`);
    values.push(updates[key]);
  }
  if (!fields.length) return dbGetVideoEnhancementTask(id);
  fields.push('updated_at = unixepoch()');
  values.push(Number(id));
  getCollectionDb().prepare(`UPDATE video_enhancement_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return dbGetVideoEnhancementTask(id);
}

function getPendingVideoEnhancementTask() {
  return getCollectionDb().prepare(`
    SELECT * FROM video_enhancement_tasks
    WHERE status IN ('queued', 'submitted', 'processing', 'downloading') AND next_poll_at <= unixepoch()
    ORDER BY created_at ASC, id ASC LIMIT 1
  `).get();
}

function extractEnhancementOutputUrl(payload) {
  const candidates = [
    payload?.result?.video_url, payload?.result?.videoUrl, payload?.result?.url,
    payload?.output?.video_url, payload?.output?.videoUrl, payload?.output?.url,
    payload?.data?.video_url, payload?.data?.videoUrl, payload?.data?.url,
    payload?.video_url, payload?.videoUrl, payload?.url,
  ];
  const direct = readValue(...candidates);
  if (direct) return direct;
  const queue = [payload?.result, payload?.output, payload?.data].filter(Boolean);
  const visited = new Set();
  while (queue.length) {
    const current = queue.shift();
    if (!current || typeof current !== 'object' || visited.has(current)) continue;
    visited.add(current);
    for (const [key, value] of Object.entries(current)) {
      if (typeof value === 'string' && /^https?:\/\//i.test(value) && /(video|url|output|result)/i.test(key)) return value;
      if (value && typeof value === 'object' && visited.size < 100) queue.push(value);
    }
  }
  return '';
}

function normalizeEnhancementRemoteStatus(payload) {
  return readValue(payload?.status, payload?.data?.status, payload?.result?.status).toLowerCase();
}

function getEnhancementInputUrl(row) {
  const baseUrl = String(row?.input_base_url || getConfiguredPublicBaseUrl()).replace(/\/+$/g, '');
  if (!baseUrl) return '';
  return `${baseUrl}/media-enhancement-input/${encodeURIComponent(String(row.public_token || ''))}`;
}

async function queueVideoEnhancementForLibraryItem(item, { enabled = false, req = null } = {}) {
  if (!item?.id) return { queued: false, reason: 'missing_item' };
  const raw = getCollectionDb().prepare('SELECT * FROM video_library_items WHERE id = ?').get(Number(item.id));
  if (!raw) return { queued: false, reason: 'missing_item' };
  const inputBaseUrl = req ? resolvePublicBaseUrl(req) : getConfiguredPublicBaseUrl();
  let task = enabled ? dbGetVideoEnhancementTaskBySource(item.id) : null;
  if (enabled && !task) {
    task = dbQueueVideoEnhancement({
      sourceItemId: item.id,
      publicToken: randomBytes(24).toString('hex'),
      inputBaseUrl,
    });
    dbUpdateVideoEnhancementTask(task.id, { status: 'checking', errorMessage: '', nextPollAt: 0 });
  }
  const filePath = path.join(VIDEO_LIBRARY_DIR, raw.stored_name);
  let metadata;
  try {
    metadata = await probeVideoMetadata(filePath);
    item = dbUpdateVideoLibraryMetadata(item.id, metadata);
  } catch (error) {
    console.warn('[video enhancement] metadata_probe_failed', { itemId: item.id, message: error?.message || '' });
    if (task) {
      task = dbUpdateVideoEnhancementTask(task.id, {
        status: 'failed', errorMessage: `读取原视频分辨率失败：${error?.message || 'ffprobe 无法识别视频'}`, nextPollAt: 0,
      });
      item = dbGetVideoLibraryItem(item.id) || item;
    }
    return { queued: false, reason: 'metadata_failed', task, item };
  }
  if (!enabled) return { queued: false, reason: 'disabled', item };
  if (task?.status === 'completed') return { queued: false, reason: 'already_completed', task, item: dbGetVideoLibraryItem(item.id) || item };
  if (task?.status === 'failed' && task.attemptCount > 0) return { queued: false, reason: 'existing_failed', task, item: dbGetVideoLibraryItem(item.id) || item };
  if (!isVideo480pOrLower(metadata)) {
    task = dbUpdateVideoEnhancementTask(task.id, {
      status: 'skipped', errorMessage: `检测到原视频为 ${metadata.width}×${metadata.height}，不是480P及以下，无需增强`,
      nextPollAt: 0, completedAt: Math.floor(Date.now() / 1000),
    });
    return { queued: false, reason: 'not_480p', task, item: dbGetVideoLibraryItem(item.id) || item };
  }
  if (!readValue(SERVER_CONFIG.mediakitApiKey)) {
    task = dbUpdateVideoEnhancementTask(task.id, { status: 'failed', errorMessage: '服务器未配置 MEDIAKIT_API_KEY', nextPollAt: 0 });
    return { queued: false, reason: 'not_configured', task, item: dbGetVideoLibraryItem(item.id) || item };
  }
  task = dbUpdateVideoEnhancementTask(task.id, {
    status: task.externalTaskId ? 'processing' : 'queued', errorMessage: '', nextPollAt: Math.floor(Date.now() / 1000),
  });
  scheduleVideoEnhancementWorker(100);
  return { queued: true, task, item: dbGetVideoLibraryItem(item.id) || item };
}

async function handlePublicEnhancementInput(req, res, token) {
  const row = getCollectionDb().prepare(`
    SELECT e.status, v.stored_name, v.mime_type, v.file_size
    FROM video_enhancement_tasks e JOIN video_library_items v ON v.id = e.source_item_id
    WHERE e.public_token = ? AND e.status NOT IN ('completed', 'failed', 'skipped')
  `).get(String(token || ''));
  if (!row) { sendJson(res, 404, { error: '增强任务素材不存在或已失效' }); return; }
  const filePath = path.join(VIDEO_LIBRARY_DIR, row.stored_name);
  try {
    const info = await stat(filePath);
    const headers = {
      'Content-Type': row.mime_type || 'video/mp4',
      'Cache-Control': 'private, max-age=300',
      'Accept-Ranges': 'bytes',
    };
    const range = req.headers.range;
    if (range) {
      const parsedRange = parseVideoLibraryByteRange(range, info.size);
      if (!parsedRange) {
        res.writeHead(416, { ...headers, 'Content-Range': `bytes */${info.size}` });
        res.end();
        return;
      }
      const { start, end } = parsedRange;
      res.writeHead(206, {
        ...headers,
        'Content-Range': `bytes ${start}-${end}/${info.size}`,
        'Content-Length': String(end - start + 1),
      });
      if (req.method === 'HEAD') { res.end(); return; }
      createReadStream(filePath, { start, end, highWaterMark: VIDEO_LIBRARY_STREAM_HIGH_WATER_MARK }).pipe(res);
      return;
    }
    res.writeHead(200, { ...headers, 'Content-Length': info.size });
    if (req.method === 'HEAD') { res.end(); return; }
    createReadStream(filePath, { highWaterMark: VIDEO_LIBRARY_STREAM_HIGH_WATER_MARK }).pipe(res);
  } catch { sendJson(res, 404, { error: '增强任务素材文件不存在' }); }
}

async function submitVideoEnhancement(row) {
  const apiKey = readValue(SERVER_CONFIG.mediakitApiKey);
  if (!apiKey) throw new Error('服务端未配置 MEDIAKIT_API_KEY');
  const source = getCollectionDb().prepare('SELECT * FROM video_library_items WHERE id = ?').get(Number(row.source_item_id));
  if (!source) throw new Error('原视频已被删除');
  const inputUrl = readValue(row.input_media_uri) || await uploadVideoToMediaKit(row, source, apiKey);
  const response = await fetch(`${MEDIAKIT_API_BASE_URL}/api/v1/tools/enhance-video`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      video_url: inputUrl,
      scene: 'aigc',
      tool_version: 'standard',
      resolution: '1080p',
    }),
    signal: AbortSignal.timeout(60 * 1000),
  });
  const text = await response.text();
  const payload = parseJsonString(text, null);
  if (!response.ok) throw new Error(readValue(payload?.error?.message, payload?.message) || `画质增强提交失败（HTTP ${response.status}）`);
  const externalTaskId = readValue(payload?.task_id, payload?.taskId, payload?.data?.task_id);
  if (!externalTaskId) throw new Error('画质增强服务未返回任务编号');
  dbUpdateVideoEnhancementTask(row.id, {
    status: 'submitted', externalTaskId, requestId: readValue(payload?.request_id), errorMessage: '',
    nextPollAt: Math.floor(Date.now() / 1000) + 10,
  });
}

function normalizeMediaKitUploadHeaders(value) {
  if (!value) return {};
  if (!Array.isArray(value) && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, headerValue]) => [String(key), String(headerValue)]));
  }
  if (!Array.isArray(value)) return {};
  const entries = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const key = readValue(item.key, item.name, item.header, item.header_name);
    const headerValue = readValue(item.value, item.header_value);
    if (key && headerValue) entries.push([key, headerValue]);
  }
  return Object.fromEntries(entries);
}

async function uploadVideoToMediaKit(taskRow, source, apiKey) {
  const requestResponse = await fetch(`${MEDIAKIT_API_BASE_URL}/api/v1/tools-sync/request-media-upload-url`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${apiKey}`, 'Content-Type': 'application/json' },
    body: '{}',
    signal: AbortSignal.timeout(60 * 1000),
  });
  const requestText = await requestResponse.text();
  const requestPayload = parseJsonString(requestText, null);
  if (!requestResponse.ok || requestPayload?.success === false) {
    throw new Error(readValue(requestPayload?.error?.message, requestPayload?.message) || `申请媒体上传地址失败（HTTP ${requestResponse.status}）`);
  }
  const uploadResult = requestPayload?.result || requestPayload?.data?.result || requestPayload?.data || {};
  const mediaUri = readValue(uploadResult?.file_id, uploadResult?.fileId);
  const uploadUrl = readValue(uploadResult?.upload_url, uploadResult?.uploadUrl);
  const uploadMethod = readValue(uploadResult?.method).toUpperCase() || 'PUT';
  if (!mediaUri || !uploadUrl) throw new Error('AI MediaKit 未返回媒体上传地址或文件标识');

  const sourcePath = path.join(VIDEO_LIBRARY_DIR, source.stored_name);
  const sourceInfo = await stat(sourcePath);
  const uploadHeaders = {
    ...normalizeMediaKitUploadHeaders(uploadResult?.upload_headers || uploadResult?.uploadHeaders),
    'Content-Type': source.mime_type || 'video/mp4',
    'Content-Length': String(sourceInfo.size),
  };
  const uploadResponse = await fetch(uploadUrl, {
    method: uploadMethod,
    headers: uploadHeaders,
    body: createReadStream(sourcePath),
    duplex: 'half',
    signal: AbortSignal.timeout(5 * 60 * 1000),
  });
  if (!uploadResponse.ok) {
    const uploadError = await uploadResponse.text().catch(() => '');
    throw new Error(`上传原视频到 AI MediaKit 失败（HTTP ${uploadResponse.status}${uploadError ? `：${uploadError.slice(0, 160)}` : ''}）`);
  }
  dbUpdateVideoEnhancementTask(taskRow.id, { inputMediaUri: mediaUri, errorMessage: '' });
  return mediaUri;
}

async function downloadEnhancedVideo(row, outputUrl) {
  dbUpdateVideoEnhancementTask(row.id, { status: 'downloading', nextPollAt: Math.floor(Date.now() / 1000) + 30 });
  const source = getCollectionDb().prepare('SELECT * FROM video_library_items WHERE id = ?').get(Number(row.source_item_id));
  if (!source) throw new Error('原视频已被删除');
  const response = await fetch(outputUrl, { signal: AbortSignal.timeout(3 * 60 * 1000) });
  if (!response.ok) throw new Error(`增强视频下载失败（HTTP ${response.status}）`);
  const buffer = await readVideoLibraryRemoteBuffer(response);
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  let outputItem = dbFindVideoLibraryByHash(sha256);
  if (!outputItem) {
    const storedName = `${sha256}.mp4`;
    const filePath = path.join(VIDEO_LIBRARY_DIR, storedName);
    await writeFile(filePath, buffer);
    const metadata = await probeVideoMetadata(filePath);
    outputItem = dbInsertVideoLibraryItem({
      folderName: source.folder_name,
      originalName: source.original_name || '视频.mp4',
      storedName,
      mimeType: 'video/mp4',
      fileSize: buffer.length,
      sha256,
      note: source.note || '',
      ...metadata,
      variant: 'enhanced',
      sourceItemId: null,
    });
    void ensureVideoLibraryPreview({ id: outputItem.id, stored_name: storedName, sha256 }).catch(() => {});
    void ensureVideoLibraryThumbnail({ id: outputItem.id, stored_name: storedName, sha256 }).catch(() => {});
  }
  if (readValue(source.note)) {
    outputItem = dbUpdateVideoLibraryNote(outputItem.id, source.note);
  }
  dbUpdateVideoEnhancementTask(row.id, {
    status: 'completed', outputItemId: outputItem.id, errorMessage: '',
    nextPollAt: 0, completedAt: Math.floor(Date.now() / 1000),
  });
  if (Number(outputItem.id) !== Number(source.id)) {
    const deletedSource = dbDeleteVideoLibraryItem(source.id);
    if (deletedSource) await deleteVideoLibraryItemFiles(deletedSource);
  }
}

async function pollVideoEnhancement(row) {
  const response = await fetch(`${MEDIAKIT_API_BASE_URL}/api/v1/tasks/${encodeURIComponent(row.external_task_id)}`, {
    headers: { Authorization: `Bearer ${readValue(SERVER_CONFIG.mediakitApiKey)}` },
    signal: AbortSignal.timeout(60 * 1000),
  });
  const text = await response.text();
  const payload = parseJsonString(text, null);
  if (!response.ok) throw new Error(readValue(payload?.error?.message, payload?.message) || `画质增强查询失败（HTTP ${response.status}）`);
  const status = normalizeEnhancementRemoteStatus(payload);
  if (['failed', 'error', 'cancelled', 'canceled'].includes(status)) {
    throw new Error(readValue(payload?.error?.message, payload?.message, payload?.result?.message) || '画质增强任务失败');
  }
  if (['completed', 'succeeded', 'success', 'done'].includes(status)) {
    const outputUrl = extractEnhancementOutputUrl(payload);
    if (!outputUrl) throw new Error('画质增强完成但未返回视频地址');
    await downloadEnhancedVideo(row, outputUrl);
    return;
  }
  dbUpdateVideoEnhancementTask(row.id, { status: 'processing', nextPollAt: Math.floor(Date.now() / 1000) + 10 });
}

async function runVideoEnhancementWorker() {
  if (videoEnhancementWorkerActive) return;
  videoEnhancementWorkerActive = true;
  try {
    const row = getPendingVideoEnhancementTask();
    if (!row) return;
    try {
      if (!row.external_task_id) await submitVideoEnhancement(row);
      else await pollVideoEnhancement(row);
    } catch (error) {
      const attempts = Number(row.attempt_count || 0) + 1;
      const terminal = attempts >= MEDIAKIT_ENHANCEMENT_MAX_ATTEMPTS;
      dbUpdateVideoEnhancementTask(row.id, {
        status: terminal ? 'failed' : (row.external_task_id ? 'processing' : 'queued'),
        attemptCount: attempts,
        errorMessage: error?.message || '画质增强失败',
        nextPollAt: terminal ? 0 : Math.floor(Date.now() / 1000) + Math.min(60, attempts * 10),
      });
      console.error('[video enhancement] worker_failed', { id: row.id, attempts, terminal, message: error?.message || '' });
    }
  } finally {
    videoEnhancementWorkerActive = false;
    scheduleVideoEnhancementWorker(MEDIAKIT_ENHANCEMENT_POLL_INTERVAL_MS);
  }
}

function scheduleVideoEnhancementWorker(delayMs = MEDIAKIT_ENHANCEMENT_POLL_INTERVAL_MS) {
  if (videoEnhancementWorkerTimer) clearTimeout(videoEnhancementWorkerTimer);
  videoEnhancementWorkerTimer = setTimeout(() => void runVideoEnhancementWorker(), Math.max(50, delayMs));
  videoEnhancementWorkerTimer.unref?.();
}

function buildVideoEnhancementRetryUpdates(nowSeconds = Math.floor(Date.now() / 1000)) {
  return {
    status: 'queued', externalTaskId: '', requestId: '', inputMediaUri: '', attemptCount: 0, errorMessage: '',
    nextPollAt: nowSeconds,
  };
}

function retryVideoEnhancementTask(id) {
  const task = dbGetVideoEnhancementTask(id);
  if (!task) return null;
  const updated = dbUpdateVideoEnhancementTask(id, buildVideoEnhancementRetryUpdates());
  scheduleVideoEnhancementWorker(100);
  return updated;
}

async function handleStartVideoEnhancement(req, res, id) {
  const item = dbGetVideoLibraryItem(id);
  if (!item) { sendJson(res, 404, { error: '视频素材不存在' }); return; }
  const result = await queueVideoEnhancementForLibraryItem(item, { enabled: true, req });
  const statusCode = result.queued || ['already_completed', 'not_480p'].includes(result.reason) ? 200 : 400;
  sendJson(res, statusCode, {
    ok: statusCode === 200,
    item: result.item || dbGetVideoLibraryItem(id),
    enhancement: result,
    error: statusCode === 200 ? undefined : (result.task?.errorMessage || '画质增强未能启动'),
  });
}

function dbUpdateVideoLibraryNote(id, note) {
  getCollectionDb().prepare('UPDATE video_library_items SET note = ?, updated_at = unixepoch() WHERE id = ?').run(note, Number(id));
  return dbGetVideoLibraryItem(id);
}

function dbDeleteVideoLibraryItem(id) {
  const db = getCollectionDb();
  const row = db.prepare('SELECT id, stored_name, sha256 FROM video_library_items WHERE id = ?').get(Number(id));
  if (!row) return null;
  db.prepare('DELETE FROM video_library_items WHERE id = ?').run(Number(id));
  return row;
}

async function deleteVideoLibraryItemFiles(item) {
  if (!item) return;
  await Promise.all([
    unlink(path.join(VIDEO_LIBRARY_DIR, item.stored_name)).catch(() => {}),
    unlink(path.join(VIDEO_LIBRARY_DIR, getVideoLibraryThumbnailName(item))).catch(() => {}),
    unlink(path.join(VIDEO_LIBRARY_DIR, getVideoLibraryPreviewName(item))).catch(() => {}),
    unlink(path.join(VIDEO_LIBRARY_DIR, getLegacyVideoLibraryPreviewName(item))).catch(() => {}),
  ]);
}

async function cleanupCompletedVideoEnhancementSources() {
  const rows = getCollectionDb().prepare(`
    SELECT s.id, s.stored_name, s.sha256, s.note AS source_note, o.id AS output_id
    FROM video_enhancement_tasks e
    JOIN video_library_items s ON s.id = e.source_item_id
    JOIN video_library_items o ON o.id = e.output_item_id
    WHERE e.status = 'completed' AND s.id <> o.id
  `).all();
  for (const row of rows) {
    if (readValue(row.source_note)) dbUpdateVideoLibraryNote(row.output_id, row.source_note);
    const deletedSource = dbDeleteVideoLibraryItem(row.id);
    if (deletedSource) await deleteVideoLibraryItemFiles(deletedSource);
  }
  return rows.length;
}

function dbGetVideoLibraryFolderId(folderName) {
  const normalized = sanitizeVideoLibraryFolder(folderName);
  const row = getCollectionDb().prepare('SELECT id FROM video_library_folders WHERE folder_name = ?').get(normalized);
  return row ? Number(row.id) : null;
}

function dbGetVideoLibraryFolderNameById(id) {
  const row = getCollectionDb().prepare('SELECT folder_name FROM video_library_folders WHERE id = ?').get(Number(id));
  return row ? String(row.folder_name) : '';
}

function dbEnsureVideoLibraryFolder(folderName) {
  const normalized = sanitizeVideoLibraryFolder(folderName);
  getCollectionDb().prepare('INSERT OR IGNORE INTO video_library_folders (folder_name) VALUES (?)').run(normalized);
  const id = dbGetVideoLibraryFolderId(normalized);
  return { id, folderName: normalized };
}

function dbUpsertPaintingFolderBinding({ paintingName, uploadHistoryId, imageHash, folderId, folderName }) {
  const db = getCollectionDb();
  const existing = db.prepare('SELECT id FROM painting_folder_bindings WHERE image_hash = ?').get(String(imageHash || ''));
  if (existing) {
    db.prepare(`
      UPDATE painting_folder_bindings
      SET painting_name = ?, upload_history_id = ?, folder_id = ?, folder_name = ?, updated_at = unixepoch()
      WHERE id = ?
    `).run(
      String(paintingName || '').slice(0, 200),
      Number(uploadHistoryId) || null,
      Number(folderId) || null,
      sanitizeVideoLibraryFolder(folderName),
      Number(existing.id)
    );
    return Number(existing.id);
  }
  const result = db.prepare(`
    INSERT INTO painting_folder_bindings (painting_name, upload_history_id, image_hash, folder_id, folder_name, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `).run(
    String(paintingName || '').slice(0, 200),
    Number(uploadHistoryId) || null,
    String(imageHash || '').slice(0, 128),
    Number(folderId) || null,
    sanitizeVideoLibraryFolder(folderName)
  );
  return Number(result.lastInsertRowid);
}

function dbGetPaintingFolderBinding(imageHash) {
  const row = getCollectionDb().prepare(`
    SELECT * FROM painting_folder_bindings WHERE image_hash = ? ORDER BY updated_at DESC LIMIT 1
  `).get(String(imageHash || ''));
  if (!row) return null;
  const currentName = dbGetVideoLibraryFolderNameById(Number(row.folder_id));
  return {
    id: Number(row.id),
    paintingName: row.painting_name,
    uploadHistoryId: row.upload_history_id,
    imageHash: row.image_hash,
    folderId: Number(row.folder_id),
    folderName: currentName || row.folder_name,
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

function normalizeBatchRun(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    batchRunId: row.batch_run_id,
    creationRequestId: row.creation_request_id || '',
    paintingName: row.painting_name,
    profile: parseJsonString(row.profile_json, {}),
    plan: parseJsonString(row.plan_json, {}),
    imagePath: row.image_path,
    imageHash: row.image_hash,
    uploadHistoryId: row.upload_history_id,
    stylePreset: row.style_preset,
    model: row.model,
    resolution: row.resolution,
    ratio: row.ratio,
    generateAudio: Boolean(row.generate_audio),
    watermark: Boolean(row.watermark),
    variationRound: Number(row.variation_round || 0),
    totalDirections: Number(row.total_directions || 40),
    targetFolderId: row.target_folder_id,
    targetFolderName: row.target_folder_name,
    status: row.status,
    controlStatus: row.control_status,
    options: parseJsonString(row.options_json, {}),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

function normalizeBatchTask(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    batchRunId: row.batch_run_id,
    directionNumber: Number(row.direction_number || 0),
    batchIndex: Number(row.batch_index || 0),
    variationRound: Number(row.variation_round || 0),
    ideaId: row.idea_id,
    ideaTitle: row.idea_title,
    ideaSummary: row.idea_summary,
    prompt: row.prompt,
    duration: Number(row.duration || 0),
    seedanceTaskId: row.seedance_task_id,
    videoUrl: row.video_url,
    libraryItemId: row.library_item_id,
    libraryItem: parseJsonString(row.library_item_json, null),
    status: row.status,
    retryCount: Number(row.retry_count || 0),
    saveRetryCount: Number(row.save_retry_count || 0),
    errorMessage: row.error_message,
    diversityLedger: parseJsonString(row.diversity_ledger_json, {}),
    createdAt: Number(row.created_at || 0),
    updatedAt: Number(row.updated_at || 0),
  };
}

function dbInsertPaintingBatchRun(data) {
  const db = getCollectionDb();
  const result = db.prepare(`
    INSERT INTO painting_batch_runs
      (batch_run_id, creation_request_id, painting_name, profile_json, plan_json, image_path, image_hash, upload_history_id,
       style_preset, model, resolution, ratio, generate_audio, watermark, variation_round, total_directions,
       target_folder_id, target_folder_name, status, control_status, options_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `).run(
    data.batchRunId,
    String(data.creationRequestId || '').slice(0, 128),
    String(data.paintingName || '').slice(0, 200),
    JSON.stringify(data.profile || {}),
    JSON.stringify(data.plan || {}),
    String(data.imagePath || ''),
    String(data.imageHash || '').slice(0, 128),
    Number(data.uploadHistoryId) || null,
    String(data.stylePreset || ''),
    String(data.model || ''),
    String(data.resolution || ''),
    String(data.ratio || ''),
    data.generateAudio ? 1 : 0,
    data.watermark ? 1 : 0,
    Number(data.variationRound) || 0,
    Number(data.totalDirections) || 40,
    Number(data.targetFolderId) || null,
    String(data.targetFolderName || ''),
    String(data.status || 'running'),
    String(data.controlStatus || 'running'),
    JSON.stringify(data.options || {})
  );
  return normalizeBatchRun(db.prepare('SELECT * FROM painting_batch_runs WHERE id = ?').get(Number(result.lastInsertRowid)));
}

function dbUpdatePaintingBatchRun(batchRunId, updates) {
  const db = getCollectionDb();
  const fields = [];
  const values = [];
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(String(updates.status)); }
  if (updates.controlStatus !== undefined) { fields.push('control_status = ?'); values.push(String(updates.controlStatus)); }
  if (updates.targetFolderId !== undefined) { fields.push('target_folder_id = ?'); values.push(Number(updates.targetFolderId) || null); }
  if (updates.targetFolderName !== undefined) { fields.push('target_folder_name = ?'); values.push(String(updates.targetFolderName)); }
  if (updates.options !== undefined) { fields.push('options_json = ?'); values.push(JSON.stringify(updates.options)); }
  if (updates.updatedAt !== undefined) { fields.push('updated_at = ?'); values.push(Number(updates.updatedAt)); }
  if (fields.length === 0) return null;
  values.push(String(batchRunId));
  db.prepare(`UPDATE painting_batch_runs SET ${fields.join(', ')} WHERE batch_run_id = ?`).run(...values);
  return normalizeBatchRun(db.prepare('SELECT * FROM painting_batch_runs WHERE batch_run_id = ?').get(String(batchRunId)));
}

function dbGetPaintingBatchRun(batchRunId) {
  return normalizeBatchRun(getCollectionDb().prepare('SELECT * FROM painting_batch_runs WHERE batch_run_id = ?').get(String(batchRunId)));
}

function dbGetPaintingBatchRunByCreationRequestId(creationRequestId) {
  const id = String(creationRequestId || '');
  if (!id) return null;
  return normalizeBatchRun(getCollectionDb().prepare('SELECT * FROM painting_batch_runs WHERE creation_request_id = ?').get(id));
}

function dbGetActivePaintingBatchRuns() {
  const rows = getCollectionDb().prepare(`
    SELECT * FROM painting_batch_runs
    WHERE status IN ('running', 'paused', 'stopping')
    ORDER BY created_at ASC
  `).all();
  return rows.map(normalizeBatchRun).filter(Boolean);
}

function dbGetRecentPaintingBatchRuns(limit = 20) {
  const rows = getCollectionDb().prepare(`
    SELECT * FROM painting_batch_runs ORDER BY created_at DESC LIMIT ?
  `).all(Number(limit));
  return rows.map(normalizeBatchRun).filter(Boolean);
}

function dbDeletePaintingBatchRun(batchRunId) {
  const db = getCollectionDb();
  const id = String(batchRunId || '');
  if (!id) return false;
  db.exec('BEGIN IMMEDIATE');
  try {
    db.prepare('DELETE FROM painting_batch_tasks WHERE batch_run_id = ?').run(id);
    const result = db.prepare('DELETE FROM painting_batch_runs WHERE batch_run_id = ?').run(id);
    db.exec('COMMIT');
    return Number(result.changes || 0) > 0;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

function dbInsertPaintingBatchTask(data) {
  const db = getCollectionDb();
  const result = db.prepare(`
    INSERT INTO painting_batch_tasks
      (batch_run_id, direction_number, batch_index, variation_round, idea_id, idea_title, idea_summary,
       prompt, duration, seedance_task_id, video_url, library_item_id, library_item_json, status,
       retry_count, save_retry_count, error_message, diversity_ledger_json, created_at, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, unixepoch(), unixepoch())
  `).run(
    data.batchRunId,
    Number(data.directionNumber) || 0,
    Number(data.batchIndex) || 0,
    Number(data.variationRound) || 0,
    String(data.ideaId || ''),
    String(data.ideaTitle || ''),
    String(data.ideaSummary || ''),
    String(data.prompt || ''),
    Number(data.duration) || 0,
    String(data.seedanceTaskId || ''),
    String(data.videoUrl || ''),
    data.libraryItemId || null,
    JSON.stringify(data.libraryItem || {}),
    String(data.status || 'queued'),
    Number(data.retryCount) || 0,
    Number(data.saveRetryCount) || 0,
    String(data.errorMessage || ''),
    JSON.stringify(data.diversityLedger || {})
  );
  return normalizeBatchTask(db.prepare('SELECT * FROM painting_batch_tasks WHERE id = ?').get(Number(result.lastInsertRowid)));
}

function dbUpdatePaintingBatchTask(id, updates) {
  const db = getCollectionDb();
  const fields = [];
  const values = [];
  if (updates.prompt !== undefined) { fields.push('prompt = ?'); values.push(String(updates.prompt)); }
  if (updates.duration !== undefined) { fields.push('duration = ?'); values.push(Number(updates.duration)); }
  if (updates.seedanceTaskId !== undefined) { fields.push('seedance_task_id = ?'); values.push(String(updates.seedanceTaskId)); }
  if (updates.videoUrl !== undefined) { fields.push('video_url = ?'); values.push(String(updates.videoUrl)); }
  if (updates.libraryItemId !== undefined) { fields.push('library_item_id = ?'); values.push(updates.libraryItemId || null); }
  if (updates.libraryItem !== undefined) { fields.push('library_item_json = ?'); values.push(JSON.stringify(updates.libraryItem || {})); }
  if (updates.status !== undefined) { fields.push('status = ?'); values.push(String(updates.status)); }
  if (updates.retryCount !== undefined) { fields.push('retry_count = ?'); values.push(Number(updates.retryCount)); }
  if (updates.saveRetryCount !== undefined) { fields.push('save_retry_count = ?'); values.push(Number(updates.saveRetryCount)); }
  if (updates.errorMessage !== undefined) { fields.push('error_message = ?'); values.push(String(updates.errorMessage)); }
  if (updates.diversityLedger !== undefined) { fields.push('diversity_ledger_json = ?'); values.push(JSON.stringify(updates.diversityLedger || {})); }
  if (fields.length === 0) return null;
  values.push(Number(id));
  db.prepare(`UPDATE painting_batch_tasks SET ${fields.join(', ')} WHERE id = ?`).run(...values);
  return normalizeBatchTask(db.prepare('SELECT * FROM painting_batch_tasks WHERE id = ?').get(Number(id)));
}

function dbGetPaintingBatchTasks(batchRunId) {
  const rows = getCollectionDb().prepare(`
    SELECT * FROM painting_batch_tasks WHERE batch_run_id = ? ORDER BY direction_number ASC, variation_round ASC, id ASC
  `).all(String(batchRunId));
  return rows.map(normalizeBatchTask).filter(Boolean);
}

function dbGetPaintingBatchTask(id) {
  return normalizeBatchTask(getCollectionDb().prepare('SELECT * FROM painting_batch_tasks WHERE id = ?').get(Number(id)));
}

function dbGetPaintingBatchTaskBySeedanceTaskId(seedanceTaskId) {
  // 禁止用空字符串做冲突检查（空 taskId 无幂等意义，且会命中所有未提交任务）。
  const taskId = String(seedanceTaskId || '');
  if (!taskId) return null;
  return normalizeBatchTask(getCollectionDb().prepare('SELECT * FROM painting_batch_tasks WHERE seedance_task_id = ?').get(taskId));
}

function dbMarkPaintingDirectionUsed(imageHash, variationRound, directionNumber) {
  const hash = String(imageHash || '');
  const direction = Number(directionNumber) || 0;
  if (!hash || !direction) return;
  getCollectionDb().prepare(`
    INSERT INTO painting_direction_usage (image_hash, variation_round, direction_number, usage_count, last_used_at, created_at, updated_at)
    VALUES (?, ?, ?, 1, unixepoch(), unixepoch(), unixepoch())
    ON CONFLICT(image_hash, variation_round, direction_number)
    DO UPDATE SET usage_count = usage_count + 1, last_used_at = unixepoch(), updated_at = unixepoch()
  `).run(hash, Number(variationRound) || 0, direction);
}

function dbGetPaintingUsedDirections(imageHash, variationRound) {
  const hash = String(imageHash || '');
  if (!hash) return [];
  const rows = getCollectionDb().prepare(`
    SELECT direction_number FROM painting_direction_usage
    WHERE image_hash = ? AND variation_round = ? AND usage_count > 0
    ORDER BY direction_number ASC
  `).all(hash, Number(variationRound) || 0);
  return rows.map((row) => Number(row.direction_number));
}

function dbGetPaintingBatchTasksByStatus(batchRunId, statuses) {
  const list = Array.isArray(statuses) ? statuses : [statuses];
  if (!list.length) return [];
  const placeholders = list.map(() => '?').join(',');
  const rows = getCollectionDb().prepare(`
    SELECT * FROM painting_batch_tasks WHERE batch_run_id = ? AND status IN (${placeholders}) ORDER BY id ASC
  `).all(String(batchRunId), ...list);
  return rows.map(normalizeBatchTask).filter(Boolean);
}

async function ensurePaintingBatchRunDir() {
  await mkdir(PAINTING_BATCH_RUN_DIR, { recursive: true });
}

async function ensurePaintingBatchRunImage(imageHash, file) {
  await ensurePaintingBatchRunDir();
  const ext = path.extname(sanitizeFileName(file.name || 'painting.jpg')).toLowerCase() || '.jpg';
  const storedName = `${String(imageHash).slice(0, 32)}${ext}`;
  const filePath = path.join(PAINTING_BATCH_RUN_DIR, storedName);
  const buffer = Buffer.from(await file.arrayBuffer());
  await writeFile(filePath, buffer);
  return { filePath, size: buffer.length };
}

async function ensurePaintingBatchRunImageFromUploadHistory(uploadHistoryId) {
  try {
    const item = await getUploadHistoryItem(Number(uploadHistoryId));
    if (!item || !item.blob) return null;
    const file = blobToFile(item);
    const hash = createHash('sha256').update(Buffer.from(await file.arrayBuffer())).digest('hex');
    const result = await ensurePaintingBatchRunImage(hash, file);
    return { ...result, imageHash: hash };
  } catch {
    return null;
  }
}

async function ensurePaintingBatchRunImageFromBatchRun(batchRun) {
  if (batchRun.imagePath && existsSync(batchRun.imagePath)) {
    return batchRun.imagePath;
  }
  if (batchRun.uploadHistoryId) {
    const restored = await ensurePaintingBatchRunImageFromUploadHistory(batchRun.uploadHistoryId);
    if (restored) {
      dbUpdatePaintingBatchRun(batchRun.batchRunId, { imagePath: restored.filePath, imageHash: restored.imageHash });
      return restored.filePath;
    }
  }
  return null;
}

async function ensureVideoLibraryDir() {
  await mkdir(VIDEO_LIBRARY_DIR, { recursive: true });
}

function runNextVideoLibraryThumbnailJob() {
  while (activeVideoLibraryThumbnailJobs < VIDEO_LIBRARY_THUMBNAIL_CONCURRENCY && videoLibraryThumbnailJobs.length) {
    const job = videoLibraryThumbnailJobs.shift();
    activeVideoLibraryThumbnailJobs += 1;
    Promise.resolve()
      .then(job.task)
      .then(job.resolve, job.reject)
      .finally(() => {
        activeVideoLibraryThumbnailJobs -= 1;
        runNextVideoLibraryThumbnailJob();
      });
  }
}

function enqueueVideoLibraryThumbnailJob(task) {
  return new Promise((resolve, reject) => {
    videoLibraryThumbnailJobs.push({ task, resolve, reject });
    runNextVideoLibraryThumbnailJob();
  });
}

async function ensureVideoLibraryThumbnail(row) {
  await ensureVideoLibraryDir();
  const thumbnailPath = path.join(VIDEO_LIBRARY_DIR, getVideoLibraryThumbnailName(row));
  if (existsSync(thumbnailPath)) return thumbnailPath;
  if (videoLibraryThumbnailPromises.has(thumbnailPath)) {
    return videoLibraryThumbnailPromises.get(thumbnailPath);
  }

  const promise = enqueueVideoLibraryThumbnailJob(async () => {
    if (existsSync(thumbnailPath)) return thumbnailPath;
    const videoPath = path.join(VIDEO_LIBRARY_DIR, row.stored_name);
    await execFileAsync('ffmpeg', [
      '-y',
      '-i', videoPath,
      '-vf', `thumbnail=30,scale=${VIDEO_LIBRARY_THUMBNAIL_MAX_WIDTH}:-2:force_original_aspect_ratio=decrease`,
      '-frames:v', '1',
      '-q:v', '4',
      thumbnailPath,
    ], {
      timeout: 30 * 1000,
      killSignal: 'SIGKILL',
    });
    return thumbnailPath;
  }).finally(() => {
    videoLibraryThumbnailPromises.delete(thumbnailPath);
  });
  videoLibraryThumbnailPromises.set(thumbnailPath, promise);
  return promise;
}

async function ensureVideoLibraryPreview(rowOrItem) {
  const row = rowOrItem?.stored_name
    ? rowOrItem
    : getCollectionDb().prepare('SELECT * FROM video_library_items WHERE id = ?').get(Number(rowOrItem?.id || 0));
  if (!row) throw new Error('视频不存在');

  await ensureVideoLibraryDir();
  const sourcePath = path.join(VIDEO_LIBRARY_DIR, row.stored_name);
  const sourceExtension = path.extname(row.stored_name || '').toLowerCase();
  if (!['.mp4', '.m4v', '.mov'].includes(sourceExtension)) return sourcePath;

  const previewPath = path.join(VIDEO_LIBRARY_DIR, getVideoLibraryPreviewName(row));
  if (existsSync(previewPath)) return previewPath;
  if (videoLibraryPreviewPromises.has(previewPath)) {
    return videoLibraryPreviewPromises.get(previewPath);
  }

  const promise = enqueueVideoLibraryThumbnailJob(async () => {
    if (existsSync(previewPath)) return previewPath;
    const temporaryPath = `${previewPath}.${process.pid}-${randomBytes(4).toString('hex')}.mp4`;
    try {
      await execFileAsync('ffmpeg', [
        '-y',
        '-i', sourcePath,
        '-map', '0:v:0',
        '-map', '0:a:0?',
        '-vf', `scale=${VIDEO_LIBRARY_PREVIEW_MAX_WIDTH}:-2:force_original_aspect_ratio=decrease`,
        '-c:v', 'libx264',
        '-preset', 'veryfast',
        '-crf', '27',
        '-maxrate', '1400k',
        '-bufsize', '2800k',
        '-pix_fmt', 'yuv420p',
        '-c:a', 'aac',
        '-b:a', '96k',
        '-ac', '2',
        '-threads', '1',
        '-movflags', '+faststart',
        temporaryPath,
      ], {
        timeout: 2 * 60 * 1000,
        killSignal: 'SIGKILL',
      });
      await rename(temporaryPath, previewPath);
      await unlink(path.join(VIDEO_LIBRARY_DIR, getLegacyVideoLibraryPreviewName(row))).catch(() => {});
      return previewPath;
    } catch (error) {
      await unlink(temporaryPath).catch(() => {});
      console.warn('[video library] preview_transcode_failed', {
        id: Number(row.id || 0),
        message: error?.message || '',
      });
      try {
        await execFileAsync('ffmpeg', [
          '-y',
          '-i', sourcePath,
          '-map', '0',
          '-c', 'copy',
          '-movflags', '+faststart',
          temporaryPath,
        ], {
          timeout: 30 * 1000,
          killSignal: 'SIGKILL',
        });
        await rename(temporaryPath, previewPath);
        return previewPath;
      } catch {
        await unlink(temporaryPath).catch(() => {});
        return sourcePath;
      }
    }
  }).finally(() => {
    videoLibraryPreviewPromises.delete(previewPath);
  });
  videoLibraryPreviewPromises.set(previewPath, promise);
  return promise;
}

async function readVideoLibraryUploadBody(req) {
  const contentLength = Number(req.headers['content-length'] || 0);
  if (contentLength && contentLength > VIDEO_LIBRARY_MAX_FILE_BYTES + 256 * 1024) {
    throw new Error('视频文件不能超过 40MB');
  }
  const request = new Request('http://localhost/video-library-upload', {
    method: req.method || 'POST',
    headers: req.headers,
    body: req,
    duplex: 'half'
  });
  const formData = await request.formData();
  const file = formData.get('file');
  return {
    folderName: sanitizeVideoLibraryFolder(formData.get('folderName')),
    note: readValue(formData.get('note')).slice(0, 1000),
    file: file instanceof File ? file : null,
  };
}

async function handleGetVideoLibrary(req, res, url) {
  const folderName = sanitizeVideoLibraryFolder(url.searchParams.get('folder') || '');
  const query = readValue(url.searchParams.get('q'));
  const items = dbGetVideoLibraryItems({ folderName: url.searchParams.get('folder') ? folderName : '', query });
  const folders = dbGetVideoLibraryFolders();
  items.slice(0, 4).forEach((item) => {
    void ensureVideoLibraryPreview(item).catch(() => {});
  });
  sendJson(res, 200, { ok: true, items, folders });
}

async function handleCreateVideoLibraryFolder(req, res) {
  try {
    const body = await readRequestBody(req);
    const folderName = readValue(body?.folderName);
    if (!folderName.trim()) {
      sendJson(res, 400, { error: '请输入文件夹名称' });
      return;
    }
    const folder = dbCreateVideoLibraryFolder(folderName);
    sendJson(res, 201, { ok: true, folder });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '新建文件夹失败' });
  }
}

async function handleGetVideoLibraryFolders(req, res) {
  sendJson(res, 200, { ok: true, folders: dbGetVideoLibraryFolders() });
}

async function handleGetVideoLibrarySummary(req, res) {
  sendJson(res, 200, { ok: true, items: dbGetVideoLibrarySummary() });
}

async function readVideoLibraryRemoteBuffer(response) {
  const declaredSize = Number(response.headers.get('content-length') || 0);
  if (declaredSize > VIDEO_LIBRARY_MAX_FILE_BYTES) {
    throw new Error('生成视频超过 40MB，暂时不能保存到视频素材库');
  }
  if (!response.body) throw new Error('生成视频没有可读取的文件内容');

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    const chunk = Buffer.from(value);
    totalBytes += chunk.length;
    if (totalBytes > VIDEO_LIBRARY_MAX_FILE_BYTES) {
      await reader.cancel().catch(() => {});
      throw new Error('生成视频超过 40MB，暂时不能保存到视频素材库');
    }
    chunks.push(chunk);
  }
  return Buffer.concat(chunks, totalBytes);
}

function getVideoLibraryModelLabel(model, provider = '') {
  const normalizedModel = readValue(model);
  const normalizedProvider = readValue(provider);
  if (normalizedProvider === 'minimax-h3' || normalizedModel === 'MiniMax-H3') return 'MiniMax H3';
  if (normalizedProvider === 'wan3' || normalizedModel === 'wan3.0-video') return '千问 Wan3.0 Video';
  if (normalizedModel === 'doubao-seedance-2-5-260628') return 'Seedance 2.5';
  if (normalizedModel === 'doubao-seedance-2-0-mini-260615') return 'Seedance 2.0 Mini';
  if (normalizedModel === 'doubao-seedance-2-0-fast-260128') return 'Seedance 2.0 Fast';
  if (normalizedModel === 'doubao-seedance-2-0-260128') return 'Seedance 2.0 稳定版';
  return normalizedProvider === 'seedance' ? 'Seedance' : '';
}

function formatVideoLibrarySourceNote({ model, provider, source = 'creative', directionNumber = 0 } = {}) {
  if (source === 'local') return '本地上传';
  const parts = [];
  const modelLabel = getVideoLibraryModelLabel(model, provider);
  if (modelLabel) parts.push(modelLabel);
  parts.push('来自创意素材');
  const normalizedDirection = Number(directionNumber || 0);
  if (Number.isInteger(normalizedDirection) && normalizedDirection > 0) {
    parts.push(`方向${normalizedDirection}`);
  }
  return parts.join(' · ');
}

function normalizeLegacyVideoLibrarySourceNote(note) {
  const normalizedNote = readValue(note);
  if (!normalizedNote) return '';
  if (normalizedNote === '来自创意创作') return '来自创意素材';
  if (!normalizedNote.includes('来自挂画创意素材')) return normalizedNote;
  const direction = normalizedNote.match(/方向\s*(\d+)/)?.[1];
  return direction ? `来自创意素材 · 方向${direction}` : '来自创意素材';
}

async function handleSaveSeedanceVideoToLibrary(req, res) {
  let filePath = '';
  try {
    const body = await readRequestBody(req);
    const taskId = readValue(body?.taskId);
    const requestedModel = readValue(body?.model);
    const folderName = sanitizeVideoLibraryFolder(body?.folderName);
    const requestedCreatedAt = Number(body?.createdAt || 0);
    const paintingDirectionNumber = Number(body?.paintingDirectionNumber || 0);
    const autoEnhance480p = body?.autoEnhance480p === true;
    if (!taskId) {
      sendJson(res, 400, { error: '缺少视频生成任务 ID' });
      return;
    }
    const taskResult = await fetchManualVideoGenerationTask(taskId);
    const taskPayload = taskResult.payload;
    const videoUrl = taskResult.videoUrl;
    if (!videoUrl) throw new Error('这条生成记录还没有可保存的视频');

    const videoResponse = await fetch(videoUrl, {
      headers: {
        'User-Agent': DOUYIN_USER_AGENT,
        Accept: 'video/mp4,video/*;q=0.9,application/octet-stream;q=0.8',
      },
      signal: AbortSignal.timeout(2 * 60 * 1000),
    });
    if (!videoResponse.ok) {
      throw new Error(`生成视频下载失败（HTTP ${videoResponse.status}）`);
    }
    const contentType = readValue(videoResponse.headers.get('content-type')).toLowerCase();
    if (contentType.includes('text/html') || contentType.includes('application/json')) {
      await videoResponse.body?.cancel().catch(() => {});
      throw new Error('生成视频链接已失效，请刷新任务后重试');
    }

    const buffer = await readVideoLibraryRemoteBuffer(videoResponse);
    if (!buffer.length) throw new Error('生成视频文件为空');
    if (buffer.length < 12 || buffer.subarray(4, 8).toString('ascii') !== 'ftyp') {
      throw new Error('生成结果不是有效的 MP4 文件，请刷新任务后重试');
    }
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = dbFindVideoLibraryByHash(sha256);
    if (existing) {
      const enhancementResult = await queueVideoEnhancementForLibraryItem(existing, { enabled: autoEnhance480p, req });
      sendJson(res, 200, {
        ok: true,
        duplicate: true,
        item: enhancementResult.item || existing,
        sourceBytes: buffer.length,
        savedBytes: existing.fileSize,
        message: `这个视频已经保存在“${existing.folderName}”文件夹`,
        enhancement: enhancementResult,
      });
      return;
    }

    const taskCreatedAt = Number(taskResult.createdAt || requestedCreatedAt || 0);
    // 挂画方向号只写入备注；文件名与其他创意素材一样只保留月日和时分。
    const paintingPosition = getPaintingFrameworkPosition(paintingDirectionNumber);
    const originalName = paintingPosition
      ? formatPaintingSeedanceVideoLibraryName(taskCreatedAt, paintingDirectionNumber)
      : formatSeedanceVideoLibraryName(taskCreatedAt);
    const storedName = `${sha256}.mp4`;
    await ensureVideoLibraryDir();
    filePath = path.join(VIDEO_LIBRARY_DIR, storedName);
    await writeFile(filePath, buffer);
    const savedFile = await stat(filePath);
    if (savedFile.size !== buffer.length) {
      throw new Error('保存后文件大小校验失败，请重试');
    }
    let item = dbInsertVideoLibraryItem({
      folderName,
      originalName,
      storedName,
      mimeType: 'video/mp4',
      fileSize: savedFile.size,
      sha256,
      note: formatVideoLibrarySourceNote({
        model: requestedModel,
        provider: taskResult.provider,
        directionNumber: paintingPosition ? paintingDirectionNumber : 0,
      }),
    });
    void ensureVideoLibraryPreview({ id: item.id, stored_name: storedName, sha256 }).catch(() => {});
    void ensureVideoLibraryThumbnail({ id: item.id, stored_name: storedName, sha256 }).catch((thumbnailError) => {
      console.warn('[video library] seedance_thumbnail_generation_failed', {
        id: item.id,
        taskId,
        message: thumbnailError?.message || '',
      });
    });
    const enhancementResult = await queueVideoEnhancementForLibraryItem(item, { enabled: autoEnhance480p, req });
    item = enhancementResult.item || item;
    sendJson(res, 201, {
      ok: true,
      duplicate: false,
      item,
      sourceBytes: buffer.length,
      savedBytes: item.fileSize,
      message: `已无损保存到“${folderName}”文件夹`,
      enhancement: enhancementResult,
    });
  } catch (error) {
    if (filePath) await unlink(filePath).catch(() => {});
    const isTimeout = error?.name === 'TimeoutError' || error?.name === 'AbortError';
    sendJson(res, isTimeout ? 504 : 500, {
      error: isTimeout ? '保存视频超时，请稍后重试' : (error?.message || '保存视频失败'),
    });
  }
}

async function handleUploadVideoLibrary(req, res) {
  let filePath = '';
  try {
    const { folderName, file } = await readVideoLibraryUploadBody(req);
    if (!file || file.size <= 0) {
      sendJson(res, 400, { error: '请选择要上传的视频文件' });
      return;
    }
    if (file.size > VIDEO_LIBRARY_MAX_FILE_BYTES) {
      sendJson(res, 413, { error: '视频文件不能超过 40MB' });
      return;
    }
    const mimeType = normalizeVideoLibraryMimeType(file.name, file.type);
    if (!mimeType) {
      sendJson(res, 400, { error: '只支持上传视频文件' });
      return;
    }

    const buffer = Buffer.from(await file.arrayBuffer());
    const sha256 = createHash('sha256').update(buffer).digest('hex');
    const existing = dbFindVideoLibraryByHash(sha256);
    if (existing) {
      sendJson(res, 200, { ok: true, duplicate: true, item: existing, message: '这个视频已经存在，没有重复保存' });
      return;
    }

    await ensureVideoLibraryDir();
    const extension = getVideoLibraryExtension(file.name, mimeType);
    const storedName = `${sha256}${extension}`;
    filePath = path.join(VIDEO_LIBRARY_DIR, storedName);
    await writeFile(filePath, buffer);
    const item = dbInsertVideoLibraryItem({
      folderName,
      originalName: sanitizeVideoLibraryFileName(file.name),
      storedName,
      mimeType,
      fileSize: buffer.length,
      sha256,
      note: formatVideoLibrarySourceNote({ source: 'local' }),
    });
    void ensureVideoLibraryPreview({ id: item.id, stored_name: storedName, sha256 }).catch(() => {});
    void ensureVideoLibraryThumbnail({ id: item.id, stored_name: storedName, sha256 }).catch((thumbnailError) => {
      console.warn('[video library] thumbnail_generation_failed', {
        id: item.id,
        message: thumbnailError?.message || '',
      });
    });
    sendJson(res, 201, { ok: true, duplicate: false, item });
  } catch (error) {
    if (filePath) await unlink(filePath).catch(() => {});
    sendJson(res, 500, { error: error.message || '视频上传失败' });
  }
}

async function handleUpdateVideoLibrary(req, res, id) {
  try {
    const body = await readRequestBody(req);
    const existing = dbGetVideoLibraryItem(id);
    if (!existing) {
      sendJson(res, 404, { error: '视频记录不存在' });
      return;
    }
    const nextNote = body?.note === undefined ? existing.note : readValue(body.note).slice(0, 1000);
    const nextName = body?.originalName === undefined
      ? existing.originalName
      : sanitizeVideoLibraryFileName(body.originalName);
    const nextFolder = body?.folderName === undefined
      ? existing.folderName
      : sanitizeVideoLibraryFolder(body.folderName);
    dbCreateVideoLibraryFolder(nextFolder);
    getCollectionDb().prepare('UPDATE video_library_items SET folder_name = ?, original_name = ?, note = ?, updated_at = unixepoch() WHERE id = ?').run(nextFolder, nextName, nextNote, Number(id));
    const item = dbGetVideoLibraryItem(id);
    sendJson(res, 200, { ok: true, item });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '更新视频信息失败' });
  }
}

async function handleDeleteVideoLibrary(req, res, id) {
  try {
    const deleted = dbDeleteVideoLibraryItem(id);
    if (!deleted) {
      sendJson(res, 404, { error: '视频记录不存在' });
      return;
    }
    await deleteVideoLibraryItemFiles(deleted);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '删除视频失败' });
  }
}

function parseVideoLibraryByteRange(rangeHeader, fileSize) {
  const match = String(rangeHeader || '').trim().match(/^bytes=(\d*)-(\d*)$/i);
  if (!match || fileSize <= 0 || (!match[1] && !match[2])) return null;

  if (!match[1]) {
    const suffixLength = Number(match[2]);
    if (!Number.isSafeInteger(suffixLength) || suffixLength <= 0) return null;
    return {
      start: Math.max(0, fileSize - suffixLength),
      end: fileSize - 1,
    };
  }

  const start = Number(match[1]);
  const requestedEnd = match[2] ? Number(match[2]) : fileSize - 1;
  if (!Number.isSafeInteger(start) || !Number.isSafeInteger(requestedEnd) || start < 0 || start >= fileSize || requestedEnd < start) {
    return null;
  }
  return {
    start,
    end: Math.min(requestedEnd, fileSize - 1),
  };
}

async function handleVideoLibraryFile(req, res, id, url) {
  try {
    const db = getCollectionDb();
    const row = db.prepare('SELECT * FROM video_library_items WHERE id = ?').get(Number(id));
    if (!row) {
      sendJson(res, 404, { error: '视频不存在' });
      return;
    }
    const wantsFastPreview = url.searchParams.get('preview') === '1' && url.searchParams.get('download') !== '1';
    const filePath = wantsFastPreview
      ? await ensureVideoLibraryPreview(row)
      : path.join(VIDEO_LIBRARY_DIR, row.stored_name);
    const info = await stat(filePath);
    const range = req.headers.range;
    const asAttachment = url.searchParams.get('download') === '1';
    const downloadName = getVideoLibraryDownloadName(row);
    const encodedFilename = encodeURIComponent(downloadName);
    const fallbackFilename = `video-${Number(row.id)}${getVideoLibraryExtension(row.stored_name, row.mime_type)}`;
    const etagBase = readValue(row.sha256) || `${Number(row.id)}-${info.size}`;
    const etag = `"${etagBase}${wantsFastPreview ? '-preview' : ''}"`;
    const headers = {
      'Accept-Ranges': 'bytes',
      'Content-Type': wantsFastPreview ? 'video/mp4' : (normalizeVideoLibraryMimeType(row.stored_name, row.mime_type) || 'video/mp4'),
      'Content-Disposition': `${asAttachment ? 'attachment' : 'inline'}; filename="${fallbackFilename}"; filename*=UTF-8''${encodedFilename}`,
      'Cache-Control': 'private, max-age=31536000, immutable',
      'ETag': etag,
      'X-Content-Type-Options': 'nosniff',
      'X-Accel-Buffering': 'no',
      'Content-Encoding': 'identity',
      'X-Video-Library-Variant': wantsFastPreview ? 'preview' : 'original',
    };
    if (!range && req.headers['if-none-match'] === etag) {
      res.writeHead(304, headers);
      res.end();
      return;
    }
    if (VIDEO_LIBRARY_ACCEL_REDIRECT_PREFIX) {
      headers['X-Accel-Redirect'] = `${VIDEO_LIBRARY_ACCEL_REDIRECT_PREFIX}/${encodeURIComponent(path.basename(filePath))}`;
      res.writeHead(200, headers);
      res.end();
      return;
    }
    if (range) {
      const parsedRange = parseVideoLibraryByteRange(range, info.size);
      if (!parsedRange) {
        res.writeHead(416, {
          'Content-Range': `bytes */${info.size}`,
          'Accept-Ranges': 'bytes',
          'Cache-Control': headers['Cache-Control'],
        });
        res.end();
        return;
      }
      const { start, end } = parsedRange;
      headers['Content-Range'] = `bytes ${start}-${end}/${info.size}`;
      headers['Content-Length'] = String(end - start + 1);
      res.writeHead(206, headers);
      if (req.method === 'HEAD') res.end();
      else createReadStream(filePath, { start, end, highWaterMark: VIDEO_LIBRARY_STREAM_HIGH_WATER_MARK }).pipe(res);
      return;
    }
    headers['Content-Length'] = String(info.size);
    res.writeHead(200, headers);
    if (req.method === 'HEAD') res.end();
    else createReadStream(filePath, { highWaterMark: VIDEO_LIBRARY_STREAM_HIGH_WATER_MARK }).pipe(res);
  } catch (error) {
    sendJson(res, 404, { error: '视频文件不存在或已损坏' });
  }
}

async function handleVideoLibraryThumbnail(req, res, id) {
  try {
    const row = getCollectionDb().prepare('SELECT * FROM video_library_items WHERE id = ?').get(Number(id));
    if (!row) {
      sendJson(res, 404, { error: '视频不存在' });
      return;
    }
    const thumbnailPath = await ensureVideoLibraryThumbnail(row);
    const info = await stat(thumbnailPath);
    res.writeHead(200, {
      'Content-Type': 'image/jpeg',
      'Content-Length': String(info.size),
      'Cache-Control': 'public, max-age=604800, immutable',
    });
    createReadStream(thumbnailPath).pipe(res);
  } catch (error) {
    console.warn('[video library] thumbnail_read_failed', {
      id: Number(id),
      message: error?.message || '',
    });
    sendJson(res, 404, { error: '视频封面暂不可用' });
  }
}

// --- Store Overview Database ---

const STORE_OVERVIEW_NODE_TYPES = new Set(['store', 'product', 'video', 'adq', 'supplier']);
const STORE_OVERVIEW_DEFAULT_COLUMN_ORDER = ['video', 'adq', 'store', 'supplier', 'product'];

function normalizeStoreOverviewNode(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    type: row.type,
    name: row.name,
    note: row.note || '',
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  };
}

function normalizeStoreOverviewEdge(row) {
  if (!row) return null;
  return {
    id: Number(row.id),
    source_id: Number(row.source_id),
    target_id: Number(row.target_id),
    relation_type: row.relation_type || 'linked',
    note: row.note || '',
    created_at: Number(row.created_at || 0),
    updated_at: Number(row.updated_at || 0),
  };
}

function dbGetStoreOverviewGraph() {
  const db = getCollectionDb();
  const nodes = db.prepare('SELECT * FROM store_overview_nodes ORDER BY type, created_at, id').all().map(normalizeStoreOverviewNode);
  const edges = db.prepare('SELECT * FROM store_overview_edges ORDER BY created_at, id').all().map(normalizeStoreOverviewEdge);
  return { nodes, edges, settings: dbGetStoreOverviewSettings() };
}

function normalizeStoreOverviewColumnOrder(value) {
  const parsed = Array.isArray(value) ? value : parseJsonString(value, []);
  const valid = Array.isArray(parsed)
    ? parsed.filter((type) => STORE_OVERVIEW_NODE_TYPES.has(String(type)))
    : [];
  return [
    ...valid,
    ...STORE_OVERVIEW_DEFAULT_COLUMN_ORDER.filter((type) => !valid.includes(type)),
  ];
}

function dbGetStoreOverviewSetting(key, fallback) {
  const db = getCollectionDb();
  const row = db.prepare('SELECT value FROM store_overview_settings WHERE key = ?').get(key);
  if (!row) return fallback;
  return row.value;
}

function dbSetStoreOverviewSetting(key, value) {
  const db = getCollectionDb();
  const stmt = db.prepare(`
    INSERT INTO store_overview_settings (key, value, updated_at)
    VALUES (?, ?, unixepoch())
    ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = unixepoch()
  `);
  stmt.run(key, value);
}

function dbGetStoreOverviewSettings() {
  return {
    columnOrder: normalizeStoreOverviewColumnOrder(dbGetStoreOverviewSetting('columnOrder', JSON.stringify(STORE_OVERVIEW_DEFAULT_COLUMN_ORDER))),
  };
}

function dbUpdateStoreOverviewSettings({ columnOrder }) {
  const normalizedColumnOrder = normalizeStoreOverviewColumnOrder(columnOrder);
  dbSetStoreOverviewSetting('columnOrder', JSON.stringify(normalizedColumnOrder));
  return dbGetStoreOverviewSettings();
}

function dbGetStoreOverviewNodeById(id) {
  const db = getCollectionDb();
  return normalizeStoreOverviewNode(db.prepare('SELECT * FROM store_overview_nodes WHERE id = ?').get(id));
}

function dbInsertStoreOverviewNode({ type, name, note }) {
  const db = getCollectionDb();
  const stmt = db.prepare(`
    INSERT INTO store_overview_nodes (type, name, note, created_at, updated_at)
    VALUES (?, ?, ?, unixepoch(), unixepoch())
  `);
  const result = stmt.run(type, name, note || '');
  return dbGetStoreOverviewNodeById(Number(result.lastInsertRowid));
}

function dbUpdateStoreOverviewNode(id, { name, note }) {
  const db = getCollectionDb();
  const stmt = db.prepare('UPDATE store_overview_nodes SET name = ?, note = ?, updated_at = unixepoch() WHERE id = ?');
  stmt.run(name, note || '', id);
  return dbGetStoreOverviewNodeById(id);
}

function dbDeleteStoreOverviewNode(id) {
  const db = getCollectionDb();
  const deleteEdges = db.prepare('DELETE FROM store_overview_edges WHERE source_id = ? OR target_id = ?');
  deleteEdges.run(id, id);
  const deleteNode = db.prepare('DELETE FROM store_overview_nodes WHERE id = ?');
  deleteNode.run(id);
}

function dbGetStoreOverviewEdgeById(id) {
  const db = getCollectionDb();
  return normalizeStoreOverviewEdge(db.prepare('SELECT * FROM store_overview_edges WHERE id = ?').get(id));
}

function dbInsertStoreOverviewEdge({ sourceId, targetId, relationType, note }) {
  const db = getCollectionDb();
  const source = dbGetStoreOverviewNodeById(sourceId);
  const target = dbGetStoreOverviewNodeById(targetId);
  if (!source || !target) {
    const error = new Error('关联的项目不存在');
    error.statusCode = 404;
    throw error;
  }
  if (source.id === target.id) {
    const error = new Error('不能把项目关联到自己');
    error.statusCode = 400;
    throw error;
  }
  if (source.type === target.type) {
    const error = new Error('同一类目内不需要互相连线，请选择其他类目的项目');
    error.statusCode = 400;
    throw error;
  }
  const normalizedSourceId = Math.min(source.id, target.id);
  const normalizedTargetId = Math.max(source.id, target.id);
  const normalizedRelationType = relationType || `${source.type}_${target.type}`;
  const existing = db.prepare(`
    SELECT * FROM store_overview_edges
    WHERE source_id = ? AND target_id = ? AND relation_type = ?
    LIMIT 1
  `).get(normalizedSourceId, normalizedTargetId, normalizedRelationType);
  if (existing) return normalizeStoreOverviewEdge(existing);

  const stmt = db.prepare(`
    INSERT INTO store_overview_edges (source_id, target_id, relation_type, note, created_at, updated_at)
    VALUES (?, ?, ?, ?, unixepoch(), unixepoch())
  `);
  const result = stmt.run(normalizedSourceId, normalizedTargetId, normalizedRelationType, note || '');
  return dbGetStoreOverviewEdgeById(Number(result.lastInsertRowid));
}

function dbDeleteStoreOverviewEdge(id) {
  const db = getCollectionDb();
  const stmt = db.prepare('DELETE FROM store_overview_edges WHERE id = ?');
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

// --- Store Overview Route Handlers ---

async function handleGetStoreOverviewGraph(req, res) {
  try {
    sendJson(res, 200, { ok: true, ...dbGetStoreOverviewGraph() });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '获取店铺总览失败' });
  }
}

async function handleUpdateStoreOverviewSettings(req, res) {
  try {
    const body = await readRequestBody(req);
    const settings = dbUpdateStoreOverviewSettings({
      columnOrder: Array.isArray(body.columnOrder) ? body.columnOrder : undefined,
    });
    sendJson(res, 200, { ok: true, settings });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '保存店铺总览设置失败' });
  }
}

async function handleCreateStoreOverviewNode(req, res) {
  try {
    const body = await readRequestBody(req);
    const type = String(body.type || '').trim();
    const name = String(body.name || '').trim();
    const note = String(body.note || '').trim();

    if (!STORE_OVERVIEW_NODE_TYPES.has(type)) {
      sendJson(res, 400, { error: '项目类型不正确' });
      return;
    }
    if (!name) {
      sendJson(res, 400, { error: '项目名称不能为空' });
      return;
    }

    const node = dbInsertStoreOverviewNode({ type, name, note });
    sendJson(res, 200, { ok: true, node });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '新增项目失败' });
  }
}

async function handleUpdateStoreOverviewNode(req, res, id) {
  try {
    const nodeId = Number(id);
    const existing = dbGetStoreOverviewNodeById(nodeId);
    if (!existing) {
      sendJson(res, 404, { error: '项目不存在' });
      return;
    }

    const body = await readRequestBody(req);
    const name = String(body.name || '').trim();
    const note = String(body.note || '').trim();
    if (!name) {
      sendJson(res, 400, { error: '项目名称不能为空' });
      return;
    }

    const node = dbUpdateStoreOverviewNode(nodeId, { name, note });
    sendJson(res, 200, { ok: true, node });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '更新项目失败' });
  }
}

async function handleDeleteStoreOverviewNode(req, res, id) {
  try {
    const nodeId = Number(id);
    const existing = dbGetStoreOverviewNodeById(nodeId);
    if (!existing) {
      sendJson(res, 404, { error: '项目不存在' });
      return;
    }
    dbDeleteStoreOverviewNode(nodeId);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '删除项目失败' });
  }
}

async function handleCreateStoreOverviewEdge(req, res) {
  try {
    const body = await readRequestBody(req);
    const sourceId = Number(body.sourceId);
    const targetId = Number(body.targetId);
    const relationType = String(body.relationType || '').trim();
    const note = String(body.note || '').trim();

    if (!sourceId || !targetId) {
      sendJson(res, 400, { error: '请选择需要关联的两个项目' });
      return;
    }

    const edge = dbInsertStoreOverviewEdge({ sourceId, targetId, relationType, note });
    sendJson(res, 200, { ok: true, edge });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || '新增关联失败' });
  }
}

async function handleDeleteStoreOverviewEdge(req, res, id) {
  try {
    const edgeId = Number(id);
    const existing = dbGetStoreOverviewEdgeById(edgeId);
    if (!existing) {
      sendJson(res, 404, { error: '关联不存在' });
      return;
    }
    dbDeleteStoreOverviewEdge(edgeId);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '删除关联失败' });
  }
}

async function handleStoreOverviewDebug(req, res) {
  try {
    const db = getCollectionDb();
    const nodeCount = db.prepare('SELECT COUNT(*) as count FROM store_overview_nodes').get()?.count || 0;
    const edgeCount = db.prepare('SELECT COUNT(*) as count FROM store_overview_edges').get()?.count || 0;
    const settings = dbGetStoreOverviewSettings();
    sendJson(res, 200, {
      ok: true,
      runtimeStateDir: RUNTIME_STATE_DIR,
      collectionDbPath: COLLECTION_DB_PATH,
      collectionDbExists: existsSync(COLLECTION_DB_PATH),
      nodeCount,
      edgeCount,
      settings,
    });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '读取店铺总览调试信息失败' });
  }
}

const DEFAULT_HOME_CULTURE_MOTTOS = ['多试试总没错', '7+3=七分专注，三分探索'];

function sanitizeHomeCultureMottos(value) {
  const list = Array.isArray(value) ? value : [];
  const mottos = list
    .map((item) => readValue(item))
    .filter(Boolean)
    .slice(0, 4);
  return mottos.length > 0 ? mottos : DEFAULT_HOME_CULTURE_MOTTOS;
}

async function loadHomeCultureMottos() {
  try {
    const raw = await readFile(HOME_CULTURE_MOTTOS_FILE, 'utf8');
    const parsed = parseJsonString(raw, {});
    return sanitizeHomeCultureMottos(parsed?.mottos);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[home culture] load_failed', { filePath: HOME_CULTURE_MOTTOS_FILE, message: error?.message || '' });
    }
    return DEFAULT_HOME_CULTURE_MOTTOS;
  }
}

async function saveHomeCultureMottos(mottos) {
  await ensureRuntimeStateDir();
  await writeFile(
    HOME_CULTURE_MOTTOS_FILE,
    JSON.stringify({ version: 1, mottos: sanitizeHomeCultureMottos(mottos), updatedAt: new Date().toISOString() }, null, 2),
    'utf8'
  );
}

async function handleGetHomeCultureMottos(req, res) {
  try {
    const mottos = await loadHomeCultureMottos();
    sendJson(res, 200, { ok: true, mottos });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '读取主页标语失败' });
  }
}

async function handleUpdateHomeCultureMottos(req, res) {
  try {
    const body = await readRequestBody(req);
    const mottos = sanitizeHomeCultureMottos(body?.mottos);
    await saveHomeCultureMottos(mottos);
    sendJson(res, 200, { ok: true, mottos });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '保存主页标语失败' });
  }
}

const DEFAULT_TEAM_TIMELINE_RECORDS = [
  {
    id: 'timeline_2022_10',
    date: '2022-10',
    title: '进入装饰画赛道',
    content: '团队正式开始探索装饰画业务，开启了这段长期积累的旅程。',
    challenge: '',
    createdAt: '2022-10-01T00:00:00.000Z',
    updatedAt: '2022-10-01T00:00:00.000Z'
  }
];

function normalizeTeamTimelineRecord(value, fallback = {}) {
  const item = value && typeof value === 'object' ? value : {};
  const date = readValue(item.date, fallback.date);
  const title = readValue(item.title, fallback.title);
  const content = readValue(item.content, item.description, fallback.content);
  const challenge = readValue(item.challenge, fallback.challenge);
  const id = readValue(item.id, fallback.id);
  if (!date || !title) return null;
  return {
    id: id || `timeline_${Date.now()}_${randomBytes(3).toString('hex')}`,
    date: date.slice(0, 20),
    title: title.slice(0, 120),
    content: content.slice(0, 3000),
    challenge: challenge.slice(0, 3000),
    createdAt: readValue(item.createdAt, fallback.createdAt) || new Date().toISOString(),
    updatedAt: new Date().toISOString()
  };
}

function normalizeTeamTimelineRecords(value) {
  if (!Array.isArray(value)) return [];
  return value.map((item) => normalizeTeamTimelineRecord(item)).filter(Boolean);
}

async function loadTeamTimeline() {
  try {
    const raw = await readFile(TEAM_TIMELINE_FILE, 'utf8');
    const parsed = parseJsonString(raw, {});
    return normalizeTeamTimelineRecords(parsed?.records);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[team timeline] load_failed', { filePath: TEAM_TIMELINE_FILE, message: error?.message || '' });
    }
    return DEFAULT_TEAM_TIMELINE_RECORDS;
  }
}

async function saveTeamTimeline(records) {
  const normalized = normalizeTeamTimelineRecords(records);
  const operation = teamTimelineQueue.then(async () => {
    await ensureRuntimeStateDir();
    await writeFile(
      TEAM_TIMELINE_FILE,
      JSON.stringify({ version: 1, records: normalized, updatedAt: new Date().toISOString() }, null, 2),
      'utf8'
    );
  });
  teamTimelineQueue = operation.catch(() => {});
  await operation;
  return normalized;
}

async function handleGetTeamTimeline(req, res) {
  try {
    sendJson(res, 200, { ok: true, records: await loadTeamTimeline() });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '读取重大事件时间线失败' });
  }
}

async function handleCreateTeamTimeline(req, res) {
  try {
    const body = await readRequestBody(req);
    const record = normalizeTeamTimelineRecord(body);
    if (!record) {
      sendJson(res, 400, { error: '请填写事件时间和事件名称' });
      return;
    }
    const records = await loadTeamTimeline();
    const saved = await saveTeamTimeline([...records, record]);
    sendJson(res, 201, { ok: true, record, records: saved });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '新增重大事件失败' });
  }
}

async function handleUpdateTeamTimeline(req, res, id) {
  try {
    const body = await readRequestBody(req);
    const records = await loadTeamTimeline();
    const index = records.findIndex((item) => item.id === id);
    if (index < 0) {
      sendJson(res, 404, { error: '没有找到这条重大事件记录' });
      return;
    }
    const record = normalizeTeamTimelineRecord(body, records[index]);
    if (!record) {
      sendJson(res, 400, { error: '请填写事件时间和事件名称' });
      return;
    }
    records[index] = record;
    const saved = await saveTeamTimeline(records);
    sendJson(res, 200, { ok: true, record, records: saved });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '更新重大事件失败' });
  }
}

async function handleDeleteTeamTimeline(req, res, id) {
  try {
    const records = await loadTeamTimeline();
    const next = records.filter((item) => item.id !== id);
    if (next.length === records.length) {
      sendJson(res, 404, { error: '没有找到这条重大事件记录' });
      return;
    }
    const saved = await saveTeamTimeline(next);
    sendJson(res, 200, { ok: true, records: saved });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '删除重大事件失败' });
  }
}

// --- Creative Feeding API Handlers ---

const DEFAULT_CREATIVE_FEEDING_SETTINGS = {
  businessBackground: '我是做自粘墙面装饰画的，主要通过短视频平台销售装饰画。当前模块只服务装饰画短视频开头创作。',
  targetAudience: '主要面向 50 岁以上中老年用户，以及重视家庭氛围、家居布置、寓意讲究的人群。',
  productFeatures: '产品是适合客厅、沙发墙、床头、玄关等场景的装饰画，核心价值不只是美观，还包括寓意、家庭氛围、吉祥感、情绪价值和场景搭配。',
  stylePreference: '表达要接地气、口语化、有场景感，像真实的人在提醒，而不是像广告。开头要抓人，有轻微冲突、提醒、讲究、反常识或情绪钩子。',
  conversionDirections: '寓意、讲究、吉祥、富贵、家和、子女孝心、家庭氛围、床头不能空、客厅挂画不能乱选、沙发墙要有靠山感等方向表现更好。',
  forbiddenExpressions: '避免直接宣传封建迷信，避免承诺发财、转运、保平安、治病、改变命运。可以表达“好寓意”“好兆头”“看着喜庆”“家里更有氛围”“长辈喜欢”这类相对安全的话。',
  openingRules: '生成一段完整、方便继续衔接的短视频开头。每条由 4～6 个短句组成，正文控制在 60～100 个汉字；第一句负责抓住注意力，后续短句逐步承接场景、情绪或观点，最后一句为后续内容留下自然接口。句子要短，有停顿感，有继续听下去的理由。不要一上来介绍产品参数，要先抓住场景、情绪或讲究。',
  outputFormat: '每次输出多条开头文案，并在每条后面附一句简短爆点逻辑说明。'
};

const CREATIVE_FEEDING_SETTING_KEYS = Object.keys(DEFAULT_CREATIVE_FEEDING_SETTINGS);

function sanitizeCreativeFeedingSettings(input = {}) {
  const settings = {};
  for (const key of CREATIVE_FEEDING_SETTING_KEYS) {
    settings[key] = readValue(input?.[key], DEFAULT_CREATIVE_FEEDING_SETTINGS[key]);
  }
  return settings;
}

function sanitizeCreativeOpeningTags(value) {
  if (Array.isArray(value)) {
    return value.map((item) => readValue(item)).filter(Boolean).slice(0, 20);
  }
  return String(value || '')
    .split(/[,，、\n]/g)
    .map((item) => item.trim())
    .filter(Boolean)
    .slice(0, 20);
}

function createCreativeFeedingId(prefix = 'opening') {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
}

function sanitizeCreativeOpening(input = {}, previous = null, options = {}) {
  const now = new Date().toISOString();
  const openingText = readValue(input?.openingText, previous?.openingText);
  const createdAt = readValue(previous?.createdAt, input?.createdAt) || now;
  return {
    id: readValue(previous?.id, input?.id) || createCreativeFeedingId(),
    openingText,
    paintingName: readValue(input?.paintingName, previous?.paintingName),
    scene: readValue(input?.scene, previous?.scene),
    hookType: readValue(input?.hookType, previous?.hookType),
    platform: readValue(input?.platform, previous?.platform),
    videoUrl: readValue(input?.videoUrl, previous?.videoUrl),
    performanceNote: readValue(input?.performanceNote, previous?.performanceNote),
    reasonAnalysis: readValue(input?.reasonAnalysis, previous?.reasonAnalysis),
    tags: sanitizeCreativeOpeningTags(input?.tags ?? previous?.tags),
    createdAt,
    updatedAt: options.touch ? now : (readValue(input?.updatedAt, previous?.updatedAt) || createdAt)
  };
}

async function writeRuntimeJsonWithBackup(filePath, payload) {
  await ensureRuntimeStateDir();
  if (existsSync(filePath)) {
    try {
      await copyFile(filePath, `${filePath}.bak`);
    } catch (error) {
      console.error('[runtime state] backup_failed', { filePath, message: error?.message || '' });
    }
  }
  await writeFile(filePath, JSON.stringify(payload, null, 2), 'utf8');
}

async function loadCreativeFeedingSettings() {
  try {
    const raw = await readFile(CREATIVE_FEEDING_SETTINGS_FILE, 'utf8');
    const parsed = parseJsonString(raw, {});
    return sanitizeCreativeFeedingSettings(parsed?.settings || parsed);
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[creative feeding] settings load_failed', { message: error?.message || '' });
    }
    const settings = sanitizeCreativeFeedingSettings();
    await writeRuntimeJsonWithBackup(CREATIVE_FEEDING_SETTINGS_FILE, {
      version: 1,
      settings,
      updatedAt: new Date().toISOString()
    });
    return settings;
  }
}

async function saveCreativeFeedingSettings(settings) {
  const sanitized = sanitizeCreativeFeedingSettings(settings);
  await writeRuntimeJsonWithBackup(CREATIVE_FEEDING_SETTINGS_FILE, {
    version: 1,
    settings: sanitized,
    updatedAt: new Date().toISOString()
  });
  return sanitized;
}

async function loadCreativeOpeningLibrary() {
  try {
    const raw = await readFile(CREATIVE_OPENING_LIBRARY_FILE, 'utf8');
    const parsed = parseJsonString(raw, {});
    const openings = Array.isArray(parsed?.openings)
      ? parsed.openings
          .map((item) => sanitizeCreativeOpening(item))
          .filter((item) => item.openingText)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      : [];
    return { version: 1, openings };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[creative feeding] library load_failed', { message: error?.message || '' });
    }
    const emptyLibrary = { version: 1, openings: [] };
    await writeRuntimeJsonWithBackup(CREATIVE_OPENING_LIBRARY_FILE, emptyLibrary);
    return emptyLibrary;
  }
}

async function saveCreativeOpeningLibrary(openings) {
  const payload = {
    version: 1,
    openings: openings
      .map((item) => sanitizeCreativeOpening(item))
      .filter((item) => item.openingText)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    updatedAt: new Date().toISOString()
  };
  await writeRuntimeJsonWithBackup(CREATIVE_OPENING_LIBRARY_FILE, payload);
  return payload.openings;
}

function sanitizeCopyLibraryItem(input, previous = {}, options = {}) {
  const now = new Date().toISOString();
  const createdAt = readValue(input?.createdAt, previous?.createdAt) || now;
  return {
    id: readValue(input?.id, previous?.id) || randomBytes(8).toString('hex'),
    type: readValue(input?.type, previous?.type) === 'rewrite' ? 'rewrite' : 'original',
    profile: input?.profile && typeof input.profile === 'object' ? input.profile : (previous?.profile || {}),
    imageThumb: readValue(input?.imageThumb, previous?.imageThumb),
    extraInfo: readValue(input?.extraInfo, previous?.extraInfo),
    forbidden: readValue(input?.forbidden, previous?.forbidden),
    originalText: readValue(input?.originalText, previous?.originalText),
    mode: readValue(input?.mode, previous?.mode),
    version: readValue(input?.version, previous?.version),
    direction: readValue(input?.direction, previous?.direction),
    fullText: readValue(input?.fullText, previous?.fullText),
    wordCount: Number.isFinite(Number(input?.wordCount))
      ? Number(input.wordCount)
      : countChars(readValue(input?.fullText, previous?.fullText)),
    isLiked: Boolean(input?.isLiked ?? previous?.isLiked),
    model: readValue(input?.model, previous?.model) || DEFAULT_DOUBAO_MULTIMODAL_MODEL,
    createdAt,
    updatedAt: options.touch ? now : (readValue(input?.updatedAt, previous?.updatedAt) || createdAt)
  };
}

async function loadCopyLibrary() {
  try {
    const raw = await readFile(CREATIVE_COPY_LIBRARY_FILE, 'utf8');
    const parsed = parseJsonString(raw, {});
    const items = Array.isArray(parsed?.items)
      ? parsed.items
          .map((item) => sanitizeCopyLibraryItem(item))
          .filter((item) => item.fullText)
          .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt)))
      : [];
    return { version: 1, items };
  } catch (error) {
    if (error?.code !== 'ENOENT') {
      console.error('[copy library] load_failed', { message: error?.message || '' });
    }
    const emptyLibrary = { version: 1, items: [] };
    await writeRuntimeJsonWithBackup(CREATIVE_COPY_LIBRARY_FILE, emptyLibrary);
    return emptyLibrary;
  }
}

async function saveCopyLibrary(items) {
  const payload = {
    version: 1,
    items: items
      .map((item) => sanitizeCopyLibraryItem(item))
      .filter((item) => item.fullText)
      .sort((a, b) => String(b.createdAt).localeCompare(String(a.createdAt))),
    updatedAt: new Date().toISOString()
  };
  await writeRuntimeJsonWithBackup(CREATIVE_COPY_LIBRARY_FILE, payload);
  return payload.items;
}

function filterCreativeOpenings(openings, url) {
  const query = readValue(url.searchParams.get('q')).toLowerCase();
  const tag = readValue(url.searchParams.get('tag'));

  return openings.filter((item) => {
    if (tag && !item.tags.includes(tag)) return false;
    if (!query) return true;
    return [
      item.openingText,
      item.paintingName,
      item.scene,
      item.hookType,
      item.platform,
      item.videoUrl,
      item.performanceNote,
      item.reasonAnalysis,
      item.tags.join(' ')
    ].join(' ').toLowerCase().includes(query);
  });
}

function getCreativeFeedingStrategyCounts(countValue) {
  const count = Math.min(30, Math.max(1, Number(countValue) || 10));
  if (count === 1) return { count, stableCount: 1, exploreCount: 0 };
  const exploreCount = Math.max(1, Math.round(count * 0.3));
  return { count, stableCount: count - exploreCount, exploreCount };
}

function tokenizeCreativeReferenceText(value) {
  const normalized = readValue(value).toLowerCase();
  if (!normalized) return [];
  const tokens = normalized
    .split(/[\s,，。.!！?？、;；:：/\\|()（）【】\[\]“”"'_-]+/)
    .map((item) => item.trim())
    .filter((item) => item.length >= 2);
  return Array.from(new Set(tokens));
}

function extractCreativeLikeScore(value) {
  const text = readValue(value).replace(/,/g, '');
  const match = text.match(/(\d+(?:\.\d+)?)\s*(万|w|W)?/);
  if (!match) return 0;
  const amount = Number(match[1]) || 0;
  return match[2] ? amount * 10000 : amount;
}

function selectSmartCreativeReferences(openings, requestBody, limit) {
  const paintingName = readValue(requestBody?.paintingName).toLowerCase();
  const scene = readValue(requestBody?.scene).toLowerCase();
  const queryTokens = tokenizeCreativeReferenceText([
    paintingName,
    scene,
    readValue(requestBody?.sellingPoint),
    readValue(requestBody?.extraRequirement),
    readValue(requestBody?.imageAnalysis)
  ].join(' '));

  return openings
    .map((item, index) => {
      const searchable = [
        item.openingText,
        item.paintingName,
        item.scene,
        item.hookType,
        item.performanceNote,
        item.reasonAnalysis,
        ...(item.tags || [])
      ].join(' ').toLowerCase();
      let score = 0;
      if (paintingName && readValue(item.paintingName).toLowerCase() === paintingName) score += 80;
      else if (paintingName && searchable.includes(paintingName)) score += 35;
      if (scene && readValue(item.scene).toLowerCase().includes(scene)) score += 35;
      else if (scene && searchable.includes(scene)) score += 16;
      for (const token of queryTokens) {
        if (searchable.includes(token)) score += token.length >= 4 ? 8 : 4;
      }
      score += Math.min(16, Math.log10(extractCreativeLikeScore(item.performanceNote) + 1) * 3);
      score += Math.max(0, 6 - index * 0.08);
      return { item, score, index };
    })
    .sort((a, b) => b.score - a.score || a.index - b.index)
    .slice(0, limit)
    .map(({ item }) => item);
}

function buildCreativeFeedingPrompt({ settings, references, requestBody }) {
  const { count, stableCount, exploreCount } = getCreativeFeedingStrategyCounts(requestBody?.count);
  const excludedOpenings = Array.isArray(requestBody?.excludeOpenings)
    ? requestBody.excludeOpenings
        .slice(0, 30)
        .map((item) => readValue(item).slice(0, 500))
        .filter(Boolean)
    : [];
  const referenceText = references.length
    ? references.map((item, index) => [
        `案例 ${index + 1}: ${item.openingText}`,
        item.paintingName ? `画名：${item.paintingName}` : '',
        item.scene ? `场景：${item.scene}` : '',
        item.hookType ? `爆点类型：${item.hookType}` : '',
        item.reasonAnalysis ? `分析：${item.reasonAnalysis}` : ''
      ].filter(Boolean).join('\n')).join('\n\n')
    : '暂无历史案例，请只基于业务设定和本次需求生成。';

  return [
    '你是装饰画短视频爆款开头文案助手，只负责生成一段内容充实、方便继续衔接的短视频开头，不写完整脚本。',
    '',
    '【业务设定】',
    `业务背景：${settings.businessBackground}`,
    `目标人群：${settings.targetAudience}`,
    `产品特点：${settings.productFeatures}`,
    `文案风格偏好：${settings.stylePreference}`,
    `高转化方向：${settings.conversionDirections}`,
    `禁忌表达：${settings.forbiddenExpressions}`,
    `开头生成规则：${settings.openingRules}`,
    `输出格式要求：${settings.outputFormat}`,
    '',
    '【历史爆款开头案例】',
    referenceText,
    '',
    '【本次需求】',
    `画名：${readValue(requestBody?.paintingName) || '未指定'}`,
    `使用场景：${readValue(requestBody?.scene) || '未指定'}`,
    `想强调的寓意/卖点：${readValue(requestBody?.sellingPoint) || '未指定'}`,
    `补充要求：${readValue(requestBody?.extraRequirement) || '无'}`,
    `画作图片识别结果：${readValue(requestBody?.imageAnalysis) || '未提供图片识别结果'}`,
    `生成数量：${count} 条`,
    excludedOpenings.length > 0
      ? `上一批不合适的文案（本次必须避开这些表达、句式和核心切入角度）：\n${excludedOpenings.map((item, index) => `${index + 1}. ${item}`).join('\n')}`
      : '',
    '',
    '【生成要求】',
    '1. 历史案例只用于学习有效的开头结构、语言节奏、受众心理和爆点逻辑，严禁照抄原句，也不能只做同义词替换。',
    '2. 生成适合抖音 / 视频号的装饰画短视频开头。',
    '3. 语言要口语化、接地气，第一句话要有抓力，整段要有场景感、情绪价值和自然承接关系。',
    '4. 避免太文艺、太年轻化、太书面、太像广告。',
    '5. 不要封建迷信，不要承诺发财、转运、治病、保平安或改变命运。',
    `6. 前 ${stableCount} 条标记为“稳健参考”：沿用已验证的爆点结构，但表达和切入角度必须针对本次画作重新创作。`,
    exploreCount > 0
      ? `7. 后 ${exploreCount} 条标记为“探索新角度”：主动跳出历史案例，从画面内容、使用场景、人群关系、生活冲突或情绪价值中寻找新的切入点。`
      : '7. 本次仅生成稳健参考结果。',
    '8. 各条文案的第一句话、核心角度和爆点逻辑要有明显差异，避免批量套模板感。',
    '9. 每条都包含“开头文案”和“爆点逻辑”。',
    '10. 每条开头文案必须由 4～6 个短句组成，正文控制在 60～100 个汉字；第一句制造钩子，后续短句逐步展开并自然承接，最后一句要方便同事继续往后续文案衔接。禁止只输出一句口号或一两句过短内容。爆点逻辑不计入正文的 60～100 字。',
    excludedOpenings.length > 0
      ? '11. 这是重新生成的一批。不得复用上一批的开场句、核心角度、句式骨架或简单同义改写，必须明显换一批思路。'
      : '',
    '',
    '请按下面格式输出：',
    '1. [稳健参考] 开头文案：...',
    '   爆点逻辑：...',
    exploreCount > 0 ? `${stableCount + 1}. [探索新角度] 开头文案：...` : '2. [稳健参考] 开头文案：...',
    '   爆点逻辑：...'
  ].join('\n');
}

function extractDoubaoResponseText(json) {
  let content = '';
  if (Array.isArray(json?.output)) {
    for (const item of json.output) {
      if (item?.role === 'assistant' && Array.isArray(item.content)) {
        for (const part of item.content) {
          if (part?.type === 'output_text' && part.text) content += part.text;
          else if (typeof part?.text === 'string') content += part.text;
        }
      }
    }
  }
  if (!content && typeof json?.output_text === 'string') content = json.output_text;
  if (!content && typeof json?.choices?.[0]?.message?.content === 'string') content = json.choices[0].message.content;
  return collapseRepeatedDoubaoText(content.trim());
}

function parseCreativeFeedingResults(text, stableCount = 0) {
  const normalized = String(text || '').trim();
  if (!normalized) return [];
  const matches = [...normalized.matchAll(/(?:^|\n)\s*(?:\d+[.、)]\s*)?(?:[\[【](稳健参考|探索新角度)[\]】]\s*)?开头文案[:：]\s*([\s\S]*?)(?:\n\s*爆点逻辑[:：]\s*([\s\S]*?))(?=\n\s*(?:\d+[.、)]\s*)?(?:[\[【](?:稳健参考|探索新角度)[\]】]\s*)?开头文案[:：]|\n\s*\d+[.、)]\s*|$)/g)];
  if (matches.length > 0) {
    return matches.map((match, index) => ({
      openingText: String(match[2] || '').trim().replace(/^["“]|["”]$/g, ''),
      logic: String(match[3] || '').trim(),
      strategy: match[1] === '探索新角度' || (!match[1] && index >= stableCount) ? 'explore' : 'stable'
    })).filter((item) => item.openingText);
  }
  return normalized.split(/\n(?=\s*\d+[.、)]\s*)/g).map((block, index) => ({
    openingText: block.trim(),
    logic: '',
    strategy: index >= stableCount ? 'explore' : 'stable'
  })).filter((item) => item.openingText);
}

function normalizeCreativeFeedingImage(imageDataUrl) {
  const image = normalizeBase64ImageInput(imageDataUrl);
  const byteLength = Buffer.byteLength(image.base64Data, 'base64');
  if (byteLength > MAX_IMAGE_ORIGINAL_UPLOAD_BYTES) {
    const error = new Error('画作图片不能超过 10MB');
    error.statusCode = 413;
    throw error;
  }
  return image;
}

async function callCreativeFeedingDoubao(prompt, imageDataUrl = '') {
  const apiKey = readValue(SERVER_CONFIG.doubaoTopmodelApiKey) || readValue(SERVER_CONFIG.seedanceApiKey);
  if (!apiKey) {
    const error = new Error('未配置 Doubao API Key');
    error.statusCode = 500;
    throw error;
  }

  const content = [];
  if (readValue(imageDataUrl)) {
    const image = normalizeCreativeFeedingImage(imageDataUrl);
    content.push({ type: 'input_image', image_url: image.imageUrl });
  }
  content.push({ type: 'input_text', text: prompt });

  const upstreamRes = await fetch('https://ark.cn-beijing.volces.com/api/v3/responses', {
    method: 'POST',
    headers: {
      'Authorization': `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify({
      model: 'doubao-seed-2-1-pro-260628',
      stream: false,
      thinking: { type: 'disabled' },
      input: [
        {
          role: 'user',
          content
        }
      ]
    }),
    signal: AbortSignal.timeout(APIMART_CHAT_FETCH_TIMEOUT_MS),
  });

  const text = await upstreamRes.text();
  let json = null;
  try { json = JSON.parse(text); } catch {}

  if (!upstreamRes.ok) {
    const rawError = json?.error?.message || json?.message || json?.code || text;
    const error = new Error(translateUpstreamError(rawError, `方舟 API 请求失败（状态码 ${upstreamRes.status}）`));
    error.statusCode = upstreamRes.status;
    throw error;
  }

  return extractDoubaoResponseText(json);
}

async function handleAnalyzeCreativeFeedingImage(req, res) {
  try {
    const body = await readRequestBody(req);
    const imageDataUrl = readValue(body?.imageDataUrl);
    if (!imageDataUrl) {
      sendJson(res, 400, { error: '请先上传画作图片' });
      return;
    }
    const prompt = [
      '你是装饰画短视频文案的画作识别助手。请只根据上传图片中确实可见的内容，输出一份简洁、可编辑的中文分析。',
      '不要虚构看不清的文字、人物、寓意或创作背景；不确定的内容明确写“无法确认”。',
      '请严格按以下字段输出，每项一行：',
      '主体题材：',
      '风格与构图：',
      '主要色彩：',
      '可见文字：',
      '可表达寓意：',
      '推荐使用场景：',
      '可探索文案角度：'
    ].join('\n');
    const analysis = await callCreativeFeedingDoubao(prompt, imageDataUrl);
    sendJson(res, 200, { ok: true, model: '豆包 Seed 2.1 Pro', analysis });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || '画作图片识别失败' });
  }
}

async function handleGetCreativeFeedingSettings(req, res) {
  try {
    const settings = await loadCreativeFeedingSettings();
    sendJson(res, 200, { ok: true, settings });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '读取创意喂养设定失败' });
  }
}

async function handleSaveCreativeFeedingSettings(req, res) {
  try {
    const body = await readRequestBody(req);
    const settings = await saveCreativeFeedingSettings(body?.settings || body);
    sendJson(res, 200, { ok: true, settings });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '保存创意喂养设定失败' });
  }
}

async function handleGetCreativeOpenings(req, res, url) {
  try {
    const library = await loadCreativeOpeningLibrary();
    const openings = filterCreativeOpenings(library.openings, url);
    sendJson(res, 200, { ok: true, openings, total: openings.length });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '读取爆款开头库失败' });
  }
}

async function handleCreateCreativeOpening(req, res) {
  try {
    const body = await readRequestBody(req);
    const opening = sanitizeCreativeOpening(body, null, { touch: true });
    if (!opening.openingText) {
      sendJson(res, 400, { error: '开头文案不能为空' });
      return;
    }
    const library = await loadCreativeOpeningLibrary();
    const openings = await saveCreativeOpeningLibrary([opening, ...library.openings]);
    sendJson(res, 200, { ok: true, opening: openings.find((item) => item.id === opening.id) || opening });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '新增爆款开头失败' });
  }
}

async function handleUpdateCreativeOpening(req, res, id) {
  try {
    const body = await readRequestBody(req);
    const library = await loadCreativeOpeningLibrary();
    const index = library.openings.findIndex((item) => item.id === id);
    if (index < 0) {
      sendJson(res, 404, { error: '爆款开头不存在' });
      return;
    }
    const opening = sanitizeCreativeOpening(body, library.openings[index], { touch: true });
    if (!opening.openingText) {
      sendJson(res, 400, { error: '开头文案不能为空' });
      return;
    }
    const next = [...library.openings];
    next[index] = opening;
    await saveCreativeOpeningLibrary(next);
    sendJson(res, 200, { ok: true, opening });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '更新爆款开头失败' });
  }
}

async function handleDeleteCreativeOpening(req, res, id) {
  try {
    const library = await loadCreativeOpeningLibrary();
    const next = library.openings.filter((item) => item.id !== id);
    if (next.length === library.openings.length) {
      sendJson(res, 404, { error: '爆款开头不存在' });
      return;
    }
    await saveCreativeOpeningLibrary(next);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    sendJson(res, 500, { error: error.message || '删除爆款开头失败' });
  }
}

async function handleGenerateCreativeFeeding(req, res) {
  try {
    const body = await readRequestBody(req);
    const settings = await loadCreativeFeedingSettings();
    const library = await loadCreativeOpeningLibrary();
    const selectedIds = Array.isArray(body?.referenceIds) ? body.referenceIds.map((item) => String(item)) : [];
    const referenceLimit = Math.min(12, Math.max(1, Number(body?.referenceLimit) || 12));
    const referenceMode = selectedIds.length > 0 ? 'manual' : 'smart';
    const references = selectedIds.length > 0
      ? library.openings.filter((item) => selectedIds.includes(item.id))
      : selectSmartCreativeReferences(library.openings, body, referenceLimit);
    const { stableCount, exploreCount } = getCreativeFeedingStrategyCounts(body?.count);
    const prompt = buildCreativeFeedingPrompt({ settings, references, requestBody: body });
    const answer = await callCreativeFeedingDoubao(prompt, body?.imageDataUrl);
    sendJson(res, 200, {
      ok: true,
      model: 'doubao-seed-2.1-pro',
      modelId: 'doubao-seed-2-1-pro-260628',
      answer,
      results: parseCreativeFeedingResults(answer, stableCount),
      referenceCount: references.length,
      referenceMode,
      stableCount,
      exploreCount
    });
  } catch (error) {
    sendJson(res, error.statusCode || 500, { error: error.message || '文案仿写生成失败' });
  }
}

// --- Image Generation API Handlers ---

function isApimartNetworkError(error) {
  return (
    error?.name === 'TimeoutError' ||
    error?.name === 'AbortError' ||
    /fetch failed|network|socket|connection|econn|timeout|timed out|aborted|terminated/i.test(String(error?.message || ''))
  );
}

async function fetchApimartJson(pathname, options = {}) {
  const url = `${APIMART_API_BASE_URL}${pathname.startsWith('/') ? pathname : `/${pathname}`}`;
  let lastError = null;

  for (let attempt = 0; attempt <= APIMART_IMAGE_RETRY_DELAYS_MS.length; attempt += 1) {
    try {
      const response = await fetch(url, {
        ...options,
        signal: AbortSignal.timeout(APIMART_IMAGE_FETCH_TIMEOUT_MS),
      });
      const text = await response.text();
      let json = null;
      try {
        json = text ? JSON.parse(text) : null;
      } catch {
        json = null;
      }
      return { response, json, text, url };
    } catch (error) {
      lastError = error;
      if (!isApimartNetworkError(error) || attempt >= APIMART_IMAGE_RETRY_DELAYS_MS.length) break;
      await sleep(APIMART_IMAGE_RETRY_DELAYS_MS[attempt]);
    }
  }

  const networkError = new Error(
    lastError?.name === 'TimeoutError' || /timeout|timed out/i.test(String(lastError?.message || ''))
      ? '图片生成 API 连接超时：服务器当前访问 APIMart 较慢或不可达，请稍后重试。'
      : '图片生成 API 网络连接失败：服务器当前无法连接 APIMart，请检查上游服务或服务器网络。'
  );
  networkError.originalMessage = lastError?.message || '';
  networkError.url = url;
  throw networkError;
}

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
      model: APIMART_IMAGE_MODEL,
      prompt,
      n: 1,
      size,
      resolution,
    };

    const imageUrls = Array.isArray(body.image_urls) ? body.image_urls : [];
    if (imageUrls.length > 0) {
      apiBody.image_urls = imageUrls.slice(0, 16);
    }

    const { response, json, text } = await fetchApimartJson('/images/generations', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
      },
      body: JSON.stringify(apiBody),
    });

    if (!response.ok) {
      const msg = json?.error?.message || json?.message || text || `图片生成 API 错误: HTTP ${response.status}`;
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
    const isNetworkError = isApimartNetworkError(error) || /APIMart|图片生成 API/.test(String(error?.message || ''));
    sendJson(res, isNetworkError ? 502 : 500, {
      error: error.message || '创建图片生成任务失败',
      ...(error.originalMessage ? { detail: error.originalMessage } : {})
    });
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

    const { response, json, text } = await fetchApimartJson(`/tasks/${task.external_task_id}`, {
      headers: {
        'Authorization': `Bearer ${token}`,
      },
    });

    if (!response.ok) {
      sendJson(res, 500, { error: json?.error?.message || json?.message || text || '查询任务状态失败' });
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
    const isNetworkError = isApimartNetworkError(error) || /APIMart|图片生成 API/.test(String(error?.message || ''));
    sendJson(res, isNetworkError ? 502 : 500, {
      error: error.message || '查询任务状态失败',
      ...(error.originalMessage ? { detail: error.originalMessage } : {})
    });
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

async function handleGetImageTaskResult(req, res, id, resultIndex) {
  try {
    const task = dbGetImageTaskById(Number(id));
    if (!task) {
      sendJson(res, 404, { error: '图片生成任务不存在' });
      return;
    }

    const index = Number(resultIndex);
    const resultUrls = Array.isArray(task.result_urls) ? task.result_urls : [];
    const targetUrl = resultUrls[index];
    if (!Number.isInteger(index) || index < 0 || !targetUrl) {
      sendJson(res, 404, { error: '生成图片不存在' });
      return;
    }

    const parsedUrl = new URL(targetUrl);
    if (parsedUrl.protocol !== 'https:' && parsedUrl.protocol !== 'http:') {
      sendJson(res, 400, { error: '生成图片地址无效' });
      return;
    }

    const upstreamRes = await fetch(parsedUrl, {
      headers: { Accept: 'image/*' },
    });
    if (!upstreamRes.ok) {
      sendJson(res, 502, { error: `读取生成图片失败（HTTP ${upstreamRes.status}）` });
      return;
    }

    const contentType = String(upstreamRes.headers.get('content-type') || 'image/png').split(';')[0].trim();
    if (!contentType.startsWith('image/')) {
      sendJson(res, 502, { error: '上游返回的内容不是图片' });
      return;
    }

    const content = Buffer.from(await upstreamRes.arrayBuffer());
    if (content.length > 60 * 1024 * 1024) {
      sendJson(res, 413, { error: '生成图片超过 60MB，无法推送' });
      return;
    }

    res.writeHead(200, {
      'Content-Type': contentType,
      'Content-Length': content.length,
      'Cache-Control': 'private, max-age=300',
    });
    res.end(content);
  } catch (error) {
    sendJson(res, 502, { error: error.message || '读取生成图片失败' });
  }
}

async function handleChatCompletions(req, res) {
  try {
    const body = await readRequestBody(req);
    const messages = body.messages;
    const model = String(body.model || 'claude-fable-5');
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

    const response = await fetch(`${APIMART_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${token}`,
        'Accept': stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(apiBody),
      signal: AbortSignal.timeout(APIMART_CHAT_FETCH_TIMEOUT_MS),
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
    const isNetworkError = isApimartNetworkError(error);
    sendJson(res, isNetworkError ? 502 : 500, {
      error: isNetworkError
        ? '对话 API 网络连接失败：服务器当前无法连接 APIMart，请检查上游服务或服务器网络。'
        : (error.message || '对话请求失败'),
      ...(error?.message ? { detail: error.message } : {})
    });
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
    const thinkingEnabled = body.thinkingEnabled !== false;

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
      model: 'doubao-seed-2-1-pro-260628',
      stream,
      input,
    };

    if (!thinkingEnabled) {
      requestPayload.thinking = { type: 'disabled' };
    }

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
      let accumulatedReasoning = '';

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

            const reasoningDelta = extractDoubaoReasoningDelta(parsed.payload, parsed.event);
            if (reasoningDelta) {
              const incrementalReasoningDelta = getIncrementalText(accumulatedReasoning, reasoningDelta);
              if (incrementalReasoningDelta) {
                accumulatedReasoning += incrementalReasoningDelta;
                const reasoningChunk = JSON.stringify({
                  choices: [{ delta: { reasoning_content: incrementalReasoningDelta } }]
                });
                res.write(`data: ${reasoningChunk}\n\n`);
                if (res.flush) res.flush();
              }
            }

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
              const reasoningDelta = extractDoubaoReasoningDelta(parsed.payload, parsed.event);
              if (reasoningDelta) {
                const incrementalReasoningDelta = getIncrementalText(accumulatedReasoning, reasoningDelta);
                if (incrementalReasoningDelta) {
                  const reasoningChunk = JSON.stringify({
                    choices: [{ delta: { reasoning_content: incrementalReasoningDelta } }]
                  });
                  res.write(`data: ${reasoningChunk}\n\n`);
                }
              }
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

async function handleDeepSeekChatCompletions(req, res) {
  try {
    const body = await readRequestBody(req);
    const messages = body.messages;
    const stream = body.stream !== false;

    if (!Array.isArray(messages) || messages.length === 0) {
      sendJson(res, 400, { error: 'messages 不能为空' });
      return;
    }

    const apiKey = readValue(SERVER_CONFIG.deepseekApiKey);
    if (!apiKey) {
      sendJson(res, 500, { error: '未配置 DeepSeek API Key，请设置 DEEPSEEK_API_KEY' });
      return;
    }

    const requestPayload = {
      model: DEEPSEEK_TOPMODEL_MODEL,
      messages,
      stream,
      thinking: { type: 'enabled' },
      reasoning_effort: 'high',
    };
    if (typeof body.temperature === 'number') requestPayload.temperature = body.temperature;
    if (typeof body.max_tokens === 'number') requestPayload.max_tokens = body.max_tokens;
    if (typeof body.top_p === 'number') requestPayload.top_p = body.top_p;

    const upstreamRes = await fetch(`${DEEPSEEK_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: stream ? 'text/event-stream' : 'application/json',
      },
      body: JSON.stringify(requestPayload),
    });

    if (!upstreamRes.ok) {
      const text = await upstreamRes.text();
      let json = null;
      try { json = JSON.parse(text); } catch {}
      sendJson(res, upstreamRes.status, {
        error: json?.error?.message || json?.message || text || `DeepSeek API 请求失败（状态码 ${upstreamRes.status}）`,
      });
      return;
    }

    if (!stream) {
      const text = await upstreamRes.text();
      res.writeHead(200, { 'Content-Type': 'application/json; charset=utf-8' });
      res.end(text);
      return;
    }

    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    const reader = upstreamRes.body.getReader();
    const decoder = new TextDecoder();
    try {
      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        res.write(decoder.decode(value, { stream: true }));
        if (res.flush) res.flush();
      }
    } finally {
      const tail = decoder.decode();
      if (tail) res.write(tail);
      reader.releaseLock();
      res.end();
    }
  } catch (error) {
    sendJson(res, 500, { error: error.message || 'DeepSeek 对话请求失败' });
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
        model: QWEN_TOPMODEL_MODEL,
        messages: transformedMessages,
        stream,
        enable_thinking: true,
      };

      if (hasWebSearch) {
        apiBody.enable_search = true;
      }

      if (typeof body.temperature === 'number') apiBody.temperature = body.temperature;
      if (typeof body.max_tokens === 'number') apiBody.max_tokens = body.max_tokens;
      if (typeof body.top_p === 'number') apiBody.top_p = body.top_p;

      const response = await fetch(`${DASHSCOPE_API_BASE_URL}/chat/completions`, {
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
      const requestPayload = {
        model: QWEN_TOPMODEL_MODEL,
        messages,
        stream,
        enable_thinking: true,
      };

      if (hasWebSearch) {
        requestPayload.enable_search = true;
      }

      const upstreamRes = await fetch(`${DASHSCOPE_API_BASE_URL}/chat/completions`, {
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
        if (typeof json?.choices?.[0]?.message?.content === 'string') {
          content = json.choices[0].message.content;
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

        if (hasOwnership) {
          summary.speakers[speakerId] = 'used';
          summary.used += 1;
        } else if (speakerStatusLength === 0) {
          summary.speakers[speakerId] = 'fresh';
          summary.available += 1;
        } else if (availableTrainingTimes > 0) {
          summary.speakers[speakerId] = 'recyclable';
          summary.available += 1;
        } else {
          summary.speakers[speakerId] = 'used';
          summary.used += 1;
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
  const upperWoodFile = formData.get('upperWoodFile');
  const lowerWoodFile = formData.get('lowerWoodFile');
  const files = formData.getAll('files').filter((item) => item instanceof File && item.size > 0);
  const filesKinds = parseJsonString(formData.get('files_kinds'), []);

  return {
    question: readValue(formData.get('question')),
    history: parseJsonString(formData.get('history'), []),
    stream: readValue(formData.get('stream')).toLowerCase() === 'true',
    enableThinking: readValue(formData.get('enable_thinking')).toLowerCase() === 'true',
    model: readValue(formData.get('model')),
    mediaKind: readValue(formData.get('media_kind')),
    file: file instanceof File ? file : null,
    upperWoodFile: upperWoodFile instanceof File && upperWoodFile.size > 0 ? upperWoodFile : null,
    lowerWoodFile: lowerWoodFile instanceof File && lowerWoodFile.size > 0 ? lowerWoodFile : null,
    files,
    filesKinds,
    // 挂画全自动批量任务创建时通过 multipart 传入的字段（字符串原样透传，由 handler 自行解析）。
    profile: readValue(formData.get('profile')),
    plan: readValue(formData.get('plan')),
    ideas: readValue(formData.get('ideas')),
    totalDirections: readValue(formData.get('totalDirections')),
    startOrder: readValue(formData.get('startOrder')),
    requestedCount: readValue(formData.get('requestedCount')),
    resolution: readValue(formData.get('resolution')),
    ratio: readValue(formData.get('ratio')),
    variationRound: readValue(formData.get('variationRound')),
    generateAudio: readValue(formData.get('generateAudio')),
    watermark: readValue(formData.get('watermark')),
    stylePreset: readValue(formData.get('stylePreset')),
    uploadHistoryId: readValue(formData.get('uploadHistoryId')),
    targetFolderId: readValue(formData.get('targetFolderId')),
    targetFolderName: readValue(formData.get('targetFolderName')),
    onlyUnused: readValue(formData.get('onlyUnused')),
    autoEnhance480p: readValue(formData.get('autoEnhance480p')),
    creationRequestId: readValue(formData.get('creationRequestId')),
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
    taskMode: readValue(formData.get('taskMode')) || 'generate',
    resolution: readValue(formData.get('resolution')) || '720p',
    ratio: readValue(formData.get('ratio')),
    duration: Number.parseInt(String(formData.get('duration') || 5), 10),
    generateAudio: readValue(formData.get('generateAudio')).toLowerCase() !== 'false',
    watermark: readValue(formData.get('watermark')).toLowerCase() === 'true',
    files: formData.getAll('files').filter((item) => item instanceof File && item.size > 0),
    // 挂画方向使用标记（手动/换一轮提交时由前端透传，用于“仅生成未使用方向”持久化）。
    imageHash: readValue(formData.get('imageHash')),
    directionNumber: readValue(formData.get('directionNumber')),
    variationRound: readValue(formData.get('variationRound'))
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

function extractDoubaoReasoningDelta(payload, eventName) {
  const resolvedEvent = String(eventName || payload?.type || '').toLowerCase();
  const choices = Array.isArray(payload?.choices) ? payload.choices : [];
  for (const choice of choices) {
    if (!choice || typeof choice !== 'object') continue;
    const delta = choice.delta;
    if (delta && typeof delta === 'object') {
      if (typeof delta.reasoning_content === 'string' && delta.reasoning_content.length > 0) return delta.reasoning_content;
      if (typeof delta.reasoning === 'string' && delta.reasoning.length > 0) return delta.reasoning;
      if (typeof delta.thinking === 'string' && delta.thinking.length > 0) return delta.thinking;
    }
  }

  const candidates = [
    payload?.reasoning_content,
    payload?.reasoning,
    payload?.thinking,
    payload?.analysis,
    payload?.delta?.reasoning_content,
    payload?.delta?.reasoning,
    payload?.delta?.thinking,
    payload?.delta?.analysis,
    payload?.data?.reasoning_content,
    payload?.data?.reasoning,
    payload?.data?.thinking,
    payload?.data?.analysis,
    payload?.item?.reasoning_content,
    payload?.item?.reasoning,
    payload?.item?.thinking,
    payload?.item?.analysis,
  ];

  for (const candidate of candidates) {
    if (typeof candidate === 'string' && candidate.length > 0) return candidate;
  }

  const objectCandidates = [
    payload?.delta,
    payload?.data?.delta,
    payload?.item?.delta,
    payload?.item,
    payload?.data
  ].filter(Boolean);

  for (const item of objectCandidates) {
    if (!item || typeof item !== 'object') continue;
    if (!isDoubaoReasoningType(resolvedEvent) && !isDoubaoReasoningType(item.type)) continue;
    if (typeof item.text === 'string' && item.text.length > 0) return item.text;
    if (typeof item.delta === 'string' && item.delta.length > 0) return item.delta;
    if (item.delta && typeof item.delta.text === 'string' && item.delta.text.length > 0) return item.delta.text;
    if (Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        if (!contentItem || typeof contentItem !== 'object') continue;
        if (!isDoubaoReasoningType(contentItem.type)) continue;
        if (typeof contentItem.text === 'string' && contentItem.text.length > 0) return contentItem.text;
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
    ws.on('unexpected-response', (_request, response) => {
      const chunks = [];
      response.on('data', (chunk) => chunks.push(Buffer.from(chunk)));
      response.on('end', () => {
        const body = Buffer.concat(chunks).toString('utf8');
        const detail = body ? `：${body.slice(0, 500)}` : '';
        const error = new Error(`火山 TTS WebSocket 鉴权失败 ${response.statusCode || ''}${detail}`);
        error.statusCode = response.statusCode;
        error.statusMessage = response.statusMessage;
        error.upstreamBody = body;
        fail(error);
      });
    });
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
      matchedGroupIndex: group?.index || null,
      speakerInConfiguredPool: !!group,
      configuredSpeakerIdCount: getConfiguredVolcSpeakerIds().length,
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
    const isVolcTtsForbidden = error.statusCode === 403;
    sendJson(res, 500, {
      error: isVolcTtsForbidden
        ? '火山 TTS 鉴权失败 403：当前 speaker_id 对应的火山账号组可能未开通实时语音合成权限，或该组不支持当前 resourceId。克隆成功但试听/生成失败时，通常需要在火山后台给这一组 App 开通 TTS/实时语音合成权限。'
        : (error.message || '火山语音生成失败'),
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
        matchedGroupIndex: error.debug?.matchedGroupIndex || debug?.matchedGroupIndex,
        speakerInConfiguredPool: typeof error.debug?.speakerInConfiguredPool === 'boolean' ? error.debug.speakerInConfiguredPool : debug?.speakerInConfiguredPool,
        configuredSpeakerIdCount: error.debug?.configuredSpeakerIdCount || debug?.configuredSpeakerIdCount,
        upstreamStatusCode: error.statusCode || null,
        upstreamStatusMessage: error.statusMessage || '',
        upstreamBody: error.upstreamBody || '',
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
    const enableThinking = false;

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
    if (!enableThinking) {
      requestPayload.thinking = { type: 'disabled' };
    }
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
      thinking: enableThinking ? 'enabled_by_model_default' : 'disabled',
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

function parseStructuredJson(text) {
  const raw = String(text || '').trim();
  if (!raw) {
    throw Object.assign(new Error('模型未返回可解析的内容'), { rawText: '' });
  }

  // 去掉 markdown 代码围栏
  let candidate = raw
    .replace(/^```(?:json|javascript|js)?\s*/i, '')
    .replace(/```\s*$/i, '')
    .trim();

  // 定位首个 { 或 [，以及对应的结尾符号
  const objectStart = candidate.indexOf('{');
  const arrayStart = candidate.indexOf('[');
  if (objectStart === -1 && arrayStart === -1) {
    throw Object.assign(new Error('模型返回的内容不是 JSON 结构'), { rawText: raw });
  }

  const isObject = objectStart === -1 || (arrayStart !== -1 && arrayStart < objectStart);
  const start = isObject ? arrayStart : objectStart;
  const endChar = isObject ? ']' : '}';
  const end = candidate.lastIndexOf(endChar);
  if (end <= start) {
    throw Object.assign(new Error('模型返回的 JSON 结构不完整'), { rawText: raw });
  }

  candidate = candidate.slice(start, end + 1);
  try {
    return JSON.parse(candidate);
  } catch (parseError) {
    throw Object.assign(new Error('模型返回的 JSON 解析失败'), {
      rawText: raw,
      parseError: parseError?.message || '',
    });
  }
}

function countChars(text) {
  return String(text || '').replace(/\s/g, '').length;
}

function textBigrams(text) {
  const normalized = String(text || '')
    .toLowerCase()
    .replace(/[#*_`>\-\s]/g, '')
    .replace(/[，。、“”‘’；：:,.!?！？（）()【】\[\]《》<>]/g, '');
  const bigrams = new Set();
  for (let i = 0; i < normalized.length - 1; i += 1) {
    bigrams.add(normalized.slice(i, i + 2));
  }
  return bigrams;
}

function textSimilarity(a, b) {
  const bigramsA = textBigrams(a);
  const bigramsB = textBigrams(b);
  if (!bigramsA.size || !bigramsB.size) return 0;
  let intersection = 0;
  for (const gram of bigramsA) {
    if (bigramsB.has(gram)) intersection += 1;
  }
  return intersection / Math.max(bigramsA.size, bigramsB.size);
}

function isRetriableUpstreamError(error) {
  const message = String(error?.message || error || '');
  return /network|fetch|failed|timeout|timed out|abort|terminated|connection|econn|socket|网络|连接|中断|超时|504|502|503|429/i.test(message);
}

async function withRetryOnce(fn) {
  try {
    return await fn();
  } catch (error) {
    if (!isRetriableUpstreamError(error)) throw error;
    console.warn('[copy] upstream retry', { message: error?.message || '' });
    try {
      return await fn();
    } catch (retryError) {
      if (isRetriableUpstreamError(retryError)) {
        throw new Error('豆包连接偶发中断，已自动重试一次但仍未成功。请稍后再试。');
      }
      throw retryError;
    }
  }
}

async function mapWithConcurrency(items, limit, fn) {
  const results = new Array(items.length);
  let cursor = 0;
  const workerCount = Math.max(1, Math.min(limit, items.length));
  const workers = Array.from({ length: workerCount }, async () => {
    while (cursor < items.length) {
      const i = cursor;
      cursor += 1;
      results[i] = await fn(items[i], i);
    }
  });
  await Promise.all(workers);
  return results;
}

function findDuplicatePair(copies) {
  for (let i = 0; i < copies.length; i += 1) {
    for (let j = i + 1; j < copies.length; j += 1) {
      if (textSimilarity(copies[i].fullText, copies[j].fullText) > 0.85) return [i, j];
    }
  }
  return null;
}

async function callDoubaoArkText({ apiKey, model, content, timeoutMs }) {
  const upstreamUrl = 'https://ark.cn-beijing.volces.com/api/v3/responses';
  const requestPayload = {
    model: model || DEFAULT_DOUBAO_MULTIMODAL_MODEL,
    stream: false,
    input: [{ role: 'user', content }],
    thinking: { type: 'disabled' }
  };

  const upstreamRes = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json'
    },
    body: JSON.stringify(requestPayload),
    signal: AbortSignal.timeout(timeoutMs || DOUBAO_MULTIMODAL_TIMEOUT_MS)
  });

  const responseText = await upstreamRes.text();
  let json = null;
  try {
    json = responseText ? JSON.parse(responseText) : null;
  } catch {}

  if (!upstreamRes.ok) {
    const rawError = json?.error?.message || json?.message || json?.code || '';
    throw new Error(translateUpstreamError(rawError, `方舟 API 请求失败（状态码 ${upstreamRes.status}）`));
  }

  const answer = extractResponsesText(json);
  if (!answer) {
    throw new Error('豆包返回为空，请稍后重试。');
  }
  return answer;
}

// 挂画分析和创意方案都可能超过线上代理的单次请求超时，因此统一使用后台任务。
const PAINTING_TASKS = new Map();
const PAINTING_TASK_TTL_MS = 30 * 60 * 1000;
const PAINTING_TASK_MAX = 100;

// 创意任务幂等：clientRequestId → painting taskId。响应丢失后，前端用同一编号重试可拿回原 taskId，
// 不会重复创建后台豆包任务。映射存活时间与挂画任务 TTL 一致；服务重启后内存任务不存在时，
// 明确返回“任务已失效”，绝不假装原任务仍在执行。
const PAINTING_IDEA_CLIENT_REQUESTS = new Map();
const PAINTING_IDEA_CLIENT_REQUEST_TTL_MS = PAINTING_TASK_TTL_MS;

function isValidPaintingClientRequestId(value) {
  const id = String(value || '');
  return /^[A-Za-z0-9._-]{8,128}$/.test(id);
}

function prunePaintingIdeaClientRequests() {
  const now = Date.now();
  for (const [id, entry] of PAINTING_IDEA_CLIENT_REQUESTS) {
    if (now - entry.createdAt > PAINTING_IDEA_CLIENT_REQUEST_TTL_MS) PAINTING_IDEA_CLIENT_REQUESTS.delete(id);
  }
}

function prunePaintingTasks() {
  const now = Date.now();
  for (const [id, task] of PAINTING_TASKS) {
    if (task.doneAt && now - task.doneAt > PAINTING_TASK_TTL_MS) PAINTING_TASKS.delete(id);
  }
  while (PAINTING_TASKS.size > PAINTING_TASK_MAX) {
    const oldestKey = PAINTING_TASKS.keys().next().value;
    PAINTING_TASKS.delete(oldestKey);
  }
}

function createPaintingTask(kind) {
  prunePaintingTasks();
  const task = {
    id: `painting-${kind}-${randomBytes(8).toString('hex')}`,
    kind,
    status: 'running',
    result: null,
    error: '',
    debug: null,
    createdAt: Date.now(),
    doneAt: 0,
  };
  PAINTING_TASKS.set(task.id, task);
  return task;
}

function handlePaintingTaskStatus(req, res, taskId) {
  const task = PAINTING_TASKS.get(readValue(taskId));
  if (!task || (task.doneAt && Date.now() - task.doneAt > PAINTING_TASK_TTL_MS)) {
    sendJson(res, 404, { error: '挂画任务不存在或已过期' });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    taskId: task.id,
    kind: task.kind,
    status: task.status,
    ...(task.status === 'done' ? { result: task.result } : {}),
    ...(task.status === 'failed' ? { error: task.error, debug: task.debug } : {}),
  });
}

// ===== 挂画全自动批量：模型与费用 =====
// 全自动批量只开放成本较低的四个模型；稳定版与 2.5 不进入批量付费入口。
const PAINTING_BATCH_MODEL = 'doubao-seedance-2-0-mini-260615';
const PAINTING_BATCH_MODELS = new Set([
  'doubao-seedance-2-0-mini-260615',
  'doubao-seedance-2-0-fast-260128',
  'MiniMax-H3',
  'wan3.0-video',
]);
const PAINTING_BATCH_RESOLUTIONS = new Set(['480p', '720p', '768p']);
const PAINTING_BATCH_MODEL_REJECT_MESSAGE = '全自动批量生成仅支持 Seedance 2.0 Mini、Fast、MiniMax H3 或 Wan3.0 Video。';

function getPaintingBatchSupportedResolutions(model) {
  return String(model || '') === 'MiniMax-H3' ? ['768p'] : ['480p', '720p'];
}

function isPaintingBatchResolutionSupported(model, resolution) {
  return getPaintingBatchSupportedResolutions(model).includes(String(resolution || '').toLowerCase());
}

// 按秒估算单价（元/秒）。Seedance 使用当前控制台价格；实际费用以平台账单为准。
function getSeedanceRatePerSecond(model, resolution = '720p') {
  const m = String(model || '');
  const res = String(resolution || '720p').toLowerCase();
  if (m === 'doubao-seedance-2-0-mini-260615') return res === '480p' ? 0.1 : res === '720p' ? 0.2 : null;
  if (m === 'doubao-seedance-2-0-fast-260128') return res === '480p' ? 0.278 : res === '720p' ? 0.598 : null;
  if (m === 'MiniMax-H3') return res === '768p' ? 0.5 : null;
  if (m === 'doubao-seedance-2-0-260128') return res === '480p' ? 0.46 : res === '720p' ? 1.0 : null;
  if (m === 'doubao-seedance-2-5-260628') return res === '720p' ? 1.5 : null;
  if (m === 'wan3.0-video') return res === '480p' ? 0.21 : res === '720p' ? 0.42 : res === '1080p' ? 0.84 : null;
  return null;
}

function roundMoney(value) {
  return Number((Number(value) || 0).toFixed(2));
}

// 计算创建当时的费用估算快照：所有待生成视频预计时长总和 × 每秒单价。
// 方向 29 已在创意生成阶段固定为 durationMin=4 / durationMax=6，这里直接按其各自时长累加。
function computePaintingBatchCostEstimate(selectedIdeas, plan, model, resolution) {
  const ratePerSecond = getSeedanceRatePerSecond(model, resolution);
  let totalMinSeconds = 0;
  let totalMaxSeconds = 0;
  for (const idea of selectedIdeas || []) {
    const min = Number(idea?.durationMin) || Number(plan?.durationMin) || 0;
    const max = Number(idea?.durationMax) || Number(plan?.durationMax) || 0;
    totalMinSeconds += min > 0 ? min : 0;
    totalMaxSeconds += max > 0 ? max : 0;
  }
  return {
    model,
    resolution: String(resolution || '720p'),
    ratePerSecond,
    totalMinSeconds,
    totalMaxSeconds,
    estimatedCostMin: ratePerSecond == null ? null : roundMoney(totalMinSeconds * ratePerSecond),
    estimatedCostMax: ratePerSecond == null ? null : roundMoney(totalMaxSeconds * ratePerSecond),
    currency: 'CNY',
    pricingNote: '费用按所选模型、分辨率与时长估算，实际以平台账单为准。',
    estimatedAt: Math.floor(Date.now() / 1000),
  };
}

async function handleCreatePaintingBatchRun(req, res) {
  try {
    if (!paintingBatchIdempotencyReady) {
      sendJson(res, 503, { error: '批量生成的幂等保护未就绪（唯一索引迁移/校验失败），已临时禁用创建以避免重复扣费。请联系管理员检查服务端日志。' });
      return;
    }
    const apiKey = readValue(SERVER_CONFIG.arkApiKey);
    const seedanceApiKey = readValue(SERVER_CONFIG.seedanceApiKey);
    if (!apiKey) {
      sendJson(res, 500, { error: '服务端未配置 ARK_API_KEY' });
      return;
    }
    const body = isMultipartFormRequest(req)
      ? await readMultipartFormBody(req)
      : await readRequestBody(req);

    // 正式付费批次幂等编号：响应丢失后前端用同一编号恢复，绝不重复创建 40 条付费任务。
    const creationRequestId = readValue(body.creationRequestId);
    if (!creationRequestId) {
      sendJson(res, 400, { error: '创建批次缺少 creationRequestId，已拒绝执行以避免网络重试造成重复扣费' });
      return;
    }
    if (!isValidPaintingClientRequestId(creationRequestId)) {
      sendJson(res, 400, { error: 'creationRequestId 格式不合法，需为 8-128 位字母/数字/._-' });
      return;
    }
    const existing = dbGetPaintingBatchRunByCreationRequestId(creationRequestId);
    if (existing) {
      const tasks = dbGetPaintingBatchTasks(existing.batchRunId);
      sendJson(res, 200, {
        ok: true,
        deduplicated: true,
        batchRunId: existing.batchRunId,
        status: existing.status,
        controlStatus: existing.controlStatus,
        taskCount: tasks.length,
        totalDirections: existing.totalDirections,
        targetFolderId: existing.targetFolderId,
        targetFolderName: existing.targetFolderName,
      });
      return;
    }

    let imageFile = null;
    let imageHash = '';
    let imagePath = '';

    if (body.file instanceof File && body.file.size > 0) {
      imageFile = body.file;
    } else if (readValue(body.image)) {
      const normalized = normalizeBase64ImageInput(body.image, body.imageMimeType);
      const buffer = Buffer.from(normalized.imageUrl.replace(/^data:image\/[^;]+;base64,/, ''), 'base64');
      imageFile = new File([buffer], 'painting.jpg', { type: normalized.mimeType || 'image/jpeg' });
    }

    if (!imageFile) {
      sendJson(res, 400, { error: '请先上传挂画图片' });
      return;
    }

    const fileBuffer = Buffer.from(await imageFile.arrayBuffer());
    imageHash = createHash('sha256').update(fileBuffer).digest('hex');
    const stored = await ensurePaintingBatchRunImage(imageHash, imageFile);
    imagePath = stored.filePath;

    const storeOptionalWoodReference = async (file, label) => {
      if (!(file instanceof File) || file.size <= 0) return null;
      if (!readValue(file.type).startsWith('image/')) {
        const error = new Error(`${label}必须是图片格式`);
        error.statusCode = 400;
        throw error;
      }
      const buffer = Buffer.from(await file.arrayBuffer());
      const hash = createHash('sha256').update(buffer).digest('hex');
      const result = await ensurePaintingBatchRunImage(hash, file);
      return {
        imagePath: result.filePath,
        imageHash: hash,
        fileName: sanitizeFileName(file.name || `${label}.jpg`),
        fileSize: result.size,
      };
    };
    const upperWoodReference = await storeOptionalWoodReference(body.upperWoodFile, '上方木条参考图');
    const lowerWoodReference = await storeOptionalWoodReference(body.lowerWoodFile, '下方木条参考图');

    const profile = body.profile && typeof body.profile === 'object'
      ? body.profile
      : (typeof body.profile === 'string' ? JSON.parse(body.profile) : null);
    const plan = body.plan && typeof body.plan === 'object'
      ? body.plan
      : (typeof body.plan === 'string' ? JSON.parse(body.plan) : null);
    const ideas = Array.isArray(body.ideas)
      ? body.ideas
      : (typeof body.ideas === 'string' ? JSON.parse(body.ideas) : []);

    if (!profile || typeof profile !== 'object') {
      sendJson(res, 400, { error: '缺少产品档案 profile' });
      return;
    }
    if (!plan || typeof plan !== 'object') {
      sendJson(res, 400, { error: '缺少拍摄方案 plan' });
      return;
    }

    const requestedCount = body.requestedCount === undefined || body.requestedCount === ''
      ? (body.totalDirections === undefined || body.totalDirections === '' ? 40 : Number(body.totalDirections))
      : Number(body.requestedCount);
    if (!Number.isInteger(requestedCount) || requestedCount < 1 || requestedCount > 40) {
      sendJson(res, 400, { error: '生成数量必须是1到40之间的整数；留空时默认生成40条。' });
      return;
    }
    const totalDirections = requestedCount;
    if (ideas.length < totalDirections) {
      sendJson(res, 400, { error: `创意方向数量不足，已提供 ${ideas.length} 条，需要 ${totalDirections} 条` });
      return;
    }
    const startOrder = readValue(body.startOrder) || 'group1';
    if (!['group1', 'group2', 'group3', 'group4', 'random'].includes(startOrder)) {
      sendJson(res, 400, { error: '生成顺序不合法，请选择第1至第4组或随机顺序。' });
      return;
    }

    const requestedModel = readValue(body.model) || PAINTING_BATCH_MODEL;
    if (!PAINTING_BATCH_MODELS.has(requestedModel)) {
      sendJson(res, 400, { error: PAINTING_BATCH_MODEL_REJECT_MESSAGE });
      return;
    }
    const model = requestedModel;
    const modelApiKey = model === 'MiniMax-H3'
      ? readValue(SERVER_CONFIG.minimaxApiKey)
      : model === 'wan3.0-video'
        ? readValue(SERVER_CONFIG.dashscopeApiKey)
        : seedanceApiKey;
    if (!modelApiKey) {
      sendJson(res, 500, { error: `服务端未配置 ${model === 'MiniMax-H3' ? 'MINIMAX_API_KEY' : model === 'wan3.0-video' ? 'DASHSCOPE_API_KEY' : 'SEEDANCE_API_KEY'}` });
      return;
    }
    const resolution = String(readValue(body.resolution) || '720p').toLowerCase();
    if (!isPaintingBatchResolutionSupported(model, resolution)) {
      sendJson(res, 400, { error: `${model === 'MiniMax-H3' ? 'MiniMax H3' : '所选模型'}仅支持${getPaintingBatchSupportedResolutions(model).map((item) => item.toUpperCase()).join('或')}。` });
      return;
    }
    const ratio = readValue(body.ratio) || '9:16';
    const variationRound = Math.max(0, Math.min(2, Number(body.variationRound) || 0));
    const onlyUnused = body.onlyUnused === 'true' || body.onlyUnused === true;
    const autoEnhance480p = body.autoEnhance480p === 'true' || body.autoEnhance480p === true;
    const generateAudio = body.generateAudio !== 'false' && body.generateAudio !== false;
    const watermark = body.watermark === 'true' || body.watermark === true;
    const stylePreset = readValue(body.stylePreset) || plan.stylePreset || 'modern-minimal';
    const uploadHistoryId = Number(body.uploadHistoryId) || null;

    let targetFolderId = Number(body.targetFolderId) || null;
    let targetFolderName = readValue(body.targetFolderName) || '通用素材';
    if (targetFolderId) {
      const resolvedName = dbGetVideoLibraryFolderNameById(targetFolderId);
      if (resolvedName && sanitizeVideoLibraryFolder(resolvedName) === sanitizeVideoLibraryFolder(targetFolderName)) {
        targetFolderName = resolvedName;
      } else {
        // 用户切换了文件夹但前端仍携带旧 id：以用户实际选择的名称重新解析，避免存到旧文件夹。
        targetFolderId = null;
      }
    }
    if (!targetFolderId) {
      const ensured = dbEnsureVideoLibraryFolder(targetFolderName);
      targetFolderId = ensured.id;
      targetFolderName = ensured.folderName;
    }

    dbUpsertPaintingFolderBinding({
      paintingName: profile.name || '未命名挂画',
      uploadHistoryId,
      imageHash,
      folderId: targetFolderId,
      folderName: targetFolderName,
    });

    let selectedIdeas = [...ideas];
    // 服务端重新校验“仅生成未使用方向”：以服务端持久化的方向使用记录为准，避免前端统计不准确导致重复生成。
    if (onlyUnused) {
      const usedDirections = new Set(dbGetPaintingUsedDirections(imageHash, variationRound));
      selectedIdeas = selectedIdeas.filter((idea) => {
        const directionNumber = Number(idea.directionNumber) > 0 ? Number(idea.directionNumber) : 0;
        return directionNumber > 0 && !usedDirections.has(directionNumber);
      });
    }
    selectedIdeas = selectedIdeas.slice(0, totalDirections);
    if (selectedIdeas.length === 0) {
      sendJson(res, 400, { error: '没有可生成的方向：当前轮次的方向都已使用过。可取消“仅生成未使用方向”或换一轮再试。' });
      return;
    }

    const batchRunId = `pb-${randomBytes(8).toString('hex')}`;
    // 创建当时的费用估算快照，写入 options_json，供后续价格配置变化时仍能追溯当时的估算依据。
    const costEstimate = computePaintingBatchCostEstimate(selectedIdeas, plan, model, resolution);
    const batchOptions = {
      ...(body.options && typeof body.options === 'object' ? body.options : {}),
      startOrder,
      requestedCount,
      autoEnhance480p,
      costEstimate,
      woodReferences: {
        upper: upperWoodReference,
        lower: lowerWoodReference,
      },
    };

    // 批次记录与本次选中的方向任务必须在同一事务内落库：事务成功后才 enqueue，禁止出现“批次已存在但任务只插了一半”。
    const batchDb = getCollectionDb();
    batchDb.exec('BEGIN IMMEDIATE');
    let run;
    try {
      run = dbInsertPaintingBatchRun({
        batchRunId,
        creationRequestId,
        paintingName: profile.name || '未命名挂画',
        profile,
        plan,
        imagePath,
        imageHash,
        uploadHistoryId,
        stylePreset,
        model,
        resolution,
        ratio,
        generateAudio,
        watermark,
        variationRound,
        totalDirections: selectedIdeas.length,
        targetFolderId,
        targetFolderName,
        status: 'running',
        controlStatus: 'running',
        options: batchOptions,
      });

      for (let index = 0; index < selectedIdeas.length; index += 1) {
        const idea = selectedIdeas[index];
        // 保留前端传入的固定方向编号（1-40），避免“只生成未使用方向”时把方向编号重排。
        const directionNumber = Number(idea.directionNumber) > 0 ? Number(idea.directionNumber) : index + 1;
        dbInsertPaintingBatchTask({
          batchRunId,
          directionNumber,
          batchIndex: Math.max(0, Math.floor((directionNumber - 1) / 10)),
          variationRound,
          ideaId: idea.id || `dir-${directionNumber}`,
          ideaTitle: idea.title || '',
          ideaSummary: idea.summary || idea.description || '',
          status: 'queued',
        });
      }
      batchDb.exec('COMMIT');
    } catch (insertError) {
      try { batchDb.exec('ROLLBACK'); } catch {}
      // 唯一索引冲突：并发同编号请求只能创建一个批次，读取已存在的原批次并返回，绝不返回 500。
      if (creationRequestId && /UNIQUE constraint failed/i.test(String(insertError?.message || ''))) {
        const existing = dbGetPaintingBatchRunByCreationRequestId(creationRequestId);
        if (existing) {
          const tasks = dbGetPaintingBatchTasks(existing.batchRunId);
          sendJson(res, 200, {
            ok: true,
            deduplicated: true,
            batchRunId: existing.batchRunId,
            status: existing.status,
            controlStatus: existing.controlStatus,
            taskCount: tasks.length,
            totalDirections: existing.totalDirections,
            targetFolderId: existing.targetFolderId,
            targetFolderName: existing.targetFolderName,
          });
          return;
        }
      }
      throw insertError;
    }

    enqueueBatchRun(batchRunId);

    sendJson(res, 202, {
      ok: true,
      deduplicated: false,
      batchRunId,
      status: run.status,
      controlStatus: run.controlStatus,
      taskCount: selectedIdeas.length,
      totalDirections: selectedIdeas.length,
      targetFolderId,
      targetFolderName,
    });
  } catch (error) {
    console.error('[painting batch] create failed', { message: error?.message || '' });
    sendJson(res, 500, { error: error?.message || '创建批量任务失败' });
  }
}

async function handleGetPaintingBatchRun(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const batchRunId = decodeURIComponent(url.pathname.replace(/^\/api\/painting\/batch-runs\//, ''));
    const run = dbGetPaintingBatchRun(batchRunId);
    if (!run) {
      sendJson(res, 404, { error: '批量任务不存在' });
      return;
    }
    const tasks = dbGetPaintingBatchTasks(batchRunId);
    sendJson(res, 200, {
      ok: true,
      run: { ...run, imagePath: undefined },
      tasks: tasks.map((t) => ({ ...t, prompt: undefined })),
      counts: {
        total: tasks.length,
        completed: tasks.filter((t) => t.status === 'completed').length,
        failed: tasks.filter((t) => t.status === 'failed').length,
        needsReview: tasks.filter((t) => t.status === 'needs_review').length,
        stopped: tasks.filter((t) => t.status === 'stopped').length,
        rendering: tasks.filter((t) => t.status === 'rendering' || t.status === 'seedance_submitted').length,
        generatingPrompt: tasks.filter((t) => t.status === 'generating_prompt' || t.status === 'prompt_ready').length,
      },
    });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '读取批量任务失败' });
  }
}

// 按创建幂等编号查询批次：用于“正式创建批次 POST 响应丢失后”前端自动确认是否已经创建。
async function handleGetPaintingBatchRunByRequest(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const requestId = decodeURIComponent(url.pathname.replace(/^\/api\/painting\/batch-runs\/by-request\//, ''));
    if (!isValidPaintingClientRequestId(requestId)) {
      sendJson(res, 400, { error: '请求编号格式不合法' });
      return;
    }
    const run = dbGetPaintingBatchRunByCreationRequestId(requestId);
    if (!run) {
      sendJson(res, 200, { ok: true, found: false });
      return;
    }
    const tasks = dbGetPaintingBatchTasks(run.batchRunId);
    sendJson(res, 200, {
      ok: true,
      found: true,
      run: { ...run, imagePath: undefined },
      tasks: tasks.map((t) => ({ ...t, prompt: undefined })),
      counts: {
        total: tasks.length,
        completed: tasks.filter((t) => t.status === 'completed').length,
        failed: tasks.filter((t) => t.status === 'failed').length,
        needsReview: tasks.filter((t) => t.status === 'needs_review').length,
        stopped: tasks.filter((t) => t.status === 'stopped').length,
        rendering: tasks.filter((t) => t.status === 'rendering' || t.status === 'seedance_submitted').length,
        generatingPrompt: tasks.filter((t) => t.status === 'generating_prompt' || t.status === 'prompt_ready').length,
      },
    });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '按请求编号查询批次失败' });
  }
}

async function handleListPaintingBatchRuns(req, res) {
  try {
    const runs = dbGetRecentPaintingBatchRuns(50);
    sendJson(res, 200, {
      ok: true,
      runs: runs.map((run) => ({ ...run, imagePath: undefined })),
    });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '读取批量任务列表失败' });
  }
}

async function handleDeletePaintingBatchRun(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const batchRunId = decodeURIComponent(url.pathname.replace(/^\/api\/painting\/batch-runs\//, ''));
    const run = dbGetPaintingBatchRun(batchRunId);
    if (!run) {
      sendJson(res, 404, { error: '批量任务不存在或已被删除' });
      return;
    }
    if (!['completed', 'failed', 'stopped', 'needs_review'].includes(run.status)) {
      sendJson(res, 409, { error: '正在运行、暂停或停止收尾中的批次不能删除，请先终止并等待任务结束' });
      return;
    }
    dbDeletePaintingBatchRun(batchRunId);
    sendJson(res, 200, { ok: true, batchRunId });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '删除批量生成历史失败' });
  }
}

async function handlePausePaintingBatchRun(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const batchRunId = decodeURIComponent(url.pathname.replace(/^\/api\/painting\/batch-runs\//, '').replace(/\/pause$/, ''));
    const run = dbGetPaintingBatchRun(batchRunId);
    if (!run) {
      sendJson(res, 404, { error: '批量任务不存在' });
      return;
    }
    if (['completed', 'failed', 'stopped', 'needs_review'].includes(run.status)) {
      sendJson(res, 400, { error: '当前状态不可暂停' });
      return;
    }
    dbUpdatePaintingBatchRun(batchRunId, { status: 'paused', controlStatus: 'paused' });
    sendJson(res, 200, { ok: true, batchRunId, controlStatus: 'paused' });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '暂停批量任务失败' });
  }
}

async function handleResumePaintingBatchRun(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const batchRunId = decodeURIComponent(url.pathname.replace(/^\/api\/painting\/batch-runs\//, '').replace(/\/resume$/, ''));
    const run = dbGetPaintingBatchRun(batchRunId);
    if (!run) {
      sendJson(res, 404, { error: '批量任务不存在' });
      return;
    }
    if (run.controlStatus !== 'paused' && run.controlStatus !== 'stopping') {
      sendJson(res, 400, { error: '当前状态不可恢复' });
      return;
    }
    if (['completed', 'failed', 'stopped', 'needs_review'].includes(run.status)) {
      sendJson(res, 400, { error: '当前状态不可恢复' });
      return;
    }
    dbUpdatePaintingBatchRun(batchRunId, { status: 'running', controlStatus: 'running' });
    // 恢复调度：把暂停期间保持 paused 的未提交任务放回队列。
    for (const t of dbGetPaintingBatchTasks(batchRunId)) {
      if (t.status === 'paused' && !t.seedanceTaskId) {
        dbUpdatePaintingBatchTask(t.id, { status: 'queued', errorMessage: '' });
      }
    }
    enqueueBatchRun(batchRunId);
    sendJson(res, 200, { ok: true, batchRunId, controlStatus: 'running' });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '恢复批量任务失败' });
  }
}

async function handleStopPaintingBatchRun(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const batchRunId = decodeURIComponent(url.pathname.replace(/^\/api\/painting\/batch-runs\//, '').replace(/\/stop$/, ''));
    const run = dbGetPaintingBatchRun(batchRunId);
    if (!run) {
      sendJson(res, 404, { error: '批量任务不存在' });
      return;
    }
    if (['completed', 'failed', 'stopped', 'needs_review'].includes(run.status)) {
      sendJson(res, 400, { error: '当前状态已结束' });
      return;
    }
    // 先进入“停止中”：未提交任务立即停止，已提交任务继续收尾，收尾完成后才转为 stopped。
    dbUpdatePaintingBatchRun(batchRunId, { status: 'stopping', controlStatus: 'stopping' });
    enqueueBatchRun(batchRunId);
    sendJson(res, 200, { ok: true, batchRunId, controlStatus: 'stopping', draining: true });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '停止批量任务失败' });
  }
}

function restorePaintingBatchRunForRetry(batchRunId) {
  const run = dbGetPaintingBatchRun(batchRunId);
  if (run && (run.controlStatus !== 'running' || ['completed', 'failed', 'stopped', 'needs_review'].includes(run.status))) {
    dbUpdatePaintingBatchRun(batchRunId, { status: 'running', controlStatus: 'running' });
  }
  enqueueBatchRun(batchRunId);
}

// “重试”语义：只回查原任务 / 重新入库，绝不新建 Seedance 任务。
async function handleRetryPaintingBatchTask(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const taskId = Number(decodeURIComponent(url.pathname.replace(/^\/api\/painting\/batch-tasks\//, '').replace(/\/retry$/, '')));
    const task = dbGetPaintingBatchTask(taskId);
    if (!task) {
      sendJson(res, 404, { error: '任务不存在' });
      return;
    }
    if (!['failed', 'needs_review', 'stopped'].includes(task.status)) {
      sendJson(res, 400, { error: '当前状态不可重试' });
      return;
    }
    if (!task.seedanceTaskId) {
      sendJson(res, 400, {
        error: '该任务没有 Seedance 任务编号，无法查询原任务。请先到 Seedance 后台核实上游是否已生成；如确认未生成，请使用“重新提交”。',
        requiresResubmit: true,
      });
      return;
    }
    dbUpdatePaintingBatchTask(task.id, {
      status: 'seedance_submitted',
      retryCount: 0,
      saveRetryCount: 0,
      errorMessage: '',
    });
    // 先返回确定结果，再异步恢复队列；避免响应状态被后续轮询/收尾流水线覆盖。
    sendJson(res, 200, { ok: true, taskId: task.id, status: 'seedance_submitted' });
    restorePaintingBatchRunForRetry(task.batchRunId);
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '重试任务失败' });
  }
}

// “重新提交”语义：确认上游确实没有生成后，允许新建 Seedance 任务（可能再次扣费）。
// 仅允许没有 seedanceTaskId 的任务，且必须二次确认。
async function handleResubmitPaintingBatchTask(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const taskId = Number(decodeURIComponent(url.pathname.replace(/^\/api\/painting\/batch-tasks\//, '').replace(/\/resubmit$/, '')));
    const body = await readRequestBody(req).catch(() => ({}));
    const confirmed = body.confirm === true || body.confirm === 'true';
    const task = dbGetPaintingBatchTask(taskId);
    if (!task) {
      sendJson(res, 404, { error: '任务不存在' });
      return;
    }
    if (!['failed', 'needs_review', 'stopped'].includes(task.status)) {
      sendJson(res, 400, { error: '当前状态不可重新提交' });
      return;
    }
    if (task.seedanceTaskId) {
      sendJson(res, 400, {
        error: '该任务已存在 Seedance 任务编号，请使用“查询原任务”而不是重新提交，避免重复扣费。',
      });
      return;
    }
    // 仅允许当前批量白名单中的模型重新提交，防止历史异常模型产生意外费用。
    const batchRun = dbGetPaintingBatchRun(task.batchRunId);
    const batchModel = String(batchRun?.model || '');
    if (!PAINTING_BATCH_MODELS.has(batchModel)) {
      sendJson(res, 400, {
        error: '该历史批次使用的模型不在当前批量生成白名单中，为避免意外费用禁止重新提交。请创建新的批次重新生成。',
      });
      return;
    }
    // 仅允许当前批量支持的分辨率重新提交。
    const batchResolution = String(batchRun?.resolution || '720p').toLowerCase();
    if (!isPaintingBatchResolutionSupported(batchModel, batchResolution)) {
      sendJson(res, 400, {
        error: `该历史批次使用的分辨率不在当前模型支持范围内，禁止重新提交。当前模型仅支持${getPaintingBatchSupportedResolutions(batchModel).map((item) => item.toUpperCase()).join('或')}。`,
      });
      return;
    }
    if (!confirmed) {
      sendJson(res, 400, {
        error: '重新提交会再次调用 Seedance 并可能再次扣费。请先在 Seedance 后台确认该方向上游确实没有生成视频，再确认重新提交。',
        needsConfirm: true,
      });
      return;
    }
    const nextStatus = task.prompt ? 'prompt_ready' : 'queued';
    dbUpdatePaintingBatchTask(task.id, {
      status: nextStatus,
      retryCount: 0,
      saveRetryCount: 0,
      errorMessage: '',
    });
    // 先返回确定结果，再异步恢复队列；避免响应状态被后续提示词/提交流水线覆盖。
    sendJson(res, 200, { ok: true, taskId: task.id, status: nextStatus });
    restorePaintingBatchRunForRetry(task.batchRunId);
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '重新提交任务失败' });
  }
}

async function handleSetPaintingFolderBinding(req, res) {
  try {
    const body = await readRequestBody(req);
    const { paintingName, uploadHistoryId, imageHash, folderId, folderName } = body;
    if (!imageHash) {
      sendJson(res, 400, { error: '缺少图片哈希 imageHash' });
      return;
    }
    let resolvedFolderId = Number(folderId) || null;
    let resolvedFolderName = readValue(folderName) || '通用素材';
    if (resolvedFolderId) {
      const nameById = dbGetVideoLibraryFolderNameById(resolvedFolderId);
      if (nameById) {
        resolvedFolderName = nameById;
      } else {
        resolvedFolderId = null;
      }
    }
    if (!resolvedFolderId) {
      const ensured = dbEnsureVideoLibraryFolder(resolvedFolderName);
      resolvedFolderId = ensured.id;
      resolvedFolderName = ensured.folderName;
    }
    dbUpsertPaintingFolderBinding({
      paintingName: String(paintingName || '').slice(0, 200),
      uploadHistoryId: Number(uploadHistoryId) || null,
      imageHash: String(imageHash),
      folderId: resolvedFolderId,
      folderName: resolvedFolderName,
    });
    sendJson(res, 200, { ok: true, folderId: resolvedFolderId, folderName: resolvedFolderName });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '保存挂画文件夹绑定失败' });
  }
}

async function handleGetPaintingFolderBinding(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const imageHash = decodeURIComponent(url.pathname.replace(/^\/api\/painting\/folder-binding\//, ''));
    const binding = dbGetPaintingFolderBinding(imageHash);
    if (!binding) {
      sendJson(res, 404, { ok: true, binding: null });
      return;
    }
    sendJson(res, 200, { ok: true, binding });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '读取挂画文件夹绑定失败' });
  }
}

async function handleGetPaintingUsedDirections(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const imageHash = String(url.searchParams.get('imageHash') || '');
    const variationRound = Math.max(0, Math.min(2, Number(url.searchParams.get('variationRound')) || 0));
    if (!imageHash) {
      sendJson(res, 400, { error: '缺少图片哈希 imageHash' });
      return;
    }
    sendJson(res, 200, { ok: true, usedDirections: dbGetPaintingUsedDirections(imageHash, variationRound) });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '读取已使用方向失败' });
  }
}

async function handleGetPaintingBatchRunEstimate(req, res) {
  try {
    const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
    const params = url.searchParams;
    const requestedModel = readValue(params.get('model')) || PAINTING_BATCH_MODEL;
    if (!PAINTING_BATCH_MODELS.has(requestedModel)) {
      sendJson(res, 400, { error: PAINTING_BATCH_MODEL_REJECT_MESSAGE });
      return;
    }
    const model = requestedModel;
    const resolution = String(readValue(params.get('resolution')) || '720p').toLowerCase();
    if (!isPaintingBatchResolutionSupported(model, resolution)) {
      sendJson(res, 400, { error: `${model === 'MiniMax-H3' ? 'MiniMax H3' : '所选模型'}仅支持${getPaintingBatchSupportedResolutions(model).map((item) => item.toUpperCase()).join('或')}。` });
      return;
    }
    const ratePerSecond = getSeedanceRatePerSecond(model, resolution);
    sendJson(res, 200, {
      ok: true,
      estimate: {
        model,
        resolution,
        ratePerSecond,
        currency: 'CNY',
        pricingNote: '费用按所选模型、分辨率与时长估算，实际以平台账单为准。',
      },
    });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '估算失败' });
  }
}

async function analyzePaintingCore(body, apiKey, requestId) {
  let imageUrl = '';
  if (body.file instanceof File && body.file.size > 0) {
    const compressedFile = await compressMediaForArk(body.file, 'image');
    const normalized = await normalizeUploadedMediaInput(compressedFile, 'image');
    imageUrl = normalized.imageUrl;
  } else if (readValue(body.image)) {
    imageUrl = normalizeBase64ImageInput(body.image, body.imageMimeType).imageUrl;
  } else {
    throw new Error('请先上传挂画图片。');
  }

  const prompt = `你是专业的挂画/卷轴产品分析专家。请仔细分析下面这张挂画/装饰画图片，输出一个「产品固定档案」JSON 对象。

要求输出以下字段（能用中文就用中文描述）：
- name：产品名称
- style：风格（如国画、油画、书法、装饰画等）
- subject：画面主体内容
- colors：主色调数组（如 ["墨黑","赭石","宣纸白"]）
- composition：构图方式
- material：材质（宣纸、绢布、油画布等）
- frameStructure：木条/挂轴/压杆等外框结构的形状、颜色、材质、粗细
- texture：纹理与笔触细节
- ratio：建议画面比例（如 9:16、16:9、1:1）
- atmosphere：整体氛围气质

严格只输出一个合法 JSON 对象，不要输出任何解释文字，不要用 markdown 代码块包裹。`;

  console.log('[doubao painting] analyze request start', { requestId, hasFile: body.file instanceof File, fileSize: body.file?.size || 0 });

  const answer = await callDoubaoArkText({
    apiKey,
    model: DEFAULT_DOUBAO_MULTIMODAL_MODEL,
    content: [
      { type: 'input_image', image_url: imageUrl },
      { type: 'input_text', text: prompt }
    ]
  });

  const profile = parseStructuredJson(answer);
  console.log('[doubao painting] analyze done', { requestId, profileKeys: profile && typeof profile === 'object' ? Object.keys(profile) : [] });
  return { profile };
}

async function runPaintingAnalyzeTask(task, body, apiKey) {
  try {
    task.result = await analyzePaintingCore(body, apiKey, task.id);
    task.status = 'done';
  } catch (error) {
    task.status = 'failed';
    task.error = error?.message || '挂画分析失败';
    task.debug = { stage: 'analyze', rawText: error?.rawText };
    console.error('[doubao painting] analyze failed', { requestId: task.id, message: error?.message || '' });
  }
  task.doneAt = Date.now();
}

async function handlePaintingAnalyze(req, res) {
  try {
    const apiKey = readValue(SERVER_CONFIG.arkApiKey);
    if (!apiKey) {
      sendJson(res, 500, { error: '服务端未配置 ARK_API_KEY' });
      return;
    }
    const body = isMultipartFormRequest(req)
      ? await readMultipartFormBody(req)
      : await readRequestBody(req);
    if (!(body.file instanceof File && body.file.size > 0) && !readValue(body.image)) {
      sendJson(res, 400, { error: '请先上传挂画图片。' });
      return;
    }
    const task = createPaintingTask('analyze');
    runPaintingAnalyzeTask(task, body, apiKey);
    sendJson(res, 202, { ok: true, taskId: task.id, status: task.status });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '挂画分析任务创建失败' });
  }
}

const PAINTING_STYLE_PROFILES = {
  'new-chinese': {
    label: '新中式雅致',
    direction: '实木家具、简洁东方线条、书房或茶席元素；人物可穿改良中式、盘扣或克制棉麻服饰，文化感雅致但不过度堆砌古典符号。',
    wardrobe: ['黛蓝', '酒红', '竹绿', '藕荷', '水红', '鹅黄', '墨绿', '灰紫', '宝蓝', '陶土红', '藏青', '橄榄绿', '浅紫', '黑色', '月白', '雾蓝', '焦糖', '莓果红', '松石绿', '暖棕'],
  },
  'modern-minimal': {
    label: '现代简约',
    direction: '简洁布艺家具、几何灯具、克制装饰和通透自然光；人物穿现代针织、衬衫、休闲西装或简洁连衣裙，禁止自动换成旗袍。',
    wardrobe: ['雾蓝', '宝蓝', '墨绿', '酒红', '鹅黄', '陶土橙', '灰紫', '黑色', '浅粉', '湖蓝', '橄榄绿', '焦糖', '水红', '藏青', '竹绿', '莓果红', '暖棕', '月白', '黛蓝', '浅紫'],
  },
  'modern-luxury': {
    label: '现代轻奢',
    direction: '石材、金属、皮质与艺术灯具组成高级样板间或酒店式空间；人物穿剪裁利落的西装、衬衫或质感连衣裙，精致但不浮夸。',
    wardrobe: ['酒红', '墨绿', '宝蓝', '黑色', '焦糖', '灰紫', '莓果红', '藏青', '水红', '孔雀蓝', '暖棕', '藕荷', '橄榄绿', '银灰', '陶土红', '黛蓝', '浅紫', '深咖', '竹绿', '月白'],
  },
  'cream-warm': {
    label: '奶油温馨',
    direction: '奶油色墙面、圆润布艺家具、柔软织物和家庭陈设；人物穿柔和针织、休闲衬衫或生活化连衣裙，明亮温暖但避免全画面发黄。',
    wardrobe: ['浅粉', '雾蓝', '鹅黄', '竹绿', '水红', '浅紫', '陶土橙', '湖蓝', '莓果红', '橄榄绿', '宝蓝', '藕荷', '焦糖', '墨绿', '酒红', '月白', '黛蓝', '暖棕', '灰紫', '松石绿'],
  },
  'natural-wood': {
    label: '原木自然',
    direction: '浅木家具、棉麻织物、自然绿植与柔和日光；人物穿现代棉麻、针织或宽松休闲装，松弛、有呼吸感并保留真实材质。',
    wardrobe: ['橄榄绿', '陶土橙', '雾蓝', '暖棕', '竹绿', '酒红', '鹅黄', '墨绿', '焦糖', '水红', '湖蓝', '藕荷', '藏青', '浅紫', '宝蓝', '莓果红', '月白', '黛蓝', '灰紫', '浅粉'],
  },
  'nordic-fresh': {
    label: '北欧清新',
    direction: '浅木、白墙、轻盈家具和明快点缀色；人物穿现代休闲夹克、针织、衬衫或简洁裙装，空间清爽但仍适合中年家庭。',
    wardrobe: ['湖蓝', '鹅黄', '陶土橙', '竹绿', '宝蓝', '浅粉', '莓果红', '雾蓝', '墨绿', '水红', '浅紫', '橄榄绿', '酒红', '焦糖', '松石绿', '藏青', '月白', '黛蓝', '灰紫', '暖棕'],
  },
  'vintage-home': {
    label: '复古雅居',
    direction: '深木、皮质、复古灯具与有年代感的陈设；人物穿复古衬衫、西装、针织或有克制纹样的裙装，形成沉稳故事感。',
    wardrobe: ['酒红', '墨绿', '焦糖', '深咖', '宝蓝', '灰紫', '藏青', '陶土红', '橄榄绿', '黑色', '莓果红', '黛蓝', '暖棕', '藕荷', '孔雀蓝', '水红', '竹绿', '浅紫', '月白', '雾蓝'],
  },
  'gallery-display': {
    label: '高端展陈',
    direction: '艺术展厅、精品酒店或高端样板间，使用克制射灯、留白和高级材质；人物穿纯色套装、衬衫或利落裙装，突出专业展陈感。',
    wardrobe: ['黑色', '宝蓝', '酒红', '墨绿', '银灰', '藏青', '莓果红', '焦糖', '孔雀蓝', '灰紫', '陶土红', '黛蓝', '暖棕', '水红', '橄榄绿', '月白', '浅紫', '竹绿', '雾蓝', '深咖'],
  },
  'everyday-life': {
    label: '烟火生活',
    direction: '真实普通住宅、自然日常用品与生活动作；人物穿针织衫、家居休闲装、普通衬衫或日常裙装，避免样板间和摆拍感。',
    wardrobe: ['雾蓝', '酒红', '竹绿', '宝蓝', '鹅黄', '浅粉', '墨绿', '陶土橙', '水红', '藏青', '浅紫', '橄榄绿', '焦糖', '莓果红', '湖蓝', '黛蓝', '暖棕', '灰紫', '月白', '松石绿'],
  },
};

function resolvePaintingStyleProfile(value) {
  return PAINTING_STYLE_PROFILES[readValue(value)] || PAINTING_STYLE_PROFILES['modern-minimal'];
}

const PAINTING_REAL_SIZE_RULE = '【第一道锁·40×80厘米真实尺寸】这是宽40厘米、高80厘米、宽高比1:2的小型竖幅挂画，不是大型卷轴。优先按可见关系执行：挂画宽度约等于普通成年女性肩宽，不得明显宽于肩膀；画高严格约为完整站立成年人身高的一半。挂在标准房门旁时，画高约为门高的40%，画宽约为门宽的一半；挂在1.8-2.0米三人沙发上方时，画宽约为沙发宽度的五分之一。人物、房门或沙发必须与挂画处于相近景深，禁止用远近错位伪造比例。输出视频9:16只是视频画布，绝不是挂画外形；空间镜头使用45-55mm等效标准透视，禁止超广角、近大远小和先做巨幅画再缩小。';
// Seedance 对“已经上墙”的静态空间场景存在稳定放大偏差。
// 商品档案和安装/手持方向仍保持真实 40×80cm；仅在这类高风险 Seedance 提示词中使用 20×40cm 反向补偿。
const PAINTING_STATIC_WALL_COMPENSATED_SIZE_RULE = '【最高优先级·静态上墙尺寸补偿】本条生成只执行20×40厘米（宽20厘米、高40厘米）、宽高比1:2的小型竖幅挂画补偿尺寸，不得自行恢复为常规或大型卷轴。必须先建立正常尺寸的成年人、三人沙发和房间，再将挂画作为明显较小的墙面点缀放入。与完整站立成年人同景深时，画高只占人物完整身高的22%-25%，完整人物约等于4-4.5幅挂画的高度；画宽只占成年人肩宽的45%-50%，明显窄于双肩。与1.8-2.0米三人沙发同景深时，画宽只约占沙发总宽的十分之一，不超过一个沙发坐垫宽度的三分之一。如果其他要求与小尺寸冲突，必须优先继续缩小挂画，不得缩小人物、沙发、房门或房间。输出视频9:16只是视频画布，绝不是挂画外形；空间镜头使用45-55mm等效标准透视，禁止超广角、仰拍、近大远小和先做大画再拉远。';
const PAINTING_WALL_WHITESPACE_RULE = '【第二道锁·墙面安装与上下留白】挂画上墙后属于墙面上的小型点缀。挂钩到天花板之间必须保留至少约1.2个挂画宽度的清楚空墙；上方木条到天花板的距离接近1幅挂画高度；挂画下边缘到地面的距离至少约1.2幅挂画高度。上下左右都要有大块连续空墙，挂钩不得贴近天花板、吊顶、横梁或画面顶边，挂画不得贴地、贴墙角、贴门框或贴柜体。若挂在三人沙发上方，画宽仍只约占沙发五分之一，不得为了突出文字而放大产品。';
const PAINTING_STATIC_WALL_COMPENSATED_WHITESPACE_RULE = '【静态上墙补偿·安装留白】挂画是墙面上的小型点缀。挂钩上方保留大块连续空墙，挂钩不得贴近天花板、吊顶、横梁或画面顶边；挂画下方保留大块墙面和地面关系，不得贴地、贴墙角、贴门框或贴柜体。若与三人沙发同框，画宽只约占沙发总宽的十分之一；若与完整站立成年人同框，画高只约占其完整身高的22%-25%。无法同时容纳家具和留白时，减少家具或让摄影机后退，不得上移、放大挂画。';
const PAINTING_SCALE_ESTABLISHING_RULE = '【第三道锁·镜头尺寸交代】除原画内容特写和实木压条特写外，凡出现上墙成品，必须先用一次真正的远景/全景建立尺寸，再允许靠近。尺寸交代镜头同时拍到完整挂画、挂钩上方大块空墙和挂画下方空间，并至少带到以下一种相近景深参照：从头到脚完整站立成人、完整标准房门、完整三人沙发，或天花板与地面边界。禁止把中景/近景称为全景，禁止人物被桌子或画面边缘截断，禁止一边要求看清纹理一边用同一镜头证明全屋比例。后续近景只表示摄影机靠近，挂画尺寸、挂点、墙面坐标和透视边界全程不变。';
const PAINTING_INSTALLATION_SCALE_RULE = '【安装方向专用人物标尺】本条是人物现场安装流程，不执行“挂画从第0秒已经上墙”。安装前先用真正的全景同时拍到人物从头到脚、完整挂画和地面，人物与挂画处于相近景深；人物把挂画竖直拿在身体正前方时，40厘米画宽约等于其肩宽，80厘米画高约等于其完整身高一半，视觉上大致从胸口延伸到大腿中段，不得到膝盖以下。人物按这个已经校准的小尺寸完成悬挂，挂好后产品不得突然变大；此时再执行墙面上下留白锁。安装尺寸交代镜头只负责证明比例，不要求同时看清文字、书法笔触或绢丝纹理，细节由之后的近景或专门特写方向完成。';
const PAINTING_CONTENT_DETAIL_SIZE_RULE = '本产品真实成品尺寸仍固定为宽40厘米、高80厘米、宽高比1:2，挂画外观与二维画面比例不得改变。本方向允许镜头为查看原画内容而近距离合理裁切挂画边缘，不要求人物、家具或空间全景，也不得因为特写把产品重新设计成巨幅画、整墙画或三维场景；镜头移动过程中画布平面、文字、笔触、印章和图案之间的相对位置与比例必须始终不变。';
const PAINTING_SIZE_LOCK_MARKER = '【挂画真实尺寸强制锁定】';
const PAINTING_OBJECT_PERMANENCE_MARKER = '【挂画全程存在与空间连续性强制锁定】';
const PAINTING_ROLLING_UNFOLD_MARKER = '【卷起挂画滚动展开与下方木条强制锁定】';
const PAINTING_REALISM_MARKER = '【真人实拍质感最高优先级】';
const PAINTING_DYNAMIC_ENDING_MARKER = '【动态收尾强制规则】';
const PAINTING_PRODUCT_FOCUSED_ENDING_MARKER = '【最高优先级·移动镜头最终落在挂画】';
const PAINTING_CHARACTER_IDENTITY_MARKER = '【人物身份分离与防复制强制锁定】';
const PAINTING_CHARACTER_IDENTITY_RULE = '人物数量和每个人的身份必须从第0秒起固定。如果创意设定为单人，全片只允许这一个人物，严禁复制、分身、镜像复制、画面中同时出现第二个长相或穿着相同的人。如果创意明确设定为多人，每个人必须是独立且可明确区分的真实个体：不同人物的脸型与五官、发型、体型特征、服装款式和服装主色必须明显不同，除非创意明确要求双胞胎，否则严禁生成双胞胎、同脸人、克隆人物或同款服装。若两名人物年龄、性别相仿，更必须通过不同脸型、不同发型和不同服装主色一眼区分。“人物保持一致”只表示每个人各自在前后镜头中保持自己的脸、发型、年龄、服装和身份不变，绝不表示不同人物彼此长得一样或穿得一样。全程禁止人物凭空增减、相互换脸、交换服装、身份互换或合并分裂。';
const WAN3_CAMERA_MOTION_MARKER = '【千问 Wan3.0 专用·运镜速度强制锁定】';
const WAN3_LEGACY_PAINTING_STRUCTURE_MARKER = '【千问 Wan3.0 专用·挂画结构连续性与禁止二次展开】';
const WAN3_STATIC_PAINTING_STRUCTURE_MARKER = '【千问 Wan3.0 专用·静态挂画逐帧拓扑锁定】';
const WAN3_UNFOLDING_STRUCTURE_MARKER = '【千问 Wan3.0 专用·唯一一次人工打开流程】';
const WAN3_STATIC_PAINTING_STRUCTURE_RULE = '本片中的挂画从首帧起就是完整平展、安装完成的最终成品，把它视为固定在墙上的刚性静态平面。上方木条、画芯、下方木条和挂绳组成一个不可拆分的整体，它们在墙面上的坐标、长度、数量和相对距离从首帧到末帧逐帧保持常数。每一帧始终恰好只有参考图中的上、下两根木条，画芯中间始终没有横杆、滚轴、白色扫描条或其他横向构件；画芯的顶部、主体和底部始终同时属于同一张连续平面。人物活动、镜头推近、拉远、横移、扫拍和内容特写只能改变取景范围，挂画本体保持完全静止，不能发生部件复制、位移、遮盖、压缩、拉伸、分层、消失、重组或画芯局部先后显现。最后一帧的产品结构必须与首帧完全相同。';
const WAN3_UNFOLDING_STRUCTURE_RULE = '本条创意只允许在时间轴指定阶段，由人物双手控制卷起的挂画完成唯一1次真实滚动打开。人物完成打开并挂好以后，挂画立即成为固定在墙上的刚性静态平面，后续不再发生任何打开、卷起、复位或结构变化。全片任何时刻都只能存在参考图中的上、下两根木条，不能生成第三根木条、复制木条、白色横杆或扫描条；镜头运动不能触发挂画本体移动或重演打开动作。';
const PAINTING_CONTENT_DETAIL_DIRECTION = 29;
const PAINTING_WOOD_DETAIL_DIRECTION = 30;
const PAINTING_CAMERA_EXPLANATION_DIRECTION = 7;
const PAINTING_LEFT_TO_RIGHT_SCAN_DIRECTION = 26;
const PAINTING_RIGHT_TO_LEFT_SCAN_DIRECTION = 27;
const PAINTING_ROLLING_UNFOLD_DIRECTIONS = new Set([1, 8]);
const PAINTING_ROLLING_UNFOLD_FIXED_INSTRUCTION = '挂画在打开的时候是滚动打开的，不是滑动打开的，打开的过程中不要改变挂画下方木条的颜色和外观，也不要在木条的边缘增加新的物体。';
const PAINTING_STATIC_WALL_COMPENSATION_DIRECTIONS = new Set([
  3, 6, PAINTING_CAMERA_EXPLANATION_DIRECTION, 10,
  ...Array.from({ length: 18 }, (_, index) => index + 11),
  ...Array.from({ length: 10 }, (_, index) => index + 31),
]);

function shouldUsePaintingStaticWallSizeCompensation(idea = {}) {
  const directionNumber = Number(idea?.directionNumber) || 0;
  if (directionNumber > 0) {
    return PAINTING_STATIC_WALL_COMPENSATION_DIRECTIONS.has(directionNumber);
  }
  const text = `${readValue(idea?.title)}\n${readValue(idea?.summary)}`;
  if (isPaintingInstallationSequence(text)) return false;
  if (/画面内容.{0,8}特写|实木压条.{0,8}特写|木条端部/.test(text)) return false;
  return /(?:开场|第0秒|全程|已经|完成|稳固|固定).{0,16}(?:上墙|挂在.{0,8}墙|位于.{0,8}墙|墙面)|(?:沙发|电视|玄关|书房|茶室|卧室|餐厅|走廊|会客区|展陈).{0,12}(?:背景墙|主墙|侧墙|墙面挂画)/.test(text);
}

function ensurePaintingRollingUnfoldInstruction(promptText, directionNumber) {
  const normalized = String(promptText || '').trim();
  if (!PAINTING_ROLLING_UNFOLD_DIRECTIONS.has(Number(directionNumber))) return normalized;
  if (normalized.includes(PAINTING_ROLLING_UNFOLD_FIXED_INSTRUCTION)) return normalized;
  return `【卷轴打开方式固定要求】\n${PAINTING_ROLLING_UNFOLD_FIXED_INSTRUCTION}\n\n${normalized}`;
}

function ensurePaintingProductFocusedEnding(promptText) {
  const normalized = String(promptText || '').trim();
  if (normalized.includes(PAINTING_PRODUCT_FOCUSED_ENDING_MARKER)) return normalized;
  return `${normalized}\n\n${PAINTING_PRODUCT_FOCUSED_ENDING_MARKER}\n${PAINTING_PRODUCT_FOCUSED_ENDING_RULE}`;
}

function ensureWan3CameraMotionLock(promptText) {
  let normalized = String(promptText || '').trim();
  if (normalized.includes(WAN3_CAMERA_MOTION_MARKER)) return normalized;

  // Wan 对“快速揭示”和“禁止绝对匀速”这类语义容易执行成速度变化。
  // 只在提交给 Wan3.0 前消除这些冲突，不影响 Seedance 和 MiniMax H3。
  normalized = normalized
    .replace(/(?:禁止|严禁|无)数学式绝对匀速(?:的)?(?:虚拟)?滑轨(?:感|运动)?/g, '禁止忽快忽慢、速度跳变和机械化运镜')
    .replace(/(?:禁止|严禁|无)机械(?:式)?绝对匀速(?:的)?滑轨(?:感|运动)?/g, '禁止忽快忽慢、速度跳变和机化运镜')
    .replace(/从左向右快速揭示/g, '从左向右低速平稳揭示')
    .replace(/从右向左快速揭示/g, '从右向左低速平稳揭示')
    .replace(/快速揭示/g, '低速平稳揭示')
    .replace(/迅速完整可见/g, '在保持低速的前提下完整可见')
    .replace(/镜头稳定但不能缓慢拖延/g, '镜头保持稳定低速，内容过多时删减动作而不加速');

  return `${normalized}\n\n${WAN3_CAMERA_MOTION_MARKER}\n${WAN3_CAMERA_MOTION_RULE}`;
}

function removeMarkedPromptSection(promptText, marker) {
  let normalized = String(promptText || '').trim();
  let markerIndex = normalized.indexOf(marker);
  while (markerIndex >= 0) {
    const nextSectionIndex = normalized.indexOf('\n\n【', markerIndex + marker.length);
    normalized = nextSectionIndex >= 0
      ? `${normalized.slice(0, markerIndex)}${normalized.slice(nextSectionIndex + 2)}`
      : normalized.slice(0, markerIndex);
    normalized = normalized.trim();
    markerIndex = normalized.indexOf(marker);
  }
  return normalized;
}

function ensureWan3PaintingStructureLock(promptText, directionNumber = 0) {
  let normalized = String(promptText || '').trim();
  const isPaintingTask = Number(directionNumber) > 0
    || /挂画|挂轴|卷轴|压条|下压杆|画布|书法画/.test(normalized);
  if (!isPaintingTask) return normalized;

  const explicitlyAllowsOpening = PAINTING_ROLLING_UNFOLD_DIRECTIONS.has(Number(directionNumber))
    || normalized.includes('【卷轴打开方式固定要求】');
  normalized = removeMarkedPromptSection(normalized, WAN3_LEGACY_PAINTING_STRUCTURE_MARKER);
  normalized = removeMarkedPromptSection(normalized, WAN3_STATIC_PAINTING_STRUCTURE_MARKER);
  normalized = removeMarkedPromptSection(normalized, WAN3_UNFOLDING_STRUCTURE_MARKER);

  if (explicitlyAllowsOpening) {
    return `${normalized}\n\n${WAN3_UNFOLDING_STRUCTURE_MARKER}\n${WAN3_UNFOLDING_STRUCTURE_RULE}`;
  }

  // Wan 会把条件句中的“卷起/滚动打开”误当成需要执行的动作。
  // 静态方向在真正提交给 Wan 前删掉整段条件式打开说明，只保留正向静态拓扑描述。
  normalized = removeMarkedPromptSection(normalized, PAINTING_ROLLING_UNFOLD_MARKER);
  return `${normalized}\n\n${WAN3_STATIC_PAINTING_STRUCTURE_MARKER}\n${WAN3_STATIC_PAINTING_STRUCTURE_RULE}`;
}
const PAINTING_CONTENT_DETAIL_VARIANTS = [
  '茶几平放·正上方左到右：挂画完整平坦放在尺寸足够的茶几表面，上下木条与画布保持原样；摄影机接近垂直俯拍，从画面左侧向右侧连续扫过，禁止默认从右侧斜拍',
  '墙面悬挂·近乎正面上到下：挂画完整稳固地挂在墙上，镜头位于近乎正面的轻微左侧机位，从画面上端向下端连续扫过，禁止明显右侧斜视',
  '书桌平放·正上方下到上：挂画完整平坦放在宽阔书桌上，木条不得拆除或变形；摄影机垂直俯拍，从画面下端向上端连续扫过',
  '房门悬挂·正面右到左：挂画通过真实挂点完整固定在平整房门上，机位接近正面，从画面右侧向左侧连续扫过，不得把门上挂画变成门的印花或壁画',
  '长桌平放·左上到右下：挂画完整平坦放在尺寸足够的长桌或展示桌上，摄影机从正上方略带自然倾角，沿画面左上至右下的主视觉路径连续移动',
  '书架平整外侧板悬挂·左到右：仅在尺寸足够、可真实承重的书架平整外侧竖板上完整悬挂，不得卡在层板中、悬空或遮住木条；镜头从左到右连续扫过原画内容',
  '矮柜宽阔台面平放·右到左：挂画完整平坦放在深度和长度都足够的矮柜宽阔台面，摄影机以正上方俯拍为主，从画面右侧向左侧连续扫过',
  '墙面悬挂·正面沿书法或山水路径：挂画完整固定在墙面，摄影机保持近乎正面，不从左右侧边斜拍；只沿参考图中真实存在的书法笔势或山水构图路径连续移动',
];

function getPaintingContentDetailVariant(variationIndex = 0) {
  const index = Math.max(0, Math.floor(Number(variationIndex) || 0));
  return PAINTING_CONTENT_DETAIL_VARIANTS[index % PAINTING_CONTENT_DETAIL_VARIANTS.length];
}

const PAINTING_CONTENT_DETAIL_VARIANT_MARKER = '【本次原画内容特写指定组合】';

function isPaintingInstallationSequence(...parts) {
  const text = parts.map((part) => String(part || '')).join('\n');
  const hasInstallationAction = /(?:现场)?安装|卷起展示到安装|展示转身上墙|对准挂点|悬挂高度|挂到墙|挂上墙|挂好|悬挂后.{0,8}扶正|扶正挂轴/.test(text);
  if (!hasInstallationAction) return false;
  const onlyDescribesAlreadyMounted = /(?:第0秒|开场|全程|已经).{0,12}(?:上墙|挂在墙|固定在墙)/.test(text)
    && !/(?:现场)?安装|对准挂点|挂到墙|挂上墙|挂好|展示转身上墙|卷起展示到安装/.test(text);
  return !onlyDescribesAlreadyMounted;
}

function ensurePaintingContentDetailVariant(promptText, variationIndex = 0) {
  const normalized = String(promptText || '').trim();
  const rule = getPaintingContentDetailVariant(variationIndex);
  if (normalized.startsWith(PAINTING_CONTENT_DETAIL_VARIANT_MARKER)) return normalized;
  return `${PAINTING_CONTENT_DETAIL_VARIANT_MARKER}\n${rule}\n本条4-6秒视频只执行上述一个摆放场景、一个主机位和一条连续移动路径。如下方其他文字与本指定组合冲突，以本段为准；不得改成右侧斜拍或其他摆放方式。\n\n${normalized}`;
}

function normalizePaintingPromptForStaticWallCompensation(promptText) {
  return String(promptText || '')
    .replace(/(?:宽\s*)?(?:40\s*(?:厘米|cm)?\s*[,，、/\-]\s*(?:高\s*)?80|25\s*(?:厘米|cm)?\s*[,，、/\-]\s*(?:高\s*)?50|15\s*(?:厘米|cm)?\s*[,，、/\-]\s*(?:高\s*)?30)\s*(?:厘米|cm)?/gi, '宽20厘米、高40厘米')
    .replace(/(?:40\s*[×xX*]\s*80|25\s*[×xX*]\s*50|15\s*[×xX*]\s*30)\s*(?:厘米|cm)?/g, '20×40厘米')
    .replace(/宽\s*(?:40\s*(?:厘米|cm).{0,8}高\s*80|25\s*(?:厘米|cm).{0,8}高\s*50|15\s*(?:厘米|cm).{0,8}高\s*30)\s*(?:厘米|cm)/gis, '宽20厘米、高40厘米')
    .replace(/((?:画高|挂画高度).{0,30})(?:45\s*%\s*(?:-|–|—|~|～|至|到)\s*50\s*%|28\s*%\s*(?:-|–|—|~|～|至|到)\s*30\s*%|17\s*%\s*(?:-|–|—|~|～|至|到)\s*18\s*%)/g, (_match, prefix) => `${prefix}22%-25%`)
    .replace(/((?:画宽|挂画宽度).{0,30})(?:18\s*%\s*(?:-|–|—|~|～|至|到)\s*22\s*%|20\s*%|12\s*%\s*(?:-|–|—|~|～|至|到)\s*14\s*%|55\s*%\s*(?:-|–|—|~|～|至|到)\s*60\s*%|30\s*%\s*(?:-|–|—|~|～|至|到)\s*35\s*%)/g, (_match, prefix) => `${prefix}45%-50%`)
    .replace(/沙发宽度的(?:五分之一|八分之一|十二分之一)|沙发总宽的(?:五分之一|八分之一|十二分之一)|约占沙发(?:五分之一|八分之一|十二分之一)/g, '沙发总宽的十分之一')
    .replace(/画宽.{0,10}(?:约等于|接近|与).{0,8}(?:成年人|女性|男性|人物)?肩宽/g, '画宽只占成年人肩宽的45%-50%')
    .replace(/画高.{0,16}(?:完整站立)?(?:成年人|人物)身高的一半/g, '画高只占完整站立成年人身高的22%-25%');
}
const PAINTING_OBJECT_PERMANENCE_RULE = '若创意设定挂画已经上墙，挂画必须从第 0 秒起就真实、完整、稳固地存在于同一墙面坐标，并在全片保持相同尺寸、透视、挂点、墙面接触阴影和遮挡关系。开场可以暂时看不到挂画，但其所在墙面位置必须完全处于取景框之外，或被门框、屏风、人物、家具、绿植等真实不透明前景遮挡；后续只能依靠镜头移动或遮挡物自然移开而被拍到。只要前面镜头已经拍到挂画所在的完整墙面，该挂画就必须已经可见。严禁挂画淡入、浮现、透明变实、凭空生成、突然出现、逐渐长出、尺寸由小变大或中途贴到墙上；“揭示、进入画面、逐渐完整看到”只能表示摄影机改变取景后拍到一个从第 0 秒起就客观存在的挂画，绝不表示挂画本身出现。';
const PAINTING_ROLLING_UNFOLD_RULE = '如果挂画开场处于卷起状态，从卷起到完全展开的全过程中，下方木条/下压杆必须始终存在并严格保持参考图中的原始形状、颜色、材质、长度、粗细、截面和两端轮廓，不得消失、变形、变色、伸长、缩短或变成圆柱形/圆杆。下方木条两端及周围不得新增任何物体、零件或装饰，包括但不限于圆柱、轴头、端帽、圆球、把手、系带或金属件。展开必须由人的双手合理控制，画布只能随着卷筒绕自身轴线旋转而逐圈滚动释放，严禁滑动、平移、平铺、抽拉、弹开或在无人操作时自行展开。';
const PAINTING_LIVE_ACTION_REALISM_RULE = '整体必须呈现普通真实住宅中的真人实地拍摄质感，而不是三维渲染、AI样板间或过度精修的商业广告。空间允许轻微生活痕迹和自然不对称，沙发织物、窗帘、衣服与皮肤保留真实纹理、褶皱和细微瑕疵；自然光应有合理方向、层次、柔和阴影和轻微明暗差异，禁止全屋无阴影的均匀棚拍光、塑料材质、蜡像皮肤和过度磨皮。镜头保持稳定清楚，但运动应有真人摄影的自然起步、轻微惯性、减速和小幅构图修正，禁止数学式绝对匀速滑轨、虚拟摄像机漂移和明显手持抖动。人物按现实正常速度完成动作，动作之间允许自然衔接，每 1-2 秒持续产生新的有效动作或构图信息即可，禁止慢放、发呆、重复和为赶时间而机械连做过多动作。';
const PAINTING_DYNAMIC_ENDING_RULE = '结尾不得为了“产品定妆”机械追加一个正对墙面挂画、固定机位、无人无动作的独立静态镜头。前面的主镜头已经完整展示产品时，直接在该镜头的连续动作或运镜中自然结束，不再补切正面挂画。若创意确实需要以挂画收束，最后阶段仍须保留至少一种清晰可见的连续变化：镜头轻微横移/推近/拉远、前景视差、人物尚未完成的自然动作、窗帘或植物的合理微动、或有方向的自然光影变化；镜头可以自然减速，但不得完全定住超过约 0.5 秒，不得让最后 1-2 秒看起来像一张静态图片。挂画自身若已上墙仍必须保持固定，动态只能来自摄影机、人物、前景或真实环境。';
const PAINTING_PRODUCT_FOCUSED_ENDING_RULE = '凡镜头存在横移、侧移、摇移、升降、推近、拉远、环绕、跟拍或从任意方向扫过场景，视频结束时镜头的最终视觉焦点必须落在挂画上：完整挂画或本条指定的挂画细节必须清晰可见，并位于画面主体区域，不能处在边缘、被人物家具遮挡、离开取景框，也不能让镜头越过挂画后继续扫向空墙、家具、人物或其他景物。镜头路径一旦到达挂画主体就必须及时减速并围绕挂画完成最后构图；如果原路径或内容过长，优先删短前段环境铺垫、缩短移动距离，必要时采用允许时长的下限，绝不能以越过挂画作为结尾。这里的“落在挂画”是锁定最终视觉中心，不等于静态定帧：最后仍保留极轻微的摄影机惯性、前景视差、人物自然微动作或光影变化，但焦点和主体始终是挂画。原画内容或木条移动特写则必须在挂画画面或木条范围内结束，镜头不得扫出产品边界。';
const WAN3_CAMERA_MOTION_RULE = '本视频所有摄影机运动必须采用稳定、克制、低速的真人云台或滑轨运镜。每个连续镜头只允许一种主要运动方向，不得在推近、拉远、左移、右移、上升和下降之间突然切换。速度曲线固定为：前0.5秒轻柔进入，中段保持近似恒定的低速，最后0.8-1秒平缓减速，全程速度连续且无跳变。严禁速度渐变特效、急加速、快速推近、快速后拉、快速横扫、甩镜、冲镜、突然变焦、速度跳变、先慢后快、中途突然加速以及结尾冲刺。如果原定动作或路径无法在时长内按低速完成，必须删减前段铺垫、减少人物动作或缩短镜头移动距离，绝不得通过加速赶进度。镜头到达挂画后必须平缓减速，视频结束时最终视觉焦点保持在挂画上，不得越过挂画后再加速移向其他景物。';

function ensurePaintingSizeLock(promptText, options = {}) {
  const useStaticWallCompensation = Boolean(options.staticWallSizeCompensation) && !options.contentDetailScan && !options.installationSequence;
  let normalized = useStaticWallCompensation
    ? normalizePaintingPromptForStaticWallCompensation(promptText).trim()
    : String(promptText || '').trim();
  const sizeLockMarker = useStaticWallCompensation ? '【挂画生成尺寸补偿锁定】' : PAINTING_SIZE_LOCK_MARKER;
  if (!normalized.startsWith(sizeLockMarker)) {
    const sizeRule = options.contentDetailScan
      ? PAINTING_CONTENT_DETAIL_SIZE_RULE
      : useStaticWallCompensation
        ? PAINTING_STATIC_WALL_COMPENSATED_SIZE_RULE
        : PAINTING_REAL_SIZE_RULE;
    const wallScaleRules = options.contentDetailScan
      ? ''
      : `\n\n${useStaticWallCompensation ? PAINTING_STATIC_WALL_COMPENSATED_WHITESPACE_RULE : PAINTING_WALL_WHITESPACE_RULE}\n\n${PAINTING_SCALE_ESTABLISHING_RULE}${options.installationSequence ? `\n\n${PAINTING_INSTALLATION_SCALE_RULE}` : ''}`;
    // 确定性放在最终提示词最前面，避免长提示词中后置尺寸规则被弱化。
    const negativeSizeRule = useStaticWallCompensation
      ? '负面限制：常规或大型卷轴、超大挂画、巨幅壁画、画高超过完整成人身高的四分之一、画宽超过成年人肩宽的一半、画宽超过三人沙发总宽的十分之一、通过缩小人物或家具突出挂画、透视夸大和超广角畸变。'
      : '负面限制：60×120厘米或更大的大型卷轴、超大挂画、巨幅壁画、画宽明显超过女性肩宽、画高明显超过完整成人身高一半、挂钩距天花板不足一个画宽、挂画下方距地面不足一幅画高、人物被截断却用作比例参照、透视夸大和超广角畸变。';
    normalized = `${sizeLockMarker}\n${sizeRule}${wallScaleRules}\n${negativeSizeRule}\n\n${normalized}`;
  }
  if (!options.installationSequence && !normalized.includes(PAINTING_OBJECT_PERMANENCE_MARKER)) {
    normalized += `\n\n${PAINTING_OBJECT_PERMANENCE_MARKER}\n${PAINTING_OBJECT_PERMANENCE_RULE}`;
  }
  if (!normalized.includes(PAINTING_CHARACTER_IDENTITY_MARKER)) {
    normalized += `\n\n${PAINTING_CHARACTER_IDENTITY_MARKER}\n${PAINTING_CHARACTER_IDENTITY_RULE}`;
  }
  if (!normalized.includes(PAINTING_ROLLING_UNFOLD_MARKER)) {
    normalized += `\n\n${PAINTING_ROLLING_UNFOLD_MARKER}\n${PAINTING_ROLLING_UNFOLD_RULE}`;
  }
  if (!normalized.includes(PAINTING_REALISM_MARKER)) {
    normalized += `\n\n${PAINTING_REALISM_MARKER}\n${PAINTING_LIVE_ACTION_REALISM_RULE}`;
  }
  if (!normalized.includes(PAINTING_DYNAMIC_ENDING_MARKER)) {
    normalized += `\n\n${PAINTING_DYNAMIC_ENDING_MARKER}\n${PAINTING_DYNAMIC_ENDING_RULE}`;
  }
  return ensurePaintingProductFocusedEnding(normalized);
}

// 4 批只负责分页；底层是一轮 40 个互不重复的创意方向。
// 组成：7 个样片原型 + 7 个合理衍生 + 10 个成品上墙空间方向 + 16 个其他方向。
const PAINTING_FRAMEWORKS = [
  // 第 1 批：样片原型 1-7 + 衍生 1-3
  [
    '样片原型01·卷起展示到安装：人物双手展示真实卷起状态，沿挂画自身轴线控制画布滚动释放至完整展开，确认上下木条后切换到墙边悬挂、扶正；开场中景、展开近景、安装侧面中景、完成后空间全景',
    '样片原型02·正面展示转身上墙：人物正面完整展示挂画，保持画面朝外转身走向墙面，对准挂点悬挂、双手扶正并后退检查；镜头从正面中景跟随到侧面，再拉远交代空间',
    '样片原型03·成品墙走近欣赏：挂画开场已经完整稳固上墙并始终静止，人物从家具旁走近，只触碰画布边缘或上下木条，观察细节后退回空间；镜头从全景跟拍到边缘近景再回到中景',
    '样片原型04·茶室安装完成：人物在茶室对准挂点挂好画、扶正下压杆，绕过茶桌后退端详并落座；镜头从茶具前景横移到安装中景，最后拉远展示茶席与挂画',
    '样片原型05·亲子协作家庭观看：成人负责对准挂点，孩子只扶稳挂画底部；挂好后两人检查端正，再与家人共同观看，其他人不参与大幅动作；成人、孩子及其他家人必须分别是可明确区分的不同人物，脸型、发型和服装款式不得相同，禁止复制同一人；镜头从协作中景转到家庭全景',
    '样片原型06·文化生活蒙太奇：用清晰硬切依次展示成品挂画、人物书写、茶席落座和画面笔触，每段都有独立动作；最后在人物完成落座、镜头仍沿茶席轻微横移时自然带到完整挂画，不追加静态定妆镜头，不得用慢放或重复镜头凑时长',
    '样片原型07·成品墙面对镜头讲解：挂画从第0秒起已经完整稳固地挂在墙面固定位置；每轮根据整体风格和近期历史，在客厅、书房、茶室、玄关、餐厅、办公室会客区或其他适合挂画的真实场景中选择不同墙面。人物站在挂画前方略偏一侧，确保身体不遮挡挂画主体，面对镜头持续自然讲解5-6秒，口型连续、语速正常，并配合克制的手势偶尔指向画面、材质或上下木条；是否生成可听语音完全服从当前声音开关，本方向不得强制开启声音。采用一个连续的空间中远景到人物中景，开场先交代人物、完整挂画和场景比例，随后只做轻微横移或极小幅推近，在人物仍在讲解和做自然手势时结束，不切静态产品定妆镜头',
    '合理衍生01·侧面结构展开：侧面近景拍双手分别控制上木条与下压杆，真实滚动释放画布；转为正面全景确认完整外观，再切到墙边完成悬挂，重点展示结构而不是重复正面摆拍',
    '合理衍生02·墙前比高定位：人物先在墙前举起挂画比较高度，放低后调整站位与挂绳，再次抬起对准挂点、悬挂、扶正、后退检查；镜头以空间全景开场并跟随动作推进',
    '合理衍生03·成品墙生活阅读：挂画全程固定上墙，人物从前景经过并在沙发或桌边坐下阅读，翻页、放杯、自然抬头看画；镜头从生活全景转向挂画并在持续轻微推近中结束，不定格、不追加静态尾镜头',
  ],
  // 第 2 批：衍生 4-7 + 成品上墙空间 1-6
  [
    '合理衍生04·成品茶室日常：挂画开场已经固定上墙，人物整理茶具、注水、落座并自然看向墙面；镜头从画拉远到茶席全景，再沿桌面前景回到挂画',
    '合理衍生05·长辈讲画：挂画已经上墙，长辈站在画旁向孩子讲解文字或画面寓意，孩子抬头聆听并作出自然回应；其他家人只在远处旁听；长辈、孩子及其他家人必须分别保持独立身份，具有明显不同的脸型、发型和服装，禁止同脸复制；镜头从家庭全景推到指向细节',
    '合理衍生06·书桌连续走向挂画：镜头从毛笔、书本和桌面开始，人物完成一笔、放下毛笔、起身绕过书桌走向成品挂画，驻足观察；全程连续跟拍，不用多场景硬切',
    '合理衍生07·轻奢空间导览：挂画已置于轻奢空间，人物从侧面依次指出木条、材质与画面细节，后退并走到一侧让出完整空间；镜头由近及远完成产品与装修的整体展示',
    '成品空间01·客厅沙发墙：挂画全程固定在沙发背景墙，人物从茶几前景经过并坐下；镜头沿茶几横向滑动形成视差，依次展示沙发、人物、落地灯与挂画，最后推近产品',
    '成品空间02·电视侧墙：挂画稳固位于电视侧墙，人物进入客厅整理遥控器和绿植后离开画面；镜头从电视柜低机位持续侧移，在电视区与挂画完整纳入构图后仍保持轻微视差直至结束',
    '成品空间03·玄关端景：挂画作为玄关第一视觉焦点，人物开门进入、放下钥匙、经过玄关柜后短暂停留；镜头从门框后跟随进入，再越过花瓶前景推向挂画',
    '成品空间04·书房背景：挂画固定在书桌背景墙，人物翻书、做笔记、放下笔并自然抬头；镜头从桌面文具近景拉远到书房全景，再在持续转向挂画细节的运动中结束，不停成静态特写',
    '成品空间05·茶室主墙：挂画固定在茶席主墙，人物温杯、注茶、落座，动作按正常速度完成；镜头从茶杯前景轻微升起，展示茶桌、座椅、绿植和墙上挂画',
    '成品空间06·卧室侧墙：挂画固定在床侧或床尾墙面，人物拉开窗帘、整理床头书和坐垫；自然光进入后镜头沿床边持续横移，在挂画与卧室整体搭配进入构图时自然结束，不停成正面静态画面',
  ],
  // 第 3 批：成品上墙空间 7-10 + 其他方向 1-6
  [
    '成品空间07·餐厅侧墙：挂画固定在餐厅侧墙，人物摆放餐具、调整花瓶并退开一步；镜头从餐桌前景横移，展示餐椅、吊灯、花瓶与挂画的色彩呼应',
    '成品空间08·走廊尽头：挂画固定在走廊尽头墙面，人物从近处沿走廊前行、经过挂画后进入侧门；镜头保持纵深远景并持续平稳推近，在门框仍形成前景视差、人物尚在侧门边缘时自然结束，不单独留下静止挂画',
    '成品空间09·办公室会客区：挂画固定在会客区背景墙，两人进入、放下文件、落座交谈；人物A与人物B是两名明确不同的人，必须使用不同脸型与五官、不同发型、不同服装款式和不同服装主色，禁止双胞胎、同脸人或克隆人物；镜头从桌面前景横摇到人物与挂画，人物不需要刻意指画',
    '成品空间10·酒店展陈：挂画固定在精品酒店或艺术展陈墙，人物从远处经过或短暂停留；镜头持续利用沙发、雕塑或灯具前景形成视差，在人物自然经过与产品同框时结束，不追加正面静态产品定妆',
    '其他方向01·软装配色呼应：挂画已经上墙，人物依次调整靠枕、花瓶与小型绿植，使其中两种颜色呼应画面主色，后退观察；镜头从软装近景拉到整体空间',
    '其他方向02·从左向右快速揭示：总时长固定5-6秒，挂画从第0秒起已经完整稳固地挂在墙面固定位置；根据本轮风格在客厅、书房、茶室、卧室、餐厅或玄关中选择与近期历史不同的合理场景。0-1秒只做极短空间起幅，镜头位于空间左侧，挂画所在位置处于取景框右侧之外，最多快速经过1-2件真实家具或一个简短人物动作，不得长时间铺垫；1-2秒连续向右平稳横扫，挂画必须最迟在第2秒从画面右侧开始进入取景并迅速完整可见；2-4秒继续右移直到完整挂画到达画面视觉中心，随即明显减速并停止继续穿越；最后1-2秒只围绕完整挂画保持极小幅向右摄影惯性、前景视差或人物微动作，挂画始终是清晰主体。严禁镜头越过挂画后扫向右侧空墙、家具或人物，严禁拖到最后1-2秒才出现挂画；若路线过长，删短开场或移动距离，不得牺牲以挂画为焦点的结尾。挂画自身全程不动、不淡入、不浮现、不缩放、不凭空生成，不得用推近或变焦冒充横扫',
    '其他方向03·从右向左快速揭示：总时长固定5-6秒，挂画从第0秒起已经完整稳固地挂在墙面固定位置；根据本轮风格在客厅、书房、茶室、卧室、餐厅或玄关中选择与上一条及近期历史不同的合理场景。0-1秒只做极短空间起幅，镜头位于空间右侧，挂画所在位置处于取景框左侧之外，最多快速经过1-2件真实家具或一个简短人物动作，不得长时间铺垫；1-2秒连续向左平稳横扫，挂画必须最迟在第2秒从画面左侧开始进入取景并迅速完整可见；2-4秒继续左移直到完整挂画到达画面视觉中心，随即明显减速并停止继续穿越；最后1-2秒只围绕完整挂画保持极小幅向左摄影惯性、前景视差或人物微动作，挂画始终是清晰主体。严禁镜头越过挂画后扫向左侧空墙、家具或人物，严禁拖到最后1-2秒才出现挂画；若路线过长，删短开场或移动距离，不得牺牲以挂画为焦点的结尾。挂画自身全程不动、不淡入、不浮现、不缩放、不凭空生成，不得用推近或变焦冒充横扫',
    '其他方向04·对称构图与人物穿行：挂画位于对称构图中心，人物从画面一侧进入、完成放书或放杯动作后从另一侧离开；主体构图保持稳定，结尾在人物尚未完全离开时轻微推近，不追加无人静态定妆',
    '其他方向05·画面内容移动特写：总时长固定为4-6秒，以挂画原画内容为唯一主体进行一镜到底近距离拍摄。每次复用必须从合理组合中轮换一种：挂画可完整悬挂在墙面、房门或可真实承重且尺寸足够的书架平整外侧板，也可连同上下木条完整平坦放在茶几、书桌、长桌、展示桌或矮柜宽阔台面上；不得倚靠、卡住、悬空或为了特写拆掉木条。机位必须在近乎正面、正上方垂直俯拍、轻微左侧或合理微倾中轮换，不得总是默认从右侧边斜拍。移动路径在上到下、下到上、左到右、右到左、对角线或沿书法笔势/山水路径中轮换，依次展示书法飞白、印章、山水、花鸟或纹理等真实可见内容。单条视频只选一个逻辑成立的摆放场景、一个主机位和一条连续路径，禁止在4-6秒内乱切多场景。镜头按正常速度持续移动并在仍有轻微惯性时结束，不定格，不拉远补拍空间，不强行加入人物或家具全景；严禁改字、补画、让二维画面景物动起来或把平面内容变成三维场景',
    '其他方向06·实木压条工艺移动特写：以上下实木压条为主体，最多两个近景镜头；在“上木条左到右”、“上木条右到左”、“下木条左到右”、“下木条右到左”、“木条端部至画布连接处”中选择与近期不同的路径，清楚展示真实木纹、颜色、粗细、截面、平直两端及与画布的连接。如上下木条都拍，每根各用一个连续移动近景；如只拍一根，可在同一镜头中沿木纹到端部完成展示。不得默认拉远补拍整个房间，不得把平直方木条变成圆柱卷轴，不得新增轴头、端帽、圆球、把手或金属件',
  ],
  // 第 4 批：其他方向 7-16
  [
    '其他方向07·开窗引入自然光：挂画已经固定上墙，人物走到窗边拉开窗帘并整理一件桌面物品；光线自然变亮但不做夸张延时，镜头从窗边横移到挂画',
    '其他方向08·落地灯照明切换：傍晚室内保持正常亮度，人物打开落地灯、坐下翻书并抬头；墙面光影产生合理轻微变化，镜头从人物中景转向挂画，禁止大面积暖黄',
    '其他方向09·双人自然交谈：挂画作为稳定背景，人物A与人物B在沙发或会客椅落座、递杯、交谈并短暂看向墙面；两人必须一眼可区分，使用不同脸型与五官、不同发型、不同服装款式和不同服装主色，禁止双胞胎、同脸人或克隆人物；镜头采用全景和中景切换，不安排两人同时大幅动作',
    '其他方向10·绿植养护生活：挂画固定上墙，人物给绿植少量浇水、擦拭叶片、移动到合适位置后退开；镜头通过绿植前景揭示挂画，产品始终清晰稳定',
    '其他方向11·花艺整理完成：人物修整花枝、插入花瓶、转动花瓶角度并让开，花艺颜色与挂画局部呼应；镜头从手部近景拉远到挂画与边柜整体',
    '其他方向12·手机取景拍摄：挂画已经上墙，人物举起手机调整站位和取景，拍摄后放下手机查看一眼并离开；镜头从人物侧后方展示真实空间，禁止生成屏幕特写或错误文字',
    '其他方向13·门框遮挡揭示：以半遮挡的门框或屏风为前景，人物推门进入、放下随身物品并走向室内；镜头小幅侧移使挂画逐步完整出现，并在门框前景仍有轻微视差、人物继续走动的空间全景中结束',
    '其他方向14·家具线条引导构图：利用沙发靠背、长桌或书架形成通向挂画的视觉线，人物沿这条动线走入、整理一件物品后落座；镜头只做稳定纵向推移',
    '其他方向15·无人自然氛围：挂画全程固定且无人物，窗帘与植物叶片只有轻微自然摆动，镜头从空间远景平稳推到产品中景；通过真实光影、家具层次和材质变化承载内容，禁止长时间完全静止',
    '其他方向16·季节软装搭配：挂画已经上墙，空间用当季花材、织物和果盘形成克制季节感，人物完成摆放、退开、关闭柜门三个动作；镜头持续横移揭示搭配，在人物关闭柜门、前景仍有视差时自然结束，不追加挂画静态定妆',
  ],
];

// 内容阶段数不等于切镜数。按 40 个方向预先分配镜头结构，避免模型为了“丰富”而机械频繁切镜。
const PAINTING_SINGLE_TAKE_DIRECTIONS = new Set([2, 3, 4, PAINTING_CAMERA_EXPLANATION_DIRECTION, 10, 11, 12, 13, 14, 15, 17, 18, 19, 20, 22, PAINTING_LEFT_TO_RIGHT_SCAN_DIRECTION, PAINTING_RIGHT_TO_LEFT_SCAN_DIRECTION, PAINTING_CONTENT_DETAIL_DIRECTION]);
const PAINTING_HYBRID_DIRECTIONS = new Set([1, 5, 8, 16, 21, 23, 24, 25, 30, 31]);

function getPaintingShotStructure(directionNumber) {
  if (PAINTING_SINGLE_TAKE_DIRECTIONS.has(directionNumber)) {
    return '一镜到底：全程连续拍摄、禁止硬切；用人物连续动作与一次稳定但带有自然起停、轻微惯性和构图修正的真人摄影路径串联内容阶段，禁止数学式绝对匀速的虚拟滑轨感。镜头连续不等于动作缓慢，人物必须按现实正常速度行动，每 1-2 秒持续出现新的有效动作、空间信息或构图变化，动作之间允许符合惯性的自然衔接。';
  }
  if (PAINTING_HYBRID_DIRECTIONS.has(directionNumber)) {
    return '主镜头＋动态收束：主体部分用一个连续主镜头完成，前面已经完整展示挂画时结尾不得再补切正面挂画；只有关键材质此前完全无法交代时才允许切 1 次动态细节镜头，全片最多 2 个镜头。最后阶段必须延续镜头、人物或前景运动，不得固定机位静止定格。';
  }
  return '克制多镜头：只在时间、空间或视觉尺度无法自然连续时切镜，通常 2-4 个镜头；禁止每个动作阶段都切一次，连续发生的动作应保留在同一镜头内。';
}

function getPaintingShotStructureLabel(directionNumber) {
  if (PAINTING_SINGLE_TAKE_DIRECTIONS.has(directionNumber)) return '一镜到底';
  if (PAINTING_HYBRID_DIRECTIONS.has(directionNumber)) return '主镜头＋动态收束';
  return '克制多镜头';
}

function getPaintingDirectionDuration(directionNumber, fallbackMin, fallbackMax) {
  if (directionNumber === PAINTING_CONTENT_DETAIL_DIRECTION) {
    return { durationMin: 4, durationMax: 6 };
  }
  if (directionNumber === PAINTING_CAMERA_EXPLANATION_DIRECTION) {
    return { durationMin: 5, durationMax: 6 };
  }
  if ([PAINTING_LEFT_TO_RIGHT_SCAN_DIRECTION, PAINTING_RIGHT_TO_LEFT_SCAN_DIRECTION].includes(directionNumber)) {
    return { durationMin: 5, durationMax: 6 };
  }
  return { durationMin: fallbackMin, durationMax: fallbackMax };
}

function normalizePaintingIdeas(parsed) {
  if (!Array.isArray(parsed)) return [];
  return parsed
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      id: String(item.id || `idea-${index + 1}`),
      title: readValue(item.title) || `方案 ${index + 1}`,
      summary: readValue(item.summary) || readValue(item.desc) || readValue(item.text) || ''
    }))
    .filter((item) => item.summary);
}

async function parsePaintingIdeasWithJsonRetry(initialAnswer, retryAnswer) {
  let answer = initialAnswer;
  try {
    return { answer, ideas: normalizePaintingIdeas(parseStructuredJson(answer)), retried: false };
  } catch (firstError) {
    answer = await retryAnswer(firstError, initialAnswer);
    return { answer, ideas: normalizePaintingIdeas(parseStructuredJson(answer)), retried: true };
  }
}

function countNearDuplicatePaintingIdeas(ideas) {
  const signatures = ideas.map((item) => (
    `${item.title}${item.summary}`
      .replace(/[\s，。；：、,.!！?？“”"'（）()\-—]/g, '')
      .slice(0, 24)
  ));
  return signatures.length - new Set(signatures).size;
}

function countPaintingIdeaStructureFailures(ideas, globalOffset = 0) {
  const furnishingPattern = /沙发|茶几|书架|绿植|地毯|落地灯|茶具|博古架|花瓶|文房摆件|餐桌|餐椅|玄关柜|书桌|边柜|床头柜|艺术灯具|电视柜|屏风|雕塑/g;
  return ideas.filter((item, index) => {
    if ([PAINTING_CONTENT_DETAIL_DIRECTION, PAINTING_WOOD_DETAIL_DIRECTION].includes(globalOffset + index + 1)) return false;
    const text = `${item.title}${item.summary}`;
    const furnishings = text.match(new RegExp(furnishingPattern.source, 'g')) || [];
    return !/(远景|全景)/.test(text) || new Set(furnishings).size < 2;
  }).length;
}

function requiredPaintingTimelineStages(duration) {
  if (duration <= 4) return 3;
  if (duration <= 6) return 3;
  if (duration <= 8) return 4;
  if (duration <= 10) return 5;
  if (duration <= 12) return 6;
  return 7;
}

function inspectPaintingPromptQuality(promptText, duration, ideaSummary = '', options = {}) {
  const issues = [];
  const useStaticWallCompensation = Boolean(options.staticWallSizeCompensation);
  const isContentDetailScan = /画面内容移动特写|原画内容.{0,8}(?:移动|巡游|扫描)特写|沿.{0,12}(?:笔势|山水路径)|实木压条.{0,8}(?:移动|工艺)?特写|木条端部至画布/.test(ideaSummary);
  const isInstallationSequence = !isContentDetailScan && isPaintingInstallationSequence(ideaSummary, promptText);
  const timelineRanges = String(promptText || '').match(/\d+(?:\.\d+)?\s*(?:-|–|—|~|～|至|到)\s*\d+(?:\.\d+)?\s*秒/g) || [];
  const requiredStages = requiredPaintingTimelineStages(duration);
  if (timelineRanges.length < requiredStages) {
    issues.push(`时间轴只有 ${timelineRanges.length} 个明确阶段，目标时长需要至少 ${requiredStages} 个`);
  }
  if (!isContentDetailScan && !/(远景|全景)/.test(promptText)) {
    issues.push('缺少远景或全景阶段');
  }
  const furnishingMatches = String(promptText || '').match(/沙发|茶几|书架|绿植|地毯|落地灯|茶具|博古架|花瓶|文房摆件|餐桌|餐椅|玄关柜|书桌|边柜|床头柜|艺术灯具/g) || [];
  if (!isContentDetailScan && new Set(furnishingMatches).size < 2) {
    issues.push('没有明确写出至少 2 件家居陈设');
  }
  if (/一镜到底/.test(ideaSummary) && !/(一镜到底|连续镜头.*不切镜|不切镜.*连续镜头)/s.test(promptText)) {
    issues.push('创意方案要求一镜到底，但完整提示词没有明确连续镜头、不切镜');
  }
  if (/主镜头.*动态收束/.test(ideaSummary) && !/(最多\s*2\s*个镜头|主镜头.*动态收束|结尾不得.*补切)/s.test(promptText)) {
    issues.push('创意方案要求主镜头动态收束，但完整提示词没有限制镜头数量或禁止静态补切');
  }
  const creativeSection = String(promptText || '').match(/创意内容\s*[：:]?([\s\S]*?)(?:负面约束\s*[：:]?|$)/)?.[1] || String(promptText || '');
  const timedEndingSegments = creativeSection
    .split(/\n+/)
    .filter((line) => /\d+(?:\.\d+)?\s*(?:-|–|—|~|～|至|到)\s*\d+(?:\.\d+)?\s*秒/.test(line));
  const finalTimedSegment = timedEndingSegments.at(-1) || creativeSection.slice(-500);
  const hasStaticEnding = /(定格|固定机位|静止不动|停在挂画|停留在挂画|只留下.{0,8}(?:挂画|挂轴)|产品定妆|完整挂画定妆)/.test(finalTimedSegment);
  const hasVisibleEndingMotion = /(横移|侧移|推近|拉远|跟拍|摇移|视差|人物.{0,12}(?:走|退|坐|放|关|翻|抬|转)|窗帘.{0,8}(?:摆动|微动)|植物.{0,8}(?:摆动|微动)|光影.{0,8}(?:移动|变化))/.test(finalTimedSegment);
  if (hasStaticEnding && !hasVisibleEndingMotion) {
    issues.push('最后阶段是正面挂画静态定格；删除这个独立尾镜头，或改为镜头/人物/前景持续运动中的自然结束');
  }
  const hasMovingCamera = /(?:镜头|摄影机).{0,40}(?:横移|侧移|摇移|升降|推近|拉远|环绕|跟拍|扫过|扫描)|(?:横移|侧移|摇移|升降|推近|拉远|环绕|跟拍|扫过|扫描).{0,24}(?:镜头|摄影机)/s.test(`${ideaSummary}\n${promptText}`);
  const endingKeepsPaintingAsFocus = /(?:挂画|挂轴|装饰画|产品|画面|书法|印章|木条|压条|纹理).{0,28}(?:视觉中心|焦点|主体|完整可见|清晰可见|持续保留|保持在画面|构图中心)|(?:视觉中心|焦点|主体|落在|对准|围绕).{0,18}(?:挂画|挂轴|装饰画|产品|画面|书法|印章|木条|压条|纹理)/s.test(finalTimedSegment);
  if (hasMovingCamera && !endingKeepsPaintingAsFocus) {
    issues.push('移动镜头的最后阶段没有明确以挂画为视觉焦点；必须删短前段路线，在镜头越过挂画前减速，并以挂画清晰位于主体区域、仍保留轻微动态的构图结束');
  }
  const fixedOnWall = /(已经|开场.*(?:已经|固定)|全程)上墙|全程固定|固定在.{0,12}墙/.test(`${ideaSummary}\n${promptText}`);
  const hasWallMountedPresentation = /(上墙|安装完成|悬挂在.{0,12}墙|挂在.{0,12}墙|固定在.{0,12}墙|墙面.{0,12}(?:挂画|挂轴))/.test(`${ideaSummary}\n${promptText}`);
  const materializesOnWall = String(promptText || '')
    .split(/[。；;\n]/)
    .filter((sentence) => !/(严禁|禁止|不得|避免|不能|不允许)/.test(sentence))
    .some((sentence) => /(挂画|挂轴).{0,16}(开始|逐渐|突然|淡入|浮现|显现).{0,16}(出现|进入画面|显现|浮现|变实|生成)|(挂画|挂轴).{0,12}(凭空|透明变实|由小变大)/s.test(sentence));
  if (fixedOnWall && materializesOnWall) {
    issues.push('挂画设定为已经上墙，但时间轴又让挂画开始出现或逐渐进入画面；必须改为第0秒持续存在，仅由取景或实体遮挡完成揭示');
  }
  const hasExactPaintingSize = useStaticWallCompensation
    ? /20\s*(?:厘米|cm).*40\s*(?:厘米|cm)|宽\s*20.*高\s*40/is.test(promptText)
    : /40\s*(?:厘米|cm).*80\s*(?:厘米|cm)|宽\s*40.*高\s*80/is.test(promptText);
  const hasScaleReference = useStaticWallCompensation
    ? /(画高.{0,20}(?:22\s*%.*25\s*%|四分之一)|画宽.{0,20}(?:45\s*%.*50\s*%|肩宽)|沙发.{0,24}(?:十分之一|10\s*%)|(?:十分之一|10\s*%).{0,12}沙发)/s.test(promptText)
    : /(完整站立成年人.*(?:45\s*%.*50\s*%|身高.{0,8}(?:一半|二分之一))|画高.{0,12}(?:完整|从头到脚).{0,8}(?:成人|人物).{0,8}(?:一半|二分之一)|画宽.{0,12}(?:女性|人物).{0,8}肩宽|房门.{0,20}(?:40\s*%|四成|一半)|沙发.*(?:18\s*%.*22\s*%|20\s*%|五分之一)|(?:18\s*%.*22\s*%|20\s*%|五分之一).*沙发)/s.test(promptText);
  if (!hasExactPaintingSize || (!isContentDetailScan && !hasScaleReference)) {
    issues.push(useStaticWallCompensation
      ? '缺少静态上墙补偿尺寸20×40厘米，以及人物身高22%-25%、肩宽45%-50%或三人沙发十分之一中的明确可见参照'
      : '缺少挂画宽40厘米、高80厘米，以及女性肩宽、完整成人身高一半、标准房门或三人沙发五分之一中的明确可见参照');
  }
  if (hasWallMountedPresentation && !isContentDetailScan) {
    const hasWallWhitespace = /(挂钩.{0,24}(?:1\.2|一个以上|一(?:个|幅)).{0,10}(?:画宽|挂画宽度)|上方木条.{0,20}(?:一幅|1幅).{0,8}(?:画高|挂画高度)|挂钩上方.{0,12}(?:大块|明显|充足).{0,8}(?:空墙|留白))/s.test(promptText)
      && /(下边缘.{0,24}(?:1\.2|一幅以上|至少一幅).{0,8}(?:画高|挂画高度)|下方.{0,12}(?:大块|明显|充足).{0,8}(?:留白|空墙|空间)|下方.{0,12}(?:至|到)地面)/.test(promptText);
    if (!hasWallWhitespace) {
      issues.push('上墙成品缺少可见安装留白：挂钩上方至少约1.2个画宽空墙，挂画下方至少约1.2幅画高空间');
    }
    const hasEstablishingBoundaries = /(远景|全景)/.test(creativeSection)
      && /(天花板|吊顶|墙顶|挂钩上方.{0,12}(?:空墙|留白))/.test(creativeSection)
      && /(地面|落地家具|完整房门|完整站立成年人|完整三人沙发|挂画下方.{0,12}(?:空间|留白|空墙))/.test(creativeSection);
    if (!hasEstablishingBoundaries) {
      issues.push('上墙成品缺少尺寸交代镜头：远景/全景需同时交代挂钩上方空墙，以及地面、落地家具、完整房门、完整站立成人或完整三人沙发');
    }
  }
  if (isInstallationSequence) {
    const hasCompletePersonScale = /(从头到脚|完整站立(?:成年人|人物)|人物全身)/.test(creativeSection)
      && /(画宽.{0,12}肩宽|肩宽.{0,12}画宽)/.test(creativeSection)
      && /(画高.{0,20}(?:身高.{0,8}(?:一半|二分之一)|胸口.{0,12}大腿中段)|身高.{0,12}(?:一半|二分之一).{0,12}画高)/.test(creativeSection);
    if (!hasCompletePersonScale) {
      issues.push('安装方向缺少专用人物标尺：全景需拍到人物从头到脚，画宽约等于肩宽、画高约为完整身高一半');
    }
    if (/(开场|第0秒).{0,20}(?:已经上墙|固定在墙)|只要.{0,20}完整墙面.{0,20}(?:已经挂好|必须呈现)/.test(creativeSection)) {
      issues.push('安装流程误用了“第0秒已经上墙”规则；安装前允许人物手持，挂好后才锁定墙面坐标');
    }
  }
  return issues;
}

async function generatePaintingIdeasCore(body, apiKey, requestId) {
  const profile = body.profile;
  const plan = body.plan && typeof body.plan === 'object' ? body.plan : {};
  if (!profile || typeof profile !== 'object') {
    throw new Error('缺少产品档案 profile');
  }

  // 每批固定展示 10 条；四批合计正好覆盖 40 个不同方向。
    const count = 10;
    const durationMin = Number(plan.durationMin) || 5;
    const durationMax = Number(plan.durationMax) || 10;
    const character = readValue(plan.character);
    const audio = readValue(plan.audio);
    const ratio = readValue(plan.ratio) || '9:16';
    const scene = readValue(plan.scene);
    const extraRequirements = readValue(plan.extraRequirements);
    const styleProfile = resolvePaintingStyleProfile(plan.stylePreset);
    const variationRound = Math.max(0, Number.parseInt(String(body.variationRound || 0), 10) || 0);
    const avoidIdeas = Array.isArray(body.avoidIdeas)
      ? body.avoidIdeas.map((item) => readValue(item).slice(0, 120)).filter(Boolean).slice(0, 12)
      : [];
    const totalBatches = PAINTING_FRAMEWORKS.length;
    const batchRaw = Number(body.batch);
    const batchIndex = Number.isFinite(batchRaw) ? ((batchRaw % totalBatches) + totalBatches) % totalBatches : 0;
    const frameworks = PAINTING_FRAMEWORKS[batchIndex];
    const globalOffset = batchIndex * count;
    const wardrobeAssignments = frameworks.map((_, index) => (
      styleProfile.wardrobe[(globalOffset + index + variationRound * 3) % styleProfile.wardrobe.length]
    ));

    const prompt = `你是短视频创意策划专家，为一块挂画/装饰画产品构思带货短视频创意。

【产品固定档案】
${JSON.stringify(profile, null, 2)}

【素材计划】
- 方案数量：${count} 条（本批全部对应固定方向；四批合计 40 个方向且互不重复）
- 单条时长：${durationMin}-${durationMax} 秒
- 输出视频画幅：${ratio}（只指视频画布，绝不是挂画外形；挂画始终为40×80厘米、1:2）
- 产品真实尺寸：${PAINTING_REAL_SIZE_RULE}
- 墙面安装留白：${PAINTING_WALL_WHITESPACE_RULE}
- 镜头尺寸交代：${PAINTING_SCALE_ESTABLISHING_RULE}
- 目标受众：以 40 岁以上人群为主，强调成熟、舒适、可信与有品质感；年龄不等于中式审美，不得因为目标人群年龄而擅自把现代、轻奢、北欧等已选风格改回中式
- 本轮整体风格：${styleProfile.label}
- 风格执行档案：${styleProfile.direction}
${character ? `- 人物偏好：${character}` : ''}
${audio ? `- 声音/音乐偏好：${audio}` : ''}
${scene ? `- 场景偏好：${scene}` : ''}
${extraRequirements ? `- 其他特殊要求：${extraRequirements}` : ''}

【本批固定方向（共 ${frameworks.length} 条，必须严格逐条使用、顺序一一对应）】
${frameworks.map((framework, index) => {
  const directionNumber = globalOffset + index + 1;
  const detailVariant = directionNumber === PAINTING_CONTENT_DETAIL_DIRECTION
    ? `\n   本轮指定的摆放×机位×路径组合：${getPaintingContentDetailVariant(variationRound)}`
    : '';
  return `${index + 1}. ${framework}${detailVariant}\n   镜头结构：${getPaintingShotStructure(directionNumber)}\n   若出现人物，本条服装主色必须为「${wardrobeAssignments[index]}」，可用其他协调色做小面积辅助。`;
}).join('\n')}

【本轮变化与历史避重】
- 当前为第 ${variationRound + 1} 轮变化。同一固定方向的大框架不变，但具体人物身份、家具组合、开场细节、动作衔接和构图必须形成这一轮的新执行版本。
- 以下是近期已使用内容，新方案不得复述或仅改几个形容词：
${avoidIdeas.length ? avoidIdeas.map((item, index) => `${index + 1}. ${item}`).join('\n') : '暂无历史内容。'}

【生成要求（重要）】
1. 严格基于上面这 ${frameworks.length} 条固定方向，逐条生成对应的 ${frameworks.length} 条方案；第 i 条方案必须对应第 i 条方向，不得偏离、合并、换序或重复其他方向，共输出且只能输出 ${count} 条。
2. 固定方向锁定的是创意机制，不是让你照抄句子。必须结合产品档案、本轮整体风格、指定服装主色和历史避重要求，生成新的可执行版本；单纯更换人物性别、衣服颜色或房间名称不算有效变化。
3. 每条方案只输出「标题 + 一句话核心创意」，用于卡片展示，不要输出完整提示词。
4. 每条方案的「标题」要能一眼看出它的镜头/创意类型与景别，如「全景跟拍」「空间横摇」「远景Reveal」「中景互动」「近景特写」等，不要全部雷同。
5. 所有方案都必须遵守四条底线：不得改变挂画的样式、颜色和外观；必须始终按宽40厘米、高80厘米的小型竖幅构图，不得设计成大型卷轴；优先用可见相对关系表达尺寸——画宽约等于女性肩宽、画高约为完整成人身高一半，挂钩上方至少约1.2个画宽空墙、挂画下方至少约1.2幅画高空间；画面动作与展示方式不得违背真实物理逻辑（不得出现穿模、悬浮等）；画面中任何物体的运动（挂画的上升、下降、平移、旋转、展开、翻面）都必须有明确的施动者（人的手、人的动作或合理的物理机制），严禁挂画或任何物体在没有手/人操作的情况下自行悬浮、漂浮、上升、移动、旋转。
6. 每条方案的「一句话核心创意」要写出足以支撑目标时长的连续内容节点，并明确继承方向指定的镜头结构。内容节点是人物动作、空间信息或构图关系的有效变化，不等于切镜；一镜到底也必须持续发生新内容，禁止用慢走、慢坐、慢喝茶、长时间凝视或过慢运镜拖满时长。
7. 每条方案的「一句话核心创意」必须包含具体的空间环境描写，至少出现 2-3 件与挂画风格协调的家居陈设（如实木沙发、茶几、书架、绿植、地毯、落地灯、茶具、博古架、花瓶等），不能只有白墙和挂画。
8. 每条方案必须包含至少1个真正的全景或远景阶段，用于展示人物与空间的相对关系；凡出现上墙成品，这个阶段必须同时交代挂钩上方大块空墙、挂画下方空间，以及从头到脚站立成人、完整房门、完整三人沙发或天花板与地面边界中的至少一种相近景深参照。禁止把人物被桌子或画面边缘截断的中景冒充全景，也禁止这个尺寸交代镜头同时承担书法或纹理特写。
9. 人物服装颜色严格按每条方向后给出的主色执行。同一批不得擅自全部改成米白、浅灰、卡其或其他近似浅色；服装款式、材质也应随人物身份和整体风格变化。
10. 若方向写明挂画开场已经上墙，必须同时执行：${PAINTING_OBJECT_PERMANENCE_RULE} ${PAINTING_WALL_WHITESPACE_RULE} ${PAINTING_SCALE_ESTABLISHING_RULE} 人物只能在空间中生活、观看或接触边缘/木条，不得把它重新取下、展开、移动或再次安装。方案中禁止使用“挂画开始出现、逐渐显现、淡入、浮现、凭空出现”等表达；如需 Reveal，必须明确是墙面挂画位置此前完全在取景框外，或被真实不透明前景遮挡。
11. 禁止出现送礼、方形礼盒、礼包盒、开箱和拆包装情节。本模块不生成包装场景。
12. 严格区分“内容阶段”和“镜头数量”：不得为了满足阶段数而机械切镜。一镜到底方向禁止硬切；主镜头＋动态收束方向最多 2 个镜头且不得为了结尾补切静态挂画；多镜头方向只在时间、空间或视觉尺度不连续时切换。
13. 真人实拍优先：${PAINTING_LIVE_ACTION_REALISM_RULE}
14. 动态收尾：${PAINTING_DYNAMIC_ENDING_RULE}
15. 特写例外：固定方向“其他方向05·画面内容移动特写”的总时长必须为 4-6 秒；它与“其他方向06·实木压条工艺移动特写”均不执行第 7、8 条的家具陈设、远景/全景要求。前者必须把绝大部分时长用于原画内容的一镜到底移动特写；后者必须聚焦上下实木压条的木纹、端部、截面和画布连接，最多两个近景镜头。两者都不得为了满足空间规则拉远补拍房间。其他 38 个方向仍严格执行第 7、8 条。

【镜头语言（多样且克制）】
- 动态运镜（稳定、连贯、按正常叙事速度推进）：推近、拉远、横向摇移、纵向/斜向移动、轻微升降或极小幅度环绕；保留真人摄影合理的起步、惯性、减速和小幅构图修正，不得写成机械绝对匀速，也不得用过慢运镜拖延内容。
- 静态/固定机位：只可用于中段极短的构图过渡或确有必要的细节观察，不能作为最后 1-2 秒的正面挂画定妆；结尾必须按动态收尾规则执行。
- 克制红线：所有运镜必须稳定、连贯并按正常叙事速度推进；展示空间纵深时允许小幅度跟拍、推移、横摇 Reveal，但禁止过慢拖延、快速甩镜、剧烈晃动、手持抖动、急推急转和旋转式环绕。
- 注意：运镜是摄像机运动，物体的运动必须有施动者——没有人物操作时，挂画必须始终静止，只允许镜头做轻微推拉/摇移/缓移，严禁把镜头运动写成挂画自身的位移、上升或旋转。

严格只输出一个 JSON 数组，元素格式为 {"id":"1","title":"方案标题","summary":"一句话核心创意描述"}。
不要输出任何解释文字，不要用 markdown 代码块包裹。`;

    console.log('[doubao painting] ideas request start', { requestId, count });

    const modelStartedAt = Date.now();
    let answer = await callDoubaoArkText({
      apiKey,
      model: DEFAULT_DOUBAO_MULTIMODAL_MODEL,
      content: [{ type: 'input_text', text: prompt }]
    });

    const parsedIdeas = await parsePaintingIdeasWithJsonRetry(answer, async (parseError) => {
      // 豆包偶发会返回被截断、带解释文字或其他不合法 JSON。后台任务已明确拿到错误结果，
      // 可安全要求模型重新输出一次，不涉及 Seedance 提交，也不会造成视频重复扣费。
      console.warn('[doubao painting] ideas JSON parse retry', {
        requestId,
        message: parseError?.message || '',
        parseError: parseError?.parseError || '',
        rawLength: String(answer || '').length,
      });
      const jsonCorrectionPrompt = `${prompt}\n\n你上一次输出无法解析为合法 JSON。请重新生成完整结果：必须只输出一个包含 ${count} 个对象的合法 JSON 数组；所有键名和字符串必须使用英文双引号；不得使用 markdown 代码块；不得添加解释；不得出现尾随逗号；必须保证数组和对象括号完整闭合。`;
      return callDoubaoArkText({
        apiKey,
        model: DEFAULT_DOUBAO_MULTIMODAL_MODEL,
        content: [{ type: 'input_text', text: jsonCorrectionPrompt }]
      });
    });
    answer = parsedIdeas.answer;
    let ideas = parsedIdeas.ideas;
    const structureFailures = countPaintingIdeaStructureFailures(ideas, globalOffset);
    const needsCriticalRetry = ideas.length !== count || countNearDuplicatePaintingIdeas(ideas) > 0;
    const hasRetryBudget = Date.now() - modelStartedAt < 25 * 1000;
    if (needsCriticalRetry && hasRetryBudget) {
      const correctionPrompt = `${prompt}\n\n你上一次输出未通过质量检查：必须恰好输出 ${count} 条有效方案，标题和核心创意不得近似重复，并严格一一对应固定方向；除“其他方向05·画面内容移动特写”和“其他方向06·实木压条工艺移动特写”外，每条标题或核心创意都要明确写出远景/全景，并至少点名 2 件具体家具或陈设；两个特写方向不得添加这些空间要求。当前有 ${structureFailures} 条未满足空间结构要求。请重新输出完整 JSON 数组，不要解释。`;
      answer = await callDoubaoArkText({
        apiKey,
        model: DEFAULT_DOUBAO_MULTIMODAL_MODEL,
        content: [{ type: 'input_text', text: correctionPrompt }]
      });
      ideas = normalizePaintingIdeas(parseStructuredJson(answer));
    }

    if (structureFailures > 0) {
      console.warn('[doubao painting] ideas quality warning', { requestId, structureFailures });
    }

    if (ideas.length !== count) {
      throw Object.assign(new Error(`模型未生成完整的 ${count} 条方案`), { rawText: answer });
    }

    ideas = ideas.map((item, index) => {
      const directionNumber = globalOffset + index + 1;
      const shotLabel = getPaintingShotStructureLabel(directionNumber);
      const directionDuration = getPaintingDirectionDuration(directionNumber, durationMin, durationMax);
      return {
        ...item,
        directionNumber,
        durationMin: directionDuration.durationMin,
        durationMax: directionDuration.durationMax,
        summary: item.summary.includes(shotLabel) ? item.summary : `【${shotLabel}】${item.summary}`,
      };
    });

    console.log('[doubao painting] ideas done', { requestId, count: ideas.length, batch: batchIndex });
    return { ideas, batch: batchIndex, totalBatches };
}

async function runPaintingIdeasTask(task, body, apiKey) {
  try {
    task.result = await generatePaintingIdeasCore(body, apiKey, task.id);
    task.status = 'done';
  } catch (error) {
    task.status = 'failed';
    task.error = error?.message || '创意方案生成失败';
    task.debug = { stage: 'ideas', rawText: error?.rawText };
    console.error('[doubao painting] ideas failed', { requestId: task.id, message: error?.message || '' });
  }
  task.doneAt = Date.now();
}

async function handlePaintingIdeas(req, res) {
  try {
    const apiKey = readValue(SERVER_CONFIG.arkApiKey);
    if (!apiKey) {
      sendJson(res, 500, { error: '服务端未配置 ARK_API_KEY' });
      return;
    }
    const body = await readRequestBody(req);
    if (!body.profile || typeof body.profile !== 'object') {
      sendJson(res, 400, { error: '缺少产品档案 profile' });
      return;
    }
    // 幂等请求编号：响应丢失后重试时复用，返回原 taskId，不重复创建豆包任务。
    const clientRequestId = readValue(body.clientRequestId);
    if (clientRequestId && !isValidPaintingClientRequestId(clientRequestId)) {
      sendJson(res, 400, { error: 'clientRequestId 格式不合法，需为 8-128 位字母/数字/._-' });
      return;
    }
    if (clientRequestId) {
      prunePaintingIdeaClientRequests();
      const existingEntry = PAINTING_IDEA_CLIENT_REQUESTS.get(clientRequestId);
      if (existingEntry) {
        const existing = PAINTING_TASKS.get(existingEntry.taskId);
        if (!existing || (existing.doneAt && Date.now() - existing.doneAt > PAINTING_TASK_TTL_MS)) {
          // 服务重启或任务已过期：内存任务不存在，明确返回失效，绝不假装原任务仍在执行。
          PAINTING_IDEA_CLIENT_REQUESTS.delete(clientRequestId);
          sendJson(res, 410, { error: '任务已失效，需要重新生成当前批次。', invalidated: true });
          return;
        }
        if (existing.status !== 'failed') {
          sendJson(res, 202, {
            ok: true,
            taskId: existing.id,
            status: existing.status,
            deduplicated: true,
            ...(existing.status === 'done' ? { result: existing.result } : {}),
          });
          return;
        }
        // 原后台任务已经明确失败，可在用户点击“继续准备”后用同一请求编号创建新任务。
        // 这里只重跑创意 JSON，不会提交 Seedance 视频任务。
        PAINTING_IDEA_CLIENT_REQUESTS.delete(clientRequestId);
      }
    }
    const task = createPaintingTask('ideas');
    if (clientRequestId) {
      PAINTING_IDEA_CLIENT_REQUESTS.set(clientRequestId, { taskId: task.id, createdAt: Date.now() });
    }
    runPaintingIdeasTask(task, body, apiKey);
    sendJson(res, 202, { ok: true, taskId: task.id, status: task.status, ...(clientRequestId ? { deduplicated: false } : {}) });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '创意方案任务创建失败' });
  }
}

async function generatePaintingIdeaPromptCore(requestId, apiKey, profile, idea, context = {}) {
  const ideaTitle = readValue(idea?.title);
  const ideaSummary = readValue(idea?.summary);
  if (!ideaTitle && !ideaSummary) {
    throw new Error('缺少创意方案内容 idea');
  }

  const isContentDetailScan = Number(idea?.directionNumber) === PAINTING_CONTENT_DETAIL_DIRECTION
    || /画面内容移动特写|原画内容.{0,8}(?:移动|巡游|扫描)特写/.test(`${ideaTitle}\n${ideaSummary}`);
  const isWoodDetailScan = Number(idea?.directionNumber) === PAINTING_WOOD_DETAIL_DIRECTION
    || /实木压条.{0,8}(?:移动|工艺)?特写|木条端部至画布/.test(`${ideaTitle}\n${ideaSummary}`);
  const isCloseDetailScan = isContentDetailScan || isWoodDetailScan;
  const isInstallationSequence = !isCloseDetailScan && isPaintingInstallationSequence(ideaTitle, ideaSummary);
  const useStaticWallSizeCompensation = !isCloseDetailScan
    && !isInstallationSequence
    && shouldUsePaintingStaticWallSizeCompensation(idea);
  const durationMin = isContentDetailScan ? 4 : (Number(idea?.durationMin) || Number(context.durationMin));
  const durationMax = isContentDetailScan ? 6 : (Number(idea?.durationMax) || Number(context.durationMax));
  const hasDurationRange =
    Number.isFinite(durationMin) && Number.isFinite(durationMax) && durationMax >= durationMin && durationMax > 0;
  const fallbackDuration =
    Number(idea?.duration) || Number(context.duration) || (hasDurationRange ? Math.round((durationMin + durationMax) / 2) : 8);
  const ratio = readValue(idea?.ratio) || readValue(context.ratio) || '9:16';
  const styleProfile = resolvePaintingStyleProfile(idea?.stylePreset || context.stylePreset);
  const character = readValue(idea?.character) || readValue(context.character);
  const audio = readValue(idea?.audio) || readValue(context.audio);
  const scene = readValue(idea?.scene) || readValue(context.scene);
  const extraRequirements = readValue(idea?.extraRequirements) || readValue(context.extraRequirements);
  const elementVariationIndex = Math.max(0, Math.floor(Number(context.elementVariationIndex) || 0));
  const contentDetailVariant = isContentDetailScan
    ? getPaintingContentDetailVariant(elementVariationIndex)
    : '';
  const previousPrompt = readValue(context.previousPrompt).slice(0, 4000);
  const avoidElements = Array.isArray(context.avoidElements)
    ? context.avoidElements.filter(Boolean).slice(0, 12)
    : [];
  const profileForPrompt = useStaticWallSizeCompensation
    ? normalizePaintingPromptForStaticWallCompensation(JSON.stringify(profile, null, 2))
    : JSON.stringify(profile, null, 2);
  const systemSizeRules = isCloseDetailScan
    ? PAINTING_CONTENT_DETAIL_SIZE_RULE
    : useStaticWallSizeCompensation
      ? `${PAINTING_STATIC_WALL_COMPENSATED_SIZE_RULE}\n${PAINTING_STATIC_WALL_COMPENSATED_WHITESPACE_RULE}\n${PAINTING_SCALE_ESTABLISHING_RULE}`
      : `${PAINTING_REAL_SIZE_RULE}\n${PAINTING_WALL_WHITESPACE_RULE}\n${PAINTING_SCALE_ESTABLISHING_RULE}${isInstallationSequence ? `\n${PAINTING_INSTALLATION_SCALE_RULE}` : ''}`;
  const finalProductSizeRequirement = useStaticWallSizeCompensation
    ? '尺寸与镜头必须执行上方静态上墙补偿规则；最终正文只能写宽20厘米、高40厘米，并选用人物身高22%-25%、肩宽45%-50%或三人沙发十分之一中的一个可见参照。不得写入其他物理尺寸或旧比例'
    : '尺寸与镜头必须执行上方系统尺寸规则，但最终正文只需简洁写明40×80厘米和本条选用的一个可见参照关系，不要重复罗列多组厘米区间和百分比';
  const finalNegativeSizeRequirement = useStaticWallSizeCompensation
    ? '尺寸方面必须明确禁止自行恢复为常规或大型卷轴、画高超过完整成人身高的四分之一、画宽超过成年人肩宽的一半、画宽超过三人沙发总宽的十分之一、缩小人物或家具来突出挂画，以及透视或广角畸变造成的尺寸夸大'
    : '尺寸方面必须明确禁止60×120厘米或更大的大型卷轴、画宽明显超过女性肩宽、画高明显超过完整成人身高一半、挂钩距天花板不足一个画宽、挂画下方距地面不足一幅画高、人物被截断却用作比例参照，以及透视或广角畸变造成的尺寸夸大';
  const physicalSizeLabel = useStaticWallSizeCompensation ? '20×40厘米、1:2的生成补偿外形' : '40×80厘米、1:2的物理外形';
  const creativeSubjectRequirements = isContentDetailScan
    ? '参考图中真实可见的文字、书法笔势、印章、山水、花鸟、装饰纹样与画布纹理，以及镜头选择该移动路径的构图依据；本方向不得强行加入人物、服装或家具'
    : isWoodDetailScan
      ? '上下实木压条的真实木纹、颜色、材质、粗细、截面、平直两端与画布连接处，以及左到右或右到左的连续移动路径；本方向不得强行加入人物、服装、家具全景或房间定妆镜头'
    : `${character ? `人物设定（${character}）` : '人物设定'}、符合「${styleProfile.label}」的服装款式与方案指定主色、${scene ? `指定场景（${scene}）` : '场景'}、构图、动作节奏、光影氛围和${audio ? `声音/音乐（${audio}）` : '声音'}`;
  const elementVariationRequirements = elementVariationIndex > 0 || avoidElements.length > 0
    ? `\n【同框架换元素重生成${elementVariationIndex > 0 ? `（第 ${elementVariationIndex} 个变化版本）` : ''}】
${elementVariationIndex > 0 ? '这是用户主动选择的“换元素再生成”，必须保留原标题与核心创意中的大框架：产品所处状态、主要动作逻辑、镜头结构（一镜到底/主镜头＋动态收束/克制多镜头）、运镜方向、起幅与收尾目的均不得改变。只在不破坏物理逻辑和创意成立条件的前提下，更换执行元素。' : '本方向必须与同批量中已经生成的方向形成明显差异，禁止只换房间名称或衣服颜色。'}
- 必须明显更换为另一套合适场景或空间布置，并再更换以下类别中的至少 2 类：人物性别/年龄/身份、服装款式与主色、家具与生活陈设组合、自然光时段或开场生活动作；若原框架本来无人，不得为了换元素强行增加人物。
- 新场景必须适合真实悬挂和展示这幅画；若核心创意锁定客厅、书房、茶室等场景类别，则换成同类别中布局、家具和色彩明确不同的另一套真实空间，不能为了求变改成不合逻辑的地点。
- 人物、服装、场景和陈设在本条视频内部仍须从头到尾保持一致。“换人物/换装”是相对于上一个生成版本而言，不得在同一条视频中途换人或换装。
- 本段要求的优先级高于上方的可选人物、服装和场景偏好，但不得覆盖产品外观、真实尺寸、整体风格、固定镜头框架和负面约束。
${previousPrompt ? `- 必须避开上一版本已经使用的具体人物、服装配色、家具组合与空间布置。上一版本仅供查重参考：\n${previousPrompt}` : '- 即使没有上一版本文本，也必须主动选择与常见米白服装、模板化样板间不同的明确元素组合。'}
${avoidElements.length > 0 ? `\n- 还必须避开本批量以下已经使用的元素组合：\n${avoidElements.map((item, index) => `${index + 1}. ${item}`).join('\n')}` : ''}\n`
    : '';

  let fullPrompt = `你是短视频提示词专家。请基于下面的「产品固定档案」和「创意方案」，写一段完整的 Seedance 视频生成提示词（中文，可直接提交给 Seedance）。

【产品固定档案（产品外观必须严格复刻，不得改动）】
${profileForPrompt}

【创意方案】
标题：${ideaTitle}
核心创意：${ideaSummary}

【目标受众（大方向引导，不锁死）】
这款挂画主要面向 40 岁以上人群，画面需要成熟、舒适、可信并有品质感，但年龄不等于中式审美。人物按现实正常速度活动，镜头平稳连贯；具体装修、服装、色彩和表达语气必须服从本轮选定风格。
【本轮整体风格（全链路必须执行）】
- 风格：${styleProfile.label}
- 空间、色彩、服装、光线、镜头、声音与文案语气：${styleProfile.direction}
- 不得因为产品是书法或国画就自动回到新中式；除非本轮风格明确为新中式，否则必须按上述风格重新设计配套环境。
${scene ? `- 用户指定场景偏好：${scene}` : ''}
${extraRequirements ? `\n【其他特殊要求】\n${extraRequirements}` : ''}
${isContentDetailScan ? `\n【本次原画内容特写指定组合（必须严格执行）】\n${contentDetailVariant}\n单条只使用这一个摆放场景、一个主机位和一条连续路径，禁止改成默认右侧斜拍，禁止为了显得丰富而在4-6秒内切换多个场景。` : ''}
${elementVariationRequirements}

【系统尺寸规则（理解并落实到时间轴；最终产品约束中无需逐字重复，服务端会确定性前置）】
${systemSizeRules}

【要求】
1. 无论视频采用何种形式（静态展示、挂墙、手持、展开、人物互动等），都绝对不得改变挂画的样式、颜色和外观，必须与产品固定档案完全一致。
2. 画面中的一切动作、镜头、展开方式、光影、透视、材质表现都必须符合真实物理逻辑，不得出现穿模、悬浮、违反重力/光影/透视等不合理现象。如果出现卷轴式挂画或卷起后展开的画作，必须严格执行：${PAINTING_ROLLING_UNFOLD_RULE} 画面中任何物体的运动（挂画的上升、下降、平移、旋转、展开、翻面）都必须有明确的施动者（人的手、人的动作或合理的物理机制），严禁挂画或任何物体在没有手/人操作的情况下自行悬浮、漂浮、上升、移动、旋转——挂画要动，必须有人来拿、挂、展开或展示它，不能自己悬空位移。人物必须严格执行：${PAINTING_CHARACTER_IDENTITY_RULE}${isInstallationSequence ? '本条明确是人物现场安装流程：开场允许人物手持尚未上墙的挂画；只有挂好以后才锁定挂点和墙面坐标，禁止套用“第0秒已经上墙”的规则。' : `若创意设定挂画已经上墙，必须严格执行：${PAINTING_OBJECT_PERMANENCE_RULE}`}
3. 内容密度：整个视频必须包含连续、不同的有效阶段，阶段数量按目标时长动态要求——4 秒至少 3 个阶段，5-6 秒至少 3 个阶段，7-8 秒至少 4 个阶段，9-10 秒至少 5 个阶段，11-12 秒至少 6 个阶段，13-15 秒至少 7 个阶段；每个阶段必须发生新的、可见的人物动作、空间信息或构图关系变化，禁止把同一动作拆段凑数。内容阶段不等于镜头数量，一镜到底可以在同一个连续镜头中完成全部阶段。人物肢体、行走、坐下、翻书、喝茶和观看都必须按现实正常速度完成，动作之间允许符合人体惯性和真实摄影的自然衔接；每 1-2 秒持续出现新动作或新构图信息即可，禁止慢放、降速、重复、循环、人物发呆和长时间凝视，也禁止为了赶时间而机械连续完成过多动作。
4. 提示词必须分三部分：产品固定约束、创意内容、负面约束。
5. 产品固定约束：挂画/卷轴的外观（画面内容、颜色、材质、木条/挂轴/压杆结构、纹理）必须严格按档案复刻，不得重新设计。如画面中的挂画带有木条、挂轴或压杆等边框结构，这些结构必须保持档案中的形状、颜色、材质、粗细、长度、截面和两端轮廓不变；如涉及卷起或展开，全程不得变形、不得把木条变成圆柱形卷轴或圆杆、不得变色，也不得在两端或旁边新增任何圆柱、轴头、端帽、圆球、把手等构件。${finalProductSizeRequirement}。
6. 创意内容：结合创意方案，写清楚${creativeSubjectRequirements}。非内容移动特写方向的服装不得擅自全部改成米白、浅灰或卡其。必须严格继承创意方案标注的“一镜到底 / 主镜头＋动态收束 / 克制多镜头”结构：一镜到底要在所有时间段明确写“连续镜头、不切镜”，用一条简单稳定且具有自然起停、惯性和小幅构图修正的真人摄影路径串联动作，禁止机械绝对匀速滑轨；主镜头＋动态收束全片最多 2 个镜头，前面已展示挂画时不得为结尾再补切正面挂画；多镜头只在无法自然连续时切换。把视频从 0 秒开始按先后顺序无重叠地铺满到结束，每段写明起止时间及新的动作或空间信息，但不得因为进入新阶段就自动切镜；4 秒至少 3 段、5-6 秒至少 3 段、7-8 秒至少 4 段、9-10 秒至少 5 段、11-12 秒至少 6 段、13-15 秒至少 7 段。${isContentDetailScan ? '本方向是4-6秒原画内容移动特写：不要求远景/全景、人物或家具陈设，不得拉远补拍空间；镜头必须根据参考图真实构图选择一条连贯扫描路径，只拍参考图中确实存在的文字、笔触、印章、山水或花鸟细节，二维画面内容本身绝对静止，不能让山水、飞鸟、流水、植物或书法笔画产生动画。' : isWoodDetailScan ? '本方向是实木压条工艺移动特写：不要求远景/全景、人物或家具陈设，不得默认拉远补拍房间；最多两个近景镜头，每个镜头必须沿一根木条或其端部到画布连接处持续移动，不定格。只展示高清参考图中真实存在的木纹、颜色、平直形状、粗细、截面、两端与连接结构，禁止变成圆柱卷轴或新增任何零件。' : isInstallationSequence ? '本方向是人物安装流程：开场真正全景必须让人物从头到脚完整可见，人物和挂画处于相近景深，挂画宽约等于肩宽、画高约为完整身高一半；这一个镜头只证明尺寸，不兼任文字或纹理特写。挂好后再用全景证明上方至少约1.2个画宽空墙、下方至少约1.2幅画高空间，最后如需展示细节只能另行靠近。' : `整个视频至少有 1 个远景或全景，场景中自然出现 2-3 件符合「${styleProfile.label}」的家具或陈设，不能只有人、墙和画。凡出现上墙成品，这个远景/全景必须同时交代挂钩上方大块空墙和挂画下方空间，并使用完整房门、从头到脚站立成人、完整三人沙发或天花板与地面边界中的一个相近景深参照；这个镜头只证明尺寸，不同时承担纹理特写。`}所有动作按现实正常速度连续完成，镜头稳定但不能缓慢拖延。${isInstallationSequence ? '本条在人物挂好以前不执行第0秒已上墙约束；挂好以后才固定挂点、尺寸和墙面坐标。' : '若方案写明挂画开场已经上墙，则挂画从第 0 秒起就在固定墙面坐标客观存在；内容密度来自人物生活动作、空间揭示、前后景和连续构图变化，不得为了凑动作重新取画或安装，更不得让挂画淡入、浮现或凭空生成。'}结尾必须执行：${PAINTING_DYNAMIC_ENDING_RULE} 移动镜头还必须执行：${PAINTING_PRODUCT_FOCUSED_ENDING_RULE} 全片实拍质感必须执行：${PAINTING_LIVE_ACTION_REALISM_RULE}
7. 负面约束：明确列出不得改变的元素（挂画外观、画面内容、木条结构等）、必须避免的物理违背现象（穿模、悬浮、违反重力/光影/透视等）、禁止单一动作慢放/循环凑时长、禁止长时间静止、禁止快速晃动/快速变焦/急推/手持抖动、严禁挂画在无人操作时自行位移；已经上墙的挂画还必须禁止淡入、浮现、透明变实、凭空生成、突然出现、逐渐长出、由小变大和中途贴到墙上；人物方面必须禁止单人复制或分身、多人同脸同发型同服装、双胞胎式克隆、人物凭空增减、换脸、换装和身份互换；${finalNegativeSizeRequirement}；实拍质感方面禁止三维渲染感、AI样板间、蜡像皮肤、过度磨皮、塑料材质、全屋无阴影的均匀棚拍光、数学式绝对匀速滑轨和虚拟摄像机漂移；一镜到底方向禁止硬切、跳切、瞬间换景和人物位置突变，多镜头方向禁止无意义频繁切镜；如涉及卷轴或木条，还要禁止滑动式展开、木条变成圆柱或变色、两端新增圆柱/轴头/端帽。禁止出现送礼、方形礼盒、礼包盒、开箱和拆包装情节。
${hasDurationRange ? `8. 总时长必须在 ${durationMin}~${durationMax} 秒之间，请你从该范围内挑选一个最合适的整数秒数；输出视频画布为 ${ratio}，这与挂画${physicalSizeLabel}无关。并在提示词最后单独写一行「总时长：X秒」（X 为你选定的整数，例如「总时长：8秒」）。` : `8. 总时长约 ${fallbackDuration} 秒；输出视频画布为 ${ratio}，这与挂画${physicalSizeLabel}无关。并在提示词最后单独写一行「总时长：${fallbackDuration}秒」。`}

严格只输出这段提示词文本本身，不要输出任何解释、标题、序号或 markdown 包裹。`;

  // 补偿方向发送给提示词模型的整份上下文也必须只有一套尺寸，
  // 防止创意摘要、历史提示词或老档案把真实尺寸重新带入 Seedance 提示词。
  if (useStaticWallSizeCompensation) {
    fullPrompt = normalizePaintingPromptForStaticWallCompensation(fullPrompt);
  }

  console.log('[doubao painting] idea-prompt request start', { requestId, title: ideaTitle });

  const modelStartedAt = Date.now();
  let answer = await callDoubaoArkText({
    apiKey,
    model: DEFAULT_DOUBAO_MULTIMODAL_MODEL,
    content: [{ type: 'input_text', text: fullPrompt }]
  });

  let promptText = String(answer || '').trim();
  if (!promptText) {
    throw new Error('模型返回的提示词为空');
  }

  let durationSec = null;
  let durationMatch = promptText.match(/总时长\s*[：:]\s*(\d{1,3})\s*秒?/);
  if (durationMatch) {
    durationSec = Number.parseInt(durationMatch[1], 10);
  }
  if (!Number.isFinite(durationSec) || durationSec <= 0) {
    durationSec = hasDurationRange ? Math.round((durationMin + durationMax) / 2) : fallbackDuration;
  }
  let resolvedDuration = Math.min(30, Math.max(4, Math.round(durationSec)));
  const qualityIssues = inspectPaintingPromptQuality(promptText, resolvedDuration, ideaSummary, {
    staticWallSizeCompensation: useStaticWallSizeCompensation,
  });
  const hasRetryBudget = Date.now() - modelStartedAt < 25 * 1000;
  if (qualityIssues.length > 0 && hasRetryBudget) {
    const correctionPrompt = `${fullPrompt}\n\n【质量检查未通过，必须重写】\n${qualityIssues.map((issue, index) => `${index + 1}. ${issue}`).join('\n')}\n请重新输出一份完整提示词，保留产品与创意方向，严格补齐连续时间轴、远景/全景和家居陈设。只输出重写后的提示词文本。`;
    answer = await callDoubaoArkText({
      apiKey,
      model: DEFAULT_DOUBAO_MULTIMODAL_MODEL,
      content: [{ type: 'input_text', text: correctionPrompt }]
    });
    promptText = String(answer || '').trim();
    if (!promptText) throw new Error('模型重写后的提示词为空');
    durationMatch = promptText.match(/总时长\s*[：:]\s*(\d{1,3})\s*秒?/);
    if (durationMatch) {
      const rewrittenDuration = Number.parseInt(durationMatch[1], 10);
      if (Number.isFinite(rewrittenDuration) && rewrittenDuration > 0) {
        resolvedDuration = Math.min(30, Math.max(4, Math.round(rewrittenDuration)));
      }
    }
  }
  // 尺寸锁定由服务端确定性追加，不依赖提示词模型是否完整保留这项关键产品约束。
  promptText = ensurePaintingSizeLock(promptText, {
    contentDetailScan: isCloseDetailScan,
    installationSequence: isInstallationSequence,
    staticWallSizeCompensation: useStaticWallSizeCompensation,
  });
  // 第一组第1、8个卷起展开方向固定补入用户指定原句，确保最终交给视频模型时一定存在。
  promptText = ensurePaintingRollingUnfoldInstruction(promptText, idea?.directionNumber);
  // 特写方向的摆放场景、机位和移动路径也由服务端确定性锁定，避免模型反复默认右侧斜拍。
  if (isContentDetailScan) {
    promptText = ensurePaintingContentDetailVariant(promptText, elementVariationIndex);
  }
  if (qualityIssues.length > 0) {
    console.warn('[doubao painting] idea-prompt quality warning', { requestId, qualityIssues, retried: hasRetryBudget });
  }

  console.log('[doubao painting] idea-prompt done', { requestId, promptLength: promptText.length, duration: resolvedDuration });
  return { prompt: promptText, duration: resolvedDuration };
}

async function handlePaintingIdeaPrompt(req, res) {
  try {
    const apiKey = readValue(SERVER_CONFIG.arkApiKey);
    if (!apiKey) {
      sendJson(res, 500, { error: '服务端未配置 ARK_API_KEY' });
      return;
    }

    const body = await readRequestBody(req);
    const profile = body.profile;
    const idea = body.idea && typeof body.idea === 'object' ? body.idea : {};
    if (!profile || typeof profile !== 'object') {
      sendJson(res, 400, { error: '缺少产品档案 profile' });
      return;
    }

    // 与挂画分析、创意方案保持同一模式：先立即返回任务编号，再由前端轮询。
    // 完整提示词可能触发质量重写，不能让浏览器/反向代理一直挂着同步连接。
    const task = createPaintingTask('idea-prompt');
    runPaintingIdeaPromptTask(task, apiKey, profile, idea, body);
    sendJson(res, 202, { ok: true, taskId: task.id, status: task.status });
  } catch (error) {
    sendJson(res, 500, {
      error: error?.message || '完整提示词生成失败',
      debug: { stage: 'idea-prompt', rawText: error?.rawText }
    });
  }
}

async function runPaintingIdeaPromptTask(task, apiKey, profile, idea, context) {
  try {
    task.result = await generatePaintingIdeaPromptCore(task.id, apiKey, profile, idea, context);
    task.status = 'done';
  } catch (error) {
    task.status = 'failed';
    task.error = error?.message || '完整提示词生成失败';
    task.debug = { stage: 'idea-prompt', rawText: error?.rawText };
    console.error('[doubao painting] idea-prompt failed', { requestId: task.id, message: error?.message || '' });
  }
  task.doneAt = Date.now();
}

// ===== 挂画全自动批量任务 =====

class PaintingBatchSemaphore {
  constructor(maxConcurrency) {
    this.maxConcurrency = Math.max(1, Number(maxConcurrency) || 1);
    this.running = 0;
    this.queue = [];
  }

  async acquire() {
    if (this.running < this.maxConcurrency) {
      this.running += 1;
      return;
    }
    return new Promise((resolve) => this.queue.push(resolve));
  }

  release() {
    if (this.queue.length > 0) {
      const next = this.queue.shift();
      next();
    } else {
      this.running = Math.max(0, this.running - 1);
    }
  }
}

const paintingBatchPromptSemaphore = new PaintingBatchSemaphore(PAINTING_BATCH_PROMPT_CONCURRENCY);
const paintingBatchSeedanceSubmitSemaphore = new PaintingBatchSemaphore(1);
const paintingBatchRenderSemaphore = new PaintingBatchSemaphore(PAINTING_BATCH_MAX_RENDERING_TASKS);

function normalizePaintingPromptForCompare(text) {
  return String(text || '')
    .toLowerCase()
    .replace(/[\s，。；：、,.!！?？“”"'（）()\-—\d]/g, '');
}

function paintingPromptSimilarity(a, b) {
  const na = normalizePaintingPromptForCompare(a);
  const nb = normalizePaintingPromptForCompare(b);
  if (!na || !nb) return 0;
  const setA = new Set(na.split('').filter(Boolean));
  const setB = new Set(nb.split('').filter(Boolean));
  if (setA.size === 0 || setB.size === 0) return 0;
  const intersection = new Set([...setA].filter((x) => setB.has(x)));
  return intersection.size / Math.max(setA.size, setB.size);
}

function extractPaintingDiversitySummary(promptText) {
  const text = String(promptText || '');
  const sceneMatch = text.match(/场景[：:]?\s*([^\n]{3,80})/);
  const furnitureMatches = text.match(/沙发|茶几|书架|绿植|地毯|落地灯|茶具|博古架|花瓶|文房摆件|餐桌|餐椅|玄关柜|书桌|边柜|床头柜|艺术灯具|电视柜|屏风|雕塑/g) || [];
  const lightMatch = text.match(/光线[：:]?\s*([^\n]{3,60})/);
  const characterMatch = text.match(/人物[：:]?\s*([^\n]{3,80})/);
  const wardrobeMatch = text.match(/服装[：:]?\s*([^\n]{3,60})/);
  const cameraMatch = text.match(/镜头[：:]?\s*([^\n]{3,80})/);
  return {
    scene: sceneMatch ? sceneMatch[1].trim() : '',
    furniture: [...new Set(furnitureMatches)].slice(0, 6),
    light: lightMatch ? lightMatch[1].trim() : '',
    character: characterMatch ? characterMatch[1].trim() : '',
    wardrobe: wardrobeMatch ? wardrobeMatch[1].trim() : '',
    camera: cameraMatch ? cameraMatch[1].trim() : '',
    snippet: text.replace(/\s+/g, ' ').slice(0, 240),
  };
}

// Seedance 接口不支持客户端幂等键，这里不做伪幂等；
// 防重复提交/扣费依赖数据库部分唯一索引 + 提交中断时置 needs_review 由人工复核。
function isRetriableSeedanceError(error) {
  const message = error?.message || '';
  return /timeout|timed out|econn|socket|network|fetch|abort|terminated|connection|503|504|502|500|rate limit|too many/i.test(message);
}

function isFuzzySeedanceTimeout(error) {
  return error?.name === 'TimeoutError' || error?.name === 'AbortError' || /timeout|timed out/i.test(error?.message || '');
}

async function sleepMs(ms) {
  return new Promise((resolve) => setTimeout(resolve, Math.max(0, Number(ms) || 0)));
}

async function buildPaintingImageFileForSeedance(imagePath, baseName = 'painting') {
  if (!imagePath || !existsSync(imagePath)) {
    throw new Error('挂画原图不存在，无法提交 Seedance 任务');
  }
  const buffer = await readFile(imagePath);
  const ext = path.extname(imagePath).toLowerCase() || '.jpg';
  const mimeType = ext === '.png' ? 'image/png' : 'image/jpeg';
  const fileName = `${sanitizeFileName(baseName) || 'painting'}${ext}`;
  return new File([buffer], fileName, { type: mimeType });
}

function getPaintingBatchReferenceSpecs(task, batchRun) {
  const woodReferences = batchRun?.options?.woodReferences || {};
  const isWoodDetailDirection = Number(task?.directionNumber) === PAINTING_WOOD_DETAIL_DIRECTION;
  const specs = [
    { imagePath: batchRun?.imagePath || '', baseName: 'painting-main', label: '图1是挂画正面主图，决定整体文字、图案、颜色、比例和木条位置' },
  ];
  if (isWoodDetailDirection && woodReferences.upper?.imagePath && existsSync(woodReferences.upper.imagePath)) {
    specs.push({ imagePath: woodReferences.upper.imagePath, baseName: 'painting-upper-wood', label: '图2是上方实木压条高清结构图，只决定上方木条的木纹、颜色、形状、粗细、截面、两端及与画布的连接' });
  }
  if (isWoodDetailDirection && woodReferences.lower?.imagePath && existsSync(woodReferences.lower.imagePath)) {
    specs.push({ imagePath: woodReferences.lower.imagePath, baseName: 'painting-lower-wood', label: `图${specs.length + 1}是下方实木压条高清结构图，只决定下方木条的木纹、颜色、形状、粗细、截面、两端及与画布的连接` });
  }
  return specs;
}

async function submitSeedanceTaskForBatchTask(task, batchRun) {
  const requestId = randomBytes(6).toString('hex');
  const model = batchRun.model || PAINTING_BATCH_MODEL;
  const isMiniMaxH3 = model === MINIMAX_H3_MODEL;
  const isWan3 = model === WAN3_VIDEO_MODEL;
  const apiKey = isMiniMaxH3
    ? readValue(SERVER_CONFIG.minimaxApiKey)
    : isWan3
      ? readValue(SERVER_CONFIG.dashscopeApiKey)
      : readValue(SERVER_CONFIG.seedanceApiKey);
  if (!apiKey) {
    throw new Error(`服务端未配置 ${isMiniMaxH3 ? 'MINIMAX_API_KEY' : isWan3 ? 'DASHSCOPE_API_KEY' : 'SEEDANCE_API_KEY'}`);
  }
  if (!task.prompt) {
    throw new Error('缺少视频生成提示词 prompt');
  }

  const isWoodDetailDirection = Number(task.directionNumber) === PAINTING_WOOD_DETAIL_DIRECTION;
  const referenceSpecs = getPaintingBatchReferenceSpecs(task, batchRun);

  const referenceGuide = isWoodDetailDirection
    ? `【参考图职责强制区分】\n${referenceSpecs.map((item) => item.label).join('\n')}。木条特写图中的桌面、墙面、手、尺子、包装物或其他背景都不属于产品，严禁复制到生成视频。如细节图与正面主图的作用冲突，整体画面以主图为准，对应木条局部结构以高清细节图为准。\n\n`
    : '';
  let promptForSubmission = ensurePaintingProductFocusedEnding(
    ensurePaintingRollingUnfoldInstruction(task.prompt, task.directionNumber)
  );
  if (isWan3) {
    promptForSubmission = ensureWan3CameraMotionLock(promptForSubmission);
    promptForSubmission = ensureWan3PaintingStructureLock(promptForSubmission, task.directionNumber);
  }
  const content = [{ type: 'text', text: `${referenceGuide}${promptForSubmission}` }];
  for (const spec of referenceSpecs) {
    const imageFile = await buildPaintingImageFileForSeedance(spec.imagePath, spec.baseName);
    const compressedFile = await compressMediaForArk(imageFile, 'image');
    const normalized = await normalizeUploadedMediaInput(compressedFile, 'image');
    content.push({ type: 'image_url', image_url: { url: normalized.imageUrl }, role: 'reference_image' });
  }

  const isSeedance25 = model === 'doubao-seedance-2-5-260628';
  const resolution = batchRun.resolution || '720p';
  const ratio = batchRun.ratio || '9:16';
  const duration = Math.min(isSeedance25 || isWan3 ? 30 : 15, Math.max(isWan3 ? 2 : 4, Math.round(task.duration || 8)));
  const generateAudio = batchRun.generateAudio !== false;
  const watermark = batchRun.watermark === true;

  const upstreamUrl = isMiniMaxH3
    ? 'https://api.minimaxi.com/v2/video_generation'
    : isWan3
      ? `${DASHSCOPE_VIDEO_BASE_URL}/api/v1/services/aigc/video-generation/video-synthesis`
      : 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
  const requestPayload = isMiniMaxH3 ? {
    model: MINIMAX_H3_MODEL,
    content,
    resolution: '768P',
    ratio,
    duration,
    aigc_watermark: watermark,
  } : isWan3 ? {
    model: WAN3_VIDEO_MODEL,
    input: {
      prompt: content[0].text,
      media: content.slice(1).map((item) => ({ type: 'reference_image', url: item.image_url.url })),
    },
    parameters: {
      resolution: resolution.toUpperCase(),
      ratio,
      duration,
      audio: generateAudio,
      prompt_extend: false,
      watermark,
    },
  } : {
    model,
    content,
    generate_audio: generateAudio,
    resolution,
    ratio,
    duration,
    watermark,
  };

  console.log('[painting batch] seedance submit start', {
    requestId,
    batchRunId: batchRun.batchRunId,
    taskId: task.id,
    directionNumber: task.directionNumber,
  });

  const upstreamRes = await fetch(upstreamUrl, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${apiKey}`,
      'Content-Type': 'application/json',
      ...(isWan3 ? { 'X-DashScope-Async': 'enable' } : {}),
    },
    body: JSON.stringify(requestPayload),
    signal: AbortSignal.timeout(60 * 1000),
  });

  const responseText = await upstreamRes.text();
  let json = null;
  try {
    json = responseText ? JSON.parse(responseText) : null;
  } catch {}

  if (!upstreamRes.ok) {
    const rawError = json?.error?.message || json?.message || json?.code || '';
    const error = new Error(translateUpstreamError(rawError, `${isMiniMaxH3 ? 'MiniMax H3' : isWan3 ? 'Wan3.0 Video' : 'Seedance'} 创建任务失败（状态码 ${upstreamRes.status}）`));
    error.statusCode = upstreamRes.status;
    throw error;
  }

  const rawTaskId = readValue(json?.id, json?.data?.id, json?.task_id, json?.taskId, json?.output?.task_id);
  const seedanceTaskId = isMiniMaxH3 && rawTaskId
    ? encodeMiniMaxH3TaskId(rawTaskId)
    : isWan3 && rawTaskId
      ? encodeWan3TaskId(rawTaskId)
      : rawTaskId;
  if (!seedanceTaskId) {
    throw new Error('Seedance 创建任务失败：服务端未返回任务编号');
  }

  console.log('[painting batch] seedance submit done', {
    requestId,
    batchRunId: batchRun.batchRunId,
    taskId: task.id,
    seedanceTaskId,
  });

  return { seedanceTaskId, response: json };
}

async function pollSeedanceTaskForBatch(seedanceTaskId) {
  const task = await fetchManualVideoGenerationTask(seedanceTaskId);
  return { status: task.status, videoUrl: task.videoUrl, response: task.payload };
}

async function downloadAndSaveSeedanceVideoForBatch(seedanceTaskId, folderName, batchMeta) {
  const taskResult = await fetchManualVideoGenerationTask(seedanceTaskId);
  const taskPayload = taskResult.payload;
  const videoUrl = taskResult.videoUrl;
  if (!videoUrl) {
    throw new Error('这条生成记录还没有可保存的视频');
  }

  const videoResponse = await fetch(videoUrl, {
    headers: {
      'User-Agent': DOUYIN_USER_AGENT,
      Accept: 'video/mp4,video/*;q=0.9,application/octet-stream;q=0.8',
    },
    signal: AbortSignal.timeout(2 * 60 * 1000),
  });
  if (!videoResponse.ok) {
    throw new Error(`生成视频下载失败（HTTP ${videoResponse.status}）`);
  }
  const contentType = readValue(videoResponse.headers.get('content-type')).toLowerCase();
  if (contentType.includes('text/html') || contentType.includes('application/json')) {
    await videoResponse.body?.cancel().catch(() => {});
    throw new Error('生成视频链接已失效');
  }

  const buffer = await readVideoLibraryRemoteBuffer(videoResponse);
  if (!buffer.length) {
    throw new Error('生成视频文件为空');
  }
  if (buffer.length < 12 || buffer.subarray(4, 8).toString('ascii') !== 'ftyp') {
    throw new Error('生成结果不是有效的 MP4 文件');
  }
  const sha256 = createHash('sha256').update(buffer).digest('hex');
  const existing = dbFindVideoLibraryByHash(sha256);
  if (existing) {
    const enhancementResult = await queueVideoEnhancementForLibraryItem(existing, { enabled: batchMeta.autoEnhance480p === true });
    return { item: enhancementResult.item || existing, duplicate: true, sourceBytes: buffer.length, savedBytes: existing.fileSize, enhancement: enhancementResult };
  }

  const taskCreatedAt = Number(taskPayload?.created_at || taskPayload?.data?.created_at || 0);
  const paintingPosition = getPaintingFrameworkPosition(batchMeta.directionNumber);
  const originalName = formatPaintingSeedanceVideoLibraryName(taskCreatedAt, batchMeta.directionNumber);
  const storedName = `${sha256}.mp4`;
  await ensureVideoLibraryDir();
  const filePath = path.join(VIDEO_LIBRARY_DIR, storedName);
  await writeFile(filePath, buffer);
  const savedFile = await stat(filePath);
  if (savedFile.size !== buffer.length) {
    throw new Error('保存后文件大小校验失败');
  }

  const note = formatVideoLibrarySourceNote({
    model: batchMeta.model,
    directionNumber: batchMeta.directionNumber,
  });
  let item = dbInsertVideoLibraryItem({
    folderName,
    originalName,
    storedName,
    mimeType: 'video/mp4',
    fileSize: savedFile.size,
    sha256,
    note,
  });
  void ensureVideoLibraryPreview({ id: item.id, stored_name: storedName, sha256 }).catch(() => {});
  void ensureVideoLibraryThumbnail({ id: item.id, stored_name: storedName, sha256 }).catch((thumbnailError) => {
    console.warn('[painting batch] thumbnail_generation_failed', {
      id: item.id,
      taskId: seedanceTaskId,
      message: thumbnailError?.message || '',
    });
  });
  const enhancementResult = await queueVideoEnhancementForLibraryItem(item, { enabled: batchMeta.autoEnhance480p === true });
  item = enhancementResult.item || item;
  return { item, duplicate: false, sourceBytes: buffer.length, savedBytes: item.fileSize, enhancement: enhancementResult };
}

// 提示词多样性提交锁：并发生成后，串行地对“已提交提示词”做相似度复核，避免两个并发任务
// 读取到相同的旧账本后各自生成、互不比较。相似度过高时至少重写其中一条。
const paintingBatchDiversityCommitMutex = new PaintingBatchSemaphore(1);

async function rewritePromptForDiversity(requestId, apiKey, profile, idea, context, referencePrompts, initialPrompt, initialDuration) {
  let finalPrompt = initialPrompt;
  let finalDuration = initialDuration;
  let rewriteAttempt = 0;
  const refs = referencePrompts.slice();
  while (refs.length > 0 && rewriteAttempt < 2) {
    const maxSimilarity = Math.max(...refs.map((p) => paintingPromptSimilarity(finalPrompt, p)));
    if (maxSimilarity < PAINTING_BATCH_PROMPT_SIMILARITY_THRESHOLD) break;
    rewriteAttempt += 1;
    const rewrite = await generatePaintingIdeaPromptCore(`${requestId}-rewrite${rewriteAttempt}`, apiKey, profile, idea, {
      ...context,
      avoidElements: refs.slice(-12).map((p) => extractPaintingDiversitySummary(p).snippet).filter(Boolean),
      extraRequirements: `${context.extraRequirements || ''}\n【必须重写】本条提示词与同批量其他方向相似度过高（${Math.round(maxSimilarity * 100)}%）。必须更换场景、人物、服装、家具陈设、光线时段、镜头运动路径中的至少 3 项，同时保留固定方向的大框架、产品真实尺寸和物理逻辑。禁止只改房间名称或衣服颜色。`.trim(),
    });
    finalPrompt = rewrite.prompt;
    finalDuration = rewrite.duration;
  }
  return { prompt: finalPrompt, duration: finalDuration };
}

async function generatePromptForBatchTask(task, batchRun, previousPrompts) {
  const requestId = randomBytes(6).toString('hex');
  const apiKey = readValue(SERVER_CONFIG.arkApiKey);
  if (!apiKey) {
    throw new Error('服务端未配置 ARK_API_KEY');
  }

  const idea = {
    id: task.ideaId,
    title: task.ideaTitle,
    summary: task.ideaSummary,
    directionNumber: task.directionNumber,
    durationMin: task.duration || batchRun.plan?.durationMin,
    durationMax: task.duration || batchRun.plan?.durationMax,
    ratio: batchRun.ratio,
    stylePreset: batchRun.stylePreset,
  };

  const context = {
    ...batchRun.plan,
    ratio: batchRun.ratio,
    stylePreset: batchRun.stylePreset,
    elementVariationIndex: batchRun.variationRound,
    previousPrompt: '',
    avoidElements: previousPrompts.slice(-8).map((p) => extractPaintingDiversitySummary(p).snippet).filter(Boolean),
  };

  let previousPromptsForDirection = [];
  if (batchRun.variationRound > 0) {
    const previousTasks = dbGetPaintingBatchTasks(batchRun.batchRunId)
      .filter((t) => t.directionNumber === task.directionNumber && t.variationRound < batchRun.variationRound && t.prompt)
      .sort((a, b) => a.variationRound - b.variationRound);
    if (previousTasks.length > 0) {
      context.previousPrompt = previousTasks[previousTasks.length - 1].prompt;
      previousPromptsForDirection = previousTasks.map((t) => t.prompt);
    }
  }

  let lastError = null;
  for (let attempt = 0; attempt <= PAINTING_BATCH_PROMPT_RETRY_MAX; attempt += 1) {
    try {
      const { prompt, duration } = await generatePaintingIdeaPromptCore(requestId, apiKey, batchRun.profile, idea, context);

      const allPrevious = [...previousPrompts, ...previousPromptsForDirection];
      return rewritePromptForDiversity(requestId, apiKey, batchRun.profile, idea, context, allPrevious, prompt, duration);
    } catch (error) {
      lastError = error;
      if (attempt < PAINTING_BATCH_PROMPT_RETRY_MAX) {
        const delay = Math.min(8000, 1000 * Math.pow(2, attempt));
        console.warn('[painting batch] prompt generation retry', { requestId, attempt, delay, message: error?.message });
        await sleepMs(delay);
      }
    }
  }
  throw lastError || new Error('完整提示词生成失败');
}

// 在提示词生成完成后、写入数据库前，串行地对最新“已提交提示词”做相似度复核。
// 因为生成阶段是并发的，两个任务可能都基于同一个旧快照生成、互不比较；
// 这里加锁后重新读取已提交的提示词，若发现相似度过高则重写，保证并发生成仍会互相比较。
async function commitBatchPromptWithDiversity(task, batchRun, initialPrompt, initialDuration) {
  await paintingBatchDiversityCommitMutex.acquire();
  try {
    const apiKey = readValue(SERVER_CONFIG.arkApiKey);
    const idea = {
      id: task.ideaId,
      title: task.ideaTitle,
      summary: task.ideaSummary,
      directionNumber: task.directionNumber,
      durationMin: task.duration || batchRun.plan?.durationMin,
      durationMax: task.duration || batchRun.plan?.durationMax,
      ratio: batchRun.ratio,
      stylePreset: batchRun.stylePreset,
    };
    const context = {
      ...batchRun.plan,
      ratio: batchRun.ratio,
      stylePreset: batchRun.stylePreset,
      elementVariationIndex: batchRun.variationRound,
      previousPrompt: '',
      avoidElements: [],
    };
    // 重新读取已提交提示词（排除自身），捕获并发生成的竞态。
    const committedPrompts = dbGetPaintingBatchTasks(task.batchRunId)
      .filter((t) => t.id !== task.id && t.prompt && t.status !== 'failed' && t.status !== 'stopped')
      .map((t) => t.prompt);
    const { prompt, duration } = await rewritePromptForDiversity(
      `diversity-${randomBytes(3).toString('hex')}`,
      apiKey,
      batchRun.profile,
      idea,
      context,
      committedPrompts,
      initialPrompt,
      initialDuration
    );
    dbUpdatePaintingBatchTask(task.id, {
      prompt,
      duration,
      status: 'prompt_ready',
      retryCount: 0,
      diversityLedger: extractPaintingDiversitySummary(prompt),
    });
  } finally {
    paintingBatchDiversityCommitMutex.release();
  }
}

async function processBatchTask(taskId) {
  let task = dbGetPaintingBatchTask(taskId);
  if (!task) return;
  const batchRun = dbGetPaintingBatchRun(task.batchRunId);
  if (!batchRun) return;

  const terminalStatuses = new Set(['completed', 'failed', 'stopped', 'needs_review']);
  if (terminalStatuses.has(task.status)) {
    return;
  }

  // 暂停：未提交任务保持暂停（由调度器决定是否推进），已提交任务仍可继续收尾。
  if (batchRun.controlStatus === 'paused') {
    if (!task.seedanceTaskId) {
      dbUpdatePaintingBatchTask(task.id, { status: 'paused' });
      return;
    }
  }

  // 终止/停止：未提交任务直接停止，已提交任务继续轮询与入库收尾。
  if (batchRun.controlStatus === 'stopping' || batchRun.controlStatus === 'stopped') {
    if (!task.seedanceTaskId) {
      dbUpdatePaintingBatchTask(task.id, { status: 'stopped' });
      return;
    }
  }

  if (task.status === 'queued' || task.status === 'generating_prompt' || (task.status === 'retry_waiting' && !task.seedanceTaskId)) {
    dbUpdatePaintingBatchTask(task.id, { status: 'generating_prompt', errorMessage: '' });
    await paintingBatchPromptSemaphore.acquire();
    try {
      task = dbGetPaintingBatchTask(task.id);
      if (!task || terminalStatuses.has(task.status)) return;
      const currentRun = dbGetPaintingBatchRun(task.batchRunId);
      if (!currentRun || currentRun.controlStatus === 'stopping' || currentRun.controlStatus === 'stopped' || currentRun.controlStatus === 'paused') {
        dbUpdatePaintingBatchTask(task.id, { status: currentRun?.controlStatus === 'paused' ? 'paused' : 'stopped' });
        return;
      }
      const previousTasks = dbGetPaintingBatchTasks(task.batchRunId)
        .filter((t) => t.id !== task.id && t.prompt && t.status !== 'failed' && t.status !== 'stopped')
        .sort((a, b) => a.id - b.id);
      const previousPrompts = previousTasks.map((t) => t.prompt);
      const generated = await generatePromptForBatchTask(task, currentRun, previousPrompts);
      // 串行提交 + 对最新“已提交提示词”做相似度复核，修复并发生成互不比较的竞态。
      await commitBatchPromptWithDiversity(task, currentRun, generated.prompt, generated.duration);
    } catch (error) {
      const nextRetryCount = (task.retryCount || 0) + 1;
      if (nextRetryCount > PAINTING_BATCH_PROMPT_RETRY_MAX) {
        dbUpdatePaintingBatchTask(task.id, {
          status: 'failed',
          retryCount: nextRetryCount,
          errorMessage: `提示词生成失败：${error?.message || '未知错误'}`,
        });
      } else {
        dbUpdatePaintingBatchTask(task.id, {
          status: 'retry_waiting',
          retryCount: nextRetryCount,
          errorMessage: `提示词生成失败（第 ${nextRetryCount} 次重试）：${error?.message || '未知错误'}`,
        });
      }
      return;
    } finally {
      paintingBatchPromptSemaphore.release();
    }
  }

  task = dbGetPaintingBatchTask(task.id);
  if (!task || terminalStatuses.has(task.status)) return;

  if (task.status === 'prompt_ready' || (task.status === 'retry_waiting' && task.seedanceTaskId)) {
    if (task.seedanceTaskId) {
      dbUpdatePaintingBatchTask(task.id, { status: 'seedance_submitted' });
    } else {
      dbUpdatePaintingBatchTask(task.id, { status: 'submitting_seedance', errorMessage: '' });
      await paintingBatchSeedanceSubmitSemaphore.acquire();
      try {
        task = dbGetPaintingBatchTask(task.id);
        if (!task || terminalStatuses.has(task.status)) return;
        const currentRun = dbGetPaintingBatchRun(task.batchRunId);
        if (!currentRun || currentRun.controlStatus === 'stopping' || currentRun.controlStatus === 'stopped' || currentRun.controlStatus === 'paused') {
          dbUpdatePaintingBatchTask(task.id, { status: currentRun?.controlStatus === 'paused' ? 'paused' : 'stopped' });
          return;
        }

        const { seedanceTaskId } = await submitSeedanceTaskForBatchTask(task, currentRun);
        dbUpdatePaintingBatchTask(task.id, {
          seedanceTaskId,
          status: 'seedance_submitted',
          retryCount: 0,
          errorMessage: '',
        });
        // 提交到 Seedance 即视为该方向已被使用（“仅生成未使用方向”的服务端持久化依据）。
        dbMarkPaintingDirectionUsed(currentRun.imageHash, currentRun.variationRound, task.directionNumber);
        await sleepMs(PAINTING_BATCH_SEEDANCE_SUBMIT_INTERVAL_MS);
      } catch (error) {
        const nextRetryCount = (task.retryCount || 0) + 1;
        const isFuzzy = isFuzzySeedanceTimeout(error);
        if (isFuzzy) {
          dbUpdatePaintingBatchTask(task.id, {
            status: 'needs_review',
            retryCount: nextRetryCount,
            errorMessage: `提交 Seedance 时超时，无法确认是否已扣费：${error?.message || '未知错误'}`,
          });
        } else if (nextRetryCount > PAINTING_BATCH_SEEDANCE_RETRY_MAX) {
          dbUpdatePaintingBatchTask(task.id, {
            status: 'failed',
            retryCount: nextRetryCount,
            errorMessage: `提交 Seedance 失败：${error?.message || '未知错误'}`,
          });
        } else {
          dbUpdatePaintingBatchTask(task.id, {
            status: 'retry_waiting',
            retryCount: nextRetryCount,
            errorMessage: `提交 Seedance 失败（第 ${nextRetryCount} 次重试）：${error?.message || '未知错误'}`,
          });
          await sleepMs(Math.min(16000, 2000 * Math.pow(2, nextRetryCount - 1)));
        }
        return;
      } finally {
        paintingBatchSeedanceSubmitSemaphore.release();
      }
    }
  }

  task = dbGetPaintingBatchTask(task.id);
  if (!task || terminalStatuses.has(task.status)) return;

  if (task.status === 'seedance_submitted' || task.status === 'rendering') {
    dbUpdatePaintingBatchTask(task.id, { status: 'rendering', errorMessage: '' });
    await paintingBatchRenderSemaphore.acquire();
    try {
      const startedAt = Date.now();
      while (true) {
        task = dbGetPaintingBatchTask(task.id);
        const currentRun = dbGetPaintingBatchRun(task.batchRunId);
        if (!currentRun) {
          dbUpdatePaintingBatchTask(task.id, { status: 'failed', errorMessage: '批量任务不存在，无法继续轮询' });
          return;
        }
        // 终止/暂停后：已提交任务仍继续轮询与入库，不因 controlStatus 变化而中断（收尾语义）。
        if (!task.seedanceTaskId) {
          dbUpdatePaintingBatchTask(task.id, { status: 'failed', errorMessage: '缺少 Seedance 任务编号' });
          return;
        }

        try {
          const poll = await pollSeedanceTaskForBatch(task.seedanceTaskId);
          if (poll.videoUrl) {
            dbUpdatePaintingBatchTask(task.id, {
              status: 'video_succeeded',
              videoUrl: poll.videoUrl,
              errorMessage: '',
            });
            break;
          }
          const statusLower = String(poll.status || '').toLowerCase();
          if (['succeed', 'succeeded', 'success', 'completed', 'done'].includes(statusLower)) {
            if (poll.videoUrl) {
              dbUpdatePaintingBatchTask(task.id, {
                status: 'video_succeeded',
                videoUrl: poll.videoUrl,
                errorMessage: '',
              });
              break;
            }
            await sleepMs(3000);
            continue;
          }
          if (['failed', 'failure', 'error'].includes(statusLower)) {
            const nextRetryCount = (task.retryCount || 0) + 1;
            if (nextRetryCount > PAINTING_BATCH_SEEDANCE_RETRY_MAX) {
              dbUpdatePaintingBatchTask(task.id, {
                status: 'failed',
                retryCount: nextRetryCount,
                errorMessage: `Seedance 渲染失败：${statusLower}`,
              });
            } else {
              dbUpdatePaintingBatchTask(task.id, {
                status: 'retry_waiting',
                retryCount: nextRetryCount,
                seedanceTaskId: '',
                errorMessage: `Seedance 渲染失败（第 ${nextRetryCount} 次重试）：${statusLower}`,
              });
            }
            return;
          }
        } catch (pollError) {
          console.warn('[painting batch] seedance poll error', {
            batchRunId: task.batchRunId,
            taskId: task.id,
            seedanceTaskId: task.seedanceTaskId,
            message: pollError?.message,
          });
        }

        if (Date.now() - startedAt > PAINTING_BATCH_TASK_TIMEOUT_MS) {
          dbUpdatePaintingBatchTask(task.id, {
            status: 'failed',
            errorMessage: 'Seedance 渲染等待超过 15 分钟',
          });
          return;
        }
        await sleepMs(4000);
      }
    } finally {
      paintingBatchRenderSemaphore.release();
    }
  }

  task = dbGetPaintingBatchTask(task.id);
  if (!task || terminalStatuses.has(task.status)) return;

  if (task.status === 'video_succeeded' || task.status === 'saving_to_library') {
    dbUpdatePaintingBatchTask(task.id, { status: 'saving_to_library', errorMessage: '' });
    try {
      const currentRun = dbGetPaintingBatchRun(task.batchRunId);
      if (!currentRun || !currentRun.targetFolderName) {
        throw new Error('未绑定视频素材库文件夹');
      }
      const folderName = dbGetVideoLibraryFolderNameById(currentRun.targetFolderId) || currentRun.targetFolderName;
      const saveResult = await downloadAndSaveSeedanceVideoForBatch(task.seedanceTaskId, folderName, {
        batchRunId: currentRun.batchRunId,
        paintingName: currentRun.paintingName,
        directionNumber: task.directionNumber,
        ideaTitle: task.ideaTitle,
        variationRound: task.variationRound,
        model: currentRun.model,
        autoEnhance480p: currentRun.options?.autoEnhance480p === true,
      });
      dbUpdatePaintingBatchTask(task.id, {
        status: 'completed',
        libraryItemId: saveResult.item?.id || null,
        libraryItem: saveResult.item,
        saveRetryCount: 0,
        errorMessage: saveResult.duplicate ? '视频已存在，未重复保存' : '',
      });
    } catch (error) {
      const nextSaveRetry = (task.saveRetryCount || 0) + 1;
      if (nextSaveRetry > PAINTING_BATCH_SAVE_RETRY_MAX) {
        dbUpdatePaintingBatchTask(task.id, {
          status: 'failed',
          saveRetryCount: nextSaveRetry,
          errorMessage: `保存素材库失败：${error?.message || '未知错误'}`,
        });
      } else {
        dbUpdatePaintingBatchTask(task.id, {
          status: 'video_succeeded',
          saveRetryCount: nextSaveRetry,
          errorMessage: `保存素材库失败（第 ${nextSaveRetry} 次重试）：${error?.message || '未知错误'}`,
        });
        await sleepMs(Math.min(16000, 2000 * Math.pow(2, nextSaveRetry - 1)));
      }
    }
  }
}

const PAINTING_BATCH_TASK_FINAL_STATUSES = new Set(['completed', 'failed', 'stopped', 'needs_review']);

function isBatchTaskDraining(task) {
  // 已提交到 Seedance 但尚未收尾（仍需轮询/入库）。
  return Boolean(task.seedanceTaskId) && ['seedance_submitted', 'rendering', 'video_succeeded', 'saving_to_library'].includes(task.status);
}

function isBatchTaskPending(task) {
  // 尚未提交到 Seedance，仍需推进（提示词/提交），含 paused 这种等待恢复的状态。
  return !task.seedanceTaskId && !PAINTING_BATCH_TASK_FINAL_STATUSES.has(task.status);
}

// 受控批量流水线：并发派发任务，真正的并行度由提示词/提交/渲染三级信号量控制，
// 不会一次性同时提交 40 条；每个任务生命周期内部仍是“提示词 -> 提交 -> 轮询 -> 入库”。
async function runBatchTaskPool(taskIds) {
  let index = 0;
  const limit = Math.min(PAINTING_BATCH_DISPATCH_CONCURRENCY, taskIds.length);
  const worker = async () => {
    while (index < taskIds.length) {
      const taskId = taskIds[index];
      index += 1;
      try {
        await processBatchTask(taskId);
      } catch (error) {
        console.error('[painting batch] task processing error', { taskId, message: error?.message });
        dbUpdatePaintingBatchTask(taskId, { status: 'failed', errorMessage: `处理任务异常：${error?.message || '未知错误'}` });
      }
    }
  };
  const workers = [];
  for (let i = 0; i < limit; i += 1) workers.push(worker());
  await Promise.all(workers);
}

function finalizeBatchRun(batchRunId) {
  const run = dbGetPaintingBatchRun(batchRunId);
  if (!run) return;
  const tasks = dbGetPaintingBatchTasks(batchRunId);
  const hasNeedsReview = tasks.some((t) => t.status === 'needs_review');
  const hasFailed = tasks.some((t) => t.status === 'failed');
  const wasTerminated = run.status === 'stopping' || run.status === 'stopped';
  const nextStatus = wasTerminated ? 'stopped' : (hasNeedsReview ? 'needs_review' : hasFailed ? 'failed' : 'completed');
  dbUpdatePaintingBatchRun(batchRunId, { status: nextStatus, controlStatus: 'stopped' });
}

async function processBatchRun(batchRunId) {
  if (paintingBatchRunActivePromises.has(batchRunId)) {
    return paintingBatchRunActivePromises.get(batchRunId);
  }

  const promise = (async () => {
    let run = dbGetPaintingBatchRun(batchRunId);
    if (!run) return;

    while (run) {
      run = dbGetPaintingBatchRun(batchRunId);
      if (!run) return;
      const control = run.controlStatus;

      if (control === 'paused') {
        // 暂停：未提交任务保持 paused，已提交任务继续收尾。
        const tasks = dbGetPaintingBatchTasks(batchRunId);
        const draining = tasks.filter(isBatchTaskDraining);
        for (const t of tasks) {
          if (isBatchTaskPending(t) && t.status !== 'paused') {
            dbUpdatePaintingBatchTask(t.id, { status: 'paused' });
          }
        }
        const hasPending = tasks.some((t) => isBatchTaskPending(t));
        if (draining.length) {
          await runBatchTaskPool(draining.map((t) => t.id));
        } else if (!hasPending) {
          finalizeBatchRun(batchRunId);
          break;
        } else {
          await sleepMs(1500);
        }
        continue;
      }

      if (control === 'stopping' || control === 'stopped') {
        // 终止：未提交任务直接停止，已提交任务继续轮询/入库，直到全部收尾完成。
        const tasks = dbGetPaintingBatchTasks(batchRunId);
        for (const t of tasks) {
          if (isBatchTaskPending(t)) {
            dbUpdatePaintingBatchTask(t.id, { status: 'stopped', errorMessage: t.errorMessage || '批量任务已终止' });
          }
        }
        const draining = tasks.filter(isBatchTaskDraining);
        if (draining.length) {
          await runBatchTaskPool(draining.map((t) => t.id));
          continue;
        }
        finalizeBatchRun(batchRunId);
        break;
      }

      // running
      const tasks = dbGetPaintingBatchTasks(batchRunId);
      const active = tasks.filter((t) => !PAINTING_BATCH_TASK_FINAL_STATUSES.has(t.status));
      if (active.length === 0) {
        finalizeBatchRun(batchRunId);
        break;
      }
      await runBatchTaskPool(active.map((t) => t.id));
    }
  })();

  paintingBatchRunActivePromises.set(batchRunId, promise);
  promise.finally(() => paintingBatchRunActivePromises.delete(batchRunId));
  return promise;
}

function enqueueBatchRun(batchRunId) {
  if (!paintingBatchRunQueue.includes(batchRunId)) {
    paintingBatchRunQueue.push(batchRunId);
  }
  if (!paintingBatchRunProcessorActive) {
    paintingBatchRunProcessorActive = true;
    void runPaintingBatchRunProcessor();
  }
}

async function runPaintingBatchRunProcessor() {
  while (paintingBatchRunQueue.length > 0) {
    const batchRunId = paintingBatchRunQueue.shift();
    try {
      await processBatchRun(batchRunId);
    } catch (error) {
      console.error('[painting batch] processor run failed', { batchRunId, message: error?.message });
      dbUpdatePaintingBatchRun(batchRunId, { status: 'failed', controlStatus: 'stopped' });
    }
  }
  paintingBatchRunProcessorActive = false;
}

async function resumePaintingBatchRunsOnStartup() {
  try {
    getCollectionDb();
    const activeRuns = dbGetActivePaintingBatchRuns();
    console.log('[painting batch] resume on startup', { count: activeRuns.length });
    for (const run of activeRuns) {
      // 暂停中的批次也要恢复：已提交任务继续轮询/入库，但不再提交新的排队任务，保持暂停状态。
      const tasks = dbGetPaintingBatchTasks(run.batchRunId);
      for (const task of tasks) {
        if (task.status === 'submitting_seedance') {
          // 提交中被打断，无法确认是否已扣费：置为待复核，绝不自动重复提交（避免重复扣费）。
          dbUpdatePaintingBatchTask(task.id, {
            status: 'needs_review',
            errorMessage: '服务重启时提交状态无法确认，系统未自动重复提交，请人工复核是否已生成视频',
          });
        } else if (task.status === 'saving_to_library') {
          dbUpdatePaintingBatchTask(task.id, {
            status: 'video_succeeded',
            errorMessage: `服务重启后恢复保存：${task.errorMessage || '继续处理'}`,
          });
        } else if (['queued', 'generating_prompt'].includes(task.status)) {
          // 尚未提交到 Seedance，可安全重跑提示词。
          dbUpdatePaintingBatchTask(task.id, {
            status: 'retry_waiting',
            errorMessage: `服务重启后恢复：${task.errorMessage || '继续处理'}`,
          });
        }
        // prompt_ready / seedance_submitted / rendering / video_succeeded 保持原状态，由调度器继续推进。
      }
      enqueueBatchRun(run.batchRunId);
    }
  } catch (error) {
    console.error('[painting batch] resume on startup failed', error?.message || '');
  }
}

// ===== 文案创作（copywriting）=====
// 挂画分析 / AI 原创 10 条 / 爆款仿写 3 版，全部复用豆包 Seed 2.1 多模态 + callDoubaoArkText。
// 独立文案库存储于 RUNTIME_STATE_DIR/creative-copy-library.json，不动现有任何运行状态文件。

function normalizeCopyItem(item, index) {
  const hook = readValue(item?.hook);
  const content = readValue(item?.content);
  const closing = readValue(item?.closing);
  const fullText = readValue(item?.fullText) || [hook, content, closing].filter(Boolean).join('\n');
  return {
    id: readValue(item?.id) || `copy-${index + 1}`,
    mode: readValue(item?.mode) === 'explore' ? 'explore' : 'stable',
    direction: readValue(item?.direction) || (readValue(item?.mode) === 'explore' ? '探索' : '稳定'),
    targetLength: Number(item?.targetLength) === 250 ? 250 : 350,
    title: readValue(item?.title),
    hook,
    content,
    closing,
    fullText
  };
}

function normalizeCopyItems(copies) {
  return (Array.isArray(copies) ? copies : [])
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => normalizeCopyItem(item, index))
    .filter((item) => item.fullText);
}

function normalizeCopyProfile(profile) {
  const source = profile && typeof profile === 'object' && !Array.isArray(profile) ? profile : {};
  const text = (value) => {
    if (typeof value === 'string') return value.trim();
    if (typeof value === 'number' || typeof value === 'boolean') return String(value);
    if (Array.isArray(value)) return value.map(text).filter(Boolean).join('；');
    if (value && typeof value === 'object') return Object.values(value).map(text).filter(Boolean).join('；');
    return '';
  };
  const list = (value) => {
    if (Array.isArray(value)) return value.map(text).filter(Boolean);
    const valueText = text(value);
    return valueText ? valueText.split(/[\n,，；;]+/).map((item) => item.trim()).filter(Boolean) : [];
  };

  return {
    name: text(source.name),
    visualDescription: text(source.visualDescription),
    colors: list(source.colors),
    style: text(source.style),
    textCalligraphySeals: text(source.textCalligraphySeals),
    material: text(source.material),
    structure: text(source.structure),
    suitableScenes: list(source.suitableScenes),
    targetAudiences: list(source.targetAudiences),
    meanings: list(source.meanings),
    sellingPoints: list(source.sellingPoints),
    uncertainClaims: list(source.uncertainClaims)
  };
}

async function generateSingleCopy({ apiKey, profile, extraInfo, forbidden, mode, direction, targetLength, excludeTexts }) {
  const { min, max } = copyWordCountBoundary(targetLength);
  // 模型字数浮动较大（实测常写到 350～400 字），放宽到较宽容差直接通过；只有明显偏离档位才触发修正重写。
  const acceptMin = min - 30;
  const acceptMax = max + 50;
  const exploreHint = '反常识或观点冲突、热门生活话题、人物第一视角、家庭关系、传统文化的新解释、情绪治愈、装修审美、送礼场景、由画面文字引发的人生思考';
  const directionLine = mode === 'explore'
    ? `- 类型：探索型（mode=explore），请从以下角度挑选一个新角度作为创作方向并填入 direction 字段：${exploreHint}`
    : `- 类型：稳定型（mode=stable），创作方向固定为「${direction || '稳定'}」，与其他稳定型文案（痛点解决、寓意价值、空间改造、人物共鸣、故事情绪、购买转化）在立意与开头要明显区分、不要趋同。`;
  const avoidTexts = (Array.isArray(excludeTexts) ? excludeTexts : []).filter((t) => typeof t === 'string' && t.trim());
  const avoidLine = avoidTexts.length
    ? `\n【避免重复】请与以下已生成文案明显区分、不要雷同：\n${avoidTexts.slice(0, 6).map((t, i) => `${i + 1}. ${t.slice(0, 80)}`).join('\n')}`
    : '';

  const buildPrompt = (correction) => `你是短视频口播文案创作专家。请为下面的挂画创作一条口播文案。

【挂画档案（产品事实以此为准，不得虚构）】
${JSON.stringify(profile, null, 2)}
${extraInfo ? `\n【用户补充信息】\n${extraInfo}` : ''}
${forbidden ? `\n【禁止出现的内容】\n${forbidden}` : ''}

【本条要求】
${directionLine}
- 字数：${targetLength} 字档（${min}～${max} 字，忽略空白字符计数，不得为凑字数重复；写完后请自行数一遍，超出就删减、不足就补充）
${avoidLine}
【结构】开头钩子（前 1～3 句）+ 中间展开 + 自然转化；口语化、适合真人口播；不虚构历史出处/销量/功效/名人评价、不夸大风水财富健康。

【输出格式】严格只输出一个 JSON 对象：
{"id":"1","mode":"${mode}","direction":"${mode === 'explore' ? '创作方向' : (direction || '稳定')}","targetLength":${targetLength},"title":"","hook":"","content":"","closing":"","fullText":""}
不要输出任何解释文字，不要用 markdown 代码块包裹。${correction}`;

  const run = async (correction) => {
    const answer = await callDoubaoArkText({
      apiKey,
      model: DEFAULT_DOUBAO_MULTIMODAL_MODEL,
      content: [{ type: 'input_text', text: buildPrompt(correction) }],
      timeoutMs: DOUBAO_COPY_TEXT_TIMEOUT_MS
    });
    const parsed = parseStructuredJson(answer);
    const copyObj = parsed?.copy && typeof parsed.copy === 'object'
      ? parsed.copy
      : (parsed && typeof parsed === 'object' && readValue(parsed.fullText) ? parsed : null);
    if (!copyObj) {
      throw Object.assign(new Error('模型未返回有效文案'), { rawText: answer });
    }
    const copy = normalizeCopyItem(copyObj, 0);
    copy.mode = mode;
    copy.direction = direction || copy.direction;
    copy.targetLength = targetLength;
    if (!copy.fullText) {
      throw Object.assign(new Error('模型返回的文案为空'), { rawText: answer });
    }
    return { copy, chars: countChars(copy.fullText), answer };
  };

  // 第一次生成（网络错误自动重试一次）。
  let result = await withRetryOnce(() => run(''));

  // 字数明显偏离目标档位时，带具体字数做一次修正重写。
  if (result.chars < acceptMin || result.chars > acceptMax) {
    const correction = `\n\n【字数修正】你上一次输出的文案共 ${result.chars} 字，${result.chars > max ? '超出' : '不足'} ${targetLength} 字档的要求（${min}～${max} 字）。请重写，把字数严格控制在 ${min}～${max} 字之间，不要为凑字数重复。`;
    result = await withRetryOnce(() => run(correction));
  }

  // 字数只做软约束：明显偏离时已尽力修正一次，不再因字数硬性失败整批（用户可对单条再编辑/重生成）。
  if (result.chars < acceptMin || result.chars > acceptMax) {
    console.warn('[doubao copy] word count soft-accept', { targetLength, chars: result.chars, min, max });
  }

  return result.copy;
}

function copyWordCountBoundary(targetLength) {
  return targetLength === 250 ? { min: 235, max: 265 } : { min: 330, max: 370 };
}

function validateCopies(copies) {
  if (!copies.length) return '模型未返回有效文案';
  if (copies.length !== 10) return `文案数量不正确（应为 10 条，实得 ${copies.length} 条）`;

  const count350 = copies.filter((c) => c.targetLength === 350).length;
  const count250 = copies.filter((c) => c.targetLength === 250).length;
  if (count350 !== 7 || count250 !== 3) {
    return `字数档位不正确（350 字应为 7 条、250 字应为 3 条，实得 350:${count350}、250:${count250}）`;
  }

  const stableCount = copies.filter((c) => c.mode === 'stable').length;
  if (stableCount !== 6) return `稳定型应为 6 条，实得 ${stableCount} 条`;

  for (const copy of copies) {
    const chars = countChars(copy.fullText);
    const { min, max } = copyWordCountBoundary(copy.targetLength);
    if (chars < min || chars > max) {
      return `「${copy.direction || copy.id}」字数 ${chars} 不在 ${min}~${max} 区间`;
    }
  }

  for (let i = 0; i < copies.length; i += 1) {
    for (let j = i + 1; j < copies.length; j += 1) {
      if (textSimilarity(copies[i].fullText, copies[j].fullText) > 0.85) {
        return `第 ${i + 1} 条与第 ${j + 1} 条内容高度重复`;
      }
    }
  }

  return null;
}

function normalizeRewriteVersions(versions) {
  const labels = ['稳定保守版', '情绪强化版', '结构重组版'];
  return (Array.isArray(versions) ? versions : [])
    .filter((item) => item && typeof item === 'object')
    .map((item, index) => ({
      version: readValue(item?.version) || labels[index] || `版本${index + 1}`,
      content: readValue(item?.content) || readValue(item?.fullText) || ''
    }))
    .filter((item) => item.content);
}

async function handleCopyAnalyze(req, res) {
  const requestId = randomBytes(6).toString('hex');
  try {
    const apiKey = readValue(SERVER_CONFIG.arkApiKey);
    if (!apiKey) {
      sendJson(res, 500, { error: '服务端未配置 ARK_API_KEY' });
      return;
    }

    const body = isMultipartFormRequest(req)
      ? await readMultipartFormBody(req)
      : await readRequestBody(req);

    let imageUrl = '';
    if (body.file instanceof File && body.file.size > 0) {
      const compressedFile = await compressMediaForArk(body.file, 'image');
      const normalized = await normalizeUploadedMediaInput(compressedFile, 'image');
      imageUrl = normalized.imageUrl;
    } else if (readValue(body.image)) {
      imageUrl = normalizeBase64ImageInput(body.image, body.imageMimeType).imageUrl;
    } else {
      sendJson(res, 400, { error: '请先上传挂画图片。' });
      return;
    }

    const name = readValue(body.name);
    const extraInfo = readValue(body.extraInfo);
    const sellingPoints = readValue(body.sellingPoints);
    const forbidden = readValue(body.forbidden);

    const prompt = `你是专业的挂画/卷轴产品分析专家。请仔细分析下面这张挂画/装饰画图片，输出一个「挂画档案」JSON 对象。

${name ? `用户提供的挂画名称：${name}\n` : ''}${extraInfo ? `用户补充的产品信息：${extraInfo}\n` : ''}${sellingPoints ? `用户提供的核心寓意或卖点：${sellingPoints}\n` : ''}${forbidden ? `用户明确禁止出现、不可编造的内容：${forbidden}\n` : ''}
要求输出以下字段（能用中文就用中文描述，无法从图片判断的字段用空字符串或空数组，不要臆造）：
- name：挂画名称
- visualDescription：画面主体和内容（画了什么、构图、有无人物/山水/花鸟/书法等）
- colors：主要颜色数组（如 ["墨黑","赭石","宣纸白"]）
- style：视觉风格（如国画、书法、油画、装饰画、现代简约等）
- textCalligraphySeals：画面中的文字、书法内容、印章（没有则为空字符串）
- material：材质与形态（宣纸、绢布、油画布、亚克力等）
- structure：边框、木条、挂轴和挂绳结构（形状、颜色、材质、粗细）
- suitableScenes：适合悬挂的空间数组（如 ["客厅","书房","茶室","玄关"]）
- targetAudiences：适合的人群数组（如 ["中年人","读书人","家庭经营者"]）
- meanings：核心寓意和情绪价值数组
- sellingPoints：可以表达的产品卖点数组
- uncertainClaims：图片无法确定、不可随意编造的信息数组（如具体年代、作者、材质真假、风水功效等）

严格只输出一个合法 JSON 对象，不要输出任何解释文字，不要用 markdown 代码块包裹。`;

    console.log('[doubao copy] analyze request start', { requestId, hasFile: body.file instanceof File, fileSize: body.file?.size || 0 });

    const answer = await withRetryOnce(() => callDoubaoArkText({
      apiKey,
      model: DEFAULT_DOUBAO_MULTIMODAL_MODEL,
      content: [
        { type: 'input_image', image_url: imageUrl },
        { type: 'input_text', text: prompt }
      ]
    }));

    const profile = normalizeCopyProfile(parseStructuredJson(answer));
    console.log('[doubao copy] analyze done', { requestId, profileKeys: profile && typeof profile === 'object' ? Object.keys(profile) : [] });
    sendJson(res, 200, { ok: true, profile });
  } catch (error) {
    console.error('[doubao copy] analyze failed', { requestId, message: error?.message || '' });
    sendJson(res, 500, {
      error: error?.message || '挂画分析失败',
      debug: { stage: 'analyze', rawText: error?.rawText }
    });
  }
}

// 「生成 10 条文案」「爆款文案仿写」是分钟级长任务，同步等待会被线上 Nginx（约 60s 读超时）切断成 504。
// 因此改为异步任务：POST 立即返回 taskId，前端轮询 GET /api/copy/tasks/:taskId 拿进度和结果。
const COPY_GENERATE_TASKS = new Map(); // taskId -> task
const COPY_GENERATE_TASK_TTL_MS = 30 * 60 * 1000;
const COPY_GENERATE_TASK_MAX = 100;

function pruneCopyGenerateTasks() {
  const now = Date.now();
  for (const [id, task] of COPY_GENERATE_TASKS) {
    if (task.doneAt && now - task.doneAt > COPY_GENERATE_TASK_TTL_MS) COPY_GENERATE_TASKS.delete(id);
  }
  while (COPY_GENERATE_TASKS.size > COPY_GENERATE_TASK_MAX) {
    const oldestKey = COPY_GENERATE_TASKS.keys().next().value;
    COPY_GENERATE_TASKS.delete(oldestKey);
  }
}

async function runCopyGenerateTask(task, { apiKey, profile, extraInfo, forbidden }) {
  const requestId = task.id;
  try {
    const stableSpecs = [
      { direction: '痛点解决', targetLength: 350 },
      { direction: '寓意价值', targetLength: 350 },
      { direction: '空间改造', targetLength: 350 },
      { direction: '人物共鸣', targetLength: 350 },
      { direction: '故事情绪', targetLength: 350 },
      { direction: '购买转化', targetLength: 250 },
    ];
    const exploreLengths = [350, 350, 250, 250];

    console.log('[doubao copy] generate request start', { requestId });

    // 拆成单条小请求（并发），避免一次性生成 10 条导致方舟 504 超时。每完成一条更新任务进度。
    const stableCopies = await mapWithConcurrency(stableSpecs, 3, async (spec) => {
      const copy = await generateSingleCopy({ apiKey, profile, extraInfo, forbidden, mode: 'stable', direction: spec.direction, targetLength: spec.targetLength, excludeTexts: [] });
      task.progress.completed += 1;
      return copy;
    });

    const stableTexts = stableCopies.map((c) => c.fullText).filter(Boolean);
    const exploreCopies = await mapWithConcurrency(exploreLengths, 2, async (targetLength) => {
      const copy = await generateSingleCopy({ apiKey, profile, extraInfo, forbidden, mode: 'explore', direction: '', targetLength, excludeTexts: stableTexts });
      task.progress.completed += 1;
      return copy;
    });

    const copies = [...stableCopies, ...exploreCopies];

    // 去重兜底：若仍有两条高度重复，重写靠后那条一次。
    const duplicatePair = findDuplicatePair(copies);
    if (duplicatePair) {
      const laterIndex = duplicatePair[1];
      const target = copies[laterIndex];
      const excludeTexts = copies.filter((_, index) => index !== laterIndex).map((c) => c.fullText).filter(Boolean);
      try {
        copies[laterIndex] = await generateSingleCopy({ apiKey, profile, extraInfo, forbidden, mode: target.mode, direction: target.direction, targetLength: target.targetLength, excludeTexts });
      } catch {
        // 保留原结果，宁可用已有文案也不中断整批。
      }
    }

    copies.forEach((c, index) => { c.id = `copy-${index + 1}`; });

    task.copies = copies;
    task.error = '';
    task.status = 'done';
    task.doneAt = Date.now();
    console.log('[doubao copy] generate done', { requestId, count: copies.length });
  } catch (error) {
    task.status = 'failed';
    task.error = error?.message || '原创文案生成失败';
    task.debug = { stage: 'generate', rawText: error?.rawText };
    task.doneAt = Date.now();
    console.error('[doubao copy] generate failed', { requestId, message: error?.message || '' });
  }
}

async function handleCopyGenerate(req, res) {
  try {
    const apiKey = readValue(SERVER_CONFIG.arkApiKey);
    if (!apiKey) {
      sendJson(res, 500, { error: '服务端未配置 ARK_API_KEY' });
      return;
    }

    const body = await readRequestBody(req);
    const profile = body.profile && typeof body.profile === 'object' ? body.profile : null;
    if (!profile) {
      sendJson(res, 400, { error: '缺少挂画档案 profile' });
      return;
    }
    const extraInfo = readValue(body.extraInfo);
    const forbidden = readValue(body.forbidden);

    pruneCopyGenerateTasks();
    const task = {
      id: `copytask-${randomBytes(8).toString('hex')}`,
      status: 'running',
      progress: { completed: 0, total: 10 },
      copies: null,
      error: '',
      debug: null,
      createdAt: Date.now(),
      doneAt: 0
    };
    COPY_GENERATE_TASKS.set(task.id, task);

    // 后台执行，不被 await；所有异常都在 runCopyGenerateTask 内部消化，不会产生未处理 Promise。
    runCopyGenerateTask(task, { apiKey, profile, extraInfo, forbidden });

    sendJson(res, 202, { ok: true, taskId: task.id, status: task.status, progress: task.progress });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '原创文案生成失败' });
  }
}

function handleCopyGenerateTaskStatus(req, res, taskId) {
  const task = COPY_GENERATE_TASKS.get(readValue(taskId));
  if (!task || (task.doneAt && Date.now() - task.doneAt > COPY_GENERATE_TASK_TTL_MS)) {
    sendJson(res, 404, { error: '任务不存在或已过期' });
    return;
  }
  sendJson(res, 200, {
    ok: true,
    taskId: task.id,
    status: task.status,
    progress: task.progress,
    ...(task.status === 'done' ? { copies: task.copies } : {}),
    ...(task.status === 'done' && task.result ? { analysis: task.result.analysis, versions: task.result.versions } : {}),
    ...(task.status === 'failed' ? { error: task.error, debug: task.debug } : {})
  });
}

async function runCopyRewriteTask(task, { apiKey, originalText, profile, extraInfo, forbidden }) {
  const requestId = task.id;
  try {
    const prompt = `你是短视频文案仿写专家。请对用户粘贴的一条已在短视频平台取得较好效果的文案，先做结构分析，再输出 3 个仿写版本。

【原文】
${originalText}

【挂画档案（产品事实以此为准，与原文冲突时以档案为准）】
${JSON.stringify(profile, null, 2)}
${extraInfo ? `\n【用户补充信息】\n${extraInfo}` : ''}
${forbidden ? `\n【禁止出现的内容】\n${forbidden}` : ''}

【第一步：分析原文】输出以下字段：
- hookMechanism：开头钩子机制
- targetAudience：目标人群
- coreSellingPoint：核心卖点
- emotionProgression：情绪推进方式
- narrativeStructure：叙事结构
- conversionMethod：转化方式
- keepableCore：可以保留的核心意思
- claimsToDrop：不应继续使用的夸张或不实信息

【第二步：生成 3 个仿写版本】version 字段分别为：
1. 稳定保守版：保留原文传播逻辑，但重新表达。
2. 情绪强化版：加强人物、场景与情绪共鸣。
3. 结构重组版：改变叙述顺序、视角和展开方式。

【仿写要求】
- 保留核心意思、真实卖点和转化逻辑。
- 文字、句式、段落顺序、视角、场景举例和情绪铺垫都要重新组织，不能只做同义词替换，不得复制原文中的连续长句。
- 原文存在虚构或夸张内容时，不继续照搬；原文信息与挂画档案冲突时以档案为准。

【输出格式】
严格只输出一个 JSON 对象：
{"analysis":{"hookMechanism":"","targetAudience":"","coreSellingPoint":"","emotionProgression":"","narrativeStructure":"","conversionMethod":"","keepableCore":"","claimsToDrop":""},"versions":[{"version":"稳定保守版","content":"完整仿写文案"}]}
- versions 必须恰好 3 个，version 分别为「稳定保守版」「情绪强化版」「结构重组版」。
- 不要输出任何解释文字，不要用 markdown 代码块包裹。`;

    const build = async () => {
      const answer = await callDoubaoArkText({
        apiKey,
        model: DEFAULT_DOUBAO_MULTIMODAL_MODEL,
        content: [{ type: 'input_text', text: prompt }],
        timeoutMs: DOUBAO_COPY_TEXT_TIMEOUT_MS
      });
      const parsed = parseStructuredJson(answer);
      return {
        analysis: parsed?.analysis && typeof parsed.analysis === 'object' ? parsed.analysis : {},
        versions: Array.isArray(parsed?.versions) ? parsed.versions : [],
        answer
      };
    };

    console.log('[doubao copy] rewrite request start', { requestId, originalLength: countChars(originalText) });

    let result = await withRetryOnce(() => build());
    let versions = normalizeRewriteVersions(result.versions);
    if (!versions.length) {
      throw Object.assign(new Error('模型未返回有效仿写版本'), { rawText: result.answer });
    }

    const tooSimilar = versions.filter((v) => textSimilarity(v.content, originalText) > 0.35);
    if (tooSimilar.length) {
      console.warn('[doubao copy] rewrite similarity retry', { requestId, count: tooSimilar.length });
      const retry = await withRetryOnce(() => build());
      const retryVersions = normalizeRewriteVersions(retry.versions);
      if (retryVersions.length) {
        versions = versions.map((v) => {
          const replacement = retryVersions.find((rv) => rv.version === v.version);
          if (replacement && textSimilarity(replacement.content, originalText) <= 0.35) return replacement;
          return v;
        });
      }
    }

    console.log('[doubao copy] rewrite done', { requestId, count: versions.length });
    task.result = { analysis: result.analysis, versions };
    task.progress.completed = 1;
    task.error = '';
    task.status = 'done';
    task.doneAt = Date.now();
  } catch (error) {
    task.status = 'failed';
    task.error = error?.message || '爆款文案仿写失败';
    task.debug = { stage: 'rewrite', rawText: error?.rawText };
    task.doneAt = Date.now();
    console.error('[doubao copy] rewrite failed', { requestId, message: error?.message || '' });
  }
}

async function handleCopyRewrite(req, res) {
  try {
    const apiKey = readValue(SERVER_CONFIG.arkApiKey);
    if (!apiKey) {
      sendJson(res, 500, { error: '服务端未配置 ARK_API_KEY' });
      return;
    }

    const body = await readRequestBody(req);
    const originalText = readValue(body.originalText);
    if (!originalText) {
      sendJson(res, 400, { error: '请粘贴需要仿写的原文。' });
      return;
    }
    const profile = body.profile && typeof body.profile === 'object' ? body.profile : {};
    const extraInfo = readValue(body.extraInfo);
    const forbidden = readValue(body.forbidden);

    pruneCopyGenerateTasks();
    const task = {
      id: `copytask-${randomBytes(8).toString('hex')}`,
      status: 'running',
      progress: { completed: 0, total: 1 },
      copies: null,
      result: null,
      error: '',
      debug: null,
      createdAt: Date.now(),
      doneAt: 0
    };
    COPY_GENERATE_TASKS.set(task.id, task);

    // 后台执行，不被 await；所有异常都在 runCopyRewriteTask 内部消化，不会产生未处理 Promise。
    runCopyRewriteTask(task, { apiKey, originalText, profile, extraInfo, forbidden });

    sendJson(res, 202, { ok: true, taskId: task.id, status: task.status, progress: task.progress });
  } catch (error) {
    sendJson(res, 500, { error: error?.message || '爆款文案仿写失败' });
  }
}

async function handleCopyRegenerate(req, res) {
  const requestId = randomBytes(6).toString('hex');
  try {
    const apiKey = readValue(SERVER_CONFIG.arkApiKey);
    if (!apiKey) {
      sendJson(res, 500, { error: '服务端未配置 ARK_API_KEY' });
      return;
    }

    const body = await readRequestBody(req);
    const profile = body.profile && typeof body.profile === 'object' ? body.profile : null;
    if (!profile) {
      sendJson(res, 400, { error: '缺少挂画档案 profile' });
      return;
    }
    const target = body.target && typeof body.target === 'object' ? body.target : {};
    const mode = readValue(target.mode) === 'explore' ? 'explore' : 'stable';
    const direction = readValue(target.direction) || (mode === 'explore' ? '探索' : '稳定');
    const targetLength = Number(target.targetLength) === 250 ? 250 : 350;
    const extraInfo = readValue(body.extraInfo);
    const forbidden = readValue(body.forbidden);
    const excludeTexts = (Array.isArray(body.excludeTexts) ? body.excludeTexts : [])
      .filter((t) => typeof t === 'string' && t.trim());

    const { min, max } = copyWordCountBoundary(targetLength);

    const prompt = `你是短视频口播文案创作专家。请为下面的挂画重新创作一条口播文案。

【挂画档案（产品事实以此为准，不得虚构）】
${JSON.stringify(profile, null, 2)}
${extraInfo ? `\n【用户补充信息】\n${extraInfo}` : ''}
${forbidden ? `\n【禁止出现的内容】\n${forbidden}` : ''}

【本条要求】
- 类型：${mode === 'explore' ? '探索型' : '稳定型'}
- 创作方向：${direction}
- 字数：${targetLength} 字档（${min}～${max} 字，忽略空白字符计数，不得为凑字数重复；写完后请自行数一遍，超出就删减、不足就补充）
${excludeTexts.length ? `\n【避免重复】请与以下已生成文案明显区分、不要雷同：\n${excludeTexts.map((t, i) => `${i + 1}. ${t}`).join('\n')}` : ''}

【结构】开头钩子（前 1～3 句）+ 中间展开 + 自然转化；口语化、适合真人口播；不虚构历史出处/销量/功效/名人评价、不夸大风水财富健康。

【输出格式】严格只输出一个 JSON 对象：
{"id":"1","mode":"${mode}","direction":"${direction}","targetLength":${targetLength},"title":"","hook":"","content":"","closing":"","fullText":""}
不要输出任何解释文字，不要用 markdown 代码块包裹。`;

    console.log('[doubao copy] regenerate request start', { requestId, direction, targetLength });

    const answer = await withRetryOnce(() => callDoubaoArkText({
      apiKey,
      model: DEFAULT_DOUBAO_MULTIMODAL_MODEL,
      content: [{ type: 'input_text', text: prompt }],
      timeoutMs: DOUBAO_COPY_TEXT_TIMEOUT_MS
    }));

    const parsed = parseStructuredJson(answer);
    const copyObj = parsed?.copy && typeof parsed.copy === 'object'
      ? parsed.copy
      : (parsed && typeof parsed === 'object' && readValue(parsed.fullText) ? parsed : null);
    if (!copyObj) {
      throw Object.assign(new Error('模型未返回有效文案'), { rawText: answer });
    }

    const copy = normalizeCopyItem(copyObj, 0);
    copy.mode = mode;
    copy.direction = direction || copy.direction;
    copy.targetLength = targetLength;
    if (!copy.fullText) {
      throw Object.assign(new Error('模型返回的文案为空'), { rawText: answer });
    }
    const chars = countChars(copy.fullText);
    // 字数软约束：单条重生成不因字数浮动而失败，用户可在结果卡看到实际字数并继续编辑。
    if (chars < min - 30 || chars > max + 50) {
      console.warn('[doubao copy] regenerate word count soft-accept', { targetLength, chars, min, max });
    }

    console.log('[doubao copy] regenerate done', { requestId, chars });
    sendJson(res, 200, { ok: true, copy });
  } catch (error) {
    console.error('[doubao copy] regenerate failed', { requestId, message: error?.message || '' });
    sendJson(res, 500, {
      error: error?.message || '单独重新生成失败',
      debug: { stage: 'regenerate', rawText: error?.rawText }
    });
  }
}

async function handleCopyLibraryList(req, res, url) {
  try {
    const library = await loadCopyLibrary();
    const q = readValue(url.searchParams.get('q')).toLowerCase();
    let items = library.items;
    if (q) {
      items = items.filter((item) =>
        [item.fullText, item.direction, item.version, item.mode, item.title, JSON.stringify(item.profile || {})]
          .some((field) => String(field || '').toLowerCase().includes(q))
      );
    }
    sendJson(res, 200, { ok: true, items, total: items.length });
  } catch (error) {
    console.error('[copy library] list failed', { message: error?.message || '' });
    sendJson(res, 500, { error: error?.message || '读取文案库失败' });
  }
}

async function handleCopyLibraryCreate(req, res) {
  try {
    const body = await readRequestBody(req);
    const library = await loadCopyLibrary();
    const item = sanitizeCopyLibraryItem(body, {}, { touch: true });
    if (!item.fullText) {
      sendJson(res, 400, { error: '缺少文案内容 fullText' });
      return;
    }
    const items = await saveCopyLibrary([item, ...library.items]);
    sendJson(res, 200, { ok: true, item: items.find((i) => i.id === item.id) || item });
  } catch (error) {
    console.error('[copy library] create failed', { message: error?.message || '' });
    sendJson(res, 500, { error: error?.message || '保存到文案库失败' });
  }
}

async function handleCopyLibraryUpdate(req, res, id) {
  try {
    const body = await readRequestBody(req);
    const library = await loadCopyLibrary();
    const existing = library.items.find((item) => item.id === id);
    if (!existing) {
      sendJson(res, 404, { error: '文案不存在或已被删除' });
      return;
    }
    const item = sanitizeCopyLibraryItem({ ...body, id }, existing, { touch: true });
    const items = await saveCopyLibrary(library.items.map((i) => (i.id === id ? item : i)));
    sendJson(res, 200, { ok: true, item: items.find((i) => i.id === id) || item });
  } catch (error) {
    console.error('[copy library] update failed', { message: error?.message || '' });
    sendJson(res, 500, { error: error?.message || '更新文案失败' });
  }
}

async function handleCopyLibraryDelete(req, res, id) {
  try {
    const library = await loadCopyLibrary();
    const next = library.items.filter((item) => item.id !== id);
    if (next.length === library.items.length) {
      sendJson(res, 404, { error: '文案不存在或已被删除' });
      return;
    }
    await saveCopyLibrary(next);
    sendJson(res, 200, { ok: true });
  } catch (error) {
    console.error('[copy library] delete failed', { message: error?.message || '' });
    sendJson(res, 500, { error: error?.message || '删除文案失败' });
  }
}

function extractQwenCreativeDelta(payload) {
  const delta = payload?.choices?.[0]?.delta;
  if (!delta || typeof delta !== 'object') return '';
  if (typeof delta.content === 'string') return delta.content;
  if (!Array.isArray(delta.content)) return '';
  return delta.content
    .map((item) => (item && typeof item === 'object' && typeof item.text === 'string' ? item.text : ''))
    .join('');
}

async function proxyQwenCreativeStream(upstreamRes, req, res, requestId) {
  if (!upstreamRes.body) {
    writeSseEvent(res, 'error', { error: '千问未返回可读取的响应流' });
    res.end();
    return;
  }

  const reader = upstreamRes.body.getReader();
  const decoder = new TextDecoder();
  let buffer = '';
  let answer = '';
  let closedByClient = false;

  const abortStream = async () => {
    if (closedByClient) return;
    closedByClient = true;
    try {
      await reader.cancel();
    } catch {}
  };
  req.once('close', abortStream);

  const consumeLine = (line) => {
    const trimmed = String(line || '').replace(/\r$/, '').trim();
    if (!trimmed.startsWith('data:')) return false;
    const rawData = trimmed.slice(5).trim();
    if (!rawData) return false;
    if (rawData === '[DONE]') return true;

    let payload = null;
    try {
      payload = JSON.parse(rawData);
    } catch {
      return false;
    }

    const upstreamError = payload?.error?.message || payload?.error || '';
    if (upstreamError) {
      writeSseEvent(res, 'error', { error: String(upstreamError) });
      return false;
    }

    // reasoning_content intentionally stays server-side. Module one only
    // displays the final reverse prompt while Qwen can still think internally.
    const delta = extractQwenCreativeDelta(payload);
    if (delta) {
      answer += delta;
      writeSseEvent(res, 'answer.delta', { delta });
    }
    return false;
  };

  try {
    while (!closedByClient) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const lines = buffer.split('\n');
      buffer = lines.pop() || '';
      for (const line of lines) {
        consumeLine(line);
      }
    }

    buffer += decoder.decode();
    if (buffer.trim()) consumeLine(buffer);

    if (!closedByClient) {
      const normalizedAnswer = normalizeDoubaoDisplayText(answer);
      if (normalizedAnswer) {
        writeSseEvent(res, 'answer.done', { answer: normalizedAnswer, model: QWEN_CREATIVE_MULTIMODAL_MODEL });
      } else {
        writeSseEvent(res, 'error', { error: '千问已完成分析，但没有返回可用的提示词内容' });
      }
      res.end();
    }
  } catch (error) {
    console.error('[qwen creative multimodal] stream failed', { requestId, message: error?.message || '' });
    if (!closedByClient) {
      writeSseEvent(res, 'error', { error: error?.message || '千问流式响应中断' });
      res.end();
    }
  } finally {
    req.off('close', abortStream);
    try {
      reader.releaseLock();
    } catch {}
  }
}

async function handleQwenCreativeMultimodal(req, res) {
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
    const { question, history, mediaKind, file, files, filesKinds } = body;
    shouldStream = wantsDoubaoStream(body, req);
    const apiKey = readValue(SERVER_CONFIG.dashscopeApiKey);
    const resolvedQuestion = readValue(question);
    const hasUploadedFile = file instanceof File && file.size > 0;
    const hasMultipleFiles = Array.isArray(files) && files.length > 0;
    const enableThinking = false;

    if (!apiKey) {
      sendJson(res, 500, { error: '服务端未配置 DASHSCOPE_API_KEY' });
      return;
    }
    if (!resolvedQuestion) {
      sendJson(res, 400, { error: '缺少文本问题 question' });
      return;
    }

    const promptText = buildDoubaoPromptWithHistory(resolvedQuestion, history);
    const content = [];
    const uploadedMedia = hasMultipleFiles
      ? files.map((currentFile, index) => ({
          file: currentFile,
          kind: Array.isArray(filesKinds) && filesKinds[index]
            ? filesKinds[index]
            : String(currentFile.type || '').startsWith('image/') ? 'image' : 'video'
        }))
      : hasUploadedFile
        ? [{ file, kind: mediaKind === 'image' ? 'image' : 'video' }]
        : [];

    stage = 'normalize_uploaded_media';
    for (const media of uploadedMedia) {
      const resolvedMediaKind = media.kind === 'image' ? 'image' : 'video';
      let mediaUrl = '';

      if (resolvedMediaKind === 'video' && media.file.size > MAX_VIDEO_ORIGINAL_UPLOAD_BYTES) {
        const publicMedia = await createPublicMediaUrl({ file: media.file, req });
        if (!publicMedia.ok) {
          sendJson(res, 400, { error: publicMedia.error, debug: { stage, fileSize: media.file.size } });
          return;
        }
        mediaUrl = publicMedia.url;
      } else {
        const compressedFile = await compressMediaForArk(media.file, resolvedMediaKind);
        const normalizedMedia = await normalizeUploadedMediaInput(compressedFile, resolvedMediaKind);
        mediaUrl = resolvedMediaKind === 'image' ? normalizedMedia.imageUrl : normalizedMedia.videoUrl;
      }

      content.push(
        resolvedMediaKind === 'image'
          ? { type: 'image_url', image_url: { url: mediaUrl } }
          : { type: 'video_url', video_url: { url: mediaUrl }, fps: 2 }
      );
    }
    content.push({ type: 'text', text: promptText });

    const requestPayload = {
      model: QWEN_CREATIVE_MULTIMODAL_MODEL,
      messages: [{ role: 'user', content }],
      enable_thinking: enableThinking,
      stream: shouldStream
    };

    console.log('[qwen creative multimodal] request start', {
      requestId,
      model: QWEN_CREATIVE_MULTIMODAL_MODEL,
      stream: shouldStream,
      mediaCount: uploadedMedia.length,
      mediaKinds: uploadedMedia.map((item) => item.kind),
      thinking: enableThinking ? 'enabled' : 'disabled',
      elapsedMs: Date.now() - requestStartedAt
    });

    if (shouldStream) {
      stage = 'open_stream_to_client';
      startSseResponse(res);
      writeSseEvent(res, 'status', { stage: 'qwen_analyzing', model: QWEN_CREATIVE_MULTIMODAL_MODEL });
      waitingHeartbeat = setInterval(() => {
        try {
          res.write(': waiting_qwen\n\n');
        } catch {}
      }, 15000);
    }

    stage = 'request_upstream';
    const upstreamRes = await fetch(`${DASHSCOPE_API_BASE_URL}/chat/completions`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
        Accept: shouldStream ? 'text/event-stream' : 'application/json'
      },
      body: JSON.stringify(requestPayload),
      signal: AbortSignal.timeout(QWEN_CREATIVE_MULTIMODAL_TIMEOUT_MS)
    });

    if (waitingHeartbeat) {
      clearInterval(waitingHeartbeat);
      waitingHeartbeat = null;
    }

    if (!upstreamRes.ok) {
      const responseText = await upstreamRes.text();
      let payload = null;
      try {
        payload = JSON.parse(responseText);
      } catch {}
      const errorMessage = payload?.error?.message || payload?.message || responseText || `千问 API 请求失败（HTTP ${upstreamRes.status}）`;
      if (shouldStream) {
        writeSseEvent(res, 'error', { error: errorMessage });
        res.end();
      } else {
        sendJson(res, upstreamRes.status, { error: errorMessage, upstream: payload || responseText });
      }
      return;
    }

    const upstreamContentType = String(upstreamRes.headers.get('content-type') || '').toLowerCase();
    if (shouldStream && upstreamContentType.includes('text/event-stream')) {
      stage = 'proxy_stream';
      writeSseEvent(res, 'status', { stage: 'qwen_answering', model: QWEN_CREATIVE_MULTIMODAL_MODEL });
      await proxyQwenCreativeStream(upstreamRes, req, res, requestId);
      return;
    }

    stage = 'read_upstream_response';
    const responseText = await upstreamRes.text();
    let payload = null;
    try {
      payload = JSON.parse(responseText);
    } catch {}
    const answer = extractResponsesText(payload);

    if (shouldStream) {
      if (answer) {
        writeSseEvent(res, 'answer.done', { answer, model: QWEN_CREATIVE_MULTIMODAL_MODEL });
      } else {
        writeSseEvent(res, 'error', { error: '千问已完成分析，但没有返回可用的提示词内容' });
      }
      res.end();
      return;
    }

    sendJson(res, 200, {
      ok: true,
      model: QWEN_CREATIVE_MULTIMODAL_MODEL,
      answer,
      response: payload,
      debug: !answer ? { responseKeys: payload && typeof payload === 'object' ? Object.keys(payload) : [] } : undefined
    });
  } catch (error) {
    if (waitingHeartbeat) clearInterval(waitingHeartbeat);
    const isInputError =
      error?.message === '请求体不是合法 JSON' ||
      error?.message === '请求体过大' ||
      error?.message === '上传文件过大';
    const isTimeout =
      error?.name === 'TimeoutError' ||
      error?.name === 'AbortError' ||
      /timeout|timed out|aborted/i.test(String(error?.message || ''));
    const message = isInputError
      ? error.message
      : isTimeout
        ? '千问视频分析超时，系统将自动重试一次；如果仍失败，请稍后再试。'
        : `千问请求失败：${error?.message || '未知错误'}`;

    console.error('[qwen creative multimodal] request failed', {
      requestId,
      stage,
      message: error?.message || '',
      elapsedMs: Date.now() - requestStartedAt
    });

    if (shouldStream) {
      writeSseEvent(res, 'error', { error: message, debug: { stage } });
      res.end();
    } else {
      sendJson(res, isInputError ? 400 : isTimeout ? 504 : 500, { error: message, debug: { stage } });
    }
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

const MINIMAX_H3_MODEL = 'MiniMax-H3';
const MINIMAX_H3_TASK_PREFIX = 'minimax-h3_';
const WAN3_VIDEO_MODEL = 'wan3.0-video';
const WAN3_TASK_PREFIX = 'wan3_';
const DASHSCOPE_VIDEO_BASE_URL = readValue(process.env.DASHSCOPE_VIDEO_BASE_URL) || 'https://dashscope.aliyuncs.com';

function isWan3TaskId(taskId) {
  return readValue(taskId).startsWith(WAN3_TASK_PREFIX);
}

function encodeWan3TaskId(taskId) {
  const rawTaskId = readValue(taskId);
  return rawTaskId.startsWith(WAN3_TASK_PREFIX) ? rawTaskId : `${WAN3_TASK_PREFIX}${rawTaskId}`;
}

function decodeWan3TaskId(taskId) {
  return readValue(taskId).replace(new RegExp(`^${WAN3_TASK_PREFIX}`), '');
}

function isMiniMaxH3TaskId(taskId) {
  return readValue(taskId).startsWith(MINIMAX_H3_TASK_PREFIX);
}

function encodeMiniMaxH3TaskId(taskId) {
  const rawTaskId = readValue(taskId);
  return rawTaskId.startsWith(MINIMAX_H3_TASK_PREFIX)
    ? rawTaskId
    : `${MINIMAX_H3_TASK_PREFIX}${rawTaskId}`;
}

function decodeMiniMaxH3TaskId(taskId) {
  return readValue(taskId).replace(new RegExp(`^${MINIMAX_H3_TASK_PREFIX}`), '');
}

async function fetchManualVideoGenerationTask(taskId) {
  const normalizedTaskId = readValue(taskId);
  const isMiniMaxH3 = isMiniMaxH3TaskId(normalizedTaskId);
  const isWan3 = isWan3TaskId(normalizedTaskId);
  const providerLabel = isMiniMaxH3 ? 'MiniMax H3' : isWan3 ? 'Wan3.0 Video' : 'Seedance';
  const apiKey = isMiniMaxH3
    ? readValue(SERVER_CONFIG.minimaxApiKey)
    : isWan3
      ? readValue(SERVER_CONFIG.dashscopeApiKey)
    : readValue(SERVER_CONFIG.seedanceApiKey);
  if (!apiKey) {
    const error = new Error(`服务端未配置 ${isMiniMaxH3 ? 'MINIMAX_API_KEY' : isWan3 ? 'DASHSCOPE_API_KEY' : 'SEEDANCE_API_KEY'}`);
    error.statusCode = 500;
    throw error;
  }

  const upstreamTaskId = isMiniMaxH3 ? decodeMiniMaxH3TaskId(normalizedTaskId) : isWan3 ? decodeWan3TaskId(normalizedTaskId) : normalizedTaskId;
  const upstreamUrl = isMiniMaxH3
    ? `https://api.minimaxi.com/v2/query/video_generation/${encodeURIComponent(upstreamTaskId)}`
    : isWan3
      ? `${DASHSCOPE_VIDEO_BASE_URL}/api/v1/tasks/${encodeURIComponent(upstreamTaskId)}`
    : `https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks/${encodeURIComponent(upstreamTaskId)}`;
  const upstreamRes = await fetch(upstreamUrl, {
    method: 'GET',
    headers: { Authorization: `Bearer ${apiKey}` },
    signal: AbortSignal.timeout(60 * 1000),
  });
  const responseText = await upstreamRes.text();
  let payload = null;
  try {
    payload = responseText ? JSON.parse(responseText) : null;
  } catch {}
  if (!upstreamRes.ok) {
    const rawError = payload?.error?.message || payload?.message || payload?.code || '';
    const error = new Error(translateUpstreamError(rawError, `${providerLabel} 查询任务失败（状态码 ${upstreamRes.status}）`));
    error.statusCode = upstreamRes.status;
    error.upstream = payload || responseText;
    throw error;
  }

  const taskPayload = isMiniMaxH3 ? payload?.task : isWan3 ? payload?.output : payload;
  const parseTaskTimestamp = (value) => {
    if (typeof value === 'number' && Number.isFinite(value)) return value > 1e12 ? Math.floor(value / 1000) : Math.floor(value);
    const numeric = Number(value);
    if (Number.isFinite(numeric) && numeric > 0) return numeric > 1e12 ? Math.floor(numeric / 1000) : Math.floor(numeric);
    const parsed = Date.parse(readValue(value));
    return Number.isFinite(parsed) ? Math.floor(parsed / 1000) : undefined;
  };
  const errorMessage = readValue(
    taskPayload?.message,
    taskPayload?.error_message,
    taskPayload?.error?.message,
    payload?.message,
    payload?.error?.message,
  );
  return {
    provider: isMiniMaxH3 ? 'minimax-h3' : isWan3 ? 'wan3' : 'seedance',
    providerLabel,
    taskId: normalizedTaskId,
    status: isMiniMaxH3 ? readValue(taskPayload?.status) : isWan3 ? readValue(taskPayload?.task_status) : extractSeedanceStatus(payload),
    videoUrl: isMiniMaxH3 ? readValue(taskPayload?.content?.url) : isWan3 ? readValue(taskPayload?.video_url) : extractSeedanceVideoUrl(payload),
    createdAt: parseTaskTimestamp(taskPayload?.created_at || taskPayload?.submit_time || taskPayload?.created_time),
    updatedAt: parseTaskTimestamp(taskPayload?.updated_at || taskPayload?.end_time || taskPayload?.scheduled_time),
    errorMessage,
    payload,
  };
}

async function handleSeedanceGetTask(req, res, taskId) {
  const requestId = randomBytes(6).toString('hex');
  const startedAt = Date.now();

  try {
    const normalizedTaskId = readValue(taskId);

    if (!normalizedTaskId) {
      sendJson(res, 400, { error: '缺少视频生成任务 ID' });
      return;
    }

    const task = await fetchManualVideoGenerationTask(normalizedTaskId);

    sendJson(res, 200, {
      ok: true,
      taskId: normalizedTaskId,
      provider: task.provider,
      status: task.status,
      videoUrl: task.videoUrl,
      createdAt: task.createdAt,
      updatedAt: task.updatedAt,
      errorMessage: task.errorMessage,
      executionExpiresAfter: Number(task.payload?.execution_expires_after || task.payload?.data?.execution_expires_after || 0) || undefined,
      response: task.payload
    });
  } catch (error) {
    console.error('[seedance get task] request failed', {
      requestId,
      taskId,
      message: error?.message || '',
      stack: error?.stack || '',
      elapsedMs: Date.now() - startedAt
    });
    sendJson(res, Number(error?.statusCode) || 500, {
      error: translateUpstreamError(error?.message, 'Seedance 查询任务失败，请稍后重试。'),
      upstream: error?.upstream,
      debug: { originalMessage: error?.message || '' }
    });
  }
}

async function handleSeedanceCreateTask(req, res) {
  const requestId = randomBytes(6).toString('hex');
  const startedAt = Date.now();

  try {
    const body = isMultipartFormRequest(req)
      ? await readSeedanceTaskFormBody(req)
      : await readRequestBody(req);
    const model = readValue(body?.model) || 'doubao-seedance-2-0-260128';
    const taskMode = readValue(body?.taskMode) || 'generate';
    const resolution = readValue(body?.resolution) || '720p';
    const ratio = readValue(body?.ratio) || '16:9';
    const duration = Number.parseInt(String(body?.duration || 5), 10);
    const isSeedance25 = model === 'doubao-seedance-2-5-260628';
    const isSeedanceMini = model === 'doubao-seedance-2-0-mini-260615';
    const isSeedanceFast = model === 'doubao-seedance-2-0-fast-260128';
    const isMiniMaxH3 = model === MINIMAX_H3_MODEL;
    const isWan3 = model === WAN3_VIDEO_MODEL;
    const manualDirection = Number(body?.directionNumber) || 0;
    let prompt = ensurePaintingRollingUnfoldInstruction(readValue(body?.prompt), manualDirection);
    if (isWan3) {
      prompt = ensureWan3PaintingStructureLock(prompt, manualDirection);
    }
    prompt = ensurePaintingProductFocusedEnding(prompt);
    if (isWan3) {
      prompt = ensureWan3CameraMotionLock(prompt);
    }
    const modelLabel = isMiniMaxH3 ? 'MiniMax H3' : isWan3 ? 'Wan3.0 Video' : isSeedance25 ? 'Seedance 2.5' : isSeedanceMini ? 'Seedance 2.0 mini' : isSeedanceFast ? 'Seedance 2.0 Fast' : 'Seedance 2.0';
    const resolvedApiKey = isMiniMaxH3
      ? readValue(SERVER_CONFIG.minimaxApiKey)
      : isWan3
        ? readValue(SERVER_CONFIG.dashscopeApiKey)
      : readValue(SERVER_CONFIG.seedanceApiKey);
    const isVideoEditTask = taskMode === 'video_edit';
    const generateAudio = body?.generateAudio !== false;
    const watermark = body?.watermark === true;
    const uploadedFiles = Array.isArray(body?.files) ? body.files : [];

    console.log('[seedance create task] request start', {
      requestId,
      model,
      taskMode,
      resolution,
      ratio,
      duration,
      generateAudio,
      watermark,
      promptLength: prompt.length,
      fileCount: uploadedFiles.length
    });

    if (!resolvedApiKey) {
      sendJson(res, 500, { error: `服务端未配置 ${isMiniMaxH3 ? 'MINIMAX_API_KEY' : isWan3 ? 'DASHSCOPE_API_KEY' : 'SEEDANCE_API_KEY'}` });
      return;
    }

    if (!prompt) {
      sendJson(res, 400, { error: '缺少视频生成提示词 prompt' });
      return;
    }

    if (!['doubao-seedance-2-0-260128', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-mini-260615', 'doubao-seedance-2-5-260628', MINIMAX_H3_MODEL, WAN3_VIDEO_MODEL].includes(model)) {
      sendJson(res, 400, { error: '不支持的视频生成模型' });
      return;
    }

    if (!['generate', 'video_edit'].includes(taskMode)) {
      sendJson(res, 400, { error: '不支持的 Seedance 任务类型' });
      return;
    }

    const supportedResolutions = isMiniMaxH3
      ? ['768p']
      : isWan3
        ? ['480p', '720p', '1080p']
      : isSeedance25 || isSeedanceMini || isSeedanceFast
        ? ['480p', '720p']
        : ['480p', '720p', '1080p', '4k'];
    if (!supportedResolutions.includes(resolution)) {
      sendJson(res, 400, {
        error: `${modelLabel} 不支持 ${resolution} 分辨率，可选：${supportedResolutions.join('、')}`
      });
      return;
    }

    if (isVideoEditTask && !isSeedance25) {
      sendJson(res, 400, { error: '视频直接换画仅支持 Seedance 2.5' });
      return;
    }

    if (isMiniMaxH3 && prompt.length > 7000) {
      sendJson(res, 400, { error: 'MiniMax H3 的提示词最多支持 7000 个字符，请适当精简后重试。' });
      return;
    }

    if (!['16:9', '4:3', '1:1', '3:4', '9:16', '21:9', 'adaptive'].includes(ratio)) {
      sendJson(res, 400, { error: 'ratio 取值不合法' });
      return;
    }

    const maxDuration = isSeedance25 || isWan3 ? 30 : 15;
    const minDuration = isWan3 ? 2 : 4;
    if (isVideoEditTask && (ratio !== 'adaptive' || duration !== -1)) {
      sendJson(res, 400, { error: 'Seedance 2.5 视频编辑必须使用智能比例并跟随原视频时长' });
      return;
    }
    if (!isVideoEditTask && (!Number.isInteger(duration) || duration < minDuration || duration > maxDuration)) {
      sendJson(res, 400, { error: `${modelLabel} 的 duration 需为 ${minDuration} 到 ${maxDuration} 秒之间的整数` });
      return;
    }

    const maxImageCount = isMiniMaxH3 ? 5 : isWan3 ? 10 : isSeedance25 ? 30 : 9;
    const maxVideoCount = isMiniMaxH3 ? 0 : isWan3 ? 5 : isSeedance25 ? 10 : 3;
    const maxAudioCount = isMiniMaxH3 ? 0 : isWan3 ? 5 : isSeedance25 ? 10 : 3;
    if (uploadedFiles.length > (isMiniMaxH3 ? 5 : isWan3 ? 10 : isSeedance25 ? 50 : 13)) {
      sendJson(res, 400, { error: `${modelLabel} 最多支持 ${maxImageCount} 张图片、${maxVideoCount} 个视频、${maxAudioCount} 段音频，请减少上传数量。` });
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
        if (imageCount > maxImageCount) {
          sendJson(res, 400, { error: `${modelLabel} 最多支持 ${maxImageCount} 张参考图片。` });
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
        if (isMiniMaxH3) {
          sendJson(res, 400, { error: 'H3试验版当前只接入参考图片，不接入参考视频；请移除视频素材后重试。' });
          return;
        }
        if (isVideoEditTask && !['video/mp4', 'video/quicktime'].includes(mimeType) && !/\.(mp4|mov)$/i.test(readValue(file.name))) {
          sendJson(res, 400, { error: 'Seedance 2.5 视频编辑仅支持 MP4 或 MOV 原视频。' });
          return;
        }
        videoCount += 1;
        if (videoCount > maxVideoCount) {
          sendJson(res, 400, { error: `${modelLabel} 最多支持 ${maxVideoCount} 个参考视频。` });
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
        if (isMiniMaxH3) {
          sendJson(res, 400, { error: 'H3试验版当前只接入参考图片，不接入参考音频；请移除音频素材后重试。' });
          return;
        }
        audioCount += 1;
        if (audioCount > maxAudioCount) {
          sendJson(res, 400, { error: `${modelLabel} 最多支持 ${maxAudioCount} 段参考音频。` });
          return;
        }
        if (file.size > 15 * 1024 * 1024) {
          sendJson(res, 400, { error: 'Seedance 参考音频单个文件不能超过 15MB。' });
          return;
        }
        const normalized = isWan3 ? null : await normalizeUploadedAudioInput(file);
        const mediaResult = isWan3 ? await createPublicMediaUrl({ file, req }) : null;
        if (isWan3 && !mediaResult?.ok) {
          sendJson(res, 400, { error: mediaResult?.error || '音频参考上传失败，请检查 PUBLIC_BASE_URL 配置。' });
          return;
        }
        content.push({
          type: 'audio_url',
          audio_url: {
            url: isWan3 ? mediaResult.url : normalized.audioUrl
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

    if (isVideoEditTask && (videoCount !== 1 || imageCount !== 1 || audioCount !== 0)) {
      sendJson(res, 400, { error: '视频直接换画需要且只能上传 1 个原视频和 1 张目标挂画图片' });
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

    const wanMedia = isWan3 ? content.slice(1).map((item) => ({
      type: item.type === 'image_url' ? 'reference_image' : item.type === 'video_url' ? 'reference_video' : 'reference_audio',
      url: item.image_url?.url || item.video_url?.url || item.audio_url?.url,
    })) : [];
    const upstreamUrl = isMiniMaxH3
      ? 'https://api.minimaxi.com/v2/video_generation'
      : isWan3
        ? `${DASHSCOPE_VIDEO_BASE_URL}/api/v1/services/aigc/video-generation/video-synthesis`
      : 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
    const requestPayload = isMiniMaxH3
      ? {
          model: MINIMAX_H3_MODEL,
          content,
          resolution: '768P',
          ratio,
          duration,
          aigc_watermark: watermark,
        }
      : isWan3 ? {
          model: WAN3_VIDEO_MODEL,
          input: { prompt, ...(wanMedia.length ? { media: wanMedia } : {}) },
          parameters: {
            resolution: resolution.toUpperCase(),
            ratio,
            duration,
            audio: generateAudio,
            prompt_extend: false,
            watermark,
          },
        } : {
          model,
          content,
          generate_audio: generateAudio,
          resolution,
          ratio,
          duration,
          watermark
        };

    console.log('[seedance create task] upstream payload preview', {
      requestId,
      resolution,
      contentTypes: content.map((c) => ({ type: c.type, role: c.role })),
      referenceVideoCount: referenceVideoUrls.length,
    });

    const upstreamRes = await fetch(upstreamUrl, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${resolvedApiKey}`,
        'Content-Type': 'application/json',
        ...(isWan3 ? { 'X-DashScope-Async': 'enable' } : {}),
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
        error: translateUpstreamError(rawError, `${modelLabel} 创建任务失败（状态码 ${upstreamRes.status}）`),
        upstream: json || responseText
      });
      return;
    }

    const upstreamTaskId = readValue(json?.id, json?.data?.id, json?.task_id, json?.taskId, json?.output?.task_id);
    const taskId = isMiniMaxH3 && upstreamTaskId ? encodeMiniMaxH3TaskId(upstreamTaskId) : isWan3 && upstreamTaskId ? encodeWan3TaskId(upstreamTaskId) : upstreamTaskId;
    console.log('[seedance create task] request complete', {
      requestId,
      taskId,
      elapsedMs: Date.now() - startedAt
    });

    // 手动 / 换一轮（remix）提交成功后，标记该方向已被使用（“仅生成未使用方向”的服务端持久化依据）。
    const manualImageHash = String(body?.imageHash || '');
    const manualVariationRound = Number(body?.variationRound) || 0;
    if (manualImageHash && manualDirection && taskId) {
      dbMarkPaintingDirectionUsed(manualImageHash, manualVariationRound, manualDirection);
    }

    sendJson(res, 200, {
      ok: true,
      taskId,
      provider: isMiniMaxH3 ? 'minimax-h3' : isWan3 ? 'wan3' : 'seedance',
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
      error: isBodyParseError ? error.message : translateUpstreamError(error?.message, '视频生成任务创建失败，请稍后重试。'),
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

  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/media-enhancement-input/')) {
    const token = decodeURIComponent(url.pathname.slice('/media-enhancement-input/'.length));
    await handlePublicEnhancementInput(req, res, token);
    return;
  }

  const isDebugDownloadBypass = String(process.env.DOWNLOAD_DEBUG_BYPASS_AUTH || '').trim().toLowerCase() === 'true';
  const isDownloadDebugRoute = url.pathname === '/api/douyin/download-video' || url.pathname === '/api/douyin/video-stream';

  if (url.pathname.startsWith('/api/') && !isAuthRoute && !isAuthenticated(req) && !(isDebugDownloadBypass && isDownloadDebugRoute)) {
    sendJson(res, 401, { error: '未登录或登录已失效' });
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/home/culture-mottos') {
    await handleGetHomeCultureMottos(req, res);
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/home/culture-mottos') {
    await handleUpdateHomeCultureMottos(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/team-timeline') {
    await handleGetTeamTimeline(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/team-timeline') {
    await handleCreateTeamTimeline(req, res);
    return;
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/api/team-timeline/')) {
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/team-timeline\//, ''));
    await handleUpdateTeamTimeline(req, res, id);
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/team-timeline/')) {
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/team-timeline\//, ''));
    await handleDeleteTeamTimeline(req, res, id);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/creative-feeding/settings') {
    await handleGetCreativeFeedingSettings(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/creative-feeding/settings') {
    await handleSaveCreativeFeedingSettings(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/creative-feeding/openings') {
    await handleGetCreativeOpenings(req, res, url);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/creative-feeding/openings') {
    await handleCreateCreativeOpening(req, res);
    return;
  }

  if (req.method === 'PUT' && url.pathname.startsWith('/api/creative-feeding/openings/')) {
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/creative-feeding\/openings\//, ''));
    await handleUpdateCreativeOpening(req, res, id);
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/creative-feeding/openings/')) {
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/creative-feeding\/openings\//, ''));
    await handleDeleteCreativeOpening(req, res, id);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/creative-feeding/generate') {
    await handleGenerateCreativeFeeding(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/creative-feeding/analyze-image') {
    await handleAnalyzeCreativeFeedingImage(req, res);
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

  if (req.method === 'POST' && url.pathname === '/api/qwen/multimodal') {
    await handleQwenCreativeMultimodal(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/painting/analyze') {
    await handlePaintingAnalyze(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/painting/ideas') {
    await handlePaintingIdeas(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/painting/idea-prompt') {
    await handlePaintingIdeaPrompt(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/painting/tasks/')) {
    const taskId = decodeURIComponent(url.pathname.replace(/^\/api\/painting\/tasks\//, ''));
    handlePaintingTaskStatus(req, res, taskId);
    return;
  }

  // 挂画全自动批量任务路由
  if (req.method === 'GET' && url.pathname === '/api/painting/batch-runs') {
    await handleListPaintingBatchRuns(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/painting/batch-runs/estimate') {
    await handleGetPaintingBatchRunEstimate(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/painting/batch-runs') {
    await handleCreatePaintingBatchRun(req, res);
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/painting/batch-runs/')) {
    await handleDeletePaintingBatchRun(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/painting/batch-runs/by-request/')) {
    await handleGetPaintingBatchRunByRequest(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/painting/batch-runs/')) {
    await handleGetPaintingBatchRun(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/painting/batch-runs/') && url.pathname.endsWith('/pause')) {
    await handlePausePaintingBatchRun(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/painting/batch-runs/') && url.pathname.endsWith('/resume')) {
    await handleResumePaintingBatchRun(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/painting/batch-runs/') && url.pathname.endsWith('/stop')) {
    await handleStopPaintingBatchRun(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/painting/batch-tasks/') && url.pathname.endsWith('/retry')) {
    await handleRetryPaintingBatchTask(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/painting/batch-tasks/') && url.pathname.endsWith('/resubmit')) {
    await handleResubmitPaintingBatchTask(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/painting/folder-binding') {
    await handleSetPaintingFolderBinding(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/painting/folder-binding/')) {
    await handleGetPaintingFolderBinding(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/painting/used-directions') {
    await handleGetPaintingUsedDirections(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/copy/analyze') {
    await handleCopyAnalyze(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/copy/generate') {
    await handleCopyGenerate(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/copy/tasks/')) {
    const taskId = decodeURIComponent(url.pathname.replace(/^\/api\/copy\/tasks\//, ''));
    handleCopyGenerateTaskStatus(req, res, taskId);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/copy/rewrite') {
    await handleCopyRewrite(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/copy/regenerate') {
    await handleCopyRegenerate(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/copy/library') {
    await handleCopyLibraryList(req, res, url);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/copy/library') {
    await handleCopyLibraryCreate(req, res);
    return;
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/copy/library/')) {
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/copy\/library\//, ''));
    await handleCopyLibraryUpdate(req, res, id);
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/copy/library/')) {
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/copy\/library\//, ''));
    await handleCopyLibraryDelete(req, res, id);
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

  // Store overview routes
  if (req.method === 'GET' && url.pathname === '/api/store-overview/graph') {
    await handleGetStoreOverviewGraph(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/store-overview/debug') {
    await handleStoreOverviewDebug(req, res);
    return;
  }

  if (req.method === 'PUT' && url.pathname === '/api/store-overview/settings') {
    await handleUpdateStoreOverviewSettings(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/store-overview/nodes') {
    await handleCreateStoreOverviewNode(req, res);
    return;
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/store-overview/nodes/')) {
    const id = url.pathname.replace(/^\/api\/store-overview\/nodes\//, '');
    await handleUpdateStoreOverviewNode(req, res, id);
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/store-overview/nodes/')) {
    const id = url.pathname.replace(/^\/api\/store-overview\/nodes\//, '');
    await handleDeleteStoreOverviewNode(req, res, id);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/store-overview/edges') {
    await handleCreateStoreOverviewEdge(req, res);
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/store-overview/edges/')) {
    const id = url.pathname.replace(/^\/api\/store-overview\/edges\//, '');
    await handleDeleteStoreOverviewEdge(req, res, id);
    return;
  }

  // Shared video library routes
  if (req.method === 'GET' && url.pathname === '/api/video-library/videos') {
    await handleGetVideoLibrary(req, res, url);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/video-library/folders') {
    await handleGetVideoLibraryFolders(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/api/video-library/summary') {
    await handleGetVideoLibrarySummary(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/video-library/folders') {
    await handleCreateVideoLibraryFolder(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/video-library/import-seedance') {
    await handleSaveSeedanceVideoToLibrary(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/video-library/videos') {
    await handleUploadVideoLibrary(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/video-library/enhancements/') && url.pathname.endsWith('/retry')) {
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/video-library\/enhancements\//, '').replace(/\/retry$/, ''));
    const task = retryVideoEnhancementTask(id);
    if (!task) sendJson(res, 404, { error: '画质增强任务不存在' });
    else sendJson(res, 200, { ok: true, task });
    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/api/video-library/videos/') && url.pathname.endsWith('/enhance')) {
    const id = decodeURIComponent(url.pathname.replace(/^\/api\/video-library\/videos\//, '').replace(/\/enhance$/, ''));
    await handleStartVideoEnhancement(req, res, id);
    return;
  }

  if (req.method === 'PATCH' && url.pathname.startsWith('/api/video-library/videos/')) {
    const id = url.pathname.replace(/^\/api\/video-library\/videos\//, '');
    await handleUpdateVideoLibrary(req, res, id);
    return;
  }

  if (req.method === 'DELETE' && url.pathname.startsWith('/api/video-library/videos/')) {
    const id = url.pathname.replace(/^\/api\/video-library\/videos\//, '');
    await handleDeleteVideoLibrary(req, res, id);
    return;
  }

  if ((req.method === 'GET' || req.method === 'HEAD') && url.pathname.startsWith('/api/video-library/videos/') && url.pathname.endsWith('/file')) {
    const id = url.pathname.replace(/^\/api\/video-library\/videos\//, '').replace(/\/file$/, '');
    await handleVideoLibraryFile(req, res, id, url);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/api/video-library/videos/') && url.pathname.endsWith('/thumbnail')) {
    const id = url.pathname.replace(/^\/api\/video-library\/videos\//, '').replace(/\/thumbnail$/, '');
    await handleVideoLibraryThumbnail(req, res, id);
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

  const imageTaskResultMatch = url.pathname.match(/^\/api\/image\/tasks\/(\d+)\/results\/(\d+)$/);
  if (req.method === 'GET' && imageTaskResultMatch) {
    await handleGetImageTaskResult(req, res, imageTaskResultMatch[1], imageTaskResultMatch[2]);
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

  if (req.method === 'POST' && url.pathname === '/api/chat/deepseek') {
    await handleDeepSeekChatCompletions(req, res);
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

// 测试友好：KELONG_SKIP_LISTEN=1 时只初始化不监听端口，便于脚本 import 复用真实逻辑做无费测试。
if (process.env.KELONG_SKIP_LISTEN !== '1') {
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
    // 服务重启后恢复未完成的挂画全自动批量任务，保证队列可继续处理。
    resumePaintingBatchRunsOnStartup().catch((error) => {
      console.error('[painting batch] startup resume failed', {
        message: error?.message || ''
      });
    });
    // 画质增强任务持久化在 SQLite；服务重启后继续提交、轮询或下载。
    cleanupCompletedVideoEnhancementSources().then((count) => {
      if (count > 0) console.log(`[video enhancement] 已清理 ${count} 个完成增强后的480P原片`);
    }).catch((error) => {
      console.error('[video enhancement] source_cleanup_failed', { message: error?.message || '' });
    });
    scheduleVideoEnhancementWorker(500);
  });
}

// 供无费测试脚本复用真实逻辑（不调用真实 Seedance / 豆包）。
export {
  getCollectionDb,
  ensurePaintingBatchIdempotencyConstraints,
  dbInsertPaintingBatchRun,
  dbInsertPaintingBatchTask,
  dbGetPaintingBatchTask,
  dbUpdatePaintingBatchTask,
  dbGetPaintingBatchRun,
  dbUpdatePaintingBatchRun,
  dbGetActivePaintingBatchRuns,
  dbGetPaintingBatchRunByCreationRequestId,
  dbDeletePaintingBatchRun,
  dbGetPaintingBatchTasks,
  dbMarkPaintingDirectionUsed,
  dbGetPaintingUsedDirections,
  handlePaintingIdeas,
  handlePaintingIdeaPrompt,
  handlePaintingTaskStatus,
  handleRetryPaintingBatchTask,
  handleResubmitPaintingBatchTask,
  handleCreatePaintingBatchRun,
  handleGetPaintingBatchRun,
  handleGetPaintingBatchRunByRequest,
  handleGetPaintingBatchRunEstimate,
  handleDeletePaintingBatchRun,
  handleSeedanceCreateTask,
  handleSeedanceGetTask,
  submitSeedanceTaskForBatchTask,
  fetchManualVideoGenerationTask,
  encodeMiniMaxH3TaskId,
  decodeMiniMaxH3TaskId,
  MINIMAX_H3_MODEL,
  encodeWan3TaskId,
  decodeWan3TaskId,
  WAN3_VIDEO_MODEL,
  getVideoLibraryModelLabel,
  formatVideoLibrarySourceNote,
  normalizeLegacyVideoLibrarySourceNote,
  normalizeLegacyCreativeVideoLibraryName,
  migrateLegacyCreativeVideoLibraryNames,
  readMultipartFormBody,
  isValidPaintingClientRequestId,
  parsePaintingIdeasWithJsonRetry,
  paintingPromptSimilarity,
  rewritePromptForDiversity,
  extractPaintingDiversitySummary,
  PaintingBatchSemaphore,
  PAINTING_BATCH_MODEL,
  PAINTING_BATCH_MODELS,
  PAINTING_BATCH_RESOLUTIONS,
  PAINTING_BATCH_MODEL_REJECT_MESSAGE,
  getSeedanceRatePerSecond,
  computePaintingBatchCostEstimate,
  getPaintingFrameworkPosition,
  formatPaintingSeedanceVideoLibraryName,
  formatSeedanceVideoLibraryName,
  ensurePaintingSizeLock,
  normalizePaintingPromptForStaticWallCompensation,
  shouldUsePaintingStaticWallSizeCompensation,
  inspectPaintingPromptQuality,
  PAINTING_REAL_SIZE_RULE,
  PAINTING_STATIC_WALL_COMPENSATED_SIZE_RULE,
  PAINTING_STATIC_WALL_COMPENSATED_WHITESPACE_RULE,
  PAINTING_WALL_WHITESPACE_RULE,
  PAINTING_SCALE_ESTABLISHING_RULE,
  PAINTING_INSTALLATION_SCALE_RULE,
  PAINTING_FRAMEWORKS,
  PAINTING_CAMERA_EXPLANATION_DIRECTION,
  PAINTING_LEFT_TO_RIGHT_SCAN_DIRECTION,
  PAINTING_RIGHT_TO_LEFT_SCAN_DIRECTION,
  PAINTING_ROLLING_UNFOLD_FIXED_INSTRUCTION,
  ensurePaintingRollingUnfoldInstruction,
  PAINTING_CHARACTER_IDENTITY_RULE,
  PAINTING_PRODUCT_FOCUSED_ENDING_RULE,
  ensurePaintingProductFocusedEnding,
  WAN3_CAMERA_MOTION_RULE,
  ensureWan3CameraMotionLock,
  WAN3_STATIC_PAINTING_STRUCTURE_RULE,
  WAN3_UNFOLDING_STRUCTURE_RULE,
  ensureWan3PaintingStructureLock,
  getPaintingDirectionDuration,
  isPaintingInstallationSequence,
  getPaintingContentDetailVariant,
  ensurePaintingContentDetailVariant,
  getPaintingBatchReferenceSpecs,
  parseFpsFraction,
  isVideo480pOrLower,
  extractEnhancementOutputUrl,
  normalizeEnhancementRemoteStatus,
  normalizeMediaKitUploadHeaders,
  buildVideoEnhancementRetryUpdates,
  cleanupCompletedVideoEnhancementSources,
};

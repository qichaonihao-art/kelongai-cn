import { createServer } from 'node:http';
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { mkdir, readFile, stat, unlink, writeFile } from 'node:fs/promises';
import { randomBytes, timingSafeEqual } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { WebSocket } from 'ws';

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
const MAX_VIDEO_ORIGINAL_UPLOAD_BYTES = 45 * 1024 * 1024;
const MAX_COMPRESSED_VIDEO_BYTES = 49 * 1024 * 1024;
const DEFAULT_DOUBAO_MULTIMODAL_MODEL = 'doubao-seed-2-0-lite-260215';
const UPLOAD_TEMP_DIR = path.join(__dirname, '.runtime-uploads');
const MEDIA_TTL_MS = 30 * 60 * 1000;
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
  volcAppKey: process.env.VOLCENGINE_APP_KEY || '',
  volcAccessKey: process.env.VOLCENGINE_ACCESS_KEY || '',
  volcSpeakerId: process.env.VOLCENGINE_SPEAKER_ID || '',
  tikhubApiToken: process.env.TIKHUB_API_TOKEN || ''
};

const DOUYIN_USER_AGENT = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36';
const TIKHUB_API_BASE_URL = 'https://api.tikhub.io';
const DOUYIN_RETRY_DELAYS_MS = [250, 700];

function readBooleanEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
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

function sendWavResponse(res, wavBuffer) {
  res.writeHead(200, {
    'Content-Type': 'audio/wav',
    'Content-Length': wavBuffer.length,
    'Cache-Control': 'no-store'
  });
  res.end(wavBuffer);
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

async function ensureUploadTempDir() {
  await mkdir(UPLOAD_TEMP_DIR, { recursive: true });
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

function handleConfigStatus(req, res) {
  const publicBaseUrl = getConfiguredPublicBaseUrl();
  sendJson(res, 200, {
    ok: true,
    auth: {
      passwordConfigured: !!APP_LOGIN_PASSWORD
    },
    serverManaged: {
      arkApiKey: !!readValue(SERVER_CONFIG.arkApiKey),
      aliyunApiKey: !!readValue(SERVER_CONFIG.aliyunApiKey),
      zhipuApiKey: !!readValue(SERVER_CONFIG.zhipuApiKey),
      volcAppKey: !!readValue(SERVER_CONFIG.volcAppKey),
      volcAccessKey: !!readValue(SERVER_CONFIG.volcAccessKey),
      volcSpeakerId: !!readValue(SERVER_CONFIG.volcSpeakerId),
      tikhubApiToken: !!readValue(SERVER_CONFIG.tikhubApiToken),
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

function parseJsonString(value, fallback = null) {
  const raw = readValue(value);
  if (!raw) return fallback;
  try {
    return JSON.parse(raw);
  } catch {
    return fallback;
  }
}

function createRequestId(prefix) {
  return `${prefix}_${Date.now().toString(36)}_${randomBytes(4).toString('hex')}`;
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

async function resolveRedirectedUrl(rawUrl) {
  const response = await fetch(rawUrl, {
    method: 'GET',
    redirect: 'follow',
    headers: {
      'user-agent': DOUYIN_USER_AGENT,
      'accept-language': 'zh-CN,zh;q=0.9,en;q=0.8'
    }
  });

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

function collectDownloadUrlCandidates(payload) {
  const paths = [
    ['video_data', 'video', 'play_addr', 'url_list'],
    ['video_data', 'video', 'play_addr_h264', 'url_list'],
    ['video_data', 'video', 'play_api', 'url_list'],
    ['video_data', 'video', 'bit_rate', '*', 'play_addr', 'url_list'],
    ['video_data', 'video', 'download_addr', 'url_list'],
    ['video', 'play_addr', 'url_list'],
    ['video', 'play_addr_h264', 'url_list'],
    ['video', 'play_api', 'url_list'],
    ['video', 'bit_rate', '*', 'play_addr', 'url_list'],
    ['video', 'download_addr', 'url_list'],
    ['aweme_detail', 'video', 'play_addr', 'url_list'],
    ['aweme_detail', 'video', 'play_addr_h264', 'url_list'],
    ['aweme_detail', 'video', 'play_api', 'url_list'],
    ['aweme_detail', 'video', 'bit_rate', '*', 'play_addr', 'url_list'],
    ['aweme_detail', 'video', 'download_addr', 'url_list'],
    ['item_info', 'item_struct', 'video', 'play_addr', 'url_list'],
    ['item_info', 'item_struct', 'video', 'play_addr_h264', 'url_list'],
    ['item_info', 'item_struct', 'video', 'bit_rate', '*', 'play_addr', 'url_list']
  ];

  const candidates = [];
  for (const path of paths) {
    const value = pickNestedValue(payload, path);
    const url = extractFirstUrl(value);
    if (url) candidates.push(url);
  }

  return [...new Set(candidates)];
}

function extractStableDownloadUrl(payload) {
  const candidates = collectDownloadUrlCandidates(payload);

  for (const candidate of candidates) {
    if (!/download_addr/i.test(candidate)) {
      return candidate;
    }
  }

  return candidates[0] || '';
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

async function callTikHubHighQualityPlayUrl({ shareUrl, awemeId, requestId }) {
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
  const upstreamRes = await fetch(upstreamUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'User-Agent': DOUYIN_USER_AGENT
    }
  });

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
  const downloadUrl = readValue(payload?.original_video_url);
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
    videoData: payload?.video_data && typeof payload.video_data === 'object' ? payload.video_data : payload || null
  };
}

async function callTikHubDouyinVideoDetail({ path, shareUrl, awemeId, requestId }) {
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
  const upstreamRes = await fetch(upstreamUrl, {
    method: 'GET',
    headers: {
      'Authorization': `Bearer ${token}`,
      'Accept': 'application/json',
      'User-Agent': DOUYIN_USER_AGENT
    }
  });

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
  const downloadUrl = extractStableDownloadUrl(payload);
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
    videoData: payload || null
  };
}

async function callTikHubVideoDetailByShareUrl({ shareUrl, requestId }) {
  return callTikHubDouyinVideoDetail({
    path: '/api/v1/douyin/app/v3/fetch_one_video_by_share_url',
    shareUrl,
    requestId
  });
}

async function callTikHubVideoDetailByAwemeId({ awemeId, requestId }) {
  return callTikHubDouyinVideoDetail({
    path: '/api/v1/douyin/app/v3/fetch_one_video',
    awemeId,
    requestId
  });
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

  return {
    question: readValue(formData.get('question')),
    history: parseJsonString(formData.get('history'), []),
    stream: readValue(formData.get('stream')).toLowerCase() === 'true',
    model: readValue(formData.get('model')),
    mediaKind: readValue(formData.get('media_kind')),
    file: file instanceof File ? file : null
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

  const containers = [payload, payload.response, payload.item].filter(Boolean);
  const textParts = [];

  for (const item of containers) {
    if (!item || typeof item !== 'object') continue;
    if (isDoubaoReasoningType(item.type)) continue;

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

  return filteredLines.join('\n').replace(/\n{3,}/g, '\n\n').trim();
}

function extractVisibleDoubaoDelta(payload, eventName) {
  const resolvedEvent = String(eventName || payload?.type || '').toLowerCase();
  if (isDoubaoReasoningType(resolvedEvent)) return '';

  const deltaCandidates = [
    payload?.delta,
    payload?.data?.delta,
    payload?.item?.delta,
    payload?.item,
    payload?.data
  ].filter(Boolean);

  for (const item of deltaCandidates) {
    if (typeof item === 'string' && item.trim() && !isDoubaoReasoningType(resolvedEvent)) {
      return item;
    }
    if (!item || typeof item !== 'object') continue;
    if (isDoubaoReasoningType(item.type)) continue;
    if (typeof item.text === 'string' && item.text.trim()) return item.text;
    if (typeof item.delta === 'string' && item.delta.trim()) return item.delta;
    if (item.delta && typeof item.delta.text === 'string' && item.delta.text.trim()) return item.delta.text;
    if (Array.isArray(item.content)) {
      for (const contentItem of item.content) {
        if (!contentItem || typeof contentItem !== 'object') continue;
        if (isDoubaoReasoningType(contentItem.type)) continue;
        if (typeof contentItem.text === 'string' && contentItem.text.trim()) {
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
            writeSseEvent(res, 'error', { error: errorMessage });
            continue;
          }

          if (isDoubaoDeltaEvent(parsed.event)) {
            const delta = extractVisibleDoubaoDelta(payload, parsed.event);
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
        if (isDoubaoDeltaEvent(parsed.event)) {
          const delta = extractVisibleDoubaoDelta(payload, parsed.event);
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

    const pcmBuffer = await connectAliyunRealtime({ apiKey: resolvedApiKey, model, voice, text });
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

    if (shouldUseVoiceCloneMock(body)) {
      const wavBuffer = buildWaveFromPcm(createMockPcmBuffer(text), 24000, 1, 16);
      sendWavResponse(res, wavBuffer);
      return;
    }

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
    const { apiKey, voice, text } = body;
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
        speed: 1.0,
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
  try {
    const body = await readRequestBody(req);
    const { speakerId, resourceId, audioData, audioFormat } = body;
    const resolvedAppKey = readValue(SERVER_CONFIG.volcAppKey);
    const resolvedAccessKey = readValue(SERVER_CONFIG.volcAccessKey);
    const resolvedSpeakerId = readValue(speakerId, SERVER_CONFIG.volcSpeakerId);

    if (shouldUseVoiceCloneMock(body)) {
      sendJson(res, 200, buildMockVoiceClonePayload('volcengine', '', resolvedSpeakerId));
      return;
    }

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
    const { model, image, imageMimeType, video, videoMimeType, question, history, mediaKind, file } = body;
    shouldStream = wantsDoubaoStream(body, req);
    const resolvedApiKey = readValue(SERVER_CONFIG.arkApiKey);
    const resolvedQuestion = readValue(question);
    const resolvedModel = readValue(model) || DEFAULT_DOUBAO_MULTIMODAL_MODEL;
    const hasUploadedFile = file instanceof File && file.size > 0;

    console.log('[doubao multimodal] request start', {
      requestId,
      stage,
      stream: shouldStream,
      model: resolvedModel,
      hasImageField: !!readValue(image),
      hasVideoField: !!readValue(video),
      hasUploadedFile,
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

    if (hasUploadedFile) {
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
        const normalizedUploadedMedia = await normalizeUploadedMediaInput(file, resolvedMediaKind);

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
      body: JSON.stringify(requestPayload)
    };

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
      await proxySseStreamToClient(upstreamRes, req, res, { skipInitialHeaders: true });
      return;
    }

    stage = 'read_upstream_response';
    const responseText = await upstreamRes.text();
    let json = null;
    try {
      json = responseText ? JSON.parse(responseText) : null;
    } catch {}

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
      if (shouldStream) {
        writeSseEvent(res, 'error', {
          error: json?.error?.message || json?.message || json?.code || `方舟 Responses API 请求失败，上游状态码 ${upstreamRes.status}`
        });
        res.end();
        return;
      }
      sendJson(res, upstreamRes.status, {
        error: json?.error?.message || json?.message || json?.code || `方舟 Responses API 请求失败，上游状态码 ${upstreamRes.status}`,
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

    console.log('[doubao multimodal] request complete', {
      requestId,
      stage,
      streamed: false,
      answerLength: extractResponsesText(json).length,
      elapsedMs: Date.now() - requestStartedAt
    });
    sendJson(res, 200, {
      ok: true,
      model: resolvedModel,
      answer: extractResponsesText(json),
      response: json
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

    if (shouldStream) {
      writeSseEvent(res, 'error', {
        error: isBodyParseOrSizeError ? error.message : (error.message || `豆包多模态理解失败（阶段: ${stage}）`)
      });
      res.end();
      return;
    }

    sendJson(res, isBodyParseOrSizeError ? 400 : 500, {
      error: isBodyParseOrSizeError ? error.message : (error.message || `豆包多模态理解失败（阶段: ${stage}）`),
      debug: {
        stage
      }
    });
  }
}

async function handleDouyinResolveDownload(req, res) {
  const requestId = createRequestId('douyin');
  const startedAt = Date.now();
  let originalInput = '';
  let originalUrl = '';
  let finalUrl = '';
  let normalizedUrl = '';
  let awemeId = '';
  let directShareUrlSuccess = false;
  let expandedShareUrlSuccess = false;
  let finalResolvePath = 'failed';
  let upstreamStatus = 0;
  let upstreamBodySummary = '';
  let requestedMode = 'stable';

  function logDouyinResolve(level, message, extra = {}) {
    const payload = {
      requestId,
      originalInput,
      originalUrl,
      normalizedUrl,
      finalUrl,
      directShareUrlSuccess,
      expandedShareUrlSuccess,
      extractedAwemeId: awemeId,
      finalResolvePath,
      upstreamStatus,
      upstreamBodySummary,
      ...extra
    };

    if (level === 'error') {
      console.error(message, payload);
      return;
    }
    if (level === 'warn') {
      console.warn(message, payload);
      return;
    }
    console.log(message, payload);
  }

  try {
    const body = await readRequestBody(req);
    const input = normalizeDouyinInput(body?.input);
    const mode = readValue(body?.mode) === 'high_quality' ? 'high_quality' : 'stable';
    originalInput = input;
    requestedMode = mode;
    if (!input) {
      const error = createDouyinResolveError({
        stage: 'no_valid_url_found',
        statusCode: 400,
        message: '请先粘贴抖音链接或整段分享文本。'
      });
      throw error;
    }

    logDouyinResolve('log', '[douyin resolve] request received', {
      inputLength: input.length,
      requestedMode
    });

    const extracted = pickPreferredDouyinUrl(input);
    originalUrl = extracted.url;
    if (!originalUrl) {
      throw createDouyinResolveError({
        stage: 'no_valid_url_found',
        statusCode: 400,
        message: '该分享内容未能识别出有效抖音作品链接。'
      });
    }

    logDouyinResolve('log', '[douyin resolve] parsed original url', {
      sourceType: extracted.sourceType
    });

    if (mode === 'high_quality') {
      try {
        const result = await retryDouyinOperation({
          label: 'raw_share_url_high_quality',
          requestId,
          operation: () => callTikHubHighQualityPlayUrl({ shareUrl: originalUrl, requestId })
        });
        directShareUrlSuccess = true;
        finalResolvePath = 'raw_share_url_high_quality';

        logDouyinResolve('log', '[douyin resolve] resolved by raw share_url high quality', {
          videoId: result.videoId,
          elapsedMs: Date.now() - startedAt
        });
        sendJson(res, 200, {
          ok: true,
          mode,
          videoId: result.videoId,
          downloadUrl: result.downloadUrl,
          videoData: result.videoData,
          normalizedUrl: originalUrl,
          sourceType: extracted.sourceType
        });
        return;
      } catch (error) {
        upstreamStatus = error?.upstreamStatus || upstreamStatus;
        upstreamBodySummary = error?.upstreamBodySummary || upstreamBodySummary;
        logDouyinResolve('warn', '[douyin resolve] raw share_url high quality failed', {
          stage: 'raw_share_url_high_quality_failed',
          reason: error?.stage || 'unknown_upstream_error',
          detail: error?.detail || error?.message || ''
        });
      }
    } else {
      try {
        const result = await retryDouyinOperation({
          label: 'share_url_video_detail',
          requestId,
          operation: () => callTikHubVideoDetailByShareUrl({ shareUrl: originalUrl, requestId })
        });
        directShareUrlSuccess = true;
        finalResolvePath = 'share_url_video_detail';

        logDouyinResolve('log', '[douyin resolve] resolved by share_url video detail', {
          videoId: result.videoId,
          elapsedMs: Date.now() - startedAt
        });
        sendJson(res, 200, {
          ok: true,
          mode,
          videoId: result.videoId,
          downloadUrl: result.downloadUrl,
          videoData: result.videoData,
          normalizedUrl: originalUrl,
          sourceType: extracted.sourceType
        });
        return;
      } catch (error) {
        upstreamStatus = error?.upstreamStatus || upstreamStatus;
        upstreamBodySummary = error?.upstreamBodySummary || upstreamBodySummary;
        logDouyinResolve('warn', '[douyin resolve] share_url video detail failed', {
          stage: 'share_url_video_detail_failed',
          reason: error?.stage || 'unknown_upstream_error',
          detail: error?.detail || error?.message || ''
        });
      }
    }

    let redirectInfo;
    try {
      redirectInfo = await retryDouyinOperation({
        label: 'short_link_expand',
        requestId,
        operation: () => resolveRedirectedUrl(originalUrl),
        shouldRetry: (error) => !error?.stage || error?.stage === 'short_link_expand_failed'
      });
    } catch (error) {
      throw createDouyinResolveError({
        stage: 'short_link_expand_failed',
        statusCode: 400,
        message: '短链接展开失败，请稍后重试或改用网页完整链接。',
        detail: error?.message || ''
      });
    }

    finalUrl = redirectInfo.finalUrl || originalUrl;
    normalizedUrl = redirectInfo.normalizedUrl || finalUrl || originalUrl;
    awemeId = redirectInfo.awemeId || extractDouyinAwemeId(normalizedUrl || finalUrl || originalUrl);

    logDouyinResolve('log', '[douyin resolve] expanded share_url prepared', {
      contentType: redirectInfo.contentType
    });

    if (mode === 'high_quality') {
      try {
        const result = await retryDouyinOperation({
          label: 'expanded_share_url_high_quality',
          requestId,
          operation: () => callTikHubHighQualityPlayUrl({ shareUrl: normalizedUrl, requestId })
        });
        expandedShareUrlSuccess = true;
        finalResolvePath = 'expanded_share_url_high_quality';

        logDouyinResolve('log', '[douyin resolve] resolved by expanded share_url high quality', {
          videoId: result.videoId,
          elapsedMs: Date.now() - startedAt
        });
        sendJson(res, 200, {
          ok: true,
          mode,
          videoId: result.videoId,
          downloadUrl: result.downloadUrl,
          videoData: result.videoData,
          normalizedUrl,
          sourceType: extracted.sourceType
        });
        return;
      } catch (error) {
        upstreamStatus = error?.upstreamStatus || upstreamStatus;
        upstreamBodySummary = error?.upstreamBodySummary || upstreamBodySummary;
        logDouyinResolve('warn', '[douyin resolve] expanded share_url high quality failed', {
          stage: 'expanded_share_url_high_quality_failed',
          reason: error?.stage || 'unknown_upstream_error',
          detail: error?.detail || error?.message || ''
        });
      }
    } else {
      try {
        const result = await retryDouyinOperation({
          label: 'expanded_share_url_video_detail',
          requestId,
          operation: () => callTikHubVideoDetailByShareUrl({ shareUrl: normalizedUrl, requestId })
        });
        expandedShareUrlSuccess = true;
        finalResolvePath = 'expanded_share_url_video_detail';

        logDouyinResolve('log', '[douyin resolve] resolved by expanded share_url video detail', {
          videoId: result.videoId,
          elapsedMs: Date.now() - startedAt
        });
        sendJson(res, 200, {
          ok: true,
          mode,
          videoId: result.videoId,
          downloadUrl: result.downloadUrl,
          videoData: result.videoData,
          normalizedUrl,
          sourceType: extracted.sourceType
        });
        return;
      } catch (error) {
        upstreamStatus = error?.upstreamStatus || upstreamStatus;
        upstreamBodySummary = error?.upstreamBodySummary || upstreamBodySummary;
        logDouyinResolve('warn', '[douyin resolve] expanded share_url video detail failed', {
          stage: 'expanded_share_url_video_detail_failed',
          reason: error?.stage || 'unknown_upstream_error',
          detail: error?.detail || error?.message || ''
        });
      }
    }

    if (!awemeId) {
      throw createDouyinResolveError({
        stage: 'aweme_id_extract_failed',
        statusCode: 400,
        message: '短链接已展开，但目标不是标准作品页，暂时无法提取作品 id。',
        detail: 'expanded share_url 解析失败，且未能提取 aweme_id'
      });
    }

    try {
      const result = await retryDouyinOperation({
        label: mode === 'high_quality' ? 'aweme_id_high_quality' : 'aweme_id_video_detail',
        requestId,
        operation: () => mode === 'high_quality'
          ? callTikHubHighQualityPlayUrl({ awemeId, requestId })
          : callTikHubVideoDetailByAwemeId({ awemeId, requestId })
      });
      finalResolvePath = mode === 'high_quality' ? 'aweme_id_high_quality' : 'aweme_id_video_detail';

      logDouyinResolve('log', `[douyin resolve] resolved by ${mode === 'high_quality' ? 'aweme_id high quality' : 'aweme_id video detail'}`, {
        videoId: result.videoId,
        elapsedMs: Date.now() - startedAt
      });

      sendJson(res, 200, {
        ok: true,
        mode,
        videoId: result.videoId || awemeId,
        downloadUrl: result.downloadUrl,
        videoData: result.videoData,
        normalizedUrl: normalizedUrl || finalUrl || originalUrl,
        sourceType: extracted.sourceType
      });
      return;
    } catch (error) {
      upstreamStatus = error?.upstreamStatus || upstreamStatus;
      upstreamBodySummary = error?.upstreamBodySummary || upstreamBodySummary;
      throw createDouyinResolveError({
        stage:
          error?.stage === 'tikhub_402_payment_required'
            ? 'tikhub_402_payment_required'
            : (error?.stage === 'tikhub_400_invalid_aweme_id' ? 'tikhub_400_invalid_aweme_id' : 'aweme_id_request_failed'),
        statusCode: error?.statusCode || 400,
        upstreamStatus: error?.upstreamStatus || 0,
        upstreamBodySummary: error?.upstreamBodySummary || '',
        upstreamCode: error?.upstreamCode || '',
        detail: error?.detail || error?.message || '',
        message: error?.stage === 'tikhub_402_payment_required'
          ? '当前接口余额不足或需要付费权限，请检查 TikHub 账户状态。'
          : mode === 'high_quality'
            ? '已提取到作品 id，但最高画质接口仍返回失败。'
            : '已提取到作品 id，但稳定解析链路仍返回失败。'
      });
    }
  } catch (error) {
    finalResolvePath = 'failed';
    upstreamStatus = error?.upstreamStatus || upstreamStatus;
    upstreamBodySummary = error?.upstreamBodySummary || upstreamBodySummary;

    logDouyinResolve('error', '[douyin resolve] request failed', {
      stage: error?.stage || 'unknown_upstream_error',
      detail: error?.detail || '',
      upstreamCode: error?.upstreamCode || '',
      message: error?.message || '',
      stack: error?.stack || '',
      elapsedMs: Date.now() - startedAt
    });

    sendJson(res, error?.statusCode || 500, {
      ok: false,
      mode: requestedMode,
      error: error?.message || '抖音视频解析失败',
      stage: error?.stage || 'unknown_upstream_error',
      detail: error?.detail || '',
      upstreamStatus,
      upstreamBodySummary
    });
  }
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

  const isAuthRoute = url.pathname === '/api/auth/login' || url.pathname === '/api/auth/status' || url.pathname === '/api/auth/logout';
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
    handleConfigStatus(req, res);
    return;
  }

  if (req.method === 'GET' && url.pathname.startsWith('/uploads/')) {
    await handlePublicMediaRequest(req, res, url.pathname.slice('/uploads/'.length));
    return;
  }

  if (url.pathname.startsWith('/api/') && !isAuthRoute && !isAuthenticated(req)) {
    sendJson(res, 401, { error: '未登录或登录已失效' });
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

  if (req.method === 'POST' && url.pathname === '/api/doubao/multimodal') {
    await handleDoubaoMultimodal(req, res);
    return;
  }

  if (req.method === 'POST' && url.pathname === '/api/douyin/resolve-download') {
    await handleDouyinResolveDownload(req, res);
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
});

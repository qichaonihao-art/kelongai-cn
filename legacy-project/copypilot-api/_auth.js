import { json } from './_tikhub.js';
import { getDefaultMaxVideoMinutes } from './_plans.js';

const SESSION_COOKIE = 'copypilot_session';
const OAUTH_STATE_COOKIE = 'copypilot_oauth_state';
const ANON_COOKIE = 'copypilot_anon';
const DAY_MS = 24 * 60 * 60 * 1000;

export { ANON_COOKIE, OAUTH_STATE_COOKIE, SESSION_COOKIE };

export function authJson(payload, status = 200, headers = {}) {
  return json(payload, status, headers);
}

export function getConfig(env) {
  return {
    appOrigin: env.APP_ORIGIN || 'http://127.0.0.1:8790',
    sessionSecret: env.SESSION_SECRET || 'dev-session-secret-change-me',
    emailFrom: env.EMAIL_FROM || 'CopyPilot <no-reply@copypilot.pages.dev>',
    mailerUrl: env.MAILER_URL || '',
    mailerSecret: env.MAILER_SECRET || '',
    resendKey: env.RESEND_API_KEY || '',
    publicFreeMode: env.PUBLIC_FREE_MODE === 'true',
    googleClientId: env.GOOGLE_CLIENT_ID || '',
    googleClientSecret: env.GOOGLE_CLIENT_SECRET || '',
    googleRedirectUri: env.GOOGLE_REDIRECT_URI || ''
  };
}

export function parseCookies(request) {
  const header = request.headers.get('Cookie') || '';
  const cookies = {};
  for (const part of header.split(';')) {
    const [key, ...rest] = part.trim().split('=');
    if (!key) continue;
    cookies[key] = decodeURIComponent(rest.join('=') || '');
  }
  return cookies;
}

export function serializeCookie(name, value, options = {}) {
  const parts = [`${name}=${encodeURIComponent(value)}`];
  if (options.maxAge !== undefined) parts.push(`Max-Age=${options.maxAge}`);
  if (options.expires) parts.push(`Expires=${options.expires.toUTCString()}`);
  parts.push(`Path=${options.path || '/'}`);
  if (options.httpOnly !== false) parts.push('HttpOnly');
  if (options.secure !== false) parts.push('Secure');
  parts.push(`SameSite=${options.sameSite || 'Lax'}`);
  return parts.join('; ');
}

export async function getSessionUser(request, env) {
  return null;
}

export function isAdminUser(user, env) {
  return false;
}

export async function requireQuota(context, action = 'extract') {
  return { ok: true, user: null, anonymousId: null, setCookie: null };
}

export async function recordUsage(context, quota, details = {}) {
  return;
}

export async function getUsageSummary(env, request, user) {
  return null;
}

export function getFreeDailyLimit(env) {
  const configured = Number(env.FREE_DAILY_LIMIT || '');
  if (Number.isFinite(configured) && configured > 0) return Math.round(configured);
  return 999999;
}

export async function signSession(payload, secret) {
  const body = base64Url(JSON.stringify(payload));
  const signature = await hmac(`${body}`, secret);
  return `${body}.${signature}`;
}

export async function verifySession(token, secret) {
  const [body, signature] = String(token || '').split('.');
  if (!body || !signature) return null;
  const expected = await hmac(body, secret);
  if (!safeEqual(signature, expected)) return null;
  try {
    const payload = JSON.parse(new TextDecoder().decode(base64UrlToBytes(body)));
    if (payload.exp && payload.exp < Math.floor(Date.now() / 1000)) return null;
    return payload;
  } catch {
    return null;
  }
}

export async function hashValue(value, secret) {
  return hmac(String(value), secret);
}

export function makeId(prefix) {
  return `${prefix}_${crypto.randomUUID().replaceAll('-', '')}`;
}

export async function getPlanLimit(db, plan) {
  if (plan === 'admin') return 1000;
  return 999999;
}

export function todayKey() {
  return new Date().toISOString().slice(0, 10);
}

export async function getAnonymousId(request) {
  const cookies = parseCookies(request);
  const existing = cookies[ANON_COOKIE];
  if (existing && existing.length > 12) return { id: existing, setCookie: null };
  const id = makeId('anon');
  return {
    id,
    setCookie: serializeCookie(ANON_COOKIE, id, { maxAge: 365 * DAY_MS / 1000, httpOnly: true })
  };
}

async function hmac(value, secret) {
  const key = await crypto.subtle.importKey(
    'raw',
    new TextEncoder().encode(secret),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign']
  );
  const signature = await crypto.subtle.sign('HMAC', key, new TextEncoder().encode(value));
  return base64UrlBytes(new Uint8Array(signature));
}

function base64Url(value) {
  return base64UrlBytes(new TextEncoder().encode(value));
}

function base64UrlBytes(bytes) {
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '');
}

function base64UrlToBytes(value) {
  const padded = value.replace(/-/g, '+').replace(/_/g, '/') + '==='.slice((value.length + 3) % 4);
  const binary = atob(padded);
  return Uint8Array.from(binary, (char) => char.charCodeAt(0));
}

function safeEqual(a, b) {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  return out === 0;
}

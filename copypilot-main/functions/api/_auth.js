import { json } from './_tikhub.js';
import { getDefaultPlanLimit, getMembershipPlan } from './_plans.js';

const SESSION_COOKIE = 'copypilot_session';
const OAUTH_STATE_COOKIE = 'copypilot_oauth_state';
const ANON_COOKIE = 'copypilot_anon';
const DAY_MS = 24 * 60 * 60 * 1000;
const FREE_DAILY_LIMIT = 10;

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
  if (!env.DB) return null;
  const token = parseCookies(request)[SESSION_COOKIE];
  if (!token) return null;
  const session = await verifySession(token, getConfig(env).sessionSecret);
  if (!session?.user_id) return null;

  const user = await env.DB.prepare(
    'SELECT id, email, name, avatar_url, plan, credits, created_at FROM users WHERE id = ?'
  ).bind(session.user_id).first();
  return user || null;
}

export function isAdminUser(user, env) {
  if (!user) return false;
  if (user.plan === 'admin') return true;
  const allowList = String(env.ADMIN_EMAILS || '')
    .split(',')
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return allowList.includes(String(user.email || '').toLowerCase());
}

export async function requireQuota(context, action = 'extract') {
  const { request, env } = context;
  if (!env.DB) return { ok: true, user: null, anonymousId: null, setCookie: null };
  const config = getConfig(env);

  const user = config.publicFreeMode ? null : await getSessionUser(request, env);
  if (user) {
    const dailyLimit = await getPlanLimit(env.DB, user.plan);
    const usedToday = await getTodayUsage(env.DB, { userId: user.id, action });
    if (usedToday >= dailyLimit) {
      return { ok: false, status: 402, message: '今日可用额度已用完，请明天再试或升级会员。', user };
    }
    if (Number(user.credits || 0) <= 0) {
      return { ok: false, status: 402, message: '当前会员额度已用完，请升级会员或联系管理员。', user };
    }
    return { ok: true, user, anonymousId: null, setCookie: null };
  }

  const anon = await getAnonymousId(request);
  const windowStart = todayKey();
  const record = await env.DB.prepare(
    'SELECT count FROM anonymous_usage_limits WHERE anonymous_id = ? AND action = ? AND window_start = ?'
  ).bind(anon.id, action, windowStart).first();
  const count = Number(record?.count || 0);
  const dailyLimit = getFreeDailyLimit(env);
  if (count >= dailyLimit) {
    return {
      ok: false,
      status: 401,
      message: `免费版每天最多可使用 ${dailyLimit} 次，请明天再试。`,
      anonymousId: anon.id,
      setCookie: anon.setCookie
    };
  }
  return { ok: true, user: null, anonymousId: anon.id, setCookie: anon.setCookie };
}

export async function recordUsage(context, quota, details = {}) {
  const { env } = context;
  if (!env.DB || !quota?.ok) return;
  const action = details.action || 'extract';
  const id = makeId('use');

  if (quota.user) {
    await env.DB.prepare(
      'UPDATE users SET credits = MAX(credits - 1, 0), updated_at = CURRENT_TIMESTAMP WHERE id = ?'
    ).bind(quota.user.id).run();
  } else if (quota.anonymousId) {
    const windowStart = todayKey();
    await env.DB.prepare(
      `INSERT INTO anonymous_usage_limits (id, anonymous_id, action, count, window_start, updated_at)
       VALUES (?, ?, ?, 1, ?, CURRENT_TIMESTAMP)
       ON CONFLICT(anonymous_id, action, window_start)
       DO UPDATE SET count = count + 1, updated_at = CURRENT_TIMESTAMP`
    ).bind(makeId('anonuse'), quota.anonymousId, action, windowStart).run();
  }

  await env.DB.prepare(
    `INSERT INTO usage_records (id, user_id, anonymous_id, action, source_url, result_title, credits_used, status)
     VALUES (?, ?, ?, ?, ?, ?, 1, ?)`
  ).bind(
    id,
    quota.user?.id || null,
    quota.anonymousId || null,
    action,
    details.sourceUrl || null,
    details.resultTitle || null,
    details.status || 'completed'
  ).run();
}

export async function getUsageSummary(env, request, user) {
  if (!env.DB) return null;
  const action = 'extract';
  const dailyLimit = user ? await getPlanLimit(env.DB, user.plan) : getFreeDailyLimit(env);
  const usedToday = user
    ? await getTodayUsage(env.DB, { userId: user.id, action })
    : await getTodayUsage(env.DB, { anonymousId: (await getAnonymousId(request)).id, action });
  return {
    dailyLimit,
    usedToday,
    remainingToday: Math.max(dailyLimit - usedToday, 0)
  };
}

export function getFreeDailyLimit(env) {
  const configured = Number(env.FREE_DAILY_LIMIT || '');
  if (Number.isFinite(configured) && configured > 0) return Math.round(configured);
  return FREE_DAILY_LIMIT;
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
  try {
    const config = await getMembershipPlan(db, plan);
    if (config?.dailyLimit) return config.dailyLimit;
  } catch {
    // Fall back to code defaults if the plan table has not been created yet.
  }
  return getDefaultPlanLimit(plan);
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

async function getTodayUsage(db, { userId, anonymousId, action }) {
  if (userId) {
    const row = await db.prepare(
      `SELECT COUNT(*) AS count FROM usage_records
       WHERE user_id = ? AND action = ? AND status = 'completed' AND date(created_at) = date('now')`
    ).bind(userId, action).first();
    return Number(row?.count || 0);
  }
  if (anonymousId) {
    const row = await db.prepare(
      'SELECT count FROM anonymous_usage_limits WHERE anonymous_id = ? AND action = ? AND window_start = ?'
    ).bind(anonymousId, action, todayKey()).first();
    return Number(row?.count || 0);
  }
  return 0;
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

import { SESSION_COOKIE, authJson, getConfig, hashValue, makeId, serializeCookie, signSession } from '../_auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return authJson({ ok: false, message: '数据库暂未配置。' }, 500);

  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  const code = String(body?.code || '').trim();
  if (!email || !/^\d{6}$/.test(code)) return authJson({ ok: false, message: '邮箱或验证码不正确。' }, 400);

  const config = getConfig(env);
  const row = await env.DB.prepare(
    `SELECT * FROM email_login_codes
     WHERE email = ? AND consumed_at IS NULL AND expires_at > datetime('now')
     ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first();

  if (!row) return authJson({ ok: false, message: '验证码已过期，请重新获取。' }, 400);
  if (Number(row.attempts || 0) >= 5) return authJson({ ok: false, message: '验证码错误次数过多，请重新获取。' }, 429);

  const expected = await hashValue(`${email}:${code}`, config.sessionSecret);
  if (row.code_hash !== expected) {
    await env.DB.prepare('UPDATE email_login_codes SET attempts = attempts + 1 WHERE id = ?').bind(row.id).run();
    return authJson({ ok: false, message: '验证码不正确。' }, 400);
  }

  await env.DB.prepare('UPDATE email_login_codes SET consumed_at = CURRENT_TIMESTAMP WHERE id = ?').bind(row.id).run();
  const user = await upsertEmailUser(env.DB, email);
  const session = await signSession({
    user_id: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  }, config.sessionSecret);

  return authJson({ ok: true, user }, 200, {
    'Set-Cookie': serializeCookie(SESSION_COOKIE, session, { maxAge: 7 * 24 * 60 * 60 })
  });
}

async function upsertEmailUser(db, email) {
  const existing = await db.prepare('SELECT id, email, name, avatar_url, plan, credits FROM users WHERE email = ?').bind(email).first();
  if (existing) return existing;
  const id = makeId('usr');
  await db.prepare(
    `INSERT INTO users (id, email, name, credits)
     VALUES (?, ?, ?, 30)`
  ).bind(id, email, email.split('@')[0]).run();
  return db.prepare('SELECT id, email, name, avatar_url, plan, credits FROM users WHERE id = ?').bind(id).first();
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

import { authJson, getSessionUser, isAdminUser } from '../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (env.PUBLIC_FREE_MODE === 'true') {
    return authJson({ ok: false, message: '管理后台未开启。' }, 404);
  }
  if (!env.DB) return authJson({ ok: false, message: '数据库暂未配置。' }, 500);

  const currentUser = await getSessionUser(request, env);
  if (!isAdminUser(currentUser, env)) {
    return authJson({ ok: false, message: '没有管理员权限。' }, 403);
  }

  const url = new URL(request.url);
  const q = String(url.searchParams.get('q') || '').trim().toLowerCase();
  const limit = Math.min(Number(url.searchParams.get('limit') || 50), 100);
  const offset = Math.max(Number(url.searchParams.get('offset') || 0), 0);

  const where = q ? 'WHERE lower(email) LIKE ? OR lower(coalesce(name, "")) LIKE ?' : '';
  const params = q ? [`%${q}%`, `%${q}%`, limit, offset] : [limit, offset];
  const rows = await env.DB.prepare(
    `SELECT id, email, name, avatar_url, plan, credits, created_at, updated_at
     FROM users
     ${where}
     ORDER BY created_at DESC
     LIMIT ? OFFSET ?`
  ).bind(...params).all();

  const countStatement = env.DB.prepare(`SELECT COUNT(*) AS count FROM users ${where}`);
  const countRow = q
    ? await countStatement.bind(`%${q}%`, `%${q}%`).first()
    : await countStatement.first();

  return authJson({
    ok: true,
    users: rows.results || [],
    total: Number(countRow?.count || 0)
  });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  if (env.PUBLIC_FREE_MODE === 'true') {
    return authJson({ ok: false, message: '管理后台未开启。' }, 404);
  }
  if (!env.DB) return authJson({ ok: false, message: '数据库暂未配置。' }, 500);

  const currentUser = await getSessionUser(request, env);
  if (!isAdminUser(currentUser, env)) {
    return authJson({ ok: false, message: '没有管理员权限。' }, 403);
  }

  const body = await request.json().catch(() => null);
  const userId = String(body?.userId || '').trim();
  const plan = normalizePlan(body?.plan);
  const credits = Number(body?.credits);
  if (!userId || !plan || !Number.isInteger(credits) || credits < 0 || credits > 100000) {
    return authJson({ ok: false, message: '用户、套餐或额度参数不正确。' }, 400);
  }

  await env.DB.prepare(
    `UPDATE users
     SET plan = ?, credits = ?, updated_at = CURRENT_TIMESTAMP
     WHERE id = ?`
  ).bind(plan, credits, userId).run();

  const user = await env.DB.prepare(
    'SELECT id, email, name, avatar_url, plan, credits, created_at, updated_at FROM users WHERE id = ?'
  ).bind(userId).first();

  return authJson({ ok: true, user });
}

function normalizePlan(value) {
  const plan = String(value || '').trim().toLowerCase();
  return ['free', 'monthly', 'yearly', 'lifetime', 'pro', 'admin'].includes(plan) ? plan : '';
}

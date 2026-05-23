import { authJson, getSessionUser } from '../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const user = await getSessionUser(request, env);
  if (!user) return authJson({ ok: false, message: '请先登录。' }, 401);

  const rows = await env.DB.prepare(
    `SELECT id, action, source_url, result_title, credits_used, status, created_at
     FROM usage_records
     WHERE user_id = ?
     ORDER BY created_at DESC
     LIMIT 30`
  ).bind(user.id).all();
  return authJson({ ok: true, records: rows.results || [] });
}

import { authJson, getSessionUser, isAdminUser } from '../_auth.js';
import { getSiteContent, saveSiteContent } from '../_site_content.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  if (env.PUBLIC_FREE_MODE === 'true') return authJson({ ok: false, message: '管理后台未开启。' }, 404);
  if (!env.DB) return authJson({ ok: false, message: '数据库暂未配置。' }, 500);

  const currentUser = await getSessionUser(request, env);
  if (!isAdminUser(currentUser, env)) return authJson({ ok: false, message: '没有管理员权限。' }, 403);

  const content = await getSiteContent(env.DB);
  return authJson({ ok: true, content });
}

export async function onRequestPatch(context) {
  const { request, env } = context;
  if (env.PUBLIC_FREE_MODE === 'true') return authJson({ ok: false, message: '管理后台未开启。' }, 404);
  if (!env.DB) return authJson({ ok: false, message: '数据库暂未配置。' }, 500);

  const currentUser = await getSessionUser(request, env);
  if (!isAdminUser(currentUser, env)) return authJson({ ok: false, message: '没有管理员权限。' }, 403);

  const body = await request.json().catch(() => null);
  if (!body?.content) return authJson({ ok: false, message: '缺少站点文案配置。' }, 400);
  const content = await saveSiteContent(env.DB, body.content);
  return authJson({ ok: true, content });
}

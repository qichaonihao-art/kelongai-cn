import { authJson, getSessionUser, isAdminUser } from '../_auth.js';
import { listMembershipPlans, upsertMembershipPlan } from '../_plans.js';

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

  const plans = await listMembershipPlans(env.DB);
  return authJson({ ok: true, plans });
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
  const plans = Array.isArray(body?.plans) ? body.plans : [body?.plan || body].filter(Boolean);
  if (!plans.length) return authJson({ ok: false, message: '缺少套餐配置。' }, 400);

  const saved = [];
  try {
    for (const plan of plans) {
      saved.push(await upsertMembershipPlan(env.DB, plan));
    }
  } catch (error) {
    return authJson({ ok: false, message: error.message || '套餐保存失败。' }, 400);
  }

  return authJson({ ok: true, plans: saved });
}

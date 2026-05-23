import { authJson, getConfig, getSessionUser, getUsageSummary, isAdminUser } from '../_auth.js';

export async function onRequestGet(context) {
  if (getConfig(context.env).publicFreeMode) {
    return authJson({ ok: true, user: null, usage: null });
  }

  const user = await getSessionUser(context.request, context.env);
  const usage = await getUsageSummary(context.env, context.request, user);
  return authJson({ ok: true, user, usage, isAdmin: isAdminUser(user, context.env) });
}

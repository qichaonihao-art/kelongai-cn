import { OAUTH_STATE_COOKIE, authJson, getConfig, makeId, serializeCookie } from '../_auth.js';

export async function onRequestGet(context) {
  const { env } = context;
  const config = getConfig(env);
  if (!config.googleClientId || !config.googleRedirectUri) {
    return authJson({ ok: false, message: 'Google 登录暂未配置。' }, 500);
  }

  const state = makeId('state');
  const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
  url.searchParams.set('client_id', config.googleClientId);
  url.searchParams.set('redirect_uri', config.googleRedirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('scope', 'openid email profile');
  url.searchParams.set('state', state);
  url.searchParams.set('prompt', 'select_account');

  return new Response(null, {
    status: 302,
    headers: {
      Location: url.toString(),
      'Set-Cookie': serializeCookie(OAUTH_STATE_COOKIE, state, { maxAge: 10 * 60 })
    }
  });
}

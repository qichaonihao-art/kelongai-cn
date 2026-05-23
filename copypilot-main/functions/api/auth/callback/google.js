import {
  OAUTH_STATE_COOKIE,
  SESSION_COOKIE,
  getConfig,
  makeId,
  parseCookies,
  serializeCookie,
  signSession
} from '../../_auth.js';

export async function onRequestGet(context) {
  const { request, env } = context;
  const config = getConfig(env);
  const url = new URL(request.url);
  const code = url.searchParams.get('code');
  const state = url.searchParams.get('state');
  const cookies = parseCookies(request);

  if (!env.DB || !code || !state || cookies[OAUTH_STATE_COOKIE] !== state) {
    return redirectWithError(config.appOrigin, 'google_login_failed');
  }

  const tokenRes = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      code,
      client_id: config.googleClientId,
      client_secret: config.googleClientSecret,
      redirect_uri: config.googleRedirectUri,
      grant_type: 'authorization_code'
    })
  });
  if (!tokenRes.ok) return redirectWithError(config.appOrigin, 'google_token_failed');
  const token = await tokenRes.json();

  const userRes = await fetch('https://www.googleapis.com/oauth2/v2/userinfo', {
    headers: { Authorization: `Bearer ${token.access_token}` }
  });
  if (!userRes.ok) return redirectWithError(config.appOrigin, 'google_user_failed');
  const googleUser = await userRes.json();

  const user = await upsertGoogleUser(env.DB, googleUser);
  const session = await signSession({
    user_id: user.id,
    email: user.email,
    exp: Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60
  }, config.sessionSecret);

  const response = new Response(null, {
    status: 302,
    headers: { Location: config.appOrigin }
  });
  response.headers.append('Set-Cookie', serializeCookie(SESSION_COOKIE, session, { maxAge: 7 * 24 * 60 * 60 }));
  response.headers.append('Set-Cookie', serializeCookie(OAUTH_STATE_COOKIE, '', { maxAge: 0 }));
  return response;
}

async function upsertGoogleUser(db, googleUser) {
  const email = String(googleUser.email || '').toLowerCase();
  const existing = await db.prepare('SELECT id FROM users WHERE email = ?').bind(email).first();
  if (existing) {
    await db.prepare(
      `UPDATE users SET name = ?, avatar_url = ?, google_id = ?, updated_at = CURRENT_TIMESTAMP WHERE email = ?`
    ).bind(googleUser.name || null, googleUser.picture || null, googleUser.id || null, email).run();
  } else {
    await db.prepare(
      `INSERT INTO users (id, email, name, avatar_url, google_id, credits)
       VALUES (?, ?, ?, ?, ?, 30)`
    ).bind(makeId('usr'), email, googleUser.name || null, googleUser.picture || null, googleUser.id || null).run();
  }
  return db.prepare('SELECT id, email, name, avatar_url, plan, credits FROM users WHERE email = ?').bind(email).first();
}

function redirectWithError(origin, error) {
  const url = new URL(origin);
  url.searchParams.set('auth_error', error);
  return Response.redirect(url.toString(), 302);
}

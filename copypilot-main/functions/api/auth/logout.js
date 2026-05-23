import { SESSION_COOKIE, authJson, serializeCookie } from '../_auth.js';

export async function onRequestPost() {
  return authJson({ ok: true }, 200, {
    'Set-Cookie': serializeCookie(SESSION_COOKIE, '', { maxAge: 0 })
  });
}

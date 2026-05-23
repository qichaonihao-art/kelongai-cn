import { authJson, getConfig, hashValue, makeId } from '../_auth.js';

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return authJson({ ok: false, message: '数据库暂未配置。' }, 500);

  const body = await request.json().catch(() => null);
  const email = normalizeEmail(body?.email);
  if (!email) return authJson({ ok: false, message: '请输入正确的邮箱。' }, 400);

  const recent = await env.DB.prepare(
    `SELECT created_at FROM email_login_codes
     WHERE email = ? AND created_at > datetime('now', '-60 seconds')
     ORDER BY created_at DESC LIMIT 1`
  ).bind(email).first();
  if (recent) return authJson({ ok: false, message: '验证码发送太频繁，请 60 秒后再试。' }, 429);

  const config = getConfig(env);
  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeHash = await hashValue(`${email}:${code}`, config.sessionSecret);
  await env.DB.prepare(
    `INSERT INTO email_login_codes (id, email, code_hash, expires_at, ip_hash)
     VALUES (?, ?, ?, datetime('now', '+10 minutes'), ?)`
  ).bind(makeId('code'), email, codeHash, await getIpHash(request, config.sessionSecret)).run();

  const sent = await sendEmailCode({ email, code, config, env });
  const localDev = isLocalDev(request);
  if (!sent && !localDev) {
    return authJson({ ok: false, message: '邮件服务暂未配置完成，请稍后再试。' }, 503);
  }

  return authJson({
    ok: true,
    message: sent ? '验证码已发送，请查看邮箱。' : '本地测试验证码已生成。',
    devCode: sent ? undefined : code
  });
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

async function getIpHash(request, secret) {
  const ip = request.headers.get('CF-Connecting-IP') || request.headers.get('X-Forwarded-For') || 'unknown';
  return hashValue(ip, secret);
}

async function sendEmailCode({ email, code, config, env }) {
  const message = buildEmailMessage({ email, code, config });
  if (config.resendKey) {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${config.resendKey}`,
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    });
    if (response.ok) return true;
    console.error('Resend email send failed', response.status, await response.text().catch(() => ''));
  }

  if (config.mailerUrl && config.mailerSecret) {
    try {
      const response = await fetch(config.mailerUrl, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${config.mailerSecret}`,
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ to: email, code })
      });
      if (response.ok) return true;
    } catch (error) {
      console.error('Mailer worker send failed', error?.message || error);
    }
  }

  return false;
}

function buildEmailMessage({ email, code, config }) {
  return {
    from: config.emailFrom || 'CopyPilot <no-reply@copypilot.cc>',
    to: email,
    subject: 'CopyPilot 登录验证码',
    text: `你的 CopyPilot 登录验证码是 ${code}，10 分钟内有效。`,
    html: `
      <div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.7;color:#111827">
        <h2 style="margin:0 0 12px">CopyPilot 登录验证码</h2>
        <p>你的验证码是：</p>
        <p style="font-size:32px;font-weight:800;letter-spacing:6px;margin:16px 0">${code}</p>
        <p>验证码 10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>
      </div>
    `
  };
}

function isLocalDev(request) {
  const url = new URL(request.url);
  return url.hostname === '127.0.0.1' || url.hostname === 'localhost';
}

import { EmailMessage } from 'cloudflare:email';

export default {
  async fetch(request, env) {
    if (request.method !== 'POST') {
      return json({ ok: false, message: 'Method not allowed' }, 405);
    }

    const auth = request.headers.get('Authorization') || '';
    if (!env.MAILER_SECRET || auth !== `Bearer ${env.MAILER_SECRET}`) {
      return json({ ok: false, message: 'Unauthorized' }, 401);
    }

    const body = await request.json().catch(() => null);
    const to = normalizeEmail(body?.to);
    const code = String(body?.code || '').trim();
    if (!to || !/^\d{6}$/.test(code)) {
      return json({ ok: false, message: 'Invalid payload' }, 400);
    }

    const from = env.EMAIL_FROM || 'CopyPilot <no-reply@copypilot.cc>';
    const { address: fromAddress, label: fromLabel } = parseMailbox(from);
    try {
      const raw = buildRawEmail({ fromAddress, fromLabel, to, code });
      await env.EMAIL.send(new EmailMessage(fromAddress, to, raw));
      return json({ ok: true });
    } catch (error) {
      return json({
        ok: false,
        message: 'Email sending failed',
        detail: error?.message || String(error)
      }, 500);
    }
  }
};

function json(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

function normalizeEmail(value) {
  const email = String(value || '').trim().toLowerCase();
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) ? email : '';
}

function parseMailbox(value) {
  const input = String(value || '').trim();
  const match = input.match(/^(.*?)\s*<([^>]+)>$/);
  if (!match) return { label: 'CopyPilot', address: input || 'no-reply@copypilot.cc' };
  return { label: match[1].trim() || 'CopyPilot', address: match[2].trim() };
}

function buildRawEmail({ fromAddress, fromLabel, to, code }) {
  const boundary = `copypilot_${crypto.randomUUID().replaceAll('-', '')}`;
  const subject = encodeHeader('CopyPilot 登录验证码');
  const text = `你的 CopyPilot 登录验证码是 ${code}，10 分钟内有效。`;
  const html = `
    <div style="font-family:Arial,'Microsoft YaHei',sans-serif;line-height:1.7;color:#111827">
      <h2 style="margin:0 0 12px">CopyPilot 登录验证码</h2>
      <p>你的验证码是：</p>
      <p style="font-size:32px;font-weight:800;letter-spacing:6px;margin:16px 0">${code}</p>
      <p>验证码 10 分钟内有效。如果不是你本人操作，可以忽略这封邮件。</p>
    </div>
  `.trim();

  return [
    `From: ${encodeHeader(fromLabel)} <${fromAddress}>`,
    `To: <${to}>`,
    `Subject: ${subject}`,
    'MIME-Version: 1.0',
    `Content-Type: multipart/alternative; boundary="${boundary}"`,
    '',
    `--${boundary}`,
    'Content-Type: text/plain; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    text,
    '',
    `--${boundary}`,
    'Content-Type: text/html; charset=UTF-8',
    'Content-Transfer-Encoding: 8bit',
    '',
    html,
    '',
    `--${boundary}--`
  ].join('\r\n');
}

function encodeHeader(value) {
  const input = String(value || '');
  if (/^[\x00-\x7F]*$/.test(input)) return input;
  const bytes = new TextEncoder().encode(input);
  let binary = '';
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return `=?UTF-8?B?${btoa(binary)}?=`;
}

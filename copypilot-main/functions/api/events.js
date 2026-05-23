import { getAnonymousId, makeId } from './_auth.js';

const ALLOWED_EVENTS = new Set([
  'page_view',
  'paste_link',
  'extract_start',
  'extract_success',
  'extract_failed',
  'extract_blocked',
  'copy_text',
  'copy_article_html',
  'rewrite_start',
  'rewrite_success',
  'rewrite_failed'
]);

export async function onRequestPost(context) {
  const { request, env } = context;
  if (!env.DB) return json({ ok: true, stored: false });

  const body = await request.json().catch(() => null);
  const eventName = String(body?.eventName || body?.event || '').trim();
  if (!ALLOWED_EVENTS.has(eventName)) return json({ ok: false, message: 'Unknown event.' }, 400);

  const anon = await getAnonymousId(request);
  await ensureTable(env.DB);

  const payload = sanitizePayload(body);
  await env.DB.prepare(
    `INSERT INTO product_events (id, anonymous_id, event_name, path, tool_type, platform, status, payload_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
  ).bind(
    makeId('evt'),
    anon.id,
    eventName,
    sanitizeText(body?.path, 160),
    sanitizeText(body?.toolType || body?.targetType, 80),
    sanitizeText(body?.platform, 80),
    eventName.endsWith('_failed') ? 'failed' : eventName.endsWith('_blocked') ? 'blocked' : 'ok',
    JSON.stringify(payload)
  ).run();

  const headers = anon.setCookie ? { 'Set-Cookie': anon.setCookie } : {};
  return json({ ok: true, stored: true }, 200, headers);
}

async function ensureTable(db) {
  await db.prepare(
    `CREATE TABLE IF NOT EXISTS product_events (
      id TEXT PRIMARY KEY,
      anonymous_id TEXT,
      event_name TEXT NOT NULL,
      path TEXT,
      tool_type TEXT,
      platform TEXT,
      status TEXT NOT NULL DEFAULT 'ok',
      payload_json TEXT,
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    )`
  ).run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_product_events_created ON product_events(created_at)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_product_events_name ON product_events(event_name)').run();
  await db.prepare('CREATE INDEX IF NOT EXISTS idx_product_events_path ON product_events(path)').run();
}

function sanitizePayload(body) {
  const allowed = {};
  for (const key of ['lang', 'inputType', 'targetType', 'toolType', 'mediaType', 'durationBucket', 'hasVideo', 'hasImage', 'hasTranscript', 'hasText', 'textLength', 'imageCount', 'template', 'aiUsed', 'reason']) {
    if (body?.[key] !== undefined) allowed[key] = body[key];
  }
  return allowed;
}

function sanitizeText(value, maxLength) {
  return String(value || '').replace(/[<>{}]/g, '').slice(0, maxLength);
}

function json(payload, status = 200, headers = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      ...headers
    }
  });
}

import { createServer } from 'node:http';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const here = path.dirname(fileURLToPath(import.meta.url));
const publicDir = path.join(here, 'public');
const mimeTypes = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.ico', 'image/x-icon'],
]);

function secureEqual(a, b) {
  const left = Buffer.from(String(a));
  const right = Buffer.from(String(b));
  return left.length === right.length && timingSafeEqual(left, right);
}

function json(res, status, body) {
  res.writeHead(status, {
    'content-type': 'application/json; charset=utf-8',
    'cache-control': 'no-store',
    'x-content-type-options': 'nosniff',
  });
  res.end(JSON.stringify(body));
}

async function readJson(req) {
  let raw = '';
  for await (const chunk of req) {
    raw += chunk;
    if (raw.length > 1_000_000) throw new Error('请求内容过大');
  }
  return raw ? JSON.parse(raw) : {};
}

function normalizeSession(input) {
  const rawDuration = Number(input.duration ?? input.duration_seconds);
  const duration = Math.round(rawDuration);
  const performedAt = new Date(input.performedAt ?? input.performed_at ?? input.date ?? Date.now()).getTime();
  const note = String(input.note || '').trim().slice(0, 280);
  if (!Number.isFinite(duration) || duration < 1 || duration > 86_400) throw new Error('训练时长无效');
  if (!Number.isFinite(performedAt)) throw new Error('训练日期无效');
  return {
    clientId: String(input.clientId ?? input.client_id ?? input.id ?? randomUUID()).slice(0, 100),
    duration,
    performedAt,
    note,
  };
}

function cookieValue(req, name) {
  const cookies = String(req.headers.cookie || '').split(';');
  for (const item of cookies) {
    const [key, ...rest] = item.trim().split('=');
    if (key === name) return decodeURIComponent(rest.join('='));
  }
  return '';
}

export function createPlankServer(options = {}) {
  const password = options.password ?? process.env.PLANK_PASSWORD ?? '';
  const secret = options.secret ?? process.env.SESSION_SECRET ?? '';
  const dataDir = options.dataDir ?? process.env.PLANK_DATA_DIR ?? path.join(here, 'data');
  const secureCookies = options.secureCookies ?? process.env.NODE_ENV === 'production';
  if (!password || !secret) throw new Error('必须配置 PLANK_PASSWORD 和 SESSION_SECRET');
  mkdirSync(dataDir, { recursive: true });

  const db = new DatabaseSync(path.join(dataDir, 'plank.db'));
  db.exec(`
    PRAGMA journal_mode = WAL;
    PRAGMA foreign_keys = ON;
    CREATE TABLE IF NOT EXISTS plank_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      client_id TEXT NOT NULL UNIQUE,
      duration_seconds INTEGER NOT NULL CHECK(duration_seconds BETWEEN 1 AND 86400),
      performed_at INTEGER NOT NULL,
      note TEXT NOT NULL DEFAULT '',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
    CREATE INDEX IF NOT EXISTS idx_plank_performed_at ON plank_sessions(performed_at DESC);
  `);

  const loginAttempts = new Map();
  const sign = (value) => createHmac('sha256', secret).update(value).digest('base64url');
  const issueToken = () => {
    const expires = String(Date.now() + 30 * 24 * 60 * 60 * 1000);
    return `${expires}.${sign(expires)}`;
  };
  const authenticated = (req) => {
    const [expires, signature] = cookieValue(req, 'plank_session').split('.');
    return Boolean(expires && signature && Number(expires) > Date.now() && secureEqual(signature, sign(expires)));
  };
  const sameOrigin = (req) => {
    const origin = req.headers.origin;
    if (!origin) return true;
    try { return new URL(origin).host === req.headers.host; } catch { return false; }
  };

  const list = db.prepare(`SELECT id, client_id AS clientId, duration_seconds AS duration,
    performed_at AS performedAt, note, created_at AS createdAt, updated_at AS updatedAt
    FROM plank_sessions ORDER BY performed_at DESC, id DESC`);
  const insert = db.prepare(`INSERT INTO plank_sessions
    (client_id, duration_seconds, performed_at, note) VALUES (?, ?, ?, ?)
    ON CONFLICT(client_id) DO UPDATE SET duration_seconds=excluded.duration_seconds,
      performed_at=excluded.performed_at, note=excluded.note, updated_at=unixepoch()`);
  const remove = db.prepare('DELETE FROM plank_sessions WHERE id = ?');

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url || '/', `http://${req.headers.host || 'localhost'}`);
      const ip = String(req.headers['x-forwarded-for'] || req.socket.remoteAddress || '').split(',')[0].trim();

      if (url.pathname === '/api/auth/status' && req.method === 'GET') {
        return json(res, 200, { authenticated: authenticated(req) });
      }
      if (url.pathname === '/api/auth/login' && req.method === 'POST') {
        const recent = (loginAttempts.get(ip) || []).filter((time) => time > Date.now() - 10 * 60 * 1000);
        if (recent.length >= 8) return json(res, 429, { error: '尝试次数过多，请稍后再试' });
        const body = await readJson(req);
        if (!secureEqual(body.password || '', password)) {
          recent.push(Date.now()); loginAttempts.set(ip, recent);
          return json(res, 401, { error: '密码不正确' });
        }
        loginAttempts.delete(ip);
        res.setHeader('set-cookie', `plank_session=${issueToken()}; Path=/; HttpOnly; SameSite=Strict; Max-Age=2592000${secureCookies ? '; Secure' : ''}`);
        return json(res, 200, { ok: true });
      }
      if (url.pathname === '/api/auth/logout' && req.method === 'POST') {
        res.setHeader('set-cookie', `plank_session=; Path=/; HttpOnly; SameSite=Strict; Max-Age=0${secureCookies ? '; Secure' : ''}`);
        return json(res, 200, { ok: true });
      }

      if (url.pathname.startsWith('/api/')) {
        if (!authenticated(req)) return json(res, 401, { error: '请先登录' });
        if (!sameOrigin(req)) return json(res, 403, { error: '请求来源无效' });
      }
      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        return json(res, 200, { sessions: list.all() });
      }
      if (url.pathname === '/api/sessions' && req.method === 'POST') {
        const item = normalizeSession(await readJson(req));
        insert.run(item.clientId, item.duration, item.performedAt, item.note);
        return json(res, 201, { ok: true, sessions: list.all() });
      }
      if (url.pathname === '/api/sessions/import' && req.method === 'POST') {
        const body = await readJson(req);
        const values = Array.isArray(body) ? body : body.sessions;
        if (!Array.isArray(values) || values.length > 10_000) throw new Error('导入文件格式无效');
        db.exec('BEGIN');
        try {
          for (const value of values) {
            const item = normalizeSession(value);
            insert.run(item.clientId, item.duration, item.performedAt, item.note);
          }
          db.exec('COMMIT');
        } catch (error) {
          db.exec('ROLLBACK');
          throw error;
        }
        return json(res, 200, { ok: true, imported: values.length, sessions: list.all() });
      }
      const deleteMatch = url.pathname.match(/^\/api\/sessions\/(\d+)$/);
      if (deleteMatch && req.method === 'DELETE') {
        remove.run(Number(deleteMatch[1]));
        return json(res, 200, { ok: true });
      }

      const relative = url.pathname === '/' ? 'index.html' : url.pathname.replace(/^\/+/, '');
      const filePath = path.resolve(publicDir, relative);
      if (!filePath.startsWith(`${publicDir}${path.sep}`) || !existsSync(filePath)) {
        return json(res, 404, { error: '页面不存在' });
      }
      const extension = path.extname(filePath);
      const revalidate = extension === '.html' || ['sw.js', 'app.js', 'styles.css'].includes(relative);
      res.writeHead(200, {
        'content-type': mimeTypes.get(extension) || 'application/octet-stream',
        'cache-control': revalidate ? 'no-cache' : 'public, max-age=3600',
        'x-content-type-options': 'nosniff',
        'x-frame-options': 'DENY',
        'referrer-policy': 'same-origin',
        'content-security-policy': "default-src 'self'; style-src 'self'; script-src 'self'; img-src 'self' data:; connect-src 'self'; manifest-src 'self'",
      });
      res.end(readFileSync(filePath));
    } catch (error) {
      json(res, 400, { error: error instanceof Error ? error.message : '请求失败' });
    }
  });

  server.on('close', () => db.close());
  return server;
}

// PM2 runs application scripts through its own small Node launcher, so the
// script path is not always argv[1]. Checking the full argv list keeps this
// module importable by tests while still starting correctly under PM2.
if (process.argv.includes(fileURLToPath(import.meta.url))) {
  const port = Number(process.env.PORT || 3100);
  const host = process.env.HOST || '127.0.0.1';
  createPlankServer().listen(port, host, () => console.log(`Plank tracker listening on http://${host}:${port}`));
}

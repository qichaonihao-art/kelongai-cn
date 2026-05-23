import { onRequestPost as extractPost } from './copypilot-api/extract.js';
import { onRequestPost as transcribeLinkPost } from './copypilot-api/transcribe-link.js';
import { onRequestPost as transcribeLinkQwenPost } from './copypilot-api/transcribe-link-qwen.mjs';
import { onRequestPost as transcribePost } from './copypilot-api/transcribe.js';
import { onRequestGet as videoProxyGet } from './copypilot-api/video-proxy.js';
import { onRequestGet as imageProxyGet } from './copypilot-api/image-proxy.js';
import { onRequestPost as batchExtractPost } from './copypilot-api/batch-extract.js';
import { onRequestGet as healthGet } from './copypilot-api/health.js';
import { onRequestPost as rewritePost } from './copypilot-api/rewrite.js';
import { onRequestPost as eventsPost } from './copypilot-api/events.js';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';

// Map existing env names to copypilot expected names
if (!process.env.TIKHUB_API_KEY && process.env.TIKHUB_API_TOKEN) {
  process.env.TIKHUB_API_KEY = process.env.TIKHUB_API_TOKEN;
}

async function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on('data', chunk => chunks.push(chunk));
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

function isMultipartRequest(req) {
  return String(req.headers['content-type'] || '').toLowerCase().includes('multipart/form-data');
}

function createRequest(req, url, bodyBuffer) {
  const fullUrl = `http://${req.headers.host || 'localhost'}${req.url}`;
  const headers = new Headers();
  for (const [key, value] of Object.entries(req.headers)) {
    if (Array.isArray(value)) {
      for (const v of value) headers.append(key, v);
    } else if (value !== undefined && value !== null) {
      headers.set(key, String(value));
    }
  }

  let body = undefined;
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    if (isMultipartRequest(req)) {
      // For multipart, pass the raw stream so Request.formData() can parse it
      body = req;
    } else if (bodyBuffer && bodyBuffer.length > 0) {
      body = bodyBuffer;
    }
  }

  const init = {
    method: req.method,
    headers,
    body,
  };
  if (isMultipartRequest(req)) {
    (init).duplex = 'half';
  }

  return new Request(fullUrl, init);
}

function createContext(req, url, bodyBuffer) {
  return {
    request: createRequest(req, url, bodyBuffer),
    env: process.env,
  };
}

async function sendResponse(res, response) {
  res.statusCode = response.status;
  for (const [key, value] of response.headers) {
    if (key.toLowerCase() === 'set-cookie') {
      const existing = res.getHeader('set-cookie');
      if (existing) {
        res.setHeader('set-cookie', Array.isArray(existing) ? [...existing, value] : [existing, value]);
      } else {
        res.setHeader('set-cookie', value);
      }
    } else {
      res.setHeader(key, value);
    }
  }
  if (!response.body) {
    res.end();
    return;
  }
  await pipeline(Readable.fromWeb(response.body), res);
}

async function handlePost(handler, req, res, url) {
  const bodyBuffer = isMultipartRequest(req) ? null : await readBody(req);
  const context = createContext(req, url, bodyBuffer);
  const response = await handler(context);
  await sendResponse(res, response);
}

async function handleGet(handler, req, res, url) {
  const context = createContext(req, url);
  const response = await handler(context);
  await sendResponse(res, response);
}

function stubJson(payload, status = 200) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { 'Content-Type': 'application/json; charset=utf-8' }
  });
}

const authMeGet = () => stubJson({ ok: true, user: null, isAdmin: false });
const authLogoutPost = () => stubJson({ ok: true });
const authSendCodePost = () => stubJson({ ok: false, message: '未配置' }, 503);
const authVerifyCodePost = () => stubJson({ ok: false, message: '未配置' }, 503);
const authGoogleGet = () => new Response(null, { status: 302, headers: { 'Location': '/' } });
const siteContentGet = () => stubJson({ ok: true, content: {} });
const membershipPlansGet = () => stubJson({ ok: true, plans: [] });
const userRecordsGet = () => stubJson({ ok: true, records: [] });
const adminForbidden = () => stubJson({ ok: false, message: '未配置' }, 403);

const ROUTES = [
  { method: 'POST', path: '/api/cp/extract', handler: extractPost },
  { method: 'POST', path: '/api/cp/transcribe-link', handler: transcribeLinkPost },
  { method: 'POST', path: '/api/cp/transcribe-link-qwen', handler: transcribeLinkQwenPost },
  { method: 'POST', path: '/api/cp/transcribe', handler: transcribePost },
  { method: 'POST', path: '/api/cp/batch-extract', handler: batchExtractPost },
  { method: 'GET', path: '/api/cp/video-proxy', handler: videoProxyGet },
  { method: 'GET', path: '/api/cp/image-proxy', handler: imageProxyGet },
  { method: 'GET', path: '/api/cp/health', handler: healthGet },
  { method: 'POST', path: '/api/cp/rewrite', handler: rewritePost },
  { method: 'POST', path: '/api/cp/events', handler: eventsPost },
  { method: 'GET', path: '/api/cp/auth/me', handler: authMeGet },
  { method: 'POST', path: '/api/cp/auth/logout', handler: authLogoutPost },
  { method: 'POST', path: '/api/cp/auth/send-code', handler: authSendCodePost },
  { method: 'POST', path: '/api/cp/auth/verify-code', handler: authVerifyCodePost },
  { method: 'GET', path: '/api/cp/auth/google', handler: authGoogleGet },
  { method: 'GET', path: '/api/cp/site/content', handler: siteContentGet },
  { method: 'GET', path: '/api/cp/membership/plans', handler: membershipPlansGet },
  { method: 'GET', path: '/api/cp/user/records', handler: userRecordsGet },
  { method: 'GET', path: '/api/cp/admin/users', handler: adminForbidden },
  { method: 'PATCH', path: '/api/cp/admin/users', handler: adminForbidden },
  { method: 'GET', path: '/api/cp/admin/membership-plans', handler: adminForbidden },
  { method: 'PATCH', path: '/api/cp/admin/membership-plans', handler: adminForbidden },
  { method: 'GET', path: '/api/cp/admin/site-content', handler: adminForbidden },
  { method: 'PATCH', path: '/api/cp/admin/site-content', handler: adminForbidden },
  { method: 'GET', path: '/api/cp/admin/analytics', handler: adminForbidden },
];

export async function tryHandleCopypilotRoute(req, res, url) {
  for (const route of ROUTES) {
    if (req.method === route.method && url.pathname === route.path) {
      if (route.method === 'GET') {
        await handleGet(route.handler, req, res, url);
      } else {
        await handlePost(route.handler, req, res, url);
      }
      return true;
    }
  }
  return false;
}

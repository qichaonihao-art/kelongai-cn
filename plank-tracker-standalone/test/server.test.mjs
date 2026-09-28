import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createPlankServer } from '../server.mjs';

test('login, create, list, and delete a session', async (t) => {
  const dataDir = mkdtempSync(path.join(tmpdir(), 'plank-test-'));
  const server = createPlankServer({ password: 'correct horse', secret: 'test-secret-that-is-long-enough', dataDir });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { server.close(); rmSync(dataDir, { recursive: true, force: true }); });
  const base = `http://127.0.0.1:${server.address().port}`;

  const login = await fetch(`${base}/api/auth/login`, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ password: 'correct horse' }) });
  assert.equal(login.status, 200);
  const cookie = login.headers.get('set-cookie').split(';')[0];

  const created = await fetch(`${base}/api/sessions`, { method: 'POST', headers: { cookie, 'content-type': 'application/json' }, body: JSON.stringify({ clientId: 'phone-1', duration: 93.427, performedAt: 1_700_000_000_000 }) });
  assert.equal(created.status, 201);

  const listed = await fetch(`${base}/api/sessions`, { headers: { cookie } });
  const body = await listed.json();
  assert.equal(body.sessions.length, 1);
  assert.equal(body.sessions[0].duration, 93);

  const removed = await fetch(`${base}/api/sessions/${body.sessions[0].id}`, { method: 'DELETE', headers: { cookie, 'content-type': 'application/json' }, body: '{}' });
  assert.equal(removed.status, 200);
});

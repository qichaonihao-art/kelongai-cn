import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const root = await mkdtemp(path.join(tmpdir(), 'scene-edit-form-'));
process.env.KELONG_SKIP_LISTEN = '1';
process.env.RUNTIME_STATE_DIR = root;
process.env.VIDEO_LIBRARY_DIR = path.join(root, 'library');
process.env.MEDIAKIT_API_KEY = '';
process.env.SEEDANCE_API_KEY = '';
const originalFetch = globalThis.fetch;
globalThis.fetch = async () => { throw new Error('This multipart test must never contact an upstream'); };
try {
  const { handlePersonReplacement } = await import('./server.mjs');
  async function submit(extra) {
    const form = new FormData();
    for (const [key, value] of Object.entries({ creationRequestId: crypto.randomUUID(), editVersion: '2', model: 'doubao-seedance-2-5-260628', resolution: '720p', audioMode: 'preserve', prompt: '', personMode: 'keep', faceMode: 'mask', ...extra })) form.set(key, value);
    const encoded = new Request('http://local.test', { method: 'POST', body: form });
    const req = Readable.from([Buffer.from(await encoded.arrayBuffer())]);
    req.method = 'POST';
    req.headers = { 'content-type': encoded.headers.get('content-type'), 'x-device-id': 'form-device', host: 'localhost' };
    let status, result;
    const res = { writeHead(code) { status = code; }, end(body) { result = JSON.parse(body); } };
    await handlePersonReplacement(req, res, new URL('http://local.test/api/person-replacement/tasks'));
    assert.equal(status, 400);
    return result.error;
  }
  assert.match(await submit({}), /访问凭证/, 'empty optional prompt is accepted by the actual multipart route');
  assert.match(await submit({ personMode: 'bad' }), /人物处理/);
  assert.match(await submit({ faceMode: 'bad' }), /人脸预处理/);
  assert.match(await submit({ personMode: 'generate', personDescription: '人'.repeat(1001) }), /新人物描述/);
  assert.match(await submit({ clothing: '衣'.repeat(501) }), /服装/);
  assert.match(await submit({ scene: '景'.repeat(1001) }), /场景/);
  assert.match(await submit({ editVersion: '', prompt: '' }), /编辑要求/, 'legacy requests retain their own required prompt');
  console.log('PASS: real multipart route passes edit version, person mode, face mode, person description, clothing and scene without upstream calls');
} finally {
  globalThis.fetch = originalFetch;
  await rm(root, { recursive: true, force: true });
}

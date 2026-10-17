import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, mkdtemp, readFile, readdir, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';

const root = await mkdtemp(path.join(tmpdir(), 'person-library-test-'));
process.env.KELONG_SKIP_LISTEN = '1';
process.env.RUNTIME_STATE_DIR = path.join(root, 'state');
process.env.VIDEO_LIBRARY_DIR = path.join(root, 'library');
process.env.SEEDANCE_API_KEY = 'test-only';
process.env.MEDIAKIT_API_KEY = 'test-only';
await mkdir(process.env.RUNTIME_STATE_DIR, { recursive: true });
const model = 'doubao-seedance-2-0-260128';
const createdAt = Date.parse('2026-10-17T02:00:00Z');
const originalFetch = globalThis.fetch;
const networkCalls = [];
let highBytes;
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  networkCalls.push({ target, method: options.method || 'GET' });
  if (target.includes('/contents/generations/tasks/')) {
    assert.equal(options.method, 'GET', 'save may query an existing generation but cannot create one');
    return Response.json({ id: 'cgt-regular', status: 'succeeded', model, created_at: createdAt / 1000, content: { video_url: 'https://test.invalid/high.mp4' } });
  }
  if (target === 'https://test.invalid/high.mp4') return new Response(highBytes, { headers: { 'Content-Type': 'video/mp4' } });
  if (target.endsWith('/request-media-upload-url')) return Response.json({ result: { file_id: 'test-media', upload_url: 'https://test.invalid/upload' } });
  if (target === 'https://test.invalid/upload') { for await (const chunk of options.body) assert.ok(chunk.length); return new Response(''); }
  if (target.endsWith('/enhance-video')) return Response.json({ task_id: 'test-enhancement' });
  if (target.endsWith('/tasks/test-enhancement')) return Response.json({ status: 'processing' });
  throw new Error(`Unexpected network call: ${target}`);
};

try {
  const { getCollectionDb, handlePersonReplacement, handleSaveSeedanceVideoToLibrary, formatSeedanceVideoLibraryName } = await import('./server.mjs');
  const db = getCollectionDb();
  async function call(url, body, deviceId = 'device-a', regular = false) {
    const req = Readable.from(body ? [JSON.stringify(body)] : []);
    req.method = body ? 'POST' : 'GET';
    req.headers = { host: 'localhost', 'content-type': 'application/json', ...(deviceId ? { 'x-device-id': deviceId } : {}) };
    let status, result;
    const res = { writeHead(code) { status = code; }, end(value) { result = JSON.parse(value); } };
    if (regular) await handleSaveSeedanceVideoToLibrary(req, res);
    else await handlePersonReplacement(req, res, new URL(url, 'http://localhost'));
    return { status, ...result };
  }
  await call('/api/person-replacement/tasks'); // Initialize and migrate the real service schema.
  async function fixture(size, color) {
    const filename = path.join(root, `${size}-${color}.mp4`);
    await promisify(execFile)('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=${color}:s=${size}:d=0.2`, '-an', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', filename]);
    return readFile(filename);
  }
  const finalBytes = await fixture('480x854', 'blue');
  highBytes = await fixture('1280x720', 'red');
  async function addCompleted(id, bytes) {
    const job = { id, requestId: crypto.randomUUID(), stage: 'completed', model, resolution: '480p', audioMode: 'silent',
      createdAt, updatedAt: createdAt, prompt: '换成新人物', sourceName: 'source.mp4', mediaToken: 'test-token', baseUrl: 'https://test.invalid' };
    db.prepare('INSERT INTO person_replacement_jobs (id, request_id, data, device_id) VALUES (?, ?, ?, ?)').run(id, job.requestId, JSON.stringify(job), 'device-a');
    const directory = path.join(process.env.RUNTIME_STATE_DIR, 'person-replacement', id);
    await mkdir(directory, { recursive: true });
    await writeFile(path.join(directory, 'source.mp4'), highBytes);
    await writeFile(path.join(directory, 'generated.mp4'), highBytes);
    await writeFile(path.join(directory, 'result.mp4'), bytes);
  }
  await addCompleted('person-a', finalBytes);
  const saveUrl = '/api/person-replacement/tasks/person-a/save';
  assert.equal((await call(saveUrl, { folderName: '产品素材' }, '')).status, 400);
  assert.equal((await call(saveUrl, { folderName: '产品素材' }, 'device-b')).status, 400);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_library_items').get().n, 0, 'other devices cannot save this task');
  const saved = await call(saveUrl, { folderName: '产品素材' });
  assert.equal(saved.status, 201);
  assert.equal(saved.duplicate, false);
  assert.equal(saved.sourceBytes, finalBytes.length);
  assert.equal(saved.savedBytes, finalBytes.length);
  assert.equal(saved.item.originalName, formatSeedanceVideoLibraryName(createdAt));
  assert.equal(saved.item.note, 'Seedance 2.0 稳定版 · 来自创意素材');
  assert.equal(saved.enhancement.queued, true);
  const stored = db.prepare('SELECT stored_name FROM video_library_items WHERE id = ?').get(saved.item.id);
  assert.deepEqual(await readFile(path.join(process.env.VIDEO_LIBRARY_DIR, stored.stored_name)), finalBytes, 'save final silent result intact, not source or raw model output');
  const record = (await call('/api/person-replacement/tasks')).tasks.find(item => item.id === 'person-a');
  assert.equal(record.libraryFolder, '产品素材');
  assert.equal(record.libraryItemId, saved.item.id);
  const duplicate = await call(saveUrl, { folderName: '另一文件夹' });
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.item.id, saved.item.id);
  assert.equal(duplicate.item.folderName, '产品素材', 'duplicate save reports its actual folder without moving it');
  assert.equal(duplicate.item.enhancement.id, saved.item.enhancement.id);

  // A normal generation and two person jobs with identical output must share one entry, even concurrently.
  await addCompleted('person-b', highBytes);
  await addCompleted('person-c', highBytes);
  const concurrent = await Promise.all([
    call('/api/person-replacement/tasks/person-b/save', { folderName: '并发素材' }),
    call('/api/person-replacement/tasks/person-c/save', { folderName: '并发素材' }),
    call('/api/video-library/import-seedance', { taskId: 'cgt-regular', model, folderName: '并发素材' }, 'device-a', true),
  ]);
  assert.ok(concurrent.every(item => [200, 201].includes(item.status)), JSON.stringify(concurrent));
  assert.equal(new Set(concurrent.map(item => item.item.id)).size, 1);
  assert.equal(concurrent.filter(item => !item.duplicate).length, 1);
  assert.ok(concurrent.every(item => item.enhancement.reason === 'not_480p'));
  assert.ok(concurrent.every(item => item.sourceBytes === highBytes.length && item.savedBytes === highBytes.length));
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_library_items').get().n, 2);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_enhancement_tasks').get().n, 2, 'one shared enhancement decision per file');
  await addCompleted('person-invalid', Buffer.from('invalid'));
  assert.equal((await call('/api/person-replacement/tasks/person-invalid/save', { folderName: '产品素材' })).status, 400);
  assert.equal((await call('/api/person-replacement/tasks')).tasks.find(item => item.id === 'person-invalid').libraryFolder, '');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_library_items').get().n, 2);
  assert.ok(!(await readdir(process.env.VIDEO_LIBRARY_DIR)).some(name => name.endsWith('.importing')));
  assert.ok(!networkCalls.some(item => item.target.includes('face-blur') || (item.method === 'POST' && item.target.includes('/contents/generations'))));
  console.log('PASS: shared regular/person video saving, final audio bytes preserved, device ownership, standard filenames/notes, duplicate/concurrent saves, durable saved folder, 480P enhancement, HD skip and invalid-file handling');
} finally {
  globalThis.fetch = originalFetch;
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

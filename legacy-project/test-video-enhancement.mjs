import assert from 'node:assert/strict';
import { access, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.KELONG_SKIP_LISTEN = '1';
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kelongai-video-enhancement-'));
process.env.RUNTIME_STATE_DIR = path.join(temporaryRoot, 'runtime');
process.env.VIDEO_LIBRARY_DIR = path.join(temporaryRoot, 'video-library');
await mkdir(process.env.RUNTIME_STATE_DIR, { recursive: true });
await mkdir(process.env.VIDEO_LIBRARY_DIR, { recursive: true });

const {
  getCollectionDb,
  parseFpsFraction,
  isVideo480pOrLower,
  extractEnhancementOutputUrl,
  normalizeEnhancementRemoteStatus,
  normalizeMediaKitUploadHeaders,
  buildVideoEnhancementRetryUpdates,
  cleanupCompletedVideoEnhancementSources,
} = await import('./server.mjs');

assert.equal(parseFpsFraction('30000/1001'), 29.97);
assert.equal(parseFpsFraction('25/1'), 25);
assert.equal(isVideo480pOrLower({ width: 480, height: 854 }), true);
assert.equal(isVideo480pOrLower({ width: 496, height: 864 }), true);
assert.equal(isVideo480pOrLower({ width: 540, height: 960 }), false);
assert.equal(isVideo480pOrLower({ width: 720, height: 1280 }), false);
assert.equal(normalizeEnhancementRemoteStatus({ data: { status: 'COMPLETED' } }), 'completed');
assert.equal(
  extractEnhancementOutputUrl({ result: { outputs: [{ video_url: 'https://example.com/enhanced.mp4' }] } }),
  'https://example.com/enhanced.mp4',
);
assert.deepEqual(
  normalizeMediaKitUploadHeaders({ 'x-upload-token': 'abc', 'x-number': 123 }),
  { 'x-upload-token': 'abc', 'x-number': '123' },
);
assert.deepEqual(
  normalizeMediaKitUploadHeaders([
    { key: 'x-upload-token', value: 'abc' },
    { name: 'x-request-id', value: 'request-1' },
  ]),
  { 'x-upload-token': 'abc', 'x-request-id': 'request-1' },
);
assert.deepEqual(buildVideoEnhancementRetryUpdates(123), {
  status: 'queued',
  externalTaskId: '',
  requestId: '',
  inputMediaUri: '',
  attemptCount: 0,
  errorMessage: '',
  nextPollAt: 123,
});

const database = getCollectionDb();
const sourceStoredName = 'source-480p.mp4';
const outputStoredName = 'output-1080p.mp4';
await writeFile(path.join(process.env.VIDEO_LIBRARY_DIR, sourceStoredName), '480p');
await writeFile(path.join(process.env.VIDEO_LIBRARY_DIR, outputStoredName), '1080p');
const sourceResult = database.prepare(`
  INSERT INTO video_library_items
    (folder_name, original_name, stored_name, mime_type, file_size, sha256, note, width, height)
  VALUES ('测试素材', '测试.mp4', ?, 'video/mp4', 4, 'source-hash', 'Seedance 2.0 Mini · 来自创意素材 · 方向34', 496, 864)
`).run(sourceStoredName);
const sourceId = Number(sourceResult.lastInsertRowid);
const outputResult = database.prepare(`
  INSERT INTO video_library_items
    (folder_name, original_name, stored_name, mime_type, file_size, sha256, note, width, height, variant)
  VALUES ('测试素材', '测试.mp4', ?, 'video/mp4', 5, 'output-hash', 'AI MediaKit 标准版增强至1080P · 原素材ID 510', 1080, 1920, 'enhanced')
`).run(outputStoredName);
const outputId = Number(outputResult.lastInsertRowid);
database.prepare(`
  INSERT INTO video_enhancement_tasks
    (source_item_id, output_item_id, public_token, status, completed_at)
  VALUES (?, ?, 'cleanup-test-token', 'completed', unixepoch())
`).run(sourceId, outputId);
assert.equal(await cleanupCompletedVideoEnhancementSources(), 1);
assert.equal(database.prepare('SELECT id FROM video_library_items WHERE id = ?').get(sourceId), undefined);
assert.equal(Number(database.prepare('SELECT id FROM video_library_items WHERE id = ?').get(outputId)?.id), outputId);
assert.equal(
  database.prepare('SELECT note FROM video_library_items WHERE id = ?').get(outputId)?.note,
  'Seedance 2.0 Mini · 来自创意素材 · 方向34',
);
await assert.rejects(access(path.join(process.env.VIDEO_LIBRARY_DIR, sourceStoredName)));
await access(path.join(process.env.VIDEO_LIBRARY_DIR, outputStoredName));

await rm(temporaryRoot, { recursive: true, force: true });

console.log('视频画质增强 — 无费测试通过');

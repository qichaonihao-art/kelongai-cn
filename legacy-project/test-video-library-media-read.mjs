import assert from 'node:assert/strict';
import childProcess from 'node:child_process';
import { syncBuiltinESMExports } from 'node:module';
import { promisify } from 'node:util';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

// Hold the media worker indefinitely to reproduce a batch backlog without real media or network calls.
const originalExec = childProcess.execFile;
const blockedExec = () => {};
blockedExec[promisify.custom] = () => new Promise(() => {});
childProcess.execFile = blockedExec;
syncBuiltinESMExports();
const root = await mkdtemp(path.join(os.tmpdir(), 'library-media-read-'));
process.env.KELONG_SKIP_LISTEN = '1';
process.env.RUNTIME_STATE_DIR = path.join(root, 'state');
process.env.VIDEO_LIBRARY_DIR = path.join(root, 'videos');
await mkdir(process.env.RUNTIME_STATE_DIR, { recursive: true });
await mkdir(process.env.VIDEO_LIBRARY_DIR, { recursive: true });
const { getCollectionDb, handleVideoLibraryFile, handleVideoLibraryThumbnail, handleGetVideoLibraryFolders } = await import('./server.mjs');
const db = getCollectionDb();
function response() {
  return { status: 0, headers: {}, writeHead(status, headers) { this.status = status; this.headers = headers; }, end() {} };
}
async function promptly(task) {
  let timer;
  try { await Promise.race([task, new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('Read waited for queued media work')), 500); })]); }
  finally { clearTimeout(timer); }
}
try {
  db.prepare('INSERT INTO video_library_items (id,folder_name,original_name,stored_name,sha256) VALUES (1,?,?,?,?)').run('批量视频', '视频.mp4', 'source.mp4', 'abcdef');
  await writeFile(path.join(process.env.VIDEO_LIBRARY_DIR, 'source.mp4'), 'original-video-bytes');
  const cover = response();
  await promptly(handleVideoLibraryThumbnail({}, cover, '1'));
  assert.equal(cover.status, 503);
  assert.equal(cover.headers['Retry-After'], '5');
  assert.equal(cover.headers['Cache-Control'], 'no-store');
  for (let i = 0; i < 20; i++) {
    const res = response();
    await promptly(handleVideoLibraryFile({ method: 'HEAD', headers: {} }, res, '1', new URL('http://localhost/file?preview=1')));
    assert.equal(res.status, 200);
    assert.equal(res.headers['X-Video-Library-Variant'], 'original');
    assert.equal(res.headers['Cache-Control'], 'private, no-store');
    assert.equal(res.headers['Content-Length'], String(Buffer.byteLength('original-video-bytes')));
  }
  const overview = response();
  await promptly(handleGetVideoLibraryFolders({}, overview));
  assert.equal(overview.status, 200);
  await writeFile(path.join(process.env.VIDEO_LIBRARY_DIR, 'abcdef.preview-v2.mp4'), 'ready-preview');
  const preview = response();
  await promptly(handleVideoLibraryFile({ method: 'HEAD', headers: { range: 'bytes=0-3' } }, preview, '1', new URL('http://localhost/file?preview=1')));
  assert.equal(preview.status, 206);
  assert.equal(preview.headers['X-Video-Library-Variant'], 'preview');
  const missing = response();
  await promptly(handleVideoLibraryThumbnail({}, missing, '999'));
  assert.equal(missing.status, 404);
  console.log('PASS: blocked media queue does not hold covers, 20 preview reads or folder listing; ready previews retain range support.');
} finally {
  childProcess.execFile = originalExec;
  syncBuiltinESMExports();
  // Let background filesystem checks finish before removing their inputs.
  await new Promise(resolve => setImmediate(resolve));
  db.close();
  await rm(root, { recursive: true, force: true });
}

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';

const root = await mkdtemp(path.join(os.tmpdir(), 'kelong-local-upload-'));
process.env.KELONG_SKIP_LISTEN = '1';
process.env.RUNTIME_STATE_DIR = path.join(root, 'state');
process.env.VIDEO_LIBRARY_DIR = path.join(root, 'videos');
process.env.MEDIAKIT_API_KEY = 'local-upload-test-key';
await mkdir(process.env.RUNTIME_STATE_DIR, { recursive: true });
await mkdir(process.env.VIDEO_LIBRARY_DIR, { recursive: true });

const originalFetch = globalThis.fetch;
const submissions = [];
// 全部网络请求使用模拟响应，不访问真实收费服务。
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith('/request-media-upload-url')) {
    return Response.json({ result: { file_id: 'local-test-media', upload_url: 'https://test.invalid/upload' } });
  }
  if (target === 'https://test.invalid/upload') {
    for await (const chunk of options.body) assert.ok(chunk.length > 0);
    return new Response('');
  }
  if (target.endsWith('/enhance-video')) {
    submissions.push(JSON.parse(options.body));
    return Response.json({ task_id: 'local-test-task' });
  }
  if (target.endsWith('/tasks/local-test-task')) return Response.json({ status: 'processing' });
  throw new Error(`禁止测试网络访问：${target}`);
};

try {
  const { handleUploadVideoLibrary, getCollectionDb, runVideoEnhancementWorker } = await import('./server.mjs');
  const db = getCollectionDb();
  async function upload(bytes, name = '本地视频.mp4') {
    const form = new FormData();
    form.append('file', new File([bytes], name, { type: 'video/mp4' }));
    form.append('folderName', '本地测试');
    const request = new Request('http://localhost/api/video-library/videos', { method: 'POST', body: form });
    const req = Readable.fromWeb(request.body);
    req.method = 'POST';
    req.headers = Object.fromEntries(request.headers);
    req.headers.host = 'localhost';
    let status;
    let result;
    await handleUploadVideoLibrary(req, {
      writeHead(code) { status = code; },
      end(body) { result = JSON.parse(body); },
    });
    return { status, ...result };
  }
  async function fixture(size) {
    const file = path.join(root, `${size}.mp4`);
    await promisify(execFile)('ffmpeg', [
      '-v', 'error', '-y', '-f', 'lavfi', '-i', `color=blue:s=${size}:d=0.1`,
      '-c:v', 'libx264', '-pix_fmt', 'yuv420p', file,
    ]);
    return readFile(file);
  }
  const lowBytes = await fixture('480x854');
  const low = await upload(lowBytes);
  assert.equal(low.status, 201);
  assert.equal(low.enhancement.queued, true);
  assert.equal(low.item.width, 480);
  assert.equal(low.item.enhancement.targetResolution, '1080p');
  assert.equal(low.item.note, '本地上传');

  const duplicate = await upload(lowBytes);
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.duplicate, true);
  assert.equal(duplicate.item.id, low.item.id);
  assert.equal(duplicate.item.enhancement.id, low.item.enhancement.id);
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_enhancement_tasks').get().n, 1);

  // 模拟升级前已上传但尚未建立增强任务的素材，再次上传应补建任务。
  db.prepare('DELETE FROM video_enhancement_tasks WHERE source_item_id = ?').run(low.item.id);
  const legacyDuplicate = await upload(lowBytes);
  assert.equal(legacyDuplicate.duplicate, true);
  assert.equal(legacyDuplicate.enhancement.queued, true);

  const high = await upload(await fixture('1280x720'), '高清.mp4');
  assert.equal(high.status, 201);
  assert.equal(high.enhancement.reason, 'not_480p');
  assert.equal(high.item.enhancement.status, 'skipped');

  const invalid = await upload(Buffer.from('invalid video'), '损坏.mp4');
  assert.equal(invalid.status, 201, '检测失败仍保留上传的原片');
  assert.equal(invalid.enhancement.reason, 'metadata_failed');
  assert.equal(invalid.item.enhancement.status, 'failed');

  const deadline = Date.now() + 10000;
  while (db.prepare('SELECT status FROM video_enhancement_tasks WHERE source_item_id = ?').get(low.item.id)?.status !== 'submitted') {
    assert.ok(Date.now() < deadline, '等待增强任务提交超时');
    runVideoEnhancementWorker();
    await new Promise(resolve => setTimeout(resolve, 20));
  }
  assert.deepEqual(submissions, [{
    video_url: 'local-test-media', scene: 'aigc', tool_version: 'standard', resolution: '1080p',
  }]);
  console.log('本地视频上传自动增强：低清入队、高清跳过、重复上传去重与补建、损坏素材保留、1080P标准版提交均通过');
} finally {
  globalThis.fetch = originalFetch;
  // 允许异步生成缩略图、预览时产生的目录变动。
  await rm(root, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
}

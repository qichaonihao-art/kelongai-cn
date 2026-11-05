import assert from 'node:assert/strict';
import { Readable } from 'node:stream';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const stateDir = await mkdtemp(path.join(tmpdir(), 'video-library-folder-rename-route-'));
process.env.RUNTIME_STATE_DIR = stateDir;
process.env.KELONG_SKIP_LISTEN = '1';
const { getCollectionDb, handleRenameVideoLibraryFolder } = await import('./server.mjs');
const db = getCollectionDb();

function request(body) {
  const req = Readable.from([JSON.stringify(body)]);
  req.method = 'PATCH';
  req.headers = { 'content-type': 'application/json' };
  return req;
}

function response() {
  const res = { statusCode: 0, body: null };
  res.writeHead = (statusCode) => { res.statusCode = statusCode; };
  res.end = (payload) => { res.body = payload ? JSON.parse(payload) : null; };
  return res;
}

async function call(encodedName, body) {
  const res = response();
  await handleRenameVideoLibraryFolder(request(body), res, encodedName);
  return res;
}

try {
  db.prepare('INSERT INTO video_library_folders (folder_name) VALUES (?)').run('接口旧名称');
  db.prepare('INSERT INTO video_library_folders (folder_name) VALUES (?)').run('接口冲突');
  db.prepare('INSERT INTO video_library_items (folder_name, original_name, stored_name, sha256) VALUES (?, ?, ?, ?)')
    .run('接口旧名称', '视频.mp4', 'video.mp4', 'hash');

  const renamed = await call(encodeURIComponent('接口旧名称'), { newFolderName: '接口新名称' });
  assert.equal(renamed.statusCode, 200);
  assert.equal(renamed.body.folder, '接口新名称');
  assert.equal(renamed.body.previousFolder, '接口旧名称');
  assert.equal(db.prepare('SELECT id FROM video_library_folders WHERE folder_name = ?').get('接口新名称') !== undefined, true);
  assert.equal(db.prepare('SELECT folder_name FROM video_library_items LIMIT 1').get().folder_name, '接口新名称');

  const conflict = await call(encodeURIComponent('接口新名称'), { newFolderName: '接口冲突' });
  assert.equal(conflict.statusCode, 409);
  assert.match(conflict.body.error, /已存在/);

  const defaultFolder = await call(encodeURIComponent('通用素材'), { newFolderName: '接口新名称' });
  assert.equal(defaultFolder.statusCode, 400);
  assert.match(defaultFolder.body.error, /默认文件夹/);

  const missing = await call(encodeURIComponent('不存在的分类'), { newFolderName: '接口新名称' });
  assert.equal(missing.statusCode, 404);

  const invalid = await call(encodeURIComponent('接口新名称'), { newFolderName: '///' });
  assert.equal(invalid.statusCode, 400);
  assert.match(invalid.body.error, /符号/);

  console.log('PASS: 文件夹重命名接口更新真实 SQLite 数据，并正确处理重名、默认文件夹、不存在和非法名称');
} finally {
  db.close();
  await rm(stateDir, { recursive: true, force: true });
}

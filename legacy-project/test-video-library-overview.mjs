import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const stateDir = await mkdtemp(path.join(tmpdir(), 'video-library-overview-'));
process.env.RUNTIME_STATE_DIR = stateDir;
process.env.KELONG_SKIP_LISTEN = '1';
const { getCollectionDb, handleGetVideoLibraryFolders } = await import('./server.mjs');
const db = getCollectionDb();
try {
  db.prepare('INSERT OR IGNORE INTO video_library_folders (folder_name) VALUES (?)').run('空文件夹');
  const insert = db.prepare('INSERT INTO video_library_items (folder_name, original_name, stored_name, sha256) VALUES (?, ?, ?, ?)');
  db.exec('BEGIN');
  for (let i=0; i<1200; i++) insert.run('商品A', `视频${i}`, `file${i}.mp4`, `hash${i}`);
  insert.run('商品B', '视频', 'b.mp4', 'b');
  db.exec('COMMIT');
  let response;
  await handleGetVideoLibraryFolders({}, { writeHead(status) { assert.equal(status, 200); }, end(body) { response = JSON.parse(body); } });
  assert.equal(response.counts['商品A'],1200);
  assert.equal(response.counts['商品B'],1);
  assert.ok(response.folders.includes('空文件夹'));
  assert.ok(response.folders.indexOf('商品A') < response.folders.indexOf('商品B'));
  assert.equal(response.items,undefined);
  assert.ok(JSON.stringify(response).length < 500, 'Overview payload stays small despite 1201 videos');
  console.log('PASS: real SQLite overview with 1201 records returns accurate counts, empty folders and no video details');
} finally {
  db.close();
  await rm(stateDir,{recursive:true,force:true});
}

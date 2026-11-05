import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { renameVideoLibraryFolder } from './video-library-folder-rename.mjs';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE video_library_folders (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      folder_name TEXT NOT NULL UNIQUE,
      created_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE video_library_items (
      id INTEGER PRIMARY KEY,
      folder_name TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE painting_folder_bindings (
      id INTEGER PRIMARY KEY,
      folder_id INTEGER NOT NULL,
      folder_name TEXT NOT NULL,
      updated_at INTEGER NOT NULL DEFAULT 0
    );
    CREATE TABLE painting_batch_runs (
      id INTEGER PRIMARY KEY,
      target_folder_id INTEGER,
      target_folder_name TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'completed'
    );
    INSERT INTO video_library_folders (id, folder_name) VALUES
      (1, '旧分类'), (2, '已存在'), (3, '空分类');
    INSERT INTO video_library_items (id, folder_name) VALUES
      (10, '旧分类'), (11, '旧分类'), (12, '已存在'), (13, '仅视频');
    INSERT INTO painting_folder_bindings (id, folder_id, folder_name) VALUES
      (20, 1, '旧分类'), (21, 2, '已存在');
    INSERT INTO painting_batch_runs (id, target_folder_id, target_folder_name, status) VALUES
      (30, 1, '旧分类', 'running'), (31, 2, '已存在', 'completed'), (32, NULL, '旧分类', 'completed');
  `);
  return db;
}

test('重命名文件夹只改名称，视频、绑定和批量任务的目标文件夹 ID 不变', () => {
  const db = database();
  assert.deepEqual(renameVideoLibraryFolder(db, '旧分类', '新分类'), {
    status: 'renamed',
    folder: '新分类',
    previousFolder: '旧分类',
  });
  assert.deepEqual(db.prepare('SELECT id, folder_name FROM video_library_folders ORDER BY id').all().map((row) => ({ ...row })), [
    { id: 1, folder_name: '新分类' },
    { id: 2, folder_name: '已存在' },
    { id: 3, folder_name: '空分类' },
  ]);
  assert.deepEqual(db.prepare('SELECT id, folder_name FROM video_library_items ORDER BY id').all().map((row) => ({ ...row })), [
    { id: 10, folder_name: '新分类' },
    { id: 11, folder_name: '新分类' },
    { id: 12, folder_name: '已存在' },
    { id: 13, folder_name: '仅视频' },
  ]);
  assert.deepEqual(db.prepare('SELECT id, folder_id, folder_name FROM painting_folder_bindings ORDER BY id').all().map((row) => ({ ...row })), [
    { id: 20, folder_id: 1, folder_name: '新分类' },
    { id: 21, folder_id: 2, folder_name: '已存在' },
  ]);
  assert.deepEqual(db.prepare('SELECT id, target_folder_id, target_folder_name FROM painting_batch_runs ORDER BY id').all().map((row) => ({ ...row })), [
    { id: 30, target_folder_id: 1, target_folder_name: '新分类' },
    { id: 31, target_folder_id: 2, target_folder_name: '已存在' },
    { id: 32, target_folder_id: null, target_folder_name: '新分类' },
  ]);
  db.close();
});

test('空文件夹和只存在于视频记录里的历史分类也能重命名', () => {
  const db = database();
  assert.equal(renameVideoLibraryFolder(db, '空分类', '新空分类').status, 'renamed');
  assert.equal(db.prepare('SELECT id FROM video_library_folders WHERE folder_name = ?').get('新空分类').id, 3);

  assert.equal(renameVideoLibraryFolder(db, '仅视频', '新视频分类').status, 'renamed');
  assert.equal(db.prepare('SELECT id FROM video_library_folders WHERE folder_name = ?').get('新视频分类').id !== undefined, true);
  assert.equal(db.prepare('SELECT folder_name FROM video_library_items WHERE id = 13').get().folder_name, '新视频分类');
  db.close();
});

test('重名、默认文件夹、不存在的文件夹和空名称都会拒绝且不改数据', () => {
  const db = database();
  const snapshot = () => JSON.stringify({
    folders: db.prepare('SELECT * FROM video_library_folders ORDER BY id').all(),
    items: db.prepare('SELECT * FROM video_library_items ORDER BY id').all(),
    bindings: db.prepare('SELECT * FROM painting_folder_bindings ORDER BY id').all(),
    runs: db.prepare('SELECT * FROM painting_batch_runs ORDER BY id').all(),
  });
  const before = snapshot();

  assert.equal(renameVideoLibraryFolder(db, '旧分类', '已存在').status, 'conflict');
  assert.equal(renameVideoLibraryFolder(db, '旧分类', '通用素材').status, 'conflict');
  assert.equal(renameVideoLibraryFolder(db, '通用素材', '新分类').status, 'default');
  assert.equal(renameVideoLibraryFolder(db, '不存在', '新分类').status, 'missing');
  assert.equal(renameVideoLibraryFolder(db, '旧分类', '   ').status, 'invalid');
  assert.equal(renameVideoLibraryFolder(db, '旧分类', '旧分类').status, 'unchanged');
  assert.equal(snapshot(), before);
  db.close();
});

test('更新文件夹名称失败时连同视频和绑定一起回滚', () => {
  const db = database();
  db.exec(`CREATE TRIGGER reject_folder_rename BEFORE UPDATE OF folder_name ON video_library_folders BEGIN SELECT RAISE(ABORT, 'blocked'); END;`);
  assert.throws(() => renameVideoLibraryFolder(db, '旧分类', '新分类'), /blocked/);
  assert.equal(db.prepare('SELECT folder_name FROM video_library_folders WHERE id = 1').get().folder_name, '旧分类');
  assert.deepEqual(db.prepare('SELECT id, folder_name FROM video_library_items ORDER BY id').all().map((row) => ({ ...row })), [
    { id: 10, folder_name: '旧分类' },
    { id: 11, folder_name: '旧分类' },
    { id: 12, folder_name: '已存在' },
    { id: 13, folder_name: '仅视频' },
  ]);
  assert.equal(db.prepare('SELECT folder_name FROM painting_folder_bindings WHERE id = 20').get().folder_name, '旧分类');
  assert.equal(db.prepare('SELECT target_folder_name FROM painting_batch_runs WHERE id = 30').get().target_folder_name, '旧分类');
  db.close();
});

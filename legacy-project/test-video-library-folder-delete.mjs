import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { deleteEmptyVideoLibraryFolder } from './video-library-folder-delete.mjs';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`
    CREATE TABLE video_library_folders (id INTEGER PRIMARY KEY, folder_name TEXT NOT NULL UNIQUE);
    CREATE TABLE video_library_items (id INTEGER PRIMARY KEY, folder_name TEXT NOT NULL);
    CREATE TABLE painting_folder_bindings (id INTEGER PRIMARY KEY, folder_id INTEGER NOT NULL);
    CREATE TABLE painting_batch_runs (id INTEGER PRIMARY KEY, target_folder_id INTEGER, status TEXT NOT NULL);
    INSERT INTO video_library_folders VALUES (1, '空文件夹'), (2, '有视频'), (3, '生成中');
    INSERT INTO video_library_items VALUES (10, '有视频');
    INSERT INTO painting_folder_bindings VALUES (20, 1), (21, 2), (22, 3);
    INSERT INTO painting_batch_runs VALUES (30, 3, 'running');
  `);
  return db;
}

test('只删除空文件夹及其自动归类绑定，不碰其他视频', () => {
  const db = database();
  assert.deepEqual(deleteEmptyVideoLibraryFolder(db, '空文件夹'), { status: 'deleted' });
  assert.equal(db.prepare('SELECT id FROM video_library_folders WHERE id = 1').get(), undefined);
  assert.equal(db.prepare('SELECT id FROM painting_folder_bindings WHERE folder_id = 1').get(), undefined);
  assert.equal(db.prepare('SELECT id FROM video_library_items WHERE id = 10').get().id, 10);
  db.close();
});

test('有视频或仍被批量任务使用时不删除', () => {
  const db = database();
  assert.deepEqual(deleteEmptyVideoLibraryFolder(db, '有视频'), { status: 'not_empty' });
  assert.deepEqual(deleteEmptyVideoLibraryFolder(db, '生成中'), { status: 'in_use' });
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM video_library_folders').get().count, 3);
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM painting_folder_bindings').get().count, 3);
  assert.deepEqual(deleteEmptyVideoLibraryFolder(db, '不存在'), { status: 'missing' });
  db.close();
});

test('数据库删除失败会连同绑定清理一起回滚', () => {
  const db = database();
  db.exec(`CREATE TRIGGER reject_folder_delete BEFORE DELETE ON video_library_folders BEGIN SELECT RAISE(ABORT, 'blocked'); END;`);
  assert.throws(() => deleteEmptyVideoLibraryFolder(db, '空文件夹'), /blocked/);
  assert.equal(db.prepare('SELECT id FROM video_library_folders WHERE id = 1').get().id, 1);
  assert.equal(db.prepare('SELECT id FROM painting_folder_bindings WHERE folder_id = 1').get().id, 20);
  db.close();
});

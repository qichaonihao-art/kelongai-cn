import test from 'node:test';
import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { normalizeShotRoleIds, setVideoLibraryShotRole } from './video-library-shot-role.mjs';

function database() {
  const db = new DatabaseSync(':memory:');
  db.exec(`CREATE TABLE video_library_items (
    id INTEGER PRIMARY KEY, folder_name TEXT NOT NULL, shot_role INTEGER NOT NULL DEFAULT 0,
    updated_at INTEGER NOT NULL DEFAULT 0
  ); INSERT INTO video_library_items (id, folder_name) VALUES (1, '静心'), (2, '静心'), (3, '青云志');`);
  return db;
}

test('normalizes and validates an explicit snapshot of item IDs', () => {
  assert.deepEqual(normalizeShotRoleIds([2, 1, 2]), [2, 1]);
  for (const ids of [[], [0], ['bad']]) assert.throws(() => normalizeShotRoleIds(ids), error => error.statusCode === 400);
});

test('moves single or selected same-folder items without copying files', () => {
  const db = database();
  assert.deepEqual(setVideoLibraryShotRole(db, { ids: [1, 2], folderName: '静心', shotRole: 1 }), { ids: [1, 2], shotRole: 1 });
  assert.deepEqual(db.prepare('SELECT id, shot_role FROM video_library_items ORDER BY id').all().map((row) => ({ ...row })), [
    { id: 1, shot_role: 1 }, { id: 2, shot_role: 1 }, { id: 3, shot_role: 0 }
  ]);
  setVideoLibraryShotRole(db, { ids: [1], folderName: '静心', shotRole: 0 });
  assert.equal(db.prepare('SELECT shot_role FROM video_library_items WHERE id = 1').get().shot_role, 0);
  db.close();
});

test('a stale or cross-folder selection is rejected atomically', () => {
  const db = database();
  assert.throws(() => setVideoLibraryShotRole(db, { ids: [1, 3], folderName: '静心', shotRole: 1 }), error => error.statusCode === 409);
  assert.throws(() => setVideoLibraryShotRole(db, { ids: [1, 99], folderName: '静心', shotRole: 1 }), error => error.statusCode === 409);
  assert.equal(db.prepare('SELECT SUM(shot_role) AS total FROM video_library_items').get().total, 0);
  db.close();
});

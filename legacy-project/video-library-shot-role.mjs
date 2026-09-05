export function normalizeShotRoleIds(ids) {
  const targets = [...new Set((Array.isArray(ids) ? ids : []).map(Number))];
  if (!targets.length || targets.some((id) => !Number.isSafeInteger(id) || id <= 0)) {
    throw Object.assign(new Error('请选择有效的视频素材'), { statusCode: 400 });
  }
  return targets;
}

export function setVideoLibraryShotRole(db, { ids, folderName, shotRole }) {
  const targets = normalizeShotRoleIds(ids);
  const placeholders = targets.map(() => '?').join(',');
  const rows = db.prepare(`SELECT id, folder_name FROM video_library_items WHERE id IN (${placeholders})`).all(...targets);
  if (rows.length !== targets.length || rows.some((row) => row.folder_name !== folderName)) {
    throw Object.assign(new Error('部分素材已被移动或删除，请刷新后重试'), { statusCode: 409 });
  }
  const role = Number(shotRole) === 1 ? 1 : 0;
  const update = db.prepare('UPDATE video_library_items SET shot_role = ?, updated_at = unixepoch() WHERE id = ?');
  db.exec('BEGIN IMMEDIATE');
  try {
    for (const id of targets) update.run(role, id);
    db.exec('COMMIT');
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
  return { ids: targets, shotRole: role };
}

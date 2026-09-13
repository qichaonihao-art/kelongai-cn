/** 删除的只是空分类；有视频或仍被批量任务使用时，保留所有数据库记录。 */
export function deleteEmptyVideoLibraryFolder(db, folderName) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const folder = db.prepare('SELECT id FROM video_library_folders WHERE folder_name = ?').get(folderName);
    let status = 'missing';
    if (folder) {
      const item = db.prepare('SELECT id FROM video_library_items WHERE folder_name = ? LIMIT 1').get(folderName);
      const activeRun = db.prepare(`
        SELECT id FROM painting_batch_runs
        WHERE target_folder_id = ? AND status NOT IN ('completed', 'failed', 'stopped', 'cancelled')
        LIMIT 1
      `).get(folder.id);
      if (item) status = 'not_empty';
      else if (activeRun) status = 'in_use';
      else {
        db.prepare('DELETE FROM painting_folder_bindings WHERE folder_id = ?').run(folder.id);
        db.prepare('DELETE FROM video_library_folders WHERE id = ?').run(folder.id);
        status = 'deleted';
      }
    }
    db.exec('COMMIT');
    return { status };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

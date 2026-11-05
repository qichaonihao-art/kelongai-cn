const DEFAULT_FOLDER_NAME = '通用素材';

/**
 * 只改分类名称：视频文件、文件夹 ID、自动归类绑定和批量任务目标都保持原样。
 * 视频行通过 folder_name 关联分类，所以只更新名称，不复制或移动任何文件。
 */
export function renameVideoLibraryFolder(db, previousName, nextName) {
  const previous = String(previousName || '').trim();
  const next = String(nextName || '').trim();
  if (!previous || !next) return { status: 'invalid', message: '请输入文件夹名称' };
  if (previous === next) return { status: 'unchanged', folder: previous, previousFolder: previous };
  if (previous === DEFAULT_FOLDER_NAME) return { status: 'default', message: '默认文件夹不能重命名' };
  if (next === DEFAULT_FOLDER_NAME) return { status: 'conflict', message: '默认文件夹已存在，请换一个名称' };

  db.exec('BEGIN IMMEDIATE');
  try {
    const source = db.prepare('SELECT id FROM video_library_folders WHERE folder_name = ?').get(previous);
    const sourceItem = db.prepare('SELECT id FROM video_library_items WHERE folder_name = ? LIMIT 1').get(previous);
    if (!source && !sourceItem) {
      db.exec('ROLLBACK');
      return { status: 'missing', message: '文件夹不存在，请刷新后重试' };
    }

    const target = db.prepare('SELECT id FROM video_library_folders WHERE folder_name = ?').get(next);
    const targetItem = db.prepare('SELECT id FROM video_library_items WHERE folder_name = ? LIMIT 1').get(next);
    if (target || targetItem) {
      db.exec('ROLLBACK');
      return { status: 'conflict', message: `文件夹“${next}”已存在，请换一个名称` };
    }

    if (source) {
      db.prepare('UPDATE video_library_folders SET folder_name = ? WHERE id = ?').run(next, source.id);
    } else {
      // 历史数据里可能有只存在于视频记录中的分类，重命名时补一条分类记录。
      db.prepare('INSERT INTO video_library_folders (folder_name) VALUES (?)').run(next);
    }
    db.prepare('UPDATE video_library_items SET folder_name = ? WHERE folder_name = ?').run(next, previous);
    db.prepare('UPDATE painting_folder_bindings SET folder_name = ?, updated_at = unixepoch() WHERE folder_name = ?').run(next, previous);
    db.prepare('UPDATE painting_batch_runs SET target_folder_name = ? WHERE target_folder_name = ?').run(next, previous);
    if (source) {
      // 按 folder_id 再校准一次，避免绑定或任务中残留旧名称。
      db.prepare('UPDATE painting_folder_bindings SET folder_name = ?, updated_at = unixepoch() WHERE folder_id = ?').run(next, source.id);
      db.prepare('UPDATE painting_batch_runs SET target_folder_name = ? WHERE target_folder_id = ?').run(next, source.id);
    }

    db.exec('COMMIT');
    return { status: 'renamed', folder: next, previousFolder: previous };
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

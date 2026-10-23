export type VideoLibraryFolderChoiceSource = 'remembered' | 'matched' | 'last-used' | 'fallback' | 'manual';

type PaintingFolderContent = { name?: string; subject?: string; prompt?: string };
type FolderBinding = { folderName: string; folderId?: number | null };

const GENERIC_VIDEO_LIBRARY_FOLDERS = new Set(['通用素材', '待分类', '未分类', '默认文件夹']);

function normalizePaintingFolderMatchText(value: unknown): string {
  return String(value || '')
    .toLocaleLowerCase('zh-CN')
    .replace(/[\s\p{P}\p{S}_]+/gu, '')
    .replace(/(?:装饰画|挂画|挂轴|卷轴|书法作品|书法|国画|画作|画芯|竖版|竖幅|产品)/g, '');
}

function scorePaintingFolderText(folderText: string, sourceText: string, baseScore: number): number {
  if (!folderText || !sourceText || folderText.length < 2) return 0;
  if (folderText === sourceText) return baseScore + 20;
  if (sourceText.includes(folderText) || folderText.includes(sourceText)) return baseScore;

  const folderCharacters = Array.from(new Set(folderText));
  const sourceCharacters = new Set(sourceText);
  const overlap = folderCharacters.filter((character) => sourceCharacters.has(character)).length;
  if (overlap >= 2 && overlap / folderCharacters.length >= 0.75) return baseScore - 25;
  return 0;
}

function suggestPaintingVideoLibraryFolder(
  folders: string[],
  painting?: { name?: string; subject?: string; prompt?: string } | null
): string | null {
  const normalizedName = normalizePaintingFolderMatchText(painting?.name);
  const normalizedSubject = normalizePaintingFolderMatchText(painting?.subject);
  const normalizedPrompt = normalizePaintingFolderMatchText(painting?.prompt);
  let best: { folder: string; score: number } | null = null;

  for (const folder of folders) {
    if (GENERIC_VIDEO_LIBRARY_FOLDERS.has(folder.trim())) continue;
    const normalizedFolder = normalizePaintingFolderMatchText(folder);
    const score = Math.max(
      scorePaintingFolderText(normalizedFolder, normalizedName, 100),
      scorePaintingFolderText(normalizedFolder, normalizedSubject, 85),
      scorePaintingFolderText(normalizedFolder, normalizedPrompt, 82)
    );
    if (score < 70) continue;
    if (!best || score > best.score || (score === best.score && folder.length > best.folder.length)) {
      best = { folder, score };
    }
  }

  return best?.folder || null;
}

// 同款连续入库时，用户上次实际保存的选择优先于识别结果和旧绑定。
export async function resolvePaintingVideoLibraryFolder(options: {
  folders: string[];
  lastFolder: string;
  painting?: PaintingFolderContent | null;
  loadBinding?: () => Promise<FolderBinding | null>;
  recentSavedFolder?: string;
}): Promise<{ folder: string; source: VideoLibraryFolderChoiceSource; folderId: number | null }> {
  const { folders, lastFolder, painting, loadBinding, recentSavedFolder } = options;
  const hasContent = [painting?.name, painting?.subject, painting?.prompt]
    .some((value) => normalizePaintingFolderMatchText(value));
  // 提示词常只写作品名，不含文件夹里的款式前缀（如“新款青云志”）。
  const lastPaintingName = lastFolder.replace(/^(?:新款|旧款|老款)/, '');
  if (folders.includes(lastFolder) && (
    !hasContent || suggestPaintingVideoLibraryFolder([lastFolder, lastPaintingName], painting)
  )) {
    return { folder: lastFolder, source: 'last-used', folderId: null };
  }

  try {
    const binding = await loadBinding?.();
    if (binding && folders.includes(binding.folderName)) {
      return { folder: binding.folderName, source: 'remembered', folderId: binding.folderId ?? null };
    }
  } catch {
    // 历史绑定不可用时继续匹配，不阻断入库。
  }

  const matchedFolder = suggestPaintingVideoLibraryFolder(folders, painting);
  if (matchedFolder) return { folder: matchedFolder, source: 'matched', folderId: null };

  const previousFolder = [lastFolder, recentSavedFolder].find((folder) => folder && folders.includes(folder));
  if (previousFolder) return { folder: previousFolder, source: 'last-used', folderId: null };
  const folder = ['通用素材', '待分类'].find((candidate) => folders.includes(candidate)) || folders[0] || '通用素材';
  return { folder, source: 'fallback', folderId: null };
}

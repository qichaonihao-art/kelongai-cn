export interface VideoLibraryItem {
  id: number;
  folderName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  note: string;
  width: number;
  height: number;
  fps: number;
  durationSeconds: number;
  variant: 'original' | 'enhanced' | string;
  sourceItemId: number | null;
  shotRole: 0 | 1;
  enhancement: {
    id: number;
    status: string;
    targetResolution: string;
    errorMessage: string;
    outputItemId: number | null;
  } | null;
  createdAt: number;
  updatedAt: number;
  streamUrl: string;
  downloadUrl: string;
  downloadName: string;
  thumbnailUrl: string;
}

export interface VideoLibrarySummaryItem {
  id: number;
  folderName: string;
  createdAt: number;
}

interface VideoLibraryReadState {
  readKeys: string[];
}

export interface VideoLibraryUnreadState {
  total: number;
  unreadIds: Set<number>;
  byFolder: Map<string, number>;
}

export const VIDEO_LIBRARY_READ_CHANGE_EVENT = 'kelongai:video-library-read-change';
export const VIDEO_LIBRARY_READ_STATE_KEY = 'kelongai.videoLibraryReadState.v2';
const LEGACY_VIDEO_LIBRARY_READ_STATE_KEY = 'kelongai.videoLibraryReadState.v1';

function videoLibraryReadKey(item: Pick<VideoLibrarySummaryItem, 'id' | 'folderName'>) {
  return `${encodeURIComponent(String(item.folderName || ''))}:${Number(item.id)}`;
}

function loadVideoLibraryReadState(): VideoLibraryReadState | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIDEO_LIBRARY_READ_STATE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      readKeys: Array.isArray(parsed.readKeys)
        ? parsed.readKeys.map(String).filter(Boolean)
        : [],
    };
  } catch {
    return null;
  }
}

function saveVideoLibraryReadState(state: VideoLibraryReadState, notify = false) {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(VIDEO_LIBRARY_READ_STATE_KEY, JSON.stringify(state));
    if (notify) window.dispatchEvent(new Event(VIDEO_LIBRARY_READ_CHANGE_EVENT));
  } catch {
    // 浏览器禁用本地存储时，提醒失效不应影响视频素材库本身。
  }
}

function initializeVideoLibraryReadState(items: VideoLibrarySummaryItem[]): VideoLibraryReadState {
  if (typeof window === 'undefined') return { readKeys: [] };
  try {
    const legacy = JSON.parse(window.localStorage.getItem(LEGACY_VIDEO_LIBRARY_READ_STATE_KEY) || 'null');
    if (legacy && typeof legacy === 'object') {
      const baselineId = Number.isFinite(Number(legacy.baselineId)) ? Math.max(0, Number(legacy.baselineId)) : 0;
      const legacyReadIds = new Set(Array.isArray(legacy.readIds) ? legacy.readIds.map(Number) : []);
      const state = {
        readKeys: items
          .filter((item) => item.id <= baselineId || legacyReadIds.has(item.id))
          .map(videoLibraryReadKey),
      };
      saveVideoLibraryReadState(state);
      return state;
    }
  } catch {
    // 旧记录损坏时按新电脑首次进入处理，避免把全部历史素材突然标为新。
  }
  // 新电脑 / 新浏览器第一次进入：当时已有素材作为历史基线，之后新增的才显示“新”。
  const state = { readKeys: items.map(videoLibraryReadKey) };
  saveVideoLibraryReadState(state);
  return state;
}

export function calculateVideoLibraryUnread(items: VideoLibrarySummaryItem[]): VideoLibraryUnreadState {
  const validItems = items.filter((item) => Number.isInteger(item.id) && item.id > 0);
  const state = loadVideoLibraryReadState() || initializeVideoLibraryReadState(validItems);
  const currentKeys = new Set(validItems.map(videoLibraryReadKey));
  const readKeys = new Set(state.readKeys.filter((key) => currentKeys.has(key)));
  if (readKeys.size !== state.readKeys.length) saveVideoLibraryReadState({ readKeys: Array.from(readKeys) });

  const unreadIds = new Set<number>();
  const byFolder = new Map<string, number>();
  validItems.forEach((item) => {
    if (readKeys.has(videoLibraryReadKey(item))) return;
    unreadIds.add(item.id);
    byFolder.set(item.folderName, (byFolder.get(item.folderName) || 0) + 1);
  });
  return { total: unreadIds.size, unreadIds, byFolder };
}

export function markVideoLibraryItemsRead(items: Array<Pick<VideoLibrarySummaryItem, 'id' | 'folderName'>>) {
  const validItems = items.filter((item) => Number.isInteger(Number(item?.id)) && Number(item.id) > 0 && String(item.folderName || ''));
  if (!validItems.length || typeof window === 'undefined') return;
  const state = loadVideoLibraryReadState() || { readKeys: [] };
  const readKeys = new Set(state.readKeys);
  validItems.forEach((item) => readKeys.add(videoLibraryReadKey(item)));
  saveVideoLibraryReadState({ readKeys: Array.from(readKeys) }, true);
}

async function readJson(response: Response) {
  return response.json().catch(() => null);
}

function errorMessage(json: any, fallback: string) {
  return typeof json?.error === 'string' ? json.error : fallback;
}

export async function getVideoLibrary(filters?: { folder?: string; query?: string }) {
  const params = new URLSearchParams();
  if (filters?.folder) params.set('folder', filters.folder);
  if (filters?.query) params.set('q', filters.query);
  const query = params.toString();
  const response = await fetch(`/api/video-library/videos${query ? `?${query}` : ''}`, { credentials: 'include' });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '读取视频库失败'));
  return {
    items: Array.isArray(json?.items) ? json.items as VideoLibraryItem[] : [],
    folders: Array.isArray(json?.folders) ? json.folders as string[] : ['通用素材'],
  };
}

export async function uploadVideoLibraryVideo(file: File, folderName: string) {
  const formData = new FormData();
  formData.append('file', file, file.name);
  formData.append('folderName', folderName);
  const response = await fetch('/api/video-library/videos', {
    method: 'POST',
    credentials: 'include',
    body: formData,
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '上传视频失败'));
  return {
    item: json?.item as VideoLibraryItem,
    duplicate: Boolean(json?.duplicate),
    message: typeof json?.message === 'string' ? json.message : '',
  };
}

export async function createVideoLibraryFolder(folderName: string) {
  const response = await fetch('/api/video-library/folders', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ folderName }),
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '新建文件夹失败'));
  return String(json?.folder || folderName);
}

export async function getVideoLibraryFolders() {
  const response = await fetch('/api/video-library/folders', { credentials: 'include' });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '读取视频素材库文件夹失败'));
  return Array.isArray(json?.folders) ? json.folders.map(String) : ['通用素材'];
}

export async function getVideoLibrarySummary() {
  const response = await fetch('/api/video-library/summary', { credentials: 'include' });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '读取视频素材库提醒失败'));
  return Array.isArray(json?.items) ? json.items as VideoLibrarySummaryItem[] : [];
}

export async function saveSeedanceVideoToLibrary(input: {
  taskId: string;
  model?: string;
  folderName: string;
  createdAt?: number;
  paintingDirectionNumber?: number;
  paintingVariationRound?: number;
  autoEnhance480p?: boolean;
}) {
  const response = await fetch('/api/video-library/import-seedance', {
    method: 'POST',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '保存到视频素材库失败'));
  return {
    item: json?.item as VideoLibraryItem,
    duplicate: Boolean(json?.duplicate),
    sourceBytes: Number(json?.sourceBytes || 0),
    savedBytes: Number(json?.savedBytes || 0),
    message: typeof json?.message === 'string' ? json.message : '已保存到视频素材库',
    enhancement: json?.enhancement || null,
  };
}

export async function retryVideoEnhancement(id: number) {
  const response = await fetch(`/api/video-library/enhancements/${id}/retry`, {
    method: 'POST', credentials: 'include',
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '重新启动画质增强失败'));
  return json?.task;
}

export async function startVideoEnhancement(id: number) {
  const response = await fetch(`/api/video-library/videos/${id}/enhance`, {
    method: 'POST', credentials: 'include',
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '启动画质增强失败'));
  return json?.item as VideoLibraryItem;
}

export async function updateVideoLibraryItem(id: number, input: { note?: string; originalName?: string; folderName?: string; shotRole?: 0 | 1 }) {
  const response = await fetch(`/api/video-library/videos/${id}`, {
    method: 'PATCH',
    credentials: 'include',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(input),
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '更新视频信息失败'));
  return json?.item as VideoLibraryItem;
}

export async function setVideoLibraryShotRole(ids: number[], folderName: string, shotRole: 0 | 1) {
  const targets = [...new Set(ids.map(Number))];
  if (!targets.length || targets.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('请先选择视频素材');
  const response = await fetch('/api/video-library/videos/shot-role', {
    method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ids: targets, folderName, shotRole }),
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '移动镜头素材失败'));
  return Array.isArray(json?.items) ? json.items as VideoLibraryItem[] : [];
}

export async function deleteVideoLibraryVideo(id: number) {
  const response = await fetch(`/api/video-library/videos/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '删除视频失败'));
}

// Snapshot explicit IDs only; a failed item must not stop the remaining selection.
export async function deleteVideoLibrarySelection(ids: number[], onProgress?: (completed: number, total: number) => void) {
  const targets = [...new Set(ids)];
  if (targets.some((id) => !Number.isSafeInteger(id) || id <= 0)) throw new Error('素材编号无效，请刷新后重新选择');
  const deletedIds: number[] = [];
  const failures: { id: number; message: string }[] = [];
  for (const id of targets) {
    try {
      await deleteVideoLibraryVideo(id);
      deletedIds.push(id);
    } catch (error) {
      failures.push({ id, message: error instanceof Error ? error.message : '删除失败' });
    }
    onProgress?.(deletedIds.length + failures.length, targets.length);
  }
  return { deletedIds, failures };
}

export function formatVideoLibrarySize(bytes: number) {
  if (bytes < 1024 * 1024) return `${Math.max(1, Math.round(bytes / 1024))}KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)}MB`;
}

export function formatVideoLibraryTime(timestamp: number) {
  if (!timestamp) return '';
  return new Date(timestamp * 1000).toLocaleString('zh-CN', {
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
}

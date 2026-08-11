export interface VideoLibraryItem {
  id: number;
  folderName: string;
  originalName: string;
  mimeType: string;
  fileSize: number;
  sha256: string;
  note: string;
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
  baselineId: number;
  readIds: number[];
}

export interface VideoLibraryUnreadState {
  total: number;
  unreadIds: Set<number>;
  byFolder: Map<string, number>;
}

export const VIDEO_LIBRARY_READ_CHANGE_EVENT = 'kelongai:video-library-read-change';
export const VIDEO_LIBRARY_READ_STATE_KEY = 'kelongai.videoLibraryReadState.v1';

function loadVideoLibraryReadState(): VideoLibraryReadState | null {
  if (typeof window === 'undefined') return null;
  try {
    const parsed = JSON.parse(window.localStorage.getItem(VIDEO_LIBRARY_READ_STATE_KEY) || 'null');
    if (!parsed || typeof parsed !== 'object') return null;
    return {
      baselineId: Number.isFinite(Number(parsed.baselineId)) ? Math.max(0, Number(parsed.baselineId)) : 0,
      readIds: Array.isArray(parsed.readIds)
        ? parsed.readIds.map(Number).filter((id: number) => Number.isInteger(id) && id > 0)
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

export function calculateVideoLibraryUnread(items: VideoLibrarySummaryItem[]): VideoLibraryUnreadState {
  const validItems = items.filter((item) => Number.isInteger(item.id) && item.id > 0);
  const maximumCurrentId = validItems.reduce((maximum, item) => Math.max(maximum, item.id), 0);
  let state = loadVideoLibraryReadState();
  if (!state) {
    state = {
      baselineId: maximumCurrentId,
      readIds: [],
    };
    saveVideoLibraryReadState(state);
  } else if (state.baselineId > maximumCurrentId) {
    state = { baselineId: maximumCurrentId, readIds: [] };
    saveVideoLibraryReadState(state);
  }

  const currentIds = new Set(validItems.map((item) => item.id));
  const readIds = new Set(state.readIds.filter((id) => id > state.baselineId && currentIds.has(id)));
  if (readIds.size !== state.readIds.length) {
    saveVideoLibraryReadState({ baselineId: state.baselineId, readIds: Array.from(readIds) });
  }

  const unreadIds = new Set<number>();
  const byFolder = new Map<string, number>();
  validItems.forEach((item) => {
    if (item.id <= state.baselineId || readIds.has(item.id)) return;
    unreadIds.add(item.id);
    byFolder.set(item.folderName, (byFolder.get(item.folderName) || 0) + 1);
  });
  return { total: unreadIds.size, unreadIds, byFolder };
}

export function markVideoLibraryItemsRead(ids: number[]) {
  const validIds = Array.from(new Set(ids.map(Number).filter((id) => Number.isInteger(id) && id > 0)));
  if (!validIds.length || typeof window === 'undefined') return;
  const state = loadVideoLibraryReadState();
  if (!state) {
    saveVideoLibraryReadState({ baselineId: Math.max(...validIds), readIds: [] }, true);
    return;
  }
  const readIds = new Set(state.readIds);
  validIds.forEach((id) => {
    if (id > state.baselineId) readIds.add(id);
  });
  saveVideoLibraryReadState({ baselineId: state.baselineId, readIds: Array.from(readIds) }, true);
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
  folderName: string;
  createdAt?: number;
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
  };
}

export async function updateVideoLibraryItem(id: number, input: { note?: string; originalName?: string; folderName?: string }) {
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

export async function deleteVideoLibraryVideo(id: number) {
  const response = await fetch(`/api/video-library/videos/${id}`, {
    method: 'DELETE',
    credentials: 'include',
  });
  const json = await readJson(response);
  if (!response.ok) throw new Error(errorMessage(json, '删除视频失败'));
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

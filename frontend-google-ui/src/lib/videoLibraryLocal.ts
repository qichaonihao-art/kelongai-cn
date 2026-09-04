import { markVideoLibraryItemsRead, type VideoLibraryItem } from './videoLibrary';

const LOCAL_FOLDER_DB_NAME = 'kelongai-video-library-local-v1';
const LOCAL_FOLDER_STORE = 'folder-bindings';
const LOCAL_INDEX_FILE = '.kelong-video-library.json';
const DAILY_DESTINATION_KEY = '__daily-download-destination__';

export function videoLibraryDownloadDay(timestamp = Date.now()) {
  const date = new Date(timestamp);
  return `${date.getFullYear()}-${date.getMonth() + 1}-${date.getDate()}`;
}

export function isVideoLibraryDestinationCurrent(updatedAt: number, now = Date.now()) {
  return videoLibraryDownloadDay(updatedAt) === videoLibraryDownloadDay(now);
}

type LocalPermission = 'granted' | 'denied' | 'prompt';

export interface VideoLibraryWritableFileHandle {
  name: string;
  getFile(): Promise<File>;
  createWritable(): Promise<WritableStream<Uint8Array>>;
}

export interface VideoLibraryDirectoryHandle {
  kind: 'directory';
  name: string;
  queryPermission(options: { mode: 'readwrite' }): Promise<LocalPermission>;
  requestPermission(options: { mode: 'readwrite' }): Promise<LocalPermission>;
  getFileHandle(name: string, options?: { create?: boolean }): Promise<VideoLibraryWritableFileHandle>;
  removeEntry?(name: string): Promise<void>;
}

interface StoredFolderBinding {
  folderName: string;
  handle: VideoLibraryDirectoryHandle;
  updatedAt: number;
}

export interface VideoLibraryLocalReceipt {
  itemId: number;
  folderName: string;
  fileName: string;
  fileSize: number;
  sha256: string;
  downloadedAt: number;
}

export interface VideoLibraryLocalIndex {
  version: 1;
  folderName: string;
  downloads: Record<string, VideoLibraryLocalReceipt>;
}

declare global {
  interface Window {
    showDirectoryPicker?: (options?: { mode?: 'readwrite'; startIn?: string }) => Promise<VideoLibraryDirectoryHandle>;
  }
}

function openLocalFolderDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('当前浏览器不支持保存本地文件夹授权'));
      return;
    }
    const request = indexedDB.open(LOCAL_FOLDER_DB_NAME, 1);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(LOCAL_FOLDER_STORE)) db.createObjectStore(LOCAL_FOLDER_STORE, { keyPath: 'folderName' });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error || new Error('读取本地文件夹绑定失败'));
  });
}

async function runBindingRequest<T>(mode: IDBTransactionMode, action: (store: IDBObjectStore) => IDBRequest<T>): Promise<T> {
  const db = await openLocalFolderDb();
  return new Promise((resolve, reject) => {
    const transaction = db.transaction(LOCAL_FOLDER_STORE, mode);
    const request = action(transaction.objectStore(LOCAL_FOLDER_STORE));
    // 写入事务完成后才报告成功，避免界面已经切换但绑定未保存。
    request.onerror = () => reject(request.error || new Error('本地文件夹绑定操作失败'));
    transaction.oncomplete = () => { db.close(); resolve(request.result); };
    transaction.onabort = () => { db.close(); reject(transaction.error || new Error('保存位置未能记住，请重新选择')); };
    transaction.onerror = () => {
      db.close();
      reject(transaction.error || new Error('本地文件夹绑定操作失败'));
    };
  });
}

export function supportsVideoLibraryLocalDownload() {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function' && typeof indexedDB !== 'undefined';
}

export async function getVideoLibraryLocalFolderBinding(): Promise<StoredFolderBinding | null> {
  if (!supportsVideoLibraryLocalDownload()) return null;
  const result = await runBindingRequest<StoredFolderBinding | undefined>('readonly', (store) => store.get(DAILY_DESTINATION_KEY));
  return result && isVideoLibraryDestinationCurrent(result.updatedAt) ? result : null;
}

export async function chooseVideoLibraryLocalFolder(): Promise<StoredFolderBinding> {
  if (!window.showDirectoryPicker) throw new Error('当前浏览器不支持直接保存到本地文件夹，请使用最新版 Chrome 或 Edge。');
  const handle = await window.showDirectoryPicker({ mode: 'readwrite', startIn: 'downloads' });
  const binding: StoredFolderBinding = { folderName: DAILY_DESTINATION_KEY, handle, updatedAt: Date.now() };
  await runBindingRequest('readwrite', (store) => store.put(binding));
  return binding;
}

export async function ensureVideoLibraryLocalFolderPermission(handle: VideoLibraryDirectoryHandle) {
  if (await handle.queryPermission({ mode: 'readwrite' }) === 'granted') return true;
  return await handle.requestPermission({ mode: 'readwrite' }) === 'granted';
}

function emptyIndex(folderName: string): VideoLibraryLocalIndex {
  return { version: 1, folderName, downloads: {} };
}

async function getExistingFile(handle: VideoLibraryDirectoryHandle, name: string): Promise<{ handle: VideoLibraryWritableFileHandle; file: File } | null> {
  try {
    const fileHandle = await handle.getFileHandle(name);
    return { handle: fileHandle, file: await fileHandle.getFile() };
  } catch (error) {
    if (error instanceof DOMException && error.name === 'NotFoundError') return null;
    throw error;
  }
}

export async function loadVideoLibraryLocalIndex(handle: VideoLibraryDirectoryHandle, folderName: string): Promise<VideoLibraryLocalIndex> {
  const existing = await getExistingFile(handle, LOCAL_INDEX_FILE);
  if (!existing) return emptyIndex(folderName);
  try {
    const parsed = JSON.parse(await existing.file.text());
    if (!parsed || parsed.version !== 1 || typeof parsed.downloads !== 'object') return emptyIndex(folderName);
    return { version: 1, folderName, downloads: parsed.downloads as Record<string, VideoLibraryLocalReceipt> };
  } catch {
    return emptyIndex(folderName);
  }
}

export async function saveVideoLibraryLocalIndex(handle: VideoLibraryDirectoryHandle, index: VideoLibraryLocalIndex) {
  const fileHandle = await handle.getFileHandle(LOCAL_INDEX_FILE, { create: true });
  const writable = await fileHandle.createWritable();
  const bytes = new TextEncoder().encode(JSON.stringify(index, null, 2));
  await new Blob([bytes], { type: 'application/json' }).stream().pipeTo(writable);
}

function sanitizeLocalVideoName(value: string, itemId: number) {
  const raw = String(value || `video-${itemId}.mp4`).replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[. ]+$/g, '').trim();
  const safe = raw || `video-${itemId}.mp4`;
  if (safe.length <= 180) return safe;
  const dot = safe.lastIndexOf('.');
  const extension = dot > 0 ? safe.slice(dot).slice(0, 12) : '';
  return `${safe.slice(0, 180 - extension.length)}${extension}`;
}

function appendLocalNameSuffix(fileName: string, suffix: number) {
  const dot = fileName.lastIndexOf('.');
  if (dot <= 0) return `${fileName}_${suffix}`;
  return `${fileName.slice(0, dot)}_${suffix}${fileName.slice(dot)}`;
}

async function sha256File(file: File) {
  const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function isSameLocalVideo(file: File, item: VideoLibraryItem) {
  if (Number(file.size) !== Number(item.fileSize)) return false;
  if (!item.sha256 || !crypto?.subtle) return false;
  return (await sha256File(file)).toLowerCase() === String(item.sha256).toLowerCase();
}

async function recordCompletedLocalVideo(
  handle: VideoLibraryDirectoryHandle,
  index: VideoLibraryLocalIndex,
  item: VideoLibraryItem,
  fileName: string,
  fileSize: number,
) {
  index.downloads[String(item.id)] = {
    itemId: item.id,
    folderName: item.folderName,
    fileName,
    fileSize,
    sha256: item.sha256 || '',
    downloadedAt: Date.now(),
  };
  // 视频本身已经核验完成时立即更新本机已读；隐藏索引写入失败不能反过来删除完整视频。
  markVideoLibraryItemsRead([item]);
  try {
    await saveVideoLibraryLocalIndex(handle, index);
  } catch (error) {
    console.warn('[video library local] index write failed', { folderName: item.folderName, itemId: item.id, message: error instanceof Error ? error.message : String(error) });
  }
}

export async function reconcileVideoLibraryLocalIndex(
  handle: VideoLibraryDirectoryHandle,
  index: VideoLibraryLocalIndex,
  items: VideoLibraryItem[],
) {
  const restored: VideoLibraryItem[] = [];
  for (const item of items) {
    const receipt = index.downloads[String(item.id)];
    if (!receipt || receipt.folderName !== item.folderName) continue;
    const existing = await getExistingFile(handle, receipt.fileName);
    if (existing && await isSameLocalVideo(existing.file, item)) restored.push(item);
  }
  if (restored.length) markVideoLibraryItemsRead(restored);
  return restored.length;
}

export async function downloadVideoLibraryItemLocally(input: {
  item: VideoLibraryItem;
  handle: VideoLibraryDirectoryHandle;
  index: VideoLibraryLocalIndex;
  signal?: AbortSignal;
}): Promise<{ status: 'downloaded' | 'duplicate'; fileName: string }> {
  const { item, handle, index, signal } = input;
  signal?.throwIfAborted();
  const requestedName = sanitizeLocalVideoName(item.downloadName || item.originalName, item.id);
  const recorded = index.downloads[String(item.id)];
  if (recorded?.folderName === item.folderName) {
    const existing = await getExistingFile(handle, recorded.fileName);
    if (existing && await isSameLocalVideo(existing.file, item)) {
      await recordCompletedLocalVideo(handle, index, item, recorded.fileName, existing.file.size);
      return { status: 'duplicate', fileName: recorded.fileName };
    }
  }

  let targetName = requestedName;
  let availableName = false;
  for (let suffix = 1; suffix < 10_000; suffix += 1) {
    const existing = await getExistingFile(handle, targetName);
    if (!existing) { availableName = true; break; }
    if (await isSameLocalVideo(existing.file, item)) {
      await recordCompletedLocalVideo(handle, index, item, targetName, existing.file.size);
      return { status: 'duplicate', fileName: targetName };
    }
    targetName = appendLocalNameSuffix(requestedName, suffix + 1);
  }
  if (!availableName) throw new Error('同名文件过多，请选择新的保存位置');

  let created = false;
  let videoComplete = false;
  try {
    const response = await fetch(item.downloadUrl, { credentials: 'include', signal });
    if (!response.ok) {
      const payload = await response.json().catch(() => null);
      throw new Error(typeof payload?.error === 'string' ? payload.error : `下载失败（HTTP ${response.status}）`);
    }
    if (!response.body) throw new Error('下载响应中没有视频内容');
    const fileHandle = await handle.getFileHandle(targetName, { create: true });
    created = true;
    const writable = await fileHandle.createWritable();
    await response.body.pipeTo(writable, { signal });
    const savedFile = await fileHandle.getFile();
    if (Number(savedFile.size) !== Number(item.fileSize)) throw new Error('文件写入不完整，已保留为未读以便重试');
    if (!savedFile.size || (item.sha256 && !await isSameLocalVideo(savedFile, item))) throw new Error('文件内容校验失败，请重新下载');
    videoComplete = true;
    await recordCompletedLocalVideo(handle, index, item, targetName, savedFile.size);
    return { status: 'downloaded', fileName: targetName };
  } catch (error) {
    if (created && !videoComplete && handle.removeEntry) await handle.removeEntry(targetName).catch(() => {});
    throw error;
  }
}

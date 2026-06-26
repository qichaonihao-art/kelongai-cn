const DB_NAME = 'kelong-upload-history';
const DB_VERSION = 2;
const STORE_NAME = 'files';
const META_STORE_NAME = 'fileMetadata';
const HISTORY_RETENTION_DAYS = 180;
const HISTORY_RETENTION_MS = HISTORY_RETENTION_DAYS * 24 * 60 * 60 * 1000;
const MAX_HISTORY_BY_KIND: Record<UploadHistoryItem['kind'], number> = {
  video: 300,
  image: 500,
  audio: 100,
};

export interface UploadHistoryItem {
  id: number;
  kind: 'image' | 'video' | 'audio';
  name: string;
  type: string;
  size: number;
  blob: Blob;
  timestamp: number;
}

export interface UploadHistorySummaryItem {
  id: number;
  kind: 'image' | 'video' | 'audio';
  name: string;
  type: string;
  size: number;
  timestamp: number;
  previewBlob?: Blob;
  duration?: number;
}

async function createImageMetadata(file: File): Promise<Pick<UploadHistorySummaryItem, 'previewBlob'>> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return {};

  return new Promise((resolve) => {
    const image = new Image();
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      image.onload = null;
      image.onerror = null;
    };

    const finish = (metadata: Pick<UploadHistorySummaryItem, 'previewBlob'> = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(metadata);
    };

    const timer = window.setTimeout(() => finish(), 2500);
    image.onload = () => {
      try {
        const sourceWidth = image.naturalWidth || 640;
        const sourceHeight = image.naturalHeight || 640;
        const targetSize = 360;
        const scale = targetSize / Math.max(sourceWidth, sourceHeight);
        const targetWidth = Math.max(1, Math.round(sourceWidth * scale));
        const targetHeight = Math.max(1, Math.round(sourceHeight * scale));
        const canvas = document.createElement('canvas');
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        canvas.getContext('2d')?.drawImage(image, 0, 0, targetWidth, targetHeight);
        canvas.toBlob((blob) => {
          window.clearTimeout(timer);
          finish({ previewBlob: blob || undefined });
        }, 'image/jpeg', 0.76);
      } catch {
        window.clearTimeout(timer);
        finish();
      }
    };
    image.onerror = () => {
      window.clearTimeout(timer);
      finish();
    };
    image.src = objectUrl;
  });
}

async function createVideoMetadata(file: File): Promise<Pick<UploadHistorySummaryItem, 'previewBlob' | 'duration'>> {
  if (typeof document === 'undefined' || typeof URL === 'undefined') return {};

  return new Promise((resolve) => {
    const video = document.createElement('video');
    const objectUrl = URL.createObjectURL(file);
    let settled = false;

    const cleanup = () => {
      URL.revokeObjectURL(objectUrl);
      video.removeAttribute('src');
      video.load();
    };

    const finish = (metadata: Pick<UploadHistorySummaryItem, 'previewBlob' | 'duration'> = {}) => {
      if (settled) return;
      settled = true;
      cleanup();
      resolve(metadata);
    };

    const timer = window.setTimeout(() => finish(), 3500);
    video.preload = 'metadata';
    video.muted = true;
    video.playsInline = true;
    video.onloadedmetadata = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
      try {
        video.currentTime = duration ? Math.min(1, Math.max(0.1, duration * 0.08)) : 0.1;
      } catch {
        window.clearTimeout(timer);
        finish({ duration });
      }
    };
    video.onseeked = () => {
      const duration = Number.isFinite(video.duration) && video.duration > 0 ? video.duration : undefined;
      try {
        const canvas = document.createElement('canvas');
        const sourceWidth = video.videoWidth || 640;
        const sourceHeight = video.videoHeight || 360;
        const targetWidth = 360;
        const targetHeight = Math.max(1, Math.round(targetWidth * sourceHeight / sourceWidth));
        canvas.width = targetWidth;
        canvas.height = targetHeight;
        canvas.getContext('2d')?.drawImage(video, 0, 0, targetWidth, targetHeight);
        canvas.toBlob((blob) => {
          window.clearTimeout(timer);
          finish({ duration, previewBlob: blob || undefined });
        }, 'image/jpeg', 0.72);
      } catch {
        window.clearTimeout(timer);
        finish({ duration });
      }
    };
    video.onerror = () => {
      window.clearTimeout(timer);
      finish();
    };
    video.src = objectUrl;
  });
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
      if (!db.objectStoreNames.contains(META_STORE_NAME)) {
        db.createObjectStore(META_STORE_NAME, { keyPath: 'id' });
      }
      if (event.oldVersion < 2 && db.objectStoreNames.contains(STORE_NAME)) {
        const transaction = (event.target as IDBOpenDBRequest).transaction;
        const fileStore = transaction?.objectStore(STORE_NAME);
        const metaStore = transaction?.objectStore(META_STORE_NAME);
        if (fileStore && metaStore) {
          const cursorRequest = fileStore.openCursor();
          cursorRequest.onsuccess = () => {
            const cursor = cursorRequest.result;
            if (!cursor) return;
            const item = cursor.value as UploadHistoryItem;
            metaStore.put({
              id: item.id,
              kind: item.kind,
              name: item.name,
              type: item.type,
              size: item.size,
              timestamp: item.timestamp,
            } satisfies UploadHistorySummaryItem);
            cursor.continue();
          };
        }
      }
    };
  });
}

function isSameUploadHistoryFile(item: UploadHistorySummaryItem, file: File, kind: UploadHistoryItem['kind']) {
  return item.kind === kind && item.name === file.name && item.size === file.size && item.type === file.type;
}

function filterRetainedHistoryItems<T extends { kind: UploadHistoryItem['kind']; timestamp: number }>(items: T[], kind?: UploadHistoryItem['kind']): T[] {
  const oldestAllowed = Date.now() - HISTORY_RETENTION_MS;
  const retained = items.filter((item) => item.timestamp >= oldestAllowed);
  if (kind) {
    return retained
      .filter((item) => item.kind === kind)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, MAX_HISTORY_BY_KIND[kind] || 300);
  }

  const grouped = new Map<UploadHistoryItem['kind'], T[]>();
  retained.forEach((item) => {
    const list = grouped.get(item.kind) || [];
    list.push(item);
    grouped.set(item.kind, list);
  });

  return Array.from(grouped.entries())
    .flatMap(([itemKind, list]) => (
      list
        .sort((a, b) => b.timestamp - a.timestamp)
        .slice(0, MAX_HISTORY_BY_KIND[itemKind] || 300)
    ))
    .sort((a, b) => b.timestamp - a.timestamp);
}

export async function saveUploadHistory(file: File, kind: 'image' | 'video' | 'audio'): Promise<void> {
  const mediaMetadata = kind === 'video'
    ? await createVideoMetadata(file)
    : kind === 'image'
      ? await createImageMetadata(file)
      : {};
  const db = await openDB();

  const all = await new Promise<UploadHistorySummaryItem[]>((resolve, reject) => {
    const readTransaction = db.transaction(META_STORE_NAME, 'readonly');
    const request = readTransaction.objectStore(META_STORE_NAME).getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as UploadHistorySummaryItem[]);
  });

  const transaction = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const metaStore = transaction.objectStore(META_STORE_NAME);

  const existing = all.find((item) => isSameUploadHistoryFile(item, file, kind));
  if (existing) {
    store.delete(existing.id);
    metaStore.delete(existing.id);
  }

  const now = Date.now();
  const oldestAllowed = now - HISTORY_RETENTION_MS;
  const maxCount = MAX_HISTORY_BY_KIND[kind] || 300;
  const sameKindAfterDuplicateRemoval = all
    .filter((item) => item.kind === kind && item.id !== existing?.id);
  const expired = sameKindAfterDuplicateRemoval.filter((item) => item.timestamp < oldestAllowed);
  const unexpired = sameKindAfterDuplicateRemoval
    .filter((item) => item.timestamp >= oldestAllowed)
    .sort((a, b) => b.timestamp - a.timestamp);
  const overflow = unexpired.slice(Math.max(0, maxCount - 1));
  const toDelete = [...expired, ...overflow];
  for (const item of toDelete) {
    store.delete(item.id);
    metaStore.delete(item.id);
  }

  const timestamp = now;
  const addRequest = store.add({
    kind,
    name: file.name,
    type: file.type,
    size: file.size,
    blob: file,
    timestamp,
  });
  addRequest.onsuccess = () => {
    metaStore.add({
      id: addRequest.result as number,
      kind,
      name: file.name,
      type: file.type,
      size: file.size,
      timestamp,
      ...mediaMetadata,
    });
  };

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  db.close();
}

export async function loadUploadHistory(kind?: 'image' | 'video' | 'audio'): Promise<UploadHistoryItem[]> {
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, 'readonly');
  const store = transaction.objectStore(STORE_NAME);

  const all = await new Promise<UploadHistoryItem[]>((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as UploadHistoryItem[]);
  });

  db.close();

  return filterRetainedHistoryItems(all, kind);
}

export async function getUploadHistoryItem(id: number): Promise<UploadHistoryItem | null> {
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, 'readonly');
  const store = transaction.objectStore(STORE_NAME);

  const item = await new Promise<UploadHistoryItem | null>((resolve, reject) => {
    const request = store.get(id);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve((request.result as UploadHistoryItem | undefined) || null);
  });

  db.close();
  return item;
}

export async function loadUploadHistorySummaries(kind?: 'image' | 'video' | 'audio'): Promise<UploadHistorySummaryItem[]> {
  const db = await openDB();
  const transaction = db.transaction(META_STORE_NAME, 'readonly');
  const store = transaction.objectStore(META_STORE_NAME);

  const all = await new Promise<UploadHistorySummaryItem[]>((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as UploadHistorySummaryItem[]);
  });

  db.close();

  return filterRetainedHistoryItems(all, kind);
}

export async function deleteUploadHistory(id: number): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction([STORE_NAME, META_STORE_NAME], 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  const metaStore = transaction.objectStore(META_STORE_NAME);
  store.delete(id);
  metaStore.delete(id);

  await new Promise<void>((resolve, reject) => {
    transaction.oncomplete = () => resolve();
    transaction.onerror = () => reject(transaction.error);
  });

  db.close();
}

export function blobToFile(item: UploadHistoryItem): File {
  return new File([item.blob], item.name, { type: item.type });
}

export function formatHistoryTime(timestamp: number): string {
  const date = new Date(timestamp);
  const now = new Date();
  const diffMs = now.getTime() - date.getTime();
  const diffMins = Math.floor(diffMs / 60000);
  const diffHours = Math.floor(diffMs / 3600000);
  const diffDays = Math.floor(diffMs / 86400000);

  if (diffMins < 1) return '刚刚';
  if (diffMins < 60) return `${diffMins}分钟前`;
  if (diffHours < 24) return `${diffHours}小时前`;
  if (diffDays < 7) return `${diffDays}天前`;
  return `${date.getMonth() + 1}月${date.getDate()}日`;
}

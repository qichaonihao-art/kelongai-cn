const DB_NAME = 'kelong-upload-history';
const DB_VERSION = 1;
const STORE_NAME = 'files';

interface UploadHistoryItem {
  id: number;
  kind: 'image' | 'video' | 'audio';
  name: string;
  type: string;
  size: number;
  blob: Blob;
  timestamp: number;
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
    };
  });
}

export async function saveUploadHistory(file: File, kind: 'image' | 'video' | 'audio'): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);

  const all = await new Promise<UploadHistoryItem[]>((resolve, reject) => {
    const request = store.getAll();
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result as UploadHistoryItem[]);
  });

  const sameKind = all.filter((item) => item.kind === kind);
  const maxCount = 20;
  if (sameKind.length >= maxCount) {
    const sorted = sameKind.sort((a, b) => a.timestamp - b.timestamp);
    const toDelete = sorted.slice(0, sameKind.length - maxCount + 1);
    for (const item of toDelete) {
      store.delete(item.id);
    }
  }

  const existing = all.find((item) => item.kind === kind && item.name === file.name && item.size === file.size);
  if (existing) {
    store.delete(existing.id);
  }

  store.add({
    kind,
    name: file.name,
    type: file.type,
    size: file.size,
    blob: file,
    timestamp: Date.now(),
  });

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

  let filtered = all;
  if (kind) {
    filtered = all.filter((item) => item.kind === kind);
  }

  return filtered.sort((a, b) => b.timestamp - a.timestamp);
}

export async function deleteUploadHistory(id: number): Promise<void> {
  const db = await openDB();
  const transaction = db.transaction(STORE_NAME, 'readwrite');
  const store = transaction.objectStore(STORE_NAME);
  store.delete(id);

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

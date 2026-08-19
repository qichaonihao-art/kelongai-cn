// 本机挂画档案库：IndexedDB 持久保存已确认的挂画档案。
// 用户要求：除非主动删除，否则一直保留（不设过期、不设数量上限）。
import type { CopyProfile } from './copywriting';

const DB_NAME = 'kelong-copy-paintings';
const DB_VERSION = 1;
const STORE_NAME = 'paintings';

export interface SavedPainting {
  id: number;
  name: string;
  imageBlob: Blob;
  profile: CopyProfile;
  extraInfo: string;
  forbidden: string;
  createdAt: number;
  updatedAt: number;
}

/** 档案栏列表项（不含大对象，objectURL 由调用方管理） */
export interface SavedPaintingSummary {
  id: number;
  name: string;
  updatedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/** 压缩到最长边 720px 的 JPEG，几十 KB 量级，用于档案栏缩略图与恢复 */
export function compressImageToBlob(file: Blob, maxEdge = 720, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error('图片压缩失败'));
        }, 'image/jpeg', quality);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error('图片压缩失败'));
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    image.src = url;
  });
}

/** 有 id 更新、无 id 插入；返回带 id 的完整记录 */
export async function savePainting(data: {
  id?: number;
  name: string;
  imageBlob: Blob;
  profile: CopyProfile;
  extraInfo: string;
  forbidden: string;
}): Promise<SavedPainting> {
  const db = await openDB();
  try {
    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
    const now = Date.now();
    if (data.id != null) {
      const existing = await requestToPromise<SavedPainting | undefined>(store.get(data.id));
      if (existing) {
        const record: SavedPainting = { ...existing, ...data, id: data.id, updatedAt: now };
        await requestToPromise(store.put(record));
        return record;
      }
      // id 不存在时按 upsert 语义降级为插入（保持原规格行为）
    }
    const insert = { ...data, createdAt: now, updatedAt: now };
    const key = await requestToPromise<IDBValidKey>(store.add(insert));
    return { ...insert, id: Number(key) };
  } finally {
    db.close();
  }
}

/** 按 updatedAt 倒序返回摘要列表 */
export async function listPaintings(): Promise<SavedPaintingSummary[]> {
  const db = await openDB();
  try {
    const all = await requestToPromise<SavedPainting[]>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
    );
    return all
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function getPainting(id: number): Promise<SavedPainting | null> {
  const db = await openDB();
  try {
    const item = await requestToPromise<SavedPainting | undefined>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
    );
    return item || null;
  } finally {
    db.close();
  }
}

export async function deletePainting(id: number): Promise<void> {
  const db = await openDB();
  try {
    await requestToPromise<undefined>(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id)
    );
  } finally {
    db.close();
  }
}

/** 仅更新 updatedAt（选中即"最近使用"） */
export async function touchPainting(id: number): Promise<void> {
  const db = await openDB();
  try {
    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
    const item = await requestToPromise<SavedPainting | undefined>(store.get(id));
    if (item) await requestToPromise(store.put({ ...item, updatedAt: Date.now() }));
  } finally {
    db.close();
  }
}

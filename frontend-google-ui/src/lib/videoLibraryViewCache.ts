import type { VideoLibraryItem } from './videoLibrary';

export interface VideoLibraryView {
  items: VideoLibraryItem[];
  folders: string[];
  counts: Record<string, number>;
}

// Small, session-only cache. Never persist account data to disk/localStorage.
const views = new Map<string, { value: VideoLibraryView; savedAt: number }>();
const MAX_VIEWS = 12;
const MAX_AGE_MS = 2 * 60_000;
let revision = 0;
export const getVideoLibraryCacheRevision = () => revision;
export const videoLibraryViewKey = (folder = '', query = '') => JSON.stringify([folder, query.trim()]);
export function invalidateVideoLibraryCache() {
  revision += 1;
  views.clear();
}
export function readCachedVideoLibraryView(key: string): VideoLibraryView | null {
  const entry = views.get(key);
  if (!entry) return null;
  if (Date.now() - entry.savedAt > MAX_AGE_MS) {
    views.delete(key);
    return null;
  }
  views.delete(key);
  views.set(key, entry);
  return entry.value;
}
export function cacheVideoLibraryView(key: string, value: VideoLibraryView, requestRevision: number) {
  // A response started before a mutation/logout must not repopulate the cache.
  if (requestRevision !== revision) return;
  views.delete(key);
  views.set(key, { value, savedAt: Date.now() });
  while (views.size > MAX_VIEWS) views.delete(views.keys().next().value!);
}

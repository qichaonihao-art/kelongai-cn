import assert from 'node:assert/strict';
import { getVideoLibraryView, updateVideoLibraryItem, deleteVideoLibraryVideo, uploadVideoLibraryVideo, createVideoLibraryFolder, deleteVideoLibraryFolder, setVideoLibraryShotRole } from './src/lib/videoLibrary';
import { cacheVideoLibraryView, getVideoLibraryCacheRevision, invalidateVideoLibraryCache, readCachedVideoLibraryView, videoLibraryViewKey } from './src/lib/videoLibraryViewCache';

const requests: string[] = [];
globalThis.fetch = (async (url: string, init?: RequestInit) => {
  requests.push(url);
  if (init?.signal?.aborted) throw new DOMException('Aborted', 'AbortError');
  if (url === '/api/video-library/folders' && !init?.method) return Response.json({ folders: ['通用素材', 'A', '空文件夹'], counts: { A: 1200 } });
  return Response.json({ items: [], folders: ['A'], item: { id: 1 }, folder: 'A' });
}) as typeof fetch;
const home = await getVideoLibraryView({});
assert.deepEqual(requests, ['/api/video-library/folders']);
assert.equal(home.counts.A, 1200);
assert.deepEqual(home.items, []);
assert.ok(home.folders.includes('空文件夹'));
await getVideoLibraryView({ folder: 'A & B', query: '产品' });
assert.equal(requests.at(-1), '/api/video-library/videos?folder=A+%26+B&q=%E4%BA%A7%E5%93%81');
const key = videoLibraryViewKey();
cacheVideoLibraryView(key, home, getVideoLibraryCacheRevision());
assert.equal(readCachedVideoLibraryView(key), home);
const oldRevision = getVideoLibraryCacheRevision();
invalidateVideoLibraryCache();
cacheVideoLibraryView(key, home, oldRevision);
assert.equal(readCachedVideoLibraryView(key), null, 'Mutation/logout prevents late cache refill');
for (const mutation of [
  () => updateVideoLibraryItem(1, { folderName: 'B' }),
  () => updateVideoLibraryItem(1, { originalName: '新名字' }),
  () => deleteVideoLibraryVideo(1),
  () => createVideoLibraryFolder('A'),
  () => deleteVideoLibraryFolder('空文件夹'),
  () => setVideoLibraryShotRole([1], 'A', 1),
  () => uploadVideoLibraryVideo(new File(['mock'], 'a.mp4'), 'A'),
]) {
  cacheVideoLibraryView(key, home, getVideoLibraryCacheRevision());
  await mutation();
  assert.equal(readCachedVideoLibraryView(key), null, 'Successful mutation invalidates views');
}
for (let i = 0; i < 13; i++) cacheVideoLibraryView(String(i), home, getVideoLibraryCacheRevision());
assert.equal(readCachedVideoLibraryView('0'), null, 'Cache has bounded size');
const originalNow = Date.now;
cacheVideoLibraryView(key, home, getVideoLibraryCacheRevision());
Date.now = () => originalNow() + 121_000;
assert.equal(readCachedVideoLibraryView(key), null, 'Expired views are discarded');
Date.now = originalNow;
const controller = new AbortController(); controller.abort();
await assert.rejects(() => getVideoLibraryView({}, controller.signal), { name: 'AbortError' });
globalThis.fetch = (async () => Response.json({ folders: ['A'] })) as typeof fetch;
await assert.rejects(() => getVideoLibraryView({}), /重启后台/, 'Old backend cannot silently display false zero counts');
cacheVideoLibraryView(key, home, getVideoLibraryCacheRevision());
globalThis.fetch = (async () => Response.json({ error: '未登录' }, { status: 401 })) as typeof fetch;
await assert.rejects(() => getVideoLibraryView({}), /未登录/);
assert.equal(readCachedVideoLibraryView(key), null);
console.log('PASS: lightweight overview, encoded filters, cache limits/expiry, cancellation, auth and mutation invalidation');

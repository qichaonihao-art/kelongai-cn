// 视频素材库本地增量下载无费测试：只使用内存文件夹，不访问真实服务器或电脑目录。
import { webcrypto } from 'node:crypto';
import {
  calculateVideoLibraryUnread,
  markVideoLibraryItemsRead,
  type VideoLibraryItem,
} from './src/lib/videoLibrary';
import {
  downloadVideoLibraryItemLocally,
  loadVideoLibraryLocalIndex,
  planVideoLibraryShotDistribution,
  type VideoLibraryDirectoryHandle,
  type VideoLibraryWritableFileHandle,
} from './src/lib/videoLibraryLocal';

let passed = 0;
let failed = 0;

function assert(condition: unknown, label: string, extra = '') {
  if (condition) {
    passed += 1;
    console.log(`  ✓ ${label}`);
  } else {
    failed += 1;
    console.error(`  ✗ ${label}${extra ? ` — ${extra}` : ''}`);
  }
}

class MemoryStorage {
  private values = new Map<string, string>();
  getItem(key: string) { return this.values.get(key) ?? null; }
  setItem(key: string, value: string) { this.values.set(key, value); }
  removeItem(key: string) { this.values.delete(key); }
  clear() { this.values.clear(); }
}

class MemoryDirectory implements VideoLibraryDirectoryHandle {
  kind = 'directory' as const;
  name = '测试下载目录';
  files = new Map<string, Uint8Array>();
  directories = new Map<string, MemoryDirectory>();
  async queryPermission() { return 'granted' as const; }
  async requestPermission() { return 'granted' as const; }
  async getFileHandle(name: string, options?: { create?: boolean }): Promise<VideoLibraryWritableFileHandle> {
    if (!this.files.has(name) && !options?.create) throw new DOMException('Not found', 'NotFoundError');
    if (!this.files.has(name)) this.files.set(name, new Uint8Array());
    const directory = this;
    return {
      name,
      async getFile() {
        return new File([directory.files.get(name) || new Uint8Array()], name);
      },
      async createWritable() {
        const chunks: Uint8Array[] = [];
        return new WritableStream<Uint8Array>({
          write(chunk) { chunks.push(new Uint8Array(chunk)); },
          close() {
            const length = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
            const merged = new Uint8Array(length);
            let offset = 0;
            chunks.forEach((chunk) => { merged.set(chunk, offset); offset += chunk.length; });
            directory.files.set(name, merged);
          },
        });
      },
    };
  }
  async getDirectoryHandle(name: string, options?: { create?: boolean }) {
    if (!this.directories.has(name) && !options?.create) throw new DOMException('Not found', 'NotFoundError');
    if (!this.directories.has(name)) {
      const directory = new MemoryDirectory();
      directory.name = name;
      this.directories.set(name, directory);
    }
    return this.directories.get(name)!;
  }
  async removeEntry(name: string) { this.files.delete(name); }
}

async function sha256(bytes: Uint8Array) {
  const digest = await webcrypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function item(id: number, folderName: string, name: string, bytes: Uint8Array): Promise<VideoLibraryItem> {
  return {
    id,
    folderName,
    originalName: name,
    mimeType: 'video/mp4',
    fileSize: bytes.length,
    sha256: await sha256(bytes),
    note: '',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 5,
    variant: 'original',
    sourceItemId: null,
    enhancement: null,
    createdAt: 1,
    updatedAt: 1,
    streamUrl: `/stream/${id}`,
    downloadUrl: `/download/${id}`,
    downloadName: name,
    thumbnailUrl: '',
  };
}

async function main() {
  if (!globalThis.crypto) Object.defineProperty(globalThis, 'crypto', { value: webcrypto });
  const storage = new MemoryStorage();
  (globalThis as any).window = { localStorage: storage, dispatchEvent() {}, setTimeout };

  console.log('\n[1] 每个浏览器、每个素材库文件夹独立记录已读');
  const summary = [
    { id: 1, folderName: '静心', createdAt: 1 },
    { id: 2, folderName: '牡丹', createdAt: 1 },
  ];
  let unread = calculateVideoLibraryUnread(summary);
  assert(unread.total === 0, '新电脑首次进入时现有素材作为历史基线，不会全部变成新素材');
  const withNewItem = [...summary, { id: 3, folderName: '静心', createdAt: 2 }];
  unread = calculateVideoLibraryUnread(withNewItem);
  assert(unread.total === 1 && unread.unreadIds.has(3), '建立基线后新增的素材正常显示为新');
  markVideoLibraryItemsRead([withNewItem[2]]);
  assert(calculateVideoLibraryUnread(withNewItem).total === 0, '当前浏览器完成素材后消除新标签');
  const moved = [{ id: 1, folderName: '新文件夹', createdAt: 1 }, summary[1]];
  unread = calculateVideoLibraryUnread(moved);
  assert(unread.unreadIds.has(1), '素材移动到另一个素材库文件夹后重新视为未下载');

  const legacyStorage = new MemoryStorage();
  legacyStorage.setItem('kelongai.videoLibraryReadState.v1', JSON.stringify({ baselineId: 1, readIds: [2] }));
  (globalThis as any).window.localStorage = legacyStorage;
  const legacySummary = [...summary, { id: 3, folderName: '静心', createdAt: 2 }];
  unread = calculateVideoLibraryUnread(legacySummary);
  assert(!unread.unreadIds.has(1) && !unread.unreadIds.has(2) && unread.unreadIds.has(3), '升级时延续旧浏览器原有的新/已读状态');

  console.log('\n[2] 同名同内容跳过，同名不同内容自动改名');
  const directory = new MemoryDirectory();
  const sameBytes = new Uint8Array([1, 2, 3]);
  directory.files.set('clip.mp4', sameBytes);
  let index = await loadVideoLibraryLocalIndex(directory, '静心');
  const sameItem = await item(11, '静心', 'clip.mp4', sameBytes);
  const realFetch = globalThis.fetch;
  let fetchCalls = 0;
  globalThis.fetch = (async () => { fetchCalls += 1; return new Response(sameBytes); }) as typeof fetch;
  const duplicate = await downloadVideoLibraryItemLocally({ item: sameItem, handle: directory, index });
  assert(duplicate.status === 'duplicate' && duplicate.fileName === 'clip.mp4', '同名同内容直接跳过');
  assert(fetchCalls === 0, '确认重复时不重新请求视频文件');

  const differentBytes = new Uint8Array([4, 5, 6, 7]);
  const differentItem = await item(12, '静心', 'clip.mp4', differentBytes);
  globalThis.fetch = (async () => { fetchCalls += 1; return new Response(differentBytes); }) as typeof fetch;
  const renamed = await downloadVideoLibraryItemLocally({ item: differentItem, handle: directory, index });
  assert(renamed.status === 'downloaded' && renamed.fileName === 'clip_2.mp4', '同名不同内容自动保存为 _2 文件');
  assert(directory.files.get('clip.mp4')?.join(',') === '1,2,3', '原同名文件没有被覆盖');
  assert(directory.files.get('clip_2.mp4')?.join(',') === '4,5,6,7', '新内容完整写入改名文件');

  console.log('\n[3] 不完整文件删除并保留为未读');
  const brokenItem = await item(13, '静心', 'broken.mp4', new Uint8Array([8, 8, 8, 8]));
  globalThis.fetch = (async () => new Response(new Uint8Array([8, 8]))) as typeof fetch;
  let brokenThrew = false;
  try {
    await downloadVideoLibraryItemLocally({ item: brokenItem, handle: directory, index });
  } catch {
    brokenThrew = true;
  }
  assert(brokenThrew, '文件大小不符时判定下载失败');
  assert(!directory.files.has('broken.mp4'), '失败产生的残缺文件已删除');
  const allSummary = [...moved, { id: 11, folderName: '静心', createdAt: 1 }, { id: 12, folderName: '静心', createdAt: 1 }, { id: 13, folderName: '静心', createdAt: 1 }];
  assert(calculateVideoLibraryUnread(allSummary).unreadIds.has(13), '失败素材继续保留“新”标签');
  assert(directory.files.has('.kelong-video-library.json'), '本地目录写入隐藏索引，浏览器记录丢失后仍可恢复');

  console.log('\n[4] 款式素材稳定均分到第2至第6镜头');
  const distributionItems = await Promise.all(Array.from({ length: 133 }, (_, offset) => (
    item(1000 + offset, '静心', `静心-${offset + 1}.mp4`, new Uint8Array([offset % 251]))
  )));
  const distribution = planVideoLibraryShotDistribution(distributionItems);
  const distributedIds = distribution.map(({ item: video }) => video.id);
  const shotCounts = [2, 3, 4, 5, 6].map((shotNumber) => distribution.filter((entry) => entry.shotNumber === shotNumber).length);
  assert(distribution.length === 133 && new Set(distributedIds).size === 133, '133个素材全部分配一次，没有重复或遗漏');
  assert(Math.max(...shotCounts) - Math.min(...shotCounts) <= 1, '五个镜头数量最多相差1个');
  const existingAssignments = Object.fromEntries(distribution.slice(0, 20).map(({ item: video, shotNumber }) => [String(video.id), shotNumber]));
  const rerun = planVideoLibraryShotDistribution([...distributionItems].reverse(), existingAssignments);
  assert(rerun.slice(0, 20).every(({ item: video, shotNumber }) => existingAssignments[String(video.id)] === shotNumber), '重新执行时保留已完成素材的镜头位置');
  const withDuplicateId = planVideoLibraryShotDistribution([...distributionItems, distributionItems[0]]);
  assert(withDuplicateId.length === 133, '重复素材ID只分配一次');
  globalThis.fetch = realFetch;

  console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========`);
  process.exit(failed ? 1 : 0);
}

void main();

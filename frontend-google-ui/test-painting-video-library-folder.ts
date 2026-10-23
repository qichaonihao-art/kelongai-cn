import assert from 'node:assert/strict';
import { resolvePaintingVideoLibraryFolder as resolve } from './src/lib/paintingVideoLibraryFolder';

const folders = ['通用素材', '青云志', '新款青云志', '千元机', '新款千元机', '百福临门'];
let bindingReads = 0;
const staleBinding = async () => {
  bindingReads += 1;
  return { folderName: '青云志', folderId: 10 };
};

// 识别只得到旧款名字、旧绑定也指向旧款时，连续入库仍沿用用户纠正后的新款。
for (let index = 0; index < 20; index += 1) {
  assert.deepEqual(await resolve({
    folders, lastFolder: '新款青云志', painting: { name: '青云志' }, loadBinding: staleBinding,
  }), { folder: '新款青云志', source: 'last-used', folderId: null });
}
assert.equal(bindingReads, 0, 'Compatible last save must take priority over stale bindings');
assert.equal((await resolve({
  folders, lastFolder: '新款千元机', painting: { name: '千元机' },
})).folder, '新款千元机');
assert.equal((await resolve({
  folders, lastFolder: '青云志', painting: { name: '新款青云志' },
})).folder, '青云志', 'Related variant remains the user’s choice until manually changed');

assert.deepEqual(await resolve({
  folders, lastFolder: '新款青云志', painting: { name: '百福临门' },
}), { folder: '百福临门', source: 'matched', folderId: null });
assert.deepEqual(await resolve({
  folders, lastFolder: '新款青云志', painting: { name: '百福临门' },
  loadBinding: async () => ({ folderName: '百福临门', folderId: 20 }),
}), { folder: '百福临门', source: 'remembered', folderId: 20 });

for (const lastFolder of ['', '已删除文件夹', '通用素材']) {
  assert.equal((await resolve({ folders, lastFolder, painting: { name: '青云志' } })).folder, '青云志');
}
assert.equal((await resolve({
  folders, lastFolder: '', painting: { name: '新款青云志' },
})).folder, '新款青云志', 'First save still automatically recognizes the full variant name');
assert.equal((await resolve({
  folders, lastFolder: '新款青云志', painting: { prompt: '展示《青云志》挂画的细节' },
})).source, 'last-used');
assert.equal((await resolve({ folders, lastFolder: '新款青云志' })).folder, '新款青云志');
assert.equal((await resolve({
  folders, lastFolder: '', painting: { name: '百福临门' },
  loadBinding: async () => { throw new Error('offline'); },
})).folder, '百福临门');
assert.equal((await resolve({
  folders, lastFolder: '', painting: { name: '百福临门' },
  loadBinding: async () => ({ folderName: '已删除文件夹', folderId: 30 }),
})).folder, '百福临门');
assert.deepEqual(await resolve({ folders: [], lastFolder: '已删除文件夹' }), {
  folder: '通用素材', source: 'fallback', folderId: null,
});
assert.equal((await resolve({ folders, lastFolder: '', recentSavedFolder: '新款青云志' })).folder, '新款青云志');
console.log('PASS: repeated variant saves, last-save priority, changed painting, first save, unavailable binding and missing folders');

import assert from 'node:assert/strict';

process.env.KELONG_SKIP_LISTEN = '1';

const {
  formatVideoLibrarySourceNote,
  normalizeLegacyVideoLibrarySourceNote,
} = await import('./server.mjs');

assert.equal(
  formatVideoLibrarySourceNote({
    model: 'doubao-seedance-2-0-fast-260128',
    directionNumber: 7,
  }),
  'Seedance 2.0 Fast · 来自创意素材 · 方向7',
);
assert.equal(
  formatVideoLibrarySourceNote({ model: 'MiniMax-H3', directionNumber: 12 }),
  'MiniMax H3 · 来自创意素材 · 方向12',
);
assert.equal(
  formatVideoLibrarySourceNote({ source: 'local' }),
  '本地上传',
);
assert.equal(
  normalizeLegacyVideoLibrarySourceNote('来自挂画创意素材·手动保存（第1组第7个，方向7，第1轮）'),
  '来自创意素材 · 方向7',
);
assert.equal(
  normalizeLegacyVideoLibrarySourceNote('来自挂画创意素材·全自动（第2组第3个，方向13，第2轮）'),
  '来自创意素材 · 方向13',
);

console.log('视频素材库备注 — 无费测试通过');

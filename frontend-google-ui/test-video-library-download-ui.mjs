import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createHash } from 'node:crypto';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'library-download-ui-'));
const calls = [];
const bytes = Buffer.from('test-video-original-bytes');
const sha256 = createHash('sha256').update(bytes).digest('hex');
let batchFileServed = false;
const server = await createServer({ configFile: false, root, cacheDir: path.join(temp, 'cache'), resolve: { alias: { '@': root } }, esbuild: { jsx: 'automatic' }, server: { host: '127.0.0.1', port: 0 }, plugins: [{ name: 'download-test-harness', configureServer(vite) {
  vite.middlewares.use(async (req, res, next) => {
    const url = new URL(req.url, 'http://localhost');
    if (/^\/api\/video-library\/videos\/\d+\/file$/.test(url.pathname) && url.searchParams.get('download') === '1') {
      // Chromium's native download manager can bypass page.route. Serve the
      // actual attachment from the isolated test server, as production does.
      calls.push(url.pathname + url.search);
      if (url.pathname.includes('/3/file')) batchFileServed = true;
      res.writeHead(200, { 'Content-Type': 'video/mp4', 'Content-Length': bytes.length, 'Cache-Control': 'no-store',
        'Content-Disposition': `attachment; filename="original.mp4"; filename*=UTF-8''${encodeURIComponent('下载素材.mp4')}` });
      res.end(bytes);
      return;
    }
    if (req.url !== '/__download_test') return next();
    res.setHeader('Content-Type', 'text/html');
    res.end(await vite.transformIndexHtml('/__download_test', `<div id="root"></div><script type="module">
      import React from 'react'; import { createRoot } from 'react-dom/client';
      import Page from '/src/pages/VideoLibraryPage.tsx';
      createRoot(document.getElementById('root')).render(React.createElement(Page,{onBack(){},onNavigate(){}}));
    </script>`));
  });
} }] });
let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage({ acceptDownloads: true });
  const errors = [], pending = [];
  page.on('pageerror', (e) => errors.push(e.message));
  // Keep directory binding and unread-summary requests pending. They must not
  // block card or preview downloads, and no folder picker may be invoked.
  await page.addInitScript(() => {
    window.pickerCalls = 0;
    window.showDirectoryPicker = async () => { window.pickerCalls++; throw new Error('Unexpected directory picker'); };
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open() { return {}; } } });
  });
  function item(id, folder, width = 1080) { return { id, folderName: folder, originalName: `素材${id}.mp4`, mimeType: 'video/mp4', fileSize: bytes.length, sha256, note: '', width, height: width === 1080 ? 1920 : 864, fps: 30, durationSeconds: 6, variant: 'original', shotRole: 0, enhancement: null, createdAt: 1791680000, updatedAt: 1791680000, streamUrl: `/api/video-library/videos/${id}/file?preview=1`, downloadUrl: `/api/video-library/videos/${id}/file?download=1`, downloadName: `下载素材${id}.mp4`, thumbnailUrl: '/thumb.jpg' }; }
  let batchMode = false;
  const handleApi = async (route) => {
    const url = new URL(route.request().url());
    if (url.pathname.endsWith('/file') && url.searchParams.get('download') === '1') return route.continue();
    calls.push(url.pathname + url.search);
    if (url.pathname.endsWith('/summary')) {
      if (!batchMode || batchFileServed) { pending.push(route); return; }
      return route.fulfill({ json: { items: [item(1, 'A'), item(2, 'B'), item(3, 'A')] } });
    }
    if (url.pathname.endsWith('/folders')) return route.fulfill({ json: { folders: ['A', 'B'], counts: { A: 1, B: 1 } } });
    if (url.pathname.endsWith('/videos')) return route.fulfill({ json: { items: batchMode ? [item(1, 'A'), item(3, 'A')] : [item(1, 'A'), item(2, 'B', 480)], folders: ['A', 'B'] } });
    return route.fulfill({ status: 404, body: '' });
  };
  await page.route('**/api/**', handleApi);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__download_test`);
  await page.getByRole('button', { name: '打开A文件夹', exact: true }).waitFor();
  const search = page.getByPlaceholder('搜索素材');
  await search.fill('素材'); await search.press('Enter');
  await page.getByRole('heading', { name: '素材1.mp4', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '返回文件夹', exact: true }).count(), 0, 'search download does not require a selected library folder');
  const card = page.locator('article').filter({ has: page.getByRole('heading', { name: '素材1.mp4', exact: true }) });
  assert.equal(await page.getByRole('button', { name: '更换保存位置', exact: true }).isDisabled(), true, 'directory binding is still pending');
  const before = calls.length;
  const downloadEvent = page.waitForEvent('download');
  await card.getByRole('button', { name: '下载', exact: true }).click();
  const download = await downloadEvent;
  const saved = path.join(temp, 'saved.mp4'); await download.saveAs(saved);
  assert.deepEqual(await readFile(saved), bytes);
  assert.ok(download.suggestedFilename().endsWith('.mp4'));
  assert.deepEqual(calls.slice(before), ['/api/video-library/videos/1/file?download=1'], 'direct download must not reload folders or unread summary');
  assert.equal(await page.evaluate(() => window.pickerCalls), 0);
  console.log('PASS: search-result download starts immediately without library-folder selection or local-folder permissions; original bytes are received');

  await card.locator('button').filter({ has: page.locator('img') }).click();
  await page.locator('video[controls]').waitFor();
  const previewDownload = page.waitForEvent('download');
  await page.getByRole('button', { name: '下载', exact: true }).last().click();
  assert.match((await previewDownload).url(), /\/1\/file\?download=1$/);
  console.log('PASS: preview downloads the original file without invoking the batch path');

  const low = page.locator('article').filter({ has: page.getByRole('heading', { name: '素材2.mp4', exact: true }) });
  let accepted = false;
  page.on('dialog', async (dialog) => { if (accepted) await dialog.accept(); else await dialog.dismiss(); });
  const fileCalls = () => calls.filter((url) => url.includes('download=1')).length;
  const beforeCancel = fileCalls();
  await low.getByRole('button', { name: '下载', exact: true }).click();
  assert.equal(fileCalls(), beforeCancel, 'declining the unenhanced original must not download anything');
  accepted = true;
  const acceptedDownload = page.waitForEvent('download');
  await low.getByRole('button', { name: '下载', exact: true }).click();
  assert.match((await acceptedDownload).url(), /\/2\/file\?download=1$/);
  assert.equal(await page.evaluate(() => window.pickerCalls), 0);
  assert.deepEqual(errors, []);
  console.log('PASS: low-resolution confirmation is preserved and browser download works while the directory binding remains unavailable');

  await page.close();
  batchMode = true;
  const batch = await browser.newPage();
  await batch.route('**/api/**', handleApi);
  await batch.addInitScript(() => {
    localStorage.setItem('kelongai.videoLibraryReadState.v2', JSON.stringify({ readKeys: ['A:1', 'B:2'] }));
    const files = new Map([['.kelong-video-library.json', new TextEncoder().encode(JSON.stringify({ version: 1, folderName: 'A', downloads: { 1: { itemId: 1, folderName: 'A', fileName: 'old.mp4', fileSize: 25, sha256: 'old' } } }))]]);
    window.testFiles = files;
    window.oldFileReads = 0;
    const directory = { name: '测试保存位置', kind: 'directory', queryPermission: async () => 'granted', requestPermission: async () => 'granted',
      async getFileHandle(name, options) {
        if (name === 'old.mp4') { window.oldFileReads++; throw new Error('Already-read files must not be hashed again'); }
        if (!files.has(name) && !options?.create) throw new DOMException('Not found', 'NotFoundError');
        if (!files.has(name)) files.set(name, new Uint8Array());
        return { name, getFile: async () => new File([files.get(name)], name), async createWritable() {
          const chunks = [];
          return new WritableStream({ write(chunk) { chunks.push(new Uint8Array(chunk)); }, close() {
            const bytes = new Uint8Array(chunks.reduce((n, part) => n + part.length, 0)); let offset = 0;
            for (const part of chunks) { bytes.set(part, offset); offset += part.length; }
            files.set(name, bytes);
          } });
        } };
      }, async removeEntry(name) { files.delete(name); },
    };
    const bindings = new Map();
    const db = { close() {}, transaction() {
      const transaction = { objectStore() { return { get(key) { return request(() => bindings.get(key)); }, put(value) { return request(() => bindings.set(value.folderName, value)); } }; } };
      function request(action) { const result = {}; setTimeout(() => { result.result = action(); transaction.oncomplete?.(); }, 0); return result; }
      return transaction;
    } };
    Object.defineProperty(window, 'indexedDB', { configurable: true, value: { open() { const request = {}; setTimeout(() => { request.result = db; request.onsuccess(); }, 0); return request; } } });
    window.showDirectoryPicker = async () => directory;
  });
  await batch.goto(`http://127.0.0.1:${server.httpServer.address().port}/__download_test`);
  await batch.getByRole('button', { name: '打开A文件夹', exact: true }).click();
  const downloadNew = batch.getByRole('button', { name: '下载新素材（1）', exact: true });
  await downloadNew.click();
  await batch.getByText('已保存到“测试保存位置”：保存 1 个，跳过重复 0 个，失败 0 个。', { exact: true }).waitFor();
  assert.equal(await batch.getByRole('button', { name: /^下载新素材/ }).isDisabled(), false, 'a pending final unread refresh must not keep downloads busy');
  assert.equal(await batch.evaluate(() => window.oldFileReads), 0, 'incremental download must not hash already-read library files');
  const stored = await batch.evaluate(() => ({ bytes: [...window.testFiles.get('下载素材3.mp4')], index: JSON.parse(new TextDecoder().decode(window.testFiles.get('.kelong-video-library.json'))), read: JSON.parse(localStorage.getItem('kelongai.videoLibraryReadState.v2')) }));
  assert.deepEqual(Buffer.from(stored.bytes), bytes);
  assert.ok(stored.index.downloads['1'] && stored.index.downloads['3']);
  assert.ok(stored.read.readKeys.includes('B:2'), 'checking one folder must preserve other folders’ read state');
  console.log('PASS: incremental batch hashes only pending items, writes complete bytes and receipts, preserves other folders and finishes without waiting for unread refresh');
} finally {
  if (browser) await browser.close();
  await server.close();
  await rm(temp, { recursive: true, force: true });
}

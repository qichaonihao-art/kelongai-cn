import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';

const playwrightModule = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const { chromium } = playwrightModule.default || playwrightModule;
const root = path.dirname(fileURLToPath(import.meta.url));
const temp = await mkdtemp(path.join(tmpdir(), 'library-folder-rename-ui-'));
let renamed = false;
const calls = [];

const server = await createServer({
  configFile: false,
  root,
  cacheDir: path.join(temp, 'cache'),
  resolve: { alias: { '@': root } },
  esbuild: { jsx: 'automatic' },
  server: { host: '127.0.0.1', port: 0 },
  plugins: [{
    name: 'folder-rename-test-harness',
    configureServer(vite) {
      vite.middlewares.use(async (req, res, next) => {
        if (req.url !== '/__folder_rename_test') return next();
        res.setHeader('Content-Type', 'text/html');
        res.end(await vite.transformIndexHtml('/__folder_rename_test', `<div id="root"></div><script type="module">
          import React from 'react';
          import { createRoot } from 'react-dom/client';
          import Page from '/src/pages/VideoLibraryPage.tsx';
          createRoot(document.getElementById('root')).render(React.createElement(Page, { onBack() {}, onNavigate() {} }));
        </script>`));
      });
    },
  }],
});

function item(folderName) {
  return {
    id: 1,
    folderName,
    originalName: '测试素材.mp4',
    mimeType: 'video/mp4',
    fileSize: 1024,
    sha256: 'hash',
    note: '',
    width: 1080,
    height: 1920,
    fps: 30,
    durationSeconds: 6,
    variant: 'original',
    shotRole: 0,
    enhancement: null,
    createdAt: 1791680000,
    updatedAt: 1791680000,
    streamUrl: '/api/video-library/videos/1/file?preview=1',
    downloadUrl: '/api/video-library/videos/1/file?download=1',
    downloadName: '测试素材.mp4',
    thumbnailUrl: '/api/video-library/videos/1/thumbnail',
  };
}

const handleApi = async (route) => {
  const request = route.request();
  const url = new URL(request.url());
  const entry = { method: request.method(), path: url.pathname };
  if (request.method() === 'PATCH') entry.body = request.postDataJSON();
  calls.push(entry);

  if (url.pathname === '/api/video-library/folders' && request.method() === 'GET') {
    return route.fulfill({
      json: renamed
        ? { folders: ['新分类', '另一个'], counts: { 新分类: 1, 另一个: 0 } }
        : { folders: ['旧分类', '另一个'], counts: { 旧分类: 1, 另一个: 0 } },
    });
  }
  if (url.pathname === '/api/video-library/summary') {
    return route.fulfill({ json: { items: [{ id: 1, folderName: renamed ? '新分类' : '旧分类', createdAt: 1791680000 }] } });
  }
  if (url.pathname.startsWith('/api/video-library/folders/') && request.method() === 'PATCH') {
    renamed = true;
    return route.fulfill({ json: { ok: true, folder: '新分类', previousFolder: '旧分类' } });
  }
  if (url.pathname === '/api/video-library/videos') {
    const folder = url.searchParams.get('folder');
    const folders = renamed ? ['新分类', '另一个'] : ['旧分类', '另一个'];
    return route.fulfill({ json: { items: folder === '新分类' || folder === '旧分类' ? [item(folder)] : [], folders } });
  }
  if (url.pathname.endsWith('/thumbnail')) return route.fulfill({ status: 204, body: '' });
  return route.fulfill({ status: 404, body: '' });
};

let browser;
try {
  await server.listen();
  browser = await chromium.launch({ headless: true, channel: process.env.PLAYWRIGHT_CHANNEL || 'chrome' });
  const page = await browser.newPage();
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.addInitScript(() => {
    localStorage.setItem('kelongai.videoLibraryReadState.v2', JSON.stringify({ readKeys: [encodeURIComponent('旧分类') + ':1'] }));
  });
  await page.route('**/api/**', handleApi);
  await page.goto(`http://127.0.0.1:${server.httpServer.address().port}/__folder_rename_test`);

  const oldCard = page.getByRole('button', { name: '打开旧分类文件夹', exact: true });
  await oldCard.waitFor();
  await oldCard.hover();
  await page.getByRole('button', { name: '重命名旧分类文件夹', exact: true }).click();
  await page.getByRole('heading', { name: '重命名文件夹', exact: true }).waitFor();
  const input = page.getByLabel('新的文件夹名称', { exact: true });
  assert.equal(await input.inputValue(), '旧分类');
  await input.fill('新分类');
  await page.getByRole('button', { name: '保存名称', exact: true }).click();

  await page.getByText('文件夹“旧分类”已重命名为“新分类”，所有设备都会同步', { exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '打开新分类文件夹', exact: true }).count(), 1);
  assert.equal(await page.getByRole('button', { name: '打开旧分类文件夹', exact: true }).count(), 0);

  const renameCall = calls.find((call) => call.method === 'PATCH');
  assert.equal(renameCall.path, `/api/video-library/folders/${encodeURIComponent('旧分类')}`);
  assert.deepEqual(renameCall.body, { newFolderName: '新分类' });

  const readState = await page.evaluate(() => JSON.parse(localStorage.getItem('kelongai.videoLibraryReadState.v2')));
  assert.deepEqual(readState.readKeys, [`${encodeURIComponent('新分类')}:1`]);

  await page.getByRole('button', { name: '打开新分类文件夹', exact: true }).click();
  await page.getByRole('heading', { name: '测试素材.mp4', exact: true }).waitFor();
  assert.equal(await page.getByRole('button', { name: '重命名新分类文件夹', exact: true }).count(), 1);
  assert.deepEqual(errors, []);
  console.log('PASS: 素材库文件夹可从文件夹卡片和文件夹详情重命名，接口参数、界面同步和本机已读标记迁移都正确');
} finally {
  await browser?.close();
  await server.close();
  await rm(temp, { recursive: true, force: true });
}

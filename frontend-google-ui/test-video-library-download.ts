import assert from 'node:assert/strict';
import { startVideoLibraryBrowserDownload } from './src/lib/videoLibraryDownload';

const anchors: any[] = [];
let clicked = 0;
let fetched = 0;
(globalThis as any).window = { location: { href: 'https://platform.example/app', origin: 'https://platform.example' } };
(globalThis as any).fetch = () => { fetched++; throw new Error('Single downloads must not fetch or buffer files'); };
(globalThis as any).document = {
  body: { appendChild(anchor: any) { anchors.push(anchor); } },
  createElement(tag: string) {
    assert.equal(tag, 'a');
    return { href: '', download: '', hidden: false, click() { clicked++; }, remove() { anchors.splice(anchors.indexOf(this), 1); } };
  },
};
const item = { id: 7, downloadUrl: '/api/video-library/videos/7/file?preview=1', downloadName: '喜庆摆件.mp4', originalName: '原视频.mp4' };
let submitted: any;
const originalAppend = document.body.appendChild;
(document.body as any).appendChild = (anchor: any) => { submitted = anchor; return originalAppend(anchor); };
startVideoLibraryBrowserDownload(item);
assert.equal(clicked, 1);
assert.equal(fetched, 0);
assert.equal(submitted.href, 'https://platform.example/api/video-library/videos/7/file?download=1');
assert.equal(submitted.download, '喜庆摆件.mp4');
assert.equal(anchors.length, 0, 'temporary link is cleaned up');
assert.equal('showDirectoryPicker' in window, false, 'native downloads work without directory support');

startVideoLibraryBrowserDownload({ ...item, downloadName: '' });
assert.equal(submitted.download, '原视频.mp4');
for (const downloadUrl of ['https://untrusted.example/api/video-library/videos/7/file', '/api/video-library/videos/8/file', 'javascript:alert(1)', '/api/video-library/videos/7/thumbnail']) {
  assert.throws(() => startVideoLibraryBrowserDownload({ ...item, downloadUrl }), /下载地址无效/);
}
assert.throws(() => startVideoLibraryBrowserDownload({ ...item, id: 0 }), /下载地址无效/);
assert.equal(clicked, 2, 'invalid links never initiate a download');
assert.equal(fetched, 0);
console.log('PASS: authenticated original-file browser downloads need no folder, fetch, blob or local receipts; unsafe links are rejected');

import assert from 'node:assert/strict';
import { createServer } from 'vite';
import { fileURLToPath } from 'node:url';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const { chromium } = await import(process.env.PLAYWRIGHT_MODULE_PATH || 'playwright');
const root = path.dirname(fileURLToPath(import.meta.url));
const cacheDir = await mkdtemp(path.join(tmpdir(), 'video-library-ui-'));
const server = await createServer({configFile:false,root,cacheDir,resolve:{alias:{'@':root}},esbuild:{jsx:'automatic'},server:{host:'127.0.0.1',port:0},plugins:[{name:'test-harness',configureServer(server){server.middlewares.use(async (req,res,next)=>{if(req.url!=='/__library_test')return next();res.setHeader('Content-Type','text/html');res.end(await server.transformIndexHtml('/__library_test', `<div id="root"></div><script type="module">
import React from 'react';
import { createRoot } from 'react-dom/client';
import Page from '/src/pages/VideoLibraryPage.tsx';
function App(){const [show,setShow]=React.useState(true);return React.createElement(React.Fragment,null,React.createElement('button',{id:'toggle',onClick:()=>setShow(!show)},'toggle'),show?React.createElement(Page,{onBack:()=>setShow(false),onNavigate:()=>setShow(false)}):null)}
createRoot(document.getElementById('root')).render(React.createElement(App));
</script>`));});}}]});
let browser;
try {
await server.listen();
const port = server.httpServer.address().port;
browser = await chromium.launch({headless:true, ...(process.env.PLAYWRIGHT_CHANNEL ? { channel: process.env.PLAYWRIGHT_CHANNEL } : {})});
const page = await browser.newPage();
const errors=[]; page.on('pageerror',e=>errors.push(e.message));
let calls=[];let heldHome=false,heldFolder='',pending=[];
function item(folder){return {id:folder==='A'?1:2,folderName:folder,originalName:folder+'素材',mimeType:'video/mp4',fileSize:100,sha256:'x',note:'',width:1080,height:1920,fps:30,durationSeconds:6,variant:'original',shotRole:0,enhancement:null,createdAt:1791680000,updatedAt:1791680000,streamUrl:'/mock.mp4',downloadUrl:'/mock.mp4',thumbnailUrl:'/thumb.jpg'};}
await page.route('**/api/**', async route=>{
 const u=new URL(route.request().url());calls.push(u.pathname+u.search);
 if(u.pathname.endsWith('/summary')) { pending.push(()=>route.fulfill({json:{items:[]}}).catch(()=>{}));return; }
 if(u.pathname.endsWith('/folders')){const finish=()=>route.fulfill({json:{folders:['通用素材','A','B'],counts:{A:1200,B:2}}}).catch(()=>{});if(heldHome)pending.push(finish);else await finish();return;}
 if(u.pathname.endsWith('/videos')){const folder=u.searchParams.get('folder');const finish=()=>route.fulfill({json:{items:[item(folder)],folders:['通用素材','A','B']}}).catch(()=>{});if(folder===heldFolder)pending.push(finish);else await finish();return;}
 await route.fulfill({json:{}});
});
await page.goto(`http://127.0.0.1:${port}/__library_test`);
await page.getByRole('button',{name:'打开A文件夹',exact:true}).waitFor({timeout:15000});
assert.ok((await page.getByRole('button',{name:'打开A文件夹',exact:true}).innerText()).includes('1200'));
assert.equal(calls.some(x=>x.includes('/videos')),false);
assert.equal(await page.getByText('正在读取共享视频库').count(),0);
console.log('PASS: cold overview appears while unread request is still pending; no full library request');
await page.getByRole('button',{name:'打开A文件夹',exact:true}).click();
await page.getByRole('heading',{name:'A素材',exact:true}).waitFor();
heldFolder='A';
await page.getByRole('button',{name:'刷新',exact:true}).click();
assert.equal(await page.getByRole('heading',{name:'A素材',exact:true}).count(),1);
assert.equal(await page.getByText('正在读取共享视频库').count(),0);
console.log('PASS: manual refresh preserves loaded cards');
heldHome=true;
await page.getByRole('button',{name:'返回文件夹',exact:true}).click();
await page.getByRole('button',{name:'打开B文件夹',exact:true}).waitFor();
heldFolder='B';
await page.getByRole('button',{name:'打开B文件夹',exact:true}).click();
await page.getByText('正在读取共享视频库').waitFor();
await page.getByRole('button',{name:'返回文件夹',exact:true}).click();
await page.getByRole('button',{name:'打开A文件夹',exact:true}).click();
await page.getByRole('heading',{name:'A素材',exact:true}).waitFor();
await Promise.all(pending.splice(0).map(f=>f()));
await page.waitForTimeout(100);
assert.equal(await page.getByRole('heading',{name:'B素材',exact:true}).count(),0);
assert.equal(await page.getByRole('heading',{name:'A素材',exact:true}).count(),1);
console.log('PASS: returning to cached folder is immediate and delayed old folder cannot overwrite it');
await page.locator('#toggle').click();
await page.locator('#toggle').click();
await page.getByRole('button',{name:'打开A文件夹',exact:true}).waitFor();
assert.equal(await page.getByText('正在读取共享视频库').count(),0);
console.log('PASS: module re-entry uses cached overview while background request waits');
// On a fresh module load no cache exists. A stuck request must stop spinning.
await page.clock.install();
await page.reload();
await page.getByText('正在读取共享视频库').waitFor();
await page.clock.fastForward(20_100);
await page.getByText('读取视频库超时，请点击刷新重试', { exact: true }).waitFor();
assert.equal(await page.getByText('正在读取共享视频库').count(),0);
assert.equal(await page.getByText('这个文件夹里还没有视频').count(),0);
console.log('PASS: request timeout stops loading and shows retry, never a false empty library');
assert.deepEqual(errors,[]);
} finally {if(browser)await browser.close();await server.close();await rm(cacheDir,{recursive:true,force:true});}

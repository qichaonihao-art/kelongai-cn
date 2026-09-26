import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
const root = await mkdtemp(path.join(os.tmpdir(), 'kelong-enhancement-concurrency-'));
process.env.KELONG_SKIP_LISTEN = '1';
process.env.RUNTIME_STATE_DIR = path.join(root, 'state');
process.env.VIDEO_LIBRARY_DIR = path.join(root, 'videos');
process.env.MEDIAKIT_API_KEY = 'test-key';
await mkdir(process.env.RUNTIME_STATE_DIR, { recursive: true });
await mkdir(process.env.VIDEO_LIBRARY_DIR, { recursive: true });
const originalFetch = globalThis.fetch;
let submitted = 0;
let downloadRequests = 0;
let finishFirstBatch = false;
let finishAll = false;
let throttled = false;
const controllers = [];
const fixture = path.join(root, '1080p.mp4');
await promisify(execFile)('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=red:s=1080x1920:d=0.1', '-c:v', 'libx264', fixture]);
const bytes = await readFile(fixture);
// 所有网络请求均拦截，禁止测试调用真实收费接口。
globalThis.fetch = async (url, options = {}) => {
  const target = String(url);
  if (target.endsWith('/api/v1/tools/enhance-video')) {
    const request = JSON.parse(options.body);
    if (request.video_url === 'test-input-45' && !throttled) {
      throttled = true;
      return Response.json({message:'too many tasks'}, {status:429});
    }
    submitted++;
    return Response.json({task_id:`test-task-${submitted}`});
  }
  if (target.includes('/api/v1/tasks/test-task-')) {
    const id = Number(target.split('test-task-')[1]);
    return finishAll || (finishFirstBatch && id <= 20)
      ? Response.json({status:'completed',result:{video_url:`https://test.invalid/output/${id}`}})
      : Response.json({status:'processing'});
  }
  if (target.startsWith('https://test.invalid/output/')) {
    downloadRequests++;
    return new Response(new ReadableStream({start(controller) {
      if (finishAll) { controller.enqueue(bytes); controller.close(); }
      else controllers.push(controller);
    }}), {headers:{'content-length':String(bytes.length)}});
  }
  throw new Error(`禁止测试网络访问：${target}`);
};
const {getCollectionDb, runVideoEnhancementWorker, streamEnhancedVideoToFile} = await import('./server.mjs');
const db = getCollectionDb();
const count = (status) => db.prepare('SELECT COUNT(*) AS n FROM video_enhancement_tasks WHERE status = ?').get(status).n;
const tick = async () => { runVideoEnhancementWorker(); await new Promise(resolve => setTimeout(resolve, 20)); };
async function until(predicate) {
  const end = Date.now() + 15000;
  while (!predicate()) {
    assert.ok(Date.now() < end, `等待超时: submitted=${submitted}, downloads=${downloadRequests}, completed=${count('completed')}`);
    await tick();
  }
}
try {
  for(let id=1;id<=45;id++) {
    await writeFile(path.join(process.env.VIDEO_LIBRARY_DIR, `${id}.mp4`), `input ${id}`);
    db.prepare(`INSERT INTO video_library_items (id,folder_name,original_name,stored_name,sha256)
      VALUES (?,'测试','输入',?,?)`).run(id,`${id}.mp4`,`input-hash-${id}`);
    db.prepare(`INSERT INTO video_enhancement_tasks (source_item_id,public_token,input_media_uri)
      VALUES (?,?,?)`).run(id,`test-token-${id}`,`test-input-${id}`);
  }
  await until(() => submitted === 20);
  for(let i=0;i<5;i++) await tick();
  assert.equal(submitted,20,'轮询位置释放不能让云端未完成任务超过20');
  finishFirstBatch=true;
  db.exec('UPDATE video_enhancement_tasks SET next_poll_at=0');
  await until(() => downloadRequests===20 && submitted===40);
  for(let i=0;i<5;i++) await tick();
  assert.equal(submitted,40,'前20个等待下载时，第二批云端只能再启动20个');
  assert.equal(count('downloading'),20,'20个下载可以同时等待网络数据，而非2个');
  console.log('通过：云端20路＋下载20路，下载阻塞时云端及时补位、不超配额');
  finishAll=true;
  for(const controller of controllers) {controller.enqueue(bytes);controller.close();}
  await until(() => {
    db.exec("UPDATE video_enhancement_tasks SET next_poll_at=0 WHERE status <> 'completed'");
    return throttled;
  });
  const throttledRow = db.prepare('SELECT * FROM video_enhancement_tasks WHERE source_item_id=45').get();
  assert.equal(throttledRow.attempt_count,0,'限流应等待重试，不消耗失败次数');
  assert.equal(throttledRow.status,'queued');
  await until(() => {
    db.exec("UPDATE video_enhancement_tasks SET next_poll_at=0 WHERE status <> 'completed'");
    return count('completed')===45;
  });
  assert.equal(count('failed'),0);
  assert.equal(submitted,45,'每个输入只成功提交一次');
  assert.equal(downloadRequests,45,'同一下载不得重复调度');
  assert.equal(db.prepare('SELECT COUNT(*) AS n FROM video_library_items').get().n,1,'相同输出并发去重成功');
  console.log('通过：45个任务完成、无重复提交下载、并发去重、限流自动重试');
  // 模拟服务重启后留下的下载阶段，可直接恢复，不再提交收费任务。
  const recoveredId = db.prepare(`INSERT INTO video_library_items (folder_name,original_name,stored_name,sha256)
    VALUES ('测试','恢复','restore.mp4','restore-input')`).run().lastInsertRowid;
  await writeFile(path.join(process.env.VIDEO_LIBRARY_DIR,'restore.mp4'),'restore');
  db.prepare(`INSERT INTO video_enhancement_tasks (source_item_id,public_token,status,external_task_id,output_media_url)
    VALUES (?,'restore-token','normalizing','test-task-restore','https://test.invalid/output/restore')`).run(recoveredId);
  await until(()=>count('completed')===46);
  assert.equal(submitted,45);
  await assert.rejects(streamEnhancedVideoToFile(new Response('x',{headers:{'content-length':String(101*1024*1024)}}),path.join(root,'oversize')),/超过100MB/);
  console.log('通过：保存阶段恢复、下载体积限制');
  await new Promise(resolve=>setTimeout(resolve,250));
} finally {
  globalThis.fetch=originalFetch;
  await rm(root,{recursive:true,force:true});
}

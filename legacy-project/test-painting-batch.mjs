// 无费测试脚本：不调用真实 Seedance / 豆包，也不监听端口。
// 通过 KELONG_SKIP_LISTEN=1 + 临时 RUNTIME_STATE_DIR 复用 server.mjs 的真实逻辑。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const stateDir = mkdtempSync(join(tmpdir(), 'kelong-painting-test-'));
process.env.RUNTIME_STATE_DIR = stateDir;
process.env.KELONG_SKIP_LISTEN = '1';

// 拦截所有出站 fetch，杜绝任何真实付费/网络调用，并记录调用以便断言“未触发创建”。
const fetchCalls = [];
const realFetch = globalThis.fetch;
globalThis.fetch = async (url, init = {}) => {
  const method = String(init.method || 'GET').toUpperCase();
  fetchCalls.push({ method, url: String(url) });
  return new Response(JSON.stringify({ error: { message: 'test-stub-unauthorized' } }), {
    status: 401,
    headers: { 'Content-Type': 'application/json' },
  });
};

const server = await import('./server.mjs');
const {
  getCollectionDb,
  ensurePaintingBatchIdempotencyConstraints,
  dbInsertPaintingBatchRun,
  dbInsertPaintingBatchTask,
  dbGetPaintingBatchTask,
  dbGetPaintingBatchRun,
  dbGetActivePaintingBatchRuns,
  dbMarkPaintingDirectionUsed,
  dbGetPaintingUsedDirections,
  handleRetryPaintingBatchTask,
  handleResubmitPaintingBatchTask,
  paintingPromptSimilarity,
  rewritePromptForDiversity,
  PaintingBatchSemaphore,
} = server;

let passed = 0;
let failed = 0;
const failures = [];
function assert(cond, name, detail = '') {
  if (cond) {
    passed += 1;
    console.log(`  ✓ ${name}`);
  } else {
    failed += 1;
    failures.push(name);
    console.error(`  ✗ ${name} ${detail}`);
  }
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

function mockRes() {
  return {
    _code: 0,
    _headers: null,
    _body: '',
    writeHead(code, headers) { this._code = code; this._headers = headers; },
    end(body) { this._body = String(body || ''); },
  };
}
function mockReq(pathname, bodyObj) {
  const listeners = {};
  const req = {
    url: pathname,
    headers: { host: 'localhost' },
    on(ev, cb) { listeners[ev] = cb; return req; },
    destroy() {},
  };
  if (bodyObj !== undefined) {
    const payload = JSON.stringify(bodyObj);
    queueMicrotask(() => {
      listeners.data?.(payload);
      listeners.end?.();
    });
  }
  return req;
}
function jsonBody(res) {
  try { return JSON.parse(res._body || '{}'); } catch { return {}; }
}

// 初始化主 collection db（建表 + 跑幂等迁移）。
getCollectionDb();

console.log('挂画批量生成 — 无费测试\n');

// ===== T1 临时 SQLite 重复数据迁移测试 =====
console.log('[1] 临时 SQLite 重复数据迁移测试');
{
  const db = new DatabaseSync(join(stateDir, 'migration-test.db'));
  db.exec(`
    CREATE TABLE painting_batch_tasks (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      batch_run_id TEXT NOT NULL,
      direction_number INTEGER NOT NULL,
      batch_index INTEGER NOT NULL,
      variation_round INTEGER NOT NULL DEFAULT 0,
      idea_id TEXT NOT NULL DEFAULT '',
      idea_title TEXT NOT NULL DEFAULT '',
      idea_summary TEXT NOT NULL DEFAULT '',
      prompt TEXT NOT NULL DEFAULT '',
      duration INTEGER NOT NULL DEFAULT 0,
      seedance_task_id TEXT NOT NULL DEFAULT '',
      video_url TEXT NOT NULL DEFAULT '',
      library_item_id INTEGER,
      library_item_json TEXT NOT NULL DEFAULT '{}',
      status TEXT NOT NULL DEFAULT 'queued',
      retry_count INTEGER NOT NULL DEFAULT 0,
      save_retry_count INTEGER NOT NULL DEFAULT 0,
      error_message TEXT NOT NULL DEFAULT '',
      diversity_ledger_json TEXT NOT NULL DEFAULT '{}',
      created_at INTEGER NOT NULL DEFAULT (unixepoch()),
      updated_at INTEGER NOT NULL DEFAULT (unixepoch())
    );
  `);
  const ins = db.prepare(`
    INSERT INTO painting_batch_tasks (batch_run_id, direction_number, batch_index, variation_round, seedance_task_id, status)
    VALUES (?, ?, ?, ?, ?, ?)
  `);
  // 重复方向键：(run-A, 0, 1) 出现两次 -> id 1,2
  ins.run('run-A', 1, 0, 0, 'seed-dir-1', 'needs_review');
  ins.run('run-A', 1, 0, 0, 'seed-dir-2', 'needs_review');
  // 重复 seedance_task_id：'seed-dup-x' 出现两次 -> id 3,4（不同方向，不构成方向重复）
  ins.run('run-B', 5, 0, 0, 'seed-dup-x', 'needs_review');
  ins.run('run-B', 6, 0, 0, 'seed-dup-x', 'needs_review');
  // 干净记录必须保留 -> id 5
  ins.run('run-C', 9, 0, 0, 'seed-keep', 'queued');

  ensurePaintingBatchIdempotencyConstraints(db);

  const remaining = db.prepare('SELECT * FROM painting_batch_tasks ORDER BY id ASC').all();
  const archived = db.prepare('SELECT * FROM painting_batch_task_archived_conflicts ORDER BY id ASC').all();

  assert(remaining.length === 3, '重复方向与重复Seedance各归档一条，仅保留唯一记录', `remaining=${remaining.map((r) => r.id).join(',')}`);
  assert(remaining.every((r) => [1, 3, 5].includes(r.id)), '保留的是每组最早一条 (id 1,3,5)');
  assert(archived.length === 2, '归档表记录 2 条冲突', `archived=${archived.length}`);

  const archivedSeedance = archived.find((a) => a.conflict_kind === 'duplicate_seedance_task_id');
  assert(!!archivedSeedance && archivedSeedance.seedance_task_id === 'seed-dup-x', '归档的重复Seedance记录保留原 taskId（可追溯）', JSON.stringify(archivedSeedance));
  const archivedDir = archived.find((a) => a.conflict_kind === 'duplicate_direction');
  assert(!!archivedDir && archivedDir.seedance_task_id === 'seed-dir-2', '归档的重复方向记录保留原 taskId（可追溯）', JSON.stringify(archivedDir));

  const indexList = db.prepare('PRAGMA index_list(painting_batch_tasks)').all();
  const hasSeedanceIdx = indexList.some((i) => i.name === 'idx_painting_batch_tasks_seedance_unique');
  const hasDirIdx = indexList.some((i) => i.name === 'idx_painting_batch_tasks_direction_unique');
  assert(hasSeedanceIdx && hasDirIdx, '两个唯一索引真实存在于 index_list', indexList.map((i) => i.name).join(','));

  const dirInfo = db.prepare('PRAGMA index_info(idx_painting_batch_tasks_direction_unique)').all();
  const dirCols = dirInfo.map((c) => c.name);
  assert(['batch_run_id', 'variation_round', 'direction_number'].every((c) => dirCols.includes(c)), '方向唯一索引包含正确列', dirCols.join(','));

  let enforced = false;
  try { ins.run('run-A', 1, 0, 0, 'seed-x', 'queued'); } catch { enforced = true; }
  assert(enforced, '唯一索引真实生效：重复方向插入被数据库拒绝');

  db.close();
}

// ===== T2 needs_review 无 taskId：普通重试绝不触发提交函数 =====
console.log('\n[2] needs_review 无 taskId：普通重试绝不触发提交函数');
{
  dbInsertPaintingBatchRun({ batchRunId: 'run-t2', paintingName: 't2', status: 'running', controlStatus: 'running', imageHash: 'hash-t2' });
  const task = dbInsertPaintingBatchTask({ batchRunId: 'run-t2', directionNumber: 1, batchIndex: 0, variationRound: 0, status: 'needs_review', seedanceTaskId: '', prompt: '', duration: 8 });
  const createCallsBefore = fetchCalls.filter((c) => c.method === 'POST' && c.url.includes('/contents/generations/tasks')).length;

  const res = mockRes();
  await handleRetryPaintingBatchTask(mockReq(`/api/painting/batch-tasks/${task.id}/retry`), res);

  const body = jsonBody(res);
  assert(res._code === 400, '返回 400', `code=${res._code}`);
  assert(body.requiresResubmit === true, '响应要求改用“重新提交”（requiresResubmit=true）', JSON.stringify(body));

  const after = dbGetPaintingBatchTask(task.id);
  assert(after.status === 'needs_review', '任务状态未被改动（仍 needs_review）', `status=${after.status}`);
  assert(after.seedanceTaskId === '', 'seedanceTaskId 仍为空');

  const createCallsAfter = fetchCalls.filter((c) => c.method === 'POST' && c.url.includes('/contents/generations/tasks')).length;
  assert(createCallsAfter === createCallsBefore, '未触发任何 Seedance 创建(提交)调用');
}

// ===== T3 有 taskId：重试只触发查询，不触发创建 =====
console.log('\n[3] 有 taskId：重试只触发查询，不触发创建');
{
  dbInsertPaintingBatchRun({ batchRunId: 'run-t3', paintingName: 't3', status: 'running', controlStatus: 'running', imageHash: 'hash-t3', imagePath: '' });
  const task = dbInsertPaintingBatchTask({ batchRunId: 'run-t3', directionNumber: 2, batchIndex: 0, variationRound: 0, status: 'needs_review', seedanceTaskId: 'seed-t3-abc123', prompt: '已经生成的提示词', duration: 8 });

  const tasksBefore = getCollectionDb().prepare('SELECT COUNT(*) AS c FROM painting_batch_tasks WHERE batch_run_id = ?').get('run-t3').c;

  const res = mockRes();
  await handleRetryPaintingBatchTask(mockReq(`/api/painting/batch-tasks/${task.id}/retry`), res);

  const body = jsonBody(res);
  assert(res._code === 200, '返回 200', `code=${res._code}`);
  assert(body.ok === true && body.status === 'seedance_submitted', '响应确定返回查询状态 seedance_submitted', JSON.stringify(body));

  const after = dbGetPaintingBatchTask(task.id);
  assert(after.seedanceTaskId === 'seed-t3-abc123', 'seedanceTaskId 保留未清空', `seedanceTaskId=${after.seedanceTaskId}`);
  assert(!['submitting_seedance', 'queued', 'generating_prompt', 'prompt_ready'].includes(after.status), '绝不进入重新提交状态（查询/轮询态除外）', `status=${after.status}`);

  const tasksAfter = getCollectionDb().prepare('SELECT COUNT(*) AS c FROM painting_batch_tasks WHERE batch_run_id = ?').get('run-t3').c;
  assert(tasksAfter === tasksBefore, '未创建新任务', `before=${tasksBefore} after=${tasksAfter}`);

  const createCalls = fetchCalls.filter((c) => c.method === 'POST' && c.url.includes('/contents/generations/tasks'));
  assert(createCalls.length === 0, '未触发任何 Seedance 创建(提交)调用');
}

// ===== T3b 重新提交的二次确认门槛 =====
console.log('\n[3b] 重新提交：无 taskId 且未确认 -> 阻止；有 taskId -> 阻止');
{
  dbInsertPaintingBatchRun({ batchRunId: 'run-t3b', paintingName: 't3b', status: 'running', controlStatus: 'running', imageHash: 'hash-t3b' });
  const noTask = dbInsertPaintingBatchTask({ batchRunId: 'run-t3b', directionNumber: 1, batchIndex: 0, variationRound: 0, status: 'needs_review', seedanceTaskId: '', prompt: '', duration: 8 });
  const hasTask = dbInsertPaintingBatchTask({ batchRunId: 'run-t3b', directionNumber: 2, batchIndex: 0, variationRound: 0, status: 'needs_review', seedanceTaskId: 'seed-t3b-exists', prompt: 'p', duration: 8 });

  const resNoConfirm = mockRes();
  await handleResubmitPaintingBatchTask(mockReq(`/api/painting/batch-tasks/${noTask.id}/resubmit`, {}), resNoConfirm);
  const bodyNoConfirm = jsonBody(resNoConfirm);
  assert(resNoConfirm._code === 400 && bodyNoConfirm.needsConfirm === true, '未二次确认时返回 needsConfirm 并阻止', JSON.stringify(bodyNoConfirm));
  assert(dbGetPaintingBatchTask(noTask.id).status === 'needs_review', '未确认时状态不变，仍 needs_review');

  const resHasTask = mockRes();
  await handleResubmitPaintingBatchTask(mockReq(`/api/painting/batch-tasks/${hasTask.id}/resubmit`, { confirm: true }), resHasTask);
  assert(resHasTask._code === 400, '已存在 taskId 时拒绝重新提交（避免重复扣费）', `code=${resHasTask._code}`);
  assert(dbGetPaintingBatchTask(hasTask.id).seedanceTaskId === 'seed-t3b-exists', '已有 taskId 未被改动');
}

// ===== T4 手动 / 换元素 提交成功后写入方向使用记录（持久化原语） =====
console.log('\n[4] 手动 / 换元素提交成功后写入方向使用记录');
{
  dbMarkPaintingDirectionUsed('hash-t4', 0, 3);   // 手动生成：第 0 轮方向 3
  dbMarkPaintingDirectionUsed('hash-t4', 1, 7);   // 换元素再生成：第 1 轮方向 7

  const round0 = dbGetPaintingUsedDirections('hash-t4', 0);
  const round1 = dbGetPaintingUsedDirections('hash-t4', 1);
  assert(round0.includes(3), '手动生成方向 3 已写入使用记录', JSON.stringify(round0));
  assert(round1.includes(7), '换元素再生成方向 7 已写入使用记录（轮次隔离）', JSON.stringify(round1));
  assert(!round0.includes(7) && !round1.includes(3), '不同轮次方向互不串扰');

  dbMarkPaintingDirectionUsed('hash-t4', 0, 3);   // 幂等重复标记
  const round0Again = dbGetPaintingUsedDirections('hash-t4', 0);
  assert(round0Again.length === 1 && round0Again[0] === 3, '重复标记不产生重复方向');

  dbMarkPaintingDirectionUsed('', 0, 5);          // 空 hash 忽略
  dbMarkPaintingDirectionUsed('hash-t4', 0, 0);   // direction 0 忽略
  assert(dbGetPaintingUsedDirections('', 0).length === 0, '空 hash 不写入');
  assert(dbGetPaintingUsedDirections('hash-t4', 0).length === 1, 'direction 0 不写入');
}

// ===== T5 stopping 批次刷新后仍被视为活动批次 =====
console.log('\n[5] stopping 批次刷新后仍被视为活动批次');
{
  dbInsertPaintingBatchRun({ batchRunId: 'run-stopping', paintingName: 'stopping', status: 'stopping', controlStatus: 'stopping' });
  const active = dbGetActivePaintingBatchRuns();
  assert(active.some((r) => r.batchRunId === 'run-stopping'), 'stopping 批次被 dbGetActivePaintingBatchRuns 识别为活动', JSON.stringify(active.map((r) => `${r.batchRunId}:${r.status}`)));
}

// ===== T6 并发提示词相似度复核（确定性原语） =====
console.log('\n[6] 并发提示词相似度复核');
{
  const pA = '新中式客厅场景：一张浅色布艺沙发靠墙摆放，旁边是原木茶几，茶几上有一盆绿植，落地灯暖黄色光线从左侧照射，人物身穿米色针织衫坐在沙发上翻阅画册，镜头从玄关缓缓推进到客厅中部。';
  const pB = '新中式客厅场景：一张浅色布艺沙发靠墙摆放，旁边是原木茶几，茶几上有一盆绿植，落地灯暖黄色光线从左侧照射，人物身穿米色针织衫坐在沙发上翻阅杂志，镜头从玄关缓缓推进到客厅中部。';
  const pC = '日式侘寂风卧室：低矮原木床架铺着亚麻床品，床头柜上放着复古台灯，人物穿灰蓝色睡衣靠在床头读信，镜头从窗口横移到床尾。';

  const simNear = paintingPromptSimilarity(pA, pB);
  assert(simNear >= 0.78, '近重复提示词被判定为相似（会触发重写）', `sim=${simNear.toFixed(3)}`);
  const simFar = paintingPromptSimilarity(pA, pC);
  assert(simFar < 0.78, '不同场景提示词不被误判相似', `sim=${simFar.toFixed(3)}`);

  // 复核短路：参考提示词不相似时，原样返回、不触发重写（证明“比较”确实发生并正确短路）。
  const idea = { id: 'i1', title: 't', summary: 's', directionNumber: 1, durationMin: 8, durationMax: 8, ratio: '9:16', stylePreset: '' };
  const rewritten = await rewritePromptForDiversity('test-req', 'fake-ark-key', {}, idea, {}, [pC], pA, 8);
  assert(rewritten.prompt === pA && rewritten.duration === 8, '复核：参考不相似时原样返回（未触发重写）');

  // 提交互斥：第二次 acquire 必须等第一次 release，保证串行复核。
  const sem = new PaintingBatchSemaphore(1);
  await sem.acquire();
  let secondAcquired = false;
  const second = sem.acquire().then(() => { secondAcquired = true; });
  await sleep(30);
  assert(secondAcquired === false, '提交锁互斥：第二次 acquire 被阻塞');
  sem.release();
  await second;
  assert(secondAcquired === true, '提交锁互斥：release 后放行');
}

console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========`);
if (failed > 0) {
  console.error('失败项：');
  failures.forEach((f) => console.error(`  - ${f}`));
}
globalThis.fetch = realFetch;
process.exit(failed > 0 ? 1 : 0);

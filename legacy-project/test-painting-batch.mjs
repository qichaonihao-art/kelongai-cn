// 无费测试脚本：不调用真实 Seedance / 豆包，也不监听端口。
// 通过 KELONG_SKIP_LISTEN=1 + 临时 RUNTIME_STATE_DIR 复用 server.mjs 的真实逻辑。
import { mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { Readable } from 'node:stream';

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
  dbUpdatePaintingBatchRun,
  dbGetActivePaintingBatchRuns,
  dbGetPaintingBatchRunByCreationRequestId,
  dbGetPaintingBatchTasks,
  dbMarkPaintingDirectionUsed,
  dbGetPaintingUsedDirections,
  handlePaintingIdeas,
  handleRetryPaintingBatchTask,
  handleResubmitPaintingBatchTask,
  handleCreatePaintingBatchRun,
  handleGetPaintingBatchRun,
  handleGetPaintingBatchRunByRequest,
  handleGetPaintingBatchRunEstimate,
  readMultipartFormBody,
  isValidPaintingClientRequestId,
  parsePaintingIdeasWithJsonRetry,
  getSeedanceRatePerSecond,
  computePaintingBatchCostEstimate,
  PAINTING_BATCH_MODEL,
  PAINTING_BATCH_MODEL_REJECT_MESSAGE,
  paintingPromptSimilarity,
  rewritePromptForDiversity,
  PaintingBatchSemaphore,
  getPaintingFrameworkPosition,
  formatPaintingSeedanceVideoLibraryName,
  formatSeedanceVideoLibraryName,
  ensurePaintingSizeLock,
  inspectPaintingPromptQuality,
  PAINTING_REAL_SIZE_RULE,
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
  dbInsertPaintingBatchRun({ batchRunId: 'run-t3b', paintingName: 't3b', status: 'running', controlStatus: 'running', imageHash: 'hash-t3b', model: PAINTING_BATCH_MODEL });
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

// ===== T7 Seedance 按秒单价 =====
console.log('\n[7] Seedance 按秒单价（元/秒）');
{
  assert(getSeedanceRatePerSecond('doubao-seedance-2-0-mini-260615') === 0.2, 'Mini = 0.2 元/秒');
  assert(getSeedanceRatePerSecond('doubao-seedance-2-0-260128') === 1.0, '2.0 = 1.0 元/秒');
  assert(getSeedanceRatePerSecond('doubao-seedance-2-5-260628') === 1.5, '2.5 = 1.5 元/秒');
  assert(getSeedanceRatePerSecond('doubao-seedance-unknown') === null, '未知模型返回 null（无兜底单价）');
}

// ===== T8 40×8s = 320s / ¥64.00 =====
console.log('\n[8] 费用估算：40 条 × 8s = 320s / ¥64.00');
{
  const ideas = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, directionNumber: i + 1, durationMin: 8, durationMax: 8 }));
  const est = computePaintingBatchCostEstimate(ideas, { durationMin: 8, durationMax: 8 }, 'doubao-seedance-2-0-mini-260615', '720p');
  assert(est.ratePerSecond === 0.2, 'ratePerSecond = 0.2', JSON.stringify(est));
  assert(est.totalMinSeconds === 320 && est.totalMaxSeconds === 320, '总时长 = 320s（min==max）', `${est.totalMinSeconds}/${est.totalMaxSeconds}`);
  assert(est.estimatedCostMin === 64 && est.estimatedCostMax === 64, '费用 = ¥64.00（单一数值）', `${est.estimatedCostMin}/${est.estimatedCostMax}`);
  assert(est.currency === 'CNY', 'currency = CNY');
  assert(typeof est.pricingNote === 'string' && est.pricingNote.includes('实际以平台账单为准'), 'pricingNote 保留“实际以平台账单为准”');
}

// ===== T9 39×8s + 方向29(4-6s) = 316-318s / ¥63.20-¥63.60 =====
console.log('\n[9] 费用估算：39 条 × 8s + 方向29(4-6s) = 316-318s / ¥63.20-¥63.60');
{
  const ideas = Array.from({ length: 39 }, (_, i) => ({ id: `i${i}`, directionNumber: i + 1, durationMin: 8, durationMax: 8 }));
  ideas.push({ id: 'i29', directionNumber: 29, durationMin: 4, durationMax: 6 });
  const est = computePaintingBatchCostEstimate(ideas, { durationMin: 8, durationMax: 8 }, 'doubao-seedance-2-0-mini-260615', '720p');
  assert(est.totalMinSeconds === 316 && est.totalMaxSeconds === 318, '总时长 = 316-318s', `${est.totalMinSeconds}/${est.totalMaxSeconds}`);
  assert(est.estimatedCostMin === 63.2 && est.estimatedCostMax === 63.6, '费用 = ¥63.20-¥63.60', `${est.estimatedCostMin}/${est.estimatedCostMax}`);
}

// ===== T10 min==max 单一数值（区间退化为单一值） =====
console.log('\n[10] min==max 时总时长与费用均为单一数值');
{
  const ideas = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, directionNumber: i + 1, durationMin: 8, durationMax: 8 }));
  const est = computePaintingBatchCostEstimate(ideas, { durationMin: 8, durationMax: 8 }, 'doubao-seedance-2-0-mini-260615', '720p');
  assert(est.totalMinSeconds === est.totalMaxSeconds, '总时长 min==max（单一数值）', `${est.totalMinSeconds}/${est.totalMaxSeconds}`);
  assert(est.estimatedCostMin === est.estimatedCostMax, '费用 min==max（单一数值）');
}

// ===== T11 未知模型无兜底 =====
console.log('\n[11] 未知模型：无 0.5 兜底 → 费用估算为 null（前端显示“暂无法估算”）');
{
  const ideas = Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, directionNumber: i + 1, durationMin: 8, durationMax: 8 }));
  const est = computePaintingBatchCostEstimate(ideas, { durationMin: 8, durationMax: 8 }, 'doubao-seedance-unknown', '720p');
  assert(est.ratePerSecond === null, 'ratePerSecond = null');
  assert(est.estimatedCostMin === null && est.estimatedCostMax === null, '费用估算为 null（无 0.5 兜底）', JSON.stringify(est));
}

// ===== T12 批量估算接口：拒绝 2.0/2.5，接受 Mini =====
console.log('\n[12] 批量估算接口：拒绝 2.0/2.5，接受 Mini');
{
  const resReject20 = mockRes();
  await handleGetPaintingBatchRunEstimate(mockReq('/api/painting/batch-runs/estimate?model=doubao-seedance-2-0-260128'), resReject20);
  assert(resReject20._code === 400, '2.0 模型返回 400', `code=${resReject20._code}`);

  const resReject25 = mockRes();
  await handleGetPaintingBatchRunEstimate(mockReq('/api/painting/batch-runs/estimate?model=doubao-seedance-2-5-260628'), resReject25);
  assert(resReject25._code === 400, '2.5 模型返回 400', `code=${resReject25._code}`);

  const resMini = mockRes();
  await handleGetPaintingBatchRunEstimate(mockReq('/api/painting/batch-runs/estimate?model=doubao-seedance-2-0-mini-260615'), resMini);
  const bodyMini = jsonBody(resMini);
  assert(resMini._code === 200 && bodyMini.estimate?.ratePerSecond === 0.2, 'Mini 返回 200 且 ratePerSecond=0.2', JSON.stringify(bodyMini));
  assert(bodyMini.estimate?.model === PAINTING_BATCH_MODEL && bodyMini.estimate?.currency === 'CNY', '返回新结构（model/currency/ratePerSecond）', JSON.stringify(bodyMini));

  const resDefault = mockRes();
  await handleGetPaintingBatchRunEstimate(mockReq('/api/painting/batch-runs/estimate'), resDefault);
  const bodyDefault = jsonBody(resDefault);
  assert(resDefault._code === 200 && bodyDefault.estimate?.model === PAINTING_BATCH_MODEL, '未传模型时默认 Mini', JSON.stringify(bodyDefault));
}

// ===== T13 历史非 Mini 批次：无 taskId 禁止重新提交 =====
console.log('\n[13] 历史非 Mini 批次：无 taskId 禁止重新提交');
{
  dbInsertPaintingBatchRun({ batchRunId: 'run-nonmini', paintingName: 'nonmini', status: 'running', controlStatus: 'running', imageHash: 'hash-nonmini', model: 'doubao-seedance-2-0-260128' });
  const task = dbInsertPaintingBatchTask({ batchRunId: 'run-nonmini', directionNumber: 1, batchIndex: 0, variationRound: 0, status: 'needs_review', seedanceTaskId: '', prompt: '', duration: 8 });
  const res = mockRes();
  await handleResubmitPaintingBatchTask(mockReq(`/api/painting/batch-tasks/${task.id}/resubmit`, { confirm: true }), res);
  const body = jsonBody(res);
  assert(res._code === 400, '非 Mini 历史批次返回 400', `code=${res._code}`);
  assert(String(body.error).includes('非 Mini 模型'), '错误信息提示非 Mini 模型', JSON.stringify(body));
  assert(dbGetPaintingBatchTask(task.id).status === 'needs_review', '任务状态未改动（仍 needs_review）');
}

// ===== T14 历史非 Mini 批次：有 taskId 仍可查询/保存（不重新提交） =====
console.log('\n[14] 历史非 Mini 批次：有 taskId 仍可查询/保存（不重新提交）');
{
  dbInsertPaintingBatchRun({ batchRunId: 'run-nonmini-q', paintingName: 'nmq', status: 'running', controlStatus: 'running', imageHash: 'hash-nmq', model: 'doubao-seedance-2-0-260128' });
  const task = dbInsertPaintingBatchTask({ batchRunId: 'run-nonmini-q', directionNumber: 1, batchIndex: 0, variationRound: 0, status: 'needs_review', seedanceTaskId: 'seed-nmq-exists', prompt: 'p', duration: 8 });
  const createBefore = fetchCalls.filter((c) => c.method === 'POST' && c.url.includes('/contents/generations/tasks')).length;
  const res = mockRes();
  await handleRetryPaintingBatchTask(mockReq(`/api/painting/batch-tasks/${task.id}/retry`), res);
  assert(res._code === 200, '非 Mini 历史任务有 taskId 仍可查询', `code=${res._code}`);
  assert(dbGetPaintingBatchTask(task.id).seedanceTaskId === 'seed-nmq-exists', 'seedanceTaskId 保留未清空');
  const createAfter = fetchCalls.filter((c) => c.method === 'POST' && c.url.includes('/contents/generations/tasks')).length;
  assert(createAfter === createBefore, '未触发任何 Seedance 创建(提交)调用');
}

// ===== T15 options_json 费用估算快照 =====
console.log('\n[15] options_json 费用估算快照（创建时写入，可追溯）');
{
  const est = computePaintingBatchCostEstimate(
    Array.from({ length: 40 }, (_, i) => ({ id: `i${i}`, directionNumber: i + 1, durationMin: 8, durationMax: 8 })),
    { durationMin: 8, durationMax: 8 },
    PAINTING_BATCH_MODEL,
    '720p',
  );
  const run = dbInsertPaintingBatchRun({
    batchRunId: 'run-snapshot',
    paintingName: 'snapshot',
    status: 'running',
    controlStatus: 'running',
    imageHash: 'hash-snapshot',
    model: PAINTING_BATCH_MODEL,
    resolution: '720p',
    options: { costEstimate: est },
  });
  const fetched = dbGetPaintingBatchRun('run-snapshot');
  const ce = fetched.options?.costEstimate;
  assert(!!ce, 'options_json 中保存了 costEstimate 快照', JSON.stringify(fetched.options));
  assert(ce.ratePerSecond === 0.2 && ce.totalMinSeconds === 320 && ce.totalMaxSeconds === 320, '快照含单价与总时长', JSON.stringify(ce));
  assert(ce.estimatedCostMin === 64 && ce.estimatedCostMax === 64, '快照含费用估算', JSON.stringify(ce));
  assert(fetched.model === PAINTING_BATCH_MODEL, '批次 model 固定为 Mini', fetched.model);
}

// ===== T16 按秒单价真正校验分辨率 =====
console.log('\n[16] 按秒单价：真正校验分辨率');
{
  assert(getSeedanceRatePerSecond('doubao-seedance-2-0-mini-260615', '720p') === 0.2, 'Mini + 720p = 0.2');
  assert(getSeedanceRatePerSecond('doubao-seedance-2-0-mini-260615', '720P') === 0.2, 'Mini + 720P(大写) = 0.2');
  assert(getSeedanceRatePerSecond('doubao-seedance-2-0-mini-260615', '1080p') === null, 'Mini + 1080p = null');
  assert(getSeedanceRatePerSecond('doubao-seedance-2-0-mini-260615', '4k') === null, 'Mini + 4k = null');
  assert(getSeedanceRatePerSecond('doubao-seedance-2-0-mini-260615') === 0.2, 'Mini + 未传分辨率（默认720p）= 0.2');
  assert(getSeedanceRatePerSecond('doubao-seedance-2-0-260128', '1080p') === null, '2.0 + 1080p = null');
  assert(getSeedanceRatePerSecond('doubao-seedance-2-5-260628', '720p') === 1.5, '2.5 + 720p = 1.5（手动模式仍可用）');
}

// ===== T17 创建批次接口：接受 720P，拒绝 1080P/4K =====
console.log('\n[17] 创建批次接口：接受 720P，拒绝 1080P/4K');
{
  const ideas = Array.from({ length: 40 }, (_, i) => ({ id: `c${i}`, directionNumber: i + 1, durationMin: 8, durationMax: 8 }));
  const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const baseBody = { image: IMG, profile: { name: '测试挂画', style: '新中式', subject: '山水' }, plan: { durationMin: 8, durationMax: 8, ratio: '9:16', stylePreset: 'modern-minimal' }, ideas, model: 'doubao-seedance-2-0-mini-260615', creationRequestId: 'batch-resolution-0001' };

  const res1080 = mockRes();
  await handleCreatePaintingBatchRun(mockReq('/api/painting/batch-runs', { ...baseBody, resolution: '1080p' }), res1080);
  assert(res1080._code === 400, 'Mini + 1080p 返回 400', `code=${res1080._code}`);
  assert(String(jsonBody(res1080).error).includes('仅支持720P'), '错误提示“仅支持720P”', jsonBody(res1080).error);

  const res4k = mockRes();
  await handleCreatePaintingBatchRun(mockReq('/api/painting/batch-runs', { ...baseBody, resolution: '4k' }), res4k);
  assert(res4k._code === 400, 'Mini + 4k 返回 400', `code=${res4k._code}`);

  const res720 = mockRes();
  await handleCreatePaintingBatchRun(mockReq('/api/painting/batch-runs', { ...baseBody, resolution: '720p' }), res720);
  const body720 = jsonBody(res720);
  assert(res720._code === 202, 'Mini + 720p 返回 202', `code=${res720._code}`);
  assert(!!body720.batchRunId, '返回 batchRunId', JSON.stringify(body720));
  const run720 = dbGetPaintingBatchRun(body720.batchRunId);
  assert(run720.model === PAINTING_BATCH_MODEL && String(run720.resolution).toLowerCase() === '720p', '批次 model=Mini 且 resolution=720p', JSON.stringify({ model: run720.model, resolution: run720.resolution }));
  // 立即停止该批次，避免后台处理器在后续断言期间产生噪声。
  dbUpdatePaintingBatchRun(body720.batchRunId, { status: 'stopped', controlStatus: 'stopped' });
}

// ===== T18 历史非 720P 批次：有 taskId 可查询，无 taskId 禁止重提 =====
console.log('\n[18] 历史非 720P 批次：有 taskId 可查询，无 taskId 禁止重提');
{
  // 无 taskId：禁止重新提交
  dbInsertPaintingBatchRun({ batchRunId: 'run-non720p', paintingName: 'non720p', status: 'running', controlStatus: 'running', imageHash: 'hash-non720p', model: PAINTING_BATCH_MODEL, resolution: '1080p' });
  const noTask = dbInsertPaintingBatchTask({ batchRunId: 'run-non720p', directionNumber: 1, batchIndex: 0, variationRound: 0, status: 'needs_review', seedanceTaskId: '', prompt: '', duration: 8 });
  const resNoTask = mockRes();
  await handleResubmitPaintingBatchTask(mockReq(`/api/painting/batch-tasks/${noTask.id}/resubmit`, { confirm: true }), resNoTask);
  assert(resNoTask._code === 400, '非 720P 历史批次无 taskId 返回 400', `code=${resNoTask._code}`);
  assert(String(jsonBody(resNoTask).error).includes('非 720P'), '错误信息提示非 720P 分辨率', jsonBody(resNoTask).error);
  assert(dbGetPaintingBatchTask(noTask.id).status === 'needs_review', '任务状态未改动（仍 needs_review）');

  // 有 taskId：仍可查询/保存（不重新提交）
  const hasTask = dbInsertPaintingBatchTask({ batchRunId: 'run-non720p', directionNumber: 2, batchIndex: 0, variationRound: 0, status: 'needs_review', seedanceTaskId: 'seed-non720p-exists', prompt: 'p', duration: 8 });
  const createBefore = fetchCalls.filter((c) => c.method === 'POST' && c.url.includes('/contents/generations/tasks')).length;
  const resHasTask = mockRes();
  await handleRetryPaintingBatchTask(mockReq(`/api/painting/batch-tasks/${hasTask.id}/retry`), resHasTask);
  assert(resHasTask._code === 200, '非 720P 历史任务有 taskId 仍可查询', `code=${resHasTask._code}`);
  assert(dbGetPaintingBatchTask(hasTask.id).seedanceTaskId === 'seed-non720p-exists', 'seedanceTaskId 保留未清空');
  const createAfter = fetchCalls.filter((c) => c.method === 'POST' && c.url.includes('/contents/generations/tasks')).length;
  assert(createAfter === createBefore, '未触发任何 Seedance 创建(提交)调用');
}

// ===== T19 创意任务幂等：相同 clientRequestId 返回同一 taskId，只创建一次后台任务 =====
console.log('\n[19] 创意任务幂等：相同 clientRequestId 返回同一 taskId');
{
  assert(isValidPaintingClientRequestId('idea-20260822-0001abc') === true, '合法编号通过校验');
  assert(isValidPaintingClientRequestId('bad id!') === false, '非法编号（空格）被拒绝');
  assert(isValidPaintingClientRequestId('short') === false, '过短编号被拒绝');
  assert(isValidPaintingClientRequestId('x'.repeat(200)) === false, '过长编号被拒绝');

  const invalid = mockRes();
  await handlePaintingIdeas(mockReq('/api/painting/ideas', { profile: { name: 'p' }, clientRequestId: 'bad id!' }), invalid);
  assert(invalid._code === 400, '非法 clientRequestId 返回 400', `code=${invalid._code}`);

  const rid = 'idea-test-00000001';
  const res1 = mockRes();
  await handlePaintingIdeas(mockReq('/api/painting/ideas', { profile: { name: '测试挂画' }, clientRequestId: rid }), res1);
  const b1 = jsonBody(res1);
  assert(res1._code === 202 && !!b1.taskId, '首次创建返回 taskId', JSON.stringify(b1));
  assert(b1.deduplicated === false, '首次创建 deduplicated=false', JSON.stringify(b1));

  const res2 = mockRes();
  await handlePaintingIdeas(mockReq('/api/painting/ideas', { profile: { name: '测试挂画' }, clientRequestId: rid }), res2);
  const b2 = jsonBody(res2);
  assert(res2._code === 202, '相同编号再次请求返回 202', `code=${res2._code}`);
  assert(b2.taskId === b1.taskId, '返回同一个 taskId（不新建任务）', `${b1.taskId} / ${b2.taskId}`);
  assert(b2.deduplicated === true, '再次请求 deduplicated=true', JSON.stringify(b2));

  // 测试桩会让豆包请求明确失败；失败后再次使用相同编号，应创建新的创意任务，而不是永久返回旧失败任务。
  let recoveredBody = null;
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await new Promise((resolve) => setImmediate(resolve));
    const retryRes = mockRes();
    await handlePaintingIdeas(mockReq('/api/painting/ideas', { profile: { name: '测试挂画' }, clientRequestId: rid }), retryRes);
    const retryBody = jsonBody(retryRes);
    if (retryBody.taskId && retryBody.taskId !== b1.taskId) {
      recoveredBody = retryBody;
      break;
    }
  }
  assert(!!recoveredBody, '原任务明确失败后，同一编号可安全创建新创意任务');
  assert(recoveredBody?.deduplicated === false, '失败恢复任务标记为新建而非命中旧失败任务', JSON.stringify(recoveredBody));

  const res3 = mockRes();
  await handlePaintingIdeas(mockReq('/api/painting/ideas', { profile: { name: '测试挂画' }, clientRequestId: 'idea-test-00000002' }), res3);
  const b3 = jsonBody(res3);
  assert(b3.taskId !== b1.taskId, '不同编号返回不同 taskId', `${b1.taskId} / ${b3.taskId}`);
}

// ===== T20 正式付费批次数据库幂等：同一 creationRequestId 只创建一个批次 =====
console.log('\n[20] 正式批次幂等：同一 creationRequestId 只创建一个批次');
{
  const ideas = Array.from({ length: 40 }, (_, i) => ({ id: `d${i}`, directionNumber: i + 1, durationMin: 8, durationMax: 8 }));
  const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const baseBody = { image: IMG, profile: { name: '测试挂画', style: '新中式', subject: '山水' }, plan: { durationMin: 8, durationMax: 8, ratio: '9:16', stylePreset: 'modern-minimal' }, ideas, model: 'doubao-seedance-2-0-mini-260615', resolution: '720p' };
  const rid = 'batch-test-00000001';

  const res1 = mockRes();
  await handleCreatePaintingBatchRun(mockReq('/api/painting/batch-runs', { ...baseBody, creationRequestId: rid }), res1);
  const b1 = jsonBody(res1);
  assert(res1._code === 202 && !!b1.batchRunId, '首次创建返回 202 + batchRunId', JSON.stringify(b1));
  assert(b1.deduplicated === false, '首次创建 deduplicated=false');
  assert(Number(b1.taskCount) === 40, '首次创建 taskCount=40', String(b1.taskCount));

  const res2 = mockRes();
  await handleCreatePaintingBatchRun(mockReq('/api/painting/batch-runs', { ...baseBody, creationRequestId: rid }), res2);
  const b2 = jsonBody(res2);
  assert(res2._code === 200, '相同编号再次请求返回 200', `code=${res2._code}`);
  assert(b2.batchRunId === b1.batchRunId, '返回同一个 batchRunId', `${b1.batchRunId} / ${b2.batchRunId}`);
  assert(b2.deduplicated === true, '再次请求 deduplicated=true', JSON.stringify(b2));
  assert(Number(b2.taskCount) === 40, '再次请求 taskCount=40（不重复插入任务）', String(b2.taskCount));

  const byRequest = dbGetPaintingBatchRunByCreationRequestId(rid);
  assert(!!byRequest && byRequest.batchRunId === b1.batchRunId, '数据库按编号可查到同一批次', byRequest?.batchRunId);
  assert(dbGetPaintingBatchTasks(b1.batchRunId).length === 40, '方向任务只有一组 40 条', String(dbGetPaintingBatchTasks(b1.batchRunId).length));

  // 唯一索引兜底：绕过 handler 直接插入同编号应触发 UNIQUE 冲突。
  let uniqueThrew = false;
  try {
    dbInsertPaintingBatchRun({ batchRunId: 'run-dup-req', creationRequestId: rid, paintingName: 'dup', status: 'running', controlStatus: 'running' });
  } catch {
    uniqueThrew = true;
  }
  assert(uniqueThrew === true, '唯一索引阻止同编号二次插入（UNIQUE 冲突）');

  // 不同编号创建不同批次。
  const res3 = mockRes();
  await handleCreatePaintingBatchRun(mockReq('/api/painting/batch-runs', { ...baseBody, creationRequestId: 'batch-test-00000002' }), res3);
  const b3 = jsonBody(res3);
  assert(res3._code === 202 && b3.batchRunId !== b1.batchRunId, '不同编号创建不同批次', `${b1.batchRunId} / ${b3.batchRunId}`);
  dbUpdatePaintingBatchRun(b3.batchRunId, { status: 'stopped', controlStatus: 'stopped' });
  dbUpdatePaintingBatchRun(b1.batchRunId, { status: 'stopped', controlStatus: 'stopped' });
}

// ===== T21 by-request 查询：创建后能找到，未知编号 found=false =====
console.log('\n[21] 按编号查询批次：找到 / 未找到');
{
  const resFound = mockRes();
  await handleGetPaintingBatchRunByRequest(mockReq('/api/painting/batch-runs/by-request/batch-test-00000001'), resFound);
  const bf = jsonBody(resFound);
  assert(resFound._code === 200 && bf.found === true && !!bf.run?.batchRunId, '已创建编号 found=true', JSON.stringify({ code: resFound._code, found: bf.found }));

  const resMiss = mockRes();
  await handleGetPaintingBatchRunByRequest(mockReq('/api/painting/batch-runs/by-request/batch-test-99999999'), resMiss);
  const bm = jsonBody(resMiss);
  assert(resMiss._code === 200 && bm.found === false, '未知编号 found=false', JSON.stringify(bm));
}

// ===== T22 事务原子性：中途方向重复导致插入失败，回滚不留半个批次 =====
console.log('\n[22] 事务原子性：插入失败不留半个批次或部分任务');
{
  // 40 条里故意让两个方向编号重复，触发 (batch_run_id, variation_round, direction_number) 唯一索引冲突。
  const ideas = Array.from({ length: 40 }, (_, i) => ({ id: `e${i}`, directionNumber: (i % 40) + 1, durationMin: 8, durationMax: 8 }));
  // 强制第 2 条与第 1 条方向编号相同。
  ideas[1] = { ...ideas[1], directionNumber: 1 };
  const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const rid = 'batch-atomic-000001';
  const res = mockRes();
  await handleCreatePaintingBatchRun(mockReq('/api/painting/batch-runs', {
    image: IMG,
    profile: { name: '测试挂画' },
    plan: { durationMin: 8, durationMax: 8, ratio: '9:16', stylePreset: 'modern-minimal' },
    ideas,
    model: 'doubao-seedance-2-0-mini-260615',
    resolution: '720p',
    creationRequestId: rid,
  }), res);
  assert(res._code === 500, '方向冲突返回 500（不回滚成伪成功）', `code=${res._code}`);
  assert(dbGetPaintingBatchRunByCreationRequestId(rid) === null, '事务回滚后无该编号批次记录');
  const orphan = getCollectionDb().prepare('SELECT COUNT(*) AS c FROM painting_batch_tasks WHERE batch_run_id NOT IN (SELECT batch_run_id FROM painting_batch_runs)').get();
  assert(Number(orphan?.c || 0) === 0, '无孤立方向任务', String(orphan?.c));
}

// ===== T23 正式付费批次必须携带幂等编号 =====
console.log('\n[23] 正式批次缺少幂等编号时拒绝创建');
{
  const ideas = Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, directionNumber: i + 1, durationMin: 8, durationMax: 8 }));
  const IMG = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
  const before = Number(getCollectionDb().prepare('SELECT COUNT(*) AS c FROM painting_batch_runs').get()?.c || 0);
  const res = mockRes();
  await handleCreatePaintingBatchRun(mockReq('/api/painting/batch-runs', {
    image: IMG,
    profile: { name: '测试挂画' },
    plan: { durationMin: 8, durationMax: 8, ratio: '9:16', stylePreset: 'modern-minimal' },
    ideas,
    model: 'doubao-seedance-2-0-mini-260615',
    resolution: '720p',
  }), res);
  const after = Number(getCollectionDb().prepare('SELECT COUNT(*) AS c FROM painting_batch_runs').get()?.c || 0);
  assert(res._code === 400, '缺少 creationRequestId 返回 400', `code=${res._code}`);
  assert(String(jsonBody(res).error).includes('避免网络重试造成重复扣费'), '返回明确的安全提示', jsonBody(res).error);
  assert(after === before, '未创建任何批次记录', `${before} / ${after}`);
}

// ===== T24 multipart 必须完整透传正式批次幂等编号 =====
console.log('\n[24] multipart 透传 creationRequestId');
{
  const formData = new FormData();
  formData.append('file', new File([new Uint8Array([1])], 'painting.png', { type: 'image/png' }));
  formData.append('profile', JSON.stringify({ name: '测试挂画' }));
  formData.append('creationRequestId', 'batch-multipart-000001');
  const encoded = new Request('http://localhost/upload', { method: 'POST', body: formData });
  const req = Readable.fromWeb(encoded.body);
  req.method = 'POST';
  req.headers = Object.fromEntries(encoded.headers.entries());
  const parsed = await readMultipartFormBody(req);
  assert(parsed.creationRequestId === 'batch-multipart-000001', 'multipart 安全编号完整传到批次 handler', parsed.creationRequestId);
  assert(parsed.file instanceof File && parsed.file.size === 1, 'multipart 图片仍正常解析');
}

// ===== T25 模型首次 JSON 非法时自动纠正一次 =====
console.log('\n[25] 创意 JSON 解析失败自动纠正');
{
  let retryCalls = 0;
  const recovered = await parsePaintingIdeasWithJsonRetry('[{"id":"1","title":"未闭合"', async () => {
    retryCalls += 1;
    return '[{"id":"1","title":"全景横摇","summary":"全景展示沙发、茶几与墙面挂画"}]';
  });
  assert(retryCalls === 1 && recovered.retried === true, '首次 JSON 非法时只纠正重试一次');
  assert(recovered.ideas.length === 1 && recovered.ideas[0].title === '全景横摇', '纠正后的合法 JSON 被正常解析', JSON.stringify(recovered.ideas));

  let validRetryCalls = 0;
  const direct = await parsePaintingIdeasWithJsonRetry('[{"id":"1","title":"近景特写","summary":"镜头移动展示画面细节"}]', async () => {
    validRetryCalls += 1;
    return '[]';
  });
  assert(validRetryCalls === 0 && direct.retried === false, '首次 JSON 合法时不产生额外模型调用');
}

// ===== T26 仅挂画创意素材使用“日期 + 第几组第几个”命名 =====
console.log('\n[26] 挂画创意素材入库命名');
{
  const createdAt = Date.UTC(2026, 7, 23, 6, 30) / 1000; // 上海时间 2026-08-23 14:30
  assert(formatSeedanceVideoLibraryName(createdAt) === '8月23日 14-30.mp4', '其他创意模块继续保持原日期命名', formatSeedanceVideoLibraryName(createdAt));
  assert(formatPaintingSeedanceVideoLibraryName(createdAt, 1) === '8月23日 14-30 第1组第1个.mp4', '方向1对应第1组第1个');
  assert(formatPaintingSeedanceVideoLibraryName(createdAt, 10) === '8月23日 14-30 第1组第10个.mp4', '方向10对应第1组第10个');
  assert(formatPaintingSeedanceVideoLibraryName(createdAt, 11) === '8月23日 14-30 第2组第1个.mp4', '方向11对应第2组第1个');
  assert(formatPaintingSeedanceVideoLibraryName(createdAt, 40) === '8月23日 14-30 第4组第10个.mp4', '方向40对应第4组第10个');
  assert(formatPaintingSeedanceVideoLibraryName(createdAt, 0) === '8月23日 14-30.mp4', '没有挂画方向号时严格回退原命名');
  assert(JSON.stringify(getPaintingFrameworkPosition(26)) === JSON.stringify({ groupNumber: 3, itemNumber: 6 }), '方向26可反查第3组第6个');
}

// ===== T27 全自动最终提示词尺寸锁定 =====
console.log('\n[27] 全自动最终提示词尺寸锁定');
{
  const locked = ensurePaintingSizeLock('产品固定约束：测试\n创意内容：0-8秒连续拍摄');
  assert(locked.startsWith('【挂画真实尺寸强制锁定】'), '尺寸锁定被确定性放在最终提示词最前面');
  assert(/40×80厘米/.test(locked) && /1:2/.test(locked), '明确锁定挂画40×80厘米与1:2物理外形');
  assert(/9:16画幅误当成挂画外形/.test(locked), '明确防止将视频9:16与挂画1:2混淆');
  assert(/1\.8至2\.0米/.test(locked) && /18%-22%/.test(locked) && /大片空墙/.test(locked), '使用三人沙发与留白作为主尺度参照');
  assert(/完整站立成年人/.test(locked) && !/成年人物可见身高/.test(locked), '人物参照不再使用不稳定的可见身高');
  assert(/45-55mm/.test(locked) && /超广角/.test(locked), '空间镜头使用标准透视并禁止超广角夸大');
  assert(locked.includes('【卷起挂画滚动展开与下方木条强制锁定】'), '最终提示词确定性追加卷起展开和下方木条锁定');
  assert(/下方木条\/下压杆必须始终存在/.test(locked) && /不得消失、变形、变色、伸长、缩短/.test(locked), '下方木条全过程保持原始外观和颜色');
  assert(/不得新增任何物体、零件或装饰/.test(locked), '禁止在下方木条两端及周围新增任何物体');
  assert(/绕自身轴线旋转而逐圈滚动释放/.test(locked) && /严禁滑动、平移、平铺、抽拉、弹开/.test(locked), '卷起挂画只能滚动释放，禁止滑动或抽拉展开');

  const issues = inspectPaintingPromptQuality(
    '产品宽40厘米、高80厘米；三人沙发宽1.9米，挂画宽度占沙发的20%。\n0-2秒全景沙发和挂画\n2-4秒经过茶几和绿植\n4-6秒人物走过\n6-8秒镜头横移',
    8,
    '客厅连续横移'
  );
  assert(!issues.some((item) => item.includes('宽40厘米')), '质量检查接受明确的沙发18%-22%尺度参照', JSON.stringify(issues));
  assert(PAINTING_REAL_SIZE_RULE.includes('输出视频') && PAINTING_REAL_SIZE_RULE.includes('挂画物理外形'), '核心规则区分视频画布与挂画物理外形');
}

console.log(`\n========== 结果：${passed} 通过 / ${failed} 失败 ==========`);
if (failed > 0) {
  console.error('失败项：');
  failures.forEach((f) => console.error(`  - ${f}`));
}
globalThis.fetch = realFetch;
process.exit(failed > 0 ? 1 : 0);

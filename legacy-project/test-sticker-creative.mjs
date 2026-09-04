// 全部上游请求拦截，数据库和图片仅写临时目录，不生成收费视频。
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { STICKER_FRAMEWORKS, STICKER_MARKER, normalizeStickerProfile, stickerPhysicalRules, ensureStickerPrompt, stickerDuration } from './sticker-creative.mjs';

process.env.RUNTIME_STATE_DIR = mkdtempSync(join(tmpdir(), 'kelong-sticker-test-'));
process.env.KELONG_SKIP_LISTEN = '1';
for (const key of ['ARK_API_KEY', 'MINIMAX_API_KEY', 'SEEDANCE_API_KEY', 'DASHSCOPE_API_KEY']) process.env[key] = 'test-only';
let textReply = '{}';
let payloads = [];
globalThis.fetch = async (url, init = {}) => {
  const payload = JSON.parse(String(init.body || '{}'));
  payloads.push({ url: String(url), payload });
  if (String(url).endsWith('/responses')) return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: textReply }] }] });
  return Response.json({ id: 'stub-video', task_id: 'stub-video', output: { task_id: 'stub-video', task_status: 'PENDING' }, base_resp: { status_code: 0 } });
};
const server = await import('./server.mjs');
const profile = normalizeStickerProfile({ name: '测试横幅字画' });
const plan = { durationMin: 6, durationMax: 8, stylePreset: 'modern-minimal', ratio: '9:16' };
const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const imagePath = join(process.env.RUNTIME_STATE_DIR, 'test.png');
writeFileSync(imagePath, Buffer.from(imageData, 'base64'));
const req = (body) => {
  const listeners = {};
  const request = { url: '/api/seedance/tasks', headers: { host: 'localhost' }, on(event, cb) { listeners[event] = cb; return request; }, destroy() {} };
  queueMicrotask(() => { listeners.data?.(JSON.stringify(body)); listeners.end?.(); });
  return request;
};
const res = () => ({ status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = String(body); } });
const forbidden = /【挂画生成尺寸补偿锁定】|【挂画真实尺寸强制锁定】|【卷轴打开方式固定要求】|【卷起挂画滚动展开与下方木条强制锁定】|【千问 Wan3.0 专用·(?:静态挂画|安装|展开)/;

assert.equal(STICKER_FRAMEWORKS.length, 40);
assert.equal(new Set(STICKER_FRAMEWORKS.map((f) => f.title)).size, 40);
assert.equal(STICKER_FRAMEWORKS.filter((f) => f.state === 'installed').length, 30);
assert.equal(STICKER_FRAMEWORKS.filter((f) => f.state === 'installation').length, 10);
assert.equal(profile.widthCm, 180);
assert.equal(profile.heightCm, 60);
assert.throws(() => normalizeStickerProfile({ widthCm: -10 }));
assert.throws(() => normalizeStickerProfile({ heightCm: 'no' }));
assert.equal(normalizeStickerProfile({ widthCm: 150, heightCm: 50 }).ratio, '150:50');
for (const f of STICKER_FRAMEWORKS) {
  const rule = stickerPhysicalRules(profile, f.directionNumber);
  assert.match(rule, /印刷假框/);
  assert.match(rule, /白色画背/);
  assert.ok(!forbidden.test(rule));
  if (f.state === 'installed') assert.match(rule, /从第0秒就完整压实/);
  else assert.ok(!rule.includes('从第0秒就完整压实'));
  const result = ensureStickerPrompt('创意正文', profile, f.directionNumber);
  assert.equal(ensureStickerPrompt(result, profile, f.directionNumber), result);
}
assert.deepEqual(stickerDuration(1, 8, 9), { durationMin: 5, durationMax: 6 });
assert.deepEqual(stickerDuration(29, 7, 9), { durationMin: 7, durationMax: 9 });

textReply = JSON.stringify({ name: '字画', material: '木板', frameStructure: '实木框', widthCm: 40 });
const analysis = await server.analyzePaintingCore({ image: `data:image/png;base64,${imageData}`, productType: 'sticker', widthCm: '150', heightCm: '50' }, 'test', 'analysis');
assert.equal(analysis.profile.widthCm, 150);
assert.match(analysis.profile.material, /PVC/);
assert.match(analysis.profile.frameStructure, /假框/);
assert.ok(!payloads.at(-1).payload.input[0].content.at(-1).text.includes('挂画/卷轴产品分析专家'));

for (let batch = 0; batch < 4; batch++) {
  textReply = JSON.stringify(Array.from({ length: 10 }, (_, i) => ({ id: String(i), title: `方案${i}`, summary: '茶室全景，茶桌与椅子旁自然展示，镜头轻移落在字画。' })));
  const result = await server.generatePaintingIdeasCore({ profile, plan, batch }, 'test', 'ideas');
  assert.equal(result.ideas.length, 10);
  assert.deepEqual(result.ideas.map((i) => i.directionNumber), Array.from({ length: 10 }, (_, i) => batch * 10 + i + 1));
  assert.ok(result.ideas.every((idea) => idea.productType === 'sticker'));
  assert.ok(!payloads.at(-1).payload.input[0].content[0].text.includes('40×80'));
}

for (const direction of [1, 8, 25, 29, 30, 33, 37, 40]) {
  textReply = '产品固定约束：保留印刷画面。创意内容：0—2秒交代产品，2—4秒轻微移动，4—6秒按指定状态展示。负面约束：禁止变形。总时长：6秒';
  const result = await server.generatePaintingIdeaPromptCore('prompt', 'test', profile, { directionNumber: direction, title: '测试', productType: 'sticker' }, plan);
  assert.equal(result.duration, 6);
  assert.ok(result.prompt.startsWith(STICKER_MARKER));
  assert.ok(!forbidden.test(result.prompt));
  assert.ok(!payloads.at(-1).payload.input[0].content[0].text.includes('40×80'));
}
await assert.rejects(server.generatePaintingIdeaPromptCore('bad', 'test', { name: '旧挂画' }, { productType: 'sticker' }, plan), /不能使用贴画/);

server.dbMarkPaintingDirectionUsed('same-image', 0, 1);
server.dbMarkPaintingDirectionUsed('same-image', 0, 33, 'sticker');
assert.deepEqual(server.dbGetPaintingUsedDirections('same-image', 0), [1]);
assert.deepEqual(server.dbGetPaintingUsedDirections('same-image', 0, 'sticker'), [33]);
const run = server.dbInsertPaintingBatchRun({ batchRunId: 'sticker-snapshot', creationRequestId: 'sticker-snapshot-id', paintingName: profile.name, profile, plan, imagePath, imageHash: 'same-image', status: 'paused', controlStatus: 'paused', model: 'wan3.0-video', resolution: '480p', ratio: '9:16', totalDirections: 40, options: {} });
profile.widthCm = 120;
assert.equal(server.dbGetPaintingBatchRun(run.batchRunId).profile.widthCm, 180);
profile.widthCm = 180;
assert.equal(server.getPaintingBatchReferenceSpecs({ directionNumber: 30 }, { ...run, options: { woodReferences: { upper: { imagePath }, lower: { imagePath } } } }).length, 1);

const batchBody = {
  image: `data:image/png;base64,${imageData}`, profile, plan,
  model: 'doubao-seedance-2-0-mini-260615', resolution: '480p', ratio: '9:16',
  requestedCount: 15, startOrder: 'group2', onlyUnused: false,
  ideas: STICKER_FRAMEWORKS.slice(10, 25).map((f) => ({ id: `sticker-${f.directionNumber}`, productType: 'sticker', directionNumber: f.directionNumber, title: f.title, summary: f.action })),
  creationRequestId: 'sticker-create-15',
};
const createdResponse = res();
await server.handleCreatePaintingBatchRun(req(batchBody), createdResponse);
assert.ok([200, 201, 202].includes(createdResponse.status), createdResponse.body);
const batchId = JSON.parse(createdResponse.body).batchRunId;
server.dbUpdatePaintingBatchRun(batchId, { status: 'paused', controlStatus: 'paused' });
assert.equal(server.dbGetPaintingBatchRun(batchId).profile.productType, 'sticker');
assert.equal(server.dbGetPaintingBatchRun(batchId).profile.widthCm, 180);
assert.deepEqual(server.dbGetPaintingBatchTasks(batchId).map((task) => task.directionNumber), Array.from({ length: 15 }, (_, i) => i + 11));
const replayResponse = res();
await server.handleCreatePaintingBatchRun(req(batchBody), replayResponse);
assert.equal(JSON.parse(replayResponse.body).batchRunId, batchId);
assert.equal(JSON.parse(replayResponse.body).deduplicated, true);
const mixedResponse = res();
await server.handleCreatePaintingBatchRun(req({ ...batchBody, creationRequestId: 'sticker-wrong-kind', ideas: [{ directionNumber: 1, title: '旧挂画' }] }), mixedResponse);
assert.equal(mixedResponse.status, 400);

for (const model of ['doubao-seedance-2-0-mini-260615', 'doubao-seedance-2-0-fast-260128', 'doubao-seedance-2-0-260128', 'doubao-seedance-2-5-260628', 'MiniMax-H3', 'wan3.0-video']) {
  const prompt = ensureStickerPrompt('产品固定约束：保持字画。创意内容：连续展示。总时长：6秒', profile, 1);
  payloads = [];
  const response = res();
  await server.handleSeedanceCreateTask(req({ model, prompt, productType: 'sticker', directionNumber: 1, duration: 6, resolution: model === 'MiniMax-H3' ? '768p' : '480p', ratio: '9:16', generateAudio: false }), response);
  assert.equal(response.status, 200, `${model}: ${response.body}`);
  const payload = payloads.at(-1).payload;
  const submitted = payload.input?.prompt || payload.content?.[0]?.text;
  assert.ok(submitted?.startsWith(STICKER_MARKER), model);
  assert.ok(!forbidden.test(submitted), model);
  assert.equal(payload.model, model);
  assert.equal(submitted.includes('【千问 Wan3.0 专用·运镜速度强制锁定】'), model === 'wan3.0-video');
  // 批量与重试复用同一提交函数；方向8不能再触发卷轴展开，30不能加载木条图。
  for (const directionNumber of [8, 30, 37]) {
    payloads = [];
    await server.submitSeedanceTaskForBatchTask({ id: 80 + directionNumber, directionNumber, prompt: ensureStickerPrompt('连续展示，总时长：6秒', profile, directionNumber), duration: 6 }, { ...run, profile, model, imagePath, resolution: model === 'MiniMax-H3' ? '768p' : '480p', options: {} });
    const batchPayload = payloads.at(-1).payload;
    const submitted = batchPayload.input?.prompt || batchPayload.content[0].text;
    assert.ok(submitted.startsWith(STICKER_MARKER));
    assert.ok(!forbidden.test(submitted));
    assert.equal(batchPayload.model, model);
    if (directionNumber === 37) assert.ok(!submitted.includes('从第0秒就完整压实'));
  }
}
console.log('贴画测试通过：40方向、结构分层、尺寸、分析/文案路由、历史快照、使用记录隔离及6模型手动/批量提交。全部请求均为模拟，无付费调用。');
process.exit(0);

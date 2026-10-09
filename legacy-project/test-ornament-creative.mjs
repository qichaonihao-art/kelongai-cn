// All upstream requests are mocked; never creates paid video tasks.
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, readFileSync } from 'node:fs';
import { Readable } from 'node:stream';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { ORNAMENT_FRAMEWORKS, ORNAMENT_MARKER, ORNAMENT_RED_CLOTH_DIRECTION, buildOrnamentVideoRequest, buildOrnamentIdeasRequest, normalizeOrnamentProfile, inspectOrnamentPromptIssues, ensureOrnamentPrompt, ornamentProfileFromPrompt } from './ornament-creative.mjs';
import { productUsageHash } from './sticker-creative.mjs';
process.env.RUNTIME_STATE_DIR = mkdtempSync(join(tmpdir(), 'kelong-ornament-test-'));
process.env.KELONG_SKIP_LISTEN = '1';
for (const key of ['ARK_API_KEY', 'MINIMAX_API_KEY', 'SEEDANCE_API_KEY', 'DASHSCOPE_API_KEY']) process.env[key] = 'test-only';
let reply = '{}'; const replies = []; const payloads = [];
globalThis.fetch = async (url, init = {}) => {
  const payload = JSON.parse(String(init.body || '{}')); payloads.push({ url: String(url), payload });
  if (String(url).endsWith('/responses')) return Response.json({ output: [{ type: 'message', content: [{ type: 'output_text', text: replies.length ? replies.shift() : reply }] }] });
  return Response.json({ id: 'stub-video', task_id: 'stub-video', output: { task_id: 'stub-video', task_status: 'PENDING' }, base_resp: { status_code: 0 } });
};
const server = await import('./server.mjs');
const profile = normalizeOrnamentProfile({ name: '马到成功固定一体摆台', subject: '马与题字', colors: ['红色', '金色'] });
const plan = { durationMin: 5, durationMax: 8, stylePreset: 'modern-minimal', ratio: '9:16', productType: 'ornament' };
const imageData = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII=';
const imagePath = join(process.env.RUNTIME_STATE_DIR, 'test.png'); writeFileSync(imagePath, Buffer.from(imageData, 'base64'));
const req = body => {
 const listeners = {}; const request = { url: '/api/seedance/tasks', headers: { host: 'localhost' }, on(event, cb) { listeners[event] = cb; return request; }, destroy() {} };
 queueMicrotask(() => { listeners.data?.(JSON.stringify(body)); listeners.end?.(); }); return request;
};
const res = () => ({ status: 0, body: '', writeHead(status) { this.status = status; }, end(body) { this.body = String(body); } });
assert.equal(ORNAMENT_FRAMEWORKS.length, 40);
assert.equal(new Set(ORNAMENT_FRAMEWORKS.map(f => f.title)).size, 40);
const reveal = ORNAMENT_FRAMEWORKS[ORNAMENT_RED_CLOTH_DIRECTION - 1];
assert.equal(reveal.directionNumber, 29);
assert.equal(reveal.title, '红布揭幕展示');
for (const scene of ['玄关柜', '书桌', '茶台']) {
 const request = buildOrnamentVideoRequest(profile, reveal, { ...plan, scene }, {});
 assert.ok(request.includes(scene));
 assert.match(request, /第0秒摆件已在台面稳定站立/);
 assert.match(request, /向上及侧方揭布/);
 assert.match(request, /主体与固定支架位置和倾角不变/);
 assert.match(request, /允许仅手入镜/);
 assert.doesNotMatch(request, /无人镜头不添加手/);
}
assert.ok(inspectOrnamentPromptIssues('开场完整展示摆台，镜头推近。', 29).length);
assert.ok(inspectOrnamentPromptIssues('开场红布遮盖摆台，红布消失后展示摆台。', 29).length);
assert.equal(inspectOrnamentPromptIssues(reveal.action, 29).length, 0);
assert.equal(inspectOrnamentPromptIssues('0–1秒：红布盖住摆台；1–3秒：手抓上角揭开红布；3–6秒：完整展示摆台。', 29).length, 0);
assert.deepEqual(ORNAMENT_FRAMEWORKS.map(f => f.directionNumber), Array.from({ length: 40 }, (_, i) => i + 1));
assert.throws(() => normalizeOrnamentProfile({ supportStructure: 'separate' }), /分离式/);
assert.equal(productUsageHash('same', 'ornament'), 'ornament:same');
assert.equal(productUsageHash('same', 'hanging'), 'same');
const corrected = normalizeOrnamentProfile({ name: '换款式', material: 'PVC', frameMaterial: '实木', backboardMaterial: '金属', frameStructure: '独立盘架', subject: '另一款正面图案' });
assert.equal(corrected.frameMaterial, '铝合金'); assert.equal(corrected.backboardMaterial, '木板');
assert.equal(corrected.subject, '另一款正面图案'); assert.match(corrected.frameStructure, /单根|一根/);
assert.ok(inspectOrnamentPromptIssues('实木边框配金属背板。').length);
assert.ok(inspectOrnamentPromptIssues('正面是立体佛像。').length);
assert.ok(inspectOrnamentPromptIssues('正面覆盖玻璃。').length);
assert.ok(inspectOrnamentPromptIssues('折叠后撑杆，移入圆形框体。').length);
assert.equal(inspectOrnamentPromptIssues('金色铝合金边框与木质背板，后部连接一根细金属支撑杆。').length, 0);
assert.notEqual(productUsageHash('same', 'sticker'), productUsageHash('same', 'ornament'));
assert.ok(inspectOrnamentPromptIssues('从支架取下主体，单独展示盘面。').length);
assert.ok(inspectOrnamentPromptIssues('将摆件贴墙，揭膜。').length);
assert.ok(inspectOrnamentPromptIssues('金马活过来奔跑。').length);
assert.equal(inspectOrnamentPromptIssues('禁止拆下主体；不得揭膜。').length, 0);
assert.ok(inspectOrnamentPromptIssues('禁止拆架，但把盘面取下单独展示。').length);
assert.ok(inspectOrnamentPromptIssues('将圆盘放回独立托架。').length);
reply = JSON.stringify({ name: '固定一体摆台', supportStructure: 'fixed', frameStructure: '固定连接的后撑' });
const analysis = await server.analyzePaintingCore({ image: `data:image/png;base64,${imageData}`, productType: 'ornament' }, 'test', 'analysis');
assert.equal(analysis.profile.frameMaterial, '铝合金'); assert.equal(analysis.profile.backboardMaterial, '木板');
assert.equal(analysis.profile.productType, 'ornament'); assert.equal(analysis.profile.supportStructure, 'fixed');
assert.match(payloads.at(-1).payload.input?.[0]?.content?.[1]?.text || JSON.stringify(payloads.at(-1)), /主体独立放在可分离托架/);
reply = JSON.stringify({ supportStructure: 'separate' });
await assert.rejects(server.analyzePaintingCore({ image: `data:image/png;base64,${imageData}`, productType: 'ornament' }, 'test', 'separate'), /分离式/);
for (let batch = 0; batch < 4; batch++) {
 reply = JSON.stringify(ORNAMENT_FRAMEWORKS.slice(batch * 10, batch * 10 + 10).map(f => ({ title: f.title, summary: f.action })));
 const ideasRequest = buildOrnamentIdeasRequest(profile, plan, batch, 0, {});
 assert.doesNotMatch(ideasRequest, /框架方向：|固定动作框架：/);
 assert.match(ideasRequest, /铝合金边框/); assert.match(ideasRequest, /木质背板/);
 const result = await server.generatePaintingIdeasCore({ productType: 'ornament', profile, plan, batch }, 'test', 'ideas');
 assert.equal(result.totalBatches, 4); assert.equal(result.ideas.length, 10);
 assert.deepEqual(result.ideas.map(i => i.directionNumber), Array.from({ length: 10 }, (_, i) => batch * 10 + i + 1));
 assert.ok(result.ideas.every(i => i.productType === 'ornament'));
}
assert.equal(inspectOrnamentPromptIssues('视频画布比例9:16，摄影机固定在三脚架，摆台稳定站立。').length, 0);
assert.equal(inspectOrnamentPromptIssues('正面没有真实浮雕，无立体佛像。').length, 0);
assert.ok(inspectOrnamentPromptIssues('摆台正面使用画布。').length);
assert.ok(inspectOrnamentPromptIssues('摆台使用三脚架。').length);
const actualDirection12 = '初始状态：摆台按固定结构稳定立于暖棕实木书桌一侧台面，金色四角斜接铝合金边框、木质背板、固定细金属后撑杆结构完整，正面为平面吉祥图案，无任何立体浮雕、独立佛像或可动金币元素，支撑结构接触台面呈轻微后倾的稳定状态；书桌另一侧铺素白宣纸、搁狼毫毛笔，搭配竹绿小文房水盂，整体为雅致书房场景。动作：身着月白棉麻盘扣上衣的人物在书桌另一侧完成书写后，将毛笔轻搁于笔山，抬眼望向摆台静静欣赏；过程中人物不触碰摆台，纸张、毛笔始终不越过摆台前方区域，禁止摆台混入实木/塑料/印刷假边框、金属/';
assert.deepEqual(inspectOrnamentPromptIssues(actualDirection12, 12), []);
for (const scene of ['书桌另一侧铺素白宣纸', '人物在宣纸上写字', '宣纸放在摆台旁边', '旁侧放一张画布', '身穿绢布上衣']) assert.deepEqual(inspectOrnamentPromptIssues(scene, 12), [], scene);
for (const material of ['正面采用宣纸', '摆台由画布制成', '绢布制成的摆台', '产品正面覆盖一层PVC柔性薄膜']) assert.ok(inspectOrnamentPromptIssues(material).length, material);
const beforePreparation = payloads.length;
for (const variationRound of [0, 1, 2]) {
 const all = [];
 for (let batch = 0; batch < 4; batch++) {
  const result = await server.generatePaintingIdeasCore({ productType: 'ornament', profile, plan: { ...plan, scene: '书桌另一侧铺素白宣纸', character: '穿绢布衣服的人物' }, batch, variationRound }, 'test', 'fixed-preparation');
  assert.equal(result.ideas.length, 10);
  all.push(...result.ideas);
  for (const idea of result.ideas) assert.equal(inspectOrnamentPromptIssues(idea.summary, idea.directionNumber).length, 0);
 }
 assert.deepEqual(all.map(idea => idea.directionNumber), Array.from({ length: 40 }, (_, index) => index + 1));
}
assert.equal(payloads.length, beforePreparation, 'all four preparation batches load fixed frameworks without model calls');
const safeVideoRequest = buildOrnamentVideoRequest(profile, { directionNumber: 12, summary: '摆台使用树脂，取下主体。' }, { ...plan, scene: '书桌另一侧铺素白宣纸' }, {});
assert.doesNotMatch(safeVideoRequest, /摆台使用树脂，取下主体/);
assert.match(safeVideoRequest, /书桌另一侧铺素白宣纸/);
assert.match(safeVideoRequest, /放下笔后抬眼欣赏/);
const forbidden = /【挂画生成尺寸补偿锁定】|【挂画真实尺寸强制锁定】|【卷轴打开方式固定要求】|【千问 Wan3.0 专用·(?:静态挂画|安装|展开)/;
for (const f of ORNAMENT_FRAMEWORKS) {
 reply = `创意内容：${f.action}\n总时长：6秒`;
 const result = await server.generatePaintingIdeaPromptCore('prompt', 'test', profile, { ...f, productType: 'ornament' }, plan);
 assert.ok(result.prompt.startsWith(ORNAMENT_MARKER)); assert.equal(result.duration, 6);
 assert.match(result.prompt, /铝合金边框/); assert.match(result.prompt, /木质背板/); assert.match(result.prompt, /单根|一根/);
 assert.match(result.prompt, /主体与后撑杆固定连接/); assert.doesNotMatch(result.prompt, forbidden);
 assert.equal(ornamentProfileFromPrompt(result.prompt).productType, 'ornament');
 assert.equal(ensureOrnamentPrompt(result.prompt, profile, f.directionNumber), result.prompt);
 assert.equal(inspectOrnamentPromptIssues(result.prompt).length, 0);
 const specs = server.getPaintingBatchReferenceSpecs({ directionNumber: f.directionNumber }, { profile, imagePath, options: { woodReferences: { upper: { imagePath } } } });
 assert.equal(specs.length, 2); assert.equal(specs[1].baseName, 'ornament-back'); assert.equal(specs[0].baseName, 'ornament-main');
}
reply = '创意内容：开场摆台完整可见，镜头推近。\n总时长：6秒';
await assert.rejects(server.generatePaintingIdeaPromptCore('bad-reveal', 'test', profile, { ...reveal, productType: 'ornament' }, plan), /校验未通过/);
reply = '创意内容：取下主体再安装支架。\n总时长：6秒';
await assert.rejects(server.generatePaintingIdeaPromptCore('bad', 'test', profile, { directionNumber: 1, productType: 'ornament' }, plan), /校验未通过/);
await assert.rejects(server.generatePaintingIdeasCore({ productType: 'hanging', profile, plan }, 'test', 'wrong'), /不能进入|产品类型参数冲突/);
await assert.rejects(server.generatePaintingIdeaPromptCore('bad-type', 'test', profile, { directionNumber: 1, productType: 'sticker' }, plan), /其他产品|产品类型参数冲突/);
for (const [handler, body] of [[server.handlePaintingAnalyze, { productType: 'ornament', image: 'x' }], [server.handlePaintingIdeas, { productType: 'ornament', profile }], [server.handlePaintingIdeaPrompt, { productType: 'ornament', profile, idea: { directionNumber: 1 } }]]) {
 const response = res(); await handler(req(body), response, 'hanging'); assert.equal(response.status, 400);
}
const prompt = ensureOrnamentPrompt('创意内容：双手整体落台，站稳后撤手。\n总时长：6秒', profile, 1);
for (const model of ['doubao-seedance-2-0-mini-260615', 'wan3.0-video', 'MiniMax-H3']) {
 const response = res(); await server.handleSeedanceCreateTask(req({ model, prompt, productType: 'ornament', directionNumber: 1, duration: 6, imageHash: 'manual-ornament-test', resolution: model === 'MiniMax-H3' ? '768p' : '480p', ratio: '9:16', generateAudio: false }), response);
 assert.equal(response.status, 200, response.body); assert.doesNotMatch(JSON.stringify(payloads.at(-1)), forbidden);
 assert.ok(JSON.stringify(payloads.at(-1).payload).includes('data:image/jpeg;base64,'));
 await server.submitSeedanceTaskForBatchTask({ directionNumber: 30, prompt, duration: 6 }, { model, profile, imagePath, resolution: model === 'MiniMax-H3' ? '768p' : '480p', ratio: '9:16', generateAudio: false });
 assert.doesNotMatch(JSON.stringify(payloads.at(-1)), forbidden);
 const sent = payloads.at(-1).payload;
 assert.equal(model === 'wan3.0-video' ? sent.input.media.length : sent.content.filter(item => item.type === 'image_url').length, 2);
}
assert.deepEqual(server.dbGetPaintingUsedDirections('manual-ornament-test', 0, 'ornament'), [1]);
assert.deepEqual(server.dbGetPaintingUsedDirections('manual-ornament-test', 0, 'hanging'), []);
assert.equal(server.paintingPromptSimilarity(ensureOrnamentPrompt('竹林雨声', profile, 1), ensureOrnamentPrompt('都市霓虹', profile, 2)), 0);
const before = payloads.length; const response = res();
await server.handleSeedanceCreateTask(req({ model: 'wan3.0-video', productType: 'ornament', prompt: '把主体从支架取下。', directionNumber: 1 }), response);
assert.equal(response.status, 400); assert.equal(payloads.length, before);
for (const [side, frame] of [[false, false], [true, false], [false, true], [true, true]]) {
 const form = new FormData();
 form.append('file', new File([Buffer.from(imageData, 'base64')], 'front.png', { type: 'image/png' }));
 for (const [key, value] of Object.entries({ profile, plan, model: 'wan3.0-video', resolution: '480p', ratio: '9:16', requestedCount: 1, onlyUnused: false, ideas: [{ ...ORNAMENT_FRAMEWORKS[0], productType: 'ornament' }], creationRequestId: `ornament-optional-${side}-${frame}` })) form.append(key, typeof value === 'object' ? JSON.stringify(value) : String(value));
 form.append('upperWoodFile', new File(['ignored wrong-product attachment'], 'wood.txt', { type: 'text/plain' }));
 if (side) form.append('ornamentSideFile', new File([Buffer.from(imageData, 'base64')], 'side.png', { type: 'image/png' }));
 if (frame) form.append('ornamentFrameFile', new File([Buffer.from(imageData, 'base64')], 'frame.png', { type: 'image/png' }));
 const webRequest = new Request('http://localhost/api/painting/batch-runs', { method: 'POST', body: form });
 const request = Readable.from([Buffer.from(await webRequest.arrayBuffer())]);
 request.headers = { 'content-type': webRequest.headers.get('content-type'), host: 'localhost' }; request.url = '/api/painting/batch-runs';
 const response = res(); await server.handleCreatePaintingBatchRun(request, response);
 assert.ok([200, 201, 202].includes(response.status), response.body);
 const id = JSON.parse(response.body).batchRunId;
 server.dbUpdatePaintingBatchRun(id, { status: 'paused', controlStatus: 'paused' });
 const run = server.dbGetPaintingBatchRun(id);
 assert.equal(run.options.woodReferences.upper, null);
 assert.equal(Boolean(run.options.ornamentReferences.side), side);
 assert.equal(Boolean(run.options.ornamentReferences.frame), frame);
 for (const reference of Object.values(run.options.ornamentReferences).filter(Boolean)) assert.equal(readFileSync(reference.imagePath).toString('base64'), imageData);
 const specs = server.getPaintingBatchReferenceSpecs({ directionNumber: 34 }, run);
 assert.equal(specs.length, 2 + Number(side) + Number(frame));
 if (side) assert.ok(specs.some(spec => spec.baseName === 'ornament-side'));
 if (frame) assert.ok(specs.some(spec => spec.baseName === 'ornament-frame'));
 await server.submitSeedanceTaskForBatchTask({ directionNumber: 34, prompt, duration: 6 }, run);
 assert.equal(payloads.at(-1).payload.input.media.length, specs.length);
}
const productTypes = ['hanging', 'sticker', 'ornament'];
const markers = { hanging: '【挂画真实尺寸强制锁定】', sticker: '【PVC背胶贴画物理锁定】', ornament: '【固定一体摆件物理锁定】' };
for (const chosen of productTypes) {
 for (const other of productTypes.filter(type => type !== chosen)) {
  const before = payloads.length;
  await assert.rejects(server.generatePaintingIdeasCore({ productType: chosen, profile: { productType: other }, plan: {} }, 'test', 'isolation'), /产品类型参数冲突/);
  await assert.rejects(server.generatePaintingIdeaPromptCore('isolation', 'test', { productType: chosen }, { productType: other }, { productType: chosen }), /产品类型参数冲突/);
  const response = res();
  await server.handleSeedanceCreateTask(req({ model: 'wan3.0-video', productType: chosen, prompt: `${markers[other]}创意内容：静态展示。`, duration: 6, resolution: '480p' }), response);
  assert.equal(response.status, 400, response.body);
  assert.equal(payloads.length, before, 'cross-product conflict must not reach upstream');
  for (const handler of [server.handlePaintingIdeas, server.handlePaintingIdeaPrompt]) {
   const response = res();
   await handler(req({ productType: chosen, profile: { productType: other }, plan: {}, idea: { productType: chosen } }), response, chosen);
   assert.equal(response.status, 400, response.body);
  }
  assert.equal(payloads.length, before, 'API conflict must be rejected before creating a generation task');
 }
 const folder = { id: 100 + productTypes.indexOf(chosen), folderName: `隔离-${chosen}` };
 server.dbUpsertPaintingFolderBinding({ paintingName: '同名产品', imageHash: 'same-product-image', folderId: folder.id, folderName: folder.folderName, productType: chosen });
}
for (const chosen of productTypes) {
 const binding = server.dbGetPaintingFolderBinding('same-product-image', '同名产品', chosen);
 assert.equal(binding.folderName, `隔离-${chosen}`);
 assert.equal(binding.paintingName, '同名产品');
 assert.equal(binding.imageHash, 'same-product-image');
 assert.equal(server.dbGetPaintingFolderBinding('new-image', '同名产品', chosen).folderName, `隔离-${chosen}`);
 assert.equal(server.dbGetPaintingFolderBinding('new-image', '未绑定名称', chosen), null);
 server.dbMarkPaintingDirectionUsed('same-product-image', 0, productTypes.indexOf(chosen) + 1, chosen);
}
for (const chosen of productTypes) assert.deepEqual(server.dbGetPaintingUsedDirections('same-product-image', 0, chosen), [productTypes.indexOf(chosen) + 1]);
const mixedResponse = res(); const beforeMixed = payloads.length;
await server.handleSeedanceCreateTask(req({ model: 'wan3.0-video', prompt: `${markers.ornament}\n${markers.sticker}`, resolution: '480p' }), mixedResponse);
assert.equal(mixedResponse.status, 400); assert.equal(payloads.length, beforeMixed);
console.log('PASS: 40 fixed frameworks, analysis, separate-stand rejection, four batches, all prompts, type isolation, manual/batch submission across six models, three-product routing/usage/folder isolation, paid-request blocking.');
process.exit(0);

import assert from 'node:assert/strict';
import { analyzePainting, generatePaintingIdeas, generatePaintingIdeaPrompt, createPaintingBatchRun, createSeedanceTask, getPaintingUsedDirections, getPaintingProductType, getPaintingProductLabel, type PaintingMaterialPlan } from './src/lib/creative';

const file = new File(['test'], 'product.png', { type: 'image/png' });
const profile = { productType: 'sticker' as const, name: '横幅', widthCm: 180, heightCm: 60 };
const idea = { productType: 'sticker' as const, id: 'sticker-1', directionNumber: 1, title: '讲解', summary: '画旁讲解' };
const plan: PaintingMaterialPlan = { count: 10, durationMin: 5, durationMax: 8, ratio: '9:16', stylePreset: 'modern-minimal', character: '', scene: '', audio: '', extraRequirements: '' };
const calls: { url: string; body: BodyInit | null | undefined }[] = [];
globalThis.fetch = async (url, init: RequestInit = {}) => {
  calls.push({ url: String(url), body: init.body });
  if (String(url).includes('/tasks/ui-task')) return Response.json({ status: 'done', result: { profile, ideas: [idea], batch: 0, totalBatches: 4, prompt: '贴画文案', duration: 6 } });
  return Response.json({ taskId: 'ui-task', batchRunId: 'ui-batch', usedDirections: [1] });
};
assert.equal(getPaintingProductType({ name: '旧记录' }), 'hanging');
assert.equal(getPaintingProductLabel(profile), 'PVC背胶贴画');
assert.equal(getPaintingProductLabel(), '挂画／卷轴');
await analyzePainting(file, 'sticker', 150, 50);
const analysisForm = calls[0].body as FormData;
assert.equal(analysisForm.get('productType'), 'sticker');
assert.equal(analysisForm.get('widthCm'), '150');
assert.equal(analysisForm.get('heightCm'), '50');
await generatePaintingIdeas(profile, plan);
const ideasRequest = JSON.parse(String(calls.find((call) => call.url === '/api/painting/ideas')!.body));
assert.equal(ideasRequest.profile.productType, 'sticker');
await generatePaintingIdeaPrompt(profile, idea, plan);
const promptRequest = JSON.parse(String(calls.find((call) => call.url === '/api/painting/idea-prompt')!.body));
assert.equal(promptRequest.idea.productType, 'sticker');
assert.equal(promptRequest.profile.widthCm, 180);
await createPaintingBatchRun({ file, upperWoodFile: file, lowerWoodFile: file, profile, plan, ideas: [idea], totalDirections: 1, requestedCount: 1, startOrder: 'random', model: 'wan3.0-video', resolution: '480p', ratio: '9:16', variationRound: 0, generateAudio: false, watermark: false, stylePreset: 'modern-minimal', creationRequestId: 'ui-batch-create' });
const batchForm = calls.at(-1)!.body as FormData;
assert.equal(JSON.parse(String(batchForm.get('profile'))).productType, 'sticker');
assert.equal(JSON.parse(String(batchForm.get('ideas')))[0].productType, 'sticker');
assert.equal(batchForm.get('startOrder'), 'random');
assert.equal(batchForm.get('requestedCount'), '1');
assert.equal(batchForm.get('upperWoodFile'), null);
assert.equal(batchForm.get('lowerWoodFile'), null);
for (const withImage of [true, false]) {
  await createSeedanceTask({ productType: 'sticker', model: 'wan3.0-video', prompt: '贴画', resolution: '480p', ratio: '9:16', duration: 6, generateAudio: false, watermark: false, references: withImage ? [{ id: '1', kind: 'image', file, fileName: file.name, previewUrl: '' }] : [] });
  const body = calls.at(-1)!.body;
  assert.equal(withImage ? (body as FormData).get('productType') : JSON.parse(String(body)).productType, 'sticker');
}
await getPaintingUsedDirections('hash', 1, 'sticker');
assert.ok(calls.at(-1)!.url.includes('productType=sticker'));
console.log('前端贴画接口测试通过：旧记录兼容、分析尺寸、方案/提示词类型、批量顺序数量、木条过滤及单条提交。无真实网络调用。');

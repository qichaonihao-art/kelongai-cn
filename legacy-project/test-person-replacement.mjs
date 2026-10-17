import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPersonReplacementService, PERSON_MODELS, PERSON_GENERATION_SUBMIT_TIMEOUT_MS, buildPersonPrompt, validatePersonOptions } from './person-replacement.mjs';

const exec = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), 'person-replacement-test-'));
const db = new DatabaseSync(path.join(root, 'tasks.sqlite'));
// Exercise upgrades from the original shared-history schema as well as fresh jobs.
db.exec('CREATE TABLE person_replacement_jobs (id TEXT PRIMARY KEY, request_id TEXT UNIQUE NOT NULL, data TEXT NOT NULL)');
const source = path.join(root, 'source.mp4');
const silent = path.join(root, 'silent.mp4');
const generated = path.join(root, 'generated.mp4');
await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=red:s=128x128:r=30:d=4.3', '-f', 'lavfi', '-i', 'sine=frequency=440:duration=4.3', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', source]);
await exec('ffmpeg', ['-y', '-i', source, '-an', '-c:v', 'copy', silent]);
await exec('ffmpeg', ['-y', '-f', 'lavfi', '-i', 'color=c=blue:s=128x128:r=30:d=5', '-f', 'lavfi', '-i', 'sine=frequency=880:duration=5', '-c:v', 'libx264', '-pix_fmt', 'yuv420p', '-c:a', 'aac', '-shortest', generated]);
async function inspect(file) {
  const { stdout } = await exec('ffprobe', ['-v', 'error', '-show_streams', '-show_format', '-of', 'json', file]);
  return JSON.parse(stdout);
}
async function probe(file) {
  const result = await inspect(file); const stream = result.streams.find(item => item.codec_type === 'video');
  return { width: stream.width, height: stream.height, fps: 30, durationSeconds: Number(result.format.duration) };
}
const sourceBytes = await readFile(source);
const silentBytes = await readFile(silent);
const generatedBytes = await readFile(generated);
let posts = [], failGeneration = false, ambiguous = false, queryFailure = false, blurFailed = false, dropMaskAudio = false, dropGeneratedAudio = false, earlyCallback = false, throwAfterCallback = false, recoveryTask = null;
const deps = { getDb: () => db, root: path.join(root, 'jobs'), exec, probe,
  getConfig: () => ({ mediaKey: 'fake-media', seedanceKey: 'fake-seedance', mediaBase: 'https://mock-mediakit.test' }),
  fetch: async (url, options = {}) => {
    if (options.method === 'POST') {
      posts.push({ url, body: JSON.parse(options.body) });
      if (url.includes('generations') && earlyCallback) {
        const payload = JSON.parse(options.body); const parts = new URL(payload.callback_url).pathname.split('/');
        service.acceptCallback(parts.at(-2), parts.at(-1), { id: `generate-${posts.length}`, model: payload.model, status: 'running', content: { video_url: 'https://untrusted.test/ignored.mp4' } });
        if (throwAfterCallback) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      }
      if (ambiguous && url.includes('generations')) throw Object.assign(new Error('The operation was aborted due to timeout'), { name: 'TimeoutError' });
      return Response.json(url.includes('face-blur') ? { task_id: `blur-${posts.length}` } : { id: `generate-${posts.length}` });
    }
    if (url.includes('/api/v1/tasks/')) return Response.json(blurFailed ? { status: 'failed', error: { message: 'mock blur failure' } } : { status: 'completed', result: { video_url: 'https://mock.test/masked.mp4' } });
    return new Response(url.includes('masked') ? (dropMaskAudio ? silentBytes : sourceBytes) : (dropGeneratedAudio ? silentBytes : generatedBytes));
  },
  fetchTask: async () => {
    if (recoveryTask) return recoveryTask;
    if (queryFailure) throw new Error('temporary query failure');
    return failGeneration ? { status: 'failed', errorMessage: 'mock generation failure' } : { status: 'succeeded', videoUrl: 'https://mock.test/generated.mp4' };
  },
};
let service = createPersonReplacementService(deps);
const options = (extra = {}) => ({ creationRequestId: crypto.randomUUID(), prompt: '换成穿米色衬衫的成年人，商品和背景不变', model: PERSON_MODELS[0], resolution: '720p', audioMode: 'preserve', files: [new File([sourceBytes], 'clip.mp4', { type: 'video/mp4' })], ...extra });
async function drive(id, target = 'completed') {
  for (let index = 0; index < 12; index++) {
    service.stop(); await service.tick();
    const task = service.get(id);
    if (task.stage === target || task.stage === 'failed' || task.stage === 'awaiting_confirmation') return task;
  }
  assert.fail(`task did not reach ${target}: ${service.get(id).stage}`);
}
try {
  assert.equal(PERSON_GENERATION_SUBMIT_TIMEOUT_MS, 180000);
  assert.throws(() => validatePersonOptions(options({ audioMode: 'bad' })), /声音/);
  assert.throws(() => validatePersonOptions(options({ model: 'wan3.0-video' })), /请选择/);
  assert.throws(() => validatePersonOptions(options({ model: PERSON_MODELS[1], resolution: '480p' })), /支持/);
  // The temporary input mask must be explicitly excluded from fidelity constraints in every mode.
  for (const model of PERSON_MODELS) for (const audioMode of ['preserve', 'rewrite', 'new-voice', 'silent']) for (const hasPortrait of [false, true]) {
    const prompt = buildPersonPrompt({ model, audioMode, hasPortrait, audioVersion: 2, sourceHasAudio: true,
      prompt: '更换人物，其他全部保持原样', dialogue: '把好心情带回家', voiceDescription: '自然女声' });
    assert.ok(prompt.indexOf('临时预处理') < prompt.indexOf('本次人物要求'), 'explain mask purpose before user fidelity wording');
    assert.match(prompt, /明确不适用于原人物脸部打码/);
    assert.match(prompt, /新人物的全部可见面部/);
    assert.match(prompt, /转头、侧脸、移动和说话期间/);
    assert.match(prompt, /不为展示面部而强行转头/);
    assert.match(prompt, /保留真实的手部、头发或道具遮挡/);
    assert.match(prompt, /不复制、保留或重新添加输入视频的人脸马赛克/);
    if (hasPortrait) assert.match(prompt, /图片1决定新人物的面部与外观/);
    else assert.match(prompt, /不尝试识别或还原原人物被遮住的身份/);
  }
  const body = options();
  const [first, duplicate] = await Promise.all([service.create(body, 'https://app.test'), service.create(body, 'https://app.test')]);
  assert.equal(first.id, duplicate.id, 'concurrent duplicate submissions share one durable task');
  let result = await drive(first.id);
  assert.equal(result.stage, 'completed', result.error);
  assert.equal(posts.length, 2, 'one blur POST and one generation POST');
  const request = posts[1].body;
  assert.equal(request.duration, 5, 'fractional source duration is rounded up, not truncated');
  assert.equal(request.generate_audio, true, 'native preservation keeps model audio enabled');
  assert.match(request.callback_url, new RegExp(`/api/person-replacement/callback/${first.id}/[a-z0-9-]+$`));
  assert.match(request.content.find(item => item.type === 'video_url').video_url.url, /masked.mp4$/);
  assert.ok(!JSON.stringify(request).includes('source.mp4'), 'original face video is not sent to generation');
  assert.match(request.content[0].text, /脸部打码不作为新人物的视觉参考/);
  assert.match(request.content[0].text, /清除该打码并生成新脸是本次必须完成的编辑/);

  assert.ok(!JSON.stringify(request).includes('挂画'), 'product rules are not injected');
  const resultFile = (await service.resultFile(first.id)).path;
  let info = await inspect(resultFile);
  assert.ok(info.streams.some(stream => stream.codec_type === 'audio'), 'original audio retained');
  assert.deepEqual(await readFile(resultFile), generatedBytes, 'native model result is saved intact without remux or retiming');
  // Native preservation must retain the model output audio (880 Hz), not overwrite it with source audio (440 Hz).
  const { stdout: pcm } = await exec('ffmpeg', ['-v', 'error', '-i', resultFile, '-map', '0:a:0', '-ac', '1', '-ar', '8000', '-t', '1', '-f', 's16le', '-'], { encoding: 'buffer' });
  let crossings = 0; for (let i = 2; i < pcm.length; i += 2) if (pcm.readInt16LE(i - 2) < 0 && pcm.readInt16LE(i) >= 0) crossings++;
  assert.ok(crossings > 860 && crossings < 900, `expected native 880 Hz model tone, got ${crossings}`);

  const mute = await service.create(options({ audioMode: 'silent' }), 'https://app.test');
  assert.equal((await drive(mute.id)).stage, 'completed');
  info = await inspect((await service.resultFile(mute.id)).path);
  assert.ok(!info.streams.some(stream => stream.codec_type === 'audio'), 'silent output has no audio stream');
  const noAudio = await service.create(options({ files: [new File([silentBytes], 'silent.mp4', { type: 'video/mp4' })] }), 'https://app.test');
  result = await drive(noAudio.id);
  assert.equal(result.stage, 'completed', result.error);
  info = await inspect((await service.resultFile(noAudio.id)).path);
  assert.ok(!info.streams.some(stream => stream.codec_type === 'audio'), 'silent original stays silent');

  const newDialogue = '这是一款适合摆在玄关的小摆台，送给你一份好心情。';
  const generatedVoice = await service.create(options({ audioMode: 'rewrite', dialogue: newDialogue, model: PERSON_MODELS[1], files: [new File([sourceBytes], 'clip.mp4', { type: 'video/mp4' }), new File(['fake portrait'], 'person.png', { type: 'image/png' })] }), 'https://app.test');
  assert.equal((await drive(generatedVoice.id)).stage, 'completed');
  assert.equal(posts.at(-1).body.generate_audio, true);
  assert.equal(posts.at(-1).body.duration, -1, '2.5 edits follow source duration natively');
  assert.equal(posts.at(-1).body.omni_reference_task_type, 'edit');
  const rewritePrompt = posts.at(-1).body.content[0].text;
  assert.match(rewritePrompt, /不复制、保留或重新添加输入视频的人脸马赛克/, '2.5 submitted edit uses the same unmasked-output contract');
  assert.ok(rewritePrompt.includes(newDialogue));
  assert.match(rewritePrompt, /原音色参考/);
  assert.match(rewritePrompt, /不沿用旧台词口型/);
  assert.equal(service.get(generatedVoice.id).dialogue, newDialogue);
  assert.ok(posts.at(-1).body.content.some(item => item.type === 'image_url'));
  assert.match(buildPersonPrompt({ hasPortrait: true, prompt: 'test', audioMode: 'generate' }), /图片1/);

  assert.throws(() => validatePersonOptions(options({ audioMode: 'rewrite', dialogue: '' })), /新台词/);
  await assert.rejects(service.create(options({ audioMode: 'rewrite', dialogue: newDialogue, files: [new File([silentBytes], 'silent.mp4', { type: 'video/mp4' })] }), 'https://app.test'), /没有音轨/);
  const cleanPreserve = validatePersonOptions(options({ audioMode: 'preserve', dialogue: '旧输入不应生效', voiceDescription: '旧音色不应生效' }));
  assert.equal(cleanPreserve.dialogue, '');
  assert.equal(cleanPreserve.voiceDescription, '');
  assert.equal(validatePersonOptions(options({ audioMode: 'rewrite', dialogue: newDialogue, voiceDescription: '新女声不应混入沿用原音色' })).voiceDescription, '');
  assert.throws(() => validatePersonOptions(options({ audioMode: 'new-voice', dialogue: '' })), /新台词/);
  assert.throws(() => validatePersonOptions(options({ audioMode: 'new-voice', dialogue: '你好', voiceDescription: '声'.repeat(501) })), /音色描述/);
  const newVoice = await service.create(options({ audioMode: 'new-voice', dialogue: newDialogue, voiceDescription: '自然亲切的成年女声，普通话', model: PERSON_MODELS[1], files: [new File([silentBytes], 'silent.mp4', { type: 'video/mp4' })] }), 'https://app.test');
  assert.equal((await drive(newVoice.id)).stage, 'completed', 'new voice works even when the original has no audio');
  const newVoicePayload = posts.at(-1).body;
  assert.equal(newVoicePayload.generate_audio, true);
  assert.equal(newVoicePayload.duration, -1);
  assert.equal(newVoicePayload.omni_reference_task_type, 'edit');
  assert.ok(newVoicePayload.content[0].text.includes(newDialogue));
  assert.match(newVoicePayload.content[0].text, /不继承视频1的原人声音色/);
  assert.match(newVoicePayload.content[0].text, /自然亲切的成年女声/);
  assert.match(newVoicePayload.content[0].text, /根据新声音和新台词的实际发音重新同步/);
  assert.equal(service.get(newVoice.id).voiceDescription, '自然亲切的成年女声，普通话');
  assert.deepEqual(await readFile((await service.resultFile(newVoice.id)).path), generatedBytes, 'new voice result is not overwritten by source audio');
  const automaticVoice = buildPersonPrompt({ audioVersion: 2, audioMode: 'new-voice', prompt: '换成女性', dialogue: '你好' });
  assert.match(automaticVoice, /为新人物匹配自然合适的声音/);

  dropMaskAudio = true;
  const maskVoice = await service.create(options(), 'https://app.test');
  await drive(maskVoice.id, 'ready');
  info = await inspect(path.join(root, 'jobs', maskVoice.id, 'masked.mp4'));
  assert.ok(info.streams.some(stream => stream.codec_type === 'audio'), 'missing voice is restored to masked INPUT for native model lip sync');
  dropMaskAudio = false;
  assert.equal((await drive(maskVoice.id)).stage, 'completed');
  dropGeneratedAudio = true;
  const fallback = await service.create(options(), 'https://app.test');
  result = await drive(fallback.id);
  assert.equal(result.stage, 'completed');
  assert.match(result.notice, /原音轨补回/);
  const missingSpeech = await service.create(options({ audioMode: 'rewrite', dialogue: newDialogue }), 'https://app.test');
  result = await drive(missingSpeech.id);
  assert.equal(result.stage, 'failed');
  assert.match(result.error, /不会用旧音轨覆盖新台词/);
  const missingNewVoice = await service.create(options({ audioMode: 'new-voice', dialogue: newDialogue, voiceDescription: '成年女声' }), 'https://app.test');
  result = await drive(missingNewVoice.id);
  assert.equal(result.stage, 'failed');
  assert.match(result.error, /不会用旧音轨覆盖新台词/);
  dropGeneratedAudio = false;
  service.retry(missingNewVoice.id);
  assert.equal((await drive(missingNewVoice.id)).stage, 'completed');
  service.retry(missingSpeech.id);
  assert.equal((await drive(missingSpeech.id)).stage, 'completed', 'a speech-generation failure retries generation, not a failing audio merge');
  const oldJob = await service.create(options(), 'https://app.test');
  const row = db.prepare('SELECT data FROM person_replacement_jobs WHERE id = ?').get(oldJob.id);
  const legacy = JSON.parse(row.data); delete legacy.audioVersion;
  db.prepare('UPDATE person_replacement_jobs SET data = ? WHERE id = ?').run(JSON.stringify(legacy), oldJob.id);
  result = await drive(oldJob.id);
  assert.equal(result.stage, 'completed', result.error);
  assert.equal(posts.at(-1).body.generate_audio, false, 'pre-upgrade jobs retain their original policy');

  failGeneration = true;
  const failed = await service.create(options(), 'https://app.test');
  result = await drive(failed.id);
  assert.equal(result.stage, 'failed');
  const blurPostsBefore = posts.filter(post => post.url.includes('face-blur')).length;
  failGeneration = false;
  service.retry(failed.id); result = await drive(failed.id);
  assert.equal(result.stage, 'completed');
  assert.equal(posts.filter(post => post.url.includes('face-blur')).length, blurPostsBefore, 'retry reuses completed blur');

  const durable = await service.create(options(), 'https://app.test');
  await drive(durable.id, 'generating');
  const before = posts.length;
  service.stop(); service = createPersonReplacementService(deps);
  assert.equal(service.get(durable.id).stage, 'generating', 'refresh/restart recovers durable task');
  queryFailure = true; await service.tick();
  assert.equal(service.get(durable.id).stage, 'generating', 'poll error does not resubmit');
  assert.equal(posts.length, before);
  queryFailure = false;
  assert.equal((await drive(durable.id)).stage, 'completed');
  assert.equal(posts.length, before, 'restart queries existing task without submitting again');

  ambiguous = true;
  const uncertain = await service.create(options(), 'https://app.test');
  result = await drive(uncertain.id);
  assert.equal(result.stage, 'awaiting_confirmation');
  assert.equal(result.canRecover, true);
  assert.match(result.notice, /向Seedance提交请求超时/);
  assert.ok(!result.notice.includes('The operation'));
  assert.equal(result.ambiguous, true);
  assert.equal(result.canRetry, false);
  assert.throws(() => service.retry(uncertain.id), /核对/);
  const ambiguousCount = posts.length;
  await service.tick(); assert.equal(posts.length, ambiguousCount, 'unknown paid submission never repeats automatically');
  const callback = new URL(posts.at(-1).body.callback_url).pathname.split('/');
  assert.throws(() => service.acceptCallback(uncertain.id, 'wrong-token', { id: 'cgt-found', model: PERSON_MODELS[0] }), /无效/);
  assert.throws(() => service.acceptCallback(uncertain.id, callback.at(-1), { id: 'cgt-found', model: PERSON_MODELS[1] }), /模型/);
  ambiguous = false;
  service.stop(); service = createPersonReplacementService(deps);
  assert.equal(service.get(uncertain.id).stage, 'awaiting_confirmation');
  service.acceptCallback(uncertain.id, callback.at(-1), { id: 'cgt-found', model: PERSON_MODELS[0], status: 'succeeded', content: { video_url: 'https://untrusted.test/must-ignore.mp4' } });
  assert.equal(service.get(uncertain.id).stage, 'generating', 'callback only recovers the ID; it does not trust callback output');
  assert.equal((await drive(uncertain.id)).stage, 'completed');
  assert.equal(posts.length, ambiguousCount, 'callback recovers timeout without another paid POST');
  service.acceptCallback(uncertain.id, callback.at(-1), { id: 'cgt-found', model: PERSON_MODELS[0], status: 'running' });
  assert.equal(service.get(uncertain.id).stage, 'completed', 'late duplicate callbacks cannot regress completed work');

  earlyCallback = true; throwAfterCallback = true;
  const raced = await service.create(options(), 'https://app.test');
  result = await drive(raced.id);
  assert.equal(result.stage, 'completed', 'callback arriving before POST timeout keeps the recovered ID');
  earlyCallback = false; throwAfterCallback = false;

  ambiguous = true;
  const manual = await service.create(options(), 'https://app.test');
  result = await drive(manual.id);
  assert.equal(result.stage, 'awaiting_confirmation');
  const manualPosts = posts.length;
  // Reproduce the screenshot's older failed record with no callback registered.
  const manualRow = JSON.parse(db.prepare('SELECT data FROM person_replacement_jobs WHERE id = ?').get(manual.id).data);
  manualRow.stage = 'failed'; manualRow.failedStage = 'submitting_generation'; delete manualRow.callbackToken;
  manualRow.error = 'The operation was aborted due to timeout';
  db.prepare('UPDATE person_replacement_jobs SET data = ? WHERE id = ?').run(JSON.stringify(manualRow), manual.id);
  assert.equal(service.get(manual.id).canRecover, true);
  assert.equal(service.get(manual.id).awaitingNotification, false);
  assert.ok(!service.get(manual.id).error.includes('The operation'));
  recoveryTask = { status: 'succeeded', videoUrl: 'https://mock.test/generated.mp4', createdAt: Math.floor(Date.now() / 1000), payload: { model: PERSON_MODELS[1], resolution: '720p' } };
  await assert.rejects(service.recoverTask(manual.id, 'cgt-manual'), /模型/);
  recoveryTask.payload.model = PERSON_MODELS[0]; recoveryTask.payload.resolution = '480p';
  await assert.rejects(service.recoverTask(manual.id, 'cgt-manual'), /分辨率/);
  recoveryTask.payload.resolution = '720p';
  assert.equal((await service.recoverTask(manual.id, 'cgt-manual')).stage, 'generating');
  ambiguous = false;
  assert.equal((await drive(manual.id)).stage, 'completed');
  assert.equal(posts.length, manualPosts, 'manual recovery makes no paid POST and reuses the completed mask');
  recoveryTask = null;

  const interrupted = await service.create(options(), 'https://app.test');
  await drive(interrupted.id, 'ready');
  const interruptedData = JSON.parse(db.prepare('SELECT data FROM person_replacement_jobs WHERE id = ?').get(interrupted.id).data);
  Object.assign(interruptedData, { stage: 'submitting_generation', callbackToken: 'restart-token' });
  db.prepare('UPDATE person_replacement_jobs SET data = ? WHERE id = ?').run(JSON.stringify(interruptedData), interrupted.id);
  service.stop(); service = createPersonReplacementService(deps);
  const interruptedPosts = posts.length;
  await service.tick();
  assert.equal(service.get(interrupted.id).stage, 'awaiting_confirmation');
  assert.equal(posts.length, interruptedPosts, 'restart while submitting waits rather than submits twice');
  service.acceptCallback(interrupted.id, 'restart-token', { id: 'cgt-after-restart', model: PERSON_MODELS[0] });
  assert.equal((await drive(interrupted.id)).stage, 'completed');
  assert.equal(posts.length, interruptedPosts);

  blurFailed = true;
  const blurFailure = await service.create(options(), 'https://app.test');
  assert.equal((await drive(blurFailure.id)).stage, 'failed');
  blurFailed = false;
  service.retry(blurFailure.id);
  assert.equal((await drive(blurFailure.id)).stage, 'completed');
  assert.ok(service.list().length >= 8);

  // Two devices can submit and continue independently, including after a server restart.
  const deviceA = 'device-a', deviceB = 'device-b';
  const bodyA = options(), bodyB = options();
  const isolatedPosts = posts.length;
  const [taskA, taskB] = await Promise.all([
    service.create(bodyA, 'https://app.test', deviceA),
    service.create(bodyB, 'https://app.test', deviceB),
  ]);
  service.stop();
  assert.deepEqual(service.list(deviceA).map(item => item.id), [taskA.id]);
  assert.deepEqual(service.list(deviceB).map(item => item.id), [taskB.id]);
  assert.equal(service.get(taskA.id, deviceB), null);
  assert.equal(service.byRequest(bodyA.creationRequestId, deviceB), null);
  assert.equal(service.byRequest(bodyA.creationRequestId, deviceA).id, taskA.id);
  assert.throws(() => service.retry(taskA.id, deviceB), /当前设备/);
  await assert.rejects(service.recoverTask(taskA.id, 'cgt-other-device', deviceB), /当前设备/);
  await assert.rejects(service.resultFile(taskA.id, deviceB), /当前设备/);
  await assert.rejects(service.create(bodyA, 'https://app.test', deviceB), /不属于当前设备/);
  assert.equal((await service.create(bodyA, 'https://app.test', deviceA)).id, taskA.id, 'same-device duplicate remains idempotent');
  assert.throws(() => service.list(''), /设备标识/);
  assert.throws(() => service.get(taskA.id, 'bad device'), /设备标识/);
  await assert.rejects(service.create(options(), 'https://app.test', ''), /设备标识/);
  service.stop(); service = createPersonReplacementService(deps);
  assert.equal(service.get(taskA.id, deviceA).stage, 'queued', 'own device resumes its queued task after restart');
  assert.equal((await drive(taskA.id)).stage, 'completed');
  assert.equal((await drive(taskB.id)).stage, 'completed');
  assert.equal(posts.length - isolatedPosts, 4, 'two devices submit exactly one mask and one generation each');
  assert.ok((await service.resultFile(taskA.id, deviceA)).path.endsWith('result.mp4'));
  assert.deepEqual(service.list(deviceA).map(item => item.id), [taskA.id]);
  assert.deepEqual(service.list(deviceB).map(item => item.id), [taskB.id]);
  // Device filtering must happen before LIMIT, even with more than 50 newer records elsewhere.
  const historyData = JSON.parse(db.prepare('SELECT data FROM person_replacement_jobs WHERE id = ?').get(taskB.id).data);
  for (let index = 0; index < 55; index++) {
    const id = `other-device-history-${index}`, requestId = crypto.randomUUID();
    db.prepare('INSERT INTO person_replacement_jobs (id, request_id, data, device_id) VALUES (?, ?, ?, ?)')
      .run(id, requestId, JSON.stringify({ ...historyData, id, requestId }), deviceB);
  }
  assert.deepEqual(service.list(deviceA).map(item => item.id), [taskA.id]);
  assert.equal(service.list(deviceB).length, 50);
  assert.equal(service.get(first.id, deviceA), null, 'unassigned pre-upgrade history is hidden instead of shared');
  assert.equal(service.byRequest(body.creationRequestId, 'legacy-device').id, first.id, 'local pending request ID can reclaim its legacy task');
  assert.equal(service.byRequest(body.creationRequestId, deviceA), null, 'a legacy task is claimed only once');
  assert.equal(service.get(first.id, 'legacy-device').id, first.id);
  assert.equal(posts.length - isolatedPosts, 4, 'history, ownership checks and legacy recovery do not submit paid work');
  // Public media accepts only the per-task capability token and named assets.
  let status;
  await service.media({ headers: {} }, { writeHead: value => { status = value; }, end() {} }, first.id, 'wrong-token', 'source.mp4');
  assert.equal(status, 404);
  await assert.rejects(service.create(options({ files: [new File(['x'], 'bad.avi', { type: 'video/avi' })] }), 'https://app.test'), /MP4/);
  console.log('PASS: person replacement workflow, native audio preservation, rewritten speech, new voice with new dialogue, silent output, legacy audio, duration modes, durable recovery, idempotency, failure retries, ambiguous POST protection, timeout/callback/manual recovery, callback race and replay safety, optional portrait, input-mask/output-face separation, concurrent device isolation, ownership checks, per-device history limits, schema upgrade, legacy recovery, and media access');
} finally { service.stop(); db.close(); await rm(root, { recursive: true, force: true }); }

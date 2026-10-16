import assert from 'node:assert/strict';
import { DatabaseSync } from 'node:sqlite';
import { mkdtemp, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createPersonReplacementService, PERSON_MODELS, buildPersonPrompt, validatePersonOptions } from './person-replacement.mjs';

const exec = promisify(execFile);
const root = await mkdtemp(path.join(tmpdir(), 'person-replacement-test-'));
const db = new DatabaseSync(path.join(root, 'tasks.sqlite'));
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
let posts = [], failGeneration = false, ambiguous = false, queryFailure = false, blurFailed = false, dropMaskAudio = false, dropGeneratedAudio = false;
const deps = { getDb: () => db, root: path.join(root, 'jobs'), exec, probe,
  getConfig: () => ({ mediaKey: 'fake-media', seedanceKey: 'fake-seedance', mediaBase: 'https://mock-mediakit.test' }),
  fetch: async (url, options = {}) => {
    if (options.method === 'POST') {
      posts.push({ url, body: JSON.parse(options.body) });
      if (ambiguous && url.includes('generations')) throw new Error('connection interrupted');
      return Response.json(url.includes('face-blur') ? { task_id: `blur-${posts.length}` } : { id: `generate-${posts.length}` });
    }
    if (url.includes('/api/v1/tasks/')) return Response.json(blurFailed ? { status: 'failed', error: { message: 'mock blur failure' } } : { status: 'completed', result: { video_url: 'https://mock.test/masked.mp4' } });
    return new Response(url.includes('masked') ? (dropMaskAudio ? silentBytes : sourceBytes) : (dropGeneratedAudio ? silentBytes : generatedBytes));
  },
  fetchTask: async () => {
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
    if (task.stage === target || task.stage === 'failed') return task;
  }
  assert.fail(`task did not reach ${target}: ${service.get(id).stage}`);
}
try {
  assert.throws(() => validatePersonOptions(options({ audioMode: 'bad' })), /声音/);
  assert.throws(() => validatePersonOptions(options({ model: 'wan3.0-video' })), /请选择/);
  assert.throws(() => validatePersonOptions(options({ model: PERSON_MODELS[1], resolution: '480p' })), /支持/);
  const body = options();
  const [first, duplicate] = await Promise.all([service.create(body, 'https://app.test'), service.create(body, 'https://app.test')]);
  assert.equal(first.id, duplicate.id, 'concurrent duplicate submissions share one durable task');
  let result = await drive(first.id);
  assert.equal(result.stage, 'completed', result.error);
  assert.equal(posts.length, 2, 'one blur POST and one generation POST');
  const request = posts[1].body;
  assert.equal(request.duration, 5, 'fractional source duration is rounded up, not truncated');
  assert.equal(request.generate_audio, true, 'native preservation keeps model audio enabled');
  assert.match(request.content.find(item => item.type === 'video_url').video_url.url, /masked.mp4$/);
  assert.ok(!JSON.stringify(request).includes('source.mp4'), 'original face video is not sent to generation');
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
  assert.equal(result.ambiguous, true);
  assert.equal(result.canRetry, false);
  assert.throws(() => service.retry(uncertain.id), /核对/);
  const ambiguousCount = posts.length;
  await service.tick(); assert.equal(posts.length, ambiguousCount, 'unknown paid submission never repeats automatically');
  ambiguous = false;

  blurFailed = true;
  const blurFailure = await service.create(options(), 'https://app.test');
  assert.equal((await drive(blurFailure.id)).stage, 'failed');
  blurFailed = false;
  service.retry(blurFailure.id);
  assert.equal((await drive(blurFailure.id)).stage, 'completed');
  assert.ok(service.list().length >= 8);
  // Public media accepts only the per-task capability token and named assets.
  let status;
  await service.media({ headers: {} }, { writeHead: value => { status = value; }, end() {} }, first.id, 'wrong-token', 'source.mp4');
  assert.equal(status, 404);
  await assert.rejects(service.create(options({ files: [new File(['x'], 'bad.avi', { type: 'video/avi' })] }), 'https://app.test'), /MP4/);
  console.log('PASS: person replacement workflow, native audio preservation, rewritten speech, new voice with new dialogue, silent output, legacy audio, duration modes, durable recovery, idempotency, failure retries, ambiguous POST protection, optional portrait and media access');
} finally { service.stop(); db.close(); await rm(root, { recursive: true, force: true }); }

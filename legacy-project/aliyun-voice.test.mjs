import test from 'node:test';
import assert from 'node:assert/strict';
import { ALIYUN_VOICE_MODEL, LEGACY_ALIYUN_VOICE_MODEL, createAliyunVoiceService, normalizeAliyunVoiceBase, parseAliyunVoiceSample, canReuseAliyunShotVoice } from './aliyun-voice.mjs';

const wav = Buffer.alloc(48);
wav.write('RIFF'); wav.write('WAVE', 8);
const audioData = `data:audio/wav;base64,${wav.toString('base64')}`;
const asJson = (value, status = 200) => new Response(JSON.stringify(value), { status });
const createArgs = { apiKey: 'test-key', preferredName: '中文 名称_name-too-long', audioData };
const publicSample = async () => ({ ok: true, url: 'https://platform.example/uploads/sample.wav' });

test('normalizes standard and workspace compatible-mode endpoints', () => {
  assert.equal(normalizeAliyunVoiceBase(), 'https://dashscope.aliyuncs.com/api/v1');
  assert.equal(normalizeAliyunVoiceBase('https://workspace.cn-beijing.maas.aliyuncs.com/compatible-mode/v1/'), 'https://workspace.cn-beijing.maas.aliyuncs.com/api/v1');
  assert.throws(() => normalizeAliyunVoiceBase('https://example.com/api/v1'));
});

test('new enrollment sends the correct action, target, prefix and sample URL', async () => {
  const calls = [];
  const service = createAliyunVoiceService({ publishSample: publicSample, fetchImpl: async (url, options) => {
    calls.push({ url, options });
    return asJson({ output: { voice_id: 'new-voice' }, request_id: 'enroll-request' });
  } });
  const result = await service.create(createArgs);
  assert.equal(calls.length, 1);
  assert.match(calls[0].url, /\/tts\/customization$/);
  const body = JSON.parse(calls[0].options.body);
  assert.equal(body.model, 'voice-enrollment');
  assert.deepEqual(body.input, { action: 'create_voice', target_model: ALIYUN_VOICE_MODEL, prefix: 'nametoolon', url: 'https://platform.example/uploads/sample.wav' });
  assert.equal(calls[0].options.headers.Authorization, 'Bearer test-key');
  assert.equal(result.engineModel, ALIYUN_VOICE_MODEL);
  assert.equal(result.output.voice_id, 'new-voice');
  assert.equal(result.output.voice, 'new-voice');
});

test('local enrollment uploads a private model-bound sample with file last', async () => {
  const calls = [];
  const service = createAliyunVoiceService({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return asJson({ data: { upload_dir: 'private/test', upload_host: 'https://bucket.oss-cn-beijing.aliyuncs.com', policy: 'policy', signature: 'signature', oss_access_key_id: 'upload-only' } });
    if (calls.length === 2) return new Response('', { status: 200 });
    return asJson({ output: { voice_id: 'local-voice' } });
  } });
  await service.create({ ...createArgs, preferredName: '中文' });
  assert.equal(calls.length, 3);
  assert.match(calls[0].url, /getPolicy&model=voice-enrollment$/);
  const form = calls[1].options.body;
  assert.equal([...form.keys()].at(-1), 'file');
  assert.equal(form.get('x-oss-object-acl'), 'private');
  assert.equal(calls[1].options.headers, undefined);
  assert.deepEqual(Buffer.from(await form.get('file').arrayBuffer()), wav);
  const enrolled = JSON.parse(calls[2].options.body);
  assert.match(enrolled.input.url, /^oss:\/\/private\/test\/voice-.*\.wav$/);
  assert.match(enrolled.input.prefix, /^[a-zA-Z0-9]{1,10}$/);
  assert.equal(calls[2].options.headers['X-DashScope-OssResourceResolve'], 'enable');
});

test('validates unsupported and oversized samples before any network call', async () => {
  let calls = 0;
  const service = createAliyunVoiceService({ fetchImpl: async () => { calls++; throw new Error('unexpected request'); } });
  for (const data of ['', 'data:video/mp4;base64,YQ==', `data:audio/wav;base64,${Buffer.alloc(10 * 1024 * 1024 + 1).toString('base64')}`]) {
    await assert.rejects(() => service.create({ ...createArgs, audioData: data }), { statusCode: 400 });
  }
  assert.equal(parseAliyunVoiceSample('data:audio/x-m4a;base64,YQ==').mimeType, 'audio/x-m4a');
  assert.equal(calls, 0);
});

test('failed or uncertain enrollment is never retried or given a fabricated voice ID', async () => {
  for (const outcome of ['timeout', 'missing-id', 'upstream-error']) {
    let calls = 0;
    const service = createAliyunVoiceService({ publishSample: publicSample, fetchImpl: async () => {
      calls++;
      if (outcome === 'timeout') throw new DOMException('timeout', 'TimeoutError');
      return outcome === 'missing-id' ? asJson({ output: {} }) : asJson({ message: 'denied' }, 403);
    } });
    await assert.rejects(() => service.create(createArgs));
    assert.equal(calls, 1);
  }
});

test('synthesis queries readiness, uses the new HTTP protocol and returns WAV bytes', async () => {
  const calls = [];
  const service = createAliyunVoiceService({ fetchImpl: async (url, options) => {
    calls.push({ url, options });
    if (calls.length === 1) return asJson({ output: { status: 'OK', target_model: ALIYUN_VOICE_MODEL } });
    if (calls.length === 2) return asJson({ output: { audio: { url: 'http://result.oss-cn-beijing.aliyuncs.com/audio.wav?signature=test' } } });
    return new Response(wav);
  } });
  assert.deepEqual(await service.synthesize({ apiKey: 'test-key', model: ALIYUN_VOICE_MODEL, voice: 'new-voice', text: '你好' }), wav);
  assert.deepEqual(JSON.parse(calls[0].options.body), { model: 'voice-enrollment', input: { action: 'query_voice', voice_id: 'new-voice' } });
  assert.match(calls[1].url, /\/tts\/SpeechSynthesizer$/);
  assert.deepEqual(JSON.parse(calls[1].options.body), { model: ALIYUN_VOICE_MODEL, input: { text: '你好', voice: 'new-voice', format: 'wav', sample_rate: 24000 } });
  assert.match(calls[2].url, /^https:/);
  assert.equal(calls[2].options.headers, undefined, 'never send the API key to the download host');
});

test('retired voices fail clearly without a paid request or automatic model relabeling', async () => {
  let calls = 0;
  const service = createAliyunVoiceService({ fetchImpl: async () => { calls++; throw new Error('unexpected request'); } });
  for (const model of [LEGACY_ALIYUN_VOICE_MODEL, 'qwen3-tts-vc-realtime-2025-11-27']) {
    await assert.rejects(() => service.synthesize({ apiKey: 'test', model, voice: 'old', text: '你好' }), { statusCode: 410, message: /重新克隆/ });
  }
  assert.equal(calls, 0);
});

test('deploying, undeployed or mismatched voices do not submit paid synthesis', async () => {
  for (const output of [{ status: 'DEPLOYING' }, { status: 'UNDEPLOYED' }, { status: 'OK', target_model: LEGACY_ALIYUN_VOICE_MODEL }]) {
    let calls = 0;
    const service = createAliyunVoiceService({ fetchImpl: async () => { calls++; return asJson({ output }); } });
    await assert.rejects(() => service.synthesize({ apiKey: 'test', model: ALIYUN_VOICE_MODEL, voice: 'new-voice', text: '你好' }));
    assert.equal(calls, 1);
  }
});

test('rejects invalid output and untrusted download URLs without extra synthesis', async () => {
  for (const url of ['http://127.0.0.1/private', 'https://aliyuncs.com.evil.example/audio', 'https://result.aliyuncs.com/audio']) {
    let calls = 0;
    const service = createAliyunVoiceService({ fetchImpl: async () => {
      calls++;
      if (calls === 1) return asJson({ output: { status: 'OK' } });
      if (calls === 2) return asJson({ output: { audio: { url } } });
      return new Response('not wav');
    } });
    await assert.rejects(() => service.synthesize({ apiKey: 'test', model: ALIYUN_VOICE_MODEL, voice: 'new-voice', text: '你好' }));
    assert.equal(calls, url === 'https://result.aliyuncs.com/audio' ? 3 : 2);
  }
});

test('shot voice reuse selects the current model without mutating old archives', () => {
  const old = { fingerprint: 'fingerprint', status: 'ready', engineModel: LEGACY_ALIYUN_VOICE_MODEL, remoteVoiceId: 'old' };
  const current = { ...old, engineModel: ALIYUN_VOICE_MODEL, remoteVoiceId: 'new' };
  const records = [old, current];
  const before = JSON.stringify(records);
  assert.equal(records.find((voice) => canReuseAliyunShotVoice(voice, 'fingerprint')), current);
  assert.equal(canReuseAliyunShotVoice({ ...current, status: 'disabled' }, 'fingerprint'), false);
  assert.equal(canReuseAliyunShotVoice(current, 'other'), false);
  assert.equal(JSON.stringify(records), before);
});

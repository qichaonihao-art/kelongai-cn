import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readdir, copyFile, symlink, mkdir, readFile, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { Readable } from 'node:stream';
import { ALIYUN_VOICE_MODEL, LEGACY_ALIYUN_VOICE_MODEL } from './aliyun-voice.mjs';

test('real route handlers upgrade old clients, preserve both archives and synthesize WAV', async (t) => {
  // Import a copied server with an isolated .env. The real server deliberately
  // overrides process.env from its own .env; never import it against live state.
  const source = path.dirname(fileURLToPath(import.meta.url));
  const sandbox = await mkdtemp(path.join(tmpdir(), 'kelongai-voice-routes-'));
  const state = path.join(sandbox, 'state');
  const previousEnv = { ...process.env };
  const originalFetch = globalThis.fetch;
  t.after(async () => {
    globalThis.fetch = originalFetch;
    for (const key of Object.keys(process.env)) if (!(key in previousEnv)) delete process.env[key];
    Object.assign(process.env, previousEnv);
    await rm(sandbox, { recursive: true, force: true });
  });
  await mkdir(state);
  for (const file of await readdir(source)) {
    if (file.endsWith('.mjs') && !file.endsWith('.test.mjs')) await copyFile(path.join(source, file), path.join(sandbox, file));
  }
  await copyFile(path.join(source, 'package.json'), path.join(sandbox, 'package.json'));
  await symlink(path.join(source, 'node_modules'), path.join(sandbox, 'node_modules'), 'dir');
  await symlink(path.join(source, 'copypilot-api'), path.join(sandbox, 'copypilot-api'), 'dir');
  await writeFile(path.join(sandbox, '.env'), [
    'KELONG_SKIP_LISTEN=1', 'VOICE_CLONE_MOCK_MODE=false', 'ALIYUN_API_KEY=test-key',
    'ALIYUN_VOICE_API_BASE_URL=https://dashscope.aliyuncs.com/api/v1',
    `RUNTIME_STATE_DIR=${state}`, 'PUBLIC_BASE_URL=https://platform.example',
  ].join('\n'));
  const oldPublic = { id: 'old-public', name: '旧常用音色', provider: 'aliyun', providerLabel: '阿里云', remoteVoiceId: 'old-public-remote', engineModel: LEGACY_ALIYUN_VOICE_MODEL, createdBy: '', createdAt: '2026-01-20T00:00:00.000Z' };
  const fingerprint = 'a'.repeat(64);
  const oldShot = { id: 'old-shot', name: '旧镜头音色', fingerprint, sourceName: 'sample.wav', projectName: '', provider: 'aliyun', providerLabel: '阿里云·镜头专用', remoteVoiceId: 'old-shot-remote', engineModel: LEGACY_ALIYUN_VOICE_MODEL, status: 'ready', createdAt: '2026-01-20T00:00:00.000Z', lastUsedAt: '2026-01-20T00:00:00.000Z', useCount: 3 };
  const publicPath = path.join(state, 'voice-archive.json');
  const shotPath = path.join(state, 'local-editor-shot-voices.json');
  await writeFile(publicPath, JSON.stringify({ version: 1, records: [oldPublic] }));
  await writeFile(shotPath, JSON.stringify({ version: 1, records: [oldShot] }));
  const wav = Buffer.alloc(48);
  wav.write('RIFF'); wav.write('WAVE', 8);
  const calls = [];
  let enrolled = 0;
  globalThis.fetch = async (url, options = {}) => {
    calls.push({ url, options });
    if (String(url).endsWith('/customization')) {
      const body = JSON.parse(options.body);
      assert.equal(body.model, 'voice-enrollment');
      if (body.input.action === 'create_voice') {
        assert.equal(body.input.target_model, ALIYUN_VOICE_MODEL);
        assert.match(body.input.url, /^https:\/\/platform.example\/uploads\/.*\.wav$/);
        const uploadedName = path.basename(new URL(body.input.url).pathname);
        assert.deepEqual(await readFile(path.join(sandbox, '.runtime-uploads', uploadedName)), wav);
        enrolled++;
        return Response.json({ output: { voice_id: `new-voice-${enrolled}` } });
      }
      assert.equal(body.input.action, 'query_voice');
      return Response.json({ output: { status: 'OK', target_model: ALIYUN_VOICE_MODEL } });
    }
    if (String(url).endsWith('/SpeechSynthesizer')) {
      assert.equal(JSON.parse(options.body).model, ALIYUN_VOICE_MODEL);
      return Response.json({ output: { audio: { url: 'https://result.aliyuncs.com/audio.wav' } } });
    }
    if (url === 'https://result.aliyuncs.com/audio.wav') {
      assert.equal(options.headers, undefined);
      return new Response(wav);
    }
    throw new Error(`Unexpected network request: ${url}`);
  };
  const { handleAliyunVoiceCreate, handleAliyunTts, handleResolveLocalEditorShotVoice } = await import(pathToFileURL(path.join(sandbox, 'server.mjs')).href);
  async function invoke(handler, body) {
    const req = Readable.from([JSON.stringify(body)]);
    req.headers = { 'content-type': 'application/json', host: 'platform.example', 'x-forwarded-proto': 'https' };
    const result = {};
    const res = { writeHead(status, headers) { result.status = status; result.headers = headers; }, end(value) { result.body = value; } };
    await handler(req, res);
    return result;
  }
  const args = { targetModel: LEGACY_ALIYUN_VOICE_MODEL, preferredName: '新常用音色', audioData: `data:audio/wav;base64,${wav.toString('base64')}` };
  const created = await invoke(handleAliyunVoiceCreate, args);
  assert.equal(created.status, 200, String(created.body));
  assert.equal(JSON.parse(created.body).engineModel, ALIYUN_VOICE_MODEL);
  let archive = JSON.parse(await readFile(publicPath, 'utf8'));
  assert.deepEqual(archive.records[0], oldPublic);
  assert.equal(archive.records[1].engineModel, ALIYUN_VOICE_MODEL);
  assert.equal(archive.records[1].remoteVoiceId, 'new-voice-1');

  const commonBeforeShot = await readFile(publicPath, 'utf8');
  const resolved = await invoke(handleResolveLocalEditorShotVoice, { ...args, fingerprint, sourceName: 'sample.wav' });
  assert.equal(resolved.status, 200, String(resolved.body));
  const newShot = JSON.parse(resolved.body);
  assert.equal(newShot.reused, false);
  assert.equal(newShot.voice.engineModel, ALIYUN_VOICE_MODEL);
  assert.notEqual(newShot.voice.id, oldShot.id);
  const shotArchive = JSON.parse(await readFile(shotPath, 'utf8'));
  assert.deepEqual(shotArchive.records[0], oldShot);
  assert.equal(shotArchive.records.length, 2);
  assert.equal(await readFile(publicPath, 'utf8'), commonBeforeShot, 'shot voices must not enter the shared archive');
  const reused = await invoke(handleResolveLocalEditorShotVoice, { fingerprint });
  assert.equal(JSON.parse(reused.body).reused, true);
  assert.equal(JSON.parse(reused.body).voice.remoteVoiceId, 'new-voice-2');
  assert.equal(enrolled, 2, 'reusing a new voice must not pay for a new clone');

  const generated = await invoke(handleAliyunTts, { model: ALIYUN_VOICE_MODEL, voice: 'new-voice-1', text: '测试新版配音' });
  assert.equal(generated.status, 200, String(generated.body));
  assert.equal(generated.headers['Content-Type'], 'audio/wav');
  assert.deepEqual(generated.body, wav);
  const callsBeforeOldVoice = calls.length;
  const retired = await invoke(handleAliyunTts, { model: LEGACY_ALIYUN_VOICE_MODEL, voice: 'old-public-remote', text: '你好' });
  assert.equal(retired.status, 410);
  assert.match(JSON.parse(retired.body).error, /重新克隆/);
  assert.equal(calls.length, callsBeforeOldVoice);
  archive = JSON.parse(await readFile(publicPath, 'utf8'));
  assert.deepEqual(archive.records[0], oldPublic);
});

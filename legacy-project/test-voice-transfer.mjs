import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import {
  createVoiceTransferService,
  groupSpeakerSegments,
  normalizeVoiceTransferScene,
  parseVoiceTransferRange,
} from './voice-transfer.mjs';
import { ALIYUN_VOICE_MODEL } from './aliyun-voice.mjs';

function makeFakeWavBuffer(bytes = 64) {
  const header = Buffer.alloc(44 + bytes);
  header.write('RIFF', 0, 'ascii');
  header.writeUInt32LE(36 + bytes, 4);
  header.write('WAVE', 8, 'ascii');
  return header;
}

test('parseVoiceTransferRange defaults to 0..15s and validates bounds', () => {
  assert.deepEqual(parseVoiceTransferRange({}, 42.5), { start: 0, end: 15, duration: 15 });
  assert.deepEqual(parseVoiceTransferRange({}, 8.2), { start: 0, end: 8.2, duration: 8.2 });
  assert.deepEqual(parseVoiceTransferRange({ startSeconds: 5, endSeconds: 20 }, 40), { start: 5, end: 20, duration: 15 });
  assert.throws(() => parseVoiceTransferRange({ startSeconds: 10, endSeconds: 10.5 }, 40), /至少需要 1 秒/);
  assert.throws(() => parseVoiceTransferRange({ startSeconds: 0, endSeconds: 35 }, 40), /不能超过 30 秒/);
});

test('normalizeVoiceTransferScene defaults to Narrate and accepts Audio', () => {
  assert.equal(normalizeVoiceTransferScene(undefined), 'Narrate');
  assert.equal(normalizeVoiceTransferScene('Narrate'), 'Narrate');
  assert.equal(normalizeVoiceTransferScene('Audio'), 'Audio');
  assert.equal(normalizeVoiceTransferScene('invalid-scene'), 'Narrate');
});

test('voiceTransferService upload -> separate -> synthesize MP3 with DEPLOYING retry and voice reuse', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'vt-test-'));
  try {
    const fetchCalls = [];
    let pollCount = 0;
    const fakeVocalWav = makeFakeWavBuffer(128);
    const fakeTtsWav = makeFakeWavBuffer(256);

    const exec = async (cmd, args) => {
      if (cmd === 'ffprobe') {
        if (args.includes('stream=codec_type,sample_rate,channels,width,height:format=duration')) {
          return {
            stdout: JSON.stringify({
              streams: [
                { codec_type: 'video', width: 1080, height: 1920 },
                { codec_type: 'audio', sample_rate: '48000', channels: 2 },
              ],
              format: { duration: '28.5' },
            }),
          };
        }
        return { stdout: JSON.stringify({ format: { duration: '12.4' } }) };
      }
      if (cmd === 'ffmpeg') {
        const outPath = args[args.length - 1];
        if (outPath.endsWith('.mp3')) {
          await writeFile(outPath, Buffer.from('ID3fake-mp3-data'));
        } else {
          await writeFile(outPath, fakeVocalWav);
        }
        return { stdout: '', stderr: '' };
      }
      throw new Error(`Unexpected command: ${cmd}`);
    };

    const fetchImpl = async (url, options = {}) => {
      fetchCalls.push({ url: String(url), method: options.method || 'GET', body: options.body });
      if (String(url).endsWith('/api/v1/tools-sync/request-media-upload-url')) {
        return new Response(JSON.stringify({
          success: true,
          result: {
            file_id: 'mediakit://audio-123',
            upload_url: 'https://upload.volces.test/put-audio',
            method: 'PUT',
          },
        }), { status: 200 });
      }
      if (String(url) === 'https://upload.volces.test/put-audio') {
        // Drain stream body if provided
        if (options.body && typeof options.body[Symbol.asyncIterator] === 'function') {
          for await (const _chunk of options.body) {}
        }
        return new Response('', { status: 200 });
      }
      if (String(url).endsWith('/api/v1/tools/separate-voice')) {
        const payload = JSON.parse(String(options.body || '{}'));
        assert.equal(payload.audio_url, 'mediakit://audio-123');
        assert.equal(payload.scene, 'Narrate');
        assert.equal(payload.output_format, 'wav');
        return new Response(JSON.stringify({
          success: true,
          task_id: 'amk-tool-separate-voice-test1',
        }), { status: 200 });
      }
      if (String(url).includes('/api/v1/tasks/amk-tool-separate-voice-test1')) {
        pollCount += 1;
        if (pollCount === 1) {
          return new Response(JSON.stringify({ success: true, status: 'processing' }), { status: 200 });
        }
        return new Response(JSON.stringify({
          success: true,
          status: 'completed',
          result: {
            voice_audio_url: 'https://cdn.volces.test/clean-voice.wav',
            music_audio_url: 'https://cdn.volces.test/music.wav',
            sfx_audio_url: 'https://cdn.volces.test/sfx.wav',
          },
        }), { status: 200 });
      }
      if (String(url) === 'https://cdn.volces.test/clean-voice.wav') {
        return new Response(fakeVocalWav, { status: 200 });
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    };

    let createCalls = 0;
    let synthCalls = 0;
    const aliyunVoiceService = {
      async create({ preferredName, audioData }) {
        createCalls += 1;
        assert.match(preferredName, /^vt[a-f0-9]{8}$/);
        assert.ok(audioData.startsWith('data:audio/wav;base64,'));
        return { output: { voice_id: 'aliyun-temp-voice-001' }, engineModel: ALIYUN_VOICE_MODEL };
      },
      async synthesize({ model, voice, text }) {
        synthCalls += 1;
        assert.equal(model, ALIYUN_VOICE_MODEL);
        assert.equal(voice, 'aliyun-temp-voice-001');
        if (synthCalls === 1) {
          throw Object.assign(new Error('音色正在准备中，请稍后再试，无需重复克隆。'), { statusCode: 409 });
        }
        assert.ok(text.length > 0);
        return fakeTtsWav;
      },
    };

    const mimeMap = new Map();
    const service = createVoiceTransferService({
      uploadTempDir: tempDir,
      exec,
      fetchImpl,
      getConfig: () => ({
        mediaKey: 'test-mediakit-key',
        mediaBase: 'https://mediakit.cn-beijing.volces.com',
        aliyunApiKey: 'test-aliyun-key',
      }),
      aliyunVoiceService,
      ensureTools: async () => {},
      scheduleCleanup: () => {},
      registerMimeType: (name, mime) => mimeMap.set(name, mime),
      unregisterMimeType: (name) => mimeMap.delete(name),
      separatePollIntervalMs: 1,
      voiceDeployPollIntervalMs: 1,
      sleepImpl: async () => {},
    });

    // 1. Upload source video
    const fakeSourceBytes = Buffer.from('fake-video-content');
    const req = Readable.from([fakeSourceBytes]);
    req.headers = {
      'content-length': String(fakeSourceBytes.length),
      'content-type': 'video/mp4',
      'x-file-name': encodeURIComponent('测试口播.mp4'),
    };
    const uploaded = await service.uploadSource(req);
    assert.equal(uploaded.ok, true);
    assert.equal(uploaded.hasVideo, true);
    assert.equal(uploaded.durationSeconds, 28.5);
    assert.equal(uploaded.defaultStartSeconds, 0);
    assert.equal(uploaded.defaultEndSeconds, 15);
    assert.equal(mimeMap.get(`${uploaded.sourceId}_vt_source`), 'video/mp4');

    // 2. Separate vocal (first call hits MediaKit)
    const sep1 = await service.separateVocal({
      sourceId: uploaded.sourceId,
      startSeconds: 0,
      endSeconds: 15,
      scene: 'Narrate',
    });
    assert.equal(sep1.ok, true);
    assert.equal(sep1.cached, false);
    assert.equal(sep1.scene, 'Narrate');
    assert.equal(pollCount, 2);

    // 2b. Same range/scene hits cache without calling MediaKit again
    const sep2 = await service.separateVocal({
      sourceId: uploaded.sourceId,
      startSeconds: 0,
      endSeconds: 15,
      scene: 'Narrate',
    });
    assert.equal(sep2.cached, true);
    assert.equal(sep2.vocalId, sep1.vocalId);

    // 3. Synthesize MP3 (first call creates Aliyun voice + retries DEPLOYING 409)
    const out1 = await service.synthesizeMp3({ vocalId: sep1.vocalId, text: '大家好，欢迎来到今天的分享。' }, {});
    assert.equal(out1.ok, true);
    assert.equal(out1.reusedVoice, false);
    assert.ok(out1.audioUrl.endsWith('.mp3'));
    assert.ok(out1.fileName.endsWith('.mp3'));
    assert.equal(createCalls, 1);
    assert.equal(synthCalls, 2);
    const mp3File = path.join(tempDir, path.basename(out1.audioUrl));
    assert.equal((await readFile(mp3File)).toString(), 'ID3fake-mp3-data');

    // 4. Synthesize again with new text -> reuses temporary Aliyun voice_id
    const out2 = await service.synthesizeMp3({ vocalId: sep1.vocalId, text: '这是修改后的第二段文案。' }, {});
    assert.equal(out2.ok, true);
    assert.equal(out2.reusedVoice, true);
    assert.equal(createCalls, 1);

    // 5. Cleanup removes source & vocal files
    await service.cleanup({ sourceId: uploaded.sourceId, vocalId: sep1.vocalId });
    assert.equal(existsSync(path.join(tempDir, `${uploaded.sourceId}_vt_source`)), false);
    assert.equal(existsSync(path.join(tempDir, `${sep1.vocalId}_vt_vocal.wav`)), false);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

test('groupSpeakerSegments merges close turns and filters tiny blips', () => {
  const speakers = groupSpeakerSegments([
    { speaker_id: 0, begin_time: 0, end_time: 2100, text: '你好，' },
    { speaker_id: 0, begin_time: 2300, end_time: 4500, text: '欢迎光临。' },
    { speaker_id: 1, begin_time: 4800, end_time: 8200, text: '谢谢大家的支持！' },
    { speaker_id: 2, begin_time: 8500, end_time: 8900, text: '嗯' }, // 0.4s blip -> ignored
  ], 15);
  assert.equal(speakers.length, 2);
  assert.equal(speakers[0].speakerId, 0);
  assert.equal(speakers[0].segments.length, 1);
  assert.equal(speakers[0].sampleText, '你好，欢迎光临。');
  assert.equal(speakers[1].speakerId, 1);
  assert.equal(speakers[1].sampleText, '谢谢大家的支持！');
});

test('voiceTransferService reuses _clip_source from online import and splits multi-speaker vocals', async () => {
  const tempDir = await mkdtemp(path.join(tmpdir(), 'vt-multi-'));
  try {
    const clipSourceId = 'abcdef1234567890abcdef12';
    await writeFile(path.join(tempDir, `${clipSourceId}_clip_source`), Buffer.from('online-video-bytes'));
    const fakeVocalWav = makeFakeWavBuffer(128);

    const exec = async (cmd, args) => {
      if (cmd === 'ffprobe') {
        if (args.includes('stream=codec_type,sample_rate,channels,width,height:format=duration')) {
          return {
            stdout: JSON.stringify({
              streams: [
                { codec_type: 'video', width: 1080, height: 1920 },
                { codec_type: 'audio', sample_rate: '48000', channels: 2 },
              ],
              format: { duration: '20.0' },
            }),
          };
        }
        return { stdout: JSON.stringify({ format: { duration: '12.0' } }) };
      }
      if (cmd === 'ffmpeg') {
        const outPath = args[args.length - 1];
        await writeFile(outPath, fakeVocalWav);
        return { stdout: '', stderr: '' };
      }
      throw new Error(`Unexpected command: ${cmd}`);
    };

    const fetchImpl = async (url, options = {}) => {
      if (String(url).endsWith('/api/v1/tools-sync/request-media-upload-url')) {
        return new Response(JSON.stringify({
          success: true,
          result: { file_id: 'mediakit://audio-multi', upload_url: 'https://upload.volces.test/m', method: 'PUT' },
        }), { status: 200 });
      }
      if (String(url) === 'https://upload.volces.test/m') {
        if (options.body && typeof options.body[Symbol.asyncIterator] === 'function') {
          for await (const _chunk of options.body) {}
        }
        return new Response('', { status: 200 });
      }
      if (String(url).endsWith('/api/v1/tools/separate-voice')) {
        return new Response(JSON.stringify({ success: true, task_id: 'task-multi-1' }), { status: 200 });
      }
      if (String(url).includes('/api/v1/tasks/task-multi-1')) {
        return new Response(JSON.stringify({
          success: true,
          status: 'completed',
          result: { voice_audio_url: 'https://cdn.volces.test/multi.wav' },
        }), { status: 200 });
      }
      if (String(url) === 'https://cdn.volces.test/multi.wav') {
        return new Response(fakeVocalWav, { status: 200 });
      }
      throw new Error(`Unexpected URL: ${url}`);
    };

    const service = createVoiceTransferService({
      uploadTempDir: tempDir,
      exec,
      fetchImpl,
      getConfig: () => ({
        mediaKey: 'test-key',
        mediaBase: 'https://mediakit.cn-beijing.volces.com',
        aliyunApiKey: 'test-aliyun',
      }),
      aliyunVoiceService: {},
      diarizeVocal: async () => ([
        { speaker_id: 0, begin_time: 0, end_time: 3500, text: '我是第一位说话人' },
        { speaker_id: 1, begin_time: 4000, end_time: 8500, text: '我是第二位说话人' },
      ]),
      ensureTools: async () => {},
      scheduleCleanup: () => {},
      separatePollIntervalMs: 1,
      sleepImpl: async () => {},
    });

    const sep = await service.separateVocal({
      sourceId: clipSourceId,
      startSeconds: 0,
      endSeconds: 15,
      scene: 'Narrate',
    });

    assert.equal(sep.ok, true);
    assert.equal(sep.requiresSpeakerSelection, true);
    assert.equal(sep.speakers.length, 2);
    assert.equal(sep.speakers[0].label, '音色 1');
    assert.equal(sep.speakers[0].sampleText, '我是第一位说话人');
    assert.equal(sep.speakers[1].label, '音色 2');
    assert.equal(sep.speakers[1].sampleText, '我是第二位说话人');
    assert.notEqual(sep.speakers[0].vocalId, sep.speakers[1].vocalId);
    assert.equal(existsSync(path.join(tempDir, `${sep.speakers[0].vocalId}_vt_vocal.wav`)), true);
    assert.equal(existsSync(path.join(tempDir, `${sep.speakers[1].vocalId}_vt_vocal.wav`)), true);
  } finally {
    await rm(tempDir, { recursive: true, force: true });
  }
});

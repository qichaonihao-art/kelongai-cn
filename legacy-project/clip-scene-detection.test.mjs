import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { createBoundaryClassifier, createClipSceneDetectionService, scanClipBoundaries } from './clip-scene-detection.mjs';

const exec = promisify(execFile);
const thumbnail = (value) => Buffer.alloc(16 * 16 * 3, value);

test('weak abrupt changes are detected, steady motion is not split', () => {
  const cuts = [];
  const classifier = createBoundaryClassifier({ fps: 30, onBoundary: (cut) => cuts.push(cut) });
  for (let n = 0; n < 120; n++) classifier.push({ time: n / 30, score: n === 15 ? 0.12 : 0.004, rgb: thumbnail(n < 15 ? 40 : 80) });
  classifier.finish();
  assert.deepEqual(cuts.map((cut) => cut.cutSeconds), [0.5]);
  const motionCuts = [];
  const motion = createBoundaryClassifier({ fps: 30, onBoundary: (cut) => motionCuts.push(cut) });
  for (let n = 0; n < 100; n++) motion.push({ time: n / 30, score: 0.1, rgb: thumbnail(30 + n) });
  motion.finish();
  assert.deepEqual(motionCuts, []);
});

test('an isolated flash is ignored while a lasting cut after it is detected', () => {
  const cuts = [];
  const classifier = createBoundaryClassifier({ fps: 30, onBoundary: (cut) => cuts.push(cut) });
  for (let n = 0; n < 120; n++) classifier.push({ time: n / 30,
    score: [30, 31, 75].includes(n) ? 0.8 : 0,
    rgb: thumbnail(n === 30 ? 255 : n >= 75 ? 180 : 30) });
  classifier.finish();
  assert.deepEqual(cuts.map((cut) => cut.cutSeconds), [2.5]);
});

test('cache shares concurrent scans and continues near the last boundary', async () => {
  let probes = 0;
  const calls = [];
  const service = createClipSceneDetectionService({
    probe: async () => { probes++; return { durationSeconds: 12, fps: 30 }; },
    getFrameSyncArgs: async () => [],
    scan: async (args) => {
      calls.push(args);
      await new Promise((resolve) => setTimeout(resolve, 5));
      const cutSeconds = args.afterSeconds ? 2.4 : 2;
      return { cutPoints: [{ cutSeconds, endSeconds: cutSeconds - 1 / 60 }], complete: !!args.afterSeconds };
    },
  });
  const request = { sourceId: 'source', sourcePath: '/tmp/source', shotCount: 1 };
  await Promise.all([service.detect(request), service.detect(request)]);
  assert.equal(calls.length, 1);
  const extended = await Promise.all([service.detect({ ...request, shotCount: 2 }), service.detect({ ...request, shotCount: 3 })]);
  assert.equal(calls.length, 2, 'higher-count concurrent requests must share the tail scan');
  assert.equal(calls[1].afterSeconds, 2);
  assert.deepEqual(extended[0].cutPoints.map((cut) => cut.cutSeconds), [2, 2.4]);
  assert.equal(extended[0].scannedToVideoEnd, true);
  await service.detect(request);
  assert.equal(calls.length, 2);
  assert.equal(probes, 1);
  service.forget('source');
  await service.detect(request);
  assert.equal(probes, 2);
});

test('a failed scan can be retried and source caches stay isolated', async () => {
  let attempts = 0;
  const service = createClipSceneDetectionService({ probe: async () => ({ durationSeconds: 90, fps: 30 }), getFrameSyncArgs: async () => [], scan: async () => {
    if (++attempts === 1) throw new Error('bad source');
    return { cutPoints: [], complete: true };
  } });
  const request = { sourceId: 'one', sourcePath: '/tmp/one', shotCount: 1 };
  await assert.rejects(() => service.detect(request), /bad source/);
  assert.equal((await service.detect(request)).scannedToVideoEnd, false, 'scanning 60 seconds must not claim it reached the end of a longer video');
  await service.detect({ ...request, sourceId: 'two' });
  assert.equal(attempts, 3);
});

test('real encoded media: short shots, similar images, flash, motion and VFR continuation', async (t) => {
  const root = await mkdtemp(path.join(tmpdir(), 'kelongai-scene-test-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const frameSyncArgs = ['-fps_mode', 'passthrough'];
  // These fixtures contain known edit points, independently of the detector.
  const cases = [
    { name: 'early', filter: "drawbox=color=white:t=fill:enable='gte(t,0.5)'", expected: [0.5] },
    { name: 'rapid', filter: "drawbox=color=white:t=fill:enable='between(t,2,2.39)'", expected: [2, 2.4] },
    { name: 'weak', filter: "drawbox=color=0x202020:t=fill:enable='gte(t,2)'", expected: [2] },
    { name: 'similar-luma-colors', source: 'color=0x0000ff:s=320x320:r=30:d=4', filter: "drawbox=color=0x4e0000:t=fill:enable='gte(t,2)'", expected: [2] },
    { name: 'flash', filter: "drawbox=color=white:t=fill:enable='eq(n,45)'", expected: [] },
    { name: 'two-frame-flash', filter: "drawbox=color=white:t=fill:enable='between(n,45,46)'", expected: [] },
    { name: 'transition', filter: "drawbox=color=0x202020:t=fill:enable='eq(n,60)',drawbox=color=white:t=fill:enable='gte(n,61)'", expected: [2] },
    { name: 'pan', source: 'testsrc2=s=640x360:r=30:d=4', filter: "crop=320:320:x='70*t':y=20", expected: [] },
    { name: 'zoom', source: 'testsrc2=s=320x320:r=30:d=4', filter: "zoompan=z='1+on*0.001':d=1:s=320x320:fps=30", expected: [] },
    { name: 'vfr', fps: 60, filter: "drawbox=color=white:t=fill:enable='between(t,1.5,1.89)',select='if(lt(t,1),not(mod(n,2)),1)'", expected: [1.5, 1.9] },
    { name: 'nonzero-start', offset: true, filter: "drawbox=color=white:t=fill:enable='between(t,1.5,1.89)'", expected: [1.5, 1.9] },
  ];
  for (const sample of cases) {
    const file = path.join(root, `${sample.name}.mp4`);
    await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', sample.source || `color=black:s=320x320:r=${sample.fps || 30}:d=4`, '-vf', sample.filter,
      ...frameSyncArgs, '-c:v', 'libx264', ...(sample.offset ? ['-output_ts_offset', '5'] : []), file]);
    const result = await scanClipBoundaries({ sourcePath: file, fps: sample.fps || 30, shotCount: 10, scanDuration: 4, frameSyncArgs });
    assert.equal(result.cutPoints.length, sample.expected.length, `${sample.name}: ${JSON.stringify(result)}`);
    for (let n = 0; n < sample.expected.length; n++) assert.ok(Math.abs(result.cutPoints[n].cutSeconds - sample.expected[n]) < 0.00002, `${sample.name}: ${JSON.stringify(result)}`);
    if (sample.expected.length > 1) {
      const tail = await scanClipBoundaries({ sourcePath: file, fps: sample.fps || 30, shotCount: 1, afterSeconds: sample.expected[0], scanDuration: 4, frameSyncArgs });
      assert.ok(Math.abs(tail.cutPoints[0]?.cutSeconds - sample.expected[1]) < 0.00002, `tail scan retained source PTS: ${sample.name}: ${JSON.stringify(tail)}`);
    }
    t.diagnostic(`${sample.name}: ${result.cutPoints.map((cut) => cut.cutSeconds).join(', ') || 'no cut'}`);
  }
});

import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { mkdir, mkdtemp, readFile, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { promisify } from 'node:util';

const exec = promisify(execFile);
process.env.KELONG_SKIP_LISTEN = '1';
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kelongai-clip-boundary-'));
process.env.RUNTIME_STATE_DIR = path.join(temporaryRoot, 'runtime');
process.env.VIDEO_LIBRARY_DIR = path.join(temporaryRoot, 'video-library');
await mkdir(process.env.RUNTIME_STATE_DIR, { recursive: true });
await mkdir(process.env.VIDEO_LIBRARY_DIR, { recursive: true });
const { getClipEndBeforeDetectedCut, parseClipRange, handleClipSourceUpload,
  getFfmpegFrameSyncArgs, handleDetectFirstClipCut, handleClipTrim, handleClipCleanup } = await import('./server.mjs');

async function invoke(handler, data, headers = {}) {
  const req = Readable.from([Buffer.isBuffer(data) ? data : Buffer.from(JSON.stringify(data))]);
  req.headers = { 'content-type': 'application/json', ...headers };
  let status;
  let body;
  await handler(req, { writeHead(code) { status = code; }, end(value) { body = JSON.parse(value); } });
  assert.equal(status, 200, JSON.stringify(body));
  return body;
}
async function pixels(file) {
  const frameSyncArgs = await getFfmpegFrameSyncArgs('passthrough');
  const { stdout } = await exec('ffmpeg', ['-v', 'error', '-i', file, '-vf', 'scale=1:1',
    ...frameSyncArgs, '-pix_fmt', 'rgb24', '-f', 'rawvideo', '-'], { encoding: 'buffer' });
  return stdout;
}
const outputPath = (clip) => path.join(import.meta.dirname, '.runtime-uploads', path.basename(clip.url));

try {
  assert.equal(getClipEndBeforeDetectedCut(4, 30), 3.983);
  assert.equal(getClipEndBeforeDetectedCut(4, 25), 3.98);
  assert.equal(getClipEndBeforeDetectedCut(4, 60), 3.992);
  assert.equal(getClipEndBeforeDetectedCut(4, 0), 3.983);
  assert.equal(getClipEndBeforeDetectedCut(4, 30, 3.99), 3.995, '可变帧率采用真实相邻帧');
  assert.deepEqual(parseClipRange({ startSeconds: 0, endSeconds: 4 }, 10), { start: 0, end: 4, duration: 4 });
  assert.equal(parseClipRange({ startSeconds: 0, endSeconds: 1.000999 }, 10).end, 1.000999);

  // 真实上传→识别→截取→解码末帧，覆盖不同帧率及切点前一帧过渡。
  for (const sample of [
    { name: '25fps', fps: '25', count: 90 },
    { name: '30fps', fps: '30', count: 90 },
    { name: '29.97fps', fps: '30000/1001', count: 90 },
    { name: '60fps', fps: '60', count: 90 },
    { name: '一帧过渡', fps: '30', count: 90, transition: true },
    { name: '可变帧率', fps: '60', count: 90, vfr: true },
  ]) {
    const file = path.join(temporaryRoot, `${sample.name}.mp4`);
    const filters = [
      ...(sample.transition ? [`drawbox=color=0x202020:t=fill:enable='eq(n,${sample.count})'`] : []),
      `drawbox=color=white:t=fill:enable='gte(n,${sample.count + (sample.transition ? 1 : 0)})'`,
      ...(sample.vfr ? ["select='if(lt(n,60),not(mod(n,2)),1)'"] : []),
    ];
    const frameSyncArgs = await getFfmpegFrameSyncArgs('vfr');
    await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', `color=black:s=160x160:r=${sample.fps}:d=5`,
      '-f', 'lavfi', '-i', 'sine=frequency=440:duration=5', '-vf', filters.join(','),
      ...frameSyncArgs, '-c:v', 'libx264', '-c:a', 'aac', file]);
    const data = await readFile(file);
    const source = await invoke(handleClipSourceUpload, data, { 'content-type': 'video/mp4', 'content-length': data.length });
    const outputs = [];
    try {
      const detected = await invoke(handleDetectFirstClipCut, { sourceId: source.sourceId, shotCount: 1 });
      assert.equal(detected.detected, true, sample.name);
      const rate = sample.fps.includes('/') ? 30000 / 1001 : Number(sample.fps);
      assert.ok(Math.abs(detected.shots[0].cutSeconds - sample.count / rate) < 0.00002, `${sample.name}: ${JSON.stringify(detected)}`);
      for (const startSeconds of [0, 0.15]) {
        const clip = await invoke(handleClipTrim, { sourceId: source.sourceId, startSeconds, endSeconds: detected.endSeconds });
        outputs.push(clip);
        const rgb = await pixels(outputPath(clip));
        assert.ok(rgb.length > 0);
        assert.ok([...rgb].every((v) => v <= 5), `${sample.name} start=${startSeconds} 带入了第二镜头或过渡画面，末帧=${[...rgb.subarray(-3)]}`);
        if (startSeconds === 0) assert.equal(rgb.length / 3, sample.count - (sample.vfr ? 30 : 0), `${sample.name}: 应保留上一镜头全部帧`);
      }
      // 手动结束点应能按用户选择跨过切点，不能被自动退帧逻辑强行改写。
      const manual = await invoke(handleClipTrim, { sourceId: source.sourceId, startSeconds: 0, endSeconds: detected.shots[0].cutSeconds + 0.3 });
      outputs.push(manual);
      const manualPixels = await pixels(outputPath(manual));
      assert.ok([...manualPixels.subarray(-3)].every((v) => v >= 245), `${sample.name}: 手动裁切应包含所选第二镜头`);
      console.log(`通过：${sample.name}，末帧无下一镜头，手动范围有效`);
    } finally {
      for (const clip of outputs) await invoke(handleClipCleanup, { outputId: clip.outputId });
      await invoke(handleClipCleanup, { sourceId: source.sourceId });
    }
  }

  const file = path.join(temporaryRoot, 'multiple.mp4');
  await exec('ffmpeg', ['-v', 'error', '-y', '-f', 'lavfi', '-i', 'color=black:s=160x160:r=30:d=6',
    '-vf', "drawbox=color=white:t=fill:enable='between(n,60,119)+gte(n,180)'", '-c:v', 'libx264', file]);
  const data = await readFile(file);
  const source = await invoke(handleClipSourceUpload, data, { 'content-type': 'video/mp4', 'content-length': data.length });
  const outputs = [];
  try {
    for (const shotCount of [1, 2, 3]) {
      const detected = await invoke(handleDetectFirstClipCut, { sourceId: source.sourceId, shotCount });
      const clip = await invoke(handleClipTrim, { sourceId: source.sourceId, startSeconds: 0, endSeconds: detected.endSeconds });
      outputs.push(clip);
      const rgb = await pixels(outputPath(clip));
      assert.equal(rgb.length / 3, shotCount * 60, `前${shotCount}镜头帧数`);
      assert.ok([...rgb.subarray(-3)].every((v) => shotCount === 2 ? v > 245 : v < 5));
      console.log(`通过：前${shotCount}镜头，无音轨视频及视频末尾`);
    }
  } finally {
    for (const clip of outputs) await invoke(handleClipCleanup, { outputId: clip.outputId });
    await invoke(handleClipCleanup, { sourceId: source.sourceId });
  }
} finally {
  await rm(temporaryRoot, { recursive: true, force: true });
}
console.log('镜头边界真实媒体回归测试通过');

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

process.env.KELONG_SKIP_LISTEN = '1';
const temporaryRoot = await mkdtemp(path.join(os.tmpdir(), 'kelongai-clip-boundary-'));
process.env.RUNTIME_STATE_DIR = path.join(temporaryRoot, 'runtime');
process.env.VIDEO_LIBRARY_DIR = path.join(temporaryRoot, 'video-library');
await mkdir(process.env.RUNTIME_STATE_DIR, { recursive: true });
await mkdir(process.env.VIDEO_LIBRARY_DIR, { recursive: true });

const { getClipEndBeforeDetectedCut, parseClipRange } = await import('./server.mjs');

// 检测点 4.000 秒是第二镜头第一帧；30fps 时结束线应退到两帧之间，
// 包含 3.9667 秒附近的第一镜头末帧，同时排除 4.000 秒的新镜头帧。
assert.equal(getClipEndBeforeDetectedCut(4, 30), 3.983);
assert.equal(getClipEndBeforeDetectedCut(4, 25), 3.98);
assert.equal(getClipEndBeforeDetectedCut(4, 60), 3.992);
assert.equal(getClipEndBeforeDetectedCut(4, 0), 3.983, '缺少帧率时按30fps安全回退');

// 手动裁切继续使用用户给出的准确结束时间，不自动回退。
assert.deepEqual(parseClipRange({ startSeconds: 0, endSeconds: 4 }, 10), {
  start: 0,
  end: 4,
  duration: 4,
});

await rm(temporaryRoot, { recursive: true, force: true });
console.log('镜头截取边界测试通过：自动切点排除下一镜头首帧，手动结束线保持原值。');

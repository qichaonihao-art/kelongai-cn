import assert from 'node:assert/strict';
import { test } from 'node:test';
import { createMediaProcessExecutor } from './media-process-queue.mjs';

test('mixed media work shares one slot; failures release it; network work bypasses it', async () => {
  let active = 0;
  let peak = 0;
  const calls = [];
  let finish;
  const executor = createMediaProcessExecutor(async (file, args, options) => {
    calls.push({ file, args, options });
    if (file !== 'ffmpeg') return 'network';
    peak = Math.max(peak, ++active);
    try {
      if (calls.length === 1) await new Promise(resolve => { finish = resolve; });
      if (args.includes('bad.mp4')) throw new Error('failed encode');
      return 'done';
    } finally { active--; }
  });
  const options = { timeout: 1000 };
  const first = executor('ffmpeg', ['-i', 'enhanced.mp4', '-crf', '17', '1080p.mp4'], options);
  await new Promise(resolve => setImmediate(resolve));
  const failed = executor('ffmpeg', ['-i', 'bad.mp4', 'preview.mp4']);
  const failureCheck = assert.rejects(failed, /failed encode/);
  const last = executor('ffmpeg', ['-i', 'video.mp4', '-frames:v', '1', 'thumbnail.jpg']);
  assert.equal(await executor('curl', ['url']), 'network');
  assert.equal(calls.filter(c => c.file === 'ffmpeg').length, 1);
  finish();
  await Promise.all([first, failureCheck, last]);
  assert.equal(peak, 1);
  assert.equal(calls[0].options, options);
  assert.deepEqual(calls[0].args, ['-filter_threads', '1', '-filter_complex_threads', '1', '-threads', '1', '-i', 'enhanced.mp4', '-crf', '17', '-threads', '1', '1080p.mp4']);
});

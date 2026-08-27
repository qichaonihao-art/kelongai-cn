import assert from 'node:assert/strict';

process.env.KELONG_SKIP_LISTEN = '1';

const {
  parseFpsFraction,
  isVideo480pOrLower,
  extractEnhancementOutputUrl,
  normalizeEnhancementRemoteStatus,
} = await import('./server.mjs');

assert.equal(parseFpsFraction('30000/1001'), 29.97);
assert.equal(parseFpsFraction('25/1'), 25);
assert.equal(isVideo480pOrLower({ width: 480, height: 854 }), true);
assert.equal(isVideo480pOrLower({ width: 720, height: 1280 }), false);
assert.equal(normalizeEnhancementRemoteStatus({ data: { status: 'COMPLETED' } }), 'completed');
assert.equal(
  extractEnhancementOutputUrl({ result: { outputs: [{ video_url: 'https://example.com/enhanced.mp4' }] } }),
  'https://example.com/enhanced.mp4',
);

console.log('视频画质增强 — 无费测试通过');

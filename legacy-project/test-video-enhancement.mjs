import assert from 'node:assert/strict';

process.env.KELONG_SKIP_LISTEN = '1';

const {
  parseFpsFraction,
  isVideo480pOrLower,
  extractEnhancementOutputUrl,
  normalizeEnhancementRemoteStatus,
  normalizeMediaKitUploadHeaders,
} = await import('./server.mjs');

assert.equal(parseFpsFraction('30000/1001'), 29.97);
assert.equal(parseFpsFraction('25/1'), 25);
assert.equal(isVideo480pOrLower({ width: 480, height: 854 }), true);
assert.equal(isVideo480pOrLower({ width: 496, height: 864 }), true);
assert.equal(isVideo480pOrLower({ width: 540, height: 960 }), false);
assert.equal(isVideo480pOrLower({ width: 720, height: 1280 }), false);
assert.equal(normalizeEnhancementRemoteStatus({ data: { status: 'COMPLETED' } }), 'completed');
assert.equal(
  extractEnhancementOutputUrl({ result: { outputs: [{ video_url: 'https://example.com/enhanced.mp4' }] } }),
  'https://example.com/enhanced.mp4',
);
assert.deepEqual(
  normalizeMediaKitUploadHeaders({ 'x-upload-token': 'abc', 'x-number': 123 }),
  { 'x-upload-token': 'abc', 'x-number': '123' },
);
assert.deepEqual(
  normalizeMediaKitUploadHeaders([
    { key: 'x-upload-token', value: 'abc' },
    { name: 'x-request-id', value: 'request-1' },
  ]),
  { 'x-upload-token': 'abc', 'x-request-id': 'request-1' },
);

console.log('视频画质增强 — 无费测试通过');

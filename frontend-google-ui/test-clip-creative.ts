import assert from 'node:assert/strict';
import { resolveClipProductType } from './src/lib/clipCreative';

for (const type of ['hanging', 'sticker', 'ornament', 'generic'] as const) {
  assert.equal(resolveClipProductType(type, 'replace'), type);
  assert.equal(resolveClipProductType(type, 'direct'), 'generic', '直接反推忽略旧交接数据里的产品类型');
}
assert.equal(resolveClipProductType(undefined, 'direct'), 'generic');
assert.equal(resolveClipProductType(undefined, 'replace'), 'hanging');
assert.equal(resolveClipProductType('invalid', 'direct'), 'generic');
console.log('通过：元素替换保留产品交接，直接反推忽略产品类型，旧调用兼容。');

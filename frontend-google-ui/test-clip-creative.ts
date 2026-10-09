import assert from 'node:assert/strict';
import { directProductContext, resolveClipProductType } from './src/lib/clipCreative';
import { replacementProductRules } from './src/lib/productReplacement';

for (const productType of ['hanging', 'sticker', 'ornament', 'generic'] as const) {
  for (const mode of ['direct', 'replace'] as const) assert.equal(resolveClipProductType(productType, mode), productType);
}
// 旧调用无产品信息仍能进入创作，直接反推不默认为挂画。
assert.equal(resolveClipProductType(undefined, 'direct'), 'generic');
assert.equal(resolveClipProductType(undefined, 'replace'), 'hanging');
assert.equal(resolveClipProductType('invalid', 'direct'), 'generic');
assert.equal(directProductContext('generic'), '');
// 直接反推没有换款时不能强加本款摆台结构或替换校验。
const ornament = directProductContext('ornament');
assert.ok(ornament.includes('固定一体摆台'));
assert.ok(ornament.includes('仍以原片为准'));
assert.ok(!ornament.includes('【产品元素替换：'));
assert.ok(!ornament.includes('【替换动作兼容性：'));
assert.ok(!ornament.includes('金色矩形铝合金边框'));
assert.ok(replacementProductRules('ornament').includes('金色矩形铝合金边框'));
assert.ok(!directProductContext('sticker').includes('固定一体摆台'));
assert.ok(!directProductContext('hanging').includes('【产品元素替换：'));
console.log('通过：剪裁产品交接及旧调用兼容，直接反推与元素替换规则隔离。');

import assert from 'node:assert/strict';
import { replacementProductRules, wrapReplacementPrompt } from './src/lib/productReplacement';
for (const type of ['hanging', 'sticker', 'ornament'] as const) {
  assert.ok(replacementProductRules(type).includes(`【产品元素替换：${type}】`));
  assert.match(replacementProductRules(type), /不兼容/);
  assert.throws(() => wrapReplacementPrompt('未经确认的提示词', type));
  assert.throws(() => wrapReplacementPrompt('【替换动作兼容性：不兼容】卷轴展开', type));
  assert.ok(wrapReplacementPrompt('【替换动作兼容性：兼容】同类产品换款', type).startsWith(`【产品元素替换：${type}】`));
}
assert.throws(() => wrapReplacementPrompt('【产品元素替换：hanging】【替换动作兼容性：兼容】', 'ornament'), /产品类型/);
assert.equal(wrapReplacementPrompt('书架替换', 'generic'), '书架替换');
assert.match(replacementProductRules('ornament'), /铝合金.*木质背板.*后撑杆/s);
assert.match(replacementProductRules('sticker'), /PVC.*无实体边框/s);
console.log('产品替换规则、通用模式、兼容性确认测试通过。');

import { ORNAMENT_STRUCTURE_RULE, inspectOrnamentPromptIssues } from './ornament-creative.mjs';
export function replacementProductFromPrompt(prompt) {
  const matches = [...String(prompt || '').matchAll(/【产品元素替换：([^】]+)】/g)].map(match => match[1]);
  if (!matches.length) return null;
  if (new Set(matches).size !== 1 || !['hanging', 'sticker', 'ornament', 'generic'].includes(matches[0])) throw Object.assign(new Error('元素替换产品标记冲突或无效'), { statusCode: 400 });
  return matches[0];
}
export function validateReplacementPrompt(prompt, type) {
  if (!type || type === 'generic') return [];
  const text = String(prompt || '');
  const issues = [];
  if (!text.includes('【替换动作兼容性：兼容】') || text.includes('【替换动作兼容性：不兼容】')) issues.push('未确认原视频动作与目标产品兼容');
  if (/【(?:固定一体摆件物理锁定|PVC背胶贴画物理锁定|挂画真实尺寸强制锁定|挂画生成尺寸补偿锁定)】/.test(text)) issues.push('元素替换混入AI素材固定方向或尺寸规则');
  if (type === 'ornament') issues.push(...inspectOrnamentPromptIssues(text));
  if (type === 'sticker') {
    const clauses = text.split(/[。；;，,\n]/).filter(clause => !/(禁止|不得|不能|不使用|不新增|无实体|没有|不是)/.test(clause));
    for (const clause of clauses) {
      if (/(?:贴画|墙贴|产品).{0,12}(?:配有|具有|采用|使用|带有|安装)(?:实体边框|实木边框|木条|挂绳|支架)|(?:实木|金属|实体)边框.{0,8}(?:贴画|墙贴)|卷轴展开/.test(clause)) issues.push('贴画替换混入挂画或摆件结构动作');
    }
  }
  return [...new Set(issues)];
}
export function replacementStructureRule(type) {
  if (type === 'ornament') return ORNAMENT_STRUCTURE_RULE;
  if (type === 'sticker') return '【贴画替换结构锁定】正面是哑光PVC柔性平面印刷膜，印刷边线不是实体边框，无木条、挂绳或支架。保留原视频实际安装或已贴好状态，不添加原视频没有的揭背膜动作。尺寸不猜测。';
  return '【挂画替换结构锁定】木条、挂绳、悬挂或卷轴结构按当前原视频和参考图可见信息执行，不增加轴头，不套用AI生成素材的尺寸或固定动作。';
}

import { ornamentSizeRule, readOrnamentSizeFromPrompt } from './ornament-size.mjs';
import { readReplacementCompatibility } from './replacement-compatibility.mjs';
import { ORNAMENT_STRUCTURE_RULE } from './ornament-creative.mjs';
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
  const compatibility = readReplacementCompatibility(text);
  if (compatibility === 'incompatible') issues.push('分析明确指出原视频动作与目标产品不兼容');
  if (compatibility === 'uncertain') issues.push('分析明确表示无法确认原视频动作与目标产品兼容');
  if (/【(?:固定一体摆件物理锁定|PVC背胶贴画物理锁定|挂画真实尺寸强制锁定|挂画生成尺寸补偿锁定)】/.test(text)) issues.push('元素替换混入AI素材固定方向或尺寸规则');
  // 元素替换保留原片人物、道具和背景，关键词无法判定材质属于哪件物体。
  // 产品结构由参考图、分析规则及提交时追加的物理锁约束，不用正文正则硬拦截。
  return [...new Set(issues)];
}
export function replacementStructureRule(type, prompt = '') {
  if (type === 'ornament') return `${ORNAMENT_STRUCTURE_RULE}\n${ornamentSizeRule(readOrnamentSizeFromPrompt(prompt))}`;
  if (type === 'sticker') return '【贴画替换结构锁定】正面是哑光PVC柔性平面印刷膜，印刷边线不是实体边框，无木条、挂绳或支架。保留原视频实际安装或已贴好状态，不添加原视频没有的揭背膜动作。尺寸不猜测。';
  return '【挂画替换结构锁定】木条、挂绳、悬挂或卷轴结构按当前原视频和参考图可见信息执行，不增加轴头，不套用AI生成素材的尺寸或固定动作。';
}

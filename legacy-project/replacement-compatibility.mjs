// 模型格式标记是辅助信息，缺失不等于动作不兼容；显式否定优先于肯定。
export function readReplacementCompatibility(prompt) {
  const text = String(prompt || '').replace(/[*`_]/g, '');
  const statuses = [...text.matchAll(/替换动作兼容性\s*[:：]\s*(不兼容|无法确认|未确认|不确定|兼容)/g)].map(match => match[1]);
  const explicitRefusal = /(?:^|\n)\s*(?:结论\s*[:：]\s*)?(?:原视频(?:中的)?(?:动作|目标|产品)[^。；\n]{0,50}(?:不兼容|无法替换|不能替换)|无法完成(?:本次)?(?:产品|元素)?替换)/.test(text);
  if (statuses.includes('不兼容') || explicitRefusal) return 'incompatible';
  if (statuses.some(status => ['无法确认', '未确认', '不确定'].includes(status))) return 'uncertain';
  return statuses.includes('兼容') ? 'compatible' : 'missing';
}

// 用户确认的外框宽、高；不推断后撑杆长度或边框厚度。
export function normalizeOrnamentSize(size = {}) {
  const widthCm = Number(size.widthCm ?? 20);
  const heightCm = Number(size.heightCm ?? 20);
  if (![widthCm, heightCm].every(value => Number.isFinite(value) && value > 0 && value <= 500)) throw new Error('摆台宽、高请填写大于0且不超过500的厘米数。');
  return { widthCm, heightCm };
}
export function ornamentSizeRule(size = {}) {
  const { widthCm, heightCm } = normalizeOrnamentSize(size);
  return `【摆台真实尺寸】外框宽${widthCm}厘米、高${heightCm}厘米。此尺寸指完整外框，不是图案尺寸或后撑杆长度。按照真实尺寸呈现摆台与正常成人双手、身体、桌柜的比例，不放大为巨型摆件，不缩小人物或家具。实物尺寸优先于原片目标尺寸及构图占比建议；通过合理取景表现景别，不改变产品尺寸。未知厚度和后撑杆长度不猜测。【/摆台真实尺寸】`;
}
export function readOrnamentSizeFromPrompt(prompt) {
  const match = String(prompt || '').match(/【摆台真实尺寸】外框宽([\d.]+)厘米、高([\d.]+)厘米/);
  return match ? normalizeOrnamentSize({ widthCm: match[1], heightCm: match[2] }) : undefined;
}
export function withOrnamentSizePrompt(prompt, size) {
  const clean = String(prompt || '').replace(/【摆台真实尺寸】[\s\S]*?【\/摆台真实尺寸】/g, '').trim();
  return `${ornamentSizeRule(size)}\n${clean}`;
}

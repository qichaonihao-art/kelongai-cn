import { normalizeOrnamentSize, ornamentSizeRule } from './ornament-size.mjs';
// 固定一体摆台：以32、33号马到成功镜头为主要动作参考。
export const ORNAMENT_RED_CLOTH_DIRECTION = 29;
export const ORNAMENT_STRUCTURE_VERSION = 'aluminum-wood-rear-rod-v1';
export const ORNAMENT_STRUCTURE_RULE = '【摆台公共结构与材质锁定】用户已确认所有款式共用同一物理结构，只有正面图案样式变化。四周是金色外观的矩形铝合金边框，四边直线、四角斜接；边框不是实木、塑料或印刷假边线。后面是木质背板，背板不是金属板、玻璃或PVC软膜。背部靠近下边中央连接一根细金属支撑杆，杆端向后落在台面，与框体下边沿共同支撑摆台，形成稳定的轻微后倾；不是两只前置盘架脚、三脚架、大底座或独立托架。支撑杆与主体连接，视频中保持使用角度，不拔出、不拆装、不折叠、不伸缩；固定连接不等于整件由一块材料铸成。正面人物、金元宝、花纹和立体光影全部属于平面图案，不能生成真实浮雕、立体佛像、独立金币或会动的实物；正面覆层的具体材质未确认，不编造玻璃、亚克力、树脂或宣纸。正面图案和题字以本次上传图为准，公共背面参考仅决定木背板、边框和后撑杆，不复制其中桌面、背景或另一款正面图案。未知厘米尺寸、边框厚度和连接机构不猜测。';
export const ORNAMENT_MARKER = '【固定一体摆件物理锁定】';
export const isOrnamentProduct = (profile) => profile?.productType === 'ornament';
export function normalizeOrnamentProfile(profile = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('缺少有效摆件档案');
  if (profile.supportStructure === 'separate') throw new Error('当前摆件仅支持摆台与支架固定一体；分离式托架请勿使用此框架');
  return { ...profile, ...normalizeOrnamentSize(profile), productType: 'ornament', supportStructure: 'fixed', structureVersion: ORNAMENT_STRUCTURE_VERSION, outline: '四边直线、四角斜接的矩形框体', frameMaterial: '铝合金', frameColor: '金色', backboardMaterial: '木板', frontSurface: '平面图案，覆层具体材质未确认', material: '四周铝合金边框、木质背板、背部细金属支撑杆；正面覆层具体材质未确认', frameStructure: '金色矩形铝合金边框，四角斜接；木背板；背部下边中央连接一根向后落台的细金属支撑杆，框体下沿与后撑杆共同支撑，使用时轻微后倾', texture: '正面为平面图案，立体光影仅为图像表现；铝合金边框允许自然金属微高光，背面保留木板纹理' };
}
const entries = [
  ["玄关走近整体落台", "人物从玄关门旁双手托扶整件摆台，正常步速走两三步到玄关柜前，整体落台，站稳后撤手并自然站回柜旁。"],
  ["客厅侧行放边柜", "人物双手持完整摆台，从客厅一侧走到边柜前放稳，双手离开后侧身让出产品；镜头固定，保留行走空间。"],
  ["书房走到书桌摆放", "人物双手承托整件摆台，从书架旁走到书桌前，轻放在预留空位，站稳撤手；人物与书桌完整留在构图中。"],
  ["茶室绕桌放摆台", "人物手持整件摆台沿茶桌侧方走两步，到干燥空位整体落稳，撤手后站在桌旁；产品不越过茶杯或壶口。"],
  ["餐边柜走近陈列", "人物从餐厅过道双手托住摆台，走近餐边柜放稳，收手并退半步欣赏，完整保留人与柜面的空间关系。"],
  ["办公桌前整体摆放", "人物双手托扶摆台走到办公桌侧方，将整件放到空位，确认支撑稳定后松手；不只拍手臂与桌面。"],
  ["沙发旁起身放摆台", "人物先坐在沙发上双手托扶摆台，正常起身后走一步到旁侧柜面放稳，撤手，镜头保留从起身到落台的完整身体动作。"],
  ["展厅柜前拿起再摆放", "人物站在宽陈列柜旁，双手将站稳的整件摆台托起，侧移一步放到同柜另一空位，站稳后撤手；全过程一镜到底。"],
  ["窗边走近放置", "人物双手托住整件摆台从室内走向窗边柜，在预留空位放稳，收手后侧站欣赏；人物不走出构图。"],
  ["接待区柜面换位", "人物站在接待区柜前，双手整体托起摆台，侧身走一步到同一柜面另一位置落稳，撤手；完整呈现重心与步伐。"],
  ["长桌侧行放到空位", "人物双手托扶整件摆台沿长桌一侧正常走两步，放到干燥空位，站稳后撤手；桌边和人物脚步持续可见。"],
  ["走近书架低格陈列", "人物手持整件摆台走到腰高且空间充足的开放书架格前，将整件放稳后撤手；不踮脚、不挤入过小格子。"],
  ["胸前双手正面展示", "人物双手承托完整摆台，在胸前偏下保持正面朝向镜头，自然看向产品再看向镜头；不把摆台向镜头前送。"],
  ["手持三分之四转正", "人物双手托住底部与侧边，将整件从三分之四侧面缓慢转回正面；主体与后撑杆同步，脸与双手保持可见。"],
  ["坐姿托扶展示", "人物坐在桌旁，双手托扶完整摆台在胸前偏下，轻微调整到正对镜头并停稳；保留人物面部、双手和桌沿。"],
  ["坐姿整体落台", "人物坐在桌前双手持摆台，将整件轻放在面前空位，后撑杆和框体下沿落稳后松手；不切成手部特写。"],
  ["桌旁指示正面图案", "人物站在已摆好摆台的侧方，用空手悬空指示真实主图后收手，自然看向镜头；摆台不移动，不推近主图局部。"],
  ["桌旁轻转整体正面", "人物在柜旁双手扶稳整件摆台，整体小角度转正，确认支撑落稳后撤手；脸、双手与完整摆台保持同框。"],
  ["人物侧让完整展示", "人物站在摆台侧方，轻摊手示意产品后向旁侧让半步；人物面部仍入镜，不让镜头追着产品推近。"],
  ["双人桌旁欣赏", "两位人物站在摆台两侧，一人空手指示正面后收回，另一人自然点头；两人的脸与完整摆台保持同框，不搬拆产品。"],
  ["归家放钥匙看摆台", "摆台预先站在玄关柜，人物归家在另一空位放下钥匙，看向摆台后侧站；保留门、柜面和人物全身。"],
  ["书房落笔欣赏", "摆台固定站在书桌一侧，人物在另一侧书写后将笔放好并看向摆台；宣纸和文房工具不遮住产品。"],
  ["茶室斟茶衬景", "摆台预先站在茶桌干燥侧后方，人物给一只杯子斟茶后收手；保留茶桌、座椅、人物与房间环境，不横移到产品特写。"],
  ["阅读合书看摆台", "人物坐在书桌旁合上一本书后抬眼看向侧方摆台；书、摆台与人物位置稳定，保留书桌、书架和室内空间。"],
  ["客厅整理靠垫衬景", "摆台已站在客厅边柜，人物在旁侧沙发上轻整理一个靠垫后坐好；柜面产品始终存在，沙发与柜面同时可见。"],
  ["餐厅整理花瓶衬景", "摆台预先站在餐边柜，人物轻调整旁侧花瓶后撤手退半步；保留餐桌、柜面与人物，花枝不遮住产品。"],
  ["窗边拉帘欣赏", "摆台已站在窗边柜，人物轻拉旁侧窗帘后回身欣赏；保留窗、柜面与完整人物，自然光不改变产品颜色。"],
  ["办公室合本休息", "摆台站在办公桌空位，人物合上笔记本后自然靠回椅背；保留桌椅、书架与房间空间，不把镜头移近产品。"],
  ['红布揭幕展示', '开场摆台已经站稳在台面，正面主图由一块不透明红布遮盖；一只手抓住红布上角，向上并向侧方连续揭开，真实布料逐渐露出完整摆台；红布最后被手持带到主体侧外，摆台与固定支架全程原位不动，完整正面清楚展示，镜头仅轻推。可换玄关柜、书桌、茶台或陈列柜等场景，红布与揭幕动作保持不变。'],
  ["正面整体短横移", "无人场景，摆台始终站稳，摄影机从左向右小幅横移，完整边框和台面边界保持入镜，不移向图案局部。"],
  ["三分之四整体弧移", "无人场景，摄影机在摆台正面一侧小于30度微弧移，保持整件外轮廓与台面同框；产品不旋转，不绕到背面。"],
  ["柜面环境整体陈列", "无人场景，柜面摆台与旁侧少量陈设持续同框，摄影机缓慢短横移，保留摆台周围留白，不推近局部。"],
  ["花枝旁侧整体揭示", "无人场景，花枝仅挡少量外沿，摄影机小幅侧移完整露出摆台；产品从首帧存在，结尾仍保留全部边框与台面。"],
  ["略高机位整体轻落", "无人场景，摄影机从略高三分之四机位小幅下降到近乎正面，完整摆台始终入镜，不裁切边框、不钻入图案局部。"],
  ["铝合金框斜接角", "近景展示一个真实铝合金边框斜接角，镜头沿短段直线边框移到相邻正面图案；接缝与框线稳定，不改变材质和形状。"],
  ["木背板与后撑杆", "从侧后方中近景展示木质背板、背部下边中央连接的单根细金属后撑杆和杆端落台，轻微侧移；只按公共背面参考确定结构，不拆装、不折叠。"],
  ["主纹样近景巡游", "仅沿本款正面真实主图做一次短距离连续移动，保留色彩、笔触与平面图像光影；图案不变成真实浮雕或会动的实物。"],
  ["题字与落款阅读", "近乎正面沿真实题字短距离横移到可见落款，没有落款则结束在题字；逐帧文字不改字，不补写宣传词。"],
  ["真实侧沿厚度", "在正面一侧小角度近景展示参考图可见的实体侧沿，短移到相邻主图；未知厚度不猜厘米、不夸大。"],
  ["平面表面侧光纹理", "近乎正面以小幅摄影机侧移展示本款真实图面纹理；保持平面印刷属性，只有参考确认的光泽才出现自然微反射。"],
 ];
const shotGroups = [
  { end: 12, group: '人物全景搬放', shotRule: '全程采用人物全景：人物从头到脚、双手、完整摆台、柜面与脚下地面同时入镜，人物高度约占画面70%-85%，摆台高度约占画面12%-20%。保留起步、行走、落台和撤手的完整过程；固定机位或为保留全身做克制跟随，全程不推近，不切特写，不截成只见手和摆台的画面。占比是构图参考，不改变产品真实比例或尺寸。' },
  { end: 20, group: '人物中景展示', shotRule: '全程采用人物中景：人物面部、上半身到腰部、双手与完整摆台同时入镜，摆台高度约占画面25%-40%。产品不挡脸，不向镜头前送，不截成手部或图案特写；摄影机不推近，人物与产品始终同框。占比只用于构图，不改变实物比例。' },
  { end: 28, group: '生活场景全景', shotRule: '全程采用生活场景全景：清楚交代人物、桌柜、座椅与房间环境，站姿人物从头到脚、坐姿人物及完整座椅留在构图，摆台高度约占画面10%-20%。人物日常动作与摆台所在空间持续同框，不收束成产品近景，不推近、不插入特写；保持产品真实尺寸。' },
  { end: 34, group: '整体产品展示', shotRule: '全程展示整件产品：完整四边边框、支撑所处台面和旁侧适量环境持续入镜，摆台高度约占画面35%-55%，四周保留可见留白。只做指定小幅运镜，不推近图案或边框局部，不裁切产品外轮廓，不改变实体尺寸。' },
  { end: 40, group: '局部特写', shotRule: '本条才采用局部近景或结构中近景，围绕指定图案、文字或真实结构做一次短路径展示；不为了拍细节改变产品比例、材质、结构或添加原图不存在的内容。' },
];
export const ORNAMENT_FRAMEWORKS = entries.map(([title, action], index) => {
  const directionNumber = index + 1;
  const shot = shotGroups.find(item => directionNumber <= item.end);
  return { directionNumber, title, action, group: shot.group, shotRule: directionNumber === ORNAMENT_RED_CLOTH_DIRECTION ? '' : shot.shotRule };
});
export function ornamentFramework(direction) {
  const framework = ORNAMENT_FRAMEWORKS[Number(direction) - 1];
  if (!framework) throw new Error('摆件方向编号必须为1至40');
  return framework;
}
export function ornamentDuration(min = 5, max = 10) {
  const durationMin = Math.max(4, Math.min(15, Math.round(Number(min) || 5)));
  return { durationMin, durationMax: Math.max(durationMin, Math.min(15, Math.round(Number(max) || 10))) };
}
export function ornamentRedClothRule() {
  return '【红布揭幕动作锁定】第0秒摆件已在台面稳定站立，正面主图被真实不透明红布盖住，可以看到布面形成的产品轮廓；不是开场无遮挡展示后再盖布。按所选总时长划分开场遮盖、手抓上角向上及侧方揭布、完整展示三个连续阶段。只移动布料，主体与固定支架位置和倾角不变。红布由手持续抓持，有自然褶皱、重力和连续轨迹，揭开后仍被手拿在主体侧外，不能凭空消失、淡出或透明化。布与主体真实接触，不穿过产品、不挂住支架、不带倒摆件；布移开时露出的是原本存在的同一产品，不是布内新生成或变身。结尾红布不遮挡正面，保留完整产品的展示时间。环境、人物服装、台面和光线可以变化，红布颜色、开场遮盖和揭布展示动作不可替换；允许仅手入镜，无需人物露脸。';
}
export function ornamentCommonPhysicalRules(profile) {
  const p = normalizeOrnamentProfile(profile);
  return `${ORNAMENT_MARKER}\n产品档案：${JSON.stringify(p)}\n${ORNAMENT_STRUCTURE_RULE}\n${ornamentSizeRule(p)}\n主体与后撑杆固定连接；视频中维持支撑角度，作为同一稳定整体；任何托举、搬放、转向必须整件同步运动，落台后支撑接触台面、重心稳定才能撤手。主体不能脱离支架，支架不能单独滑动、凭空出现或变化。仅按参考图和已确认档案保留轮廓、比例、厚度、文字、图案、颜色和实际材质，不照搬样片的马或红底；金色铝合金边框为全系列固定结构；背面只按公共背面参考保留木背板与后撑杆，不编造其他结构。未知真实尺寸不猜厘米数。不复制参考图的手、背景或字幕。产品不是墙贴、卷轴或独立装饰盘，不上墙、不揭膜、不卷展、不装配托架。图案和题字静止附着在产品上，不活化、不改字。摄影机运动不改变产品实体尺寸，结尾产品仍为视觉焦点。`;
}
export function ornamentPhysicalRules(profile, direction) {
  const f = ornamentFramework(direction);
  return `${ornamentCommonPhysicalRules(profile)}\n框架方向：${f.directionNumber}\n固定动作框架：${f.action}${f.shotRule ? `\n【景别与构图要求】${f.shotRule}` : ''}${f.directionNumber === ORNAMENT_RED_CLOTH_DIRECTION ? `\n${ornamentRedClothRule()}` : ''}`;
}
export function inspectOrnamentPromptIssues(prompt, direction = 0) {
  const text = String(prompt || ''); const issues = [];
  // 只检查肯定动作句，避免把物理锁定中的否定约束当成动作。
  const creativeBody = text.includes('【摆件创意正文】') ? text.split('【摆件创意正文】').at(-1) : text;
  for (const rawSentence of creativeBody.split(/[。；;，,\n]/).filter(s => !/(禁止|不得|不能|不允许|严禁|不拆|不取|不揭|不上|不卷|不装|不活|不复制|不抓|不变成活|不是|不变成|不生成|不编造)/.test(s))) {
    // 视频画布与摄影器材不属于摆件本体，不能按产品材质/支架误判。
    const sentence = rawSentence.replace(/(?:并不是|并非|没有|无)(?:真实浮雕|立体佛像|立体雕塑)/g, '平面图案').replace(/(?:视频|输出|成片)画布(?:比例)?|画布(?:比例|尺寸|宽高比)/g, '').replace(/(?:摄影机|摄像机|相机)(?:固定在|放在|置于|使用|采用|的)?三脚架|三脚架(?:上的|上的?摄影机|上的?相机|固定机位)/g, '摄影器材');
    if (/(取下|拆下|拆卸|分离|分开|拔出).{0,18}(主体|盘面|摆台|支架|托架)|(?:主体|盘面|支架).{0,18}(取下|拆下|拆卸|分离|分开)|(?:插入|装入|安装).{0,12}(支架|托架)/.test(sentence)) issues.push('不得拆分或装配固定一体摆台与支架');
    if (/(盘面|圆盘|装饰盘).{0,12}(放回|放到|放在|装到).{0,8}(支架|托架)/.test(sentence)) issues.push('不得将独立盘面放到托架上');
    if (/(揭膜|背胶|贴墙|卷轴展开|木条压杆|挂绳|挂钩)/.test(sentence)) issues.push('摆件混入挂画或贴画动作');
    if (/(实木|木质|木制|塑料|树脂|PVC)(?:材质|制|质)?的?\s*(边框|外框)|(?:边框|外框)(?:材质)?(?:为|是|采用|使用|由|：|:)?\s*(实木|木质|木制|塑料|树脂|PVC)/.test(sentence)) issues.push('摆台边框必须为铝合金');
    if (/(金属|铝合金|玻璃|PVC|软膜)(?:材质|制|质)?的?\s*(背板|背面板)|(?:背板|背面板)(?:材质)?(?:为|是|采用|使用|由|：|:)?\s*(金属|铝合金|玻璃|PVC|软膜)/.test(sentence)) issues.push('摆台背板必须为木板');
    const paperMaterial = '(?:宣纸|绢布|画布|PVC柔性(?:薄膜|膜)?)';
    const productSurface = '(?:摆台|摆件|产品|主体|正面|面板|覆层)';
    // 只拦截“产品采用宣纸”等材质归属，不拦截书桌上的宣纸、服装绢布等道具。
    const wrongSurfaceMaterial = new RegExp(`${productSurface}(?:的)?(?:材质|材料|表面)?(?:为|是|采用|使用|覆盖|覆有|由|用|以|制作成|制成|做成|贴上|裱上|：|:)\\s*(?:一层|一张|柔性|印刷)?${paperMaterial}`).test(sentence)
      || new RegExp(`${paperMaterial}(?:材质|制成|制作|做成|印刷)?(?:的)?${productSurface}`).test(sentence);
    if (wrongSurfaceMaterial || /(真实浮雕|立体雕塑|立体佛像|树脂摆件|陶瓷摆件|独立底座|三脚架|双脚托架|圆形框体|圆角边框|压条|挂轴|轴头|揭背膜|安装上墙)/.test(sentence)) issues.push('摆台混入错误结构、材质或立体主体');
    if (/(正面|表面|覆层)(?:材质)?(?:为|是|覆盖|采用|使用|由|：|:)\s*(玻璃|亚克力|树脂)/.test(sentence)) issues.push('正面覆层材质尚未确认，不得编造');
    if (/(拔出|折叠|伸缩|收起|展开|打开|拆卸).{0,10}(后撑杆|支撑杆)|(?:后撑杆|支撑杆).{0,10}(拔出|折叠|伸缩|收起|展开|打开|拆卸)/.test(sentence)) issues.push('后撑杆须保持连接和使用角度');
    if (/(马|花|图案).{0,12}(奔跑|飞出|活过来|变成活)/.test(sentence)) issues.push('产品图案不能活化');
  }
  const resolvedDirection = Number(direction) || Number(text.match(/框架方向：(\d+)/)?.[1]);
  if (resolvedDirection === ORNAMENT_RED_CLOTH_DIRECTION) {
    const body = text.includes('【摆件创意正文】') ? text.split('【摆件创意正文】').at(-1) : text;
    if (!/(开场|初始|第\s*0\s*秒|开始|首帧|0\s*(?:[-–—~～]|至)\s*\d+(?:\.\d+)?\s*秒).{0,40}红布.{0,35}(遮|盖)/s.test(body)) issues.push('红布揭幕方向必须开场用红布遮盖摆台');
    if (!/手/.test(body) || !/(揭开|掀开|提起|拿开|移开|拉开|揭布)/.test(body)) issues.push('红布揭幕方向必须有手揭开红布的连续动作');
    for (const clause of body.split(/[。；;，,\n]/).filter(s => !/(禁止|不得|不能|不允许|严禁)/.test(s))) {
      if (/红布.{0,12}(消失|淡出|透明化|变透明|溶解)/.test(clause)) issues.push('红布必须由手真实拿开，不得消失或透明化');
    }
  }
  return [...new Set(issues)];
}
export function ensureOrnamentPrompt(prompt, profile, direction) {
  const text = String(prompt || '');
  const body = text.includes('【摆件创意正文】') ? text.split('【摆件创意正文】').at(-1).trim() : text.trim();
  return `${ornamentPhysicalRules(profile, direction)}\n\n【摆件创意正文】\n${body}`;
}
export function ornamentProfileFromPrompt(prompt) {
  const text = String(prompt || '');
  if (!text.startsWith(ORNAMENT_MARKER)) return null;
  try { return normalizeOrnamentProfile(JSON.parse(text.match(/产品档案：([^\n]+)/)?.[1] || '{}')); } catch { throw new Error('摆件档案标记损坏，请重新生成提示词'); }
}
export function buildOrnamentIdeasRequest(profile, plan, batch, variationRound, style) {
  const frameworks = ORNAMENT_FRAMEWORKS.slice(batch * 10, batch * 10 + 10);
  return `为固定一体摆台生成10条创意方案。${ornamentCommonPhysicalRules(profile)}\n本轮风格：${JSON.stringify(style)}；用户计划：${JSON.stringify(plan)}；变化轮次：${variationRound}。风格中的木材、石材、织物和配色只用于场景与服装，不能改写摆台边框、木背板、后撑杆和正面平面属性。只变场景、人物和摄影参数，以下10个动作和方向编号不得改变。每条一镜到底、只完成一个可实现动作。用户要求若与固定结构冲突，固定结构优先。\n${frameworks.map(f => `${f.directionNumber}. ${f.title}：${f.action}${f.shotRule ? `；景别：${f.shotRule}` : ''}`).join('\n')}\n只输出合法JSON数组，按上述顺序恰好10项，每项包含title、summary；summary明确初始状态、动作、运镜和结束状态。不要输出挂画或贴画规则。`;
}
export function buildOrnamentVideoRequest(profile, idea, context, style) {
  const f = ornamentFramework(idea.directionNumber); const range = ornamentDuration(idea.durationMin || context.durationMin, idea.durationMax || context.durationMax);
  return `输出可直接生成视频的中文完整提示词。${ornamentPhysicalRules(profile, f.directionNumber)}\n创意方向：${f.title}；摘要：${f.action}\n用户计划：${JSON.stringify(context)}\n统一风格：${JSON.stringify(style)}\n风格中的木材、石材、织物和配色仅用于场景与服装，不能改变产品公共结构与材质。必须遵守固定动作框架，一镜到底，只完成一个动作。分时间段写明初始状态、手的承托与撤离顺序、摄影机短路径和自然收束。${f.directionNumber === ORNAMENT_RED_CLOTH_DIRECTION ? '必须有一只手抓红布上角揭布，可以仅手入镜、不露脸；结尾留出完整展示产品的时间。' : '无人镜头不添加手。'}严禁采纳摘要或用户计划中的拆架、盘面分离动作。时长取${range.durationMin}至${range.durationMax}之间整数；以“总时长：X秒”结尾。`;
}

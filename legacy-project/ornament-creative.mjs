// 固定一体摆台：以32、33号马到成功镜头为主要动作参考。
export const ORNAMENT_RED_CLOTH_DIRECTION = 29;
export const ORNAMENT_STRUCTURE_VERSION = 'aluminum-wood-rear-rod-v1';
export const ORNAMENT_STRUCTURE_RULE = '【摆台公共结构与材质锁定】用户已确认所有款式共用同一物理结构，只有正面图案样式变化。四周是金色外观的矩形铝合金边框，四边直线、四角斜接；边框不是实木、塑料或印刷假边线。后面是木质背板，背板不是金属板、玻璃或PVC软膜。背部靠近下边中央连接一根细金属支撑杆，杆端向后落在台面，与框体下边沿共同支撑摆台，形成稳定的轻微后倾；不是两只前置盘架脚、三脚架、大底座或独立托架。支撑杆与主体连接，视频中保持使用角度，不拔出、不拆装、不折叠、不伸缩；固定连接不等于整件由一块材料铸成。正面人物、金元宝、花纹和立体光影全部属于平面图案，不能生成真实浮雕、立体佛像、独立金币或会动的实物；正面覆层的具体材质未确认，不编造玻璃、亚克力、树脂或宣纸。正面图案和题字以本次上传图为准，公共背面参考仅决定木背板、边框和后撑杆，不复制其中桌面、背景或另一款正面图案。未知厘米尺寸、边框厚度和连接机构不猜测。';
export const ORNAMENT_MARKER = '【固定一体摆件物理锁定】';
export const isOrnamentProduct = (profile) => profile?.productType === 'ornament';
export function normalizeOrnamentProfile(profile = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('缺少有效摆件档案');
  if (profile.supportStructure === 'separate') throw new Error('当前摆件仅支持摆台与支架固定一体；分离式托架请勿使用此框架');
  return { ...profile, productType: 'ornament', supportStructure: 'fixed', structureVersion: ORNAMENT_STRUCTURE_VERSION, outline: '四边直线、四角斜接的矩形框体', frameMaterial: '铝合金', frameColor: '金色', backboardMaterial: '木板', frontSurface: '平面图案，覆层具体材质未确认', material: '四周铝合金边框、木质背板、背部细金属支撑杆；正面覆层具体材质未确认', frameStructure: '金色矩形铝合金边框，四角斜接；木背板；背部下边中央连接一根向后落台的细金属支撑杆，框体下沿与后撑杆共同支撑，使用时轻微后倾', texture: '正面为平面图案，立体光影仅为图像表现；铝合金边框允许自然金属微高光，背面保留木板纹理' };
}
const entries = [
  ['双手整体落台', '人物一手托住整体底部、一手扶主体侧边，将完整摆件短距离放到玄关柜；框体下沿和后撑杆端都接触台面、确认站稳后先后撤手，镜头轻推。'],
  ['柜面侧方移入', '完整摆件由柜面右侧整体进入构图，双手托扶放到预留位置；主体与支架同步移动，站稳后撤手，正面保持清楚。'],
  ['微转正面再撤手', '摆件已经站稳，手扶侧边让主体与支架整体小角度转向镜头，支撑接触台面；转正后撤手，镜头短推。'],
  ['近处搬到书桌', '双手整体托起摆件，从同一书桌旁侧短距离搬到中央空位，整件平稳落台后撤手；不从画面外凭空出现。'],
  ['茶台摆放', '人物将整件摆台放到茶台侧后方的干燥空位，框体下沿与后撑杆端都落稳后再收手；茶具与产品之间保留间距，镜头轻横移。'],
  ['桌面轻挪居中', '已站稳的摆件由手托扶整体轻挪几厘米到柜面中央；支架不滞留原位，确认稳定后松手，镜头慢推。'],
  ['双手正面托举', '双手托扶完整摆件在胸前正面展示，主体与固定支架始终一起被承托；轻向前送出，保持产品清楚，不完成落台。'],
  ['手持轻转回正', '双手托住整件底部与侧边，小角度转到三分之四侧面，再回到正面；支架与主体角度同步，后撑杆维持使用角度，不拆装或折叠。'],
  ['人物让出产品', '人物站在已摆好摆台的侧方，用空手指示正面后收手并侧让；不遮住文字，镜头推近完整摆件。'],
  ['指示纹样不碰支架', '人物用指尖悬空指向参考图真实的主图或题字后收回，摆件全程由框体下沿和后撑杆共同站稳；镜头由整体轻推到该局部，不抓取或拆下主体。'],
  ['玄关归家一瞥', '摆件预先站在玄关柜，人物在侧方放下钥匙后看向摆件并离开主构图；镜头短横移到完整产品。'],
  ['书桌落笔看摆台', '摆件固定站在书桌一侧，人物在另一侧放下笔后抬眼欣赏；镜头轻推，产品正面始终清楚，纸张不遮挡主体。'],
  ['办公桌整理后展示', '摆件预先摆在办公桌空位，人物整理旁边一本闭合笔记本并收手，镜头小幅侧移，以完整摆件为焦点。'],
  ['茶席斟茶衬景', '茶杯在前景，摆件站稳在茶席侧后方；人物只给一只杯子斟茶，镜头从杯旁短移到摆件，始终保持干燥。'],
  ['餐边柜花艺陪衬', '摆件站在餐边柜，人物只调整旁侧花瓶并撤手，镜头轻推向摆件，花枝不穿过产品或遮住主图。'],
  ['书架空格陈列', '完整摆件已站在足够高的书架空格内，人物整理旁边书脊后撤手；镜头短推，支撑落点与柜板可见。'],
  ['会客侧方欣赏', '两位人物在摆台两侧轻声交流，以一次空手指示主图后收回；镜头靠近产品，人物始终不搬拆摆台。'],
  ['窗边自然光展示', '摆件预先站在窗边柜，人物轻拉旁侧窗帘后退开；自然光缓慢变化，产品颜色稳定，镜头以正面中近景结束。'],
  ['阅读前景带出产品', '书桌前景人物合上书并收回双手，后方摆件始终站稳；镜头短升到产品，书不经过主图前方。'],
  ['无人柜面氛围', '无人柜面摆台一直存在，旁侧窗帘轻微摆动；镜头从包含台面支撑的中景缓慢推近，产品保持视觉中心。'],
  ['左向右短横移', '摆件静止站在柜面，摄影机从左向右短横移，呈现轻微视差；完整主图在第1秒已可见，收尾不越过产品。'],
  ['右向左短横移', '摆件静止站在书桌，镜头由右向左短横移，保留台面与底部接触关系；结束仍是完整产品。'],
  ['正面缓慢推近', '从含台面和整件摆台的正面中景连续推近至主图近景；实体不放大、不改变厚度，结尾保留真实图案。'],
  ['局部拉远见全貌', '从参考图主纹样近景连续拉远至整件摆台和台面支撑；产品始终存在且站稳，禁止拉远时补长支架。'],
  ['低机位短升', '由台面略低机位缓慢升到摆件正面，开场可见底部与台面接触；到完整主体即减速，不扫到天花板。'],
  ['高机位轻落', '略高三分之四机位看整件摆台，镜头小幅下降至近乎正面；背面如入镜只按公共背面参考保留木板与后撑杆，保持整体倾角不变。'],
  ['三分之四微弧移', '镜头在产品正面一侧做小于30度的微弧移，展示真实边沿厚度与正面内容；产品不旋转，不绕到背面。'],
  ['花枝旁侧揭示', '旁侧花枝仅遮挡少量外沿，镜头小幅横移露出整件摆台；产品从首帧一直存在，花枝不与摆件穿模。'],
  ['红布揭幕展示', '开场摆台已经站稳在台面，正面主图由一块不透明红布遮盖；一只手抓住红布上角，向上并向侧方连续揭开，真实布料逐渐露出完整摆台；红布最后被手持带到主体侧外，摆台与固定支架全程原位不动，完整正面清楚展示，镜头仅轻推。可换玄关柜、书桌、茶台或陈列柜等场景，红布与揭幕动作保持不变。'],
  ['桌面前景缓慢带入', '前景一本闭合书与摆台错开，镜头从书旁短移带入完整摆台；开场即见部分产品，第2秒前主体清楚，不扫离焦点。'],
  ['主纹样近景巡游', '仅沿参考图实际主图做一次短距离连续移动，保留平面图案原有的色彩、笔触和图像光影，不生成真实凸起或浮雕；马、花等图案不变成活物。'],
  ['题字近景阅读', '近乎正面沿真实可辨题字小幅横移，文字逐帧不变形不改字；不可辨小字保持原纹理，不补写宣传词。'],
  ['主图到落款', '从参考图真实主图连续移动到可见落款或印章；没有落款则结束在主图，不新增文字与印章。'],
  ['铝合金框斜接角', '近景展示金色矩形铝合金边框的一个斜接角，镜头沿短段直线边框移到相邻正面图案；四边刚性直线、角接缝稳定，不变成圆角、实木框或印刷边线。'],
  ['真实侧边厚度', '在正面一侧小角度近景展示参考图可见的实体侧沿，再短移回主图；未知厚度不夸大，不变成柔性膜或卷轴。'],
  ['木背板与后撑杆', '从侧后方中近景展示木质背板、连接在背部下边中央的单根细金属支撑杆及杆端落台；框体下沿与后撑杆共同承重，整件轻微后倾。镜头小幅侧移，支撑杆保持角度与连接，不拆装、不折叠，不生成独立托架；只用公共背面参考确定结构。'],
  ['表面侧光纹理', '近乎正面拍参考图真实表面，以轻微摄影机侧移展示纹理；仅当档案确认光泽时允许自然微反射，不强制镜面。'],
  ['局部到整体收束', '由正面主图细节连续拉远至整件摆台与旁侧环境，保持主体与支架固定、比例稳定，结束仍有轻微运镜。'],
  ['手掌旁侧尺度参照', '摆台站在柜面，一只空手短暂停在侧边作为尺度参照后撤离；不贴住主图、不靠手支撑，不推断固定厘米尺寸。'],
  ['托起整体短距换位', '双手整体托起站稳的摆台，在同一宽柜面短距离换位后落稳撤手；一镜到底只完成一次搬放，不拆支架，不倾倒。'],
];
export const ORNAMENT_FRAMEWORKS = entries.map(([title, action], index) => ({ directionNumber: index + 1, title, action, group: ['整体搬放与人物展示', '生活场景陈列', '摄影机运镜', '细节与结构展示'][Math.floor(index / 10)] }));
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
  return `${ORNAMENT_MARKER}\n产品档案：${JSON.stringify(p)}\n${ORNAMENT_STRUCTURE_RULE}\n主体与后撑杆固定连接；视频中维持支撑角度，作为同一稳定整体；任何托举、搬放、转向必须整件同步运动，落台后支撑接触台面、重心稳定才能撤手。主体不能脱离支架，支架不能单独滑动、凭空出现或变化。仅按参考图和已确认档案保留轮廓、比例、厚度、文字、图案、颜色和实际材质，不照搬样片的马或红底；金色铝合金边框为全系列固定结构；背面只按公共背面参考保留木背板与后撑杆，不编造其他结构。未知真实尺寸不猜厘米数。不复制参考图的手、背景或字幕。产品不是墙贴、卷轴或独立装饰盘，不上墙、不揭膜、不卷展、不装配托架。图案和题字静止附着在产品上，不活化、不改字。摄影机运动不改变产品实体尺寸，结尾产品仍为视觉焦点。`;
}
export function ornamentPhysicalRules(profile, direction) {
  const f = ornamentFramework(direction);
  return `${ornamentCommonPhysicalRules(profile)}\n框架方向：${f.directionNumber}\n固定动作框架：${f.action}${f.directionNumber === ORNAMENT_RED_CLOTH_DIRECTION ? `\n${ornamentRedClothRule()}` : ''}`;
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
  return `为固定一体摆台生成10条创意方案。${ornamentCommonPhysicalRules(profile)}\n本轮风格：${JSON.stringify(style)}；用户计划：${JSON.stringify(plan)}；变化轮次：${variationRound}。风格中的木材、石材、织物和配色只用于场景与服装，不能改写摆台边框、木背板、后撑杆和正面平面属性。只变场景、人物和摄影参数，以下10个动作和方向编号不得改变。每条一镜到底、只完成一个可实现动作。用户要求若与固定结构冲突，固定结构优先。\n${frameworks.map(f => `${f.directionNumber}. ${f.title}：${f.action}`).join('\n')}\n只输出合法JSON数组，按上述顺序恰好10项，每项包含title、summary；summary明确初始状态、动作、运镜和结束状态。不要输出挂画或贴画规则。`;
}
export function buildOrnamentVideoRequest(profile, idea, context, style) {
  const f = ornamentFramework(idea.directionNumber); const range = ornamentDuration(idea.durationMin || context.durationMin, idea.durationMax || context.durationMax);
  return `输出可直接生成视频的中文完整提示词。${ornamentPhysicalRules(profile, f.directionNumber)}\n创意方向：${f.title}；摘要：${f.action}\n用户计划：${JSON.stringify(context)}\n统一风格：${JSON.stringify(style)}\n风格中的木材、石材、织物和配色仅用于场景与服装，不能改变产品公共结构与材质。必须遵守固定动作框架，一镜到底，只完成一个动作。分时间段写明初始状态、手的承托与撤离顺序、摄影机短路径和自然收束。${f.directionNumber === ORNAMENT_RED_CLOTH_DIRECTION ? '必须有一只手抓红布上角揭布，可以仅手入镜、不露脸；结尾留出完整展示产品的时间。' : '无人镜头不添加手。'}严禁采纳摘要或用户计划中的拆架、盘面分离动作。时长取${range.durationMin}至${range.durationMax}之间整数；以“总时长：X秒”结尾。`;
}

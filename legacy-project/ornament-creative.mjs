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
  ["玄关柜旁自然展示", "摆台预先站稳在玄关柜，人物站在侧方摊掌示意后收手并微笑欣赏；人物与完整摆台持续同框，镜头固定。"],
  ["客厅腰侧整体落台", "人物在客厅边柜旁从腰侧自然托扶整件摆台，轻放到空位，支撑落稳后撤手；人物与完整摆台持续同框，镜头固定。"],
  ["书桌旁坐姿欣赏", "摆台预先站稳在书桌一侧，人物坐在旁侧合上书后看向产品；书本不遮挡摆台，镜头保持人与产品同框。"],
  ["茶桌旁轻转正面", "人物在茶桌侧方轻扶整件摆台，在台面小角度转正，支撑落稳后撤手；面部、双手与完整摆台持续同框。"],
  ["办公柜旁侧让展示", "摆台预先站稳在办公柜，人物站在旁侧示意后侧让半步；镜头保持人物与完整摆台同框，不追着人物移动。"],
  ["玄关落台后推进主图", "开场人物在玄关柜旁从腰侧托扶整件摆台，直接轻放、落稳并撤手；随后人物停在侧方，摄影机沿正面缓慢前推，结尾停在真实主图特写。"],
  ["客厅示意后推进题字", "开场摆台已站稳在客厅边柜，人物在旁侧摊掌示意后收手停住；摄影机连续缓慢向正面题字推进，结尾保留真实题字内容特写，无题字则展示主图。"],
  ["书房转正后推进图案", "开场人物在书桌侧方扶整件摆台小角度转正，落稳并撤手；摄影机随后沿正面缓慢靠近主纹样，结尾给到平面图案特写。"],
  ["茶室欣赏后推进内容", "开场人物坐在茶桌旁侧自然欣赏已站稳的摆台，空手轻示意后收回；人物停住，摄影机从人与产品同框连续前推至正面内容特写。"],
  ["餐边柜侧让后推进主图", "开场人物在已摆好产品的餐边柜旁示意并侧让半步，停住且不遮挡；摄影机沿预留路径缓慢推进到摆台正面主图特写。"],
  ["玄关柜面正面横扫", "无人场景，摆台站稳在玄关柜，摄影机正面从左向右短横移，完整产品始终为主体，旁侧钥匙碟只作陪衬。"],
  ["客厅边柜反向扫拍", "无人场景，摆台站稳在客厅边柜，摄影机正面从右向左缓慢短移，完整金色边框与台面持续可见，背景沙发虚化。"],
  ["书桌书册旁横移", "无人场景，摆台站稳在书桌空位，旁侧少量书册不遮挡；摄影机沿桌沿短横移，完整产品始终为主体。"],
  ["茶台干燥侧缓扫", "无人场景，摆台站稳在茶台干燥一侧，茶杯留在旁侧背景；摄影机低速横扫完整正面，不穿过茶具或水汽。"],
  ["餐边柜花瓶旁扫拍", "无人场景，摆台站稳在餐边柜，旁侧花瓶低调陪衬且不挡图案；摄影机短横移展示完整产品与台面。"],
  ["办公桌留白陈列扫拍", "无人场景，摆台站稳在办公桌侧方，笔筒与合上的笔记本作背景；摄影机短横移，主体完整、四周保留留白。"],
  ["窗边柔光横移", "无人场景，摆台站稳在窗边柜，侧窗柔光照亮正面；摄影机沿柜面短横移，完整产品清晰，窗景仅作背景。"],
  ["床头柜静物扫拍", "无人场景，摆台站稳在空间充足的床头柜，台灯与薄书在旁；摄影机从右向左短移，不让灯具遮挡完整产品。"],
  ["开放书架产品扫拍", "无人场景，摆台站稳在宽敞开放书架格内，侧方留少量书册；摄影机正面短横移，保留完整框体与搁板，不拍整个房间。"],
  ["陈列台简洁横移", "无人场景，摆台站稳在简洁陈列台，摄影机沿正面短横移；完整产品为主体，以台面和少量背景留白衬托。"],
  ["左前方整体微弧移", "无人场景，摆台原位站稳，摄影机从左前方沿小于30度短弧移向近正面，完整边框与台面持续可见。"],
  ["右前方整体微弧移", "无人场景，摆台原位站稳，摄影机从右前方沿小于30度短弧移向近正面，不绕到背面、不改变产品倾角。"],
  ["略高机位整体下降", "无人场景，摄影机从略高的三分之四机位缓慢下降到近正面，完整产品持续入镜，不夸大顶边厚度。"],
  ["台面机位缓慢升起", "无人场景，摄影机从接近产品下沿的正前方机位小幅升起到正面，保持完整产品和台面，不钻入底部或支撑内部。"],
  ["花枝前景侧移揭示", "无人场景，前景花枝仅遮挡少量外沿，摄影机小幅侧移露出完整摆台；产品从首帧原位存在，花枝不划过主图。"],
  ["书脊前景侧移揭示", "无人场景，旁侧书脊仅挡少量外沿，摄影机沿台面小幅侧移完整露出摆台；不将产品凭空生成或推入画面。"],
  ["侧窗金框微光弧移", "无人场景，摆台站稳在柜面，摄影机在正面一侧做小幅弧移，让铝合金边框出现自然微高光；正面图案与完整轮廓保持稳定。"],
  ["桌沿斜向整体短移", "无人场景，摄影机沿桌沿斜向短距离平移，保留完整摆台与台面接触关系；不前推成局部、不夸大前景透视。"],
  ["红布揭幕展示", "开场摆台已经站稳在台面，正面主图由一块不透明红布遮盖；一只手抓住红布上角，向上并向侧方连续揭开，真实布料逐渐露出完整摆台；红布最后被手持带到主体侧外，摆台与固定支架全程原位不动，完整正面清楚展示，镜头仅轻推。可换玄关柜、书桌、茶台或陈列柜等场景，红布与揭幕动作保持不变。"],
  ["正面整体推进主图", "无人场景，从完整摆台和少量台面开场，摄影机沿正面缓慢直线前推到真实主图特写，产品原位不动，结尾稳定停留。"],
  ["侧前方推进题字", "无人场景，从完整摆台的轻微侧前方开场，摄影机沿短直线路径缓慢靠近题字，结尾近乎正面的真实题字特写；无题字则展示主图。"],
  ["柜面整体推进纹样", "无人场景，从柜面完整摆台开场，摄影机缓慢推进到正面主纹样，背景逐渐退出构图，平面图案保持静止。"],
  ["台面整体推进框画交界", "无人场景，从台面完整摆台开场，摄影机缓慢推进到一侧铝合金框与正面图案交界，展示真实材质关系，不夸大厚度。"],
  ["主图特写缓退见整体", "无人场景，从真实主图局部特写开场，摄影机沿正面平稳缓退，逐渐露出完整边框和少量台面，产品始终原位站稳。"],
  ["铝合金框斜接角", "近景展示一个真实铝合金边框斜接角，镜头沿短段直线边框移到相邻正面图案；接缝与框线稳定，不改变材质和形状。"],
  ["木背板与后撑杆", "从侧后方中近景展示木质背板、背部下边中央连接的单根细金属后撑杆和杆端落台，轻微侧移；只按公共背面参考确定结构，不拆装、不折叠。"],
  ["主纹样近景巡游", "仅沿本款正面真实主图做一次短距离连续移动，保留色彩、笔触与平面图像光影；图案不变成真实浮雕或会动的实物。"],
  ["题字与落款阅读", "近乎正面沿真实题字短距离横移到可见落款，没有落款则结束在题字；逐帧文字不改字，不补写宣传词。"],
  ["真实侧沿厚度", "在正面一侧小角度近景展示参考图可见的实体侧沿，短移到相邻主图；未知厚度不猜厘米、不夸大。"],
  ["平面表面侧光纹理", "近乎正面以小幅摄影机侧移展示本款真实图面纹理；保持平面印刷属性，只有参考确认的光泽才出现自然微反射。"],
];
const shotGroups = [
  {"end": 5, "group": "人物同框展示", "shotRule": "人物面部、双手与完整摆台保持自然中景或中远景同框，无需强行拍全身；摆台按本次真实厘米尺寸与人物同景深呈现。固定机位或极小幅平移，全程不推近、不切特写，不前送产品。"},
  {"end": 10, "group": "人物同框推进特写", "shotRule": "开场用自然中景或中远景交代人物、完整摆台与台面的真实比例，无需强行拍全身。前约三分之一完成指定简短动作，落台或转正须站稳、撤手后才推进；中段摄影机沿无障碍短路径连续缓慢前推，人物停在旁侧并可自然退出构图；末段约五分之一稳定停留在正面内容特写；短时长优先缩短人物动作，不压缩成急推或跳切。全程一镜到底，匀速平滑、轻缓起停、对焦连续，不切镜、不跳焦、不突然加速，不以产品变大、人物家具缩小或产品前送代替摄影机靠近；开场允许小字自然不可读，文字可读性服从真实尺寸，结尾只呈现参考图中真实内容。"},
  {"end": 20, "group": "产品场景扫拍", "shotRule": "无人场景，不添加人物或手；完整摆台为画面主体，周围只保留台面与少量场景陪衬，不拉成房间全景。通过摄影机取景展示产品，完整边框持续可见，按指定路径平稳短横移，不推进局部，产品实体尺寸不变。"},
  {"end": 28, "group": "产品角度运镜", "shotRule": "无人场景，不添加人物或手；以完整摆台为主体，保留台面接触关系与适量留白，不拍房间全景。摄影机仅做指定的小幅角度或高度变化，保持完整轮廓，不绕背、不钻入产品，不改变实体尺寸。"},
  {"end": 34, "group": "产品揭幕与景别变化", "shotRule": "无人场景，不添加人物或手；按本条指定方向连续缓慢推进或拉远，可从完整产品过渡至局部或从局部退至整体，不强求完整边框全程入镜。产品原位站稳，摄影机平稳起停、连续对焦，结尾稳定停留；不切镜、不跳焦、不用产品缩放代替运镜。"},
  {"end": 40, "group": "局部特写", "shotRule": "无人场景，不添加人物或手；围绕指定图案、文字或真实结构做一次短路径近景展示，不为了交代环境拉成全景，不改变产品比例、材质、结构或添加原图不存在的内容。"},
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
export const ORNAMENT_PRESENTATION_RULE = '【自然喜庆展示】有人物搬运时，摆台在腰部附近或身体侧方自然托扶，直接完成搬放，落台站稳后及时撤手；展示时摆台留在桌柜上，人物在旁侧自然微笑、欣赏或摊掌示意。不双手持框在胸前静止展示，不抱在身体正中央摆拍，不做肃立持框合影。无人镜头不增加人物；仅手揭红布的镜头继续只移动红布。';
const SCENE_STYLE_START = '【摆台场景与服饰风格】';
const SCENE_STYLE_END = '【/摆台场景与服饰风格】';
function sceneStyleConfigFromPrompt(prompt) {
  const match = String(prompt || '').match(/场景风格配置：([^\n]+)/);
  if (!match) return null;
  try { return JSON.parse(match[1]); } catch { return null; }
}
export function ornamentSceneStyleRules(config, direction) {
  const style = config?.style;
  if (!style?.label || !style?.direction) return '';
  const wardrobe = Array.isArray(style.wardrobe) ? style.wardrobe : [];
  const index = Math.max(0, Number(direction) - 1 + (Number(config.variationIndex) || 0));
  const color = wardrobe.length ? wardrobe[index % wardrobe.length] : '';
  return `${SCENE_STYLE_START}\n场景风格配置：${JSON.stringify(config)}\n本条采用「${style.label}」。环境和服饰必须实际体现：${style.direction}\n框架只固定动作顺序、物体接触关系和景别；其中书房、茶室、办公区等名称表示功能区域，不锁定中式装修、实木家具、旗袍或盘扣衣。将墙面、家具造型、陈设、织物、配色与光线统一设计为本次所选风格，不能只在标题写风格名称而沿用上一种环境。有人物时服装的款式、面料和搭配也采用同一风格${color ? `，本条服装建议主色为${color}` : ''}；无人镜头不为展示服装增加人物。${config.scene ? `用户本次场景偏好：${config.scene}；保留动作所需的台面和空间，在该场景内落实所选装修风格。` : ''}${config.character ? `用户本次人物偏好：${config.character}；具体人物要求优先，未指定的服装细节按所选风格补全。` : ''}\n产品档案中的题材、红底或书法气质只决定产品图案，不能据此把所有环境和服装改成新中式。风格只改变环境、人物服饰和摄影氛围，不改变铝合金框、木背板、固定后撑杆、真实尺寸及本款正面图案。${Number(direction) === ORNAMENT_RED_CLOTH_DIRECTION ? '本条红布揭幕仍使用原来的不透明红布和连续揭布动作。' : '本条不增加红布揭幕或其他框架的动作。'}\n${SCENE_STYLE_END}`;
}
export function ornamentScaleRules(profile) {
  const { widthCm, heightCm } = normalizeOrnamentSize(profile);
  const percent = (value, reference) => Number((value / reference * 100).toFixed(1));
  const standardSize = widthCm === 20 && heightCm === 20;
  return `【摆台与人物真实比例】先建立正常体型成年人、正常大小的双手和桌柜，再放入外框宽${widthCm}厘米、高${heightCm}厘米的小型桌面摆台。尺度参照取正常成人肩宽约40厘米、全身高约165厘米：同距离、正面且没有透视缩短时，摆台宽约为肩宽的${percent(widthCm, 40)}%，摆台高约为全身高的${percent(heightCm, 165)}%。这些是同景深的实物尺度参照，不是视频画面占比，不要求人物恰好为该身高或肩宽。${standardSize ? '本款20×20厘米：宽约半个成人肩宽，高约成人身高的八分之一；一条20厘米外框边长大致接近一只成人从手腕到中指尖的完整手长，不是一整段上半身的高度。' : '自定义尺寸按本次输入同比例呈现，不套用20×20厘米款的手长或半肩宽关系。'}\n人物搬运时摆台贴近身体腰侧，不前伸到镜头前，不靠近镜头制造近大远小；人物、双手与摆台应处于相近景深，采用自然标准透视，避免超广角夸大前景。双手只是轻扶底边和侧边，${widthCm <= 20 ? '不能把这款小摆台做成与双肩同宽的大画框。' : '框体宽度严格依照本次厘米尺寸，不按双手张开的距离猜测尺寸。'}搬运、转向、落台、撤手全过程保持同一件产品的实体大小，放到桌柜上后不能突然变大或缩小；桌柜也不缩小来迎合摆台。\n人物全景与生活全景中允许产品自然较小，靠清楚的轮廓、正面朝向、合理光线与背景区分提高辨识度，不靠增大产品。人物中景也保持相同实物比例。无人整体展示和局部特写可以通过摄影机取景让产品或局部占画面较多，产品仍是相同厘米尺寸；整件、手指、框边与台面之间的比例不能变化。人物推进特写方向仅在开场要求人物与摆台同景深，随后摄影机靠近，人物可自然退出构图；不能通过放大实物保证开场小字可读。实际厘米尺寸和同景深比例优先于正文、旧方案中的产品画面占比建议。【/摆台与人物真实比例】`;
}
export function ornamentCommonPhysicalRules(profile) {
  const p = normalizeOrnamentProfile(profile);
  return `${ORNAMENT_MARKER}\n产品档案：${JSON.stringify(p)}\n${ORNAMENT_STRUCTURE_RULE}\n${ornamentSizeRule(p)}\n${ornamentScaleRules(p)}\n${ORNAMENT_PRESENTATION_RULE}\n主体与后撑杆固定连接；视频中维持支撑角度，作为同一稳定整体；任何托举、搬放、转向必须整件同步运动，落台后支撑接触台面、重心稳定才能撤手。主体不能脱离支架，支架不能单独滑动、凭空出现或变化。仅按参考图和已确认档案保留轮廓、比例、厚度、文字、图案、颜色和实际材质，不照搬样片的马或红底；金色铝合金边框为全系列固定结构；背面只按公共背面参考保留木背板与后撑杆，不编造其他结构。未知真实尺寸不猜厘米数。不复制参考图的手、背景或字幕。产品不是墙贴、卷轴或独立装饰盘，不上墙、不揭膜、不卷展、不装配托架。图案和题字静止附着在产品上，不活化、不改字。摄影机运动不改变产品实体尺寸，结尾产品仍为视觉焦点。`;
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
export function ensureOrnamentPrompt(prompt, profile, direction, sceneStyleConfig) {
  const text = String(prompt || '');
  const config = sceneStyleConfig ?? sceneStyleConfigFromPrompt(text);
  const rawBody = text.includes('【摆件创意正文】') ? text.split('【摆件创意正文】').at(-1).trim() : text.trim();
  const body = rawBody.replace(/【摆台场景与服饰风格】[\s\S]*?【\/摆台场景与服饰风格】/g, '').trim();
  const styleRule = ornamentSceneStyleRules(config, direction);
  return `${ornamentPhysicalRules(profile, direction)}${styleRule ? `\n${styleRule}` : ''}\n\n【摆件创意正文】\n${body}`;
}
export function ornamentProfileFromPrompt(prompt) {
  const text = String(prompt || '');
  if (!text.startsWith(ORNAMENT_MARKER)) return null;
  try { return normalizeOrnamentProfile(JSON.parse(text.match(/产品档案：([^\n]+)/)?.[1] || '{}')); } catch { throw new Error('摆件档案标记损坏，请重新生成提示词'); }
}
export function buildOrnamentIdeasRequest(profile, plan, batch, variationRound, style, avoidIdeas = []) {
  const frameworks = ORNAMENT_FRAMEWORKS.slice(batch * 10, batch * 10 + 10);
  const previous = Array.isArray(avoidIdeas) ? avoidIdeas.filter(item => typeof item === 'string').slice(0, 12).map(item => item.slice(0, 500)) : [];
  return `你是短视频创意策划专家，为固定一体摆台生成10条可执行的带货视频创意方案，不是原样抄写动作模板。${ornamentCommonPhysicalRules(profile)}
【本轮整体风格】${style.label || ''}：${style.direction || ''}
【用户素材计划】${JSON.stringify(plan)}
【本轮变化】当前为第${variationRound + 1}轮。同一动作方向不变，但人物、服装、装修、家具组合、配色和光线应形成新的具体执行版本。
【历史避重】${JSON.stringify(previous)}
框架只固定动作机制、顺序、接触关系和景别，框架中的书房、茶室等是功能区域，不锁定新中式装修；按所选整体风格重新设计墙面、家具、灯具、软装和服装，不因产品正面是书法、佛像或红底而自动改回新中式。用户指定的场景、人物、声音和其他要求在不改变产品物理结构与动作方向的前提下落实。
${ornamentSceneStyleRules({ style: { ...style, wardrobe: [] }, scene: plan.scene, character: plan.character, variationIndex: variationRound * 3 }, 0).replace('本条不增加红布揭幕或其他框架的动作。', '红布揭幕仅用于第29号，其他方向不添加红布或其他框架的动作。')}
【本批10个固定动作方向，严格按顺序一一展开】
${frameworks.map(f => {
  const wardrobe = Array.isArray(style.wardrobe) ? style.wardrobe : [];
  const color = wardrobe.length ? wardrobe[(f.directionNumber - 1 + variationRound * 3) % wardrobe.length] : '';
  return `${f.directionNumber}. ${f.title}：${f.action}${f.shotRule ? `；景别：${f.shotRule}` : ''}${color ? `；若出现人物，服装主色为${color}，款式、面料按本轮风格` : ''}${f.directionNumber === ORNAMENT_RED_CLOTH_DIRECTION ? `\n${ornamentRedClothRule()}` : ''}`;
}).join('\n')}
【每条方案要求】
1. 只输出标题与一句话核心创意，不输出完整视频提示词。标题能看出动作和景别，summary必须写具体空间布局、至少2—3件与所选风格协调的家居陈设、明确的光线和配色；有人物时写出具体服装款式、面料、主色及自然动作，无人方向不加人物。局部特写只描述原景别内实际可见的背景，不为了交代陈设增加全景或塞入道具。
2. 把对应固定方向的初始状态、动作、运镜、结束状态融入该场景；只换房间名称或加一个风格形容词不算落实风格。每条一镜到底；物体移动有真实施动者，不新增剧情、切镜或其他框架的动作。
3. 有人物搬运时在腰侧自然托扶，落台后撤手，不双手持框在胸前静止摆拍；始终按本次厘米尺寸与正常成人建立比例，不按画面占比放大。产品材质、结构和正面图案保持本次档案，场景中的木材、石材和织物不移植到产品上。
4. 第29号如在本批，保持开场不透明红布遮盖、手持续抓持向上侧揭布、摆台原位不动、结尾完整展示的动作，只按风格改变环境和服装。无人方向与局部特写继续保持各自景别。
5. 严格只输出合法JSON数组，按上述顺序恰好10项，每项包含title、summary；不输出解释或markdown。不得混入挂画或贴画的尺寸、安装或卷展规则。`;
}
export function buildOrnamentVideoRequest(profile, idea, context, style) {
  const f = ornamentFramework(idea.directionNumber); const range = ornamentDuration(idea.durationMin || context.durationMin, idea.durationMax || context.durationMax);
  return `输出可直接生成视频的中文完整提示词。${ornamentPhysicalRules(profile, f.directionNumber)}\n【已按风格展开的创意方案】标题：${idea.title || f.title}；核心创意：${idea.summary || f.action}\n继承方案中具体的空间布局、家具陈设、人物服装、配色、光线与动作衔接，细化为连续时间轴，不退回只复述固定动作模板；当前所选风格优先于旧方案的环境描述。当前固定动作、景别与运镜规则优先于旧方案中全程不推近、人物持续同框等冲突描述；产品结构、实际厘米尺寸与自然持握要求优先，方案仅决定这些约束内的具体执行，不采纳方案中相冲突的拆架、胸前持框或放大产品要求。\n用户计划：${JSON.stringify(context)}\n${Number(context.elementVariationIndex) > 0 ? '【换元素】相对上一版本更换人物服装、家具组合和空间配色，固定方向、所选风格及产品物理信息保持一致；同一条视频内不换人换装。' : ''}${context.previousPrompt || context.avoidElements?.length ? '历史提示词和avoidElements只供避重，不继承其中的旧风格、动作或尺寸。' : ''}\n${ornamentSceneStyleRules({ style, scene: context.scene, character: context.character, variationIndex: context.elementVariationIndex }, f.directionNumber)}\n风格中的木材、石材、织物和配色仅用于场景与服装，不能改变产品公共结构与材质。必须遵守固定动作框架，一镜到底，只完成一个动作。分时间段写明初始状态、手的承托与撤离顺序、摄影机短路径和自然收束。${f.directionNumber === ORNAMENT_RED_CLOTH_DIRECTION ? '必须有一只手抓红布上角揭布，可以仅手入镜、不露脸；结尾留出完整展示产品的时间。' : '无人镜头不添加手。'}严禁采纳摘要或用户计划中的拆架、盘面分离动作。时长取${range.durationMin}至${range.durationMax}之间整数；以“总时长：X秒”结尾。`;
}

import { normalizeOrnamentSize, ornamentSizeRule } from './ornament-size.mjs';
// 固定一体摆台：以32、33号马到成功镜头为主要动作参考。
export const ORNAMENT_RED_CLOTH_DIRECTION = 29;
export const ORNAMENT_STRUCTURE_VERSION = 'current-product-views-v1';
export const ORNAMENT_STRUCTURE_RULE = '【本款固定一体摆台结构】主体与支撑结构保持固定连接，搬放或转向时整件同步移动，站稳后才撤手。保留本款参考图可见的边框轮廓、颜色、表面、背面和支撑结构。只描述图片能确认的细节；看不准的材质、厚度和连接方式保持未知。产品图案、题字和图内光影留在产品表面，不变为独立实物或动画。保持本款连接和摆放状态，不拆装支撑结构。';
export function ornamentReferenceGuide(hasSide) {
  return `【本款摆件参考图】图1是本款正面，决定正面图案、题字、颜色及可见外形。图2是同一款的背面，决定背面颜色、纹理和支撑连接。${hasSide ? '图3是同一款的侧面，补充侧沿、厚度和支撑角度。' : '侧沿仅展示正面或背面图能确认的部分。'}结合各角度保留本款实物外观，不复制图片里的背景、手或道具。`;
}
export const ORNAMENT_MARKER = '【固定一体摆件物理锁定】';
export const isOrnamentProduct = (profile) => profile?.productType === 'ornament';
export function normalizeOrnamentProfile(profile = {}) {
  if (!profile || typeof profile !== 'object' || Array.isArray(profile)) throw new Error('缺少有效摆件档案');
  if (profile.supportStructure === 'separate') throw new Error('当前摆件仅支持摆台与支架固定一体；分离式托架请勿使用此框架');
  return { ...profile, ...normalizeOrnamentSize(profile), productType: 'ornament', supportStructure: 'fixed', structureVersion: ORNAMENT_STRUCTURE_VERSION };
}
export function requireCurrentOrnamentProfile(profile) {
  if (profile?.structureVersion !== ORNAMENT_STRUCTURE_VERSION) {
    throw Object.assign(new Error('请上传本款正面和背面图，重新分析摆件并生成方案'), { statusCode: 400 });
  }
}
const entries = [
  ["玄关迎归安静陈列", "摆台从首帧站稳在玄关边柜前侧，完整正面清晰；后景人物从门边走入、在远处停下换鞋，动作完成后画面留给原位摆台。镜头固定中远景，人物不拿摆台、不走过产品前方。"],
  ["客厅边柜自然落台", "人物只做一次有来由的布置：从边柜旁腰侧托扶整件摆台，轻放到预留空位，支撑完全站稳后双手撤离；随后静留完整摆台与客厅。固定中景，不把产品从画面左边搬到右边再搬回。"],
  ["书房阅读前景陈列", "摆台已站稳在书桌靠镜头的一侧，后方人物坐着读书、自然翻完一页后继续阅读；摄影机固定，摆台始终清晰，人物与书本在后景柔和虚化，不碰或遮挡产品。"],
  ["茶室闲谈前景陈列", "摆台已站稳在茶桌干燥的前侧，两位人物在后方落座低声交谈并相视点头；镜头固定中远景，完整摆台持续清晰，茶具与人留在背景，不伸手转动产品。"],
  ["办公柜会客背景", "摆台已站稳在办公边柜前侧，后方两人在会客区坐下交谈，保持坐姿完成这段自然互动；镜头固定，前景产品清晰完整，人物柔和虚焦且不穿过产品。"],
  ["玄关归家后缓推摆台", "摆台从首帧原位站稳在玄关柜，远处人物走入后停在换鞋区；人物动作完成，摄影机才沿柜面缓缓向产品靠近，末尾停在完整正面而不是突然跳到极近特写。"],
  ["客厅谈笑缓推摆台", "摆台从首帧站稳在客厅茶几前侧，后方家人已坐着轻声谈笑；摄影机沿茶几缓慢直线靠近完整摆台，家人留在柔焦背景，结尾停在产品整体与底座。"],
  ["书房阅读缓推主图", "摆台原位站稳在书桌前侧，后方人物持续安静阅读；摄影机从带书桌与人物的中景连续缓推到摆台主图近景，不要求人物改变姿势或额外示意，末尾稳定停留。"],
  ["茶席生活缓推内容", "摆台原位站稳在茶桌干燥侧，后方人物在另一侧缓慢完成一次斟茶，茶壶与水远离产品；摄影机等倒茶动作结束后才平稳靠近摆台正面，结尾保留完整产品或真实主图近景。"],
  ["餐边柜备餐后缓推", "摆台原位站稳在餐边柜前侧，后景人物在餐桌上放好一只餐具并撤手；这个动作结束后摄影机缓慢靠近柜上完整产品，末尾稳住，不让餐具越过产品正面。"],
  ["玄关纵深侧移迎归", "摆台站稳在玄关柜前侧，后方人物从门边走到换鞋区，不经过产品前方；摄影机沿柜面缓慢侧移一小段，让门厅与摆台产生层次，末尾留住完整正面与台面。"],
  ["客厅家人背景扫拍", "摆台站稳在茶几靠镜头一侧，后方家人坐在沙发上自然交谈；摄影机沿桌边低速横移，产品始终清晰，人物保持柔焦、不伸手碰摆台，末尾稳住。"],
  ["书桌阅读纵深扫拍", "摆台站稳在书桌前侧，后方人物翻完一页继续阅读；摄影机沿桌沿缓慢侧移，书页只在背景变化，完整摆台正面不被人或书遮挡。"],
  ["茶台待客侧向扫拍", "摆台站稳在茶台干燥前侧，背景两人在座位上交谈，一人端起茶杯后稳稳放回；摄影机沿茶台短距离侧移，不穿过茶具或热水，最后停在完整摆台。"],
  ["餐边柜餐叙扫拍", "摆台站稳在餐边柜前侧，后方家人在餐桌旁坐着聊天；摄影机从柜的一侧缓慢横移到产品正面，桌柜与人形成纵深，末尾保留产品完整轮廓和小段台面。"],
  ["办公会客纵深扫拍", "摆台站稳在会议桌前缘干净一侧，后方两人落座交谈；摄影机沿桌沿缓慢侧移，产品保持清晰完整，背景仅柔和显示人物活动，不把摆台移到人手里。"],
  ["窗边侧光陈列扫拍", "无人场景，摆台站稳在窗边柜，侧窗柔光在原有边框上形成自然亮暗；摄影机沿柜面短横移，窗景与柜体保留空间层次，结尾完整正面清晰。"],
  ["床头阅读背景扫拍", "摆台站稳在宽敞床头柜前侧，后方人物倚靠床头安静读书；摄影机沿柜面慢移，台灯和书不遮挡正面，最后保持产品完整且人物柔焦。"],
  ["开放书架层板扫拍", "无人场景，摆台站稳在开放书架宽敞层板的前侧，旁边只留少量书册；摄影机在层板外缓慢侧移，以书架边线形成纵深，绝不进入层板内部或遮住产品。"],
  ["陈列台聚光扫拍", "无人场景，摆台站稳在简洁展台，暖白局部灯光照亮正面，后方空间柔和虚化；摄影机沿展台短移到近正面后停止，保留完整产品、支撑与落台接触。"],
  ["客厅左前弧移环视", "摆台站稳在客厅边柜前侧，摄影机从左前约25度沿小弧线移动至近正面；后方人物坐在沙发上交谈，只有背景动作持续，产品正面与底座全程完整，停住后留出欣赏时间。"],
  ["茶室右前弧移环视", "摆台站稳在茶台干燥一侧，摄影机从右前约25度沿小弧线回到正面；后方人物安静品茶，杯子远离产品，镜头只作这一次环视，结尾停在完整摆台。"],
  ["陈列柜略高机位下降", "无人场景，摆台站稳在陈列柜，摄影机从略高的三分之四角度小幅下降到自然正面；柜体线条与桌面始终交代空间，完整边框和支撑可见，不夸大顶边厚度。"],
  ["茶几台面机位升起", "无人场景，摆台站稳在茶几上，摄影机从接近桌面的正前方缓慢升到自然视线高度；后方沙发形成柔和纵深，始终看见完整产品与台面，不钻到支撑底部。"],
  ["花枝前景揭示厅景", "无人场景，花枝位于镜头一侧的近景，摆台从首帧便站稳在后方柜面；摄影机小幅侧移，让花枝逐渐退出外沿，露出摆台、台面及一小段客厅纵深，末尾稳定展示完整正面。"],
  ["书脊前景揭示书房", "无人场景，书脊在镜头一侧略遮产品外沿，摆台已站稳在书桌上；摄影机沿桌边小幅侧移到书脊不挡产品的位置，露出完整产品及书房背景后停住，不凭空生出摆台。"],
  ["侧窗光下小弧环视", "无人场景，摆台站稳在窗边柜面；摄影机沿正面一侧约20度小弧线移动，侧窗的真实亮暗掠过参考图可见的边框，正面图案、固定支撑和桌面保持稳定，结尾停住。"],
  ["玄关桌沿斜向扫视", "无人场景，摆台站稳在玄关柜前侧；摄影机沿桌沿斜向短移，门厅和柜面产生自然纵深，完整摆台始终清晰，结尾略靠近正面但不推成局部。"],
  ["红布揭幕展示", "开场摆台已经站稳在台面，正面主图由一块不透明红布遮盖；一只手抓住红布上角，向上并向侧方连续揭开，真实布料逐渐露出完整摆台；红布最后被手持带到主体侧外，摆台与固定支架全程原位不动，完整正面清楚展示，镜头仅轻推。可换玄关柜、书桌、茶台或陈列柜等场景，红布与揭幕动作保持不变。"],
  ["正面整体推进主图", "无人场景，从完整摆台和少量台面开场，摄影机沿正面缓慢直线前推到真实主图特写，产品原位不动，结尾稳定停留。"],
  ["玄关空间缓推整体", "无人场景，摆台原位站稳在玄关边柜；摄影机从带一小段门厅和柜体的中远景沿柜面缓推到产品中景，完整摆台和底座始终在画面内，结尾停住，不跳到局部。"],
  ["办公会谈背景缓推", "摆台原位站稳在会客桌前侧，两人在后方坐着交谈；摄影机从包含桌面与人物的中远景缓推到清晰完整的摆台，背景人物逐渐柔焦，结尾保留桌面接触与完整正面。"],
  ["茶室陈列缓退见空间", "无人场景，摆台原位站稳在茶室边柜；摄影机从完整产品的中近景平稳后退至可见茶席、柜体和后方座位的中远景，产品仍在清晰前景，借纵深而不是扩大实物保持主体感。"],
  ["主图特写缓退见整体", "无人场景，从真实主图局部特写开场，摄影机沿正面平稳缓退，逐渐露出完整边框和少量台面，产品始终原位站稳。"],
  ["边框转角细节", "近景展示本款边框可见的转角，镜头沿短段直线边框移到相邻正面图案；接缝与框线稳定，不改变材质和形状。"],
  ["本款背面与支撑结构", "从侧后方中近景轻微侧移，展示本款背面照片可见的颜色、表面纹理、固定支撑及其与台面的接触关系；保持连接，不拆装。"],
  ["主纹样近景巡游", "仅沿本款正面真实主图做一次短距离连续移动，保留色彩、笔触与平面图像光影；图案不变成真实浮雕或会动的实物。"],
  ["题字与落款阅读", "近乎正面沿真实题字短距离横移到可见落款，没有落款则结束在题字；逐帧文字不改字，不补写宣传词。"],
  ["真实侧沿厚度", "在正面一侧小角度近景展示参考图可确认的实体侧沿，短移到相邻主图；无侧面图时只展示正背图可确认的边缘，不补拍未知角度或猜测厚度。"],
  ["平面表面侧光纹理", "近乎正面以小幅摄影机侧移展示本款真实图面纹理；保持平面印刷属性，只有参考确认的光泽才出现自然微反射。"],
  // 同行视频取样：730 00–04/18–24；431 00–04/20–22/38；617 08–18/26–36。
  ["双人礼赠交接", "两人相向站在桌边，赠送者在腰侧托住整件摆台底部递给对方，对方从底部接稳后赠送者撤手；接收者继续在腰侧稳稳托住整件，完整正面朝向镜头。摄影机固定中景，只拍这次连续交接，不举到胸前摆拍，不追加落台动作。"],
  ["家人围看自然交流", "摆台预先站稳在茶几前侧，后方两位家人坐着轻声交流并相视微笑，一人仅在产品侧边轻示意，双手不搬动产品；前景完整摆台始终清晰，后方人物柔和虚焦，固定机位持续记录这段互动。"],
  ["讲解者俯身指引", "摆台预先站稳在桌面，讲解者站在桌后自然俯身，双手分别停在产品左右两侧的空处摊掌指引，随即收手并看向镜头；不触碰、不遮住正面。镜头固定中近景，清楚保留讲解者面部、双手、摆台底座与台面。"],
  ["茶席前景焦点交接", "摆台预先站稳在茶席后侧的干燥台面，开场前景茶杯轻虚化、完整摆台可见；摄影机固定不横移，以一次缓慢连续的对焦将清晰焦点从前景茶杯交给后方摆台，结尾产品正面与底座清晰稳定，茶具不遮挡主图，也不增添水汽。"],
];
const shotGroups = [
  {"end": 5, "group": "人物与生活场景", "shotRule": "中景或中远景交代真实生活空间、完整摆台和人物位置；有人搬放时人与产品处于相近景深，只有本条指定的第2号允许碰摆台。其余方向摆台从首帧原位站稳、前景清晰，背景人物自然活动且可柔焦；固定机位，不推近、不切特写、不前送产品。指定动作完整结束后留出稳定展示时间。"},
  {"end": 10, "group": "生活场景缓推展示", "shotRule": "开场中景或中远景同时交代完整摆台、台面与后方生活空间；摆台从首帧站稳，背景人物只做本条指定的一件自然事情，不伸手触碰产品。若人物动作有明确终点，先让它完整结束，再让摄影机沿无障碍短路径连续缓推；其余方向背景活动可低强度持续。结尾按本条要求保留完整产品或主图近景，并稳定停留约一秒。全程一镜到底、对焦连续、不跳切或突然加速；人物在远景虚焦不意味着摆台与人同尺寸，不能放大产品、缩小家具或前送产品代替运镜。"},
  {"end": 20, "group": "场景纵深扫拍", "shotRule": "摆台从首帧原位站稳且正面清晰，桌柜与生活空间有真实前后层次。仅当本条写明背景人物时允许人物，人物只在后景做指定活动，不走过产品正面、不伸手搬动摆台；写明无人场景的方向保持无人。摄影机沿指定台面做一次平稳短侧移，完整产品、底座和一小段台面持续可见；保留足够场景但不拉成空旷全屋，末段停稳，不加入第二种运镜。"},
  {"end": 28, "group": "场景小弧环视", "shotRule": "摆台原位站稳，完整正面、固定支撑与台面持续可见；仅当本条写明人物时允许后景人物自然活动，不增加搬运动作。摄影机只做本条指定的一次小弧移、高度变化或侧移，正面偏转约20至25度以内，不绕到背面、不钻进产品、不改变实体尺寸；背景保留空间纵深，起停平稳，末尾停留。"},
  {"end": 34, "group": "产品与空间景别变化", "shotRule": "摆台从首帧原位站稳；仅当本条写明人物时允许人物在后景自然活动，其他方向保持无人。摄影机仅按本条指定路径连续缓推或缓退，既可到近景，也可停在完整产品中景或退至仍以产品为清晰前景的中远景；不能机械地把每条都推进主图特写。产品实体尺寸不变，景别依靠机位变化，平稳起停、连续对焦，结尾停留，不跳切或临时追加动作。"},
  {"end": 40, "group": "局部特写", "shotRule": "无人场景，不添加人物或手；围绕指定图案、文字或真实结构做一次短路径近景展示，不为了交代环境拉成全景，不改变产品比例、材质、结构或添加原图不存在的内容。"},
  {"end": 41, "group": "人物礼赠交接", "shotRule": "两人、双手、完整摆台和桌面保持同框；只允许自然的腰侧交接，整件及固定支撑同步移动，接收者接稳后赠送者才撤手；全程一镜到底，保持真实人物与摆台比例。"},
  {"end": 42, "group": "家人互动陈列", "shotRule": "前景完整产品为清晰视觉主体，背景人物在产品后方留出空间自然互动；固定机位，不推近、不切镜，不移动产品，也不让手挡住正面。"},
  {"end": 43, "group": "人物讲解展示", "shotRule": "讲解者位于已站稳摆台后方，面部与完整产品同时清晰可见，双手仅在产品两侧示意；固定机位，不将产品放大到与人物肩同宽，不以推进或剪辑代替动作。"},
  {"end": 44, "group": "静物景深交接", "shotRule": "无人场景，不添加人物或手；固定机位，以连续自然的对焦变化完成前景茶具到完整摆台的视觉引导，结尾产品始终清楚；不通过移动或缩放产品制造转场。"},
];
export const ORNAMENT_FRAMEWORKS = entries.map(([title, action], index) => {
  const directionNumber = index + 1;
  const shot = shotGroups.find(item => directionNumber <= item.end);
  return { directionNumber, title, action, group: shot.group, shotRule: directionNumber === ORNAMENT_RED_CLOTH_DIRECTION ? '' : shot.shotRule };
});
export function ornamentFramework(direction) {
  const framework = ORNAMENT_FRAMEWORKS[Number(direction) - 1];
  if (!framework) throw new Error(`摆件方向编号必须为1至${ORNAMENT_FRAMEWORKS.length}`);
  return framework;
}
export function ornamentDuration(min = 5, max = 10) {
  const durationMin = Math.max(4, Math.min(15, Math.round(Number(min) || 5)));
  return { durationMin, durationMax: Math.max(durationMin, Math.min(15, Math.round(Number(max) || 10))) };
}
export function ornamentRedClothRule() {
  return '【红布揭幕动作锁定】第0秒摆件已在台面稳定站立，正面主图被真实不透明红布盖住，可以看到布面形成的产品轮廓；不是开场无遮挡展示后再盖布。按所选总时长划分开场遮盖、手抓上角向上及侧方揭布、完整展示三个连续阶段。只移动布料，主体与固定支架位置和倾角不变。红布由手持续抓持，有自然褶皱、重力和连续轨迹，揭开后仍被手拿在主体侧外，不能凭空消失、淡出或透明化。布与主体真实接触，不穿过产品、不挂住支架、不带倒摆件；布移开时露出的是原本存在的同一产品，不是布内新生成或变身。结尾红布不遮挡正面，保留完整产品的展示时间。环境、人物服装、台面和光线可以变化，红布颜色、开场遮盖和揭布展示动作不可替换；允许仅手入镜，无需人物露脸。';
}
export const ORNAMENT_PRESENTATION_RULE = '【自然生活展示】只有本条明确要求搬放或交接时人物才触碰摆台；搬放须在腰侧自然托扶，落台站稳后撤手。第41号礼赠只在腰侧交接，接收者接稳后赠送者撤手，无需落台。场景陈列方向摆台从首帧站稳在桌柜前侧，人物只在指定后景完成阅读、交谈、归家或待客等自然活动，不上前转动、搬放、挡住产品；第43号讲解允许人物在桌后从两侧示意。不双手持框在胸前静止展示，不抱在身体正中央摆拍，不做肃立持框合影。明确无人镜头不增加人物；仅手揭红布的镜头只移动红布。';
export const ORNAMENT_SHOT_CONTINUITY_RULE = '【单镜头动作与收尾】每条视频只保留本框架写明的主要运镜和必要的背景生活活动，不额外添加搬来搬去、转向、握手、再次示意或切换场景。开头先交代摆台与环境的固定位置；人物的斟茶、落台、归家、摆餐具等有终点的动作须完成、物体站稳或放稳、手撤开，再启动下一个被框架明确允许的镜头运动。背景聊天或阅读可以持续，但动作轻缓，不抢前景主体。运镜沿一条连续路径平稳起停、视线与对焦自然衔接，末尾给清晰产品至少约一秒稳定展示；短时长宁可减少背景动作，也不压缩成半途跳动作、瞬移或突然切特写。产品从开场到结束是同一件，底座与接触面坐标连续，背景人物和家具位置前后一致。';
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
  return `${SCENE_STYLE_START}\n场景风格配置：${JSON.stringify(config)}\n本条采用「${style.label}」。环境和服饰必须实际体现：${style.direction}\n框架只固定动作顺序、物体接触关系和景别；其中书房、茶室、办公区等名称表示功能区域，不锁定中式装修、实木家具、旗袍或盘扣衣。将墙面、家具造型、陈设、织物、配色与光线统一设计为本次所选风格，不能只在标题写风格名称而沿用上一种环境。有人物时服装的款式、面料和搭配也采用同一风格${color ? `，本条服装建议主色为${color}` : ''}；无人镜头不为展示服装增加人物。${config.scene ? `用户本次场景偏好：${config.scene}；保留动作所需的台面和空间，在该场景内落实所选装修风格。` : ''}${config.character ? `用户本次人物偏好：${config.character}；具体人物要求优先，未指定的服装细节按所选风格补全。` : ''}\n产品档案中的题材、红底或书法气质只决定产品图案，不能据此把所有环境和服装改成新中式。风格只改变环境、人物服饰和摄影氛围，不改变本款的边框、背面、固定支撑、真实尺寸及正面图案。${Number(direction) === ORNAMENT_RED_CLOTH_DIRECTION ? '本条红布揭幕仍使用原来的不透明红布和连续揭布动作。' : '本条不增加红布揭幕或其他框架的动作。'}\n${SCENE_STYLE_END}`;
}
export function ornamentScaleRules(profile) {
  const { widthCm, heightCm } = normalizeOrnamentSize(profile);
  const percent = (value, reference) => Number((value / reference * 100).toFixed(1));
  const standardSize = widthCm === 20 && heightCm === 20;
  return `【摆台与人物真实比例】先建立正常体型成年人、正常大小的双手和桌柜，再放入外框宽${widthCm}厘米、高${heightCm}厘米的小型桌面摆台。尺度参照取正常成人肩宽约40厘米、全身高约165厘米：同距离、正面且没有透视缩短时，摆台宽约为肩宽的${percent(widthCm, 40)}%，摆台高约为全身高的${percent(heightCm, 165)}%。这些是同景深的实物尺度参照，不是视频画面占比，不要求人物恰好为该身高或肩宽。${standardSize ? '本款20×20厘米：宽约半个成人肩宽，高约成人身高的八分之一；一条20厘米外框边长大致接近一只成人从手腕到中指尖的完整手长，不是一整段上半身的高度。' : '自定义尺寸按本次输入同比例呈现，不套用20×20厘米款的手长或半肩宽关系。'}\n人物搬运时摆台贴近身体腰侧，不前伸到镜头前，不靠近镜头制造近大远小；人物、双手与摆台应处于相近景深，采用自然标准透视，避免超广角夸大前景。双手只是轻扶底边和侧边，${widthCm <= 20 ? '不能把这款小摆台做成与双肩同宽的大画框。' : '框体宽度严格依照本次厘米尺寸，不按双手张开的距离猜测尺寸。'}搬运、转向、落台、撤手全过程保持同一件产品的实体大小，放到桌柜上后不能突然变大或缩小；桌柜也不缩小来迎合摆台。\n人物全景与生活全景中允许产品自然较小，靠清楚的轮廓、正面朝向、合理光线与背景区分提高辨识度，不靠增大产品。人物中景也保持相同实物比例。无人整体展示和局部特写可以通过摄影机取景让产品或局部占画面较多，产品仍是相同厘米尺寸；整件、手指、框边与台面之间的比例不能变化。人物推进特写方向仅在开场要求人物与摆台同景深，随后摄影机靠近，人物可自然退出构图；不能通过放大实物保证开场小字可读。实际厘米尺寸和同景深比例优先于正文、旧方案中的产品画面占比建议。【/摆台与人物真实比例】`;
}
export function ornamentCommonPhysicalRules(profile) {
  const p = normalizeOrnamentProfile(profile);
  return `${ORNAMENT_MARKER}\n产品档案：${JSON.stringify(p)}\n${ORNAMENT_STRUCTURE_RULE}\n${ornamentSizeRule(p)}\n${ornamentScaleRules(p)}\n${ORNAMENT_PRESENTATION_RULE}\n${ORNAMENT_SHOT_CONTINUITY_RULE}\n主体与本款支撑保持固定连接。落台后确认整件站稳再撤手。正面、背面和侧沿分别以本款对应参考图为准，已分析的档案用于描述可见细节。未知真实尺寸不猜厘米数。不复制参考图的手、背景或字幕。产品不是墙贴、卷轴或独立装饰盘，不上墙、不揭膜、不卷展、不装配托架。图案和题字静止附着在产品上，不活化、不改字。摄影机运动不改变产品实体尺寸，结尾产品仍为视觉焦点。`;
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
  if (!text.includes(ORNAMENT_MARKER)) return null;
  let profile;
  try { profile = JSON.parse(text.match(/产品档案：([^\n]+)/)?.[1] || '{}'); }
  catch { throw Object.assign(new Error('摆件档案标记损坏，请重新生成提示词'), { statusCode: 400 }); }
  requireCurrentOrnamentProfile(profile);
  return normalizeOrnamentProfile(profile);
}
export function buildOrnamentIdeasRequest(profile, plan, batch, variationRound, style, avoidIdeas = []) {
  const frameworks = ORNAMENT_FRAMEWORKS.slice(batch * 10, batch * 10 + 10);
  const count = frameworks.length;
  const previous = Array.isArray(avoidIdeas) ? avoidIdeas.filter(item => typeof item === 'string').slice(0, 12).map(item => item.slice(0, 500)) : [];
  return `你是短视频创意策划专家，为固定一体摆台生成${count}条可执行的带货视频创意方案，不是原样抄写动作模板。${ornamentCommonPhysicalRules(profile)}
【本轮整体风格】${style.label || ''}：${style.direction || ''}
【用户素材计划】${JSON.stringify(plan)}
【本轮变化】当前为第${variationRound + 1}轮。同一动作方向不变，但人物、服装、装修、家具组合、配色和光线应形成新的具体执行版本。
【历史避重】${JSON.stringify(previous)}
框架只固定动作机制、顺序、接触关系和景别，框架中的书房、茶室等是功能区域，不锁定新中式装修；按所选整体风格重新设计墙面、家具、灯具、软装和服装，不因产品正面是书法、佛像或红底而自动改回新中式。用户指定的场景、人物、声音和其他要求在不改变产品物理结构与动作方向的前提下落实。
${ornamentSceneStyleRules({ style: { ...style, wardrobe: [] }, scene: plan.scene, character: plan.character, variationIndex: variationRound * 3 }, 0).replace('本条不增加红布揭幕或其他框架的动作。', '红布揭幕仅用于第29号，其他方向不添加红布或其他框架的动作。')}
【本批${count}个固定动作方向，严格按顺序一一展开】
${frameworks.map(f => {
  const wardrobe = Array.isArray(style.wardrobe) ? style.wardrobe : [];
  const color = wardrobe.length ? wardrobe[(f.directionNumber - 1 + variationRound * 3) % wardrobe.length] : '';
  return `${f.directionNumber}. ${f.title}：${f.action}${f.shotRule ? `；景别：${f.shotRule}` : ''}${color ? `；若出现人物，服装主色为${color}，款式、面料按本轮风格` : ''}${f.directionNumber === ORNAMENT_RED_CLOTH_DIRECTION ? `\n${ornamentRedClothRule()}` : ''}`;
}).join('\n')}
【每条方案要求】
1. 只输出标题与一句话核心创意，不输出完整视频提示词。标题能看出动作和景别，summary必须写具体空间布局、至少2—3件与所选风格协调的家居陈设、明确的光线和配色；有人物时写出具体服装款式、面料、主色及自然动作，无人方向不加人物。局部特写只描述原景别内实际可见的背景，不为了交代陈设增加全景或塞入道具。
2. 把对应固定方向的初始状态、背景人物活动、运镜、结束状态融入该场景；只换房间名称或加一个风格形容词不算落实风格。每条一镜到底；有终点的人物动作必须完成再推进或转移机位，结尾留完整展示，不新增剧情、跳切或其他框架动作。背景人物只在指定后景活动，产品原位静止且清晰；物体移动有真实施动者。
3. 有人物搬运时在腰侧自然托扶，落台后撤手，不双手持框在胸前静止摆拍；始终按本次厘米尺寸与正常成人建立比例，不按画面占比放大。产品材质、结构和正面图案保持本次档案，场景中的木材、石材和织物不移植到产品上。
4. 第29号如在本批，保持开场不透明红布遮盖、手持续抓持向上侧揭布、摆台原位不动、结尾完整展示的动作，只按风格改变环境和服装。无人方向与局部特写继续保持各自景别。
5. 严格只输出合法JSON数组，按上述顺序恰好${count}项，每项包含title、summary；不输出解释或markdown。不得混入挂画或贴画的尺寸、安装或卷展规则。`;
}
export function buildOrnamentVideoRequest(profile, idea, context, style) {
  const f = ornamentFramework(idea.directionNumber); const range = ornamentDuration(idea.durationMin || context.durationMin, idea.durationMax || context.durationMax);
  return `输出可直接生成视频的中文完整提示词。${ornamentPhysicalRules(profile, f.directionNumber)}\n【已按风格展开的创意方案】标题：${idea.title || f.title}；核心创意：${idea.summary || f.action}\n继承方案中具体的空间布局、家具陈设、人物服装、配色、光线与动作衔接，细化为连续时间轴，不退回只复述固定动作模板；当前所选风格优先于旧方案的环境描述。当前固定动作、景别与运镜规则优先于旧方案中全程不推近、人物持续同框等冲突描述；产品结构、实际厘米尺寸与自然持握要求优先，方案仅决定这些约束内的具体执行，不采纳方案中相冲突的拆架、胸前持框或放大产品要求。\n用户计划：${JSON.stringify(context)}\n${Number(context.elementVariationIndex) > 0 ? '【换元素】相对上一版本更换人物服装、家具组合和空间配色，固定方向、所选风格及产品物理信息保持一致；同一条视频内不换人换装。' : ''}${context.previousPrompt || context.avoidElements?.length ? '历史提示词和avoidElements只供避重，不继承其中的旧风格、动作或尺寸。' : ''}\n${ornamentSceneStyleRules({ style, scene: context.scene, character: context.character, variationIndex: context.elementVariationIndex }, f.directionNumber)}\n风格中的木材、石材、织物和配色仅用于场景与服装，不能改变本款产品结构与材质。必须遵守固定框架，一镜到底；摆台原位静止的方向只允许指定的背景生活活动和一次主运镜，背景活动不能变成抢主体的第二条剧情。分时间段写明初始状态、指定人物动作完成的节点、摄影机短路径和结尾稳定展示；有搬放才写手的承托、落稳与撤离顺序。${f.directionNumber === ORNAMENT_RED_CLOTH_DIRECTION ? '必须有一只手抓红布上角揭布，可以仅手入镜、不露脸；结尾留出完整展示产品的时间。' : '明确无人镜头不添加手；有人物的场景镜头也不能临时增加触碰产品的手。'}严禁采纳摘要或用户计划中的拆架、盘面分离动作。时长取${range.durationMin}至${range.durationMax}之间整数；以“总时长：X秒”结尾。`;
}

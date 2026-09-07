// PVC 贴画与卷轴的规则独立维护；方向编号只在各自产品类型内有意义。
export const STICKER_MARKER = '【PVC背胶贴画物理锁定】';
export const STICKER_FINAL_MARKER = '【PVC墙贴最终几何裁决】';
export const STICKER_RASTER_MARKER = '【PVC正面不可拆分纹理锁定】';
export const STICKER_COLOR_MARKER = '【PVC产品视觉与哑光表面绝对保真锁定】';
export const isStickerProduct = (profile) => profile?.productType === 'sticker';
export const productUsageHash = (hash, type) => type === 'sticker' && hash ? `sticker:${hash}` : String(hash || '');

export function normalizeStickerProfile(profile = {}) {
  const dimension = (value, fallback) => {
    if (value === undefined || value === '') return fallback;
    const number = Number(value);
    if (!Number.isFinite(number) || number < 10 || number > 500) throw new Error('贴画宽高必须在10至500厘米之间');
    return number;
  };
  const widthCm = dimension(profile.widthCm, 180);
  const heightCm = dimension(profile.heightCm, 60);
  return {
    ...profile, productType: 'sticker', widthCm, heightCm,
    ratio: `${widthCm}:${heightCm}`,
    material: '柔性PVC背胶贴画，背面白色，配可揭离的背膜',
    frameStructure: '正面是已经印刷完成且不可拆分的一张平面彩色图层；参考图内所有颜色都只是同一膜面的印刷像素，没有独立外围部件、背板、木条、挂绳或挂钩',
  };
}

const entries = [
  // 1—10：人物与已经贴好的成品
  ['画旁自然讲解', '茶室中人物站在已贴好的横款字画侧前方，对镜头持续自然讲解并克制指示画面，不遮挡主要文字。5—6秒；是否出声服从声音开关。'],
  ['走近欣赏', '客厅全景中横款贴画从第0秒起就完全贴平，并与沙发背景墙及沙发的水平中心线对齐。人物空手走近欣赏后侧让出画面，镜头轻推到产品中景；人物全程不搬画、不托画、不安装。'],
  ['长辈讲字', '书房中长辈指向已贴好的字画向年轻成年人讲解，对方点头回应；两人脸型、发型、衣着明显不同，镜头结束于文字局部。'],
  ['双人品评', '茶室两名外貌衣着不同的成年人先同框看画，一人克制指示，另一人回应并侧让，镜头横移以完整贴画收尾。'],
  ['整理软装让出画', '客厅人物整理沙发靠垫后站到一侧，露出一直存在的已贴好字画，镜头结束于画与沙发搭配。'],
  ['书房起身看画', '开场直接采用正面中景，无遮挡看见侧边人物和整幅已贴好的字画；横向贴画从首帧起占9:16画面宽度约55%—65%，参考图对应的完整正面位图已经一次性清楚存在，不使用全屋大远景。人物双手空置，从单人阅读椅自然起身并转向字画，镜头跟随视线做很短的轻推到文字或印章局部。桌面不放书本、散页、白纸或薄膜，不设计放书、翻页及任何白色物体经过镜头前方的动作。'],
  ['茶席主人介绍', '主人在茶桌旁对镜头介绍墙上的成品字画，手势指示画意而不触碰揭起边缘，镜头微横移保持完整字画。'],
  ['办公室访客看画', '现代经理办公室中，办公桌与两把独立访客椅保持正常尺度；两位不同长相、不同服装的成年人从办公桌侧方走近企业文化墙，停步看画并自然交流，随后侧让，镜头推向已贴好的画。全片不出现住宅沙发、客厅茶几或成排靠垫。'],
  ['手机取景留念', '人物从侧后方举手机为已贴好的字画取景，再放下手机让出主体；不拍手机屏幕特写，收尾聚焦字画。'],
  ['轻触成品表面', '横款贴画从第0秒起就居中且完全贴平。人物只用指腹轻划靠近边缘的正面印刷表面后移开，手指不得伸到产品背后，不抓边、不托举、不揭膜、不搬动、不旋转、不重新安装；镜头轻推展示PVC薄片与墙面无缝贴合。'],
  // 11—20：成品融入生活，非床头默认场景
  ['茶室斟茶', '横款贴画固定在茶席后方宽墙面，人物给一只茶杯注茶；镜头由茶杯前景轻微升起并落在完整字画上。'],
  ['客厅阅读', '已贴好字画位于沙发背景墙，人物坐着自然翻页，镜头从阅读场景轻推向字画，保留生活前景。'],
  ['书房落笔', '书房人物完成一笔并放下笔，镜头由桌面连续上移到已贴好的横款字画，以画面内容收尾。'],
  ['办公室会客递杯', '小型办公室会客区使用两把彼此分开的单人会客椅和一张圆形边桌，两位外貌衣着不同的人递杯交流；已贴好的横画位于会客椅组合对应的宽墙面中心，镜头轻横移后集中展示画，不生成住宅三人沙发。'],
  ['餐厅花瓶', '餐厅人物调整花瓶后退出主构图，镜头越过花瓶前景展示餐边柜上方已贴好的字画。'],
  ['客厅开帘', '人物轻拉窗帘引入自然光，镜头从帘边平稳转向已贴好的横画，光线变化合理不过曝。'],
  ['茶室整理茶具', '人物把一件茶具归位后落座，镜头沿茶桌小幅侧移，结尾仍以已贴好的横款字画为主体。'],
  ['书房灯下阅读', '傍晚人物打开台灯并翻书，背景横款贴画已固定，镜头轻推向画，不把整幅画染成过亮金色。'],
  ['客厅绿植前景', '人物给绿植少量浇水后把手收回，镜头由叶片前景侧移揭示一直在墙上的字画，不能扫过画。'],
  ['无人茶室氛围', '无人茶室已贴好的字画保持平整固定，窗帘自然微动；镜头由空间全景沿短路径推向画面中景收尾。'],
  // 21—30：摄影路径与印刷细节，不能混入卷轴木条特写
  ['左向右揭示', '5—6秒连续左向右横移，开场空间铺垫不超过1秒，第2秒前完整字画进入画面，移动到以画为中心后不再穿越主体。'],
  ['办公室文化墙右向左揭示', '现代会议室以会议桌边缘和两把独立办公椅形成前景，5—6秒连续右向左横移；开场空间铺垫不超过1秒，第2秒前完整企业文化墙贴画进入画面，收尾聚焦字画而非左侧空墙。全片不出现住宅沙发、客厅茶几或成排靠垫。'],
  ['全景推进文字', '已贴好横款字画与宽沙发同框交代尺寸，沿单一短路径平稳推近至真实文字或印章局部收尾，不为特写改变字画实体尺寸。'],
  ['细节拉远全貌', '从已贴好字画的印刷局部开始，平稳短距离拉远至完整横画及周边墙面，以产品整体为结尾焦点。'],
  ['正面文字巡游', '4—6秒近乎正面沿横款字画从左向右连续扫过真实书法字迹和印章；全片近景，不强行拉远补拍房间。'],
  ['反向画意巡游', '4—6秒近乎正面沿已贴好的画从右向左连续展示参考图真实可见内容，结束仍停在画内，不生成印刷景物动画。'],
  ['正面印刷纹理巡游', '4—6秒保持近乎正面机位，只在字画内部区域从真实书法笔触连续移动到朱红印章与淡墨纹样；镜头不得靠近、追踪或突出产品四周外沿，不把任何印刷色块解释成立体物体。'],
  ['贴墙平面质感', '4—6秒保持近乎正面的轻微侧光近景，展示画芯内部的哑光PVC印刷纹理与墙面完全贴平的整体效果；不拍产品侧面，不沿四周外沿移动，不掀边、不生成第二层画。'],
  ['前景遮挡揭示', '独立茶室的木格屏风或茶桌旁绿植一开始真实遮挡部分已贴好字画，镜头小幅横移让完整横画可见，以画为主体收尾；场景内不混入客厅家具。'],
  ['低位升起看画', '书房由桌边略低机位沿短路径平稳升起，到完整横款字画居中即停止上扫，最后微动仍围绕画，不扫向天花板。'],
  // 31—40：柔性形态、揭膜及局部安装。一次只演示可完成的一段，不压缩完整施工。
  ['双人正面展示', '两位不同脸型发型衣着的成年人在书房空地各扶长幅贴画一端，正面朝镜头，画身有自然轻微弯曲与下垂，保持横向原比例；只展示未安装成品，不揭膜不上墙。'],
  ['双人搬运比位', '两名不同外貌衣着的成年人各扶一端，把尚带背膜的长幅贴画移到茶室宽墙前短暂比位；双手始终承托，不松手、不假装已粘牢。'],
  ['桌面揭膜起角', '4—6秒近景在足够长的干净操作台上，一手稳住贴画，另一手从背面角部提起单独的背膜；白色背面属于画身，背膜与画身清楚分离，只揭一小段，不演示完整施工。'],
  ['双人局部揭膜', '两人在宽阔整洁的铺贴工作区各承托一端，一人保持画身稳定，另一人从背面揭开一小段背膜；揭下的膜始终被手持有并可追踪，白色画背仍留在PVC主体上；结束仍为手持未安装状态。'],
  ['左端向右局部贴合', '茶室墙面上左端已粘牢，中部尚未贴合由手承托；一手向右揭开少量背膜，一手沿新增裸露背胶区域向右压贴，只完成短区间，右端余料仍合理由手托住。'],
  ['右端向左局部贴合', '书房墙面右端已粘牢，左侧未贴区域由手支撑；一手向左揭少量背膜，另一手跟随由右向左压贴，已贴区域不移动，白色画背不被撕成第二幅画。'],
  ['卷材沿轴展开', '操作长桌上由双手控制未安装的横幅卷材，卷体绕自身竖向轴线旋转并向一侧释放画身；只拍一段滚动展开，背膜仍附着，不凭空新增木杆、不把卷体横滑当展开。'],
  ['未贴区域落墙压实', '局部近景开始时其余画面已粘牢，仅右端小段未粘且自然弯曲露出白色画背，背膜已揭除并置于台面；一手托住，一手使小段落墙压实，不能先撕起已粘部位。'],
  ['安装最后压边', '客厅字画已完成贴合，仅做最后检查，人物手掌从中部向边缘轻压并移开，镜头拉至完整成品；不重复揭膜，不卷起，不移动已贴区域。'],
  ['双人完成后让出', '两名外貌衣着不同的成年人在茶室分别对已基本贴合的左右端做最后轻压，先后松手侧退让出完整画面；只展示收尾，不再安装第二次。'],
];

export const STICKER_FRAMEWORKS = entries.map(([title, action], index) => ({
  directionNumber: index + 1, title, action,
  state: index < 30 ? 'installed' : 'installation',
  closeDetail: [25, 26, 27, 28, 33].includes(index + 1),
}));
const STICKER_WALL_INSTALL_DIRECTIONS = new Set([35, 36, 38, 39, 40]);
const STICKER_LIVING_ROOM_DIRECTIONS = new Set([2, 5, 10, 12, 16, 19, 23, 39]);
const STICKER_TEA_ROOM_DIRECTIONS = new Set([1, 4, 7, 11, 17, 20, 29, 32, 35, 40]);
const STICKER_STUDY_DIRECTIONS = new Set([3, 6, 9, 13, 18, 24, 28, 30, 31, 36, 38]);

const STICKER_LIVING_ROOM_LAYOUTS = {
  2: '暖灰色低靠背布艺三人沙发',
  5: '焦糖色皮质三人沙发',
  10: '奶油白模块布艺沙发',
  12: '浅燕麦色亚麻三人沙发',
  16: '雾灰色现代直排沙发',
  19: '橄榄灰灯芯绒三人沙发',
  23: '米灰色简约布艺三人沙发',
  39: '棕褐色皮质直排沙发',
};

function stickerSceneLayoutRule(direction) {
  const number = Number(direction);
  if (STICKER_LIVING_ROOM_DIRECTIONS.has(number)) {
    const sofa = STICKER_LIVING_ROOM_LAYOUTS[number] || '现代三人沙发';
    return `本方向固定为客厅场景，使用${sofa}作为主家具；贴画水平中心与完整沙发水平中心重合。不得把沙发替换成每条都相同的浅灰样板间沙发。`;
  }
  if (STICKER_TEA_ROOM_DIRECTIONS.has(number)) {
    return '本方向固定为独立茶室，主家具只能是实木茶桌、茶椅、茶凳、茶柜或博古架，贴画位于主茶桌对应的完整墙面中心。茶室内严禁出现三人沙发、客厅沙发、沙发扶手、沙发靠背或成排沙发靠垫。';
  }
  if (STICKER_STUDY_DIRECTIONS.has(number)) {
    return '本方向固定为书房或阅读区，主家具只能是书桌、书架、单人阅读椅、矮书柜或边几，贴画位于书桌或阅读区对应的完整墙面中心。书房内严禁出现三人沙发、客厅沙发、沙发扶手、沙发靠背或成排沙发靠垫。';
  }
  if (number === 8) {
    return '本方向固定为现代经理办公室，使用办公桌和两把彼此分开的独立访客椅，贴画位于办公桌侧后方的完整企业文化墙中心；不得使用住宅三人沙发、客厅茶几组合或成排沙发靠垫。';
  }
  if (number === 14) {
    return '本方向固定为小型办公室会客区，使用两把彼此分开的单人会客椅和圆形边桌，贴画与会客椅组合水平居中；不得使用住宅三人沙发、客厅茶几组合或成排沙发靠垫。';
  }
  if (number === 22) {
    return '本方向固定为现代会议室，使用会议桌边缘和两把独立办公椅形成前景，贴画位于会议室企业文化墙中心；不得使用住宅三人沙发、客厅茶几组合或成排沙发靠垫。';
  }
  if (number === 15) {
    return '本方向固定为餐厅，使用餐桌、独立餐椅、餐边柜和花瓶，贴画与餐桌或餐边柜组合水平居中；严禁出现沙发及客厅茶几。';
  }
  if ([21, 25, 26, 27].includes(number)) {
    return '本方向使用安静的文化走廊、展陈墙或纯墙面产品近景，只出现连续墙面、窄边柜或局部绿植；严禁出现沙发、客厅茶几和成排靠垫。';
  }
  if ([33, 34, 37].includes(number)) {
    return '本方向使用宽阔整洁的工作室或铺贴操作区，以长操作台和独立工作椅为主；严禁出现沙发、客厅茶几和成排靠垫。';
  }
  return '本方向使用与创意正文一致的单一功能空间，主家具必须服务于该空间；除正文明确写明客厅外，严禁自动补入沙发、客厅茶几或成排靠垫。';
}

function visiblePercentRange(productWidth, referenceMin, referenceMax) {
  const min = Math.round((productWidth / referenceMax) * 100);
  const max = Math.round((productWidth / referenceMin) * 100);
  return `${min}%—${max}%`;
}

function stickerSceneScaleRule(profile, direction) {
  const p = normalizeStickerProfile(profile);
  const number = Number(direction);
  const common = `尺寸构图必须从真实的${p.widthCm}×${p.heightCm}厘米成品和正常住宅尺度推导，先建立正常大小的房间、人物与家具，再放入产品；不得把墙面、人物或家具缩小来衬托产品，也不得把墙面无限放大而把产品缩成难以辨认的小条。使用45—55mm等效标准透视，空间不足时摄影机后退，不使用超广角。`;
  if (STICKER_LIVING_ROOM_DIRECTIONS.has(number)) {
    return `${common}同景深完整三人沙发按宽210—240厘米表现，贴画宽度应约占沙发总宽的${visiblePercentRange(p.widthCm, 210, 240)}；贴画下边缘与沙发靠背顶部保留约20—35厘米空墙，左右围绕沙发中线对称留白。不得偏离上述可见比例来夸大或缩小产品。`;
  }
  if (STICKER_TEA_ROOM_DIRECTIONS.has(number)) {
    return `${common}茶桌后方用于展示的连续功能墙按宽320—400厘米表现，贴画宽度应约占这段墙宽的${visiblePercentRange(p.widthCm, 320, 400)}；贴画视觉中心离地约145—155厘米，下沿与茶桌或茶柜顶部保持约35—55厘米呼吸空间，左右留白基本均衡。`;
  }
  if (STICKER_STUDY_DIRECTIONS.has(number)) {
    return `${common}书桌或阅读区对应的连续功能墙按宽300—360厘米表现，贴画宽度应约占这段墙宽的${visiblePercentRange(p.widthCm, 300, 360)}；贴画视觉中心离地约145—155厘米，下沿与书桌、矮柜顶部保留约30—50厘米空墙，不压住书架或灯具。`;
  }
  if ([8, 14, 22].includes(number)) {
    return `${common}办公室或会客室主墙按宽360—450厘米表现，贴画宽度应约占主墙宽的${visiblePercentRange(p.widthCm, 360, 450)}；贴画视觉中心离地约145—160厘米，与会议桌、办公桌或独立会客椅组合居中，周围保留克制而清楚的空墙。`;
  }
  if (number === 15) {
    return `${common}餐桌或餐边柜对应的功能墙按宽320—400厘米表现，贴画宽度应约占墙宽的${visiblePercentRange(p.widthCm, 320, 400)}；贴画下沿与餐边柜顶部保留约25—45厘米空墙，画、柜与餐桌中心轴协调。`;
  }
  if ([21, 25, 26, 27].includes(number)) {
    return `${common}走廊或展陈墙的有效连续墙段按宽300—420厘米表现，贴画宽度应约占墙段宽的${visiblePercentRange(p.widthCm, 300, 420)}；完整展示时视觉中心离地约145—155厘米，左右不得贴近墙角或门框。近景只代表摄影机靠近，不能改变产品实体尺寸。`;
  }
  return `${common}未安装产品与宽200—240厘米的长操作台处于相近景深，贴画展开宽度应约占操作台长度的${visiblePercentRange(p.widthCm, 200, 240)}；工作台和人物保持正常尺度，画身不得被拉伸、压缩或为了塞进9:16画面而改变比例。`;
}

function stickerRasterIdentityRule(framework) {
  const visibleState = framework.state === 'installed'
    ? '第0帧直接显示参考图对应的完整印刷画面，第一帧与最后一帧的产品画面完全相同'
    : '正面任何已经进入取景框的区域，都直接显示参考图在该区域对应的最终印刷画面，并在后续帧保持不变';
  return `${STICKER_RASTER_MARKER}${visibleState}。这张贴画就是上传参考图这张印刷品本身：贴画的外边缘就是参考图最外层印刷内容的外沿，参考图四周如带有白色留白，这圈留白不属于贴画、不出现在画面上，贴画外沿之外直接就是墙面。参考图整体是一张印在同一张PVC膜面上的平面位图，文字、印章、底色和最外围的印刷色带都是这张图上的内容，作为一个整体随镜头同步运动，内部零相对位移、零层次视差。参考图外围的印刷色带属于画面本身的有效内容：若是一圈闭合矩形，则上边、下边、左边、右边四边连续完整、四角自然相接，宽度和位置与参考图一致，从第一次可见起保持到最后一帧。整张印刷画面一次成型，不逐边生长、不中途补色或淡出；裁切线以内的原有印刷颜色全程保留，不删除、不淡化。`;
}

function stickerColorFidelityRule() {
  return `${STICKER_COLOR_MARKER}上传参考图是产品全部视觉信息的唯一依据：贴画的颜色就是参考图的颜色。参考图外围的印刷色带保持参考图原本的颜色、浓度和宽度，与底色形成和参考图一样清楚的明暗对比，从首帧到末帧不变；文字、印章和底色都保持参考图中的样子。这圈外围色带是印在膜面上的平面图案，属于贴画画面本身，不是画框，也不是浅色装裱边。画面整体可以有温暖的场景色调和柔和光线，但贴画上各颜色之间的相对深浅关系始终服从参考图，深色区域不被提亮，浅色底不被染色。贴画是贴在墙上的哑光柔性PVC印刷薄片，表面没有反光、高光和倒影。镜头推近、拉远、侧移期间，贴画的颜色和内容逐帧稳定。`;
}

function sanitizeStickerProductColorLabels(promptText) {
  const source = String(promptText || '');
  const creativeBodyMarker = '【贴画创意正文】';
  const markerIndex = source.lastIndexOf(creativeBodyMarker);
  const productStart = markerIndex >= 0 ? markerIndex + creativeBodyMarker.length : 0;
  const creativeMatch = source.slice(productStart).search(/创意内容\s*[：:]/);
  if (creativeMatch < 0) return source;
  const creativeIndex = productStart + creativeMatch;
  const legacyRepaired = source.slice(productStart, creativeIndex)
    // 修复旧版本把负面词“亮面、光面、镜面”误替换成三次“哑光表面”形成的自相矛盾文本。
    .replace(/不呈现(?:哑光柔性PVC印刷表面[、，,]?){2,}/g, '不呈现亮面、光面、镜面、')
    .replace(/哑光柔性PVC印刷表面高光/g, '镜面高光');
  const productSection = legacyRepaired
    .split(/([。；;\n])/)
    .map((clause) => {
      // “禁止浅棕/亮面/镜面”等负面句必须原样保留，不能再被正向修正器反向污染。
      if (!clause || /^[。；;\n]$/.test(clause) || /禁止|严禁|不得|不能|不呈现|不出现|无(?:窗户|倒影|反光|高光)/.test(clause)) return clause;
      return clause
        // 产品外围色名经常由文本模型臆测为浅色；改回“参考图原色”比硬编码某一种商品颜色安全。
        .replace(/浅棕褐色|浅棕色|浅褐色|淡棕褐色|淡棕色|淡褐色/g, '参考图对应区域的原始印刷颜色')
        // 删除模型在正向产品描述里臆造的亮面材质；创意内容中的玻璃家具不会被误改。
        .replace(/(?:高亮|亮面|光面|镜面)(?:的)?(?:PVC)?(?:印刷)?(?:表面|材质|质感|光泽)?/g, '哑光柔性PVC印刷表面')
        .replace(/(?:玻璃般|玻璃式|玻璃质感的?)(?:反光|光泽|高光|表面|质感)?/g, '哑光柔性PVC印刷表面');
    })
    .join('');
  return `${source.slice(0, productStart)}${productSection}${source.slice(creativeIndex)}`;
}

function compactStickerCreativeBody(promptText) {
  const source = String(promptText || '').trim();
  const creative = source.match(/创意内容\s*[：:]\s*([\s\S]*?)(?=\n?\s*负面约束\s*[：:]|\n?\s*总时长\s*[：:]|$)/)?.[1]?.trim();
  if (!creative) return source;
  const duration = source.match(/总时长\s*[：:]\s*(\d+)\s*秒/)?.[1];
  // 产品结构、颜色、表面与负面约束全部由确定性系统规则提供。
  // 文本模型只保留场景和镜头创意，避免把同一套“禁止边框”重复数次后反向压掉参考图原有印刷边线。
  return `创意内容：${creative}${duration ? `\n总时长：${duration}秒` : ''}`;
}
export function getStickerFramework(direction) {
  const framework = STICKER_FRAMEWORKS[Number(direction) - 1];
  if (!framework) throw new Error('贴画方向编号必须为1至40');
  return framework;
}
export function stickerDuration(direction, min = 5, max = 10) {
  if ([1, 21, 22].includes(Number(direction))) return { durationMin: 5, durationMax: 6 };
  if ([25, 26, 27, 28, 33].includes(Number(direction))) return { durationMin: 4, durationMax: 6 };
  const durationMin = Math.min(15, Math.max(4, Number(min) || 5));
  return { durationMin, durationMax: Math.min(15, Math.max(durationMin, Number(max) || 10)) };
}

export function stickerPhysicalRules(profile, direction) {
  const p = normalizeStickerProfile(profile);
  const f = getStickerFramework(direction);
  const sceneLayoutRule = stickerSceneLayoutRule(f.directionNumber);
  const sceneScaleRule = stickerSceneScaleRule(p, f.directionNumber);
  const rasterIdentityRule = stickerRasterIdentityRule(f);
  const colorFidelityRule = stickerColorFidelityRule();
  return `${STICKER_MARKER}
框架方向：${f.directionNumber}。
产品类型：PVC背胶贴画。尺寸：宽${p.widthCm}厘米、高${p.heightCm}厘米，实体宽高比${p.widthCm}:${p.heightCm}，与视频画幅比例无关。保持该真实尺寸，不使用卷轴的小尺寸补偿，不缩小人物或家具。
${f.state === 'installed'
    ? '材质为已经完成施工并永久贴实的单层柔性PVC印刷薄片，本片只展示正面完成态：参考图的整个正面是一张平面彩色印刷图层，全部区域位于同一张连续薄片、同一墙面深度。墙上只有这张印刷薄片本身，没有木条、挂绳、挂钩、轴头或任何施工材料，不生成实体木框、画框、背板或玻璃面。二维文字、印章和印刷图层不变成三维物体，文字笔画保持不变。'
    : '材质为柔性PVC薄片，正面为参考图对应的完整平面印刷图层，背面白色，有可揭离的背膜。正面全部颜色区域位于同一张连续薄片、同一深度；没有木条、挂绳、挂钩或实体框，不使用小胶带定位，不生成实体木框、画框、背板或玻璃面。白色画背和印刷正面属于同一张PVC主体，背膜才是另一个被揭离的物体，不得把白色画背撕成第二张画；被揭下的膜由手持有或放到明确可见的台面，不能凭空消失。二维文字、印章和印刷图层不变成三维物体，文字笔画保持不变。'}
${rasterIdentityRule}
${colorFidelityRule}
${f.state === 'installed' ? `本方向为已安装成品展示，以下状态高于创意正文：第0秒起墙上已经存在最终完成态的整张横画，整个表面与墙面全幅无缝贴合，四角及四边全部压实，二者之间没有空气层或可见间距。参考图对应的完整正面位图从第0帧起一次性、完整、清晰存在，所有像素的颜色和相对位置逐帧不变。人物始终空手并与产品表面保持距离，产品全片都是同一个贴墙静态平面；唯一变化来自镜头、人物和合理环境微动。贴画主体逐帧保持同一${p.widthCm}:${p.heightCm}横向外形和同一墙面坐标，首帧状态就是末帧状态。` : `本方向只执行以下初始状态和动作：${f.action} 未粘区域允许在手支撑下自然弯曲和下垂，不得拉伸或橡胶变形；已粘区域保持固定。贴合只能随手揭膜与压贴逐段推进，已完成后不能再次展开或揭起。演员站地面，不站床、柜子或沙发。`}
${f.directionNumber === 6 ? '方向6开场连续性强制要求：第0秒直接采用无遮挡的正面中景，空手人物、墙面和完整贴画立即处于正常空间关系中；完整横向贴画从首帧起占9:16视频画面宽度约55%—65%，参考图对应的整张正面位图在首帧已经一次性完整清楚，严禁随着推近补充或加深任何外围颜色区域。禁止全屋大远景，禁止把贴画缩在画面远处后再依靠推近补全产品。方向6全片不使用书本、散页、白纸、白布、薄膜、幕布或任何大面积白色物体，不设计放书或翻页动作，镜头前方始终无遮挡；禁止用掀开、翻开、抽走、滑走、擦镜、遮挡后移开的方式揭示场景或贴画。方向6的收尾只能聚焦文字、印章或画芯内部纹理，不得同时展示、靠近或强化产品四周外沿。' : ''}
${(f.state === 'installed' || STICKER_WALL_INSTALL_DIRECTIONS.has(f.directionNumber)) && !f.closeDetail ? `成品位置或预定安装位置必须按本方向功能空间和主家具组合的几何中心布置，不得偏贴在家具一端、门边、墙角或狭窄墙柱上。构图需要人物时让人物站到侧边，不得把贴画挪离中心给人物让位。${sceneLayoutRule}` : sceneLayoutRule}
【本方向空间比例锁定】${sceneScaleRule}${f.state === 'installed' && !f.closeDetail ? '贴画在视频画面中的宽度占比始终不低于40%，人物同框的中景里也不低于此值，保证外围印刷色带清晰可辨。' : ''}
${f.state === 'installed' ? '人物动作只服务于生活化展示或讲解，人物与产品始终分离；产品区域内没有任何自主运动或形态变化。' : '所有物体运动必须由明确手部接触带动。一个动作不能同时既揭膜又凭空压平整幅长画；时长不足时只拍可真实完成的局部步骤，禁止加速赶施工。'}
${f.closeDetail ? '本方向是局部近景，不强制人物全身或房间全景；只因相机靠近呈现细节，产品物理尺寸不变。' : '空间展示用宽阔连续墙面与同景深家具交代尺寸，横幅完整可见且不拉伸；人物不要遮住字画主体。场景严格服从本方向指定的唯一功能空间，不跨场景混搭家具，不默认床头场景。'}
人物数量全程一致；多人必须脸型、发型和服装明显不同，不得复制同一个人。人物正常速度，镜头一条短而明确的路径均匀分配到整个时长，无急加速、急推急拉、甩镜或末尾冲刺。摄影机移动不得导致贴画形态变化。
最后视觉焦点必须落在贴画整体或本方向指定的画内细节，不能扫过贴画继续拍空墙或天花板。保留需要的推进特写，不统一改为中远景收尾。结尾可以自然减速，并保留人物或前景微动，不追加独立静态定妆镜头。`;
}

function sanitizeInstalledStickerCreativeBody(promptText) {
  return String(promptText || '')
    .replace(/[，,]?(?:产品)?背面(?:为)?白色(?:[，,、]?(?:有|带|配有?)?可揭离(?:的)?背膜)?/g, '')
    .replace(/[，,]?(?:背面)?白色(?:配|带|有)可揭离(?:的)?背膜/g, '')
    .replace(/[^。；\n]{0,36}(?:揭下的背膜|背膜凭空消失|背膜全程|白色画背)[^。；\n]{0,36}[。；]?/g, '')
    .replace(/(?:揭膜、|、揭膜|揭膜)/g, '')
    .replace(/背膜/g, '')
    .replace(/白色画背/g, '')
    .replace(/(?:；\s*){2,}/g, '；')
    .replace(/(?:，\s*){2,}/g, '，')
    .trim();
}

export function ensureStickerPrompt(prompt, profile, direction) {
  // 自己生成的旧规则也替换为本次档案快照，不能在重试时叠加不同尺寸。
  const text = String(prompt || '').trim();
  const extracted = text.includes('【贴画创意正文】') ? text.split('【贴画创意正文】').slice(1).join('【贴画创意正文】').trim() : text;
  const p = normalizeStickerProfile(profile);
  const f = getStickerFramework(direction);
  const rawBody = extracted.split(STICKER_FINAL_MARKER)[0].trim();
  const bodyWithoutConstruction = f.state === 'installed' ? sanitizeInstalledStickerCreativeBody(rawBody) : rawBody;
  const body = compactStickerCreativeBody(sanitizeStickerProductColorLabels(bodyWithoutConstruction));
  const positionRule = (f.state === 'installed' || STICKER_WALL_INSTALL_DIRECTIONS.has(f.directionNumber)) && !f.closeDetail
    ? '墙贴的水平中心对准所在功能背景墙及主家具组合的水平中心，人物只能侧让，不能让产品偏离中心。'
    : '';
  const stateRule = f.state === 'installed'
    ? '本方向从首帧到末帧都只展示同一张早已贴好的正面成品；产品本体逐帧保持同一个贴墙静态平面，首帧状态与末帧状态完全相同。'
    : '只执行框架指定的一个局部形态或安装步骤，不增加卷轴动作。';
  const finalRule = `唯一允许出现的产品实体是一张宽${p.widthCm}厘米、高${p.heightCm}厘米的横向哑光柔性PVC印刷膜，就是上传参考图这张印刷品本身：整个正面一次性完整呈现参考图的印刷画面，外围印刷色带四边连续、颜色与参考图一致，是平面印刷图案，不是画框或浅色装裱边。产品裁切线以外直接是普通墙面，没有第二个矩形或任何外围结构。${stateRule}${positionRule}`;
  return `${stickerPhysicalRules(p, direction)}\n\n【贴画创意正文】\n${body}\n\n${STICKER_FINAL_MARKER}\n${finalRule}`;
}

export function inspectStickerPromptIssues(prompt, direction) {
  const f = getStickerFramework(direction);
  const source = String(prompt || '');
  const stickerBody = source.includes('【贴画创意正文】')
    ? source.split('【贴画创意正文】').slice(1).join('【贴画创意正文】').split(STICKER_FINAL_MARKER)[0]
    : source;
  const creative = stickerBody.match(/创意内容\s*[：:]?([\s\S]*?)(?:负面约束\s*[：:]?|$)/)?.[1] || stickerBody;
  const positiveClauses = creative.split(/[。；;\n]/).filter((clause) => clause && !/(?:禁止|严禁|不得|不能|不要|避免|不出现|无)/.test(clause));
  const positive = positiveClauses.join('\n');
  const issues = [];
  if (/【(?:挂画生成尺寸补偿锁定|挂画真实尺寸强制锁定|挂画全程存在与空间连续性强制锁定|卷起挂画滚动展开与下方木条强制锁定)】/.test(source)) {
    issues.push('混入了挂画专用尺寸、挂钩、木条或卷轴规则');
  }
  if (/(?:竖幅|竖版|纵向).{0,8}(?:贴画|墙贴|字画|画面|成品|画框)|(?:贴画|墙贴|字画|画面|成品|画框).{0,8}(?:竖幅|竖版|纵向)/.test(positive)) {
    issues.push('把180×60厘米横向PVC墙贴写成了竖向产品');
  }
  if (/(?:实木|木质|金属).{0,8}(?:边框|画框|框架)|(?:实体|立体).{0,8}(?:边框|画框|框体)|相框|匾额|牌匾|玻璃画框/.test(positive)) {
    issues.push('把正面的二维印刷装饰边线写成了独立立体构件');
  }
  if (f.state === 'installed' && /(?:人物|女士|女性|男士|男性|双手|手部|她|他).{0,30}(?:手持|拿起|托起|托住|搬动|举起|旋转|展开|铺开|贴上墙|安装)|(?:手持|拿起|托起|托住|搬动|举起|旋转|展开|铺开|贴上墙|安装).{0,30}(?:贴画|墙贴|字画|画面|成品)/s.test(positive)) {
    issues.push('已安装展示方向混入了手持、旋转、展开或再次安装产品的动作');
  }
  if (/(?:聚焦|特写|展示|沿着|沿|扫过|清晰看到|突出|强化).{0,28}(?:边框|边线|外沿|外圈|薄边)|(?:边框|边线|外沿|外圈|薄边).{0,20}(?:聚焦|特写|展示|扫过|清晰)/.test(positive)) {
    issues.push('镜头把产品四周外沿单独作为展示对象，容易诱发后生成或立体化');
  }
  if (!STICKER_LIVING_ROOM_DIRECTIONS.has(f.directionNumber) && /沙发|沙发靠垫|客厅茶几/.test(positive)) {
    issues.push('本方向不是客厅，却混入了沙发、沙发靠垫或客厅茶几');
  }
  return issues;
}

export function stickerProfileFromPrompt(prompt) {
  if (!String(prompt || '').trimStart().startsWith(STICKER_MARKER)) return null;
  const match = String(prompt).match(/尺寸：宽([\d.]+)厘米、高([\d.]+)厘米/);
  return normalizeStickerProfile(match ? { widthCm: match[1], heightCm: match[2] } : {});
}

export function buildStickerIdeasRequest(profile, plan, batch, variationRound, avoidIdeas, style) {
  const frameworks = STICKER_FRAMEWORKS.slice(batch * 10, batch * 10 + 10);
  return `你为PVC背胶贴画设计短视频。只输出10个对象的合法JSON数组：[{"id":"1","title":"标题","summary":"具体创意"}]，严格按下面10个方向一一对应，不改变初始状态、安装/成品分类、运镜方向或结尾目标。
档案：${JSON.stringify(normalizeStickerProfile(profile))}
偏好：${JSON.stringify(plan)}；风格：${style.label}，${style.direction}。第${variationRound + 1}轮；避免复述这些旧创意：${JSON.stringify(avoidIdeas || [])}。
40个方向中前30个是已安装展示，后10个才涉及柔性形态和安装。前30个方向的贴画必须在第0秒以前已经贴好，创意不得给它增加手持、搬运、展开、旋转或贴墙动作。每个方向必须服从该方向指定的唯一功能空间及家具，不跨场景混搭；茶室、书房、餐厅、办公室、走廊和工作区不得自动补入住宅沙发或成排靠垫，只有明确标为客厅的方向才允许使用该方向指定的沙发。每条明确地点和2件符合该空间用途的陈设，局部特写例外。产品无挂钩木条挂绳，不使用定位胶带，不套用卷轴尺寸补偿。参考图整个正面只能描述为一张不可拆分的平面印刷位图，不得把任何颜色区域命名或描述成独立框体、相框、匾或外围部件，也不得设计专门拍摄产品四周外沿的镜头。上传参考图是产品内容、颜色、外观、纹理和表面效果的唯一依据；产品只描述为哑光柔性PVC印刷薄片，不根据场景风格给产品换颜色或材质；所选风格只改变环境、人物、家具、服装和光线，不改变产品本身。成品与本方向主家具组合对应的功能墙几何中心对齐。白色画背属于主体，背膜另行揭离。已贴好不能二次展开。人物正常速度，镜头全程平稳均匀推进，结束焦点在画，允许文字、印章和画芯内部纹理特写结尾。只拍时长内真实可完成的动作。
${frameworks.map((f, index) => `${index + 1}. 方向${f.directionNumber}：${f.title}。${f.action}。${stickerSceneLayoutRule(f.directionNumber)}${stickerSceneScaleRule(profile, f.directionNumber)}一镜到底。人物如出现，主色${style.wardrobe[(batch * 10 + index + variationRound * 3) % style.wardrobe.length]}。`).join('\n')}
每条一句具体创意，写明连续动作和镜头路径；同一条只一个场景，人物、布置不得中途变化。不要写完整提示词。`;
}

export function buildStickerVideoRequest(profile, idea, context, style) {
  const f = getStickerFramework(idea.directionNumber);
  const normalizedProfile = normalizeStickerProfile(profile);
  const promptProfile = f.state === 'installed'
    ? { ...normalizedProfile, material: '已经贴实在墙面的单层柔性PVC正面印刷薄片' }
    : normalizedProfile;
  const range = stickerDuration(f.directionNumber, idea.durationMin || context.durationMin, idea.durationMax || context.durationMax);
  return `你是PVC背胶贴画短视频导演。只输出“创意内容”和“总时长”，不要重复产品固定约束，不要另写负面约束，不要解释或Markdown；产品物理规则会由系统在输出后统一添加。最后写总时长：X秒，X须为${range.durationMin}至${range.durationMax}内整数。
${stickerPhysicalRules(profile, f.directionNumber)}
固定档案：${JSON.stringify(promptProfile)}
方向${f.directionNumber}：${f.title}。${f.action}
本轮具体创意：${idea.title}；${idea.summary}
风格：${style.label}，${style.direction}。用户偏好：${JSON.stringify(context)}
上次提示词和avoidElements只是避重资料，不能覆盖当前物理状态。换元素保留本方向动作结构，可更换同类房间布置、人物服装、光线和陈设，不改变产品。视频画幅为${context.ratio || '9:16'}，不是产品实体比例。
一个连续镜头，不切镜。时间轴从0秒无重叠连续到结束；按时长每1—2秒交代实际动作或取景变化，但不为了凑节点给贴好的画增加施工动作。镜头路径长度按整段时间均匀分配；保留近景特写方向。全景看不清小字时不重写小字，不放大实物，不强制远景识别笔画。
真实住宅自然光、柔和阴影、生活纹理和自然人物，不做卡通、三维渲染或塑料皮肤。声音服从偏好，静音时讲解可只有口型。不添加包装、定位胶带、挂钩、木杆或硬框；不要在产品颜色、外围色带、材质观感上做任何发挥——产品始终是参考图那张平面印刷品本身，颜色与对比以参考图为准。场景风格只改变环境和人物。禁止二次展开、横竖旋转、变形、画面漂移、人物克隆和无操作的物体移动。${f.state === 'installed' ? '这是纯成品展示，输出文本中完全不要描述产品背侧、施工材料或任何剥离过程，只描述已经贴实的正面成品。' : ''}已安装方向的最终提示词若出现“手持画、搬画、展开画、旋转画、把画贴上墙”等动作，必须在输出前删除这些动作。`;
}

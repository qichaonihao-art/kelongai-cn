// PVC 贴画与卷轴的规则独立维护；方向编号只在各自产品类型内有意义。
export const STICKER_MARKER = '【PVC背胶贴画物理锁定】';
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
    frameStructure: '装饰边线仅为PVC正面的平面印刷图案，与画芯处于同一薄平面；没有实体边框、背板、木条、挂绳或挂钩',
  };
}

const entries = [
  // 1—10：人物与已经贴好的成品
  ['画旁自然讲解', '茶室中人物站在已贴好的横款字画侧前方，对镜头持续自然讲解并克制指示画面，不遮挡主要文字。5—6秒；是否出声服从声音开关。'],
  ['走近欣赏', '客厅全景中横款贴画从第0秒起就完全贴平，并与沙发背景墙及沙发的水平中心线对齐。人物空手走近欣赏后侧让出画面，镜头轻推到产品中景；人物全程不搬画、不托画、不安装。'],
  ['长辈讲字', '书房中长辈指向已贴好的字画向年轻成年人讲解，对方点头回应；两人脸型、发型、衣着明显不同，镜头结束于文字局部。'],
  ['双人品评', '茶室两名外貌衣着不同的成年人先同框看画，一人克制指示，另一人回应并侧让，镜头横移以完整贴画收尾。'],
  ['整理软装让出画', '客厅人物整理沙发靠垫后站到一侧，露出一直存在的已贴好字画，镜头结束于画与沙发搭配。'],
  ['书房起身看画', '人物放下手中的书，从阅读椅起身转向已贴好的字画，镜头跟随视线轻推到画面局部。'],
  ['茶席主人介绍', '主人在茶桌旁对镜头介绍墙上的成品字画，手势指示画意而不触碰揭起边缘，镜头微横移保持完整字画。'],
  ['朋友来访看画', '会客区两位不同长相、不同服装的成年人并肩经过，停步看画并自然交流，镜头推向已贴好的画，不切到其他房间。'],
  ['手机取景留念', '人物从侧后方举手机为已贴好的字画取景，再放下手机让出主体；不拍手机屏幕特写，收尾聚焦字画。'],
  ['轻触成品表面', '横款贴画从第0秒起就居中且完全贴平。人物只用指腹轻划靠近边缘的正面印刷表面后移开，手指不得伸到产品背后，不抓边、不托举、不揭膜、不搬动、不旋转、不重新安装；镜头轻推展示PVC薄片与墙面无缝贴合。'],
  // 11—20：成品融入生活，非床头默认场景
  ['茶室斟茶', '横款贴画固定在茶席后方宽墙面，人物给一只茶杯注茶；镜头由茶杯前景轻微升起并落在完整字画上。'],
  ['客厅阅读', '已贴好字画位于沙发背景墙，人物坐着自然翻页，镜头从阅读场景轻推向字画，保留生活前景。'],
  ['书房落笔', '书房人物完成一笔并放下笔，镜头由桌面连续上移到已贴好的横款字画，以画面内容收尾。'],
  ['会客区递杯', '办公室会客区两位外貌衣着不同的人递杯交流，已贴好的横画在宽墙面上，镜头轻横移最后集中展示画。'],
  ['餐厅花瓶', '餐厅人物调整花瓶后退出主构图，镜头越过花瓶前景展示餐边柜上方已贴好的字画。'],
  ['客厅开帘', '人物轻拉窗帘引入自然光，镜头从帘边平稳转向已贴好的横画，光线变化合理不过曝。'],
  ['茶室整理茶具', '人物把一件茶具归位后落座，镜头沿茶桌小幅侧移，结尾仍以已贴好的横款字画为主体。'],
  ['书房灯下阅读', '傍晚人物打开台灯并翻书，背景横款贴画已固定，镜头轻推向画，不把整幅画染成过亮金色。'],
  ['客厅绿植前景', '人物给绿植少量浇水后把手收回，镜头由叶片前景侧移揭示一直在墙上的字画，不能扫过画。'],
  ['无人茶室氛围', '无人茶室已贴好的字画保持平整固定，窗帘自然微动；镜头由空间全景沿短路径推向画面中景收尾。'],
  // 21—30：摄影路径与印刷细节，不能混入卷轴木条特写
  ['左向右揭示', '5—6秒连续左向右横移，开场空间铺垫不超过1秒，第2秒前完整字画进入画面，移动到以画为中心后不再穿越主体。'],
  ['右向左揭示', '5—6秒连续右向左横移，开场空间铺垫不超过1秒，第2秒前完整字画进入画面，收尾聚焦字画而非左侧空墙。'],
  ['全景推进文字', '已贴好横款字画与宽沙发同框交代尺寸，沿单一短路径平稳推近至真实文字或印章局部收尾，不为特写改变字画实体尺寸。'],
  ['细节拉远全貌', '从已贴好字画的印刷局部开始，平稳短距离拉远至完整横画及周边墙面，以产品整体为结尾焦点。'],
  ['正面文字巡游', '4—6秒近乎正面沿横款字画从左向右连续扫过真实书法字迹和印章；全片近景，不强行拉远补拍房间。'],
  ['反向画意巡游', '4—6秒近乎正面沿已贴好的画从右向左连续展示参考图真实可见内容，结束仍停在画内，不生成印刷景物动画。'],
  ['二维装饰边线细节', '4—6秒近景沿已经贴实的正面装饰边线移动至画芯；装饰边线只是平面油墨图案，和画芯处于同一薄片、同一墙面深度，不形成任何实体构件或悬空结构。'],
  ['贴墙薄边细节', '4—6秒轻微侧角近景展示已经压实的PVC薄边与墙面接触，连续移向印刷画面；不掀边、不生成第二层画。'],
  ['前景遮挡揭示', '茶室屏风或客厅绿植一开始真实遮挡部分已贴好字画，镜头小幅横移让完整横画可见，以画为主体收尾。'],
  ['低位升起看画', '书房由桌边略低机位沿短路径平稳升起，到完整横款字画居中即停止上扫，最后微动仍围绕画，不扫向天花板。'],
  // 31—40：柔性形态、揭膜及局部安装。一次只演示可完成的一段，不压缩完整施工。
  ['双人正面展示', '两位不同脸型发型衣着的成年人在书房空地各扶长幅贴画一端，正面朝镜头，画身有自然轻微弯曲与下垂，保持横向原比例；只展示未安装成品，不揭膜不上墙。'],
  ['双人搬运比位', '两名不同外貌衣着的成年人各扶一端，把尚带背膜的长幅贴画移到茶室宽墙前短暂比位；双手始终承托，不松手、不假装已粘牢。'],
  ['桌面揭膜起角', '4—6秒近景在足够长的干净操作台上，一手稳住贴画，另一手从背面角部提起单独的背膜；白色背面属于画身，背膜与画身清楚分离，只揭一小段，不演示完整施工。'],
  ['双人局部揭膜', '两人在客厅空地各承托一端，一人保持画身稳定，另一人从背面揭开一小段背膜；揭下的膜始终被手持有并可追踪，白色画背仍留在PVC主体上；结束仍为手持未安装状态。'],
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
  return `${STICKER_MARKER}
框架方向：${f.directionNumber}。
产品类型：PVC背胶贴画。尺寸：宽${p.widthCm}厘米、高${p.heightCm}厘米，实体宽高比${p.widthCm}:${p.heightCm}，与视频画幅比例无关。保持该真实尺寸，不使用卷轴的小尺寸补偿，不缩小人物或家具。
材质为柔性PVC薄片，正面为参考图的印刷字画，背面白色，有可揭离的背膜。参考图中看似边框的部分只能理解为印在PVC正面的二维装饰边线：装饰边线、画芯和外沿处于同一张连续薄片、同一墙面深度，厚度接近墙贴且不可见，不是真框。禁止生成实体木框、匾框、画框侧壁、背板、内凹画芯、凸起包边、四角拼缝、金属框、玻璃面、框体高光或沿框投到墙上的立体阴影。没有木条、挂绳、挂钩、轴头或实体框，不使用小胶带定位。
白色画背和印刷正面属于同一张PVC主体；背膜才是另一个被揭离的物体，不得把白色画背撕成第二张画。背膜按参考素材表现，不确定透明度时不要虚构多层；被揭下的膜由手持有或放到明确可见台面，不能凭空消失。二维字画、印章和正面装饰边线不能变成真实三维物体，禁止改字、增减笔画、纹理流动。
${f.state === 'installed' ? `本方向为已安装展示，以下状态高于创意正文：贴画在第0秒以前已经完成施工，第0秒起整张横画的背胶面与墙面全幅无缝贴合，四角及四边全部压实，画与墙之间不存在空气层或可见间距。全片禁止人物手持贴画，禁止拿起、托举、搬运、旋转、横竖转换、卷起、展开、揭膜、贴墙、扶正或再次安装；禁止从竖幅变横幅、从卷材变成品或从小画变大画。只有镜头、人物和合理环境微动，贴画主体逐帧保持同一${p.widthCm}:${p.heightCm}横向外形和同一墙面坐标。开场未见画只能因取景框外或真实前景遮挡；若创意正文出现与此冲突的安装动作，一律删除冲突动作而不是改变产品状态。` : `本方向只执行以下初始状态和动作：${f.action} 未粘区域允许在手支撑下自然弯曲和下垂，不得拉伸或橡胶变形；已粘区域保持固定。贴合只能随手揭膜与压贴逐段推进，已完成后不能再次展开或揭起。演员站地面，不站床、柜子或沙发。`}
${(f.state === 'installed' || STICKER_WALL_INSTALL_DIRECTIONS.has(f.directionNumber)) && !f.closeDetail ? '成品位置或预定安装位置必须按所依附功能墙面的几何中心布置：沙发背景墙中，贴画水平中心与完整三人沙发水平中心基本重合；茶室、书房或会客区中，与主要茶桌、书桌或主家具组合的水平中心基本重合。不得偏贴在家具一端、门边、墙角或狭窄墙柱上。构图需要人物时让人物站到侧边，不得把贴画挪离中心给人物让位。' : ''}
所有物体运动必须由明确手部接触带动。一个动作不能同时既揭膜又凭空压平整幅长画；时长不足时只拍可真实完成的局部步骤，禁止加速赶施工。
${f.closeDetail ? '本方向是局部近景，不强制人物全身或房间全景；只因相机靠近呈现细节，产品物理尺寸不变。' : '空间展示用宽阔连续墙面与同景深家具交代尺寸，横幅完整可见且不拉伸；人物不要遮住字画主体。以茶室、客厅、书房为主，不默认床头场景。'}
人物数量全程一致；多人必须脸型、发型和服装明显不同，不得复制同一个人。人物正常速度，镜头一条短而明确的路径均匀分配到整个时长，无急加速、急推急拉、甩镜或末尾冲刺。摄影机移动不得导致贴画形态变化。
最后视觉焦点必须落在贴画整体或本方向指定的画内细节，不能扫过贴画继续拍空墙或天花板。保留需要的推进特写，不统一改为中远景收尾。结尾可以自然减速，并保留人物或前景微动，不追加独立静态定妆镜头。`;
}

export function ensureStickerPrompt(prompt, profile, direction) {
  // 自己生成的旧规则也替换为本次档案快照，不能在重试时叠加不同尺寸。
  const text = String(prompt || '').trim();
  const body = text.includes('【贴画创意正文】') ? text.split('【贴画创意正文】').slice(1).join('【贴画创意正文】').trim() : text;
  return `${stickerPhysicalRules(profile, direction)}\n\n【贴画创意正文】\n${body}`;
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
40个方向中前30个是已安装展示，后10个才涉及柔性形态和安装。前30个方向的贴画必须在第0秒以前已经贴好，创意不得给它增加手持、搬运、展开、旋转或贴墙动作。以茶室、客厅、书房为主，不默认床头；每条明确地点和2件合理陈设，局部特写例外。产品无挂钩木条挂绳，不使用定位胶带，不套用卷轴尺寸补偿；所谓边框只能是印在PVC正面的平面装饰边线，不能描述为框体、相框或匾。成品在沙发、茶桌或书桌对应的功能背景墙几何中心。白色画背属于主体，背膜另行揭离。已贴好不能二次展开。人物正常速度，镜头全程平稳均匀推进，结束焦点在画，允许文字特写结尾。只拍时长内真实可完成的动作。
${frameworks.map((f, index) => `${index + 1}. 方向${f.directionNumber}：${f.title}。${f.action}。一镜到底。人物如出现，主色${style.wardrobe[(batch * 10 + index + variationRound * 3) % style.wardrobe.length]}。`).join('\n')}
每条一句具体创意，写明连续动作和镜头路径；同一条只一个场景，人物、布置不得中途变化。不要写完整提示词。`;
}

export function buildStickerVideoRequest(profile, idea, context, style) {
  const f = getStickerFramework(idea.directionNumber);
  const range = stickerDuration(f.directionNumber, idea.durationMin || context.durationMin, idea.durationMax || context.durationMax);
  return `你是PVC背胶贴画短视频导演。输出可直接提交视频模型的中文提示词，不要解释或Markdown。分为产品固定约束、创意内容、负面约束；最后写总时长：X秒，X须为${range.durationMin}至${range.durationMax}内整数。
${stickerPhysicalRules(profile, f.directionNumber)}
固定档案：${JSON.stringify(normalizeStickerProfile(profile))}
方向${f.directionNumber}：${f.title}。${f.action}
本轮具体创意：${idea.title}；${idea.summary}
风格：${style.label}，${style.direction}。用户偏好：${JSON.stringify(context)}
上次提示词和avoidElements只是避重资料，不能覆盖当前物理状态。换元素保留本方向动作结构，可更换同类房间布置、人物服装、光线和陈设，不改变产品。视频画幅为${context.ratio || '9:16'}，不是产品实体比例。
一个连续镜头，不切镜。时间轴从0秒无重叠连续到结束；按时长每1—2秒交代实际动作或取景变化，但不为了凑节点给贴好的画增加施工动作。镜头路径长度按整段时间均匀分配；保留近景特写方向。全景看不清小字时不重写小字，不放大实物，不强制远景识别笔画。
真实住宅自然光、柔和阴影、生活纹理和自然人物，不做卡通、三维渲染或塑料皮肤。声音服从偏好，静音时讲解可只有口型。不添加包装、定位胶带、挂钩、木杆、硬框、背板或玻璃；禁止把印刷装饰边线变成立体匾框，禁止二次展开、横竖旋转、变形、画面漂移、人物克隆和无操作的物体移动。已安装方向的最终提示词若出现“手持画、搬画、展开画、旋转画、把画贴上墙”等动作，必须在输出前删除这些动作。`;
}

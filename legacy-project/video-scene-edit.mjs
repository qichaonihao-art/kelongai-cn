// Versioned editing rules: existing person-replacement jobs keep their contract.
export function validateSceneEditOptions(body) {
  if (String(body.editVersion || '') !== '2') return null;
  const personMode = String(body.personMode || 'keep');
  const faceMode = String(body.faceMode || 'mask');
  if (!['keep', 'generate'].includes(personMode)) throw new Error('请选择有效的人物处理方式');
  if (!['mask', 'no-visible-face'].includes(faceMode)) throw new Error('请选择有效的人脸预处理方式');
  const personDescription = personMode === 'generate' ? String(body.personDescription || '').trim() : '';
  const clothing = String(body.clothing || '').trim();
  const scene = String(body.scene || '').trim();
  if (personDescription.length > 1000) throw new Error('新人物描述最多1000字');
  if (clothing.length > 500) throw new Error('服装调整最多500字');
  if (scene.length > 1000) throw new Error('场景调整最多1000字');
  return { editVersion: 2, personMode, faceMode, personDescription, clothing, scene };
}

export function buildSceneEditPrompt(job, audioRule) {
  const keepPerson = job.personMode !== 'generate';
  return `直接编辑视频1，不分析重拍、不改写脚本，也不重新设计或复刻一条相似视频。
【编辑基准与素材职责】
视频1是画面和时间轴的唯一基准。锁定原视频的镜头数量、顺序、切点、机位、运镜、景别、构图、帧内位置、时长与节奏。未明确授权的内容全部保持原样，不新增人物、物体、镜头、字幕、水印或剧情。
${job.hasProductReference ? '图片1仅作为目标装饰画/产品的款式参考，不是人脸、人物、服装、背景或新场景参考。只提取图中的目标画及其图案、文字、边框外观，忽略参考图片中的房间、拍摄背景、人物和其他道具。将视频1里主要展示、拿持、摆放或悬挂的目标画替换成图片1中的款式。保持原画在视频里的实际大小、位置、数量、朝向、悬挂/拿持方式、边缘透视、光照和阴影；替换随原物体运动，保留手指、身体、道具等真实前后遮挡与接触关系。不要把产品扩大，不替换无关的背景画或道具，不把图片铺满视频，也不改变原有展示动作。' : '本次没有产品参考图：原视频中的画、商品和道具全部保持原样，不自行设计新的产品款式。'}
【人物处理：${keepPerson ? '保留原人物形象' : '生成新人物'}】
${keepPerson ? '尽量保持原人物的整体形象、年龄、性别、发型、体态、肤色、服装、姿态和表情习惯；除下述明确服装调整外，不重新设计演员，不改变年龄或性别。面部保留可见外观线索并自然补全不可见细节，与原人物整体形象和前后帧保持连贯。不得把产品参考图中的人当作目标人物。' : `按文字要求生成一个连贯的新人物，不对应任何上传的指定人脸。新人物描述：${job.personDescription || '由 AI 生成与原视频动作和拍摄环境相适应的自然成年人物'}。保持原人物的位置、动作、朝向、表演节奏和手中产品不变。未明确指定服装时，协调新人物的年龄、性别与服装，不增加夸张配饰。`}
【服装与场景】
${job.clothing ? `服装仅按此要求调整：${job.clothing}。修改颜色时保持原服装款式、材质、褶皱和动作；不连带修改人物或产品。` : keepPerson ? '原服装的颜色、款式、材质全部保持原样。' : '服装按新人物描述自然协调；已有明确服装描述时遵循描述。'}
${job.scene ? `场景仅按此要求调整：${job.scene}。保留原机位、运镜、动作时间线和产品接触关系，不增加切镜或重新编排剧情。` : '原场景、背景、家具、光照及其他陈设全部保持原样。'}
【输入打码与成片面部】
${job.faceMode === 'no-visible-face' ? '用户确认原视频没有可见人脸，本次没有添加打码。保持背面、出画或真实遮挡的状态，不为了展示脸而强行转头、推近或新增人脸。' : `视频1中的人脸马赛克、像素方块或模糊遮脸层，仅是输入阶段的临时预处理，不是原片风格，不属于“其他不变”的保留范围。输出必须清除这些临时遮罩。${keepPerson ? '以保留原人物整体形象为目标，生成自然、清晰且逐帧连贯的面部，不主动更换演员。' : '生成符合新人物描述的自然清晰面部。'}转头、侧脸、移动和说话时不得继续复制遮罩。保留真实的头发、手部及道具遮挡，不改变人物朝向，不增加面部特写。`}
面部清晰程度服从原景别、焦距、景深和光照，不强行放大或锐化。不得在成片重新添加马赛克、黑条、像素遮罩或模糊脸。
【额外调整】
${job.prompt || '没有额外调整，严格执行以上选定范围。'}
额外要求只补充已选择的编辑范围；人物处理方式、服装和场景的明确选择优先，未指定的内容不根据产品图案或台词联想改变。
【声音与口型】
${keepPerson ? audioRule.replace('只替换人物形象，', '仅按上述范围编辑画面，').replaceAll('新人物', '人物') : audioRule}
【最终检查目标】
这是对原视频的局部编辑。只改变目标产品和本次明确选中的人物、服装、场景或声音项目；其他画面与时间轴保持原样。输入临时打码不得保留在成片中。`;
}

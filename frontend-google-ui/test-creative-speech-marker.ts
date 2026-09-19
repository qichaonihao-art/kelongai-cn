import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractHumanSpeechMarker, stripHumanSpeechMarker, HUMAN_SPEECH_MARKER_TOKENS, extractDialogueLines, stripDialogueMarkers, stripReverseMarkers, DIALOGUE_MARKER_TOKENS, resolveAutoAudioSetting, extractExplicitAudioPreference, extractFinalVideoPromptSection, findFinalVideoPromptRange, extractRequestedDialogueLines, ensureRequestedDialogueInFinalPrompt, hasRequestedDialogueIntent, findDialogueOccurrencesInFinalPrompt, type AutoAudioReverseMode } from './src/lib/creative';

// extractHumanSpeechMarker：三态
assert.equal(extractHumanSpeechMarker('【人物说话：是】\n一、核心主体信息'), true);
assert.equal(extractHumanSpeechMarker('【人物说话：否】\n一、核心主体信息'), false);
assert.equal(extractHumanSpeechMarker('一、核心主体信息\n十二、负面提示词'), null);
assert.equal(extractHumanSpeechMarker(''), null);
// 容忍半角冒号、空格
assert.equal(extractHumanSpeechMarker('【人物说话: 是】'), true);
assert.equal(extractHumanSpeechMarker('【 人物说话 ：否 】'), false);
// 不在第一行也要能读到
assert.equal(extractHumanSpeechMarker('前面有内容\n【人物说话：是】\n后面'), true);

// stripHumanSpeechMarker：删除标记行
assert.equal(stripHumanSpeechMarker('【人物说话：是】\n一、核心主体信息'), '一、核心主体信息');
assert.equal(stripHumanSpeechMarker('一、核心主体信息\n【人物说话：否】\n二、场景'), '一、核心主体信息\n二、场景');
assert.equal(stripHumanSpeechMarker('无标记文本'), '无标记文本');
assert.equal(stripHumanSpeechMarker('   【人物说话：是】   \n正文'), '正文');
// 同一行内联也要清掉
assert.equal(stripHumanSpeechMarker('【人物说话：是】一、核心主体信息'), '一、核心主体信息');
assert.equal(stripHumanSpeechMarker('正文【人物说话：否】结尾'), '正文结尾');
// 措辞写歪时不清除真实内容
assert.equal(stripHumanSpeechMarker('【人物说话：可能是】正文'), '【人物说话：可能是】正文');
// 半角方括号不认（必须全角【】），不清除真实内容
assert.equal(stripHumanSpeechMarker('[人物说话：是]正文'), '[人物说话：是]正文');

// 不变式：解析出来的标记经过清理后必须消失。
// 注意：真正拦住措辞漂移的是前面那些基于字面量的断言（它们会先失败），
// 这两条只是把两个函数的行为串起来，不构成独立防线。
assert.equal(extractHumanSpeechMarker(stripHumanSpeechMarker('【人物说话：是】\n正文')), null);
assert.equal(extractHumanSpeechMarker(stripHumanSpeechMarker('正文\n【人物说话：否】')), null);

// tokens 与正则必须一致：用权威 token 拼出来的文本，两个函数都要认。
assert.equal(extractHumanSpeechMarker(HUMAN_SPEECH_MARKER_TOKENS.yes), true);
assert.equal(extractHumanSpeechMarker(HUMAN_SPEECH_MARKER_TOKENS.no), false);
assert.equal(stripHumanSpeechMarker(`${HUMAN_SPEECH_MARKER_TOKENS.no}\n正文`), '正文');

// CRLF：AI 输出经 JSON 往返可能带 \r\n
assert.equal(stripHumanSpeechMarker('正文\r\n【人物说话：否】\r\n结尾'), '正文\r\n结尾');

// 只有标记、没有其它内容
assert.equal(stripHumanSpeechMarker('【人物说话：是】'), '');

// resolveAutoAudioSetting：真值表
const MODEL = 'doubao-seedance-2-5-260628';
assert.equal(resolveAutoAudioSetting({ hasSpeech: true, mode: 'direct', model: MODEL }), true);
assert.equal(resolveAutoAudioSetting({ hasSpeech: false, mode: 'direct', model: MODEL }), false);
assert.equal(resolveAutoAudioSetting({ hasSpeech: true, mode: 'replace', model: MODEL }), true);
assert.equal(resolveAutoAudioSetting({ hasSpeech: false, mode: 'replace', model: MODEL }), false);
assert.equal(resolveAutoAudioSetting({ hasSpeech: true, mode: 'image', model: MODEL }), true);
assert.equal(resolveAutoAudioSetting({ hasSpeech: false, mode: 'image', model: MODEL }), false);
assert.equal(resolveAutoAudioSetting({ hasSpeech: false, explicitPreference: true, mode: 'image', model: MODEL }), true, '明确新增声音高于原素材无声标记');
assert.equal(resolveAutoAudioSetting({ hasSpeech: true, explicitPreference: false, mode: 'direct', model: MODEL }), false, '明确静音高于原素材人声标记');
const noDialogueWithMusic = `${HUMAN_SPEECH_MARKER_TOKENS.no}\n十一、最终可直接用于视频生成模型的完整提示词\n生成指令：人物安静地走过街道，保留环境音和背景音乐。`;
assert.equal(extractExplicitAudioPreference(extractFinalVideoPromptSection(noDialogueWithMusic) || ''), true, '复现：AI 写了背景音乐会被旧逻辑误认为必须开声音');
assert.equal(resolveAutoAudioSetting({ hasSpeech: extractHumanSpeechMarker(noDialogueWithMusic), explicitPreference: extractExplicitAudioPreference(''), mode: 'direct', model: MODEL }), false, '无人说话时，即使 AI 最终提示词有音乐，也要关闭声音');
assert.equal(resolveAutoAudioSetting({ hasSpeech: true, explicitPreference: false, mode: 'painting', model: MODEL }), null, '装饰画模块不受明确声音判定影响');
assert.equal(resolveAutoAudioSetting({ hasSpeech: true, explicitPreference: false, mode: 'direct', model: 'MiniMax-H3' }), null, 'H3 不受声音开关判定影响');
assert.equal(extractExplicitAudioPreference('新视频增加旁白'), true);
assert.equal(extractExplicitAudioPreference('请保留室内环境音，不要背景音乐'), true);
assert.equal(extractExplicitAudioPreference('全片静音，不需要生成声音'), false);
assert.equal(extractExplicitAudioPreference('不要背景音乐'), null, '仅不要配乐不等于整个视频静音');
assert.equal(extractExplicitAudioPreference('避免添加背景音乐'), null, '负面约束里的音频词不误开声音');
assert.equal(extractExplicitAudioPreference('没有提到音频要求'), null);
assert.equal(extractFinalVideoPromptSection('十一、最终可直接用于视频生成模型的完整提示词\n保留环境音\n十二、负面提示词\n禁止生成声音'), '保留环境音');
assert.equal(extractFinalVideoPromptSection('一、最终可直接用于视频生成模型的完整复刻提示词\n固定机位一镜到底\n二、负面提示词\n禁止切镜'), '固定机位一镜到底', '精简版一/二段结构也必须正确提取');
assert.deepEqual(extractRequestedDialogueLines('请让人物说：“AI时代，创新是唯一生产力”。'), ['AI时代，创新是唯一生产力']);
assert.deepEqual(extractRequestedDialogueLines('台词："欢迎光临"；随后旁白：“请进”'), ['欢迎光临', '请进']);
assert.deepEqual(extractRequestedDialogueLines('不要说“旧话”，改为说“新话”'), ['新话'], '旧台词不能被当作待核对原话');
assert.deepEqual(extractRequestedDialogueLines('人物说：欢迎光临'), ['欢迎光临'], '带冒号的无引号台词也要识别');
assert.deepEqual(extractRequestedDialogueLines('人物说： 欢迎光临。视频时长6秒。'), ['欢迎光临。'], '冒号后的空格不能导致无引号台词漏识别');
assert.deepEqual(
  extractRequestedDialogueLines('中间女士说话内容为：有时候屋里被别人使坏你都不知道。今年啊就把这个，挂在家里，还有卧室。注意人物眼神和神态的刻画。视频时长6秒。把女士年龄调整为70岁左右。'),
  ['有时候屋里被别人使坏你都不知道。今年啊就把这个，挂在家里，还有卧室。'],
  '无引号长台词必须在后续制作要求前结束',
);
assert.equal(hasRequestedDialogueIntent('人物说：欢迎光临'), true, '未加引号的台词要求应提示补充格式');
const finalRange = findFinalVideoPromptRange('一、核心主体信息\n人物说：欢迎光临\n十一、最终可直接用于视频生成模型的完整提示词\n人物说：欢迎光临\n十二、负面提示词\n无');
assert.equal(finalRange && '一、核心主体信息\n人物说：欢迎光临\n十一、最终可直接用于视频生成模型的完整提示词\n人物说：欢迎光临\n十二、负面提示词\n无'.slice(finalRange.start, finalRange.end).trim(), '人物说：欢迎光临', '台词范围只包括最终提示词');
const dialoguePrompt = '一、核心主体信息\n原话：AI时代，创新是唯一生产力\n十一、最终可直接用于视频生成模型的完整提示词\n人物说：AI时代，创新是第一生产力\n十二、负面提示词\n原话：AI时代，创新是唯一生产力';
assert.deepEqual(findDialogueOccurrencesInFinalPrompt(dialoguePrompt, ['AI时代，创新是唯一生产力']), [], '分析区和负面区有原话，最终提示词改字仍须判不匹配');
const correctDialoguePrompt = dialoguePrompt.replace('人物说：AI时代，创新是第一生产力', '人物说：AI时代，创新是唯一生产力');
const exactHits = findDialogueOccurrencesInFinalPrompt(correctDialoguePrompt, ['AI时代，创新是唯一生产力']);
assert.equal(exactHits.length, 1, '只高亮最终提示词中的精确原话');
assert.equal(correctDialoguePrompt.slice(exactHits[0].start, exactHits[0].end), 'AI时代，创新是唯一生产力');
const punctuationPrompt = '十一、最终可直接用于视频生成模型的完整提示词\n台词精准匹配：人物说出“如果你现在连五万块钱存款都拿不出来，刚挣点钱就左手进右手出，起早贪黑干好几年，一下又回到原典，你就听我的”\n十二、负面提示词';
const punctuationHits = findDialogueOccurrencesInFinalPrompt(punctuationPrompt, ['如果你现在连五万块钱存款都拿不出来，刚挣点钱就左手进右手出，起早贪黑干好几年，一下又回到原典，你就听我的。']);
assert.equal(punctuationHits.length, 1, '仅少句末句号时仍应点亮原话');
assert.equal(punctuationPrompt.slice(punctuationHits[0].start, punctuationHits[0].end), '如果你现在连五万块钱存款都拿不出来，刚挣点钱就左手进右手出，起早贪黑干好几年，一下又回到原典，你就听我的');
assert.deepEqual(findDialogueOccurrencesInFinalPrompt(punctuationPrompt.replace('原典', '原点'), ['如果你现在连五万块钱存款都拿不出来，刚挣点钱就左手进右手出，起早贪黑干好几年，一下又回到原典，你就听我的。']), [], '任何汉字改动都不能因忽略标点而误标绿');
assert.deepEqual(findDialogueOccurrencesInFinalPrompt(punctuationPrompt.replace('你就听我的”', '你就听我的呀”'), ['如果你现在连五万块钱存款都拿不出来，刚挣点钱就左手进右手出，起早贪黑干好几年，一下又回到原典，你就听我的。']), [], '句末多说一个字也不能只因原话是子串就误标绿');
const wrappedPrompt = '台词：“欢迎，\n光临！”';
const wrappedHits = findDialogueOccurrencesInFinalPrompt(wrappedPrompt, ['欢迎,光临!']);
assert.equal(wrappedHits.length, 1, '中英文标点及换行排版不同仍可定位到原提示词');
assert.equal(wrappedPrompt.slice(wrappedHits[0].start, wrappedHits[0].end), '欢迎，\n光临');
assert.deepEqual(findDialogueOccurrencesInFinalPrompt('十一、最终可直接用于视频生成模型的完整提示词\n禁止人物说“AI时代，创新是唯一生产力”\n十二、负面提示词', ['AI时代，创新是唯一生产力']), [], '否定语境中的原话不应误判为已让人物说出');
const missingDialoguePrompt = '一、核心主体信息\n一位老人\n十一、最终可直接用于视频生成模型的完整提示词\n老人面对镜头自然说话。\n十二、负面提示词\n禁止切镜';
const restoredDialoguePrompt = ensureRequestedDialogueInFinalPrompt(missingDialoguePrompt, ['挂上十年你都不会后悔。']);
assert.equal(findDialogueOccurrencesInFinalPrompt(restoredDialoguePrompt, ['挂上十年你都不会后悔。']).length, 1, '反推模型漏掉的用户原话必须补回第十一部分');
assert.equal(ensureRequestedDialogueInFinalPrompt(restoredDialoguePrompt, ['挂上十年你都不会后悔。']), restoredDialoguePrompt, '已经出现的原话不能重复追加');
const compactPrompt = '一、最终可直接用于视频生成模型的完整复刻提示词\n老人面对镜头自然说话。\n总时长：6秒\n\n二、负面提示词\n禁止切镜';
const restoredCompactPrompt = ensureRequestedDialogueInFinalPrompt(compactPrompt, ['挂上十年你都不会后悔。']);
assert.equal(findDialogueOccurrencesInFinalPrompt(restoredCompactPrompt, ['挂上十年你都不会后悔。']).length, 1, '精简版提示词漏掉的用户原话也必须补回正向生成部分');
assert.equal(extractFinalVideoPromptSection(restoredCompactPrompt)?.includes('禁止切镜'), false, '精简版负面提示词不得混入正向参数和台词核对范围');
assert.equal(extractFinalVideoPromptSection(restoredCompactPrompt)?.trimEnd().endsWith('总时长：6秒'), true, '补回台词后总时长仍必须是正向提示词最后一行');
// 第四个模块不参与
assert.equal(resolveAutoAudioSetting({ hasSpeech: true, mode: 'painting', model: MODEL }), null);
assert.equal(resolveAutoAudioSetting({ hasSpeech: false, mode: 'painting', model: MODEL }), null);
// H3 音轨随模型，按钮本就是禁用的
assert.equal(resolveAutoAudioSetting({ hasSpeech: true, mode: 'direct', model: 'MiniMax-H3' }), null);
assert.equal(resolveAutoAudioSetting({ hasSpeech: false, mode: 'direct', model: 'MiniMax-H3' }), null);
// 没读到标记就不猜
assert.equal(resolveAutoAudioSetting({ hasSpeech: null, mode: 'direct', model: MODEL }), null);
assert.equal(resolveAutoAudioSetting({ hasSpeech: null, mode: 'replace', model: MODEL }), null);
assert.equal(resolveAutoAudioSetting({ hasSpeech: null, mode: 'image', model: MODEL }), null);
// 未知模式（将来新增的反推模式）默认不参与，而不是掉进 hasSpeech 分支
assert.equal(resolveAutoAudioSetting({ hasSpeech: true, mode: 'unknown' as AutoAudioReverseMode, model: MODEL }), null);
// 非布尔值（未按类型调用）一律不猜
assert.equal(resolveAutoAudioSetting({ hasSpeech: undefined as unknown as null, mode: 'direct', model: MODEL }), null);

// 源码级断言：提示词模板必须插值权威 token，不得手抄字面量。
// 这个耦合失败时是静默的——解析返回 null 等同「旧记录」，功能无声失效、不报错。
// 改动 CreativeCreationPage.tsx 的提示词文案时如果手抄了标记文字，这里会先红。
const pageSource = readFileSync(new URL('./src/pages/CreativeCreationPage.tsx', import.meta.url), 'utf8');
assert.ok(
  pageSource.includes('${HUMAN_SPEECH_MARKER_TOKENS.yes}') && pageSource.includes('${HUMAN_SPEECH_MARKER_TOKENS.no}'),
  '提示词规则必须插值 HUMAN_SPEECH_MARKER_TOKENS，不得手抄标记字面量',
);
// 禁的是「手抄的标记本身」，不是这四个字出现的任何场合——散文里提一句判定标准的措辞是合法的。
assert.equal(/【\s*人物说话\s*[：:]\s*[是否]/.test(pageSource), false, '页面里不得出现手抄的标记字面量');
// 直接反推与元素替换共用同一个视频复刻构建器，图片生视频另有一个模板，所以应有两处插值。
// 锚在模板字面量前缀 `${` 上，而不是裸的 HUMAN_SPEECH_MARKER_RULE(——后者还会命中定义行。
const ruleCallSites = pageSource.split('${HUMAN_SPEECH_MARKER_RULE(').length - 1;
assert.equal(ruleCallSites, 2, '视频复刻共用模板与图片生视频模板应各插值一次标记规则；新增独立模板时同步更新此处');
assert.ok(
  pageSource.includes('const VIDEO_REVERSE_PROMPT = (options: VideoClonePromptOptions) => buildVideoClonePrompt(options);')
    && pageSource.includes('buildVideoClonePrompt(options, { target, value: replacement })'),
  '直接反推与元素替换必须共用同一套复刻规则，避免质量标准漂移',
);
assert.ok(
  pageSource.includes('只输出“一、最终可直接用于视频生成模型的完整复刻提示词”和“二、负面提示词”两个正文部分')
    && !pageSource.slice(pageSource.indexOf('function buildVideoClonePrompt'), pageSource.indexOf('const IMAGE_TO_VIDEO_PROMPT')).includes('一、核心主体信息'),
  '视频反推不得再输出前十段分析后重复一遍最终提示词',
);
assert.ok(
  pageSource.includes('有效字幕，锁定内容、位置、字号、颜色、出现与消失时段；水印、平台标识和 AI 生成标记仍必须去除')
    && pageSource.includes('具体画面内容、造型、颜色、风格、材质、纹理和可见细节')
    && pageSource.includes('禁止把原动作整体机械慢放、循环重复、定格或长时间静止等待'),
  '精简模板必须保留旧版已验证的字幕/水印、参考图质感和自然延时约束',
);
assert.ok(
  pageSource.includes("characterRemix ? '执行本次人物改造要求")
    && pageSource.includes("includeSubtitles ? '保留有效字幕并去除水印")
    && pageSource.includes('options.durationSeconds !== options.sourceDurationSeconds ? `将原片时序自然重排为')
    && pageSource.includes('除此之外，原片内容全部冻结'),
  '允许变化清单必须纳入人物改造、目标时长和字幕选项，不能与用户已启用的功能互相否定',
);
assert.ok(
  pageSource.includes('rawQuestion + VIDEO_REVERSE_FORMAT_SUFFIX')
    && pageSource.includes('rawQuestion + IMAGE_REVERSE_FORMAT_SUFFIX'),
  '视频精简格式与图片生视频旧格式必须分开追加，不能让本次改动误伤图片模块',
);

// 源码级断言：接入点那三行。决策真值表全绿也拦不住接线写错——把 `!== null` 改成真值判断，
// 上面 13 条断言一条都不会红，而用户需求里「无人声就关掉」那一半已经没了。
assert.ok(
  pageSource.includes('if (nextGenerateAudio !== null)'),
  '自动设置必须判 !== null：false 是明确的「关」，真值判断会丢掉这一支',
);
assert.ok(
  pageSource.includes('extractHumanSpeechMarker(latestAssistantText)'),
  '人声标记必须从原始文本取，不能用 strip 之后的输出（strip 已经把它删了）',
);
assert.ok(
  pageSource.includes('const cleanPrompt = stripReverseMarkers(formatted);')
    && pageSource.includes('ensureRequestedDialogueInFinalPrompt(cleanPrompt, requestedDialogueLines)')
    && pageSource.includes('SEEDANCE_SHOT_FIDELITY_LOCK}\\n\\n${promptWithRequiredDialogue}'),
  '填框前必须清掉全部标记行（人声判定 + 台词），不能把标记发给视频模型',
);
assert.ok(
  pageSource.includes('extractDialogueLines(latestAssistantText)'),
  '台词必须从原始文本取，不能用 strip 之后的输出',
);
assert.ok(
  pageSource.includes('const userAdjustments = snapshot?.additionalChange ?? lastReverseDialogueInputRef.current;')
    && pageSource.includes('extractRequestedDialogueLines(userAdjustments)')
    && (pageSource.match(/lastReverseDialogueInputRef\.current = additionalChange/g) || []).length === 2,
  '用户明确指定的台词必须来自当次提交的额外调整，自动或手动同步都不能依赖 AI 转述',
);
const syncSource = pageSource.slice(pageSource.indexOf('function syncLatestPromptToSeedance()'), pageSource.indexOf('function syncReverseMediaToSeedance('));
assert.ok(
  syncSource.includes('extractExplicitAudioPreference(userAdjustments)')
    && !syncSource.includes('extractExplicitAudioPreference(finalVideoPrompt'),
  '只有用户明确提出的声音要求能覆盖人声标记，AI 生成的背景音乐不能阻止自动关声',
);
assert.ok(
  pageSource.includes('setSeedanceDialogueLines(dialogueLines)'),
  '选定的台词必须写进 state，否则右侧框一句都不会标绿',
);
assert.ok(
  pageSource.includes('replaceSeedanceReferencesWithImages(referenceImages)')
    && pageSource.includes('function replaceSeedanceReferencesWithImages(images: SelectedCreativeMedia[])'),
  '自动同步必须用本次素材整体替换右侧参考图；直接反推也要清掉上一条元素替换的残留图片',
);
assert.ok(
  pageSource.includes('检测到“额外调整”里有台词要求，但没有识别出具体原话'),
  '台词意图存在但无法提取原话时必须提示用户，不能静默带着缺失台词继续生成',
);

// ---------------------------------------------------------------------------
// 台词标记
// ---------------------------------------------------------------------------

assert.deepEqual(extractDialogueLines('【台词：欢迎光临】\n一、核心主体信息'), ['欢迎光临']);
assert.deepEqual(
  extractDialogueLines('【人物说话：是】\n【台词：欢迎光临】\n【台词：您稍等】\n一、核心主体信息'),
  ['欢迎光临', '您稍等'],
  '多句台词按出现顺序返回',
);
assert.deepEqual(extractDialogueLines('一、核心主体信息\n十二、负面提示词'), [], '没有标记返回空数组');
assert.deepEqual(extractDialogueLines(''), [], '空文本返回空数组');
assert.deepEqual(extractDialogueLines('【台词：欢迎光临】\n【台词：欢迎光临】'), ['欢迎光临', '欢迎光临'], '同一句出现两次都返回');
// 容忍半角冒号与空白
assert.deepEqual(extractDialogueLines('【台词: 你好 】'), ['你好']);
// 空标记丢弃，不产生空字符串（否则 indexOf('') 会匹配到位置 0，整篇被误标）
assert.deepEqual(extractDialogueLines('【台词：】\n【台词：   】'), [], '空标记必须丢弃');
// 只在台词标记里找，不误抓人声判定标记
assert.deepEqual(extractDialogueLines('【人物说话：是】'), [], '人声判定标记不是台词');

// tokens 与正则一致
assert.deepEqual(extractDialogueLines(`${DIALOGUE_MARKER_TOKENS.prefix}你好${DIALOGUE_MARKER_TOKENS.suffix}`), ['你好']);

// stripDialogueMarkers
assert.equal(stripDialogueMarkers('【台词：欢迎光临】\n正文'), '正文');
assert.equal(stripDialogueMarkers('【人物说话：是】\n【台词：欢迎光临】\n【台词：您稍等】\n正文'), '【人物说话：是】\n正文', '只删台词，不动人声判定');
assert.equal(stripDialogueMarkers('正文'), '正文');
assert.equal(stripDialogueMarkers('【台词：欢迎光临】'), '');
assert.equal(stripReverseMarkers('【人物说话：是】\n【台词：欢迎光临】\n【台词：您稍等】\n一、核心主体信息'),
  '一、核心主体信息', '一次清掉两种标记');
assert.equal(stripReverseMarkers('【人物说话：否】\n一、核心主体信息'), '一、核心主体信息', '只有人声判定时也正常');

// 不变式：抽取出来的台词，清理后必须不再以标记形式存在
assert.deepEqual(extractDialogueLines(stripReverseMarkers('【台词：欢迎光临】\n正文')), []);

// 源码级断言：台词标记的措辞同样必须插值权威 token
assert.ok(
  pageSource.includes('${DIALOGUE_MARKER_TOKENS.prefix}') && pageSource.includes('${DIALOGUE_MARKER_TOKENS.suffix}'),
  '提示词规则必须插值 DIALOGUE_MARKER_TOKENS，不得手抄台词标记字面量',
);
assert.equal(/【\s*台词\s*[：:]/.test(pageSource), false, '页面里不得出现手抄的台词标记字面量');

// 查看态直接渲染带台词标记的正文，编辑态只使用原生 textarea；两者不能叠加。
assert.ok(
  pageSource.includes("dialogue: 'rounded-sm bg-emerald-200/80 font-black")
    && pageSource.includes('showSeedancePromptPreview ? (')
    && pageSource.includes("{isSeedancePromptEditing ? '查看台词位置' : '编辑提示词'}"),
  '查看态必须在正文原位置突出台词，并提供明确的查看／编辑切换',
);
assert.ok(
  pageSource.includes("data-dialogue-highlight={part.tone === 'dialogue' ? 'true' : undefined}")
    && pageSource.includes("querySelector<HTMLElement>('[data-dialogue-highlight=\"true\"]')"),
  '查看提示词时必须自动滚动到正文中的第一处台词',
);
assert.ok(
  pageSource.includes('findDialogueOccurrencesInFinalPrompt(seedancePrompt, seedanceDialogueLines).map(({ line }) => line)'),
  '台词状态必须复用最终提示词的精确匹配结果，不能固定显示未匹配的文字',
);
assert.ok(
  !pageSource.includes('seedanceHighlightContentRef')
    && !pageSource.includes('seedanceOverlayHighlight')
    && pageSource.includes('ref={seedancePromptPreviewRef}')
    && pageSource.includes('ref={seedancePromptRef}'),
  '高亮预览和原生输入框必须是互斥节点，不能再用同步滚动的叠加层',
);

console.log('前端人声标记测试通过：标记三态解析、台词标记抽取与清理、标记行清理、声音开关决策真值表、高亮接线。无真实网络调用。');

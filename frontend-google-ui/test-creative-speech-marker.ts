import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractHumanSpeechMarker, stripHumanSpeechMarker, HUMAN_SPEECH_MARKER_TOKENS, extractDialogueLines, stripDialogueMarkers, stripReverseMarkers, DIALOGUE_MARKER_TOKENS, resolveAutoAudioSetting, extractExplicitAudioPreference, extractFinalVideoPromptSection, findFinalVideoPromptRange, extractRequestedDialogueLines, hasRequestedDialogueIntent, findDialogueOccurrencesInFinalPrompt, type AutoAudioReverseMode } from './src/lib/creative';

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
assert.equal(resolveAutoAudioSetting({ hasSpeech: true, explicitPreference: false, mode: 'painting', model: MODEL }), null, '装饰画模块不受明确声音判定影响');
assert.equal(resolveAutoAudioSetting({ hasSpeech: true, explicitPreference: false, mode: 'direct', model: 'MiniMax-H3' }), null, 'H3 不受声音开关判定影响');
assert.equal(extractExplicitAudioPreference('新视频增加旁白'), true);
assert.equal(extractExplicitAudioPreference('请保留室内环境音，不要背景音乐'), true);
assert.equal(extractExplicitAudioPreference('全片静音，不需要生成声音'), false);
assert.equal(extractExplicitAudioPreference('不要背景音乐'), null, '仅不要配乐不等于整个视频静音');
assert.equal(extractExplicitAudioPreference('避免添加背景音乐'), null, '负面约束里的音频词不误开声音');
assert.equal(extractExplicitAudioPreference('没有提到音频要求'), null);
assert.equal(extractFinalVideoPromptSection('十一、最终可直接用于视频生成模型的完整提示词\n保留环境音\n十二、负面提示词\n禁止生成声音'), '保留环境音');
assert.deepEqual(extractRequestedDialogueLines('请让人物说：“AI时代，创新是唯一生产力”。'), ['AI时代，创新是唯一生产力']);
assert.deepEqual(extractRequestedDialogueLines('台词："欢迎光临"；随后旁白：“请进”'), ['欢迎光临', '请进']);
assert.deepEqual(extractRequestedDialogueLines('不要说“旧话”，改为说“新话”'), ['新话'], '旧台词不能被当作待核对原话');
assert.deepEqual(extractRequestedDialogueLines('人物说：欢迎光临'), [], '未加引号时不猜测原话边界');
assert.equal(hasRequestedDialogueIntent('人物说：欢迎光临'), true, '未加引号的台词要求应提示补充格式');
const finalRange = findFinalVideoPromptRange('一、核心主体信息\n人物说：欢迎光临\n十一、最终可直接用于视频生成模型的完整提示词\n人物说：欢迎光临\n十二、负面提示词\n无');
assert.equal(finalRange && '一、核心主体信息\n人物说：欢迎光临\n十一、最终可直接用于视频生成模型的完整提示词\n人物说：欢迎光临\n十二、负面提示词\n无'.slice(finalRange.start, finalRange.end).trim(), '人物说：欢迎光临', '台词范围只包括最终提示词');
const dialoguePrompt = '一、核心主体信息\n原话：AI时代，创新是唯一生产力\n十一、最终可直接用于视频生成模型的完整提示词\n人物说：AI时代，创新是第一生产力\n十二、负面提示词\n原话：AI时代，创新是唯一生产力';
assert.deepEqual(findDialogueOccurrencesInFinalPrompt(dialoguePrompt, ['AI时代，创新是唯一生产力']), [], '分析区和负面区有原话，最终提示词改字仍须判不匹配');
const correctDialoguePrompt = dialoguePrompt.replace('人物说：AI时代，创新是第一生产力', '人物说：AI时代，创新是唯一生产力');
const exactHits = findDialogueOccurrencesInFinalPrompt(correctDialoguePrompt, ['AI时代，创新是唯一生产力']);
assert.equal(exactHits.length, 1, '只高亮最终提示词中的精确原话');
assert.equal(correctDialoguePrompt.slice(exactHits[0].start, exactHits[0].end), 'AI时代，创新是唯一生产力');
assert.deepEqual(findDialogueOccurrencesInFinalPrompt('十一、最终可直接用于视频生成模型的完整提示词\n禁止人物说“AI时代，创新是唯一生产力”\n十二、负面提示词', ['AI时代，创新是唯一生产力']), [], '否定语境中的原话不应误判为已让人物说出');
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
// 锚在模板字面量前缀 `${` 上，而不是裸的 HUMAN_SPEECH_MARKER_RULE(——后者在规则被改成
// function 声明时也会命中定义行，计数变 4，而失败信息会误导人把数字改成 4（于是掩盖真实的删除）。
const ruleCallSites = pageSource.split('${HUMAN_SPEECH_MARKER_RULE(').length - 1;
assert.equal(ruleCallSites, 3, '三个反推模板（直接反推／元素替换／图片生视频）应各插值一次标记规则；新增模式时同步更新此处');

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
  pageSource.includes('setSeedancePrompt(stripReverseMarkers(formatted))'),
  '填框前必须清掉全部标记行（人声判定 + 台词），不能把标记发给视频模型',
);
assert.ok(
  pageSource.includes('extractDialogueLines(latestAssistantText)'),
  '台词必须从原始文本取，不能用 strip 之后的输出',
);
assert.ok(
  pageSource.includes("const requestedDialogueLines = extractRequestedDialogueLines(snapshot?.additionalChange || '')"),
  '用户明确指定的台词必须直接来自额外调整，不能依赖 AI 转述',
);
assert.ok(
  pageSource.includes('setSeedanceDialogueLines(dialogueLines)'),
  '选定的台词必须写进 state，否则右侧框一句都不会标绿',
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

// 源码级断言：透明文字必须挂在「叠加层确实渲染着同一份文本」上。
// 写成 seedanceReplaceHighlight 会让「有台词、但元素替换高亮为空」时整框文字隐形——
// 不报错、不是白屏，是一个看得见边框、里面什么都没有的空框。
assert.ok(
  pageSource.includes('seedanceOverlayHighlight ? "bg-transparent text-transparent'),
  'textarea 的透明文字必须由合并后的叠加层状态决定，不能只看元素替换高亮',
);
assert.ok(
  pageSource.includes('const seedanceOverlayHighlight = useMemo'),
  '叠加层文本必须来自同一份当前提示词，否则两层对不上就会隐形',
);

console.log('前端人声标记测试通过：标记三态解析、台词标记抽取与清理、标记行清理、声音开关决策真值表、高亮接线。无真实网络调用。');

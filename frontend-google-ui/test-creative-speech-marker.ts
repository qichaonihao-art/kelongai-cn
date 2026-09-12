import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { extractHumanSpeechMarker, stripHumanSpeechMarker, HUMAN_SPEECH_MARKER_TOKENS, resolveAutoAudioSetting, type AutoAudioReverseMode } from './src/lib/creative';

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
  pageSource.includes('setSeedancePrompt(stripHumanSpeechMarker(formatted))'),
  '填框前必须清掉标记行，不能把标记发给视频模型',
);

console.log('前端人声标记测试通过：标记三态解析、标记行清理、声音开关决策真值表。无真实网络调用。');

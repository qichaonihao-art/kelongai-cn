import assert from 'node:assert/strict';
import { extractHumanSpeechMarker, stripHumanSpeechMarker, HUMAN_SPEECH_MARKER_TOKENS, resolveAutoAudioSetting } from './src/lib/creative';

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

console.log('前端人声标记测试通过：标记三态解析、标记行清理、声音开关决策真值表。无真实网络调用。');

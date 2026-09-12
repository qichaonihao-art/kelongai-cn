# 创意创作自动开关「声音」实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 创意创作页前三个子模块（直接反推 / 元素替换 / 图片生视频）的反推结果同步到右侧 C 端提示词窗口时，按素材中是否有人声开口自动开关「生成声音」按钮。

**Architecture:** 反推用的 AI 在输出第一行写一行机器可读标记 `【人物说话：是】` 或 `【人物说话：否】`。前端在唯一的同步入口 `syncLatestPromptToSeedance()` 里解析该标记，把提示词填进右侧输入框前先删掉标记行，再按「模块 + 模型 + 标记」三态决策设置开关。决策逻辑做成 `src/lib/creative.ts` 里的纯函数，用仓库现有的独立 `test-*.ts` 脚本覆盖。

**Tech Stack:** React 19 + TypeScript + Vite；测试用 `node:assert/strict` + `node --import tsx`（本仓库既有约定，无 vitest/jest）。

**Spec:** `docs/superpowers/specs/2026-09-12-creative-auto-audio-switch-design.md`

---

## 前置说明

- 工作分支：`feat/creative-auto-audio-switch`（已创建，spec 已提交）。
- 所有命令的工作目录是 `frontend-google-ui/`，除非另有说明。
- 本仓库没有测试框架。测试脚本放在 `frontend-google-ui/` 根目录，命名 `test-*.ts`，用 `node --import tsx test-xxx.ts` 直接运行，风格对齐 `test-sticker-creative.ts`。
- `tsconfig.json` 没有 `include`/`exclude`，`npm run lint`（即 `tsc --noEmit`）会检查测试脚本，所以测试脚本必须类型正确。

### ⚠️ lint 门禁：`npm run lint` 在本仓库**本来就不是干净的**

开工前（commit `ab333dd`，未包含本次任何改动）跑 `npm run lint` 就有 11 个既存错误，分布如下：

```
4  src/pages/DouyinDownloaderPage.tsx  TS2339  Property 'hasAudio' does not exist on type '{ url: string; }'.
4  src/pages/CreativeCreationPage.tsx   TS2769  No overload matches this call.
1  src/pages/CreativeCreationPage.tsx   TS2322  Type '(forceQuestion?: string) => void' is not assignable to 'MouseEventHandler<HTMLButtonElement>'.
1  src/pages/DouyinDownloaderPage.tsx   TS2322  AnimatePresence className 不存在
1  test-video-library-local.ts         TS2741  Property 'shotRole' is missing in type 'VideoLibraryItem'
```

**因此本计划中所有 lint 步骤的正确验收标准不是「无输出」，而是「与基线相比不新增错误」。** 上方列表就是基线。Task 3 和 Task 4 会修改 `CreativeCreationPage.tsx` 并插入新行，既存错误的**行号会漂移**，所以比对时必须剥掉 `(行,列)` 再比，不能按行号比。

**不要顺手修这些既存错误。** 它们与本次功能无关，修它们属于计划外的重构，会让 diff 无法审查。

基线比对命令（任意 task 完成后都可复跑）：

```bash
cd frontend-google-ui
npm run lint 2>&1 | grep -E "^[a-zA-Z].*\.tsx?\(" | sed -E 's/\([0-9]+,[0-9]+\)//' | sort | uniq -c | sort -rn
```

把输出与基线列表逐行对照，必须完全一致。多出任何一行 = 本次改动引入了新类型错误，必须修掉。

`npm run build` 不受影响：`package.json` 的 `build` 是纯 `vite build`，不跑 `tsc`，所以构建成功仍是有效的独立门禁。

---

## 文件结构

| 文件 | 职责 | 动作 |
|---|---|---|
| `frontend-google-ui/src/lib/creative.ts` | 纯逻辑：标记解析、标记清理、开关决策 | 修改（追加到文件末尾） |
| `frontend-google-ui/test-creative-speech-marker.ts` | 上述三个纯函数的断言脚本 | 新建 |
| `frontend-google-ui/src/pages/CreativeCreationPage.tsx` | 提示词模板注入标记规则；同步入口接线 | 修改（4 处） |

---

## Task 1: 标记解析与清理纯函数

**Files:**
- Create: `frontend-google-ui/test-creative-speech-marker.ts`
- Modify: `frontend-google-ui/src/lib/creative.ts`（追加到文件末尾）

- [ ] **Step 1: 写失败的测试**

新建 `frontend-google-ui/test-creative-speech-marker.ts`：

```ts
import assert from 'node:assert/strict';
import { extractHumanSpeechMarker, stripHumanSpeechMarker } from './src/lib/creative';

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
// 大小括号或措辞写歪时不清除真实内容
assert.equal(stripHumanSpeechMarker('【人物说话：可能是】正文'), '【人物说话：可能是】正文');

console.log('前端人声标记测试通过：标记三态解析、标记行清理。无真实网络调用。');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend-google-ui && node --import tsx test-creative-speech-marker.ts`

Expected: FAIL — `SyntaxError` 或 `does not provide an export named 'extractHumanSpeechMarker'`。两个函数都还不存在。

- [ ] **Step 3: 实现最小代码**

在 `frontend-google-ui/src/lib/creative.ts` **文件末尾**追加：

```ts
const HUMAN_SPEECH_MARKER_PATTERN = /【\s*人物说话\s*[：:]\s*(是|否)\s*】/;

// 只匹配独占一行的标记（允许行首行尾空白），用于整行删除
const HUMAN_SPEECH_MARKER_LINE_PATTERN = /^[^\S\n]*【\s*人物说话\s*[：:]\s*(?:是|否)\s*】[^\S\n]*\n?/gm;

/**
 * 读取反推结果里的【人物说话：是/否】标记。
 * 返回 null 表示没找到标记（改造前的历史记录，或 AI 未按格式输出），
 * 此时调用方不应改动声音开关，避免误关掉用户需要的声音。
 */
export function extractHumanSpeechMarker(text: string): boolean | null {
  const match = HUMAN_SPEECH_MARKER_PATTERN.exec(String(text || ''));
  if (!match) return null;
  return match[1] === '是';
}

/**
 * 删除标记，用于把反推结果填进右侧提示词框之前做清理。
 * 先删独占一行的标记（连同换行），再清掉同行内联残留，最后收敛空行。
 */
export function stripHumanSpeechMarker(text: string): string {
  return String(text || '')
    .replace(HUMAN_SPEECH_MARKER_LINE_PATTERN, '')
    .replace(/【\s*人物说话\s*[：:]\s*(?:是|否)\s*】/g, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
```

注意两条正则都**不能**带 `g` 标志的是 `HUMAN_SPEECH_MARKER_PATTERN`（`RegExp.prototype.exec` 在 `g` 模式下会因 `lastIndex` 残留而时对时错）。`HUMAN_SPEECH_MARKER_LINE_PATTERN` 是 `gm`，但它只用在 `String.prototype.replace` 上，`replace` 每次都会重置 `lastIndex`，是安全的。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend-google-ui && node --import tsx test-creative-speech-marker.ts`

Expected: PASS，输出 `前端人声标记测试通过：标记三态解析、标记行清理。无真实网络调用。`

- [ ] **Step 5: 类型检查**

Run: `cd frontend-google-ui && npm run lint 2>&1 | grep -E "^[a-zA-Z].*\.tsx?\(" | sed -E 's/\([0-9]+,[0-9]+\)//' | sort | uniq -c | sort -rn`

Expected: 输出与前置说明里的基线**完全一致**（11 个既存错误，不含本任务的文件）。本任务新增的两个文件不得出现在输出里。

- [ ] **Step 6: 提交**

```bash
cd /Users/qichao/Documents/kelongai-cn
git add frontend-google-ui/src/lib/creative.ts frontend-google-ui/test-creative-speech-marker.ts
git commit -m "Add human speech marker parsing helpers

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 2: 声音开关决策纯函数

**Files:**
- Modify: `frontend-google-ui/test-creative-speech-marker.ts`（追加断言）
- Modify: `frontend-google-ui/src/lib/creative.ts`（追加到文件末尾）

- [ ] **Step 1: 写失败的测试**

在 `frontend-google-ui/test-creative-speech-marker.ts` 的 `console.log` 那一行**之前**插入：

```ts
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
```

同时把导入语句改成：

```ts
import { extractHumanSpeechMarker, resolveAutoAudioSetting, stripHumanSpeechMarker } from './src/lib/creative';
```

并把最后一行 `console.log` 改成：

```ts
console.log('前端人声标记测试通过：标记三态解析、标记行清理、声音开关决策真值表。无真实网络调用。');
```

- [ ] **Step 2: 运行测试确认失败**

Run: `cd frontend-google-ui && node --import tsx test-creative-speech-marker.ts`

Expected: FAIL — `does not provide an export named 'resolveAutoAudioSetting'`。

- [ ] **Step 3: 实现最小代码**

在 `frontend-google-ui/src/lib/creative.ts` **文件末尾**追加：

```ts
export type AutoAudioReverseMode = 'direct' | 'replace' | 'image' | 'painting';

// 只有前三个反推模式自动设置声音；第四个「装饰画创意素材」以及将来新增的模式一律不碰，
// 让它们落到 null（保持用户手动设置），而不是掉进 hasSpeech 分支。
const AUTO_AUDIO_IN_SCOPE_MODES: ReadonlySet<AutoAudioReverseMode> = new Set(['direct', 'replace', 'image']);

/**
 * 决定同步提示词时要不要自动设置「生成声音」开关。
 * 返回 null 表示不改动开关，用户此前的手动设置原样保留。
 */
export function resolveAutoAudioSetting(options: {
  hasSpeech: boolean | null;
  mode: AutoAudioReverseMode;
  model: string;
}): boolean | null {
  const { hasSpeech, mode, model } = options;
  if (!AUTO_AUDIO_IN_SCOPE_MODES.has(mode)) return null;
  // MiniMax-H3 的音轨随模型，声音按钮本来就是禁用的。
  if (model === 'MiniMax-H3') return null;
  // 历史记录或 AI 未按格式输出时保持现状，不猜。
  if (typeof hasSpeech !== 'boolean') return null;
  return hasSpeech;
}
```

第一行用**放行式**而非排除式：`null` 的语义就是「超出范围」，新增的反推模式按定义就是超出范围的。排除式（只判 `painting`）会把新增模式静默放进自动设置分支；放行式让它落到安全默认 `null`。第三行用 `typeof`：它在声明的参数类型下让返回类型 `boolean | null` 按构造成立，比 `=== null || === undefined` 两连判更短且后者有一支不可达。

- [ ] **Step 4: 运行测试确认通过**

Run: `cd frontend-google-ui && node --import tsx test-creative-speech-marker.ts`

Expected: PASS，输出 `前端人声标记测试通过：标记三态解析、标记行清理、声音开关决策真值表。无真实网络调用。`

- [ ] **Step 5: 类型检查**

Run: `cd frontend-google-ui && npm run lint 2>&1 | grep -E "^[a-zA-Z].*\.tsx?\(" | sed -E 's/\([0-9]+,[0-9]+\)//' | sort | uniq -c | sort -rn`

Expected: 输出与前置说明里的基线完全一致。新增的文件不得出现在输出里。

- [ ] **Step 6: 提交**

```bash
cd /Users/qichao/Documents/kelongai-cn
git add frontend-google-ui/src/lib/creative.ts frontend-google-ui/test-creative-speech-marker.ts
git commit -m "Add auto audio switch decision helper

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

---

## Task 3: 三个提示词模板注入标记规则

**Files:**
- Modify: `frontend-google-ui/src/pages/CreativeCreationPage.tsx`

三处修改，都在同一个文件。改完先做静态检查，真正的行为验证在 Task 5。

- [ ] **Step 1: 新增共享常量（必须插值权威 token）**

**先加 import。** 在 `frontend-google-ui/src/pages/CreativeCreationPage.tsx` 里 `} from "@/src/lib/creative";` 结尾的那段 import（约第 89 行）加上 Task 1 导出的 token：

```ts
  HUMAN_SPEECH_MARKER_TOKENS,
```

然后在同文件中找到 `PAINTING_WOOD_BAR_OUTPUT_RULE` 的定义（约第 626 行），在它**下面**新增——一条注释、一个接受判定标准的规则模板、两条判定标准：

```ts
// 【人物说话：是/否】标记是横跨三方的契约：这里的规则文案、creative.ts 里的解析正则、
// 以及 AI 实际输出的格式。措辞和正则一旦对不上，解析会返回 null，而 null 的语义恰好是
// 「旧记录，不要碰开关」——功能于是静默失效：没有异常、没有日志，现象酷似历史兼容逻辑
// 正常生效。所以标记文字只能插值 HUMAN_SPEECH_MARKER_TOKENS，不得另抄字面量；
// test-creative-speech-marker.ts 用源码断言钉住了这一点，手抄会直接测试失败。
// 判定标准随模式而异：视频看音轨里有没有人声，图片没有音轨，只能看画面里人物的说话状态。
const HUMAN_SPEECH_MARKER_RULE = (criterion: string) => `【人声判定】必须在输出的第一行、且在“一、核心主体信息”之前，单独写一行机器可读标记：${HUMAN_SPEECH_MARKER_TOKENS.yes}或${HUMAN_SPEECH_MARKER_TOKENS.no}。判定标准：${criterion}这一行是给程序读取的，必须严格使用上述格式，不得改写措辞、不得添加其他字符。`;

const HUMAN_SPEECH_CRITERION_VIDEO = '只要素材中存在人声开口，包括人物台词、对话、口播、独白、旁白、画外音，无论画面中是否能看到人物张嘴，一律写“是”；只有纯背景音乐、纯环境音效、完全无声的素材才写“否”。';

const HUMAN_SPEECH_CRITERION_IMAGE = '只要图片中的人物处于说话状态（张嘴说话、手持话筒、口播或演唱姿态等），或者用户在本条任务的其他调整要求（如有）里明确要求出现人声——包括人物开口说话、旁白、口播、配音等，一律写“是”；纯风景、纯静物、人物只是静止看向镜头等没有说话意图的图片，且用户未要求出现人声的，一律写“否”。';
```

**不要**把 `【人物说话：是】`／`【人物说话：否】` 直接抄进这些字符串。必须走 `HUMAN_SPEECH_MARKER_TOKENS` 插值——原因见下方「标记措辞的单一事实来源」。注意规则模板必须用**反引号模板字符串**（不是单引号），否则 `${...}` 不会生效。（注意：注释里也不能出现「人物说话」四个字，Step 5b 的 grep 会连注释一起扫到。）

#### 为什么判定标准要按模式拆开

原设计只有一条判定标准，写的是「只要**素材**中存在人声开口」——这是按**音轨**写的。但 `IMAGE_TO_VIDEO_PROMPT` 的输入是**静态图片**（模板开头即「请把我上传的这张图片作为唯一的视觉基准」），静态图没有音轨，字面答案恒为「否」。而 `image` 又在 `AUTO_AUDIO_IN_SCOPE_MODES` 里，于是**每次图片生视频同步都会把声音关掉**；更糟的是模型遇到「照片里人物张着嘴」也可能反答「是」，行为不稳定。

所以图片模式换成看**画面里人物的说话状态 + 用户要求**：这才是用户真正关心的东西——生成出来的视频会不会有台词。

两个措辞要点：

1. **必须点名「其他调整要求」这个真实标签**，不能写「附加要求」——后者在本页只出现在这条判定标准自己身上，模型看不到那个词。用户文本由 `IMAGE_TO_VIDEO_PROMPT` 渲染成「其他调整要求：…」（在「本次可选调整」里），与判定标准同属一条消息；写「（如有）」是为了该段因未填附加要求而整体缺席时仍读得通。
2. **「用户要求」那一支必须涵盖旁白/配音**，不能只写「人物开口说话」。产品图、展厅图配「加一段旁白讲解」「加入口播介绍」是这个模块的常见用法；只认人物开口的话，两个分支都不命中，反而会把用户明确要的声音关掉——正是本设计要避免的误关。

### ⚠️ 标记措辞的单一事实来源

`【人物说话：是/否】` 是一个横跨三方的契约：Task 1 的两个解析正则、本任务的提示词规则、以及 AI 实际输出的格式。

这个耦合是**不对称**的：如果提示词规则和正则对不上，AI 会输出新措辞，`extractHumanSpeechMarker` 返回 `null`——而 `null` 的语义恰好是「旧记录，不要碰声音开关」。于是功能**静默失效**，没有异常、没有日志、没有测试失败，用户只看到开关该动没动，且现象酷似「历史兼容逻辑生效了」，极难排查。

所以：**权威措辞只有一份** —— Task 1 在 `src/lib/creative.ts` 导出的 `HUMAN_SPEECH_MARKER_TOKENS`。提示词规则插值它，正则宽松地解析它。要改措辞，改 token 一处，测试会立刻告诉你哪些地方跟不上了。

- [ ] **Step 2: 注入 `VIDEO_REVERSE_PROMPT`（直接反推）**

在该模板的 `const base = \`...\`` 里，把：

```
光影和氛围。\n\n${VIDEO_CONTEXT_ISOLATION_RULE}\n\n请严格按以下结构输出：
```

改成：

```
光影和氛围。\n\n${HUMAN_SPEECH_MARKER_RULE(HUMAN_SPEECH_CRITERION_VIDEO)}\n\n${VIDEO_CONTEXT_ISOLATION_RULE}\n\n请严格按以下结构输出：
```

**只改这一处，不要动这个模板里其它任何内容。** 该模板后面还有 `durationLockedBase = base.replace(VIDEO_CONTEXT_ISOLATION_RULE, ...)`，因为标记规则文本与隔离规则文本不重叠，这个 `replace` 仍然正常工作。

- [ ] **Step 3: 注入 `VIDEO_REPLACE_PROMPT`（元素替换）**

在该模板里，把：

```
${buildReverseDurationRule(options.durationSeconds, options.sourceDurationSeconds)}

${VIDEO_CONTEXT_ISOLATION_RULE}
```

改成：

```
${buildReverseDurationRule(options.durationSeconds, options.sourceDurationSeconds)}

${HUMAN_SPEECH_MARKER_RULE(HUMAN_SPEECH_CRITERION_VIDEO)}

${VIDEO_CONTEXT_ISOLATION_RULE}
```

- [ ] **Step 4: 注入 `IMAGE_TO_VIDEO_PROMPT`（图片生视频，用图片判定标准）**

在该模板的 `return \`...\`` 里，把：

```
动态细节。\n\n${imageIsolationRule}\n\n请严格按以下结构输出：
```

改成：

```
动态细节。\n\n${HUMAN_SPEECH_MARKER_RULE(HUMAN_SPEECH_CRITERION_IMAGE)}\n\n${imageIsolationRule}\n\n请严格按以下结构输出：
```

- [ ] **Step 4b: 解除「严格十二个部分」与新增第一行的措辞冲突**

`VIDEO_REVERSE_FORMAT_SUFFIX`（约第 623 行）在 `handleSend` 里被追加到反推提示词的**最末尾**（约第 4974 行，`isReversePrompt` 为真时）——这是位置最靠后、最显眼的一条指令，它说「请严格按照以上十二个部分输出」，而标记规则要的是一个**在第一部分之前**的第十三样东西。

把该字符串开头从：

```
'\n\n请严格按照以上十二个部分输出，
```

改成：

```
'\n\n除第一行的人声判定标记外，请严格按照以上十二个部分输出，
```

**改之前先确认作用范围**：`grep -n "VIDEO_REVERSE_FORMAT_SUFFIX" src/pages/CreativeCreationPage.tsx` 应当只有定义处 + 约 4974 行一处消费；`isReversePrompt` 要求同时含 `核心主体信息` 与（`待复刻样片` 或 `唯一的视觉基准`），恰好就是收标记规则的那三个模板。若发现别的消费方会把它追加到不含标记规则的提示词上，**停下来报告**，不要改。

- [ ] **Step 4c: 用源码断言把「规则 ↔ token」这一半也钉住**

`test-creative-speech-marker.ts` 原本只钉了「token ↔ 解析器」。测试文件只 import `src/lib/creative`，所以将来有人改文案时手打 `【人物说话：是】`，不会有任何测试变红——而这正是本设计认定的静默失效路径。补三条源码级断言（放在末尾 `console.log` 之前）：

```ts
// 源码级断言：提示词模板必须插值权威 token，不得手抄字面量。
// 这个耦合失败时是静默的——解析返回 null 等同「旧记录」，功能无声失效、不报错。
// 改动 CreativeCreationPage.tsx 的提示词文案时如果手抄了标记文字，这里会先红。
const pageSource = readFileSync(new URL('./src/pages/CreativeCreationPage.tsx', import.meta.url), 'utf8');
assert.ok(
  pageSource.includes('${HUMAN_SPEECH_MARKER_TOKENS.yes}') && pageSource.includes('${HUMAN_SPEECH_MARKER_TOKENS.no}'),
  '提示词规则必须插值 HUMAN_SPEECH_MARKER_TOKENS，不得手抄标记字面量',
);
assert.equal(pageSource.includes('人物说话'), false, '页面里不得出现手抄的标记字面量');
// 锚在模板字面量前缀 `${` 上，而不是裸的 HUMAN_SPEECH_MARKER_RULE(——后者在规则被改成
// function 声明时也会命中定义行，计数变 4，而失败信息会误导人把数字改成 4（于是掩盖真实的删除）。
const ruleCallSites = pageSource.split('${HUMAN_SPEECH_MARKER_RULE(').length - 1;
assert.equal(ruleCallSites, 3, '三个反推模板（直接反推／元素替换／图片生视频）应各插值一次标记规则；新增模式时同步更新此处');
```

顶部加 `import { readFileSync } from 'node:fs';`。上面两个 `'${HUMAN_SPEECH_MARKER_TOKENS.yes}'` 必须留在**单引号**里，否则会被当成模板插值。

**计数断言为什么锚 `${` 而不是裸的函数名**：页面里紧邻的 `buildCharacterRemixClause` 就是 `function` 声明，所以把 `HUMAN_SPEECH_MARKER_RULE` 从箭头函数改成声明式是很自然的改法。裸函数名会连定义行一起数进去，计数变 4、测试变红，而失败信息写着「新增模式时同步更新此处」——等于诱导人把 3 改成 4，从此掩盖真实的删除（4→3 就通过了）。锚上 `${` 前缀，定义行永远匹配不到。

**这条断言的已知上限**：它只能发现**删除**，发现不了**遗漏**——新增一个在范围内的模板却忘了插值，计数仍是 3，测试照样绿。要更进一步就得逐个点名模板，那比这个文件的其他约定耦合更重，不值得。

- [ ] **Step 5: 确认三处都注入了，且没有多注**

Run: `cd frontend-google-ui && grep -c "HUMAN_SPEECH_MARKER_RULE(" src/pages/CreativeCreationPage.tsx`

Expected: `3` —— 三个模板各一次调用。

（`grep -c "HUMAN_SPEECH_MARKER_RULE"` 不带左括号应为 `4`：1 处定义 + 3 处调用。）

- [ ] **Step 5b: 确认没有硬编码标记字面量漏进来**

Run: `cd frontend-google-ui && grep -n "人物说话" src/pages/CreativeCreationPage.tsx`

Expected: **无输出**（退出码 1）。这是本任务最重要的一条检查：一旦这里出现字面量，就说明有人把标记措辞抄成了第四份，而这个文件里没有正则能保护它。措辞只能从 `HUMAN_SPEECH_MARKER_TOKENS` 来，所以这个文件里不该出现「人物说话」四个字——**注释里也不行**。

- [ ] **Step 5c: 变异测试（确认 Step 4c 的断言不是恒真的摆设）**

源码断言容易写成永远通过。用两次变异确认它真的会红，改完记得还原：

```bash
cd frontend-google-ui
cp src/pages/CreativeCreationPage.tsx /tmp/page.bak.ts
# 变异 1：手抄字面量替代 token 插值
perl -0pi -e 's/\$\{HUMAN_SPEECH_MARKER_TOKENS\.yes\}/【人物说话：是】/' src/pages/CreativeCreationPage.tsx
node --import tsx test-creative-speech-marker.ts   # 预期：AssertionError「必须插值 HUMAN_SPEECH_MARKER_TOKENS」
cp /tmp/page.bak.ts src/pages/CreativeCreationPage.tsx
# 变异 2：漏掉一个模板的插值
perl -0pi -e 's/\$\{HUMAN_SPEECH_MARKER_RULE\(HUMAN_SPEECH_CRITERION_IMAGE\)\}//' src/pages/CreativeCreationPage.tsx
node --import tsx test-creative-speech-marker.ts   # 预期：AssertionError「应各插值一次标记规则」
cp /tmp/page.bak.ts src/pages/CreativeCreationPage.tsx
git status --porcelain src/pages/CreativeCreationPage.tsx   # 预期：无输出
```

- [ ] **Step 6: 类型检查**

Run: `cd frontend-google-ui && npm run lint 2>&1 | grep -E "^[a-zA-Z].*\.tsx?\(" | sed -E 's/\([0-9]+,[0-9]+\)//' | sort | uniq -c | sort -rn`

Expected: 输出与前置说明里的基线**完全一致**。`CreativeCreationPage.tsx` 本来就贡献 4× TS2769 + 1× TS2322，插入新行后行号会漂移，所以剥掉行列号比对——条数和内容都不能变。

- [ ] **Step 7: 提交**

```bash
cd /Users/qichao/Documents/kelongai-cn
git add frontend-google-ui/src/pages/CreativeCreationPage.tsx frontend-google-ui/test-creative-speech-marker.ts
git commit -m "Require speech marker in reverse prompt templates

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Task 3 实际分两个 commit 落地（都已完成）：`211e071` 只做三处模板注入，review 后 `527daac` 补上按模式拆分的判定标准、格式后缀措辞、以及 Step 4c 的源码断言。`src/lib/creative.ts` 在本任务中不应被修改。

---

## Task 4: 接入同步入口

**Files:**
- Modify: `frontend-google-ui/src/pages/CreativeCreationPage.tsx`

- [ ] **Step 1: 扩充 import**

找到该文件里 `} from "@/src/lib/creative";` 结尾的那段 import（约第 89 行），在列表里加上三个新符号。例如把：

```ts
  extractVideoGenerationDurationFromPrompt,
```

改成：

```ts
  extractVideoGenerationDurationFromPrompt,
  extractHumanSpeechMarker,
  stripHumanSpeechMarker,
  resolveAutoAudioSetting,
```

（三个符号按字母序插入到合适位置即可，`type` 前缀的条目保持原样。）

- [ ] **Step 2: 把快照的读取收敛到一处**

找到 `syncLatestPromptToSeedance()`（约第 2743 行）。在 `if (!latestAssistantText) { ... }` 这个早退块**之后**、`const formatted = latestAssistantText` **之前**，插入：

```ts
    // 快照在这里读一次并就地清空：syncReverseMediaToSeedance() 消费同一个快照，
    // 两边都从这一个值推导 activeMode，所以既没有「当前是哪个模块」的第二套口径，
    // 也没有读写顺序错位导致判定到别的模块的余地。
    // 这中间没有 await，提前清空不会漏掉任何重新赋值的时机。
    const snapshot = pendingReverseSeedanceSyncRef.current;
    pendingReverseSeedanceSyncRef.current = null;
    const activeMode = snapshot?.mode || reverseMode;
    // 人声标记必须从原始文本里取，不能用 strip 之后的输出——strip 已经把它删掉了。
    const hasSpeech = extractHumanSpeechMarker(latestAssistantText);
```

**为什么不是「在调用前读一下、再照旧让被调方自己读」：** 那是本任务最初的做法，`activeMode` 会在调用方与被调方各推导一次，而两者的唯一同步手段是一句注释——将来有人调换两条相邻语句就会静默判错模块，正是本功能设计上要避免的失效类型。改成传快照后，ref 只被读一次，顺序依赖**从结构上消失**。

这一步必须**同时**改被调方签名（Step 4b），否则 ref 会被清两次、`snapshot` 到不了被调方。

- [ ] **Step 3: 填框时清掉标记行**

把该函数里的：

```ts
    setSeedancePrompt(formatted);
```

改成：

```ts
    setSeedancePrompt(stripHumanSpeechMarker(formatted));
```

- [ ] **Step 4: 设置声音开关**

在 `setSeedancePromptHighlight(true);` / `setTimeout(() => setSeedancePromptHighlight(false), 2000);` 这两行**之后**、`// 反推完成自动带出：...` 注释**之前**，插入：

```ts
    // 按素材里有没有人声开口自动设置「生成声音」，自动判定只改当前开关，不写入本地记忆。
    // 【明确不调用 rememberManualSeedancePreference()】那个函数会把设置写进 localStorage
    // 并覆盖 normalSeedanceSettingsRef；自动判定一旦写进去，一条恰好有人声的提示词就会把
    // 用户的全局默认永久改成「开声音」。自动结果不落盘。
    // nextGenerateAudio 为 null 表示不表态（历史记录、AI 未按格式输出、该模式不适用），
    // 保持用户设置；false 是明确的「关」。所以这里必须判 !== null，不能简写成 if (x)。
    const nextGenerateAudio = resolveAutoAudioSetting({ hasSpeech, mode: activeMode, model: seedanceModel });
    if (nextGenerateAudio !== null) {
      setSeedanceGenerateAudio(nextGenerateAudio);
    }
```

两点措辞是刻意的：

1. **不要写「只作用于当前这次任务」**——`switchSeedanceTaskMode`（约 2963 行）进入 `video-edit-painting` 时会把当时的 `seedanceGenerateAudio` 存进 `normalSeedanceSettingsRef`，退出时还原，所以自动值在会话内可以活过「这次任务」。真正成立且重要的只有一条：不落盘。
2. **`!== null` 不能简写成 `if (x)`**——`false` 是明确的「关」，真值判断会把「无人声」这一支悄悄丢掉。这是后来者最容易"顺手清理"掉的一处，所以把非对称性写在调用点。

- [ ] **Step 4b: 被调方改为接收快照**

```ts
  function syncReverseMediaToSeedance(snapshot: ReverseSeedanceSyncSnapshot | null) {
    const activeMode = snapshot?.mode || reverseMode;
```

删掉原有的 `const snapshot = pendingReverseSeedanceSyncRef.current;` 与 `pendingReverseSeedanceSyncRef.current = null;` 两行；函数体**其余部分逐字不动**（`painting` 早退、参考图选择、时长逻辑、错误提示都不改）。`ReverseSeedanceSyncSnapshot | null` 正是该 ref 的声明类型（`useRef<ReverseSeedanceSyncSnapshot | null>(null)`），无需断言。

- [ ] **Step 5: 确认改动落位正确**

Run:
```bash
cd frontend-google-ui
grep -n "syncReverseMediaToSeedance" src/pages/CreativeCreationPage.tsx
grep -n "pendingReverseSeedanceSyncRef" src/pages/CreativeCreationPage.tsx
```

Expected: 调用点**只有一个**，且传 `snapshot`；ref 的「读取 + 清空」**只在调用方一处**出现，其余命中只能是 `useRef` 声明、设置快照的三处赋值、以及生成失败路径上的一处清空。被调方不再碰这个 ref。

- [ ] **Step 6: 类型检查**

Run: `cd frontend-google-ui && npm run lint 2>&1 | grep -E "^[a-zA-Z].*\.tsx?\(" | sed -E 's/\([0-9]+,[0-9]+\)//' | sort | uniq -c | sort -rn`

Expected: 输出与前置说明里的基线**完全一致**（`CreativeCreationPage.tsx` 仍是 4× TS2769 + 1× TS2322，行号漂移不算变化）。多出任何一行就是本次改动引入的新类型错误。若新错误是 `activeMode` 类型不匹配，检查是否误改成了 `as` 断言——`ReverseMode` 与 `AutoAudioReverseMode` 是同构联合类型，不需要断言，直接传即可。

- [ ] **Step 6b: 确认没顺手去修无关的既存错误**

**不要**为了让 lint 变干净去修那些既存错误。它们与本次功能无关，修了会让 diff 无法审查。本次改动只允许新增自己那一段代码。

- [ ] **Step 7: 构建**

Run: `cd frontend-google-ui && npm run build`

Expected: 构建成功，输出 `dist/`。无 TypeScript 报错。

- [ ] **Step 8: 提交**

```bash
cd /Users/qichao/Documents/kelongai-cn
git add frontend-google-ui/src/pages/CreativeCreationPage.tsx
git commit -m "Auto set audio switch when syncing prompt to seedance

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

Task 4 实际分两个 commit 落地（都已完成）：`e34ba8b` 完成接线，review 后 `6f286d6` 把快照读取收敛到一处（Step 2 + Step 4b）并修正三处注释措辞。`src/lib/creative.ts` 在本任务中不应被修改。

---

## Task 5: 端到端验证

纯函数已有自动化覆盖。本任务验证的是自动化覆盖不到的部分：提示词模板是否真的让 AI 输出了标记，以及接线在真实交互里是否生效。**这一步需要真实调用模型，不收费的部分先做完。**

- [ ] **Step 1: 回归两个既有测试脚本**

Run:
```bash
cd frontend-google-ui
node --import tsx test-creative-speech-marker.ts
node --import tsx test-sticker-creative.ts
node --import tsx test-video-library-local.ts
```

Expected: 三个脚本各自输出自己的「通过」行，无 assert 失败。确认没有改坏既有测试。

- [ ] **Step 2: 确认标记规则出现在三个模板的实际输出里**

Run: `cd frontend-google-ui && grep -n "【人声判定】" src/pages/CreativeCreationPage.tsx`

Expected: `1` 行 —— 规则模板定义处。三个模板里是 `${HUMAN_SPEECH_MARKER_RULE(...)}` 调用，所以只有定义那行含字面量。这确认了模板存在（调用数由 Task 3 Step 5 的 `grep -c` 确认）。

- [ ] **Step 3: 真实验证（需要模型额度）**

Run: `cd frontend-google-ui && npm run dev`，浏览器打开 `http://localhost:5173`，进入创意创作页。

逐条执行并记录结果：

| # | 操作 | 预期 |
|---|---|---|
| 1 | 直接反推，传一条**有人说话**的视频，等自动同步 | 聊天区第一行出现 `【人物说话：是】`；右侧提示词框**没有**这一行；声音按钮变「生成声音」 |
| 2 | 直接反推，传一条**无人说话**的视频（如纯风景/产品展示） | 标记为 `否`；右侧无标记行；按钮变「不生成声音」 |
| 3 | 图片生视频，传一张**纯风景/静物**图片 | 标记为 `否`，按钮变「不生成声音」 |
| 3b | **图片模式关键用例**：图片生视频，传一张人物静止看向镜头的图片，**附加要求里不写任何开口说话的需求** | 标记为 `否`。这条验证的是图片模式用的是自己的判定标准，而不是去看不存在的音轨 |
| 3c | **图片模式关键用例**：同上图片，但附加要求里明确写「让人物开口说一句欢迎光临」 | 标记为 `是`，按钮变「生成声音」。这条验证附加要求能被模型看到并纳入判定 |
| 3d | **图片模式不定性检查**：图片生视频，传一张**人物张着嘴说话**的照片 | 标记为 `是`（按图片判定标准：人物处于说话状态） |
| 3e | **图片模式误关检查**：纯静物/风景图，附加要求写「加一段旁白讲解」 | 标记为 `是`。人物不在画面里，但用户明确要了人声——判定标准的「用户要求」那一支必须涵盖旁白/配音，否则会误关 |
| 4 | 元素替换，传一条有人声的视频 | 标记为 `是`，按钮变「生成声音」 |
| 5 | **关键用例**：找一条只有旁白/画外音、画面人物不张嘴的视频 | 必须是 `是`（本期边界定义：有无人声开口，不看是否张嘴） |
| 6 | 从历史记录里打开一条**改造前**生成的反推结果，点「同步最新提示词」 | 无标记，走 `null` 分支，声音按钮**保持原状态不变** |
| 7 | 任意一次自动设置后，手动点一下声音按钮 | 点击生效；不会被再次自动覆盖（同步只在点击时发生） |
| 8 | 切到 `MiniMax-H3` 模型后同步 | 按钮显示「H3无声音开关」且禁用；不报错 |
| 9 | 切到左侧第四个标签「装饰画创意素材」，走一遍原有流程 | 声音相关行为与改造前完全一致（该模块不受影响） |

- [ ] **Step 4: 记录结果**

把上表逐条结果写进本计划文件末尾的「验证记录」小节，或直接回报给用户。任何一条不符合预期，回到对应 Task 排查——不要带着失败项收尾。

---

## 验证记录

（执行时填写）

---

## 自查

**Spec 覆盖**
- 标记规则与三处模板注入 → Task 3
- 标记措辞单一事实来源（`HUMAN_SPEECH_MARKER_TOKENS`）→ Task 1 导出，Task 3 插值，Task 3 Step 4c 源码断言 + Step 5b + Step 5c 变异测试守住
- 图片模式用独立判定标准（静态图无音轨，不能沿用「素材里有没有人声开口」）→ Task 3 Step 1 + Step 4 + Task 5 表 #3/#3b/3c/3d
- 「严格十二个部分」与新增第一行不冲突 → Task 3 Step 4b
- 标记解析 / 清理纯函数 → Task 1
- 决策真值表（painting / H3 / null / true / false）→ Task 2
- `activeMode` 顺序陷阱 → Task 4 Step 2 + Step 4b（不是靠注释警告，而是把快照读取收敛到一处，让顺序依赖从结构上消失）
- 不调用 `rememberManualSeedancePreference` → Task 4 Step 4
- 聊天区保留标记、右侧输入框去掉 → Task 4 Step 3 + Task 5 Step 3 表 #1
- 旧记录走 `null` 分支 → Task 1 测试 + Task 5 表 #6
- 第四个模块不受影响 → Task 2 测试 + Task 5 表 #9
- 构建与类型检查 → Task 3 Step 6、Task 4 Step 6/7 |
- 无新增依赖、无后端改动 → 全计划未涉及

**类型一致性**
- `extractHumanSpeechMarker(text: string): boolean | null` —— Task 1 定义，Task 4 Step 2 调用，一致。
- `stripHumanSpeechMarker(text: string): string` —— Task 1 定义，Task 4 Step 3 调用，一致。
- `resolveAutoAudioSetting({ hasSpeech, mode, model })` —— Task 2 定义，Task 4 Step 4 调用，字段名 `hasSpeech` / `mode` / `model` 三处一致。
- `AutoAudioReverseMode` —— 仅作参数类型，不导出使用方需要额外处理。

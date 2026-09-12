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

然后在同文件中找到 `PAINTING_WOOD_BAR_OUTPUT_RULE` 的定义（约第 626 行），在它**下面**新增：

```ts
const HUMAN_SPEECH_MARKER_RULE = `【人声判定】必须在输出的第一行、且在“一、核心主体信息”之前，单独写一行机器可读标记：${HUMAN_SPEECH_MARKER_TOKENS.yes}或${HUMAN_SPEECH_MARKER_TOKENS.no}。判定标准：只要素材中存在人声开口，包括人物台词、对话、口播、独白、旁白、画外音，无论画面中是否能看到人物张嘴，一律写“是”；只有纯背景音乐、纯环境音效、完全无声的素材才写“否”。这一行是给程序读取的，必须严格使用上述格式，不得改写措辞、不得添加其他字符。`;
```

**不要**把 `【人物说话：是】`／`【人物说话：否】` 直接抄进这个字符串。必须走 `HUMAN_SPEECH_MARKER_TOKENS` 插值——原因见下方「标记措辞的单一事实来源」。注意这里必须用**反引号模板字符串**（不是单引号），否则 `${...}` 不会生效。

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
光影和氛围。\n\n${HUMAN_SPEECH_MARKER_RULE}\n\n${VIDEO_CONTEXT_ISOLATION_RULE}\n\n请严格按以下结构输出：
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

${HUMAN_SPEECH_MARKER_RULE}

${VIDEO_CONTEXT_ISOLATION_RULE}
```

- [ ] **Step 4: 注入 `IMAGE_TO_VIDEO_PROMPT`（图片生视频）**

在该模板的 `return \`...\`` 里，把：

```
动态细节。\n\n${imageIsolationRule}\n\n请严格按以下结构输出：
```

改成：

```
动态细节。\n\n${HUMAN_SPEECH_MARKER_RULE}\n\n${imageIsolationRule}\n\n请严格按以下结构输出：
```

- [ ] **Step 5: 确认三处都注入了，且没有多注**

Run: `cd frontend-google-ui && grep -c "HUMAN_SPEECH_MARKER_RULE" src/pages/CreativeCreationPage.tsx`

Expected: `4` —— 1 处常量定义 + 3 处模板插值。

- [ ] **Step 5b: 确认没有硬编码标记字面量漏进来**

Run: `cd frontend-google-ui && grep -n "人物说话" src/pages/CreativeCreationPage.tsx`

Expected: **无输出**（退出码 1）。这是本任务最重要的一条检查：一旦这里出现字面量，就说明有人把标记措辞抄成了第四份，而这个文件里没有正则能保护它。措辞只能从 `HUMAN_SPEECH_MARKER_TOKENS` 来，所以这个文件里不该出现「人物说话」四个字。

- [ ] **Step 6: 类型检查**

Run: `cd frontend-google-ui && npm run lint 2>&1 | grep -E "^[a-zA-Z].*\.tsx?\(" | sed -E 's/\([0-9]+,[0-9]+\)//' | sort | uniq -c | sort -rn`

Expected: 输出与前置说明里的基线**完全一致**。`CreativeCreationPage.tsx` 本来就贡献 4× TS2769 + 1× TS2322，插入新行后行号会漂移，所以剥掉行列号比对——条数和内容都不能变。

- [ ] **Step 7: 提交**

```bash
cd /Users/qichao/Documents/kelongai-cn
git add frontend-google-ui/src/pages/CreativeCreationPage.tsx
git commit -m "Require speech marker in reverse prompt templates

Co-Authored-By: Claude Code <noreply@anthropic.com>"
```

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

- [ ] **Step 2: 在 `syncLatestPromptToSeedance()` 里先读 `activeMode`**

找到 `syncLatestPromptToSeedance()`（约第 2726 行）。在 `if (!latestAssistantText) { ... }` 这个早退块**之后**、`const formatted = latestAssistantText` **之前**，插入：

```ts
    // 必须在 syncReverseMediaToSeedance() 之前读取：它一进来就会把 pendingReverseSeedanceSyncRef 置空。
    const activeMode = pendingReverseSeedanceSyncRef.current?.mode || reverseMode;
    const hasSpeech = extractHumanSpeechMarker(latestAssistantText);
```

**顺序是硬性要求。** `syncReverseMediaToSeedance()` 的第一行就是 `pendingReverseSeedanceSyncRef.current = null`，它在本函数末尾被调用。若把这两行放到它后面，`activeMode` 会退化成当前的 `reverseMode`，用户切过左侧标签页后会判错模块。

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
    // 自动判定素材中是否有人声开口，并据此设置声音开关；判定不出来时不动用户的手动设置。
    // 这里刻意不调用 rememberManualSeedancePreference()：自动结果不应写进 localStorage 改变全局默认。
    const nextGenerateAudio = resolveAutoAudioSetting({ hasSpeech, mode: activeMode, model: seedanceModel });
    if (nextGenerateAudio !== null) {
      setSeedanceGenerateAudio(nextGenerateAudio);
    }
```

- [ ] **Step 5: 确认改动落位正确**

Run: `cd frontend-google-ui && sed -n '/function syncLatestPromptToSeedance/,/^  }/p' src/pages/CreativeCreationPage.tsx`

Expected: 依次能看到 —— 早退块 → `const activeMode = ...` → `const hasSpeech = ...` → `const formatted = ...` → `setSeedancePrompt(stripHumanSpeechMarker(formatted));` → `resolveAutoAudioSetting(...)` 与 `if (nextGenerateAudio !== null)` → 最后一行 `syncReverseMediaToSeedance();`。

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

Expected: `1` 行 —— 常量定义处。模板里是 `${HUMAN_SPEECH_MARKER_RULE}` 插值，所以只有常量那行含字面量。这确认了常量存在且被引用（引用数由 Task 3 Step 5 的 `grep -c` 确认）。

- [ ] **Step 3: 真实验证（需要模型额度）**

Run: `cd frontend-google-ui && npm run dev`，浏览器打开 `http://localhost:5173`，进入创意创作页。

逐条执行并记录结果：

| # | 操作 | 预期 |
|---|---|---|
| 1 | 直接反推，传一条**有人说话**的视频，等自动同步 | 聊天区第一行出现 `【人物说话：是】`；右侧提示词框**没有**这一行；声音按钮变「生成声音」 |
| 2 | 直接反推，传一条**无人说话**的视频（如纯风景/产品展示） | 标记为 `否`；右侧无标记行；按钮变「不生成声音」 |
| 3 | 图片生视频，传一张**画面中人物看图未说话**的图片 | 标记为 `否`，按钮变「不生成声音」 |
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
- 标记措辞单一事实来源（`HUMAN_SPEECH_MARKER_TOKENS`）→ Task 1 导出，Task 3 插值，Task 3 Step 5b 守住
- 标记解析 / 清理纯函数 → Task 1
- 决策真值表（painting / H3 / null / true / false）→ Task 2
- `activeMode` 顺序陷阱 → Task 4 Step 2
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

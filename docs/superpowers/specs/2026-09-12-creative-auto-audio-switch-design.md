# 创意创作：提示词同步时自动开关「声音」设计

## 背景与问题

创意创作页左侧「模块一 视频反推提示词」有三个子模块：直接反推、元素替换、图片生视频。它们生成的反推结果会同步到右侧「模块二 AI 生成视频」的提示词输入框。

同步之后，右侧的「生成声音 / 不生成声音」开关需要用户自己判断并手动点击。用户需求：

> 这三个模块最终生成的提示词填到右边 C 端提示词窗口时，如果提示词里涉及人物说话，自动把声音按钮打开；不涉及台词说话内容，就自动关闭。

现状问题：反推结果里有没有台词，用户得自己读完整个分析再决定，容易漏判；改错了要等视频生成完才发现。

## 目标

在**不新增页面、不新增接口、不新增依赖**的前提下：

- 提示词同步到右侧时，自动按「素材中是否有人声开口」设置声音开关；
- 判定只发生一次，行为可预期，不干扰用户后续手动操作；
- 自动结果不写入本地记忆，不污染用户已有的手动偏好。

## 术语与判定边界

判定标准**按模式分两套**，因为输入形态不同：视频有音轨，静态图片没有。

### 视频模式（直接反推、元素替换）：看音轨

**「有人声开口」= 是**：人物台词、对话、口播、独白、旁白、画外音。不论画面里是否看得到人物张嘴，只要有人声说话内容就算。

**只有以下情况算「否」**：纯背景音乐、纯环境音效、纯无声素材。

### 图片模式（图片生视频）：看画面里人物的说话状态

输入是静态图片，没有音轨，所以不能沿用上面那条——字面执行会恒判「否」，等于每次同步都把声音关掉；而模型遇到「照片里人物张着嘴」也可能反答「是」，行为不稳定。

**算「是」**：图片中的人物处于说话状态（张嘴说话、手持话筒、口播或演唱姿态等），**或者**用户在本条任务的其他调整要求（如有）里明确要求出现人声——包括人物开口说话、**旁白、口播、配音**等。

**算「否」**：纯风景、纯静物、人物只是静止看向镜头等没有说话意图的图片，**且**用户未要求出现人声。

「用户要求」那一支必须涵盖旁白/配音，不能只写「人物开口说话」：产品图、展厅图配「加一段旁白讲解」「加入口播介绍」是这个模块的常见用法，若只认人物开口，两个分支都不命中，反而会把用户明确要的声音关掉——正是本设计要避免的误关。

判定的是用户真正关心的东西——**生成出来的视频会不会有台词**，而不是输入素材有没有音轨。

### 共同点

判定由反推用的 AI 完成——它是唯一真正看过素材的一方。关键词规则在本期不做。

## 设计方案

### 改动范围

1. `frontend-google-ui/src/lib/creative.ts`：新增 3 个纯函数和 1 个联合类型（约 35 行）。
2. `frontend-google-ui/src/pages/CreativeCreationPage.tsx`：新增 1 个规则模板 + 2 条判定标准、在 3 个提示词模板里各插值一次、修正 `VIDEO_REVERSE_FORMAT_SUFFIX` 的「十二个部分」措辞、在 `syncLatestPromptToSeedance()` 里接 8 行（约 30 行）。
3. `frontend-google-ui/test-creative-speech-marker.ts`：新增，覆盖两个解析函数和决策真值表，另加源码断言钉住「提示词模板 ↔ 权威 token」。

无新增依赖、无后端改动。

**测试约定**：本仓库没有 vitest/jest，沿用现有的独立脚本约定——根目录 `test-*.ts`，`node:assert/strict`，`node --import tsx test-xxx.ts` 运行，与 `test-sticker-creative.ts`、`test-video-library-local.ts` 同风格。`tsconfig.json` 没有 `include`/`exclude`，所以 `npm run lint`（`tsc --noEmit`）会一并检查测试脚本。

### 1. 让反推 AI 输出机器可读标记

在 `CreativeCreationPage.tsx` 顶部常量区新增共享常量，与现有 `VIDEO_CONTEXT_ISOLATION_RULE`、`PAINTING_WOOD_BAR_RULE` 同级：

规则模板接受一个「判定标准」参数，判定标准按模式给：

```ts
// 判定标准随模式而异：视频看音轨里有没有人声，图片没有音轨，只能看画面里人物的说话状态。
const HUMAN_SPEECH_MARKER_RULE = (criterion: string) => `【人声判定】必须在输出的第一行、且在“一、核心主体信息”之前，单独写一行机器可读标记：${HUMAN_SPEECH_MARKER_TOKENS.yes}或${HUMAN_SPEECH_MARKER_TOKENS.no}。判定标准：${criterion}这一行是给程序读取的，必须严格使用上述格式，不得改写措辞、不得添加其他字符。`;

const HUMAN_SPEECH_CRITERION_VIDEO = '只要素材中存在人声开口，……一律写“是”；只有纯背景音乐、纯环境音效、完全无声的素材才写“否”。';

const HUMAN_SPEECH_CRITERION_IMAGE = '只要图片中的人物处于说话状态（张嘴说话、手持话筒、口播或演唱姿态等），或者用户在本条任务的其他调整要求（如有）里明确要求出现人声——包括人物开口说话、旁白、口播、配音等，一律写“是”；纯风景、纯静物、人物只是静止看向镜头等没有说话意图的图片，且用户未要求出现人声的，一律写“否”。';
```

在三个模板的正文开头各插值一次：

| 模板 | 插入位置 | 对应子模块 | 判定标准 |
|---|---|---|---|
| `VIDEO_REVERSE_PROMPT` | 开头指令句之后、`VIDEO_CONTEXT_ISOLATION_RULE` 之前 | 直接反推 | `_VIDEO` |
| `VIDEO_REPLACE_PROMPT` | 开头四步任务说明之后、`buildReverseDurationRule` 之前 | 元素替换 | `_VIDEO` |
| `IMAGE_TO_VIDEO_PROMPT` | 开头指令句之后、`${imageIsolationRule}` 之前 | 图片生视频 | `_IMAGE` |

图片模式引用用户要求时用的是**实际渲染出来的措辞**「其他调整要求」，不是「附加要求」——后者在页面里只出现在这条判定标准自己身上，模型看不到那个标签。用户的文本由 `IMAGE_TO_VIDEO_PROMPT` 渲染成「其他调整要求：…」（在「本次可选调整」里），与判定标准同属一条消息，模型能直接看到。写成「（如有）」是为了在该段因未填附加要求而整体缺席时仍读得通。

**同时要解除与「十二个部分」的措辞冲突。** `VIDEO_REVERSE_FORMAT_SUFFIX` 在 `handleSend` 里被追加到反推提示词的**最末尾**（位置最靠后、最显眼），原文是「请严格按照以上十二个部分输出」，而标记是第一部分**之前**的第十三样东西。该串开头改为「除第一行的人声判定标记外，请严格按照以上十二个部分输出」。该后缀只在这三个模板上追加（`isReversePrompt` 要求同时含 `核心主体信息` 与 `待复刻样片`/`唯一的视觉基准`），所以这道例外条款在它到达的每一处都成立。

**为什么放第一行而不是最后一行**：现有格式规则已经把「最后一行」占给了 `总时长：X秒`（见 `VIDEO_REVERSE_FORMAT_SUFFIX`），且 `extractVideoGenerationDurationFromPrompt` 取的是全文**最后一个**匹配。标记放开头与时长解析互不干扰。

### 2. 解析函数（`src/lib/creative.ts`）

与现有 `extractVideoGenerationDurationFromPrompt` 同风格，新增：

```ts
// 全文搜索而非只认第一行，AI 把标记写到别处也能读到
export function extractHumanSpeechMarker(text: string): boolean | null

// 删除标记行（含其所在行的换行），保证右侧输入框干净
export function stripHumanSpeechMarker(text: string): string
```

标记正则：`/【\s*人物说话\s*[：:]\s*(是|否)\s*】/`，取首个匹配。

**标记措辞的单一事实来源。** `【人物说话：是/否】` 是横跨三方的契约：这里的解析正则、第 1 节提示词模板里的规则文本、以及 AI 实际输出的格式。

这个耦合是不对称的：提示词措辞和正则一旦对不上，AI 会输出新措辞，`extractHumanSpeechMarker` 返回 `null`——而 `null` 的语义恰好是「旧记录，不要碰开关」。功能于是**静默失效**：没有异常、没有日志、没有测试失败，现象酷似「历史兼容逻辑正常生效」，极难排查。

因此 `creative.ts` 额外导出一份权威 token：

```ts
export const HUMAN_SPEECH_MARKER_TOKENS = { yes: '【人物说话：是】', no: '【人物说话：否】' } as const;
```

提示词规则**必须插值**它，不得另抄字面量；正则保持宽松解析（容忍半角冒号与空白），因为正则要容错 AI 的写法偏移，而 token 是要求 AI 输出的规范写法。改措辞只需改 token 一处，测试会立刻暴露跟不上的地方。

**这条不变式由测试钉住，而不是靠注释提醒。** `test-creative-speech-marker.ts` 除了覆盖两个解析函数，还用源码断言检查 `CreativeCreationPage.tsx`：必须含 `${HUMAN_SPEECH_MARKER_TOKENS.yes}` / `.no` 插值、不得出现「人物说话」字面量、三个模板各插值一次规则。原因是「token ↔ 解析器」那一半原本已有测试，但「规则文案 ↔ token」那一半没有——而恰恰是这一半断了才走静默失效路径。断言本身做过变异测试（手抄字面量、漏掉一个模板）确认会红，不是恒真的摆设。

`extractHumanSpeechMarker` 返回三态：

- `true` — 有人声开口
- `false` — 无人声开口
- `null` — 没找到标记（历史记录、AI 未按格式输出）

### 3. 决策函数（`src/lib/creative.ts`）

决策逻辑做成纯函数放进 `creative.ts`，而不是内联在组件里——这张真值表是本功能唯一的实际逻辑，放纯函数才能被 `test-*.ts` 覆盖：

```ts
export type AutoAudioReverseMode = 'direct' | 'replace' | 'image' | 'painting';

export function resolveAutoAudioSetting(options: {
  hasSpeech: boolean | null;
  mode: AutoAudioReverseMode;
  model: string;
}): boolean | null
```

按顺序短路，任一命中即返回 `null`（不改动开关）：

| 条件 | 返回 | 理由 |
|---|---|---|
| `mode` 不在 `{direct, replace, image}` 内 | `null` | 第四个反推模式「装饰画创意素材」不在范围内，与 `syncReverseMediaToSeedance()` 中现有的 `if (activeMode === 'painting') return;` 保持一致 |
| `model === 'MiniMax-H3'` | `null` | 该模型音轨随模型，声音按钮本就 `disabled`，改了也不生效 |
| `typeof hasSpeech !== 'boolean'` | `null`，不猜 | 历史记录和格式异常时保持现状，避免误关掉用户需要的声音 |
| `hasSpeech === true` / `false` | `true` / `false` | 本期唯一的行为 |

**第一行用放行式（allow-list）而不是排除式。** `null` 的语义就是「超出范围」，而将来新增的反推模式**按定义**就是超出范围的。排除式（只判 `painting`）会把新增模式静默放进自动设置分支；放行式让它落到安全默认 `null`，即保持用户的手动设置——也就是本功能上线前的状态。代价不对称，取安全的一侧。

**第三行用 `typeof` 而不是 `=== null || === undefined` 两连判。** 后者在声明的参数类型下 `undefined` 那一支不可达（唯一生产者 `extractHumanSpeechMarker` 返回 `boolean | null`），也测不到。`typeof` 一句同时涵盖两者，并且让声明的返回类型 `boolean | null` 按构造成立——`return hasSpeech` 在这一行之后必然是 `boolean`。

组件侧只保留三行：拿到返回值，非 `null` 才调 `setSeedanceGenerateAudio`。

`AutoAudioReverseMode` 与页面里的 `ReverseMode` 是同构联合类型，页面的 `reverseMode` 可直接传入，无需类型断言。

**明确不调用 `rememberManualSeedancePreference()`**：该函数会把设置写进 `localStorage` 并覆盖 `normalSeedanceSettingsRef`。自动判定如果写进去，一条恰好有人说话的提示词就会把用户的全局默认永久改成「开声音」。自动结果不落盘。

（注意措辞：是「不落盘」，不是「只作用于当前这次任务」。`switchSeedanceTaskMode` 进入 `video-edit-painting` 时会把当时的开关值存进 `normalSeedanceSettingsRef`、退出时还原，所以自动值在会话内可以活过「这次任务」。真正成立且重要的是不写入 `localStorage`。）

### 4. 接入点

`syncLatestPromptToSeedance()`（约 2743 行）是唯一接入点——自动同步（`useEffect` 里 `autoSyncToSeedanceRef` 命中时）和手动点「同步最新提示词」按钮都走这里。

执行顺序：

1. `const snapshot = pendingReverseSeedanceSyncRef.current; pendingReverseSeedanceSyncRef.current = null;` —— 快照在这里**读一次并就地清空**，位置在 `!latestAssistantText` 早退之后（早退不该消费快照）。
2. `const activeMode = snapshot?.mode || reverseMode;` —— 从上面那个快照推导，不重复读 ref。
3. `const hasSpeech = extractHumanSpeechMarker(latestAssistantText);` —— 必须用**原始文本**判定，不能用 strip 之后的输出（strip 已经把标记删掉了）。
4. `setSeedancePrompt(stripHumanSpeechMarker(formatted));` —— 右侧输入框不含标记行。
5. 设置开关：

```ts
const nextGenerateAudio = resolveAutoAudioSetting({ hasSpeech, mode: activeMode, model: seedanceModel });
if (nextGenerateAudio !== null) {
  setSeedanceGenerateAudio(nextGenerateAudio);
}
```

6. `syncReverseMediaToSeedance(snapshot);` —— 现有调用，保持在最后，并把**同一个快照**传进去。

**为什么快照只读一次。** 最初的实现是调用方读一次、被调方自己再读一次，两者靠一句注释维持一致——而 `syncReverseMediaToSeedance()` 当时一进来就清空 ref，使调用方的读取顺序成为隐式约束：任何一次调换两条相邻语句，都会静默判错模块，正是本功能设计上要避免的失效类型。改成传快照后，ref 只有一处读、一处写，顺序依赖**从结构上消失**。被调方因此接收 `snapshot: ReverseSeedanceSyncSnapshot | null`（正是该 ref 的声明类型，无需断言），函数体其余部分逐字不变。

**`!== null` 不能简写成 `if (nextGenerateAudio)`。** `false` 是明确的「关」，真值判断会把「无人声」这一支悄悄丢掉——而那正是用户需求的一半。这是最容易被「顺手清理」掉的一处，因此由测试源码断言钉住。

`activeMode` 的取值只此一处，不再有第二套口径；被调方拿到的是已经算好的快照。

### 5. 用户可见行为

- 「豆包分析记录」聊天区**保留**标记行。用户能直接看到 AI 判的是「是」还是「否」，误判时一眼可查，也便于后续调提示词。
- 右侧提示词输入框**去掉**标记行，不给视频模型发与画面无关的杂讯。
- 判定只在同步那一刻发生一次。之后用户手动改提示词不会重判，随时可以手动点开关覆盖。

## 保留不变

- 声音开关的手动点击逻辑、`rememberManualSeedancePreference` 的持久化行为；
- 第四个模块「装饰画创意素材」的全部现有流程（含 `video-edit-painting` 强制 `generateAudio: true`）；
- 时长解析（`extractVideoGenerationDurationFromPrompt`）与参考图自动带出（`syncReverseMediaToSeedance`）；
- 历史任务恢复时 `setSeedancePrompt` + `setSeedanceGenerateAudio` 按存档还原的路径——那是恢复已保存任务，不是本次同步，不受本改动影响；
- 三个模板中现有的全部约束内容。

## 本期不做

- 关键词规则兜底（用户明确选择纯 AI 标记方案）；
- 用户编辑右侧提示词后的实时重判（需防抖 + 手动/自动冲突处理，复杂度不成比例）；
- 自动结果写入本地记忆；
- 第四个模块。

## 验证方式

1. **视频模式正例**：直接反推 / 元素替换，各跑 1 条有人声开口的素材、1 条无人声的素材，确认开关结果符合预期。
2. **旁白用例**：至少 1 条只有旁白、画面中人物不开口的素材，确认识别为「是」（这是视频侧边界定义的关键用例）。
3. **图片模式三个用例**（本期判定标准拆分的直接验证）：
   - 纯风景/静物图 →「否」；
   - 人物静止看向镜头的图、附加要求不写开口需求 →「否」（证明走的是图片标准，而不是去读不存在的音轨）；
   - 同上图片但附加要求写「让人物开口说一句欢迎光临」→「是」（证明附加要求能被模型看到并纳入判定）；
   - **纯静物/风景图 + 附加要求写「加一段旁白讲解」→「是」**（证明「用户要求」那一支涵盖旁白/配音，不是只认人物开口）；
   - 人物张着嘴说话的照片 →「是」。
4. **旧记录回归**：取一条改造前生成的历史记录同步一次，确认开关纹丝不动（走 `null` 分支）。
5. **聊天区与输入框**：确认聊天区能看到标记行，右侧输入框没有。
6. **手动覆盖**：自动设置后手动点一次开关，确认点击生效且不被再次同步覆盖（同步只在点击时发生）。
7. **MiniMax-H3**：切到该模型后同步，确认不报错、开关状态不被改动。
8. `cd frontend-google-ui && node --import tsx test-creative-speech-marker.ts` 通过，输出 `前端人声标记测试通过：...`。该脚本同时跑源码断言（三个模板的插值、无手抄字面量）。
9. `cd frontend-google-ui && npm run build` 通过。`npm run lint` 在本仓库改动前就有 11 个既存错误（详见实施计划的前置说明），验收标准是**不新增错误**，不是全绿。

## 风险与兜底

| 风险 | 兜底措施 |
|---|---|
| AI 不按格式输出标记 | 解析返回 `null`，开关保持原样（不猜）。提示词中已用「必须」「严格使用上述格式」措辞强化 |
| AI 把标记写到第一行以外 | 解析是全文搜索，不依赖行位置 |
| 标记行被写进右侧提示词 | `stripHumanSpeechMarker` 在填框前清除；验证方式第 5 条专门检查 |
| 图片模式判定标准仍按音轨写（该模式没有音轨，会恒判「否」并每次关掉声音） | 图片模式用独立判定标准（看画面里人物的说话状态 + 用户附加要求），验证方式第 3 条四个用例专门覆盖 |
| 判定错误导致声音该开没开 | 标记在聊天区可见，用户可当场发现并手动点开；这是本期选择「可见标记」而非「静默判定」的原因 |
| 新增约束稀释原有约束的遵循度 | 标记规则是单行强指令，插在三处模板开头；不修改任何现有约束的措辞 |

## 影响范围

- **前端**：`src/lib/creative.ts`、`src/pages/CreativeCreationPage.tsx` 两个文件。
- **后端**：无改动。
- **数据/状态**：无新增字段、无 `localStorage` schema 变更。
- **API 接口**：无新增/变更，不增加模型调用次数（标记随原有反推请求一起返回）。

## 下一步

按本设计实现两个文件的改动，完成后按「验证方式」逐条本地验证。

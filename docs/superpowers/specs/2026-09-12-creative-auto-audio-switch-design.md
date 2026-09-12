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

**「有人声开口」= 是**：人物台词、对话、口播、独白、旁白、画外音。不论画面里是否看得到人物张嘴，只要有人声说话内容就算。

**只有以下情况算「否」**：纯背景音乐、纯环境音效、纯无声素材。

判定由反推用的 AI 完成——它是唯一真正看过素材的一方。关键词规则在本期不做。

## 设计方案

### 改动范围

1. `frontend-google-ui/src/lib/creative.ts`：新增 2 个纯函数（约 25 行）。
2. `frontend-google-ui/src/pages/CreativeCreationPage.tsx`：新增 1 个共享常量、在 3 个提示词模板里各插值一次、新增 1 个应用函数、在 `syncLatestPromptToSeedance()` 里调用（约 20 行）。

无新增文件、无新增依赖、无后端改动。

### 1. 让反推 AI 输出机器可读标记

在 `CreativeCreationPage.tsx` 顶部常量区新增共享常量，与现有 `VIDEO_CONTEXT_ISOLATION_RULE`、`PAINTING_WOOD_BAR_RULE` 同级：

```ts
const HUMAN_SPEECH_MARKER_RULE = '【人声判定】必须在输出的第一行、且在“一、核心主体信息”之前，单独写一行机器可读标记：【人物说话：是】或【人物说话：否】。判定标准：只要素材中存在人声开口，包括人物台词、对话、口播、独白、旁白、画外音，无论画面中是否能看到人物张嘴，一律写“是”；只有纯背景音乐、纯环境音效、完全无声的素材才写“否”。这一行是给程序读取的，必须严格使用上述格式，不得改写措辞、不得添加其他字符。';
```

在三个模板的正文开头各插值一次 `${HUMAN_SPEECH_MARKER_RULE}`：

| 模板 | 位置 | 对应子模块 |
|---|---|---|
| `VIDEO_REVERSE_PROMPT` | 开头指令句之后、`VIDEO_CONTEXT_ISOLATION_RULE` 之前 | 直接反推 |
| `VIDEO_REPLACE_PROMPT` | 开头四步任务说明之后、`buildReverseDurationRule` 之前 | 元素替换 |
| `IMAGE_TO_VIDEO_PROMPT` | 开头指令句之后、`${imageIsolationRule}` 之前 | 图片生视频 |

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

`extractHumanSpeechMarker` 返回三态：

- `true` — 有人声开口
- `false` — 无人声开口
- `null` — 没找到标记（历史记录、AI 未按格式输出）

### 3. 应用函数（`CreativeCreationPage.tsx`）

新增 `applyAutoAudioSetting(hasSpeech: boolean | null, activeMode: string)`，按顺序短路，任一命中即不改动开关：

| 条件 | 行为 | 理由 |
|---|---|---|
| `activeMode === 'painting'` | 跳过 | 第四个模块不在范围内，与 `syncReverseMediaToSeedance()` 中现有的 `if (activeMode === 'painting') return;` 保持一致 |
| `seedanceModel === 'MiniMax-H3'` | 跳过 | 该模型音轨随模型，声音按钮本就 `disabled`，改了也不生效 |
| `hasSpeech === null` | 跳过，不猜 | 历史记录和格式异常时保持现状，避免误关掉用户需要的声音 |
| `hasSpeech === true` / `false` | `setSeedanceGenerateAudio(true / false)` | 本期唯一的行为 |

**明确不调用 `rememberManualSeedancePreference()`**：该函数会把设置写进 `localStorage` 并覆盖 `normalSeedanceSettingsRef`。自动判定如果写进去，一条恰好有人说话的提示词就会把用户的全局默认永久改成「开声音」。自动结果只作用于当前这次任务的状态。

### 4. 接入点

`syncLatestPromptToSeedance()`（约 2726 行）是唯一接入点——自动同步（`useEffect` 里 `autoSyncToSeedanceRef` 命中时）和手动点「同步最新提示词」按钮都走这里。

执行顺序（**顺序有硬性要求**）：

1. `const activeMode = pendingReverseSeedanceSyncRef.current?.mode || reverseMode;` —— 必须在第 4 步之前读。`syncReverseMediaToSeedance()` 一进来就执行 `pendingReverseSeedanceSyncRef.current = null`，读完再调它就取不到了。这是本次改动最容易踩的坑。
2. `const hasSpeech = extractHumanSpeechMarker(latestAssistantText);` —— 用原始文本判定，先算，避免 strip 影响匹配。
3. `setSeedancePrompt(stripHumanSpeechMarker(formatted));` —— 右侧输入框不含标记行。
4. `applyAutoAudioSetting(hasSpeech, activeMode);` —— 设置开关。
5. `syncReverseMediaToSeedance();` —— 现有调用，保持在最后。

`activeMode` 的取值方式与 `syncReverseMediaToSeedance()` 内部完全一致，不引入第二套口径。

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

1. **六个正例**：直接反推 / 元素替换 / 图片生视频，各跑 1 条有人声开口的素材、1 条无人声的素材，确认开关结果符合预期。
2. **旁白用例**：至少 1 条只有旁白、画面中人物不开口的素材，确认识别为「是」（这是本期边界定义的关键用例）。
3. **旧记录回归**：取一条改造前生成的历史记录同步一次，确认开关纹丝不动（走 `null` 分支）。
4. **聊天区与输入框**：确认聊天区能看到标记行，右侧输入框没有。
5. **手动覆盖**：自动设置后手动点一次开关，确认点击生效且不被再次同步覆盖（同步只在点击时发生）。
6. **MiniMax-H3**：切到该模型后同步，确认不报错、开关状态不被改动。
7. `cd frontend-google-ui && npm run build` 通过。

## 风险与兜底

| 风险 | 兜底措施 |
|---|---|
| AI 不按格式输出标记 | 解析返回 `null`，开关保持原样（不猜）。提示词中已用「必须」「严格使用上述格式」措辞强化 |
| AI 把标记写到第一行以外 | 解析是全文搜索，不依赖行位置 |
| 标记行被写进右侧提示词 | `stripHumanSpeechMarker` 在填框前清除；验证方式第 4 条专门检查 |
| 判定错误导致声音该开没开 | 标记在聊天区可见，用户可当场发现并手动点开；这是本期选择「可见标记」而非「静默判定」的原因 |
| 新增约束稀释原有约束的遵循度 | 标记规则是单行强指令，插在三处模板开头；不修改任何现有约束的措辞 |

## 影响范围

- **前端**：`src/lib/creative.ts`、`src/pages/CreativeCreationPage.tsx` 两个文件。
- **后端**：无改动。
- **数据/状态**：无新增字段、无 `localStorage` schema 变更。
- **API 接口**：无新增/变更，不增加模型调用次数（标记随原有反推请求一起返回）。

## 下一步

按本设计实现两个文件的改动，完成后按「验证方式」逐条本地验证。

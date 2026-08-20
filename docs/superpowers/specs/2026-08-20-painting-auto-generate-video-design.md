# 挂画创意素材「自动生成视频」功能设计

## 背景与需求

当前挂画创意素材模块中，用户点击「生成完整提示词」后，系统会自动：
- 把生成的提示词填入右侧 Seedance 提示词框；
- 自动识别提示词里的「总时长：X秒」并设置视频时长；
- 把挂画图片追加到 Seedance 参考图片中。

用户希望再增加一个「自动生成视频」按钮，点击后一次性完成上述全部动作，并自动触发右侧 Seedance 的「开始生成视频」。同时保留原有「生成完整提示词」按钮的单一流程不变。

另外，如果提交给 Seedance 的提示词没有附带图片，必须弹出确认窗口，让用户确认是否主动这么操作。

## 目标

- 在「生成完整提示词」按钮旁边新增「自动生成视频」按钮；
- 点击后自动：生成提示词 → 填入提示词 → 设置时长 → 追加挂画图片 → 触发 Seedance 任务创建；
- 复用现有确认逻辑：无参考图片时弹出确认窗口；
- 原有「生成完整提示词」按钮行为完全不变；
- 不引入新的对话框库，复用 `window.confirm` 或页面现有弹窗风格。

## 根因与关键实现点

### 状态闭包问题

`handlePaintingGeneratePrompt` 是异步函数，内部通过 `setState` 更新 `seedancePrompt`、`seedanceDuration`、`seedanceReferences`。如果直接在它后面调用 `handleCreateSeedanceVideo`，后者读取的是旧闭包中的状态，可能拿到未更新的值。

因此需要：
- 让 `handlePaintingGeneratePrompt` 在 setState 的同时，把计算好的新值返回给调用方；
- 让 `handleCreateSeedanceVideo` 支持通过参数传入提示词、时长、参考素材，优先使用传入值而非闭包状态。

### 无图片确认

现有 `handleCreateSeedanceVideo` 已经实现了无参考素材的确认弹窗：

```javascript
if (!isVideoEdit && seedanceReferences.length === 0) {
  const confirmed = window.confirm('当前未添加任何参考图片或视频，确定只使用文本提示词生成视频吗？');
  if (!confirmed) return;
}
```

自动流程复用该函数即可自然满足「无图片弹窗确认」的需求，无需新增弹窗逻辑。

## 设计方案

### 改动范围

仅修改 `frontend-google-ui/src/pages/CreativeCreationPage.tsx`。

### 1. 提取参考素材计算函数

把 `appendPaintingToSeedanceReferences` 中「计算追加挂画图片后的新 references 数组」的逻辑抽成纯函数 `computeNextSeedanceReferencesWithPainting`。

原 `appendPaintingToSeedanceReferences` 改为调用该纯函数并 `setSeedanceReferences`。

```typescript
function computeNextSeedanceReferencesWithPainting(): SeedanceReferenceFile[] {
  if (!paintingImage) return seedanceReferences;
  if (seedanceReferences.some((ref) => ref.kind === 'image' && ref.fileName === paintingImage.fileName)) {
    return seedanceReferences;
  }
  const isSeedance25 = seedanceModel === 'doubao-seedance-2-5-260628';
  const maxImageCount = isSeedance25 ? 30 : 9;
  if (seedanceReferences.filter((ref) => ref.kind === 'image').length >= maxImageCount) {
    return seedanceReferences;
  }
  const nextReference: SeedanceReferenceFile = {
    id: createMessageId('seedance_ref'),
    kind: 'image',
    file: paintingImage.file,
    previewUrl: createMediaPreviewUrl(paintingImage.file),
    fileName: paintingImage.fileName,
  };
  return [...seedanceReferences, nextReference];
}

function appendPaintingToSeedanceReferences() {
  setSeedanceReferences(computeNextSeedanceReferencesWithPainting());
}
```

### 2. `handlePaintingGeneratePrompt` 返回生成结果

在 `handlePaintingGeneratePrompt` 的末尾，把 `setSeedanceReferences` 改为使用上面提取的纯函数，并返回本次生成产生的值：

```typescript
async function handlePaintingGeneratePrompt(idea: PaintingIdeaSummary) {
  // ... 现有生成逻辑 ...
  const durationSeconds = Math.min(30, Math.max(4, Math.round(durationSec)));
  const nextReferences = computeNextSeedanceReferencesWithPainting();

  setSeedancePrompt(prompt);
  setSeedanceDuration(durationSeconds);
  setSeedanceReferences(nextReferences);
  setSeedancePromptHighlight(true);
  setTimeout(() => setSeedancePromptHighlight(false), 2000);
  scrollToRef(seedancePromptRef);

  // ... 保存 history 逻辑 ...

  return { prompt, duration: durationSeconds, references: nextReferences };
}
```

### 3. `handleCreateSeedanceVideo` 支持参数覆盖

给 `handleCreateSeedanceVideo` 增加可选参数 `overrides`，允许调用方传入提示词、时长、参考素材，优先使用传入值：

```typescript
async function handleCreateSeedanceVideo(overrides?: {
  prompt?: string;
  duration?: number;
  references?: SeedanceReferenceFile[];
}) {
  const isVideoEdit = seedanceTaskMode === 'video-edit-painting';
  const prompt = isVideoEdit
    ? buildVideoEditPaintingPrompt(videoEditTarget, videoEditAdjustments)
    : (overrides?.prompt ?? seedancePrompt.trim());
  if (!prompt || isSeedanceLoading) return;

  const references = overrides?.references ?? seedanceReferences;
  const duration = overrides?.duration ?? seedanceDuration;

  if (isVideoEdit) {
    // ... 保持现有 video-edit 校验逻辑，使用 references 替代 seedanceReferences ...
  }

  if (!isVideoEdit && references.length === 0) {
    const confirmed = window.confirm('当前未添加任何参考图片或视频，确定只使用文本提示词生成视频吗？');
    if (!confirmed) return;
  }

  // ... 重复提示词确认逻辑 ...

  setIsSeedanceLoading(true);
  setSeedanceError("");
  setSeedanceTask(null);

  try {
    const task = await createSeedanceTask({
      model: isVideoEdit ? 'doubao-seedance-2-5-260628' : seedanceModel,
      taskMode: isVideoEdit ? 'video_edit' : 'generate',
      prompt,
      resolution: seedanceResolution,
      ratio: isVideoEdit ? 'adaptive' : seedanceRatio,
      duration: isVideoEdit ? -1 : duration,
      generateAudio: seedanceGenerateAudio,
      watermark: seedanceWatermark,
      references,
    });
    // ... 后续逻辑使用 references 更新 history ...
  } catch (error) {
    // ...
  } finally {
    setIsSeedanceLoading(false);
  }
}
```

注意：在更新 `seedanceHistory` 时，也要使用传入的 `references` 和 `duration`，而不是闭包里的 `seedanceReferences`/`seedanceDuration`。

### 4. 新增「自动生成视频」处理函数

```typescript
async function handlePaintingAutoGenerateVideo(idea: PaintingIdeaSummary) {
  if (paintingLoading !== 'idle' || isSeedanceLoading) return;
  const result = await handlePaintingGeneratePrompt(idea);
  if (!result) return;
  await handleCreateSeedanceVideo({
    prompt: result.prompt,
    duration: result.duration,
    references: result.references,
  });
}
```

### 5. UI 新增按钮

在「生成完整提示词」按钮旁边新增「自动生成视频」按钮：

```jsx
<button
  type="button"
  onClick={() => handlePaintingAutoGenerateVideo(idea)}
  disabled={paintingLoading !== 'idle' || isSeedanceLoading}
  className={...}
>
  {paintingLoading === 'prompt' && paintingSelectedIdea?.id === idea.id ? (
    <Loader2 className="size-3 animate-spin" />
  ) : (
    <Film className="size-3" />
  )}
  自动生成视频
</button>
```

按钮样式与「生成完整提示词」区分开，建议使用更强调的颜色（如 rose），让用户感知这是一个更强力的操作。

按钮的 disabled 状态需要考虑：
- `paintingLoading !== 'idle'`：正在生成提示词或创意方案时禁用；
- `isSeedanceLoading`：右侧正在创建 Seedance 任务时禁用。

### 6. 原有「生成完整提示词」行为不变

`handlePaintingGeneratePrompt` 的调用方、返回值、副作用均保持兼容。点击原按钮的流程和之前完全一致。

## 预期效果

- 用户点击「自动生成视频」后，提示词、图片、时长自动填充并直接开始生成视频；
- 如果未附带图片，会弹出 `window.confirm` 确认框，用户取消则中止；
- 原「生成完整提示词」按钮不受影响；
- 因状态闭包问题导致的潜在数据不一致被消除。

## 验证方式

1. 进入「创意创作 → 视频创作 → 挂画创意素材」；
2. 上传挂画图片并生成 10 条方案；
3. 点击任意方案的「生成完整提示词」，确认右侧提示词、图片、时长已自动填入，流程不变；
4. 点击另一方案的「自动生成视频」：
   - 右侧提示词、图片、时长更新；
   - 自动开始创建 Seedance 任务（出现加载状态）；
5. 测试无图片场景：
   - 先清空右侧所有参考图片；
   - 点击「自动生成视频」；
   - 应弹出确认窗口「当前未添加任何参考图片或视频，确定只使用文本提示词生成视频吗？」；
   - 点击取消则任务不创建；
   - 点击确认则任务创建。

## 影响范围

- **前端**：仅 `CreativeCreationPage.tsx`；
- **后端**：无改动；
- **API 接口**：无新增/变更；
- **数据/状态**：无持久化格式变更。

## 风险与兜底

| 风险 | 兜底措施 |
|---|---|
| 状态闭包导致提交旧数据 | `handleCreateSeedanceVideo` 接受 overrides，自动流程显式传入新值 |
| 用户误触强力按钮 | 按钮样式与原有按钮区分；无图片时弹窗确认 |
| 生成提示词失败还想继续创建视频 | `handlePaintingGeneratePrompt` 抛错时直接返回，不进入第二步 |
| 自动触发与右侧已有内容冲突 | 复用现有逻辑覆盖，与手动流程行为一致 |

## 下一步

按本设计修改 `frontend-google-ui/src/pages/CreativeCreationPage.tsx`，完成后本地验证两种按钮的流程。
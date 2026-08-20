# 挂画创意素材「自动生成视频」功能实施计划

> **For agentic workers:** REQUIRED SUB-TOOL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 在 `CreativeCreationPage.tsx` 中新增「自动生成视频」按钮，实现一键生成提示词、填充右侧 Seedance 表单、自动创建视频任务；同时复用现有无图片确认弹窗。

**Architecture:** 仅改动 `frontend-google-ui/src/pages/CreativeCreationPage.tsx`。核心思路：提取 references 计算纯函数 → 让 `handlePaintingGeneratePrompt` 返回生成结果 → 让 `handleCreateSeedanceVideo` 支持参数覆盖 → 新增自动流程函数和 UI 按钮。

**Tech Stack:** React, TypeScript, Tailwind CSS, existing `window.confirm`

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `frontend-google-ui/src/pages/CreativeCreationPage.tsx` | 修改 | 提取参考素材计算、新增自动生成视频流程和按钮 |

---

## Task 1: 提取参考素材计算纯函数

**Files:**
- Modify: `frontend-google-ui/src/pages/CreativeCreationPage.tsx:2970-2989`

- [ ] **Step 1: 替换 `appendPaintingToSeedanceReferences` 函数体**

使用 `Edit` 工具，将：

```typescript
  function appendPaintingToSeedanceReferences() {
    if (!paintingImage) return;
    // 按文件名去重：右侧已有同名参考图时不再重复追加。
    if (seedanceReferences.some((ref) => ref.kind === 'image' && ref.fileName === paintingImage.fileName)) {
      return;
    }
    const isSeedance25 = seedanceModel === 'doubao-seedance-2-5-260628';
    const maxImageCount = isSeedance25 ? 30 : 9;
    if (seedanceReferences.filter((ref) => ref.kind === 'image').length >= maxImageCount) {
      return;
    }
    const nextReference: SeedanceReferenceFile = {
      id: createMessageId('seedance_ref'),
      kind: 'image',
      file: paintingImage.file,
      previewUrl: createMediaPreviewUrl(paintingImage.file),
      fileName: paintingImage.fileName,
    };
    setSeedanceReferences((previous) => [...previous, nextReference]);
  }
```

替换为：

```typescript
  function computeNextSeedanceReferencesWithPainting(): SeedanceReferenceFile[] {
    if (!paintingImage) return seedanceReferences;
    // 按文件名去重：右侧已有同名参考图时不再重复追加。
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

- [ ] **Step 2: Commit**

```bash
git add frontend-google-ui/src/pages/CreativeCreationPage.tsx
git commit -m "refactor(painting): 提取参考素材计算纯函数"
```

---

## Task 2: 让 `handlePaintingGeneratePrompt` 返回生成结果

**Files:**
- Modify: `frontend-google-ui/src/pages/CreativeCreationPage.tsx:2916-2968`

- [ ] **Step 1: 修改函数体，返回生成结果**

使用 `Edit` 工具，将 `setSeedanceReferences` 调用替换为纯函数调用并添加 return。

原代码段（约 2938-2944 行）：

```typescript
      setSeedancePrompt(prompt.trim());
      setSeedanceRatio(ratio);
      setSeedanceDuration(durationSeconds);
      appendPaintingToSeedanceReferences();
      setSeedancePromptHighlight(true);
      setTimeout(() => setSeedancePromptHighlight(false), 2000);
      scrollToRef(seedancePromptRef);
```

替换为：

```typescript
      setSeedancePrompt(prompt.trim());
      setSeedanceRatio(ratio);
      setSeedanceDuration(durationSeconds);
      const nextReferences = computeNextSeedanceReferencesWithPainting();
      setSeedanceReferences(nextReferences);
      setSeedancePromptHighlight(true);
      setTimeout(() => setSeedancePromptHighlight(false), 2000);
      scrollToRef(seedancePromptRef);

      return { prompt: prompt.trim(), duration: durationSeconds, references: nextReferences };
```

- [ ] **Step 2: Commit**

```bash
git add frontend-google-ui/src/pages/CreativeCreationPage.tsx
git commit -m "feat(painting): generatePrompt返回生成结果供自动流程使用"
```

---

## Task 3: 让 `handleCreateSeedanceVideo` 支持参数覆盖

**Files:**
- Modify: `frontend-google-ui/src/pages/CreativeCreationPage.tsx:2427-2513`

- [ ] **Step 1: 修改函数签名与 prompt 获取**

使用 `Edit` 工具，将函数签名：

```typescript
  async function handleCreateSeedanceVideo() {
```

替换为：

```typescript
  async function handleCreateSeedanceVideo(overrides?: {
    prompt?: string;
    duration?: number;
    references?: SeedanceReferenceFile[];
  }) {
```

- [ ] **Step 2: 修改 prompt 获取逻辑**

将：

```typescript
    const isVideoEdit = seedanceTaskMode === 'video-edit-painting';
    const prompt = isVideoEdit
      ? buildVideoEditPaintingPrompt(videoEditTarget, videoEditAdjustments)
      : seedancePrompt.trim();
    if (!prompt || isSeedanceLoading) return;
```

替换为：

```typescript
    const isVideoEdit = seedanceTaskMode === 'video-edit-painting';
    const prompt = isVideoEdit
      ? buildVideoEditPaintingPrompt(videoEditTarget, videoEditAdjustments)
      : (overrides?.prompt ?? seedancePrompt.trim());
    if (!prompt || isSeedanceLoading) return;

    const references = overrides?.references ?? seedanceReferences;
    const duration = overrides?.duration ?? seedanceDuration;
```

- [ ] **Step 3: 修改 video-edit 校验，使用 references**

将：

```typescript
      const videoReferences = seedanceReferences.filter((item) => item.kind === 'video');
      const imageReferences = seedanceReferences.filter((item) => item.kind === 'image');
```

替换为：

```typescript
      const videoReferences = references.filter((item) => item.kind === 'video');
      const imageReferences = references.filter((item) => item.kind === 'image');
```

- [ ] **Step 4: 修改无参考素材确认，使用 references**

将：

```typescript
    if (!isVideoEdit && seedanceReferences.length === 0) {
```

替换为：

```typescript
    if (!isVideoEdit && references.length === 0) {
```

- [ ] **Step 5: 修改 createSeedanceTask 调用，使用传入值**

将：

```typescript
      const task = await createSeedanceTask({
        model: isVideoEdit ? 'doubao-seedance-2-5-260628' : seedanceModel,
        taskMode: isVideoEdit ? 'video_edit' : 'generate',
        prompt,
        resolution: seedanceResolution,
        ratio: isVideoEdit ? 'adaptive' : seedanceRatio,
        duration: isVideoEdit ? -1 : seedanceDuration,
        generateAudio: seedanceGenerateAudio,
        watermark: seedanceWatermark,
        references: seedanceReferences,
      });
```

替换为：

```typescript
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
```

- [ ] **Step 6: 修改历史记录更新，使用传入值**

在历史记录 `createSeedanceHistoryItem` 调用处，将 `seedanceDuration` 替换为 `duration`，将 `seedanceReferences` 替换为 `references`。

原代码（约 2494-2500 行）：

```typescript
              prompt,
              resolution: seedanceResolution,
              ratio: isVideoEdit ? 'adaptive' : seedanceRatio,
              duration: isVideoEdit ? -1 : seedanceDuration,
              generateAudio: seedanceGenerateAudio,
              watermark: seedanceWatermark,
```

替换为：

```typescript
              prompt,
              resolution: seedanceResolution,
              ratio: isVideoEdit ? 'adaptive' : seedanceRatio,
              duration: isVideoEdit ? -1 : duration,
              generateAudio: seedanceGenerateAudio,
              watermark: seedanceWatermark,
```

以及 `recordSeedanceCost` 调用处，将 `seedanceDuration` 替换为 `duration`：

```typescript
      recordSeedanceCost(
        isVideoEdit ? Math.ceil(videoEditSourceDuration || 0) : duration,
        isVideoEdit ? 'doubao-seedance-2-5-260628' : seedanceModel
      );
```

- [ ] **Step 7: Commit**

```bash
git add frontend-google-ui/src/pages/CreativeCreationPage.tsx
git commit -m "feat(seedance): handleCreateSeedanceVideo支持参数覆盖"
```

---

## Task 4: 新增「自动生成视频」处理函数

**Files:**
- Modify: `frontend-google-ui/src/pages/CreativeCreationPage.tsx`（在 `handlePaintingGeneratePrompt` 附近新增函数）

- [ ] **Step 1: 在 `handlePaintingGeneratePrompt` 函数后新增自动流程函数**

使用 `Edit` 工具，在 `handlePaintingGeneratePrompt` 结束后的 `appendPaintingToSeedanceReferences` 函数之前插入：

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

- [ ] **Step 2: Commit**

```bash
git add frontend-google-ui/src/pages/CreativeCreationPage.tsx
git commit -m "feat(painting): 新增自动生成视频处理函数"
```

---

## Task 5: 新增「自动生成视频」UI 按钮

**Files:**
- Modify: `frontend-google-ui/src/pages/CreativeCreationPage.tsx:3892-3905`

- [ ] **Step 1: 在「生成完整提示词」按钮旁新增按钮**

使用 `Edit` 工具，将按钮区域：

```tsx
                              <button
                                type="button"
                                onClick={() => handlePaintingGeneratePrompt(idea)}
                                disabled={paintingLoading !== 'idle'}
                                className={cn(
                                  'shrink-0 inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                  isUsed
                                    ? 'border-emerald-200 bg-white text-emerald-600 hover:border-emerald-300 hover:bg-emerald-50'
                                    : 'border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600'
                                )}
                              >
                                {paintingLoading === 'prompt' && paintingSelectedIdea?.id === idea.id ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                                {isUsed ? '再次生成' : '生成完整提示词'}
                              </button>
```

替换为：

```tsx
                              <div className="flex shrink-0 items-center gap-1.5">
                                <button
                                  type="button"
                                  onClick={() => handlePaintingGeneratePrompt(idea)}
                                  disabled={paintingLoading !== 'idle'}
                                  className={cn(
                                    'inline-flex h-8 items-center gap-1 rounded-full border px-3 text-[11px] font-bold transition-colors disabled:cursor-not-allowed disabled:opacity-60',
                                    isUsed
                                      ? 'border-emerald-200 bg-white text-emerald-600 hover:border-emerald-300 hover:bg-emerald-50'
                                      : 'border-slate-200 bg-white text-slate-600 hover:border-rose-200 hover:bg-rose-50 hover:text-rose-600'
                                  )}
                                >
                                  {paintingLoading === 'prompt' && paintingSelectedIdea?.id === idea.id ? <Loader2 className="size-3 animate-spin" /> : <Sparkles className="size-3" />}
                                  {isUsed ? '再次生成' : '生成完整提示词'}
                                </button>
                                <button
                                  type="button"
                                  onClick={() => handlePaintingAutoGenerateVideo(idea)}
                                  disabled={paintingLoading !== 'idle' || isSeedanceLoading}
                                  className="inline-flex h-8 items-center gap-1 rounded-full border border-rose-200 bg-rose-50 px-3 text-[11px] font-bold text-rose-600 transition-colors hover:border-rose-300 hover:bg-rose-100 disabled:cursor-not-allowed disabled:opacity-60"
                                >
                                  {paintingLoading === 'prompt' && paintingSelectedIdea?.id === idea.id ? <Loader2 className="size-3 animate-spin" /> : <Film className="size-3" />}
                                  自动生成视频
                                </button>
                              </div>
```

注意：`Film` icon 需要从 `lucide-react` 导入。如果当前文件已导入 `Film`，则无需额外操作；如果没有，需要添加到 imports。

- [ ] **Step 2: 检查并确保 `Film` icon 已导入**

使用 `Edit` 工具，在文件顶部找到 `lucide-react` 的 import 行，添加 `Film`。

查找类似：

```typescript
import { ..., Sparkles, ... } from 'lucide-react';
```

如果没有 `Film`，添加进去。

- [ ] **Step 3: Commit**

```bash
git add frontend-google-ui/src/pages/CreativeCreationPage.tsx
git commit -m "feat(painting): 新增自动生成视频按钮"
```

---

## Task 6: 本地验证

**Files:**
- 无需修改文件

- [ ] **Step 1: 启动前端开发服务器**

```bash
cd /Users/qichao/Documents/kelongai-cn/frontend-google-ui
npm run dev
```

- [ ] **Step 2: 启动后端服务**

```bash
cd /Users/qichao/Documents/kelongai-cn/legacy-project
node server.mjs
```

- [ ] **Step 3: 测试「生成完整提示词」按钮**

进入挂画创意素材，上传图片、分析、生成方案，点击「生成完整提示词」：
- 右侧 Seedance 提示词框应填入内容；
- 右侧应出现挂画参考图；
- 时长应被设置；
- 原有流程无变化。

- [ ] **Step 4: 测试「自动生成视频」按钮**

点击另一方案的「自动生成视频」：
- 右侧提示词、图片、时长更新；
- 自动进入加载状态（开始创建 Seedance 任务）；
- 无二次点击「开始生成视频」的必要。

- [ ] **Step 5: 测试无图片确认弹窗**

- 先清空右侧 Seedance 参考图片（点击参考图上的 X）；
- 点击「自动生成视频」；
- 应弹出 `window.confirm`：「当前未添加任何参考图片或视频，确定只使用文本提示词生成视频吗？」；
- 点击取消：任务不创建；
- 点击确认：任务创建。

- [ ] **Step 6: 停止服务**

```bash
lsof -ti:3000 | xargs kill -9 2>/dev/null || true
lsof -ti:5173 | xargs kill -9 2>/dev/null || true
```

---

## Self-Review Checklist

**Spec coverage：**
- [x] 提取 references 计算纯函数 → Task 1
- [x] generatePrompt 返回结果 → Task 2
- [x] createSeedanceVideo 支持 overrides → Task 3
- [x] 新增自动流程函数 → Task 4
- [x] 新增 UI 按钮 → Task 5
- [x] 无图片确认弹窗 → 复用 Task 3 中的现有逻辑
- [x] 本地验证 → Task 6

**Placeholder scan：**
- [x] 无 TBD/TODO/模糊描述
- [x] 所有代码块可直接使用

**Type consistency：**
- [x] `SeedanceReferenceFile` 类型保持一致
- [x] `PaintingIdeaSummary` 参数类型保持一致

---

## 执行方式选择

计划已保存到 `docs/superpowers/plans/2026-08-20-painting-auto-generate-video.md`。

两种执行方式：

**1. Subagent-Driven（推荐）**

**2. Inline Execution（当前会话直接执行）**

你想用哪种？
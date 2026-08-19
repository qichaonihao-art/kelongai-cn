# 文案创作页 · 视觉统一（宣纸墨韵 → 平台 slate/violet 风）设计文档

日期：2026-08-20
范围：`frontend-google-ui/src/pages/CopywritingPage.tsx`（仅此一个文件）
不涉及后端、数据流、IndexedDB、接口改动。

## 背景与目标

1. 现状：上一轮（2026-08-19）重构把文案创作页做成了「宣纸墨韵」风格——米黄底 `#f7f3ea`、
   米白卡面 `#fffdf8`、赭石强调 `#9a3412`，仅本页使用。
2. 问题：该风格与平台其余界面（slate 玻璃拟态 + 白卡 + 模块品牌色）脱节，观感不统一。
3. 目标：把文案创作页的 UI 与交互视觉统一到平台标准，同时保持美观，**布局结构与交互逻辑、
   数据流零改动**。

用户决策记录：
- 强调色：**violet-600**（与入口页「文案创作」模块品牌色 `bg-violet-600` 一致）。
- 改造范围：**全面统一 + 细节润色**（换配色 + 卡片圆角/阴影/按钮形状/输入框/顶栏/焦点态对齐 sibling 页）。

## 一、设计令牌（替换现有 `INK` 对象）

替换 [CopywritingPage.tsx:215-224](frontend-google-ui/src/pages/CopywritingPage.tsx#L215-L224) 的 `INK`
常量，改为平台统一令牌：

| 用途 | 现状（宣纸风） | 改为（平台风） |
|---|---|---|
| 页面底色 | `INK.page` `bg-[#f7f3ea]` | `bg-background`（slate-300 径向纹理，由 body 提供） |
| 卡片面 | `INK.card` `bg-[#fffdf8] border-[#ddd3bd]` | `rounded-2xl border border-slate-300 bg-white` + 柔和阴影 |
| 主强调色 | `INK.accent` `bg-[#9a3412] … hover:bg-[#7c2d0e]` | `bg-violet-600 text-white hover:bg-violet-700` |
| 强调描边 | `INK.accentRing` `border-[#9a3412]` | `border-violet-600` |
| 标题字 | `INK.text` `text-[#2d2a26]` | `text-slate-900` |
| 次要字 | `INK.sub` `text-[#8a8272]` | `text-slate-500` |
| 正文 | `text-[#4a443a]`（散落） | `text-slate-700` |
| 中性徽章 | `INK.chip` `bg-[#f3ecdd] text-[#6b5d45]` | `bg-slate-100 text-slate-600` |
| 探索型/仿写徽章 | `bg-[#efe9db] text-[#9a3412]`（散落） | `bg-violet-50 text-violet-700` |
| 空态/提示块 | `bg-[#f3ecdd]/60 text-[#8a8272] ring-[#ddd3bd]`（散落） | `bg-slate-50 text-slate-500 ring-1 ring-slate-200` |

其余散落的硬编码色值统一映射：
`#9a3412 → violet-600`、`#7c2d0e → violet-700`、`#f3ecdd → slate-100`、
`#ddd3bd → slate-300/slate-200`、`#efe9db → violet-50`、`#8a8272 / #6b5d45 / #4a443a / #b8ae98 → slate 灰阶`、
`#fffdf8 → white`。

## 二、逐区域改动清单

1. **顶栏**：`bg-[#fffdf8]/90` → `bg-white/80 backdrop-blur-md`（对齐 sibling [CreativeCreationPage.tsx:3508](frontend-google-ui/src/pages/CreativeCreationPage.tsx#L3508)）。
2. **Hero 图标**：`bg-[#9a3412]` → `bg-violet-600`。
3. **档案侧栏卡片 / 工作区各卡片**：统一 `rounded-2xl border-slate-300 bg-white`。
4. **按钮**：主按钮 `bg-violet-600 text-white hover:bg-violet-700`，统一 `rounded-full` 胶囊形（对齐 sibling 页）；
   「文案库」区图标保留 `bg-amber-600` 作第二强调色。
5. **输入框 / 文本框**：`rounded-lg border-slate-200`，焦点态 `focus:border-violet-300 focus:ring-2 focus:ring-violet-100`
   （替换现有赭石 ring `focus:ring-[#f3ecdd]`）。
6. **结果卡 ResultCard**：卡片 `border-slate-300 bg-white`；序号角标 `bg-violet-600`；
   「稳定型」徽章 slate、「探索型/仿写版本」徽章 violet；收藏星号保留 amber（平台语义色）。
7. **折叠区（爆款仿写 / 文案库）**：白卡 + `border-slate-300`，展开箭头 `text-slate-400`。
8. **档案选中态**：`border-violet-600`（替换赭石 `accentRing`）。

## 三、保持不变（明确不改）

- 布局结构：左档案栏（≥lg）+ 右工作区、移动端档案横条。
- 交互逻辑：分析 → 确认档案 → 工作区三段式；折叠/展开、复制、编辑、收藏、存档、删除。
- 数据流：IndexedDB 档案、文案库、上传历史、接口调用、异步轮询。

## 四、测试与验收

- `npx tsc --noEmit` 对改动文件无新增错误。
- 手动走查：页面在 slate 底 + 白卡 + violet 强调下渲染正常；顶栏与 sibling 页一致；
  三段式流程、折叠区、结果卡操作、档案切换均正常；移动端档案横条正常。

## 五、明确不做（YAGNI）

- 不改布局结构、不新增/删除功能。
- 不引入全站主题变量或深色模式。
- 不触碰 `lib/copywriting.ts`、`lib/paintingArchive.ts` 等数据模块。

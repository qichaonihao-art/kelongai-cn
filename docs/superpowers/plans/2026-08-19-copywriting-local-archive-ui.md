# 文案创作页 · 本机档案库 + 工作台 UI 实施计划

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 挂画档案一次确认后持久保存在本机（IndexedDB，主动删除才消失），页面重构为「左档案栏 + 右工作区」的宣纸墨韵风格工作台。

**Architecture:** 新增独立模块 `src/lib/paintingArchive.ts` 封装 IndexedDB 读写（upsert/list/get/delete/touch）；`CopywritingPage.tsx` 从单列三步流程改为双栏工作台，右侧视图按 `setup → profile → workspace` 三态切换。仅前端改动，无后端、无新依赖。

**Tech Stack:** React + TypeScript + Tailwind v4（任意值类名）+ IndexedDB。

**设计文档:** `docs/superpowers/specs/2026-08-19-copywriting-local-archive-ui-design.md`

**验证环境:** `cd frontend-google-ui && npx tsc --noEmit`（只关注改动文件）+ `npm run dev`（vite 5173，后端 3000 已在跑）。项目无单测框架，采用每任务的 tsc 检查 + 终验走查清单。

---

### Task 1: `paintingArchive.ts` 本机档案库模块

**Files:**
- Create: `frontend-google-ui/src/lib/paintingArchive.ts`

- [ ] **Step 1: 写入完整模块代码**

```ts
// 本机挂画档案库：IndexedDB 持久保存已确认的挂画档案。
// 用户要求：除非主动删除，否则一直保留（不设过期、不设数量上限）。
import type { CopyProfile } from './copywriting';

const DB_NAME = 'kelong-copy-paintings';
const DB_VERSION = 1;
const STORE_NAME = 'paintings';

export interface SavedPainting {
  id: number;
  name: string;
  imageBlob: Blob;
  profile: CopyProfile;
  extraInfo: string;
  forbidden: string;
  createdAt: number;
  updatedAt: number;
}

/** 档案栏列表项（不含大对象，objectURL 由调用方管理） */
export interface SavedPaintingSummary {
  id: number;
  name: string;
  updatedAt: number;
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'id', autoIncrement: true });
      }
    };
  });
}

function requestToPromise<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    request.onerror = () => reject(request.error);
    request.onsuccess = () => resolve(request.result);
  });
}

/** 压缩到最长边 720px 的 JPEG，几十 KB 量级，用于档案栏缩略图与恢复 */
export function compressImageToBlob(file: Blob, maxEdge = 720, quality = 0.82): Promise<Blob> {
  return new Promise((resolve, reject) => {
    const url = URL.createObjectURL(file);
    const image = new Image();
    image.onload = () => {
      try {
        const scale = Math.min(1, maxEdge / Math.max(image.naturalWidth, image.naturalHeight));
        const canvas = document.createElement('canvas');
        canvas.width = Math.max(1, Math.round(image.naturalWidth * scale));
        canvas.height = Math.max(1, Math.round(image.naturalHeight * scale));
        canvas.getContext('2d')?.drawImage(image, 0, 0, canvas.width, canvas.height);
        canvas.toBlob((blob) => {
          URL.revokeObjectURL(url);
          if (blob) resolve(blob);
          else reject(new Error('图片压缩失败'));
        }, 'image/jpeg', quality);
      } catch (err) {
        URL.revokeObjectURL(url);
        reject(err instanceof Error ? err : new Error('图片压缩失败'));
      }
    };
    image.onerror = () => {
      URL.revokeObjectURL(url);
      reject(new Error('图片读取失败'));
    };
    image.src = url;
  });
}

/** 有 id 更新、无 id 插入；返回带 id 的完整记录 */
export async function savePainting(data: {
  id?: number;
  name: string;
  imageBlob: Blob;
  profile: CopyProfile;
  extraInfo: string;
  forbidden: string;
}): Promise<SavedPainting> {
  const db = await openDB();
  try {
    const now = Date.now();
    let record: SavedPainting;
    if (data.id != null) {
      const existing = await requestToPromise<SavedPainting | undefined>(
        db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(data.id)
      );
      if (existing) {
        record = { ...existing, ...data, id: data.id, updatedAt: now };
        await requestToPromise(
          db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).put(record)
        );
        return record;
      }
    }
    record = { ...data, id: undefined as unknown as number, createdAt: now, updatedAt: now };
    const key = await requestToPromise<IDBValidKey>(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).add(record)
    );
    return { ...record, id: Number(key) };
  } finally {
    db.close();
  }
}

/** 按 updatedAt 倒序返回摘要列表 */
export async function listPaintings(): Promise<SavedPaintingSummary[]> {
  const db = await openDB();
  try {
    const all = await requestToPromise<SavedPainting[]>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).getAll()
    );
    return all
      .map(({ id, name, updatedAt }) => ({ id, name, updatedAt }))
      .sort((a, b) => b.updatedAt - a.updatedAt);
  } finally {
    db.close();
  }
}

export async function getPainting(id: number): Promise<SavedPainting | null> {
  const db = await openDB();
  try {
    const item = await requestToPromise<SavedPainting | undefined>(
      db.transaction(STORE_NAME, 'readonly').objectStore(STORE_NAME).get(id)
    );
    return item || null;
  } finally {
    db.close();
  }
}

export async function deletePainting(id: number): Promise<void> {
  const db = await openDB();
  try {
    await requestToPromise<undefined>(
      db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME).delete(id)
    );
  } finally {
    db.close();
  }
}

/** 仅更新 updatedAt（选中即“最近使用”） */
export async function touchPainting(id: number): Promise<void> {
  const db = await openDB();
  try {
    const store = db.transaction(STORE_NAME, 'readwrite').objectStore(STORE_NAME);
    const item = await requestToPromise<SavedPainting | undefined>(store.get(id));
    if (item) await requestToPromise(store.put({ ...item, updatedAt: Date.now() }));
  } finally {
    db.close();
  }
}
```

- [ ] **Step 2: 类型检查**

Run: `cd frontend-google-ui && npx tsc --noEmit 2>&1 | grep paintingArchive`
Expected: 无输出（退出码 1）。若报错修复后重跑。

- [ ] **Step 3: Commit**

```bash
git add src/lib/paintingArchive.ts
git commit -m "feat: 新增本机挂画档案库 IndexedDB 模块"
```

---

### Task 2: 页面接线——加载/选中/切换/删除/确认时保存

**Files:**
- Modify: `frontend-google-ui/src/pages/CopywritingPage.tsx`

全部为对现有文件的精确修改，不动 UI（UI 在 Task 3）。

- [ ] **Step 1: 增加 import 与状态**

在文件顶部 import 区（`import { ... } from '../lib/copywriting'` 附近）加：

```ts
import {
  compressImageToBlob,
  deletePainting,
  getPainting,
  listPaintings,
  savePainting,
  touchPainting,
  type SavedPaintingSummary,
} from '../lib/paintingArchive';
```

在组件内状态区（`const [historyOpen, setHistoryOpen] = useState(false);` 之后）加：

```ts
const [archiveItems, setArchiveItems] = useState<SavedPaintingSummary[]>([]);
const [activePaintingId, setActivePaintingId] = useState<number | null>(null);
const [archiveUnavailable, setArchiveUnavailable] = useState(false);
/** 当前挂画的图片 blob 来源：新上传的 File 或从档案恢复的 Blob，确认档案时用于存档 */
const currentImageBlobRef = useRef<Blob | null>(null);
const [confirmDeleteId, setConfirmDeleteId] = useState<number | null>(null);
```

- [ ] **Step 2: 挂载时加载档案并自动选中最近使用的**

在读取历史图片的 `useEffect` 之后新增：

```ts
useEffect(() => {
  let cancelled = false;
  let objectUrl = '';
  (async () => {
    try {
      const items = await listPaintings();
      if (cancelled || items.length === 0) return;
      const latest = await getPainting(items[0].id);
      if (!latest || cancelled) return;
      objectUrl = URL.createObjectURL(latest.imageBlob);
      currentImageBlobRef.current = latest.imageBlob;
      setActivePaintingId(latest.id);
      setProfile(latest.profile);
      setProfileDraft(profileToDraft(latest.profile));
      setProfileConfirmed(true);
      setImageThumb(objectUrl);
      setPaintingPreviewUrl((prev) => {
        if (prev) URL.revokeObjectURL(prev);
        return objectUrl;
      });
      setExtraInfo(latest.extraInfo || '');
      setForbidden(latest.forbidden || '');
      void touchPainting(latest.id);
    } catch {
      if (!cancelled) setArchiveUnavailable(true);
    }
  })();
  return () => {
    cancelled = true;
    if (objectUrl) URL.revokeObjectURL(objectUrl);
  };
}, []);
```

（注意：`setPaintingPreviewUrl` 需改为函数式更新以正确回收旧 objectURL，如上。）

- [ ] **Step 3: 上传文件时记录 blob 引用**

`applyPaintingFile`（约 487 行）中 `setPaintingFile(file)` 之后加一行：

```ts
currentImageBlobRef.current = file;
```

- [ ] **Step 4: 确认档案时自动存档**

`handleConfirmProfile` 中 `setProfileConfirmed(true);` 之前插入：

```ts
const paintingIdToSave = activePaintingId;
void (async () => {
  try {
    const blob = currentImageBlobRef.current
      ? await compressImageToBlob(currentImageBlobRef.current).catch(() => currentImageBlobRef.current as Blob)
      : null;
    if (!blob) return;
    const saved = await savePainting({
      id: paintingIdToSave ?? undefined,
      name: next.name || next.visualDescription?.slice(0, 12) || '未命名挂画',
      imageBlob: blob,
      profile: next,
      extraInfo,
      forbidden,
    });
    setActivePaintingId(saved.id);
    setArchiveItems(await listPaintings());
  } catch {
    setArchiveUnavailable(true);
  }
})();
```

（存档失败不阻塞确认流程，只置降级提示。）

- [ ] **Step 5: 切换与删除档案的处理函数**

在 `handlePickHistory` 之后新增：

```ts
const refreshArchive = async () => {
  try {
    setArchiveItems(await listPaintings());
  } catch {
    setArchiveUnavailable(true);
  }
};

const handleSelectPainting = async (id: number) => {
  if (id === activePaintingId || generatingRef.current) return;
  try {
    const item = await getPainting(id);
    if (!item) return;
    if (paintingPreviewUrl) URL.revokeObjectURL(paintingPreviewUrl);
    const objectUrl = URL.createObjectURL(item.imageBlob);
    currentImageBlobRef.current = item.imageBlob;
    setActivePaintingId(item.id);
    setPaintingFile(null);
    setPaintingPreviewUrl(objectUrl);
    setProfile(item.profile);
    setProfileDraft(profileToDraft(item.profile));
    setProfileConfirmed(true);
    setImageThumb(objectUrl);
    setName(item.name || '');
    setExtraInfo(item.extraInfo || '');
    setForbidden(item.forbidden || '');
    setOriginalItems([]);
    setRewriteItems([]);
    setError('');
    void touchPainting(item.id).then(refreshArchive);
  } catch {
    setError('读取本机档案失败，请重试。');
  }
};

const handleDeletePainting = async (id: number) => {
  try {
    await deletePainting(id);
    const items = await listPaintings();
    setArchiveItems(items);
    if (id === activePaintingId) {
      if (items.length > 0) {
        await handleSelectPainting(items[0].id);
      } else {
        handleFileChange(null);
        setActivePaintingId(null);
      }
    }
    setNotice('已删除本机档案');
    window.setTimeout(() => setNotice(''), 2200);
  } catch {
    setError('删除本机档案失败');
  }
};

const handleNewPainting = () => {
  handleFileChange(null);
  setActivePaintingId(null);
  setName('');
  setExtraInfo('');
  setForbidden('');
  setSellingPoints('');
  setOriginalItems([]);
  setRewriteItems([]);
  setRewriteOriginalText('');
};
```

注意：`handleSelectPainting` 里手动回收 objectURL 而不走 `applyPaintingFile`（后者会清空 profile）。

- [ ] **Step 6: 类型检查 + Commit**

Run: `cd frontend-google-ui && npx tsc --noEmit 2>&1 | grep CopywritingPage`
Expected: 无输出。

```bash
git add src/pages/CopywritingPage.tsx
git commit -m "feat: 文案创作页接入本机挂画档案库（加载/切换/删除/确认存档）"
```

---

### Task 3: 工作台布局 + 宣纸墨韵 UI

**Files:**
- Modify: `frontend-google-ui/src/pages/CopywritingPage.tsx`

主题色 token（页面顶部 `const` 区定义，Task 3 各步共用）：

```ts
// 宣纸墨韵（仅本页）：宣纸米底 / 卡面 / 边框 / 墨字 / 赭石强调
const INK = {
  page: 'bg-[#f7f3ea]',
  card: 'bg-[#fffdf8] border-[#ddd3bd]',
  text: 'text-[#2d2a26]',
  sub: 'text-[#8a8272]',
  accent: 'bg-[#9a3412] text-[#fffdf8] hover:bg-[#7c2d0e]',
  accentRing: 'border-[#9a3412]',
  chip: 'bg-[#f3ecdd] text-[#6b5d45]',
};
```

三态视图：`const view = !profile ? 'setup' : !profileConfirmed ? 'profile' : 'workspace';`（替换 `currentStep`，删除 `STEPS`、`StepIndicator` 组件及其渲染）。

- [ ] **Step 1: 页面骨架改为双栏**

`<main>` 整体替换为：

```tsx
<main className={cn('mx-auto w-full max-w-[80rem] flex-1 px-4 py-6 md:px-6', INK.page)}>
  {/* 移动端档案横条（<lg） */}
  <div className="mb-4 flex gap-2 overflow-x-auto pb-1 lg:hidden">
    {archiveItems.map((p) => (
      <button key={p.id} type="button" onClick={() => void handleSelectPainting(p.id)}
        className={cn('shrink-0 rounded border px-3 py-1.5 text-xs font-bold',
          p.id === activePaintingId ? cn('border-[1.5px]', INK.accentRing, INK.text, 'bg-[#fffdf8]') : cn(INK.card, INK.sub))}>
        {p.name}
      </button>
    ))}
    <button type="button" onClick={handleNewPainting}
      className={cn('shrink-0 rounded border border-dashed border-[#ddd3bd] px-3 py-1.5 text-xs font-bold', INK.sub))}>
      ＋ 新挂画
    </button>
  </div>

  <div className="flex gap-5">
    {/* 左侧档案栏（≥lg） */}
    <aside className="hidden w-64 shrink-0 lg:flex lg:flex-col">
      <div className={cn('rounded p-3', INK.card, 'border')}>
        <div className={cn('mb-2.5 text-sm font-black tracking-widest', INK.text)}>本机挂画档案</div>
        <div className="flex flex-col gap-1.5">
          {archiveUnavailable && (
            <p className={cn('text-[11px] font-bold', INK.sub)}>本机存储不可用，档案不会保留</p>
          )}
          {!archiveUnavailable && archiveItems.length === 0 && (
            <p className={cn('text-[11px] font-bold', INK.sub)}>还没有档案，分析并确认第一张挂画后会自动保存</p>
          )}
          {archiveItems.map((p) => (
            <div key={p.id}
              className={cn('group flex items-center gap-2 rounded border px-2 py-1.5 transition-colors',
                p.id === activePaintingId ? cn('border-[1.5px]', INK.accentRing) : 'border-transparent hover:bg-[#f3ecdd]')}>
              <button type="button" onClick={() => void handleSelectPainting(p.id)}
                className={cn('min-w-0 flex-1 truncate text-left text-xs font-bold', p.id === activePaintingId ? INK.text : INK.sub)}>
                {p.name}
              </button>
              {confirmDeleteId === p.id ? (
                <span className="flex shrink-0 items-center gap-1">
                  <button type="button" onClick={() => void handleDeletePainting(p.id)} className="text-[10px] font-bold text-red-600">删</button>
                  <button type="button" onClick={() => setConfirmDeleteId(null)} className={cn('text-[10px] font-bold', INK.sub)}>取消</button>
                </span>
              ) : (
                <button type="button" onClick={() => setConfirmDeleteId(p.id)}
                  className="hidden shrink-0 text-[#b8ae98] hover:text-red-500 group-hover:block" title="删除档案">
                  <Trash2 className="size-3.5" />
                </button>
              )}
            </div>
          ))}
        </div>
        <button type="button" onClick={handleNewPainting}
          className={cn('mt-3 rounded border border-dashed border-[#ddd3bd] py-1.5 text-xs font-bold', INK.sub, 'hover:border-[#9a3412] hover:text-[#9a3412]')}>
          ＋ 新挂画
        </button>
      </div>
    </aside>

    {/* 右侧工作区 */}
    <div className="min-w-0 flex-1">{/* 依次填入 Step 2~4 的内容 */}</div>
  </div>
</main>
```

- [ ] **Step 2: 工作区 setup 视图（未选档案 / 新挂画）**

把现「Step 1 分析挂画」section（现 791–916 行）搬进工作区，`view === 'setup'` 时渲染，标题区的序号徽标 `1` 删除；容器类名改为 `cn('rounded border p-5 shadow-sm md:p-6', INK.card)`；「分析产品」按钮类名改 `INK.accent`；输入框 focus 色从 violet 系改为 `focus:border-[#9a3412] focus:ring-[#f3ecdd]`；「历史图片」交互原样保留。

- [ ] **Step 3: 工作区 profile 视图（档案确认/编辑）**

把现「Step 2 确认档案」section（现 918–1015 行）搬进工作区，`view === 'profile'` 时渲染；删除序号徽标 `2`；「确认档案并继续」按钮改 `INK.accent`；已确认态的 emerald 色块改为 `bg-[#f3ecdd] text-[#6b5d45]` 系。同时删除 `profileSectionRef` 及 `handleAnalyze`/`handleConfirmProfile`/`handleEditProfile` 里的 `scrollIntoView` 调用（视图切换已取代滚动定位），删除对应的 `window.setTimeout`/`requestAnimationFrame` 包装。

- [ ] **Step 4: 工作区 workspace 视图**

`view === 'workspace'` 时渲染，由三块组成：

1. **当前挂画条**（新写）：

```tsx
<div className={cn('mb-4 flex items-center gap-3 rounded border p-3', INK.card)}>
  {paintingPreviewUrl && <img src={paintingPreviewUrl} alt={profileDraft.name} className="h-16 w-12 rounded-sm object-cover" />}
  <div className="min-w-0 flex-1">
    <div className={cn('truncate text-sm font-black', INK.text)}>{profileDraft.name || '挂画档案'}</div>
    <div className={cn('mt-1 flex flex-wrap gap-1.5')}>
      {(confirmedSummary || []).map((chip) => (
        <span key={chip} className={cn('rounded px-2 py-0.5 text-[11px] font-bold', INK.chip)}>{chip}</span>
      ))}
    </div>
  </div>
  <button type="button" onClick={handleEditProfile}
    className={cn('shrink-0 rounded border px-3 py-1.5 text-xs font-bold', INK.card, INK.text, 'hover:border-[#9a3412]')}>
    编辑档案
  </button>
</div>
```

2. **原创 10 条区**：现 1028–1102 行内容搬入，卡片容器改 `INK.card`，生成按钮改 `INK.accent`，结果列表从 `space-y-3` 改为 `grid grid-cols-1 gap-3 xl:grid-cols-2`；删除外层「Step 3」标题条（1019–1025 行）与序号徽标 `3`。

3. **折叠横条卡**（仿写 + 文案库）：仿写区（现 1105–1158 行）与文案库区（现 1162–1225 行）分别套折叠壳；文案库沿用 `libraryOpen`（默认 false），仿写新增 `const [rewriteOpen, setRewriteOpen] = useState(false);`。折叠壳结构统一为：

```tsx
<div className={cn('mb-4 rounded border', INK.card)}>
  <button type="button" onClick={() => setRewriteOpen((v) => !v)} className="flex w-full items-center justify-between p-4">
    <span className={cn('text-sm font-black', INK.text)}>爆款文案仿写 <span className={cn('ml-1 text-xs font-bold', INK.sub)}>分析原文 → 3 个版本</span></span>
    {rewriteOpen ? <ChevronUp className="size-4 text-[#8a8272]" /> : <ChevronDown className="size-4 text-[#8a8272]" />}
  </button>
  {rewriteOpen && <div className="border-t border-[#ddd3bd] p-4">{/* 原 section 主体内容 */}</div>}
</div>
```

（文案库同理，标题右侧保留数量徽标。）

- [ ] **Step 5: ResultCard 主题化 + Header**

`ResultCard`（306–414 行）：卡片容器 `rounded-lg border border-slate-300 bg-white p-5 shadow-sm ... hover:shadow-md` 改为 `cn('rounded border p-5 transition-all', INK.card, INK.text, 'hover:-translate-y-0.5 hover:shadow-md')`；序号方块 `bg-slate-900` 改 `bg-[#9a3412] text-[#fffdf8]`；「存文案库」主按钮改 `INK.accent`；编辑态 textarea 的 violet focus 改 `focus:border-[#9a3412] focus:ring-[#f3ecdd]`。页面 `<header>` 底色加 `bg-[#fffdf8]/90`。

- [ ] **Step 6: 清理死代码**

删除：`STEPS` 常量、`StepIndicator` 组件、`currentStep`、`generateSectionRef`、`profileSectionRef` 及全部 `scroll-mt-20` 类名。确认无未使用 import（`Fragment` 若仅 StepIndicator 使用则一并删除）。

- [ ] **Step 7: 类型检查 + lint**

Run: `cd frontend-google-ui && npx tsc --noEmit 2>&1 | grep CopywritingPage; npm run -s lint 2>&1 | grep -i copywriting`
Expected: 均无输出。

- [ ] **Step 8: Commit**

```bash
git add src/pages/CopywritingPage.tsx
git commit -m "feat: 文案创作页重构为左档案栏+右工作区的宣纸墨韵工作台"
```

---

### Task 4: 端到端走查（对照 spec 验收清单）

- [ ] **Step 1: 走查**

浏览器打开 `http://localhost:5173`（vite 已跑，HMR 生效），逐项验证并在下方打勾：

1. 新挂画 → 上传 → 分析 → 确认 → 刷新页面 → 左栏出现档案且自动选中，无需重新识别
2. 再建第二个档案，两个档案互相切换：图片/档案/补充信息/禁止内容正确恢复，生成结果被清空
3. 删除档案：hover 出现 🗑 → 二次确认 → 删除后刷新不再出现；若删的是当前档案则自动切到下一档或回到新挂画视图
4. 「生成 10 条」全流程：进度 3/10 显示、结果网格 2 列、复制/入库/重生成/编辑/双击编辑可用
5. 仿写、文案库默认折叠，点开展开，功能正常
6. Chrome 隐私窗口打开页面：出现「本机存储不可用」提示，功能不崩
7. 窗口缩到 <1024px：档案栏变为顶部横条

- [ ] **Step 2: 发现问题的修复与复验，然后最终提交**

```bash
git add -A src/pages/CopywritingPage.tsx src/lib/paintingArchive.ts
git commit -m "fix: 走查问题修复（如有）"
```

---

## Self-Review 记录

- Spec 覆盖：多档案库（Task 1/2）、自动选中恢复（Task 2 Step 2）、切换/删除/新挂画（Task 2 Step 5 + Task 3 Step 1）、确认时存档（Task 2 Step 4）、压缩图（Task 1 compressImageToBlob）、隐私模式降级（Task 2 Step 2/4 + Task 3 Step 1 提示）、布局/配色/折叠/移动端（Task 3）、验收清单（Task 4）。✓
- 生成结果不持久化：切换/新挂画时 `setOriginalItems([])` 清空，未加任何结果存储。✓
- 类型一致性：`SavedPaintingSummary`、`savePainting` 入参与 Task 2 调用一致；`INK` 各键在 Task 3 各步引用一致。✓

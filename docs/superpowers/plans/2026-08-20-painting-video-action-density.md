# 挂画创意素材动作密度优化实施计划

> **For agentic workers:** REQUIRED SUB-TOOL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** 通过修改 `legacy-project/server.mjs` 中的框架动作链与提示词，让挂画创意素材生成的长视频动作更密集、内容更充实，避免磨时间。

**Architecture:** 仅改动后端两处：① `PAINTING_FRAMEWORKS` 中 3 条典型框架升级动作链；② `handlePaintingIdeaPrompt` 根据时长动态要求动作阶段数，并加入反磨时间约束。

**Tech Stack:** Node.js, legacy-project/server.mjs, 豆包 Seed 2.1 Pro (ARK)

---

## 文件变更清单

| 文件 | 操作 | 说明 |
|---|---|---|
| `legacy-project/server.mjs` | 修改 | 升级 3 条框架动作链 |
| `legacy-project/server.mjs` | 修改 | 更新 `handlePaintingIdeaPrompt` 阶段数、节奏、反磨时间约束 |

---

## Task 1: 升级「空间穿行」框架动作链

**Files:**
- Modify: `legacy-project/server.mjs`（第 1 批框架数组中第二条）

- [ ] **Step 1: 替换框架字符串**

使用 `Edit` 工具，将：

```javascript
    '空间穿行：年轻女性手捧挂画从客厅沙发旁走向玄关白墙，经过实木茶几、绿植与落地灯，停下比划挂的位置；镜头从身后缓慢跟拍，再轻微横摇到墙面',
```

替换为：

```javascript
    '空间穿行：年轻女性从沙发起身，双手捧起挂画，绕过实木茶几、经过绿植与落地灯走到玄关白墙前，先单手比划挂的高度，再双手扶正挂画对准挂点，后退一步端详，最后上前微调画框；镜头从身后跟拍，再轻微横摇到墙面',
```

- [ ] **Step 2: 语法检查**

Run: `node --check legacy-project/server.mjs`
Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add legacy-project/server.mjs
git commit -m "feat(painting): 升级空间穿行框架动作链"
```

---

## Task 2: 升级「全景 Reveal」框架动作链

**Files:**
- Modify: `legacy-project/server.mjs`（第 2 批框架数组中第二条）

- [ ] **Step 1: 替换框架字符串**

使用 `Edit` 工具，将：

```javascript
    '全景 Reveal：客厅全景，能看到实木沙发、茶几、书架、地毯与绿植，镜头缓慢推近，最后定格到墙上挂画',
```

替换为：

```javascript
    '全景 Reveal：客厅全景展示实木沙发、茶几、书架、地毯与绿植，人物手持挂画从画面一侧走入，边走边将画举到胸前，在墙前停下脚步，抬手比划挂的位置，镜头跟随人物推近并最后定格到挂画',
```

- [ ] **Step 2: 语法检查**

Run: `node --check legacy-project/server.mjs`
Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add legacy-project/server.mjs
git commit -m "feat(painting): 升级全景Reveal框架动作链"
```

---

## Task 3: 升级「协作挂画」框架动作链

**Files:**
- Modify: `legacy-project/server.mjs`（第 3 批框架数组中第二条）

- [ ] **Step 1: 替换框架字符串**

使用 `Edit` 工具，将：

```javascript
    '协作挂画：丈夫站在矮梯上挂画，妻子在地面递画并后退端详；镜头从餐厅缓慢横摇到客厅，扫过餐桌、花瓶与茶具',
```

替换为：

```javascript
    '协作挂画：丈夫踩上矮梯用铅笔在墙面标记挂点，妻子递上挂画并扶稳底部，丈夫接过挂画对齐挂点挂好，妻子递水平仪检查是否端正，两人一起后退欣赏；镜头从餐厅横摇到客厅，再轻微推近到挂画',
```

- [ ] **Step 2: 语法检查**

Run: `node --check legacy-project/server.mjs`
Expected: 无报错。

- [ ] **Step 3: Commit**

```bash
git add legacy-project/server.mjs
git commit -m "feat(painting): 升级协作挂画框架动作链"
```

---

## Task 4: 更新 `handlePaintingIdeaPrompt` 阶段数与反磨时间约束

**Files:**
- Modify: `legacy-project/server.mjs:12533-12540` 附近

- [ ] **Step 1: 替换「动作密度」相关段落**

使用 `Edit` 工具，将：

```javascript
3. 动作密度：整个视频必须包含 3-4 个连续、不同的动作阶段，节奏清晰、有起承转合；禁止通过慢放、降速或循环来凑够时长，禁止长时间静止画面，每个阶段的动作都要真实发生在对应时间段内。
```

替换为：

```javascript
3. 动作密度：整个视频必须包含连续、不同的动作阶段，阶段数量按目标时长动态要求——5-6 秒至少 4 个阶段，7-8 秒至少 5 个阶段，9-10 秒至少 6 个阶段；每个阶段必须是不重复的连续动作，禁止把同一动作拆成两段凑数。节奏清晰、有起承转合；禁止通过慢放、降速、停顿、重复动作或循环来凑够时长，禁止长时间静止画面，禁止空镜留白超过 1 秒，每个阶段的动作都要真实发生在对应时间段内。
```

- [ ] **Step 2: 替换「创意内容」第 6 条中阶段示例与运镜约束**

使用 `Edit` 工具，将：

```javascript
6. 创意内容：结合创意方案，写清楚${character ? `人物设定（${character}）` : '人物设定'}、人物着装（着装要符合中式挂画的雅致基调：年轻女性可穿旗袍或中式改良服饰，中老年人物可穿中式对襟、盘扣、禅意棉麻；衣着颜色从中式雅致色系中挑选，如淡青、月白、藕荷、黛蓝、水红、竹绿、鹅黄、黑色、浅紫色、浅绿色、米白色、浅灰色等，避免每次都用同一种颜色，让颜色丰富、有变化）、场景、构图、动作节奏、光影氛围（墙面以雅致浅色为主，如纯白、浅灰、米白、淡青，可根据场景氛围微调；光线为正常的自然光或中性白光，避免大面积暖黄/黄昏氛围，整体保持雅致有文化感）、${audio ? `声音/音乐（${audio}）` : '声音'}等，并重点落实镜头语言——按方案里已规划的运镜为每个动作阶段配一种景别或机位变化，把整个视频按时间轴拆成 3-4 个连续的动作阶段（从 0 秒开始、按先后顺序无重叠地铺满到总时长结束），每个阶段写明起止时间、对应的动作与镜头的景别/机位变化；整个视频必须包含至少 1 个远景或全景阶段，用于展示人物与空间的相对关系，场景中必须出现 2-3 件与挂画风格协调的家居陈设（如实木沙发、茶几、书架、绿植、地毯、落地灯、茶具、博古架、花瓶、文房摆件等），陈设布置要自然、有生活气息，避免空旷；例如「0-3 秒远景跟拍人物手捧挂画从客厅沙发走向白墙 → 3-6 秒中景人物停下比划挂的位置，背景可见茶几、绿植、落地灯 → 6-8 秒特写挂画被挂上墙并轻微推近」；所有运镜必须舒缓、稳定、慢速，在展示空间纵深和家居陈设时允许使用小幅度跟拍、推移、横摇 Reveal 等运镜，但禁止快速甩镜、剧烈晃动、手持抖动、快速变焦/急推、急转、旋转式环绕。
```

替换为：

```javascript
6. 创意内容：结合创意方案，写清楚${character ? `人物设定（${character}）` : '人物设定'}、人物着装（着装要符合中式挂画的雅致基调：年轻女性可穿旗袍或中式改良服饰，中老年人物可穿中式对襟、盘扣、禅意棉麻；衣着颜色从中式雅致色系中挑选，如淡青、月白、藕荷、黛蓝、水红、竹绿、鹅黄、黑色、浅紫色、浅绿色、米白色、浅灰色等，避免每次都用同一种颜色，让颜色丰富、有变化）、场景、构图、动作节奏、光影氛围（墙面以雅致浅色为主，如纯白、浅灰、米白、淡青，可根据场景氛围微调；光线为正常的自然光或中性白光，避免大面积暖黄/黄昏氛围，整体保持雅致有文化感）、${audio ? `声音/音乐（${audio}）` : '声音'}等，并重点落实镜头语言——按方案里已规划的运镜为每个动作阶段配一种景别或机位变化，把整个视频按时间轴拆成连续的动作阶段（从 0 秒开始、按先后顺序无重叠地铺满到总时长结束），阶段数量按目标时长动态要求：5-6 秒至少 4 个阶段、7-8 秒至少 5 个阶段、9-10 秒至少 6 个阶段；每个阶段写明起止时间、对应的动作与镜头的景别/机位变化，每个阶段必须是不重复的连续动作，禁止把同一动作拆成两段凑数；整个视频必须包含至少 1 个远景或全景阶段，用于展示人物与空间的相对关系，场景中必须出现 2-3 件与挂画风格协调的家居陈设（如实木沙发、茶几、书架、绿植、地毯、落地灯、茶具、博古架、花瓶、文房摆件等），陈设布置要自然、有生活气息，避免空旷；例如 7-8 秒视频可拆为「0-1.5 秒远景跟拍人物从沙发起身取画 → 1.5-3.5 秒中景人物手捧挂画绕过茶几走向白墙 → 3.5-5 秒中近景人物单手比划高度再双手扶正挂画 → 5-6 秒近景挂画对齐挂点挂好 → 6-7.5 秒中景人物后退端详并上前微调画框」；所有运镜必须舒缓但连贯、不拖沓，在展示空间纵深和家居陈设时允许使用小幅度跟拍、推移、横摇 Reveal 等运镜，但禁止快速甩镜、剧烈晃动、手持抖动、快速变焦/急推、急转、旋转式环绕。
```

- [ ] **Step 3: 语法检查**

Run: `node --check legacy-project/server.mjs`
Expected: 无报错。

- [ ] **Step 4: Commit**

```bash
git add legacy-project/server.mjs
git commit -m "feat(painting): idea-prompt按时长动态要求动作阶段数并反磨时间"
```

---

## Task 5: 本地验证

**Files:**
- 无需修改文件

- [ ] **Step 1: 启动后端**

Run:
```bash
cd /Users/qichao/Documents/kelongai-cn/legacy-project
node server.mjs
```

Expected: 服务在 `http://127.0.0.1:3000` 启动。

- [ ] **Step 2: 登录并调用 ideas**

```bash
export APP_LOGIN_PASSWORD=$(grep "^APP_LOGIN_PASSWORD=" .env | cut -d'=' -f2-)
curl -s -c /tmp/cookies3.txt -X POST http://127.0.0.1:3000/api/auth/login -H 'Content-Type: application/json' -d "{\"password\":\"$APP_LOGIN_PASSWORD\"}"
```

Expected: `{"ok":true}`

- [ ] **Step 3: 测试 8 秒 idea-prompt 阶段数**

```bash
curl -s -b /tmp/cookies3.txt -X POST http://127.0.0.1:3000/api/painting/idea-prompt \
  -H 'Content-Type: application/json' \
  -d '{
    "profile": {"name":"Test Painting","style":"国画","subject":"山水","colors":["墨黑","赭石","宣纸白"],"composition":"竖幅","material":"宣纸","frameStructure":"木条装裱","texture":"水墨笔触","ratio":"9:16","atmosphere":"雅致有文化感"},
    "idea": {"id":"2","title":"空间穿行","summary":"年轻女性从沙发起身，双手捧起挂画，绕过实木茶几、经过绿植与落地灯走到玄关白墙前，先单手比划挂的高度，再双手扶正挂画对准挂点，后退一步端详，最后上前微调画框。"},
    "durationMin": 7,
    "durationMax": 8,
    "ratio": "9:16"
  }' | python3 -m json.tool | grep -c "秒"
```

Expected: 返回的 prompt 中包含至少 5 个带「秒」的时间阶段标记。

- [ ] **Step 4: 检查反磨时间约束是否写入 prompt**

从 Step 3 的返回中确认 prompt 包含以下关键词中的至少 2 个：
- "禁止通过慢放"
- "禁止长时间静止"
- "禁止空镜留白"
- "不拖沓"

- [ ] **Step 5: 停止后端**

```bash
lsof -ti:3000 | xargs kill -9
```

---

## Self-Review Checklist

**Spec coverage:**
- [x] 按时长动态要求阶段数 → Task 4
- [x] 反磨时间约束 → Task 4
- [x] 升级 3 条框架动作链 → Task 1-3
- [x] 本地验证 → Task 5

**Placeholder scan:**
- [x] 无 TBD/TODO/模糊描述
- [x] 所有代码块可直接使用

**Type consistency：**
- [x] 修改均在 `legacy-project/server.mjs` 字符串/模板内

---

## 执行方式选择

计划已保存到 `docs/superpowers/plans/2026-08-20-painting-video-action-density.md`。

两种执行方式：

**1. Subagent-Driven（推荐）** — 每个 Task 派一个独立 subagent 执行。

**2. Inline Execution（当前会话直接执行）** — 我直接在当前会话按 Task 逐步改。

你想用哪种？
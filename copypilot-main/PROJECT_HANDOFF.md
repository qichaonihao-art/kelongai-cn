# CopyPilot 项目交接记录

更新时间：2026-05-11

## 项目定位

CopyPilot 是一个对标 AnyToCopy 方向的内容提取工具站。当前公开版定位为免费工具，不展示登录、剩余次数、积分和会员入口；本地开发环境保留登录、用户中心、验证码等商业化功能代码，后续需要时可以打开。

账号策略：当前采用无密码登录，用户用邮箱验证码或 Google 登录进入账号。因此不需要开发“忘记密码/重置密码”流程；如果用户换设备或退出登录，重新收验证码即可。

核心能力：

- 首页智能识别链接类型，自动整理标题、平台发布文案、标签、视频、图片和视频语音文案。
- 提取视频：输入作品链接，提取可预览和下载的视频素材。
- 提取文案：支持链接提取，也支持本地音视频文件上传后语音转文字。
- 提取图文：提取图文作品标题、正文、标签和图片素材，图片有打开、下载原图、复制链接按钮。
- 提取文章：支持公众号、网页文章等文章链接，尽量提取标题、正文、标签和原图素材。
- FAQ 已改为可折叠交互。
- 移动端已适配，包含手机横向工具导航、单列布局、视频比例自适应、图片网格自适应。

## 技术栈

- 前端：Vue 3 + Vite + CSS
- 图标：lucide-vue-next
- 后端：Cloudflare Pages Functions
- 数据库：Cloudflare D1，绑定名 `DB`
- 部署：Cloudflare Pages
- 解析接口：TikHub API
- 音视频转文字：SiliconFlow 语音识别接口

## 重要文件

- `src/App.vue`：主要页面、路由、语言切换、提取逻辑、结果展示。
- `src/styles.css`：全站 UI、响应式、FAQ、Footer、移动端样式。
- `functions/api/extract.js`：内容链接解析入口，调用 TikHub。
- `functions/api/transcribe-link.js`：链接视频转文字，超过 10 分钟跳过转写。
- `functions/api/transcribe.js`：本地音视频上传后转文字。
- `functions/api/image-proxy.js`：图片代理/下载。
- `functions/api/video-proxy.js`：视频代理/下载。
- `functions/api/auth/*`：邮箱验证码、Google 登录相关接口，公开免费版暂不展示。
- `functions/api/admin/users.js`：管理员用户列表和用户套餐/额度调整接口，公开免费版关闭。
- `functions/api/admin/membership-plans.js`：管理员会员套餐参数配置接口，可编辑价格、权益、内部额度、每日限制、最长转写分钟等。
- `functions/api/membership/plans.js`：前台会员套餐读取接口，只返回展示字段，不返回内部额度和成本字段。
- `functions/api/_plans.js`：会员套餐配置表初始化、默认值、读取和保存逻辑。
- `functions/api/admin/site-content.js`：管理员站点文案配置接口，可编辑导航、首页、输入框提示、进度提示、工具内页标题/说明/SEO 标题、功能卡片、使用步骤、FAQ、Footer 等核心运营文案。
- `functions/api/site/content.js`：前台站点文案读取接口。
- `functions/api/_site_content.js`：站点文案默认值、表初始化、读取和保存逻辑。
- `migrations/0001_auth_usage.sql`：D1 用户、验证码、使用记录表。
- `scripts/deploy-cloudflare.ps1`：本地读取 Cloudflare Token 并部署 Pages。
- `public/favicon.svg`：浏览器标签图标。

## 本地运行

```bash
npm install
npm run dev
```

只跑前端时用上面命令。要连 Cloudflare Functions 测接口：

```bash
npm run build
npm run cf:dev
```

## 构建和部署

```bash
npm run build
npm run cf:deploy:local
```

`cf:deploy:local` 会读取本地文件：

```text
C:\Users\Admin\.copypilot\cloudflare.env
```

这个文件只保存在本地，不要提交到 Git。里面需要有 Cloudflare 部署相关变量，例如 `CLOUDFLARE_API_TOKEN` 和 `CLOUDFLARE_PAGES_PROJECT`。

线上域名：

```text
https://copypilot.cc
```

Cloudflare Pages 项目：

```text
copypilot
```

## 环境变量

不要把任何真实密钥写进代码或文档。Cloudflare Pages 里需要配置这些变量：

- `TIKHUB_API_KEY`
- `TIKHUB_BASE_URL`
- `SILICONFLOW_API_KEY`
- `SILICONFLOW_TRANSCRIBE_MODEL`
- `PUBLIC_FREE_MODE`
- `SESSION_SECRET`
- `APP_ORIGIN`
- `EMAIL_FROM`
- `MAILER_URL`
- `MAILER_SECRET`
- `RESEND_API_KEY`
- `GOOGLE_CLIENT_ID`
- `GOOGLE_CLIENT_SECRET`
- `GOOGLE_REDIRECT_URI`
- `ADMIN_EMAILS`

公开免费版建议：

```text
PUBLIC_FREE_MODE=true
APP_ORIGIN=https://copypilot.cc
```

## 当前产品规则

- 公开版免费使用，不显示登录、次数、积分和会员。
- 登录体系采用邮箱验证码 + Google 登录，无密码，不做忘记密码流程。
- 管理员用户由 `users.plan = admin` 或 `ADMIN_EMAILS` 环境变量控制。
- 管理员可在本地/商业化版本的用户中心查看用户列表，并调整用户套餐和后台内部额度。
- 商业化前台只展示“月会员 / 年会员 / 永久会员”，不要向普通用户展示积分、Credits、单次扣费、接口成本等内部计费逻辑。
- 后台仍然用内部额度做成本控制：月会员、年会员、永久会员在后台对应不同额度和风控策略，但前台只表达会员权益。
- 会员参数不要写死在前端。后台可以编辑并保存：套餐名称、价格文案、价格分值、是否展示、权益说明、内部额度、每日可用次数、最长视频转写分钟数；保存后前台展示和后端限制都读取数据库配置。
- 前台运营文案不要写死在前端。后台可以编辑中文/英文的首页标题、副标题、按钮、功能卡片、使用步骤、FAQ 和 Footer 简介；保存后前台读取数据库配置。
- 视频转文字只处理 10 分钟以内的视频。
- 超过 10 分钟的视频仍可提取标题、发布文案、标签、视频和图片，但跳过视频语音文案。
- 主页应该做智能提取：用户不需要先选平台，输入链接后自动识别并调用合适接口。
- 单独页面保留：提取视频、提取文案、提取图文、提取文章。
- SEO 区域已加入多个平台和场景入口，Footer 热门工具拆成两列。

## 最近完成

- 手机端导航和布局适配。
- 首页智能提取结果增强。
- FAQ 改成折叠问答。
- FAQ 答案文字尺寸调小。
- 视频转文字 10 分钟限制。
- 浏览器 favicon。
- Footer 排版优化。
- 公开版隐藏登录和积分提示。
- 基础用户管理：管理员查看用户、调整套餐、调整后台内部额度。
- 基础会员管理：管理员可编辑月会员、年会员、永久会员的展示和风控参数。
- 基础文案管理：管理员可编辑首页和全站核心运营文案，避免每次改字都发版。

## 后续优先级

1. 用真实手机检查首页、提取视频、提取文案、提取图文、提取文章五个页面。
2. 把首页智能提取合并成后端单一 `/api/smart-extract`，减少重复调用 TikHub 的成本。
3. 给长任务增加更细的进度状态，例如识别平台、提取作品、下载音频、转写中、整理结果。
4. 增加 Cloudflare Web Analytics 或 Plausible 等访问统计。
5. 后续商业化再打开邮箱验证码、Google 登录、用户中心、积分和会员模块。
6. 管理后台后续可继续补：用户搜索分页、封禁、操作日志、套餐到期时间、支付订单。
7. 以后做 AI 二创时，优先从公众号文章的结构化排版和图片占位开始。

## 注意事项

- 不要提交任何 API Key、Token、账号 Cookie。
- 不要在公开版展示技术接口说明、成本、余额、积分和开发者内部字段。
- TikHub 返回结构可能变化，解析字段要保持容错。
- 微信公众号文章很难做到 100% 原格式还原，目前主要是提取标题、正文和图片，排版还原需要单独做结构化渲染。
- 图片、视频代理接口后续上线大流量前需要加来源限制、下载限制或签名，避免被滥用。

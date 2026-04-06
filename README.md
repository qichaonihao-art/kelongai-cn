# kelongai-cn

当前项目已经完成“新前端 + 旧后端”第一阶段整合：

- 正式主前端：`frontend-google-ui`
- 真实后端：`legacy-project/server.mjs`
- 旧前端参考：`legacy-project/ai`

当前原则仍然是：以 `frontend-google-ui` 现有 UI 为唯一基准，只给现有模块接真实能力，不把旧前端的大量面板搬回来。

## 当前完成情况

### 已真实可用

- 登录链路
  - `POST /api/auth/login`
  - `GET /api/auth/status`
  - `POST /api/auth/logout`
- 声音克隆
  - 阿里云
  - 智谱
  - 火山引擎
- 创意创作
  - 豆包多模态 `POST /api/doubao/multimodal`
- 抖音视频解析下载
  - `POST /api/douyin/resolve-download`
  - `POST /api/douyin/extract-transcript`

### 仍保留兜底能力

- `VOICE_CLONE_MOCK_MODE=true`
  - 仅影响声音克隆和 TTS
  - 开启后会强制走本地 mock，不再依赖第三方音频服务

### 仍可继续优化，但当前不影响主流程

- 声音克隆页的音色持久化
- 创意创作页的会话持久化
- 更细的错误分级和监控
- 部署前的 PM2 / Nginx / 域名配置收口

## 目录说明

```text
kelongai-cn/
├── frontend-google-ui/   # 正式新前端
└── legacy-project/       # Node 后端 + 旧前端参考
```

## 本地启动

### 1. 启动后端

```bash
cd legacy-project
npm install
HOST=127.0.0.1 npm start
```

后端默认端口：

```text
http://127.0.0.1:3000
```

### 2. 启动前端

```bash
cd frontend-google-ui
npm install
npm run dev
```

前端地址：

```text
http://127.0.0.1:5173
```

说明：

- Vite 已配置 `/api` 代理到后端 `3000`
- 本地开发时前后端可以同时运行

## 登录怎么用

后端通过 `.env` 中的 `APP_LOGIN_PASSWORD` 控制登录密码。

登录流程：

1. 打开 `http://127.0.0.1:5173`
2. 输入 `legacy-project/.env` 中配置的 `APP_LOGIN_PASSWORD`
3. 登录成功后进入首页
4. 刷新仍会保持登录态
5. 退出登录后返回登录页

## 环境变量

建议复制：

```bash
cp legacy-project/.env.example legacy-project/.env
```

### 基础项

- `PORT`
- `HOST`
- `FRONTEND_MODE`
- `CORS_ALLOW_ORIGIN`
- `APP_LOGIN_PASSWORD`

### 创意创作

- `ARK_API_KEY`
  - 豆包多模态真实调用必填
- `PUBLIC_BASE_URL`
  - 大视频分析推荐必填
  - 需要填你的公网可访问后端地址，例如 `https://your-domain.com`
  - 本地 `127.0.0.1` 只适合小文件直传，较大视频需要公网 URL 才能让方舟抓取
  - 后端会把大视频临时落盘，并通过 `/uploads/<文件名>` 暴露给方舟抓取

### 抖音视频解析下载

- `SILICONFLOW_API_KEY`
  - 抖音视频口播文案转写必填
  - 只允许配置在后端环境变量中，前端不会接触这个密钥
- `SILICONFLOW_API_BASE_URL`
  - 可选，默认 `https://api.siliconflow.cn/v1`
  - 中国大陆环境建议保持默认 `.cn`
- `SILICONFLOW_ASR_MODEL`
  - 可选，默认 `FunAudioLLM/SenseVoiceSmall`
- `TIKHUB_API_TOKEN`
  - 现在仅作为解析失败时的弱兜底，不再是主链路必填
  - 如果你只需要“解析视频 + 下载 + ASR 转写”，理论上可以先不配
- `DOUYIN_VIDEO_DOWNLOAD_TIMEOUT_MS`
  - 可选，默认 `600000`
  - 用于控制服务端下载抖音视频文件到临时目录的超时

### 声音克隆

- `ALIYUN_API_KEY`
  - 阿里云真实音色创建和 TTS
- `ZHIPU_API_KEY`
  - 智谱真实音色创建和 TTS
- `VOLCENGINE_APP_KEY`
  - 火山引擎真实链路必填
- `VOLCENGINE_ACCESS_KEY`
  - 火山引擎真实链路必填
- `VOLCENGINE_SPEAKER_ID`
  - 火山引擎常用默认 speaker_id

### Mock 开关

- `VOICE_CLONE_MOCK_MODE`
  - `false`：声音克隆走真实服务
  - `true`：声音克隆和 TTS 强制走本地 mock

## 验证方式

### 验证声音克隆

1. 登录后进入“声音克隆”
2. 选择平台：阿里云 / 智谱 / 火山引擎
3. 上传一个音频样本
4. 点击上传后的音频播放器试听
5. 创建音色
6. 输入文本生成语音
7. 播放或下载生成结果

### 验证创意工作台

1. 登录后进入“创意创作”
2. 发送一条文本消息
3. 确认 AI 返回真实内容而不是固定模板
4. 点击图片按钮上传一张图
5. 再发消息，确认图片和文本一起参与本轮豆包对话

### 验证抖音视频解析下载

1. 登录后进入“抖音视频解析下载”
2. 粘贴一个抖音网页直链，点击“解析视频”
3. 确认返回 `videoId`、`normalizedUrl`、作者和下载按钮
4. 点击“提取视频文案”，确认页面进入加载态并返回转写文本
5. 再粘贴一段抖音 App 分享文案，确认短链接也能被解析

## 本地预发布验证

如果要按接近线上方式验证：

```bash
cd legacy-project
npm run build
FRONTEND_MODE=react HOST=127.0.0.1 npm start
```

然后打开：

```text
http://127.0.0.1:3000
```

这时就是由 Node 同时提供前端页面和 `/api/*`。

## 相关文件

- 前端入口：[`frontend-google-ui/src/main.tsx`](frontend-google-ui/src/main.tsx)
- 页面切换核心：[`frontend-google-ui/src/App.tsx`](frontend-google-ui/src/App.tsx)
- 登录接口封装：[`frontend-google-ui/src/lib/auth.ts`](frontend-google-ui/src/lib/auth.ts)
- 声音克隆接口封装：[`frontend-google-ui/src/lib/voice.ts`](frontend-google-ui/src/lib/voice.ts)
- 创意创作接口封装：[`frontend-google-ui/src/lib/creative.ts`](frontend-google-ui/src/lib/creative.ts)
- 后端主入口：[`legacy-project/server.mjs`](legacy-project/server.mjs)
- 部署说明：[`legacy-project/DEPLOY.md`](legacy-project/DEPLOY.md)

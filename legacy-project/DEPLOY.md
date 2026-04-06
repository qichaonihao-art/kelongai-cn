# 部署说明

## 当前目录职责

- 主前端工程：`../frontend-google-ui/`
- 旧前端参考：`ai/`
- 后端服务：`server.mjs`
- 线上推荐链路：`Nginx -> Node(server.mjs) -> /api + frontend-google-ui/dist`

当前推荐把前端构建产物和 `/api/*` 都交给同一个 Node 服务提供，这样登录 Cookie、接口调用和前端路由 fallback 都更稳定。

## 一、前端模式

`server.mjs` 支持两套前端目录：

- `react`：`../frontend-google-ui/dist`
- `legacy`：`ai/`

通过环境变量切换：

```bash
FRONTEND_MODE=react
```

或：

```bash
FRONTEND_MODE=legacy
```

说明：

- `react` 是当前正式新前端
- `legacy` 只作为旧界面回滚备份
- 如果指定目录不存在，`server.mjs` 会自动回退到另一套可用前端

## 二、本地开发

### 1. 双进程开发

适合日常联调：

后端：

```bash
cd legacy-project
npm install
HOST=127.0.0.1 npm start
```

前端：

```bash
cd frontend-google-ui
npm install
npm run dev
```

打开：

```text
http://127.0.0.1:5173
```

说明：

- Vite 会把 `/api/*` 代理到本地 `http://127.0.0.1:3000`
- 适合改 UI、联调登录、声音克隆和创意创作

### 2. 本地预发布验证

适合验证最终部署形态：

```bash
cd legacy-project
npm run build
FRONTEND_MODE=react HOST=127.0.0.1 npm start
```

打开：

```text
http://127.0.0.1:3000
```

这时就是：

- Node 提供 `frontend-google-ui/dist`
- Node 提供 `/api/*`

## 三、环境变量

至少建议配置：

- `PORT`
- `HOST`
- `FRONTEND_MODE=react`
- `CORS_ALLOW_ORIGIN`
- `APP_LOGIN_PASSWORD`
- `ARK_API_KEY`
- `ALIYUN_API_KEY`
- `ZHIPU_API_KEY`
- `VOLCENGINE_APP_KEY`
- `VOLCENGINE_ACCESS_KEY`
- `VOLCENGINE_SPEAKER_ID`
- `VOICE_CLONE_MOCK_MODE=false`
- `TIKHUB_API_TOKEN`

### 声音克隆平台说明

- 阿里云：依赖 `ALIYUN_API_KEY`
- 智谱：依赖 `ZHIPU_API_KEY`
- 火山引擎：依赖 `VOLCENGINE_APP_KEY`、`VOLCENGINE_ACCESS_KEY`、`VOLCENGINE_SPEAKER_ID`
- Mock 兜底：`VOICE_CLONE_MOCK_MODE=true`

### 创意创作说明

- 豆包多模态依赖 `ARK_API_KEY`

### 抖音视频解析下载说明

- 口播文案转写依赖 `SILICONFLOW_API_KEY`
- 中国大陆环境建议同时配置 `SILICONFLOW_API_BASE_URL=https://api.siliconflow.cn/v1`
- 可选配置 `SILICONFLOW_ASR_MODEL`，默认 `FunAudioLLM/SenseVoiceSmall`
- 可选配置 `DOUYIN_VIDEO_DOWNLOAD_TIMEOUT_MS`，默认 `600000`
- 如需保留旧解析兜底，可选配置 `TIKHUB_API_TOKEN`
- 前端调用本地 `/api/douyin/resolve-download` 和 `/api/douyin/extract-transcript`

## 四、服务器部署

### 1. 服务器准备

- Node.js 18+，建议 Node.js 20+
- Nginx
- PM2
- `ffmpeg` 与 `ffprobe`

### 2. 安装依赖

```bash
cd legacy-project
npm install

cd ../frontend-google-ui
npm install
```

### 3. 构建前端

```bash
cd legacy-project
npm run build
```

### 4. 启动后端

```bash
cd legacy-project
npm start
```

建议用 PM2：

```bash
pm2 start "npm start" --name kelongai-cn
```

## 五、Nginx 示例

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 200m;

    location / {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        send_timeout 600s;
    }
}
```

说明：

- 创意创作的视频分析建议保留较长超时，否则很容易在 Nginx 层先收到 `504 Gateway Timeout`
- `proxy_buffering off` 对 SSE 流式返回尤其重要，否则浏览器可能一直收不到增量数据
- `client_max_body_size` 需要大于你允许上传的视频大小

## 六、回滚方式

如果新前端上线后要临时回滚：

1. 把环境变量改为：

```bash
FRONTEND_MODE=legacy
```

2. 重启 Node 或 PM2

这样服务就会重新从 `ai/` 提供旧前端。

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

## 五、Nginx 配置（生产环境）

### 5.1 完整优化配置

```nginx
server {
    listen 80;
    server_name your-domain.com;

    client_max_body_size 200m;

    # 全局 TCP 优化
    tcp_nopush on;
    tcp_nodelay on;

    # === 视频下载接口：零缓冲、零压缩、直接透传 ===
    location ~ ^/api/douyin/(download-video|video-stream)$ {
        proxy_pass http://127.0.0.1:3000;
        proxy_http_version 1.1;
        proxy_set_header Host $host;
        proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
        proxy_set_header X-Forwarded-Proto $scheme;
        proxy_set_header Connection "";

        # 核心：关闭一切缓冲和压缩
        proxy_buffering off;
        proxy_request_buffering off;
        proxy_cache off;
        gzip off;

        # 告诉 Nginx 不要 buffering（对 Safari/Chrome 都有效）
        add_header X-Accel-Buffering no;

        # 支持分块传输（流式响应）
        chunked_transfer_encoding on;

        # 超长超时（视频下载可能很慢）
        proxy_read_timeout 600s;
        proxy_send_timeout 600s;
        send_timeout 600s;
    }

    # === 其他 API 和前端：保留 SSE 所需的 buffering off ===
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

### 5.2 关键配置说明

| 配置项 | 作用 | 对下载的影响 |
|--------|------|-------------|
| `proxy_buffering off` | Nginx 不缓存上游响应，收到即转发 | **必须**，否则 Nginx 会等缓冲满才发给浏览器 |
| `proxy_request_buffering off` | Nginx 不缓存客户端请求体 | 对下载影响小，但 SSE/上传需要 |
| `proxy_cache off` | 关闭 Nginx 缓存层 | **必须**，防止视频被错误缓存 |
| `gzip off` | 关闭 gzip 压缩 | **必须**，视频已经是压缩格式，gzip 只会浪费 CPU |
| `add_header X-Accel-Buffering no` | 显式告诉 Nginx 不要缓冲 | **推荐**，某些 Nginx 版本需要这个 header 才生效 |
| `chunked_transfer_encoding on` | 启用 HTTP chunked 传输 | 对流式响应必要，Node 没有 Content-Length 时需要 |
| `tcp_nopush on; tcp_nodelay on` | 优化 TCP 包发送策略 | 减少小包延迟，提高吞吐量 |

### 5.3 验证 Nginx 配置是否生效

**步骤 1：检查 Nginx 配置语法**
```bash
sudo nginx -t
sudo nginx -s reload
```

**步骤 2：确认 buffering 已关闭**
```bash
# 在服务器上测试下载接口的响应头
curl -I "https://your-domain.com/api/douyin/download-video?downloadUrl=...&videoId=..."
```

**预期看到的响应头：**
```
HTTP/2 200
content-type: video/mp4
content-disposition: attachment; filename="douyin_xxx.mp4"
content-length: 14567890    ← 如果有这个，浏览器会立即显示文件大小
x-accel-buffering: no       ← 证明 Nginx 没有缓冲
transfer-encoding: chunked  ← 如果没有 content-length，会用 chunked
```

**步骤 3：抓包确认 Nginx 是否在缓冲**
```bash
# 在服务器上同时看 Nginx access log 和 Node log
tail -f /var/log/nginx/access.log | grep download-video &
tail -f /path/to/your/server.log | grep 'stream_finished'
```

如果 Nginx 在缓冲：
- Node 日志显示 `stream_finished`（已完成推流）
- 但浏览器还要等几秒才收到文件
- Nginx access log 的响应时间比 Node 的 `totalDurationMs` 长很多

**步骤 4：直接绕过 Nginx 测试**
```bash
# 在本地直接连 Node 端口（绕过 Nginx）
curl -L -o /tmp/test_direct.mp4 \
  -w 'direct ttfb=%{time_starttransfer} total=%{time_total}\n' \
  "http://服务器IP:3000/api/douyin/download-video?downloadUrl=...&videoId=..."

# 对比通过 Nginx 的
# 如果 direct 明显更快，确认瓶颈在 Nginx
```

## 六、抖音视频下载网络诊断

如果线上服务器下载视频明显比本地慢，请按以下步骤诊断：

### 1. 服务器直接测速（对比本地 curl）

```bash
# 替换为实际的抖音视频直链 URL
curl -L -s -o /tmp/test_douyin.mp4 \
  -w '\nHTTP=%{http_code}\nSIZE=%{size_download}\nDNS=%{time_namelookup}\nCONNECT=%{time_connect}\nTTFB=%{time_starttransfer}\nTOTAL=%{time_total}\nSPEED=%{speed_download}\n' \
  --connect-timeout 10 --max-time 60 \
  -H 'Referer: https://www.douyin.com/' \
  -H 'User-Agent: Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/136.0.0.0 Safari/537.36' \
  "URL_HERE"
```

对比本地执行同一命令的结果。关注 `TTFB` 和 `SPEED` 差异。

### 2. 诊断指标阈值

| 指标 | 阈值 | 含义 | 建议 |
|------|------|------|------|
| DNS > 500ms | 警告 | DNS 解析慢 | 检查 `/etc/resolv.conf`，换 223.5.5.5 或 8.8.8.8 |
| CONNECT - DNS > 1s | 警告 | TCP 握手延迟高 | 服务器到 CDN 路由差，考虑换地域 |
| TTFB - PRETRANSFER > 3s | 严重 | CDN 边缘节点响应慢 | CDN 限流或节点过载，自适应冷却会自动处理 |
| TOTAL - TTFB > 30s | 警告 | 数据传输慢 | 带宽不足或被限速 |
| speed_download < 500KB/s | 严重 | 公网带宽瓶颈 | 升级服务器带宽或换实例 |

### 3. 服务器公网带宽测试

```bash
curl -s https://raw.githubusercontent.com/sivel/speedtest-cli/master/speedtest.py | python3 - --simple
```

### 4. 查看 Nginx 超时日志

```bash
sudo tail -100 /var/log/nginx/error.log | grep -E '(504|502|upstream timed out)'
```

### 5. 实时查看 host 自适应排名

```bash
curl -s http://localhost:3000/api/douyin/host-stats | python3 -m json.tool
```

### 6. 路由延迟探测

```bash
# 查看服务器到抖音 CDN 的延迟
ping -c 5 -W 3 v9-dy-o-abtest.zjcdn.com
# 查看路由路径
traceroute v9-dy-o-abtest.zjcdn.com
```

## 七、回滚方式

如果新前端上线后要临时回滚：

1. 把环境变量改为：

```bash
FRONTEND_MODE=legacy
```

2. 重启 Node 或 PM2

这样服务就会重新从 `ai/` 提供旧前端。

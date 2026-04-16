# 部署说明

## 当前部署边界

- 前端：部署到 Vercel，只负责页面展示、浏览器本地存储、调用接口。
- 代理：部署到香港云服务器，负责转发阿里云和火山引擎相关请求。
- 智谱：当前仍由前端直连官方接口，保持现有链路不变。
- 阿里云 / 火山：前端统一通过代理地址访问，不再在页面里写死多个 `/api/*` 地址。

## 一、前端部署到 Vercel

### 1. 需要准备

- 代码仓库已包含 `vercel.json`
- 前端统一配置文件是 `ai/app-config.js`

### 2. 上线前修改前端配置

编辑 `ai/app-config.js`：

```js
window.APP_CONFIG = {
  proxyBaseUrl: 'https://your-proxy-domain.com',
  useServerManagedSecrets: true
};
```

说明：

- `proxyBaseUrl`：填你香港服务器上的代理域名
- `useServerManagedSecrets`：
  - `false`：前端继续要求用户手动填写阿里云 / 火山密钥
  - `true`：前端默认认为密钥已放到代理服务器环境变量里

### 3. Vercel 部署方式

把当前仓库连接到 Vercel，直接部署即可。

本项目已通过 `vercel.json` 把根路径指向 `ai/index.html`。

部署完成后，你会得到类似：

```text
https://your-project.vercel.app
```

## 二、代理部署到云服务器

### 1. 服务器需要准备

- Node.js 18+，建议 Node.js 20 或更高
- 可访问外网
- 一个域名或子域名，指向这台服务器

### 2. 上传并启动代理

服务器上只需要这几类文件：

- `server.mjs`
- `package.json`
- `package-lock.json`
- `ai/` 目录

安装依赖：

```bash
npm install
```

复制环境变量模板：

```bash
cp .env.example .env
```

然后按实际情况填写 `.env`。

启动：

```bash
HOST=0.0.0.0 npm start
```

建议后续再用 `pm2` 或 `systemd` 托管进程。

## 三、代理需要的环境变量

参考 `.env.example`：

- `PORT`：代理监听端口
- `HOST`：建议服务器上用 `0.0.0.0`
- `CORS_ALLOW_ORIGIN`：允许访问代理的前端域名
- `ALIYUN_API_KEY`：阿里云密钥
- `VOLCENGINE_APP_KEY`：火山 App Key
- `VOLCENGINE_ACCESS_KEY`：火山 Access Key
- `VOLCENGINE_SPEAKER_ID`：可选，固定 speaker_id 时再填

说明：

- 如果这些环境变量已经配置好，前端就可以把 `useServerManagedSecrets` 设为 `true`
- 即使配置了环境变量，代理也兼容从前端请求体读取密钥，方便本地调试

## 四、前端如何连接线上代理

前端只认一个统一入口：

- `ai/app-config.js` 里的 `proxyBaseUrl`
- 页面里的“代理服务”配置项 `cfgProxyBaseUrl`

优先级：

1. 页面里手动填写的代理地址
2. `ai/app-config.js` 里的 `proxyBaseUrl`
3. 本地自动回退逻辑

这意味着：

- 本地开发时可以不填，继续用 `npm start`
- 线上部署时只需要把 `proxyBaseUrl` 改成你的代理域名
- 不需要在多个接口调用处分别改地址

## 五、当前代理已覆盖的链路

- 阿里云音色创建：`POST /api/voice/aliyun`
- 阿里云语音生成：`POST /api/tts/aliyun`
- 火山音色训练：`POST /api/voice/volcengine`
- 火山语音生成：`POST /api/tts/volcengine`

这四条链路都已为“前端在 Vercel、代理在独立服务器”这种架构准备好。

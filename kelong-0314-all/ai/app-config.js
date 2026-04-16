window.APP_CONFIG = {
  // 线上部署时可改成你的代理域名，例如 https://voice-proxy.example.com
  // 留空时：
  // 1. 本地通过 npm start 打开页面，会继续走当前域名下的 /api/*
  // 2. 直接双击 html 或 file:// 调试时，会回退到 http://127.0.0.1:3000
  proxyBaseUrl: 'https://voice.kelongai.xyz',

  // 如果线上代理已经在服务器环境变量中配置了阿里云 / 火山密钥，
  // 可改为 true，这样前端可不再要求用户手动输入这些密钥。
  useServerManagedSecrets: true
};

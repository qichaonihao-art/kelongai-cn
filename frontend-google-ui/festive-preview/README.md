# 2027 新春版 · 本地预览

在 `frontend-google-ui` 目录运行：

```sh
./node_modules/.bin/vite --config festive-preview/vite.config.ts
```

打开 <http://127.0.0.1:5177/>，演示密码：`2027`。

直接查看工作台首页：<http://127.0.0.1:5177/?screen=home>。

- 只替换登录页与工作台首页，九个业务模块保持原样。
- 所有业务接口都由本地预览中间件模拟，不会写入正式数据。
- 预览服务只监听 `127.0.0.1`。

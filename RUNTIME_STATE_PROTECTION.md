# 运行状态数据保护说明

这个文件是服务器维护红线。后续维护 AI 工作平台任何模块时，都必须保护运行状态数据，尤其是声音克隆的历史音色档案。

## 生产状态目录

阿里云服务器正式运行状态目录统一为：

```text
/www/wwwroot/kelongai-runtime-state
```

`legacy-project/server.mjs` 会通过 `RUNTIME_STATE_DIR` 读取这个目录。生产环境的 `legacy-project/.env` 必须包含：

```bash
RUNTIME_STATE_DIR=/www/wwwroot/kelongai-runtime-state
```

不要让生产环境回退到默认目录：

```text
/www/wwwroot/kelongai-cn/legacy-project/.runtime-state
```

这个默认目录只作为旧数据迁移来源或本地开发兜底，不再作为线上正式状态目录。

## 必须保护的文件

重点保护：

```text
/www/wwwroot/kelongai-runtime-state/voice-archive.json
```

这是声音克隆“我的音色”的服务器统一档案，多设备同步依赖它。

同时保护：

```text
/www/wwwroot/kelongai-runtime-state/volc-speaker-ownership.json
/www/wwwroot/kelongai-runtime-state/collection.db
/www/wwwroot/kelongai-runtime-state/home-culture-mottos.json
```

- `volc-speaker-ownership.json`：火山声音克隆 speaker_id 槽位归属。
- `collection.db`：店铺总览和相关运行数据。
- `home-culture-mottos.json`：主页团队文化标语，多设备同步依赖它。

## 禁止操作

除非已经明确备份并确认要恢复，否则不要执行任何会删除运行状态目录的命令。

严禁：

```bash
rm -rf /www/wwwroot/kelongai-runtime-state
rm -rf /www/wwwroot/kelongai-runtime-state/*
rm -f /www/wwwroot/kelongai-runtime-state/voice-archive.json
```

也不要把 `RUNTIME_STATE_DIR` 改回项目目录下的 `.runtime-state`，否则页面会读到另一个空状态目录，看起来就像历史音色丢失。

正常前端部署可以清理：

```bash
rm -rf /www/wwwroot/kelongai-cn/legacy-project/ai/*
```

但只能清理前端静态文件目录，不能清理 `/www/wwwroot/kelongai-runtime-state`。

## 每次服务器拉代码前先检查

```bash
grep '^RUNTIME_STATE_DIR=' /www/wwwroot/kelongai-cn/legacy-project/.env
ls -lah /www/wwwroot/kelongai-runtime-state
test -f /www/wwwroot/kelongai-runtime-state/voice-archive.json && echo "voice archive OK"
```

如果 `RUNTIME_STATE_DIR` 不是 `/www/wwwroot/kelongai-runtime-state`，先修正 `.env`，再重启服务。

## 修改前备份

凡是涉及 `.env`、`legacy-project/server.mjs`、部署脚本、PM2 配置、运行目录迁移，都先备份状态目录：

```bash
mkdir -p /www/wwwroot/kelongai-runtime-state-backups
tar -czf /www/wwwroot/kelongai-runtime-state-backups/runtime-state-$(date +%F-%H%M%S).tar.gz \
  -C /www/wwwroot kelongai-runtime-state
```

备份完成后再执行 `git pull`、`npm install`、`npm run build`、`pm2 restart` 等操作。

## 误判为空时的排查

如果声音克隆“我的音色”突然为空，先不要重新克隆，也不要删除任何文件。先查：

```bash
find /www/wwwroot -name "voice-archive.json" -o -name "volc-speaker-ownership.json"
cat /www/wwwroot/kelongai-runtime-state/voice-archive.json
cat /www/wwwroot/kelongai-cn/legacy-project/.runtime-state/voice-archive.json 2>/dev/null
```

如果旧目录有数据、新目录为空，说明是状态目录切换或 `.env` 配置问题。先备份两个目录，再把旧档案迁移到新目录。

## 设计原则

声音克隆历史音色必须以服务器档案为准，不从浏览器本地缓存恢复或同步。这样所有设备看到的是同一份数据，避免不同电脑的旧缓存互相污染。

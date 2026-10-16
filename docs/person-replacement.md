# 创意创作视频人物替换

创意创作右侧提供独立的“视频人物替换”入口，面向单人视频。人物图片选传，可从历史图片选择；没有图片时按文字描述生成。声音提供三种常用方式：保留原声与台词；沿用原视频音色说新台词；换新音色说新台词。另提供静音选项。后两种方式使用独立的新台词输入框。沿用原音色需要原视频有清晰人声；换新音色可描述目标声音，不填时按人物要求匹配新声音，也支持原视频无音轨的情况。

## 配置与运行

沿用现有服务端配置：

- `MEDIAKIT_API_KEY`：AI MediaKit 人脸打码访问凭证。
- `SEEDANCE_API_KEY`：Seedance 视频生成访问凭证。
- `PUBLIC_BASE_URL`：火山可以访问的应用公网地址。
- 服务器需要 `ffmpeg` 和 `ffprobe`，用于读取视频及处理原声。

无需新增依赖。重新构建前端并重启后端即可载入代码。

## 视频参数

原视频使用50MB以内的MP4或MOV，分辨率不超过4K。

- Seedance 2.0：4至15秒，480P或720P。
- Seedance 2.5：4至30秒，当前界面使用720P。
- 人物图片：选传，最多1张，10MB以内的JPG、PNG或WebP。

生成接口使用参考视频加可选人物图片，不走左侧反推，也不注入挂画、贴画或摆台的专用规则。Seedance 2.5 使用 `omni_reference_task_type: edit`、`ratio: adaptive` 和 `duration: -1`，让模型跟随原片时长和比例；2.0 按支持的整数秒请求时长。新的有声任务开启模型声音能力，直接保留模型返回的音视频，不覆盖音轨或重新调整时间。升级前已创建的任务保留原处理规则。

## 后台流程与恢复

原视频保存到任务目录；不符合MediaKit帧率范围时先转成30fps。之后调用MediaKit人脸打码异步接口，轮询完成后立即保存打码视频，避免依赖24小时临时地址。仅打码视频送入Seedance；如果打码工具遗漏音轨，在提交模型前把原音轨补入打码视频，保证模型能参考原声。默认模式要求模型保留原声、原台词并同步新人物口型；改台词模式明确以原人声为音色参考，逐字说新台词并重新同步口型，不沿用旧台词口型。仅在默认模式的模型输出完全没有音轨且时长接近原片时，才用原音轨补回并提示检查口型。新台词模式绝不用旧音轨覆盖；模型没有返回人声时保留画面供查看，用户重试会重新生成声音和画面。

任务写入现有SQLite数据库的 `person_replacement_jobs` 表，文件位于 `RUNTIME_STATE_DIR/person-replacement`。进度包含上传、格式准备、打码、保存打码结果、人物替换、声音处理和完成。页面读取最近50条记录，刷新或后端重启后继续处理已持有任务编号的任务。

同一提交编号只建立一个任务。查询异常只继续查询，不重复提交。已确认失败的任务支持用户手动重试，并复用已完成的打码。提交超时、连接中断、服务端5xx或进程在付费提交阶段中断时，如果未拿到任务编号，记录为结果未确认，停止自动重新提交，提示到火山后台核对。

成片可下载或保存到视频素材库；优先保存模型原生输出，仅静音和缺音轨备用处理会另行处理音轨。480P入库沿用既有画质增强流程。

## 接口

- `POST /api/person-replacement/tasks`：multipart上传，字段为 `creationRequestId`、`prompt`、`model`、`resolution`、`audioMode`、`dialogue`、`voiceDescription` 和 `files`。`audioMode` 使用 `preserve`、`rewrite`、`new-voice` 或 `silent`，兼容升级前的 `generate`；`rewrite` 和 `new-voice` 时 `dialogue` 必填，`new-voice` 可选填 `voiceDescription`（最多500字）。
- `GET /api/person-replacement/tasks`：最近50条任务。
- `GET /api/person-replacement/tasks/by-request/:requestId`：网络中断后的提交查询。
- `GET /api/person-replacement/tasks/:id`：任务状态。
- `POST /api/person-replacement/tasks/:id/retry`：从可恢复阶段继续。
- `POST /api/person-replacement/tasks/:id/save`：将成片保存到指定素材库文件夹。
- `GET/HEAD /api/person-replacement/media/:id/:token/:file`：带随机令牌的媒体读取，支持Range；仅允许固定媒体文件名。该入口在登录检查之前供上游取素材，其余任务接口沿用应用登录检查。

## 验证

运行 `node legacy-project/test-person-replacement.mjs`。测试使用模拟上游和本地合成视频，不发送真实付费请求，覆盖：并发提交幂等、可选人物图、打码复用、生成失败重试、查询失败恢复、服务重启、提交结果未确认时停止重复付费、原生音视频原样保留、新台词与原音色指令传递、新音色加新台词及原视频静音的输入、2.5编辑任务参数、打码结果缺音轨补回、模型缺音轨时备用处理、旧任务兼容、静音输出及原视频无音轨的情况。

此验证不代表真实MediaKit和Seedance账户权限、审核或生成质量已经通过。真实视频会保留平台返回的错误信息，不保证所有人物视频都能通过或精确还原。

官方能力依据：

- [Seedance 2.5 教程](https://docs.volcengine.com/docs/ark/seedance-2-5?lang=zh)
- [Seedance 2.5 提示词指南](https://docs.volcengine.com/docs/ark/seedance-2-5-prompt-guide?lang=zh)

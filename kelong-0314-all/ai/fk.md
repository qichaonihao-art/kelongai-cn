> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 音色复刻

> 使用音色复刻技术，基于示例音频生成指定音色、文本内容的语音合成。



## OpenAPI

````yaml openapi/openapi.json post /paas/v4/voice/clone
openapi: 3.0.1
info:
  title: ZHIPU AI API
  description: ZHIPU AI 接口提供强大的 AI 能力，包括聊天对话、工具调用和视频生成。
  license:
    name: ZHIPU AI 开发者协议和政策
    url: https://chat.z.ai/legal-agreement/terms-of-service
  version: 1.0.0
  contact:
    name: Z.AI 开发者
    url: https://chat.z.ai/legal-agreement/privacy-policy
    email: user_feedback@z.ai
servers:
  - url: https://open.bigmodel.cn/api/
    description: 开放平台服务
security:
  - bearerAuth: []
tags:
  - name: 模型 API
    description: Chat API
  - name: 工具 API
    description: Web Search API
  - name: Agent API
    description: Agent API
  - name: 文件 API
    description: File API
  - name: 知识库 API
    description: Knowledge API
  - name: 实时 API
    description: Realtime API
  - name: 批处理 API
    description: Batch API
  - name: 助理 API
    description: Assistant API
  - name: 智能体 API（旧）
    description: QingLiu Agent API
paths:
  /paas/v4/voice/clone:
    post:
      tags:
        - 模型 API
      summary: 音色复刻
      description: 使用音色复刻技术，基于示例音频生成指定音色、文本内容的语音合成。
      requestBody:
        content:
          application/json:
            schema:
              $ref: '#/components/schemas/VoiceCloneRequest'
        required: true
      responses:
        '200':
          description: 业务处理成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/VoiceCloneResponse'
        default:
          description: 请求失败。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/Error'
components:
  schemas:
    VoiceCloneRequest:
      type: object
      required:
        - voice_name
        - input
        - file_id
        - model
      properties:
        model:
          type: string
          description: 模型
          enum:
            - glm-tts-clone
          default: glm-tts-clone
          example: glm-tts-clone
        voice_name:
          type: string
          description: 指定唯一的音色名称
          example: my_custom_voice_001
        text:
          type: string
          description: 示例音频的文本内容，选填
          example: 你好，这是一段示例音频的文本内容，用于音色复刻参考。
        input:
          type: string
          description: 生成试听音频的目标文本内容
          example: 欢迎使用我们的音色复刻服务，这将生成与示例音频相同音色的语音。
        file_id:
          type: string
          description: 示例音频的file_id，通过文件接口上传获取。大小限制不超过10M，建议音频时长在3秒到30秒之间。
          example: file_abc123def456ghi789
        request_id:
          type: string
          description: 由用户端传递，需要唯一；用于区分每次请求的唯一标识符。如果用户端未提供，平台将默认生成。
          example: voice_clone_req_001
    VoiceCloneResponse:
      type: object
      properties:
        voice:
          type: string
          description: 音色
          example: voice_clone_20240315_143052_001
        file_id:
          type: string
          description: 音频试听文件ID
          example: file_xyz789abc456def123
        file_purpose:
          type: string
          description: 文件 purpose，固定为voice-clone-output
          example: voice-clone-output
        request_id:
          type: string
          description: 请求 ID
          example: voice_clone_req_20240315_143052_001
    Error:
      type: object
      properties:
        error:
          required:
            - code
            - message
          type: object
          properties:
            code:
              type: string
            message:
              type: string
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        使用以下格式进行身份验证：Bearer [<your api
        key>](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)

````

Built with [Mintlify](https://mintlify.com).
> ## Documentation Index
> Fetch the complete documentation index at: https://docs.bigmodel.cn/llms.txt
> Use this file to discover all available pages before exploring further.

# 上传文件文档

> 向指定知识库上传文件类型文档，支持多种切片方式和回调。



## OpenAPI

````yaml openapi/openapi.json post /llm-application/open/document/upload_document/{id}
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
  /llm-application/open/document/upload_document/{id}:
    post:
      tags:
        - 知识库 API
      summary: 上传文件文档
      description: 向指定知识库上传文件类型文档，支持多种切片方式和回调。
      parameters:
        - name: id
          in: path
          required: true
          description: 知识库id
          schema:
            type: string
      requestBody:
        content:
          multipart/form-data:
            schema:
              $ref: '#/components/schemas/DocumentUploadRequest'
        required: true
      responses:
        '200':
          description: 业务处理成功
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/DocumentUploadResponse'
        default:
          description: 请求失败。
          content:
            application/json:
              schema:
                $ref: '#/components/schemas/LlmApplicationError'
components:
  schemas:
    DocumentUploadRequest:
      type: object
      properties:
        files:
          type: string
          format: binary
          description: 文件
        knowledge_type:
          type: integer
          description: |-
            文档类型，不传则动态解析。
            1: 按标题段落切：支持txt,doc,pdf,url,docx,ppt,pptx,md
            2: 按问答对切片：支持txt,doc,pdf,url,docx,ppt,pptx,md
            3: 按行切片：支持xls,xlsx,csv
            5: 自定义切片：支持txt,doc,pdf,url,docx,ppt,pptx,md
            6: 按页切片：支持pdf,ppt,pptx
            7: 按单个切片：支持xls,xlsx,csv
        custom_separator:
          type: array
          items:
            type: string
          description: |
            自定义切片规则，knowledge_type=5时传，默认
        sentence_size:
          type: integer
          description: 自定义切片大小，knowledge_type=5时传，20-2000，默认300
        parse_image:
          type: boolean
          description: 是否解析图片，默认不解析
        callback_url:
          type: string
          description: 回调地址
        callback_header:
          type: object
          description: 回调时header携带的k-v
        word_num_limit:
          type: string
          description: 文档字数上限，必须为数字
        req_id:
          type: string
          description: 请求唯一id
      required:
        - files
    DocumentUploadResponse:
      type: object
      properties:
        data:
          type: object
          properties:
            successInfos:
              type: array
              items:
                $ref: '#/components/schemas/DocumentUploadSuccessInfo'
              description: 上传成功的文件
            failedInfos:
              type: array
              items:
                $ref: '#/components/schemas/DocumentUploadFailedInfo'
              description: 上传失败的文件
        code:
          type: integer
          description: 响应码，200为成功
        message:
          type: string
          description: 响应信息
        timestamp:
          type: integer
          description: 响应时间戳
    LlmApplicationError:
      type: object
      properties:
        code:
          type: integer
        message:
          type: string
    DocumentUploadSuccessInfo:
      type: object
      properties:
        documentId:
          type: string
          description: 文档ID
        fileName:
          type: string
          description: 文件名
    DocumentUploadFailedInfo:
      type: object
      properties:
        fileName:
          type: string
          description: 文件名
        failReason:
          type: string
          description: 失败原因
  securitySchemes:
    bearerAuth:
      type: http
      scheme: bearer
      description: >-
        使用以下格式进行身份验证：Bearer [<your api
        key>](https://bigmodel.cn/usercenter/proj-mgmt/apikeys)

````

Built with [Mintlify](https://mintlify.com).
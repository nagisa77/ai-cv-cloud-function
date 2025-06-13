# AI 简历云函数服务

该项目是一个基于 Node.js (Express) 的服务，设计用于在 Serverless 环境（如腾讯云 SCF）中运行，为简历生成和图片处理提供 API 支持。主要功能包括：

- 验证码登录与用户认证
- 简历的 CRUD 管理及数据存储
- 调用大模型聊天接口（默认 DeepSeek V3-0324）
- 上传图片或 PDF 文件并经 OCR 识别后生成结构化简历
- 生成并保存简历截图至腾讯云 COS

下文将介绍项目结构、环境变量配置以及接口使用方式。

## 项目结构

- `app.js`：应用入口，加载各类路由并启动服务器。
- `routes/`：
  - `auth.js`：验证码发送与登录验证。
  - `user.js`：简历管理、元数据和聊天记录接口。
  - `pic.js`：图片上传、OCR 简历解析及截图逻辑。
  - `chat.js`：代理大模型聊天接口（可切换 DeepSeek 或 QWEN）。
- `utils/redis.js`：Redis 客户端封装，用于数据缓存及验证码存储。
- `scf_bootstrap`：在 SCF 环境中启动服务的脚本。
- `.env.example`：环境变量示例文件。

## 环境准备

1. 安装依赖：
   ```bash
   npm install
   ```
2. 复制 `.env.example` 为 `.env`，并根据实际情况填入各项配置，例如 Redis、COS、Resend、模型名称、OpenAI 密钥、SCF Endpoint、腾讯 OCR 以及 JWT 密钥等：
   ```bash
  cp .env.example .env
  # 修改 .env 填入真实配置
  ```
   其中 `OPENAI_MODEL` 用于指定要使用的大模型名称，默认值为 `deepseek-chat`。若值包含 `qwen` 将自动使用 DashScope 接口。
3. 本地启动：
   ```bash
   node app.js
   # 默认端口为 9000
   ```

## 主要接口概览

### 1. 认证相关 `/auth`

- `POST /auth/captcha/send` 发送验证码，可通过邮箱或手机号接收。
- `POST /auth/captcha/login` 使用验证码登录，返回 JWT token。

### 2. 用户与简历相关 `/user`

> 所有 `/user` 路由均需要在 `Authorization` 请求头中携带 `Bearer <token>` 格式的 JWT。

- `POST /user/resumes` 创建新简历。成功后将异步触发截图并保存至 COS。
- `PATCH /user/resumes/:resume_id` 更新简历信息（名称、模板类型、颜色）。如模板变更会重新截图。
- `GET /user/resumes` 获取当前用户的简历列表（使用 `?trash=true` 查看回收站）。
- `GET /user/resumes/:resume_id` 获取某份简历的详细信息。
- `POST /user/resumes/:resume_id/recycle` 将简历移入回收站。
- `POST /user/resumes/:resume_id/restore` 从回收站恢复简历。
- `DELETE /user/resumes/:resume_id` 彻底删除简历及其关联数据（通常在回收站中调
用）。
- `POST /user/resumes/batch/recycle` 批量将多个简历移入回收站。
- `DELETE /user/resumes/batch` 批量彻底删除简历及其关联数据。
- `GET|POST|DELETE /user/resumes/:resume_id/meta_data` 管理简历的元数据（JSON 格式）。
- `GET|POST /user/resumes/:resume_id/chat` 获取或保存与简历相关的聊天记录。

### 3. 图片及 OCR `/pic`

- `POST /pic` 上传图片文件到 COS，返回公开访问的 URL。
- `POST /pic/ocr-resume` 接收上传的图片或 PDF（或远程 URL），经过腾讯云 OCR 识别并结合模板调用配置的大模型生成结构化简历数据。
- `POST /pic/scf-screenshot` 根据简历 ID、模板类型和颜色在无头浏览器中截图，并将图片存储到 COS（内部使用，可在创建或更新简历时自动调用）。

### 4. 聊天接口 `/chat`

- `POST /chat/completions` 兼容 OpenAI 格式，根据模型名称代理 DeepSeek 或 QWEN 进行对话。

### 5. 面试题接口 `/interview`

- `GET /interview/meta` 获取所有来源平台及分类列表。
- `GET /interview/questions` 按来源数量排序返回面试题，可使用 `categories` 和 `platform` 查询参数过滤，支持 `page` 和 `pageSize` 分页查询（不传则返回全部）。

## 部署到 Serverless

项目默认在本地运行，但也可部署到腾讯云函数（SCF）。部署时需保证 `scf_bootstrap` 为可执行文件，并在函数入口设置为该脚本。同时需在环境变量中配置所有外部服务的密钥。

## License

本项目以 MIT 协议开源，同时也支持遵循 GPL 协议。

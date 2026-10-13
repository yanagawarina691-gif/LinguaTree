# LinguaTree

个人英语学习原型：将视频或手动文字稿解析成知识点，再通过知识图谱、闪卡、问答和迁移练习复习。

<img src="docs/preview.png" alt="LinguaTree 个人学习演示" width="320">

**当前为单账户演示。** 所有获准访问的人共用 `default` 用户和同一份学习记录，没有注册登录或多用户数据隔离。请勿将其用于存放多个用户的私密数据。

## 已有流程与限制

- 视频下载、音频转写、可选图像分析与语言模型解析；也可手动提供文字稿。
- 动态生成知识矿石和关联，配合学习记录与练习页面。
- Express + SQLite 后端，React + Vite 前端。
- 视频源的下载限制、网络环境和模型输出会影响解析结果；这是原型，尚未实现公开服务所需的任务队列、并发配额和完整防滥用措施。

## 本地启动

需要 Node.js 22 或更高版本。视频流程另需 ffmpeg、Python 3；相关 Python ASR 路径依赖 `requests` 和 `dashscope`。yt-dlp 用于支持的平台视频下载。只浏览界面、查看空知识库和运行基础测试无需付费密钥。

```bash
npm ci
npm --prefix frontend ci
cp .env.example .env
npm run migrate
npm run build:frontend
npm start
```

打开 <http://127.0.0.1:3000>。前端由 Express 同源提供，首次启动自动创建数据库。知识节点随解析动态产生，不再预置 42 个固定节点。

需要 AI 功能时，根据 `.env.example` 配置模型与密钥：`OPENAI_API_KEY`/`OPENAI_BASE_URL` 用于兼容接口的语言与视觉模型；`ASR_PROVIDER` 决定语音服务，DashScope 语音另用 `DASHSCOPE_API_KEY`。这些服务能力不能仅靠替换 Base URL 任意互换。调用会消耗所配置服务的额度。

前端热更新开发：运行 `npm run dev` 启动后端，另开终端运行 `npm --prefix frontend run dev`。Vite 将 `/api` 转发到本机后端。

## 访问保护

默认 `HOST=127.0.0.1`，仅监听本机。若设置 `DEMO_PASSWORD`，页面和 API 均使用 HTTP Basic 访问保护，浏览器会提示输入用户名 `learner` 和该口令。

生成随机口令：

```bash
node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"
```

将生成结果设置为 `DEMO_PASSWORD`，不要提交到 Git。口令至少 24 个字符；生产模式或对外监听时，缺少口令会拒绝启动。`/health` 仅返回无敏感内容的健康状态，无需口令。

对外部署需同时配置：

- `NODE_ENV=production`
- `HOST=0.0.0.0`
- 强随机 `DEMO_PASSWORD`
- HTTPS 入口，以及持久化 SQLite 数据目录。`DB_PATH` 可指定数据库文件路径，父目录需预先创建。

Docker/Render 配置按前后端同源服务运行。现有独立静态托管配置不构成访问保护；以 Express 服务提供页面和 API 为本版本的推荐运行方式。不要把 API Key 或演示口令写入前端环境变量。

**访问口令只限制谁能进入演示，不提供用户之间的数据隔离。** 知道口令的访客都会看到和修改同一份演示数据。HTTP Basic 凭据可能由浏览器缓存，演示后关闭独立浏览器会话；需要撤销已分享的访问权限时轮换口令。

## 核心 API

以下路由遵循同一访问保护规则；没有 `/api/auth/register`、`/api/auth/login` 或 JWT 账户接口。

| 路径 | 用途 |
| --- | --- |
| `GET /api/info` | 当前运行模式及接口摘要 |
| `POST /api/videos/parse` | 提交 `url` 或 `manualTranscript` |
| `GET /api/videos` | 共享演示的视频列表 |
| `GET /api/videos/:id/status` | 解析状态 |
| `GET /api/videos/:id` | 解析内容与练习 |
| `GET /api/tree` | 知识图谱 |
| `GET /api/user/stats` | 共享账户学习统计 |

更多路由定义见 `src/routes/`。旧版固定知识树、SSE 和注册登录说明不再代表当前实现。

## 测试

```bash
npm test
```

`npm test` 先构建前端，再运行基础集成测试。测试启动真实服务，使用临时数据库，检查访问保护、视频列表、知识图谱和学习统计；不读取个人数据库，不调用模型 API。CI 使用同样的检查。

`test/test_asr_llm.mjs` 与 `test/test_ocr_vlm.mjs` 是手动模型诊断脚本，需要各自指定的本地音视频素材和密钥，会调用外部服务，不属于默认测试。

## 目录

```text
frontend/          React 前端与素材源文件
src/routes/        API 路由
src/services/      视频处理、AI 调用和学习流程
src/middleware/    演示访问保护与共享用户上下文
src/db/            SQLite schema 与初始化
public/            前端构建产物，由构建生成
test/             集成测试和手动诊断脚本
```

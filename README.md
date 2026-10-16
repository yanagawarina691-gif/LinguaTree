# LinguaTree

把视频或文字稿中的英语知识整理成可探索的知识图谱，再通过讲解、闪卡、问答和迁移练习巩固学习。

本仓库是可运行的项目归档与作品集记录，包含 React 前端、Express 后端、个人学习流程、固定演示数据和自动化测试。

<img src="docs/preview.png" alt="LinguaTree 学习界面" width="320">

## 快速开始：无需密钥的本地演示

需要 Node.js 22 或更高版本，在仓库根目录执行：

```bash
npm ci
npm --prefix frontend ci
# 已有 .env 时跳过复制，保留自己的配置
cp .env.example .env
npm run build:frontend
npm start
```

打开 <http://127.0.0.1:3000>。默认 `APP_MODE=demo`，无需模型密钥、ffmpeg、Python 或数据库迁移。复用已有 `.env` 时，确认 `APP_MODE=demo`、`HOST=127.0.0.1`、`NODE_ENV=development`，并将 `PUBLIC_ORIGIN` 留空。

演示包含三组虚构课程，可以浏览知识图谱、知识点讲解、闪卡、练习参考答案和示例学习进度。页面会标注只读模式，所有内容均来自 `src/demo/snapshot.json`，不代表真实用户记录或真实视频解析结果。

## 项目内容

- **学习素材**：视频链接或手动文字稿输入，整理知识点与例句
- **知识图谱**：以可交互的图谱呈现知识节点、关联与学习状态
- **巩固练习**：深化讲解、闪卡、自由问答和场景迁移
- **学习记录**：课程归档、复习状态与个人统计

这些学习流程的交互实现保留在 personal 模式；demo 使用预生成内容展示界面与学习路径。

## 运行模式与配置

### demo：固定示例

`APP_MODE=demo` 是默认模式。服务端仅挂载固定示例的读取接口，写入请求被拒绝；讲解、闪卡和练习答案也直接读取快照。demo 不打开个人 SQLite 数据库，不加载个人学习服务，不下载媒体，不调用 AI。

切换模式不会迁移、清空或覆盖个人数据；demo 会忽略个人数据库与模型配置。`.env`、密钥和真实学习数据库应保留在本机，不提交到仓库。

### personal：个人交互学习

在 `.env` 中设置 `APP_MODE=personal`，并按 `.env.example` 配置自己的模型服务：

- 文字解析与 AI 练习：`OPENAI_API_KEY`、`OPENAI_BASE_URL`、`LLM_MODEL`
- 视频识别：`ASR_PROVIDER`、`ASR_MODEL`、`VLM_MODEL`，使用 DashScope ASR 时配置 `DASHSCOPE_API_KEY`
- 视频处理环境：ffmpeg、Python 3、Python 的 `requests` / `dashscope` 依赖，以及 yt-dlp
- 数据存储：可选 `DB_PATH`，默认 `src/db/linguatree.db`；自定义路径的父目录需预先存在

```bash
npm run migrate
npm start
```

personal 首次启动也会自动初始化数据库 schema；demo 下执行迁移命令只提示无需迁移。交互式 AI 功能需要已配置、可用的对应服务，调用会消耗服务额度；视频下载还取决于来源平台的支持情况。

personal 面向个人使用，所有获准访问者共用同一份学习数据。演示展示使用 demo，自己的学习记录使用独立的 personal 实例。

## 开发与测试

前端热更新使用两个终端：

```bash
# 终端 1：后端，默认 3000 端口
npm run dev

# 终端 2：前端，默认 5173 端口
npm --prefix frontend run dev
```

访问 Vite 输出的本机地址。`/api` 由 Vite 转发至后端；本机开发时 `PUBLIC_ORIGIN` 留空，或设置为当前 Vite 来源。

```bash
# 构建前端到 public/，由 Express 同源提供页面与 API
npm run build:frontend

# 自动构建前端，再运行后端集成测试与前端回归测试
npm test
```

默认测试使用临时目录与虚构数据，不读取开发者 `.env` 或个人数据库，不调用真实模型。覆盖访问保护、来源校验、只读接口、demo 与个人服务隔离、前端练习预览及 personal 基本读写；CI 执行同一命令。

`test/test_asr_llm.mjs` 与 `test/test_ocr_vlm.mjs` 是独立的手动模型诊断脚本，需要本地音视频和密钥，会调用外部服务，不属于默认测试。

## 源码结构

```text
frontend/          React 页面、组件、样式与前端测试
src/demo/          虚构示例快照与只读路由
src/routes/        personal 交互 API
src/services/      学习流程、媒体处理及 AI 服务
src/middleware/    访问保护与个人用户上下文
src/db/            SQLite schema、初始化与迁移
public/            前端构建产物
test/              后端集成测试与手动诊断脚本
```

`GET /api/info` 提供当前 `mode`、`readOnly`、`dataset` 和主要接口说明，前端据此切换功能。`GET /health` 提供公开的健康检查。

## 可选：分享演示

默认仅监听本机。需要分享时，仓库提供 Docker 与 Render 配置，由 Express 同源提供整站，使用以下环境变量：

```text
APP_MODE=demo
NODE_ENV=production
HOST=0.0.0.0
DEMO_PASSWORD=<至少 24 字符的随机口令>
PUBLIC_ORIGIN=https://your-demo.example.com
```

可用 `node -e "console.log(require('node:crypto').randomBytes(24).toString('base64url'))"` 生成口令。HTTP Basic 用户名固定为 `learner`，保护页面与 API；生产模式或对外监听时必须配置口令。`PUBLIC_ORIGIN` 填实际访问来源，不含路径，HTTPS 由托管平台或反向代理提供。

API 校验请求来源；命令行客户端需提供匹配的 `Origin`，例如本地使用 `Origin: http://127.0.0.1:3000`。撤销分享时更换口令并重启服务。demo 不需要持久化磁盘，也不保存访客进度；personal 则需要保留 SQLite 数据目录。

`vercel.json` 是独立静态托管配置，不包含上述整站访问保护；分享带口令的演示请使用 Express 同源方式。

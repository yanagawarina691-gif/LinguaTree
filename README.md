# LinguaTree Backend

AI 驱动的英语学习后端 — 抖音视频 → ASR/OCR/VLM 多模态解析 → LLM 知识点映射 → 知识树生长。

## 快速开始

### 1. 安装依赖

```bash
npm install
```

### 2. 配置环境变量

```bash
cp .env.example .env
# 编辑 .env，填入 OPENAI_API_KEY
```

**API Key 获取方式（任选其一）：**

| 平台 | 获取地址 | Base URL | 模型 |
|------|---------|----------|------|
| OpenAI | https://platform.openai.com/api-keys | `https://api.openai.com/v1` | gpt-4o-mini, gpt-4o, whisper-1 |
| 通义千问 | https://dashscope.console.aliyun.com/ | `https://dashscope.aliyuncs.com/compatible-mode/v1` | qwen-plus, qwen-vl-max |
| DeepSeek | https://platform.deepseek.com/ | `https://api.deepseek.com/v1` | deepseek-chat（无 vision） |

如果在国内直连 OpenAI 失败，取消 `.env` 中代理行的注释：
```
HTTP_PROXY=http://127.0.0.1:7897
HTTPS_PROXY=http://127.0.0.1:7897
```

### 3. 初始化数据库

```bash
npm run migrate
```

这会创建 SQLite 数据库文件 `src/db/linguatree.db` 并 seed 42 个知识树节点。

### 4. 启动服务

```bash
npm start
# 或开发模式（文件改动自动重启）
npm run dev
```

服务默认运行在 `http://localhost:3000`。

## API 接口

### 认证

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/auth/register` | 注册（body: `{ "nickname": "小陈" }`） |
| POST | `/api/auth/login` | 登录（body: `{ "nickname": "小陈" }`） |
| GET | `/api/auth/me` | 获取当前用户（需 Bearer token） |

### 视频解析

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/api/videos/parse` | 提交视频链接开始解析（body: `{ "url": "https://..." }` 或 `{ "manualTranscript": "文字稿..." }`） |
| GET | `/api/videos/:id/status` | 查询解析状态和进度 |
| GET | `/api/videos/:id` | 获取解析结果（含知识点映射 + 巩固训练题） |
| GET | `/api/videos` | 获取用户视频列表 |
| POST | `/api/videos/:id/exercises/complete` | 提交巩固训练答题结果 |

### 知识树

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/tree` | 获取完整知识树（含每个节点 XP/等级/掌握度） |
| GET | `/api/tree/branch/:branchId` | 获取某个分支详情（branchId: grammar/vocabulary/pronunciation/listening/culture） |
| GET | `/api/tree/weak?count=3` | 获取弱项节点 |
| GET | `/api/tree/stats` | 获取知识树统计 |

### 用户

| 方法 | 路径 | 说明 |
|------|------|------|
| GET | `/api/user/stats` | 获取用户学习统计 |

## AI 解析 Pipeline

```
用户粘贴抖音链接
    │
    ▼
┌─────────────────────────────────────────────┐
│  阶段一：多模态理解                              │
│  1. 下载视频 (yt-dlp / 直链)                     │
│  2. ffmpeg 提取音频 + 关键帧                       │
│  3. ASR 语音转文字 (Whisper)                     │
│  4. OCR 画面文字识别 (GPT-4o vision)              │
│  5. VLM 画面场景描述 (GPT-4o vision)              │
└──────────────────────┬──────────────────────┘
                       ▼
┌─────────────────────────────────────────────┐
│  阶段二：LLM 知识点抽取与映射                       │
│  6. 知识点识别 → 42 节点知识树映射                   │
│  7. 权重判定 (1-5) + confidence 评估              │
│  8. CEFR 难度评估                                │
│  9. 巩固训练题生成 (选择/填空/判断)                  │
└──────────────────────┬──────────────────────┘
                       ▼
┌─────────────────────────────────────────────┐
│  阶段三：知识树更新与推荐                           │
│  10. XP 计算 (weight × 完播率 × 10)              │
│  11. 节点自动升级 (休眠→发芽→茂叶→开花)             │
│  12. 掌握度计算 (答题正确率×0.7 + XP归一化×0.3)      │
└─────────────────────────────────────────────┘
```

### 降级策略

- **视频下载失败** → 提示用户手动粘贴文字稿
- **ASR 失败** → 使用手动文字稿，跳过音频
- **OCR/VLM 失败** → 仅使用文本信息
- **LLM 返回空结果** → 提示"未识别到英语知识点"

## 知识树结构

5 个一级分支，18 个二级分支，42 个叶子节点：

| 分支 | 节点数 | 颜色 |
|------|--------|------|
| 语法 (Grammar) | 18 | #CE82FF |
| 词汇 (Vocabulary) | 10 | #FF9600 |
| 发音 (Pronunciation) | 7 | #FF4B4B |
| 听力 (Listening) | 4 | #1CB0F6 |
| 文化 (Culture) | 3 | #FFC800 |

### 节点等级

| 等级 | 名称 | 所需 XP | 视觉 |
|------|------|---------|------|
| Lv0 | 休眠 | 0 | 灰白半透明 |
| Lv1 | 发芽 | ≥10 | 浅绿嫩叶 |
| Lv2 | 茂叶 | ≥50 | 翠绿茂密 |
| Lv3 | 开花 | ≥150 | 金色花朵 |

### XP 来源

- 视频解析命中节点：`weight × completion_rate × 10`
- 巩固训练答对：`+5 XP/题`
- 答错不扣 XP（正向激励）

## 项目结构

```
linguatree-backend/
├── src/
│   ├── server.js              # 入口
│   ├── app.js                 # Express app
│   ├── config.js              # 环境配置
│   ├── db/
│   │   ├── index.js           # SQLite 连接 + 迁移
│   │   ├── schema.sql         # 数据库 schema
│   │   ├── migrate.js         # 迁移脚本
│   │   └── linguatree.db      # SQLite 数据库（自动生成）
│   ├── data/
│   │   └── knowledgeTree.json # 42 节点知识树定义
│   ├── middleware/
│   │   └── auth.js            # JWT 认证
│   ├── routes/
│   │   ├── auth.js            # 认证路由
│   │   ├── videos.js          # 视频解析路由
│   │   ├── tree.js            # 知识树路由
│   │   └── user.js            # 用户路由
│   ├── services/
│   │   ├── videoDownload.js   # 视频下载（yt-dlp/直链）
│   │   ├── mediaProcess.js    # ffmpeg 音频+关键帧提取
│   │   ├── asrService.js      # Whisper 语音转文字
│   │   ├── llmService.js      # LLM 知识抽取 + GPT-4o vision OCR/VLM
│   │   ├── treeService.js     # 知识树 XP/升级/掌握度
│   │   └── pipeline.js        # AI Pipeline 编排器
│   └── utils/
│       └── logger.js          # 日志工具
├── .env.example
├── .gitignore
├── package.json
└── README.md
```

## 前置依赖

- **Node.js** ≥ 18
- **ffmpeg** — 音频提取和关键帧截图（`brew install ffmpeg`）
- **yt-dlp**（可选）— 抖音视频下载（`brew install yt-dlp`）

## 开发

```bash
# 开发模式（文件改动自动重启）
npm run dev

# 重新初始化数据库（删除旧 db 后重新 migrate）
rm src/db/linguatree.db && npm run migrate
```

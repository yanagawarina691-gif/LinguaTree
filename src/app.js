import express from 'express';
import cors from 'cors';
import { config } from './config.js';
import { logger } from './utils/logger.js';
import authRoutes from './routes/auth.js';
import videoRoutes from './routes/videos.js';
import treeRoutes from './routes/tree.js';
import userRoutes from './routes/user.js';
import cardRoutes from './routes/cards.js';

const app = express();

// 中间件
app.use(cors());
app.use(express.json({ limit: '10mb' }));

// 请求日志
app.use((req, res, next) => {
  logger.debug(`${req.method} ${req.url}`);
  next();
});

// 健康检查
app.get('/health', (req, res) => {
  res.json({
    status: 'ok',
    service: 'LinguaTree Backend',
    version: '1.0.0',
    timestamp: new Date().toISOString(),
  });
});

// API 路由
app.use('/api/auth', authRoutes);
app.use('/api/videos', videoRoutes);
app.use('/api/tree', treeRoutes);
app.use('/api/user', userRoutes);
app.use('/api/cards', cardRoutes);

// 根路由 — API 信息
app.get('/api/info', (req, res) => {
  res.json({
    name: 'LinguaTree Backend API',
    version: '1.0.0',
    docs: '/health',
    endpoints: {
      auth: {
        'POST /api/auth/register': '注册（body: { nickname }）',
        'POST /api/auth/login': '登录（body: { nickname }）',
        'GET /api/auth/me': '获取当前用户（需 Bearer token）',
      },
      videos: {
        'POST /api/videos/parse': '提交视频解析（body: { url?, manualTranscript? }）',
        'GET /api/videos/:id/status': '查询解析状态',
        'GET /api/videos/:id': '获取解析结果',
        'GET /api/videos': '视频列表',
        'POST /api/videos/:id/exercises/complete': '提交巩固训练结果',
        'GET /api/videos/:id/deepen': '获取加深理解内容（M1，缓存优先）',
        'GET /api/videos/:id/deepen/stream': 'SSE 流式推送加深理解内容（M1）',
        'POST /api/videos/:id/deepen/feedback': '提交加深理解反馈（M1）',
        'POST /api/videos/:id/deepen/regenerate': '重新生成加深理解内容（M1）',
        'POST /api/videos/:id/deepen/complete': '标记加深理解完成并发放 XP（M1，幂等）',
        'GET /api/videos/:id/internalize/flashcards': '获取闪卡（M5模态一，无则生成）',
        'POST /api/videos/:id/internalize/flashcards/complete': '标记闪卡完成+发XP（M5，幂等）',
        'GET /api/videos/:id/internalize/freeform': '获取问答题（M5模态三，无则生成）',
        'POST /api/videos/:id/internalize/freeform/evaluate': '提交问答题答案+AI评估+XP（M5，幂等）',
        'GET /api/videos/:id/migration': '获取迁移场景（M2，无则自动生成）',
        'POST /api/videos/:id/migration/evaluate': '提交迁移回答并获取AI评估（M2，幂等防刷）',
        'POST /api/videos/:id/migration/skip': '跳过迁移环节（M2，记录行为）',
        'GET /api/videos/:id/progress': '获取三阶段学习进度（M4）',
        'POST /api/videos/:id/complete': '三阶段完结并归档到卡片（M4）',
      },
      tree: {
        'GET /api/tree': '获取完整知识树',
        'GET /api/tree/branch/:branchId': '获取分支详情',
        'GET /api/tree/weak': '获取弱项节点',
        'GET /api/tree/stats': '获取知识树统计',
      },
      user: {
        'GET /api/user/stats': '获取用户统计',
      },
      cards: {
        'GET /api/cards': '获取知识卡片列表（M3，?review=1 返回今日推荐复习）',
        'GET /api/cards/:nodeId': '获取单张卡片详情（M3）',
        'GET /api/cards/:nodeId/backlinks': '获取卡片双向链接（M3）',
        'POST /api/cards/:nodeId/review': '记录复习并更新 SRS（M3）',
      },
    },
  });
});

// 静态文件服务（前端 H5 应用）
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import { existsSync } from 'fs';

app.use(express.static(join(__dirname, '..', 'public')));

// SPA fallback: 非 API 路由返回 index.html
app.get(/^\/(?!api|health).*/, (req, res, next) => {
  const indexPath = join(__dirname, '..', 'public', 'index.html');
  if (existsSync(indexPath)) {
    res.sendFile(indexPath);
  } else {
    next();
  }
});

// 404
app.use((req, res) => {
  res.status(404).json({ error: `路由不存在: ${req.method} ${req.url}` });
});

// 错误处理
app.use((err, req, res, next) => {
  logger.error(`未捕获错误: ${err.message}`);
  logger.debug(err.stack);
  res.status(500).json({
    error: '服务器内部错误',
    message: config.NODE_ENV === 'development' ? err.message : undefined,
  });
});

export default app;

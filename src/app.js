import express from 'express';
import { createDemoAccess } from './middleware/demoAccess.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

const app = express();

// 请求日志
app.use((req, res, next) => {
  res.set('Content-Security-Policy', "frame-ancestors 'none'");
  res.set('X-Content-Type-Options', 'nosniff');
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

// 所有页面和 API 共用访问保护；仅无敏感内容的健康检查公开。
app.use(createDemoAccess(config));

const readOnly = config.APP_MODE === 'demo';
// Fail closed before parsing request bodies, including unknown/future endpoints.
if (readOnly) {
  app.use((req, res, next) => {
    if (!['GET', 'HEAD'].includes(req.method)) {
      return res.status(403).json({ code: 'DEMO_READ_ONLY', error: '这是只读示例，不能修改数据或调用 AI。' });
    }
    next();
  });
}

// 根路由 — API 信息
app.get('/api/info', (req, res) => {
  res.json({
    name: 'LinguaTree Backend API',
    version: '1.0.0',
    mode: readOnly ? 'read-only-demo' : 'single-user-personal',
    readOnly,
    dataset: readOnly ? 'fictional-pregenerated' : null,
    access: 'HTTP Basic when DEMO_PASSWORD is configured; username: learner',
    limitations: readOnly
      ? 'Fictional, pregenerated examples only. No personal database, writes, downloads or model calls.'
      : 'All authorized visitors share and can modify the same personal learning data.',
    endpoints: {
      videos: {
        'GET /api/videos/:id/status': '查询解析状态',
        'GET /api/videos/:id': '获取解析结果',
        'GET /api/videos': '视频列表',
        'GET /api/videos/:id/migration': readOnly ? '预生成迁移示例' : '获取或生成迁移场景',
        ...(!readOnly && {
          'POST /api/videos/parse': '提交视频解析（body: { url?, manualTranscript? }）',
          'POST /api/videos/:id/exercises/complete': '提交巩固训练结果',
          'POST /api/videos/:id/migration/evaluate': '提交迁移回答并获取 AI 评估',
        }),
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
    },
  });
});

if (readOnly) {
  // Deliberately do not import personal routes, SQLite or generation services.
  const { default: demoRoutes } = await import('./demo/routes.js');
  app.use('/api', demoRoutes);
} else {
  app.use(express.json({ limit: '10mb' }));
  const [{ default: videos }, { default: tree }, { default: ores }, { default: user }] = await Promise.all([
    import('./routes/videos.js'), import('./routes/tree.js'), import('./routes/ores.js'), import('./routes/user.js'),
  ]);
  app.use('/api/videos', videos);
  app.use('/api/tree', tree);
  app.use('/api/ores', ores);
  app.use('/api/user', user);
}

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

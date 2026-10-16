import app from './app.js';
import { config } from './config.js';
import { logger } from './utils/logger.js';

/**
 * 启动服务
 */
async function start() {
  if (config.APP_MODE === 'personal') {
    const { initSchema } = await import('./db/index.js');
    initSchema();
  }
  console.log(config.APP_MODE === 'demo'
    ? '[LinguaTree] 只读虚构示例已就绪；未连接个人数据库或 AI 服务'
    : '[LinguaTree] 个人学习模式已就绪');

  // 启动 Express
  const server = app.listen(config.PORT, config.HOST, () => {
    logger.info(`Listening: http://${config.HOST}:${server.address().port}`);
    logger.info('='.repeat(50));
    logger.info(`  LinguaTree Backend`);
    logger.info(`  Port: ${config.PORT}`);
    logger.info(`  Env: ${config.NODE_ENV}`);
    logger.info(`  Mode: ${config.APP_MODE}`);
    logger.info(`  OpenAI Base: ${config.OPENAI_BASE_URL}`);
    logger.info(`  LLM Model: ${config.LLM_MODEL}`);
    logger.info(`  VLM Model: ${config.VLM_MODEL}`);
    logger.info(`  ASR Model: ${config.ASR_MODEL}`);
    logger.info('='.repeat(50));
    logger.info(`  API docs: http://localhost:${config.PORT}/`);
    logger.info(`  Health:   http://localhost:${config.PORT}/health`);
    logger.info('='.repeat(50));

    if (config.APP_MODE === 'personal' && !config.OPENAI_API_KEY) {
      logger.warn('⚠️  OPENAI_API_KEY 未配置！AI 解析功能将无法工作');
      logger.warn('   请复制 .env.example 为 .env 并填写 API Key');
    }
  });
}

start().catch(err => {
  logger.error('启动失败:', err);
  process.exit(1);
});

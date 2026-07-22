import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { runPipeline, processExerciseCompletion } from '../services/pipeline.js';
import { getOrCreateMigrationScenario, evaluateMigrationAttempt } from '../services/migrationService.js';
import { getOrCreateDeepenUnderstanding, markDeepenCompleted, recordDeepenFeedback } from '../services/deepenService.js';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(authRequired);

/**
 * POST /api/videos/parse
 * 提交视频链接，开始 AI 解析
 * body: { url: string, manualTranscript?: string }
 */
router.post('/parse', async (req, res) => {
  const { url, manualTranscript } = req.body;

  if (!url && !manualTranscript) {
    return res.status(400).json({ error: '请提供视频链接或手动文字稿' });
  }

  const videoId = nanoid(12);

  // 创建视频记录
  db.prepare(`
    INSERT INTO videos (id, user_id, source_url, status, manual_transcript)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(videoId, req.userId, url || '(手动文字稿)', manualTranscript || '');

  // 异步执行 Pipeline（不阻塞请求）
  runPipeline(videoId, req.userId, url, manualTranscript)
    .then(result => {
      logger.info(`[API] 视频 ${videoId} 解析成功`);
    })
    .catch(err => {
      logger.error(`[API] 视频 ${videoId} 解析失败:`, err.message);
    });

  res.status(202).json({
    videoId,
    status: 'pending',
    message: '解析已开始，请轮询状态接口',
  });
});

/**
 * GET /api/videos/:id/status
 * 查询解析状态
 */
router.get('/:id/status', (req, res) => {
  const video = db.prepare(`
    SELECT id, status, title, author, cefr_level, summary, error_message, created_at, updated_at
    FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);

  if (!video) {
    return res.status(404).json({ error: '视频不存在' });
  }

  // 获取最新的解析日志
  const logs = db.prepare(`
    SELECT stage, status, message, duration_ms, created_at
    FROM parse_logs WHERE video_id = ?
    ORDER BY created_at DESC LIMIT 10
  `).all(req.params.id);

  res.json({ ...video, logs });
});

/**
 * GET /api/videos/:id
 * 获取解析完成的视频详情（含节点映射和题目）
 */
router.get('/:id', (req, res) => {
  const video = db.prepare(`
    SELECT * FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);

  if (!video) {
    return res.status(404).json({ error: '视频不存在' });
  }

  if (video.status !== 'done') {
    return res.json({
      ...video,
      message: `解析进行中: ${video.status}`,
    });
  }

  // 获取节点映射
  const nodes = db.prepare(`
    SELECT vn.node_id, vn.weight, vn.confidence, vn.is_unclassified, vn.unclassified_name,
           kn.name as node_name, kn.top_branch_name
    FROM video_nodes vn
    LEFT JOIN knowledge_nodes kn ON kn.node_id = vn.node_id
    WHERE vn.video_id = ?
  `).all(req.params.id);

  // 获取题目
  const exercises = db.prepare(`
    SELECT id, node_id, type, question, options, answer, explanation
    FROM exercises WHERE video_id = ?
  `).all(req.params.id);

  // 格式化题目（统一使用 question 字段）
  const formattedExercises = {};
  for (const ex of exercises) {
    const formatted = {
      id: ex.id,
      node_id: ex.node_id,
      type: ex.type,
      question: ex.question,
      explanation: ex.explanation,
    };
    if (ex.type === 'choice') {
      formatted.options = JSON.parse(ex.options);
      formatted.answer = parseInt(ex.answer);
    } else if (ex.type === 'fill') {
      formatted.answer = ex.answer;
    } else if (ex.type === 'judge') {
      formatted.answer = ex.answer === 'true';
    }
    formattedExercises[ex.type] = formatted;
  }

  res.json({
    ...video,
    nodes: nodes.filter(n => !n.is_unclassified),
    unclassified: nodes.filter(n => n.is_unclassified),
    exercises: formattedExercises,
  });
});

/**
 * GET /api/videos
 * 获取用户的视频列表
 */
router.get('/', (req, res) => {
  const videos = db.prepare(`
    SELECT id, source_url, title, author, status, cefr_level, summary, created_at
    FROM videos WHERE user_id = ?
    ORDER BY created_at DESC
  `).all(req.userId);

  res.json(videos);
});

/**
 * POST /api/videos/:id/exercises/complete
 * 提交巩固训练结果
 * body: { attempts: [{ exerciseId, nodeId, isCorrect, isSkipped, userAnswer }] }
 */
router.post('/:id/exercises/complete', (req, res) => {
  const { attempts } = req.body;
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return res.status(400).json({ error: '请提供答题结果' });
  }

  const video = db.prepare(`
    SELECT id FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);

  if (!video) {
    return res.status(404).json({ error: '视频不存在' });
  }

  const result = processExerciseCompletion(req.userId, req.params.id, attempts);

  // P0: 旧版 choice/fill/judge 作为内化过渡，标记 freeform_completed
  db.prepare(`
    UPDATE videos SET freeform_completed = 1, updated_at = datetime('now') WHERE id = ?
  `).run(req.params.id);

  res.json({
    totalQuestions: attempts.length,
    correctCount: attempts.filter(a => a.isCorrect).length,
    skippedCount: attempts.filter(a => a.isSkipped).length,
    treeUpdate: result.treeUpdate,
  });
});

/**
 * GET /api/videos/:id/deepen
 * 获取加深理解内容（无则调用 LLM 生成并缓存）
 */
router.get('/:id/deepen', async (req, res) => {
  const video = db.prepare(`
    SELECT id, title FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);

  if (!video) {
    return res.status(404).json({ error: '视频不存在' });
  }

  try {
    const content = await getOrCreateDeepenUnderstanding(req.params.id, req.userId);
    res.json({ ...content, video_title: video.title });
  } catch (err) {
    logger.error('[API]', `获取加深理解内容失败: ${err.message}`);
    res.status(500).json({ error: '生成加深理解内容失败', message: err.message });
  }
});

/**
 * POST /api/videos/:id/deepen/feedback
 * 提交加深理解反馈（useful / confused）
 * body: { feedbackType: string, itemIndex?: number }
 */
router.post('/:id/deepen/feedback', (req, res) => {
  const { feedbackType, itemIndex } = req.body;

  if (!feedbackType || !['useful', 'confused'].includes(feedbackType)) {
    return res.status(400).json({ error: 'feedbackType 必须是 useful 或 confused' });
  }

  const video = db.prepare(`
    SELECT id FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);

  if (!video) {
    return res.status(404).json({ error: '视频不存在' });
  }

  try {
    const result = recordDeepenFeedback(req.params.id, req.userId, feedbackType, itemIndex ?? -1);
    res.json(result);
  } catch (err) {
    logger.error('[API]', `记录加深理解反馈失败: ${err.message}`);
    res.status(500).json({ error: '记录反馈失败', message: err.message });
  }
});

/**
 * POST /api/videos/:id/deepen
 * 标记加深理解完成或跳过
 * body: { skipped?: boolean }
 */
router.post('/:id/deepen', (req, res) => {
  const { skipped = false } = req.body;

  const video = db.prepare(`
    SELECT id FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);

  if (!video) {
    return res.status(404).json({ error: '视频不存在' });
  }

  try {
    const result = markDeepenCompleted(req.params.id, req.userId, !!skipped);
    res.json(result);
  } catch (err) {
    logger.error('[API]', `完成加深理解失败: ${err.message}`);
    res.status(500).json({ error: '更新加深理解状态失败', message: err.message });
  }
});

/**
 * GET /api/videos/:id/migration
 * 获取迁移场景（无则自动生成）
 */
router.get('/:id/migration', async (req, res) => {
  const video = db.prepare(`
    SELECT id FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);

  if (!video) {
    return res.status(404).json({ error: '视频不存在' });
  }

  try {
    const scenario = await getOrCreateMigrationScenario(req.params.id, req.userId);
    res.json(scenario);
  } catch (err) {
    logger.error('[API]', `获取迁移场景失败: ${err.message}`);
    res.status(500).json({ error: '生成迁移场景失败', message: err.message });
  }
});

/**
 * POST /api/videos/:id/migration/evaluate
 * 提交迁移回答，获取 AI 评估
 * body: { userInput: string }
 */
router.post('/:id/migration/evaluate', async (req, res) => {
  const { userInput } = req.body;

  if (!userInput || typeof userInput !== 'string') {
    return res.status(400).json({ error: '请提供迁移回答内容' });
  }

  const video = db.prepare(`
    SELECT id FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);

  if (!video) {
    return res.status(404).json({ error: '视频不存在' });
  }

  try {
    const result = await evaluateMigrationAttempt(req.params.id, req.userId, userInput.trim());
    res.json(result);
  } catch (err) {
    logger.error('[API]', `评估迁移回答失败: ${err.message}`);
    res.status(500).json({ error: '评估失败', message: err.message });
  }
});

export default router;

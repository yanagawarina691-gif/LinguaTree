import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { runPipeline, processExerciseCompletion } from '../services/pipeline.js';
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

  res.json({
    totalQuestions: attempts.length,
    correctCount: attempts.filter(a => a.isCorrect).length,
    skippedCount: attempts.filter(a => a.isSkipped).length,
    treeUpdate: result.treeUpdate,
  });
});

export default router;

import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { runPipeline, processExerciseCompletion } from '../services/pipeline.js';
import { getOrCreateMigrationScenario, evaluateMigrationAttempt, skipMigration } from '../services/migrationService.js';
import {
  getVideoForDeepen,
  getDeepen,
  generateAndStoreDeepen,
  deleteDeepen,
  recordFeedback,
  completeDeepen,
} from '../services/deepenService.js';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';
import { ensureCardArchived } from '../services/cardService.js';
import {
  getOrCreateFlashcards,
  completeFlashcards,
  getOrCreateFreeformQuestion,
  evaluateFreeformAttempt,
} from '../services/internalizeService.js';

const router = Router();
router.use(authRequired);

/**
 * POST /api/videos/parse
 */
router.post('/parse', async (req, res) => {
  const { url, manualTranscript } = req.body;
  if (!url && !manualTranscript) {
    return res.status(400).json({ error: '请提供视频链接或手动文字稿' });
  }

  const videoId = nanoid(12);
  db.prepare(`
    INSERT INTO videos (id, user_id, source_url, status, manual_transcript)
    VALUES (?, ?, ?, 'pending', ?)
  `).run(videoId, req.userId, url || '(手动文字稿)', manualTranscript || '');

  runPipeline(videoId, req.userId, url, manualTranscript)
    .then(() => logger.info(`[API] 视频 ${videoId} 解析成功`))
    .catch(err => logger.error(`[API] 视频 ${videoId} 解析失败:`, err.message));

  res.status(202).json({ videoId, status: 'pending', message: '解析已开始，请轮询状态接口' });
});

/**
 * GET /api/videos/:id/status
 */
router.get('/:id/status', (req, res) => {
  const video = db.prepare(`
    SELECT id, status, title, author, cefr_level, summary, error_message, created_at, updated_at
    FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);

  if (!video) return res.status(404).json({ error: '视频不存在' });

  const logs = db.prepare(`
    SELECT stage, status, message, duration_ms, created_at
    FROM parse_logs WHERE video_id = ?
    ORDER BY created_at DESC LIMIT 10
  `).all(req.params.id);

  res.json({ ...video, logs });
});

/**
 * GET /api/videos/:id
 */
router.get('/:id', (req, res) => {
  const video = db.prepare(`SELECT * FROM videos WHERE id = ? AND user_id = ?`).get(req.params.id, req.userId);
  if (!video) return res.status(404).json({ error: '视频不存在' });
  if (video.status !== 'done') return res.json({ ...video, message: `解析进行中: ${video.status}` });

  const nodes = db.prepare(`
    SELECT vn.node_id, vn.weight, vn.confidence, vn.is_unclassified, vn.unclassified_name,
           kn.name as node_name, kn.top_branch_name
    FROM video_nodes vn
    LEFT JOIN knowledge_nodes kn ON kn.node_id = vn.node_id
    WHERE vn.video_id = ?
  `).all(req.params.id);

  const exercises = db.prepare(`
    SELECT id, node_id, type, question, options, answer, explanation
    FROM exercises WHERE video_id = ?
  `).all(req.params.id);

  const formattedExercises = {};
  for (const ex of exercises) {
    const formatted = { id: ex.id, node_id: ex.node_id, type: ex.type, question: ex.question, explanation: ex.explanation };
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
 */
router.post('/:id/exercises/complete', (req, res) => {
  const { attempts } = req.body;
  if (!Array.isArray(attempts) || attempts.length === 0) {
    return res.status(400).json({ error: '请提供答题结果' });
  }
  const video = db.prepare(`SELECT id FROM videos WHERE id = ? AND user_id = ?`).get(req.params.id, req.userId);
  if (!video) return res.status(404).json({ error: '视频不存在' });

  const result = processExerciseCompletion(req.userId, req.params.id, attempts);
  res.json({
    totalQuestions: attempts.length,
    correctCount: attempts.filter(a => a.isCorrect).length,
    skippedCount: attempts.filter(a => a.isSkipped).length,
    treeUpdate: result.treeUpdate,
  });
});

/**
 * GET /api/videos/:id/deepen
 */
router.get('/:id/deepen', async (req, res) => {
  try {
    const video = getVideoForDeepen(req.params.id, req.userId);
    let content = getDeepen(req.params.id);
    if (!content) {
      content = await generateAndStoreDeepen(video, { stream: false });
      content = getDeepen(req.params.id) || content;
    }
    // [BUG-14 修复] 删除原死代码 `topic: content.brief_comment ? undefined : undefined`
    res.json({
      ...content,
      videoId: video.id,
      title: video.title,
      deepenCompleted: !!video.deepen_completed,
    });
  } catch (err) {
    const status = err.status || 500;
    logger.error(`[API] 获取加深理解失败: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/videos/:id/deepen/stream
 */
router.get('/:id/deepen/stream', async (req, res) => {
  res.setHeader('Content-Type', 'text/event-stream');
  res.setHeader('Cache-Control', 'no-cache');
  res.setHeader('Connection', 'keep-alive');
  res.setHeader('X-Accel-Buffering', 'no');
  res.flushHeaders?.();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const video = getVideoForDeepen(req.params.id, req.userId);
    send('thinking', { videoId: video.id, title: video.title });

    let content = getDeepen(req.params.id);
    if (!content) {
      content = await generateAndStoreDeepen(video, {
        stream: true,
        onChunk: (delta) => send('delta', { delta }),
      });
      content = getDeepen(req.params.id) || content;
    }

    send('comment', { brief_comment: content.brief_comment, comment_type: content.comment_type });
    send('corrections', content.corrections || []);
    send('supplements', content.supplements || []);
    send('structured', { sections: content.structured_content || [], keywords: content.keywords || [] });
    send('done', { videoId: video.id, title: video.title, deepenCompleted: !!video.deepen_completed });
  } catch (err) {
    const status = err.status || 500;
    logger.error(`[API] 流式加深理解失败: ${err.message}`);
    send('error', { message: err.message, status });
  } finally {
    res.end();
  }
});

/**
 * POST /api/videos/:id/deepen/feedback
 */
router.post('/:id/deepen/feedback', (req, res) => {
  try {
    getVideoForDeepen(req.params.id, req.userId);
    const { type, target, message } = req.body;
    recordFeedback(req.params.id, req.userId, { type, target, message });
    res.json({ ok: true });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/videos/:id/deepen/regenerate
 */
router.post('/:id/deepen/regenerate', async (req, res) => {
  try {
    const video = getVideoForDeepen(req.params.id, req.userId);
    deleteDeepen(req.params.id);
    const content = await generateAndStoreDeepen(video, { stream: false });
    res.json({ ...content, videoId: video.id, title: video.title, deepenCompleted: !!video.deepen_completed });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/videos/:id/deepen/complete
 */
router.post('/:id/deepen/complete', (req, res) => {
  try {
    const result = completeDeepen(req.params.id, req.userId);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/videos/:id/internalize/flashcards (M5 模态一)
 */
router.get('/:id/internalize/flashcards', async (req, res) => {
  try {
    getVideoForDeepen(req.params.id, req.userId);
    const result = await getOrCreateFlashcards(req.params.id);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/videos/:id/internalize/flashcards/complete (M5 模态一)
 */
router.post('/:id/internalize/flashcards/complete', (req, res) => {
  try {
    getVideoForDeepen(req.params.id, req.userId);
    const result = completeFlashcards(req.params.id, req.userId);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/videos/:id/internalize/freeform (M5 模态三)
 */
router.get('/:id/internalize/freeform', async (req, res) => {
  try {
    getVideoForDeepen(req.params.id, req.userId);
    const result = await getOrCreateFreeformQuestion(req.params.id, req.userId);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/videos/:id/internalize/freeform/evaluate (M5 模态三)
 */
router.post('/:id/internalize/freeform/evaluate', async (req, res) => {
  try {
    const { userInput } = req.body;
    if (!userInput || typeof userInput !== 'string') {
      return res.status(400).json({ error: '请提供回答内容' });
    }
    getVideoForDeepen(req.params.id, req.userId);
    const result = await evaluateFreeformAttempt(req.params.id, req.userId, userInput.trim());
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/videos/:id/migration
 */
router.get('/:id/migration', async (req, res) => {
  const video = db.prepare(`SELECT id FROM videos WHERE id = ? AND user_id = ?`).get(req.params.id, req.userId);
  if (!video) return res.status(404).json({ error: '视频不存在' });
  try {
    const scenario = await getOrCreateMigrationScenario(req.params.id, req.userId);
    res.json(scenario);
  } catch (err) {
    const status = err.status || 500;
    logger.error('[API]', `获取迁移场景失败: ${err.message}`);
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/videos/:id/migration/evaluate
 */
router.post('/:id/migration/evaluate', async (req, res) => {
  const { userInput } = req.body;
  if (!userInput || typeof userInput !== 'string') {
    return res.status(400).json({ error: '请提供迁移回答内容' });
  }
  const video = db.prepare(`SELECT id FROM videos WHERE id = ? AND user_id = ?`).get(req.params.id, req.userId);
  if (!video) return res.status(404).json({ error: '视频不存在' });
  try {
    const result = await evaluateMigrationAttempt(req.params.id, req.userId, userInput.trim());
    res.json(result);
  } catch (err) {
    logger.error('[API]', `评估迁移回答失败: ${err.message}`);
    res.status(500).json({ error: '评估失败', message: err.message });
  }
});

/**
 * POST /api/videos/:id/migration/skip
 */
router.post('/:id/migration/skip', (req, res) => {
  try {
    const result = skipMigration(req.params.id, req.userId);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * GET /api/videos/:id/progress (M4)
 * [BUG-07 修复] pipelineDone 原 `|| true` 恒真导致 migration 状态被忽略
 */
router.get('/:id/progress', (req, res) => {
  const video = db.prepare(`
    SELECT id, title, status, deepen_completed, migration_completed, freeform_completed, flashcard_completed
    FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);

  if (!video) return res.status(404).json({ error: '视频不存在' });

  const internalizeDone = db.prepare(`
    SELECT COUNT(*) as c FROM exercise_attempts WHERE video_id = ? AND user_id = ?
  `).get(req.params.id, req.userId)?.c > 0;

  const mainNode = db.prepare(`
    SELECT vn.node_id FROM video_nodes vn
    WHERE vn.video_id = ? AND vn.is_unclassified = 0
    ORDER BY vn.weight DESC LIMIT 1
  `).get(req.params.id);
  const archived = mainNode ? !!db.prepare(
    `SELECT 1 FROM srs_reviews WHERE user_id = ? AND node_id = ?`
  ).get(req.userId, mainNode.node_id) : false;

  res.json({
    videoId: video.id,
    title: video.title,
    status: video.status,
    stages: {
      deepen: { completed: !!video.deepen_completed, skippable: true },
      internalize: {
        completed: internalizeDone,
        flashcard: !!video.flashcard_completed,
        freeform: !!video.freeform_completed,
      },
      migration: { completed: !!video.migration_completed, skippable: true },
      archive: { completed: archived },
    },
    // [BUG-07 修复] 删除 `|| true`，migration 完成状态现在正确参与判定
    pipelineDone: !!video.deepen_completed && internalizeDone && !!video.migration_completed && archived,
  });
});

/**
 * POST /api/videos/:id/complete (M4)
 */
router.post('/:id/complete', (req, res) => {
  const video = db.prepare(`
    SELECT id, deepen_completed, migration_completed FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);
  if (!video) return res.status(404).json({ error: '视频不存在' });

  const nodes = db.prepare(`
    SELECT DISTINCT node_id FROM video_nodes WHERE video_id = ? AND is_unclassified = 0
  `).all(req.params.id);

  let archivedCount = 0;
  for (const n of nodes) {
    try {
      ensureCardArchived(req.userId, n.node_id);
      archivedCount++;
    } catch (e) {
      logger.warn(`[API] 归档节点 ${n.node_id} 失败: ${e.message}`);
    }
  }

  logger.info(`[API] 视频 ${req.params.id} 三阶段完结，归档 ${archivedCount} 个知识节点`);
  res.json({
    ok: true, videoId: req.params.id, archivedNodes: archivedCount,
    stages: { deepen: !!video.deepen_completed, migration: !!video.migration_completed },
    next: '/archive',
  });
});

export default router;

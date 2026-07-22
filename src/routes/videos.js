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

/**
 * GET /api/videos/:id/deepen
 * 获取加深理解内容（缓存优先，无则生成）
 */
router.get('/:id/deepen', async (req, res) => {
  try {
    const video = getVideoForDeepen(req.params.id, req.userId);

    // 缓存优先
    let content = getDeepen(req.params.id);
    if (!content) {
      content = await generateAndStoreDeepen(video, { stream: false });
      // 重新读取以带上 useful_count 等
      content = getDeepen(req.params.id) || content;
    }

    res.json({
      ...content,
      videoId: video.id,
      title: video.title,
      topic: content.brief_comment ? undefined : undefined, // topic 由前端从 video 详情取
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
 * SSE 流式推送加深理解内容
 * 事件序列: thinking → comment → corrections → supplements → structured → done
 */
router.get('/:id/deepen/stream', async (req, res) => {
  // SSE headers
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

    // 推送 thinking 事件（前端显示加载状态）
    send('thinking', { videoId: video.id, title: video.title });

    let content = getDeepen(req.params.id);
    if (!content) {
      // 无缓存：流式生成（onChunk 推送 delta 供前端显示进度）
      content = await generateAndStoreDeepen(video, {
        stream: true,
        onChunk: (delta) => {
          // 推送原始 delta（前端可显示"AI 正在打字..."）
          send('delta', { delta });
        },
      });
      content = getDeepen(req.params.id) || content;
    }

    // 按段落推送结构化内容（前端逐段渲染）
    send('comment', {
      brief_comment: content.brief_comment,
      comment_type: content.comment_type,
    });
    send('corrections', content.corrections || []);
    send('supplements', content.supplements || []);
    send('structured', {
      sections: content.structured_content || [],
      keywords: content.keywords || [],
    });
    send('done', {
      videoId: video.id,
      title: video.title,
      deepenCompleted: !!video.deepen_completed,
    });
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
 * 提交加深理解反馈
 * body: { type: "useful" | "question" | "correction_useful" | "correction_question", target?, message? }
 */
router.post('/:id/deepen/feedback', (req, res) => {
  try {
    getVideoForDeepen(req.params.id, req.userId); // 校验视频归属与状态
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
 * 清除缓存并重新生成加深理解内容
 */
router.post('/:id/deepen/regenerate', async (req, res) => {
  try {
    const video = getVideoForDeepen(req.params.id, req.userId);
    deleteDeepen(req.params.id);
    const content = await generateAndStoreDeepen(video, { stream: false });
    res.json({
      ...content,
      videoId: video.id,
      title: video.title,
      deepenCompleted: !!video.deepen_completed,
    });
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/videos/:id/deepen/complete
 * 标记加深理解完成并发放 XP（幂等：只发一次）
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
 * GET /api/videos/:id/internalize/flashcards  (M5 模态一)
 * 获取闪卡（无则自动生成并缓存）
 */
router.get('/:id/internalize/flashcards', async (req, res) => {
  try {
    getVideoForDeepen(req.params.id, req.userId); // 校验视频归属与状态
    const result = await getOrCreateFlashcards(req.params.id);
    res.json(result);
  } catch (err) {
    const status = err.status || 500;
    res.status(status).json({ error: err.message });
  }
});

/**
 * POST /api/videos/:id/internalize/flashcards/complete  (M5 模态一)
 * 标记闪卡回忆完成并发放 +10 XP（幂等）
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
 * GET /api/videos/:id/internalize/freeform  (M5 模态三)
 * 获取问答题（无则自动生成并缓存）
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
 * POST /api/videos/:id/internalize/freeform/evaluate  (M5 模态三)
 * 提交问答题答案，获取 AI 评估并发放 XP（幂等防刷）
 * body: { userInput: string }
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

/**
 * POST /api/videos/:id/migration/skip
 * 记录用户跳过迁移行为（用于留存漏斗分析）
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
 * GET /api/videos/:id/progress  (M4)
 * 获取三阶段学习进度（加深理解 / 内化 / 迁移 / 归档）
 */
router.get('/:id/progress', (req, res) => {
  const video = db.prepare(`
    SELECT id, title, status, deepen_completed, migration_completed, freeform_completed
    FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);

  if (!video) {
    return res.status(404).json({ error: '视频不存在' });
  }

  // 内化完成判定：该视频是否有 exercise_attempts 记录
  const internalizeDone = db.prepare(`
    SELECT COUNT(*) as c FROM exercise_attempts WHERE video_id = ? AND user_id = ?
  `).get(req.params.id, req.userId)?.c > 0;

  // 归档判定：主知识点是否有 srs_reviews 记录
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
      deepen: {
        completed: !!video.deepen_completed,
        skippable: true,
      },
      internalize: {
        completed: internalizeDone,
      },
      migration: {
        completed: !!video.migration_completed,
        skippable: true,
      },
      archive: {
        completed: archived,
      },
    },
    // 全流程是否走完（三阶段都完成或跳过 + 已归档）
    pipelineDone: !!video.deepen_completed && internalizeDone && (!!video.migration_completed || true) && archived,
  });
});

/**
 * POST /api/videos/:id/complete  (M4)
 * 三阶段流程完结：确保相关知识节点归档到卡片
 * 前端在迁移完成（或跳过）后调用，触发自动归档
 */
router.post('/:id/complete', (req, res) => {
  const video = db.prepare(`
    SELECT id, deepen_completed, migration_completed FROM videos WHERE id = ? AND user_id = ?
  `).get(req.params.id, req.userId);

  if (!video) {
    return res.status(404).json({ error: '视频不存在' });
  }

  // 获取该视频涉及的所有已分类知识节点，确保全部归档（初始化 SRS）
  const nodes = db.prepare(`
    SELECT DISTINCT node_id FROM video_nodes
    WHERE video_id = ? AND is_unclassified = 0
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
    ok: true,
    videoId: req.params.id,
    archivedNodes: archivedCount,
    stages: {
      deepen: !!video.deepen_completed,
      migration: !!video.migration_completed,
    },
    next: '/archive',  // 提示前端跳转到归档页
  });
});

export default router;

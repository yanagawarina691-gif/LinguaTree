import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { runPipeline, processExerciseCompletion } from '../services/pipeline.js';
import {
  getVideoForDeepen,
  getPrimaryNode,
  getDeepen,
  generateAndStoreDeepen,
  deleteDeepen,
  recordFeedback,
  completeDeepen,
} from '../services/deepenService.js';
import { extractBriefCommentFromPartial } from '../services/llmService.js';
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

/* ============================================================
 * v2 阶段一：加深理解（Deepen Understanding）
 * ========================================================== */

/**
 * GET /api/videos/:id/deepen
 * 获取加深理解内容（缓存优先；未生成则同步生成，适合非流式场景）
 */
router.get('/:id/deepen', async (req, res) => {
  try {
    const video = getVideoForDeepen(req.params.id, req.userId);
    const primary = getPrimaryNode(video.id);

    let deepen = getDeepen(video.id);
    let cached = true;
    if (!deepen) {
      deepen = await generateAndStoreDeepen(video);
      cached = false;
    }

    res.json({
      videoId: video.id,
      title: video.title,
      topic: primary.name,
      deepenCompleted: !!video.deepen_completed,
      cached,
      deepen,
    });
  } catch (err) {
    logger.error(`[API] deepen 获取失败: ${err.message}`);
    res.status(err.status || 500).json({ error: err.message || '加深理解内容生成失败' });
  }
});

/**
 * GET /api/videos/:id/deepen/stream
 * SSE 流式推送加深理解内容
 * 事件序列: comment → corrections → supplements → structured → done
 * （corrections 为空数组时前端省略整段展示）
 */
router.get('/:id/deepen/stream', async (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream; charset=utf-8',
    'Cache-Control': 'no-cache, no-transform',
    'Connection': 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  let aborted = false;
  req.on('close', () => { aborted = true; });

  const send = (event, data) => {
    if (aborted) return;
    res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
  };

  try {
    const video = getVideoForDeepen(req.params.id, req.userId);
    const primary = getPrimaryNode(video.id);

    let deepen = getDeepen(video.id);

    if (deepen) {
      // 缓存命中：按序快速重放各段事件
      send('comment', { brief_comment: deepen.brief_comment, comment_type: deepen.comment_type });
    } else {
      // 未缓存：流式调用 LLM，brief_comment 就绪即早报
      let commentSent = false;
      deepen = await generateAndStoreDeepen(video, {
        stream: true,
        onChunk: (_delta, accumulated) => {
          if (commentSent || aborted) return;
          const partial = extractBriefCommentFromPartial(accumulated);
          if (partial && partial.brief_comment) {
            commentSent = true;
            send('comment', partial);
          }
        },
      });
      if (!commentSent) {
        send('comment', { brief_comment: deepen.brief_comment, comment_type: deepen.comment_type });
      }
    }

    send('corrections', { items: deepen.corrections });
    send('supplements', { items: deepen.supplements });
    send('structured', { sections: deepen.structured_content, keywords: deepen.keywords });
    send('done', {
      videoId: video.id,
      title: video.title,
      topic: primary.name,
      deepenCompleted: !!video.deepen_completed,
      deepen,
    });
    res.end();
  } catch (err) {
    logger.error(`[API] deepen 流式生成失败: ${err.message}`);
    send('error', { error: err.message || '加深理解内容生成失败' });
    res.end();
  }
});

/**
 * POST /api/videos/:id/deepen/feedback
 * 提交加深理解反馈
 * body: { type: 'useful'|'question'|'correction_useful'|'correction_question', target?, message? }
 */
router.post('/:id/deepen/feedback', (req, res) => {
  try {
    getVideoForDeepen(req.params.id, req.userId);
    recordFeedback(req.params.id, req.userId, req.body || {});
    res.json({ ok: true });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '反馈提交失败' });
  }
});

/**
 * POST /api/videos/:id/deepen/regenerate
 * 清除缓存的加深理解内容（之后重新拉取/stream 即重新生成）
 */
router.post('/:id/deepen/regenerate', (req, res) => {
  try {
    getVideoForDeepen(req.params.id, req.userId);
    deleteDeepen(req.params.id);
    res.json({ ok: true, message: '已清除缓存，重新拉取将重新生成' });
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '操作失败' });
  }
});

/**
 * POST /api/videos/:id/deepen/complete
 * 标记加深理解完成（滚动到底/开始练习触发），发放 +10 XP（幂等）
 */
router.post('/:id/deepen/complete', (req, res) => {
  try {
    const result = completeDeepen(req.params.id, req.userId);
    res.json(result);
  } catch (err) {
    res.status(err.status || 500).json({ error: err.message || '操作失败' });
  }
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

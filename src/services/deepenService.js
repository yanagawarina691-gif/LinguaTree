import db from '../db/index.js';
import { generateDeepenContent, generateDeepenContentStream } from './llmService.js';
import { addNodeXP } from './treeService.js';
import { logger } from '../utils/logger.js';

/** 加深理解阶段完成奖励 XP（PRD v2 §6.1.4） */
export const DEEPEN_XP = 10;

/**
 * 取视频信息，校验归属与解析状态
 */
export function getVideoForDeepen(videoId, userId) {
  const video = db.prepare(`
    SELECT * FROM videos WHERE id = ? AND user_id = ?
  `).get(videoId, userId);
  if (!video) {
    const err = new Error('视频不存在');
    err.status = 404;
    throw err;
  }
  if (video.status !== 'done') {
    const err = new Error(`视频还在解析中（${video.status}），完成后再来看加深理解`);
    err.status = 409;
    throw err;
  }
  return video;
}

/**
 * 视频主知识点（weight 最高的已分类节点），无则回退 unclassified
 */
export function getPrimaryNode(videoId) {
  const row = db.prepare(`
    SELECT vn.node_id, kn.name
    FROM video_nodes vn
    LEFT JOIN knowledge_nodes kn ON kn.node_id = vn.node_id
    WHERE vn.video_id = ? AND vn.is_unclassified = 0
    ORDER BY vn.weight DESC, vn.confidence DESC
    LIMIT 1
  `).get(videoId);
  return row || { node_id: 'unclassified', name: '未分类知识点' };
}

/**
 * 组装 LLM 生成所需的 knowledge 上下文
 */
function buildKnowledgeContext(video) {
  const nodes = db.prepare(`
    SELECT vn.node_id, vn.weight, kn.name
    FROM video_nodes vn
    LEFT JOIN knowledge_nodes kn ON kn.node_id = vn.node_id
    WHERE vn.video_id = ? AND vn.is_unclassified = 0
    ORDER BY vn.weight DESC
  `).all(video.id);

  // topic 优先取权重最高节点名；否则退化为摘要前 20 字
  const topic = nodes[0]?.name || (video.summary || '').slice(0, 20) || video.title || '英语知识点';
  return { topic, nodes };
}

/**
 * 读取缓存的加深理解内容（含视频完成状态）
 */
export function getDeepen(videoId) {
  const row = db.prepare(`
    SELECT * FROM deepen_understanding WHERE video_id = ?
  `).get(videoId);
  if (!row) return null;
  return {
    node_id: row.node_id,
    brief_comment: row.brief_comment,
    comment_type: row.comment_type,
    corrections: JSON.parse(row.corrections || '[]'),
    supplements: JSON.parse(row.supplements || '[]'),
    structured_content: JSON.parse(row.structured_content || '[]'),
    keywords: JSON.parse(row.keywords || '[]'),
    useful_count: row.useful_count || 0,
    created_at: row.created_at,
  };
}

/**
 * 生成并落库加深理解内容
 * @param {Object} video - videos 表行
 * @param {Object} [options]
 * @param {boolean} [options.stream] - 是否流式调用 LLM
 * @param {(delta: string, accumulated: string) => void} [options.onChunk]
 */
export async function generateAndStoreDeepen(video, { stream = false, onChunk } = {}) {
  const knowledge = buildKnowledgeContext(video);
  const primary = getPrimaryNode(video.id);

  const genFn = stream ? generateDeepenContentStream : generateDeepenContent;
  const result = await genFn(video, knowledge, onChunk);

  // UPSERT（video_id UNIQUE）：重新生成时覆盖旧内容
  db.prepare(`
    INSERT INTO deepen_understanding
      (video_id, node_id, brief_comment, comment_type, corrections, supplements, structured_content, keywords)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(video_id) DO UPDATE SET
      node_id = excluded.node_id,
      brief_comment = excluded.brief_comment,
      comment_type = excluded.comment_type,
      corrections = excluded.corrections,
      supplements = excluded.supplements,
      structured_content = excluded.structured_content,
      keywords = excluded.keywords,
      created_at = datetime('now')
  `).run(
    video.id,
    primary.node_id,
    result.brief_comment,
    result.comment_type,
    JSON.stringify(result.corrections),
    JSON.stringify(result.supplements),
    JSON.stringify(result.structured_content),
    JSON.stringify(result.keywords),
  );

  logger.info(`[Deepen] 视频 ${video.id} 加深理解内容已生成并存储`);
  return result;
}

/**
 * 删除缓存（重新生成用）
 */
export function deleteDeepen(videoId) {
  db.prepare(`DELETE FROM deepen_understanding WHERE video_id = ?`).run(videoId);
}

/**
 * 记录反馈；useful 类型同步累加计数
 */
export function recordFeedback(videoId, userId, { type, target = '', message = '' }) {
  const allowed = ['useful', 'question', 'correction_useful', 'correction_question'];
  if (!allowed.includes(type)) {
    const err = new Error(`不支持的反馈类型: ${type}`);
    err.status = 400;
    throw err;
  }

  db.prepare(`
    INSERT INTO deepen_feedback (video_id, user_id, feedback_type, target, message)
    VALUES (?, ?, ?, ?, ?)
  `).run(videoId, userId, type, String(target).slice(0, 500), String(message).slice(0, 1000));

  if (type === 'useful') {
    db.prepare(`
      UPDATE deepen_understanding SET useful_count = useful_count + 1 WHERE video_id = ?
    `).run(videoId);
  }

  logger.info(`[Deepen] 用户 ${userId} 对视频 ${videoId} 反馈: ${type}`);
}

/**
 * 标记加深理解完成并发放 XP（幂等：只发一次）
 * XP 归属视频主知识点节点
 * @returns {{ alreadyCompleted: boolean, xpGained: number, treeUpdate?: Object }}
 */
export function completeDeepen(videoId, userId) {
  const video = getVideoForDeepen(videoId, userId);

  if (video.deepen_completed) {
    return { alreadyCompleted: true, xpGained: 0 };
  }

  const primary = getPrimaryNode(videoId);
  let treeUpdate = null;
  let xpGained = 0;

  if (primary.node_id !== 'unclassified') {
    const r = addNodeXP(userId, primary.node_id, DEEPEN_XP);
    xpGained = r.xpGain;
    treeUpdate = {
      node_id: primary.node_id,
      node_name: primary.name,
      xp: r.xp,
      oldLevel: r.oldLevel,
      newLevel: r.newLevel,
      leveledUp: r.leveledUp,
    };
  }

  db.prepare(`
    UPDATE videos SET deepen_completed = 1, updated_at = datetime('now') WHERE id = ?
  `).run(videoId);

  logger.info(`[Deepen] 用户 ${userId} 完成视频 ${videoId} 加深理解, +${xpGained} XP → ${primary.node_id}`);
  return { alreadyCompleted: false, xpGained, treeUpdate };
}

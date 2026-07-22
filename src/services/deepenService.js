import db from '../db/index.js';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';
import { generateDeepenUnderstanding } from './llmService.js';
import { addNodeXP } from './treeService.js';

/**
 * 获取视频的主知识点节点（weight 最高，不含 unclassified）
 * @param {string} videoId
 * @returns {Object|null} - { node_id, node_name, weight }
 */
function getMainNodeForVideo(videoId) {
  return db.prepare(`
    SELECT vn.node_id, vn.weight, kn.name as node_name, kn.definition
    FROM video_nodes vn
    JOIN knowledge_nodes kn ON kn.node_id = vn.node_id
    WHERE vn.video_id = ? AND vn.is_unclassified = 0
    ORDER BY vn.weight DESC, vn.confidence DESC
    LIMIT 1
  `).get(videoId);
}

/**
 * 获取视频所有映射节点（用于 Prompt 注入）
 * @param {string} videoId
 * @returns {Array}
 */
function getMappedNodesForVideo(videoId) {
  return db.prepare(`
    SELECT vn.node_id, vn.weight, vn.confidence, kn.name, kn.definition
    FROM video_nodes vn
    JOIN knowledge_nodes kn ON kn.node_id = vn.node_id
    WHERE vn.video_id = ? AND vn.is_unclassified = 0
    ORDER BY vn.weight DESC, vn.confidence DESC
  `).all(videoId);
}

/**
 * 解析 JSON 字段，失败返回默认值
 */
function safeParse(jsonStr, defaultValue) {
  try {
    return JSON.parse(jsonStr || JSON.stringify(defaultValue));
  } catch (e) {
    return defaultValue;
  }
}

/**
 * 获取或生成加深理解内容
 * @param {string} videoId
 * @param {string} userId
 * @returns {Object}
 */
export async function getOrCreateDeepenUnderstanding(videoId, userId) {
  // 1. 检查缓存
  const existing = db.prepare(`
    SELECT * FROM deepen_understanding WHERE video_id = ?
  `).get(videoId);

  if (existing) {
    return {
      id: existing.id,
      video_id: existing.video_id,
      node_id: existing.node_id,
      brief_comment: existing.brief_comment,
      comment_type: existing.comment_type,
      corrections: safeParse(existing.corrections, []),
      supplements: safeParse(existing.supplements, []),
      structured_content: safeParse(existing.structured_content, []),
    };
  }

  // 2. 校验视频归属
  const video = db.prepare(`
    SELECT id, title, author, asr_text, ocr_text, summary
    FROM videos WHERE id = ? AND user_id = ?
  `).get(videoId, userId);

  if (!video) {
    throw new Error('视频不存在');
  }

  // 3. 准备节点数据
  const mappedNodes = getMappedNodesForVideo(videoId);
  const mainNode = mappedNodes[0] || { node_id: 'unclassified', name: '未分类知识点' };

  // 4. 调用 LLM
  const content = await generateDeepenUnderstanding(
    {
      title: video.title,
      author: video.author,
      asr_text: video.asr_text,
      ocr_text: video.ocr_text,
      summary: video.summary,
    },
    mappedNodes
  );

  // 5. 持久化
  const id = nanoid(12);
  db.prepare(`
    INSERT INTO deepen_understanding
      (id, video_id, node_id, brief_comment, comment_type, corrections, supplements, structured_content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    id,
    videoId,
    mainNode.node_id,
    content.brief_comment || '',
    content.comment_type || '',
    JSON.stringify(content.corrections || []),
    JSON.stringify(content.supplements || []),
    JSON.stringify(content.structured_content || [])
  );

  logger.info('[Deepen]', `视频 ${videoId} 生成加深理解内容: ${content.brief_comment.slice(0, 20)}...`);

  return {
    id,
    video_id: videoId,
    node_id: mainNode.node_id,
    ...content,
  };
}

/**
 * 标记加深理解完成（或跳过）
 * @param {string} videoId
 * @param {string} userId
 * @param {boolean} skipped
 * @returns {Object}
 */
export function markDeepenCompleted(videoId, userId, skipped = false) {
  const video = db.prepare(`
    SELECT id FROM videos WHERE id = ? AND user_id = ?
  `).get(videoId, userId);

  if (!video) {
    throw new Error('视频不存在');
  }

  const mainNode = getMainNodeForVideo(videoId);
  let xpGained = 0;
  let treeUpdate = null;

  if (!skipped && mainNode && mainNode.node_id !== 'unclassified') {
    xpGained = 10;
    treeUpdate = addNodeXP(userId, mainNode.node_id, xpGained, 'deepen');
  }

  db.prepare(`
    UPDATE videos
    SET deepen_completed = 1, updated_at = datetime('now')
    WHERE id = ?
  `).run(videoId);

  return {
    completed: true,
    skipped: !!skipped,
    xpGained,
    treeUpdate: treeUpdate
      ? {
          node_id: mainNode.node_id,
          node_name: mainNode.node_name,
          xpGain: xpGained,
          oldLevel: treeUpdate.oldLevel,
          newLevel: treeUpdate.newLevel,
          leveledUp: treeUpdate.leveledUp,
          totalXp: treeUpdate.xp,
        }
      : null,
  };
}

/**
 * 记录加深理解反馈
 * @param {string} videoId
 * @param {string} userId
 * @param {string} feedbackType - 'useful' | 'confused'
 * @param {number} itemIndex - 对应项索引，-1 表示整体
 */
export function recordDeepenFeedback(videoId, userId, feedbackType, itemIndex = -1) {
  if (!['useful', 'confused'].includes(feedbackType)) {
    throw new Error('反馈类型无效，仅支持 useful/confused');
  }

  const video = db.prepare(`
    SELECT id FROM videos WHERE id = ? AND user_id = ?
  `).get(videoId, userId);

  if (!video) {
    throw new Error('视频不存在');
  }

  db.prepare(`
    INSERT INTO deepen_feedback (id, video_id, user_id, feedback_type, item_index)
    VALUES (?, ?, ?, ?, ?)
  `).run(nanoid(12), videoId, userId, feedbackType, itemIndex);

  logger.info('[Deepen]', `用户 ${userId} 对视频 ${videoId} 反馈: ${feedbackType}`);

  return { recorded: true };
}

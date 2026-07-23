import db from '../db/index.js';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';
import { generateDeepenUnderstanding } from './llmService.js';
import { addOreXP } from './treeService.js';

function getMainNodeForVideo(videoId) {
  return db.prepare(`
    SELECT vo.ore_id, vo.confidence, o.name as node_name, o.description
    FROM video_ores vo
    JOIN ore_nodes o ON o.id = vo.ore_id
    WHERE vo.video_id = ?
    ORDER BY vo.confidence DESC
    LIMIT 1
  `).get(videoId);
}

function getMappedNodesForVideo(videoId) {
  return db.prepare(`
    SELECT vo.ore_id, vo.confidence, o.name, o.description
    FROM video_ores vo
    JOIN ore_nodes o ON o.id = vo.ore_id
    WHERE vo.video_id = ?
    ORDER BY vo.confidence DESC
  `).all(videoId);
}

function safeParse(jsonStr, defaultValue) {
  try { return JSON.parse(jsonStr || JSON.stringify(defaultValue)); }
  catch { return defaultValue; }
}

export async function getOrCreateDeepenUnderstanding(videoId, userId) {
  const existing = db.prepare('SELECT * FROM deepen_understanding WHERE video_id = ?').get(videoId);
  if (existing) {
    return {
      id: existing.id, video_id: existing.video_id, ore_id: existing.ore_id,
      brief_comment: existing.brief_comment, comment_type: existing.comment_type,
      corrections: safeParse(existing.corrections, []),
      supplements: safeParse(existing.supplements, []),
      structured_content: safeParse(existing.structured_content, []),
    };
  }

  const video = db.prepare('SELECT id, title, author, asr_text, ocr_text, summary FROM videos WHERE id = ? AND user_id = ?').get(videoId, userId);
  if (!video) throw new Error('视频不存在');

  const mappedNodes = getMappedNodesForVideo(videoId);

  // 兜底：如果视频没有映射到任何矿石，基于视频内容自动创建一个
  let mainOreId;
  if (mappedNodes.length > 0) {
    mainOreId = mappedNodes[0].ore_id;
  } else {
    // 从视频摘要/title生成一个合理的矿石名称
    const rawName = video.title || video.summary || '英语知识点';
    const cleanName = rawName.replace(/视频标题及文字稿提示内容聚焦于[「『]*|[」』]*，.*$/g, '')
      .replace(/[，,。\.\n].*$/, '').trim().slice(0, 20) || '英语知识点';
    const mainNode = { name: cleanName };
    const existing = db.prepare('SELECT id FROM ore_nodes WHERE name = ?').get(mainNode.name);
    if (existing) {
      mainOreId = existing.id;
    } else {
      const result = db.prepare('INSERT INTO ore_nodes (name, description, tags, color, created_from_video_id) VALUES (?, ?, ?, ?, ?)').run(
        mainNode.name, video.summary || '', '[]', '#58CC02', videoId
      );
      mainOreId = result.lastInsertRowid;
    }
    // 确保有 video_ores 映射
    db.prepare('INSERT OR IGNORE INTO video_ores (video_id, ore_id, confidence) VALUES (?, ?, ?)').run(videoId, mainOreId, 0.5);
    mappedNodes.push({ ore_id: mainOreId, name: mainNode.name, description: video.summary || '' });
  }

  const content = await generateDeepenUnderstanding(
    { title: video.title, author: video.author, asr_text: video.asr_text, ocr_text: video.ocr_text, summary: video.summary },
    mappedNodes
  );

  const id = nanoid(12);
  db.prepare(`
    INSERT INTO deepen_understanding (id, video_id, ore_id, brief_comment, comment_type, corrections, supplements, structured_content)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(id, videoId, mainOreId, content.brief_comment || '', content.comment_type || '',
    JSON.stringify(content.corrections || []), JSON.stringify(content.supplements || []),
    JSON.stringify(content.structured_content || []));

  logger.info('[Deepen]', `视频 ${videoId} 生成加深理解: ${(content.brief_comment || '').slice(0, 20)}`);

  return { id, video_id: videoId, ore_id: mainOreId, ...content };
}

export function markDeepenCompleted(videoId, userId, skipped = false) {
  const video = db.prepare('SELECT id FROM videos WHERE id = ? AND user_id = ?').get(videoId, userId);
  if (!video) throw new Error('视频不存在');

  const mainNode = getMainNodeForVideo(videoId);
  let xpGained = 0, treeUpdate = null;

  if (!skipped && mainNode && mainNode.ore_id) {
    xpGained = 10;
    treeUpdate = addOreXP(userId, mainNode.ore_id, xpGained, 'deepen');
  }

  db.prepare("UPDATE videos SET deepen_completed = 1, updated_at = datetime('now') WHERE id = ?").run(videoId);

  return {
    completed: true, skipped: !!skipped, xpGained,
    treeUpdate: treeUpdate ? {
      ore_id: mainNode.ore_id, node_name: mainNode.node_name, xpGain: xpGained,
      oldLevel: treeUpdate.oldLevel, newLevel: treeUpdate.newLevel,
      leveledUp: treeUpdate.leveledUp, totalXp: treeUpdate.xp,
    } : null,
  };
}

export function recordDeepenFeedback(videoId, userId, feedbackType, itemIndex = -1) {
  if (!['useful', 'confused'].includes(feedbackType)) throw new Error('反馈类型无效');
  const video = db.prepare('SELECT id FROM videos WHERE id = ? AND user_id = ?').get(videoId, userId);
  if (!video) throw new Error('视频不存在');

  db.prepare('INSERT INTO deepen_feedback (id, video_id, user_id, feedback_type, item_index) VALUES (?, ?, ?, ?, ?)')
    .run(nanoid(12), videoId, userId, feedbackType, itemIndex);

  logger.info('[Deepen]', `用户 ${userId} 对视频 ${videoId} 反馈: ${feedbackType}`);
  return { recorded: true };
}

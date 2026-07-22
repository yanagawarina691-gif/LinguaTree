import db from '../db/index.js';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';
import { generateFlashcards, generateFreeformQuestion, evaluateFreeform } from './llmService.js';
import { addNodeXP } from './treeService.js';
import { getPrimaryNode } from './deepenService.js';

/** 闪卡完成奖励 XP（PRD §6.2 P1-1） */
export const FLASHCARD_XP = 10;
/** 问答题完成基础 XP */
export const FREEFORM_XP_BASE = 20;
/** 问答题≥80分额外 XP */
export const FREEFORM_XP_BONUS = 10;

/**
 * 获取视频主知识点（复用 deepenService 的 getPrimaryNode）
 */
function getMainNode(videoId) {
  return getPrimaryNode(videoId);
}

/**
 * 从加深理解内容中提取可读摘要（供闪卡生成 LLM 使用）
 * [BUG-03 修复] 原实现直接对 JSON 字符串 .slice(0,500)，传入截断 JSON
 * 现改为解析 JSON 后拼接各章节文本
 */
function buildDeepenSummary(deepenRow) {
  if (!deepenRow) return '';
  const parts = [];
  if (deepenRow.brief_comment) parts.push(deepenRow.brief_comment);
  try {
    const sections = JSON.parse(deepenRow.structured_content || '[]');
    if (Array.isArray(sections)) {
      for (const s of sections) {
        if (s.section && s.content) parts.push(`${s.section}: ${s.content}`);
      }
    }
  } catch { /* JSON 解析失败则忽略结构化内容 */ }
  return parts.join('\n').slice(0, 500);
}

/**
 * 获取或创建视频的闪卡（缓存优先）
 * @param {string} videoId
 * @returns {Object} - { cards, node_id, node_name }
 */
export async function getOrCreateFlashcards(videoId) {
  const cached = db.prepare(`SELECT * FROM flashcards WHERE video_id = ?`).get(videoId);
  if (cached) {
    logger.info(`[Flashcard] 视频 ${videoId} 已有闪卡缓存，直接返回`);
    return {
      cards: JSON.parse(cached.cards || '[]'),
      node_id: cached.node_id,
      node_name: db.prepare(`SELECT name FROM knowledge_nodes WHERE node_id = ?`).get(cached.node_id)?.name || '',
    };
  }

  const primary = getMainNode(videoId);
  if (!primary || primary.node_id === 'unclassified') {
    throw new Error('视频未关联知识节点，无法生成闪卡');
  }

  // [BUG-03 修复] 提取可读摘要而非截断 JSON
  const deepen = db.prepare(`SELECT brief_comment, structured_content FROM deepen_understanding WHERE video_id = ?`).get(videoId);
  const deepenSummary = buildDeepenSummary(deepen);

  const cards = await generateFlashcards(primary.name, deepenSummary);

  db.prepare(`
    INSERT OR REPLACE INTO flashcards (video_id, node_id, cards)
    VALUES (?, ?, ?)
  `).run(videoId, primary.node_id, JSON.stringify(cards));

  logger.info(`[Flashcard] 视频 ${videoId} 生成 ${cards.length} 张闪卡`);
  return { cards, node_id: primary.node_id, node_name: primary.name };
}

/**
 * 标记闪卡回忆完成并发放 XP（幂等：基于 videos.flashcard_completed 字段）
 * [BUG-04 修复] 原实现用 parse_logs + LIKE 做幂等（反模式+脆弱）
 * 现改用 videos.flashcard_completed 字段，与 freeform_completed/migration_completed 对齐
 * @returns {{ xpGained, treeUpdate, alreadyCompleted }}
 */
export function completeFlashcards(videoId, userId) {
  const video = db.prepare(`SELECT flashcard_completed FROM videos WHERE id = ?`).get(videoId);
  if (!video) throw new Error('视频不存在');

  // 幂等：已发放过则不再发
  if (video.flashcard_completed) {
    return { alreadyCompleted: true, xpGained: 0 };
  }

  const primary = getMainNode(videoId);
  if (!primary || primary.node_id === 'unclassified') {
    return { alreadyCompleted: false, xpGained: 0 };
  }

  const r = addNodeXP(userId, primary.node_id, FLASHCARD_XP);

  // 标记完成（幂等关键字段）
  db.prepare(`UPDATE videos SET flashcard_completed = 1, updated_at = datetime('now') WHERE id = ?`).run(videoId);

  logger.info(`[Flashcard] 用户 ${userId} 完成视频 ${videoId} 闪卡回忆, +${FLASHCARD_XP} XP → ${primary.node_id}`);
  return {
    alreadyCompleted: false,
    xpGained: FLASHCARD_XP,
    treeUpdate: {
      node_id: primary.node_id,
      node_name: primary.name,
      xp: r.xp,
      oldLevel: r.oldLevel,
      newLevel: r.newLevel,
      leveledUp: r.leveledUp,
    },
  };
}

/**
 * 获取或创建视频的问答题（缓存优先）
 */
export async function getOrCreateFreeformQuestion(videoId, userId) {
  const cached = db.prepare(`SELECT * FROM freeform_questions WHERE video_id = ?`).get(videoId);
  if (cached) {
    logger.info(`[Freeform] 视频 ${videoId} 已有问答题缓存，直接返回`);
    return {
      question: cached.question,
      target_knowledge: cached.target_knowledge,
      evaluation_criteria: JSON.parse(cached.evaluation_criteria || '[]'),
      reference_answers: JSON.parse(cached.reference_answers || '[]'),
      difficulty: cached.difficulty,
      node_id: cached.node_id,
    };
  }

  const primary = getMainNode(videoId);
  if (!primary || primary.node_id === 'unclassified') {
    throw new Error('视频未关联知识节点，无法生成问答题');
  }

  const accuracy = getExerciseAccuracy(userId, videoId);
  const q = await generateFreeformQuestion(primary.name, primary.node_id, accuracy);

  db.prepare(`
    INSERT OR REPLACE INTO freeform_questions
      (video_id, node_id, question, target_knowledge, evaluation_criteria, reference_answers, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    videoId, primary.node_id,
    q.question, q.target_knowledge,
    JSON.stringify(q.evaluation_criteria),
    JSON.stringify(q.reference_answers),
    q.difficulty
  );

  logger.info(`[Freeform] 视频 ${videoId} 生成问答题`);
  return { ...q, node_id: primary.node_id };
}

/**
 * 评估问答题回答并发放 XP（幂等：每个视频只发一次 XP）
 */
export async function evaluateFreeformAttempt(videoId, userId, userInput) {
  const video = db.prepare(`SELECT freeform_completed FROM videos WHERE id = ?`).get(videoId);
  if (!video) throw new Error('视频不存在');

  const qRow = db.prepare(`SELECT * FROM freeform_questions WHERE video_id = ?`).get(videoId);
  if (!qRow) throw new Error('问答题不存在，请先获取题目');

  const question = {
    question: qRow.question,
    target_knowledge: qRow.target_knowledge,
    evaluation_criteria: JSON.parse(qRow.evaluation_criteria || '[]'),
    reference_answers: JSON.parse(qRow.reference_answers || '[]'),
  };

  const evaluation = await evaluateFreeform(qRow.target_knowledge, question, userInput);

  const alreadyCompleted = !!video.freeform_completed;

  let xpEarned = FREEFORM_XP_BASE;
  if (evaluation.overall_score >= 80) xpEarned += FREEFORM_XP_BONUS;
  const xpGained = alreadyCompleted ? 0 : xpEarned;

  db.prepare(`
    INSERT INTO freeform_attempts
      (id, video_id, user_id, node_id, user_input, ai_evaluation, accuracy_score, overall_score, xp_gained)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    nanoid(12), videoId, userId, qRow.node_id,
    userInput, JSON.stringify(evaluation),
    evaluation.accuracy, evaluation.overall_score, xpGained
  );

  let treeUpdate = null;
  if (!alreadyCompleted) {
    const r = addNodeXP(userId, qRow.node_id, xpGained);
    treeUpdate = {
      node_id: qRow.node_id,
      node_name: db.prepare(`SELECT name FROM knowledge_nodes WHERE node_id = ?`).get(qRow.node_id)?.name || '',
      xpGain: xpGained,
      oldLevel: r.oldLevel,
      newLevel: r.newLevel,
      leveledUp: r.leveledUp,
      totalXp: r.xp,
    };

    db.prepare(`UPDATE videos SET freeform_completed = 1, updated_at = datetime('now') WHERE id = ?`).run(videoId);
    logger.info(`[Freeform] 用户 ${userId} 首次完成视频 ${videoId} 问答题: score=${evaluation.overall_score}, xp=+${xpGained}`);
  } else {
    logger.info(`[Freeform] 用户 ${userId} 重复提交视频 ${videoId} 问答题（不发XP）: score=${evaluation.overall_score}`);
  }

  return { evaluation, xpGained, alreadyCompleted, xpEarned, treeUpdate };
}

/**
 * 获取用户在该视频内化环节的正确率
 */
function getExerciseAccuracy(userId, videoId) {
  const stats = db.prepare(`
    SELECT COUNT(*) as total,
           SUM(CASE WHEN is_correct = 1 AND is_skipped = 0 THEN 1 ELSE 0 END) as correct
    FROM exercise_attempts WHERE user_id = ? AND video_id = ?
  `).get(userId, videoId);
  if (!stats || !stats.total) return null;
  return Math.round((stats.correct / stats.total) * 100);
}

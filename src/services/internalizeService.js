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
 * 获取或创建视频的闪卡（缓存优先）
 * @param {string} videoId
 * @returns {Object} - { cards, node_id, node_name }
 */
export async function getOrCreateFlashcards(videoId) {
  // 1. 查缓存
  const cached = db.prepare(`SELECT * FROM flashcards WHERE video_id = ?`).get(videoId);
  if (cached) {
    logger.info(`[Flashcard] 视频 ${videoId} 已有闪卡缓存，直接返回`);
    return {
      cards: JSON.parse(cached.cards || '[]'),
      node_id: cached.node_id,
      node_name: db.prepare(`SELECT name FROM knowledge_nodes WHERE node_id = ?`).get(cached.node_id)?.name || '',
    };
  }

  // 2. 获取主知识点
  const primary = getMainNode(videoId);
  if (!primary || primary.node_id === 'unclassified') {
    throw new Error('视频未关联知识节点，无法生成闪卡');
  }

  // 3. 获取加深理解内容作为上下文
  const deepen = db.prepare(`SELECT structured_content, supplements FROM deepen_understanding WHERE video_id = ?`).get(videoId);
  const deepenSummary = deepen ? (deepen.structured_content || '').slice(0, 500) : '';

  // 4. 调用 LLM 生成
  const cards = await generateFlashcards(primary.name, deepenSummary);

  // 5. 缓存
  db.prepare(`
    INSERT OR REPLACE INTO flashcards (video_id, node_id, cards)
    VALUES (?, ?, ?)
  `).run(videoId, primary.node_id, JSON.stringify(cards));

  logger.info(`[Flashcard] 视频 ${videoId} 生成 ${cards.length} 张闪卡`);
  return { cards, node_id: primary.node_id, node_name: primary.name };
}

/**
 * 标记闪卡回忆完成并发放 XP（幂等：用 freeform_completed 之外的方式追踪）
 * 由于闪卡是"回忆"环节，PRD 未要求严格幂等，但为防刷分，用 parse_logs 记录
 * @returns {{ xpGained, treeUpdate, alreadyCompleted }}
 */
export function completeFlashcards(videoId, userId) {
  // 检查是否已发放过闪卡 XP（通过 parse_logs 查 flashcard_complete 记录）
  const already = db.prepare(`
    SELECT 1 FROM parse_logs WHERE video_id = ? AND stage = 'flashcard' AND status = 'completed' AND message LIKE ?
  `).get(videoId, `%user:${userId}%`);

  if (already) {
    return { alreadyCompleted: true, xpGained: 0 };
  }

  const primary = getMainNode(videoId);
  if (!primary || primary.node_id === 'unclassified') {
    return { alreadyCompleted: false, xpGained: 0 };
  }

  const r = addNodeXP(userId, primary.node_id, FLASHCARD_XP);

  // 记录完成（幂等标记）
  db.prepare(`
    INSERT INTO parse_logs (video_id, stage, status, message)
    VALUES (?, 'flashcard', 'completed', ?)
  `).run(videoId, `闪卡回忆完成 user:${userId} +${FLASHCARD_XP}XP`);

  logger.info(`[Flashcard] 用户 ${userId} 完成视频 ${videoId} 闪卡回忆, +${FLASHCARD_XP} XP`);
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
 * @param {string} videoId
 * @param {string} userId
 * @returns {Object} - { question, target_knowledge, evaluation_criteria, reference_answers, difficulty, node_id }
 */
export async function getOrCreateFreeformQuestion(videoId, userId) {
  // 1. 查缓存
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

  // 2. 获取主知识点
  const primary = getMainNode(videoId);
  if (!primary || primary.node_id === 'unclassified') {
    throw new Error('视频未关联知识节点，无法生成问答题');
  }

  // 3. 获取内化正确率
  const accuracy = getExerciseAccuracy(userId, videoId);

  // 4. 调用 LLM 生成
  const q = await generateFreeformQuestion(primary.name, primary.node_id, accuracy);

  // 5. 缓存
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
 * @returns {{ evaluation, xpGained, alreadyCompleted, treeUpdate }}
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

  // 调用 LLM 评估
  const evaluation = await evaluateFreeform(qRow.target_knowledge, question, userInput);

  // 幂等：已完成的视频不再发 XP
  const alreadyCompleted = !!video.freeform_completed;

  let xpEarned = FREEFORM_XP_BASE;
  if (evaluation.overall_score >= 80) xpEarned += FREEFORM_XP_BONUS;
  const xpGained = alreadyCompleted ? 0 : xpEarned;

  // 保存尝试记录
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

    // 标记完成（幂等）
    db.prepare(`UPDATE videos SET freeform_completed = 1, updated_at = datetime('now') WHERE id = ?`).run(videoId);

    logger.info(`[Freeform] 用户 ${userId} 首次完成视频 ${videoId} 问答题: score=${evaluation.overall_score}, xp=+${xpGained}`);
  } else {
    logger.info(`[Freeform] 用户 ${userId} 重复提交视频 ${videoId} 问答题（不发XP）: score=${evaluation.overall_score}`);
  }

  return {
    evaluation,
    xpGained,
    alreadyCompleted,
    xpEarned,
    treeUpdate,
  };
}

/**
 * 获取用户在该视频内化环节的正确率（复用 migrationService 的逻辑）
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

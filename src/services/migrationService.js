import db from '../db/index.js';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';
import { generateMigrationScenario, evaluateMigration } from './llmService.js';
import { addNodeXP } from './treeService.js';
import { buildMigrationCoverBacklinks, ensureCardArchived } from './cardService.js';

/** 迁移完成奖励 XP（PRD §6.1.7：场景迁移完成 +50 XP；跨视频连接 +80 XP 见 P1-2） */
export const MIGRATION_XP_BASE = 50;
/** 跨视频知识连接迁移完成 XP（P1-2，未实现，预留常量） */
export const MIGRATION_XP_CROSS_VIDEO = 80;

/**
 * 获取视频的主知识点节点（weight 最高）
 */
export function getMainNodeForVideo(videoId) {
  const node = db.prepare(`
    SELECT vn.node_id, vn.weight, kn.name as node_name, kn.definition
    FROM video_nodes vn
    JOIN knowledge_nodes kn ON kn.node_id = vn.node_id
    WHERE vn.video_id = ? AND vn.is_unclassified = 0
    ORDER BY vn.weight DESC, vn.confidence DESC
    LIMIT 1
  `).get(videoId);
  return node || null;
}

/**
 * 获取用户在该视频内化环节的正确率
 */
export function getExerciseAccuracy(userId, videoId) {
  const stats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(CASE WHEN is_correct = 1 AND is_skipped = 0 THEN 1 ELSE 0 END) as correct
    FROM exercise_attempts
    WHERE user_id = ? AND video_id = ?
  `).get(userId, videoId);

  if (!stats || !stats.total) return null;
  return Math.round((stats.correct / stats.total) * 100);
}

/**
 * 校验用户是否已完成内化环节
 * [BUG-09 修复] 原实现只检查 exercise_attempts 是否存在，未校验闪卡/问答题
 * 现按 PRD P1-1 三模态（闪卡→选择题→问答题）全部完成才算内化完成
 * @returns {{ ok: boolean, reason?: string, missing?: string[] }}
 */
export function checkInternalizationDone(userId, videoId) {
  const video = db.prepare(`
    SELECT flashcard_completed, freeform_completed FROM videos WHERE id = ?
  `).get(videoId);

  const missing = [];

  // 闪卡完成
  if (!video?.flashcard_completed) {
    missing.push('闪卡回忆');
  }

  // 选择题检测完成（有 exercise_attempts 记录）
  const attemptRow = db.prepare(`
    SELECT COUNT(*) as count FROM exercise_attempts
    WHERE user_id = ? AND video_id = ?
  `).get(userId, videoId);
  if (!attemptRow || attemptRow.count === 0) {
    missing.push('选择题检测');
  }

  // 问答题表达完成
  if (!video?.freeform_completed) {
    missing.push('问答题表达');
  }

  if (missing.length > 0) {
    return {
      ok: false,
      reason: `请先完成内化三模态（${missing.join('、')}），再来尝试场景迁移`,
      missing,
    };
  }
  return { ok: true };
}

/**
 * 获取或创建视频的迁移场景
 */
export async function getOrCreateMigrationScenario(videoId, userId, options = {}) {
  // [BUG-09 修复] 内化前置校验（三模态全部完成）
  if (!options.skipInternalizationCheck) {
    const check = checkInternalizationDone(userId, videoId);
    if (!check.ok) {
      const err = new Error(check.reason);
      err.status = 409;
      throw err;
    }
  }

  const existing = db.prepare(`
    SELECT * FROM migration_scenarios WHERE video_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(videoId);

  if (existing) {
    logger.info(`[Migration] 视频 ${videoId} 已有迁移场景，直接返回`);
    return {
      scenarioId: existing.id,
      scenario_title: existing.scenario_title,
      scenario_description: existing.scenario_description,
      user_task: existing.user_task,
      evaluation_criteria: JSON.parse(existing.evaluation_criteria || '[]'),
      reference_answer: existing.reference_answer,
      difficulty: existing.difficulty,
      node_id: existing.node_id,
      node_name: existing.node_name,
    };
  }

  const mainNode = getMainNodeForVideo(videoId);
  if (!mainNode) {
    throw new Error('视频未关联任何知识节点，无法生成迁移场景');
  }

  const video = db.prepare('SELECT summary FROM videos WHERE id = ?').get(videoId);
  const accuracy = getExerciseAccuracy(userId, videoId);

  const scenarioData = await generateMigrationScenario(
    mainNode.node_name, mainNode.node_id, accuracy, video?.summary || ''
  );

  const scenarioId = nanoid(12);
  db.prepare(`
    INSERT INTO migration_scenarios
      (id, video_id, node_id, node_name, scenario_title, scenario_description,
       user_task, evaluation_criteria, reference_answer, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    scenarioId, videoId, mainNode.node_id, mainNode.node_name,
    scenarioData.scenario_title, scenarioData.scenario_description,
    scenarioData.user_task, JSON.stringify(scenarioData.evaluation_criteria),
    scenarioData.reference_answer, scenarioData.difficulty
  );

  logger.info(`[Migration] 视频 ${videoId} 生成新迁移场景: ${scenarioData.scenario_title}`);

  return { scenarioId, node_id: mainNode.node_id, node_name: mainNode.node_name, ...scenarioData };
}

/**
 * 评估用户迁移回答并更新知识树 XP（幂等：每个视频只发一次 XP）
 *
 * [BUG-05 修复] 原实现用 MIGRATION_XP_HIGH=80 做分数梯度奖励（+30/+15），
 * 误把 PRD 中跨视频连接的 +80 XP 当成场景迁移的分数阈值。
 * 现按 PRD §6.1.7：场景迁移完成即固定 +50 XP，无分数梯度。
 *
 * @param {string} videoId
 * @param {string} userId
 * @param {string} userInput
 * @returns {Object} - { evaluation, xpGained, alreadyCompleted, treeUpdate }
 */
export async function evaluateMigrationAttempt(videoId, userId, userInput) {
  const video = db.prepare(`SELECT migration_completed FROM videos WHERE id = ?`).get(videoId);
  if (!video) {
    throw new Error('视频不存在');
  }

  const scenarioRow = db.prepare(`
    SELECT * FROM migration_scenarios WHERE video_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(videoId);

  if (!scenarioRow) {
    throw new Error('迁移场景不存在，请先获取场景');
  }

  const scenario = {
    scenario_title: scenarioRow.scenario_title,
    scenario_description: scenarioRow.scenario_description,
    user_task: scenarioRow.user_task,
    evaluation_criteria: JSON.parse(scenarioRow.evaluation_criteria || '[]'),
    reference_answer: scenarioRow.reference_answer,
  };

  const evaluation = await evaluateMigration(scenarioRow.node_name, scenario, userInput);

  const alreadyCompleted = !!video.migration_completed;

  // [BUG-05 修复] 场景迁移完成固定 +50 XP（PRD §6.1.7），无分数梯度
  const xpEarned = MIGRATION_XP_BASE;
  const xpGained = alreadyCompleted ? 0 : xpEarned;

  const attemptId = nanoid(12);
  db.prepare(`
    INSERT INTO migration_attempts
      (id, scenario_id, user_id, video_id, node_id, user_input,
       ai_evaluation, accuracy_score, overall_score, xp_gained)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    attemptId, scenarioRow.id, userId, videoId, scenarioRow.node_id,
    userInput, JSON.stringify(evaluation),
    evaluation.accuracy_score, evaluation.overall_score, xpGained
  );

  let treeUpdate = null;
  if (!alreadyCompleted) {
    const treeResult = addNodeXP(userId, scenarioRow.node_id, xpGained);
    treeUpdate = {
      node_id: scenarioRow.node_id,
      node_name: scenarioRow.node_name,
      xpGain: xpGained,
      oldLevel: treeResult.oldLevel,
      newLevel: treeResult.newLevel,
      leveledUp: treeResult.leveledUp,
      totalXp: treeResult.xp,
    };

    db.prepare(`
      UPDATE videos SET migration_completed = 1, updated_at = datetime('now') WHERE id = ?
    `).run(videoId);

    try {
      buildMigrationCoverBacklinks(videoId, scenarioRow.node_id);
      ensureCardArchived(userId, scenarioRow.node_id);
    } catch (e) {
      logger.warn(`[Migration] 归档/backlinks 建立失败（非致命）: ${e.message}`);
    }

    logger.info(`[Migration] 用户 ${userId} 首次完成视频 ${videoId} 迁移: score=${evaluation.overall_score}, xp=+${xpGained}`);
  } else {
    logger.info(`[Migration] 用户 ${userId} 重复提交视频 ${videoId} 迁移评估（不发 XP）: score=${evaluation.overall_score}`);
  }

  return { evaluation, xpGained, alreadyCompleted, xpEarned, treeUpdate };
}

/**
 * 记录用户跳过迁移行为（用于留存漏斗分析，PRD §5.2）
 */
export function skipMigration(videoId, userId) {
  const video = db.prepare(`SELECT id FROM videos WHERE id = ? AND user_id = ?`).get(videoId, userId);
  if (!video) {
    const err = new Error('视频不存在');
    err.status = 404;
    throw err;
  }

  db.prepare(`
    INSERT INTO parse_logs (video_id, stage, status, message)
    VALUES (?, 'migration', 'skipped', ?)
  `).run(videoId, `用户 ${userId} 跳过迁移环节`);

  logger.info(`[Migration] 用户 ${userId} 跳过视频 ${videoId} 的迁移环节`);
  return { skipped: true };
}

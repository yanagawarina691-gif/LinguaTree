import db from '../db/index.js';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';
import { generateMigrationScenario, evaluateMigration } from './llmService.js';
import { addNodeXP } from './treeService.js';
import { buildMigrationCoverBacklinks, ensureCardArchived } from './cardService.js';

/** 迁移完成奖励 XP（PRD §6.1.7：完成迁移获得额外 XP） */
export const MIGRATION_XP_BASE = 50;
export const MIGRATION_XP_HIGH = 80;  // ≥80 分额外奖励

/**
 * 获取视频的主知识点节点（weight 最高）
 * @param {string} videoId
 * @returns {Object|null} - { node_id, node_name, weight }
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
 * @param {string} userId
 * @param {string} videoId
 * @returns {number|null} - 0-100，无数据返回 null
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
 * 校验用户是否已完成内化环节（PRD §6.1.5：迁移应在内化完成后触发）
 * 判定：该视频是否有 exercise_attempts 记录（含跳过的题目也算经过内化）
 * @returns {{ ok: boolean, reason?: string }}
 */
export function checkInternalizationDone(userId, videoId) {
  const row = db.prepare(`
    SELECT COUNT(*) as count FROM exercise_attempts
    WHERE user_id = ? AND video_id = ?
  `).get(userId, videoId);

  if (!row || row.count === 0) {
    return { ok: false, reason: '请先完成内化练习，再来尝试场景迁移' };
  }
  return { ok: true };
}

/**
 * 获取或创建视频的迁移场景
 * @param {string} videoId
 * @param {string} userId
 * @param {Object} [options]
 * @param {boolean} [options.skipInternalizationCheck] - 跳过内化校验（内部调用用）
 * @returns {Object} - 场景信息（含 scenarioId）
 */
export async function getOrCreateMigrationScenario(videoId, userId, options = {}) {
  // 内化前置校验（PRD §6.1.5）
  if (!options.skipInternalizationCheck) {
    const check = checkInternalizationDone(userId, videoId);
    if (!check.ok) {
      const err = new Error(check.reason);
      err.status = 409;
      throw err;
    }
  }

  // 1. 检查是否已有场景
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

  // 2. 获取主知识点
  const mainNode = getMainNodeForVideo(videoId);
  if (!mainNode) {
    throw new Error('视频未关联任何知识节点，无法生成迁移场景');
  }

  // 3. 获取视频摘要和内化正确率
  const video = db.prepare('SELECT summary FROM videos WHERE id = ?').get(videoId);
  const accuracy = getExerciseAccuracy(userId, videoId);

  // 4. 调用 LLM 生成场景
  const scenarioData = await generateMigrationScenario(
    mainNode.node_name,
    mainNode.node_id,
    accuracy,
    video?.summary || ''
  );

  // 5. 存入数据库
  const scenarioId = nanoid(12);
  db.prepare(`
    INSERT INTO migration_scenarios
      (id, video_id, node_id, node_name, scenario_title, scenario_description,
       user_task, evaluation_criteria, reference_answer, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    scenarioId,
    videoId,
    mainNode.node_id,
    mainNode.node_name,
    scenarioData.scenario_title,
    scenarioData.scenario_description,
    scenarioData.user_task,
    JSON.stringify(scenarioData.evaluation_criteria),
    scenarioData.reference_answer,
    scenarioData.difficulty
  );

  logger.info(`[Migration] 视频 ${videoId} 生成新迁移场景: ${scenarioData.scenario_title}`);

  return {
    scenarioId,
    node_id: mainNode.node_id,
    node_name: mainNode.node_name,
    ...scenarioData,
  };
}

/**
 * 评估用户迁移回答并更新知识树 XP（幂等：每个视频只发一次 XP）
 *
 * 修复 Bug M2-1：原实现每次调用都 addNodeXP，可无限刷分。
 * 现改为：检查 videos.migration_completed，已完成则不再发 XP（但仍评估并存尝试记录）。
 *
 * @param {string} videoId
 * @param {string} userId
 * @param {string} userInput - 用户提交的英文回答
 * @returns {Object} - { evaluation, xpGained, alreadyCompleted, treeUpdate }
 */
export async function evaluateMigrationAttempt(videoId, userId, userInput) {
  // 获取视频（含 migration_completed 状态）
  const video = db.prepare(`SELECT migration_completed FROM videos WHERE id = ?`).get(videoId);
  if (!video) {
    throw new Error('视频不存在');
  }

  // 获取场景
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

  // 调用 LLM 评估
  const evaluation = await evaluateMigration(scenarioRow.node_name, scenario, userInput);

  // 幂等：已完成的视频不再发 XP（但仍记录尝试 + 返回评估）
  const alreadyCompleted = !!video.migration_completed;

  // XP 计算：基础 50，≥80分额外 +30，≥60分额外 +15
  let xpEarned = MIGRATION_XP_BASE;
  if (evaluation.overall_score >= 80) xpEarned += 30;
  else if (evaluation.overall_score >= 60) xpEarned += 15;

  // 实际发放的 XP：已完成则为 0（幂等防刷）
  const xpGained = alreadyCompleted ? 0 : xpEarned;

  // 保存尝试记录（无论是否已完成，都记录这次尝试）
  const attemptId = nanoid(12);
  db.prepare(`
    INSERT INTO migration_attempts
      (id, scenario_id, user_id, video_id, node_id, user_input,
       ai_evaluation, accuracy_score, overall_score, xp_gained)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    attemptId,
    scenarioRow.id,
    userId,
    videoId,
    scenarioRow.node_id,
    userInput,
    JSON.stringify(evaluation),
    evaluation.accuracy_score,
    evaluation.overall_score,
    xpGained
  );

  // 仅首次完成时发放 XP 并标记完成
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

    // 标记迁移完成（幂等关键：后续调用不再发 XP）
    db.prepare(`
      UPDATE videos SET migration_completed = 1, updated_at = datetime('now') WHERE id = ?
    `).run(videoId);

    // M3: 建立 migration_cover backlinks + 确保归档
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

  return {
    evaluation,
    xpGained,
    alreadyCompleted,
    xpEarned,    // 本次评估"应得"的 XP（供前端展示，实际发放受幂等限制）
    treeUpdate,
  };
}

/**
 * 记录用户跳过迁移行为（用于留存漏斗分析，PRD §5.2）
 * @param {string} videoId
 * @param {string} userId
 * @returns {{ skipped: boolean }}
 */
export function skipMigration(videoId, userId) {
  const video = db.prepare(`SELECT id FROM videos WHERE id = ? AND user_id = ?`).get(videoId, userId);
  if (!video) {
    const err = new Error('视频不存在');
    err.status = 404;
    throw err;
  }

  // 用 parse_logs 记录跳过行为（复用现有表，stage='migration', status='skipped'）
  db.prepare(`
    INSERT INTO parse_logs (video_id, stage, status, message)
    VALUES (?, 'migration', 'skipped', ?)
  `).run(videoId, `用户 ${userId} 跳过迁移环节`);

  logger.info(`[Migration] 用户 ${userId} 跳过视频 ${videoId} 的迁移环节`);
  return { skipped: true };
}

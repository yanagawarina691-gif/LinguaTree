import db from '../db/index.js';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';
import { generateMigrationScenario, evaluateMigration } from './llmService.js';
import { addNodeXP } from './treeService.js';

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
 * 获取或创建视频的迁移场景
 * @param {string} videoId
 * @param {string} userId
 * @returns {Object} - 场景信息（含 scenarioId）
 */
export async function getOrCreateMigrationScenario(videoId, userId) {
  // 1. 检查是否已有场景
  const existing = db.prepare(`
    SELECT * FROM migration_scenarios WHERE video_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(videoId);

  if (existing) {
    logger.info('[Migration]', `视频 ${videoId} 已有迁移场景，直接返回`);
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

  logger.info('[Migration]', `视频 ${videoId} 生成新迁移场景: ${scenarioData.scenario_title}`);

  return {
    scenarioId,
    node_id: mainNode.node_id,
    node_name: mainNode.node_name,
    ...scenarioData,
  };
}

/**
 * 评估用户迁移回答并更新知识树 XP
 * @param {string} videoId
 * @param {string} userId
 * @param {string} userInput - 用户提交的英文回答
 * @returns {Object} - 评估结果 + XP
 */
export async function evaluateMigrationAttempt(videoId, userId, userInput) {
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

  // 计算 XP：基础 50，≥80分额外 +30
  let xpGained = 50;
  if (evaluation.overall_score >= 80) xpGained += 30;
  else if (evaluation.overall_score >= 60) xpGained += 15;

  // 保存尝试记录
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

  // 更新知识树 XP
  const treeResult = addNodeXP(userId, scenarioRow.node_id, xpGained);

  logger.info('[Migration]', `用户 ${userId} 迁移完成: score=${evaluation.overall_score}, xp=+${xpGained}`);

  return {
    evaluation,
    xpGained,
    treeUpdate: {
      node_id: scenarioRow.node_id,
      node_name: scenarioRow.node_name,
      xpGain: xpGained,
      oldLevel: treeResult.oldLevel,
      newLevel: treeResult.newLevel,
      leveledUp: treeResult.leveledUp,
      totalXp: treeResult.xp,
    },
  };
}

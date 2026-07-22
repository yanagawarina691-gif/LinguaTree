import db from '../db/index.js';
import { logger } from '../utils/logger.js';

/**
 * XP 升级阈值
 */
const LEVEL_THRESHOLDS = [
  { level: 0, name: '休眠', min_xp: 0 },
  { level: 1, name: '发芽', min_xp: 10 },
  { level: 2, name: '茂叶', min_xp: 50 },
  { level: 3, name: '开花', min_xp: 150 },
];

/**
 * 根据 XP 计算等级
 */
export function calcLevel(xp) {
  let level = 0;
  for (const t of LEVEL_THRESHOLDS) {
    if (xp >= t.min_xp) level = t.level;
  }
  return level;
}

function getMaxXpForCurrentLevel(level) {
  if (level >= 3) return 150;
  return LEVEL_THRESHOLDS[level + 1]?.min_xp || 150;
}

function getMinXpForCurrentLevel(level) {
  return LEVEL_THRESHOLDS[level]?.min_xp || 0;
}

/**
 * 计算掌握度
 * mastery = recent_correct_rate × 0.7 + xp_normalized × 0.3
 * 新用户无训练数据时：mastery = xp_normalized × 1.0
 */
export function calculateMastery(userId, nodeId) {
  const recentAttempts = db.prepare(`
    SELECT is_correct, is_skipped
    FROM exercise_attempts
    WHERE user_id = ? AND node_id = ?
    ORDER BY created_at DESC
    LIMIT 5
  `).all(userId, nodeId);

  const node = db.prepare(`
    SELECT xp, level FROM user_nodes
    WHERE user_id = ? AND node_id = ?
  `).get(userId, nodeId);

  if (!node) return 0;

  const currentXp = node.xp || 0;
  const currentLevel = node.level || 0;

  const minXp = getMinXpForCurrentLevel(currentLevel);
  const maxXp = getMaxXpForCurrentLevel(currentLevel);
  const xpNormalized = maxXp > minXp
    ? Math.min((currentXp - minXp) / (maxXp - minXp), 1.0)
    : 0;

  if (recentAttempts.length === 0) {
    return Math.max(0, Math.min(1.0, xpNormalized * 1.0));
  }

  const validAttempts = recentAttempts.filter(a => !a.is_skipped);
  if (validAttempts.length === 0) {
    return Math.max(0, Math.min(1.0, xpNormalized * 0.3));
  }
  const correctCount = validAttempts.filter(a => a.is_correct).length;
  const recentCorrectRate = correctCount / validAttempts.length;

  const mastery = recentCorrectRate * 0.7 + xpNormalized * 0.3;
  return Math.max(0, Math.min(1.0, mastery));
}

/**
 * 增加节点 XP 并自动升级
 */
export function addNodeXP(userId, nodeId, xpGain) {
  const nodeExists = db.prepare('SELECT 1 FROM knowledge_nodes WHERE node_id = ?').get(nodeId);
  if (!nodeExists) {
    logger.warn('[Tree]', `节点不存在，跳过 XP 更新: ${nodeId}`);
    return { oldLevel: 0, newLevel: 0, xp: 0, xpGain: 0, leveledUp: false };
  }

  db.prepare(`
    INSERT OR IGNORE INTO user_nodes (user_id, node_id, xp, level, mastery)
    VALUES (?, ?, 0, 0, 0.0)
  `).run(userId, nodeId);

  const old = db.prepare(`
    SELECT xp, level FROM user_nodes
    WHERE user_id = ? AND node_id = ?
  `).get(userId, nodeId);

  const newXp = (old.xp || 0) + xpGain;
  const newLevel = calcLevel(newXp);

  db.prepare(`
    UPDATE user_nodes
    SET xp = ?, level = ?, mastery = ?, updated_at = datetime('now')
    WHERE user_id = ? AND node_id = ?
  `).run(newXp, newLevel, calculateMastery(userId, nodeId), userId, nodeId);

  return {
    oldLevel: old.level || 0,
    newLevel,
    xp: newXp,
    xpGain,
    leveledUp: newLevel > (old.level || 0),
  };
}

/**
 * 记录答题结果并更新掌握度
 * [BUG-11 修复] 先 INSERT OR IGNORE 保证 user_nodes 记录存在，避免 UPDATE 影响 0 行
 */
export function recordAttempt(userId, nodeId, isCorrect, isSkipped = false) {
  // 确保节点存在且 user_nodes 记录已创建
  const nodeExists = db.prepare('SELECT 1 FROM knowledge_nodes WHERE node_id = ?').get(nodeId);
  if (!nodeExists) {
    logger.warn('[Tree]', `recordAttempt: 节点不存在 ${nodeId}`);
    return;
  }
  db.prepare(`
    INSERT OR IGNORE INTO user_nodes (user_id, node_id, xp, level, mastery)
    VALUES (?, ?, 0, 0, 0.0)
  `).run(userId, nodeId);

  const mastery = calculateMastery(userId, nodeId);
  db.prepare(`
    UPDATE user_nodes
    SET mastery = ?, updated_at = datetime('now')
    WHERE user_id = ? AND node_id = ?
  `).run(mastery, userId, nodeId);
}

/**
 * 巩固训练答对奖励：仅对答对节点 +5 XP，不重复发放视频解析 XP
 * [BUG-01 修复] 原实现调用 updateTreeFromVideo 会重复发放 weight×completion×10 的视频解析 XP
 */
export function addExerciseBonus(userId, correctNodeIds) {
  const updatedNodes = [];
  const leveledUpNodes = [];
  let totalXp = 0;

  for (const nodeId of correctNodeIds) {
    if (!nodeId || nodeId === 'unclassified') continue;
    const r = addNodeXP(userId, nodeId, 5);
    totalXp += 5;
    updatedNodes.push({
      node_id: nodeId,
      xpGain: 5,
      oldLevel: r.oldLevel,
      newLevel: r.newLevel,
      leveledUp: r.leveledUp,
      totalXp: r.xp,
    });
    if (r.leveledUp) {
      leveledUpNodes.push({ node_id: nodeId, oldLevel: r.oldLevel, newLevel: r.newLevel });
    }
  }

  if (updatedNodes.length > 0) {
    logger.info(`[Tree] 用户 ${userId} 巩固训练答对奖励: ${updatedNodes.length} 节点, +${totalXp} XP`);
  }
  return { updatedNodes, leveledUpNodes, totalXp };
}

/**
 * 处理视频解析完成后的树更新（tree-updater Skill）
 */
export function updateTreeFromVideo(userId, videoId, nodes, completionRate = 1.0, correctNodeIds = []) {
  const updatedNodes = [];
  const leveledUpNodes = [];
  let totalXp = 0;

  for (const nodeMapping of nodes) {
    const { node_id, weight } = nodeMapping;
    if (!node_id || node_id === 'unclassified') continue;

    const videoXpGain = Math.round(weight * completionRate * 10);
    const result = addNodeXP(userId, node_id, videoXpGain);
    totalXp += videoXpGain;

    if (correctNodeIds.includes(node_id)) {
      const exerciseResult = addNodeXP(userId, node_id, 5);
      totalXp += 5;
      result.xp = exerciseResult.xp;
      result.leveledUp = exerciseResult.leveledUp || result.leveledUp;
      result.newLevel = exerciseResult.newLevel;
    }

    updatedNodes.push({
      node_id,
      xpGain: videoXpGain + (correctNodeIds.includes(node_id) ? 5 : 0),
      oldLevel: result.oldLevel,
      newLevel: result.newLevel,
      leveledUp: result.leveledUp,
      totalXp: result.xp,
    });

    if (result.leveledUp) {
      leveledUpNodes.push({ node_id, oldLevel: result.oldLevel, newLevel: result.newLevel });
    }
  }

  logger.info(`[Tree] 用户 ${userId} 树更新完成: ${updatedNodes.length} 节点更新, ${leveledUpNodes.length} 升级, 总XP +${totalXp}`);
  return { updatedNodes, leveledUpNodes, totalXp };
}

/**
 * 获取用户完整知识树（含每个节点状态）
 */
export function getUserTree(userId) {
  const rows = db.prepare(`
    SELECT
      kn.node_id, kn.name, kn.definition, kn.sub_branch, kn.top_branch,
      kn.top_branch_name, kn.color, kn.sort_order,
      un.xp, un.level, un.mastery, un.last_review_at
    FROM knowledge_nodes kn
    LEFT JOIN user_nodes un ON un.node_id = kn.node_id AND un.user_id = ?
    ORDER BY kn.sort_order
  `).all(userId);

  const tree = {};
  for (const row of rows) {
    if (!tree[row.top_branch]) {
      tree[row.top_branch] = { id: row.top_branch, name: row.top_branch_name, color: row.color, sub_branches: {} };
    }
    if (!tree[row.top_branch].sub_branches[row.sub_branch]) {
      tree[row.top_branch].sub_branches[row.sub_branch] = [];
    }
    tree[row.top_branch].sub_branches[row.sub_branch].push({
      node_id: row.node_id, name: row.name, definition: row.definition,
      xp: row.xp || 0, level: row.level || 0, mastery: row.mastery || 0,
    });
  }

  const stats = {
    totalNodes: rows.length,
    activatedNodes: rows.filter(r => (r.level || 0) > 0).length,
    totalXp: rows.reduce((sum, r) => sum + (r.xp || 0), 0),
    avgMastery: rows.filter(r => r.mastery > 0).length > 0
      ? rows.reduce((sum, r) => sum + (r.mastery || 0), 0) / rows.filter(r => r.mastery > 0).length
      : 0,
  };

  return { branches: tree, stats };
}

/**
 * 获取弱项节点（mastery 最低的 N 个已激活节点）
 */
export function getWeakNodes(userId, count = 3) {
  return db.prepare(`
    SELECT kn.node_id, kn.name, kn.top_branch_name, kn.sub_branch, un.xp, un.level, un.mastery
    FROM knowledge_nodes kn
    JOIN user_nodes un ON un.node_id = kn.node_id AND un.user_id = ?
    WHERE un.level > 0
    ORDER BY un.mastery ASC, un.xp ASC
    LIMIT ?
  `).all(userId, count);
}

/**
 * 获取用户统计信息
 * [BUG-15 修复] sprouted 与 activated 等价问题：sprouted 改为统计 level>=2(茂叶) 以上
 * 等级定义：Lv0 休眠 / Lv1 发芽 / Lv2 茂叶 / Lv3 开花
 */
export function getUserStats(userId) {
  const videoCount = db.prepare(`
    SELECT COUNT(*) as count FROM videos WHERE user_id = ? AND status = 'done'
  `).get(userId)?.count || 0;

  const nodeStats = db.prepare(`
    SELECT
      COUNT(CASE WHEN level >= 1 THEN 1 END) as activated,
      COUNT(CASE WHEN level >= 2 THEN 1 END) as leafy,
      COUNT(CASE WHEN level >= 3 THEN 1 END) as bloomed,
      SUM(xp) as total_xp
    FROM user_nodes WHERE user_id = ?
  `).get(userId) || {};

  const exerciseStats = db.prepare(`
    SELECT COUNT(*) as total, SUM(is_correct) as correct, SUM(is_skipped) as skipped
    FROM exercise_attempts WHERE user_id = ?
  `).get(userId) || {};

  return {
    videosParsed: videoCount,
    nodesActivated: nodeStats.activated || 0,
    nodesLeafy: nodeStats.leafy || 0,
    nodesBloomed: nodeStats.bloomed || 0,
    totalXp: nodeStats.total_xp || 0,
    exercisesTotal: exerciseStats.total || 0,
    exercisesCorrect: exerciseStats.correct || 0,
    exercisesSkipped: exerciseStats.skipped || 0,
    accuracyRate: exerciseStats.total > 0
      ? (exerciseStats.correct / exerciseStats.total * 100).toFixed(1) + '%'
      : '0%',
  };
}

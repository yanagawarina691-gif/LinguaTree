import db from '../db/index.js';
import { logger } from '../utils/logger.js';

/**
 * 阶段名称（PRD 五阶段矿石生长模型）
 */
export const STAGE_NAMES = ['undiscovered', 'seedling', 'crystal', 'prism', 'radiant'];

/**
 * 阶段中文名称（用于展示）
 */
export const STAGE_NAMES_CN = ['未发现', '矿苗', '晶芽', '辉石', '璀璨'];

/**
 * XP 升级阈值（PRD v2 五阶段）
 */
const LEVEL_THRESHOLDS = [
  { level: 0, name: STAGE_NAMES[0], name_cn: STAGE_NAMES_CN[0], min_xp: 0 },
  { level: 1, name: STAGE_NAMES[1], name_cn: STAGE_NAMES_CN[1], min_xp: 50 },
  { level: 2, name: STAGE_NAMES[2], name_cn: STAGE_NAMES_CN[2], min_xp: 150 },
  { level: 3, name: STAGE_NAMES[3], name_cn: STAGE_NAMES_CN[3], min_xp: 350 },
  { level: 4, name: STAGE_NAMES[4], name_cn: STAGE_NAMES_CN[4], min_xp: 700 },
];

/**
 * 每日上限配置（按 XP 来源）
 */
const DAILY_XP_CAPS = {
  repeated: { limit: 10, unit: '次/矿石/日' },
  link: { limit: 20, unit: '次/日' },
  review: { limit: 3, unit: '轮/矿石/日' },
};

/**
 * 根据 XP 计算等级（0-4）
 */
export function calcLevel(xp) {
  let level = 0;
  for (const t of LEVEL_THRESHOLDS) {
    if (xp >= t.min_xp) level = t.level;
  }
  return level;
}

/**
 * 计算当前等级的最大 XP 阈值
 */
function getMaxXpForCurrentLevel(level) {
  if (level >= LEVEL_THRESHOLDS.length - 1) return LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1].min_xp;
  return LEVEL_THRESHOLDS[level + 1]?.min_xp || LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1].min_xp;
}

/**
 * 计算当前等级的最小 XP 阈值
 */
function getMinXpForCurrentLevel(level) {
  return LEVEL_THRESHOLDS[level]?.min_xp || 0;
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
 * 计算掌握度
 * mastery = recent_correct_rate × 0.7 + xp_normalized × 0.3
 * 新用户无训练数据时：mastery = xp_normalized × 1.0
 */
export function calculateMastery(userId, nodeId) {
  // 获取最近 5 次该节点的训练记录
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

  // XP 归一化
  const minXp = getMinXpForCurrentLevel(currentLevel);
  const maxXp = getMaxXpForCurrentLevel(currentLevel);
  const xpNormalized = maxXp > minXp
    ? Math.min((currentXp - minXp) / (maxXp - minXp), 1.0)
    : 0;

  // 如果没有训练记录，只用 XP 归一化
  if (recentAttempts.length === 0) {
    return Math.max(0, Math.min(1.0, xpNormalized * 1.0));
  }

  // 计算最近 5 次正确率
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
 * @param {string} userId
 * @param {string} nodeId
 * @param {number} xpGain
 * @param {string} source - XP 来源（影响每日上限与明细）
 * @returns {Object} - { oldLevel, newLevel, xp, leveledUp }
 */
export function addNodeXP(userId, nodeId, xpGain, source = 'default') {
  // FK guard: 检查节点是否存在于 knowledge_nodes 表
  const nodeExists = db.prepare('SELECT 1 FROM knowledge_nodes WHERE node_id = ?').get(nodeId);
  if (!nodeExists) {
    logger.warn('[Tree]', `节点不存在，跳过 XP 更新: ${nodeId}`);
    return { oldLevel: 0, newLevel: 0, xp: 0, xpGain: 0, leveledUp: false };
  }

  // 确保记录存在
  db.prepare(`
    INSERT OR IGNORE INTO user_nodes (user_id, node_id, xp, level, stage, mastery)
    VALUES (?, ?, 0, 0, 'undiscovered', 0.0)
  `).run(userId, nodeId);

  const old = db.prepare(`
    SELECT xp, level, xp_breakdown FROM user_nodes
    WHERE user_id = ? AND node_id = ?
  `).get(userId, nodeId);

  // 解析 xp_breakdown
  const breakdown = safeParse(old.xp_breakdown, { sources: {}, daily: {} });
  if (!breakdown.sources) breakdown.sources = {};
  if (!breakdown.daily) breakdown.daily = {};

  const today = new Date().toISOString().slice(0, 10);

  // 每日上限校验（仅针对有上限的来源）
  if (DAILY_XP_CAPS[source]) {
    const dailyRecord = breakdown.daily[source] || { date: today, count: 0 };
    if (dailyRecord.date !== today) {
      dailyRecord.date = today;
      dailyRecord.count = 0;
    }
    if (dailyRecord.count >= DAILY_XP_CAPS[source].limit) {
      logger.info('[Tree]', `XP 来源 ${source} 已达今日上限: ${nodeId}`);
      return {
        oldLevel: old.level || 0,
        newLevel: old.level || 0,
        xp: old.xp || 0,
        xpGain: 0,
        leveledUp: false,
        capped: true,
      };
    }
    dailyRecord.count += 1;
    breakdown.daily[source] = dailyRecord;
  }

  // 更新明细
  breakdown.sources[source] = (breakdown.sources[source] || 0) + xpGain;

  const newXp = (old.xp || 0) + xpGain;
  const newLevel = calcLevel(newXp);
  const newStage = STAGE_NAMES[newLevel] || 'undiscovered';

  db.prepare(`
    UPDATE user_nodes
    SET xp = ?, level = ?, stage = ?, mastery = ?, xp_breakdown = ?, updated_at = datetime('now')
    WHERE user_id = ? AND node_id = ?
  `).run(
    newXp,
    newLevel,
    newStage,
    calculateMastery(userId, nodeId),
    JSON.stringify(breakdown),
    userId,
    nodeId
  );

  return {
    oldLevel: old.level || 0,
    newLevel,
    xp: newXp,
    xpGain,
    leveledUp: newLevel > (old.level || 0),
    stage: newStage,
  };
}

/**
 * 记录答题结果并更新掌握度
 * @param {string} userId
 * @param {string} nodeId
 * @param {boolean} isCorrect
 * @param {boolean} isSkipped
 */
export function recordAttempt(userId, nodeId, isCorrect, isSkipped = false) {
  // 更新该节点的掌握度
  const mastery = calculateMastery(userId, nodeId);
  db.prepare(`
    UPDATE user_nodes
    SET mastery = ?, updated_at = datetime('now')
    WHERE user_id = ? AND node_id = ?
  `).run(mastery, userId, nodeId);
}

/**
 * 处理视频解析完成后的树更新
 * @param {string} userId
 * @param {string} videoId
 * @param {Array} nodes - [{ node_id, weight, confidence }]
 * @param {number} completionRate - 完播率 0-1
 * @param {Array} correctNodeIds - 巩固训练答对的节点 ID
 * @returns {Object} - { updatedNodes, leveledUpNodes, totalXp }
 */
export function updateTreeFromVideo(userId, videoId, nodes, completionRate = 1.0, correctNodeIds = []) {
  const updatedNodes = [];
  const leveledUpNodes = [];
  let totalXp = 0;

  for (const nodeMapping of nodes) {
    const { node_id, weight } = nodeMapping;
    if (!node_id || node_id === 'unclassified') continue;

    // 检测是否已从其他视频激活过该节点（反复刷到）
    const priorCount = db.prepare(`
      SELECT COUNT(*) as count
      FROM video_nodes vn
      JOIN videos v ON v.id = vn.video_id
      WHERE vn.node_id = ?
        AND vn.video_id != ?
        AND v.user_id = ?
        AND v.status = 'done'
    `).get(node_id, videoId, userId)?.count || 0;

    let result = null;

    if (priorCount > 0) {
      // 反复刷到：+5 XP（受每日上限约束）
      result = addNodeXP(userId, node_id, 5, 'repeated');
      totalXp += result.xpGain;
    } else {
      // 新节点初次通过视频激活：weight × 完播率 × 10
      const videoXpGain = Math.round(weight * completionRate * 10);
      result = addNodeXP(userId, node_id, videoXpGain, 'video');
      totalXp += result.xpGain;
    }

    // 巩固训练答对该节点：+5 XP
    if (correctNodeIds.includes(node_id)) {
      const exerciseResult = addNodeXP(userId, node_id, 5, 'exercise');
      totalXp += exerciseResult.xpGain;
      result.xp = exerciseResult.xp;
      result.leveledUp = exerciseResult.leveledUp || result.leveledUp;
      result.newLevel = exerciseResult.newLevel;
      result.stage = exerciseResult.stage;
    }

    updatedNodes.push({
      node_id,
      xpGain: result.xpGain,
      oldLevel: result.oldLevel,
      newLevel: result.newLevel,
      leveledUp: result.leveledUp,
      totalXp: result.xp,
      stage: result.stage,
    });

    if (result.leveledUp) {
      leveledUpNodes.push({
        node_id,
        oldLevel: result.oldLevel,
        newLevel: result.newLevel,
        stage: result.stage,
      });
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
      un.xp, un.level, un.stage, un.mastery, un.last_review_at
    FROM knowledge_nodes kn
    LEFT JOIN user_nodes un ON un.node_id = kn.node_id AND un.user_id = ?
    ORDER BY kn.sort_order
  `).all(userId);

  // 按一级分支组织
  const tree = {};
  for (const row of rows) {
    if (!tree[row.top_branch]) {
      tree[row.top_branch] = {
        id: row.top_branch,
        name: row.top_branch_name,
        color: row.color,
        sub_branches: {},
      };
    }
    if (!tree[row.top_branch].sub_branches[row.sub_branch]) {
      tree[row.top_branch].sub_branches[row.sub_branch] = [];
    }
    tree[row.top_branch].sub_branches[row.sub_branch].push({
      node_id: row.node_id,
      name: row.name,
      definition: row.definition,
      xp: row.xp || 0,
      level: row.level || 0,
      stage: row.stage || 'undiscovered',
      mastery: row.mastery || 0,
    });
  }

  // 统计
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
  const nodes = db.prepare(`
    SELECT
      kn.node_id, kn.name, kn.top_branch_name, kn.sub_branch,
      un.xp, un.level, un.stage, un.mastery
    FROM knowledge_nodes kn
    JOIN user_nodes un ON un.node_id = kn.node_id AND un.user_id = ?
    WHERE un.level > 0
    ORDER BY un.mastery ASC, un.xp ASC
    LIMIT ?
  `).all(userId, count);

  return nodes;
}

/**
 * 获取用户统计信息
 */
export function getUserStats(userId) {
  const videoCount = db.prepare(`
    SELECT COUNT(*) as count FROM videos WHERE user_id = ? AND status = 'done'
  `).get(userId)?.count || 0;

  const nodeStats = db.prepare(`
    SELECT
      COUNT(CASE WHEN level > 0 THEN 1 END) as activated,
      COUNT(CASE WHEN level >= 1 THEN 1 END) as seedling,
      COUNT(CASE WHEN level >= 2 THEN 1 END) as crystal,
      COUNT(CASE WHEN level >= 3 THEN 1 END) as prism,
      COUNT(CASE WHEN level >= 4 THEN 1 END) as radiant,
      SUM(xp) as total_xp
    FROM user_nodes WHERE user_id = ?
  `).get(userId) || {};

  const exerciseStats = db.prepare(`
    SELECT
      COUNT(*) as total,
      SUM(is_correct) as correct,
      SUM(is_skipped) as skipped
    FROM exercise_attempts WHERE user_id = ?
  `).get(userId) || {};

  return {
    videosParsed: videoCount,
    nodesActivated: nodeStats.activated || 0,
    nodesSeedling: nodeStats.seedling || 0,
    nodesCrystal: nodeStats.crystal || 0,
    nodesPrism: nodeStats.prism || 0,
    nodesRadiant: nodeStats.radiant || 0,
    totalXp: nodeStats.total_xp || 0,
    exercisesTotal: exerciseStats.total || 0,
    exercisesCorrect: exerciseStats.correct || 0,
    exercisesSkipped: exerciseStats.skipped || 0,
    accuracyRate: exerciseStats.total > 0
      ? (exerciseStats.correct / exerciseStats.total * 100).toFixed(1) + '%'
      : '0%',
  };
}

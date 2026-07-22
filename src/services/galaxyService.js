import db from '../db/index.js';
import { logger } from '../utils/logger.js';

/**
 * 矿石星图（Crystal Galaxy）服务
 * 为前端矿石星图可视化提供节点数据 + 共现关联 + 统计
 */

// ====== 色板定义（从 HTML 移植 + 新增 orange） ======
export const PALETTES = {
  rose:    { base: '#FC3F4D', accent: '#FE8BF2', shadow: '#FB4DFE' },
  blue:    { base: '#186AFE', accent: '#059BFC', shadow: '#030095' },
  green:   { base: '#02D34D', accent: '#BDF500', shadow: '#0602D2' },
  gold:    { base: '#FCD90B', accent: '#FFF000', shadow: '#FF7F00' },
  violet:  { base: '#7548FD', accent: '#FB4DFE', shadow: '#A204F9' },
  aqua:    { base: '#40F2FB', accent: '#059BFC', shadow: '#186AFE' },
  orange:  { base: '#FF9600', accent: '#FFB347', shadow: '#E07B00' },
};

// ====== 分支 → 色板映射 ======
const BRANCH_PALETTE = {
  grammar: 'violet',
  vocabulary: 'orange',
  pronunciation: 'rose',
  listening: 'blue',
  culture: 'gold',
};

// ====== 子分支 → 晶体族形映射 ======
// key 用 node_id 的前两段（如 "grammar.tense"），从 node_id 提取
const SUBBRANCH_FAMILY = {
  'grammar.tense': 'prism',
  'grammar.voice': 'blade',
  'grammar.clause': 'cluster',
  'grammar.modal_nonfinite': 'drop',
  'vocabulary.daily': 'pebble',
  'vocabulary.academic': 'gem',
  'vocabulary.business': 'cube',
  'vocabulary.idioms': 'cluster',
  'vocabulary.phrases': 'blade',
  'pronunciation.phonetics': 'drop',
  'pronunciation.connected': 'blade',
  'pronunciation.intonation': 'prism',
  'listening.daily': 'pebble',
  'listening.news': 'gem',
  'listening.media': 'cluster',
  'culture.western': 'cube',
  'culture.intercultural': 'drop',
  'culture.trends': 'gem',
};

// ====== 阶段名称（PRD 五阶段矿石生长模型） ======
export const STAGE_NAMES = ['未发现', '矿苗', '晶芽', '辉石', '璀璨'];

// ====== XP 阶段阈值 ======
const STAGE_THRESHOLDS = [0, 50, 150, 350, 700];

/**
 * 从 node_id 提取子分支 id（前两段）
 * 例: "grammar.tense.present_perfect" → "grammar.tense"
 */
function extractSubBranchId(nodeId) {
  const parts = nodeId.split('.');
  if (parts.length >= 2) return `${parts[0]}.${parts[1]}`;
  return nodeId;
}

/**
 * 根据累计 XP 直接计算矿石阶段（PRD 五阶段阈值）
 * @param {number} xp
 * @returns {number} 0-4
 */
export function calcStage(xp) {
  let stage = 0;
  for (let i = 0; i < STAGE_THRESHOLDS.length; i++) {
    if (xp >= STAGE_THRESHOLDS[i]) stage = i;
  }
  return stage;
}

/**
 * 获取矿石星图所有节点（含用户状态 + 色板/族形/阶段计算）
 * @param {string} userId
 * @returns {Array} 节点数组
 */
export function getGalaxyNodes(userId) {
  const rows = db.prepare(`
    SELECT
      kn.node_id, kn.name, kn.definition, kn.sub_branch,
      kn.top_branch, kn.top_branch_name, kn.color, kn.sort_order,
      un.xp, un.level, un.mastery, un.last_review_at
    FROM knowledge_nodes kn
    LEFT JOIN user_nodes un ON un.node_id = kn.node_id AND un.user_id = ?
    WHERE kn.node_id != 'unclassified'
    ORDER BY kn.sort_order
  `).all(userId);

  return rows.map(row => {
    const level = row.level || 0;
    const mastery = row.mastery || 0;
    const xp = row.xp || 0;
    const subBranchId = extractSubBranchId(row.node_id);
    const palette = BRANCH_PALETTE[row.top_branch] || 'blue';
    const family = SUBBRANCH_FAMILY[subBranchId] || 'prism';
    const stage = calcStage(xp);

    return {
      node_id: row.node_id,
      name: row.name,
      definition: row.definition,
      top_branch: row.top_branch,
      top_branch_name: row.top_branch_name,
      sub_branch: row.sub_branch,
      sub_branch_id: subBranchId,
      color: row.color,
      palette,
      family,
      sort_order: row.sort_order,
      xp,
      level,
      stage,
      mastery,
      active: level > 0,
      last_review_at: row.last_review_at,
    };
  });
}

/**
 * 获取节点间共现关联（从 video_nodes 自动计算）
 * 两个节点在同一视频出现 = 一次共现
 * strength = 共现次数(0.5) + 置信度(0.3) + 权重(0.2)
 * @param {string} userId
 * @returns {Array} [{ a, b, strength }]
 */
export function getGalaxyLinks(userId) {
  const rows = db.prepare(`
    SELECT
      a.node_id AS a,
      b.node_id AS b,
      COUNT(*)              AS co_count,
      AVG(a.confidence)     AS avg_conf_a,
      AVG(b.confidence)     AS avg_conf_b,
      AVG(a.weight)         AS avg_w_a,
      AVG(b.weight)         AS avg_w_b
    FROM video_nodes a
    JOIN video_nodes b
      ON a.video_id = b.video_id
     AND a.node_id < b.node_id
    JOIN videos v
      ON v.id = a.video_id
     AND v.user_id = ?
     AND v.status = 'done'
    WHERE a.is_unclassified = 0
      AND b.is_unclassified = 0
    GROUP BY a.node_id, b.node_id
    HAVING co_count >= 1
  `).all(userId);

  const links = rows.map(row => {
    const coScore = Math.min(1, row.co_count / 3);
    const confScore = ((row.avg_conf_a || 0) + (row.avg_conf_b || 0)) / 2;
    const wScore = ((row.avg_w_a || 0) + (row.avg_w_b || 0)) / 2 / 5;
    const strength = Math.max(0, Math.min(1,
      coScore * 0.5 + confScore * 0.3 + wScore * 0.2
    ));
    return { a: row.a, b: row.b, strength: Math.round(strength * 100) / 100 };
  });

  // 过滤弱关联
  const filtered = links.filter(l => l.strength >= 0.25);

  // 每个节点最多保留 top 6 关联（防爆炸）
  const nodeLinkCount = new Map();
  const capped = [];
  // 先按 strength 降序排，优先保留强关联
  filtered.sort((a, b) => b.strength - a.strength);
  for (const link of filtered) {
    const ca = nodeLinkCount.get(link.a) || 0;
    const cb = nodeLinkCount.get(link.b) || 0;
    if (ca >= 6 || cb >= 6) continue;
    capped.push(link);
    nodeLinkCount.set(link.a, ca + 1);
    nodeLinkCount.set(link.b, cb + 1);
  }

  return capped;
}

/**
 * 获取矿石星图完整数据（节点 + 关联 + 统计）
 * @param {string} userId
 * @returns {{ nodes: Array, links: Array, stats: Object }}
 */
export function getGalaxy(userId) {
  const nodes = getGalaxyNodes(userId);
  const links = getGalaxyLinks(userId);

  const stats = {
    totalNodes: nodes.length,
    activatedNodes: nodes.filter(n => n.active).length,
    totalXp: nodes.reduce((sum, n) => sum + n.xp, 0),
    linksCount: links.length,
  };

  logger.info(`[Galaxy] 用户 ${userId}: ${nodes.length} 节点, ${links.length} 关联, ${stats.activatedNodes} 已激活`);

  return { nodes, links, stats };
}

import db from '../db/index.js';
import { logger } from '../utils/logger.js';

/**
 * 矿石星图服务 v2
 * 动态矿石节点 + 标签分组 + 共现关联
 */

const TAG_COLORS = [
  '#58CC02', '#3B82F6', '#A855F7', '#EF4444',
  '#F59E0B', '#EC4899', '#06B6D4', '#84CC16', '#F97316',
];

const STAGE_THRESHOLDS = [0, 50, 150, 350, 700];

export function calcStage(xp) {
  let stage = 0;
  for (let i = 0; i < STAGE_THRESHOLDS.length; i++) {
    if (xp >= STAGE_THRESHOLDS[i]) stage = i;
  }
  return stage;
}

/**
 * 获取所有矿石节点（含用户状态）
 */
export function getGalaxyNodes(userId) {
  const rows = db.prepare(`
    SELECT
      o.id, o.name, o.description, o.tags, o.color, o.video_count, o.xp_total, o.created_at,
      uo.xp, uo.level, uo.stage, uo.mastery, uo.last_review_at
    FROM ore_nodes o
    LEFT JOIN user_ores uo ON uo.ore_id = o.id AND uo.user_id = ?
    ORDER BY o.xp_total DESC
  `).all(userId);

  return rows.map(row => {
    const xp = row.xp || 0;
    const level = row.level || 0;

    return {
      id: row.id,
      name: row.name,
      description: row.description,
      tags: JSON.parse(row.tags || '[]'),
      color: row.color,
      video_count: row.video_count,
      xp_total: row.xp_total,
      created_at: row.created_at,
      xp,
      level,
      stage: level,
      mastery: row.mastery || 0,
      active: level > 0,
      last_review_at: row.last_review_at,
    };
  });
}

/**
 * 获取共现关联（从 video_ores 自动计算）
 */
export function getGalaxyLinks(userId) {
  const rows = db.prepare(`
    SELECT
      a.ore_id AS a,
      b.ore_id AS b,
      COUNT(*) AS co_count
    FROM video_ores a
    JOIN video_ores b ON a.video_id = b.video_id AND a.ore_id < b.ore_id
    JOIN videos v ON v.id = a.video_id AND v.user_id = ? AND v.status = 'done'
    GROUP BY a.ore_id, b.ore_id
    HAVING co_count >= 1
  `).all(userId);

  const links = rows.map(row => ({
    a: row.a,
    b: row.b,
    strength: Math.round(Math.min(1, row.co_count / 3) * 100) / 100,
  }));

  const filtered = links.filter(l => l.strength >= 0.25);
  const nodeLinkCount = new Map();
  const capped = [];
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
 * 获取标签列表
 */
function getTags() {
  const rows = db.prepare('SELECT name, color, ore_count FROM tags ORDER BY ore_count DESC').all();
  const colorMap = {};
  rows.forEach((t, i) => {
    if (!t.color) t.color = TAG_COLORS[i % TAG_COLORS.length];
    colorMap[t.name] = t.color;
  });
  return { rows, colorMap };
}

/**
 * 获取完整星图数据
 */
export function getGalaxy(userId) {
  const nodes = getGalaxyNodes(userId);
  const links = getGalaxyLinks(userId);
  const { rows: tags } = getTags();

  const stats = {
    totalNodes: nodes.length,
    activatedNodes: nodes.filter(n => n.active).length,
    totalXp: nodes.reduce((sum, n) => sum + n.xp, 0),
    linksCount: links.length,
    tags,
  };

  logger.info(`[Galaxy] ${nodes.length} 矿石, ${links.length} 关联, ${stats.activatedNodes} 已激活`);

  return { nodes, links, stats };
}

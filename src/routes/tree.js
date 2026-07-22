import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { getUserTree, getWeakNodes, getUserStats, getUserTree as getTree } from '../services/treeService.js';
import { getGalaxy } from '../services/galaxyService.js';

const router = Router();
router.use(authRequired);

/**
 * GET /api/tree/galaxy
 * 获取矿石星图数据（42节点 + 共现关联 + 统计）
 */
router.get('/galaxy', (req, res) => {
  const galaxy = getGalaxy(req.userId);
  res.json(galaxy);
});

/**
 * GET /api/tree
 * 获取用户完整知识树
 */
router.get('/', (req, res) => {
  const tree = getUserTree(req.userId);
  res.json(tree);
});

/**
 * GET /api/tree/branch/:branchId
 * 获取某个一级分支的详情
 */
router.get('/branch/:branchId', (req, res) => {
  const { branchId } = req.params;

  const rows = db.prepare(`
    SELECT
      kn.node_id, kn.name, kn.definition, kn.sub_branch,
      kn.top_branch, kn.top_branch_name, kn.color, kn.sort_order,
      un.xp, un.level, un.stage, un.mastery, un.last_review_at
    FROM knowledge_nodes kn
    LEFT JOIN user_nodes un ON un.node_id = kn.node_id AND un.user_id = ?
    WHERE kn.top_branch = ?
    ORDER BY kn.sort_order
  `).all(req.userId, branchId);

  if (rows.length === 0) {
    return res.status(404).json({ error: `分支 ${branchId} 不存在` });
  }

  // 按二级分支组织
  const subBranches = {};
  let branchName = '';
  let branchColor = '';
  for (const row of rows) {
    branchName = row.top_branch_name;
    branchColor = row.color;
    if (!subBranches[row.sub_branch]) {
      subBranches[row.sub_branch] = [];
    }
    subBranches[row.sub_branch].push({
      node_id: row.node_id,
      name: row.name,
      definition: row.definition,
      xp: row.xp || 0,
      level: row.level || 0,
      stage: row.stage || 'undiscovered',
      mastery: row.mastery || 0,
    });
  }

  res.json({
    id: branchId,
    name: branchName,
    color: branchColor,
    sub_branches: subBranches,
    stats: {
      totalNodes: rows.length,
      activatedNodes: rows.filter(r => (r.level || 0) > 0).length,
      totalXp: rows.reduce((sum, r) => sum + (r.xp || 0), 0),
    },
  });
});

/**
 * GET /api/tree/weak
 * 获取弱项节点（mastery 最低的 3 个已激活节点）
 */
router.get('/weak', (req, res) => {
  const count = parseInt(req.query.count) || 3;
  const nodes = getWeakNodes(req.userId, count);
  res.json(nodes);
});

/**
 * GET /api/tree/stats
 * 获取知识树统计信息
 */
router.get('/stats', (req, res) => {
  const stats = getUserStats(req.userId);

  // 按分支统计
  const branchStats = db.prepare(`
    SELECT
      kn.top_branch,
      kn.top_branch_name,
      kn.color,
      COUNT(*) as total,
      SUM(CASE WHEN un.level > 0 THEN 1 ELSE 0 END) as activated,
      SUM(CASE WHEN un.level >= 2 THEN 1 ELSE 0 END) as leafy,
      SUM(CASE WHEN un.level >= 3 THEN 1 ELSE 0 END) as bloomed,
      SUM(un.xp) as total_xp
    FROM knowledge_nodes kn
    LEFT JOIN user_nodes un ON un.node_id = kn.node_id AND un.user_id = ?
    GROUP BY kn.top_branch
    ORDER BY kn.sort_order
  `).all(req.userId);

  res.json({ ...stats, branchStats });
});

export default router;

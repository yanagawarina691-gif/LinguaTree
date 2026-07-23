import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { getUserTree } from '../services/treeService.js';
import { getGalaxy } from '../services/galaxyService.js';

const router = Router();
router.use(authRequired);

/**
 * GET /api/tree/galaxy — 矿石星图数据
 */
router.get('/galaxy', (req, res) => {
  const galaxy = getGalaxy(req.userId);
  res.json(galaxy);
});

/**
 * GET /api/tree — 用户矿石列表
 */
router.get('/', (req, res) => {
  const tree = getUserTree(req.userId);
  res.json(tree);
});

/**
 * GET /api/tree/stats — 统计
 */
router.get('/stats', (req, res) => {
  const ores = db.prepare(`
    SELECT uo.xp, uo.level, uo.stage, uo.mastery
    FROM user_ores uo WHERE uo.user_id = ?
  `).all(req.userId);

  const tags = db.prepare('SELECT name, color, ore_count FROM tags ORDER BY ore_count DESC').all();

  res.json({
    totalOres: ores.length,
    activatedOres: ores.filter(o => (o.level || 0) > 0).length,
    totalXp: ores.reduce((s, o) => s + (o.xp || 0), 0),
    tags,
  });
});

export default router;

import { Router } from 'express';
import { getUserStats } from '../services/treeService.js';
import { attachDemoUser } from '../middleware/demoUser.js';

const router = Router();
router.use(attachDemoUser);

/**
 * GET /api/user/stats
 * 获取用户学习统计
 */
router.get('/stats', (req, res) => {
  const stats = getUserStats(req.userId);
  res.json(stats);
});

export default router;

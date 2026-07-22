import { Router } from 'express';
import { authRequired } from '../middleware/auth.js';
import {
  getCardList,
  getCardDetail,
  getTodayReviewCards,
  getBacklinks,
  recordReview,
} from '../services/cardService.js';
import { logger } from '../utils/logger.js';

const router = Router();
router.use(authRequired);

/**
 * GET /api/cards
 * query: ?review=1 → 仅返回今日推荐复习卡片
 */
router.get('/', (req, res) => {
  try {
    if (req.query.review === '1' || req.query.review === 'true') {
      const count = Math.min(parseInt(req.query.count || '5', 10), 20);
      const cards = getTodayReviewCards(req.userId, count);
      return res.json({ type: 'review', cards });
    }
    const cards = getCardList(req.userId);
    res.json({ type: 'all', cards });
  } catch (err) {
    logger.error(`[API] 获取卡片列表失败: ${err.message}`);
    res.status(500).json({ error: '获取卡片列表失败', message: err.message });
  }
});

/**
 * GET /api/cards/:nodeId
 */
router.get('/:nodeId', (req, res) => {
  try {
    const card = getCardDetail(req.userId, req.params.nodeId);
    if (!card) return res.status(404).json({ error: '知识卡片不存在' });
    res.json(card);
  } catch (err) {
    logger.error(`[API] 获取卡片详情失败: ${err.message}`);
    res.status(500).json({ error: '获取卡片详情失败', message: err.message });
  }
});

/**
 * GET /api/cards/:nodeId/backlinks
 * [BUG-10 修复] 传入 req.userId 过滤 source_videos 归属，防止跨用户展示
 */
router.get('/:nodeId/backlinks', (req, res) => {
  try {
    const backlinks = getBacklinks(req.params.nodeId, req.userId);
    res.json({ backlinks });
  } catch (err) {
    res.status(500).json({ error: '获取双向链接失败', message: err.message });
  }
});

/**
 * POST /api/cards/:nodeId/review
 * body: { quality: number } — 0-100 评分
 */
router.post('/:nodeId/review', (req, res) => {
  try {
    const { quality } = req.body;
    const q = Math.max(0, Math.min(100, parseInt(quality, 10) || 0));
    const result = recordReview(req.userId, req.params.nodeId, q);
    res.json({ ok: true, ...result });
  } catch (err) {
    logger.error(`[API] 记录复习失败: ${err.message}`);
    res.status(500).json({ error: '记录复习失败', message: err.message });
  }
});

export default router;

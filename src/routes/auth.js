import { Router } from 'express';
import db from '../db/index.js';
import { initUserNodes } from '../db/index.js';
import { generateToken, authRequired } from '../middleware/auth.js';
import { nanoid } from 'nanoid';

const router = Router();

/**
 * POST /api/auth/register
 * 注册（demo 阶段免密码验证，直接创建用户）
 */
router.post('/register', (req, res) => {
  const { nickname } = req.body;
  if (!nickname || nickname.trim().length === 0) {
    return res.status(400).json({ error: '请输入昵称' });
  }

  const userId = nanoid(12);
  db.prepare(`
    INSERT INTO users (id, nickname) VALUES (?, ?)
  `).run(userId, nickname.trim());

  // 为新用户初始化知识树
  initUserNodes(userId);

  const token = generateToken(userId, nickname.trim());
  res.json({
    userId,
    nickname: nickname.trim(),
    token,
  });
});

/**
 * POST /api/auth/login
 * 登录（demo 阶段按昵称查找，不验证密码）
 */
router.post('/login', (req, res) => {
  const { nickname } = req.body;
  if (!nickname) {
    return res.status(400).json({ error: '请输入昵称' });
  }

  // demo: 按昵称查找，找不到就创建
  let user = db.prepare('SELECT id, nickname FROM users WHERE nickname = ?').get(nickname.trim());
  if (!user) {
    const userId = nanoid(12);
    db.prepare('INSERT INTO users (id, nickname) VALUES (?, ?)').run(userId, nickname.trim());
    initUserNodes(userId);
    user = { id: userId, nickname: nickname.trim() };
  }

  const token = generateToken(user.id, user.nickname);
  res.json({
    userId: user.id,
    nickname: user.nickname,
    token,
  });
});

/**
 * GET /api/auth/me
 * 获取当前用户信息
 */
router.get('/me', authRequired, (req, res) => {
  const user = db.prepare('SELECT id, nickname, avatar, created_at FROM users WHERE id = ?').get(req.userId);
  if (!user) {
    return res.status(404).json({ error: '用户不存在' });
  }
  res.json(user);
});

export default router;

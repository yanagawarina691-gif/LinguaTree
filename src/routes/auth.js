import { Router } from 'express';
import db from '../db/index.js';
import { generateToken, authRequired } from '../middleware/auth.js';
import { nanoid } from 'nanoid';

const router = Router();

router.post('/register', (req, res) => {
  const { nickname } = req.body;
  if (!nickname || nickname.trim().length === 0) {
    return res.status(400).json({ error: '请输入昵称' });
  }

  const userId = nanoid(12);
  db.prepare('INSERT INTO users (id, nickname) VALUES (?, ?)').run(userId, nickname.trim());

  const token = generateToken(userId, nickname.trim());
  res.json({ userId, nickname: nickname.trim(), token });
});

router.post('/login', (req, res) => {
  const { nickname } = req.body;
  if (!nickname) {
    return res.status(400).json({ error: '请输入昵称' });
  }

  let user = db.prepare('SELECT id, nickname FROM users WHERE nickname = ?').get(nickname.trim());
  if (!user) {
    const userId = nanoid(12);
    db.prepare('INSERT INTO users (id, nickname) VALUES (?, ?)').run(userId, nickname.trim());
    user = { id: userId, nickname: nickname.trim() };
  }

  const token = generateToken(user.id, user.nickname);
  res.json({ userId: user.id, nickname: user.nickname, token });
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

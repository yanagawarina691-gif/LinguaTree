import jwt from 'jsonwebtoken';
import { config } from '../config.js';

/**
 * JWT 认证中间件
 * 从 Authorization: Bearer <token> 中解析用户 ID
 */
export function authRequired(req, res, next) {
  const authHeader = req.headers.authorization;
  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return res.status(401).json({ error: '未提供认证 token，请先登录' });
  }

  const token = authHeader.slice(7);
  try {
    const payload = jwt.verify(token, config.JWT_SECRET);
    req.userId = payload.userId;
    req.userNickname = payload.nickname;
    next();
  } catch (err) {
    return res.status(401).json({ error: 'token 无效或已过期，请重新登录' });
  }
}

/**
 * 生成 JWT token
 */
export function generateToken(userId, nickname) {
  return jwt.sign({ userId, nickname }, config.JWT_SECRET, {
    expiresIn: '30d',
  });
}

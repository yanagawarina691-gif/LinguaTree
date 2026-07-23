import db from '../db/index.js';
import { nanoid } from 'nanoid';

const DEFAULT_USER_ID = 'default';

/**
 * 确保默认用户存在
 */
function ensureDefaultUser() {
  const exists = db.prepare('SELECT id FROM users WHERE id = ?').get(DEFAULT_USER_ID);
  if (!exists) {
    db.prepare('INSERT INTO users (id, nickname) VALUES (?, ?)').run(DEFAULT_USER_ID, 'Learner');
  }
}

/**
 * 无需登录，所有请求使用默认用户
 */
export function authRequired(req, res, next) {
  ensureDefaultUser();
  req.userId = DEFAULT_USER_ID;
  req.userNickname = 'Learner';
  next();
}

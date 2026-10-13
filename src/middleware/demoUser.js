import db from '../db/index.js';

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
 * 通过 demoAccess 访问保护后，所有请求使用同一个演示用户
 */
export function attachDemoUser(req, res, next) {
  ensureDefaultUser();
  req.userId = DEFAULT_USER_ID;
  req.userNickname = 'Learner';
  next();
}

import { createHash, timingSafeEqual } from 'node:crypto';

export function validateDemoAccess({ HOST, NODE_ENV, DEMO_PASSWORD }) {
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
  if ((NODE_ENV === 'production' || !loopback) && !DEMO_PASSWORD) {
    throw new Error('共享演示对外监听或以 production 运行时必须配置 DEMO_PASSWORD');
  }
  if (DEMO_PASSWORD && DEMO_PASSWORD.length < 24) {
    throw new Error('DEMO_PASSWORD 至少需要 24 个字符，请使用随机生成的口令');
  }
}

const digest = (value) => createHash('sha256').update(value).digest();

/** A shared demo access gate, not separate user accounts. */
export function createDemoAccess(settings) {
  validateDemoAccess(settings);
  const expected = settings.DEMO_PASSWORD ? digest(`learner:${settings.DEMO_PASSWORD}`) : null;
  return (req, res, next) => {
    // Block browser requests initiated by unrelated sites, including local demos.
    if (req.get('Sec-Fetch-Site') === 'cross-site') {
      return res.status(403).json({ error: '请从演示页面访问此服务' });
    }
    if (!expected) return next();
    res.set('Cache-Control', 'no-store');
    const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(req.get('Authorization') || '');
    if (match) {
      const credentials = Buffer.from(match[1], 'base64').toString('utf8');
      if (timingSafeEqual(digest(credentials), expected)) return next();
    }
    res.set('WWW-Authenticate', 'Basic realm="LinguaTree personal demo", charset="UTF-8"');
    return res.status(401).json({ error: '此个人演示需要访问口令，用户名为 learner' });
  };
}

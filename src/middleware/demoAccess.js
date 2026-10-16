import { createHash, timingSafeEqual } from 'node:crypto';

export function validateDemoAccess({ HOST, NODE_ENV, DEMO_PASSWORD, PUBLIC_ORIGIN }) {
  const loopback = ['127.0.0.1', 'localhost', '::1'].includes(HOST);
  if ((NODE_ENV === 'production' || !loopback) && !DEMO_PASSWORD) {
    throw new Error('共享演示对外监听或以 production 运行时必须配置 DEMO_PASSWORD');
  }
  if (DEMO_PASSWORD && DEMO_PASSWORD.length < 24) {
    throw new Error('DEMO_PASSWORD 至少需要 24 个字符，请使用随机生成的口令');
  }
  if (PUBLIC_ORIGIN) {
    const url = new URL(PUBLIC_ORIGIN);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password ||
        url.pathname !== '/' || url.search || url.hash) {
      throw new Error('PUBLIC_ORIGIN 必须是完整 http(s) 来源，不含路径、查询或凭据');
    }
  }
}

const digest = (value) => createHash('sha256').update(value).digest();

/** A shared demo access gate, not separate user accounts. */
export function createDemoAccess(settings) {
  validateDemoAccess(settings);
  const expected = settings.DEMO_PASSWORD ? digest(`learner:${settings.DEMO_PASSWORD}`) : null;
  return (req, res, next) => {
    res.set('Cache-Control', 'no-store');
    if (expected) {
      const match = /^Basic ([A-Za-z0-9+/]+={0,2})$/i.exec(req.get('Authorization') || '');
      const accepted = match && timingSafeEqual(digest(Buffer.from(match[1], 'base64').toString('utf8')), expected);
      if (!accepted) {
        res.set('WWW-Authenticate', 'Basic realm="LinguaTree personal demo", charset="UTF-8"');
        return res.status(401).json({ error: '此个人演示需要访问口令，用户名为 learner' });
      }
    }

    const api = /^\/api(?:\/|$)/i.test(req.path);
    const safePageNavigation = !api && req.method === 'GET' &&
      req.get('Sec-Fetch-Mode') === 'navigate' && req.get('Sec-Fetch-Dest') === 'document';
    const site = req.get('Sec-Fetch-Site');
    const forbidden = () => res.status(403).json({ error: '请从演示页面访问此服务' });
    // Let external links reach HTML and the password prompt, never generating APIs.
    if (site && !['same-origin', 'none'].includes(site) && !safePageNavigation) return forbidden();

    if (api) {
      const source = req.get('Origin') || req.get('Referer');
      if (source) {
        try {
          const expectedOrigin = new URL(settings.PUBLIC_ORIGIN || `${req.protocol}://${req.get('host')}`).origin;
          if (new URL(source).origin !== expectedOrigin) return forbidden();
        } catch { return forbidden(); }
      } else if (!site || (site === 'none' && !['GET', 'HEAD'].includes(req.method))) {
        // Legacy browsers and non-browser clients must supply an exact Origin.
        return forbidden();
      }
    }
    return next();
  };
}

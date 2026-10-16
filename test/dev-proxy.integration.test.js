import assert from 'node:assert/strict';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { createServer, loadConfigFromFile } from '../frontend/node_modules/vite/dist/node/index.js';
import { startTestServer } from './helpers/server.js';

test('Vite development proxy preserves browser origin and serves mode/data through dynamic ports', { timeout: 20000 }, async t => {
  const backend = await startTestServer(t);
  const configPath = fileURLToPath(new URL('../frontend/vite.config.js', import.meta.url));
  const loaded = await loadConfigFromFile({ command: 'serve', mode: 'development' }, configPath);
  const config = loaded.config;
  // Keep real proxy options; only point to the isolated test backend.
  config.server.proxy['/api'].target = backend.base;
  config.server.proxy['/health'].target = backend.base;
  const vite = await createServer({
    ...config,
    configFile: false,
    root: fileURLToPath(new URL('../frontend', import.meta.url)),
    logLevel: 'silent',
    server: { ...config.server, host: '127.0.0.1', port: 0, strictPort: true, hmr: false },
  });
  t.after(() => vite.close());
  await vite.listen();
  const origin = `http://127.0.0.1:${vite.httpServer.address().port}`;
  const browserHeaders = {
    Authorization: backend.authorization,
    Origin: origin,
    Referer: origin + '/tree',
    'Sec-Fetch-Site': 'same-origin',
  };
  for (const path of ['/api/info', '/api/videos', '/api/tree']) {
    const response = await fetch(origin + path, { headers: browserHeaders });
    assert.equal(response.status, 200, path);
  }
  const mode = await (await fetch(origin + '/api/info', { headers: browserHeaders })).json();
  assert.equal(mode.readOnly, true);
  const foreign = await fetch(origin + '/api/info', { headers: { ...browserHeaders, Origin: 'https://foreign.example' } });
  assert.equal(foreign.status, 403);
});

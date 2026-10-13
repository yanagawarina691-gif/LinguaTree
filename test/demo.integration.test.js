import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import Database from 'better-sqlite3';
import { validateDemoAccess } from '../src/middleware/demoAccess.js';

// No real model calls and no access to the developer's database or .env file.
test('external and production demos require a strong access password', () => {
  assert.doesNotThrow(() => validateDemoAccess({ HOST: '127.0.0.1', NODE_ENV: 'development', DEMO_PASSWORD: '' }));
  for (const HOST of ['0.0.0.0', '::', '192.168.1.2']) {
    assert.throws(() => validateDemoAccess({ HOST, NODE_ENV: 'development', DEMO_PASSWORD: '' }), /DEMO_PASSWORD/);
  }
  assert.throws(() => validateDemoAccess({ HOST: '127.0.0.1', NODE_ENV: 'production', DEMO_PASSWORD: '' }), /DEMO_PASSWORD/);
  assert.throws(() => validateDemoAccess({ HOST: '127.0.0.1', NODE_ENV: 'development', DEMO_PASSWORD: 'short' }), /24/);
});

test('shared demo protects HTML and APIs while allowing health checks', { timeout: 15000 }, async (t) => {
  const temp = await mkdtemp(join(tmpdir(), 'linguatree-demo-'));
  const dbPath = join(temp, 'test.db');
  const password = randomBytes(24).toString('base64url');
  const child = spawn(process.execPath, ['src/server.js'], {
    cwd: new URL('..', import.meta.url),
    env: { ...process.env, DOTENV_CONFIG_PATH: join(temp, 'absent.env'), HOST: '127.0.0.1', PORT: '0', NODE_ENV: 'production', DEMO_PASSWORD: password, DB_PATH: dbPath, OPENAI_API_KEY: '', DASHSCOPE_API_KEY: '' },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  t.after(async () => {
    if (child.exitCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
    await rm(temp, { recursive: true, force: true });
  });
  const base = await new Promise((resolve, reject) => {
    let output = '';
    let errors = '';
    child.stderr.on('data', data => { errors += data; });
    child.on('error', reject);
    child.on('exit', code => reject(new Error(`server exited ${code}: ${errors}`)));
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/Listening: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) resolve(match[1]);
    });
  });
  const headers = { Authorization: `Basic ${Buffer.from(`learner:${password}`).toString('base64')}` };
  assert.equal((await fetch(base + '/health')).status, 200);
  for (const path of ['/', '/tree', '/api/videos', '/api/tree', '/api/user/stats']) {
    const response = await fetch(base + path);
    assert.equal(response.status, 401, path);
    assert.match(response.headers.get('www-authenticate'), /Basic/);
  }
  assert.equal((await fetch(base + '/api/videos', { headers: { Authorization: 'Basic invalid' } })).status, 401);
  assert.equal((await fetch(base + '/api/videos', { headers: { ...headers, 'Sec-Fetch-Site': 'cross-site' } })).status, 403);
  const page = await fetch(base, { headers });
  assert.equal(page.status, 200);
  assert.match(page.headers.get('content-type'), /html/);
  assert.equal((await fetch(base + '/api/auth/login', { method: 'POST', headers })).status, 404);
  const empty = await fetch(base + '/api/videos', { headers });
  assert.equal(empty.status, 200);
  assert.deepEqual(await empty.json(), []);
  const db = new Database(dbPath);
  try {
    db.prepare("INSERT INTO videos (id, user_id, source_url, title) VALUES ('fixture', 'default', '(manual)', 'Private demo fixture')").run();
  } finally { db.close(); }
  const list = await (await fetch(base + '/api/videos', { headers })).json();
  assert.equal(list[0].title, 'Private demo fixture');
  const blocked = await fetch(base + '/api/videos');
  assert.equal(blocked.status, 401);
  assert.doesNotMatch(await blocked.text(), /Private demo fixture/);
  assert.equal((await fetch(base + '/api/videos/fixture/status', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/tree', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/user/stats', { headers })).status, 200);
  const info = await (await fetch(base + '/api/info', { headers })).json();
  assert.equal(info.mode, 'single-user-demo');
  assert.equal(info.endpoints.auth, undefined);
});

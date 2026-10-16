import assert from 'node:assert/strict';
import { test } from 'node:test';
import { mkdtemp, readFile, writeFile, rm, stat } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { startTestServer, rawRequest } from './helpers/server.js';

test('default demo serves immutable fiction without importing personal code or performing outbound IO', { timeout: 30000 }, async t => {
  const protectedDir = await mkdtemp(join(tmpdir(), 'linguatree-personal-sentinel-'));
  t.after(() => rm(protectedDir, { recursive: true, force: true }));
  const personalPath = join(protectedDir, 'personal.db');
  const tripwire = join(protectedDir, 'unexpected-io.txt');
  const sentinel = 'private personal database sentinel: demo must never open this file';
  await writeFile(personalPath, sentinel);
  const before = await stat(personalPath);
  const { base, headers, temp } = await startTestServer(t, {
    env: {
      APP_MODE: '', DB_PATH: personalPath, DEMO_IO_TRIPWIRE: tripwire,
      OPENAI_API_KEY: 'synthetic-test-key-not-a-real-credential', DASHSCOPE_API_KEY: 'synthetic-test-key',
      OPENAI_BASE_URL: 'http://127.0.0.1:9', DASHSCOPE_BASE_URL: 'http://127.0.0.1:9',
      DOUYIN_PARSE_API: 'http://127.0.0.1:9',
    },
    nodeArgs: ['--experimental-loader', './test/helpers/forbid-personal-loader.js', '--import', './test/helpers/deny-demo-io.js'],
  });
  const get = path => fetch(base + path, { headers });
  const info = await (await get('/api/info')).json();
  assert.equal(info.mode, 'read-only-demo');
  assert.equal(info.readOnly, true);
  assert.equal(info.dataset, 'fictional-pregenerated');
  assert.equal(info.endpoints.videos['POST /api/videos/parse'], undefined);
  assert.equal(info.endpoints.tree['GET /api/tree/branch/:branchId'], undefined);
  assert.equal(info.endpoints.tree['GET /api/tree/weak'], undefined);
  assert.ok(info.endpoints.tree['GET /api/tree/galaxy']);
  for (const path of ['/deepen', '/internalize/flashcards', '/internalize/freeform', '/migration']) {
    assert.ok(info.endpoints.videos[`GET /api/videos/:id${path}`]);
  }

  const listResponse = await get('/api/videos');
  assert.equal(listResponse.status, 200);
  const listBefore = await listResponse.text();
  const videos = JSON.parse(listBefore);
  assert.ok(videos.length >= 2);
  assert.ok(videos.every(video => video.synthetic && video.id.startsWith('demo-')));
  assert.ok(videos.every(video => !video.source_url));
  for (const video of videos) {
    for (const suffix of ['', '/status', '/deepen', '/internalize/flashcards', '/internalize/freeform', '/migration']) {
      const path = `/api/videos/${video.id}${suffix}`;
      const first = await get(path);
      assert.equal(first.status, 200, path);
      assert.equal(first.headers.get('cache-control'), 'no-store');
      const content = await first.text();
      assert.doesNotMatch(content, /private personal database sentinel/);
      assert.equal(await (await get(path + '?regenerate=true')).text(), content, path);
      const head = await fetch(base + path, { method: 'HEAD', headers });
      assert.equal(head.status, 200);
      assert.equal(await head.text(), '');
    }
  }
  for (const path of ['/api/tree', '/api/tree/galaxy', '/api/tree/stats', '/api/user/stats', '/api/ores', '/api/ores/101/knowledge-card']) {
    assert.equal((await get(path)).status, 200, path);
  }

  const writePaths = [
    '/api/videos/parse', '/api/videos/demo-cafe/claim', '/api/videos/demo-cafe/exercises/complete',
    '/api/videos/demo-cafe/deepen', '/api/videos/demo-cafe/deepen/feedback', '/api/videos/demo-cafe/deepen/regenerate',
    '/api/videos/demo-cafe/internalize/flashcards/complete', '/api/videos/demo-cafe/internalize/freeform/evaluate',
    '/api/videos/demo-cafe/migration/evaluate', '/api/ores/101/tags', '/api/ores/101/review',
    '/api/cards/101/review', '/api/future-write-endpoint', '/',
  ];
  for (const path of writePaths) {
    for (const method of ['POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
      const response = await fetch(base + path, { method, headers: { ...headers, 'Content-Type': 'application/json' }, body: '{invalid json' });
      assert.equal(response.status, 403, `${method} ${path}`);
      assert.equal((await response.json()).code, 'DEMO_READ_ONLY');
    }
  }
  for (const path of ['/api/videos/real-private-id/deepen', '/api/videos/demo-cafe/deepen/regenerate', '/api/videos/demo-cafe/deepen/stream', '/api/unknown', '/api/videos/__proto__']) {
    assert.equal((await get(path)).status, 404, path);
  }
  assert.equal(await (await get('/api/videos')).text(), listBefore);
  assert.equal(await readFile(personalPath, 'utf8'), sentinel);
  assert.equal((await stat(personalPath)).mtimeMs, before.mtimeMs);
  await assert.rejects(stat(tripwire), { code: 'ENOENT' });
  await assert.rejects(stat(join(temp, 'media')), { code: 'ENOENT' });
});

test('external document links reach Basic authentication, while API navigation and foreign sources stay blocked', { timeout: 15000 }, async t => {
  const { base, headers, authorization } = await startTestServer(t);
  const navigation = { 'Sec-Fetch-Site': 'cross-site', 'Sec-Fetch-Mode': 'navigate', 'Sec-Fetch-Dest': 'document', 'Sec-Fetch-User': '?1', Referer: 'https://portfolio.example/' };
  for (const path of ['/', '/tree', '/me', '/deepen/demo-cafe']) {
    const unauthenticated = await rawRequest(base + path, { headers: navigation });
    assert.equal(unauthenticated.status, 401);
    assert.match(unauthenticated.headers.get('www-authenticate'), /Basic/);
    const accepted = await rawRequest(base + path, { headers: { ...navigation, Authorization: authorization } });
    assert.equal(accepted.status, 200);
    assert.match(accepted.headers.get('content-type'), /html/);
  }
  for (const site of ['cross-site', 'same-site']) {
    for (const path of ['/api/videos', '/api/videos/demo-cafe/deepen', '/API/videos/demo-cafe/migration']) {
      const response = await rawRequest(base + path, { headers: { ...navigation, 'Sec-Fetch-Site': site, Authorization: authorization } });
      assert.equal(response.status, 403, `${site}: ${path}`);
    }
  }
  assert.equal((await fetch(base + '/api/videos', { headers: { Authorization: authorization } })).status, 403);
  assert.equal((await fetch(base + '/api/videos', { headers: { ...headers, Origin: 'https://foreign.example' } })).status, 403);
  assert.equal((await fetch(base + '/api/videos', { headers: { ...headers, Origin: 'null' } })).status, 403);
  assert.equal((await fetch(base + '/api/videos', { headers: { Authorization: authorization, 'Sec-Fetch-Site': 'same-origin' } })).status, 200);
  assert.equal((await fetch(base + '/api/videos', { headers })).status, 200);
  assert.equal((await fetch(base + '/api/videos', { headers: { Authorization: authorization, Referer: base + '/tree' } })).status, 200);
  assert.equal((await fetch(base + '/api/videos', { headers: { ...headers, Authorization: 'Basic invalid' } })).status, 401);
  assert.equal((await fetch(base + '/api/videos', { method: 'POST' })).status, 401);
  assert.equal((await fetch(base + '/health')).status, 200);
});

test('configured public origin supports HTTPS reverse proxies without trusting forwarded headers', { timeout: 15000 }, async t => {
  const { base, headers, authorization } = await startTestServer(t, { env: { PUBLIC_ORIGIN: 'https://demo.example' } });
  assert.equal((await fetch(base + '/api/videos', { headers })).status, 200);
  const spoofed = await fetch(base + '/api/videos', { headers: { Authorization: authorization, Origin: 'https://foreign.example', 'X-Forwarded-Host': 'foreign.example', 'X-Forwarded-Proto': 'https' } });
  assert.equal(spoofed.status, 403);
});

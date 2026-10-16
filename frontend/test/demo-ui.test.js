import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import React from 'react';
import TestRenderer, { act } from 'react-test-renderer';
import { MemoryRouter } from 'react-router-dom';
import { build } from 'esbuild';

// Exercise actual components and effects without requiring a browser or network.
const bundle = await build({
  stdin: { contents: "export { default as App } from './src/App.jsx'; export { AuthProvider } from './src/context/AuthContext.jsx';",
    resolveDir: fileURLToPath(new URL('../', import.meta.url)), loader: 'jsx' },
  bundle: true, write: false, platform: 'node', format: 'cjs', packages: 'external',
  jsx: 'automatic', loader: { '.css': 'empty' },
});
const module = { exports: {} };
new Function('require', 'module', 'exports', bundle.outputFiles[0].text)(createRequire(import.meta.url), module, module.exports);
const { App, AuthProvider } = module.exports;
const snapshot = JSON.parse(await readFile(new URL('../../src/demo/snapshot.json', import.meta.url), 'utf8'));
const originalFetch = globalThis.fetch;
const DEMO = { mode: 'read-only-demo', readOnly: true, dataset: 'fictional-pregenerated' };
const PERSONAL = { mode: 'single-user-personal', readOnly: false, dataset: null };
let renderer;
let calls;

function fixture(path) {
  if (path === '/api/videos') return snapshot.videos;
  if (path === '/api/tree/galaxy') return snapshot.galaxy;
  if (path === '/api/user/stats') return snapshot.userStats;
  const ore = path.match(/^\/api\/ores\/(\d+)\/knowledge-card$/);
  if (ore) return snapshot.knowledgeCards[ore[1]];
  const video = path.match(/^\/api\/videos\/([^/]+)(.*)$/);
  if (video) {
    const key = { '': 'videoDetails', '/deepen': 'deepen', '/internalize/flashcards': 'flashcards',
      '/internalize/freeform': 'freeform', '/migration': 'migration' }[video[2]];
    return snapshot[key]?.[video[1]];
  }
  return undefined;
}

function mockApi(info = DEMO) {
  calls = [];
  globalThis.fetch = async (path, options = {}) => {
    calls.push({ path, method: options.method || 'GET' });
    if ((options.method || 'GET') !== 'GET') throw new Error(`Unexpected write: ${path}`);
    const data = path === '/api/info' ? (typeof info === 'function' ? await info() : info) : fixture(path);
    return { ok: data !== undefined, status: data === undefined ? 404 : 200,
      json: async () => data === undefined ? { error: '演示内容不存在' } : structuredClone(data) };
  };
}

async function mount(path = '/') {
  await act(async () => {
    renderer = TestRenderer.create(React.createElement(MemoryRouter, { initialEntries: [path],
      future: { v7_startTransition: true, v7_relativeSplatPath: true } },
    React.createElement(AuthProvider, null, React.createElement(App))));
  });
}
const text = () => textOf(renderer.root);
const textOf = node => node.children.map(child => typeof child === 'string' ? child : textOf(child)).join('');
const button = label => renderer.root.findAllByType('button').find(node => textOf(node).includes(label));
async function click(label) {
  const node = button(label);
  assert.ok(node, `Missing button: ${label}`);
  await act(async () => node.props.onClick({ stopPropagation() {} }));
}

afterEach(async () => {
  if (renderer) await act(async () => renderer.unmount());
  renderer = null;
  globalThis.fetch = originalFetch;
});

test('each reachable demo route renders fictional snapshot content without inputs or POST requests', async () => {
  for (const [path, expected] of [
    ['/', '示例课程'], ['/tree', '点击水晶'], ['/ore/101', '以下等级与掌握度为虚构展示数据'],
    ['/deepen/demo-cafe', '浏览预生成练习'], ['/internalize/demo-cafe', '查看参考答案'],
    ['/migration/demo-cafe', '参考表达（预生成）'], ['/me', '示例学习者（虚构）'],
  ]) {
    mockApi();
    await mount(path);
    assert.match(text(), /只读演示 · 虚构示例/, path);
    assert.ok(text().includes(expected), `${path}: missing ${expected}`);
    if (path === '/me') {
      assert.ok(renderer.root.findAllByProps({ className: 'count-up' }).every(node => textOf(node) !== '—'));
    }
    assert.equal(renderer.root.findAllByType('input').length, 0, path);
    assert.equal(renderer.root.findAllByType('textarea').length, 0, path);
    assert.ok(calls.every(call => call.method === 'GET'), path);
    for (const forbidden of ['开始解析', '完成复习 +3 XP', '自定义标签', '提交评估', '我有疑问', '我知道']) {
      assert.ok(!text().includes(forbidden), `${path}: exposed ${forbidden}`);
    }
    await act(async () => renderer.unmount());
    renderer = null;
  }
});

test('browse deepen, flashcards, answers and migration repeatedly without changing progress', async () => {
  mockApi();
  await mount('/deepen/demo-cafe');
  await click('浏览预生成练习');
  assert.match(text(), /内化练习示例/);
  const flashcard = renderer.root.findByProps({ className: 'demo-flashcard' });
  await act(async () => flashcard.props.onClick());
  assert.match(text(), /点击返回正面/);
  await click('下一张');
  assert.match(text(), /2\/4/);
  await click('上一张');
  assert.match(text(), /1\/4/);
  await click('浏览迁移场景');
  assert.match(text(), /不提交回答或产生评分/);
  await click('浏览内化练习');
  await click('返回讲解');
  await click('浏览预生成练习');
  assert.ok(calls.length > 8);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('unknown mode mounts no content pages until the read-only response arrives', async () => {
  let resolveMode;
  mockApi(() => new Promise(resolve => { resolveMode = resolve; }));
  await mount('/internalize/demo-cafe');
  assert.match(text(), /加载中/);
  assert.deepEqual(calls.map(call => call.path), ['/api/info']);
  await act(async () => resolveMode(DEMO));
  assert.match(text(), /内化练习示例/);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('failed or inconsistent mode shows a retry screen and performs no content calls', async () => {
  for (const info of [{ ...DEMO, readOnly: false }, () => { throw new Error('服务连接失败'); }]) {
    mockApi(info);
    await mount('/migration/demo-cafe');
    assert.match(text(), /提交功能已停用/);
    assert.deepEqual(calls.map(call => call.path), ['/api/info']);
    mockApi(DEMO);
    await click('重试连接');
    assert.match(text(), /预生成场景示例/);
    await act(async () => renderer.unmount());
    renderer = null;
  }
});

test('personal mode retains parse, review, tags, feedback and answer controls', async () => {
  for (const [path, expected] of [
    ['/', '开始解析'], ['/ore/101', '完成复习 +3 XP'],
    ['/deepen/demo-cafe', '我有疑问'], ['/internalize/demo-cafe', '我知道'],
    ['/migration/demo-cafe', '提交评估'],
  ]) {
    mockApi(PERSONAL);
    await mount(path);
    assert.ok(text().includes(expected), `${path}: missing ${expected}`);
    assert.ok(!text().includes('只读演示 · 虚构示例'));
    await act(async () => renderer.unmount());
    renderer = null;
  }
});

test('demo tree selection, close, knowledge-card links and Back stay read-only', async () => {
  mockApi();
  await mount('/tree');
  const firstOre = () => renderer.root.findAll(node => node.type === 'div'
    && typeof node.props.className === 'string' && node.props.className.startsWith('snake-ore ')
    && !node.props.className.includes('empty'))[0];
  await act(async () => firstOre().props.onClick());
  assert.ok(button('查看卡片'));
  await click('关闭');
  assert.equal(button('查看卡片'), undefined);
  await act(async () => firstOre().props.onClick());
  await click('查看卡片');
  assert.match(text(), /以下等级与掌握度为虚构展示数据/);
  const tags = renderer.root.findAllByProps({ className: 'card-tag' });
  assert.ok(tags.length > 0);
  assert.ok(tags.every(tag => tag.props.onClick === undefined));
  const backlink = renderer.root.findAllByProps({ className: 'card-backlink-card' })[0];
  if (backlink) {
    await act(async () => backlink.props.onClick());
    assert.match(text(), /知识卡片/);
    await act(async () => renderer.root.findByProps({ className: 'topbar-btn' }).props.onClick());
    assert.match(text(), /知识卡片/);
  }
  await act(async () => renderer.root.findByProps({ className: 'topbar-btn' }).props.onClick());
  assert.match(text(), /点击水晶/);
  assert.ok(calls.every(call => call.method === 'GET'));
});

test('demo internalize never starts the interactive trainer timer', async () => {
  const originalSetInterval = globalThis.setInterval;
  let timerCalls = 0;
  globalThis.setInterval = (...args) => { timerCalls++; return originalSetInterval(...args); };
  try {
    mockApi();
    await mount('/internalize/demo-cafe');
    for (let i = 0; i < 3; i++) await click('下一张');
    assert.equal(button('下一张').props.disabled, true);
    assert.equal(timerCalls, 0);
    assert.ok(calls.every(call => call.method === 'GET'));
  } finally {
    globalThis.setInterval = originalSetInterval;
  }
});

test('personal migration displays the reward returned inside evaluation', async () => {
  mockApi(PERSONAL);
  const read = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    if (path === '/api/videos/demo-cafe/migration/evaluate' && options.method === 'POST') {
      calls.push({ path, method: options.method });
      return { ok: true, status: 200, json: async () => ({
        evaluation: { overall_score: 90, xpGained: 60, criteria_scores: [] },
        treeUpdate: { leveledUp: true, ore_id: 101 },
      }) };
    }
    return read(path, options);
  };
  await mount('/migration/demo-cafe');
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'Could I have a coffee, please?' } }));
  await click('提交评估');
  assert.match(text(), /迁移结果/);
  assert.match(text(), /\+60 XP/);
  assert.ok(text().includes(`知识节点「${snapshot.migration['demo-cafe'].ore_name}」升级了`));
  assert.equal(calls.filter(call => call.method === 'POST').length, 1);
});

test('personal freeform completion displays its server-awarded XP without model calls', async () => {
  mockApi(PERSONAL);
  const read = globalThis.fetch;
  globalThis.fetch = async (path, options = {}) => {
    const response = value => ({ ok: true, status: 200, json: async () => structuredClone(value) });
    if (options.method === 'POST') {
      calls.push({ path, method: options.method });
      if (path.endsWith('/flashcards/complete')) return response({ xpGained: 10 });
      assert.equal(path, '/api/videos/demo-cafe/internalize/freeform/evaluate');
      return response({ evaluation: { overall_score: 85, xpGained: 30, improvement: 'Keep practicing.' }, treeUpdate: { xpGain: 30 } });
    }
    if (path === '/api/videos/demo-cafe') return response({ ...snapshot.videoDetails['demo-cafe'], exercises: {} });
    if (path.endsWith('/flashcards')) return response({ flashcards: snapshot.flashcards['demo-cafe'].flashcards.slice(0, 1) });
    return read(path.split('?')[0], options);
  };
  await mount('/internalize/demo-cafe');
  await click('我知道');
  await act(async () => renderer.root.findByType('textarea').props.onChange({ target: { value: 'Could I have a coffee, please?' } }));
  await click('提交评估');
  assert.match(text(), /内化完成/);
  assert.match(text(), /问答题 85 分 · \+30 XP/);
  assert.equal(calls.filter(call => call.path.endsWith('/freeform/evaluate')).length, 1);
});

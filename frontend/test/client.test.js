import test, { afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { api, configureApiAccess, resetApiAccess } from '../src/api/client.js';
import { reviewCard } from '../src/api/cards.js';
import { reviewOre, updateOreTags } from '../src/api/ores.js';
import {
  parseVideo, claimVideo, completeExercises, completeDeepen, feedbackDeepen,
  evaluateMigration, completeFlashcards, evaluateFreeform,
  getVideoList, getVideoDetail, getDeepen, getFlashcards, getFreeformQuestion, getMigration,
} from '../src/api/videos.js';

const originalFetch = globalThis.fetch;
const DEMO = { mode: 'read-only-demo', readOnly: true, dataset: 'fictional-pregenerated' };
const PERSONAL = { mode: 'single-user-personal', readOnly: false, dataset: null };
const mutations = [
  () => parseVideo('https://example.com/video'),
  () => claimVideo('demo-cafe'),
  () => completeExercises('demo-cafe', []),
  () => completeDeepen('demo-cafe'),
  () => feedbackDeepen('demo-cafe', 'useful'),
  () => evaluateMigration('demo-cafe', 'Example'),
  () => completeFlashcards('demo-cafe', 1),
  () => evaluateFreeform('demo-cafe', 'Example'),
  () => updateOreTags(101, ['example']),
  () => reviewOre(101),
  () => reviewCard(101, 100),
];

function mockFetch() {
  const calls = [];
  globalThis.fetch = async (path, options) => {
    calls.push({ path, options });
    return { ok: true, status: 200, json: async () => ({ ok: true }) };
  };
  return calls;
}

afterEach(() => { resetApiAccess(); globalThis.fetch = originalFetch; });

test('every mutating API wrapper fails closed before mode is known', async () => {
  const calls = mockFetch();
  for (const mutate of mutations) await assert.rejects(mutate, /只读演示/);
  assert.equal(calls.length, 0);
});

test('demo blocks every mutating wrapper and every unsafe HTTP method without fetching', async () => {
  const calls = mockFetch();
  configureApiAccess(DEMO);
  for (const mutate of mutations) await assert.rejects(mutate, /只读演示/);
  for (const method of ['post', 'PUT', 'PATCH', 'DELETE', 'OPTIONS']) {
    await assert.rejects(() => api('/api/anything', { method }), /只读演示/);
  }
  assert.equal(calls.length, 0);
});

test('demo retains GET-only browsing for all pregenerated learning stages', async () => {
  const calls = mockFetch();
  configureApiAccess(DEMO);
  await Promise.all([
    getVideoList(), getVideoDetail('demo-cafe'), getDeepen('demo-cafe'),
    getFlashcards('demo-cafe'), getFreeformQuestion('demo-cafe'), getMigration('demo-cafe'),
  ]);
  assert.equal(calls.length, 6);
  assert.ok(calls.every(call => !call.options.method || call.options.method === 'GET'));
});

test('only explicit personal mode permits existing interactive API wrappers', async () => {
  const calls = mockFetch();
  configureApiAccess(PERSONAL);
  for (const mutate of mutations) await mutate();
  assert.equal(calls.length, mutations.length);
  assert.ok(calls.every(call => call.options.method === 'POST'));
});

test('invalid, inconsistent or missing mode resets any prior write permission', async () => {
  const calls = mockFetch();
  for (const info of [null, {}, { readOnly: false }, { ...DEMO, readOnly: false },
    { ...PERSONAL, readOnly: true }, { ...PERSONAL, dataset: 'fictional-pregenerated' },
    { ...DEMO, dataset: null }, { ...PERSONAL, mode: 'unknown' }]) {
    configureApiAccess(PERSONAL);
    assert.throws(() => configureApiAccess(info), /无法确认运行模式/);
    await assert.rejects(() => reviewOre(101), /只读演示/);
  }
  assert.equal(calls.length, 0);
});

test('a mode reset closes the client after a personal session', async () => {
  const calls = mockFetch();
  configureApiAccess(PERSONAL);
  resetApiAccess();
  await assert.rejects(() => reviewOre(101), /只读演示/);
  assert.equal(calls.length, 0);
});

test('malformed API responses surface a useful retry error', async () => {
  globalThis.fetch = async () => ({ ok: false, status: 503, json: async () => { throw new Error('not json'); } });
  await assert.rejects(() => api('/api/info'), /无效响应.*503/);
});

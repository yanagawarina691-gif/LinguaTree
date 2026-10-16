import assert from 'node:assert/strict';
import { test } from 'node:test';
import { spawnSync } from 'node:child_process';
import { mkdtemp, readFile, rm, stat, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

test('documented migration commands preserve demo data and initialize the configured personal database', async t => {
  const temp = await mkdtemp(join(tmpdir(), 'linguatree-migrate-'));
  t.after(() => rm(temp, { recursive: true, force: true }));
  const existing = join(temp, 'untouched.db');
  await writeFile(existing, 'personal data must remain untouched');
  const run = (mode, database) => spawnSync(process.execPath, ['src/db/migrate.js'], {
    cwd: new URL('..', import.meta.url), encoding: 'utf8', timeout: 10000,
    env: { ...process.env, DOTENV_CONFIG_PATH: join(temp, 'absent.env'),
      APP_MODE: mode, DB_PATH: database, OPENAI_API_KEY: '', DASHSCOPE_API_KEY: '' },
  });
  const demo = run('demo', existing);
  assert.equal(demo.status, 0, demo.stderr);
  assert.match(demo.stdout, /不需要数据库迁移/);
  assert.equal(await readFile(existing, 'utf8'), 'personal data must remain untouched');

  const database = join(temp, 'custom-personal.db');
  const personal = run('personal', database);
  assert.equal(personal.status, 0, personal.stderr);
  assert.ok(personal.stdout.includes(`Database file: ${database}`));
  assert.ok((await stat(database)).size > 0);
  assert.equal((await readFile(database)).subarray(0, 15).toString(), 'SQLite format 3');
  assert.equal(run('personal', database).status, 0, 'migration can be run twice');
});

import { spawn } from 'node:child_process';
import { once } from 'node:events';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomBytes } from 'node:crypto';
import http from 'node:http';

// Node fetch overwrites Sec-Fetch-Mode; use raw HTTP to reproduce navigation metadata.
export function rawRequest(url, { method = 'GET', headers = {} } = {}) {
  return new Promise((resolve, reject) => {
    const request = http.request(url, { method, headers }, response => {
      const chunks = [];
      response.on('data', chunk => chunks.push(chunk));
      response.on('end', () => resolve({
        status: response.statusCode,
        headers: new Headers(response.headers),
        text: async () => Buffer.concat(chunks).toString('utf8'),
      }));
      response.on('error', reject);
    });
    request.on('error', reject);
    request.end();
  });
}

export async function startTestServer(t, { mode = 'demo', env = {}, nodeArgs = [] } = {}) {
  const temp = await mkdtemp(join(tmpdir(), 'linguatree-safe-demo-'));
  const password = randomBytes(24).toString('base64url');
  const child = spawn(process.execPath, [...nodeArgs, 'src/server.js'], {
    cwd: new URL('../..', import.meta.url),
    env: {
      ...process.env,
      DOTENV_CONFIG_PATH: join(temp, 'absent.env'),
      APP_MODE: mode, HOST: '127.0.0.1', PORT: '0', NODE_ENV: 'production',
      DEMO_PASSWORD: password, PUBLIC_ORIGIN: '', DB_PATH: join(temp, 'test.db'),
      OPENAI_API_KEY: '', DASHSCOPE_API_KEY: '', TEMP_DIR: join(temp, 'media'),
      ...env,
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  let stderr = '';
  child.stderr.on('data', data => { stderr += data; });
  t.after(async () => {
    if (child.exitCode === null && child.signalCode === null) {
      const closed = once(child, 'close');
      child.kill();
      await closed;
    }
    await rm(temp, { recursive: true, force: true });
  });
  const base = await new Promise((resolve, reject) => {
    let output = '';
    const timeout = setTimeout(() => reject(new Error(`server startup timed out: ${stderr}`)), 10000);
    child.once('error', error => { clearTimeout(timeout); reject(error); });
    child.once('exit', code => { clearTimeout(timeout); reject(new Error(`server exited ${code}: ${stderr}`)); });
    child.stdout.on('data', data => {
      output += data;
      const match = output.match(/Listening: (http:\/\/127\.0\.0\.1:\d+)/);
      if (match) { clearTimeout(timeout); resolve(match[1]); }
    });
  });
  const authorization = `Basic ${Buffer.from(`learner:${password}`).toString('base64')}`;
  const headers = { Authorization: authorization, Origin: env.PUBLIC_ORIGIN || base };
  return { base, temp, headers, authorization, child, stderr: () => stderr };
}

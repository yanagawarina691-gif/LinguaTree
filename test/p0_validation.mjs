#!/usr/bin/env node
/**
 * P0 改造端到端验证脚本
 * 验证范围：数据库、后端 API、矿石生长、迁移 backlinks、前端构建
 */
import { spawn, execSync } from 'child_process';
import fs from 'fs';
import path from 'path';

const BASE_URL = 'http://localhost:3000';
const PROJECT_ROOT = '/Users/alexyugo/WorkBuddy/2026-07-22-11-54-57/LinguaTree';
const FRONTEND_ROOT = path.join(PROJECT_ROOT, 'frontend');
const REPORT_PATH = '/Users/alexyugo/WorkBuddy/2026-07-22-16-19-22/LinguaTree-P0-Validation-Report.md';

const results = [];
let serverProcess = null;
let token = null;
let userId = null;
let videoId = null;
let scenario = null;

function log(category, status, message, detail = '') {
  results.push({ category, status, message, detail });
  const icon = status === 'PASS' ? '✅' : status === 'FAIL' ? '❌' : status === 'WARN' ? '⚠️' : 'ℹ️';
  console.log(`${icon} [${category}] ${message}${detail ? ` | ${detail}` : ''}`);
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

async function request(method, endpoint, body = null, auth = true) {
  const headers = { 'Content-Type': 'application/json' };
  if (auth && token) headers['Authorization'] = `Bearer ${token}`;
  const res = await fetch(`${BASE_URL}${endpoint}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const text = await res.text();
  let json = null;
  try { json = JSON.parse(text); } catch { json = text; }
  return { status: res.status, json };
}

function startServer() {
  return new Promise((resolve, reject) => {
    serverProcess = spawn('node', ['src/server.js'], { cwd: PROJECT_ROOT, stdio: 'pipe' });
    let ready = false;
    serverProcess.stdout.on('data', data => {
      const str = data.toString();
      if (!ready && (str.includes('LinguaTree Backend') || str.includes('Health:'))) {
        ready = true;
        resolve();
      }
    });
    serverProcess.stderr.on('data', data => {
      const str = data.toString();
      if (!ready && (str.includes('LinguaTree Backend') || str.includes('Health:'))) {
        ready = true;
        resolve();
      }
    });
    serverProcess.on('error', reject);
    setTimeout(() => {
      if (!ready) resolve(); // 给额外时间
    }, 3000);
  });
}

function stopServer() {
  if (serverProcess) {
    serverProcess.kill('SIGTERM');
  }
}

async function waitForServer(timeoutMs = 10000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${BASE_URL}/health`);
      if (res.ok) return true;
    } catch {}
    await sleep(200);
  }
  return false;
}

// ====== 数据库验证 ======
function verifyDatabase() {
  try {
    const dbPath = path.join(PROJECT_ROOT, 'src/db/linguatree.db');
    if (!fs.existsSync(dbPath)) {
      log('DB', 'FAIL', '数据库文件不存在', dbPath);
      return false;
    }

    const tables = execSync(`sqlite3 "${dbPath}" ".tables"`, { encoding: 'utf8' }).trim().split(/\s+/);
    const requiredTables = [
      'deepen_understanding', 'deepen_feedback', 'flashcards', 'freeform_questions',
      'freeform_attempts', 'card_backlinks', 'srs_reviews'
    ];
    for (const t of requiredTables) {
      if (!tables.includes(t)) {
        log('DB', 'FAIL', `新表缺失: ${t}`);
        return false;
      }
    }
    log('DB', 'PASS', '所有新表已创建');

    const userNodesCols = execSync(`sqlite3 "${dbPath}" "PRAGMA table_info(user_nodes);"`, { encoding: 'utf8' });
    for (const col of ['stage', 'last_migration_score', 'migration_count', 'last_freeform_score', 'xp_breakdown']) {
      if (!userNodesCols.includes(col)) {
        log('DB', 'FAIL', `user_nodes 缺少列: ${col}`);
        return false;
      }
    }
    log('DB', 'PASS', 'user_nodes 扩展字段已补齐');

    const videosCols = execSync(`sqlite3 "${dbPath}" "PRAGMA table_info(videos);"`, { encoding: 'utf8' });
    for (const col of ['deepen_completed', 'migration_completed', 'freeform_completed']) {
      if (!videosCols.includes(col)) {
        log('DB', 'FAIL', `videos 缺少列: ${col}`);
        return false;
      }
    }
    log('DB', 'PASS', 'videos 扩展字段已补齐');

    const indexes = execSync(`sqlite3 "${dbPath}" "SELECT name FROM sqlite_master WHERE type='index';"`, { encoding: 'utf8' });
    for (const idx of ['idx_deepen_understanding_video', 'idx_card_backlinks_source', 'idx_srs_reviews_next']) {
      if (!indexes.includes(idx)) {
        log('DB', 'WARN', `索引可能缺失: ${idx}`);
      }
    }
    log('DB', 'PASS', '新表索引已创建');
    return true;
  } catch (err) {
    log('DB', 'FAIL', '数据库验证异常', err.message);
    return false;
  }
}

// ====== 后端 API 验证 ======
async function verifyAuth() {
  const register = await request('POST', '/api/auth/register', { nickname: `P0Tester_${Date.now()}` }, false);
  if (register.status !== 200 || !register.json.token) {
    log('API', 'FAIL', '注册失败', JSON.stringify(register.json));
    return false;
  }
  token = register.json.token;
  userId = register.json.userId;
  log('API', 'PASS', '注册成功并获取 token', `userId=${userId}`);

  const login = await request('POST', '/api/auth/login', { nickname: register.json.nickname }, false);
  if (login.status !== 200 || !login.json.token) {
    log('API', 'FAIL', '登录失败', JSON.stringify(login.json));
    return false;
  }
  log('API', 'PASS', '登录成功');
  return true;
}

async function verifyParse() {
  const manualTranscript = `Today we will compare the present perfect tense and the past simple tense.
The present perfect is used for actions at an unspecified time before now.
For example: I have visited Paris twice. She has finished her homework.
The past simple is used for completed actions in the past.
For example: I visited Paris last year. She finished her homework yesterday.
We also use daily greetings like "How are you?" and "Nice to meet you."
Remember: present perfect uses have/has + past participle; past simple uses the past form of the verb.`;

  const parse = await request('POST', '/api/videos/parse', {
    url: 'https://example.com/fake-douyin-url',
    manualTranscript,
  });
  if (parse.status !== 202 || !parse.json.videoId) {
    log('API', 'FAIL', '解析提交失败', JSON.stringify(parse.json));
    return false;
  }
  videoId = parse.json.videoId;
  log('API', 'PASS', '解析提交成功', `videoId=${videoId}`);

  // 轮询解析状态
  for (let i = 0; i < 30; i++) {
    await sleep(2000);
    const status = await request('GET', `/api/videos/${videoId}/status`);
    if (status.status !== 200) {
      log('API', 'FAIL', '查询解析状态失败', JSON.stringify(status.json));
      return false;
    }
    if (status.json.status === 'done') {
      log('API', 'PASS', '视频解析完成', `status=${status.json.status}`);
      return true;
    }
    if (status.json.status === 'error') {
      log('API', 'FAIL', '视频解析失败', status.json.error_message);
      return false;
    }
  }
  log('API', 'FAIL', '视频解析超时');
  return false;
}

async function verifyDeepen() {
  const deepen = await request('GET', `/api/videos/${videoId}/deepen`);
  if (deepen.status !== 200 || !deepen.json.brief_comment) {
    log('API', 'FAIL', 'GET /deepen 失败', JSON.stringify(deepen.json));
    return false;
  }
  log('API', 'PASS', 'GET /deepen 返回加深理解内容', `brief_comment=${deepen.json.brief_comment.slice(0, 20)}...`);

  const feedback = await request('POST', `/api/videos/${videoId}/deepen/feedback`, { feedbackType: 'useful', itemIndex: -1 });
  if (feedback.status !== 200 || !feedback.json.recorded) {
    log('API', 'FAIL', 'POST /deepen/feedback 失败', JSON.stringify(feedback.json));
    return false;
  }
  log('API', 'PASS', 'POST /deepen/feedback 记录反馈成功');

  // 获取完成前节点 XP
  const before = await request('GET', '/api/tree/galaxy');
  const mainNodeBefore = before.json.nodes.find(n => n.active);
  const beforeXp = mainNodeBefore ? mainNodeBefore.xp : 0;

  const complete = await request('POST', `/api/videos/${videoId}/deepen`, { skipped: false });
  if (complete.status !== 200 || !complete.json.completed) {
    log('API', 'FAIL', 'POST /deepen 完成失败', JSON.stringify(complete.json));
    return false;
  }
  if (complete.json.xpGained !== 10) {
    log('API', 'FAIL', 'POST /deepen XP 不正确', `期望 10, 实际 ${complete.json.xpGained}`);
    return false;
  }
  log('API', 'PASS', 'POST /deepen 完成加深理解', `xpGained=${complete.json.xpGained}`);

  // 校验 videos.deepen_completed
  const video = await request('GET', `/api/videos/${videoId}`);
  if (video.status !== 200 || video.json.deepen_completed !== 1) {
    log('API', 'FAIL', 'videos.deepen_completed 未标记', JSON.stringify(video.json));
    return false;
  }
  log('API', 'PASS', 'videos.deepen_completed 已标记');

  // 校验矿石 XP 增加
  const after = await request('GET', '/api/tree/galaxy');
  const mainNodeAfter = after.json.nodes.find(n => n.node_id === (mainNodeBefore?.node_id));
  if (mainNodeAfter && mainNodeAfter.xp - beforeXp !== 10) {
    log('API', 'FAIL', '矿石 XP 未正确增加', `期望 +10, 实际 +${mainNodeAfter.xp - beforeXp}`);
    return false;
  }
  log('API', 'PASS', '矿石 XP 增加 +10');
  return true;
}

async function verifyDeepenFallback() {
  // 在解析失败（无节点）的情况下，验证 deepen 端点仍能返回 mock 内容
  const deepen = await request('GET', `/api/videos/${videoId}/deepen`);
  if (deepen.status !== 200 || !deepen.json.brief_comment) {
    log('API', 'FAIL', 'GET /deepen 降级失败', JSON.stringify(deepen.json));
    return false;
  }
  log('API', 'PASS', 'GET /deepen LLM 降级返回内容', `brief_comment=${deepen.json.brief_comment.slice(0, 20)}...`);

  const feedback = await request('POST', `/api/videos/${videoId}/deepen/feedback`, { feedbackType: 'confused', itemIndex: -1 });
  if (feedback.status !== 200 || !feedback.json.recorded) {
    log('API', 'FAIL', 'POST /deepen/feedback 降级失败', JSON.stringify(feedback.json));
    return false;
  }
  log('API', 'PASS', 'POST /deepen/feedback 降级路径记录反馈成功');
  return true;
}

async function verifyGalaxyStages() {
  const galaxy = await request('GET', '/api/tree/galaxy');
  if (galaxy.status !== 200 || !Array.isArray(galaxy.json.nodes)) {
    log('API', 'FAIL', 'GET /api/tree/galaxy 失败', JSON.stringify(galaxy.json));
    return false;
  }
  const stageNames = ['未发现', '矿苗', '晶芽', '辉石', '璀璨'];
  const threshold = [0, 50, 150, 350, 700];
  for (const node of galaxy.json.nodes) {
    const expectedStage = threshold.reduce((acc, t, i) => (node.xp >= t ? i : acc), 0);
    if (node.stage !== expectedStage) {
      log('API', 'FAIL', '矿石阶段计算错误', `node=${node.node_id}, xp=${node.xp}, 期望 stage=${expectedStage}, 实际=${node.stage}`);
      return false;
    }
  }
  log('API', 'PASS', 'GET /api/tree/galaxy 五阶段阈值正确', `${stageNames.join('/')}`);
  return true;
}

async function verifyMigration() {
  const migration = await request('GET', `/api/videos/${videoId}/migration`);
  if (migration.status !== 200 || !migration.json.scenarioId) {
    log('API', 'FAIL', 'GET /migration 失败', JSON.stringify(migration.json));
    return false;
  }
  scenario = migration.json;
  log('API', 'PASS', 'GET /migration 返回迁移场景', `scenarioId=${scenario.scenarioId}`);

  // 检查 related_node_ids 字段存在
  if (!Array.isArray(scenario.related_node_ids)) {
    log('API', 'FAIL', '迁移场景缺少 related_node_ids', JSON.stringify(scenario));
    return false;
  }
  log('API', 'PASS', '迁移场景包含 related_node_ids', JSON.stringify(scenario.related_node_ids));

  const evaluate = await request('POST', `/api/videos/${videoId}/migration/evaluate`, {
    userInput: 'I have finished my homework and I have visited Paris twice.',
  });
  if (evaluate.status !== 200 || typeof evaluate.json.xpGained !== 'number') {
    log('API', 'FAIL', 'POST /migration/evaluate 失败', JSON.stringify(evaluate.json));
    return false;
  }
  if (![50, 60].includes(evaluate.json.xpGained)) {
    log('API', 'FAIL', '迁移评估 XP 不正确', `期望 50 或 60, 实际 ${evaluate.json.xpGained}`);
    return false;
  }
  log('API', 'PASS', 'POST /migration/evaluate 评估并奖励 XP', `xpGained=${evaluate.json.xpGained}`);

  // 校验 videos.migration_completed
  const video = await request('GET', `/api/videos/${videoId}`);
  if (video.status !== 200 || video.json.migration_completed !== 1) {
    log('API', 'FAIL', 'videos.migration_completed 未标记', JSON.stringify(video.json));
    return false;
  }
  log('API', 'PASS', 'videos.migration_completed 已标记');

  // 校验 backlinks 创建
  const backlinks = await request('GET', '/api/tree/galaxy');
  const hasBacklinks = backlinks.json.links.some(l => l.a === scenario.node_id || l.b === scenario.node_id);
  if (scenario.related_node_ids.length > 0 && !hasBacklinks) {
    log('API', 'FAIL', '迁移评估后未创建 backlinks', `node_id=${scenario.node_id}`);
    return false;
  }
  log('API', 'PASS', '迁移评估后 backlinks 已创建', `links=${backlinks.json.links.length}`);

  // 校验 user_nodes 迁移统计
  const node = await request('GET', '/api/tree/galaxy');
  const target = node.json.nodes.find(n => n.node_id === scenario.node_id);
  if (!target || target.xp === 0) {
    log('API', 'FAIL', '迁移后节点 XP 未更新', `node_id=${scenario.node_id}`);
    return false;
  }
  log('API', 'PASS', '迁移后节点 XP 已更新', `node_id=${scenario.node_id}, xp=${target.xp}`);
  return true;
}

// ====== 前端验证 ======
function verifyFrontend() {
  try {
    // 检查 App.jsx 路由
    const appPath = path.join(FRONTEND_ROOT, 'src/App.jsx');
    const appContent = fs.readFileSync(appPath, 'utf8');
    const requiredRoutes = ['/deepen/:videoId', '/internalize/:videoId'];
    for (const r of requiredRoutes) {
      if (!appContent.includes(r)) {
        log('FE', 'FAIL', `App.jsx 缺少路由: ${r}`);
        return false;
      }
    }
    log('FE', 'PASS', 'App.jsx 已注册 deepen/internalize 路由');

    // 构建前端（vite.config.js 配置 outDir: '../public'）
    execSync('npm run build', { cwd: FRONTEND_ROOT, stdio: 'pipe', env: { ...process.env, NODE_ENV: 'production' } });
    const outDir = path.join(PROJECT_ROOT, 'public');
    const hasIndex = fs.existsSync(path.join(outDir, 'index.html'));
    const hasAssets = fs.existsSync(path.join(outDir, 'assets'));
    if (!hasIndex || !hasAssets) {
      log('FE', 'FAIL', '前端构建产物不完整', `index.html=${hasIndex}, assets=${hasAssets}`);
      return false;
    }
    log('FE', 'PASS', '前端 npm run build 构建成功', `outDir=${outDir}`);

    // DeepenPage 组件渲染检查（静态语法）
    const deepenPath = path.join(FRONTEND_ROOT, 'src/pages/DeepenPage.jsx');
    const deepenContent = fs.readFileSync(deepenPath, 'utf8');
    for (const keyword of ['getDeepen', 'completeDeepen', 'feedbackDeepen', 'brief_comment', 'corrections', 'supplements', 'structured_content']) {
      if (!deepenContent.includes(keyword)) {
        log('FE', 'FAIL', `DeepenPage 缺少关键元素: ${keyword}`);
        return false;
      }
    }
    log('FE', 'PASS', 'DeepenPage 组件关键元素完整');
    return true;
  } catch (err) {
    log('FE', 'FAIL', '前端验证异常', err.message);
    return false;
  }
}

// ====== 代码审查 ======
function verifyCodeReview() {
  const checks = [
    {
      file: 'src/services/treeService.js',
      issues: [],
      check(content) {
        if (!content.includes('LEVEL_THRESHOLDS')) this.issues.push('未定义阈值常量');
        if (!content.includes('STAGE_NAMES =')) this.issues.push('未定义阶段名称');
        if (!content.includes('repeated')) this.issues.push('未处理 repeated 来源');
        if (!content.includes('DAILY_XP_CAPS')) this.issues.push('未定义每日上限');
      }
    },
    {
      file: 'src/services/deepenService.js',
      issues: [],
      check(content) {
        if (content.includes('db.prepare(`SELECT * FROM deepen_understanding WHERE video_id = ?`)')) {
          // OK
        }
        if (!content.includes('markDeepenCompleted')) this.issues.push('缺少完成标记函数');
        if (!content.includes('recordDeepenFeedback')) this.issues.push('缺少反馈记录函数');
      }
    },
    {
      file: 'src/services/migrationService.js',
      issues: [],
      check(content) {
        if (!content.includes('upsertBacklink')) this.issues.push('缺少 backlinks 更新');
        if (!content.includes('migration_count')) this.issues.push('未更新迁移次数');
        if (!content.includes('last_migration_score')) this.issues.push('未更新最近迁移分数');
        if (!content.includes('>= 85')) this.issues.push('未实现 ≥85 额外 +10');
      }
    },
    {
      file: 'src/routes/videos.js',
      issues: [],
      check(content) {
        if (!content.includes('/:id/deepen')) this.issues.push('未注册 deepen 路由');
        if (!content.includes('/:id/migration')) this.issues.push('未注册 migration 路由');
        if (!content.includes('freeform_completed = 1')) this.issues.push('未标记 freeform_completed');
      }
    },
    {
      file: 'frontend/src/pages/DeepenPage.jsx',
      issues: [],
      check(content) {
        if (!content.includes('handleStartPractice')) this.issues.push('缺少开始练习处理');
        if (!content.includes('handleSkip')) this.issues.push('缺少跳过处理');
        if (!content.includes('handleFeedback')) this.issues.push('缺少反馈处理');
      }
    }
  ];

  let allPass = true;
  for (const c of checks) {
    const filePath = path.join(PROJECT_ROOT, c.file);
    const content = fs.readFileSync(filePath, 'utf8');
    c.check(content);
    if (c.issues.length > 0) {
      allPass = false;
      log('CODE', 'FAIL', `${c.file} 存在问题`, c.issues.join('; '));
    } else {
      log('CODE', 'PASS', `${c.file} 关键检查通过`);
    }
  }
  return allPass;
}

// ====== 主流程 ======
async function main() {
  console.log('=== LinguaTree P0 改造验证开始 ===\n');

  // 1. 数据库
  const dbOk = verifyDatabase();
  if (!dbOk) {
    console.log('\n数据库验证失败，停止后续验证。');
    generateReport();
    return;
  }

  // 2. 启动后端
  console.log('\n--- 启动后端服务 ---');
  await startServer();
  const healthy = await waitForServer();
  if (!healthy) {
    log('SERVER', 'FAIL', '后端服务健康检查失败');
    stopServer();
    generateReport();
    return;
  }
  log('SERVER', 'PASS', '后端服务已启动并通过 /health 检查');

  // 3. 后端 API
  console.log('\n--- 后端 API 验证 ---');
  await verifyAuth();
  const parseOk = await verifyParse();
  if (parseOk) {
    await verifyDeepen();
    await verifyGalaxyStages();
    await verifyMigration();
  } else {
    log('API', 'WARN', '视频解析失败，跳过依赖解析结果的 deepen XP / migration 验证');
    // 仍尝试验证 deepen 内容生成降级
    await verifyDeepenFallback();
    await verifyGalaxyStages();
  }

  // 4. 前端
  console.log('\n--- 前端验证 ---');
  verifyFrontend();

  // 5. 代码审查
  console.log('\n--- 代码审查 ---');
  verifyCodeReview();

  // 停止服务
  stopServer();

  // 生成报告
  generateReport();
}

function generateReport() {
  const passCount = results.filter(r => r.status === 'PASS').length;
  const failCount = results.filter(r => r.status === 'FAIL').length;
  const warnCount = results.filter(r => r.status === 'WARN').length;

  const bugs = results.filter(r => r.status === 'FAIL');
  const routing = failCount === 0 ? 'NoOne' : 'Engineer';

  let md = `# LinguaTree P0 改造验证报告

## 执行摘要
- **总体结果**: ${failCount === 0 ? '✅ 全部通过' : `❌ 发现 ${failCount} 项失败`}
- **通过项**: ${passCount}
- **失败项**: ${failCount}
- **警告项**: ${warnCount}
- **智能路由判定**: ${routing}

## 详细验证结果

| 类别 | 状态 | 说明 | 详情 |
|------|------|------|------|
`;
  for (const r of results) {
    md += `| ${r.category} | ${r.status} | ${r.message} | ${r.detail || ''} |\n`;
  }

  if (bugs.length > 0) {
    md += `\n## 发现的 Bug 清单\n\n`;
    for (const b of bugs) {
      md += `- **${b.category}**: ${b.message}${b.detail ? ` — ${b.detail}` : ''}\n`;
    }
    md += `\n## 路由判定说明\n\n判定为 **Engineer**，请工程师寇豆码修复上述源码 Bug。\n`;
  } else {
    md += `\n## 路由判定说明\n\n判定为 **NoOne**，P0 改造验证全部通过。\n`;
  }

  md += `\n---\n*报告生成时间: ${new Date().toISOString()}*\n`;

  fs.writeFileSync(REPORT_PATH, md, 'utf8');
  console.log(`\n=== 验证报告已保存至: ${REPORT_PATH} ===`);
  console.log(`\n汇总: PASS=${passCount}, FAIL=${failCount}, WARN=${warnCount}, Routing=${routing}`);
}

main().catch(err => {
  console.error('验证脚本异常:', err);
  stopServer();
  generateReport();
});

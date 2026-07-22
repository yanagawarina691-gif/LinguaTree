import Database from 'better-sqlite3';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const DB_PATH = join(__dirname, 'linguatree.db');
const SCHEMA_PATH = join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * 初始化数据库 schema
 */
export function initSchema() {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);

  // 兼容已有数据库：为旧库补加 v2 新增列（SQLite 不支持 ADD COLUMN IF NOT EXISTS）
  const migrations = [
    `ALTER TABLE videos ADD COLUMN deepen_completed INTEGER DEFAULT 0`,
    `ALTER TABLE videos ADD COLUMN migration_completed INTEGER DEFAULT 0`,
    `ALTER TABLE videos ADD COLUMN freeform_completed INTEGER DEFAULT 0`,
  ];
  for (const sql of migrations) {
    try {
      db.exec(sql);
    } catch (e) {
      if (!e.message.includes('duplicate column name')) throw e;
    }
  }

  console.log('[DB] Schema initialized');
}

/**
 * 从 JSON 种子知识树数据到数据库
 */
export function seedKnowledgeTree() {
  const treePath = join(__dirname, '..', 'data', 'knowledgeTree.json');
  const treeData = JSON.parse(readFileSync(treePath, 'utf-8'));

  // 检查是否已 seed
  const existing = db.prepare('SELECT COUNT(*) as count FROM knowledge_nodes').get();
  if (existing.count > 0) {
    console.log(`[DB] Knowledge tree already seeded (${existing.count} nodes), skipping`);
    return;
  }

  const insertNode = db.prepare(`
    INSERT INTO knowledge_nodes (node_id, name, definition, sub_branch, top_branch, top_branch_name, color, sort_order)
    VALUES (@node_id, @name, @definition, @sub_branch, @top_branch, @top_branch_name, @color, @sort_order)
  `);

  let order = 0;
  const allLeaves = [];

  for (const branch of treeData.branches) {
    for (const subBranch of branch.sub_branches) {
      for (const leaf of subBranch.leaves) {
        allLeaves.push({
          node_id: leaf.node_id,
          name: leaf.name,
          definition: leaf.definition,
          sub_branch: subBranch.name,
          top_branch: branch.id,
          top_branch_name: branch.name,
          color: branch.color,
          sort_order: order++
        });
      }
    }
  }

  const insertMany = db.transaction((nodes) => {
    for (const node of nodes) {
      insertNode.run(node);
    }
  });

  insertMany(allLeaves);

  // 添加 unclassified 特殊节点（用于未分类知识点）
  insertNode.run({
    node_id: 'unclassified',
    name: '未分类知识点',
    definition: '不在知识树预定义节点中的英语知识点',
    sub_branch: '其他',
    top_branch: 'other',
    top_branch_name: '其他',
    color: '#999999',
    sort_order: order++
  });

  console.log(`[DB] Seeded ${allLeaves.length + 1} knowledge nodes (incl. unclassified)`);

  // 验证数量
  const stats = treeData.stats;
  const dbCount = db.prepare('SELECT COUNT(*) as count FROM knowledge_nodes').get();
  console.log(`[DB] Expected ${stats.total_leaves} leaves, got ${dbCount.count}`);
}

/**
 * 为新用户初始化知识树（创建所有节点的 user_nodes 记录，默认 Lv0）
 */
export function initUserNodes(userId) {
  const nodes = db.prepare('SELECT node_id FROM knowledge_nodes').all();
  const insert = db.prepare(`
    INSERT OR IGNORE INTO user_nodes (user_id, node_id, xp, level, mastery)
    VALUES (?, ?, 0, 0, 0.0)
  `);
  const tx = db.transaction((rows) => {
    for (const row of rows) {
      insert.run(userId, row.node_id);
    }
  });
  tx(nodes);
  console.log(`[DB] Initialized ${nodes.length} user_nodes for user ${userId}`);
}

export default db;

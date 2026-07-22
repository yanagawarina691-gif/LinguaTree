#!/usr/bin/env node
/**
 * 数据库迁移脚本 - 创建 schema + seed 知识树数据
 * 用法: node src/db/migrate.js [--seed]
 */
import db, { initSchema, seedKnowledgeTree } from './index.js';

console.log('=== LinguaTree Database Migration ===\n');

// 1. 创建所有表
initSchema();

// 2. 为已存在的数据库补齐新列（ALTER TABLE ADD COLUMN IF NOT EXISTS 的兼容性写法）
function columnExists(tableName, columnName) {
  const columns = db.prepare(`PRAGMA table_info(${tableName})`).all();
  return columns.some(col => col.name === columnName);
}

function ensureColumn(tableName, columnDef) {
  const [columnName] = columnDef.trim().split(/\s+/);
  if (!columnExists(tableName, columnName)) {
    db.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnDef}`).run();
    console.log(`[DB] Added column ${tableName}.${columnName}`);
  }
}

// user_nodes 扩展字段
ensureColumn('user_nodes', 'stage TEXT DEFAULT \'undiscovered\'');
ensureColumn('user_nodes', 'last_migration_score INTEGER DEFAULT 0');
ensureColumn('user_nodes', 'migration_count INTEGER DEFAULT 0');
ensureColumn('user_nodes', 'last_freeform_score INTEGER DEFAULT 0');
ensureColumn('user_nodes', 'xp_breakdown TEXT DEFAULT \'{}\'');

// videos 扩展字段
ensureColumn('videos', 'deepen_completed INTEGER DEFAULT 0');
ensureColumn('videos', 'migration_completed INTEGER DEFAULT 0');
ensureColumn('videos', 'freeform_completed INTEGER DEFAULT 0');

// migration_scenarios / migration_attempts 扩展字段
ensureColumn('migration_scenarios', 'related_node_ids TEXT DEFAULT \'[]\'');
ensureColumn('migration_attempts', 'confirmed_link INTEGER DEFAULT 0');

// 3. 如果带 --seed 参数（或表为空），seed 知识树
const args = process.argv.slice(2);
if (args.includes('--seed') || args.includes('-s')) {
  seedKnowledgeTree();
} else {
  // 默认也 seed（幂等，已存在会跳过）
  seedKnowledgeTree();
}

console.log('\n=== Migration complete ===');
console.log('Database file: src/db/linguatree.db');
process.exit(0);

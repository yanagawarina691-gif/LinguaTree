#!/usr/bin/env node
/**
 * 数据库迁移脚本 - 创建 schema + seed 知识树数据
 * 用法: node src/db/migrate.js [--seed]
 */
import { initSchema, seedKnowledgeTree } from './index.js';

console.log('=== LinguaTree Database Migration ===\n');

// 1. 创建所有表
initSchema();

// 2. 如果带 --seed 参数（或表为空），seed 知识树
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

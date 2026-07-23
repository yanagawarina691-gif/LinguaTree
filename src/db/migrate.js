#!/usr/bin/env node
/**
 * 数据库迁移脚本 v2 - 创建 schema（动态矿石网络，无需 seed）
 * 用法: node src/db/migrate.js
 */
import { initSchema } from './index.js';

console.log('=== LinguaTree v2 Database Migration ===\n');

initSchema();

console.log('\n=== Migration complete ===');
console.log('Ore nodes are created dynamically when videos are parsed.');
console.log('Database file: src/db/linguatree.db');
process.exit(0);

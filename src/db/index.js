import Database from 'better-sqlite3';
import { config } from '../config.js';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { readFileSync } from 'fs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

// Demo uses a fictional in-memory snapshot, never the personal SQLite file.
if (config.APP_MODE !== 'personal') {
  throw new Error('只读演示禁止打开个人数据库；个人学习请明确设置 APP_MODE=personal');
}

const DB_PATH = process.env.DB_PATH || join(__dirname, 'linguatree.db');
const SCHEMA_PATH = join(__dirname, 'schema.sql');

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

export function initSchema() {
  const schema = readFileSync(SCHEMA_PATH, 'utf-8');
  db.exec(schema);
  console.log('[DB] Schema initialized (v2 dynamic ore network)');
}

export default db;

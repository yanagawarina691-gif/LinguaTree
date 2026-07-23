-- ============================================================
-- 迁移脚本: 新增 videos.flashcard_completed 字段
-- 对应 BUG-04 修复（闪卡幂等改用专门字段，弃用 parse_logs LIKE）
-- ============================================================
-- 用法：
--   sqlite3 src/db/linguatree.db < src/db/migrations/002_add_flashcard_completed.sql
-- 或在 Node 中通过 better-sqlite3 执行本文件 SQL
-- ============================================================

-- 新增闪卡完成标记字段（与 freeform_completed / migration_completed 对齐）
ALTER TABLE videos ADD COLUMN flashcard_completed INTEGER DEFAULT 0;

-- 迁移历史数据：若 parse_logs 中已有 flashcard completed 记录，回填到新字段
UPDATE videos
SET flashcard_completed = 1
WHERE id IN (
  SELECT DISTINCT video_id
  FROM parse_logs
  WHERE stage = 'flashcard' AND status = 'completed'
);

-- ============================================================
-- 附：schema.sql 中 videos 表应同步新增该字段定义
-- 在 deepen_completed / migration_completed / freeform_completed 附近添加：
--   flashcard_completed INTEGER DEFAULT 0,    -- M5: 闪卡回忆是否完成（0/1，幂等防刷）
-- ============================================================

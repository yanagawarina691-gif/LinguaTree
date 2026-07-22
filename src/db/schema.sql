-- LinguaTree Database Schema (SQLite)

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 知识树节点定义表（静态数据，从 JSON seed）
CREATE TABLE IF NOT EXISTS knowledge_nodes (
    node_id TEXT PRIMARY KEY,          -- e.g. "grammar.tense.present_perfect"
    name TEXT NOT NULL,                 -- e.g. "现在完成时"
    definition TEXT DEFAULT '',
    sub_branch TEXT NOT NULL,           -- e.g. "时态"
    top_branch TEXT NOT NULL,           -- e.g. "grammar"
    top_branch_name TEXT NOT NULL,       -- e.g. "语法"
    color TEXT DEFAULT '#58CC02',
    sort_order INTEGER DEFAULT 0
);

-- 用户知识树状态表（每个用户对每个节点的 XP/等级/掌握度）
CREATE TABLE IF NOT EXISTS user_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,            -- 0=休眠 1=发芽 2=茂叶 3=开花
    mastery REAL DEFAULT 0.0,           -- 0.0 ~ 1.0
    last_review_at TEXT,               -- 最后复习时间
    next_review_at TEXT,               -- 下次复习时间（v2 间隔复习）
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, node_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (node_id) REFERENCES knowledge_nodes(node_id)
);

-- 视频表
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_url TEXT NOT NULL,           -- 原始抖音链接
    title TEXT DEFAULT '',
    author TEXT DEFAULT '',
    cover_url TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',      -- pending/downloading/asr/ocr/vlm/llm/done/error
    asr_text TEXT DEFAULT '',           -- ASR 文字稿
    ocr_text TEXT DEFAULT '',           -- OCR 画面文字
    vlm_description TEXT DEFAULT '',    -- VLM 画面描述
    cefr_level TEXT DEFAULT '',         -- A1-C2
    summary TEXT DEFAULT '',            -- LLM 生成的摘要
    completion_rate REAL DEFAULT 0.0,   -- 完播率 0-1
    manual_transcript TEXT DEFAULT '',  -- 用户手动粘贴的文字稿（降级路径）
    error_message TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 视频-节点映射表
CREATE TABLE IF NOT EXISTS video_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    weight INTEGER DEFAULT 1,           -- 1-5
    confidence REAL DEFAULT 0.0,         -- 0.0-1.0
    is_unclassified INTEGER DEFAULT 0,  -- 0=正常 1=未分类
    unclassified_name TEXT DEFAULT '',  -- 未分类时的知识点名称
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (node_id) REFERENCES knowledge_nodes(node_id)
);

-- 巩固训练题目表
CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    node_id TEXT NOT NULL,              -- 关联的知识点
    type TEXT NOT NULL,                 -- 'choice' | 'fill' | 'judge'
    question TEXT NOT NULL,
    options TEXT DEFAULT '[]',          -- JSON array for choice questions
    answer TEXT NOT NULL,               -- 正确答案（choice: index, fill: text, judge: 'true'/'false'）
    explanation TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (node_id) REFERENCES knowledge_nodes(node_id)
);

-- 用户答题记录表
CREATE TABLE IF NOT EXISTS exercise_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    is_correct INTEGER DEFAULT 0,       -- 0=错 1=对
    is_skipped INTEGER DEFAULT 0,       -- 0=未跳过 1=跳过
    user_answer TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (exercise_id) REFERENCES exercises(id),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (node_id) REFERENCES knowledge_nodes(node_id)
);

-- 解析日志表（用于调试和异常排查）
CREATE TABLE IF NOT EXISTS parse_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    stage TEXT NOT NULL,                -- 'download' | 'asr' | 'ocr' | 'vlm' | 'llm' | 'tree_update'
    status TEXT NOT NULL,               -- 'start' | 'success' | 'error' | 'degraded'
    message TEXT DEFAULT '',
    duration_ms INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_user_nodes_user ON user_nodes(user_id);
CREATE INDEX IF NOT EXISTS idx_user_nodes_node ON user_nodes(node_id);
CREATE INDEX IF NOT EXISTS idx_videos_user ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_video_nodes_video ON video_nodes(video_id);
CREATE INDEX IF NOT EXISTS idx_video_nodes_node ON video_nodes(node_id);
CREATE INDEX IF NOT EXISTS idx_exercises_video ON exercises(video_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON exercise_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_node ON exercise_attempts(node_id);
CREATE INDEX IF NOT EXISTS idx_attempts_video ON exercise_attempts(video_id);

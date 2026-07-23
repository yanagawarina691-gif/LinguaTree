-- LinguaTree v2 数据库 Schema (Obsidian式动态矿石网络)

-- 用户表
CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    nickname TEXT NOT NULL,
    avatar TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
);

-- 视频表
CREATE TABLE IF NOT EXISTS videos (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    source_url TEXT NOT NULL,
    title TEXT DEFAULT '',
    author TEXT DEFAULT '',
    cover_url TEXT DEFAULT '',
    status TEXT DEFAULT 'pending',
    asr_text TEXT DEFAULT '',
    ocr_text TEXT DEFAULT '',
    vlm_description TEXT DEFAULT '',
    cefr_level TEXT DEFAULT '',
    summary TEXT DEFAULT '',
    completion_rate REAL DEFAULT 0.0,
    manual_transcript TEXT DEFAULT '',
    error_message TEXT DEFAULT '',
    deepen_completed INTEGER DEFAULT 0,
    migration_completed INTEGER DEFAULT 0,
    freeform_completed INTEGER DEFAULT 0,
    claimed INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 动态矿石节点表（每次 AI 解析创建，随内容自然生长）
CREATE TABLE IF NOT EXISTS ore_nodes (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    description TEXT DEFAULT '',
    tags TEXT DEFAULT '[]',
    color TEXT DEFAULT '#58CC02',
    video_count INTEGER DEFAULT 1,
    xp_total INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    created_from_video_id TEXT,
    FOREIGN KEY (created_from_video_id) REFERENCES videos(id)
);

-- 视频-矿石映射表
CREATE TABLE IF NOT EXISTS video_ores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    ore_id INTEGER NOT NULL,
    confidence REAL DEFAULT 0.5,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(video_id, ore_id),
    FOREIGN KEY (video_id) REFERENCES videos(id) ON DELETE CASCADE,
    FOREIGN KEY (ore_id) REFERENCES ore_nodes(id) ON DELETE CASCADE
);

-- 用户-矿石状态表
CREATE TABLE IF NOT EXISTS user_ores (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    ore_id INTEGER NOT NULL,
    xp INTEGER DEFAULT 0,
    level INTEGER DEFAULT 0,
    stage INTEGER DEFAULT 1,
    mastery REAL DEFAULT 0.0,
    last_review_at TEXT,
    next_review_at TEXT,
    last_migration_score INTEGER DEFAULT 0,
    migration_count INTEGER DEFAULT 0,
    last_freeform_score INTEGER DEFAULT 0,
    xp_breakdown TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(user_id, ore_id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (ore_id) REFERENCES ore_nodes(id) ON DELETE CASCADE
);

-- 标签注册表（归一化 + 颜色分配）
CREATE TABLE IF NOT EXISTS tags (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT UNIQUE NOT NULL,
    color TEXT,
    ore_count INTEGER DEFAULT 0
);

-- 巩固训练题目表
CREATE TABLE IF NOT EXISTS exercises (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    ore_id INTEGER NOT NULL,
    type TEXT NOT NULL,
    question TEXT NOT NULL,
    options TEXT DEFAULT '[]',
    answer TEXT NOT NULL,
    explanation TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (ore_id) REFERENCES ore_nodes(id)
);

-- 用户答题记录表
CREATE TABLE IF NOT EXISTS exercise_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    exercise_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    ore_id INTEGER NOT NULL,
    is_correct INTEGER DEFAULT 0,
    is_skipped INTEGER DEFAULT 0,
    user_answer TEXT DEFAULT '',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (exercise_id) REFERENCES exercises(id),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (ore_id) REFERENCES ore_nodes(id)
);

-- 解析日志表
CREATE TABLE IF NOT EXISTS parse_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    video_id TEXT NOT NULL,
    stage TEXT NOT NULL,
    status TEXT NOT NULL,
    message TEXT DEFAULT '',
    duration_ms INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id)
);

-- 迁移场景表
CREATE TABLE IF NOT EXISTS migration_scenarios (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    ore_id INTEGER NOT NULL,
    ore_name TEXT DEFAULT '',
    scenario_title TEXT DEFAULT '',
    scenario_description TEXT DEFAULT '',
    user_task TEXT DEFAULT '',
    evaluation_criteria TEXT DEFAULT '[]',
    reference_answer TEXT DEFAULT '',
    difficulty TEXT DEFAULT 'B1',
    related_ore_ids TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (ore_id) REFERENCES ore_nodes(id)
);

-- 迁移尝试表
CREATE TABLE IF NOT EXISTS migration_attempts (
    id TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    ore_id INTEGER NOT NULL,
    user_input TEXT DEFAULT '',
    ai_evaluation TEXT DEFAULT '{}',
    accuracy_score INTEGER DEFAULT 0,
    overall_score INTEGER DEFAULT 0,
    xp_gained INTEGER DEFAULT 0,
    confirmed_link INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (scenario_id) REFERENCES migration_scenarios(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (ore_id) REFERENCES ore_nodes(id)
);

-- 加深理解内容表
CREATE TABLE IF NOT EXISTS deepen_understanding (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    ore_id INTEGER NOT NULL,
    brief_comment TEXT DEFAULT '',
    comment_type TEXT DEFAULT '',
    corrections TEXT DEFAULT '[]',
    supplements TEXT DEFAULT '[]',
    structured_content TEXT DEFAULT '[]',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (ore_id) REFERENCES ore_nodes(id)
);

-- 加深理解反馈表
CREATE TABLE IF NOT EXISTS deepen_feedback (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL,
    item_index INTEGER DEFAULT -1,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 闪卡内容表
CREATE TABLE IF NOT EXISTS flashcards (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    ore_id INTEGER NOT NULL,
    front TEXT DEFAULT '',
    back TEXT DEFAULT '',
    trigger_type TEXT DEFAULT 'word',
    difficulty TEXT DEFAULT 'B1',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (ore_id) REFERENCES ore_nodes(id)
);

-- 闪卡学习记录表
CREATE TABLE IF NOT EXISTS flashcard_attempts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    ore_id INTEGER NOT NULL,
    known_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (ore_id) REFERENCES ore_nodes(id)
);

-- 问答题表
CREATE TABLE IF NOT EXISTS freeform_questions (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    ore_id INTEGER NOT NULL,
    question TEXT DEFAULT '',
    target_knowledge TEXT DEFAULT '',
    evaluation_criteria TEXT DEFAULT '[]',
    reference_answers TEXT DEFAULT '[]',
    difficulty TEXT DEFAULT 'B1',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (ore_id) REFERENCES ore_nodes(id)
);

-- 问答题尝试记录表
CREATE TABLE IF NOT EXISTS freeform_attempts (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_input TEXT DEFAULT '',
    ai_evaluation TEXT DEFAULT '{}',
    score INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (question_id) REFERENCES freeform_questions(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 矿石间链接表（backlinks，来自场景迁移 + 共现）
CREATE TABLE IF NOT EXISTS ore_backlinks (
    id TEXT PRIMARY KEY,
    source_ore_id INTEGER NOT NULL,
    target_ore_id INTEGER NOT NULL,
    link_type TEXT DEFAULT 'co_occurrence',
    source_videos TEXT DEFAULT '[]',
    strength REAL DEFAULT 0,
    confirm_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (source_ore_id) REFERENCES ore_nodes(id),
    FOREIGN KEY (target_ore_id) REFERENCES ore_nodes(id)
);

-- SRS 复习记录表
CREATE TABLE IF NOT EXISTS srs_reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    ore_id INTEGER NOT NULL,
    last_review_date TEXT,
    next_review_date TEXT,
    review_interval INTEGER DEFAULT 1,
    ease_factor REAL DEFAULT 2.5,
    review_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (ore_id) REFERENCES ore_nodes(id)
);

-- 索引
CREATE INDEX IF NOT EXISTS idx_ore_nodes_tags ON ore_nodes(tags);
CREATE INDEX IF NOT EXISTS idx_user_ores_user ON user_ores(user_id);
CREATE INDEX IF NOT EXISTS idx_user_ores_ore ON user_ores(ore_id);
CREATE INDEX IF NOT EXISTS idx_video_ores_video ON video_ores(video_id);
CREATE INDEX IF NOT EXISTS idx_video_ores_ore ON video_ores(ore_id);
CREATE INDEX IF NOT EXISTS idx_videos_user ON videos(user_id);
CREATE INDEX IF NOT EXISTS idx_videos_status ON videos(status);
CREATE INDEX IF NOT EXISTS idx_exercises_video ON exercises(video_id);
CREATE INDEX IF NOT EXISTS idx_exercises_ore ON exercises(ore_id);
CREATE INDEX IF NOT EXISTS idx_attempts_user ON exercise_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_attempts_ore ON exercise_attempts(ore_id);
CREATE INDEX IF NOT EXISTS idx_attempts_video ON exercise_attempts(video_id);
CREATE INDEX IF NOT EXISTS idx_migration_scenario_video ON migration_scenarios(video_id);
CREATE INDEX IF NOT EXISTS idx_migration_scenario_ore ON migration_scenarios(ore_id);
CREATE INDEX IF NOT EXISTS idx_migration_attempts_user ON migration_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_deepen_understanding_video ON deepen_understanding(video_id);
CREATE INDEX IF NOT EXISTS idx_deepen_understanding_ore ON deepen_understanding(ore_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_video ON flashcards(video_id);
CREATE INDEX IF NOT EXISTS idx_flashcard_attempts_user ON flashcard_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_freeform_questions_video ON freeform_questions(video_id);
CREATE INDEX IF NOT EXISTS idx_ore_backlinks_source ON ore_backlinks(source_ore_id);
CREATE INDEX IF NOT EXISTS idx_ore_backlinks_target ON ore_backlinks(target_ore_id);
CREATE INDEX IF NOT EXISTS idx_srs_reviews_user ON srs_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_srs_reviews_ore ON srs_reviews(ore_id);
CREATE INDEX IF NOT EXISTS idx_srs_reviews_next ON srs_reviews(next_review_date);

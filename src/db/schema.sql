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
    level INTEGER DEFAULT 0,            -- 0=未发现 1=矿苗 2=晶芽 3=辉石 4=璀璨
    stage TEXT DEFAULT 'undiscovered',  -- undiscovered/seedling/crystal/prism/radiant
    mastery REAL DEFAULT 0.0,           -- 0.0 ~ 1.0
    last_review_at TEXT,               -- 最后复习时间
    next_review_at TEXT,               -- 下次复习时间（v2 间隔复习）
    last_migration_score INTEGER DEFAULT 0,
    migration_count INTEGER DEFAULT 0,
    last_freeform_score INTEGER DEFAULT 0,
    xp_breakdown TEXT DEFAULT '{}',    -- 各来源 XP 明细与每日上限计数
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
    deepen_completed INTEGER DEFAULT 0, -- 加深理解是否完成
    migration_completed INTEGER DEFAULT 0, -- 迁移是否完成
    freeform_completed INTEGER DEFAULT 0,  -- 问答题/内化是否完成
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

-- ========== M2: 迁移场景相关表 ==========

-- 迁移场景表（AI 生成的场景，每个视频-节点可缓存一个）
CREATE TABLE IF NOT EXISTS migration_scenarios (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    node_id TEXT NOT NULL,              -- 主知识点节点 ID
    node_name TEXT DEFAULT '',          -- 知识点名称（冗余，方便展示）
    scenario_title TEXT DEFAULT '',     -- 场景标题
    scenario_description TEXT DEFAULT '',-- 场景描述（含情境和任务说明）
    user_task TEXT DEFAULT '',          -- 用户需要完成的具体任务
    evaluation_criteria TEXT DEFAULT '[]', -- JSON 数组：评估维度
    reference_answer TEXT DEFAULT '',   -- 参考答案（AI 评估时对比）
    difficulty TEXT DEFAULT 'B1',      -- CEFR 难度
    related_node_ids TEXT DEFAULT '[]', -- JSON 数组：场景关联的其他矿石 ID
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (node_id) REFERENCES knowledge_nodes(node_id)
);

-- 迁移尝试表（用户每次提交的迁移回答 + AI 评估结果）
CREATE TABLE IF NOT EXISTS migration_attempts (
    id TEXT PRIMARY KEY,
    scenario_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    video_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    user_input TEXT DEFAULT '',         -- 用户提交的回答
    ai_evaluation TEXT DEFAULT '{}',     -- JSON: AI 评估结果
    accuracy_score INTEGER DEFAULT 0,   -- 知识点使用准确率 0-100
    overall_score INTEGER DEFAULT 0,    -- 总分 0-100
    xp_gained INTEGER DEFAULT 0,        -- 获得的 XP
    confirmed_link INTEGER DEFAULT 0,   -- 是否已确认晶链
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (scenario_id) REFERENCES migration_scenarios(id),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (node_id) REFERENCES knowledge_nodes(node_id)
);

-- ========== P0: 加深理解 / 内化三模态 / 归档复习层 ==========

-- 加深理解内容表
CREATE TABLE IF NOT EXISTS deepen_understanding (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    brief_comment TEXT DEFAULT '',      -- AI 简短回应（约 20 字）
    comment_type TEXT DEFAULT '',       -- 点评/提醒/鼓励
    corrections TEXT DEFAULT '[]',      -- JSON: 纠错内容数组
    supplements TEXT DEFAULT '[]',      -- JSON: 补充内容数组
    structured_content TEXT DEFAULT '[]', -- JSON: 逻辑理顺章节数组
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (node_id) REFERENCES knowledge_nodes(node_id)
);

-- 加深理解反馈表（有用 / 有疑问）
CREATE TABLE IF NOT EXISTS deepen_feedback (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    feedback_type TEXT NOT NULL,        -- 'useful' | 'confused'
    item_index INTEGER DEFAULT -1,      -- 对应纠错/补充项索引，-1 表示整体反馈
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 闪卡内容表
CREATE TABLE IF NOT EXISTS flashcards (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    front TEXT DEFAULT '',              -- 正面触发词/概念
    back TEXT DEFAULT '',               -- 背面定义+例句
    trigger_type TEXT DEFAULT 'concept', -- concept | structure | example
    difficulty TEXT DEFAULT 'B1',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (node_id) REFERENCES knowledge_nodes(node_id)
);

-- 问答题表
CREATE TABLE IF NOT EXISTS freeform_questions (
    id TEXT PRIMARY KEY,
    video_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    question TEXT DEFAULT '',
    target_knowledge TEXT DEFAULT '',
    evaluation_criteria TEXT DEFAULT '[]',  -- JSON array
    reference_answers TEXT DEFAULT '[]',    -- JSON array
    difficulty TEXT DEFAULT 'B1',
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (video_id) REFERENCES videos(id),
    FOREIGN KEY (node_id) REFERENCES knowledge_nodes(node_id)
);

-- 问答题尝试记录表
CREATE TABLE IF NOT EXISTS freeform_attempts (
    id TEXT PRIMARY KEY,
    question_id TEXT NOT NULL,
    user_id TEXT NOT NULL,
    user_input TEXT DEFAULT '',
    ai_evaluation TEXT DEFAULT '{}',     -- JSON
    score INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (question_id) REFERENCES freeform_questions(id),
    FOREIGN KEY (user_id) REFERENCES users(id)
);

-- 知识卡片 backlinks 表
CREATE TABLE IF NOT EXISTS card_backlinks (
    id TEXT PRIMARY KEY,
    source_node_id TEXT NOT NULL,
    target_node_id TEXT NOT NULL,
    link_type TEXT DEFAULT 'co_occurrence', -- co_occurrence | ai_supplement | migration_cover | user_manual
    source_videos TEXT DEFAULT '[]',        -- JSON array of video IDs
    strength REAL DEFAULT 0,
    confirm_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (source_node_id) REFERENCES knowledge_nodes(node_id),
    FOREIGN KEY (target_node_id) REFERENCES knowledge_nodes(node_id)
);

-- SRS 复习记录表
CREATE TABLE IF NOT EXISTS srs_reviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL,
    node_id TEXT NOT NULL,
    last_review_date TEXT,
    next_review_date TEXT,
    review_interval INTEGER DEFAULT 1,  -- 天数
    ease_factor REAL DEFAULT 2.5,       -- SM-2 算法参数
    review_count INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    FOREIGN KEY (user_id) REFERENCES users(id),
    FOREIGN KEY (node_id) REFERENCES knowledge_nodes(node_id)
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
CREATE INDEX IF NOT EXISTS idx_migration_scenario_video ON migration_scenarios(video_id);
CREATE INDEX IF NOT EXISTS idx_migration_scenario_node ON migration_scenarios(node_id);
CREATE INDEX IF NOT EXISTS idx_migration_attempts_user ON migration_attempts(user_id);
CREATE INDEX IF NOT EXISTS idx_migration_attempts_video ON migration_attempts(video_id);
CREATE INDEX IF NOT EXISTS idx_migration_attempts_scenario ON migration_attempts(scenario_id);
CREATE INDEX IF NOT EXISTS idx_deepen_understanding_video ON deepen_understanding(video_id);
CREATE INDEX IF NOT EXISTS idx_deepen_understanding_node ON deepen_understanding(node_id);
CREATE INDEX IF NOT EXISTS idx_deepen_feedback_video ON deepen_feedback(video_id);
CREATE INDEX IF NOT EXISTS idx_flashcards_video ON flashcards(video_id);
CREATE INDEX IF NOT EXISTS idx_freeform_questions_video ON freeform_questions(video_id);
CREATE INDEX IF NOT EXISTS idx_card_backlinks_source ON card_backlinks(source_node_id);
CREATE INDEX IF NOT EXISTS idx_card_backlinks_target ON card_backlinks(target_node_id);
CREATE INDEX IF NOT EXISTS idx_srs_reviews_user ON srs_reviews(user_id);
CREATE INDEX IF NOT EXISTS idx_srs_reviews_node ON srs_reviews(node_id);
CREATE INDEX IF NOT EXISTS idx_srs_reviews_next ON srs_reviews(next_review_date);

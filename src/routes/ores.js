import { Router } from 'express';
import db from '../db/index.js';
import { authRequired } from '../middleware/auth.js';
import { addOreXP, calculateMastery } from '../services/treeService.js';

const router = Router();
router.use(authRequired);

function safeParse(jsonStr, defaultValue) {
  try { return JSON.parse(jsonStr || JSON.stringify(defaultValue)); }
  catch { return defaultValue; }
}

/**
 * GET /api/ores/:id/knowledge-card
 * 获取完整的知识点卡片数据（Obsidian 结构）
 */
router.get('/:id/knowledge-card', (req, res) => {
  const oreId = parseInt(req.params.id, 10);
  const userId = req.userId;

  // 矿石信息
  const ore = db.prepare('SELECT * FROM ore_nodes WHERE id = ?').get(oreId);
  if (!ore) return res.status(404).json({ error: '矿石不存在' });

  // 用户进度
  const progress = db.prepare('SELECT * FROM user_ores WHERE user_id = ? AND ore_id = ?').get(userId, oreId) || {};

  // 来源视频
  const sourceVideos = db.prepare(`
    SELECT v.id, v.title, v.summary, v.cefr_level, v.created_at
    FROM videos v
    JOIN video_ores vo ON vo.video_id = v.id
    WHERE vo.ore_id = ? AND v.user_id = ? AND v.status = 'done'
    ORDER BY v.created_at DESC
  `).all(oreId, userId);

  // Backlinks — 共现关联
  const backlinks = db.prepare(`
    SELECT
      CASE WHEN ob.source_ore_id = ? THEN ob.target_ore_id ELSE ob.source_ore_id END AS related_id,
      o.name AS related_name,
      ob.link_type, ob.strength, ob.confirm_count,
      ob.source_videos
    FROM ore_backlinks ob
    JOIN ore_nodes o ON o.id = (CASE WHEN ob.source_ore_id = ? THEN ob.target_ore_id ELSE ob.source_ore_id END)
    WHERE (ob.source_ore_id = ? OR ob.target_ore_id = ?)
    ORDER BY ob.strength DESC
  `).all(oreId, oreId, oreId, oreId);

  // 视频共现关联（未在 backlinks 表中的）
  const coOccurrence = db.prepare(`
    SELECT DISTINCT o2.id AS related_id, o2.name AS related_name, COUNT(*) AS co_count
    FROM video_ores vo1
    JOIN video_ores vo2 ON vo1.video_id = vo2.video_id AND vo1.ore_id != vo2.ore_id
    JOIN ore_nodes o2 ON o2.id = vo2.ore_id
    WHERE vo1.ore_id = ?
    GROUP BY o2.id
    ORDER BY co_count DESC
    LIMIT 10
  `).all(oreId);

  // 合并 backlinks 和 coOccurrence
  const mergedLinks = [];
  const seenIds = new Set();
  for (const bl of backlinks) {
    if (!seenIds.has(bl.related_id)) {
      mergedLinks.push({ ...bl, co_count: 0 });
      seenIds.add(bl.related_id);
    }
  }
  for (const co of coOccurrence) {
    if (!seenIds.has(co.related_id)) {
      mergedLinks.push({ ...co, link_type: 'co_occurrence', strength: Math.min(1, co.co_count / 3), confirm_count: co.co_count, source_videos: '[]' });
      seenIds.add(co.related_id);
    }
  }

  // 加深理解内容
  const deepen = db.prepare(`
    SELECT * FROM deepen_understanding
    WHERE ore_id = ? AND video_id IN (SELECT video_id FROM video_ores WHERE ore_id = ?)
    ORDER BY created_at DESC LIMIT 1
  `).get(oreId, oreId);

  // 错题
  const wrongAnswers = db.prepare(`
    SELECT ex.question, ex.answer AS correct_answer, ex.explanation, ea.user_answer, ea.created_at
    FROM exercise_attempts ea
    JOIN exercises ex ON ex.id = ea.exercise_id
    WHERE ea.ore_id = ? AND ea.user_id = ? AND ea.is_correct = 0
    ORDER BY ea.created_at DESC LIMIT 5
  `).all(oreId, userId);

  // 迁移记录
  const migrations = db.prepare(`
    SELECT ms.scenario_title, ma.user_input, ma.overall_score, ma.accuracy_score, ma.xp_gained, ma.created_at
    FROM migration_attempts ma
    JOIN migration_scenarios ms ON ms.id = ma.scenario_id
    WHERE ma.ore_id = ? AND ma.user_id = ?
    ORDER BY ma.created_at DESC LIMIT 3
  `).all(oreId, userId);

  // 闪卡
  const flashcards = db.prepare('SELECT front, back, trigger_type FROM flashcards WHERE ore_id = ? LIMIT 20').all(oreId);

  res.json({
    id: ore.id,
    name: ore.name,
    description: ore.description,
    tags: safeParse(ore.tags, []),
    color: ore.color,
    video_count: ore.video_count,
    xp_total: ore.xp_total,
    created_at: ore.created_at,

    progress: {
      xp: progress.xp || 0,
      level: progress.level || 0,
      stage: progress.stage || 1,
      mastery: progress.mastery || 0,
      last_review_at: progress.last_review_at || null,
      next_review_at: progress.next_review_at || null,
      migration_count: progress.migration_count || 0,
    },

    source_videos: sourceVideos.map(v => ({
      id: v.id, title: v.title, summary: v.summary, cefr_level: v.cefr_level, created_at: v.created_at,
    })),

    backlinks: mergedLinks,

    deepen: deepen ? {
      corrections: safeParse(deepen.corrections, []),
      supplements: safeParse(deepen.supplements, []),
      structured_content: safeParse(deepen.structured_content, []),
    } : null,

    wrong_answers: wrongAnswers,

    migrations: migrations.map(m => ({
      scenario_title: m.scenario_title,
      user_input: m.user_input,
      score: m.overall_score,
      accuracy: m.accuracy_score,
      xp_gained: m.xp_gained,
      created_at: m.created_at,
    })),

    flashcards,
  });
});

/**
 * POST /api/ores/:id/tags
 * 添加/更新标签
 */
router.post('/:id/tags', (req, res) => {
  const oreId = parseInt(req.params.id, 10);
  const { tags } = req.body;
  if (!Array.isArray(tags)) return res.status(400).json({ error: 'tags 必须是数组' });

  const ore = db.prepare('SELECT id, tags FROM ore_nodes WHERE id = ?').get(oreId);
  if (!ore) return res.status(404).json({ error: '矿石不存在' });

  db.prepare('UPDATE ore_nodes SET tags = ? WHERE id = ?').run(JSON.stringify(tags), oreId);

  // 更新标签注册表
  for (const tag of tags) {
    try {
      db.prepare('INSERT INTO tags (name, ore_count) VALUES (?, 1) ON CONFLICT(name) DO UPDATE SET ore_count = ore_count + 1').run(tag);
    } catch {}
  }

  res.json({ tags });
});

/**
 * POST /api/ores/:id/review
 * 复习矿石 +3 XP
 */
router.post('/:id/review', (req, res) => {
  const oreId = parseInt(req.params.id, 10);
  const userId = req.userId;

  const result = addOreXP(userId, oreId, 3, 'review');
  const mastery = calculateMastery(userId, oreId);
  db.prepare('UPDATE user_ores SET mastery = ?, last_review_at = datetime(\'now\') WHERE user_id = ? AND ore_id = ?')
    .run(mastery, userId, oreId);

  res.json({
    oreId,
    xp: result.xp,
    level: result.newLevel,
    leveledUp: result.leveledUp,
    xpGain: result.xpGain,
    capped: result.capped || false,
    mastery,
  });
});

export default router;

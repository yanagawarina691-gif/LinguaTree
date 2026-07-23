import db from '../db/index.js';
import { logger } from '../utils/logger.js';

const LEVEL_THRESHOLDS = [
  { level: 0, min_xp: 0 },
  { level: 1, min_xp: 5 },
  { level: 2, min_xp: 10 },
  { level: 3, min_xp: 15 },
];

const MAX_LEVEL = 3;
const MAX_LEVEL_XP = 15;

const DAILY_XP_CAPS = { repeated: { limit: 10 }, link: { limit: 20 }, review: { limit: 3 } };

export function calcLevel(xp) {
  let level = 0;
  for (const t of LEVEL_THRESHOLDS) {
    if (xp >= t.min_xp) level = t.level;
  }
  return level;
}

function safeParse(jsonStr, defaultValue) {
  try { return JSON.parse(jsonStr || JSON.stringify(defaultValue)); }
  catch { return defaultValue; }
}

export function calculateMastery(userId, oreId) {
  try {
    const recentAttempts = db.prepare(`
      SELECT is_correct, is_skipped FROM exercise_attempts
      WHERE user_id = ? AND ore_id = ?
      ORDER BY created_at DESC LIMIT 5
    `).all(userId, oreId);

    const userOre = db.prepare('SELECT xp FROM user_ores WHERE user_id = ? AND ore_id = ?').get(userId, oreId);
    const xp = userOre?.xp || 0;
    const maxXp = LEVEL_THRESHOLDS[LEVEL_THRESHOLDS.length - 1].min_xp;
    const xpNormalized = Math.min(1, xp / maxXp);

    if (recentAttempts.length === 0) return xpNormalized;

    const correct = recentAttempts.filter(a => a.is_correct && !a.is_skipped).length;
    const total = recentAttempts.filter(a => !a.is_skipped).length || 1;
    const recentCorrectRate = correct / total;

    return Math.round((recentCorrectRate * 0.7 + xpNormalized * 0.3) * 100) / 100;
  } catch {
    return 0;
  }
}

export function addOreXP(userId, oreId, xpGain, source = 'default') {
  const oreExists = db.prepare('SELECT 1 FROM ore_nodes WHERE id = ?').get(oreId);
  if (!oreExists) {
    logger.warn('[Tree]', `矿石不存在: ${oreId}`);
    return { oldLevel: 0, newLevel: 0, xp: 0, xpGain: 0, leveledUp: false };
  }

  db.prepare(`
    INSERT OR IGNORE INTO user_ores (user_id, ore_id, xp, level, stage, mastery)
    VALUES (?, ?, 0, 0, 1, 0.0)
  `).run(userId, oreId);

  const old = db.prepare('SELECT xp, level, xp_breakdown FROM user_ores WHERE user_id = ? AND ore_id = ?').get(userId, oreId);

  // Lv.3 (满级) 不加分
  if ((old?.level ?? 0) >= MAX_LEVEL) {
    return { oldLevel: old.level, newLevel: old.level, xp: old.xp, xpGain: 0, leveledUp: false, capped: true };
  }

  const breakdown = safeParse(old.xp_breakdown, { sources: {}, daily: {} });
  if (!breakdown.sources) breakdown.sources = {};
  if (!breakdown.daily) breakdown.daily = {};

  const today = new Date().toISOString().slice(0, 10);

  if (DAILY_XP_CAPS[source]) {
    const dailyRecord = breakdown.daily[source] || { date: today, count: 0 };
    if (dailyRecord.date !== today) { dailyRecord.date = today; dailyRecord.count = 0; }
    if (dailyRecord.count >= DAILY_XP_CAPS[source].limit) {
      return { oldLevel: old.level || 0, newLevel: old.level || 0, xp: old.xp || 0, xpGain: 0, leveledUp: false, capped: true };
    }
    dailyRecord.count += 1;
    breakdown.daily[source] = dailyRecord;
  }

  breakdown.sources[source] = (breakdown.sources[source] || 0) + xpGain;

  const newXp = (old.xp || 0) + xpGain;
  const newLevel = calcLevel(newXp);

  db.prepare(`
    UPDATE user_ores SET xp = ?, level = ?, stage = ?, mastery = ?, xp_breakdown = ?, updated_at = datetime('now')
    WHERE user_id = ? AND ore_id = ?
  `).run(newXp, newLevel, newLevel + 1, calculateMastery(userId, oreId), JSON.stringify(breakdown), userId, oreId);

  // 更新矿石总 XP
  db.prepare('UPDATE ore_nodes SET xp_total = xp_total + ? WHERE id = ?').run(xpGain, oreId);

  return { oldLevel: old.level || 0, newLevel, xp: newXp, xpGain, leveledUp: newLevel > (old.level || 0) };
}

// 兼容旧 API 名
export const addNodeXP = addOreXP;

export function recordAttempt(userId, oreId, isCorrect, isSkipped = false) {
  const mastery = calculateMastery(userId, oreId);
  db.prepare('UPDATE user_ores SET mastery = ?, updated_at = datetime(\'now\') WHERE user_id = ? AND ore_id = ?').run(mastery, userId, oreId);
}

export function updateTreeFromVideo(userId, videoId, oreIds, completionRate = 1.0, correctOreIds = []) {
  const updatedNodes = [];
  const leveledUpNodes = [];

  for (const oreId of oreIds) {
    // 观看 XP = 5
    const watchXp = Math.round(5 * completionRate);
    const result = addOreXP(userId, oreId, watchXp, 'watch');
    updatedNodes.push({ oreId, ...result });
    if (result.leveledUp) leveledUpNodes.push(oreId);
  }

  // 答题正确额外 XP
  for (const oreId of correctOreIds) {
    const result = addOreXP(userId, oreId, 5, 'exercise');
    const idx = updatedNodes.findIndex(n => n.oreId === oreId);
    if (idx >= 0) {
      updatedNodes[idx] = { oreId, xp: result.xp, oldLevel: updatedNodes[idx].oldLevel, newLevel: result.newLevel, xpGain: updatedNodes[idx].xpGain + 5, leveledUp: updatedNodes[idx].leveledUp || result.leveledUp };
    }
    if (result.leveledUp && !leveledUpNodes.includes(oreId)) leveledUpNodes.push(oreId);
  }

  return { updatedNodes, leveledUpNodes };
}

export function getUserTree(userId) {
  const ores = db.prepare(`
    SELECT o.id, o.name, o.description, o.tags, o.color, o.video_count, o.xp_total, o.created_at,
           uo.xp, uo.level, uo.stage, uo.mastery, uo.last_review_at
    FROM ore_nodes o
    LEFT JOIN user_ores uo ON uo.ore_id = o.id AND uo.user_id = ?
    ORDER BY o.xp_total DESC
  `).all(userId);

  const tags = db.prepare('SELECT name, color, ore_count FROM tags ORDER BY ore_count DESC').all();

  const stats = {
    totalOres: ores.length,
    activatedOres: ores.filter(o => (o.level || 0) > 0).length,
    totalXp: ores.reduce((s, o) => s + (o.xp || 0), 0),
    tags,
  };

  return { ores, stats };
}

export function getUserStats(userId) {
  const tree = getUserTree(userId);
  const videoCount = db.prepare('SELECT COUNT(*) as count FROM videos WHERE user_id = ? AND status = \'done\'').get(userId);

  const flashcardWords = db.prepare(
    'SELECT COALESCE(SUM(known_count), 0) as total FROM flashcard_attempts WHERE user_id = ?'
  ).get(userId);

  const migrationCount = db.prepare(
    'SELECT COUNT(*) as total FROM migration_attempts WHERE user_id = ?'
  ).get(userId);

  const migrationCorrect = db.prepare(
    'SELECT COUNT(*) as total FROM migration_attempts WHERE user_id = ? AND overall_score >= 60'
  ).get(userId);

  const choiceCorrect = db.prepare(
    `SELECT COUNT(*) as total FROM exercise_attempts ea
     JOIN exercises e ON ea.exercise_id = e.id
     WHERE ea.user_id = ? AND e.type = 'choice' AND ea.is_correct = 1`
  ).get(userId);

  const fillCorrect = db.prepare(
    `SELECT COUNT(*) as total FROM exercise_attempts ea
     JOIN exercises e ON ea.exercise_id = e.id
     WHERE ea.user_id = ? AND e.type = 'fill' AND ea.is_correct = 1`
  ).get(userId);

  return {
    ...tree.stats,
    videosParsed: videoCount?.count || 0,
    totalFlashcardWords: flashcardWords?.total || 0,
    totalMigrations: migrationCount?.total || 0,
    totalMigrationCorrect: migrationCorrect?.total || 0,
    totalChoiceCorrect: choiceCorrect?.total || 0,
    totalFillCorrect: fillCorrect?.total || 0,
  };
}

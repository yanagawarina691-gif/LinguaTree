import db from '../db/index.js';
import { logger } from '../utils/logger.js';
import { calculateMastery } from './treeService.js';

/**
 * Card Service — 知识卡片归档复习层（M3）
 *
 * 职责：
 * 1. 组装知识卡片数据（汇聚 knowledge_nodes / user_nodes / deepen_understanding /
 *    exercise_attempts / migration_attempts / video_nodes / card_backlinks / srs_reviews）
 * 2. backlinks 自动建立（co_occurrence / ai_supplement / migration_cover）
 * 3. SRS 间隔复习算法（SuperMemo-2 简化版）
 */

/** SRS: 答题质量 → quality 分值映射（SM-2 标准 0-5） */
function qualityToSM2(quality) {
  if (quality >= 90) return 5;  // 完美记忆
  if (quality >= 75) return 4;  // 正确但费力
  if (quality >= 60) return 3;  // 正确但很费力
  if (quality >= 40) return 2;  // 错误，但似曾相识
  if (quality >= 20) return 1;  // 错误，但有印象
  return 0;                      // 完全忘记
}

/**
 * SuperMemo-2 简化版算法（PRD §6.2 P1-3）
 * @param {number} quality - 0-100 的评分（内部转为 0-5）
 * @param {number} reviewCount - 已复习次数
 * @param {number} easeFactor - 当前难度系数
 * @param {number} interval - 当前间隔（天）
 * @returns {{ nextInterval, nextEaseFactor, nextReviewDate }}
 */
export function calculateNextReview(quality100, reviewCount, easeFactor, interval) {
  const quality = qualityToSM2(quality100);
  let newEaseFactor, newInterval;

  if (quality < 3) {
    // 答错或忘记：重置间隔为 1 天
    newInterval = 1;
    newEaseFactor = Math.max(1.3, easeFactor - 0.2);
  } else {
    // 答对：根据复习次数增加间隔
    if (reviewCount === 0) {
      newInterval = 1;
    } else if (reviewCount === 1) {
      newInterval = 3;
    } else {
      newInterval = Math.round(interval * easeFactor);
    }
    newEaseFactor = easeFactor + (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
    newEaseFactor = Math.max(1.3, newEaseFactor);
  }

  const nextReviewDate = new Date(Date.now() + newInterval * 24 * 60 * 60 * 1000).toISOString();
  return { nextInterval: newInterval, nextEaseFactor: newEaseFactor, nextReviewDate };
}

/**
 * 获取或初始化用户的 SRS 记录
 */
function getOrCreateSrs(userId, nodeId) {
  let row = db.prepare(`
    SELECT * FROM srs_reviews WHERE user_id = ? AND node_id = ?
  `).get(userId, nodeId);

  if (!row) {
    db.prepare(`
      INSERT OR IGNORE INTO srs_reviews (user_id, node_id, review_count, ease_factor, review_interval)
      VALUES (?, ?, 0, 2.5, 1)
    `).run(userId, nodeId);
    row = db.prepare(`SELECT * FROM srs_reviews WHERE user_id = ? AND node_id = ?`).get(userId, nodeId);
  }
  return row;
}

/**
 * 记录一次复习并更新 SRS（POST /api/cards/:nodeId/review 调用）
 * @param {string} userId
 * @param {string} nodeId
 * @param {number} quality - 0-100 评分（来自用户自评或答题正确率）
 * @returns {{ nextReviewDate, nextInterval, reviewCount }}
 */
export function recordReview(userId, nodeId, quality) {
  const srs = getOrCreateSrs(userId, nodeId);
  const { nextInterval, nextEaseFactor, nextReviewDate } = calculateNextReview(
    quality,
    srs.review_count || 0,
    srs.ease_factor || 2.5,
    srs.review_interval || 1
  );

  const newCount = (srs.review_count || 0) + 1;
  db.prepare(`
    UPDATE srs_reviews
    SET last_review_date = datetime('now'),
        next_review_date = ?,
        review_interval = ?,
        ease_factor = ?,
        review_count = ?,
        updated_at = datetime('now')
    WHERE user_id = ? AND node_id = ?
  `).run(nextReviewDate, nextInterval, nextEaseFactor, newCount, userId, nodeId);

  logger.info(`[Card] 用户 ${userId} 复习节点 ${nodeId}: quality=${quality}, next=${nextReviewDate.slice(0,10)}, interval=${nextInterval}d`);
  return { nextReviewDate, nextInterval, reviewCount: newCount };
}

// ========== Backlinks 自动建立 ==========

/**
 * 建立双向 backlinks（source↔target）
 * 约定：插入 source→target 的同时插入 target→source，保证双向性
 */
function upsertBacklink(sourceNodeId, targetNodeId, linkType, sourceVideos = [], strength = 0.5) {
  if (!sourceNodeId || !targetNodeId || sourceNodeId === targetNodeId) return;
  if (sourceNodeId === 'unclassified' || targetNodeId === 'unclassified') return;

  const videosJson = JSON.stringify(sourceVideos);
  const insertSql = db.prepare(`
    INSERT INTO card_backlinks (source_node_id, target_node_id, link_type, source_videos, strength)
    VALUES (?, ?, ?, ?, ?)
    ON CONFLICT(source_node_id, target_node_id, link_type) DO UPDATE SET
      source_videos = excluded.source_videos,
      strength = MAX(card_backlinks.strength, excluded.strength)
  `);

  // 双向插入
  insertSql.run(sourceNodeId, targetNodeId, linkType, videosJson, strength);
  insertSql.run(targetNodeId, sourceNodeId, linkType, videosJson, strength);
}

/**
 * 跨视频知识映射 backlinks（同一视频出现的知识点之间建立链接）
 * 在视频解析完成后调用
 */
export function buildCoOccurrenceBacklinks(videoId) {
  const nodes = db.prepare(`
    SELECT node_id FROM video_nodes
    WHERE video_id = ? AND is_unclassified = 0
  `).all(videoId).map(n => n.node_id);

  if (nodes.length < 2) return;

  let count = 0;
  for (let i = 0; i < nodes.length; i++) {
    for (let j = i + 1; j < nodes.length; j++) {
      upsertBacklink(nodes[i], nodes[j], 'co_occurrence', [videoId], 0.8);
      count++;
    }
  }
  logger.info(`[Card] 视频 ${videoId} 建立 ${count} 条 co_occurrence backlinks`);
}

/**
 * AI 补充内容 backlinks（加深理解的 supplements 里关联的知识节点）
 * 在加深理解生成完成后调用
 */
export function buildAiSupplementBacklinks(videoId, sourceNodeId) {
  if (!sourceNodeId || sourceNodeId === 'unclassified') return;

  const deepen = db.prepare(`SELECT supplements FROM deepen_understanding WHERE video_id = ?`).get(videoId);
  if (!deepen || !deepen.supplements) return;

  const supplements = JSON.parse(deepen.supplements || '[]');
  let count = 0;

  for (const sup of supplements) {
    // 通过 related_node_name 查找节点 ID
    if (!sup.related_node_name) continue;
    const target = db.prepare(`
      SELECT node_id FROM knowledge_nodes WHERE name = ? AND node_id != 'unclassified'
    `).get(sup.related_node_name);
    if (target) {
      upsertBacklink(sourceNodeId, target.node_id, 'ai_supplement', [videoId], 0.6);
      count++;
    }
  }

  if (count > 0) {
    logger.info(`[Card] 视频 ${videoId} 建立 ${count} 条 ai_supplement backlinks (source=${sourceNodeId})`);
  }
}

/**
 * 迁移场景覆盖 backlinks（迁移场景涉及的知识节点之间）
 * 在迁移评估完成后调用
 */
export function buildMigrationCoverBacklinks(videoId, nodeId) {
  if (!nodeId || nodeId === 'unclassified') return;
  // 迁移场景目前只关联主知识点，暂无跨节点。
  // 预留：未来迁移场景涉及多节点时在此建立链接。
}

// ========== 知识卡片数据组装 ==========

/**
 * 获取用户的知识卡片列表（只含"学过的"节点）
 * "学过"定义：level > 0 或有 deepen_understanding 或有 exercise_attempts 或有 migration_attempts
 */
export function getCardList(userId) {
  // 筛选有学习记录的节点
  const learnedNodes = db.prepare(`
    SELECT DISTINCT kn.node_id, kn.name, kn.definition, kn.sub_branch, kn.top_branch, kn.top_branch_name, kn.color,
           COALESCE(un.xp, 0) as xp, COALESCE(un.level, 0) as level, COALESCE(un.mastery, 0) as mastery,
           un.last_review_at,
           srs.next_review_date
    FROM knowledge_nodes kn
    LEFT JOIN user_nodes un ON un.node_id = kn.node_id AND un.user_id = ?
    LEFT JOIN srs_reviews srs ON srs.node_id = kn.node_id AND srs.user_id = ?
    WHERE kn.node_id != 'unclassified'
      AND (
        un.level > 0
        OR EXISTS (SELECT 1 FROM deepen_understanding du WHERE du.node_id = kn.node_id)
        OR EXISTS (SELECT 1 FROM exercise_attempts ea WHERE ea.node_id = kn.node_id AND ea.user_id = ?)
        OR EXISTS (SELECT 1 FROM migration_attempts ma WHERE ma.node_id = kn.node_id AND ma.user_id = ?)
      )
    ORDER BY un.level DESC, un.mastery DESC, kn.sort_order
  `).all(userId, userId, userId, userId);

  const today = new Date().toISOString().slice(0, 10);

  return learnedNodes.map(n => {
    const masteryPct = Math.round((n.mastery || 0) * 100);
    const dueToday = n.next_review_date && n.next_review_date.slice(0, 10) <= today;
    return {
      node_id: n.node_id,
      name: n.name,
      definition: n.definition,
      sub_branch: n.sub_branch,
      top_branch: n.top_branch,
      top_branch_name: n.top_branch_name,
      color: n.color,
      xp: n.xp,
      level: n.level,
      mastery: masteryPct,
      last_review_at: n.last_review_at,
      next_review_date: n.next_review_date,
      due_today: !!dueToday,
      mastery_color: masteryPct < 40 ? 'red' : masteryPct < 70 ? 'orange' : 'green',
    };
  });
}

/**
 * 获取今日推荐复习卡片（SRS 到期 + 低掌握度）
 */
export function getTodayReviewCards(userId, count = 5) {
  const today = new Date().toISOString().slice(0, 10);
  const cards = db.prepare(`
    SELECT kn.node_id, kn.name, kn.definition, kn.color, kn.top_branch_name,
           COALESCE(un.mastery, 0) as mastery, un.level,
           srs.next_review_date, srs.review_count
    FROM knowledge_nodes kn
    JOIN user_nodes un ON un.node_id = kn.node_id AND un.user_id = ?
    LEFT JOIN srs_reviews srs ON srs.node_id = kn.node_id AND srs.user_id = ?
    WHERE kn.node_id != 'unclassified' AND un.level > 0
      AND (
        (srs.next_review_date IS NOT NULL AND srs.next_review_date <= ?)
        OR (un.mastery < 0.4 AND (srs.next_review_date IS NULL OR srs.next_review_date <= ?))
      )
    ORDER BY
      CASE WHEN srs.next_review_date IS NOT NULL AND srs.next_review_date <= ? THEN 0 ELSE 1 END,
      un.mastery ASC
    LIMIT ?
  `).all(userId, userId, today, today, today, count);

  return cards.map(n => ({
    node_id: n.node_id,
    name: n.name,
    definition: n.definition,
    color: n.color,
    top_branch_name: n.top_branch_name,
    mastery: Math.round((n.mastery || 0) * 100),
    level: n.level,
    next_review_date: n.next_review_date,
    review_count: n.review_count || 0,
  }));
}

/**
 * 获取单张知识卡片详情（汇聚全链路数据）
 */
export function getCardDetail(userId, nodeId) {
  // 1. 基础节点信息 + 用户状态
  const node = db.prepare(`
    SELECT kn.*, COALESCE(un.xp, 0) as xp, COALESCE(un.level, 0) as level,
           COALESCE(un.mastery, 0) as mastery, un.last_review_at,
           srs.next_review_date, srs.review_interval, srs.ease_factor, srs.review_count
    FROM knowledge_nodes kn
    LEFT JOIN user_nodes un ON un.node_id = kn.node_id AND un.user_id = ?
    LEFT JOIN srs_reviews srs ON srs.node_id = kn.node_id AND srs.user_id = ?
    WHERE kn.node_id = ?
  `).get(userId, userId, nodeId);

  if (!node) return null;

  // 2. 加深理解内容（取最近一次，用于核心概念/结构/例句/易错点）
  const deepen = db.prepare(`
    SELECT structured_content, corrections FROM deepen_understanding
    WHERE node_id = ?
    ORDER BY created_at DESC LIMIT 1
  `).get(nodeId);

  let coreConcept = node.definition || '';
  let structure = '';
  let examples = [];
  let pitfalls = [];

  if (deepen) {
    const sections = JSON.parse(deepen.structured_content || '[]');
    for (const sec of sections) {
      if (sec.section && sec.section.includes('定义')) coreConcept = coreConcept || sec.content;
      else if (sec.section && sec.section.includes('结构')) structure = sec.content;
      else if (sec.section && sec.section.includes('例句')) examples.push(sec.content);
      else if (sec.section && sec.section.includes('易错')) pitfalls.push(sec.content);
    }
    const corrections = JSON.parse(deepen.corrections || '[]');
    for (const c of corrections) {
      pitfalls.push(`${c.original} → ${c.corrected}（${c.explanation || ''}）`);
    }
  }

  // 3. 来源视频
  const sourceVideos = db.prepare(`
    SELECT v.id, v.title, v.created_at
    FROM video_nodes vn
    JOIN videos v ON v.id = vn.video_id
    WHERE vn.node_id = ? AND v.user_id = ?
    ORDER BY v.created_at DESC
  `).all(nodeId, userId);

  // 4. 我的错题（最近 5 道）
  const wrongExercises = db.prepare(`
    SELECT ea.user_answer, e.question, e.answer, e.type, e.options, e.explanation, ea.created_at
    FROM exercise_attempts ea
    JOIN exercises e ON e.id = ea.exercise_id
    WHERE ea.user_id = ? AND ea.node_id = ? AND ea.is_correct = 0
    ORDER BY ea.created_at DESC
    LIMIT 5
  `).all(userId, nodeId);

  // 5. 迁移记录
  const migrationRecords = db.prepare(`
    SELECT ma.overall_score, ma.accuracy_score, ma.xp_gained, ma.created_at,
           ms.scenario_title
    FROM migration_attempts ma
    LEFT JOIN migration_scenarios ms ON ms.id = ma.scenario_id
    WHERE ma.user_id = ? AND ma.node_id = ?
    ORDER BY ma.created_at DESC
    LIMIT 5
  `).all(userId, nodeId);

  // 6. backlinks
  const backlinks = getBacklinks(nodeId);

  const masteryPct = Math.round((node.mastery || 0) * 100);

  return {
    node_id: node.node_id,
    name: node.name,
    definition: node.definition,
    sub_branch: node.sub_branch,
    top_branch: node.top_branch,
    top_branch_name: node.top_branch_name,
    color: node.color,
    xp: node.xp,
    level: node.level,
    mastery: masteryPct,
    mastery_color: masteryPct < 40 ? 'red' : masteryPct < 70 ? 'orange' : 'green',
    last_review_at: node.last_review_at,
    next_review_date: node.next_review_date,
    review_count: node.review_count || 0,
    core_concept: coreConcept,
    structure,
    examples,
    pitfalls,
    source_videos: sourceVideos.map(v => ({
      id: v.id,
      title: v.title || '未命名视频',
      date: v.created_at,
    })),
    wrong_exercises: wrongExercises.map(e => ({
      question: e.question,
      user_answer: e.user_answer,
      correct_answer: e.type === 'choice' ? parseInt(e.answer) : e.answer,
      options: e.options ? JSON.parse(e.options) : null,
      type: e.type,
      explanation: e.explanation,
    })),
    migration_records: migrationRecords.map(m => ({
      scenario_title: m.scenario_title,
      overall_score: m.overall_score,
      accuracy_score: m.accuracy_score,
      xp_gained: m.xp_gained,
      date: m.created_at,
    })),
    backlinks,
  };
}

/**
 * 获取卡片的双向链接
 * 返回当前节点指向的所有链接（双向性已在写入时保证）
 */
export function getBacklinks(nodeId) {
  const rows = db.prepare(`
    SELECT cb.target_node_id, cb.link_type, cb.source_videos, cb.strength,
           kn.name as target_name, kn.top_branch_name as target_branch
    FROM card_backlinks cb
    JOIN knowledge_nodes kn ON kn.node_id = cb.target_node_id
    WHERE cb.source_node_id = ?
    ORDER BY cb.strength DESC
  `).all(nodeId);

  return rows.map(r => ({
    node_id: r.target_node_id,
    node_name: r.target_name,
    branch: r.target_branch,
    link_type: r.link_type,
    source_videos: JSON.parse(r.source_videos || '[]'),
    strength: r.strength,
  }));
}

/**
 * M4: 自动归档 — 当用户完成某个视频的学习链路后，
 * 确保该视频涉及的知识节点都被纳入归档（通过 user_nodes 的 level ≥ 1 体现）
 * 实际上 user_nodes 在 addNodeXP 时已创建，这里只做 SRS 初始化
 */
export function ensureCardArchived(userId, nodeId) {
  if (!nodeId || nodeId === 'unclassified') return;
  getOrCreateSrs(userId, nodeId);
  logger.info(`[Card] 节点 ${nodeId} 已确保归档（用户 ${userId}）`);
}

import db from '../db/index.js';
import { logger } from '../utils/logger.js';
import { calculateMastery } from './treeService.js';

/**
 * Card Service — 知识卡片归档复习层（M3）
 *
 * 修复记录：
 * [BUG-02] getCardList/getCardDetail 的 deepen_understanding 查询加 user_id 过滤，防止跨用户数据泄露
 * [BUG-06] buildAiSupplementBacklinks 改用 related_node_id（配合 llmService prompt），不再依赖名称匹配
 * [BUG-10] getBacklinks 增加 userId 参数，过滤 source_videos 归属
 * [BUG-12] getOrCreateSrs 新建时设 next_review_date = date('now')，新归档卡片可进复习推荐
 */

function qualityToSM2(quality) {
  if (quality >= 90) return 5;
  if (quality >= 75) return 4;
  if (quality >= 60) return 3;
  if (quality >= 40) return 2;
  if (quality >= 20) return 1;
  return 0;
}

/**
 * SuperMemo-2 简化版算法（PRD §6.2 P1-3）
 */
export function calculateNextReview(quality100, reviewCount, easeFactor, interval) {
  const quality = qualityToSM2(quality100);
  let newEaseFactor, newInterval;

  if (quality < 3) {
    newInterval = 1;
    newEaseFactor = Math.max(1.3, easeFactor - 0.2);
  } else {
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
 * [BUG-12 修复] 新建时设 next_review_date = date('now')，使新归档卡片可进入"今日推荐复习"
 */
function getOrCreateSrs(userId, nodeId) {
  let row = db.prepare(`SELECT * FROM srs_reviews WHERE user_id = ? AND node_id = ?`).get(userId, nodeId);

  if (!row) {
    db.prepare(`
      INSERT OR IGNORE INTO srs_reviews
        (user_id, node_id, review_count, ease_factor, review_interval, next_review_date)
      VALUES (?, ?, 0, 2.5, 1, date('now'))
    `).run(userId, nodeId);
    row = db.prepare(`SELECT * FROM srs_reviews WHERE user_id = ? AND node_id = ?`).get(userId, nodeId);
  }
  return row;
}

/**
 * 记录一次复习并更新 SRS
 */
export function recordReview(userId, nodeId, quality) {
  const srs = getOrCreateSrs(userId, nodeId);
  const { nextInterval, nextEaseFactor, nextReviewDate } = calculateNextReview(
    quality, srs.review_count || 0, srs.ease_factor || 2.5, srs.review_interval || 1
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

  insertSql.run(sourceNodeId, targetNodeId, linkType, videosJson, strength);
  insertSql.run(targetNodeId, sourceNodeId, linkType, videosJson, strength);
}

/**
 * 跨视频知识映射 backlinks（同一视频出现的知识点之间建立链接）
 */
export function buildCoOccurrenceBacklinks(videoId) {
  const nodes = db.prepare(`
    SELECT node_id FROM video_nodes WHERE video_id = ? AND is_unclassified = 0
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
 * [BUG-06 修复] 改用 related_node_id（LLM prompt 已改回返回 id），不再依赖名称匹配
 */
export function buildAiSupplementBacklinks(videoId, sourceNodeId) {
  if (!sourceNodeId || sourceNodeId === 'unclassified') return;

  const deepen = db.prepare(`SELECT supplements FROM deepen_understanding WHERE video_id = ?`).get(videoId);
  if (!deepen || !deepen.supplements) return;

  const supplements = JSON.parse(deepen.supplements || '[]');
  let count = 0;

  for (const sup of supplements) {
    // [BUG-06 修复] 优先用 related_node_id，兼容旧数据回退 related_node_name
    let targetNodeId = sup.related_node_id;
    if (!targetNodeId && sup.related_node_name) {
      // 兼容：若有 name 无 id，尝试按名称查
      const target = db.prepare(`SELECT node_id FROM knowledge_nodes WHERE name = ?`).get(sup.related_node_name);
      targetNodeId = target?.node_id;
    }

    if (targetNodeId && targetNodeId !== 'unclassified') {
      upsertBacklink(sourceNodeId, targetNodeId, 'ai_supplement', [videoId], 0.6);
      count++;
    }
  }

  if (count > 0) {
    logger.info(`[Card] 视频 ${videoId} 建立 ${count} 条 ai_supplement backlinks (source=${sourceNodeId})`);
  }
}

/**
 * 迁移场景覆盖 backlinks
 */
export function buildMigrationCoverBacklinks(videoId, nodeId) {
  if (!nodeId || nodeId === 'unclassified') return;
  // 预留：未来迁移场景涉及多节点时在此建立链接
}

// ========== 知识卡片数据组装 ==========

/**
 * 获取用户的知识卡片列表（只含"学过的"节点）
 * [BUG-02 修复] deepen_understanding EXISTS 子查询加 JOIN videos 过滤 user_id
 */
export function getCardList(userId) {
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
        OR EXISTS (
          SELECT 1 FROM deepen_understanding du
          JOIN videos dv ON dv.id = du.video_id
          WHERE du.node_id = kn.node_id AND dv.user_id = ?
        )
        OR EXISTS (SELECT 1 FROM exercise_attempts ea WHERE ea.node_id = kn.node_id AND ea.user_id = ?)
        OR EXISTS (SELECT 1 FROM migration_attempts ma WHERE ma.node_id = kn.node_id AND ma.user_id = ?)
      )
    ORDER BY un.level DESC, un.mastery DESC, kn.sort_order
  `).all(userId, userId, userId, userId, userId);

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
 * [BUG-12 关联] next_review_date IS NULL 的新卡片也算到期（兼容历史数据）
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
        (srs.next_review_date IS NULL)
        OR (srs.next_review_date <= ?)
        OR (un.mastery < 0.4 AND (srs.next_review_date IS NULL OR srs.next_review_date <= ?))
      )
    ORDER BY
      CASE WHEN srs.next_review_date IS NULL THEN 0
           WHEN srs.next_review_date <= ? THEN 0 ELSE 1 END,
      un.mastery ASC
    LIMIT ?
  `).all(userId, userId, today, today, today, count);

  return cards.map(n => ({
    node_id: n.node_id, name: n.name, definition: n.definition,
    color: n.color, top_branch_name: n.top_branch_name,
    mastery: Math.round((n.mastery || 0) * 100), level: n.level,
    next_review_date: n.next_review_date, review_count: n.review_count || 0,
  }));
}

/**
 * 获取单张知识卡片详情（汇聚全链路数据）
 * [BUG-02 修复] deepen 查询加 JOIN videos 过滤 user_id，防止跨用户展示他人加深理解内容
 */
export function getCardDetail(userId, nodeId) {
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

  // [BUG-02 修复] JOIN videos 过滤 user_id
  const deepen = db.prepare(`
    SELECT du.structured_content, du.corrections
    FROM deepen_understanding du
    JOIN videos dv ON dv.id = du.video_id
    WHERE du.node_id = ? AND dv.user_id = ?
    ORDER BY du.created_at DESC LIMIT 1
  `).get(nodeId, userId);

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

  const sourceVideos = db.prepare(`
    SELECT v.id, v.title, v.created_at
    FROM video_nodes vn
    JOIN videos v ON v.id = vn.video_id
    WHERE vn.node_id = ? AND v.user_id = ?
    ORDER BY v.created_at DESC
  `).all(nodeId, userId);

  const wrongExercises = db.prepare(`
    SELECT ea.user_answer, e.question, e.answer, e.type, e.options, e.explanation, ea.created_at
    FROM exercise_attempts ea
    JOIN exercises e ON e.id = ea.exercise_id
    WHERE ea.user_id = ? AND ea.node_id = ? AND ea.is_correct = 0
    ORDER BY ea.created_at DESC
    LIMIT 5
  `).all(userId, nodeId);

  const migrationRecords = db.prepare(`
    SELECT ma.overall_score, ma.accuracy_score, ma.xp_gained, ma.created_at, ms.scenario_title
    FROM migration_attempts ma
    LEFT JOIN migration_scenarios ms ON ms.id = ma.scenario_id
    WHERE ma.user_id = ? AND ma.node_id = ?
    ORDER BY ma.created_at DESC
    LIMIT 5
  `).all(userId, nodeId);

  // [BUG-10 修复] backlinks 加 userId 过滤 source_videos 归属
  const backlinks = getBacklinks(nodeId, userId);

  const masteryPct = Math.round((node.mastery || 0) * 100);

  return {
    node_id: node.node_id, name: node.name, definition: node.definition,
    sub_branch: node.sub_branch, top_branch: node.top_branch,
    top_branch_name: node.top_branch_name, color: node.color,
    xp: node.xp, level: node.level, mastery: masteryPct,
    mastery_color: masteryPct < 40 ? 'red' : masteryPct < 70 ? 'orange' : 'green',
    last_review_at: node.last_review_at,
    next_review_date: node.next_review_date,
    review_count: node.review_count || 0,
    core_concept: coreConcept, structure, examples, pitfalls,
    source_videos: sourceVideos.map(v => ({ id: v.id, title: v.title || '未命名视频', date: v.created_at })),
    wrong_exercises: wrongExercises.map(e => ({
      question: e.question, user_answer: e.user_answer,
      correct_answer: e.type === 'choice' ? parseInt(e.answer) : e.answer,
      options: e.options ? JSON.parse(e.options) : null, type: e.type, explanation: e.explanation,
    })),
    migration_records: migrationRecords.map(m => ({
      scenario_title: m.scenario_title, overall_score: m.overall_score,
      accuracy_score: m.accuracy_score, xp_gained: m.xp_gained, date: m.created_at,
    })),
    backlinks,
  };
}

/**
 * 获取卡片的双向链接
 * [BUG-10 修复] 增加 userId 参数，过滤 source_videos 只保留当前用户相关的视频
 * 返回当前节点指向的所有链接（双向性已在写入时保证）
 */
export function getBacklinks(nodeId, userId = null) {
  const rows = db.prepare(`
    SELECT cb.target_node_id, cb.link_type, cb.source_videos, cb.strength,
           kn.name as target_name, kn.top_branch_name as target_branch
    FROM card_backlinks cb
    JOIN knowledge_nodes kn ON kn.node_id = cb.target_node_id
    WHERE cb.source_node_id = ?
    ORDER BY cb.strength DESC
  `).all(nodeId);

  return rows.map(r => {
    const sourceVideos = JSON.parse(r.source_videos || '[]');
    // [BUG-10 修复] 若提供 userId，过滤 source_videos 只保留该用户的视频
    let filteredVideos = sourceVideos;
    if (userId) {
      const userVideos = new Set(
        db.prepare(`SELECT id FROM videos WHERE user_id = ?`).all(userId).map(v => v.id)
      );
      filteredVideos = sourceVideos.filter(vid => userVideos.has(vid));
      // 如果该链接没有任何来源视频属于当前用户，跳过该 backlink
      if (filteredVideos.length === 0 && sourceVideos.length > 0) return null;
    }
    return {
      node_id: r.target_node_id,
      node_name: r.target_name,
      branch: r.target_branch,
      link_type: r.link_type,
      source_videos: filteredVideos,
      strength: r.strength,
    };
  }).filter(Boolean);
}

/**
 * M4: 自动归档 — 确保知识节点被纳入归档（初始化 SRS）
 */
export function ensureCardArchived(userId, nodeId) {
  if (!nodeId || nodeId === 'unclassified') return;
  getOrCreateSrs(userId, nodeId);
  logger.info(`[Card] 节点 ${nodeId} 已确保归档（用户 ${userId}）`);
}

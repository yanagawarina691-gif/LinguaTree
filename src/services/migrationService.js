import db from '../db/index.js';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';
import { generateMigrationScenario, evaluateMigration } from './llmService.js';
import { addOreXP } from './treeService.js';

function safeParse(jsonStr, defaultValue) {
  try { return JSON.parse(jsonStr || JSON.stringify(defaultValue)); }
  catch { return defaultValue; }
}

export function getMainNodeForVideo(videoId) {
  return db.prepare(`
    SELECT vo.ore_id, o.name as node_name, o.description
    FROM video_ores vo
    JOIN ore_nodes o ON o.id = vo.ore_id
    WHERE vo.video_id = ?
    ORDER BY vo.confidence DESC
    LIMIT 1
  `).get(videoId) || null;
}

function getRelatedOreIdsForVideo(videoId, mainOreId) {
  const rows = db.prepare(`
    SELECT DISTINCT vo.ore_id
    FROM video_ores vo
    JOIN ore_nodes o ON o.id = vo.ore_id
    WHERE vo.video_id = ? AND vo.ore_id != ?
    ORDER BY vo.confidence DESC
    LIMIT 3
  `).all(videoId, mainOreId);
  return rows.map(r => r.ore_id);
}

function upsertOreBacklink(sourceOreId, targetOreId, linkType, videoId, strength) {
  const existing = db.prepare(`
    SELECT id, source_videos, confirm_count, strength
    FROM ore_backlinks WHERE source_ore_id = ? AND target_ore_id = ? AND link_type = ?
  `).get(sourceOreId, targetOreId, linkType);

  if (existing) {
    const videos = safeParse(existing.source_videos, []);
    if (!videos.includes(videoId)) videos.push(videoId);
    const newStrength = Math.max(0, Math.min(1, ((existing.strength || 0) * (existing.confirm_count || 1) + strength) / ((existing.confirm_count || 1) + 1)));
    db.prepare(`UPDATE ore_backlinks SET source_videos = ?, strength = ?, confirm_count = confirm_count + 1 WHERE id = ?`)
      .run(JSON.stringify(videos), Math.round(newStrength * 100) / 100, existing.id);
  } else {
    db.prepare(`INSERT INTO ore_backlinks (id, source_ore_id, target_ore_id, link_type, source_videos, strength)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(nanoid(12), sourceOreId, targetOreId, linkType, JSON.stringify([videoId]), strength);
  }
}

export async function getOrCreateMigrationScenario(videoId, userId) {
  const existing = db.prepare('SELECT * FROM migration_scenarios WHERE video_id = ?').get(videoId);
  if (existing) {
    return {
      id: existing.id, video_id: existing.video_id, ore_id: existing.ore_id,
      ore_name: existing.ore_name, scenario_title: existing.scenario_title,
      scenario_description: existing.scenario_description, user_task: existing.user_task,
      evaluation_criteria: safeParse(existing.evaluation_criteria, []),
      reference_answer: existing.reference_answer, difficulty: existing.difficulty,
      related_ore_ids: safeParse(existing.related_ore_ids, []),
    };
  }

  const video = db.prepare('SELECT id, title, author, asr_text, ocr_text, summary FROM videos WHERE id = ? AND user_id = ?').get(videoId, userId);
  if (!video) throw new Error('视频不存在');

  const mainNode = getMainNodeForVideo(videoId);
  if (!mainNode) throw new Error('视频未识别到知识点');

  const topicOreId = mainNode.ore_id;
  const relatedOreIds = getRelatedOreIdsForVideo(videoId, topicOreId);

  const scenario = await generateMigrationScenario(mainNode.node_name, topicOreId, null, video.summary || '');

  const id = nanoid(12);
  db.prepare(`INSERT INTO migration_scenarios (id, video_id, ore_id, ore_name, scenario_title, scenario_description,
    user_task, evaluation_criteria, reference_answer, difficulty, related_ore_ids)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    id, videoId, topicOreId, mainNode.node_name,
    scenario.scenario_title, scenario.scenario_description, scenario.user_task,
    JSON.stringify(scenario.evaluation_criteria), scenario.reference_answer, scenario.difficulty,
    JSON.stringify(relatedOreIds)
  );

  return { id, video_id: videoId, ore_id: topicOreId, ore_name: mainNode.node_name, ...scenario, related_ore_ids: relatedOreIds };
}

export async function evaluateMigrationAttempt(videoId, userId, userInput) {
  const scenario = db.prepare('SELECT * FROM migration_scenarios WHERE video_id = ?').get(videoId);
  if (!scenario) throw new Error('请先生成迁移场景');

  const evaluation = await evaluateMigration(scenario.ore_name, scenario, userInput);

  let xpGained = 50;
  if (evaluation.overall_score >= 85) xpGained += 10;
  if (evaluation.overall_score < 40) xpGained = 20;

  db.prepare(`INSERT INTO migration_attempts (id, scenario_id, user_id, video_id, ore_id, user_input, ai_evaluation, accuracy_score, overall_score, xp_gained)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
    nanoid(12), scenario.id, userId, videoId, scenario.ore_id,
    userInput, JSON.stringify(evaluation),
    evaluation.accuracy_score, evaluation.overall_score, xpGained
  );

  const treeResult = addOreXP(userId, scenario.ore_id, xpGained, 'migration');
  db.prepare('UPDATE user_ores SET last_migration_score = ?, migration_count = migration_count + 1, updated_at = datetime(\'now\') WHERE user_id = ? AND ore_id = ?')
    .run(evaluation.overall_score, userId, scenario.ore_id);

  const relatedOreIds = safeParse(scenario.related_ore_ids, []);
  for (const targetId of relatedOreIds) {
    if (!targetId || targetId === scenario.ore_id) continue;
    upsertOreBacklink(scenario.ore_id, targetId, 'migration_cover', videoId, 0.7);
    upsertOreBacklink(targetId, scenario.ore_id, 'migration_cover', videoId, 0.7);
  }

  logger.info('[Migration]', `用户 ${userId} 迁移完成: score=${evaluation.overall_score}, xp=+${xpGained}`);

  return {
    evaluation: { ...evaluation, xpGained },
    treeUpdate: { ore_id: scenario.ore_id, xpGain: xpGained, oldLevel: treeResult.oldLevel, newLevel: treeResult.newLevel, leveledUp: treeResult.leveledUp },
  };
}

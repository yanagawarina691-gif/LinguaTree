import db from '../db/index.js';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';
import { generateFlashcards, generateFreeformQuestion, evaluateFreeformAnswer } from './llmService.js';
import { addOreXP } from './treeService.js';

function safeParse(jsonStr, defaultValue) {
  try { return JSON.parse(jsonStr || JSON.stringify(defaultValue)); }
  catch { return defaultValue; }
}

export function getMainNodeForVideo(videoId) {
  const node = db.prepare(`
    SELECT vo.ore_id, o.name as node_name, o.description, vo.confidence
    FROM video_ores vo
    JOIN ore_nodes o ON o.id = vo.ore_id
    WHERE vo.video_id = ?
    ORDER BY vo.confidence DESC
    LIMIT 1
  `).get(videoId);
  if (node) return node;

  const video = db.prepare('SELECT title, summary FROM videos WHERE id = ?').get(videoId);
  if (video) {
    const fallbackTopic = (video.summary || video.title || '视频内容').split(/[。.]/)[0].slice(0, 40);
    return { ore_id: 0, node_name: fallbackTopic, description: '', confidence: 0 };
  }
  return null;
}

export async function getOrCreateFlashcards(videoId, userId) {
  const existing = db.prepare('SELECT * FROM flashcards WHERE video_id = ? LIMIT 1').get(videoId);
  if (existing) {
    const cards = db.prepare('SELECT front, back, trigger_type, difficulty FROM flashcards WHERE video_id = ?').all(videoId);
    const mainNode = getMainNodeForVideo(videoId);
    return { flashcards: cards, ore_id: mainNode?.ore_id, node_name: mainNode?.node_name };
  }

  const video = db.prepare('SELECT id, title, author, asr_text, ocr_text, summary FROM videos WHERE id = ? AND user_id = ?').get(videoId, userId);
  if (!video) throw new Error('视频不存在');

  const mainNode = getMainNodeForVideo(videoId);
  if (!mainNode) throw new Error('无法获取视频知识点');

  const deepenContent = db.prepare('SELECT * FROM deepen_understanding WHERE video_id = ?').get(videoId);
  const parsedDeepen = deepenContent ? {
    brief_comment: deepenContent.brief_comment,
    structured_content: safeParse(deepenContent.structured_content, []),
    supplements: safeParse(deepenContent.supplements, []),
  } : null;
  const cards = await generateFlashcards(mainNode.node_name, mainNode.ore_id, parsedDeepen);

  const insert = db.prepare('INSERT INTO flashcards (id, video_id, ore_id, front, back, trigger_type, difficulty) VALUES (?, ?, ?, ?, ?, ?, ?)');
  for (const c of cards) {
    insert.run(nanoid(12), videoId, mainNode.ore_id, c.front, c.back, c.trigger_type, c.difficulty);
  }

  return { flashcards: cards, ore_id: mainNode.ore_id, node_name: mainNode.node_name };
}

export async function getOrCreateFreeformQuestion(videoId, userId, accuracy = null) {
  const existing = db.prepare('SELECT * FROM freeform_questions WHERE video_id = ? LIMIT 1').get(videoId);
  if (existing) return { ...existing, evaluation_criteria: safeParse(existing.evaluation_criteria, []), reference_answers: safeParse(existing.reference_answers, []) };

  const mainNode = getMainNodeForVideo(videoId);
  if (!mainNode) throw new Error('无法获取视频知识点');

  const userAccuracy = accuracy !== null ? accuracy :
    (db.prepare(`SELECT AVG(CASE WHEN is_correct THEN 100 ELSE 0 END) as avg FROM exercise_attempts WHERE user_id = ? AND video_id = ?`).get(userId, videoId)?.avg || 70);
  const effectiveAccuracy = Math.round(userAccuracy);

  const questionData = await generateFreeformQuestion(mainNode.node_name, mainNode.ore_id, effectiveAccuracy);

  const id = nanoid(12);
  db.prepare(`INSERT INTO freeform_questions (id, video_id, ore_id, question, target_knowledge, evaluation_criteria, reference_answers, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(id, videoId, mainNode.ore_id,
    questionData.question, questionData.target_knowledge,
    JSON.stringify(questionData.evaluation_criteria), JSON.stringify(questionData.reference_answers), questionData.difficulty);

  return { id, video_id: videoId, ore_id: mainNode.ore_id, ...questionData };
}

export async function evaluateFreeformAttempt(videoId, userId, userInput) {
  const question = db.prepare('SELECT * FROM freeform_questions WHERE video_id = ?').get(videoId);
  if (!question) throw new Error('请先生成问答题');

  const evaluation = await evaluateFreeformAnswer(question.target_knowledge, question, userInput);

  let xpGained = 20;
  if (evaluation.overall_score >= 80) xpGained += 10;
  if (evaluation.overall_score < 40) xpGained = 10;

  db.prepare(`INSERT INTO freeform_attempts (id, question_id, user_id, user_input, ai_evaluation, score)
    VALUES (?, ?, ?, ?, ?, ?)`).run(
    nanoid(12), question.id, userId, userInput,
    JSON.stringify(evaluation), evaluation.overall_score
  );

  const treeResult = addOreXP(userId, question.ore_id, xpGained, 'freeform');
  db.prepare('UPDATE user_ores SET last_freeform_score = ?, updated_at = datetime(\'now\') WHERE user_id = ? AND ore_id = ?')
    .run(evaluation.overall_score, userId, question.ore_id);

  logger.info('[Internalize]', `用户 ${userId} 问答题完成: score=${evaluation.overall_score}, xp=+${xpGained}`);

  return {
    evaluation: { ...evaluation, xpGained },
    treeUpdate: { ore_id: question.ore_id, xpGain: xpGained, oldLevel: treeResult.oldLevel, newLevel: treeResult.newLevel, leveledUp: treeResult.leveledUp },
  };
}

export function completeFlashcards(videoId, userId, knownCount = 0) {
  const mainNode = getMainNodeForVideo(videoId);
  if (!mainNode) throw new Error('无法获取视频知识点');

  const xpGained = 10;
  const treeResult = addOreXP(userId, mainNode.ore_id, xpGained, 'flashcard');

  // 记录闪卡学习单词数
  db.prepare(
    'INSERT INTO flashcard_attempts (user_id, video_id, ore_id, known_count) VALUES (?, ?, ?, ?)'
  ).run(userId, videoId, mainNode.ore_id, knownCount);

  return { xpGained, treeUpdate: { ore_id: mainNode.ore_id, xpGain: xpGained, oldLevel: treeResult.oldLevel, newLevel: treeResult.newLevel, leveledUp: treeResult.leveledUp } };
}

export function completeChoiceExercises(userId, videoId, attempts) {
  const { correctOreIds, treeResult } = (() => {
    const correctOreIds = [];
    const insertAttempt = db.prepare('INSERT INTO exercise_attempts (user_id, exercise_id, video_id, ore_id, is_correct, is_skipped, user_answer) VALUES (?, ?, ?, ?, ?, ?, ?)');
    for (const a of attempts) {
      const oreId = a.oreId || a.nodeId || 0;
      insertAttempt.run(userId, a.exerciseId, videoId, oreId, a.isCorrect ? 1 : 0, a.isSkipped ? 1 : 0, a.userAnswer || '');
      if (a.isCorrect && !a.isSkipped && !correctOreIds.includes(oreId)) correctOreIds.push(oreId);
    }
    const videoOres = db.prepare('SELECT ore_id FROM video_ores WHERE video_id = ?').all(videoId).map(r => r.ore_id);
    for (const oid of videoOres) addOreXP(userId, oid, 5, 'exercise');
    for (const oid of correctOreIds) addOreXP(userId, oid, 5, 'exercise');
    return { correctOreIds, treeResult: { updatedNodes: [], leveledUpNodes: [] } };
  })();
  return { correctOreIds, treeResult };
}

import db from '../db/index.js';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';
import { generateFlashcards, generateFreeformQuestion, evaluateFreeformAnswer } from './llmService.js';
import { addNodeXP } from './treeService.js';
import { processExerciseCompletion } from './pipeline.js';

/**
 * 解析 JSON 字段，失败返回默认值
 */
function safeParse(jsonStr, defaultValue) {
  try {
    return JSON.parse(jsonStr || JSON.stringify(defaultValue));
  } catch (e) {
    return defaultValue;
  }
}

/**
 * 获取视频的主知识点节点（weight 最高）
 * 若视频没有被归类到知识树节点，则取未分类节点（unclassified）作为兜底，
 * 仍可用视频内容生成闪卡/问答题，避免流程卡死。
 * @param {string} videoId
 * @returns {Object|null} - { node_id, node_name, definition, is_unclassified }
 */
export function getMainNodeForVideo(videoId) {
  // 1. 优先取已分类节点
  const node = db.prepare(`
    SELECT vn.node_id, vn.weight, kn.name as node_name, kn.definition, 0 as is_unclassified
    FROM video_nodes vn
    JOIN knowledge_nodes kn ON kn.node_id = vn.node_id
    WHERE vn.video_id = ? AND vn.is_unclassified = 0
    ORDER BY vn.weight DESC, vn.confidence DESC
    LIMIT 1
  `).get(videoId);
  if (node) return node;

  // 2. 兜底：取未分类节点
  const unclassified = db.prepare(`
    SELECT vn.node_id, vn.weight, vn.unclassified_name as node_name,
           '' as definition, 1 as is_unclassified
    FROM video_nodes vn
    WHERE vn.video_id = ? AND vn.is_unclassified = 1
    ORDER BY vn.confidence DESC
    LIMIT 1
  `).get(videoId);
  if (unclassified) {
    // 使用一个稳定的兜底 node_id，让 XP 系统不会报错，也不会污染真实知识树
    return {
      ...unclassified,
      node_id: 'unclassified',
      node_name: unclassified.node_name || '视频知识点',
    };
  }

  // 3. 最后的兜底：视频完全没有被 LLM 映射到任何节点时，
  //    用视频的 summary / title 作为主题生成闪卡，保证流程不卡死
  const video = db.prepare(`
    SELECT title, summary, manual_transcript FROM videos WHERE id = ?
  `).get(videoId);
  if (video) {
    const fallbackTopic = (video.summary || video.title || video.manual_transcript || '本视频内容')
      .split(/[。\.\n]/)[0]
      .slice(0, 40);
    return {
      node_id: 'unclassified',
      node_name: fallbackTopic || '视频知识点',
      definition: '',
      weight: 0,
      is_unclassified: 1,
    };
  }

  return null;
}

/**
 * 获取视频的加深理解内容（用于闪卡生成）
 * @param {string} videoId
 * @returns {Object|null}
 */
function getDeepenContent(videoId) {
  const row = db.prepare(`
    SELECT * FROM deepen_understanding WHERE video_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(videoId);
  if (!row) return null;
  return {
    brief_comment: row.brief_comment,
    comment_type: row.comment_type,
    corrections: safeParse(row.corrections, []),
    supplements: safeParse(row.supplements, []),
    structured_content: safeParse(row.structured_content, []),
  };
}

/**
 * 获取或创建闪卡
 * @param {string} videoId
 * @param {string} userId
 * @returns {Object} - { flashcards: [...], node_id, node_name }
 */
export async function getOrCreateFlashcards(videoId, userId) {
  // 1. 检查是否已有闪卡
  const existing = db.prepare(`
    SELECT * FROM flashcards WHERE video_id = ? ORDER BY created_at DESC
  `).all(videoId);

  if (existing.length > 0) {
    const firstNodeId = existing[0].node_id;
    const nodeName = firstNodeId === 'unclassified'
      ? '视频知识点'
      : (db.prepare('SELECT name FROM knowledge_nodes WHERE node_id = ?').get(firstNodeId)?.name || firstNodeId);
    return {
      flashcards: existing.map(c => ({
        id: c.id,
        front: c.front,
        back: c.back,
        trigger_type: c.trigger_type,
        difficulty: c.difficulty,
      })),
      node_id: firstNodeId,
      node_name: nodeName,
    };
  }

  // 2. 获取主知识点
  const mainNode = getMainNodeForVideo(videoId);
  if (!mainNode) {
    throw new Error('视频未关联任何知识节点，无法生成闪卡');
  }

  // 3. 调用 LLM 生成闪卡
  const deepenContent = getDeepenContent(videoId);
  const cards = await generateFlashcards(mainNode.node_name, mainNode.node_id, deepenContent);

  // 4. 存入数据库
  const insert = db.prepare(`
    INSERT INTO flashcards (id, video_id, node_id, front, back, trigger_type, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  const savedCards = [];
  for (const c of cards) {
    const id = nanoid(12);
    insert.run(id, videoId, mainNode.node_id, c.front, c.back, c.trigger_type, c.difficulty);
    savedCards.push({ id, ...c });
  }

  logger.info('[Internalize]', `视频 ${videoId} 生成 ${savedCards.length} 张闪卡`);

  return {
    flashcards: savedCards,
    node_id: mainNode.node_id,
    node_name: mainNode.node_name,
  };
}

/**
 * 获取或创建问答题
 * @param {string} videoId
 * @param {string} userId
 * @param {number|null} accuracy - 选择题正确率
 * @returns {Object} - 问答题信息
 */
export async function getOrCreateFreeformQuestion(videoId, userId, accuracy = null) {
  // 1. 检查是否已有问答题
  const existing = db.prepare(`
    SELECT * FROM freeform_questions WHERE video_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(videoId);

  if (existing) {
    return {
      questionId: existing.id,
      question: existing.question,
      target_knowledge: existing.target_knowledge,
      evaluation_criteria: safeParse(existing.evaluation_criteria, []),
      reference_answers: safeParse(existing.reference_answers, []),
      difficulty: existing.difficulty,
      node_id: existing.node_id,
    };
  }

  // 2. 获取主知识点
  const mainNode = getMainNodeForVideo(videoId);
  if (!mainNode) {
    throw new Error('视频未关联任何知识节点，无法生成问答题');
  }

  // 3. 调用 LLM 生成问答题
  const effectiveAccuracy = accuracy !== null ? accuracy : 70;
  const questionData = await generateFreeformQuestion(mainNode.node_name, mainNode.node_id, effectiveAccuracy);

  // 4. 存入数据库
  const questionId = nanoid(12);
  db.prepare(`
    INSERT INTO freeform_questions
      (id, video_id, node_id, question, target_knowledge, evaluation_criteria, reference_answers, difficulty)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    questionId,
    videoId,
    mainNode.node_id,
    questionData.question,
    questionData.target_knowledge,
    JSON.stringify(questionData.evaluation_criteria),
    JSON.stringify(questionData.reference_answers),
    questionData.difficulty
  );

  logger.info('[Internalize]', `视频 ${videoId} 生成问答题`);

  return {
    questionId,
    node_id: mainNode.node_id,
    node_name: mainNode.node_name,
    ...questionData,
  };
}

/**
 * 评估问答题回答
 * @param {string} videoId
 * @param {string} userId
 * @param {string} userInput
 * @returns {Object} - 评估结果 + XP
 */
export async function evaluateFreeformAttempt(videoId, userId, userInput) {
  // 1. 获取问答题
  const questionRow = db.prepare(`
    SELECT * FROM freeform_questions WHERE video_id = ? ORDER BY created_at DESC LIMIT 1
  `).get(videoId);

  if (!questionRow) {
    throw new Error('问答题不存在，请先获取问答题');
  }

  const question = {
    question: questionRow.question,
    target_knowledge: questionRow.target_knowledge,
    evaluation_criteria: safeParse(questionRow.evaluation_criteria, []),
    reference_answers: safeParse(questionRow.reference_answers, []),
  };

  // 2. 调用 LLM 评估
  const evaluation = await evaluateFreeformAnswer(question.target_knowledge, question, userInput);

  // 3. 计算 XP：基础 20，≥80 分额外 +10
  let xpGained = 20;
  if (evaluation.overall_score >= 80) xpGained += 10;

  // 4. 保存尝试记录
  const attemptId = nanoid(12);
  db.prepare(`
    INSERT INTO freeform_attempts
      (id, question_id, user_id, user_input, ai_evaluation, score)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(
    attemptId,
    questionRow.id,
    userId,
    userInput,
    JSON.stringify(evaluation),
    evaluation.overall_score
  );

  // 5. 更新知识树 XP
  const treeResult = addNodeXP(userId, questionRow.node_id, xpGained, 'freeform');

  // 6. 更新用户节点问答题统计
  db.prepare(`
    UPDATE user_nodes
    SET last_freeform_score = ?, updated_at = datetime('now')
    WHERE user_id = ? AND node_id = ?
  `).run(evaluation.overall_score, userId, questionRow.node_id);

  logger.info('[Internalize]', `用户 ${userId} 问答题完成: score=${evaluation.overall_score}, xp=+${xpGained}`);

  return {
    evaluation,
    xpGained,
    treeUpdate: {
      node_id: questionRow.node_id,
      xpGain: xpGained,
      oldLevel: treeResult.oldLevel,
      newLevel: treeResult.newLevel,
      leveledUp: treeResult.leveledUp,
      totalXp: treeResult.xp,
      stage: treeResult.stage,
    },
  };
}

/**
 * 完成闪卡阶段，发放 XP
 * @param {string} videoId
 * @param {string} userId
 * @param {number} knownCount
 * @returns {Object}
 */
export function completeFlashcards(videoId, userId, knownCount = 0) {
  const mainNode = getMainNodeForVideo(videoId);
  if (!mainNode) {
    throw new Error('视频未关联任何知识节点');
  }

  // 闪卡完成基础 +10 XP
  const xpGained = 10;
  const treeResult = addNodeXP(userId, mainNode.node_id, xpGained, 'flashcard');

  logger.info('[Internalize]', `用户 ${userId} 完成闪卡: known=${knownCount}, xp=+${xpGained}`);

  return {
    xpGained,
    knownCount,
    treeUpdate: {
      node_id: mainNode.node_id,
      xpGain: xpGained,
      oldLevel: treeResult.oldLevel,
      newLevel: treeResult.newLevel,
      leveledUp: treeResult.leveledUp,
      totalXp: treeResult.xp,
      stage: treeResult.stage,
    },
  };
}

/**
 * 完成整个内化环节（选择题提交后调用）
 * 与原有 processExerciseCompletion 复用逻辑
 * @param {string} userId
 * @param {string} videoId
 * @param {Array} attempts - 选择题答题结果
 * @returns {Object}
 */
export function completeChoiceExercises(userId, videoId, attempts) {
  const result = processExerciseCompletion(userId, videoId, attempts);

  // 标记视频问答题/内化完成（旧字段兼容）
  db.prepare(`
    UPDATE videos SET freeform_completed = 1, updated_at = datetime('now') WHERE id = ?
  `).run(videoId);

  return result;
}

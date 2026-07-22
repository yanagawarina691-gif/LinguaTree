import db from '../db/index.js';
import { nanoid } from 'nanoid';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { downloadVideo } from './videoDownload.js';
import { extractAudio, extractKeyframes, imageToBase64, cleanupTempFiles } from './mediaProcess.js';
import { transcribeAudio } from './asrService.js';
import { extractKnowledge, analyzeImage } from './llmService.js';
import { updateTreeFromVideo } from './treeService.js';

/**
 * 记录解析日志
 */
function logParse(videoId, stage, status, message, durationMs = 0) {
  db.prepare(`
    INSERT INTO parse_logs (video_id, stage, status, message, duration_ms)
    VALUES (?, ?, ?, ?, ?)
  `).run(videoId, stage, status, message, durationMs);
}

/**
 * 更新视频状态
 */
function updateVideoStatus(videoId, status, extra = {}) {
  const fields = ['status = ?'];
  const values = [status];
  for (const [key, val] of Object.entries(extra)) {
    fields.push(`${key} = ?`);
    values.push(val);
  }
  values.push(videoId);
  db.prepare(`UPDATE videos SET ${fields.join(', ')}, updated_at = datetime('now') WHERE id = ?`).run(...values);
}

/**
 * 保存解析结果到数据库
 */
function saveExtractionResult(videoId, extractionResult) {
  const { nodes, unclassified, exercises } = extractionResult;

  // 检查 node_id 是否存在于 knowledge_nodes 表中
  const allNodes = db.prepare('SELECT node_id FROM knowledge_nodes').all();
  const validNodeIds = new Set(allNodes.map(r => r.node_id));

  // 保存视频-节点映射
  const insertNode = db.prepare(`
    INSERT INTO video_nodes (video_id, node_id, weight, confidence, is_unclassified, unclassified_name)
    VALUES (?, ?, ?, ?, ?, ?)
  `);

  let savedNodes = 0;
  for (const node of nodes) {
    if (!validNodeIds.has(node.node_id)) {
      logger.warn('PIPELINE', `跳过不存在的节点: ${node.node_id}`);
      continue;
    }
    try {
      insertNode.run(videoId, node.node_id, node.weight, node.confidence, 0, '');
      savedNodes++;
    } catch (e) {
      logger.warn('PIPELINE', `插入节点 ${node.node_id} 失败: ${e.message}`);
    }
  }

  // 保存未分类节点（不需要 FK 检查，因为 is_unclassified=1 时不关联 knowledge_nodes）
  if (unclassified) {
    for (const unc of unclassified) {
      try {
        insertNode.run(videoId, 'unclassified', 0, unc.confidence || 0.5, 1, unc.name || '');
      } catch (e) {
        logger.warn('PIPELINE', `插入未分类节点失败: ${e.message}`);
      }
    }
  }

  // 保存题目
  const insertExercise = db.prepare(`
    INSERT INTO exercises (id, video_id, node_id, type, question, options, answer, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveExercise = (ex, type) => {
    if (!ex) return;
    const nodeId = ex.node_id || 'unclassified';
    if (!validNodeIds.has(nodeId)) {
      logger.warn('PIPELINE', `跳过题目（节点不存在）: ${nodeId}`);
      return;
    }
    try {
      insertExercise.run(
        nanoid(12), videoId, nodeId, type,
        ex.question || ex.sentence || ex.statement || '',
        JSON.stringify(ex.options || []),
        String(ex.answer),
        ex.explanation || ''
      );
    } catch (e) {
      logger.warn('PIPELINE', `保存${type}题失败: ${e.message}`);
    }
  };

  saveExercise(exercises.choice, 'choice');
  saveExercise(exercises.fill, 'fill');
  saveExercise(exercises.judge, 'judge');

  logger.stage('PIPELINE', `保存结果: ${savedNodes} 节点, ${unclassified?.length || 0} 未分类`);
}

/**
 * 执行完整的 AI 解析 Pipeline
 * @param {string} videoId - 视频 ID
 * @param {string} userId - 用户 ID
 * @param {string} url - 视频链接
 * @param {string} manualTranscript - 用户手动粘贴的文字稿（降级路径）
 */
export async function runPipeline(videoId, userId, url, manualTranscript = '') {
  const startTime = Date.now();
  const tempFiles = [];

  try {
    logger.stage('PIPELINE', `开始解析视频 ${videoId}: ${url}`);

    let asrText = '';
    let ocrText = '';
    let vlmDescription = '';
    let title = '';
    let author = '';

    // ========== 阶段一：多模态理解 ==========

    if (manualTranscript) {
      // 降级路径：用户手动粘贴文字稿
      logger.stage('PIPELINE', '使用手动文字稿模式（跳过视频下载和 ASR）');
      asrText = manualTranscript;
      logParse(videoId, 'asr', 'degraded', '使用用户手动粘贴的文字稿');
      logParse(videoId, 'download', 'skipped', '手动模式跳过下载');
      logParse(videoId, 'ocr', 'skipped', '手动模式跳过 OCR');
      logParse(videoId, 'vlm', 'skipped', '手动模式跳过 VLM');
    } else {
      // 正常路径：下载视频
      updateVideoStatus(videoId, 'downloading');
      const dlStart = Date.now();
      try {
        const { videoPath, title: dlTitle, author: dlAuthor } = await downloadVideo(url, videoId);
        title = dlTitle;
        author = dlAuthor;
        tempFiles.push(videoPath);
        logParse(videoId, 'download', 'success', `下载完成: ${videoPath}`, Date.now() - dlStart);
        updateVideoStatus(videoId, 'asr', { title, author });
      } catch (err) {
        logParse(videoId, 'download', 'error', err.message, Date.now() - dlStart);
        throw new Error(`视频下载失败: ${err.message}。建议使用手动粘贴文字稿方式`);
      }

      // ASR 语音转写
      try {
        updateVideoStatus(videoId, 'asr');
        const asrStart = Date.now();
        const audioPath = await extractAudio(tempFiles[0], videoId);
        tempFiles.push(audioPath);
        asrText = await transcribeAudio(audioPath);
        updateVideoStatus(videoId, 'ocr', { asr_text: asrText });
        logParse(videoId, 'asr', 'success', `转写完成: ${asrText.length}字符`, Date.now() - asrStart);
      } catch (err) {
        logParse(videoId, 'asr', 'error', err.message);
        logger.warn('PIPELINE', `ASR 失败，降级为空文字稿: ${err.message}`);
        // ASR 失败不中断，继续 OCR/VLM
      }

      // OCR + VLM（画面文字识别 + 场景描述）
      try {
        updateVideoStatus(videoId, 'ocr');
        const ocrStart = Date.now();
        const frames = await extractKeyframes(tempFiles[0], videoId);
        frames.forEach(f => tempFiles.push(f));

        // 对关键帧并行执行 OCR 和 VLM
        const ocrResults = [];
        const vlmResults = [];

        for (const frame of frames) {
          const base64 = imageToBase64(frame);
          try {
            const [ocr, vlm] = await Promise.all([
              analyzeImage(base64, 'ocr'),
              analyzeImage(base64, 'vlm'),
            ]);
            ocrResults.push(ocr);
            vlmResults.push(vlm);
          } catch (err) {
            logger.warn('PIPELINE', `关键帧分析失败: ${err.message}`);
          }
        }

        ocrText = ocrResults.filter(t => t && t !== '无文字内容').join('\n');
        vlmDescription = vlmResults.filter(t => t).join('\n');

        updateVideoStatus(videoId, 'vlm', {
          ocr_text: ocrText,
          vlm_description: vlmDescription,
        });
        logParse(videoId, 'ocr', 'success', `OCR: ${ocrText.length}字符`, Date.now() - ocrStart);
        logParse(videoId, 'vlm', 'success', `VLM: ${vlmDescription.length}字符`, Date.now() - ocrStart);
      } catch (err) {
        logParse(videoId, 'ocr', 'error', err.message);
        logger.warn('PIPELINE', `OCR/VLM 失败，降级为仅文本: ${err.message}`);
        // OCR/VLM 失败不中断，继续 LLM
      }
    }

    // ========== 阶段二：LLM 知识点抽取与映射 ==========

    if (!asrText && !ocrText && !vlmDescription && !manualTranscript) {
      // 所有文本来源都为空
      updateVideoStatus(videoId, 'error', {
        error_message: '未能获取任何文本内容（ASR/OCR/VLM/手动文字稿均为空）',
      });
      logParse(videoId, 'llm', 'error', '无可用文本');
      throw new Error('未能识别到任何文本内容，请尝试手动粘贴文字稿');
    }

    logger.stage('LLM', `可用文本: ASR=${asrText.length}字, OCR=${ocrText.length}字, VLM=${vlmDescription.length}字${manualTranscript ? ', 手动文字稿=' + manualTranscript.length + '字' : ''}`);

    updateVideoStatus(videoId, 'llm');
    const llmStart = Date.now();
    const extractionResult = await extractKnowledge({
      title,
      author,
      asr_text: asrText,
      ocr_text: ocrText,
      vlm_description: vlmDescription,
      manual_transcript: manualTranscript,
    });

    logParse(videoId, 'llm', 'success', `抽取 ${extractionResult.nodes?.length || 0} 个节点`, Date.now() - llmStart);

    // 保存解析结果
    saveExtractionResult(videoId, extractionResult);

    // 更新视频记录
    updateVideoStatus(videoId, 'done', {
      cefr_level: extractionResult.cefr_level || '',
      summary: extractionResult.summary || '',
    });

    // ========== 阶段三：知识树更新 ==========

    // MVP 阶段：完播率默认为 1.0（实际前端可以传入）
    // 巩固训练的 XP 在用户提交答案后再更新
    const completionRate = 1.0;
    const treeResult = updateTreeFromVideo(
      userId,
      videoId,
      extractionResult.nodes || [],
      completionRate,
      [] // 巩固训练答对列表，初始为空
    );

    logParse(videoId, 'tree_update', 'success', `${treeResult.updatedNodes.length} 节点更新, ${treeResult.leveledUpNodes.length} 升级`);

    // 清理临时文件
    cleanupTempFiles(tempFiles);

    const totalDuration = Date.now() - startTime;
    logger.stage('PIPELINE', `解析完成! 耗时 ${(totalDuration / 1000).toFixed(1)}s`);

    return {
      videoId,
      status: 'done',
      title,
      author,
      asrText,
      ocrText,
      vlmDescription,
      nodes: extractionResult.nodes || [],
      unclassified: extractionResult.unclassified || [],
      cefrLevel: extractionResult.cefr_level || '',
      summary: extractionResult.summary || '',
      exercises: extractionResult.exercises || {},
      treeUpdate: treeResult,
      duration: totalDuration,
    };
  } catch (error) {
    logger.error('PIPELINE', `解析失败: ${error.message}`);
    updateVideoStatus(videoId, 'error', { error_message: error.message });
    logParse(videoId, 'pipeline', 'error', error.message, Date.now() - startTime);

    // 清理临时文件
    cleanupTempFiles(tempFiles);

    throw error;
  }
}

/**
 * 处理巩固训练完成后的树更新
 * @param {string} userId
 * @param {string} videoId
 * @param {Array} attempts - [{ exerciseId, nodeId, isCorrect, isSkipped, userAnswer }]
 * @returns {Object} - { correctNodeIds, treeUpdate }
 */
export function processExerciseCompletion(userId, videoId, attempts) {
  const correctNodeIds = [];
  const insertAttempt = db.prepare(`
    INSERT INTO exercise_attempts (user_id, exercise_id, video_id, node_id, is_correct, is_skipped, user_answer)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const attempt of attempts) {
    insertAttempt.run(
      userId,
      attempt.exerciseId,
      videoId,
      attempt.nodeId,
      attempt.isCorrect ? 1 : 0,
      attempt.isSkipped ? 1 : 0,
      attempt.userAnswer || ''
    );

    if (attempt.isCorrect && !attempt.isSkipped) {
      if (!correctNodeIds.includes(attempt.nodeId)) {
        correctNodeIds.push(attempt.nodeId);
      }
    }
  }

  // 获取该视频映射的节点
  const videoNodes = db.prepare(`
    SELECT node_id, weight FROM video_nodes
    WHERE video_id = ? AND is_unclassified = 0
  `).all(videoId);

  // 重新计算树更新（包含答题正确加的 XP）
  const treeResult = updateTreeFromVideo(
    userId,
    videoId,
    videoNodes,
    1.0,
    correctNodeIds
  );

  return { correctNodeIds, treeResult };
}

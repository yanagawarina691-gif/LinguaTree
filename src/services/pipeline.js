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
/**
 * 清理矿石名称：去除引号、前缀、空格，截断到 12 字符
 */
function cleanOreName(raw) {
  if (!raw) return '未分类知识点';
  let name = String(raw)
    .replace(/['""''「」《》\[\]【】`]+/g, '')
    .replace(/^(本视频|视频|主要|核心|该视频|此视频)?(聚焦于|聚焦|讲解|讨论|介绍|关于|讲述|分享|涉及)/, '')
    .replace(/^(的|是|一个|一种|这项|该|此|内容)/, '')
    .replace(/[，。,.\n].*$/s, '')
    .replace(/\s+/g, ' ')
    .trim();
  if (name.length > 12) name = name.slice(0, 12);
  return name || '未分类知识点';
}

/**
 * 保存 AI 抽取结果 — 动态创建矿石节点
 * v2: 每次解析创建新矿石，或合并到已有矿石
 */
function saveExtractionResult(videoId, extractionResult) {
  const { ores, exercises } = extractionResult;

  const TAG_COLORS = [
    '#58CC02', '#3B82F6', '#A855F7', '#EF4444',
    '#F59E0B', '#EC4899', '#06B6D4', '#84CC16', '#F97316',
  ];

  // 注册/更新标签
  const ensureTag = db.prepare(`
    INSERT INTO tags (name, color, ore_count) VALUES (?, ?, 1)
    ON CONFLICT(name) DO UPDATE SET ore_count = ore_count + 1
  `);

  // 创建/获取矿石节点
  const insertOre = db.prepare(`
    INSERT INTO ore_nodes (name, description, tags, color, created_from_video_id)
    VALUES (?, ?, ?, ?, ?)
  `);

  // 视频-矿石映射
  const insertVideoOre = db.prepare(`
    INSERT OR IGNORE INTO video_ores (video_id, ore_id, confidence)
    VALUES (?, ?, ?)
  `);

  // 更新矿石 video_count
  const bumpOreCount = db.prepare(`
    UPDATE ore_nodes SET video_count = video_count + 1 WHERE id = ?
  `);

  const savedOreIds = [];

  const txn = db.transaction(() => {
    for (const ore of (ores || [])) {
      let oreId;

      // 合并逻辑：如果 LLM 提示合并到已有矿石
      if (ore.merge_hint) {
        const existing = db.prepare('SELECT id FROM ore_nodes WHERE id = ?').get(ore.merge_hint);
        if (existing) {
          oreId = existing.id;
          bumpOreCount.run(oreId);
          insertVideoOre.run(videoId, oreId, ore.confidence || 0.7);
          savedOreIds.push(oreId);
          continue;
        }
      }

      // 去重：检查是否已有同名矿石
      const dup = db.prepare('SELECT id FROM ore_nodes WHERE name = ?').get(ore.name);
      if (dup) {
        oreId = dup.id;
        bumpOreCount.run(oreId);
        insertVideoOre.run(videoId, oreId, ore.confidence || 0.7);
        savedOreIds.push(oreId);
        continue;
      }

      // 创建新矿石
      const tags = ore.tags || [];
      const tagColor = TAG_COLORS[Math.floor(Math.random() * TAG_COLORS.length)];
      const cleanedName = cleanOreName(ore.name);

      const result = insertOre.run(
        cleanedName,
        ore.description || '',
        JSON.stringify(tags),
        tagColor,
        videoId
      );
      oreId = result.lastInsertRowid;

      // 注册标签
      for (const tag of tags) {
        try { ensureTag.run(tag, tagColor); } catch {}
      }

      insertVideoOre.run(videoId, oreId, ore.confidence || 0.7);
      savedOreIds.push(oreId);
    }
  });

  txn();

  // 保存题目（关联到第一个矿石）
  const insertExercise = db.prepare(`
    INSERT INTO exercises (id, video_id, ore_id, type, question, options, answer, explanation)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)
  `);

  const saveExercise = (ex, type) => {
    if (!ex || savedOreIds.length === 0) return;
    try {
      insertExercise.run(
        nanoid(12), videoId, savedOreIds[0], type,
        ex.question || '',
        JSON.stringify(ex.options || []),
        String(ex.answer),
        ex.explanation || ''
      );
    } catch (e) {
      logger.warn('PIPELINE', `保存${type}题失败: ${e.message}`);
    }
  };

  saveExercise(exercises?.choice, 'choice');
  saveExercise(exercises?.fill, 'fill');
  saveExercise(exercises?.judge, 'judge');

  logger.stage('PIPELINE', `保存结果: ${savedOreIds.length} 个矿石`);
  return savedOreIds;
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

    logParse(videoId, 'llm', 'success', `抽取 ${extractionResult.ores?.length || 0} 个矿石`, Date.now() - llmStart);

    // 保存解析结果（创建矿石节点）
    const savedOreIds = saveExtractionResult(videoId, extractionResult);

    // 如果没有真实视频标题（比如手动文字稿），用第一颗矿石名作为标题
    if (!title && savedOreIds.length > 0) {
      const firstOre = db.prepare('SELECT name FROM ore_nodes WHERE id = ?').get(savedOreIds[0]);
      if (firstOre) {
        db.prepare("UPDATE videos SET title = ? WHERE id = ?").run(firstOre.name, videoId);
        title = firstOre.name;
      }
    }

    // 更新视频记录
    updateVideoStatus(videoId, 'done', {
      cefr_level: extractionResult.cefr_level || '',
      summary: extractionResult.summary || '',
    });

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
      ores: extractionResult.ores || [],
      oreIds: savedOreIds,
      cefrLevel: extractionResult.cefr_level || '',
      summary: extractionResult.summary || '',
      exercises: extractionResult.exercises || {},
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
 * 处理巩固训练完成后的矿石更新
 */
export function processExerciseCompletion(userId, videoId, attempts) {
  const correctOreIds = [];
  const insertAttempt = db.prepare(`
    INSERT INTO exercise_attempts (user_id, exercise_id, video_id, ore_id, is_correct, is_skipped, user_answer)
    VALUES (?, ?, ?, ?, ?, ?, ?)
  `);

  for (const attempt of attempts) {
    insertAttempt.run(
      userId,
      attempt.exerciseId,
      videoId,
      attempt.oreId || attempt.nodeId,
      attempt.isCorrect ? 1 : 0,
      attempt.isSkipped ? 1 : 0,
      attempt.userAnswer || ''
    );

    if (attempt.isCorrect && !attempt.isSkipped) {
      const oid = attempt.oreId || attempt.nodeId;
      if (!correctOreIds.includes(oid)) {
        correctOreIds.push(oid);
      }
    }
  }

  const videoOres = db.prepare(`
    SELECT ore_id FROM video_ores WHERE video_id = ?
  `).all(videoId).map(r => r.ore_id);

  const treeResult = updateTreeFromVideo(userId, videoId, videoOres, 1.0, correctOreIds);

  return { correctOreIds, treeResult };
}

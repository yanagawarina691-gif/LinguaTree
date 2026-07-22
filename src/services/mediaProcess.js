import ffmpeg from 'fluent-ffmpeg';
import { existsSync, mkdirSync, readFileSync, unlinkSync } from 'fs';
import { join, extname } from 'path';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

const TEMP_DIR = config.TEMP_DIR;

/**
 * 从视频中提取音频（转为 mp3）
 * @param {string} videoPath - 视频文件路径
 * @param {string} outputName - 输出文件名（不含扩展名）
 * @returns {string} - 音频文件路径
 */
export function extractAudio(videoPath, outputName) {
  return new Promise((resolve, reject) => {
    const audioPath = join(TEMP_DIR, `${outputName}.mp3`);
    mkdirSync(TEMP_DIR, { recursive: true });

    logger.stage('FFMPEG', `提取音频: ${videoPath} → ${audioPath}`);

    ffmpeg(videoPath)
      .noVideo()
      .audioCodec('libmp3lame')
      .audioBitrate('128k')
      .format('mp3')
      .on('start', (cmd) => logger.debug('FFMPEG', `command: ${cmd}`))
      .on('end', () => {
        if (existsSync(audioPath)) {
          logger.stage('FFMPEG', `音频提取完成: ${audioPath}`);
          resolve(audioPath);
        } else {
          reject(new Error('音频提取完成但文件不存在'));
        }
      })
      .on('error', (err) => {
        logger.error('FFMPEG', `音频提取失败: ${err.message}`);
        reject(new Error(`音频提取失败: ${err.message}`));
      })
      .save(audioPath);
  });
}

/**
 * 从视频中提取关键帧（截图）
 * @param {string} videoPath - 视频文件路径
 * @param {string} outputName - 输出文件名前缀
 * @param {number} count - 要提取的关键帧数量
 * @returns {string[]} - 关键帧图片路径数组
 */
export function extractKeyframes(videoPath, outputName, count = null) {
  const frameCount = count || config.KEYFRAME_COUNT;
  return new Promise((resolve, reject) => {
    const frameDir = join(TEMP_DIR, `${outputName}_frames`);
    mkdirSync(frameDir, { recursive: true });

    // 获取视频时长
    ffmpeg.ffprobe(videoPath, (err, metadata) => {
      if (err) {
        reject(new Error(`获取视频信息失败: ${err.message}`));
        return;
      }

      const duration = metadata?.format?.duration || 60;
      // 在视频中间均匀分布截取关键帧，跳过开头和结尾各 10%
      const startPct = 0.1;
      const endPct = 0.9;
      const timestamps = [];
      for (let i = 0; i < frameCount; i++) {
        const pct = startPct + (endPct - startPct) * (i + 0.5) / frameCount;
        timestamps.push(duration * pct);
      }

      logger.stage('FFMPEG', `提取 ${frameCount} 个关键帧, 时长 ${duration.toFixed(1)}s, 时间点: ${timestamps.map(t => t.toFixed(1) + 's').join(', ')}`);

      const promises = timestamps.map((ts, i) => {
        return new Promise((resolveFrame, rejectFrame) => {
          const framePath = join(frameDir, `frame_${i}.jpg`);
          ffmpeg(videoPath)
            .screenshots({
              timestamps: [ts],
              filename: `frame_${i}.jpg`,
              folder: frameDir,
              size: '1280x720',
              quality: 3,
            })
            .on('end', () => {
              if (existsSync(framePath)) {
                resolveFrame(framePath);
              } else {
                rejectFrame(new Error(`关键帧 ${i} 未生成`));
              }
            })
            .on('error', (err) => rejectFrame(err));
        });
      });

      Promise.allSettled(promises).then((results) => {
        const frames = results
          .filter(r => r.status === 'fulfilled')
          .map(r => r.value);

        if (frames.length === 0) {
          reject(new Error('所有关键帧提取失败'));
        } else {
          logger.stage('FFMPEG', `成功提取 ${frames.length}/${frameCount} 个关键帧`);
          resolve(frames);
        }
      });
    });
  });
}

/**
 * 将图片转为 base64
 * @param {string} imagePath - 图片路径
 * @returns {string} - base64 编码（不含 data: 前缀）
 */
export function imageToBase64(imagePath) {
  const buffer = readFileSync(imagePath);
  return buffer.toString('base64');
}

/**
 * 清理临时文件
 * @param {string[]} paths - 要删除的文件路径数组
 */
export function cleanupTempFiles(paths) {
  for (const p of paths) {
    try {
      if (existsSync(p)) {
        unlinkSync(p);
      }
    } catch (e) {
      logger.debug('FFMPEG', `清理 ${p} 失败: ${e.message}`);
    }
  }
}

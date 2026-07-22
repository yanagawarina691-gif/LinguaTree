import axios from 'axios';
import { spawn, execFile } from 'child_process';
import { createWriteStream, mkdirSync, existsSync, statSync, renameSync, unlinkSync } from 'fs';
import { join, extname } from 'path';
import { pipeline } from 'stream/promises';
import ffmpeg from 'fluent-ffmpeg';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';
import { isDouyinUrl, downloadDouyinVideo } from './douyinDownload.js';
// douyinDownload.js: iesdouyin 分享页直接解析方案 + 可选第三方 API

const TEMP_DIR = config.TEMP_DIR;

/**
 * 检测 yt-dlp 是否可用
 */
function checkYtDlp() {
  try {
    spawn('yt-dlp', ['--version'], { stdio: 'pipe' });
    return true;
  } catch {
    return false;
  }
}

/**
 * 验证下载的文件是否为有效视频（通过 ffprobe 检查）
 */
function validateVideoFile(filePath) {
  return new Promise((resolve) => {
    ffmpeg.ffprobe(filePath, (err, metadata) => {
      if (err) {
        logger.error('DOWNLOAD', `文件验证失败（非有效视频）: ${err.message}`);
        resolve(false);
        return;
      }
      const hasVideoStream = (metadata.streams || []).some(s => s.codec_type === 'video');
      const hasAudioStream = (metadata.streams || []).some(s => s.codec_type === 'audio');
      if (hasVideoStream || hasAudioStream) {
        logger.stage('DOWNLOAD', `文件验证通过: 视频=${hasVideoStream}, 音频=${hasAudioStream}, 时长=${metadata.format?.duration || '未知'}s`);
        resolve(true);
      } else {
        logger.error('DOWNLOAD', '文件验证失败：未找到视频或音频流');
        resolve(false);
      }
    });
  });
}

/**
 * 使用 yt-dlp 下载视频（支持抖音、B站等平台）
 * @param {string} url - 视频链接
 * @param {string} outputPath - 输出路径
 * @param {string[]} extraArgs - 额外的 yt-dlp 参数（如 --cookies-from-browser）
 */
function downloadWithYtDlp(url, outputPath, extraArgs = []) {
  return new Promise((resolve, reject) => {
    const args = [
      '-o', outputPath.replace(extname(outputPath), ''),
      '--format', 'best',
      '--no-playlist',
      '--no-warnings',
      '--retries', '3',
      ...extraArgs,
      url
    ];

    const ytDlp = spawn('yt-dlp', args, { stdio: 'pipe' });
    let stderr = '';

    ytDlp.stderr.on('data', (data) => {
      stderr += data.toString();
    });

    ytDlp.on('close', (code) => {
      if (code === 0) {
        const possibleExts = ['.mp4', '.webm', '.mkv', ''];
        let foundFile = null;
        for (const ext of possibleExts) {
          const candidate = outputPath.replace(extname(outputPath), '') + ext;
          if (existsSync(candidate)) {
            foundFile = candidate;
            break;
          }
        }
        if (foundFile) {
          if (extname(foundFile) !== '.mp4') {
            const newPath = foundFile.replace(extname(foundFile), '.mp4');
            renameSync(foundFile, newPath);
            foundFile = newPath;
          }
          resolve(foundFile);
        } else {
          reject(new Error('yt-dlp 下载完成但未找到输出文件'));
        }
      } else {
        reject(new Error(`yt-dlp 退出码 ${code}: ${stderr.slice(0, 500)}`));
      }
    });

    ytDlp.on('error', (err) => {
      reject(new Error(`yt-dlp 启动失败: ${err.message}`));
    });
  });
}

/**
 * 直接下载视频文件（适用于直链 mp4）
 */
async function downloadDirect(url, outputPath) {
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: 60000,
    maxRedirects: 5,
  });

  // 检查 content-type，拒绝 HTML 响应
  const contentType = response.headers['content-type'] || '';
  if (contentType.includes('text/html')) {
    throw new Error('下载目标为 HTML 页面而非视频文件（该链接可能需要浏览器 cookies）');
  }

  const writer = createWriteStream(outputPath);
  await pipeline(response.data, writer);

  return outputPath;
}

/**
 * 下载抖音视频
 * @param {string} url - 抖音视频链接（短链或完整链接）
 * @param {string} videoId - 视频 ID（用于命名临时文件）
 * @returns {Object} - { videoPath, title, author }
 */
export async function downloadVideo(url, videoId) {
  mkdirSync(TEMP_DIR, { recursive: true });
  const outputPath = join(TEMP_DIR, `${videoId}.mp4`);

  logger.stage('DOWNLOAD', `开始下载视频: ${url}`);

  // 抖音链接：优先用第三方解析 API，未配置则走 yt-dlp
  if (isDouyinUrl(url)) {
    try {
      logger.stage('DOWNLOAD', '检测到抖音链接，使用 iesdouyin 分享页解析');
      const result = await downloadDouyinVideo(url, videoId);
      if (!(await validateVideoFile(result.videoPath))) {
        try { unlinkSync(result.videoPath); } catch {}
        throw new Error('抖音视频下载后文件验证失败');
      }
      return result;
    } catch (err) {
      logger.warn('DOWNLOAD', `抖音解析下载失败，回退到 yt-dlp: ${err.message}`);
      // 继续走下面的 yt-dlp 逻辑
    }
  }

  // 如果是直接 mp4 链接
  if (url.match(/\.(mp4|webm)/i)) {
    logger.stage('DOWNLOAD', '检测到直接视频链接，直接下载');
    await downloadDirect(url, outputPath);
    const stats = statSync(outputPath);
    logger.stage('DOWNLOAD', `下载完成: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
    if (!(await validateVideoFile(outputPath))) {
      try { unlinkSync(outputPath); } catch {}
      throw new Error('下载的文件不是有效的视频文件');
    }
    return { videoPath: outputPath, title: '', author: '' };
  }

  // 尝试 yt-dlp（支持抖音等平台）
  if (checkYtDlp()) {
    // 第一次尝试：标准下载
    try {
      logger.stage('DOWNLOAD', '使用 yt-dlp 下载');
      const result = await downloadWithYtDlp(url, outputPath);

      // 验证下载的文件是有效视频
      if (!(await validateVideoFile(result))) {
        try { unlinkSync(result); } catch {}
        throw new Error('yt-dlp 下载的文件无效');
      }

      // 尝试获取视频信息
      let title = '';
      let author = '';
      try {
        const infoResult = await new Promise((resolve, reject) => {
          const proc = spawn('yt-dlp', ['--print', '%(title)s|||%(uploader)s', '--no-warnings', url], { stdio: 'pipe' });
          let output = '';
          proc.stdout.on('data', (d) => output += d.toString());
          proc.on('close', () => resolve(output.trim()));
          proc.on('error', reject);
        });
        if (infoResult) {
          const parts = infoResult.split('|||');
          title = parts[0] || '';
          author = parts[1] || '';
        }
      } catch {}

      const stats = statSync(result);
      logger.stage('DOWNLOAD', `下载完成: ${result} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
      return { videoPath: result, title, author };
    } catch (err) {
      logger.warn('DOWNLOAD', `yt-dlp 首次失败: ${err.message}`);

      // 第二次尝试：使用浏览器 cookies（解决抖音需要 cookies 的问题）
      try {
        logger.stage('DOWNLOAD', '使用 yt-dlp + 浏览器 cookies 重试');
        const result = await downloadWithYtDlp(url, outputPath, ['--cookies-from-browser', 'chrome']);

        if (!(await validateVideoFile(result))) {
          try { unlinkSync(result); } catch {}
          throw new Error('yt-dlp (cookies) 下载的文件无效');
        }

        let title = '';
        let author = '';
        try {
          const infoResult = await new Promise((resolve, reject) => {
            const proc = spawn('yt-dlp', ['--print', '%(title)s|||%(uploader)s', '--no-warnings', '--cookies-from-browser', 'chrome', url], { stdio: 'pipe' });
            let output = '';
            proc.stdout.on('data', (d) => output += d.toString());
            proc.on('close', () => resolve(output.trim()));
            proc.on('error', reject);
          });
          if (infoResult) {
            const parts = infoResult.split('|||');
            title = parts[0] || '';
            author = parts[1] || '';
          }
        } catch {}

        const stats = statSync(result);
        logger.stage('DOWNLOAD', `下载完成 (cookies): ${result} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
        return { videoPath: result, title, author };
      } catch (err2) {
        logger.warn('DOWNLOAD', `yt-dlp cookies 也失败: ${err2.message}`);
      }
    }
  }

  // 尝试直接 HTTP 下载（某些抖音短链重定向到视频文件）
  try {
    logger.stage('DOWNLOAD', '尝试直接 HTTP 下载');
    await downloadDirect(url, outputPath);
    const stats = statSync(outputPath);
    logger.stage('DOWNLOAD', `下载完成: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);
    if (!(await validateVideoFile(outputPath))) {
      try { unlinkSync(outputPath); } catch {}
      throw new Error('直接下载的文件不是有效视频（可能拿到了 HTML 页面）');
    }
    return { videoPath: outputPath, title: '', author: '' };
  } catch (err) {
    logger.error('DOWNLOAD', `直接下载也失败: ${err.message}`);
    throw new Error(`视频下载失败: ${err.message}。建议：1) 使用手动粘贴文字稿方式；2) 提供直链 mp4 URL；3) 配置 yt-dlp 浏览器 cookies`);
  }
}

import axios from 'axios';
import { createWriteStream, mkdirSync, statSync } from 'fs';
import { join } from 'path';
import { pipeline } from 'stream/promises';
import { logger } from '../utils/logger.js';
import { config } from '../config.js';

const TEMP_DIR = config.TEMP_DIR;

// iPhone User-Agent — 抖音移动端分享页返回的结构化数据更完整
const DOUYIN_HEADERS = {
  'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) EdgiOS/121.0.2277.107 Version/17.0 Mobile/15E148 Safari/604.1',
};

/**
 * 检测 URL 是否为抖音链接
 */
export function isDouyinUrl(url) {
  return /douyin\.com|iesdouyin\.com|v\.douyin\.com/.test(url);
}

/**
 * 从分享文本中提取 URL
 */
function extractUrlFromText(text) {
  const match = text.match(/https?:\/\/[^\s]+/);
  return match ? match[0] : null;
}

/**
 * 从 iesdouyin 分享页 HTML 中提取视频信息
 * 新版分享页通过 _ROUTER_DATA JSON 返回视频数据
 */
function extractVideoInfoFromHtml(html, videoId) {
  // 方案1：从 _ROUTER_DATA JSON 中提取（新版分享页）
  const routerMatch = html.match(/window\._ROUTER_DATA\s*=\s*(\{[\s\S]*?\})\s*<\/script>/);
  if (routerMatch) {
    try {
      const routerData = JSON.parse(routerMatch[1]);
      const videoPageData = routerData?.loaderData?.['video_(id)/page'];
      const videoInfoRes = videoPageData?.videoInfoRes;

      if (videoInfoRes?.item_list && videoInfoRes.item_list.length > 0) {
        const item = videoInfoRes.item_list[0];
        const video = item.video || {};
        const playAddr = video.play_addr || {};
        const urlList = playAddr.url_list || [];

        if (urlList.length > 0) {
          // playwm → play 去水印
          const videoUrl = urlList[0].replace('playwm', 'play');
          const title = (item.desc || '').replace(/[\\/:*?"<>|]/g, '_').trim() || `douyin_${videoId}`;
          const author = item.author?.nickname || '';
          logger.stage('DOUYIN', `从 _ROUTER_DATA 提取成功: ${videoUrl.substring(0, 80)}...`);
          return { videoUrl, title, videoId, author };
        }
      }

      // 检查是否视频不存在
      if (videoInfoRes?.filter_list && videoInfoRes.filter_list.length > 0) {
        const reason = videoInfoRes.filter_list[0].filter_reason;
        if (reason === 'SYSTEM_ITEM_NOT_EXIST') {
          throw new Error(`视频不存在或已删除 (videoId: ${videoId})`);
        }
      }
    } catch (e) {
      if (e.message.includes('不存在或已删除')) throw e;
      logger.warn('DOUYIN', `_ROUTER_DATA 解析失败: ${e.message}`);
    }
  }

  // 方案2：旧版正则匹配（兼容旧页面结构）
  const playAddrMatch = html.match(/"play_addr"[^}]*"url_list"[^[]*\[\s*"([^"]+)"/);
  if (playAddrMatch && playAddrMatch[1]) {
    const videoUrl = playAddrMatch[1].replace('playwm', 'play');
    const titleMatch = html.match(/"desc"\s*:\s*"([^"]+)"/) || html.match(/<title>([^<]+)<\/title>/);
    const title = titleMatch
      ? titleMatch[1].replace(/[\\/:*?"<>|]/g, '_').trim()
      : `douyin_${videoId}`;
    return { videoUrl, title, videoId, author: '' };
  }

  // 方案3：正则搜索 douyinvod CDN 链接
  const cdnMatch = html.match(/https?:\/\/[^"]*douyinvod\.com[^"]*/);
  if (cdnMatch) {
    const videoUrl = cdnMatch[0].replace('playwm', 'play');
    return { videoUrl, title: `douyin_${videoId}`, videoId, author: '' };
  }

  // 备用：aweme.snssdk.com 播放链接（可能无效）
  const backupUrl = `https://aweme.snssdk.com/aweme/v1/play/?video_id=${videoId}`;
  return {
    videoUrl: backupUrl,
    title: `douyin_${videoId}`,
    videoId,
    author: '',
  };
}

/**
 * 解析抖音分享链接，获取无水印视频直链
 * 核心逻辑：短链跟随重定向 → 提取视频ID → 请求 iesdouyin 分享页 → 从 _ROUTER_DATA 中提取视频直链
 *
 * 如果配置了 DOUYIN_PARSE_API，优先使用第三方解析 API
 */
async function parseShareUrl(shareText) {
  // 如果配置了第三方 API，优先使用
  if (config.DOUYIN_PARSE_API) {
    try {
      const result = await parseWithThirdPartyApi(shareText);
      if (result) return result;
    } catch (err) {
      logger.warn('DOUYIN', `第三方 API 解析失败，回退到直接解析: ${err.message}`);
    }
  }

  // 直接解析方案
  const shareUrl = extractUrlFromText(shareText);
  if (!shareUrl) {
    throw new Error('未找到有效的分享链接');
  }

  logger.stage('DOUYIN', `解析分享链接: ${shareUrl}`);

  // 步骤1：跟随短链重定向，获取最终 URL（含视频 ID）
  const shareResponse = await axios.get(shareUrl, {
    headers: DOUYIN_HEADERS,
    maxRedirects: 5,
    timeout: 15000,
  });

  // 从最终 URL 提取视频 ID
  const finalUrl = shareResponse.request?.res?.responseUrl || shareUrl;
  const videoIdMatch = finalUrl.match(/video\/([^/?]+)/);
  let videoId = videoIdMatch ? videoIdMatch[1] : '';

  // 如果 URL 中没有 video ID，尝试从重定向后的 URL 中匹配其他模式
  if (!videoId) {
    const altMatch = finalUrl.match(/\/(?:video|share)\/(\d+)/);
    videoId = altMatch ? altMatch[1] : '';
  }

  // 如果完整链接格式是 douyin.com/video/xxx，直接提取
  if (!videoId) {
    const directMatch = shareUrl.match(/video\/([^/?]+)/);
    videoId = directMatch ? directMatch[1] : '';
  }

  if (!videoId) {
    throw new Error('无法从链接中提取视频 ID');
  }

  logger.stage('DOUYIN', `提取到视频 ID: ${videoId}`);

  // 步骤2：请求 iesdouyin 分享页，从 HTML 中提取视频信息
  const videoPageUrl = `https://www.iesdouyin.com/share/video/${videoId}`;
  logger.stage('DOUYIN', `请求分享页: ${videoPageUrl}`);

  const response = await axios.get(videoPageUrl, {
    headers: DOUYIN_HEADERS,
    timeout: 15000,
  });

  const videoInfo = extractVideoInfoFromHtml(response.data, videoId);

  if (!videoInfo.videoUrl) {
    throw new Error('从分享页中未提取到视频直链');
  }

  logger.stage('DOUYIN', `解析成功: ${videoInfo.videoUrl.substring(0, 80)}...`);
  if (videoInfo.title) {
    logger.stage('DOUYIN', `视频标题: ${videoInfo.title}`);
  }

  return videoInfo;
}

/**
 * 使用第三方解析 API（可选，配置 DOUYIN_PARSE_API 时生效）
 */
async function parseWithThirdPartyApi(douyinUrl) {
  const apiUrl = config.DOUYIN_PARSE_API;
  if (!apiUrl) return null;

  logger.stage('DOUYIN', `使用第三方 API: ${apiUrl}`);

  let response;
  if (apiUrl.includes('{url}')) {
    const fullUrl = apiUrl.replace('{url}', encodeURIComponent(douyinUrl));
    response = await axios.get(fullUrl, { timeout: 15000, headers: { 'User-Agent': 'Mozilla/5.0' } });
  } else if (apiUrl.includes('?') || apiUrl.includes('=')) {
    const sep = apiUrl.includes('?') ? '&' : '?';
    response = await axios.get(`${apiUrl}${sep}url=${encodeURIComponent(douyinUrl)}`, {
      timeout: 15000,
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
  } else {
    response = await axios.post(apiUrl, { url: douyinUrl }, {
      timeout: 15000,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const data = response.data;
  const paths = ['url', 'video_url', 'videoUrl', 'play_url', 'playUrl', 'data.url', 'data.video_url', 'data.videoUrl', 'data.play_url', 'data.playUrl'];
  let videoUrl = null;
  for (const path of paths) {
    const value = path.split('.').reduce((obj, key) => obj?.[key], data);
    if (typeof value === 'string' && value.startsWith('http')) {
      videoUrl = value;
      break;
    }
  }
  if (!videoUrl) {
    const jsonStr = JSON.stringify(data);
    const match = jsonStr.match(/https?:\/\/[^"]+\.(?:mp4|m3u8)[^"]*/);
    if (match) videoUrl = match[0];
  }

  if (!videoUrl) return null;

  const titlePaths = ['title', 'desc', 'data.title', 'data.desc'];
  let title = '';
  for (const path of titlePaths) {
    const value = path.split('.').reduce((obj, key) => obj?.[key], data);
    if (typeof value === 'string' && value.length > 0) {
      title = value;
      break;
    }
  }

  return { videoUrl, title, videoId: '' };
}

/**
 * 下载视频文件
 */
async function downloadFile(url, outputPath) {
  const response = await axios({
    method: 'GET',
    url,
    responseType: 'stream',
    timeout: 120000,
    maxRedirects: 5,
    headers: DOUYIN_HEADERS,
  });

  const writer = createWriteStream(outputPath);
  await pipeline(response.data, writer);
  return outputPath;
}

/**
 * 下载抖音视频（支持短链、完整链接、分享文本）
 * @param {string} url - 抖音视频链接或分享文本
 * @param {string} videoId - 后端内部视频 ID（用于命名临时文件）
 * @returns {Object} - { videoPath, title, author }
 */
export async function downloadDouyinVideo(url, videoId) {
  mkdirSync(TEMP_DIR, { recursive: true });
  const outputPath = join(TEMP_DIR, `${videoId}.mp4`);

  // 1. 解析分享链接，获取无水印直链
  const videoInfo = await parseShareUrl(url);

  // 2. 下载视频
  logger.stage('DOUYIN', '开始下载视频...');
  await downloadFile(videoInfo.videoUrl, outputPath);

  const stats = statSync(outputPath);
  logger.stage('DOUYIN', `下载完成: ${outputPath} (${(stats.size / 1024 / 1024).toFixed(1)}MB)`);

  return {
    videoPath: outputPath,
    title: videoInfo.title || '',
    author: videoInfo.author || '',
  };
}

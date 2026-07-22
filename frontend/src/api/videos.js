import { api } from './client.js';

// 提交视频解析
export function parseVideo(url, manualTranscript) {
  const body = {};
  if (url) body.url = url;
  if (manualTranscript) body.manualTranscript = manualTranscript;
  return api('/api/videos/parse', {
    method: 'POST',
    body: JSON.stringify(body),
  });
}

// 查询解析状态
export function getVideoStatus(videoId) {
  return api(`/api/videos/${videoId}/status`);
}

// 获取视频详情（含节点映射和题目）
export function getVideoDetail(videoId) {
  return api(`/api/videos/${videoId}`);
}

// 获取视频列表
export function getVideoList() {
  return api('/api/videos');
}

// 提交巩固训练结果
export function completeExercises(videoId, attempts) {
  return api(`/api/videos/${videoId}/exercises/complete`, {
    method: 'POST',
    body: JSON.stringify({ attempts }),
  });
}

// 获取迁移场景（无则自动生成）
export function getMigration(videoId) {
  return api(`/api/videos/${videoId}/migration`);
}

// 提交迁移回答，获取 AI 评估
export function evaluateMigration(videoId, userInput) {
  return api(`/api/videos/${videoId}/migration/evaluate`, {
    method: 'POST',
    body: JSON.stringify({ userInput }),
  });
}

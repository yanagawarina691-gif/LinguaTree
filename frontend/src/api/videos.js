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

// 领取矿石（解析完成后选择"立即学习"）
export function claimVideo(videoId) {
  return api(`/api/videos/${videoId}/claim`, { method: 'POST' });
}

// 提交巩固训练结果
export function completeExercises(videoId, attempts) {
  return api(`/api/videos/${videoId}/exercises/complete`, {
    method: 'POST',
    body: JSON.stringify({ attempts }),
  });
}

// 获取加深理解内容（无则自动生成）
export function getDeepen(videoId) {
  return api(`/api/videos/${videoId}/deepen`);
}

// 标记加深理解完成或跳过
export function completeDeepen(videoId, skipped = false) {
  return api(`/api/videos/${videoId}/deepen`, {
    method: 'POST',
    body: JSON.stringify({ skipped }),
  });
}

// 提交加深理解反馈
export function feedbackDeepen(videoId, feedbackType, itemIndex = -1) {
  return api(`/api/videos/${videoId}/deepen/feedback`, {
    method: 'POST',
    body: JSON.stringify({ feedbackType, itemIndex }),
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

// ========== P1: 内化三模态 ==========

// 获取闪卡内容
export function getFlashcards(videoId) {
  return api(`/api/videos/${videoId}/internalize/flashcards`);
}

// 完成闪卡阶段
export function completeFlashcards(videoId, knownCount) {
  return api(`/api/videos/${videoId}/internalize/flashcards/complete`, {
    method: 'POST',
    body: JSON.stringify({ knownCount }),
  });
}

// 获取问答题
export function getFreeformQuestion(videoId, accuracy = null) {
  const qs = accuracy !== null ? `?accuracy=${accuracy}` : '';
  return api(`/api/videos/${videoId}/internalize/freeform${qs}`);
}

// 提交问答题回答
export function evaluateFreeform(videoId, userInput) {
  return api(`/api/videos/${videoId}/internalize/freeform/evaluate`, {
    method: 'POST',
    body: JSON.stringify({ userInput }),
  });
}

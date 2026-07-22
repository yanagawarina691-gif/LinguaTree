import { api } from './client.js';
import { getToken } from './client.js';

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

// 跳过迁移环节（记录跳过行为）
export function skipMigration(videoId) {
  return api(`/api/videos/${videoId}/migration/skip`, {
    method: 'POST',
  });
}

// ========== M1: 加深理解相关 API ==========

// 获取加深理解内容（非流式，缓存优先）
export function getDeepen(videoId) {
  return api(`/api/videos/${videoId}/deepen`);
}

// 提交加深理解反馈
export function postDeepenFeedback(videoId, { type, target, message }) {
  return api(`/api/videos/${videoId}/deepen/feedback`, {
    method: 'POST',
    body: JSON.stringify({ type, target, message }),
  });
}

// 标记加深理解完成（幂等，发放 +10 XP）
export function completeDeepen(videoId) {
  return api(`/api/videos/${videoId}/deepen/complete`, {
    method: 'POST',
  });
}

// 重新生成加深理解内容
export function regenerateDeepen(videoId) {
  return api(`/api/videos/${videoId}/deepen/regenerate`, {
    method: 'POST',
  });
}

/**
 * SSE 流式获取加深理解内容
 * @param {string} videoId
 * @param {Object} callbacks - { onComment, onCorrections, onSupplements, onStructured, onDone, onError }
 * @param {AbortSignal} [signal] - 可选，用于中断
 */
export function streamDeepen(videoId, callbacks, signal) {
  const {
    onComment,
    onCorrections,
    onSupplements,
    onStructured,
    onDone,
    onError,
  } = callbacks;

  // 使用 fetch + ReadableStream 解析 SSE（EventSource 不支持自定义 header 传 token）
  const token = getToken();
  const headers = { 'Accept': 'text/event-stream' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  fetch(`/api/videos/${videoId}/deepen/stream`, { headers, signal })
    .then(async (response) => {
      if (!response.ok) {
        const data = await response.json().catch(() => ({}));
        throw new Error(data.error || `请求失败: ${response.status}`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        buffer += decoder.decode(value, { stream: true });
        // SSE 事件以双换行分隔
        const parts = buffer.split('\n\n');
        buffer = parts.pop(); // 最后一段可能不完整，留到下次

        for (const part of parts) {
          const lines = part.split('\n');
          let event = 'message';
          let dataStr = '';
          for (const line of lines) {
            if (line.startsWith('event:')) event = line.slice(6).trim();
            else if (line.startsWith('data:')) dataStr += line.slice(5).trim();
          }
          if (!dataStr) continue;

          let data;
          try { data = JSON.parse(dataStr); } catch { data = {}; }

          switch (event) {
            case 'comment':
              onComment?.(data);
              break;
            case 'corrections':
              onCorrections?.(data);
              break;
            case 'supplements':
              onSupplements?.(data);
              break;
            case 'structured':
              onStructured?.(data.sections, data.keywords);
              break;
            case 'done':
              onDone?.(data);
              break;
            case 'error':
              onError?.(data.message || '生成失败');
              break;
            // thinking / delta 事件前端可忽略（仅用于进度提示）
            default:
              break;
          }
        }
      }
    })
    .catch((err) => {
      if (err.name === 'AbortError') return; // 用户主动中断
      onError?.(err.message || '连接失败');
    });
}

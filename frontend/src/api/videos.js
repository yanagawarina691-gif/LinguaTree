import { api, getToken } from './client.js';

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

// ===== v2 阶段一：加深理解 =====

// 获取加深理解内容（缓存优先，非流式）
export function getDeepen(videoId) {
  return api(`/api/videos/${videoId}/deepen`);
}

// 提交加深理解反馈（有用/疑问）
export function postDeepenFeedback(videoId, payload) {
  return api(`/api/videos/${videoId}/deepen/feedback`, {
    method: 'POST',
    body: JSON.stringify(payload),
  });
}

// 重新生成加深理解内容（清除缓存）
export function regenerateDeepen(videoId) {
  return api(`/api/videos/${videoId}/deepen/regenerate`, { method: 'POST' });
}

// 标记加深理解完成（+10 XP，幂等）
export function completeDeepen(videoId) {
  return api(`/api/videos/${videoId}/deepen/complete`, { method: 'POST' });
}

/**
 * SSE 流式读取加深理解内容
 * 用 fetch + ReadableStream（EventSource 无法携带 Authorization 头）
 * @param {string} videoId
 * @param {Object} handlers - { onComment, onCorrections, onSupplements, onStructured, onDone, onError }
 * @param {AbortSignal} [signal] - 可选中止信号
 */
export async function streamDeepen(videoId, handlers, signal) {
  const token = getToken();
  const res = await fetch(`/api/videos/${videoId}/deepen/stream`, {
    method: 'GET',
    headers: { 'Authorization': token ? `Bearer ${token}` : '' },
    signal,
  });

  if (!res.ok) {
    let msg = `请求失败: ${res.status}`;
    try { const d = await res.json(); msg = d.error || msg; } catch {}
    if (handlers.onError) handlers.onError(msg);
    return;
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder('utf-8');
  let buffer = '';

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });

    // SSE 事件以空行分隔
    let sep;
    while ((sep = buffer.indexOf('\n\n')) !== -1) {
      const raw = buffer.slice(0, sep);
      buffer = buffer.slice(sep + 2);

      let event = 'message';
      let data = '';
      for (const line of raw.split('\n')) {
        if (line.startsWith('event:')) event = line.slice(6).trim();
        else if (line.startsWith('data:')) data += line.slice(5).trim();
      }
      if (!data) continue;

      let payload;
      try { payload = JSON.parse(data); } catch { continue; }

      switch (event) {
        case 'comment': handlers.onComment?.(payload); break;
        case 'corrections': handlers.onCorrections?.(payload.items || []); break;
        case 'supplements': handlers.onSupplements?.(payload.items || []); break;
        case 'structured': handlers.onStructured?.(payload.sections || [], payload.keywords || []); break;
        case 'done': handlers.onDone?.(payload); break;
        case 'error': handlers.onError?.(payload.error || '生成失败'); break;
      }
    }
  }
}

import { api } from './client.js';

// 获取知识卡片列表（?review=1 返回今日推荐复习）
export function getCards(review = false) {
  const query = review ? '?review=1' : '';
  return api(`/api/cards${query}`);
}

// 获取单张知识卡片详情
export function getCardDetail(nodeId) {
  return api(`/api/cards/${nodeId}`);
}

// 获取卡片的双向链接
export function getCardBacklinks(nodeId) {
  return api(`/api/cards/${nodeId}/backlinks`);
}

// 记录复习行为并更新 SRS
// quality: 0-100 评分
export function reviewCard(nodeId, quality) {
  return api(`/api/cards/${nodeId}/review`, {
    method: 'POST',
    body: JSON.stringify({ quality }),
  });
}

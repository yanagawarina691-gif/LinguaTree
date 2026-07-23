import { api } from './client.js';

export function knowledgeCard(oreId) {
  return api(`/api/ores/${oreId}/knowledge-card`);
}

export function updateOreTags(oreId, tags) {
  return api(`/api/ores/${oreId}/tags`, {
    method: 'POST',
    body: JSON.stringify({ tags }),
  });
}

export function reviewOre(oreId) {
  return api(`/api/ores/${oreId}/review`, { method: 'POST' });
}

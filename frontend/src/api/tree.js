import { api } from './client.js';

export function getGalaxy() {
  return api('/api/tree/galaxy');
}

export function getTree() {
  return api('/api/tree');
}

export function getTreeStats() {
  return api('/api/tree/stats');
}

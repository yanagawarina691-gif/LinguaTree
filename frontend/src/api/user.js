import { api } from './client.js';

export function getUserStats() {
  return api('/api/user/stats');
}

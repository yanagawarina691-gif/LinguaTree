import { api } from './client.js';

// 获取完整知识树
export function getTree() {
  return api('/api/tree');
}

// 获取分支详情
export function getBranch(branchId) {
  return api(`/api/tree/branch/${branchId}`);
}

// 获取弱项节点
export function getWeakNodes(count = 3) {
  return api(`/api/tree/weak?count=${count}`);
}

// 获取知识树统计
export function getTreeStats() {
  return api('/api/tree/stats');
}

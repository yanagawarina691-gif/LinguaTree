/**
 * 42 节点矿石星图布局算法
 * 5 矿层横向带 + 子分支聚簇 + 交替扰动
 *
 * viewBox: 0 0 1180 980
 * 每个分支占一条横向带（按 sort_order 自上而下）
 * 带内按子分支分块，块内节点等距排列
 * 节点 y 上下交替扰动 ±30，增加矿石错落感
 */

const W = 1180;
const H = 980;
const PAD_TOP = 70;
const PAD_BOT = 70;
const PAD_X = 70;

const BRANCH_ORDER = ['grammar', 'vocabulary', 'pronunciation', 'listening', 'culture'];

const BRANCH_LABELS = {
  grammar: { cn: '语法晶脉', en: 'GRAMMAR STRATA' },
  vocabulary: { cn: '词汇晶脉', en: 'VOCABULARY STRATA' },
  pronunciation: { cn: '发音晶脉', en: 'PRONUNCIATION STRATA' },
  listening: { cn: '听力晶脉', en: 'LISTENING STRATA' },
  culture: { cn: '文化晶脉', en: 'CULTURE STRATA' },
};

/**
 * 为节点数组计算 x/y 坐标
 * @param {Array} nodes 后端返回的节点数组（已按 sort_order 排序）
 * @returns {Array} 带 x/y 的节点数组
 */
export function layout(nodes) {
  const layerH = (H - PAD_TOP - PAD_BOT) / BRANCH_ORDER.length;
  const result = [];

  BRANCH_ORDER.forEach((branchId, bi) => {
    const layerMid = PAD_TOP + layerH * bi + layerH / 2;
    const branchNodes = nodes.filter(n => n.top_branch === branchId);
    const total = branchNodes.length;
    if (total === 0) return;

    // 按子分支分组，保持原顺序
    const subGroups = {};
    const subOrder = [];
    branchNodes.forEach(n => {
      const key = n.sub_branch_id || n.sub_branch;
      if (!subGroups[key]) {
        subGroups[key] = [];
        subOrder.push(key);
      }
      subGroups[key].push(n);
    });

    let cursor = PAD_X;
    subOrder.forEach(subId => {
      const subNodes = subGroups[subId];
      const subW = (W - 2 * PAD_X) * (subNodes.length / total);
      const gap = subW / (subNodes.length + 1);
      subNodes.forEach((n, li) => {
        const offset = subNodes.length <= 2 ? 0 : ((li % 2 === 0) ? -1 : 1) * 30;
        result.push({ ...n, x: cursor + gap * (li + 1), y: layerMid + offset });
      });
      cursor += subW;
    });
  });

  return result;
}

/**
 * 获取矿区带（zone）的布局信息
 * @returns {Array} [{ branchId, label, en, x, y, width, height }]
 */
export function getZones() {
  const layerH = (H - PAD_TOP - PAD_BOT) / BRANCH_ORDER.length;
  return BRANCH_ORDER.map((branchId, bi) => {
    const y = PAD_TOP + layerH * bi + 10;
    const labels = BRANCH_LABELS[branchId] || { cn: branchId, en: branchId.toUpperCase() };
    return {
      branchId,
      label: labels.cn,
      en: labels.en,
      x: 15,
      y,
      width: W - 30,
      height: layerH - 20,
    };
  });
}

/**
 * 计算关联边的二次贝塞尔路径
 * @param {number} ax 起点x
 * @param {number} ay 起点y
 * @param {number} bx 终点x
 * @param {number} by 终点y
 * @param {number} index 边索引（用于错位）
 * @returns {string} SVG path d
 */
export function linkPath(ax, ay, bx, by, index = 0) {
  const mx = (ax + bx) / 2;
  const my = (ay + by) / 2 - 24 + (index % 3) * 17;
  return `M${ax} ${ay}Q${mx} ${my} ${bx} ${by}`;
}

export const VIEWBOX = { width: W, height: H };
export const INITIAL_PAN = { x: -70, y: -42 };

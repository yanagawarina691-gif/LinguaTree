/**
 * 晶体形状纯函数（从 frosted-crystal-garden.html 移植）
 * 无 DOM 副作用，可被 React 组件直接调用生成 SVG path d 字符串
 */

// ====== 阶段缩放系数（stage 1-4 对应的晶体整体缩放） ======
export const STAGE_SCALE = [0.31, 0.57, 0.8, 1];

// ====== 阶段名称（PRD 五阶段矿石生长模型） ======
export const STAGE_NAMES = ['未发现', '矿苗', '晶芽', '辉石', '璀璨'];

// ====== 矿石槽位配置（8 个晶体槽位，按 unlock 阶段解锁） ======
// unlock=1: 主晶（stage 1 解锁）
// unlock=3: stage 3 解锁
// unlock=4: stage 4 解锁
export const MINERAL_SLOTS = [
  { x: 0,   y: 4,  a: 0,   h: 70, w: 24, unlock: 1 },
  { x: -19, y: 11, a: -12, h: 46, w: 17, unlock: 3 },
  { x: 20,  y: 12, a: 11,  h: 50, w: 16, unlock: 3 },
  { x: 7,   y: 15, a: 4,   h: 38, w: 13, unlock: 3 },
  { x: -34, y: 17, a: -21, h: 31, w: 13, unlock: 4 },
  { x: 35,  y: 18, a: 19,  h: 34, w: 12, unlock: 4 },
  { x: -9,  y: 19, a: -7,  h: 25, w: 11, unlock: 4 },
  { x: 26,  y: 20, a: 14,  h: 22, w: 10, unlock: 4 },
];

/**
 * 生成棱柱形晶体 path d 字符串
 * @param {number} w 宽度
 * @param {number} h 高度
 * @param {number} tilt 倾斜量（默认 0）
 * @returns {string} SVG path d
 */
export function crystalPath(w, h, tilt = 0) {
  return `M${-w / 2 + tilt} 18L${-w * 0.42 + tilt} ${-h * 0.52}L${tilt} ${-h}L${w * 0.42 + tilt} ${-h * 0.52}L${w / 2 + tilt} 18L0 28Z`;
}

/**
 * 按族形返回晶体 path d 字符串
 * @param {string} family 族形: cube|blade|drop|pebble|cluster|prism|gem|geode
 * @param {number} w 宽度
 * @param {number} h 高度
 * @returns {string} SVG path d
 */
export function familyPath(family, w, h) {
  switch (family) {
    case 'cube':
      return `M${-w / 2} ${-h * 0.72}L${-w * 0.16} ${-h}L${w / 2} ${-h * 0.72}L${w / 2} 19L${w * 0.08} 27L${-w / 2} 18Z`;
    case 'blade':
      return `M${-w * 0.46} 21L${-w * 0.35} ${-h * 0.74}L0 ${-h}L${w * 0.34} ${-h * 0.68}L${w * 0.46} 20Z`;
    case 'drop':
      return `M0 ${-h}Q${w * 0.52} ${-h * 0.5} ${w * 0.44} 9Q${w * 0.25} 27 0 28Q${-w * 0.42} 23 ${-w * 0.45} 6Q${-w * 0.43} ${-h * 0.52} 0 ${-h}Z`;
    case 'pebble':
      return `M${-w * 0.48} 19Q${-w * 0.58} ${-h * 0.42} 0 ${-h}Q${w * 0.56} ${-h * 0.46} ${w * 0.48} 18Q0 32 ${-w * 0.48} 19Z`;
    case 'cluster':
    case 'gem':
    case 'geode':
    case 'prism':
    default:
      return crystalPath(w, h, 0);
  }
}

/**
 * 根据 stage 返回应解锁的槽位列表（按高度排序）
 * @param {number} stage 0-4
 * @returns {Array} 过滤+排序后的槽位
 */
export function getUnlockedSlots(stage) {
  return MINERAL_SLOTS
    .filter(slot => slot.unlock <= stage)
    .sort((a, b) => a.h - b.h);
}

/**
 * 计算晶核（core）半径
 * @param {number} stage 1-4
 * @returns {number} 半径
 */
export function getCoreRadius(stage) {
  return 10 + stage * 4;
}

/**
 * 计算 stage 对应的星点数量
 * @param {number} stage 1-4
 * @returns {number} 星点数 (1/1/2/4)
 */
export function getSparkCount(stage) {
  if (stage >= 4) return 4;
  if (stage >= 3) return 2;
  return 1;
}

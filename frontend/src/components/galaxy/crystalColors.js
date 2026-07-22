/**
 * 晶体色板常量（从 frosted-crystal-garden.html 移植 + 新增 orange）
 * 每套色板包含 base / accent / shadow 三个色值
 */

export const PALETTES = {
  rose:   { base: '#FC3F4D', accent: '#FE8BF2', shadow: '#FB4DFE' },
  blue:   { base: '#186AFE', accent: '#059BFC', shadow: '#030095' },
  green:  { base: '#02D34D', accent: '#BDF500', shadow: '#0602D2' },
  gold:   { base: '#FCD90B', accent: '#FFF000', shadow: '#FF7F00' },
  violet: { base: '#7548FD', accent: '#FB4DFE', shadow: '#A204F9' },
  aqua:   { base: '#40F2FB', accent: '#059BFC', shadow: '#186AFE' },
  orange: { base: '#FF9600', accent: '#FFB347', shadow: '#E07B00' },
};

/**
 * 分支 → 色板 key 映射
 * 与后端 galaxyService.js 的 BRANCH_PALETTE 保持一致
 */
export const BRANCH_PALETTE = {
  grammar: 'violet',
  vocabulary: 'orange',
  pronunciation: 'rose',
  listening: 'blue',
  culture: 'gold',
};

/**
 * 获取色板
 * @param {string} paletteKey
 * @returns {{ base: string, accent: string, shadow: string }}
 */
export function getPalette(paletteKey) {
  return PALETTES[paletteKey] || PALETTES.blue;
}

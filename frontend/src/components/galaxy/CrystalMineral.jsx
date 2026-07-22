/**
 * 晶体本体几何组件（renderMineral 的 React 版）
 * 所有 fill/stroke 用 inline style，不依赖 CSS className
 * 保留 className 仅供交互态（dim/lit/glow）使用
 */
import {
  STAGE_SCALE,
  getUnlockedSlots,
  getCoreRadius,
  getSparkCount,
  familyPath,
} from './crystalShapes.js';
import { getPalette } from './crystalColors.js';

function getSpread(family) {
  if (family === 'cluster') return 1.12;
  if (family === 'blade') return 1.06;
  if (family === 'prism') return 0.86;
  return 1;
}

export default function CrystalMineral({ node }) {
  const { stage, family, palette } = node;
  const colors = getPalette(palette);

  // stage 0：只渲染暗灰石头
  if (stage === 0) {
    return (
      <g className="cl-mineral">
        <ellipse
          cx={0} cy={25} rx={23} ry={8}
          style={{ fill: '#C8C8C8', stroke: '#999', strokeWidth: 1 }}
        />
      </g>
    );
  }

  const stageScale = STAGE_SCALE[stage - 1] || 1;
  const spread = getSpread(family);
  const slots = getUnlockedSlots(stage);
  const coreR = getCoreRadius(stage);
  const sparkCount = getSparkCount(stage);

  return (
    <g className="cl-mineral">
      {/* 底座岩石 */}
      <ellipse
        cx={0} cy={25} rx={23 + stage * 5} ry={8 + stage * 0.5}
        style={{ fill: '#C8C8C8', stroke: '#999', strokeWidth: 1 }}
      />

      {/* 解锁的晶体槽位 */}
      {slots.map((slot, i) => {
        const isMain = slot.unlock === 1;
        const h = isMain ? slot.h * stageScale : slot.h * (stage === 3 ? 0.82 : 1);
        const w = slot.w * (isMain ? (0.72 + stage * 0.08) : 1);
        const x = slot.x * spread;

        return (
          <g key={i}>
            {/* 晶体主体 */}
            <path
              className="cl-body cl-rise"
              d={familyPath(family, w, h)}
              transform={`translate(${x} ${slot.y}) rotate(${slot.a})`}
              style={{
                fill: colors.base,
                stroke: colors.shadow,
                strokeWidth: 1.6,
                strokeLinejoin: 'round',
                animationDelay: `${i * 65}ms`,
              }}
            />
            {/* 切面 */}
            <path
              d={`M${x} ${slot.y - h}L${x + w * 0.42} ${slot.y - h * 0.52}L${x + 1} ${slot.y + 22}Z`}
              style={{ fill: colors.shadow, opacity: 0.78 }}
            />
            {/* 高光 */}
            <path
              d={`M${x} ${slot.y - h}L${x - w * 0.38} ${slot.y - h * 0.53}L${x - 2} ${slot.y - 2}Z`}
              style={{ fill: colors.accent, opacity: 0.84 }}
            />
            {/* pebble 族主晶的纹理 */}
            {family === 'pebble' && isMain &&
              Array.from({ length: stage }).map((_, k) => (
                <path
                  key={`vein-${k}`}
                  d={`M${-w * 0.3} ${8 - k * 11}Q0 ${1 - k * 12} ${w * 0.34} ${7 - k * 10}`}
                  style={{ fill: 'none', stroke: colors.accent, strokeWidth: 1.4, opacity: 0.78 }}
                />
              ))}
          </g>
        );
      })}

      {/* 晶核 */}
      <circle
        className="cl-core"
        cx={0} cy={-5} r={coreR}
        style={{ fill: colors.accent, opacity: 0.3 }}
      />

      {/* 内部光束 */}
      <path
        className="cl-inner-beam"
        d={`M-5 15L-3 ${-12 - stage * 7}L2 ${-22 - stage * 8}L6 14L1 24Z`}
        style={{ fill: '#fff', opacity: 0.15 }}
      />

      {/* 星点 */}
      {Array.from({ length: sparkCount }).map((_, i) => {
        const sx = -13 + i * 9;
        const sy = -22 + (i % 2) * 13;
        return (
          <path
            key={`spark-${i}`}
            className="cl-spark"
            d={`M${sx} ${sy - 7}L${sx + 2} ${sy - 2}L${sx + 7} ${sy}L${sx + 2} ${sy + 2}L${sx} ${sy + 7}L${sx - 2} ${sy + 2}L${sx - 7} ${sy}L${sx - 2} ${sy - 2}Z`}
            style={{ fill: '#fff', opacity: 0.4 }}
          />
        );
      })}
    </g>
  );
}

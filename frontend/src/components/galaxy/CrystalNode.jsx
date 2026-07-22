/**
 * 晶体节点组件（单个矿石节点）
 * 管理 stage 0 暗灰 / stage 1-4 晶体 + label + meta + glow 类名
 * 从 frosted-crystal-garden.html 的 rebuildNode 迁移为 JSX
 */
import CrystalMineral from './CrystalMineral.jsx';
import { STAGE_NAMES } from './crystalShapes.js';
import { getPalette } from './crystalColors.js';

export default function CrystalNode({ node, selected, related, dimmed, relatedStrength, onClick }) {
  const { stage, palette, family, name, xp, mastery } = node;
  const colors = getPalette(palette);
  const isActive = stage > 0;

  // 计算节点类名
  let className = 'cl-node';
  if (!isActive) {
    className += ' inactive';
  }
  if (dimmed) {
    className += ' dim';
  } else if (selected || related) {
    className += ' lit';
    // 按关联强度分辉光等级
    const s = selected ? 1 : relatedStrength;
    if (s > 0.82) className += ' high';
    else if (s > 0.6) className += ' mid';
    else className += ' low';
  }

  // stage 0 不显示晶体，只显示暗灰石头
  // stage label 和 meta 在 stage > 0 时显示
  const stageLabel = stage > 0 ? `S${stage} · ${STAGE_NAMES[stage]} · ${Math.round(mastery * 100)}%` : '';

  return (
    <g
      className={className}
      data-id={node.node_id}
      transform={`translate(${node.x} ${node.y})`}
      style={{
        color: colors.base,
        '--gem-accent': colors.accent,
        '--gem-shadow': colors.shadow,
        '--s': selected ? 1 : (relatedStrength || 0),
      }}
      onClick={isActive ? onClick : undefined}
      aria-label={`${name}，第 ${stage} 阶段`}
    >
      <CrystalMineral node={node} />

      {/* 标签 */}
      <text className="cl-label" x={0} y={58}>{name}</text>

      {/* 元数据（仅激活节点显示） */}
      {stage > 0 && (
        <text className="cl-meta" x={0} y={74}>{stageLabel}</text>
      )}
    </g>
  );
}

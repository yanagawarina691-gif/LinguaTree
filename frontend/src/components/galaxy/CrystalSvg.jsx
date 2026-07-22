/**
 * SVG 根组件
 * 组装 defs + 背景 + 矿区带 + 关联边 + 节点层
 * 管理 pan/zoom 的 world transform
 */
import CrystalDefs from './CrystalDefs.jsx';
import CrystalBackground from './CrystalBackground.jsx';
import CrystalZone from './CrystalZone.jsx';
import CrystalLink from './CrystalLink.jsx';
import CrystalNode from './CrystalNode.jsx';
import { VIEWBOX } from './galaxyLayout.js';

export default function CrystalSvg({
  nodes,
  links,
  zones,
  selectedId,
  neighbors,
  pan,
  zoom,
  dragging,
  onNodeClick,
  onBackgroundClick,
  svgRef,
  ...pointerHandlers
}) {
  const { width, height } = VIEWBOX;

  // SVG 级点击：如果没点中节点，就取消选中
  const handleSvgClick = (e) => {
    if (e.target.closest && e.target.closest('.cl-node')) return;
    onBackgroundClick();
  };

  return (
    <svg
      ref={svgRef}
      id="cl-svg"
      className={dragging ? 'dragging' : ''}
      viewBox={`0 0 ${width} ${height}`}
      role="img"
      aria-labelledby="cl-title cl-desc"
      onClick={handleSvgClick}
      {...pointerHandlers}
    >
      <title id="cl-title">可拖拽并可生长的矿石知识网络</title>
      <desc id="cl-desc">每颗知识矿石有四个成长阶段。点击矿石显示关联强度，复习后矿石改变形态并长大。</desc>

      <CrystalDefs />

      {/* 地面背景 */}
      <rect width={width} height={height} fill="url(#cl-ground)" />
      <rect width={width} height={height} fill="url(#cl-grain)" opacity=".3" />

      <CrystalBackground />

      {/* 可拖拽的 world 层 */}
      <g id="cl-world" transform={`translate(${pan.x} ${pan.y}) scale(${zoom})`}>
        {/* 矿区带 */}
        <g id="cl-zones" aria-hidden="true">
          {zones.map(zone => (
            <CrystalZone key={zone.branchId} zone={zone} />
          ))}
        </g>

        {/* 关联边 */}
        <g id="cl-links" aria-hidden="true">
          {links.map((link, i) => {
            const nodeA = nodes.find(n => n.node_id === link.a);
            const nodeB = nodes.find(n => n.node_id === link.b);
            if (!nodeA || !nodeB) return null;
            const isActive = selectedId && (link.a === selectedId || link.b === selectedId);
            return (
              <CrystalLink
                key={`${link.a}-${link.b}`}
                ax={nodeA.x}
                ay={nodeA.y}
                bx={nodeB.x}
                by={nodeB.y}
                strength={link.strength}
                index={i}
                active={isActive}
              />
            );
          })}
        </g>

        {/* 节点 */}
        <g id="cl-nodes">
          {nodes.map(node => {
            const isSelected = node.node_id === selectedId;
            const neighbor = neighbors?.get(node.node_id);
            const isRelated = selectedId && neighbor !== undefined;
            const isDimmed = selectedId && !isSelected && !isRelated;
            const strength = neighbor?.[0]?.strength || 0;
            return (
              <CrystalNode
                key={node.node_id}
                node={node}
                selected={isSelected}
                related={isRelated}
                dimmed={isDimmed}
                relatedStrength={strength}
                onClick={() => onNodeClick(node.node_id)}
              />
            );
          })}
        </g>
      </g>
    </svg>
  );
}

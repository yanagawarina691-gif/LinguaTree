/**
 * 矿区背景带组件
 * 每个分支一条横向带，渲染圆角矩形 + 中英标签
 */

export default function CrystalZone({ zone }) {
  const { branchId, label, en, x, y, width, height } = zone;
  return (
    <g className="cl-zone-group" data-branch={branchId}>
      <rect
        x={x}
        y={y}
        width={width}
        height={height}
        rx={46}
        className="cl-zone"
      />
      <text
        x={x + 18}
        y={y + 27}
        className="cl-zone-label"
      >
        {en} · {label}
      </text>
    </g>
  );
}

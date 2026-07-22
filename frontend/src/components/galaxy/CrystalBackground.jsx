/**
 * 背景装饰层（从 frosted-crystal-garden.html 的 cl-backdrop 迁移为 JSX）
 * 包含：地面渐变矩形、噪点纹理覆盖、玻璃路径、虚线轮廓
 */
import { VIEWBOX } from './galaxyLayout.js';

export default function CrystalBackground() {
  const { width, height } = VIEWBOX;
  return (
    <g className="cl-backdrop" aria-hidden="true">
      {/* 玻璃路径 A（上方） */}
      <path
        d={`M-60 72Q120 18 246 118T520 68T820 92V250Q648 205 512 270T230 230T-60 272Z`}
        fill="url(#cl-glass-a)"
        filter="url(#cl-frost)"
      />
      {/* 玻璃路径 B（下方） */}
      <path
        d={`M-70 382Q104 324 252 416T526 370T840 404V630H-70Z`}
        fill="url(#cl-glass-b)"
        filter="url(#cl-frost)"
      />
      {/* 全幅霜冻覆盖 */}
      <rect x="0" y="0" width={width} height={height} fill="transparent" filter="url(#cl-frost)" opacity=".18" />
      {/* 上方波浪线 */}
      <path
        d="M-20 128Q106 42 230 115T480 90T790 118"
        fill="none"
        stroke="color-mix(in srgb,var(--viz-series-2) 38%,var(--border))"
        strokeWidth="24"
        opacity=".11"
      />
      {/* 下方波浪线 */}
      <path
        d="M-20 458Q95 394 213 455T462 430T790 462"
        fill="none"
        stroke="color-mix(in srgb,var(--viz-series-5) 34%,var(--border))"
        strokeWidth="34"
        opacity=".1"
      />
      {/* 虚线轮廓 */}
      <path
        d="M0 105Q120 25 239 98T480 77T760 104M0 477Q111 406 228 470T475 444T760 478"
        fill="none"
        stroke="var(--border)"
        strokeWidth="1.2"
        strokeDasharray="4 11"
        opacity=".24"
      />
    </g>
  );
}

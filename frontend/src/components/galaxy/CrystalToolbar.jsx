/**
 * 顶部工具栏组件
 * 品牌名 + 状态文案 + 缩放控制
 */

export default function CrystalToolbar({ stats, statusText, zoom, onZoomIn, onZoomOut, onReset }) {
  return (
    <div className="cl-bar">
      <div>
        <div className="cl-brand">矿石星图</div>
        <div className="cl-status">
          {statusText || `${stats?.activatedNodes || 0}/${stats?.totalNodes || 42} 颗矿石 · ${stats?.totalXp || 0} XP`}
        </div>
      </div>
      <div className="viz-row">
        <button type="button" className="btn btn-ghost" onClick={onZoomOut} aria-label="缩小">－</button>
        <span style={{ fontSize: 11, color: 'var(--text-lt)', minWidth: 36, textAlign: 'center' }}>
          {Math.round(zoom * 100)}%
        </span>
        <button type="button" className="btn btn-ghost" onClick={onZoomIn} aria-label="放大">＋</button>
        <button type="button" className="btn btn-ghost" onClick={onReset}>全景</button>
      </div>
    </div>
  );
}

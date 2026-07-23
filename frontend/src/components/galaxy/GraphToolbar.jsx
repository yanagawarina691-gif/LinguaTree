export default function GraphToolbar({ status, onZoomIn, onZoomOut, onReset }) {
  return (
    <div className="graph-toolbar">
      <span className="graph-status">{status}</span>
      <div className="graph-controls">
        <button className="graph-btn" onClick={onZoomIn} aria-label="放大" title="放大">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35M11 8v6M8 11h6" />
          </svg>
        </button>
        <button className="graph-btn" onClick={onZoomOut} aria-label="缩小" title="缩小">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round">
            <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35M8 11h6" />
          </svg>
        </button>
        <button className="graph-btn" onClick={onReset} aria-label="全景" title="全景">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M3 7V5a2 2 0 012-2h2M17 3h2a2 2 0 012 2v2M21 17v2a2 2 0 01-2 2h-2M7 21H5a2 2 0 01-2-2v-2" />
          </svg>
        </button>
      </div>
    </div>
  );
}

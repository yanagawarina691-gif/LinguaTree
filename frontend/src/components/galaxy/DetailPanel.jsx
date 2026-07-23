const stageNames = ['晶核', '初晶', '晶簇', '盛晶'];

export default function DetailPanel({ node, relatedNodes, onReview, onInfo }) {
  if (!node) return null;

  const sorted = [...(relatedNodes || [])].sort((a, b) => (b.strength || 0) - (a.strength || 0));
  const isMax = (node.stage || 1) >= 4;

  return (
    <div className="detail-panel">
      <div className="detail-header">
        <div className="detail-id">
          <span className={`detail-kind ${node.kind === '语法' ? 'grammar' : 'vocab'}`}>
            {node.kind || '知识'}
          </span>
          <span className="detail-name">{node.name}</span>
        </div>
        <div className="detail-meta">
          <div className="detail-score">
            <span>{node.score || 0}</span>
            <span className="detail-score-unit">%</span>
          </div>
          <div className="detail-stage">
            第 {node.stage || 1} 阶段 · {stageNames[(node.stage || 1) - 1]}
          </div>
        </div>
      </div>

      <div className="detail-related">
        关联：{sorted.map(r => `${r.name || '节点 ' + r.nid} ${Math.round((r.strength || 0) * 100)}%`).join(' · ') || '暂无关联'}
      </div>

      <div className="detail-growth">
        {[0, 1, 2, 3].map(i => (
          <span key={i} className={i < (node.stage || 1) ? 'on' : ''} />
        ))}
      </div>

      <div className="detail-growth-labels">
        {stageNames.map((name, i) => (
          <span key={i} className={i < (node.stage || 1) ? 'on' : ''}>{name}</span>
        ))}
      </div>

      <div className="detail-actions">
        <button className="btn btn-primary" onClick={onReview} disabled={isMax}>
          {isMax ? (
            <>
              <svg viewBox="0 0 24 24" fill="currentColor" width="16" height="16">
                <path d="M12 2l3.09 6.26L22 9.27l-5 4.87L18.18 22 12 18.56 5.82 22 7 14.14l-5-4.87 6.91-1.01L12 2z" />
              </svg>
              已达盛晶
            </>
          ) : (
            <>
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.4" strokeLinecap="round" strokeLinejoin="round">
                <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
              </svg>
              复习一次
            </>
          )}
        </button>
        <button className="btn btn-secondary" onClick={onInfo} title="晶体信息">
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <circle cx="12" cy="12" r="10" /><path d="M12 16v-4M12 8h.01" />
          </svg>
        </button>
      </div>
    </div>
  );
}

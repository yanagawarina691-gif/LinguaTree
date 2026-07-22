import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { getTree } from '../api/tree.js';

const BRANCH_HOTSPOTS = {
  listening:     { x: 20, y: 52, icon: '👂' },
  grammar:       { x: 26, y: 22, icon: '✏️' },
  culture:       { x: 50, y: 15, icon: '🌍' },
  vocabulary:    { x: 74, y: 22, icon: '📖' },
  pronunciation:{ x: 80, y: 48, icon: '🗣️' },
};

function hexToRgb(hex) {
  const r = parseInt(hex.slice(1,3), 16);
  const g = parseInt(hex.slice(3,5), 16);
  const b = parseInt(hex.slice(5,7), 16);
  return `${r},${g},${b}`;
}

export default function TreePage() {
  const [tree, setTree] = useState(null);
  const [zoom, setZoom] = useState(1);
  const navigate = useNavigate();

  const loadTree = useCallback(async () => {
    try {
      const data = await getTree();
      setTree(data);
    } catch (err) {
      console.error('Failed to load tree:', err);
    }
  }, []);

  useEffect(() => { loadTree(); }, [loadTree]);

  return (
    <div className="page active tree-page">
      <div className="topbar">
        <div className="topbar-btn" onClick={() => navigate('/')} style={{ fontSize: '20px' }}>‹</div>
        <div className="topbar-logo" style={{ fontSize: '18px' }}>我的知识树</div>
        <div className="topbar-btn" onClick={() => setZoom(1)}>⟳</div>
      </div>

      <div className="tree-stats">
        <div className="tree-stat-pill">🌳 {tree?.stats?.activatedNodes || 0}/{tree?.stats?.totalNodes || 42} 节点</div>
        <div className="tree-stat-pill">⚡ {tree?.stats?.totalXp || 0} XP</div>
      </div>

      <div className="tree-canvas">
        <img src="/assets/knowledge-tree-bg.png" className="tree-bg-img" alt="" draggable="false" style={{ transform: `scale(${zoom})`, transformOrigin: 'center bottom' }} />
        <div className="tree-hotspots" style={{ transform: `scale(${zoom})`, transformOrigin: 'center bottom' }}>
          {tree && Object.entries(tree.branches).map(([id, branch]) => {
            const pos = BRANCH_HOTSPOTS[id];
            if (!pos) return null;
            return (
              <div key={id} className="tree-hotspot" style={{
                left: `${pos.x}%`, top: `${pos.y}%`, width: '72px', height: '72px',
                background: `rgba(${hexToRgb(branch.color)},.15)`,
                border: `3px solid ${branch.color}`,
              }} onClick={() => navigate(`/branch/${id}`)}>
                <div className="hs-glow" style={{ background: `radial-gradient(circle,${branch.color}33,transparent)` }}></div>
                <span style={{ fontSize: 22, filter: 'drop-shadow(0 1px 2px rgba(0,0,0,.3))' }}>{pos.icon}</span>
              </div>
            );
          })}
        </div>
        <div className="tree-legend">
          <img src="/assets/growth-states.png" className="growth-legend-img" alt="growth states" />
        </div>
        <div className="tree-zoom-controls">
          <div className="tree-zoom-btn" onClick={() => setZoom(z => Math.min(2, z * 1.2))}>+</div>
          <div className="tree-zoom-btn" onClick={() => setZoom(z => Math.max(0.5, z * 0.8))}>−</div>
        </div>
      </div>
    </div>
  );
}

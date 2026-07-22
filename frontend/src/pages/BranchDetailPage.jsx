import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate } from 'react-router-dom';
import TopBar from '../components/TopBar.jsx';
import { getBranch } from '../api/tree.js';

const BRANCH_ICONS = { listening:'👂', grammar:'✏️', culture:'🌍', vocabulary:'📖', pronunciation:'🗣️' };
const LVL_NAMES = ['未发现','矿苗','晶芽','辉石','璀璨'];

export default function BranchDetailPage() {
  const { branchId } = useParams();
  const navigate = useNavigate();
  const [branch, setBranch] = useState(null);

  const loadBranch = useCallback(async () => {
    try {
      const data = await getBranch(branchId);
      setBranch(data);
    } catch (err) {
      console.error('Failed to load branch:', err);
    }
  }, [branchId]);

  useEffect(() => { loadBranch(); }, [loadBranch]);

  if (!branch) return <div className="page active" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>加载中...</div>;

  return (
    <div className="page active branch-detail-page">
      <TopBar title={branch.name} />
      <div className="branch-header" style={{ background: `linear-gradient(135deg,${branch.color},${branch.color}cc)` }}>
        <div className="bh-icon">{BRANCH_ICONS[branchId] || '🌿'}</div>
        <h2>{branch.name}</h2>
        <div className="branch-stats">
          <div className="branch-stat"><div className="branch-stat-num">{branch.stats.activatedNodes}/{branch.stats.totalNodes}</div><div className="branch-stat-label">已激活</div></div>
          <div className="branch-stat"><div className="branch-stat-num">{branch.stats.totalXp}</div><div className="branch-stat-label">总 XP</div></div>
        </div>
      </div>
      <div className="node-list">
        {Object.entries(branch.sub_branches).map(([subName, nodes]) => (
          <div key={subName}>
            <div className="section-title" style={{ padding: '0 0 4px' }}>{subName}</div>
            {nodes.map(leaf => {
              const mastery = Math.round((leaf.mastery || 0) * 100);
              const masteryColor =
                leaf.level === 0 ? '#E0E0E0' :
                leaf.level === 1 ? '#C9B99A' :
                leaf.level === 2 ? '#A0D8EF' :
                leaf.level === 3 ? '#B19CD9' : '#FFD700';
              return (
                <div key={leaf.node_id} className="node-card">
                  <div className="node-card-top">
                    <div className="node-name">{leaf.name}</div>
                    <div className={`node-level-badge lvl-${leaf.level}`}>{LVL_NAMES[leaf.level]}</div>
                  </div>
                  <div className="node-mastery-bar"><div className="node-mastery-fill" style={{ width: `${mastery}%`, background: masteryColor }}></div></div>
                  <div className="node-xp-text">{leaf.xp} XP · 掌握度 {mastery}%</div>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

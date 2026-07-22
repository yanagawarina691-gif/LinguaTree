/**
 * 底部详情面板组件
 * 显示选中矿石的名称、阶段、关联、成长条、查看分支按钮
 */
import { useNavigate } from 'react-router-dom';
import { STAGE_NAMES } from './crystalShapes.js';

export default function CrystalDetail({ node, neighbors, nodesById, onToast }) {
  const navigate = useNavigate();
  if (!node) return null;

  const { name, stage, top_branch, top_branch_name, mastery, node_id } = node;
  const isMaxStage = stage >= 4;

  // 关联列表（按强度降序）
  const relatedList = (neighbors || [])
    .map(rel => ({
      name: nodesById?.get(rel.id)?.name || rel.id,
      strength: rel.strength,
    }))
    .sort((a, b) => b.strength - a.strength)
    .slice(0, 5);

  const handleViewBranch = () => {
    if (onToast) onToast(`跳转到「${top_branch_name}」分支`);
    navigate(`/branch/${top_branch}`);
  };

  return (
    <aside className="cl-detail" aria-live="polite">
      <div className="cl-detail-main">
        <div>
          <div className="cl-heading">
            <span className="viz-badge">{top_branch_name}</span>
            <strong>{name}</strong>
          </div>
          <div className="cl-stage-label">
            {stage > 0 ? `第 ${stage} 阶段 · ${STAGE_NAMES[stage]}` : '未激活 · 暗灰状态'}
          </div>
        </div>
        <button
          type="button"
          className={`btn ${isMaxStage ? '' : 'btn-primary'}`}
          onClick={handleViewBranch}
          disabled={isMaxStage}
          style={isMaxStage ? { background: 'var(--bg-gray)', color: 'var(--text-lt)' } : {}}
        >
          {isMaxStage ? '已成熟' : '去学习'}
        </button>
      </div>

      {relatedList.length > 0 && (
        <div className="cl-related">
          关联：{relatedList.map(r => `${r.name} ${Math.round(r.strength * 100)}%`).join(' · ')}
        </div>
      )}

      {/* 成长条（4格，按 stage 点亮） */}
      <div className="cl-growth-track" aria-label="矿石成长进度">
        {[1, 2, 3, 4].map(i => (
          <span key={i} className={i <= stage ? 'on' : ''} />
        ))}
      </div>
    </aside>
  );
}

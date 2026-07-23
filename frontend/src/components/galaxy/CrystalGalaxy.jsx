/**
 * 矿石星图主容器 v2
 * 从后端 API 加载动态矿石数据，不再使用静态 crystalData
 */
import { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGalaxy } from '../../api/tree.js';
import CrystalGraph from './CrystalGraph';
import GraphToolbar from './GraphToolbar';
import DetailPanel from './DetailPanel';
import Toast from './Toast';
import { useGraphTransform } from './hooks/useGraphTransform';
import { useGraphFocus } from './hooks/useGraphFocus';

const CRYSTAL_TYPES = ['hexagonal', 'tetra', 'octa', 'rhombo', 'dodeca'];

function hexToDark(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `#${Math.floor(r * 0.5).toString(16).padStart(2, '0')}${Math.floor(g * 0.5).toString(16).padStart(2, '0')}${Math.floor(b * 0.5).toString(16).padStart(2, '0')}`;
}

function hexToShine(hex) {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + 80);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + 80);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + 80);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const stageNames = ['晶核', '初晶', '晶簇', '盛晶'];

/**
 * 简单圆形布局
 */
function layoutNodes(nodes) {
  if (!nodes || nodes.length === 0) return [];
  const cx = 500, cy = 350, radius = Math.min(280, nodes.length * 18);
  return nodes.map((node, i) => {
    const angle = (2 * Math.PI * i) / nodes.length - Math.PI / 2;
    return {
      ...node,
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    };
  });
}

/**
 * 将后端 galaxy 数据转换为 CrystalGraph 需要的格式
 */
function transformGalaxyData(galaxyData) {
  if (!galaxyData || !galaxyData.nodes) return { crystals: [], links: [] };

  const crystals = layoutNodes(galaxyData.nodes).map((node, idx) => {
    const tags = node.tags || [];
    const kind = tags.length > 0 ? tags[0] : '知识';
    const stage = Math.max(1, (node.stage || node.level || 0) + 1);
    const type = CRYSTAL_TYPES[idx % CRYSTAL_TYPES.length];
    const color = node.color || '#58CC02';

    return {
      id: node.id,
      name: node.name,
      kind,
      score: Math.round((node.mastery || 0) * 100),
      x: node.x,
      y: node.y,
      type,
      color,
      dark: hexToDark(color),
      shine: hexToShine(color),
      stage: Math.min(4, stage),
      hardness: 5 + Math.random() * 4,
      weight: 2 + Math.random() * 3,
      rarity: `R-${Math.floor(Math.random() * 6) + 1}`,
      tags,
      description: node.description,
    };
  });

  const links = (galaxyData.links || []).map((l, idx) => ({
    id: idx,
    a: l.a,
    b: l.b,
    s: l.strength,
    strength: l.strength,
  }));

  return { crystals, links };
}

export default function CrystalGalaxy() {
  const navigate = useNavigate();
  const [galaxyData, setGalaxyData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const [toastShow, setToastShow] = useState(false);
  const toastTimer = useRef(null);

  const { crystals, links } = useMemo(() => transformGalaxyData(galaxyData), [galaxyData]);

  const {
    pan, zoom, status, setStatus,
    renderTransform, zoomTo, reset: resetTransform,
    handlePointerDown, handlePointerMove, handlePointerUp, handleWheel
  } = useGraphTransform();

  const {
    selectedId, selectedNode,
    focus, overview,
    getNodeState, getLinkState, getRelatedNodes
  } = useGraphFocus(crystals, links);

  useEffect(() => {
    getGalaxy()
      .then(d => { setGalaxyData(d); setLoading(false); })
      .catch(e => { setError(e.message); setLoading(false); });
  }, []);

  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    setToastShow(true);
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastShow(false), 2000);
  }, []);

  const onNodeClick = useCallback((nid) => {
    focus(nid);
    const node = crystals.find(c => c.id === nid);
    const rel = getRelatedNodes();
    setStatus(`「${node?.name || ''}」点亮 ${rel.length} 条知识链接`);
  }, [focus, getRelatedNodes, crystals, setStatus]);

  const onNodeDoubleClick = useCallback((nid) => {
    navigate(`/ore/${nid}`);
  }, [navigate]);

  const onReset = useCallback(() => {
    resetTransform();
    overview();
    setStatus('点击矿石，点亮知识矿脉');
  }, [resetTransform, overview, setStatus]);

  const onZoomIn = useCallback(() => zoomTo(zoom * 1.16), [zoomTo, zoom]);
  const onZoomOut = useCallback(() => zoomTo(zoom / 1.16), [zoomTo, zoom]);

  const onReview = useCallback(() => {
    if (selectedId === null) return;
    navigate(`/ore/${selectedId}`);
  }, [selectedId, navigate]);

  const onInfo = useCallback(() => {
    const node = crystals.find(c => c.id === selectedId);
    if (node) {
      showToast(`${node.kind} · 阶段${node.stage}/4 · 掌握度 ${node.score}%`);
    }
  }, [selectedId, crystals, showToast]);

  const selectedData = crystals.find(c => c.id === selectedId);
  const relatedNodes = getRelatedNodes();

  if (loading) {
    return (
      <div className="crystal-galaxy-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        <div className="galaxy-empty">
          <div className="galaxy-empty-icon">💎</div>
          <div className="galaxy-empty-title">正在唤醒矿石星图</div>
          <div className="galaxy-empty-desc">正在从知识矿脉中加载你的矿石</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="crystal-galaxy-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        <div className="galaxy-empty">
          <div className="galaxy-empty-icon" style={{ background: 'linear-gradient(135deg, #FEF2F2, #FFF5F5)' }}>⚠️</div>
          <div className="galaxy-empty-title" style={{ color: '#DC2626' }}>加载失败</div>
          <div className="galaxy-empty-desc">{error}</div>
        </div>
      </div>
    );
  }

  if (!crystals || crystals.length === 0) {
    return (
      <div className="crystal-galaxy-app" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', flex: 1 }}>
        <div className="galaxy-empty">
          <div className="galaxy-empty-icon">💎</div>
          <div className="galaxy-empty-title">还没有矿石</div>
          <div className="galaxy-empty-desc">去首页粘贴一个英语教学视频链接，AI 解析后就会在这里长出矿石</div>
        </div>
      </div>
    );
  }

  const stats = galaxyData?.stats || {};
  const allTags = [...new Set(crystals.flatMap(c => c.tags || []))].slice(0, 3);

  return (
    <div className="crystal-galaxy-app">
      <div className="galaxy-stats">
        <div className="stat-item">
          <span className="stat-num">{stats.totalNodes || crystals.length}</span>
          <span className="stat-label">矿石</span>
        </div>
        <div className="stat-item">
          <span className="stat-num">{stats.activatedNodes || 0}</span>
          <span className="stat-label">已激活</span>
        </div>
        <div className="stat-item">
          <span className="stat-num">{stats.linksCount || 0}</span>
          <span className="stat-label">矿脉</span>
        </div>
      </div>

      <div className="crystal-galaxy-wrapper">
        <GraphToolbar status={status} onZoomIn={onZoomIn} onZoomOut={onZoomOut} onReset={onReset} />
        <CrystalGraph
          nodes={crystals}
          links={links}
          allTags={allTags}
          getNodeState={getNodeState}
          getLinkState={getLinkState}
          renderTransform={renderTransform}
          onNodeClick={onNodeClick}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={handlePointerUp}
          onWheel={handleWheel}
        />
      </div>
      <DetailPanel node={selectedData} relatedNodes={relatedNodes} onReview={onReview} onInfo={onInfo} />
      <Toast message={toastMsg} show={toastShow} />
    </div>
  );
}

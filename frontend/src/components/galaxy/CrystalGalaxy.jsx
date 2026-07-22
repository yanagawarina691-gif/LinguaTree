/**
 * 矿石星图主容器
 * 整合数据加载、布局计算、选中高亮、pan/zoom 交互
 */
import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import { getGalaxy } from '../../api/tree.js';
import CrystalSvg from './CrystalSvg.jsx';
import CrystalToolbar from './CrystalToolbar.jsx';
import CrystalDetail from './CrystalDetail.jsx';
import { layout, getZones } from './galaxyLayout.js';
import { usePanZoom } from './usePanZoom.js';

export default function CrystalGalaxy() {
  const [data, setData] = useState(null);
  const [selectedId, setSelectedId] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [toastMsg, setToastMsg] = useState('');
  const toastTimer = useRef(null);

  const { pan, zoom, dragging, svgRef, movedRef, handlers, zoomIn, zoomOut, reset } = usePanZoom();

  useEffect(() => {
    getGalaxy()
      .then(d => {
        setData(d);
        setLoading(false);
      })
      .catch(e => {
        console.error('Failed to load galaxy:', e);
        setError(e.message);
        setLoading(false);
      });
  }, []);

  // 计算布局（加 x/y 坐标）
  const nodesWithLayout = useMemo(() => (data ? layout(data.nodes) : []), [data]);
  const zones = useMemo(() => getZones(), []);

  // 构建 neighbors Map 和 nodesById Map
  const { neighbors, nodesById } = useMemo(() => {
    const nMap = new Map();
    const byId = new Map();
    if (data) {
      nodesWithLayout.forEach(n => byId.set(n.node_id, n));
      data.links.forEach(l => {
        if (!nMap.has(l.a)) nMap.set(l.a, []);
        if (!nMap.has(l.b)) nMap.set(l.b, []);
        nMap.get(l.a).push({ id: l.b, strength: l.strength });
        nMap.get(l.b).push({ id: l.a, strength: l.strength });
      });
    }
    return { neighbors: nMap, nodesById: byId };
  }, [data, nodesWithLayout]);

  const selectedNode = selectedId ? nodesById.get(selectedId) : null;

  // 点击节点（非拖拽时）
  const handleNodeClick = useCallback((id) => {
    if (movedRef.current) return;
    setSelectedId(prev => (prev === id ? null : id));
  }, [movedRef]);

  // 点击空白取消选中
  const handleBackgroundClick = useCallback(() => {
    if (movedRef.current) return;
    setSelectedId(null);
  }, [movedRef]);

  // 全景重置
  const handleReset = useCallback(() => {
    setSelectedId(null);
    reset();
  }, [reset]);

  // Toast
  const showToast = useCallback((msg) => {
    setToastMsg(msg);
    if (toastTimer.current) clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToastMsg(''), 1900);
  }, []);

  // 状态文案
  let statusText = '点击矿石，点亮它的知识矿脉';
  if (loading) statusText = '正在加载矿石星图...';
  else if (error) statusText = `加载失败: ${error}`;
  else if (selectedNode) {
    const relCount = neighbors.get(selectedNode.node_id)?.length || 0;
    statusText = `「${selectedNode.name}」点亮 ${relCount} 条知识矿脉`;
  }

  if (loading) {
    return (
      <div className="crystal-galaxy" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center', color: 'var(--text-lt)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>💎</div>
          <div>正在唤醒矿石星图...</div>
        </div>
      </div>
    );
  }

  if (error) {
    return (
      <div className="crystal-galaxy" style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%' }}>
        <div style={{ textAlign: 'center', color: 'var(--red)' }}>
          <div style={{ fontSize: 32, marginBottom: 8 }}>⚠️</div>
          <div>矿石星图加载失败</div>
          <div style={{ fontSize: 12, marginTop: 4 }}>{error}</div>
        </div>
      </div>
    );
  }

  return (
    <div className="crystal-galaxy" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <CrystalToolbar
        stats={data?.stats}
        statusText={statusText}
        zoom={zoom}
        onZoomIn={zoomIn}
        onZoomOut={zoomOut}
        onReset={handleReset}
      />

      <div className="cl-stage" style={{ position: 'relative', flex: 1, overflow: 'hidden' }}>
        <CrystalSvg
          nodes={nodesWithLayout}
          links={data?.links || []}
          zones={zones}
          selectedId={selectedId}
          neighbors={neighbors}
          pan={pan}
          zoom={zoom}
          dragging={dragging}
          svgRef={svgRef}
          onNodeClick={handleNodeClick}
          onBackgroundClick={handleBackgroundClick}
          {...handlers}
        />

        {/* 图例 */}
        <div className="cl-key">
          <span><i className="cl-dot grammar" />语法晶脉</span>
          <span><i className="cl-dot words" />词汇晶脉</span>
          <span><i className="cl-dot growth" />复习会生长</span>
        </div>
        <div className="cl-pan">拖拽探索</div>

        {/* 详情面板 */}
        {selectedNode && (
          <CrystalDetail
            node={selectedNode}
            neighbors={neighbors.get(selectedNode.node_id) || []}
            nodesById={nodesById}
            onToast={showToast}
          />
        )}

        {/* Toast */}
        {toastMsg && (
          <div className="cl-toast show">{toastMsg}</div>
        )}
      </div>
    </div>
  );
}

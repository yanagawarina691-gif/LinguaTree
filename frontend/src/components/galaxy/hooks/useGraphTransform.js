import { useState, useCallback, useRef } from 'react';

export function useGraphTransform(initialPan = { x: -80, y: -40 }, initialZoom = 1) {
  const [pan, setPan] = useState(initialPan);
  const [zoom, setZoom] = useState(initialZoom);
  const [status, setStatus] = useState('点击晶体，点亮语言知识矿脉');
  const dragRef = useRef(null);

  const renderTransform = useCallback(() => {
    return `translate(${pan.x} ${pan.y}) scale(${zoom})`;
  }, [pan, zoom]);

  const zoomTo = useCallback((next, cx = 500, cy = 350) => {
    next = Math.max(0.6, Math.min(1.8, next));
    const ratio = next / zoom;
    setPan(p => ({ x: cx - (cx - p.x) * ratio, y: cy - (cy - p.y) * ratio }));
    setZoom(next);
    setStatus(`视图缩放 ${Math.round(next * 100)}%`);
  }, [zoom]);

  const reset = useCallback(() => {
    setPan(initialPan);
    setZoom(initialZoom);
    setStatus('点击晶体，点亮语言知识矿脉');
  }, [initialPan]);

  // Pointer handlers
  const handlePointerDown = useCallback((e, svgEl) => {
    svgEl.setPointerCapture(e.pointerId);
    dragRef.current = { sx: e.clientX, sy: e.clientY, px: pan.x, py: pan.y, moved: 0 };
  }, [pan]);

  const handlePointerMove = useCallback((e, svgEl) => {
    const d = dragRef.current;
    if (!d) return;
    const dist = Math.hypot(e.clientX - d.sx, e.clientY - d.sy);
    d.moved = Math.max(d.moved, dist);
    const rect = svgEl.getBoundingClientRect();
    const dx = (e.clientX - d.sx) * (1000 / rect.width);
    const dy = (e.clientY - d.sy) * (700 / rect.height);
    setPan({
      x: Math.max(-600, Math.min(200, d.px + dx)),
      y: Math.max(-300, Math.min(150, d.py + dy))
    });
  }, []);

  const handlePointerUp = useCallback((e, svgEl) => {
    const d = dragRef.current;
    svgEl?.classList?.remove('dragging');
    if (d && d.moved < 8) {
      // Use current event coordinates, not stored ones
      const el = document.elementFromPoint(e.clientX, e.clientY);
      const node = el?.closest('.graph-node');
      dragRef.current = null;
      if (node) return parseInt(node.getAttribute('data-id'));
    }
    dragRef.current = null;
    return null;
  }, []);

  const handleWheel = useCallback((e, svgEl) => {
    e.preventDefault();
    const rect = svgEl.getBoundingClientRect();
    const cx = (e.clientX - rect.left) * (1000 / rect.width);
    const cy = (e.clientY - rect.top) * (700 / rect.height);
    const curZoom = zoom; // capture current zoom
    zoomTo(curZoom * (e.deltaY > 0 ? 0.9 : 1.1), cx, cy);
  }, [zoom, zoomTo]);

  return {
    pan, zoom, status, setStatus,
    renderTransform, zoomTo, reset,
    handlePointerDown, handlePointerMove, handlePointerUp, handleWheel
  };
}

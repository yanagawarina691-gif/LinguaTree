/**
 * Pan/Zoom 自定义 hook
 * 从 frosted-crystal-garden.html 的 pan/zoom 逻辑迁移为 React hook
 * 管理 SVG world 层的拖拽平移和滚轮缩放
 *
 * 纯 React state 驱动，不直接操作 DOM
 * wheel 事件用 addEventListener + { passive: false } 处理
 */
import { useState, useRef, useCallback, useEffect } from 'react';
import { VIEWBOX, INITIAL_PAN } from './galaxyLayout.js';

const { width: VB_W, height: VB_H } = VIEWBOX;
const MIN_ZOOM = 0.5;
const MAX_ZOOM = 1.8;
const PAN_X_MIN = -700;
const PAN_X_MAX = 200;
const PAN_Y_MIN = -500;
const PAN_Y_MAX = 200;
const DRAG_THRESHOLD = 8;

export function usePanZoom() {
  const [pan, setPan] = useState(INITIAL_PAN);
  const [zoom, setZoom] = useState(1);
  const [dragging, setDragging] = useState(false);
  const startRef = useRef(null);
  const movedRef = useRef(false);
  const svgRef = useRef(null);

  // 用 ref 保存最新的 pan/zoom，供 wheel 事件读取
  const stateRef = useRef({ pan, zoom });
  stateRef.current = { pan, zoom };

  const clampPan = useCallback((p) => ({
    x: Math.max(PAN_X_MIN, Math.min(PAN_X_MAX, p.x)),
    y: Math.max(PAN_Y_MIN, Math.min(PAN_Y_MAX, p.y)),
  }), []);

  const zoomTo = useCallback((next, cx = VB_W / 2, cy = VB_H / 2) => {
    const { pan: prevPan, zoom: prevZoom } = stateRef.current;
    const clamped = Math.max(MIN_ZOOM, Math.min(MAX_ZOOM, next));
    const ratio = clamped / prevZoom;
    const newPan = clampPan({
      x: cx - (cx - prevPan.x) * ratio,
      y: cy - (cy - prevPan.y) * ratio,
    });
    setPan(newPan);
    setZoom(clamped);
  }, [clampPan]);

  const onPointerDown = useCallback((e) => {
    if (svgRef.current) {
      svgRef.current.setPointerCapture(e.pointerId);
    }
    const { pan: curPan } = stateRef.current;
    startRef.current = {
      x: e.clientX,
      y: e.clientY,
      panX: curPan.x,
      panY: curPan.y,
    };
    movedRef.current = false;
    setDragging(true);
  }, []);

  const onPointerMove = useCallback((e) => {
    if (!startRef.current || !svgRef.current) return;
    const r = svgRef.current.getBoundingClientRect();
    const dxClient = e.clientX - startRef.current.x;
    const dyClient = e.clientY - startRef.current.y;
    const dx = dxClient * (VB_W / r.width);
    const dy = dyClient * (VB_H / r.height);

    if (Math.hypot(dxClient, dyClient) > DRAG_THRESHOLD) {
      movedRef.current = true;
    }

    const newPan = clampPan({
      x: startRef.current.panX + dx,
      y: startRef.current.panY + dy,
    });
    setPan(newPan);
  }, [clampPan]);

  const onPointerUp = useCallback(() => {
    startRef.current = null;
    setDragging(false);
  }, []);

  const onPointerCancel = useCallback(() => {
    startRef.current = null;
    setDragging(false);
  }, []);

  // wheel 事件用 addEventListener（React onWheel 是 passive，无法 preventDefault）
  useEffect(() => {
    const svg = svgRef.current;
    if (!svg) return;

    const handleWheel = (e) => {
      e.preventDefault();
      const r = svg.getBoundingClientRect();
      const cx = (e.clientX - r.left) * (VB_W / r.width);
      const cy = (e.clientY - r.top) * (VB_H / r.height);
      const { zoom: curZoom } = stateRef.current;
      zoomTo(curZoom * (e.deltaY > 0 ? 0.9 : 1.1), cx, cy);
    };

    svg.addEventListener('wheel', handleWheel, { passive: false });
    return () => svg.removeEventListener('wheel', handleWheel);
  }, [zoomTo]);

  const reset = useCallback(() => {
    setPan(INITIAL_PAN);
    setZoom(1);
  }, []);

  return {
    pan,
    zoom,
    dragging,
    svgRef,
    movedRef,
    handlers: {
      onPointerDown,
      onPointerMove,
      onPointerUp,
      onPointerCancel,
    },
    zoomTo,
    zoomIn: () => zoomTo(stateRef.current.zoom * 1.16),
    zoomOut: () => zoomTo(stateRef.current.zoom / 1.16),
    reset,
  };
}

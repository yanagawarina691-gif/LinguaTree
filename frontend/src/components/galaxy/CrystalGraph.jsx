import { useRef, useEffect, useCallback } from 'react';
import { el } from './utils/svgHelpers';
import { builders } from './utils/crystalBuilders';

const stageScales = [0.40, 0.65, 0.85, 1.00];

const slots = [
  { x: 0,  y: 4,  w: 24, h: 70, unlock: 1, angle: 0 },
  { x: -19, y: 11, w: 17, h: 46, unlock: 3, angle: -12 },
  { x: 20,  y: 12, w: 16, h: 50, unlock: 3, angle: 11 },
  { x: 7,   y: 15, w: 13, h: 38, unlock: 3, angle: 4 },
  { x: -34, y: 17, w: 13, h: 31, unlock: 4, angle: -21 },
  { x: 35,  y: 18, w: 12, h: 34, unlock: 4, angle: 19 },
  { x: -9,  y: 19, w: 11, h: 25, unlock: 4, angle: -7 },
  { x: 26,  y: 20, w: 10, h: 22, unlock: 4, angle: 14 },
];

function renderNode(node) {
  const g = el('g', { class: 'graph-node', 'data-id': node.id });
  g.setAttribute('transform', `translate(${node.x} ${node.y})`);

  g.appendChild(el('circle', { class: 'node-halo', cx: 0, cy: -2, r: 38 + (node.stage || 1) * 4 }));

  g.appendChild(el('ellipse', {
    cx: 0, cy: 22, rx: 24 + (node.stage || 1) * 5, ry: 7 + (node.stage || 1) * 1,
    fill: node.dark, opacity: 0.24, filter: 'url(#blur-ground)'
  }));

  const cg = el('g', { class: 'crystal-group' });
  const ss = stageScales[(node.stage || 1) - 1] || 1;
  const unlocked = slots.filter(s => s.unlock <= (node.stage || 1)).sort((a, b) => a.h - b.h);
  const builder = builders[node.type] || builders.hexagonal;

  unlocked.forEach((slot, idx) => {
    const isMain = slot.unlock === 1;
    const h = isMain ? slot.h * ss : slot.h * ((node.stage || 1) === 3 ? 0.82 : 1);
    const w = slot.w * (isMain ? (0.72 + (node.stage || 1) * 0.08) : 1);
    const slotScale = Math.min(w / 24, h / 70);

    const sg = el('g', { transform: `translate(${slot.x} ${slot.y + 8 * slotScale}) rotate(${slot.angle})`, opacity: 0.24 });
    sg.appendChild(builder(node.dark, node.dark, node.dark, slotScale));
    cg.appendChild(sg);

    const bg = el('g', { transform: `translate(${slot.x} ${slot.y}) rotate(${slot.angle})` });
    const shape = builder(node.color, node.dark, node.shine, slotScale);
    shape.style.animationDelay = (idx * 60) + 'ms';
    bg.appendChild(shape);
    cg.appendChild(bg);
  });

  g.appendChild(cg);

  const label = el('text', { class: 'graph-label', x: 0, y: 52 });
  label.textContent = node.name;
  g.appendChild(label);

  return g;
}

function renderLink(link, nodes) {
  const a = nodes.find(n => n.id === link.a);
  const b = nodes.find(n => n.id === link.b);
  if (!a || !b) return el('g');
  const mx = (a.x + b.x) / 2;
  const my = (a.y + b.y) / 2 - 24 + ((link.a * link.b) % 3) * 17;
  const p = el('path', {
    class: 'graph-link',
    d: `M${a.x} ${a.y} Q${mx} ${my} ${b.x} ${b.y}`,
    'data-id': link.a + '-' + link.b
  });
  p.style.setProperty('--s', link.strength || link.s);
  return p;
}

export default function CrystalGraph({ nodes, links, allTags, getNodeState, getLinkState, renderTransform, onNodeClick, onWheel, onPointerDown, onPointerMove, onPointerUp }) {
  const svgRef = useRef(null);
  const linksRef = useRef(null);
  const nodesRef = useRef(null);

  useEffect(() => {
    const nl = nodesRef.current;
    const ll = linksRef.current;
    if (!nl || !ll) return;
    nl.innerHTML = '';
    ll.innerHTML = '';
    (links || []).forEach(l => ll.appendChild(renderLink(l, nodes)));
    (nodes || []).forEach(n => nl.appendChild(renderNode(n)));
  }, [nodes, links]);

  useEffect(() => {
    const nl = nodesRef.current;
    const ll = linksRef.current;
    if (!nl || !ll) return;

    nl.querySelectorAll('.graph-node').forEach(nodeEl => {
      const id = parseInt(nodeEl.getAttribute('data-id'));
      const state = getNodeState(id);
      nodeEl.classList.remove('dim', 'lit', 'low', 'mid', 'high', 'selected');
      if (state.dim) nodeEl.classList.add('dim');
      if (state.lit) nodeEl.classList.add('lit');
      if (state.level && state.level !== 'selected') nodeEl.classList.add(state.level);
      if (state.level === 'selected') nodeEl.classList.add('selected');
      if (state.lit) nodeEl.style.setProperty('--s', state.strength);
    });

    if (ll) {
      ll.querySelectorAll('.graph-link').forEach(linkEl => {
        const lid = linkEl.getAttribute('data-id');
        const state = getLinkState(lid);
        linkEl.classList.toggle('active', state.active);
        linkEl.classList.toggle('dim', !state.active);
      });
    }
  }, [getNodeState, getLinkState, nodes, links]);

  useEffect(() => {
    const world = document.getElementById('graph-world');
    if (world) world.setAttribute('transform', renderTransform());
  }, [renderTransform]);

  const onPointerDownHandler = useCallback((e) => onPointerDown(e, svgRef.current), [onPointerDown]);
  const onPointerMoveHandler = useCallback((e) => onPointerMove(e, svgRef.current), [onPointerMove]);
  const onPointerUpHandler = useCallback((e) => {
    const nid = onPointerUp(e, svgRef.current);
    if (nid !== null && nid !== undefined) onNodeClick(nid);
    // Also try direct target detection as fallback
    if (nid === null || nid === undefined) {
      const nodeEl = e.target?.closest?.('.graph-node');
      if (nodeEl) {
        const id = parseInt(nodeEl.getAttribute('data-id'));
        if (!isNaN(id)) onNodeClick(id);
      }
    }
  }, [onPointerUp, onNodeClick]);
  const onWheelHandler = useCallback((e) => onWheel(e, svgRef.current), [onWheel]);

  const onSvgClick = useCallback((e) => {
    const nodeEl = e.target?.closest?.('.graph-node');
    if (nodeEl) {
      const id = parseInt(nodeEl.getAttribute('data-id'));
      if (!isNaN(id)) onNodeClick(id);
    }
  }, [onNodeClick]);

  return (
    <div className="graph-container">
      <div className="graph-legend">
        {allTags && allTags.length > 0
          ? allTags.map((tag, i) => (
              <span key={tag}><i className="legend-dot connected" style={{ background: ['#58CC02','#3B82F6','#A855F7'][i % 3] }} />{tag}</span>
            ))
          : <span><i className="legend-dot connected" />关联矿脉</span>
        }
        <span><i className="legend-dot selected" />已选中</span>
      </div>
      <div className="graph-hint">
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
          <path d="M5 9l-3 3 3 3M9 5l3-3 3 3M15 19l-3 3-3-3M19 9l3 3-3 3M2 12h20M12 2v20" />
        </svg>
        拖拽探索
      </div>
      <svg ref={svgRef} id="graph-svg" viewBox="0 0 1000 700" role="img" aria-label="矿石知识图谱"
        onPointerDown={onPointerDownHandler} onPointerMove={onPointerMoveHandler}
        onPointerUp={onPointerUpHandler} onPointerCancel={onPointerUpHandler}
        onClick={onSvgClick} onWheel={onWheelHandler}>
        <defs>
          <pattern id="bg-dots" x="0" y="0" width="40" height="40" patternUnits="userSpaceOnUse">
            <circle cx="20" cy="20" r="0.8" fill="#D1D5DB" opacity="0.35" />
            <circle cx="0" cy="0" r="0.5" fill="#D1D5DB" opacity="0.2" />
          </pattern>
          <filter id="glow-green-low" x="-140%" y="-140%" width="380%" height="380%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="4" result="blur" />
            <feColorMatrix in="blur" type="matrix" values="0.345 0 0 0 0  0 0.8 0 0 0  0 0.008 0 0 0  0 0 0 0.28 0" result="colored" />
            <feMerge><feMergeNode in="colored" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-green-mid" x="-180%" y="-180%" width="460%" height="460%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="8" result="blur1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="2" result="blur2" />
            <feColorMatrix in="blur1" type="matrix" values="0.345 0 0 0 0  0 0.8 0 0 0  0 0.008 0 0 0  0 0 0 0.34 0" result="colored1" />
            <feColorMatrix in="blur2" type="matrix" values="0.345 0 0 0 0  0 0.8 0 0 0  0 0.008 0 0 0  0 0 0 0.28 0" result="colored2" />
            <feMerge><feMergeNode in="colored1" /><feMergeNode in="colored2" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="glow-green-high" x="-220%" y="-220%" width="540%" height="540%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="14" result="blur1" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="5" result="blur2" />
            <feGaussianBlur in="SourceGraphic" stdDeviation="1.5" result="blur3" />
            <feColorMatrix in="blur1" type="matrix" values="0.345 0 0 0 0  0 0.8 0 0 0  0 0.008 0 0 0  0 0 0 0.38 0" result="colored1" />
            <feColorMatrix in="blur2" type="matrix" values="0.345 0 0 0 0  0 0.8 0 0 0  0 0.008 0 0 0  0 0 0 0.32 0" result="colored2" />
            <feColorMatrix in="blur3" type="matrix" values="0.345 0 0 0 0  0 0.8 0 0 0  0 0.008 0 0 0  0 0 0 0.22 0" result="colored3" />
            <feMerge><feMergeNode in="colored1" /><feMergeNode in="colored2" /><feMergeNode in="colored3" /><feMergeNode in="SourceGraphic" /></feMerge>
          </filter>
          <filter id="blur-ground" x="-50%" y="-50%" width="200%" height="200%">
            <feGaussianBlur in="SourceGraphic" stdDeviation="2.5" />
          </filter>
        </defs>
        <rect width="1000" height="700" fill="#F8F9FB" />
        <rect width="1000" height="700" fill="url(#bg-dots)" />
        <g id="graph-world">
          <g ref={linksRef} id="graph-links" />
          <g ref={nodesRef} id="graph-nodes" />
        </g>
      </svg>
    </div>
  );
}

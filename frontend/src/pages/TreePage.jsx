/**
 * TreePage v4 — 纯白蛇形矿石路径
 * 白背景 + 彩色晶体自上而下蛇形排列 + 始终串联的线
 */
import { useState, useEffect, useRef, useLayoutEffect, useMemo } from 'react';
import { useNavigate } from 'react-router-dom';
import { getGalaxy } from '../api/tree.js';
import { useAuth } from '../context/AuthContext.jsx';
import '../styles/tree-page-v3.css';

const GEM_COLORS = [
  '#58CC02', // emerald
  '#A855F7', // amethyst
  '#3B82F6', // sapphire
  '#EF4444', // ruby
  '#F59E0B', // topaz
  '#EC4899', // pink tourmaline
  '#06B6D4', // aquamarine
  '#84CC16', // peridot
  '#F97316', // citrine
  '#6366F1', // tanzanite
  '#14B8A6', // teal
  '#D946EF', // fuchsia
];

function hexToDark(hex) {
  const r = parseInt(hex.slice(1, 3), 16);
  const g = parseInt(hex.slice(3, 5), 16);
  const b = parseInt(hex.slice(5, 7), 16);
  return `#${Math.floor(r * 0.35).toString(16).padStart(2, '0')}${Math.floor(g * 0.35).toString(16).padStart(2, '0')}${Math.floor(b * 0.35).toString(16).padStart(2, '0')}`;
}

function hexToShine(hex) {
  const r = Math.min(255, parseInt(hex.slice(1, 3), 16) + 120);
  const g = Math.min(255, parseInt(hex.slice(3, 5), 16) + 120);
  const b = Math.min(255, parseInt(hex.slice(5, 7), 16) + 120);
  return `#${r.toString(16).padStart(2, '0')}${g.toString(16).padStart(2, '0')}${b.toString(16).padStart(2, '0')}`;
}

const CRYSTAL_SHAPES = ['hexagonal', 'tetra', 'octa', 'rhombo', 'dodeca', 'gem'];

// ── SVG 晶体渲染 ──
function CrystalSvg({ shape, color, scale, glow }) {
  const dark = hexToDark(color);
  const shine = hexToShine(color);
  const s = scale || 2.2;

  const renders = {
    hexagonal: (
      <g>
        <polygon points={`${-28*s},${-48*s} ${28*s},${-48*s} ${44*s},${-8*s} ${28*s},${32*s} ${-28*s},${32*s} ${-44*s},${-8*s}`} fill={color} stroke={dark} strokeWidth={1.8*s} strokeLinejoin="round" strokeOpacity={0.55} />
        <polygon points={`${-28*s},${-48*s} ${-44*s},${-8*s} ${-28*s},${32*s} ${-28*s},${-48*s}`} fill={dark} opacity={0.35} />
        <polygon points={`${28*s},${-48*s} ${28*s},${32*s} ${44*s},${-8*s}`} fill={shine} opacity={0.55} />
        <polygon points={`${-28*s},${-48*s} ${0},${-75*s} ${28*s},${-48*s}`} fill={shine} opacity={0.5} stroke={dark} strokeWidth={1*s} strokeLinejoin="round" strokeOpacity={0.35} />
        <polygon points={`${-28*s},${-48*s} ${-44*s},${-8*s} ${0},${-75*s} ${-28*s},${-48*s}`} fill={dark} opacity={0.25} />
        <polygon points={`${28*s},${-48*s} ${0},${-75*s} ${44*s},${-8*s}`} fill={shine} opacity={0.45} />
        <circle cx={0} cy={-10*s} r={6*s} fill="white" opacity={0.2} />
      </g>
    ),
    tetra: (
      <g>
        <polygon points={`${0},${-70*s} ${-40*s},${28*s} ${40*s},${28*s}`} fill={color} stroke={dark} strokeWidth={1.6*s} strokeLinejoin="round" strokeOpacity={0.5} />
        <polygon points={`${0},${-70*s} ${-40*s},${28*s} ${0},${16*s}`} fill={dark} opacity={0.32} />
        <polygon points={`${0},${-70*s} ${40*s},${28*s} ${0},${16*s}`} fill={shine} opacity={0.5} />
        <line x1={0} y1={-68*s} x2={0} y2={18*s} stroke={shine} strokeWidth={3*s} opacity={0.5} strokeLinecap="round" />
        <circle cx={0} cy={-22*s} r={6*s} fill="white" opacity={0.22} />
      </g>
    ),
    octa: (
      <g>
        <polygon points={`${0},${72*s} ${-46*s},${0} ${0},${0} ${46*s},${0}`} fill={color} stroke={dark} strokeWidth={1.5*s} strokeLinejoin="round" strokeOpacity={0.45} opacity={0.88} />
        <polygon points={`${0},${72*s} ${-46*s},${0} ${0},${0}`} fill={dark} opacity={0.3} />
        <polygon points={`${0},${72*s} ${46*s},${0} ${0},${0}`} fill={shine} opacity={0.2} />
        <polygon points={`${0},${-72*s} ${-46*s},${0} ${0},${0} ${46*s},${0}`} fill={color} stroke={dark} strokeWidth={1.5*s} strokeLinejoin="round" strokeOpacity={0.45} />
        <polygon points={`${0},${-72*s} ${-46*s},${0} ${0},${0}`} fill={dark} opacity={0.3} />
        <polygon points={`${0},${-72*s} ${46*s},${0} ${0},${0}`} fill={shine} opacity={0.55} />
        <circle cx={0} cy={-20*s} r={5*s} fill="white" opacity={0.2} />
      </g>
    ),
    rhombo: (
      <g>
        <polygon points={`${-24*s},${-54*s} ${32*s},${-60*s} ${44*s},${20*s} ${-12*s},${32*s}`} fill={color} stroke={dark} strokeWidth={1.7*s} strokeLinejoin="round" strokeOpacity={0.5} />
        <polygon points={`${-24*s},${-54*s} ${-12*s},${32*s} ${44*s},${20*s} ${32*s},${-60*s}`} fill={dark} opacity={0.24} />
        <polygon points={`${-24*s},${-54*s} ${-12*s},${32*s} ${-12*s},${-6*s}`} fill={shine} opacity={0.5} />
        <polygon points={`${-24*s},${-54*s} ${-8*s},${-76*s} ${32*s},${-60*s}`} fill={shine} opacity={0.45} stroke={dark} strokeWidth={1*s} strokeLinejoin="round" strokeOpacity={0.3} />
        <polygon points={`${-24*s},${-54*s} ${-12*s},${32*s} ${-8*s},${-76*s} ${-24*s},${-54*s}`} fill={dark} opacity={0.2} />
        <circle cx={4*s} cy={-22*s} r={5*s} fill="white" opacity={0.18} />
      </g>
    ),
    dodeca: (() => {
      const outerR = 46*s, innerR = 23*s, cy = -8*s, pts = [];
      for (let i = 0; i < 12; i++) {
        const a = (Math.PI * 2 * i) / 12 - Math.PI / 2;
        pts.push(`${Math.cos(a) * (i % 2 === 0 ? outerR : innerR)},${Math.sin(a) * (i % 2 === 0 ? outerR : innerR) + cy}`);
      }
      const facets = [];
      for (let i = 0; i < 6; i++) {
        const a1 = (Math.PI * 2 * i * 2) / 12 - Math.PI / 2;
        const a2 = (Math.PI * 2 * (i * 2 + 1)) / 12 - Math.PI / 2;
        const a3 = (Math.PI * 2 * (i * 2 + 2)) / 12 - Math.PI / 2;
        const p = `${Math.cos(a1)*outerR},${Math.sin(a1)*outerR+cy} ${Math.cos(a2)*innerR},${Math.sin(a2)*innerR+cy} ${Math.cos(a3)*outerR},${Math.sin(a3)*outerR+cy}`;
        facets.push(<polygon key={`f${i}`} points={p} fill={i < 3 ? dark : shine} opacity={i < 3 ? 0.22 : 0.32} />);
      }
      return (
        <g>
          <polygon points={pts.join(' ')} fill={color} stroke={dark} strokeWidth={1.8*s} strokeLinejoin="round" strokeOpacity={0.5} />
          {facets}
          <circle cx={0} cy={cy} r={5*s} fill="white" opacity={0.18} />
        </g>
      );
    })(),
    gem: (
      <g>
        <polygon points={`${0},${-80*s} ${-22*s},${-48*s} ${-32*s},${0} ${-18*s},${36*s} ${18*s},${36*s} ${32*s},${0} ${22*s},${-48*s}`} fill={color} stroke={dark} strokeWidth={1.6*s} strokeLinejoin="round" strokeOpacity={0.5} />
        <polygon points={`${0},${-80*s} ${-22*s},${-48*s} ${0},${-40*s}`} fill={shine} opacity={0.55} />
        <polygon points={`${0},${-80*s} ${22*s},${-48*s} ${0},${-40*s}`} fill={dark} opacity={0.22} />
        <polygon points={`${-32*s},${0} ${-22*s},${-48*s} ${0},${-40*s} ${-18*s},${36*s}`} fill={dark} opacity={0.28} />
        <polygon points={`${32*s},${0} ${22*s},${-48*s} ${0},${-40*s} ${18*s},${36*s}`} fill={shine} opacity={0.42} />
        <circle cx={0} cy={-30*s} r={5*s} fill="white" opacity={0.24} />
      </g>
    ),
  };

  return (
    <svg viewBox="-80 -100 160 180" className={`crystal-svg ${glow ? 'glow' : ''}`}>
      <defs>
        <filter id={`crystal-glow-${color.slice(1)}`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur in="SourceGraphic" stdDeviation="6" result="blur" />
          <feColorMatrix in="blur" type="matrix" values={`${parseInt(color.slice(1,3),16)/255} 0 0 0 0  ${parseInt(color.slice(3,5),16)/255} 0 0 0 0  ${parseInt(color.slice(5,7),16)/255} 0 0 0 0  0 0 0 0.35 0`} result="colored" />
          <feMerge><feMergeNode in="colored" /><feMergeNode in="SourceGraphic" /></feMerge>
        </filter>
      </defs>
      <g filter={glow ? `url(#crystal-glow-${color.slice(1)})` : 'none'}>
        {renders[shape] || renders.hexagonal}
      </g>
    </svg>
  );
}

// ── 蛇形布局计算 ──
const ROW_HEIGHT = 128;
const START_Y = 56;
const COLS = 5;
const MARGIN_X = 34;

const MAX_SLOTS = 12;

function computeSnakeLayout(count, width) {
  if (!width || count === 0) return { positions: [], totalHeight: START_Y + ROW_HEIGHT + 80 };
  const usable = Math.max(0, width - MARGIN_X * 2);
  const step = usable / (COLS - 1);
  const colX = Array.from({ length: COLS }, (_, i) => MARGIN_X + i * step);
  const positions = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / COLS);
    const isReversed = row % 2 === 1;
    const colIndex = i % COLS;
    const x = isReversed ? colX[COLS - 1 - colIndex] : colX[colIndex];
    const y = START_Y + row * ROW_HEIGHT;
    positions.push({ x, y, row, colIndex, isReversed });
  }
  const rows = Math.ceil(count / COLS);
  return { positions, totalHeight: START_Y + rows * ROW_HEIGHT + 120 };
}

// 将路径拆为多段，每段根据两端是否解锁决定颜色
function buildSnakeSegments(positions, oreNodes) {
  if (positions.length === 0) return [];
  const segments = [];
  for (let i = 1; i < positions.length; i++) {
    const prev = positions[i - 1];
    const curr = positions[i];
    const prevOre = oreNodes[i - 1];
    const currOre = oreNodes[i];
    const unlocked = !!(prevOre && currOre);
    let d = `M ${prev.x} ${prev.y}`;
    if (prev.row !== curr.row) {
      // 蛇形换行：弧线在行外侧大 U 形
      // 偶数行正向（行末在最右）→ 弧线外凸到右侧
      // 奇数行反向（行末在最左）→ 弧线外凸到左侧
      const r = Math.min(70, Math.abs(curr.y - prev.y) * 0.7);
      const dir = prev.row % 2 === 0 ? 1 : -1;
      d += ` C ${prev.x + dir * r} ${prev.y}, ${curr.x + dir * r} ${curr.y}, ${curr.x} ${curr.y}`;
    } else {
      d += ` L ${curr.x} ${curr.y}`;
    }
    segments.push({ d, unlocked });
  }
  return segments;
}

export default function TreePage() {
  const navigate = useNavigate();
  const { user } = useAuth();
  const [galaxy, setGalaxy] = useState({ nodes: [], links: [], stats: {} });
  const [loading, setLoading] = useState(true);
  const [selectedId, setSelectedId] = useState(null);
  const fieldRef = useRef(null);
  const [fieldWidth, setFieldWidth] = useState(390);

  useEffect(() => {
    getGalaxy()
      .then(d => {
        const ores = d.ores || d.nodes || [];
        const nodes = ores.map(o => ({
          id: o.id,
          name: o.name,
          level: o.level ?? o.stage ?? 0,
          mastery: typeof o.mastery === 'number' ? o.mastery : (o.xp_total ? Math.min(1, o.xp_total / 200) : 0),
          color: o.color,
        }));
        setGalaxy({
          nodes,
          links: d.links || [],
          stats: d.stats || { totalNodes: nodes.length, totalXp: ores.reduce((s, o) => s + (o.xp_total || 0), 0), linksCount: 0 },
        });
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  useLayoutEffect(() => {
    if (!fieldRef.current) return;
    const el = fieldRef.current;
    const update = () => setFieldWidth(el.offsetWidth);
    update();

    let ro;
    if (typeof ResizeObserver !== 'undefined') {
      ro = new ResizeObserver(update);
      ro.observe(el);
    } else {
      window.addEventListener('resize', update);
    }
    return () => {
      if (ro) ro.disconnect();
      else window.removeEventListener('resize', update);
    };
  }, [loading]);

  const selectedOre = galaxy.nodes.find(n => n.id === selectedId);
  const oreNodes = galaxy.nodes;
  const slotCount = Math.max(MAX_SLOTS, oreNodes.length);

  const { positions, totalHeight } = useMemo(
    () => computeSnakeLayout(slotCount, fieldWidth),
    [slotCount, fieldWidth]
  );
  const pathSegments = useMemo(
    () => buildSnakeSegments(positions, oreNodes),
    [positions, oreNodes]
  );

  // 平移状态
  const [pan, setPan] = useState({ x: 0, y: 0 });
  const dragRef = useRef(null);
  const startRef = useRef({ x: 0, y: 0, panX: 0, panY: 0 });

  const onPanStart = (e) => {
    if (e.target.closest('.snake-ore:not(.empty)')) return; // 矿石上不触发拖动
    dragRef.current = true;
    const pt = e.touches ? e.touches[0] : e;
    startRef.current = { x: pt.clientX, y: pt.clientY, panX: pan.x, panY: pan.y };
  };
  const onPanMove = (e) => {
    if (!dragRef.current) return;
    const pt = e.touches ? e.touches[0] : e;
    setPan({
      x: startRef.current.panX + (pt.clientX - startRef.current.x),
      y: startRef.current.panY + (pt.clientY - startRef.current.y),
    });
  };
  const onPanEnd = () => { dragRef.current = false; };

  const handleOreClick = (id) => {
    setSelectedId(id === selectedId ? null : id);
  };

  const handleOpenCard = () => {
    if (selectedId) navigate(`/ore/${selectedId}`);
  };

  const today = new Date();
  const dateStr = `${today.getMonth() + 1}月${today.getDate()}日`;
  const stats = galaxy.stats;

  return (
    <div className="page active tree-page-v3 snake-white">
      {/* 蛇形矿石场 */}
      <div className="snake-arena">
        {loading ? (
          <div className="snake-empty">
            <div className="snake-empty-icon">💎</div>
            <div className="snake-empty-title">正在唤醒晶体...</div>
          </div>
        ) : (
          <div
            ref={fieldRef}
            className="snake-field"
            style={{ height: totalHeight, transform: `translate(${pan.x}px, ${pan.y}px)`, touchAction: 'none' }}
            onMouseDown={onPanStart}
            onMouseMove={onPanMove}
            onMouseUp={onPanEnd}
            onMouseLeave={onPanEnd}
            onTouchStart={onPanStart}
            onTouchMove={onPanMove}
            onTouchEnd={onPanEnd}
          >
            {/* 串联路径（按解锁状态分段） */}
            <svg className="snake-path" viewBox={`-90 0 ${fieldWidth + 180} ${totalHeight + 30}`} preserveAspectRatio="xMidYMid meet">
              {pathSegments.map((seg, i) => (
                <g key={i}>
                  <path
                    d={seg.d}
                    className={`snake-line ${seg.unlocked ? 'seg-unlocked' : 'seg-locked'}`}
                    fill="none" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round"
                  />
                  {seg.unlocked && (
                    <path
                      d={seg.d}
                      className="snake-flow"
                      fill="none" strokeWidth="5" strokeLinecap="round" strokeLinejoin="round"
                    />
                  )}
                </g>
              ))}
            </svg>

            {/* 晶体 + 空位 */}
            {positions.map((pos, i) => {
              const ore = oreNodes[i];
              const color = ore ? GEM_COLORS[ore.id % GEM_COLORS.length] : null;
              const isSel = ore && selectedId === ore.id;
              return (
                <div
                  key={i}
                  className={`snake-ore ${ore ? '' : 'empty'} ${isSel ? 'selected' : ''}`}
                  style={{ left: pos.x, top: pos.y, '--ore-color': color || '#D1D5DB', animationDelay: `${i * 0.05}s` }}
                  onClick={() => ore && handleOreClick(ore.id)}
                >
                  <div className="snake-ore-ring" />
                  {ore ? (
                    <img
                      className="crystal-svg"
                      src={`/assets/crystals/crystal-${Math.abs(ore.id) % 4}-${(ore.level ?? 0) >= 2 ? 1 : 0}.png`}
                      alt={ore.name}
                    />
                  ) : (
                    <div className="snake-ore-empty">
                      <div className="snake-ore-empty-outer" />
                      <div className="snake-ore-empty-inner" />
                    </div>
                  )}
                  <div className="snake-ore-label">
                    {ore ? (
                      <>
                        <div className="snake-ore-name">{ore.name}</div>
                        <div className="snake-ore-level">Lv.{ore.level || 0}</div>
                      </>
                    ) : null}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {!loading && (
          <div className="snake-hint">探索更多视频，积累水晶</div>
        )}
      </div>

      {/* 选中卡片 */}
      {selectedOre && (
        <div className="snake-card" onClick={handleOpenCard}>
          <div className="snake-card-name">{selectedOre.name}</div>
          <div className="snake-card-meta">
            阶段 {selectedOre.level || 0}/4 · 掌握度 {Math.round((selectedOre.mastery || 0) * 100)}%
          </div>
          <div className="snake-card-btns">
            <button className="snake-card-btn snake-card-btn-primary" onClick={(e) => { e.stopPropagation(); handleOpenCard(); }}>📖 复习</button>
            <button className="snake-card-btn snake-card-btn-ghost" onClick={(e) => { e.stopPropagation(); setSelectedId(null); }}>关闭</button>
          </div>
        </div>
      )}
    </div>
  );
}

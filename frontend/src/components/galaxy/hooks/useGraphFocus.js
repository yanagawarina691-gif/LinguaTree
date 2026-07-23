import { useState, useMemo } from 'react';

export function useGraphFocus(nodes, links) {
  const [selectedId, setSelectedId] = useState(null);

  const neighbors = useMemo(() => {
    const map = new Map((nodes || []).map(c => [c.id, []]));
    (links || []).forEach(l => {
      const aList = map.get(l.a);
      const bList = map.get(l.b);
      if (aList) aList.push({ nid: l.b, strength: l.strength || l.s, link: l, name: (nodes || []).find(n => n.id === l.b)?.name });
      if (bList) bList.push({ nid: l.a, strength: l.strength || l.s, link: l, name: (nodes || []).find(n => n.id === l.a)?.name });
    });
    return map;
  }, [nodes, links]);

  const getNodeState = (nodeId) => {
    if (selectedId === null) return { dim: false, lit: false, level: null, strength: 0 };
    const rel = neighbors.get(selectedId);
    if (nodeId === selectedId) return { dim: false, lit: true, level: 'selected', strength: 1 };

    const found = (rel || []).find(r => r.nid === nodeId);
    if (!found) return { dim: true, lit: false, level: null, strength: 0 };

    const s = found.strength;
    let level;
    if (s > 0.82) level = 'high';
    else if (s > 0.6) level = 'mid';
    else level = 'low';
    return { dim: false, lit: true, level, strength: s };
  };

  const getLinkState = (linkId) => {
    if (selectedId === null) return { active: false };
    const parts = linkId.split('-');
    const a = parseInt(parts[0]), b = parseInt(parts[1]);
    return { active: a === selectedId || b === selectedId };
  };

  const getRelatedNodes = () => {
    if (selectedId === null) return [];
    return [...(neighbors.get(selectedId) || [])].sort((a, b) => (b.strength || 0) - (a.strength || 0));
  };

  const focus = (id) => setSelectedId(id);
  const overview = () => setSelectedId(null);
  const selectedNode = (nodes || []).find(n => n.id === selectedId) || null;

  return { selectedId, selectedNode, focus, overview, getNodeState, getLinkState, getRelatedNodes };
}

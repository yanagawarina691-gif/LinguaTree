import { el } from './svgHelpers';

export function buildHexagonal(c, dark, shine, scale) {
  const s = scale || 1, g = el('g');
  g.append(
    el('polygon', { points: `${-28*s},${-48*s} ${28*s},${-48*s} ${44*s},${-8*s} ${28*s},${32*s} ${-28*s},${32*s} ${-44*s},${-8*s}`, fill: c, stroke: dark, 'stroke-width': 1.8 * s, 'stroke-linejoin': 'round', 'stroke-opacity': 0.6 }),
    el('polygon', { points: `${-28*s},${-48*s} ${-44*s},${-8*s} ${-28*s},${32*s} ${-28*s},${-48*s}`, fill: dark, opacity: 0.38 }),
    el('polygon', { points: `${28*s},${-48*s} ${28*s},${32*s} ${44*s},${-8*s}`, fill: shine, opacity: 0.6 }),
    el('polygon', { points: `${-28*s},${-48*s} ${0},${-70*s} ${28*s},${-48*s}`, fill: shine, opacity: 0.5, stroke: dark, 'stroke-width': 1 * s, 'stroke-linejoin': 'round', 'stroke-opacity': 0.5 }),
    el('polygon', { points: `${-28*s},${-48*s} ${-44*s},${-8*s} ${0},${-70*s} ${-28*s},${-48*s}`, fill: dark, opacity: 0.28 }),
    el('polygon', { points: `${28*s},${-48*s} ${0},${-70*s} ${44*s},${-8*s}`, fill: shine, opacity: 0.42 }),
    el('circle', { cx: 0, cy: -6 * s, r: 4 * s, fill: 'white', opacity: 0.18 })
  );
  return g;
}

export function buildTetra(c, dark, shine, scale) {
  const s = scale || 1, g = el('g');
  g.append(
    el('polygon', { points: `${0},${-70*s} ${-38*s},${24*s} ${38*s},${24*s}`, fill: c, stroke: dark, 'stroke-width': 1.6 * s, 'stroke-linejoin': 'round', 'stroke-opacity': 0.55 }),
    el('polygon', { points: `${0},${-70*s} ${-38*s},${24*s} ${0},${14*s}`, fill: dark, opacity: 0.34 }),
    el('polygon', { points: `${0},${-70*s} ${38*s},${24*s} ${0},${14*s}`, fill: shine, opacity: 0.55 }),
    el('line', { x1: 0, y1: -68 * s, x2: 0, y2: 16 * s, stroke: shine, 'stroke-width': 3 * s, opacity: 0.55, 'stroke-linecap': 'round' }),
    el('circle', { cx: 0, cy: -20 * s, r: 3.5 * s, fill: 'white', opacity: 0.22 })
  );
  return g;
}

export function buildOcta(c, dark, shine, scale) {
  const s = scale || 1, g = el('g');
  g.append(
    el('polygon', { points: `${0},${66*s} ${-42*s},${0} ${0},${0} ${42*s},${0}`, fill: c, stroke: dark, 'stroke-width': 1.5 * s, 'stroke-linejoin': 'round', 'stroke-opacity': 0.5, opacity: 0.88 }),
    el('polygon', { points: `${0},${66*s} ${-42*s},${0} ${0},${0}`, fill: dark, opacity: 0.34 }),
    el('polygon', { points: `${0},${66*s} ${42*s},${0} ${0},${0}`, fill: shine, opacity: 0.22 }),
    el('line', { x1: -42 * s, y1: 0, x2: 42 * s, y2: 0, stroke: dark, 'stroke-width': 1 * s, opacity: 0.25 }),
    el('polygon', { points: `${0},${-66*s} ${-42*s},${0} ${0},${0} ${42*s},${0}`, fill: c, stroke: dark, 'stroke-width': 1.5 * s, 'stroke-linejoin': 'round', 'stroke-opacity': 0.5 }),
    el('polygon', { points: `${0},${-66*s} ${-42*s},${0} ${0},${0}`, fill: dark, opacity: 0.32 }),
    el('polygon', { points: `${0},${-66*s} ${42*s},${0} ${0},${0}`, fill: shine, opacity: 0.58 }),
    el('circle', { cx: 0, cy: -18 * s, r: 3 * s, fill: 'white', opacity: 0.2 })
  );
  return g;
}

export function buildRhombo(c, dark, shine, scale) {
  const s = scale || 1, g = el('g');
  g.append(
    el('polygon', { points: `${-22*s},${-52*s} ${30*s},${-58*s} ${42*s},${18*s} ${-10*s},${28*s}`, fill: c, stroke: dark, 'stroke-width': 1.7 * s, 'stroke-linejoin': 'round', 'stroke-opacity': 0.55 }),
    el('polygon', { points: `${-22*s},${-52*s} ${-10*s},${28*s} ${42*s},${18*s} ${30*s},${-58*s}`, fill: dark, opacity: 0.26 }),
    el('polygon', { points: `${-22*s},${-52*s} ${-10*s},${28*s} ${-10*s},${-4*s}`, fill: shine, opacity: 0.52 }),
    el('polygon', { points: `${-22*s},${-52*s} ${-8*s},${-72*s} ${30*s},${-58*s}`, fill: shine, opacity: 0.45, stroke: dark, 'stroke-width': 1 * s, 'stroke-linejoin': 'round', 'stroke-opacity': 0.4 }),
    el('polygon', { points: `${-22*s},${-52*s} ${-10*s},${28*s} ${-8*s},${-72*s} ${-22*s},${-52*s}`, fill: dark, opacity: 0.22 }),
    el('circle', { cx: 4 * s, cy: -20 * s, r: 3.5 * s, fill: 'white', opacity: 0.16 })
  );
  return g;
}

export function buildDodeca(c, dark, shine, scale) {
  const s = scale || 1, g = el('g');
  const outerR = 44 * s, innerR = 22 * s, cy = -6 * s;
  const pts = [];
  for (let i = 0; i < 12; i++) {
    const a = (Math.PI * 2 * i) / 12 - Math.PI / 2;
    pts.push(`${Math.cos(a) * (i % 2 === 0 ? outerR : innerR)},${Math.sin(a) * (i % 2 === 0 ? outerR : innerR) + cy}`);
  }
  g.append(el('polygon', { points: pts.join(' '), fill: c, stroke: dark, 'stroke-width': 1.8 * s, 'stroke-linejoin': 'round', 'stroke-opacity': 0.55 }));
  const facets = el('g');
  for (let i = 0; i < 6; i++) {
    const a1 = (Math.PI * 2 * i * 2) / 12 - Math.PI / 2;
    const a2 = (Math.PI * 2 * (i * 2 + 1)) / 12 - Math.PI / 2;
    const a3 = (Math.PI * 2 * (i * 2 + 2)) / 12 - Math.PI / 2;
    const p = `${Math.cos(a1)*outerR},${Math.sin(a1)*outerR+cy} ${Math.cos(a2)*innerR},${Math.sin(a2)*innerR+cy} ${Math.cos(a3)*outerR},${Math.sin(a3)*outerR+cy}`;
    facets.appendChild(el('polygon', { points: p, fill: i < 3 ? dark : shine, opacity: i < 3 ? 0.24 : 0.35 }));
  }
  for (let i = 0; i < 6; i++) {
    const a = (Math.PI * 2 * i * 2) / 12 - Math.PI / 2;
    facets.appendChild(el('line', { x1: 0, y1: cy, x2: Math.cos(a) * outerR, y2: Math.sin(a) * outerR + cy, stroke: 'white', 'stroke-width': 0.6 * s, opacity: 0.15 }));
  }
  g.append(facets, el('circle', { cx: 0, cy, r: 4 * s, fill: 'white', opacity: 0.2 }));
  return g;
}

export const builders = { hexagonal: buildHexagonal, tetra: buildTetra, octa: buildOcta, rhombo: buildRhombo, dodeca: buildDodeca };

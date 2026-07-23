const SVG_NS = 'http://www.w3.org/2000/svg';

export function el(tag, attrs = {}) {
  const n = document.createElementNS(SVG_NS, tag);
  Object.entries(attrs).forEach(([k, v]) => n.setAttribute(k, typeof v === 'number' ? String(v) : v));
  return n;
}

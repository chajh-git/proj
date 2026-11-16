// web/editor/components/radar-chart.js  (113번)
// 레이더 차트: 파츠 하나의 성격(무게·비용·내구도·전력·성능)을 같은 종류 파츠들과 견주어 한눈에 보여 준다. (명세 18-3)
//   const r = createRadarChart({ axes:[{ key, label, max }], size:220 });   r.el
//   r.set([{ name, color, values:{ key: 값 } }, …])    값은 axis.max 로 나눈 비율(0~1)로 그려진다(넘으면 1에서 멈춤)

import { el, ensureStyle } from '../../ui/dom.js';
import { COMPONENT_CSS } from './slider-number.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

export function createRadarChart({ axes = [], size = 220, rings = 4 } = {}) {
  ensureStyle(COMPONENT_CSS, 'ed-comp-style');
  const c = size / 2;
  const R = size / 2 - 34;
  const svg = sv('svg', { viewBox: `0 0 ${size} ${size}`, width: size, height: size, role: 'img', 'aria-label': axes.map((a) => a.label).join('·') + ' 레이더 차트' });
  const ang = (i) => -Math.PI / 2 + (i / axes.length) * Math.PI * 2;
  const pt = (i, t) => [c + Math.cos(ang(i)) * R * t, c + Math.sin(ang(i)) * R * t];
  for (let k = 1; k <= rings; k++) svg.append(sv('polygon', { points: axes.map((_, i) => pt(i, k / rings).join(',')).join(' '), fill: 'none', stroke: 'var(--cm-panelEdge)' }));
  axes.forEach((a, i) => {
    const [x, y] = pt(i, 1);
    svg.append(sv('line', { x1: c, y1: c, x2: x, y2: y, stroke: 'var(--cm-panelEdge)' }));
    const [lx, ly] = pt(i, 1.2);
    const t = sv('text', { x: lx, y: ly + 3, fill: 'var(--cm-textDim)', 'font-size': 10, 'text-anchor': 'middle' });
    t.textContent = a.label;
    svg.append(t);
  });
  const layer = sv('g', {});
  svg.append(layer);
  const node = el('div', { class: 'ed-radar' }, svg);
  return {
    el: node,
    set(series) {
      while (layer.firstChild) layer.removeChild(layer.firstChild);
      for (const s of series) {
        const pts = axes.map((a, i) => pt(i, Math.min(1, Math.max(0, (s.values[a.key] ?? 0) / (a.max || 1)))));
        layer.append(sv('polygon', { points: pts.map((p) => p.join(',')).join(' '), fill: s.color || 'var(--cm-primary)', 'fill-opacity': 0.25, stroke: s.color || 'var(--cm-primary)', 'stroke-width': 2 }));
        for (const [x, y] of pts) layer.append(sv('circle', { cx: x, cy: y, r: 3, fill: s.color || 'var(--cm-primary)' }));
      }
    },
  };
}

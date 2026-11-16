// web/editor/components/curve-editor.js  (112번)
// 곡선 편집기: 핸들을 끌어 모양을 바꾸고, 아래 숫자 표로도 같은 값을 고친다. (예: 투지→공격 배율, 무게별 가속)
//   createCurveEditor({ points:[[x,y],…], xMin, xMax, yMin, yMax, xLabel, yLabel, lockX, onChange }) → { el, get, set }
//   · 점 개수는 고정. lockX=true 면 x 는 그대로 두고 y 만 끌 수 있다.
//   · x 는 이웃 점을 넘지 못한다. 키보드: 핸들에 포커스 후 방향키.
//   · 미리보기 함수 preview(x) 가 있으면 점 사이를 선형 보간한 값을 돌려준다(get().evaluate).

import { el, ensureStyle } from '../../ui/dom.js';
import { COMPONENT_CSS, clampTo } from './slider-number.js';

const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}) => { const n = document.createElementNS(NS, tag); for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v); return n; };

export function evaluateCurve(points, x) {
  if (!points.length) return 0;
  if (x <= points[0][0]) return points[0][1];
  for (let i = 1; i < points.length; i++) {
    if (x <= points[i][0]) { const [x0, y0] = points[i - 1]; const [x1, y1] = points[i]; return x1 === x0 ? y1 : y0 + ((y1 - y0) * (x - x0)) / (x1 - x0); }
  }
  return points[points.length - 1][1];
}

export function createCurveEditor({ points, xMin = 0, xMax = 100, yMin = 0, yMax = 1, xLabel = 'x', yLabel = 'y', lockX = false, width = 320, height = 180, onChange = () => {} } = {}) {
  ensureStyle(COMPONENT_CSS, 'ed-comp-style');
  let pts = points.map(([x, y]) => [x, y]);
  const pad = 26;
  const W = width; const H = height;
  const px = (x) => pad + ((x - xMin) / (xMax - xMin || 1)) * (W - pad - 10);
  const py = (y) => H - pad - ((y - yMin) / (yMax - yMin || 1)) * (H - pad - 10);
  const ix = (sx) => xMin + ((sx - pad) / (W - pad - 10)) * (xMax - xMin);
  const iy = (sy) => yMin + ((H - pad - sy) / (H - pad - 10)) * (yMax - yMin);

  const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: 'img', 'aria-label': `${xLabel}에 따른 ${yLabel} 곡선` });
  svg.append(sv('line', { x1: pad, y1: H - pad, x2: W - 10, y2: H - pad, stroke: 'var(--cm-panelEdge)' }), sv('line', { x1: pad, y1: 10, x2: pad, y2: H - pad, stroke: 'var(--cm-panelEdge)' }));
  const lab = (x, y, t, anchor = 'middle') => { const n = sv('text', { x, y, fill: 'var(--cm-textDim)', 'font-size': 10, 'text-anchor': anchor }); n.textContent = t; return n; };
  svg.append(lab(pad, H - 10, String(xMin), 'start'), lab(W - 10, H - 10, String(xMax), 'end'), lab(pad - 4, H - pad, String(yMin), 'end'), lab(pad - 4, 18, String(yMax), 'end'), lab(W / 2, H - 2, xLabel));
  const poly = sv('polyline', { fill: 'none', stroke: 'var(--cm-primary)', 'stroke-width': 2 });
  svg.append(poly);
  const handles = pts.map((_, i) => {
    const h = sv('circle', { r: 7, fill: 'var(--cm-primary)', stroke: 'var(--cm-bg)', 'stroke-width': 2, tabindex: 0, style: 'cursor:grab', role: 'slider', 'aria-label': `점 ${i + 1}` });
    svg.append(h);
    return h;
  });

  const table = el('table', {});
  const inputs = [];
  const numCell = (i, axis, min, max, step) => {
    const inp = el('input', { type: 'number', min, max, step, class: 'cm-input', style: { width: '70px', padding: '3px 5px' } });
    inp.addEventListener('change', () => { setPoint(i, axis === 0 ? Number(inp.value) : pts[i][0], axis === 1 ? Number(inp.value) : pts[i][1]); fire(); });
    inputs[i] = inputs[i] || [];
    inputs[i][axis] = inp;
    return el('td', {}, inp);
  };
  table.append(el('tr', {}, el('th', {}, '#'), el('th', {}, xLabel), el('th', {}, yLabel)));
  pts.forEach((_, i) => table.append(el('tr', {}, el('th', {}, String(i + 1)), lockX ? el('td', {}, el('span', { class: 'u' }, '')) : numCell(i, 0, xMin, xMax, (xMax - xMin) / 100), numCell(i, 1, yMin, yMax, (yMax - yMin) / 200))));

  function setPoint(i, x, y) {
    const lo = i > 0 ? pts[i - 1][0] : xMin;
    const hi = i < pts.length - 1 ? pts[i + 1][0] : xMax;
    const nx = lockX ? pts[i][0] : Math.min(hi, Math.max(lo, clampTo(x, xMin, xMax, (xMax - xMin) / 1000)));
    const ny = clampTo(y, yMin, yMax, (yMax - yMin) / 1000);
    pts[i] = [nx, ny];
    paint();
  }
  function paint() {
    poly.setAttribute('points', pts.map(([x, y]) => `${px(x)},${py(y)}`).join(' '));
    pts.forEach(([x, y], i) => {
      handles[i].setAttribute('cx', px(x)); handles[i].setAttribute('cy', py(y));
      handles[i].setAttribute('aria-valuenow', String(y));
      if (inputs[i]) { if (inputs[i][0]) inputs[i][0].value = String(Number(x.toFixed(2))); if (inputs[i][1]) inputs[i][1].value = String(Number(y.toFixed(3))); }
    });
  }
  const fire = () => onChange(pts.map((p) => [...p]));

  handles.forEach((h, i) => {
    const pos = (e) => { const r = svg.getBoundingClientRect(); return [((e.clientX - r.left) / r.width) * W, ((e.clientY - r.top) / r.height) * H]; };
    h.addEventListener('pointerdown', (e) => { h.setPointerCapture(e.pointerId); h.style.cursor = 'grabbing'; e.preventDefault(); });
    h.addEventListener('pointermove', (e) => { if (!h.hasPointerCapture(e.pointerId)) return; const [sx, sy] = pos(e); setPoint(i, ix(sx), iy(sy)); fire(); });
    h.addEventListener('pointerup', (e) => { h.releasePointerCapture(e.pointerId); h.style.cursor = 'grab'; });
    h.addEventListener('keydown', (e) => {
      const dy = (yMax - yMin) / 100; const dx = (xMax - xMin) / 100;
      const m = { ArrowUp: [0, dy], ArrowDown: [0, -dy], ArrowLeft: [-dx, 0], ArrowRight: [dx, 0] }[e.key];
      if (!m) return;
      e.preventDefault(); setPoint(i, pts[i][0] + m[0], pts[i][1] + m[1]); fire();
    });
  });

  paint();
  const node = el('div', { class: 'ed-curve' }, svg, table);
  return {
    el: node,
    get: () => pts.map((p) => [...p]),
    evaluate: (x) => evaluateCurve(pts, x),
    set(v, silent = true) { pts = v.map(([x, y]) => [x, y]); paint(); if (!silent) fire(); },
  };
}

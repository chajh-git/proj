// web/editor/components/range-slider.js  (108번)
// 구간(체력 구간 등)용 이중 핸들 슬라이더 + 숫자 2개. 낮은 쪽이 높은 쪽을 넘지 못한다.
//   createRangeSlider({ value:[lo,hi], min, max, step, unit, onChange }) → { el, get, set }

import { el, ensureStyle } from '../../ui/dom.js';
import { COMPONENT_CSS, clampTo, decimals } from './slider-number.js';

export function createRangeSlider({ value = [0, 1], min = 0, max = 1, step = 0.01, unit = '', scale = 1, onChange = () => {} } = {}) {
  ensureStyle(COMPONENT_CSS, 'ed-comp-style');
  const d = (v) => Number((v * scale).toFixed(decimals(step * scale) + 1));
  const lo = el('input', { type: 'range', min: min * scale, max: max * scale, step: step * scale });
  const hi = el('input', { type: 'range', min: min * scale, max: max * scale, step: step * scale });
  const nLo = el('input', { type: 'number', min: min * scale, max: max * scale, step: step * scale });
  const nHi = el('input', { type: 'number', min: min * scale, max: max * scale, step: step * scale });
  const fill = el('div', { class: 'fill' });
  let cur = [min, max];
  const paint = () => {
    lo.value = String(cur[0] * scale); hi.value = String(cur[1] * scale);
    nLo.value = String(d(cur[0])); nHi.value = String(d(cur[1]));
    const span = max - min || 1;
    fill.style.left = `${((cur[0] - min) / span) * 100}%`;
    fill.style.right = `${(1 - (cur[1] - min) / span) * 100}%`;
  };
  const set2 = (a, b, which) => {
    a = clampTo(a, min, max, step); b = clampTo(b, min, max, step);
    if (a > b) { if (which === 'lo') a = b; else b = a; } // 핸들이 서로를 넘지 못하게
    cur = [a, b]; paint();
  };
  const fire = () => onChange([...cur]);
  lo.addEventListener('input', () => { set2(Number(lo.value) / scale, cur[1], 'lo'); fire(); });
  hi.addEventListener('input', () => { set2(cur[0], Number(hi.value) / scale, 'hi'); fire(); });
  nLo.addEventListener('change', () => { set2(Number(nLo.value) / scale, cur[1], 'lo'); fire(); });
  nHi.addEventListener('change', () => { set2(cur[0], Number(nHi.value) / scale, 'hi'); fire(); });
  const track = el('div', { class: 'ed-range' }, el('div', { class: 'track' }), fill, lo, hi);
  const node = el('span', { class: 'ed-c' }, nLo, track, nHi, unit ? el('span', { class: 'u' }, unit) : null);
  set2(value[0], value[1], 'lo');
  return { el: node, get: () => [...cur], set(v, silent = true) { set2(v[0], v[1], 'lo'); if (!silent) fire(); } };
}

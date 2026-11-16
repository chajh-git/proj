// web/editor/components/stepper3.js  (111번)
// 크기별 개수(연결점 소/중/대 등)를 3칸 스테퍼로. 값은 { S, M, L }.
//   createStepper3({ value:{S,M,L}, min, max, labels, onChange }) → { el, get, set }

import { el, ensureStyle } from '../../ui/dom.js';
import { COMPONENT_CSS } from './slider-number.js';

export function createStepper3({ value = { S: 0, M: 0, L: 0 }, min = 0, max = 9, labels = { S: '소', M: '중', L: '대' }, onChange = () => {} } = {}) {
  ensureStyle(COMPONENT_CSS, 'ed-comp-style');
  const cur = { S: value.S, M: value.M, L: value.L };
  const outs = {};
  const cell = (k) => {
    const out = el('b', { style: { minWidth: '22px', textAlign: 'center' } }, String(cur[k]));
    outs[k] = out;
    const bump = (d) => { const n = Math.min(max, Math.max(min, cur[k] + d)); if (n === cur[k]) return; cur[k] = n; out.textContent = String(n); onChange({ ...cur }); };
    return el('span', { class: 'ed-c', style: { gap: '4px' } }, el('span', { class: 'u' }, labels[k]), el('button', { type: 'button', class: 'st', onClick: () => bump(-1), 'aria-label': `${labels[k]} 줄이기` }, '−'), out, el('button', { type: 'button', class: 'st', onClick: () => bump(1), 'aria-label': `${labels[k]} 늘리기` }, '+'));
  };
  const node = el('span', { class: 'ed-c', style: { gap: '14px' } }, cell('S'), cell('M'), cell('L'));
  return { el: node, get: () => ({ ...cur }), set(v, silent = true) { for (const k of ['S', 'M', 'L']) { cur[k] = Math.min(max, Math.max(min, v[k])); outs[k].textContent = String(cur[k]); } if (!silent) onChange({ ...cur }); } };
}

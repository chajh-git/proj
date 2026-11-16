// web/editor/components/chip-select.js  (109번)
// 다중 선택(태그, 전장 등)을 칩 토글로. options: [[값, 라벨], …]
//   createChipSelect({ options, value:[…], onChange }) → { el, get, set }

import { el, ensureStyle } from '../../ui/dom.js';
import { COMPONENT_CSS } from './slider-number.js';

export function createChipSelect({ options = [], value = [], onChange = () => {} } = {}) {
  ensureStyle(COMPONENT_CSS, 'ed-comp-style');
  const sel = new Set(value);
  const btns = new Map();
  const paint = () => { for (const [k, b] of btns) { b.classList.toggle('on', sel.has(k)); b.setAttribute('aria-pressed', String(sel.has(k))); } };
  const node = el('div', { class: 'ed-chips' }, options.map(([k, label]) => {
    const b = el('button', { type: 'button', onClick: () => { sel.has(k) ? sel.delete(k) : sel.add(k); paint(); onChange(get()); } }, label);
    btns.set(k, b);
    return b;
  }));
  const get = () => options.map(([k]) => k).filter((k) => sel.has(k)); // 항상 옵션 순서
  paint();
  return { el: node, get, set(v, silent = true) { sel.clear(); v.forEach((x) => sel.add(x)); paint(); if (!silent) onChange(get()); } };
}

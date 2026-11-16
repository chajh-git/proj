// web/editor/components/segmented.js  (110번)
// 열거(등급 등)는 세그먼트 버튼, 참/거짓은 토글(두 칸짜리 세그먼트).
//   createSegmented({ options:[[값,라벨],…], value, onChange }) → { el, get, set }
//   createToggle({ value, onLabel, offLabel, onChange })        → { el, get, set }

import { el, ensureStyle } from '../../ui/dom.js';
import { COMPONENT_CSS } from './slider-number.js';

export function createSegmented({ options = [], value, onChange = () => {} } = {}) {
  ensureStyle(COMPONENT_CSS, 'ed-comp-style');
  let cur = value;
  const btns = new Map();
  const paint = () => { for (const [k, b] of btns) b.classList.toggle('on', k === cur); };
  const node = el('div', { class: 'ed-seg', role: 'group' }, options.map(([k, label]) => {
    const b = el('button', { type: 'button', onClick: () => { if (cur === k) return; cur = k; paint(); onChange(k); } }, label);
    btns.set(k, b);
    return b;
  }));
  paint();
  return { el: node, get: () => cur, set(v, silent = true) { cur = v; paint(); if (!silent) onChange(cur); } };
}

export function createToggle({ value = false, onLabel = '켜짐', offLabel = '꺼짐', onChange = () => {} } = {}) {
  const seg = createSegmented({ options: [[false, offLabel], [true, onLabel]], value: Boolean(value), onChange });
  return { el: seg.el, get: seg.get, set: seg.set };
}

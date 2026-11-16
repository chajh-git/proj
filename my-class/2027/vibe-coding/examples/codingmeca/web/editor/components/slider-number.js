// web/editor/components/slider-number.js  (106번)
// 슬라이더 + 숫자 입력 (정수·실수 범위), 그리고 시간용 스테퍼 + 슬라이더.
//   const c = createSliderNumber({ value, min, max, step, unit, onChange });   c.el  c.set(v, silent?)  c.get()
//   const t = createSecondsInput({ value, min, max, step, unit:'초', onChange });
// 모든 값은 범위와 눈금에 맞춰 고쳐서 내보낸다. 숫자 칸에 범위 밖 값을 적으면 고친 값으로 되돌려 보여 준다.
// 모든 편집기 컴포넌트가 같은 모양을 쓴다: { el, set(value, silent), get() }, 값이 바뀌면 onChange(value)

import { el, ensureStyle } from '../../ui/dom.js';

export const COMPONENT_CSS = `
.ed-c{display:inline-flex;align-items:center;gap:8px;flex-wrap:wrap;max-width:100%}
.ed-c input[type=range]{accent-color:var(--cm-primary);width:min(260px,40vw);min-width:110px}
.ed-c input[type=number]{width:84px;font:inherit;padding:5px 7px;border-radius:6px;border:1px solid var(--cm-panelEdge);background:rgba(0,0,0,.35);color:var(--cm-text)}
.ed-c input[type=number]:focus{outline:none;border-color:var(--cm-primary)}
.ed-c .u{font-size:12px;color:var(--cm-textDim)}
.ed-c button.st{width:28px;height:28px;border-radius:6px;border:1px solid var(--cm-panelEdge);background:rgba(255,255,255,.05);color:var(--cm-text);cursor:pointer;font:inherit;line-height:1}
.ed-c button.st:hover{border-color:var(--cm-primary);color:var(--cm-primary)}
.ed-seg{display:inline-flex;border:1px solid var(--cm-panelEdge);border-radius:8px;overflow:hidden}
.ed-seg button{font:inherit;font-size:13px;padding:5px 12px;border:0;border-right:1px solid var(--cm-panelEdge);background:transparent;color:var(--cm-textDim);cursor:pointer}
.ed-seg button:last-child{border-right:0}
.ed-seg button.on{background:var(--cm-primary);color:var(--cm-bg);font-weight:700}
.ed-chips{display:flex;flex-wrap:wrap;gap:6px}
.ed-chips button{font:inherit;font-size:12px;padding:4px 11px;border-radius:999px;border:1px solid var(--cm-panelEdge);background:transparent;color:var(--cm-textDim);cursor:pointer}
.ed-chips button.on{background:color-mix(in srgb,var(--cm-primary) 22%,transparent);border-color:var(--cm-primary);color:var(--cm-text)}
.ed-range{position:relative;width:min(260px,40vw);min-width:130px;height:26px}
.ed-range .track{position:absolute;left:0;right:0;top:11px;height:4px;border-radius:2px;background:var(--cm-panelEdge)}
.ed-range .fill{position:absolute;top:11px;height:4px;border-radius:2px;background:var(--cm-primary)}
.ed-range input[type=range]{position:absolute;left:0;top:0;width:100%;height:26px;margin:0;background:none;pointer-events:none;-webkit-appearance:none;appearance:none}
.ed-range input[type=range]::-webkit-slider-thumb{pointer-events:auto;-webkit-appearance:none;width:16px;height:16px;border-radius:50%;background:var(--cm-primary);border:2px solid var(--cm-bg);cursor:pointer}
.ed-range input[type=range]::-moz-range-thumb{pointer-events:auto;width:14px;height:14px;border-radius:50%;background:var(--cm-primary);border:2px solid var(--cm-bg);cursor:pointer}
.ed-range input[type=range]::-webkit-slider-runnable-track{background:none}
.ed-range input[type=range]::-moz-range-track{background:none}
.ed-curve svg{background:rgba(0,0,0,.3);border:1px solid var(--cm-panelEdge);border-radius:8px;touch-action:none;max-width:100%}
.ed-curve table{border-collapse:collapse;margin-top:6px;font-size:12px}
.ed-curve td,.ed-curve th{padding:2px 6px;color:var(--cm-textDim);font-weight:400}
.ed-curve td input{width:64px}
.ed-radar svg{max-width:100%}
`;

export const clampTo = (v, min, max, step, int = false) => {
  let n = Number(v);
  if (!Number.isFinite(n)) n = min;
  n = Math.min(max, Math.max(min, n));
  if (int) n = Math.round(n);
  else if (step) { const d = Math.max(0, Math.ceil(-Math.log10(step))) + 1; n = Number((Math.round((n - min) / step) * step + min).toFixed(d)); n = Math.min(max, Math.max(min, n)); }
  return n;
};
export const decimals = (step) => (step >= 1 ? 0 : Math.max(0, Math.ceil(-Math.log10(step))));

export function createSliderNumber({ value, min = 0, max = 100, step = 1, unit = '', int = false, onChange = () => {}, scale = 1 } = {}) {
  ensureStyle(COMPONENT_CSS, 'ed-comp-style');
  // scale: 화면에 보이는 값 = 저장 값 × scale (퍼센트 슬라이더가 100을 넘김)
  const dmin = min * scale; const dmax = max * scale; const dstep = step * scale;
  const range = el('input', { type: 'range', min: dmin, max: dmax, step: dstep });
  const box = el('input', { type: 'number', min: dmin, max: dmax, step: dstep });
  let cur = value;
  const show = (v) => { const d = v * scale; range.value = String(d); box.value = String(Number(d.toFixed(decimals(dstep) + 1))); };
  const commit = (disp) => { const v = clampTo(Number(disp) / scale, min, max, step, int); cur = v; show(v); onChange(v); };
  range.addEventListener('input', () => commit(range.value));
  box.addEventListener('change', () => commit(box.value));
  const node = el('span', { class: 'ed-c' }, range, box, unit ? el('span', { class: 'u' }, unit) : null);
  show(clampTo(value, min, max, step, int));
  return { el: node, get: () => cur, set(v, silent = true) { cur = clampTo(v, min, max, step, int); show(cur); if (!silent) onChange(cur); } };
}

export function createSecondsInput({ value, min = 0, max = 60, step = 1, unit = '초', onChange = () => {} } = {}) {
  ensureStyle(COMPONENT_CSS, 'ed-comp-style');
  const inner = createSliderNumber({ value, min, max, step, unit, onChange: (v) => onChange(v) });
  const dec = el('button', { type: 'button', class: 'st', title: `−${step}${unit}`, onClick: () => inner.set(inner.get() - step, false) }, '−');
  const inc = el('button', { type: 'button', class: 'st', title: `+${step}${unit}`, onClick: () => inner.set(inner.get() + step, false) }, '+');
  const node = el('span', { class: 'ed-c' }, dec, inc, inner.el);
  return { el: node, get: inner.get, set: inner.set };
}

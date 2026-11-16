// web/editor/row-kit.js
// 조율 센터 패널들이 같이 쓰는 '변수 한 줄'(이름·설명 + 편집 컴포넌트 + 되돌리기/기본값 버튼) 도구.
//   const kit = createRowKit({ store });
//   kit.row(spec, { label, desc })  → 요소   (같은 경로의 이전 줄은 자동으로 잊는다)
//   kit.reset()                     패널을 다시 그리기 전에 호출
//   kit.paintAll()
// 저장소의 change 사건에 맞춰 바뀐 줄만 강조·갱신한다(↶ ↺ 로 값이 바뀌면 컴포넌트에도 반영).

import { el, ensureStyle } from '../ui/dom.js';
import { buildControl } from './control-factory.js';

export const ROW_CSS = `
.ed-row{display:grid;grid-template-columns:minmax(150px,230px) 1fr auto;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;border:1px solid transparent;border-bottom-color:var(--cm-panelEdge)}
.ed-row.changed{background:color-mix(in srgb,var(--cm-primary) 10%,transparent);border-color:var(--cm-primary)}
.ed-row .lb b{display:block;font-size:13px}
.ed-row .lb small{display:block;font-size:11px;color:var(--cm-textDim);margin-top:2px;line-height:1.35}
.ed-row .df{font-size:11px;color:var(--cm-textDim);white-space:nowrap}
.ed-row .acts{display:flex;gap:4px}
.ed-row .acts button{font:inherit;width:28px;height:28px;border-radius:6px;border:1px solid var(--cm-panelEdge);background:transparent;color:var(--cm-text);cursor:pointer}
.ed-row .acts button:disabled{opacity:.25;cursor:default}
.ed-row .acts button:not(:disabled):hover{border-color:var(--cm-primary);color:var(--cm-primary)}
.ed-recs{display:flex;flex-direction:column;gap:4px}.ed-rec{display:flex;align-items:center;gap:10px}.ed-rec b{width:18px;text-align:center}
@media (max-width:820px){.ed-row{grid-template-columns:1fr}}
`;

export const fmtValue = (v) => {
  if (typeof v === 'boolean') return v ? '켜짐' : '꺼짐';
  if (typeof v === 'number') return String(Number(v.toFixed(4)));
  if (Array.isArray(v)) return v.join(', ');
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}:${typeof x === 'number' ? Number(x.toFixed(3)) : x}`).join(' ');
  return String(v);
};

export function createRowKit({ store }) {
  ensureStyle(ROW_CSS, 'ed-row-style');
  const rows = new Map(); // path → { row, ctl, revertBtn, resetBtn, spec }
  const paint = (path) => {
    const r = rows.get(path);
    if (!r) return;
    r.row.classList.toggle('changed', store.isChanged(path));
    r.revertBtn.disabled = !store.isChanged(path);
    r.resetBtn.disabled = store.isDefault(path);
  };
  store.on('change', ({ path }) => {
    if (path === null) { for (const [p, r] of rows) { r.ctl.set(store.get(p)); paint(p); } return; }
    const r = rows.get(path);
    if (r) { r.ctl.set(store.get(path)); paint(path); }
  });
  return {
    row(spec, { label = null, desc = null, compact = false } = {}) {
      const path = spec.path;
      const ctl = buildControl(spec, { value: store.get(path), onChange: (v) => store.set(path, v) });
      const revertBtn = el('button', { type: 'button', title: '저장된 값으로 되돌리기', onClick: () => store.revert(path) }, '↶');
      const resetBtn = el('button', { type: 'button', title: '기본값으로', onClick: () => store.reset(path) }, '↺');
      const unit = spec.unit && !/%/.test(spec.unit) && typeof spec.default === 'number' ? spec.unit : '';
      const dfEl = el('span', { class: 'df' }, `기본 ${fmtValue(spec.default)}${unit}`);
      const d = desc ?? spec.desc;
      const row = el('div', { class: 'ed-row', 'data-path': path, style: compact ? { padding: '5px 8px' } : {} },
        el('div', { class: 'lb' }, el('b', {}, label ?? spec.label), d ? el('small', {}, d) : null),
        el('div', {}, ctl.el, ' ', dfEl),
        el('div', { class: 'acts' }, revertBtn, resetBtn));
      rows.set(path, { row, ctl, revertBtn, resetBtn, spec });
      paint(path);
      return row;
    },
    reset() { rows.clear(); },
    paint, paintAll() { for (const p of rows.keys()) paint(p); },
    ctl: (path) => rows.get(path)?.ctl ?? null,
  };
}

// web/ui/dom.js  (UI 공통 도구, 58~71번이 함께 씀)
// 아주 작은 DOM 도우미와 공통 스타일. 색은 config/theme.js 가 정한 CSS 변수(--cm-*)만 쓴다.
//   el('div', {class:'x', onClick: fn}, '글자', el('span'))   요소 만들기
//   ensureStyle() 공통 스타일을 한 번만 넣기
//   gauge({label, value, max, text, warn})  가로 게이지

export function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props || {})) {
    if (v === false || v == null) continue;
    if (k === 'class') e.className = v;
    else if (k === 'style' && typeof v === 'object') Object.assign(e.style, v);
    else if (k.startsWith('on') && typeof v === 'function') e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (k === 'text') e.textContent = v;
    else e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat(Infinity)) if (c != null && c !== false) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

export function clear(node) { while (node.firstChild) node.removeChild(node.firstChild); return node; }
export const clamp01 = (v) => Math.max(0, Math.min(1, v));
export const round1 = (v) => Math.round(v * 10) / 10;

// 가로 게이지. over=true 면 한도 초과(빨강), warn=true 면 주의(주황)
export function gauge({ label, value, max, text = null, over = false, warn = false, hint = null }) {
  const pct = max > 0 ? clamp01(value / max) * 100 : 0;
  const fill = el('div', { class: `cm-gauge-fill${over ? ' over' : warn ? ' warn' : ''}`, style: { width: `${pct}%` } });
  return el('div', { class: 'cm-gauge', title: hint || '' },
    el('div', { class: 'cm-gauge-head' }, el('span', {}, label), el('b', {}, text ?? `${round1(value)} / ${max}`)),
    el('div', { class: 'cm-gauge-track' }, fill));
}

// 눈에 안 띄게 잠깐 보이는 안내문(상단)
export function flashHint(root, text, ms = 2200) {
  const n = el('div', { class: 'cm-hintbar' }, text);
  root.append(n);
  setTimeout(() => n.remove(), ms);
}

const CSS = `
.cm-panel{background:color-mix(in srgb,var(--cm-panel) calc(var(--cm-panel-opacity,.8)*100%),transparent);border:1px solid var(--cm-panelEdge);border-radius:var(--cm-radius);backdrop-filter:blur(6px);color:var(--cm-text);font-size:13px}
.cm-panel h3{margin:0;padding:10px 12px;font-size:13px;letter-spacing:.06em;color:var(--cm-primary);border-bottom:1px solid var(--cm-panelEdge)}
.cm-body{padding:10px 12px}
.cm-btn{font:inherit;padding:7px 12px;border-radius:6px;border:1px solid var(--cm-panelEdge);background:rgba(255,255,255,.04);color:var(--cm-text);cursor:pointer;transition:all .15s}
.cm-btn:hover:not(:disabled){border-color:var(--cm-primary);color:var(--cm-primary)}
.cm-btn:disabled{opacity:.4;cursor:not-allowed}
.cm-btn.primary{background:var(--cm-primary);color:var(--cm-bg);border-color:var(--cm-primary);font-weight:700}
.cm-btn.primary:hover:not(:disabled){filter:brightness(1.15);color:var(--cm-bg)}
.cm-btn.danger{border-color:var(--cm-danger);color:var(--cm-danger)}
.cm-input{font:inherit;padding:7px 10px;border-radius:6px;border:1px solid var(--cm-panelEdge);background:rgba(0,0,0,.35);color:var(--cm-text);min-width:0}
.cm-input:focus{outline:none;border-color:var(--cm-primary)}
.cm-tabs{display:flex;flex-wrap:wrap;gap:4px}
.cm-tab{font:inherit;font-size:12px;padding:5px 9px;border-radius:999px;border:1px solid var(--cm-panelEdge);background:transparent;color:var(--cm-textDim);cursor:pointer}
.cm-tab.on{background:var(--cm-primary);border-color:var(--cm-primary);color:var(--cm-bg);font-weight:700}
.cm-gauge{margin:8px 0}
.cm-gauge-head{display:flex;justify-content:space-between;font-size:12px;color:var(--cm-textDim);margin-bottom:3px}
.cm-gauge-head b{color:var(--cm-text);font-weight:600}
.cm-gauge-track{height:8px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}
.cm-gauge-fill{height:100%;border-radius:4px;background:var(--cm-primary);transition:width .25s}
.cm-gauge-fill.warn{background:var(--cm-warn,#FFB020)}
.cm-gauge-fill.over{background:var(--cm-danger)}
.cm-chip{display:inline-block;padding:1px 7px;border-radius:999px;font-size:11px;background:rgba(255,255,255,.1);color:var(--cm-textDim)}
.cm-chip.S{background:#2c5f4a;color:#9fe8c4}.cm-chip.M{background:#4a4a8a;color:#c8c8ff}.cm-chip.L{background:#7a4a2a;color:#ffd0a8}
.cm-msg{padding:6px 8px;border-radius:6px;margin:4px 0;font-size:12px;line-height:1.4;cursor:default}
.cm-msg.error{background:rgba(255,70,70,.14);border-left:3px solid var(--cm-danger)}
.cm-msg.warning{background:rgba(255,176,32,.12);border-left:3px solid var(--cm-warn,#FFB020)}
.cm-msg.ok{background:rgba(80,220,140,.12);border-left:3px solid #50DC8C}
.cm-msg[data-uid]{cursor:pointer}
.cm-scroll{overflow:auto;scrollbar-width:thin}
.cm-hintbar{position:absolute;top:14px;left:50%;transform:translateX(-50%);padding:8px 16px;border-radius:999px;background:rgba(0,0,0,.7);border:1px solid var(--cm-primary);font-size:13px;pointer-events:none;z-index:5}
.cm-field{display:flex;flex-direction:column;gap:5px;margin:10px 0}
.cm-field label{font-size:12px;color:var(--cm-textDim)}
.cm-row{display:flex;gap:8px;align-items:center}
`;

let styled = false;
export function ensureStyle(extra = '', id = 'cm-ui-base') {
  if (!styled) {
    const s = document.createElement('style');
    s.id = 'cm-ui-base';
    s.textContent = CSS;
    document.head.append(s);
    styled = true;
  }
  if (extra && !document.getElementById(id)) {
    const s = document.createElement('style');
    s.id = id;
    s.textContent = extra;
    document.head.append(s);
  }
}

// 간단한 이벤트 발행기
export function emitter() {
  const m = new Map();
  return {
    on(type, fn) { if (!m.has(type)) m.set(type, new Set()); m.get(type).add(fn); return () => m.get(type)?.delete(fn); },
    emit(type, ...a) { m.get(type)?.forEach((fn) => { try { fn(...a); } catch (e) { console.error(e); } }); },
  };
}

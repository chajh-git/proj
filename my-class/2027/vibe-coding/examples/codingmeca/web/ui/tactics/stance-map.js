// web/ui/tactics/stance-map.js  (65번)
// 태세 지도: 태세(최대 5)를 점으로, 전환 규칙을 화살표로 그린다. 점을 누르면 그 태세의 규칙 보드가 열린다. (명세 14-4)
//   실선 = 전환 규칙, 점선 = '태세 전환' 동작 카드로 바뀌는 길
//   const map = createStanceMap({ root, model, onToast }); map.setActive(id) — model 의 현재 태세를 따라간다.

import { makeStance, newId } from '../../../shared/tactics/schema.js';
import { CONSTANTS } from '../../../config/constants.js';
import { STANCE_COLORS } from './labels.js';
import { el, clear, ensureStyle } from '../dom.js';

const L = CONSTANTS.tactics;
const W = 320;
const H = 230;
const NS = 'http://www.w3.org/2000/svg';
const sv = (tag, attrs = {}, ...kids) => {
  const n = document.createElementNS(NS, tag);
  for (const [k, v] of Object.entries(attrs)) if (v != null) n.setAttribute(k, v);
  for (const c of kids) if (c != null) n.append(c.nodeType ? c : document.createTextNode(c));
  return n;
};

const CSS = `
.cm-smap{display:flex;flex-direction:column}
.cm-smap .gfx{padding:6px 8px 0}
.cm-smap svg{width:100%;height:auto;display:block}
.cm-smap .node{cursor:pointer}
.cm-smap .node text{fill:var(--cm-text);font-size:12px;font-weight:700;pointer-events:none}
.cm-smap .node .sub{font-size:9px;font-weight:400;fill:var(--cm-textDim)}
.cm-smap .node:hover circle{filter:brightness(1.25)}
.cm-smap .acts{display:flex;flex-wrap:wrap;gap:6px;padding:8px 10px 10px;align-items:center}
.cm-smap .acts .cm-input{width:110px}
.cm-smap .hint{padding:0 12px 8px;font-size:11px;color:var(--cm-textDim)}
`;

// 태세 개수별 배치
export function layoutNodes(n) {
  const cx = W / 2;
  const cy = H / 2 + 6;
  if (n === 1) return [[cx, cy]];
  const r = n === 2 ? 95 : 70;
  const start = n === 2 ? 0 : -Math.PI / 2;
  return Array.from({ length: n }, (_, i) => {
    const a = start + (i / n) * Math.PI * 2 + (n === 2 ? Math.PI / 2 * 0 : 0);
    return [cx + Math.cos(a) * r * (n === 2 ? 1 : 1.25), cy + Math.sin(a) * r * (n === 2 ? 0.01 : 1)];
  });
}

// 태세 사이의 길 목록: { from, to, kind:'tr'|'act', count }
export function collectLinks(tactics) {
  const map = new Map();
  for (const s of tactics.stances) {
    for (const tr of s.transitions) {
      const k = `${s.id}>${tr.to}>tr`;
      map.set(k, { from: s.id, to: tr.to, kind: 'tr', count: (map.get(k)?.count || 0) + 1 });
    }
    for (const r of s.rules) {
      if (r.do.type !== 'switch_stance') continue;
      const k = `${s.id}>${r.do.to}>act`;
      map.set(k, { from: s.id, to: r.do.to, kind: 'act', count: (map.get(k)?.count || 0) + 1 });
    }
  }
  return [...map.values()];
}

export function createStanceMap({ root, model, onToast = () => {} } = {}) {
  ensureStyle(CSS, 'cm-smap-style');
  const wrap = el('div', { class: 'cm-panel cm-smap' });
  const gfx = el('div', { class: 'gfx' });
  const acts = el('div', { class: 'acts' });
  wrap.append(el('h3', {}, '태세 지도'), gfx, el('div', { class: 'hint' }, '점을 누르면 그 태세를 고칠 수 있습니다. 실선은 전환 규칙, 점선은 ‘태세 전환’ 동작입니다.'), acts);
  root.append(wrap);

  function render() {
    const t = model.get();
    const cur = model.currentStance;
    const pos = new Map(t.stances.map((s, i) => [s.id, layoutNodes(t.stances.length)[i]]));
    const svg = sv('svg', { viewBox: `0 0 ${W} ${H}`, role: 'img', 'aria-label': '태세 지도' });
    const defs = sv('defs');
    for (const [id, color] of [['a-tr', '#9fe8ff'], ['a-act', '#FFB020']]) {
      defs.append(sv('marker', { id, viewBox: '0 0 10 10', refX: 9, refY: 5, markerWidth: 7, markerHeight: 7, orient: 'auto-start-reverse' }, sv('path', { d: 'M0,0 L10,5 L0,10 z', fill: color })));
    }
    svg.append(defs);

    const R = 26;
    const links = collectLinks(t);
    const has = new Set(links.map((l) => `${l.from}>${l.to}`));
    for (const l of links) {
      const [x1, y1] = pos.get(l.from);
      const [x2, y2] = pos.get(l.to);
      if (l.from === l.to) {
        svg.append(sv('path', { d: `M${x1 - 10},${y1 - R + 2} c-18,-28 28,-28 20,0`, fill: 'none', stroke: l.kind === 'tr' ? '#9fe8ff' : '#FFB020', 'stroke-width': 1.6, 'stroke-dasharray': l.kind === 'act' ? '4 3' : null, 'marker-end': `url(#a-${l.kind})` }));
        continue;
      }
      const dx = x2 - x1;
      const dy = y2 - y1;
      const d = Math.hypot(dx, dy) || 1;
      const ux = dx / d;
      const uy = dy / d;
      // 서로 오가는 길은 살짝 휘게, 종류가 다르면 더 휘게
      const bend = (has.has(`${l.to}>${l.from}`) ? 16 : 0) + (l.kind === 'act' ? 10 : 0);
      const sx = x1 + ux * R;
      const sy = y1 + uy * R;
      const ex = x2 - ux * (R + 5);
      const ey = y2 - uy * (R + 5);
      const mx = (sx + ex) / 2 - uy * bend;
      const my = (sy + ey) / 2 + ux * bend;
      svg.append(sv('path', { d: `M${sx},${sy} Q${mx},${my} ${ex},${ey}`, fill: 'none', stroke: l.kind === 'tr' ? '#9fe8ff' : '#FFB020', 'stroke-width': 1.6, 'stroke-dasharray': l.kind === 'act' ? '4 3' : null, 'marker-end': `url(#a-${l.kind})`, opacity: 0.9 }));
      if (l.count > 1) svg.append(sv('text', { x: mx, y: my - 3, 'text-anchor': 'middle', fill: '#cfe', 'font-size': 9 }, `×${l.count}`));
    }

    t.stances.forEach((s, i) => {
      const [x, y] = pos.get(s.id);
      const color = STANCE_COLORS[i % STANCE_COLORS.length];
      const g = sv('g', { class: 'node', 'data-stance': s.id, tabindex: 0, role: 'button', 'aria-label': `${s.name} 태세` });
      if (s.id === cur) g.append(sv('circle', { cx: x, cy: y, r: R + 5, fill: 'none', stroke: color, 'stroke-width': 2, opacity: 0.8 }));
      g.append(sv('circle', { cx: x, cy: y, r: R, fill: color, 'fill-opacity': 0.22, stroke: color, 'stroke-width': s.id === t.startStance ? 3 : 1.5 }));
      g.append(sv('text', { x, y: y + 4, 'text-anchor': 'middle' }, s.name.length > 6 ? `${s.name.slice(0, 5)}…` : s.name));
      if (s.id === t.startStance) g.append(sv('text', { x, y: y + R + 13, 'text-anchor': 'middle', class: 'sub' }, '시작'));
      g.append(sv('text', { x, y: y - R - 5, 'text-anchor': 'middle', class: 'sub' }, `규칙 ${s.rules.length} · 전환 ${s.transitions.length}`));
      const pick = () => { model.currentStance = s.id; };
      g.addEventListener('click', pick);
      g.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(); } });
      svg.append(g);
    });
    clear(gfx);
    gfx.append(svg);

    // 버튼들
    clear(acts);
    const s = model.stance();
    const nameInput = el('input', { class: 'cm-input', value: s.name, maxlength: L.maxNameLength, 'aria-label': '태세 이름' });
    nameInput.addEventListener('change', () => { const v = nameInput.value.trim(); if (v) model.mutate((x) => { x.stances.find((q) => q.id === model.currentStance).name = v; }); else nameInput.value = s.name; });
    acts.append(nameInput,
      el('button', { type: 'button', class: 'cm-btn', disabled: t.stances.length >= L.maxStances, title: t.stances.length >= L.maxStances ? `태세는 ${L.maxStances}개까지입니다` : '', onClick: addStance }, '＋ 태세'),
      el('button', { type: 'button', class: 'cm-btn', disabled: s.id === t.startStance, onClick: () => model.mutate((x) => { x.startStance = model.currentStance; }) }, '시작 태세로'),
      el('button', { type: 'button', class: 'cm-btn danger', disabled: t.stances.length <= 1, onClick: removeStance }, '삭제'));
  }

  function addStance() {
    const t = model.get();
    if (t.stances.length >= L.maxStances) return onToast(`태세는 ${L.maxStances}개까지입니다`);
    const id = newId('s', t.stances.map((q) => q.id));
    model.mutate((x) => { x.stances.push(makeStance(id, `태세 ${x.stances.length + 1}`)); });
    model.currentStance = id;
  }

  function removeStance() {
    const t = model.get();
    if (t.stances.length <= 1) return;
    const id = model.currentStance;
    const idx = t.stances.findIndex((q) => q.id === id);
    model.mutate((x) => {
      x.stances.splice(idx, 1);
      if (x.startStance === id) x.startStance = x.stances[0].id;
    });
    model.currentStance = model.get().stances[Math.max(0, idx - 1)].id;
  }

  const off1 = model.on('change', render);
  const off2 = model.on('stance', render);
  render();
  return { el: wrap, render, destroy() { off1(); off2(); wrap.remove(); } };
}

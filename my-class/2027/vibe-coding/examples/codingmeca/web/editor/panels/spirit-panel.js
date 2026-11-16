// web/editor/panels/spirit-panel.js  (118번) — 투지·게이지·성향 수치 + 투지에 따른 공격 배율·회피 곡선 미리보기. (명세 18-3)
//   공식은 shared/sim/spirit.js 와 같다:  공격 = 1 + attackSwing × (투지 − 시작) / (최대/2),  회피 = dodgeMax × clamp(투지/최대, 0, 1)
import { createConstantsPanel } from './constants-panel.js';
import { el } from '../../ui/dom.js';

export function createSpiritPanel({ store, kit }) {
  const base = createConstantsPanel({ store, kit, groups: ['spirit', 'temperament', 'gauge'], id: 'spirit', label: '투지·게이지' });
  const cv = el('canvas', { width: 360, height: 130, style: { border: '1px solid var(--cm-panelEdge)', borderRadius: '6px', margin: '6px 0 12px', maxWidth: '100%' } });
  const root = el('div', {}, el('div', { class: 'gd' }, '투지에 따른 공격 배율(파랑)과 회피 확률(노랑) 미리보기'), cv, base.el);
  const paint = () => {
    const g = cv.getContext('2d'); const W = cv.width; const H = cv.height;
    g.clearRect(0, 0, W, H);
    const max = store.get('spirit.baseMax') || 100; const start = store.get('spirit.start') ?? max / 2;
    const swing = store.get('spirit.attackSwing') ?? 0; const dodge = store.get('spirit.dodgeMax') ?? 0;
    const atk = (s) => 1 + swing * (s - start) / (max / 2); const dg = (s) => dodge * Math.min(1, Math.max(0, s / max));
    const lo = Math.min(atk(0), 1 - 0.01); const hi = Math.max(atk(max), 1 + dodge + 0.01);
    const Y = (v) => H - 8 - (v - lo) / (hi - lo) * (H - 16);
    const line = (f, c) => { g.strokeStyle = c; g.beginPath(); for (let i = 0; i <= 50; i++) { const s = i / 50 * max; const x = i / 50 * (W - 10) + 5; i ? g.lineTo(x, Y(f(s))) : g.moveTo(x, Y(f(s))); } g.stroke(); };
    g.strokeStyle = '#334'; g.beginPath(); g.moveTo(0, Y(1)); g.lineTo(W, Y(1)); g.stroke();
    line(atk, '#4FC3F7'); line(dg, '#FFC857');
  };
  store.on('change', ({ path }) => { if (path === null || String(path).startsWith('spirit.')) paint(); });
  return { ...base, el: root, onShow() { base.onShow(); paint(); } };
}

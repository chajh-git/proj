// web/editor/panels/aptitude-panel.js  (117번) — 적성 등급 배율(S~D) 슬라이더 + 막대 미리보기, 투지·게이지는 spirit-panel. (명세 18-3)
import { createConstantsPanel } from './constants-panel.js';
import { el } from '../../ui/dom.js';

export function createAptitudePanel({ store, kit }) {
  const base = createConstantsPanel({ store, kit, groups: ['aptitude'], id: 'aptitude', label: '적성' });
  const bars = el('div', { style: { display: 'flex', gap: '10px', alignItems: 'flex-end', height: '90px', margin: '8px 0 14px' } });
  const root = el('div', {}, bars, base.el);
  const paint = () => {
    const m = store.get('stats.aptitudeMult') || {};
    bars.replaceChildren(...['S', 'A', 'B', 'C', 'D'].map((g) => el('div', { style: { textAlign: 'center', fontSize: '12px' } },
      el('div', { style: { width: '34px', height: `${Math.max(2, (m[g] ?? 0) / 1.5 * 70)}px`, background: 'var(--cm-primary)', borderRadius: '4px 4px 0 0', margin: '0 auto' } }), `${g} ×${Number((m[g] ?? 0).toFixed(2))}`)));
  };
  store.on('change', ({ path }) => { if (path === null || path === 'stats.aptitudeMult') paint(); });
  return { ...base, el: root, onShow() { base.onShow(); paint(); } };
}

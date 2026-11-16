// web/editor/panels/preset-panel.js  (122번) — 리그 프리셋(입문·표준·무제한). 원형 설계도가 한도를 넘으면 경고한다. (명세 18-3)
import { LEAGUE_PRESETS } from '../../../data/league-presets.js';
import { PRESETS } from '../../../data/presets.js';
import { createItemPanel } from './item-panel.js';
import { el } from '../../ui/dom.js';

export function presetOverLimit(store, id) {
  const cap = store.get(`presets/${id}/weightCap`); const budget = store.get(`presets/${id}/budget`);
  return PRESETS.filter((p) => p.expected && (p.expected.weight > cap || p.expected.cost > budget)).map((p) => `‘${p.name}’ 무게 ${p.expected.weight}/${cap}, 비용 ${p.expected.cost}/${budget}`);
}

export function createPresetPanel({ store, kit }) {
  return createItemPanel({
    store, kit, section: 'presets', id: 'preset', label: '리그 프리셋', items: LEAGUE_PRESETS,
    extra(item) {
      const box = el('div', { class: 'ed-warn', style: { color: 'var(--cm-warn,#FFC857)', fontSize: '12px' } });
      const refresh = () => { const w = presetOverLimit(store, item.id); box.textContent = w.length ? `⚠ 한도를 넘는 원형 설계도: ${w.join(' / ')}` : ''; };
      refresh();
      return { el: box, refresh };
    },
  });
}

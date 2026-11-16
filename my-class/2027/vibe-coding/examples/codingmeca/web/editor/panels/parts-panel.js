// web/editor/panels/parts-panel.js  (115번)  /  cores-panel.js(116번)는 같은 파일의 createCoresPanel
// 부품 표(왼쪽, 분류별) + 편집 카드(오른쪽) + 같은 분류와 견주는 레이더 차트. (명세 18-3)

import { PARTS, CATEGORY_ORDER } from '../../../data/parts.js';
import { CATEGORY_LABEL } from '../../../config/names.js';
import { createItemPanel } from './item-panel.js';
import { createRadarChart } from '../components/radar-chart.js';

const AXES = [['weight', '무게'], ['cost', '비용'], ['power', '전력'], ['hpBonus', '체력'], ['durability', '내구']];
const COLORS = ['#4FC3F7', '#FFC857'];

// 레이더: 같은 분류에서 각 축의 가장 큰 현재값을 1로 놓고 이 부품의 값을 견준다(저장 전 값 포함).
function radarFor(part, store) {
  const peers = PARTS.filter((p) => p.category === part.category);
  const val = (p, k) => { const v = store.get(`parts/${p.id}/${k}`); return typeof v === 'number' ? v : (typeof p[k] === 'number' ? p[k] : 0); };
  const axes = AXES.filter(([k]) => peers.some((p) => val(p, k) > 0)).map(([key, label]) => ({ key, label, max: Math.max(1, ...peers.map((p) => val(p, key))) }));
  if (axes.length < 3) return null;
  const chart = createRadarChart({ axes, size: 220 });
  const paint = () => {
    const mean = {}; for (const a of axes) mean[a.key] = peers.reduce((s, p) => s + val(p, a.key), 0) / peers.length;
    chart.set([{ name: '같은 분류 평균', color: COLORS[1], values: mean }, { name: part.name, color: COLORS[0], values: Object.fromEntries(axes.map((a) => [a.key, val(part, a.key)])) }]);
  };
  paint();
  return { el: chart.el, refresh: paint };
}

export function createPartsPanel({ store, kit }) {
  return createItemPanel({
    store, kit, section: 'parts', id: 'parts', label: '부품',
    items: PARTS, filter: (p) => p.category !== 'core',
    groupOf: (p) => p.category, groupLabel: (c) => CATEGORY_LABEL[c] || c,
    itemSub: (p) => CATEGORY_LABEL[p.category] || '', extra: radarFor,
  });
}
export function createCoresPanel({ store, kit }) {
  return createItemPanel({
    store, kit, section: 'parts', id: 'cores', label: '코어',
    items: PARTS, filter: (p) => p.category === 'core', extra: radarFor,
  });
}
export { CATEGORY_ORDER };

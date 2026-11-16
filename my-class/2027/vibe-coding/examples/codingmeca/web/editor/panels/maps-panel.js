// web/editor/panels/maps-panel.js  (119번) — 전장 수치(슬라이더) + 위에서 본 미니맵(장애물·섬 비율·축소 한계). (명세 18-3)
import { MAPS } from '../../../data/maps.js';
import { createItemPanel } from './item-panel.js';
import { el } from '../../ui/dom.js';

function minimap(map, store) {
  const S = 180;
  const cv = el('canvas', { width: S, height: S, style: { border: '1px solid var(--cm-panelEdge)', borderRadius: '6px', background: '#0b1018' } });
  const g = cv.getContext('2d');
  const paint = () => {
    g.clearRect(0, 0, S, S);
    const pv = map.preview || {};
    g.fillStyle = pv.floor || '#1c2a3a'; g.fillRect(0, 0, S, S);
    g.fillStyle = pv.obstacle || '#5a6b80';
    for (const o of map.obstacles || []) {
      const r = Array.isArray(o) ? o : (o.rect || [o.x, o.y, o.w, o.h]);
      if (r && r.length >= 4 && r.every((n) => typeof n === 'number')) g.fillRect(r[0] * S, r[1] * S, r[2] * S, r[3] * S);
    }
    const island = store.get(`maps/${map.id}/rules.island.areaRatio`);
    if (typeof island === 'number') { g.strokeStyle = '#4FC3F7'; g.beginPath(); g.arc(S / 2, S / 2, Math.sqrt(island / Math.PI) * S, 0, 7); g.stroke(); }
    const lava = store.get(`maps/${map.id}/rules.lavaEdge.widthMeters`);
    if (typeof lava === 'number') { g.strokeStyle = '#FF6B3D'; g.lineWidth = Math.max(1, lava * 2); g.strokeRect(0, 0, S, S); g.lineWidth = 1; }
    const min = store.get(`maps/${map.id}/rules.shrink.minSize`);
    if (typeof min === 'number') { const w = Math.min(1, min / 40) * S; g.setLineDash([4, 3]); g.strokeStyle = '#FFC857'; g.strokeRect((S - w) / 2, (S - w) / 2, w, w); g.setLineDash([]); }
  };
  paint();
  return { el: cv, refresh: paint };
}

export function createMapsPanel({ store, kit }) {
  return createItemPanel({ store, kit, section: 'maps', id: 'maps', label: '전장', items: MAPS, itemSub: (m) => m.env || '', extra: minimap });
}

// web/editor/panels/item-panel.js
// 항목 목록(왼쪽) + 편집 카드(오른쪽) 형태의 공통 패널. 부품·코어·전장·각성기·리그 프리셋 패널이 이걸 쓴다. (명세 18-3)
//   createItemPanel({ store, kit, section, id, label, items, itemLabel, filter, extra, groups })
//   · items: 항목 배열(데이터 파일의 원본)    · extra(item, store) → 카드 위에 붙일 { el, refresh() } (레이더·미니맵 등)
//   · 항목 수치는 명세 leafSpecsFor(section, id) 로 자동으로 만들어 행 도구(kit)로 그린다. 바뀐 항목은 목록에서 점으로 표시.

import { leafSpecsFor } from '../../../config/balance-schema.js';
import { el, clear, ensureStyle } from '../../ui/dom.js';

const CSS = `
.ip{display:grid;grid-template-columns:230px 1fr;gap:12px;min-height:0}
.ip-list{display:flex;flex-direction:column;gap:2px;max-height:calc(100vh - 190px);overflow:auto;padding-right:4px}
.ip-list button{font:inherit;text-align:left;padding:6px 8px;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--cm-text);cursor:pointer;display:flex;justify-content:space-between;gap:6px}
.ip-list button:hover{border-color:var(--cm-panelEdge)}
.ip-list button.on{background:color-mix(in srgb,var(--cm-primary) 18%,transparent);border-color:var(--cm-primary)}
.ip-list .dot{color:var(--cm-primary);font-weight:700}
.ip-list h4{margin:8px 0 2px;font-size:11px;color:var(--cm-textDim);font-weight:600}
.ip-card h2{margin:0 0 2px}
.ip-card .sub{font-size:12px;color:var(--cm-textDim);margin:0 0 8px}
.ip-extra{margin:6px 0 10px}
@media (max-width:820px){.ip{grid-template-columns:1fr}.ip-list{max-height:160px}}
`;

export function createItemPanel({ store, kit, section, id, label, items, itemLabel = (x) => x.name || x.id, itemSub = () => '', filter = () => true, groupOf = null, groupLabel = (g) => g, extra = null, emptyText = '항목이 없습니다.' }) {
  ensureStyle(CSS, 'ed-ip-style');
  const list = items.filter(filter);
  const owned = new Set(list.flatMap((it) => leafSpecsFor(section, it.id).map((s) => s.path)));
  const listEl = el('div', { class: 'ip-list' });
  const card = el('div', { class: 'ip-card' });
  const root = el('div', { class: 'ip' }, listEl, card);
  let current = list[0]?.id ?? null;
  let query = '';
  let ex = null;

  const changedIn = (itemId) => leafSpecsFor(section, itemId).some((s) => store.isChanged(s.path));

  function renderList() {
    clear(listEl);
    const q = query.toLowerCase();
    let lastGroup = null;
    for (const it of list) {
      if (q && !`${itemLabel(it)} ${it.id} ${itemSub(it)}`.toLowerCase().includes(q)) continue;
      const g = groupOf ? groupOf(it) : null;
      if (g !== lastGroup) { lastGroup = g; if (g) listEl.append(el('h4', {}, groupLabel(g))); }
      listEl.append(el('button', { type: 'button', class: it.id === current ? 'on' : '', onClick: () => { current = it.id; renderList(); renderCard(); } },
        el('span', {}, itemLabel(it)), changedIn(it.id) ? el('span', { class: 'dot' }, '●') : null));
    }
    if (!listEl.childElementCount) listEl.append(el('div', { class: 'ed-empty' }, emptyText));
  }

  function renderCard() {
    kit.reset(); clear(card); ex = null;
    const it = list.find((x) => x.id === current);
    if (!it) return;
    card.append(el('h2', {}, itemLabel(it)), el('p', { class: 'sub' }, [it.desc || it.info || '', itemSub(it) ? ` · ${itemSub(it)}` : ''].join('')));
    if (extra) { ex = extra(it, store); if (ex) card.append(el('div', { class: 'ip-extra' }, ex.el)); }
    const specs = leafSpecsFor(section, it.id);
    if (!specs.length) card.append(el('div', { class: 'ed-empty' }, '이 항목에는 고칠 수 있는 수치가 없습니다.'));
    for (const s of specs) card.append(kit.row(s));
  }

  store.on('change', ({ path }) => {
    if (path !== null && !owned.has(path)) return;
    if (path === null) { renderList(); renderCard(); return; }
    renderList();
    ex?.refresh?.();
  });

  return {
    id, label, el: root, searchable: true,
    owns: (path) => owned.has(path),
    ownerOf: (path) => (owned.has(path) ? id : null),
    search(q) { query = q; if (q) { const f = list.find((it) => `${itemLabel(it)} ${it.id}`.toLowerCase().includes(q.toLowerCase())); if (f) current = f.id; } renderList(); renderCard(); },
    select(itemId) { if (list.some((x) => x.id === itemId)) { current = itemId; renderList(); renderCard(); } },
    onShow() { renderList(); renderCard(); },
  };
}

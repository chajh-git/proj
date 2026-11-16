// web/editor/panels/constants-panel.js  (114번)
// 명세(config/balance-schema.js)의 일반 변수 그룹을 그대로 그려 주는 패널. 전역 규칙·피해 모델·능력 공식·교전·전술 한도 등에 쓴다. (명세 18-3)
//   createConstantsPanel({ store, kit, groups:['global','damage'], title })
//   panel.el  panel.owns(path)  panel.search(q)  panel.onShow()
// ‘고급’ 그룹은 접어 두고, 검색어가 있으면 펼쳐서 보여 준다.

import { BALANCE_GROUPS, VAR_BY_PATH } from '../../../config/balance-schema.js';
import { el, clear } from '../../ui/dom.js';

export function createConstantsPanel({ store, kit, groups, id = null, label = null }) {
  const list = BALANCE_GROUPS.filter((g) => groups.includes(g.id));
  const owned = new Set(list.flatMap((g) => g.vars.map((v) => v.path)));
  const root = el('div', {});
  let query = '';

  function render() {
    kit.reset();
    clear(root);
    let any = false;
    const q = query.toLowerCase();
    for (const g of list) {
      const specs = g.vars.map((v) => VAR_BY_PATH[v.path]).filter((s) => !q || `${s.label} ${s.desc || ''} ${s.path}`.toLowerCase().includes(q));
      if (!specs.length) continue;
      any = true;
      const rows = specs.map((s) => kit.row(s));
      root.append(el('h2', {}, g.label), el('p', { class: 'gd' }, g.desc || ''));
      if (g.adv && !q) root.append(el('details', { class: 'ed-adv' }, el('summary', {}, '고급 — 바꾸면 모든 기체의 느낌이 달라집니다. 펼쳐서 수정'), rows));
      else root.append(...rows);
    }
    if (!any) root.append(el('div', { class: 'ed-empty' }, '찾는 변수가 없습니다.'));
  }
  return {
    id: id ?? `const-${groups.join('-')}`, label: label ?? list.map((g) => g.label).join(' · '),
    el: root, searchable: true,
    owns: (path) => owned.has(path),
    search(q) { query = q; render(); },
    onShow() { render(); },
  };
}

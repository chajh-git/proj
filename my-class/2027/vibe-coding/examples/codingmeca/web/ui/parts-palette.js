// web/ui/parts-palette.js  (60번)
// 격납고 왼쪽 파츠 팔레트: 카테고리 탭 + 검색 + 파츠 카드. (명세 14-3)
//   · 카드를 '눌러 선택' 하거나 '끌어서' 3D 작업대 위에 놓는다(끌기는 터치·마우스 모두).
//   · 선택/끌기 시작·끝은 콜백으로 알린다. 실제 부착은 조립 화면(59번)이 처리한다.
//   const palette = createPartsPalette({ root, onSelect, onDragMove, onDrop, onDragCancel });
//   palette.setSelected(partId|null)  palette.setBudget({ weightLeft, costLeft }) → 남은 한도를 넘는 카드는 흐리게
//   palette.setPresent(Set(partId))   → 이미 쓴 파츠 표시(개수)

import { PARTS, PARTS_BY_CATEGORY, CATEGORY_ORDER } from '../../data/parts.js';
import { CATEGORY_LABEL, SIZE_LABEL, DAMAGE_TYPE_LABEL, ENV_LABEL, ALTITUDE_LABEL } from '../../config/names.js';
import { el, clear, ensureStyle } from './dom.js';

const CSS = `
.cm-pal{display:flex;flex-direction:column;height:100%;min-height:0}
.cm-pal .top{padding:8px 10px;border-bottom:1px solid var(--cm-panelEdge)}
.cm-pal .search{width:100%;box-sizing:border-box;margin-bottom:8px}
.cm-pal .list{flex:1;min-height:0;padding:8px 10px;display:flex;flex-direction:column;gap:7px}
.cm-card{position:relative;padding:8px 10px;border-radius:8px;border:1px solid var(--cm-panelEdge);background:rgba(255,255,255,.03);cursor:grab;user-select:none;touch-action:none;transition:border-color .12s,background .12s}
.cm-card:hover{border-color:var(--cm-primary);background:rgba(255,255,255,.07)}
.cm-card.sel{border-color:var(--cm-primary);box-shadow:0 0 0 1px var(--cm-primary) inset;background:rgba(255,255,255,.1)}
.cm-card.dim{opacity:.45}
.cm-card .nm{display:flex;align-items:center;gap:6px;font-weight:600}
.cm-card .nm .cnt{margin-left:auto;font-size:11px;color:var(--cm-textDim)}
.cm-card .st{margin-top:4px;font-size:11px;color:var(--cm-textDim);line-height:1.5}
.cm-card .st b{color:var(--cm-text);font-weight:600}
.cm-card .wc{margin-top:3px;font-size:11px;color:var(--cm-textDim)}
.cm-ghost{position:fixed;z-index:60;pointer-events:none;padding:6px 12px;border-radius:8px;background:var(--cm-primary);color:var(--cm-bg);font-weight:700;font-size:13px;transform:translate(-50%,-130%);box-shadow:0 4px 18px rgba(0,0,0,.5)}
.cm-pal .empty{padding:18px 6px;text-align:center;color:var(--cm-textDim)}
`;

const fmt = (n) => (Number.isInteger(n) ? String(n) : (Math.round(n * 10) / 10).toString());

// 카테고리별 핵심 수치 한 줄
export function summaryOf(d) {
  const b = (k, v) => `${k} <b>${v}</b>`;
  const out = [];
  switch (d.category) {
    case 'core': out.push(b('출력', d.output), b('용량', d.capacity), b('체력', d.baseHp)); break;
    case 'structure': if (d.hpBonus) out.push(b('체력', `+${d.hpBonus}`)); break;
    case 'mobility':
      out.push(b('추력', d.thrust), b('최고속', d.maxSpeed), b('고도', ALTITUDE_LABEL[d.maxAltitude] || d.maxAltitude));
      if (d.aptitude) {
        const best = Object.entries(d.aptitude).filter(([, g]) => g === 'A' || g === 'S').map(([e, g]) => `${ENV_LABEL[e] || e} ${g}`);
        if (best.length) out.push(best.join('·'));
      }
      break;
    case 'armor': out.push(Object.entries(d.reduce || {}).map(([t, v]) => `${DAMAGE_TYPE_LABEL[t] || t} −${Math.round(v * 100)}%`).join(' ')); break;
    case 'defense':
      if (d.shieldAbsorb) out.push(b('흡수', d.shieldAbsorb), b('재가동', `${d.rebootSeconds}초`));
      else if (d.invulnSeconds) out.push(b('무적', `${d.invulnSeconds}초`), b('쿨', `${d.cooldown}초`));
      else if (d.cooldown) out.push(b('쿨', `${d.cooldown}초`));
      break;
    case 'sensor': out.push(b('범위', `${d.range}m`), `${(d.info || []).length}종 정보`); break;
    case 'weapon': case 'overdrive':
      out.push(d.damagePerSecond ? b('초당 피해', d.damagePerSecond) : b('피해', d.damage ?? '—'), DAMAGE_TYPE_LABEL[d.damageType] || '');
      if (d.cooldown) out.push(b('쿨', `${d.cooldown}초`));
      if (d.range) out.push(b('사거리', `${d.range}m`));
      if (d.energyCost) out.push(b('소모', d.energyCost));
      break;
    case 'spirit': if (d.spiritMaxBonus) out.push(b('투지 최대', `+${d.spiritMaxBonus}`)); break;
    case 'cell': out.push(b('용량', d.capacity), b('출력', `+${d.output}`)); break;
    default: break;
  }
  return out.filter(Boolean).join(' · ');
}

export function createPartsPalette({ root, onSelect = () => {}, onDragStart = () => {}, onDragMove = () => {}, onDrop = () => {}, onDragCancel = () => {}, categories = CATEGORY_ORDER } = {}) {
  ensureStyle(CSS, 'cm-pal-style');
  const wrap = el('div', { class: 'cm-panel cm-pal' });
  const search = el('input', { class: 'cm-input search', type: 'search', placeholder: '파츠 검색 (이름·종류)', 'aria-label': '파츠 검색' });
  const tabs = el('div', { class: 'cm-tabs' });
  const list = el('div', { class: 'list cm-scroll' });
  wrap.append(el('h3', {}, '파츠 팔레트'), el('div', { class: 'top' }, search, tabs), list);
  root.append(wrap);

  let cat = categories.find((c) => c !== 'core') || categories[0];
  let query = '';
  let selected = null;
  let budget = { weightLeft: Infinity, costLeft: Infinity };
  let present = new Map();
  let ghost = null;

  const cats = categories.filter((c) => PARTS_BY_CATEGORY[c]?.length);
  function renderTabs() {
    clear(tabs);
    for (const c of cats) {
      tabs.append(el('button', { type: 'button', class: `cm-tab${c === cat && !query ? ' on' : ''}`, onClick: () => { cat = c; query = ''; search.value = ''; render(); } }, CATEGORY_LABEL[c] || c));
    }
  }

  const matches = (p, q) => {
    const s = `${p.name} ${p.id} ${CATEGORY_LABEL[p.category] || ''} ${(p.tags || []).join(' ')} ${DAMAGE_TYPE_LABEL[p.damageType] || ''}`.toLowerCase();
    return q.split(/\s+/).every((w) => s.includes(w));
  };

  function card(p) {
    const tooHeavy = p.weight > budget.weightLeft;
    const tooCostly = p.cost > budget.costLeft;
    const c = el('div', { class: `cm-card${selected === p.id ? ' sel' : ''}${tooHeavy || tooCostly ? ' dim' : ''}`, 'data-part': p.id, role: 'button', tabindex: 0, title: tooHeavy ? '무게 한도를 넘습니다' : tooCostly ? '예산을 넘습니다' : '눌러서 선택, 끌어서 부착' },
      el('div', { class: 'nm' },
        p.name,
        p.size ? el('span', { class: `cm-chip ${p.size}` }, `${SIZE_LABEL[p.size]}`) : el('span', { class: 'cm-chip' }, '코어'),
        present.get(p.id) ? el('span', { class: 'cnt' }, `×${present.get(p.id)}`) : null),
      (() => { const s = el('div', { class: 'st' }); s.innerHTML = summaryOf(p); return s; })(),
      el('div', { class: 'wc' }, `무게 ${fmt(p.weight)} · 비용 ${fmt(p.cost)}${p.power ? ` · 전력 ${fmt(p.power)}` : ''}`));
    bindDrag(c, p);
    return c;
  }

  function render() {
    renderTabs();
    clear(list);
    const items = query ? PARTS.filter((p) => cats.includes(p.category) && matches(p, query)) : PARTS_BY_CATEGORY[cat] || [];
    if (!items.length) list.append(el('div', { class: 'empty' }, '맞는 파츠가 없습니다'));
    for (const p of items) list.append(card(p));
  }

  // 눌러 선택 / 끌어서 놓기
  function bindDrag(node, p) {
    let start = null;
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, dragging: false, id: e.pointerId };
      node.setPointerCapture?.(e.pointerId);
    });
    node.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id) return;
      if (!start.dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
        start.dragging = true;
        ghost = el('div', { class: 'cm-ghost' }, p.name);
        document.body.append(ghost);
        onDragStart(p.id);
      }
      if (start.dragging) {
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
        onDragMove(p.id, e.clientX, e.clientY);
      }
    });
    const finish = (e, cancel) => {
      if (!start || e.pointerId !== start.id) return;
      const was = start;
      start = null;
      ghost?.remove();
      ghost = null;
      if (was.dragging) { cancel ? onDragCancel(p.id) : onDrop(p.id, e.clientX, e.clientY); }
      else if (!cancel) { api.setSelected(selected === p.id ? null : p.id, true); }
    };
    node.addEventListener('pointerup', (e) => finish(e, false));
    node.addEventListener('pointercancel', (e) => finish(e, true));
    node.addEventListener('keydown', (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); api.setSelected(selected === p.id ? null : p.id, true); } });
  }

  search.addEventListener('input', () => { query = search.value.trim().toLowerCase(); render(); });

  const api = {
    el: wrap,
    setSelected(id, notify = false) {
      selected = id;
      list.querySelectorAll('.cm-card').forEach((c) => c.classList.toggle('sel', c.dataset.part === id));
      if (notify) onSelect(id);
    },
    get selected() { return selected; },
    // 남은 무게·비용: 넘치는 카드는 흐리게(그래도 선택은 가능 — 경고는 능력치 패널이 알려 준다)
    setBudget(b) { budget = { weightLeft: b.weightLeft ?? Infinity, costLeft: b.costLeft ?? Infinity }; render(); },
    setPresent(map) { present = map instanceof Map ? map : new Map(); render(); },
    showCategory(c) { if (cats.includes(c)) { cat = c; query = ''; search.value = ''; render(); } },
    destroy() { ghost?.remove(); wrap.remove(); },
  };
  render();
  return api;
}

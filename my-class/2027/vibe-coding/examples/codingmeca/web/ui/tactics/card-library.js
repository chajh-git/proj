// web/ui/tactics/card-library.js  (63번)
// 신경 연산실 왼쪽 카드 보관함: 조건 카드 / 동작 카드(채널별). (명세 14-4)
//   · 눌러서 고르거나(→ 규칙 보드의 빈 칸을 누르면 놓임) 끌어서 규칙 보드 위에 놓는다.
//   · 센서가 있어야 쓰는 카드는 잠겨 보인다(센서 파츠가 설계에 있으면 열린다).
//   const lib = createCardLibrary({ root, onSelect, onLocked, onDragStart, onDragMove, onDrop, onDragCancel });
//   lib.setDesign(design)      설계의 센서 정보로 잠금 갱신
//   lib.setSelected(payload|null)    payload = { kind:'condition'|'action', type }
//   lib.showTab('cond'|'move'|'weapon'|'defense'|'special')

import { CONDITION_DEFS, ACTION_DEFS, CHANNELS, CHANNEL_LABEL } from '../../../shared/tactics/schema.js';
import { designSensorInfo } from '../../../shared/tactics/validator.js';
import { SENSOR_LABEL } from './labels.js';
import { el, clear, ensureStyle } from '../dom.js';

const CSS = `
.cm-clib{display:flex;flex-direction:column;height:100%;min-height:0}
.cm-clib .top{padding:8px 10px;border-bottom:1px solid var(--cm-panelEdge)}
.cm-clib .adv{display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;color:var(--cm-textDim)}
.cm-clib .list{flex:1;min-height:0;padding:6px 10px 12px}
.cm-clib .grp{margin:12px 0 5px;font-size:11px;letter-spacing:.1em;color:var(--cm-textDim)}
.cm-ccard{position:relative;margin:5px 0;padding:7px 10px;border-radius:8px;border:1px solid var(--cm-panelEdge);background:rgba(255,255,255,.03);cursor:grab;user-select:none;touch-action:none}
.cm-ccard:hover{border-color:var(--cm-primary);background:rgba(255,255,255,.07)}
.cm-ccard.sel{border-color:var(--cm-primary);box-shadow:0 0 0 1px var(--cm-primary) inset;background:rgba(255,255,255,.1)}
.cm-ccard.cond{border-left:4px solid #6BD0FF}
.cm-ccard.act{border-left:4px solid #FFB020}
.cm-ccard.lock{opacity:.42;cursor:not-allowed}
.cm-ccard .nm{font-weight:600;display:flex;gap:6px;align-items:center}
.cm-ccard .nm em{margin-left:auto;font-style:normal;font-size:10px;color:var(--cm-textDim)}
.cm-ccard .ht{margin-top:2px;font-size:11px;color:var(--cm-textDim);line-height:1.4}
`;

const TABS = [['cond', '조건'], ...CHANNELS.map((c) => [c, CHANNEL_LABEL[c]])];

export function createCardLibrary({ root, onSelect = () => {}, onLocked = () => {}, onDragStart = () => {}, onDragMove = () => {}, onDrop = () => {}, onDragCancel = () => {} } = {}) {
  ensureStyle(CSS, 'cm-clib-style');
  const wrap = el('div', { class: 'cm-panel cm-clib' });
  const tabs = el('div', { class: 'cm-tabs' });
  const advBox = el('input', { type: 'checkbox', id: 'cm-clib-adv' });
  const top = el('div', { class: 'top' }, tabs, el('label', { class: 'adv', for: 'cm-clib-adv' }, advBox, '고급 카드 보이기'));
  const list = el('div', { class: 'list cm-scroll' });
  wrap.append(el('h3', {}, '카드 보관함'), top, list);
  root.append(wrap);

  let tab = 'cond';
  let info = null; // null = 설계를 모름 → 잠그지 않음
  let selected = null;
  let ghost = null;

  const lockedReason = (needs) => (needs && info && !info.has(needs) ? `${SENSOR_LABEL[needs] || needs} 센서가 필요합니다` : null);

  function makeCard(kind, type, def) {
    const reason = kind === 'condition' ? lockedReason(def.needs) : null;
    const advanced = kind === 'action' && def.level === 'advanced';
    const c = el('div', {
      class: `cm-ccard ${kind === 'condition' ? 'cond' : 'act'}${reason ? ' lock' : ''}${selected && selected.kind === kind && selected.type === type ? ' sel' : ''}`,
      'data-kind': kind, 'data-type': type, role: 'button', tabindex: 0, title: reason || '눌러서 선택, 끌어서 규칙 보드에 놓기',
    },
    el('div', { class: 'nm' }, def.label, reason ? el('em', {}, '🔒 센서') : advanced ? el('em', {}, '고급') : null),
    def.hint ? el('div', { class: 'ht' }, def.hint) : null,
    reason ? el('div', { class: 'ht' }, reason) : null);
    bindDrag(c, { kind, type }, reason);
    return c;
  }

  function render() {
    tabs.replaceChildren(...TABS.map(([id, label]) => el('button', { type: 'button', class: `cm-tab${id === tab ? ' on' : ''}`, onClick: () => { tab = id; render(); } }, label)));
    clear(list);
    if (tab === 'cond') {
      const groups = new Map();
      for (const [type, def] of Object.entries(CONDITION_DEFS)) {
        if (!groups.has(def.group)) groups.set(def.group, []);
        groups.get(def.group).push([type, def]);
      }
      for (const [g, items] of groups) {
        list.append(el('div', { class: 'grp' }, g));
        for (const [type, def] of items) list.append(makeCard('condition', type, def));
      }
    } else {
      const showAdv = advBox.checked;
      const items = Object.entries(ACTION_DEFS).filter(([, d]) => d.channels.includes(tab) && (showAdv || d.level !== 'advanced'));
      list.append(el('div', { class: 'grp' }, `${CHANNEL_LABEL[tab]} 동작`));
      for (const [type, def] of items) list.append(makeCard('action', type, def));
    }
  }

  function bindDrag(node, payload, locked) {
    let start = null;
    node.addEventListener('pointerdown', (e) => {
      if (e.button !== undefined && e.button !== 0) return;
      start = { x: e.clientX, y: e.clientY, dragging: false, id: e.pointerId };
      node.setPointerCapture?.(e.pointerId);
    });
    node.addEventListener('pointermove', (e) => {
      if (!start || e.pointerId !== start.id || locked) return;
      if (!start.dragging && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8) {
        start.dragging = true;
        ghost = el('div', { class: 'cm-ghost' }, node.querySelector('.nm').firstChild.textContent);
        document.body.append(ghost);
        onDragStart(payload);
      }
      if (start.dragging) {
        ghost.style.left = `${e.clientX}px`;
        ghost.style.top = `${e.clientY}px`;
        onDragMove(payload, e.clientX, e.clientY);
      }
    });
    const finish = (e, cancel) => {
      if (!start || e.pointerId !== start.id) return;
      const was = start;
      start = null;
      ghost?.remove();
      ghost = null;
      if (was.dragging) { cancel ? onDragCancel(payload) : onDrop(payload, e.clientX, e.clientY); }
      else if (!cancel) {
        if (locked) onLocked(locked);
        else api.setSelected(selected && selected.kind === payload.kind && selected.type === payload.type ? null : payload, true);
      }
    };
    node.addEventListener('pointerup', (e) => finish(e, false));
    node.addEventListener('pointercancel', (e) => finish(e, true));
    node.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter' && e.key !== ' ') return;
      e.preventDefault();
      if (locked) onLocked(locked); else api.setSelected(payload, true);
    });
  }

  advBox.addEventListener('change', render);

  const api = {
    el: wrap,
    setDesign(design) { info = design ? designSensorInfo(design) : null; render(); },
    setSelected(p, notify = false) {
      selected = p;
      list.querySelectorAll('.cm-ccard').forEach((c) => c.classList.toggle('sel', !!p && c.dataset.kind === p.kind && c.dataset.type === p.type));
      if (notify) onSelect(p);
    },
    get selected() { return selected; },
    showTab(t) { if (TABS.some(([id]) => id === t)) { tab = t; render(); } },
    get tab() { return tab; },
    destroy() { ghost?.remove(); wrap.remove(); },
  };
  render();
  return api;
}

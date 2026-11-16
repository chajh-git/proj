// web/ui/tactics/card-board.js  (64번)
// 신경 연산실 규칙 보드: 현재 태세의 규칙을 채널(이동·무장·방어·특수)별 줄로 보여 주고,
// 조건 카드·동작 카드를 놓아 규칙을 만든다. 태세 전환 규칙, 변수·타이머도 여기서 고친다. (명세 14-4)
//
//   const model = createTacticsModel(tactics);          // 전술 데이터 + 되돌리기 + 현재 태세
//   const board = createCardBoard({ root, model, onToast });
//   board.setDesign(design)                              // 파츠·센서 목록(선택지)과 경고 계산에 사용
//   board.setPending(payload|null)                       // 보관함에서 '눌러 고른' 카드 → 보드의 칸을 누르면 놓임
//   board.dragOver(x,y) / board.drop(payload,x,y) / board.dragEnd()   // 보관함에서 끌어 올 때
//   board.focusPath('stances[0].rules[2]')               // 검증 메시지 위치로 이동
//
// model: get() set(t) mutate(fn) undo() redo() on('change'|'stance') currentStance

import {
  CHANNELS, CHANNEL_LABEL, CONDITION_DEFS, ACTION_DEFS, TARGET_DEFS, OPS, OP_LABEL, COND_MODE_LABEL,
  emptyTactics, makeRule, makeStance, newCondition, newAction, newId, DEFAULT_TARGET,
} from '../../../shared/tactics/schema.js';
import { validateTactics } from '../../../shared/tactics/validator.js';
import { CONSTANTS } from '../../../config/constants.js';
import { PART_BY_ID } from '../../../data/parts.js';
import { PILOT_SKILLS } from '../../../data/pilot-skills.js';
import { PARAM_LABEL } from './labels.js';
import { el, clear, ensureStyle, emitter } from '../dom.js';

const L = CONSTANTS.tactics;
const clone = (o) => JSON.parse(JSON.stringify(o));

// 없는 변수·타이머·태세를 가리키는 조각을 정리한다 (삭제 뒤 남는 찌꺼기 방지)
export function scrubTactics(t) {
  const vars = new Set(t.variables.map((v) => v.id));
  const timers = new Set(t.timers.map((v) => v.id));
  const stances = new Set(t.stances.map((s) => s.id));
  const condOk = (c) => !((c.type === 'variable' && !vars.has(c.var)) || (c.type === 'timer_elapsed' && !timers.has(c.timer)));
  const actOk = (a) => !(((a.type === 'set_var' || a.type === 'add_var') && !vars.has(a.var)) || (a.type === 'start_timer' && !timers.has(a.timer)) || (a.type === 'switch_stance' && !stances.has(a.to)));
  for (const s of t.stances) {
    s.transitions = s.transitions.filter((tr) => stances.has(tr.to));
    for (const tr of s.transitions) tr.when.conditions = tr.when.conditions.filter(condOk);
    s.rules = s.rules.filter((r) => actOk(r.do));
    for (const r of s.rules) r.when.conditions = r.when.conditions.filter(condOk);
  }
  if (!stances.has(t.startStance)) t.startStance = t.stances[0]?.id;
  return t;
}

export function createTacticsModel(initial = emptyTactics()) {
  let t = clone(initial);
  const undoStack = [];
  const redoStack = [];
  const em = emitter();
  let cur = t.stances.some((s) => s.id === t.startStance) ? t.startStance : t.stances[0].id;
  const fixCur = () => { if (!t.stances.some((s) => s.id === cur)) cur = t.startStance; };
  const api = {
    get: () => t,
    set(next, { keepHistory = false } = {}) {
      t = clone(next);
      if (!keepHistory) { undoStack.length = 0; redoStack.length = 0; }
      fixCur();
      em.emit('change', t, 'set');
      em.emit('stance', cur);
    },
    mutate(fn) {
      undoStack.push(clone(t));
      if (undoStack.length > 60) undoStack.shift();
      redoStack.length = 0;
      const next = clone(t);
      fn(next);
      scrubTactics(next);
      t = next;
      const before = cur;
      fixCur();
      em.emit('change', t, 'mutate');
      if (cur !== before) em.emit('stance', cur);
    },
    undo() { if (!undoStack.length) return false; redoStack.push(clone(t)); t = undoStack.pop(); fixCur(); em.emit('change', t, 'undo'); em.emit('stance', cur); return true; },
    redo() { if (!redoStack.length) return false; undoStack.push(clone(t)); t = redoStack.pop(); fixCur(); em.emit('change', t, 'redo'); em.emit('stance', cur); return true; },
    get canUndo() { return undoStack.length > 0; },
    get canRedo() { return redoStack.length > 0; },
    get currentStance() { return cur; },
    set currentStance(id) { if (id !== cur && t.stances.some((s) => s.id === id)) { cur = id; em.emit('stance', cur); } },
    stance: () => t.stances.find((s) => s.id === cur),
    on: em.on,
  };
  return api;
}

const CSS = `
.cm-board{display:flex;flex-direction:column;height:100%;min-height:0}
.cm-board .head{display:flex;align-items:center;gap:8px;padding:8px 12px;border-bottom:1px solid var(--cm-panelEdge)}
.cm-board .head b{font-size:14px}
.cm-board .head .sp{flex:1}
.cm-board .body{flex:1;min-height:0;padding:8px 12px 18px}
.cm-board details.vt{margin:6px 0 10px;border:1px solid var(--cm-panelEdge);border-radius:8px;padding:6px 10px}
.cm-board details.vt summary{cursor:pointer;font-size:12px;color:var(--cm-textDim)}
.cm-board .vrow{display:flex;gap:6px;align-items:center;margin:5px 0;flex-wrap:wrap}
.cm-board .lane{margin:10px 0;border:1px dashed var(--cm-panelEdge);border-radius:10px;padding:6px 8px;transition:border-color .12s,background .12s}
.cm-board .lane.over,.cm-board .rule.over,.cm-board .slot.over{border-color:var(--cm-primary);background:rgba(255,255,255,.07)}
.cm-board.pending .lane,.cm-board.pending .rule,.cm-board.pending .tr{cursor:copy}
.cm-board .lane>h4{margin:0 0 4px;font-size:12px;letter-spacing:.08em;color:var(--cm-primary);display:flex;gap:8px;align-items:center}
.cm-board .lane>h4 small{color:var(--cm-textDim);font-weight:400;letter-spacing:0}
.cm-board .rule{display:flex;flex-wrap:wrap;gap:6px;align-items:center;margin:5px 0;padding:6px 8px;border-radius:8px;border:1px solid var(--cm-panelEdge);background:rgba(255,255,255,.03)}
.cm-board .rule.hl{box-shadow:0 0 0 2px var(--cm-primary)}
.cm-board .rule .no{font-size:11px;color:var(--cm-textDim);min-width:14px}
.cm-board .chip{display:inline-flex;align-items:center;gap:5px;padding:3px 7px;border-radius:7px;font-size:12px;border-left:4px solid #6BD0FF;background:rgba(107,208,255,.09)}
.cm-board .chip.act{border-left-color:#FFB020;background:rgba(255,176,32,.1)}
.cm-board .chip .x{cursor:pointer;color:var(--cm-textDim);padding:0 2px}
.cm-board .chip .x:hover{color:var(--cm-danger)}
.cm-board .chip select,.cm-board .chip input{font:inherit;font-size:12px;padding:2px 4px;border-radius:5px;border:1px solid var(--cm-panelEdge);background:rgba(0,0,0,.4);color:var(--cm-text);max-width:150px}
.cm-board .chip input[type=number]{width:62px}
.cm-board>.body select,.cm-board .rule>select{font:inherit;font-size:12px;padding:3px 5px;border-radius:6px;border:1px solid var(--cm-panelEdge);background:rgba(0,0,0,.4);color:var(--cm-text);max-width:160px}
.cm-board .chip .pl{position:relative}
.cm-board .pop{position:absolute;z-index:20;top:100%;left:0;min-width:150px;padding:6px 8px;border-radius:8px;background:var(--cm-panel);border:1px solid var(--cm-primary);box-shadow:0 6px 20px rgba(0,0,0,.5)}
.cm-board .pop label{display:flex;gap:6px;align-items:center;font-size:12px;padding:2px 0;white-space:nowrap}
.cm-board .slot{display:inline-flex;align-items:center;padding:3px 9px;border-radius:7px;border:1px dashed var(--cm-panelEdge);font-size:11px;color:var(--cm-textDim);cursor:pointer;background:transparent;font-family:inherit}
.cm-board .slot:hover{border-color:var(--cm-primary);color:var(--cm-primary)}
.cm-board .mode{font:inherit;font-size:11px;border:1px solid var(--cm-panelEdge);background:transparent;color:var(--cm-textDim);border-radius:999px;padding:1px 8px;cursor:pointer}
.cm-board .arrow{color:var(--cm-textDim)}
.cm-board .ops{margin-left:auto;display:flex;gap:2px}
.cm-board .ops button{font:inherit;border:none;background:transparent;color:var(--cm-textDim);cursor:pointer;padding:2px 5px;border-radius:5px}
.cm-board .ops button:hover:not(:disabled){color:var(--cm-primary);background:rgba(255,255,255,.08)}
.cm-board .ops button:disabled{opacity:.25;cursor:default}
.cm-board .warn{font-size:11px;color:var(--cm-warn,#FFB020);width:100%}
.cm-board .err{font-size:11px;color:var(--cm-danger);width:100%}
.cm-board .empty{font-size:12px;color:var(--cm-textDim);padding:4px 2px}
.cm-board .msgs{margin-bottom:6px}
.cm-board .tr{border-left:3px solid var(--cm-secondary,#FF2BD6)}
`;

// ── 값 하나를 고치는 작은 입력 ──────────────────────────────
function partChoices(design) {
  const ids = [...new Set((design?.parts || []).map((p) => p.part))];
  const list = ids.length ? ids : Object.keys(PART_BY_ID);
  return list.filter((id) => PART_BY_ID[id] && PART_BY_ID[id].category !== 'core' && PART_BY_ID[id].category !== 'structure').map((id) => [id, PART_BY_ID[id].name]);
}

function select(options, value, onChange) {
  const s = el('select', {}, options.map(([v, label]) => el('option', { value: v, selected: v === value }, label)));
  if (!options.some(([v]) => v === value)) s.prepend(el('option', { value: String(value), selected: true }, String(value)));
  s.addEventListener('change', () => onChange(s.value));
  return s;
}

function fieldEditor(spec, value, onChange, env, key) {
  switch (spec.kind) {
    case 'number': case 'index': {
      const i = el('input', { type: 'number', min: spec.min, max: spec.max, step: spec.step || 1, value });
      i.addEventListener('change', () => { const n = Number(i.value); onChange(Number.isFinite(n) ? Math.min(spec.max, Math.max(spec.min, n)) : spec.min); });
      return el('span', {}, i, spec.unit ? el('small', {}, spec.unit) : null);
    }
    case 'enum': return select(spec.options.map((o) => [o.id, o.label]), value, onChange);
    case 'bool': return select(key === 'on' ? [['true', '켜기'], ['false', '끄기']] : [['true', '예'], ['false', '아니오']], String(value), (v) => onChange(v === 'true'));
    case 'op': return select((spec.ops || OPS).map((o) => [o, OP_LABEL[o]]), value, onChange);
    case 'partId': return select(partChoices(env.design), value, onChange);
    case 'partIds': {
      const wrap = el('span', { class: 'pl' });
      const btn = el('button', { type: 'button', class: 'slot', style: { borderStyle: 'solid' } }, (value || []).length ? (value || []).map((id) => PART_BY_ID[id]?.name || id).join('·') : '전부');
      let pop = null;
      btn.addEventListener('click', (e) => {
        e.stopPropagation();
        if (pop) { pop.remove(); pop = null; return; }
        const chosen = new Set(value || []);
        pop = el('div', { class: 'pop' }, partChoices(env.design).map(([id, name]) => {
          const cb = el('input', { type: 'checkbox', checked: chosen.has(id) });
          cb.addEventListener('change', () => { cb.checked ? chosen.add(id) : chosen.delete(id); });
          return el('label', {}, cb, name);
        }), el('button', { type: 'button', class: 'cm-btn', style: { marginTop: '6px', width: '100%' }, onClick: () => { pop.remove(); pop = null; onChange([...chosen]); } }, '확인'));
        wrap.append(pop);
      });
      wrap.append(btn);
      return wrap;
    }
    case 'variable': return select(env.tactics.variables.map((v) => [v.id, v.name]), value, onChange);
    case 'timer': return select(env.tactics.timers.map((v) => [v.id, v.name]), value, onChange);
    case 'stance': return select(env.tactics.stances.map((v) => [v.id, v.name]), value, onChange);
    case 'selector': return select(Object.entries(TARGET_DEFS).filter(([id]) => id !== 'locked').map(([id, d]) => [id, d.label]), value, onChange);
    case 'skill': return select(Object.entries(PILOT_SKILLS).map(([id, s]) => [id, s.name]), value, onChange);
    default: return el('span', {}, String(value));
  }
}

function defaultOf(spec, key) {
  if (spec.kind === 'number' || spec.kind === 'index') return spec.min;
  if (spec.kind === 'enum') return spec.options[0].id;
  if (spec.kind === 'bool') return true;
  if (spec.kind === 'partIds') return [];
  if (spec.kind === 'op') return (spec.ops || OPS)[0];
  void key;
  return undefined;
}

export function createCardBoard({ root, model, onToast = () => {}, onFocusRule = () => {} } = {}) {
  ensureStyle(CSS, 'cm-board-style');
  const wrap = el('div', { class: 'cm-panel cm-board' });
  const head = el('div', { class: 'head' });
  const body = el('div', { class: 'body cm-scroll' });
  wrap.append(head, body);
  root.append(wrap);

  let design = null;
  let pending = null;
  let hlPath = null;

  const env = () => ({ design, tactics: model.get() });
  const stanceIndex = () => model.get().stances.findIndex((s) => s.id === model.currentStance);

  // ── 놓기 ────────────────────────────────────────────────
  function dropInfo(node) {
    const d = node?.closest?.('[data-drop]');
    if (!d || !body.contains(d)) return null;
    return { node: d, drop: d.dataset.drop, channel: d.dataset.channel, ri: d.dataset.ri != null ? Number(d.dataset.ri) : null };
  }

  function place(payload, info) {
    const si = stanceIndex();
    if (payload.kind === 'condition') {
      if (!info || (info.drop !== 'rule' && info.drop !== 'tr')) { onToast('조건 카드는 규칙 위에 놓으세요'); return false; }
      const list = info.drop === 'rule' ? model.get().stances[si].rules : model.get().stances[si].transitions;
      if (list[info.ri].when.conditions.length >= L.maxConditionsPerRule) { onToast(`조건은 한 규칙에 ${L.maxConditionsPerRule}개까지입니다`); return false; }
      model.mutate((t) => {
        const r = (info.drop === 'rule' ? t.stances[si].rules : t.stances[si].transitions)[info.ri];
        r.when.conditions.push(newCondition(payload.type));
      });
      return true;
    }
    // 동작 카드
    const def = ACTION_DEFS[payload.type];
    if (info && info.drop === 'rule') {
      const rule = model.get().stances[si].rules[info.ri];
      if (def.channels.includes(rule.channel)) {
        model.mutate((t) => { t.stances[si].rules[info.ri].do = newAction(payload.type); });
        return true;
      }
    }
    const channel = info && info.drop === 'lane' && def.channels.includes(info.channel) ? info.channel : def.channels.includes(payload.channel) ? payload.channel : def.channels[0];
    if (info && info.drop === 'lane' && !def.channels.includes(info.channel)) {
      onToast(`‘${def.label}’은(는) ${def.channels.map((c) => CHANNEL_LABEL[c]).join('·')} 줄에 놓을 수 있습니다`);
      return false;
    }
    if (model.get().stances[si].rules.length >= L.maxRulesPerStance) { onToast(`규칙은 태세마다 ${L.maxRulesPerStance}개까지입니다`); return false; }
    model.mutate((t) => { t.stances[si].rules.push(makeRule(channel, null, newAction(payload.type))); });
    return true;
  }

  function addTransition() {
    const si = stanceIndex();
    const t0 = model.get();
    const s = t0.stances[si];
    if (s.transitions.length >= L.maxTransitionsPerStance) return onToast(`전환 규칙은 태세마다 ${L.maxTransitionsPerStance}개까지입니다`);
    const other = t0.stances.find((x) => x.id !== s.id);
    if (!other) return onToast('먼저 태세를 하나 더 만드세요 (태세 지도)');
    model.mutate((t) => { t.stances[si].transitions.push({ when: { mode: 'all', conditions: [] }, to: other.id }); });
  }

  // ── 조각 그리기 ─────────────────────────────────────────
  function condChip(c, onChange, onRemove) {
    const def = CONDITION_DEFS[c.type];
    const chip = el('span', { class: 'chip' }, el('b', {}, def.label));
    for (const f of def.fields) {
      const lab = PARAM_LABEL[f.key];
      if (lab) chip.append(el('small', {}, lab));
      chip.append(fieldEditor(f.spec, c[f.key], (v) => onChange({ ...c, [f.key]: v }), env(), f.key));
    }
    chip.append(el('span', { class: 'x', title: '조건 빼기', onClick: (e) => { e.stopPropagation(); onRemove(); } }, '✕'));
    return chip;
  }

  function whenBlock(when, setWhen) {
    const box = el('span', { class: 'cm-row', style: { flexWrap: 'wrap', gap: '5px' } });
    if (!when.conditions.length) box.append(el('span', { class: 'chip', style: { borderLeftColor: '#888', background: 'rgba(255,255,255,.05)' } }, '항상'));
    when.conditions.forEach((c, i) => {
      if (i > 0) box.append(el('button', { type: 'button', class: 'mode', title: '눌러서 바꾸기', onClick: (e) => { e.stopPropagation(); setWhen({ ...when, mode: when.mode === 'all' ? 'any' : 'all' }); } }, when.mode === 'all' ? '그리고' : '또는'));
      box.append(condChip(c, (nc) => setWhen({ ...when, conditions: when.conditions.map((x, j) => (j === i ? nc : x)) }), () => setWhen({ ...when, conditions: when.conditions.filter((_, j) => j !== i) })));
    });
    if (when.conditions.length > 1) box.append(el('small', { style: { color: 'var(--cm-textDim)' } }, `(${COND_MODE_LABEL[when.mode]})`));
    return box;
  }

  function actionChip(a, onChange, channel) {
    const def = ACTION_DEFS[a.type];
    const chip = el('span', { class: 'chip act' }, el('b', {}, def.label));
    for (const p of def.params) {
      if (p.when && Object.entries(p.when).some(([k, v]) => a[k] !== v)) continue;
      const has = a[p.key] !== undefined;
      const lab = PARAM_LABEL[p.key];
      if (p.optional && !has) {
        chip.append(el('button', { type: 'button', class: 'slot', onClick: (e) => { e.stopPropagation(); onChange({ ...a, [p.key]: defaultOf(p.spec, p.key) ?? (p.key === 'part' ? partChoices(design)[0]?.[0] : undefined) }); } }, `＋${lab || '옵션'}`));
        continue;
      }
      if (lab) chip.append(el('small', {}, lab));
      chip.append(fieldEditor(p.spec, a[p.key], (v) => onChange({ ...a, [p.key]: v }), env(), p.key));
      if (p.optional) chip.append(el('span', { class: 'x', title: '옵션 빼기', onClick: (e) => { e.stopPropagation(); const n = { ...a }; delete n[p.key]; onChange(n); } }, '✕'));
    }
    void channel;
    return chip;
  }

  function opsButtons(i, n, onMove, onDel) {
    return el('span', { class: 'ops' },
      el('button', { type: 'button', title: '위로 (먼저 확인)', disabled: i === 0, onClick: (e) => { e.stopPropagation(); onMove(-1); } }, '▲'),
      el('button', { type: 'button', title: '아래로', disabled: i === n - 1, onClick: (e) => { e.stopPropagation(); onMove(1); } }, '▼'),
      el('button', { type: 'button', title: '지우기', onClick: (e) => { e.stopPropagation(); onDel(); } }, '🗑'));
  }

  function issuesFor(result, path) {
    return [...result.errors.map((m) => ['err', m]), ...result.warnings.map((m) => ['warn', m])].filter(([, m]) => m.path === path || m.path.startsWith(`${path}.`) || m.path.startsWith(`${path}[`));
  }

  function renderVarsTimers(t) {
    const d = el('details', { class: 'vt' }, el('summary', {}, `변수 ${t.variables.length}/${L.maxVariables} · 타이머 ${t.timers.length}/${L.maxTimers}`));
    t.variables.forEach((v, i) => {
      const name = el('input', { class: 'cm-input', value: v.name, maxlength: L.maxNameLength, style: { width: '110px' }, 'aria-label': '변수 이름' });
      name.addEventListener('change', () => model.mutate((x) => { x.variables[i].name = name.value.trim() || v.name; }));
      const init = el('input', { class: 'cm-input', type: 'number', value: v.init, style: { width: '70px' }, 'aria-label': '시작값' });
      init.addEventListener('change', () => model.mutate((x) => { x.variables[i].init = Math.max(-999, Math.min(999, Number(init.value) || 0)); }));
      d.append(el('div', { class: 'vrow' }, el('span', { class: 'cm-chip' }, '변수'), name, el('small', {}, '시작값'), init, el('button', { type: 'button', class: 'cm-btn', onClick: () => model.mutate((x) => { x.variables.splice(i, 1); }) }, '삭제')));
    });
    t.timers.forEach((v, i) => {
      const name = el('input', { class: 'cm-input', value: v.name, maxlength: L.maxNameLength, style: { width: '110px' }, 'aria-label': '타이머 이름' });
      name.addEventListener('change', () => model.mutate((x) => { x.timers[i].name = name.value.trim() || v.name; }));
      d.append(el('div', { class: 'vrow' }, el('span', { class: 'cm-chip' }, '타이머'), name, el('button', { type: 'button', class: 'cm-btn', onClick: () => model.mutate((x) => { x.timers.splice(i, 1); }) }, '삭제')));
    });
    d.append(el('div', { class: 'vrow' },
      el('button', { type: 'button', class: 'cm-btn', disabled: t.variables.length >= L.maxVariables, onClick: () => model.mutate((x) => { const id = newId('v', x.variables.map((q) => q.id)); x.variables.push({ id, name: `변수${x.variables.length + 1}`, init: 0, min: -999, max: 999 }); }) }, '＋ 변수'),
      el('button', { type: 'button', class: 'cm-btn', disabled: t.timers.length >= L.maxTimers, onClick: () => model.mutate((x) => { const id = newId('t', x.timers.map((q) => q.id)); x.timers.push({ id, name: `타이머${x.timers.length + 1}` }); }) }, '＋ 타이머')));
    if (t.variables.length || t.timers.length) d.open = true;
    return d;
  }

  function render() {
    const t = model.get();
    const si = stanceIndex();
    const s = t.stances[si];
    const result = validateTactics(t, { design });
    clear(head);
    head.append(el('b', {}, s.name), ...(s.id === t.startStance ? [el('span', { class: 'cm-chip' }, '시작 태세')] : []), el('span', { class: 'sp' }),
      el('button', { type: 'button', class: 'cm-btn', disabled: !model.canUndo, onClick: () => model.undo(), title: 'Ctrl+Z' }, '↶'),
      el('button', { type: 'button', class: 'cm-btn', disabled: !model.canRedo, onClick: () => model.redo(), title: 'Ctrl+Y' }, '↷'));
    clear(body);
    wrap.classList.toggle('pending', !!pending);

    // 검증 메시지
    const msgs = el('div', { class: 'msgs' });
    for (const m of result.errors) msgs.append(el('div', { class: 'cm-msg error', onClick: () => api.focusPath(m.path) }, m.message));
    for (const m of result.warnings) msgs.append(el('div', { class: 'cm-msg warning', onClick: () => api.focusPath(m.path) }, m.message));
    if (msgs.children.length) body.append(msgs);

    body.append(renderVarsTimers(t));

    // 채널별 줄
    for (const ch of CHANNELS) {
      const idxs = s.rules.map((r, i) => [r, i]).filter(([r]) => r.channel === ch);
      const lane = el('div', { class: 'lane', 'data-drop': 'lane', 'data-channel': ch },
        el('h4', {}, CHANNEL_LABEL[ch], el('small', {}, idxs.length ? '위에 있는 규칙부터 확인합니다' : '동작 카드를 여기에 놓으세요')));
      for (const [r, i] of idxs) {
        const path = `stances[${si}].rules[${i}]`;
        const iss = issuesFor(result, path);
        const row = el('div', { class: `rule${hlPath === path ? ' hl' : ''}`, 'data-drop': 'rule', 'data-ri': i, 'data-path': path },
          el('span', { class: 'no' }, idxs.findIndex(([, j]) => j === i) + 1),
          el('small', {}, '만약'),
          whenBlock(r.when, (w) => model.mutate((x) => { x.stances[si].rules[i].when = w; })),
          el('button', { type: 'button', class: 'slot', title: '조건 카드를 고른 뒤 누르면 추가됩니다', 'data-drop': 'rule', 'data-ri': i, onClick: () => { if (!pending) onToast('왼쪽 보관함에서 조건 카드를 고르거나 끌어다 놓으세요'); } }, '＋조건'),
          el('span', { class: 'arrow' }, '→'),
          actionChip(r.do, (a) => model.mutate((x) => { x.stances[si].rules[i].do = a; }), ch));
        if (ch === 'move' || ch === 'weapon') {
          row.append(el('small', {}, '대상'), select(Object.entries(TARGET_DEFS).map(([id, d]) => [id, d.label]), r.target || DEFAULT_TARGET, (v) => model.mutate((x) => { x.stances[si].rules[i].target = v; })));
        }
        row.append(opsButtons(i, s.rules.length,
          (dir) => model.mutate((x) => {
            // 같은 채널 안에서만 순서를 바꾼다
            const rules = x.stances[si].rules;
            let j = i + dir;
            while (j >= 0 && j < rules.length && rules[j].channel !== ch) j += dir;
            if (j < 0 || j >= rules.length) return;
            [rules[i], rules[j]] = [rules[j], rules[i]];
          }),
          () => model.mutate((x) => { x.stances[si].rules.splice(i, 1); })));
        for (const [lv, m] of iss) row.append(el('div', { class: lv }, m.message));
        lane.append(row);
      }
      body.append(lane);
    }

    // 전환 규칙
    const trLane = el('div', { class: 'lane', 'data-drop': 'trlane' },
      el('h4', {}, '태세 전환', el('small', {}, '조건이 맞으면 다른 태세로 바뀝니다 (위에서부터 확인)')));
    s.transitions.forEach((tr, i) => {
      const path = `stances[${si}].transitions[${i}]`;
      const row = el('div', { class: `rule tr${hlPath === path ? ' hl' : ''}`, 'data-drop': 'tr', 'data-ri': i, 'data-path': path },
        el('small', {}, '만약'),
        whenBlock(tr.when, (w) => model.mutate((x) => { x.stances[si].transitions[i].when = w; })),
        el('button', { type: 'button', class: 'slot', 'data-drop': 'tr', 'data-ri': i, onClick: () => { if (!pending) onToast('왼쪽 보관함에서 조건 카드를 고르거나 끌어다 놓으세요'); } }, '＋조건'),
        el('span', { class: 'arrow' }, '→'),
        select(t.stances.map((q) => [q.id, q.name]), tr.to, (v) => model.mutate((x) => { x.stances[si].transitions[i].to = v; })),
        el('small', {}, '태세로'),
        opsButtons(i, s.transitions.length,
          (dir) => model.mutate((x) => { const a = x.stances[si].transitions; [a[i], a[i + dir]] = [a[i + dir], a[i]]; }),
          () => model.mutate((x) => { x.stances[si].transitions.splice(i, 1); })));
      for (const [lv, m] of issuesFor(result, path)) row.append(el('div', { class: lv }, m.message));
      trLane.append(row);
    });
    trLane.append(el('button', { type: 'button', class: 'cm-btn', disabled: s.transitions.length >= L.maxTransitionsPerStance, onClick: addTransition }, '＋ 전환 규칙'));
    body.append(trLane);
  }

  // ── 상호작용 ────────────────────────────────────────────
  // 눌러 고른 카드 놓기: 입력칸·버튼이 아닌 곳을 누르면 그 줄/규칙에 놓인다
  body.addEventListener('click', (e) => {
    if (!pending) return;
    if (e.target.closest('select,input,.x,.ops,.mode,details,summary,.cm-btn')) return;
    const slotBtn = e.target.closest('button.slot');
    const info = dropInfo(slotBtn || e.target);
    if (!info || info.drop === 'trlane') return;
    if (place(pending, info)) onPlaced?.();
  });
  let onPlaced = null;

  // 입력칸 밖을 누르면 열려 있는 파츠 선택 창 닫기
  document.addEventListener('click', onDocClick);
  function onDocClick(e) { if (!e.target.closest?.('.pop')) wrap.querySelectorAll('.pop').forEach((p) => p.remove()); }

  const off1 = model.on('change', render);
  const off2 = model.on('stance', render);

  const api = {
    el: wrap,
    render,
    setDesign(d) { design = d; render(); },
    setPending(p) { pending = p; wrap.classList.toggle('pending', !!p); },
    onPlaced(fn) { onPlaced = fn; },
    dragOver(x, y) {
      wrap.querySelectorAll('.over').forEach((n) => n.classList.remove('over'));
      const info = dropInfo(document.elementFromPoint(x, y));
      if (info) info.node.classList.add('over');
    },
    dragEnd() { wrap.querySelectorAll('.over').forEach((n) => n.classList.remove('over')); },
    // 끌어서 놓기. 보드 밖이면 false
    drop(payload, x, y) {
      api.dragEnd();
      const hit = document.elementFromPoint(x, y);
      if (!hit || !wrap.contains(hit)) return false;
      return place(payload, dropInfo(hit));
    },
    // 보드 한가운데 동작을 곧바로 추가 (버튼용)
    addAction(type, channel) { return place({ kind: 'action', type, channel }, null); },
    focusPath(path) {
      const m = /^stances\[(\d+)\]/.exec(path || '');
      if (m) {
        const id = model.get().stances[Number(m[1])]?.id;
        if (id) model.currentStance = id;
      }
      const base = (path || '').match(/^stances\[\d+\]\.(rules|transitions)\[\d+\]/)?.[0];
      hlPath = base || null;
      render();
      const n = base && body.querySelector(`[data-path="${base}"]`);
      n?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
      if (base) { onFocusRule(base); setTimeout(() => { hlPath = null; render(); }, 1600); }
    },
    destroy() { off1(); off2(); document.removeEventListener('click', onDocClick); wrap.remove(); },
  };
  render();
  return api;
}

export { makeStance };

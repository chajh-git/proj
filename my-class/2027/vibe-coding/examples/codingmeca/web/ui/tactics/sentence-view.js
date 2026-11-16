// web/ui/tactics/sentence-view.js  (66번)
// 문장 보기: 카드로 짠 전술을 "만약 …이면 …한다" 문장으로 읽는다. 같은 데이터를 다르게 보여 줄 뿐, 편집은 하지 않는다. (명세 14-4)
//   tacticsToSentences(tactics, design) → [{ id, name, isStart, rules:[{channel, text}], transitions:[text] }]   (순수 함수)
//   createSentenceView({ root }).update(tactics, design)                                                       (화면)

import { CHANNELS, CHANNEL_LABEL, CONDITION_DEFS, ACTION_DEFS, TARGET_DEFS, OP_LABEL } from '../../../shared/tactics/schema.js';
import { PILOT_SKILLS } from '../../../data/pilot-skills.js';
import { PART_BY_ID } from '../../../data/parts.js';
import { el, clear, ensureStyle } from '../dom.js';

// 받침 유무에 따라 이/가, 은/는, 을/를 붙이기
export function josa(word, pair) {
  const w = String(word);
  const ch = w.charCodeAt(w.length - 1);
  let has = false;
  if (ch >= 0xac00 && ch <= 0xd7a3) has = (ch - 0xac00) % 28 !== 0;
  else has = /[0136-8lmnLMN]$/.test(w); // 숫자·영문은 대략적으로 읽는 소리 기준
  const [a, b] = pair.split('/');
  return w + (has ? a : b);
}

// '내 체력 %' → '내 체력' (값 뒤에 단위가 따로 붙으므로)
const bare = (label) => label.replace(/\s*%$/, '').replace(/\(m\)$/, '').trim();

function nameOf(ctx, kind, id) {
  if (kind === 'variable') return ctx.variables.find((v) => v.id === id)?.name || id;
  if (kind === 'timer') return ctx.timers.find((t) => t.id === id)?.name || id;
  if (kind === 'stance') return ctx.stances.find((s) => s.id === id)?.name || id;
  if (kind === 'skill') return PILOT_SKILLS[id]?.name || id;
  if (kind === 'selector') return TARGET_DEFS[id]?.label || id;
  if (kind === 'partId') return PART_BY_ID[id]?.name || id;
  return id;
}

function valueText(spec, v, ctx) {
  switch (spec.kind) {
    case 'number': return `${v}${spec.unit || ''}`;
    case 'enum': return spec.options.find((o) => o.id === v)?.label ?? String(v);
    case 'bool': return v ? '켜짐' : '꺼짐';
    case 'op': return OP_LABEL[v] || v;
    case 'index': return `${v}번`;
    case 'partIds': return (v || []).length ? v.map((id) => nameOf(ctx, 'partId', id)).join('·') : '전부';
    default: return nameOf(ctx, spec.kind, v);
  }
}

export function describeCondition(c, ctx) {
  const def = CONDITION_DEFS[c.type];
  if (!def) return `알 수 없는 조건(${c.type})`;
  const f = Object.fromEntries(def.fields.map((fd) => [fd.key, fd]));
  const val = (key) => valueText(f[key].spec, c[key], ctx);
  const op = c.op ? OP_LABEL[c.op] : null;
  const label = bare(def.label);

  switch (c.type) {
    case 'part_state': return c.op === '!=' ? `${josa(nameOf(ctx, 'partId', c.part), '이/가')} ${josa(val('state'), '이/가')} 아님` : `${josa(nameOf(ctx, 'partId', c.part), '이/가')} ${val('state')} 상태`;
    case 'part_ammo': return `${nameOf(ctx, 'partId', c.part)} 탄수 ${c.value} ${op}`;
    case 'timer_elapsed': return `타이머 ‘${nameOf(ctx, 'timer', c.timer)}’ 경과 ${c.value}초 ${op}`;
    case 'variable': return `변수 ‘${nameOf(ctx, 'variable', c.var)}’ ${c.value} ${op}`;
    case 'shared_var': return `팀 공유 변수 ${c.index}번 ${c.value} ${op}`;
    case 'event_warning': return `전장 이벤트 예고(${val('event')})`;
    case 'in_hazard': return c.value ? '위험구역 안에 있음' : '위험구역 밖에 있음';
    default: break;
  }
  if (c.value !== undefined && c.op) {
    if (def.fields.find((x) => x.key === 'value')?.spec.kind === 'enum') return c.op === '!=' ? `${josa(label, '이/가')} ${josa(val('value'), '이/가')} 아님` : `${josa(label, '이/가')} ${val('value')}`;
    return `${label} ${val('value')} ${op}`;
  }
  if (c.value !== undefined) return c.value ? label : `${label} 아님`;
  return label;
}

export function describeAction(a, ctx) {
  const def = ACTION_DEFS[a.type];
  if (!def) return `알 수 없는 동작(${a.type})`;
  const extra = [];
  for (const p of def.params) {
    if (a[p.key] === undefined || a[p.key] === null) continue;
    if (p.when && Object.entries(p.when).some(([k, v]) => a[k] !== v)) continue;
    if (p.key === 'on') { extra.push(a.on ? '켜기' : '끄기'); continue; }
    const txt = valueText(p.spec, a[p.key], ctx);
    extra.push(p.key === 'pct' ? `${a.pct}%` : txt);
  }
  return extra.length ? `${def.label}(${extra.join(', ')})` : def.label;
}

// 반환: '조건들' + 이어지는 말('이면'/'아니면'), 조건이 없으면 null
function whenText(when, ctx) {
  const list = (when?.conditions || []).map((c) => describeCondition(c, ctx));
  if (!list.length) return null;
  const joined = list.join(when.mode === 'any' ? ' 또는 ' : ' 그리고 ');
  return joined.endsWith('아님') ? `${joined.slice(0, -2)}아니면` : `${joined}이면`;
}

export function tacticsToSentences(tactics, design = null) {
  void design;
  const ctx = { variables: tactics.variables || [], timers: tactics.timers || [], stances: tactics.stances || [] };
  return (tactics.stances || []).map((s) => ({
    id: s.id,
    name: s.name,
    isStart: s.id === tactics.startStance,
    rules: (s.rules || []).map((r) => {
      const cond = whenText(r.when, ctx);
      const act = describeAction(r.do, ctx);
      const tgt = ['move', 'weapon'].includes(r.channel) && r.target && r.target !== 'current' ? ` [대상: ${nameOf(ctx, 'selector', r.target)}]` : '';
      return { channel: r.channel, text: cond ? `만약 ${cond} ${act}${tgt}` : `항상 ${act}${tgt}` };
    }),
    transitions: (s.transitions || []).map((t) => {
      const cond = whenText(t.when, ctx);
      return `${cond ? `만약 ${cond}` : '항상'} ‘${nameOf(ctx, 'stance', t.to)}’ 태세로 바꾼다`;
    }),
  }));
}

const CSS = `
.cm-sent{padding:10px 12px;overflow:auto;max-height:100%}
.cm-sent .st{margin-bottom:14px}
.cm-sent .st h4{margin:0 0 6px;font-size:14px;color:var(--cm-primary)}
.cm-sent .st h4 span{font-size:11px;color:var(--cm-textDim);margin-left:6px}
.cm-sent .ln{margin:4px 0;padding:5px 8px;border-radius:6px;background:rgba(255,255,255,.04);font-size:13px;line-height:1.5}
.cm-sent .ln b{display:inline-block;min-width:34px;margin-right:6px;font-size:11px;color:var(--cm-bg);background:var(--cm-primary);border-radius:4px;padding:0 5px;text-align:center}
.cm-sent .ln.tr{border-left:3px solid var(--cm-secondary,var(--cm-primary))}
.cm-sent .none{color:var(--cm-textDim);font-size:12px}
`;

export function createSentenceView({ root } = {}) {
  ensureStyle(CSS, 'cm-sent-style');
  const wrap = el('div', { class: 'cm-panel cm-sent' });
  root.append(wrap);
  return {
    el: wrap,
    update(tactics, design = null) {
      clear(wrap);
      wrap.append(el('h3', { style: { margin: '-10px -12px 10px' } }, '문장으로 보기'));
      for (const s of tacticsToSentences(tactics, design)) {
        const box = el('div', { class: 'st' }, el('h4', {}, s.name, el('span', {}, s.isStart ? '시작 태세' : '')));
        if (!s.rules.length && !s.transitions.length) box.append(el('div', { class: 'none' }, '규칙이 없습니다'));
        for (const r of s.rules) box.append(el('div', { class: 'ln' }, el('b', {}, CHANNEL_LABEL[r.channel] || r.channel), r.text));
        for (const t of s.transitions) box.append(el('div', { class: 'ln tr' }, el('b', {}, '전환'), t));
        wrap.append(box);
      }
    },
    show(on) { wrap.style.display = on ? '' : 'none'; },
    destroy() { wrap.remove(); },
  };
}

export { CHANNELS };

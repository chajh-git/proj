// shared/tactics/validator.js  (21번)
// 전술 검증과 정리. 저장 때는 validateTactics로 문제를 알려주고,
// 서버가 경기를 시작할 때는 sanitizeTactics로 '위반 규칙은 무시'합니다 (명세 11-7).
// 화면 코드를 import하지 않습니다.
//
// 결과 항목: { level: 'error'|'warning', code, path, message }
//   error   → 서버가 그 규칙/전환/태세를 무시한다 (또는 숫자를 범위로 맞춘다)
//   warning → 동작은 하지만 알려줄 것 (센서 없음, 도달 불가 규칙 등)

import { CONSTANTS } from '../../config/constants.js';
import { findForbidden } from '../../config/names.js';
import { PART_BY_ID } from '../../data/parts.js';
import { PILOT_SKILLS } from '../../data/pilot-skills.js';
import { clamp } from '../util/math.js';
import {
  CHANNELS, COND_MODES, OPS, ENUM_OPS, CONDITION_DEFS, ACTION_DEFS, TARGET_IDS, TARGET_DEFS,
  DEFAULT_TARGET, emptyTactics, conditionNeeds,
} from './schema.js';

const item = (level, code, path, message) => ({ level, code, path, message });
const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);

// 설계가 가진 센서 정보 키 (센서 파츠의 info 합집합)
export function designSensorInfo(design) {
  const info = new Set();
  for (const p of design?.parts || []) {
    const def = PART_BY_ID[p.part];
    if (def?.category === 'sensor') (def.info || []).forEach((k) => info.add(k));
  }
  return info;
}

export const designPartIds = (design) => new Set((design?.parts || []).map((p) => p.part));

// ── 값 하나 검사·보정 ───────────────────────────────────
// 반환: { value, issue?: string }
function checkValue(spec, raw, ctx) {
  switch (spec.kind) {
    case 'number': {
      if (typeof raw !== 'number' || !Number.isFinite(raw)) return { issue: '숫자가 아닙니다' };
      return { value: clamp(raw, spec.min, spec.max) };
    }
    case 'index': {
      if (!Number.isInteger(raw)) return { issue: '정수가 아닙니다' };
      return { value: clamp(raw, spec.min, spec.max) };
    }
    case 'bool':
      return typeof raw === 'boolean' ? { value: raw } : { issue: '참/거짓이 아닙니다' };
    case 'op': {
      const ops = spec.ops || OPS;
      return ops.includes(raw) ? { value: raw } : { issue: `허용되지 않는 연산자: ${raw}` };
    }
    case 'enum':
      return spec.options.some((o) => o.id === raw) ? { value: raw } : { issue: `허용되지 않는 값: ${raw}` };
    case 'partId':
      return typeof raw === 'string' && PART_BY_ID[raw] ? { value: raw } : { issue: `알 수 없는 파츠: ${raw}` };
    case 'partIds':
      if (!Array.isArray(raw) || raw.length > 12) return { issue: '파츠 목록이 올바르지 않습니다' };
      if (!raw.every((p) => typeof p === 'string' && PART_BY_ID[p])) return { issue: '알 수 없는 파츠가 들어 있습니다' };
      return { value: [...new Set(raw)] };
    case 'variable':
      return ctx.varIds.has(raw) ? { value: raw } : { issue: `없는 변수: ${raw}` };
    case 'timer':
      return ctx.timerIds.has(raw) ? { value: raw } : { issue: `없는 타이머: ${raw}` };
    case 'stance':
      return ctx.stanceIds.has(raw) ? { value: raw } : { issue: `없는 태세: ${raw}` };
    case 'selector':
      return TARGET_IDS.includes(raw) && raw !== 'locked' ? { value: raw } : { issue: `허용되지 않는 선택자: ${raw}` };
    case 'skill':
      return PILOT_SKILLS[raw] ? { value: raw } : { issue: `알 수 없는 각성기: ${raw}` };
    default:
      return { issue: `알 수 없는 형식: ${spec.kind}` };
  }
}

// 필드 묶음 검사 → { ok, out, issues }
function checkFields(defFields, source, ctx) {
  const out = {};
  const issues = [];
  for (const f of defFields) {
    // 조건부 필드: when 키가 맞지 않으면 건너뜀 (예: face가 part일 때만 part 필요)
    if (f.when && !Object.entries(f.when).every(([k, v]) => source[k] === v)) continue;
    const raw = source[f.key];
    if (raw === undefined || raw === null) {
      if (f.optional) continue;
      if (f.default !== undefined) {
        out[f.key] = f.default;
        continue;
      }
      issues.push(`${f.key} 값이 없습니다`);
      continue;
    }
    const r = checkValue(f.spec, raw, ctx);
    if (r.issue) issues.push(`${f.key}: ${r.issue}`);
    else out[f.key] = r.value;
  }
  return { ok: issues.length === 0, out, issues };
}

function checkName(name, path, limit, out, label) {
  if (typeof name !== 'string' || !name.trim()) {
    out.push(item('error', 'no_name', path, `${label} 이름이 없습니다`));
    return null;
  }
  if (findForbidden(name).length) {
    out.push(item('error', 'forbidden_word', path, '사용할 수 없는 단어가 들어 있습니다'));
    return null;
  }
  if (name.length > limit) out.push(item('warning', 'name_cut', path, `이름은 ${limit}자까지만 쓰입니다`));
  return name.slice(0, limit);
}

// ── 조건식 ──────────────────────────────────────────────
function checkWhen(when, path, ctx, issuesOut) {
  if (!isObj(when)) {
    issuesOut.push(item('error', 'bad_when', path, '조건식이 올바르지 않습니다'));
    return null;
  }
  const L = ctx.limits;
  const mode = when.mode ?? 'all';
  if (!COND_MODES.includes(mode)) {
    issuesOut.push(item('error', 'bad_mode', path, `조건 결합 방식이 올바르지 않습니다: ${mode}`));
    return null;
  }
  const list = Array.isArray(when.conditions) ? when.conditions : null;
  if (!list) {
    issuesOut.push(item('error', 'bad_when', path, '조건 목록이 없습니다'));
    return null;
  }
  if (list.length > L.maxConditionsPerRule) {
    issuesOut.push(item('error', 'too_many_conditions', path, `조건은 규칙 하나에 ${L.maxConditionsPerRule}개까지입니다`));
    return null;
  }
  const conditions = [];
  for (const [i, c] of list.entries()) {
    const p = `${path}.conditions[${i}]`;
    const def = CONDITION_DEFS[c?.type];
    if (!def) {
      issuesOut.push(item('error', 'unknown_condition', p, `알 수 없는 조건: ${c?.type}`));
      return null;
    }
    const r = checkFields(def.fields, c, ctx);
    if (!r.ok) {
      issuesOut.push(item('error', 'bad_condition', p, `${def.label}: ${r.issues.join(', ')}`));
      return null;
    }
    const need = conditionNeeds(c);
    if (need && ctx.info && !ctx.info.has(need)) {
      issuesOut.push(item('warning', 'sensor_missing', p, `${def.label} 조건은 필요한 센서가 없어 항상 거짓으로 처리됩니다`));
    }
    if (c.part && ctx.partIds && !ctx.partIds.has(c.part)) {
      issuesOut.push(item('warning', 'part_not_in_design', p, `${PART_BY_ID[c.part]?.name ?? c.part}이(가) 이 설계에 없습니다`));
    }
    conditions.push({ type: c.type, ...r.out });
  }
  return { mode, conditions };
}

// ── 동작 ────────────────────────────────────────────────
function checkAction(action, channel, path, ctx, issuesOut) {
  const def = ACTION_DEFS[action?.type];
  if (!def) {
    issuesOut.push(item('error', 'unknown_action', path, `알 수 없는 동작: ${action?.type}`));
    return null;
  }
  if (channel && !def.channels.includes(channel)) {
    issuesOut.push(item('error', 'wrong_channel', path, `${def.label}은(는) ${channel} 채널에 둘 수 없습니다`));
    return null;
  }
  const r = checkFields(def.params, action, ctx);
  if (!r.ok) {
    issuesOut.push(item('error', 'bad_action', path, `${def.label}: ${r.issues.join(', ')}`));
    return null;
  }
  const refs = [...(r.out.parts || []), ...(r.out.part ? [r.out.part] : [])];
  if (ctx.partIds) {
    for (const id of refs) {
      if (!ctx.partIds.has(id)) issuesOut.push(item('warning', 'part_not_in_design', path, `${PART_BY_ID[id]?.name ?? id}이(가) 이 설계에 없습니다`));
    }
  }
  return { type: action.type, ...r.out };
}

/**
 * 전술 검증·정리.
 * opts: { design (센서·파츠 확인용, 선택), constants }
 * 반환: { ok, errors, warnings, sanitized }  — sanitized는 문제 있는 부분을 뺀 사본(항상 실행 가능한 형태)
 */
export function validateTactics(tactics, opts = {}) {
  const constants = opts.constants || CONSTANTS;
  const L = constants.tactics;
  const out = [];
  const design = opts.design || null;
  const ctxBase = { limits: L, info: design ? designSensorInfo(design) : null, partIds: design ? designPartIds(design) : null };

  if (!isObj(tactics)) {
    out.push(item('error', 'bad_tactics', '', '전술 데이터가 올바르지 않습니다'));
    return finish(out, emptyTactics());
  }

  // 변수·타이머
  const variables = [];
  const rawVars = Array.isArray(tactics.variables) ? tactics.variables : [];
  if (rawVars.length > L.maxVariables) out.push(item('error', 'too_many_variables', 'variables', `변수는 ${L.maxVariables}개까지입니다`));
  for (const [i, v] of rawVars.slice(0, L.maxVariables).entries()) {
    const p = `variables[${i}]`;
    if (!v?.id || variables.some((x) => x.id === v.id)) {
      out.push(item('error', 'bad_variable', p, '변수 id가 비었거나 겹칩니다'));
      continue;
    }
    const name = checkName(v.name ?? v.id, `${p}.name`, L.maxNameLength, out, '변수');
    if (name === null) continue;
    const min = Number.isFinite(v.min) ? v.min : -999;
    const max = Number.isFinite(v.max) ? v.max : 999;
    variables.push({ id: String(v.id), name, init: clamp(Number(v.init) || 0, min, max), min, max });
  }
  const timers = [];
  const rawTimers = Array.isArray(tactics.timers) ? tactics.timers : [];
  if (rawTimers.length > L.maxTimers) out.push(item('error', 'too_many_timers', 'timers', `타이머는 ${L.maxTimers}개까지입니다`));
  for (const [i, t] of rawTimers.slice(0, L.maxTimers).entries()) {
    const p = `timers[${i}]`;
    if (!t?.id || timers.some((x) => x.id === t.id)) {
      out.push(item('error', 'bad_timer', p, '타이머 id가 비었거나 겹칩니다'));
      continue;
    }
    const name = checkName(t.name ?? t.id, `${p}.name`, L.maxNameLength, out, '타이머');
    if (name === null) continue;
    timers.push({ id: String(t.id), name });
  }

  // 태세 id 먼저 수집(전환·동작이 서로를 참조하므로)
  const rawStances = Array.isArray(tactics.stances) ? tactics.stances : [];
  if (rawStances.length > L.maxStances) out.push(item('error', 'too_many_stances', 'stances', `태세는 ${L.maxStances}개까지입니다`));
  const stanceIds = new Set();
  for (const s of rawStances.slice(0, L.maxStances)) if (s?.id && !stanceIds.has(s.id)) stanceIds.add(String(s.id));

  const ctx = { ...ctxBase, varIds: new Set(variables.map((v) => v.id)), timerIds: new Set(timers.map((t) => t.id)), stanceIds };

  const stances = [];
  const seen = new Set();
  for (const [si, s] of rawStances.slice(0, L.maxStances).entries()) {
    const sp = `stances[${si}]`;
    if (!s?.id || seen.has(s.id)) {
      out.push(item('error', 'bad_stance', sp, '태세 id가 비었거나 겹칩니다'));
      continue;
    }
    seen.add(s.id);
    const name = checkName(s.name ?? s.id, `${sp}.name`, L.maxNameLength, out, '태세') ?? String(s.id);

    // 전환 규칙
    const transitions = [];
    const rawTr = Array.isArray(s.transitions) ? s.transitions : [];
    if (rawTr.length > L.maxTransitionsPerStance) out.push(item('error', 'too_many_transitions', `${sp}.transitions`, `전환 규칙은 태세마다 ${L.maxTransitionsPerStance}개까지입니다`));
    for (const [ti, tr] of rawTr.slice(0, L.maxTransitionsPerStance).entries()) {
      const tp = `${sp}.transitions[${ti}]`;
      if (!stanceIds.has(tr?.to)) {
        out.push(item('error', 'bad_transition', tp, `없는 태세로 전환합니다: ${tr?.to}`));
        continue;
      }
      if (tr.to === s.id) out.push(item('warning', 'self_transition', tp, '자기 자신으로 전환하는 규칙은 의미가 없습니다'));
      const when = checkWhen(tr.when, `${tp}.when`, ctx, out);
      if (when) transitions.push({ when, to: tr.to });
    }

    // 규칙
    const rules = [];
    const rawRules = Array.isArray(s.rules) ? s.rules : [];
    if (rawRules.length > L.maxRulesPerStance) out.push(item('error', 'too_many_rules', `${sp}.rules`, `규칙은 태세마다 ${L.maxRulesPerStance}개까지입니다`));
    const channelClosed = {}; // 조건 없는 규칙이 이미 있는 채널
    for (const [ri, r] of rawRules.slice(0, L.maxRulesPerStance).entries()) {
      const rp = `${sp}.rules[${ri}]`;
      if (!CHANNELS.includes(r?.channel)) {
        out.push(item('error', 'bad_channel', rp, `알 수 없는 채널: ${r?.channel}`));
        continue;
      }
      const when = checkWhen(r.when ?? { mode: 'all', conditions: [] }, `${rp}.when`, ctx, out);
      if (!when) continue;
      const action = checkAction(r.do, r.channel, `${rp}.do`, ctx, out);
      if (!action) continue;
      const target = r.target ?? DEFAULT_TARGET;
      if (!TARGET_IDS.includes(target)) {
        out.push(item('error', 'bad_target', rp, `알 수 없는 대상 선택자: ${target}`));
        continue;
      }
      const need = TARGET_DEFS[target].needs;
      if (need && ctx.info && !ctx.info.has(need)) {
        out.push(item('warning', 'selector_fallback', rp, `${TARGET_DEFS[target].label}은(는) 센서가 없어 가장 가까운 적으로 대체됩니다`));
      }
      if (channelClosed[r.channel]) {
        out.push(item('warning', 'unreachable_rule', rp, '위에 조건 없는 규칙이 있어 이 규칙은 실행되지 않습니다'));
      }
      if (when.conditions.length === 0) channelClosed[r.channel] = true;
      rules.push({ channel: r.channel, when, do: action, target });
    }
    stances.push({ id: String(s.id), name, transitions, rules });
  }

  if (stances.length === 0) {
    out.push(item('error', 'no_stance', 'stances', '태세가 하나도 없습니다'));
    return finish(out, emptyTactics());
  }

  // 시작 태세
  let startStance = tactics.startStance;
  if (!stances.some((s) => s.id === startStance)) {
    out.push(item('error', 'bad_start', 'startStance', '시작 태세가 없습니다. 첫 번째 태세로 시작합니다'));
    startStance = stances[0].id;
  }

  // 태세 전환 규칙이 가리키는 태세가 제거됐을 수 있으므로 한 번 더 걸러냄
  const alive = new Set(stances.map((s) => s.id));
  for (const s of stances) s.transitions = s.transitions.filter((t) => alive.has(t.to));
  // 동작 안의 switch_stance 도 마찬가지
  for (const s of stances) s.rules = s.rules.filter((r) => r.do.type !== 'switch_stance' || alive.has(r.do.to));

  // 도달 불가 태세 (경고)
  const reach = new Set([startStance]);
  const queue = [startStance];
  while (queue.length) {
    const curId = queue.shift();
    const cur = stances.find((s) => s.id === curId);
    const targets = [...cur.transitions.map((t) => t.to), ...cur.rules.filter((r) => r.do.type === 'switch_stance').map((r) => r.do.to)];
    for (const to of targets) if (!reach.has(to)) { reach.add(to); queue.push(to); }
  }
  for (const s of stances) {
    if (!reach.has(s.id)) out.push(item('warning', 'unreachable_stance', `stances.${s.id}`, `'${s.name}' 태세로 가는 전환이 없어 쓰이지 않습니다`));
  }

  return finish(out, { startStance, stances, variables, timers });
}

function finish(list, sanitized) {
  const errors = list.filter((x) => x.level === 'error');
  const warnings = list.filter((x) => x.level === 'warning');
  return { ok: errors.length === 0, errors, warnings, sanitized };
}

// 서버가 경기 시작 때 쓰는 함수: 위반은 버리고 실행 가능한 전술을 돌려준다.
export function sanitizeTactics(tactics, opts = {}) {
  return validateTactics(tactics, opts).sanitized;
}

export { OPS, ENUM_OPS };

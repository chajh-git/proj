// shared/balance/merge.js  (102번)
// 기본 수치(config/constants.js, data/*.js)와 조율 센터에서 저장한 수치를 합친다. 범위를 벗어난 값은 바로잡는다. 서버와 브라우저가 같은 코드를 쓴다. (명세 18-1)
//   저장 형식(바뀐 값만):
//     { constants: { 'time.matchSeconds': 200, 'stats.aptitudeMult': { S:1.3, … } },
//       parts:   { fr_light: { weight: 4, 'provides.S': 2 } },  maps: { m1: { 'rules.shrink.stepMeters': 3 } },
//       skills:  { haste: { cost: 50 } },                       presets: { standard: { weightCap: 90 } } }
//   normalizeBalance(saved)            → { data, issues, ok }              범위 검사·바로잡기. data 는 깨끗한 저장 형식
//   mergeBalance(saved, base?)         → { constants, parts, maps, skills, presets, issues, ok, data }   덮어쓴 값(깊게 얼림)
//   diffBalance(a, b)                  → [{ path, label, from, to }]
//   changedFromDefault(values)         → { 한 줄 경로: 값 } → 기본값과 다른 것만 남긴 저장 형식
//   flattenBalance(data)               → { 한 줄 경로: 값 }   (화면 저장소가 쓰는 형태. 항목별 수치의 경로는 '부품/ID/잎경로')
// 알 수 없는 경로는 무시하고 issues 에 남긴다(오래된 저장본 호환).

import { CONSTANTS } from '../../config/constants.js';
import { VAR_BY_PATH, VARS, getPath, specFor, SECTION_KEYS, SECTIONS } from '../../config/balance-schema.js';
import { PART_BY_ID } from '../../data/parts.js';

const clone = (v) => JSON.parse(JSON.stringify(v));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);
const clampNum = (n, lo, hi) => Math.min(hi, Math.max(lo, n));

function setPath(obj, path, value) {
  const keys = path.split('.');
  let o = obj;
  for (let i = 0; i < keys.length - 1; i++) o = o[keys[i]];
  o[keys[keys.length - 1]] = value;
}

function deepFreeze(o) {
  Object.values(o).forEach((v) => v && typeof v === 'object' && !Object.isFrozen(v) && deepFreeze(v));
  return Object.freeze(o);
}

const snap = (n, spec) => {
  if (spec.type === 'int') return Math.round(n);
  if (spec.step && spec.step < 1) { const d = Math.max(0, Math.ceil(-Math.log10(spec.step))); return Number(n.toFixed(d + 1)); }
  return spec.step === 1 ? Math.round(n) : n;
};

/** 변수 하나의 값을 명세에 맞게 고친다. → { value, ok, note } (ok=false 면 값을 쓸 수 없음) */
export function coerceValue(spec, raw) {
  switch (spec.type) {
    case 'int': case 'num': case 'ratio': case 'seconds': {
      const n = Number(raw);
      if (raw === null || raw === '' || !Number.isFinite(n)) return { ok: false, note: '숫자가 아닙니다' };
      const v = snap(clampNum(n, spec.min, spec.max), spec);
      return { ok: true, value: v, note: v !== n ? `범위(${spec.min}~${spec.max})에 맞췄습니다` : null };
    }
    case 'bool': return typeof raw === 'boolean' ? { ok: true, value: raw } : { ok: false, note: '참/거짓이어야 합니다' };
    case 'enum': return spec.options.some(([k]) => k === raw) ? { ok: true, value: raw } : { ok: false, note: '선택지에 없는 값입니다' };
    case 'multi': {
      if (!Array.isArray(raw)) return { ok: false, note: '목록이어야 합니다' };
      const ok = raw.filter((x) => spec.options.some(([k]) => k === x));
      return { ok: true, value: [...new Set(ok)], note: ok.length !== raw.length ? '없는 선택지를 뺐습니다' : null };
    }
    case 'range': {
      if (!Array.isArray(raw) || raw.length !== 2 || raw.some((x) => !Number.isFinite(Number(x)))) return { ok: false, note: '[낮음, 높음] 이어야 합니다' };
      const a = clampNum(Number(raw[0]), spec.min, spec.max);
      const b = clampNum(Number(raw[1]), spec.min, spec.max);
      return { ok: true, value: [Math.min(a, b), Math.max(a, b)] };
    }
    case 'curve': {
      if (!Array.isArray(raw) || raw.length !== spec.points || raw.some((p) => !Array.isArray(p) || p.length !== 2 || p.some((x) => !Number.isFinite(Number(x))))) return { ok: false, note: `점 ${spec.points}개의 [x,y] 목록이어야 합니다` };
      const pts = raw.map(([x, y]) => [clampNum(Number(x), spec.xMin, spec.xMax), clampNum(Number(y), spec.yMin, spec.yMax)]).sort((p, q) => p[0] - q[0]);
      return { ok: true, value: pts };
    }
    case 'triple': {
      if (!raw || typeof raw !== 'object') return { ok: false, note: '{S,M,L} 이어야 합니다' };
      const out = {};
      for (const k of ['S', 'M', 'L']) { const n = Number(raw[k]); if (!Number.isFinite(n)) return { ok: false, note: `${k} 값이 숫자가 아닙니다` }; out[k] = Math.round(clampNum(n, spec.min, spec.max)); }
      return { ok: true, value: out };
    }
    case 'record': {
      if (!raw || typeof raw !== 'object') return { ok: false, note: '값 묶음이어야 합니다' };
      const out = {};
      for (const [k] of spec.keys) {
        const n = Number(raw[k]);
        if (!Number.isFinite(n)) return { ok: false, note: `${k} 값이 숫자가 아닙니다` };
        out[k] = snap(clampNum(n, spec.min, spec.max), { ...spec, type: spec.item });
      }
      return { ok: true, value: out };
    }
    default: return { ok: false, note: '알 수 없는 형식' };
  }
}

const labelOf = (path) => { const sp = specFor(path); return sp ? (sp.itemName ? `${sp.itemName} · ${sp.label}` : sp.label) : path; };

export function normalizeBalance(saved) {
  const issues = [];
  const data = { constants: {} };
  const src = saved?.constants && typeof saved.constants === 'object' ? saved.constants : {};
  for (const [path, raw] of Object.entries(src)) {
    const spec = VAR_BY_PATH[path];
    if (!spec) { issues.push({ path, level: 'unknown', message: '알 수 없는 변수라 무시했습니다' }); continue; }
    const r = coerceValue(spec, raw);
    if (!r.ok) { issues.push({ path, level: 'error', message: `${spec.label}: ${r.note}` }); continue; }
    if (r.note) issues.push({ path, level: 'clamped', message: `${spec.label}: ${r.note}` });
    if (!eq(r.value, spec.default)) data.constants[path] = r.value; // 기본값과 같으면 저장하지 않는다
  }
  // 항목별 수치
  for (const section of SECTION_KEYS) {
    const bySec = saved?.[section];
    if (!bySec || typeof bySec !== 'object') continue;
    for (const [id, leaves] of Object.entries(bySec)) {
      if (!leaves || typeof leaves !== 'object') continue;
      for (const [leaf, raw] of Object.entries(leaves)) {
        const path = `${section}/${id}/${leaf}`;
        const spec = specFor(path);
        if (!spec) { issues.push({ path, level: 'unknown', message: `${SECTIONS[section].label} ${id}/${leaf}: 알 수 없는 항목이라 무시했습니다` }); continue; }
        const r = coerceValue(spec, raw);
        if (!r.ok) { issues.push({ path, level: 'error', message: `${labelOf(path)}: ${r.note}` }); continue; }
        if (r.note) issues.push({ path, level: 'clamped', message: `${labelOf(path)}: ${r.note}` });
        if (eq(r.value, spec.default)) continue;
        ((data[section] ||= {})[id] ||= {})[leaf] = r.value;
      }
    }
  }
  // 변수 사이의 관계
  const c = (p) => (p in data.constants ? data.constants[p] : getPath(CONSTANTS, p));
  if (c('tactics.rangeBand.near') >= c('tactics.rangeBand.mid')) issues.push({ path: 'tactics.rangeBand', level: 'error', message: '‘가까움 경계’는 ‘중간 경계’보다 작아야 합니다' });
  if (c('lab.lowWinRate') >= c('lab.highWinRate')) issues.push({ path: 'lab', level: 'error', message: '‘너무 약한 기준’은 ‘너무 센 기준’보다 낮아야 합니다' });
  if (c('fusion.cinematicSeconds') < CONSTANTS.fusion.cinematicMinSeconds || c('fusion.cinematicSeconds') > CONSTANTS.fusion.cinematicMaxSeconds) issues.push({ path: 'fusion.cinematicSeconds', level: 'error', message: '융합 연출 길이는 6~10초입니다' });
  const apt = c('stats.aptitudeMult');
  if (apt && !(apt.S >= apt.A && apt.A >= apt.B && apt.B >= apt.C && apt.C >= apt.D)) issues.push({ path: 'stats.aptitudeMult', level: 'warn', message: '적성 배율은 S ≥ A ≥ B ≥ C ≥ D 순서가 자연스럽습니다' });
  return { data, issues, ok: !issues.some((i) => i.level === 'error') };
}

/** 저장 형식 → 한 줄 경로 값 묶음 */
export function flattenBalance(data) {
  const out = { ...(data?.constants || {}) };
  for (const section of SECTION_KEYS) for (const [id, leaves] of Object.entries(data?.[section] || {})) for (const [leaf, v] of Object.entries(leaves)) out[`${section}/${id}/${leaf}`] = v;
  return out;
}

/** 한 줄 경로 값 묶음({경로:값}, 전부 또는 일부) → 기본값과 다른 것만 남긴 저장 형식 */
export function changedFromDefault(values) {
  const data = { constants: {} };
  for (const [path, v] of Object.entries(values)) {
    const spec = specFor(path);
    if (!spec || eq(v, spec.default)) continue;
    if (spec.section) ((data[spec.section] ||= {})[spec.itemId] ||= {})[spec.leaf] = clone(v);
    else data.constants[path] = clone(v);
  }
  return data;
}

export function mergeBalance(saved, base = CONSTANTS) {
  const { data, issues, ok } = normalizeBalance(saved);
  const out = clone(base);
  // 오류가 난 변수는 normalizeBalance 에서 이미 빠졌으므로, 나머지는 그대로 적용한다(깨진 저장본이라도 경기는 돌아가야 한다)
  for (const [path, v] of Object.entries(data.constants)) setPath(out, path, clone(v));

  const overlay = (section, items) => {
    const ov = data[section] || {};
    return items.map((item) => {
      const o = ov[item.id];
      if (!o) return item;
      const copy = clone(item);
      for (const [leaf, v] of Object.entries(o)) setPath(copy, leaf, clone(v));
      if (Array.isArray(copy.tags)) copy.tags = Object.freeze([...copy.tags]);
      return deepFreeze(copy);
    });
  };
  const partList = overlay('parts', Object.values(PART_BY_ID));
  const skillList = overlay('skills', SECTIONS.skills.items());
  return {
    constants: deepFreeze(out),
    parts: Object.freeze(Object.fromEntries(partList.map((p) => [p.id, p]))),
    maps: Object.freeze(overlay('maps', SECTIONS.maps.items())),
    skills: Object.freeze(Object.fromEntries(skillList.map((p) => [p.id, p]))),
    presets: Object.freeze(overlay('presets', SECTIONS.presets.items())),
    issues, ok, data,
  };
}

export function diffBalance(a, b) {
  const pa = flattenBalance(a);
  const pb = flattenBalance(b);
  const out = [];
  for (const path of new Set([...Object.keys(pa), ...Object.keys(pb)])) {
    const spec = specFor(path);
    const from = path in pa ? pa[path] : spec?.default;
    const to = path in pb ? pb[path] : spec?.default;
    if (!eq(from, to)) out.push({ path, label: spec ? labelOf(path) : path, from, to });
  }
  return out.sort((x, y) => x.path.localeCompare(y.path));
}

export { VARS };

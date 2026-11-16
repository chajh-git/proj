// shared/tactics/schema.js  (20번)
// 전술의 어휘 정의: 조건 카드, 동작 카드, 대상 선택자, 채널, 연산자. (명세 v1.0 11장)
// 신경 연산실(카드 UI)·검증기·해석기가 모두 이 표를 기준으로 합니다. 새 카드는 여기에 한 줄 추가하면 됩니다.
// 화면 코드를 import하지 않습니다(서버와 브라우저 공용).
//
// ── 전술 데이터 ─────────────────────────────────────────
//  tactics = { startStance, stances: [stance], variables: [{id, name, init, min, max}], timers: [{id, name}] }
//  stance  = { id, name, transitions: [{ when, to }], rules: [rule] }
//  rule    = { channel, when, do, target }      when = { mode: 'all'|'any', conditions: [cond] }
//  cond    = { type, ...필드 }                  do = { type, ...매개변수 }
//
// ── 값 형식(spec) ───────────────────────────────────────
//  { kind:'number', min, max, step?, unit? } | { kind:'enum', options:[{id,label}] } | { kind:'bool' }
//  { kind:'partId' } 설계에 있는 파츠 종류 | { kind:'partIds' } | { kind:'variable' } | { kind:'timer' }
//  { kind:'stance' } | { kind:'selector' } | { kind:'skill' } | { kind:'index', min, max }

import { CONSTANTS } from '../../config/constants.js';

export const CHANNELS = CONSTANTS.enums.channels; // ['move','weapon','defense','special']
export const CHANNEL_LABEL = Object.freeze({ move: '이동', weapon: '무장', defense: '방어', special: '특수' });
export const CHANNEL_PRIORITY = CONSTANTS.enums.channelPriority; // 충돌 시 우선순위(앞이 강함)

export const COND_MODES = Object.freeze(['all', 'any']);
export const COND_MODE_LABEL = Object.freeze({ all: '모두 만족', any: '하나라도 만족' });

export const OPS = Object.freeze(['<', '<=', '>', '>=', '==', '!=']);
export const OP_LABEL = Object.freeze({ '<': '미만', '<=': '이하', '>': '초과', '>=': '이상', '==': '같음', '!=': '다름' });
export const ENUM_OPS = Object.freeze(['==', '!=']);

// 센서가 열어주는 정보 키 (data/parts.js의 sensor.info와 같은 이름)
export const SENSOR_INFO = Object.freeze([
  'enemy_distance', 'enemy_bearing', 'stealth_reveal', 'enemy_energy_pct', 'enemy_hp_pct', 'enemy_spirit',
  'enemy_part_state', 'through_walls', 'underwater_detect', 'enemy_stance_name', 'ally_precise', 'shared_vars',
]);

// 방위 8방 (관찰자의 앞을 0으로, 시계 방향)
export const BEARING8 = Object.freeze(['front', 'front_right', 'right', 'back_right', 'back', 'back_left', 'left', 'front_left']);
export const BEARING8_LABEL = Object.freeze({
  front: '정면', front_right: '우전방', right: '오른쪽', back_right: '우후방', back: '후방', back_left: '좌후방', left: '왼쪽', front_left: '좌전방',
});

const E = (pairs) => ({ kind: 'enum', options: pairs.map(([id, label]) => ({ id, label })) });
const N = (min, max, unit = '', step = 1) => ({ kind: 'number', min, max, unit, step });
const BOOL = { kind: 'bool' };

export const BAND_OPTIONS = E([['near', '근거리'], ['mid', '중거리'], ['far', '원거리']]);
export const ALT_OPTIONS = E([['ground', '지상'], ['low', '저공'], ['high', '고공']]);
export const ENV_OPTIONS = E([['ground', '지상'], ['water', '수중'], ['air', '공중'], ['space', '우주']]);
export const FORM_OPTIONS = E([['A', '형태 A'], ['B', '형태 B']]);
export const HPBAND_OPTIONS = E([['high', '상'], ['mid', '중'], ['low', '하']]);
export const BEARING_OPTIONS = E(BEARING8.map((k) => [k, BEARING8_LABEL[k]]));
export const PART_STATE_OPTIONS = E([['ok', '정상'], ['damaged', '손상'], ['missing', '없음'], ['cooldown', '쿨다운']]);
export const EVENT_OPTIONS = E([['any', '아무 예고'], ['meteor', '운석'], ['spikes', '함정'], ['emp', 'EMP 폭풍'], ['shrink', '전장 축소']]);

// 비교형 조건의 필드 묶음
const cmpNum = (spec) => [{ key: 'op', spec: { kind: 'op' } }, { key: 'value', spec }];
const cmpEnum = (spec) => [{ key: 'op', spec: { kind: 'op', ops: ENUM_OPS } }, { key: 'value', spec }];
const isBool = [{ key: 'value', spec: BOOL, default: true }];

// ── 조건 카드 ───────────────────────────────────────────
// group: 카드 분류 / needs: 필요한 센서 정보(없으면 null) / about: 'self'|'enemy'|'ally'|'world'
const C = (label, group, about, fields, needs = null, hint = '') => ({ label, group, about, fields, needs, hint });

export const CONDITION_DEFS = Object.freeze({
  // 내 상태 (항상 알 수 있음)
  self_hp_pct: C('내 체력 %', '내 상태', 'self', cmpNum(N(0, 100, '%')), null),
  self_energy_pct: C('내 에너지 %', '내 상태', 'self', cmpNum(N(0, 100, '%')), null),
  self_spirit: C('내 투지', '내 상태', 'self', cmpNum(N(0, 200)), null),
  self_gauge: C('내 게이지', '내 상태', 'self', cmpNum(N(0, 100)), null),
  self_speed: C('내 속도', '내 상태', 'self', cmpNum(N(0, 40, 'm/s', 0.5)), null),
  self_altitude: C('내 고도', '내 상태', 'self', cmpEnum(ALT_OPTIONS), null),
  self_env: C('발밑 환경', '내 상태', 'self', cmpEnum(ENV_OPTIONS), null),
  self_form: C('현재 형태', '내 상태', 'self', cmpEnum(FORM_OPTIONS), null),
  part_state: C('파츠 상태', '내 상태', 'self', [
    { key: 'part', spec: { kind: 'partId' } },
    { key: 'op', spec: { kind: 'op', ops: ENUM_OPS } },
    { key: 'state', spec: PART_STATE_OPTIONS },
  ], null),
  part_ammo: C('파츠 탄수', '내 상태', 'self', [{ key: 'part', spec: { kind: 'partId' } }, ...cmpNum(N(0, 99))], null),
  // 시간
  time_elapsed: C('경기 경과 시간', '시간', 'world', cmpNum(N(0, 400, '초')), null),
  time_in_stance: C('태세 경과 시간', '시간', 'world', cmpNum(N(0, 400, '초', 0.5)), null),
  timer_elapsed: C('타이머 경과', '시간', 'world', [{ key: 'timer', spec: { kind: 'timer' } }, ...cmpNum(N(0, 400, '초', 0.5))], null),
  // 전장
  in_hazard: C('위험구역 안', '전장', 'world', isBool, null),
  event_warning: C('전장 이벤트 예고', '전장', 'world', [{ key: 'event', spec: EVENT_OPTIONS }], null),
  // 변수
  variable: C('변수 비교', '변수', 'self', [{ key: 'var', spec: { kind: 'variable' } }, ...cmpNum(N(-999, 999))], null),
  shared_var: C('팀 공유 변수', '변수', 'self', [{ key: 'index', spec: { kind: 'index', min: 1, max: CONSTANTS.tactics.maxSharedVariables } }, ...cmpNum(N(-999, 999))], 'shared_vars'),
  // 적 (대상 기준)
  enemy_band: C('적 거리 구간', '적 정보', 'enemy', cmpEnum(BAND_OPTIONS), null, '센서 없이도 알 수 있는 근/중/원'),
  enemy_distance: C('적 거리(m)', '적 정보', 'enemy', cmpNum(N(0, 80, 'm', 0.5)), 'enemy_distance'),
  enemy_bearing: C('적 방향', '적 정보', 'enemy', cmpEnum(BEARING_OPTIONS), null),
  enemy_hp_pct: C('적 체력 %', '적 정보', 'enemy', cmpNum(N(0, 100, '%')), 'enemy_hp_pct'),
  enemy_energy_pct: C('적 에너지 %', '적 정보', 'enemy', cmpNum(N(0, 100, '%')), 'enemy_energy_pct'),
  enemy_spirit: C('적 투지', '적 정보', 'enemy', cmpNum(N(0, 200)), 'enemy_spirit'),
  enemy_detected: C('적 탐지됨', '적 정보', 'enemy', isBool, null, '은신한 적은 탐지되지 않는다'),
  enemy_weapon_active: C('적이 무기 사용 중', '적 정보', 'enemy', isBool, 'enemy_part_state'),
  enemy_altitude: C('적 고도', '적 정보', 'enemy', cmpEnum(ALT_OPTIONS), null),
  enemy_count: C('남은 적 수', '적 정보', 'world', cmpNum(N(0, 3)), null),
  // 아군
  ally_band: C('아군 거리 구간', '아군 정보', 'ally', cmpEnum(BAND_OPTIONS), null),
  ally_hp_band: C('아군 체력 상/중/하', '아군 정보', 'ally', cmpEnum(HPBAND_OPTIONS), null),
  ally_hp_pct: C('아군 체력 %', '아군 정보', 'ally', cmpNum(N(0, 100, '%')), 'ally_precise'),
  ally_count: C('남은 아군 수', '아군 정보', 'world', cmpNum(N(0, 2)), null),
});

export const CONDITION_TYPES = Object.freeze(Object.keys(CONDITION_DEFS));

// ── 대상 선택자 ─────────────────────────────────────────
export const TARGET_DEFS = Object.freeze({
  current: { label: '현재 대상', group: '기본' },
  nearest_enemy: { label: '가장 가까운 적', group: '적', needs: null },
  lowest_hp_enemy: { label: '체력 낮은 적', group: '적', needs: 'enemy_hp_pct', fallback: 'nearest_enemy' },
  most_damaged_enemy: { label: '파츠 손상이 많은 적', group: '적', needs: 'enemy_part_state', fallback: 'nearest_enemy' },
  weapon_active_enemy: { label: '무기를 사용 중인 적', group: '적', needs: 'enemy_part_state', fallback: 'nearest_enemy' },
  enemy_1: { label: '적 1 (출전 순서)', group: '적', needs: null },
  enemy_2: { label: '적 2 (출전 순서)', group: '적', needs: null },
  enemy_3: { label: '적 3 (출전 순서)', group: '적', needs: null },
  nearest_ally: { label: '가장 가까운 아군', group: '아군', needs: null },
  lowest_hp_ally: { label: '체력 낮은 아군', group: '아군', needs: null },
  locked: { label: '잠근 대상', group: '기본' },
  self: { label: '나', group: '기본' },
});
export const TARGET_IDS = Object.freeze(Object.keys(TARGET_DEFS));
export const DEFAULT_TARGET = 'current';

// ── 동작 카드 ───────────────────────────────────────────
// channels: 이 동작을 둘 수 있는 채널 / params: 매개변수 / level: 'basic'|'advanced'(고급 카드)
const A = (label, channels, params = [], level = 'basic', hint = '') => ({ label, channels, params, level, hint });
const FACE_OPTIONS = E([['front', '정면'], ['back', '후면'], ['left', '왼쪽'], ['right', '오른쪽'], ['thickest_armor', '가장 두꺼운 장갑면'], ['part', '특정 파츠']]);
const ON = { key: 'on', spec: BOOL, default: true };

export const ACTION_DEFS = Object.freeze({
  // 이동
  approach: A('접근', ['move']),
  retreat: A('후퇴 (바라보며 뒤로)', ['move']),
  flee: A('이탈 (돌아서 달아남)', ['move']),
  charge: A('돌진', ['move']),
  circle: A('맴돌기', ['move'], [{ key: 'dir', spec: E([['cw', '시계'], ['ccw', '반시계']]), optional: true }]),
  align: A('정렬', ['move'], [
    { key: 'face', spec: FACE_OPTIONS },
    { key: 'part', spec: { kind: 'partId' }, optional: true, when: { face: 'part' } },
  ]),
  stop: A('정지', ['move']),
  change_altitude: A('고도 변경', ['move'], [{ key: 'to', spec: ALT_OPTIONS }]),
  set_thrust: A('이동 기관 출력 %', ['move'], [{ key: 'parts', spec: { kind: 'partIds' } }, { key: 'pct', spec: N(0, 100, '%', 5) }], 'advanced'),
  // 무장
  use_weapon: A('무기 사용', ['weapon'], [{ key: 'parts', spec: { kind: 'partIds' }, optional: true }]),
  hold_aim: A('조준 유지', ['weapon']),
  charge_weapon: A('충전', ['weapon'], [{ key: 'parts', spec: { kind: 'partIds' }, optional: true }]),
  overdrive: A('오버드라이브 발동', ['weapon']),
  fire_interval: A('발사 간격', ['weapon'], [{ key: 'parts', spec: { kind: 'partIds' } }, { key: 'seconds', spec: N(0, 20, '초', 0.1) }], 'advanced'),
  aim_offset: A('조준 오프셋', ['weapon'], [{ key: 'deg', spec: N(-60, 60, '°', 1) }], 'advanced'),
  // 방어
  shield: A('실드', ['defense'], [ON]),
  intercept: A('요격', ['defense'], [ON]),
  repair: A('수리', ['defense'], [ON]),
  phase: A('위상 전환', ['defense']),
  pilot_skill: A('각성기 발동', ['defense'], [{ key: 'skill', spec: { kind: 'skill' } }]),
  // 방어·특수 공용
  toggle_part: A('파츠 켜기/끄기', ['defense', 'special'], [{ key: 'parts', spec: { kind: 'partIds' } }, ON], 'advanced'),
  // 특수
  switch_stance: A('태세 전환', ['special'], [{ key: 'to', spec: { kind: 'stance' } }]),
  set_var: A('변수 설정', ['special'], [{ key: 'var', spec: { kind: 'variable' } }, { key: 'value', spec: N(-999, 999) }]),
  add_var: A('변수 증감', ['special'], [{ key: 'var', spec: { kind: 'variable' } }, { key: 'delta', spec: N(-99, 99) }]),
  start_timer: A('타이머 시작', ['special'], [{ key: 'timer', spec: { kind: 'timer' } }]),
  set_shared_var: A('팀 공유 변수 쓰기', ['special'], [{ key: 'index', spec: { kind: 'index', min: 1, max: CONSTANTS.tactics.maxSharedVariables } }, { key: 'value', spec: N(-999, 999) }]),
  lock_target: A('타겟 잠금', ['special'], [{ key: 'selector', spec: { kind: 'selector' } }, { key: 'releaseSeconds', spec: N(0, 60, '초', 1), optional: true }]),
  unlock_target: A('타겟 잠금 해제', ['special']),
  fusion_signal: A('융합 신호', ['special'], [], 'basic', '조건이 맞지 않으면 투지 −5, 쿨다운 8초'),
  transform: A('변신', ['special']),
  detach: A('분리', ['special'], [{ key: 'parts', spec: { kind: 'partIds' }, optional: true }], 'advanced', '파츠 분리 또는 융합 해제'),
});
export const ACTION_TYPES = Object.freeze(Object.keys(ACTION_DEFS));

// 한 채널에서 쓸 수 있는 동작 목록
export const actionsForChannel = (channel) => ACTION_TYPES.filter((t) => ACTION_DEFS[t].channels.includes(channel));

// ── 한도 (constants.tactics) ────────────────────────────
export const limitsOf = (constants = CONSTANTS) => constants.tactics;

// ── 만들기 보조 ─────────────────────────────────────────
export const ALWAYS = Object.freeze({ mode: 'all', conditions: Object.freeze([]) });

export function newId(prefix, existing) {
  const used = new Set(existing);
  for (let n = 1; n < 1000; n++) if (!used.has(`${prefix}${n}`)) return `${prefix}${n}`;
  throw new Error('id를 만들 수 없습니다');
}

export const makeRule = (channel, when, action, target = DEFAULT_TARGET) => ({
  channel, when: when || { mode: 'all', conditions: [] }, do: action, target,
});

export const makeStance = (id, name) => ({ id, name, transitions: [], rules: [] });

// 새 전술: 태세 하나, 규칙 없음 (모든 채널이 기본 동작: 정지·무장 없음·방어 없음)
export function emptyTactics() {
  return { startStance: 'main', stances: [makeStance('main', '기본')], variables: [], timers: [] };
}

// 조건·동작 카드의 기본값 채우기 (UI에서 카드를 새로 놓을 때)
export function defaultFields(fields) {
  const out = {};
  for (const f of fields) {
    const s = f.spec;
    if (f.default !== undefined) out[f.key] = f.default;
    else if (s.kind === 'op') out[f.key] = (s.ops || OPS)[0];
    else if (s.kind === 'number') out[f.key] = s.min;
    else if (s.kind === 'enum') out[f.key] = s.options[0].id;
    else if (s.kind === 'bool') out[f.key] = true;
    else if (s.kind === 'index') out[f.key] = s.min;
    else if (s.kind === 'partIds') out[f.key] = [];
  }
  return out;
}

export function newCondition(type) {
  const def = CONDITION_DEFS[type];
  if (!def) throw new Error(`알 수 없는 조건: ${type}`);
  return { type, ...defaultFields(def.fields) };
}

export function newAction(type) {
  const def = ACTION_DEFS[type];
  if (!def) throw new Error(`알 수 없는 동작: ${type}`);
  return { type, ...defaultFields(def.params.filter((p) => !p.optional)) };
}

// 조건이 필요로 하는 센서 정보 키 (없으면 null)
export const conditionNeeds = (cond) => CONDITION_DEFS[cond?.type]?.needs ?? null;
export const selectorNeeds = (id) => TARGET_DEFS[id]?.needs ?? null;

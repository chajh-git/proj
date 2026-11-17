// shared/tactics/manual.js
// 수동 조종: 키보드·마우스 입력을 기체 명령(cmd)으로 바꾼다. 신경 연산실 전술(interpreter)을 대신한다(완전 수동).
// 화면 코드를 import하지 않는다 → 브라우저(시험 사격장, 로컬 시뮬)와 서버(리그 경기·연습전)가 같은 코드를 쓴다.
//
//   enableManual(entity)                       기체를 수동 조종 상태로 만든다(전술 정지)
//   disableManual(entity)                      전술로 되돌린다
//   setManualInput(entity, raw)                입력 갱신 — 서버는 '믿지 않고' 여기서 값을 다듬는다(sanitizeInput)
//   manualCommand(world, entity)               이번 틱의 명령 (referee가 틱마다 부른다)
//
// 입력 한 번의 모양(raw)
//   { throttle:-1~1, aim:(heading 라디안|null), hold:{fire,shield,intercept,repair,overdrive},
//     once:['phase','skill1','skill2','transform','detach','altUp','altDown','lock','unlock'] }
//   · aim 은 '카메라가 보는 방향'(heading 규약: 0 → 앞 −z, 오른쪽으로 돌면 줄어듦). 기체가 그 방향으로 몸을 돌린다.
//   · once 는 눌린 순간 한 번만 처리하는 동작. 서버는 틱마다 최대 MAX_ONCE 개만 받아들인다.

import { clamp, wrapAngle, headingFromDirection } from '../util/math.js';
import { emptyCommand, ALTITUDES } from '../sim/world.js';

export const MANUAL_ONCE = Object.freeze(['phase', 'skill1', 'skill2', 'transform', 'detach', 'altUp', 'altDown', 'lock', 'unlock']);
export const MANUAL_HOLD = Object.freeze(['fire', 'shield', 'intercept', 'repair', 'overdrive']);
const MAX_ONCE = 6;
const TURN_GAIN = 2.2; // 조준 방향으로 도는 세기(연산 틱마다)
const LOCK_CONE = 0.7; // 조준선에서 이만큼(라디안) 안의 적만 자동으로 겨냥

const num = (v, d = 0) => (Number.isFinite(+v) ? +v : d);

export function sanitizeInput(raw) {
  const r = raw && typeof raw === 'object' ? raw : {};
  const hold = {};
  for (const k of MANUAL_HOLD) hold[k] = Boolean(r.hold?.[k]);
  const once = Array.isArray(r.once) ? r.once.filter((k) => MANUAL_ONCE.includes(k)).slice(0, MAX_ONCE) : [];
  return {
    throttle: clamp(num(r.throttle), -1, 1),
    aim: r.aim === null || r.aim === undefined ? null : wrapAngle(num(r.aim)),
    hold, once,
  };
}

const idleInput = () => ({ throttle: 0, aim: null, hold: Object.fromEntries(MANUAL_HOLD.map((k) => [k, false])), once: [] });

export function enableManual(e) {
  e.manual = { input: idleInput(), queue: [], lockId: null, shown: { shield: false, intercept: false, repair: false } };
  return e;
}
export function disableManual(e) {
  if (!e.manual) return e;
  for (const [, p] of e.parts) { if (p.def?.shieldAbsorb !== undefined || p.def?.interceptRange !== undefined || p.def?.repairPartPerSecond !== undefined) p.on = false; }
  e.manual = null;
  return e;
}
export const isManual = (e) => Boolean(e.manual);

/** 입력을 받는다. hold 는 최신 값으로 덮고, once 는 대기열에 쌓는다. */
export function setManualInput(e, raw) {
  if (!e.manual) return false;
  const s = sanitizeInput(raw);
  e.manual.input = { throttle: s.throttle, aim: s.aim, hold: s.hold, once: [] };
  for (const k of s.once) if (e.manual.queue.length < 16) e.manual.queue.push(k);
  return true;
}

const enemiesOf = (world, e) => world.entities.filter((o) => o.alive && o.team !== e.team);

// 조준선에 가장 가까운 적. 잠금이 있고 살아 있으면 그 적.
function pickTarget(world, e, aim) {
  const m = e.manual;
  const foes = enemiesOf(world, e);
  if (m.lockId) {
    const t = foes.find((o) => o.id === m.lockId);
    if (t) return t;
    m.lockId = null;
  }
  const dir = aim ?? e.heading;
  let best = null; let bs = Infinity;
  for (const o of foes) {
    const b = headingFromDirection({ x: o.pos.x - e.pos.x, z: o.pos.z - e.pos.z });
    const off = Math.abs(wrapAngle(b - dir));
    const d = Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z);
    const score = off + d * 0.004; // 각도가 우선, 같으면 가까운 적
    if (off <= LOCK_CONE && score < bs) { bs = score; best = o; }
  }
  if (!best && foes.length) { // 조준선 근처에 없으면 가장 가까운 적을 겨냥 후보로(발사는 사거리·각도 조건을 따로 본다)
    best = foes.reduce((a, o) => (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) < Math.hypot(a.pos.x - e.pos.x, a.pos.z - e.pos.z) ? o : a));
  }
  return best;
}

function setOnWhere(e, pred, on) {
  for (const [, p] of e.parts) if (p.state !== 'detached' && pred(p.def)) p.on = on;
}

/** 이번 틱의 명령. 누르고 있는 것(hold)은 매 틱, 한 번 동작(once)은 대기열에서 하나씩 꺼내 쓴다. */
export function manualCommand(world, e) {
  const m = e.manual;
  const cmd = emptyCommand();
  const inp = m.input;
  cmd.throttle = inp.throttle;
  if (inp.aim !== null) cmd.turn = clamp(-wrapAngle(inp.aim - e.heading) * TURN_GAIN, -1, 1);

  // 한 번 동작
  const once = new Set(m.queue.splice(0, m.queue.length));
  const foes = enemiesOf(world, e);
  if (once.has('lock')) { // 다음 적으로 잠금 바꾸기
    const i = foes.findIndex((o) => o.id === m.lockId);
    m.lockId = foes.length ? foes[(i + 1) % foes.length].id : null;
  }
  if (once.has('unlock')) m.lockId = null;
  const target = pickTarget(world, e, inp.aim);
  cmd.targetId = target ? target.id : null;

  if (inp.hold.fire) {
    const uids = [];
    for (const uid of e.dyn?.working || []) { const p = e.parts.get(uid); if (p?.def?.category === 'weapon') uids.push(uid); }
    cmd.weapon.use = uids;
    cmd.weapon.hold = true;
  }
  if (inp.hold.overdrive) cmd.weapon.overdrive = true;

  // 방어(누르는 동안)
  const sets = [
    ['shield', (d) => d.shieldAbsorb !== undefined],
    ['intercept', (d) => d.interceptRange !== undefined],
    ['repair', (d) => d.repairPartPerSecond !== undefined],
  ];
  for (const [k, pred] of sets) {
    cmd.defense[k] = inp.hold[k] ? true : null;
    if (inp.hold[k] !== m.shown[k]) { setOnWhere(e, pred, inp.hold[k]); m.shown[k] = inp.hold[k]; }
  }
  if (once.has('phase')) cmd.defense.phase = true;
  const skills = e.skills || [];
  if (once.has('skill1') && skills[0]) cmd.defense.skill = skills[0].id;
  else if (once.has('skill2') && skills[1]) cmd.defense.skill = skills[1].id;

  // 특수
  if (once.has('transform')) cmd.special.transform = true;
  if (once.has('detach')) cmd.special.detach = [];

  // 고도: 한 층씩
  if (once.has('altUp') || once.has('altDown')) {
    const i = ALTITUDES.indexOf(e.altChange ? e.altChange.to : e.altitude);
    const j = clamp(i + (once.has('altUp') ? 1 : -1), 0, ALTITUDES.length - 1);
    cmd.altTarget = ALTITUDES[j];
  }

  // 변신 중에는 움직이거나 쏘지 못한다 (actions.js 와 같은 규칙)
  if (cmd.special.transform) { cmd.throttle = 0; cmd.turn = 0; cmd.weapon = emptyCommand().weapon; }
  return cmd;
}

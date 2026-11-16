// shared/sim/referee.js  (34번)
// 심판: 한 틱을 정해진 순서로 진행하고(명세 v1.0 9-1 [고정]), 승패를 판정한다(9-8 [고정]).
//
// 틱 순서: ① 판단(센서·태세·규칙→명령) ② 명령 적용(방어·각성기·무기 발사) ③ 물리 적분 ④ 충돌·투사체
//          ⑤ 피해 해결(발생 즉시 combat.js에서) ⑥ 에너지·투지·게이지·쿨다운 갱신 ⑦ 전장 이벤트
//          ⑧ 틱 종료 훅(서버: 융합·변신 판정) ⑨ 승패 판정 ⑩ 스냅샷
//
// 국면: countdown(개시 5초, 정지) → fight(제한시간 180초) → extension(동률 시 30초, 전장 급축소) → over
// 같은 설정·같은 시드면 항상 같은 결과다(시뮬레이션 안에서 Math.random 금지, world.rng만 사용).
// 화면 코드를 import하지 않습니다(서버와 브라우저 공용).

import { createWorld, teamHpRatio, pushEvent } from './world.js';
import { isDecisionTick, decideAll } from '../tactics/interpreter.js';
import { refreshDynamics, updateEnergy, beginTick, spendEnergy } from './energy.js';
import { stepPhysics } from './physics.js';
import { fireWeapons, stepProjectiles, stepEffects, stepWeaponTimers } from './weapons.js';
import { processRams, stepEnvironment, stepRepair, destroyPart } from './combat.js';
import { stepSpirit, useSkill } from './spirit.js';
import { makeSnapshot } from './snapshot.js';
import { uidsOfPartId } from './energy.js';

/**
 * 경기 만들기.
 * config: createWorld 설정 + { hooks: { onSpecial(world, entity, special), onTickEnd(world, match) }, onSnapshot(snap), onEnd(result) }
 */
export function createMatch(config) {
  const world = createWorld(config);
  const C = world.constants;
  return {
    world,
    status: 'running', // running | finished | aborted
    phase: 'countdown', // countdown | fight | extension | over
    countdownLeft: C.time.countdownSeconds,
    extensionEnd: null,
    hooks: config.hooks || {},
    onSnapshot: config.onSnapshot || null,
    onEnd: config.onEnd || null,
    snapshotEvery: Math.max(1, Math.round(C.time.physicsHz / C.time.streamHz)),
    ticksTotal: 0,
    result: null,
  };
}

// ── ② 명령 적용 중 방어·특수 ────────────────────────────
function applyCommands(world, match, e) {
  const t = world.time;
  const cmd = e.cmd;
  if (e.status.stunUntil > t || e.status.transformUntil > t) return;

  // 위상 전환기: 1.5초 무적, 쿨 20초, 소모 80(발동)
  if (cmd.defense.phase) {
    for (const uid of e.dyn.working) {
      const p = e.parts.get(uid);
      const d = p.def;
      if (!d.invulnSeconds || p.cooldown > 0) continue;
      if (!spendEnergy(e, d.power)) break;
      e.status.invulnUntil = t + d.invulnSeconds;
      p.cooldown = d.cooldown * e.mods.cooldown;
      pushEvent(world, { type: 'phase', entity: e.id, uid });
      break;
    }
    cmd.defense.phase = false; // 한 번만
  }
  // 각성기
  if (cmd.defense.skill) {
    useSkill(world, e, cmd.defense.skill);
    cmd.defense.skill = null;
  }
  // 분리: 지정한 파츠를 스스로 떼어낸다(빈 목록은 융합 해제 신호 → 서버 훅)
  const sp = cmd.special;
  if (sp.detach) {
    if (sp.detach.length === 0) match.hooks.onSpecial?.(world, e, { release: true });
    else for (const id of sp.detach) for (const uid of uidsOfPartId(e, id)) destroyPart(world, e, uid, null);
    sp.detach = null;
  }
  // 변신·융합 신호는 서버가 판정한다 (레시피가 비공개이므로 공용 코드에는 없다)
  if (sp.transform || sp.fusionSignal) {
    match.hooks.onSpecial?.(world, e, { transform: sp.transform, fusionSignal: sp.fusionSignal });
    sp.transform = false;
    sp.fusionSignal = false;
  }
}

// ── 한 틱 ───────────────────────────────────────────────
export function stepMatch(match) {
  if (match.status !== 'running') return match;
  const { world } = match;
  const C = world.constants;
  const dt = 1 / C.time.physicsHz;
  match.ticksTotal += 1;

  // 개시 카운트다운: 시간이 흐르지 않고 기체도 움직이지 않는다
  if (match.phase === 'countdown') {
    match.countdownLeft -= dt;
    if (match.countdownLeft <= 1e-9) {
      match.phase = 'fight';
      pushEvent(world, { type: 'start' });
    }
    emitSnapshot(match);
    return match;
  }

  // 융합 연출 중에는 모든 것이 멈춘다 (명세 12-5 [고정]). 서버 훅이 world.frozen을 켜고 끈다.
  if (world.frozen) {
    world.events = [];
    match.hooks.onTickEnd?.(world, match);
    emitSnapshot(match);
    return match;
  }

  world.time = world.tick * dt;
  world.events = [];
  const t = world.time;
  for (const e of world.entities) if (e.alive) refreshDynamics(e, t, world.terrain);

  // ① 판단
  if (isDecisionTick(world)) decideAll(world);
  // ② 명령 적용 + 무기 발사
  for (const e of world.entities) if (e.alive) applyCommands(world, match, e);
  fireWeapons(world, dt);
  // ③ 물리
  for (const e of world.entities) if (e.alive) refreshDynamics(e, t, world.terrain); // 위의 분리·EMP 반영
  stepPhysics(world, dt);
  // ④ 충돌·투사체  ⑤ 피해는 combat.js에서 발생 즉시 처리
  stepProjectiles(world, dt);
  stepEffects(world, dt);
  processRams(world);
  // ⑥ 에너지·투지·게이지·쿨다운
  stepRepair(world, dt);
  stepWeaponTimers(world, dt);
  for (const e of world.entities) {
    if (!e.alive) continue;
    updateEnergy(e, dt, C);
    beginTick(e);
  }
  stepSpirit(world, dt);
  // ⑦ 전장 이벤트
  world.time = t + dt; // 이번 틱의 끝 시각 기준으로 이벤트 판정
  stepEnvironment(world, dt);
  world.time = t;
  // ⑧ 틱 종료 훅
  match.hooks.onTickEnd?.(world, match);
  // ⑨ 승패
  judge(match);
  // ⑩ 스냅샷
  world.tick += 1;
  if (match.status === 'finished' || world.tick % match.snapshotEvery === 0) emitSnapshot(match);
  else collectEvents(world);
  return match;
}

// 사건 모으기: 스냅샷은 3틱마다 한 번이라, 그 사이 틱에서 생긴 사건이 사라지지 않게 보관했다가 스냅샷에 함께 싣는다.
function collectEvents(world) {
  if (world._evSrc !== world.events) { world._evSrc = world.events; world._evN = 0; }
  if (!world.evBuffer) world.evBuffer = [];
  for (let i = world._evN; i < world.events.length; i++) world.evBuffer.push(world.events[i]);
  world._evN = world.events.length;
}

function emitSnapshot(match) {
  const { world } = match;
  collectEvents(world);
  if (match.onSnapshot) match.onSnapshot(makeSnapshot(world, match));
  world.evBuffer = [];
}

// ── 승패 (명세 9-8 [고정]) ──────────────────────────────
function finish(match, winner, reason) {
  const { world } = match;
  match.status = 'finished';
  match.phase = 'over';
  world.over = true;
  const ratios = Object.fromEntries(world.teamIds.map((id) => [id, teamHpRatio(world, id)]));
  match.result = {
    winner, reason, ratios,
    duration: world.time + 1 / world.constants.time.physicsHz,
    ticks: world.tick + 1,
    entities: world.entities.map((e) => ({
      id: e.id, team: e.team, name: e.name, owner: e.owner, alive: e.alive, hp: Math.max(0, e.hp), maxHp: e.maxHp,
      damageDealt: e.stats.damageDealt, damageTaken: e.stats.damageTaken, partsLost: e.stats.partsLost, partsDestroyed: e.stats.partsDestroyed,
    })),
  };
  world.result = match.result;
  pushEvent(world, { type: 'end', winner, reason });
  match.onEnd?.(match.result);
}

function judge(match) {
  const { world } = match;
  const C = world.constants;
  const alive = Object.fromEntries(world.teamIds.map((id) => [id, world.entities.some((e) => e.team === id && e.alive)]));
  const [a, b] = world.teamIds;
  // 전멸전
  if (!alive[a] && !alive[b]) return finish(match, null, 'mutual_ko');
  if (!alive[a]) return finish(match, b, 'knockout');
  if (!alive[b]) return finish(match, a, 'knockout');

  const t = world.time + 1 / C.time.physicsHz;
  const compare = () => {
    const ra = teamHpRatio(world, a);
    const rb = teamHpRatio(world, b);
    return Math.abs(ra - rb) < 1e-9 ? null : ra > rb ? a : b;
  };
  if (match.phase === 'fight' && t >= C.time.matchSeconds) {
    const w = compare();
    if (w) return finish(match, w, 'time');
    // 동률: 연장전(경기장 급축소)
    match.phase = 'extension';
    match.extensionEnd = C.time.matchSeconds + C.time.extensionSeconds;
    if (C.match.extensionHazardShrink) world.terrain.startExtension(t);
    pushEvent(world, { type: 'extension' });
    return null;
  }
  if (match.phase === 'extension' && t >= match.extensionEnd) {
    const w = compare();
    return finish(match, w, w ? 'extension' : 'draw');
  }
  return null;
}

// 중단 (서버 재시작·지휘관 중단): 결과 없음
export function abortMatch(match, reason = 'aborted') {
  if (match.status !== 'running') return;
  match.status = 'aborted';
  match.phase = 'over';
  match.result = { winner: null, reason, aborted: true };
  match.onEnd?.(match.result);
}

/** 끝까지 돌려서 결과만 얻는다 (조율 센터의 매치업 매트릭스·테스트용). 스냅샷은 만들지 않는다. */
export function simulateMatch(config, opts = {}) {
  const match = createMatch({ ...config, onSnapshot: null });
  const T = match.world.constants.time;
  // 제한시간 + 연장 + 여유 5초까지
  const maxTicks = opts.maxTicks ?? Math.ceil((T.matchSeconds + T.extensionSeconds + 5) * T.physicsHz);
  match.countdownLeft = 0;
  match.phase = 'fight';
  while (match.status === 'running' && match.ticksTotal < maxTicks) stepMatch(match);
  if (match.status === 'running') abortMatch(match, 'max_ticks');
  return match;
}

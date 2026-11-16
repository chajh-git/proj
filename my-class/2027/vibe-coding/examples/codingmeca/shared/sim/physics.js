// shared/sim/physics.js  (28번)
// 이동·선회·고도 변경·벽 충돌·기체끼리 충돌. (명세 v1.0 9-1의 ②③④, 9-2, 9-3)
// 명령(cmd)을 속도로 바꾸고 위치를 적분한다. 피해는 직접 주지 않고 'ram' 사건을 world.events에 남긴다(combat.js가 처리).
// 화면 코드를 import하지 않습니다.
//
// 좌표·방향은 math.js 규약: heading 0 → 앞이 −z, 선회 입력 +1 = 오른쪽.
//   heading은 three.js rotation.y 와 같아서, 오른쪽으로 돌려면 heading이 줄어든다.

import { clamp, forwardFromHeading, v3len, deg2rad } from '../util/math.js';
import { ALT_INDEX, ALTITUDES, aptitudeEnv } from './world.js';

const MOVE_ALT_RANK = { ground: 0, low: 1, high: 2 };

// 이동 제압 여부 (스턴·변신·고도 변경·에너지 고갈·격파)
export function movementSuppressed(e, t) {
  return !e.alive || e.status.immobilizedUntil > t || e.altChange !== null || e.status.transformUntil > t;
}

// 고급 동작 '이동 기관 출력 %'를 추력 배율로
function thrustScale(e) {
  const pct = e.cmd.thrustPct;
  if (!pct) return 1;
  let total = 0;
  let scaled = 0;
  for (const uid of e.dyn.working) {
    const d = e.tree.nodes.get(uid).def;
    if (d.category !== 'mobility') continue;
    total += d.thrust;
    const p = pct[d.id];
    scaled += d.thrust * (p === undefined ? 1 : p / 100);
  }
  return total > 0 ? scaled / total : 1;
}

// 이 기체가 이동할 수 있는 최고 고도층이 target 이상인가
function canReachAltitude(e, target) {
  return MOVE_ALT_RANK[e.dyn.stats.move.maxAltitude] >= MOVE_ALT_RANK[target];
}

function updateAltitude(world, e, t) {
  const C = world.constants.physics;
  if (e.altChange) {
    if (t >= e.altChange.until) {
      e.altitude = e.altChange.to;
      e.altChange = null;
    }
    return;
  }
  const want = e.cmd.altTarget;
  if (!want || want === e.altitude || !e.dyn.stats.move.canMove) return;
  // 한 번에 한 층씩
  const dir = Math.sign(ALT_INDEX[want] - ALT_INDEX[e.altitude]);
  const next = ALTITUDES[ALT_INDEX[e.altitude] + dir];
  if (dir > 0 && !canReachAltitude(e, next)) return;
  e.altChange = { to: next, until: t + C.altitudeChangeSeconds };
}

// 한 기체의 속도·위치를 dt초 진행
function moveEntity(world, e, dt) {
  const t = world.time;
  const C = world.constants.physics;
  const terrain = world.terrain;
  updateAltitude(world, e, t);

  const mv = e.dyn.stats.move;
  const env = aptitudeEnv(world, e);
  const per = mv.byEnv[env];
  const suppressed = movementSuppressed(e, t) || e.dyn.energyDepleted || !mv.canMove;
  const throttle = suppressed ? 0 : clamp(e.cmd.throttle, -1, 1);
  const turnIn = suppressed ? 0 : clamp(e.cmd.turn, -1, 1);
  e.moveInput = { throttle, turn: turnIn };

  // 선회: 목표 각속도로 부드럽게 접근. 오른쪽(+1)은 heading 감소.
  const tscale = thrustScale(e);
  const turnRate = deg2rad(mv.turn) * e.mods.turn * (suppressed ? 0 : 1);
  const targetAng = -turnIn * turnRate;
  e.angVel += (targetAng - e.angVel) * Math.min(1, C.turnResponse * dt);
  e.heading += e.angVel * dt;

  // 전후 이동: 접지(마찰)가 낮을수록 속도를 바꾸기 어렵다
  const maxSpeed = per.maxSpeed * e.dyn.speedMult * e.mods.speed * tscale;
  const accel = per.accel * e.mods.accel * e.dyn.eta * tscale;
  const f = forwardFromHeading(e.heading);
  const speedCap = throttle >= 0 ? maxSpeed : maxSpeed * C.reverseSpeedMult;
  const desired = { x: f.x * throttle * speedCap, z: f.z * throttle * speedCap };
  const grip = clamp(terrain.friction, 0.05, 1.5);
  let dvx = desired.x - e.vel.x;
  let dvz = desired.z - e.vel.z;
  const dvLen = Math.hypot(dvx, dvz);
  const maxDv = accel * grip * dt;
  if (dvLen > maxDv && dvLen > 1e-9) {
    dvx = (dvx / dvLen) * maxDv;
    dvz = (dvz / dvLen) * maxDv;
  }
  e.vel.x += dvx;
  e.vel.z += dvz;
  // 구동력이 없을 때의 자연 감속(바닥 마찰)
  if (throttle === 0 || accel === 0) {
    const drag = Math.max(0, 1 - 0.8 * grip * dt);
    e.vel.x *= drag;
    e.vel.z *= drag;
  }
  // 최고속 초과분(충돌 반동 등)은 서서히 줄인다
  const sp = Math.hypot(e.vel.x, e.vel.z);
  const hardCap = Math.max(maxSpeed, 1) * 3;
  if (sp > hardCap) {
    e.vel.x *= hardCap / sp;
    e.vel.z *= hardCap / sp;
  }

  e.pos.x += e.vel.x * dt;
  e.pos.z += e.vel.z * dt;
  confine(world, e);
}

// 전장 경계와 벽: 중심이 경계 안쪽 margin 이상 떨어지게 한다
function confine(world, e) {
  const { terrain } = world;
  const r = e.bodyRadius;
  const hx = terrain.halfW - r;
  const hz = terrain.halfD - r;
  if (e.pos.x > hx) { e.pos.x = hx; if (e.vel.x > 0) e.vel.x = -e.vel.x * 0.2; }
  if (e.pos.x < -hx) { e.pos.x = -hx; if (e.vel.x < 0) e.vel.x = -e.vel.x * 0.2; }
  if (e.pos.z > hz) { e.pos.z = hz; if (e.vel.z > 0) e.vel.z = -e.vel.z * 0.2; }
  if (e.pos.z < -hz) { e.pos.z = -hz; if (e.vel.z < 0) e.vel.z = -e.vel.z * 0.2; }
  // 벽(사각 장애물) 밀어내기
  for (const o of terrain.obstacles) {
    const cx = clamp(e.pos.x, o.min.x, o.max.x);
    const cz = clamp(e.pos.z, o.min.z, o.max.z);
    let dx = e.pos.x - cx;
    let dz = e.pos.z - cz;
    let dist = Math.hypot(dx, dz);
    if (dist >= r) continue;
    if (dist < 1e-6) {
      // 중심이 벽 안: 가까운 면으로 빼낸다
      const left = e.pos.x - o.min.x;
      const right = o.max.x - e.pos.x;
      const up = e.pos.z - o.min.z;
      const down = o.max.z - e.pos.z;
      const m = Math.min(left, right, up, down);
      if (m === left) { dx = -1; dz = 0; } else if (m === right) { dx = 1; dz = 0; } else if (m === up) { dx = 0; dz = -1; } else { dx = 0; dz = 1; }
      dist = 1;
    }
    const nx = dx / dist;
    const nz = dz / dist;
    e.pos.x = cx + nx * r + (dist === 1 && cx === e.pos.x ? 0 : 0);
    e.pos.z = cz + nz * r;
    const vn = e.vel.x * nx + e.vel.z * nz;
    if (vn < 0) { e.vel.x -= vn * nx * 1.2; e.vel.z -= vn * nz * 1.2; }
  }
}

// 적 기체끼리 충돌 (같은 고도층만). 아군끼리는 시작 간격이 좁아도 겹쳐 시작할 수 있으므로 충돌하지 않는다.
function collideEntities(world) {
  const C = world.constants.physics;
  const list = world.entities.filter((e) => e.alive);
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i];
      const b = list[j];
      if (a.team === b.team || a.altitude !== b.altitude) continue;
      const dx = b.pos.x - a.pos.x;
      const dz = b.pos.z - a.pos.z;
      const dist = Math.hypot(dx, dz);
      const min = a.bodyRadius + b.bodyRadius;
      if (dist >= min) continue;
      const nx = dist > 1e-6 ? dx / dist : 1;
      const nz = dist > 1e-6 ? dz / dist : 0;
      const ma = Math.max(1, a.dyn.weight);
      const mb = Math.max(1, b.dyn.weight);
      // 겹침 풀기: 가벼운 쪽이 더 많이 밀린다
      const push = min - dist;
      a.pos.x -= nx * push * (mb / (ma + mb));
      a.pos.z -= nz * push * (mb / (ma + mb));
      b.pos.x += nx * push * (ma / (ma + mb));
      b.pos.z += nz * push * (ma / (ma + mb));
      // 서로 다가오는 속도(법선 방향)
      const vn = (a.vel.x - b.vel.x) * nx + (a.vel.z - b.vel.z) * nz;
      if (vn <= 0) continue;
      const e = C.restitution * world.terrain.bounceMult;
      const j2 = ((1 + e) * vn) / (1 / ma + 1 / mb);
      a.vel.x -= (j2 / ma) * nx;
      a.vel.z -= (j2 / ma) * nz;
      b.vel.x += (j2 / mb) * nx;
      b.vel.z += (j2 / mb) * nz;
      if (vn > C.ramThresholdSpeed) {
        const over = vn - C.ramThresholdSpeed;
        world.events.push({
          type: 'ram', tick: world.tick, time: world.time, a: a.id, b: b.id, speed: vn,
          // 상대의 질량이 내게 부딪친다: 피해 = (상대속도 − 4) × 상대 질량 × 0.05
          damageToA: over * mb * C.ramDamageFactor,
          damageToB: over * ma * C.ramDamageFactor,
          point: { x: a.pos.x + nx * a.bodyRadius, z: a.pos.z + nz * a.bodyRadius },
        });
      }
    }
  }
}

/** 물리 한 틱: 모든 기체 이동 → 충돌. 기체 상태가 바뀌었을 때(파츠 이탈 등)는 호출 전에 refreshDynamics가 되어 있어야 한다. */
export function stepPhysics(world, dt) {
  for (const e of world.entities) {
    if (!e.alive) {
      e.vel.x *= 0.9;
      e.vel.z *= 0.9;
      continue;
    }
    moveEntity(world, e, dt);
  }
  collideEntities(world);
}

export const speedOf = (e) => Math.hypot(e.vel.x, e.vel.z);
export { v3len };

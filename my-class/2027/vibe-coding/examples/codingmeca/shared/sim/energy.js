// shared/sim/energy.js  (30번)
// 기체의 '지금 상태'를 계산한다: 어떤 파츠가 작동 중인가, 전력 효율, 에너지 소모, 무게·추력 등의 현재값.
// (명세 v1.0 5-4, 6장, 9-4의 7). 화면 코드를 import하지 않습니다.
//
// 파츠 런타임 상태 (entity.parts: Map uid → part)
//   { uid, partId, def, state: 'ok'|'broken'|'detached', durability, maxDurability,
//     disabledUntil, on, cooldown, ammo, heat }
//
// 작동 조건 = 이탈하지 않음 + 파손 아님 + 켜져 있음 + 정지(스턴·EMP) 아님 + 활성 형태 + 전력 도달
//   전력 도달: 설계상 홉 규칙(assembly)을 만족하고, 경로의 전력 중계 케이블이 작동 중일 것.
// 계산 결과는 entity.dyn 에 담긴다. 틱마다 refreshDynamics를 부르면 된다(몇십 개 파츠라 가볍다).

import { activeSet } from '../build/assembly.js';
import { computeStatsFromTree } from '../build/stats.js';
import { clamp } from '../util/math.js';

// 파츠가 제 기능을 할 수 있는 상태인가 (전력·형태는 따로 본다)
export function partUsable(part, t) {
  return part.state === 'ok' && part.disabledUntil <= t && part.on !== false;
}

// 작동 중인 파츠 uid 집합과 EMP 상태
export function computeWorking(entity, t, terrain) {
  const { tree } = entity;
  const act = activeSet(tree, entity.form);
  const stormOn = Boolean(terrain?.empActive(t));
  const working = new Set();
  const carries = new Map(); // uid → 이 노드 아래로 전력이 이어지는가

  // 1차: 전자 정지를 빼고 계산 → EMP 방호막이 서 있는지 확인
  const pass = (empBlocks) => {
    working.clear();
    carries.clear();
    for (const uid of tree.order) {
      const node = tree.nodes.get(uid);
      const part = entity.parts.get(uid);
      if (!part || part.state === 'detached') continue;
      const parentCarries = node.parent ? carries.get(node.parent.uid) === true : true;
      const usable = partUsable(part, t) && !(empBlocks && node.def.electronic);
      const isFixed = node.def.category === 'core' || node.def.category === 'structure';
      const ok = isFixed || usable;
      // 중계 케이블이 멈추면 그 아래로는 전력이 가지 않는다
      carries.set(uid, parentCarries && !(node.relay && !ok));
      if (parentCarries && node.powered && act.has(uid) && ok) working.add(uid);
    }
  };
  pass(false);
  const immune = [...working].some((uid) => tree.nodes.get(uid).def.empImmune) || entity.status?.empImmuneUntil > t;
  const blocks = (stormOn && !immune) || entity.status?.empUntil > t;
  if (blocks) pass(true);
  return { working, empBlocked: blocks };
}

/**
 * 현재 상태 계산 → entity.dyn
 * dyn: { working:Set, present:Set, stats, output, capacity, eta, draw, empBlocked, energyDepleted,
 *        sensorInfo: Map(info → range|null), speedMult }
 */
export function refreshDynamics(entity, t, terrain) {
  const present = new Set();
  for (const [uid, p] of entity.parts) if (p.state !== 'detached') present.add(uid);
  const { working, empBlocked } = computeWorking(entity, t, terrain);
  const stats = computeStatsFromTree(entity.tree, {
    form: entity.form, pilot: entity.design?.pilot, layout: entity.layout, presentSet: present, workingSet: working,
  });
  const prev = entity.dyn || {};

  // 센서 정보: 정보 키 → 가장 먼 범위 (범위 null = 무제한, 통신기)
  const sensorInfo = new Map();
  for (const uid of working) {
    const def = entity.tree.nodes.get(uid).def;
    if (def.category !== 'sensor') continue;
    for (const key of def.info || []) {
      const cur = sensorInfo.get(key);
      const range = def.range ?? null;
      if (cur === undefined) sensorInfo.set(key, range);
      else if (cur !== null && (range === null || range > cur)) sensorInfo.set(key, range);
    }
  }

  const capacity = stats.power.capacity;
  entity.maxEnergy = capacity;
  entity.energy = Math.min(entity.energy, capacity);
  entity.dyn = {
    working, present, stats, empBlocked, sensorInfo,
    output: stats.power.output,
    capacity,
    weight: stats.weight,
    stealthActive: stats.stealthActive,
    speedMult: stats.speedMult,
    eta: prev.eta ?? 1,
    draw: prev.draw ?? 0,
    energyDepleted: entity.energy <= 0,
  };
  return entity.dyn;
}

// 이번 틱에 '사용 중'이었던 파츠 기록 (무기 발사, 방어 동작 등이 호출)
export function beginTick(entity) {
  entity.used = new Set();
}
export function markUsed(entity, uid) {
  (entity.used ||= new Set()).add(uid);
}

/**
 * 에너지 갱신: 순간 소모 D를 구하고 효율 η = min(1, P÷D)로 정한 뒤 에너지를 줄인다.
 * 이동 소모 = 이동 기관 소모 × |스로틀| × (무게 ÷ 50)  (명세 6장)
 */
export function updateEnergy(entity, dt, constants) {
  const dyn = entity.dyn;
  const idle = constants.power.idleDrawFactor;
  const divisor = constants.stats.moveEnergyWeightDivisor;
  const throttle = Math.abs(entity.cmd?.throttle ?? 0);
  let draw = 0;
  for (const uid of dyn.working) {
    const node = entity.tree.nodes.get(uid);
    const d = node.def;
    if (!(d.power > 0)) continue;
    if (d.category === 'mobility') {
      draw += d.power * Math.max(idle, throttle) * (dyn.weight / divisor);
    } else if (d.drain === 'always') {
      draw += d.power;
    } else {
      draw += d.power * (entity.used?.has(uid) ? 1 : idle);
    }
  }
  dyn.draw = draw;
  dyn.eta = draw > 0 ? Math.min(1, dyn.output / draw) : 1;
  const spent = Math.min(draw, dyn.output) * dt;
  entity.energy = Math.max(0, entity.energy - spent);
  dyn.energyDepleted = entity.energy <= 0;
  entity.stats.energySpent += spent;
  return spent;
}

// 단발 사용 비용(무기 1회, 위상 전환 등): 가능하면 차감하고 true
export function spendEnergy(entity, amount) {
  if (entity.energy < amount) return false;
  entity.energy -= amount;
  entity.stats.energySpent += amount;
  entity.dyn.energyDepleted = entity.energy <= 0;
  return true;
}

// 에너지 비율 0~100
export const energyPct = (entity) => (entity.maxEnergy > 0 ? clamp((entity.energy / entity.maxEnergy) * 100, 0, 100) : 0);

// 작동 중인 파츠 중 조건에 맞는 것의 uid 목록
export function workingParts(entity, predicate = () => true) {
  const out = [];
  for (const uid of entity.dyn.working) {
    const node = entity.tree.nodes.get(uid);
    if (predicate(node.def, node, entity.parts.get(uid))) out.push(uid);
  }
  return out;
}

// 파츠 ID(예: 'wp_fang')에 해당하는 이 기체의 uid들 (이탈한 것 제외)
export function uidsOfPartId(entity, partId) {
  const out = [];
  for (const [uid, p] of entity.parts) if (p.partId === partId && p.state !== 'detached') out.push(uid);
  return out;
}

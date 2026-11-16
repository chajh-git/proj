// shared/tactics/sensors.js  (22번)
// 센서 정보 레벨 (명세 v1.0 11-4). 기체는 '진실'이 아니라 '자기가 알 수 있는 만큼'만 보고 판단한다.
//  - 센서 없음: 거리 구간(근/중/원)과 방향 8방. 아군 체력은 상/중/하.
//  - 센서 있음: 센서 범위 안에서 수치와 추가 정보. 센서가 파손되면 즉시 기본 수준으로 돌아간다
//    (energy.refreshDynamics가 작동 중인 센서만 dyn.sensorInfo에 넣는다).
//  - 은신: 열감지·양자 센서(stealth_reveal)가 범위 안에서 간파한다.
//  - 벽: 시야가 막히면 센서 수치는 못 얻고 기본 정보(구간·8방)만 남는다. 소나(through_walls)는 범위 안에서 벽 너머를 본다.
// 화면 코드를 import하지 않습니다.

import { wrapAngle, forwardFromHeading } from '../util/math.js';
import { BEARING8 } from './schema.js';
import { energyPct } from '../sim/energy.js';

const SECTOR = Math.PI / 4;

// 관찰자 기준으로 target이 어느 쪽에 있는가 (오른쪽 +, 앞 0)
export function relativeBearing(observer, target) {
  const dx = target.pos.x - observer.pos.x;
  const dz = target.pos.z - observer.pos.z;
  const f = forwardFromHeading(observer.heading);
  const right = { x: Math.cos(observer.heading), z: -Math.sin(observer.heading) };
  return Math.atan2(dx * right.x + dz * right.z, dx * f.x + dz * f.z);
}

export const bearingIndex = (bearing) => ((Math.round(bearing / SECTOR) % 8) + 8) % 8;
export const bearingKey = (bearing) => BEARING8[bearingIndex(bearing)];
// 방향 8방의 중심 각도 (센서 없이 조향할 때 쓰는 거친 값)
export const sectorCenter = (bearing) => wrapAngle(Math.round(bearing / SECTOR) * SECTOR);

// 이 기체가 info 정보를 distance(m)에서 읽을 수 있는가
export function hasInfo(observer, info, distance) {
  const m = observer.dyn.sensorInfo;
  if (!m.has(info)) return false;
  const range = m.get(info);
  return range === null || distance <= range;
}

export function distanceBand(distance, constants) {
  const b = constants.tactics.rangeBand;
  return distance < b.near ? 'near' : distance <= b.mid ? 'mid' : 'far';
}

export function hpBand(pct, constants) {
  const c = constants.tactics.allyHpBandCuts;
  return pct > c.high ? 'high' : pct > c.mid ? 'mid' : 'low';
}

// 거리 추정치: 센서가 있으면 정확한 값, 없으면 구간의 중간값
export function estimatedDistance(p, constants) {
  return p.distance ?? constants.tactics.bandMidpoint[p.band];
}

// 부위 손상 정보 요약 (enemy_part_state 필요): 파손·이탈한 기능 파츠 수, 무기 사용 여부
function partSummary(target, t) {
  let damaged = 0;
  let weaponActive = false;
  for (const p of target.parts.values()) {
    if (p.def.category === 'core' || p.def.category === 'structure') continue;
    if (p.state !== 'ok') damaged += 1;
    else if (p.maxDurability && p.durability / p.maxDurability < 1) damaged += 0.5;
  }
  if (target.used) {
    for (const uid of target.used) if (target.parts.get(uid)?.def.category === 'weapon') weaponActive = true;
  }
  if (target.lastWeaponAt !== undefined && t - target.lastWeaponAt < 1) weaponActive = true;
  return { damaged, weaponActive };
}

/**
 * 관찰자가 대상을 어떻게 인식하는가.
 * 반환 perception:
 *  { id, team, isAlly, alive, detected, blocked?(벽에 가림), reason?, band, distance|null, bearing(rad), bearingExact, bearing8,
 *    altitude, hpPct|null, hpBand, energyPct|null, spirit|null, damagedParts|null, weaponActive|null }
 */
export function perceive(world, observer, target) {
  const C = world.constants;
  const t = world.time;
  const isAlly = observer.team === target.team;
  const trueDist = Math.hypot(target.pos.x - observer.pos.x, target.pos.z - observer.pos.z);
  const bearing = relativeBearing(observer, target);
  const base = {
    id: target.id, team: target.team, isAlly, alive: target.alive, detected: true,
    band: distanceBand(trueDist, C), bearing8: bearingKey(bearing), altitude: target.altitude,
    distance: null, bearing: sectorCenter(bearing), bearingExact: false,
    hpPct: null, hpBand: null, energyPct: null, spirit: null, damagedParts: null, weaponActive: null,
  };

  if (!isAlly) {
    // 은신: 간파하는 센서가 범위 안에 있어야 보인다
    const stealthy = target.dyn.stealthActive && target.status.stealthBrokenUntil <= t;
    if (stealthy && !hasInfo(observer, 'stealth_reveal', trueDist)) return { ...base, detected: false, reason: 'stealth' };
    // 벽: 시야가 막히면 센서 수치는 얻지 못하고 기본 정보(거리 구간·방향 8방)만 남는다. 소나는 벽 너머를 본다.
    if (world.terrain.blocksSensors && world.terrain.segmentBlocked(observer.pos.x, observer.pos.z, target.pos.x, target.pos.z)) {
      const sonar = world.terrain.sonarSeesThrough && hasInfo(observer, 'through_walls', trueDist);
      if (!sonar) return { ...base, blocked: true, hpBand: hpBand(Math.max(0, (target.hp / target.maxHp) * 100), C) };
    }
  }

  const hpPct = target.maxHp > 0 ? Math.max(0, (target.hp / target.maxHp) * 100) : 0;
  base.hpBand = hpBand(hpPct, C);

  if (isAlly) {
    // 아군은 통신기(ally_precise)가 있으면 정밀 정보
    if (hasInfo(observer, 'ally_precise', trueDist)) {
      base.distance = trueDist;
      base.bearing = bearing;
      base.bearingExact = true;
      base.hpPct = hpPct;
      base.energyPct = energyPct(target);
      base.spirit = target.spirit;
    }
    return base;
  }

  if (hasInfo(observer, 'enemy_distance', trueDist)) base.distance = trueDist;
  if (hasInfo(observer, 'enemy_bearing', trueDist)) {
    base.bearing = bearing;
    base.bearingExact = true;
  }
  if (hasInfo(observer, 'enemy_hp_pct', trueDist)) base.hpPct = hpPct;
  if (hasInfo(observer, 'enemy_energy_pct', trueDist)) base.energyPct = energyPct(target);
  if (hasInfo(observer, 'enemy_spirit', trueDist)) base.spirit = target.spirit;
  if (hasInfo(observer, 'enemy_part_state', trueDist)) {
    const s = partSummary(target, t);
    base.damagedParts = s.damaged;
    base.weaponActive = s.weaponActive;
  }
  return base;
}

// 한 기체가 보는 모든 다른 기체의 인식 (한 판단 틱에 한 번 계산해 재사용)
export function perceiveAll(world, observer) {
  const out = new Map();
  for (const o of world.entities) {
    if (o === observer) continue;
    out.set(o.id, perceive(world, observer, o));
  }
  return out;
}

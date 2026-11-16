// shared/sim/weapons.js  (32번)
// 무장: 명령(cmd.weapon)을 읽어 발사·접촉 피해·투사체·지속 효과·오버드라이브를 처리한다 (명세 v1.0 7-8, 7-9, 9-2, 9-6).
// 조준은 '진짜 상태'로 판정한다(인식이 아니라 실제 위치). 화면 코드를 import하지 않습니다.
//
// 발사 조건: 작동 중 + 쿨다운 0 + 사거리 + 장착 방향 각도 + 고도층 + 시야(벽) + 에너지
//  - 근접: 같은 고도층만. 플라즈마: 같은 층+인접층. 그 밖(미사일·레이저·범위)은 층 무관.
//  - 사거리는 '무기 위치 → 상대 몸 가장자리' 기준(상대 충돌 반경 × bodyReachFactor를 더한다).
//  - 단발 1회 비용 = 소모 × 1초(spendEnergy). 접촉·지속 무기는 사용 중 소모(markUsed).

import { rotateY, forwardFromHeading, clamp } from '../util/math.js';
import { WORLD_DIR } from '../build/assembly.js';
import { markUsed, spendEnergy } from './energy.js';
import { ALT_INDEX, pushEvent } from './world.js';
import { applyDamage, applyEmp, disablePart, pickHitPart } from './combat.js';
import { attackMult, canOverdrive, overdriveParts } from './spirit.js';

const DEG = Math.PI / 180;

// ── 기하 보조 ───────────────────────────────────────────
export function partWorldPos(e, uid) {
  const c = e.layout.items.get(uid).center;
  const r = rotateY({ x: c.x, y: 0, z: c.z }, e.heading);
  return { x: e.pos.x + r.x, z: e.pos.z + r.z };
}

// 파츠가 향한 수평 방향(월드). 위/아래 장착은 기체 앞으로 본다.
export function mountDirection(e, uid) {
  const key = e.layout.items.get(uid).outKey;
  const v = key === 'up' || key === 'down' ? WORLD_DIR.front : WORLD_DIR[key];
  const w = rotateY({ x: v.x, y: 0, z: v.z }, e.heading);
  return { x: w.x, z: w.z };
}

const angleBetween = (a, b) => {
  const la = Math.hypot(a.x, a.z) || 1;
  const lb = Math.hypot(b.x, b.z) || 1;
  return Math.acos(clamp((a.x * b.x + a.z * b.z) / (la * lb), -1, 1));
};

const edgeReach = (world, target) => target.radius * world.constants.combat.bodyReachFactor;
const distTo = (from, target) => Math.hypot(target.pos.x - from.x, target.pos.z - from.z);

function arcFor(world, d) {
  const c = world.constants.combat;
  return (d.canHitRear ? c.rearArcDeg : d.homing ? c.missileArcDeg : c.aimArcDeg) * DEG;
}

function layerOk(e, target, d) {
  const dz = Math.abs(ALT_INDEX[e.altitude] - ALT_INDEX[target.altitude]);
  if (d.melee) return dz === 0;
  if (d.id === 'wp_plasma') return dz <= 1;
  return true;
}

function sightOk(world, from, target, d) {
  const T = world.terrain;
  const blocked = (d.hitscan && T.blocksLaser) || ((d.id === 'wp_plasma' || d.id === 'wp_rail') && T.blocksStraightProjectiles);
  return !blocked || !T.segmentBlocked(from.x, from.z, target.pos.x, target.pos.z);
}

// 한 무기가 지금 target을 맞힐 수 있는가
function canEngage(world, e, uid, d, target, { needArc = true } = {}) {
  const from = partWorldPos(e, uid);
  if (distTo(from, target) > d.range + edgeReach(world, target)) return false;
  if (!layerOk(e, target, d)) return false;
  if (needArc) {
    const to = { x: target.pos.x - from.x, z: target.pos.z - from.z };
    if (angleBetween(mountDirection(e, uid), to) > arcFor(world, d)) return false;
  }
  return sightOk(world, from, target, d);
}

const enemiesAlive = (world, e) => world.entities.filter((o) => o.alive && o.team !== e.team);

const damageScale = (world, e) => attackMult(world, e) * clamp(e.dyn.eta, 0.2, 1);

// 무기를 쓸 수 없는 상태인가 (정지·스턴·변신·에너지 고갈)
function weaponsLocked(world, e) {
  return e.status.stunUntil > world.time || e.status.transformUntil > world.time || e.dyn.energyDepleted;
}

// ── 투사체 ──────────────────────────────────────────────
function spawnProjectile(world, e, uid, d, target, extra = {}) {
  const from = partWorldPos(e, uid);
  const dx = target.pos.x - from.x;
  const dz = target.pos.z - from.z;
  const len = Math.hypot(dx, dz) || 1;
  const speed = d.projectileSpeed ?? world.constants.combat.projectileSpeedDefault;
  const pr = {
    id: world.nextProjectileId++, owner: e.id, team: e.team, partId: d.id, kind: d.id,
    x: from.x, z: from.z, vx: (dx / len) * speed, vz: (dz / len) * speed, speed,
    damage: d.damage * damageScale(world, e), damageType: d.damageType,
    homing: Boolean(d.homing), interceptable: Boolean(d.interceptable), targetId: target.id,
    life: world.constants.combat.projectileLifeSeconds, ...extra,
  };
  world.projectiles.push(pr);
  pushEvent(world, { type: 'projectile', id: pr.id, kind: pr.kind, owner: e.id, x: pr.x, z: pr.z });
  return pr;
}

export function stepProjectiles(world, dt) {
  const C = world.constants.combat;
  const T = world.terrain;
  const keep = [];
  for (const p of world.projectiles) {
    const owner = world.byId.get(p.owner);
    p.life -= dt;
    if (p.life <= 0) continue;
    if (p.homing) {
      const tg = world.byId.get(p.targetId);
      if (tg && tg.alive) {
        const dx = tg.pos.x - p.x;
        const dz = tg.pos.z - p.z;
        const l = Math.hypot(dx, dz) || 1;
        p.vx = (dx / l) * p.speed;
        p.vz = (dz / l) * p.speed;
      }
    }
    p.x += p.vx * dt;
    p.z += p.vz * dt;
    if (Math.abs(p.x) > T.halfW + 2 || Math.abs(p.z) > T.halfD + 2) continue;
    if (T.blocksStraightProjectiles && !p.homing && T.obstacles.some((o) => p.x >= o.min.x && p.x <= o.max.x && p.z >= o.min.z && p.z <= o.max.z)) {
      pushEvent(world, { type: 'projectile_blocked', id: p.id, x: p.x, z: p.z });
      continue;
    }
    // 요격: 적 요격기가 사거리 안의 요격 가능 투사체를 격추
    let gone = false;
    if (p.interceptable) {
      for (const o of world.entities) {
        if (!o.alive || o.team === p.team) continue;
        for (const uid of o.dyn.working) {
          const part = o.parts.get(uid);
          const d = part.def;
          if (!d.interceptRange || part.ammo <= 0 || part.cooldown > 0) continue;
          if (Math.hypot(p.x - o.pos.x, p.z - o.pos.z) > d.interceptRange) continue;
          part.ammo -= 1;
          part.cooldown = d.cooldown * o.mods.cooldown;
          markUsed(o, uid);
          pushEvent(world, { type: 'intercepted', id: p.id, by: o.id, x: p.x, z: p.z });
          gone = true;
          break;
        }
        if (gone) break;
      }
    }
    if (gone) continue;
    // 명중
    let hit = null;
    for (const o of world.entities) {
      if (!o.alive || o.team === p.team) continue;
      if (Math.hypot(p.x - o.pos.x, p.z - o.pos.z) <= C.projectileHitRadius + o.radius * C.bodyReachFactor) { hit = o; break; }
    }
    if (hit) {
      if (world.rng.chance(hit.mods.dodge)) {
        pushEvent(world, { type: 'dodged', entity: hit.id, projectile: p.id });
      } else {
        applyDamage(world, { attacker: owner, victim: hit, amount: p.damage, type: p.damageType, origin: { x: p.x, z: p.z } });
      }
      continue;
    }
    keep.push(p);
  }
  world.projectiles = keep;
}

// ── 지속 효과: 중력 끌림·중독 ───────────────────────────
export function stepEffects(world, dt) {
  const t = world.time;
  const keep = [];
  for (const fx of world.effects) {
    const target = world.byId.get(fx.target);
    if (!target || !target.alive || t >= fx.until) continue;
    if (fx.type === 'pull') {
      target.vel.x = fx.vx;
      target.vel.z = fx.vz;
    } else if (fx.type === 'poison' && t >= fx.nextAt) {
      fx.nextAt += fx.tickSeconds;
      const cands = [];
      for (const [uid, p] of target.parts) {
        if (p.state !== 'detached' && p.maxDurability) cands.push(uid);
      }
      if (cands.length) {
        const uid = cands[Math.floor(world.rng.next() * cands.length)];
        applyDamage(world, { attacker: world.byId.get(fx.owner), victim: target, amount: fx.perTick, type: 'poison', origin: null, partUid: uid, ignoreArmor: true, noTransfer: true });
      }
    }
    keep.push(fx);
  }
  world.effects = keep;
  void dt;
}

// ── 쿨다운·열 (틱 순서 ⑥) ──────────────────────────────
export function stepWeaponTimers(world, dt) {
  const t = world.time;
  for (const e of world.entities) {
    for (const p of e.parts.values()) {
      if (p.cooldown > 0) p.cooldown = Math.max(0, p.cooldown - dt);
      if (p.def.heatCoolPerSecond && p.heat > 0) p.heat = Math.max(0, p.heat - p.def.heatCoolPerSecond * dt);
    }
    void t;
  }
}

// ── 한 발 쏘기 ──────────────────────────────────────────
function fireOnce(world, e, uid, p, d, target) {
  const t = world.time;
  const cdOverride = e.cmd.weapon.interval[uid] || 0;
  const cooldown = Math.max(d.cooldown * e.mods.cooldown, cdOverride);
  const scale = damageScale(world, e);
  const from = partWorldPos(e, uid);
  const markFired = () => {
    p.cooldown = cooldown;
    e.lastWeaponAt = t;
    e.status.stealthBrokenUntil = t + (e.dyn.stats.stealthActive ? 3 : 0);
    pushEvent(world, { type: 'fire', entity: e.id, uid, weapon: d.id, target: target.id });
  };
  const spend = () => spendEnergy(e, d.power * world.constants.power.singleShotSeconds);

  // 발사 종류별
  if (d.disablePartSeconds) { // 스턴 건: 적중 파츠 1개 정지
    if (!spend()) return false;
    let uidHit = null;
    for (let i = 0; i < 6 && !uidHit; i++) {
      const cand = applyPick(world, target, from);
      if (cand && target.parts.get(cand).maxDurability) uidHit = cand;
    }
    if (uidHit) disablePart(world, target, uidHit, d.disablePartSeconds);
    markFired();
    return true;
  }
  if (d.disableElectronicsSeconds) { // EMP 펄스: 범위 안의 모든 적
    if (!spend()) return false;
    for (const o of enemiesAlive(world, e)) {
      if (distTo(from, o) <= d.range + edgeReach(world, o)) applyEmp(world, o, d.disableElectronicsSeconds);
    }
    markFired();
    return true;
  }
  if (d.pullSpeed) { // 중력 포
    if (!spend()) return false;
    const dx = target.pos.x - e.pos.x;
    const dz = target.pos.z - e.pos.z;
    const l = Math.hypot(dx, dz) || 1;
    const push = l < world.constants.combat.gravPushRange ? 1 : -1;
    world.effects.push({ type: 'pull', target: target.id, vx: (dx / l) * d.pullSpeed * push, vz: (dz / l) * d.pullSpeed * push, until: t + d.pullSeconds });
    applyDamage(world, { attacker: e, victim: target, amount: d.damage * scale, type: d.damageType, origin: from });
    markFired();
    return true;
  }
  if (d.tickSeconds) { // 나노봇: 중독
    if (!spend()) return false;
    world.effects.push({ type: 'poison', target: target.id, owner: e.id, tickSeconds: d.tickSeconds, perTick: d.partDurabilityPerTick, nextAt: t + d.tickSeconds, until: t + d.durationSeconds });
    markFired();
    return true;
  }
  if (d.projectile) { // 플라즈마·미사일
    if (!spend()) return false;
    if (d.ammo !== undefined && d.ammo !== null) {
      if (p.ammo <= 0) return false;
      p.ammo -= 1;
    }
    spawnProjectile(world, e, uid, d, target);
    if (d.heatPerShot) {
      p.heat += d.heatPerShot;
      if (p.heat >= d.heatMax) p.heatLockedUntil = t + d.overheatLockSeconds;
    }
    markFired();
    return true;
  }
  if (d.cone) { // 브레스: 지속 시작 (피해는 stepContinuous)
    p.activeUntil = t + d.durationSeconds;
    markFired();
    return true;
  }
  // 근접 단발·레이저
  if (!spend()) return false;
  applyDamage(world, { attacker: e, victim: target, amount: d.damage * scale, type: d.damageType, origin: from });
  if (d.immobilizeSeconds) target.status.immobilizedUntil = Math.max(target.status.immobilizedUntil, t + d.immobilizeSeconds);
  if (d.recoverySeconds) p.recoveryUntil = t + d.recoverySeconds;
  markFired();
  return true;
}

const applyPick = (world, target, origin) => pickHitPart(world, target, origin);

// 레일건: 충전 후 직선 관통
function fireRail(world, e, uid, p, d, target) {
  const t = world.time;
  const from = partWorldPos(e, uid);
  const dx = target.pos.x - from.x;
  const dz = target.pos.z - from.z;
  const l = Math.hypot(dx, dz) || 1;
  const dir = { x: dx / l, z: dz / l };
  const width = world.constants.combat.railWidth / 2;
  const scale = damageScale(world, e);
  for (const o of enemiesAlive(world, e)) {
    const rx = o.pos.x - from.x;
    const rz = o.pos.z - from.z;
    const along = rx * dir.x + rz * dir.z;
    const lateral = Math.abs(rx * dir.z - rz * dir.x);
    if (along < 0 || along > d.range + edgeReach(world, o)) continue;
    if (lateral > width + edgeReach(world, o)) continue;
    applyDamage(world, { attacker: e, victim: o, amount: d.damage * scale, type: d.damageType, origin: from });
  }
  p.chargeT = 0;
  p.cooldown = d.cooldown * e.mods.cooldown;
  e.lastWeaponAt = t;
  pushEvent(world, { type: 'rail', entity: e.id, uid, x: from.x, z: from.z, dx: dir.x, dz: dir.z, length: d.range });
}

// ── 무기 발사 처리 (틱 순서 ②) ──────────────────────────
export function fireWeapons(world, dt) {
  const t = world.time;
  for (const e of world.entities) {
    if (!e.alive) continue;
    const cmd = e.cmd.weapon;
    const target = e.cmd.targetId ? world.byId.get(e.cmd.targetId) : null;
    const locked = weaponsLocked(world, e);

    if (cmd.overdrive && !locked) tryOverdrive(world, e);

    for (const uid of e.dyn.working) {
      const p = e.parts.get(uid);
      const d = p.def;
      if (d.category !== 'weapon') continue;
      const wantsUse = cmd.use.includes(uid);
      const wantsCharge = cmd.charge.includes(uid);

      // 충전식(레일건): 쓰거나 충전 명령이 있는 동안 모은다
      if (d.chargeSeconds) {
        if (!locked && (wantsUse || wantsCharge) && p.cooldown <= 0) {
          p.chargeT = Math.min(d.chargeSeconds, (p.chargeT || 0) + dt);
          markUsed(e, uid);
          if (wantsUse && p.chargeT >= d.chargeSeconds && target && target.alive && canEngage(world, e, uid, d, target)) fireRail(world, e, uid, p, d, target);
        } else {
          p.chargeT = 0;
        }
        continue;
      }

      if (!wantsUse || locked || !target || !target.alive) {
        p.contactT = 0;
        continue;
      }

      // 접촉·지속 무기(스피너): 닿아 있는 동안 초당 피해
      if (d.contact) {
        if (canEngage(world, e, uid, d, target)) {
          markUsed(e, uid);
          e.lastWeaponAt = t;
          applyDamage(world, { attacker: e, victim: target, amount: d.damagePerSecond * dt * damageScale(world, e), type: d.damageType, origin: partWorldPos(e, uid) });
          if (d.flipIntervalSeconds) {
            p.contactT = (p.contactT || 0) + dt;
            if (p.contactT >= d.flipIntervalSeconds) {
              p.contactT = 0;
              target.status.immobilizedUntil = Math.max(target.status.immobilizedUntil, t + d.flipImmobilizeSeconds);
              pushEvent(world, { type: 'flip', entity: target.id, by: e.id });
            }
          }
        } else p.contactT = 0;
        continue;
      }

      if (p.cooldown > 0 || p.heatLockedUntil > t || (p.recoveryUntil || 0) > t) continue;
      if (d.ammo !== undefined && d.ammo !== null && p.ammo <= 0) continue;
      const needArc = !d.area;
      if (d.area ? distTo(partWorldPos(e, uid), target) > d.range + edgeReach(world, target) : !canEngage(world, e, uid, d, target, { needArc })) continue;
      fireOnce(world, e, uid, p, d, target);
    }

    // 브레스 지속 피해
    for (const uid of e.dyn.working) {
      const p = e.parts.get(uid);
      const d = p.def;
      if (!d.cone || !(p.activeUntil > t)) continue;
      markUsed(e, uid);
      const from = partWorldPos(e, uid);
      const mount = mountDirection(e, uid);
      const half = world.constants.combat.breathHalfAngleDeg * DEG;
      for (const o of enemiesAlive(world, e)) {
        if (distTo(from, o) > d.range + edgeReach(world, o)) continue;
        if (angleBetween(mount, { x: o.pos.x - from.x, z: o.pos.z - from.z }) > half + 0.05) continue;
        if (!sightOk(world, from, o, d)) continue;
        applyDamage(world, { attacker: e, victim: o, amount: d.damagePerSecond * dt * damageScale(world, e), type: d.damageType, origin: from });
      }
    }

    // 초가속 돌진: 접촉 피해(대상당 1회)
    if (e.status.rushUntil > t) {
      e.status.rushHit ??= new Set();
      for (const o of enemiesAlive(world, e)) {
        if (e.status.rushHit.has(o.id) || e.altitude !== o.altitude) continue;
        if (Math.hypot(o.pos.x - e.pos.x, o.pos.z - e.pos.z) <= e.bodyRadius + o.bodyRadius) {
          e.status.rushHit.add(o.id);
          applyDamage(world, { attacker: e, victim: o, amount: e.status.rushDamage * attackMult(world, e), type: 'physical', origin: { x: e.pos.x, z: e.pos.z } });
        }
      }
    }
  }
}

// ── 오버드라이브 (게이지 100 소모) ───────────────────────
export function tryOverdrive(world, e) {
  if (!canOverdrive(world, e)) return false;
  const uid = overdriveParts(e)[0];
  const d = e.parts.get(uid).def;
  const t = world.time;
  const scale = attackMult(world, e);
  if (d.energyCost && !spendEnergy(e, d.energyCost)) return false;
  e.gauge = 0;
  e.lastWeaponAt = t;
  pushEvent(world, { type: 'overdrive', entity: e.id, uid, weapon: d.id });
  const from = { x: e.pos.x, z: e.pos.z };
  if (d.line) { // 소멸포: 전방 직선
    const f = forwardFromHeading(e.heading);
    for (const o of enemiesAlive(world, e)) {
      const rx = o.pos.x - from.x;
      const rz = o.pos.z - from.z;
      const along = rx * f.x + rz * f.z;
      const lateral = Math.abs(rx * f.z - rz * f.x);
      const r = edgeReach(world, o);
      if (along < 0 || along > d.line.length + r || lateral > d.line.width / 2 + r) continue;
      applyDamage(world, { attacker: e, victim: o, amount: d.damage * scale, type: d.damageType, origin: from });
    }
  } else if (d.radius) { // 광역 폭발: 자신 제외
    for (const o of enemiesAlive(world, e)) {
      if (distTo(from, o) <= d.radius + edgeReach(world, o)) applyDamage(world, { attacker: e, victim: o, amount: d.damage * scale, type: d.damageType, origin: from });
    }
  } else if (d.contactDamage) { // 초가속 돌진
    e.status.rushUntil = t + d.durationSeconds;
    e.status.rushSpeedMult = d.speedMult;
    e.status.rushDamage = d.contactDamage;
    e.status.rushHit = new Set();
  }
  return true;
}

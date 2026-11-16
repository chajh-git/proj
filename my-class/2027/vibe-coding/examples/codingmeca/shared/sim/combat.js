// shared/sim/combat.js  (31번)
// 피해 해결 (명세 v1.0 9-4 [고정]): 실드 → 피격 광선으로 맞는 파츠 결정 → 파츠·기체 체력 피해 → 파손·이탈 연쇄 → 격파·부활.
// 환경 피해(위험구역·운석·함정)와 충돌 피해, 수리·자가수복도 여기서 처리한다. 화면 코드를 import하지 않습니다.
//
// 피해 종류: physical | energy | emp | poison   (emp는 applyEmp, 나머지는 applyDamage)
// 결과: { total(효과적 피해 합), hp, absorbed, partUid, destroyed:[uid], ko }

import { descendantsOf } from '../build/assembly.js';
import { rayAabb, rotateY, clamp } from '../util/math.js';
import { refreshDynamics } from './energy.js';
import { pushEvent } from './world.js';
import { onDamageDealt, onDamageTaken, onPartKill, onPartLost, consumeUnyielding } from './spirit.js';

const NO_RESULT = Object.freeze({ total: 0, hp: 0, absorbed: 0, partUid: null, destroyed: [], ko: false });

// ── 피격 광선: 공격 원점에서 기체 중심을 향해, 기체 높이 범위의 무작위 높이로 쏜다 ──
export function pickHitPart(world, victim, origin) {
  const { layout } = victim;
  const present = [];
  for (const [uid, it] of layout.items) if (victim.parts.get(uid).state !== 'detached') present.push([uid, it]);
  if (present.length === 0) return victim.tree.root.uid;
  if (!origin) return victim.tree.root.uid;

  const dx = origin.x - victim.pos.x;
  const dz = origin.z - victim.pos.z;
  const len = Math.hypot(dx, dz);
  const world2local = (v) => rotateY(v, -victim.heading);
  const dirLocal = len > 1e-6 ? world2local({ x: dx / len, y: 0, z: dz / len }) : { x: 0, y: 0, z: -1 };
  const b = layout.bounds;
  const cx = (b.min.x + b.max.x) / 2;
  const cz = (b.min.z + b.max.z) / 2;
  const reach = Math.max(b.max.x - b.min.x, b.max.z - b.min.z) + 3;
  const start = { x: cx + dirLocal.x * reach, y: 0, z: cz + dirLocal.z * reach };
  const dir = { x: -dirLocal.x, y: 0, z: -dirLocal.z };
  const hLen = Math.hypot(dir.x, dir.z) || 1;
  dir.x /= hLen;
  dir.z /= hLen;
  for (let tries = 0; tries < 6; tries++) {
    start.y = world.rng.range(b.min.y, b.max.y);
    let bestT = Infinity;
    let best = null;
    for (const [uid, it] of present) {
      const t = rayAabb(start, dir, it.box, reach * 2);
      if (t !== null && t < bestT) {
        bestT = t;
        best = uid;
      }
    }
    if (best) return best;
  }
  return victim.tree.root.uid; // 모두 빗나가면 코어(몸통)가 맞은 것으로
}

// ── 체력 감소와 격파·부활 ──────────────────────────────
export function damageHp(world, victim, amount, attacker = null) {
  if (!victim.alive || amount <= 0) return false;
  victim.hp -= amount;
  if (victim.hp > 0) return false;
  // 불굴 각성 → 재생 코어 → 격파
  if (consumeUnyielding(world, victim)) return false;
  const regen = [...victim.parts.values()].find((p) => p.def.reviveHpPct && p.state === 'ok' && (p.revives ??= p.def.reviveCount) > 0);
  if (regen) {
    regen.revives -= 1;
    victim.hp = victim.maxHp * regen.def.reviveHpPct;
    victim.status.immobilizedUntil = Math.max(victim.status.immobilizedUntil, world.time + regen.def.reviveStunSeconds);
    victim.status.stunUntil = world.time + regen.def.reviveStunSeconds;
    pushEvent(world, { type: 'revive', entity: victim.id });
    return false;
  }
  victim.hp = 0;
  victim.alive = false;
  victim.defeatedAt = world.time;
  victim.cmd.throttle = 0;
  victim.cmd.turn = 0;
  pushEvent(world, { type: 'ko', entity: victim.id, by: attacker ? attacker.id : null });
  return true;
}

// ── 파츠 이탈 (하위 파츠 연쇄) ─────────────────────────
export function destroyPart(world, victim, uid, attacker = null) {
  const node = victim.tree.nodes.get(uid);
  if (!node || node.def.category === 'core' || node.def.category === 'structure') return [];
  const uids = [uid, ...descendantsOf(victim.tree, uid)].filter((u) => victim.parts.get(u).state !== 'detached');
  for (const u of uids) {
    const p = victim.parts.get(u);
    p.state = 'detached';
    p.durability = 0;
  }
  refreshDynamics(victim, world.time, world.terrain);
  victim.maxHp = victim.dyn.stats.hp; // 떨어져 나간 구조체의 체력 보너스가 줄어든다
  victim.hp = Math.min(victim.hp, victim.maxHp);
  pushEvent(world, { type: 'part_lost', entity: victim.id, part: node.partId, uids, by: attacker ? attacker.id : null });
  onPartKill(world, attacker);
  onPartLost(world, victim);
  return uids;
}

// ── 피해 한 건 ─────────────────────────────────────────
/**
 * o: { attacker, victim, amount, type, origin:{x,z}|null, ignoreArmor?, partUid?(지정 파츠), noTransfer? }
 */
export function applyDamage(world, o) {
  const { attacker, victim, type } = o;
  const C = world.constants.damage;
  const t = world.time;
  if (!victim.alive || !(o.amount > 0)) return NO_RESULT;
  if (victim.status.invulnUntil > t) {
    pushEvent(world, { type: 'blocked', entity: victim.id, by: attacker?.id ?? null });
    return NO_RESULT;
  }
  let amount = o.amount * victim.mods.damageTaken;
  let absorbed = 0;

  // 실드: 물리·에너지 피해를 전방위로 흡수
  if (type !== 'poison') {
    for (const uid of victim.dyn.working) {
      const p = victim.parts.get(uid);
      if (!p.def.shieldAbsorb) continue;
      p.shieldHp ??= p.def.shieldAbsorb;
      if (p.shieldHp <= 0) continue;
      const take = Math.min(amount, p.shieldHp);
      p.shieldHp -= take;
      amount -= take;
      absorbed += take;
      if (p.shieldHp <= 0) {
        p.disabledUntil = t + p.def.rebootSeconds;
        pushEvent(world, { type: 'shield_break', entity: victim.id, uid });
      }
      break; // 실드는 하나만 쓴다
    }
  }

  let partUid = o.partUid ?? null;
  let hpDamage = 0;
  let partDamage = 0;
  const destroyed = [];
  if (amount > 0) {
    partUid ??= pickHitPart(world, victim, o.origin);
    const part = victim.parts.get(partUid);
    const def = part.def;
    if (def.category === 'core' || def.category === 'structure') {
      hpDamage = amount; // 경감 없이 기체 체력에 직접
    } else {
      let reduce = 0;
      if (def.category === 'armor' && !o.ignoreArmor && type !== 'poison') reduce = def.reduce?.[type] ?? 0;
      if (def.absorbFirstHit && !part.absorbedFirst && type !== 'poison') {
        part.absorbedFirst = true; // 반응 장갑: 첫 피격 1회 완전 흡수
        pushEvent(world, { type: 'absorbed', entity: victim.id, uid: partUid });
        amount = 0;
      }
      partDamage = amount * (1 - reduce);
      part.durability = Math.max(0, part.durability - partDamage);
      if (!o.noTransfer && type !== 'poison') hpDamage = partDamage * C.transferRatio; // 충격 전달 25%
      if (part.durability <= 0) destroyed.push(...destroyPart(world, victim, partUid, attacker));
      else if (part.state === 'ok' && part.durability <= part.maxDurability * C.brokenThreshold) {
        part.state = 'broken';
        pushEvent(world, { type: 'part_broken', entity: victim.id, uid: partUid, part: part.partId });
      }
    }
  }

  const total = absorbed + (partDamage || hpDamage);
  const ko = damageHp(world, victim, hpDamage, attacker);
  pushEvent(world, {
    type: 'hit', attacker: attacker?.id ?? null, victim: victim.id, uid: partUid, damageType: type,
    amount: total, hp: hpDamage, absorbed, destroyed: destroyed.length > 0,
  });
  if (attacker && attacker !== victim) onDamageDealt(world, attacker, total);
  onDamageTaken(world, victim, total);
  if (attacker) {
    // 공격하면 은신이 잠시 풀린다
    attacker.status.stealthBrokenUntil = t + 3;
  }
  return { total, hp: hpDamage, absorbed, partUid, destroyed, ko };
}

// 경감·광선 없이 기체 체력에 직접 (환경·충돌)
export function damageDirect(world, victim, amount, { attacker = null, source = 'env' } = {}) {
  if (!victim.alive || !(amount > 0) || victim.status.invulnUntil > world.time) return 0;
  const a = amount * victim.mods.damageTaken;
  const ko = damageHp(world, victim, a, attacker);
  if (attacker && attacker !== victim) onDamageDealt(world, attacker, a);
  onDamageTaken(world, victim, a);
  if (ko || a >= 1) pushEvent(world, { type: 'direct', victim: victim.id, amount: a, source });
  return a;
}

// ── EMP·정지 ───────────────────────────────────────────
export function applyEmp(world, victim, seconds) {
  const immune = [...victim.dyn.working].some((u) => victim.tree.nodes.get(u).def.empImmune);
  if (immune) {
    pushEvent(world, { type: 'emp_resisted', entity: victim.id });
    return false;
  }
  victim.status.empUntil = Math.max(victim.status.empUntil, world.time + seconds);
  pushEvent(world, { type: 'emp', entity: victim.id, seconds });
  return true;
}

export function disablePart(world, victim, uid, seconds) {
  const p = victim.parts.get(uid);
  if (!p || p.state === 'detached') return false;
  p.disabledUntil = Math.max(p.disabledUntil, world.time + seconds);
  pushEvent(world, { type: 'part_disabled', entity: victim.id, uid, seconds });
  return true;
}

// ── 충돌 피해: physics.js가 남긴 ram 사건 처리 ──────────
export function processRams(world) {
  for (const ev of world.events) {
    if (ev.type !== 'ram' || ev.handled) continue;
    ev.handled = true;
    const a = world.byId.get(ev.a);
    const b = world.byId.get(ev.b);
    damageDirect(world, a, ev.damageToA, { attacker: b, source: 'ram' });
    damageDirect(world, b, ev.damageToB, { attacker: a, source: 'ram' });
  }
}

// ── 환경 피해 (틱 순서 ⑦) ──────────────────────────────
export function stepEnvironment(world, dt) {
  const t = world.time;
  const { terrain } = world;
  const alts = world.constants.combat.envHitAltitudes;
  for (const e of world.entities) {
    if (!e.alive) continue;
    for (const h of terrain.hazardsAt(e.pos.x, e.pos.z, e.altitude, t)) damageDirect(world, e, h.dps * dt, { source: h.kind });
  }
  for (const ev of terrain.eventsBetween(t - dt, t)) {
    pushEvent(world, { type: ev.kind === 'meteor' ? 'meteor_impact' : 'spikes_fire', x: ev.x, z: ev.z, radius: ev.radius });
    const allowed = alts[ev.kind] || ['ground'];
    for (const e of world.entities) {
      if (!e.alive || !allowed.includes(e.altitude)) continue;
      if (Math.hypot(e.pos.x - ev.x, e.pos.z - ev.z) <= ev.radius + e.radius * 0.5) damageDirect(world, e, ev.damage, { source: ev.kind });
    }
  }
}

// ── 수리·자가수복·실드 재가동 (틱 순서 ⑥) ──────────────
export function stepRepair(world, dt) {
  const t = world.time;
  const brokenAt = world.constants.damage.brokenThreshold;
  const heal = (e, p, amount) => {
    p.durability = Math.min(p.maxDurability, p.durability + amount);
    if (p.state === 'broken' && p.durability > p.maxDurability * brokenAt) p.state = 'ok';
  };
  for (const e of world.entities) {
    if (!e.alive) continue;
    for (const p of e.parts.values()) {
      if (p.def.shieldAbsorb && p.shieldHp !== undefined && p.shieldHp <= 0 && p.disabledUntil <= t && p.state === 'ok') p.shieldHp = p.def.shieldAbsorb; // 재가동
    }
    for (const uid of e.dyn.working) {
      const p = e.parts.get(uid);
      const d = p.def;
      if (d.selfRepairPerSecond && p.maxDurability) heal(e, p, d.selfRepairPerSecond * dt);
      if (d.repairPartPerSecond) {
        let worst = null;
        let ratio = 1;
        for (const q of e.parts.values()) {
          if (q.state === 'detached' || !q.maxDurability) continue;
          const r = q.durability / q.maxDurability;
          if (r < ratio) { ratio = r; worst = q; }
        }
        if (worst) heal(e, worst, d.repairPartPerSecond * dt);
        e.hp = Math.min(e.maxHp, e.hp + (d.repairHpPerSecond || 0) * dt);
      }
    }
  }
}

export { clamp };

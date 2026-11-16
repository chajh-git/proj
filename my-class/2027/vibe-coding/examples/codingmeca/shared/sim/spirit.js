// shared/sim/spirit.js  (33번)
// 투지·오버드라이브 게이지·조종사 성향·각성기 (명세 v1.0 9-5, 9-6, 9-7).
// 투지는 공격·가속·회피에 배율을 주고(mods), 파츠(증폭기·안정기·회로·축전기)와 성향이 변동량을 곱한다.
// 화면 코드를 import하지 않습니다.

import { clamp } from '../util/math.js';
import { PILOT_SKILLS } from '../../data/pilot-skills.js';
import { pushEvent } from './world.js';

// ── 변동량 배율 ─────────────────────────────────────────
function gainMult(world, e) {
  const sp = world.constants.spirit;
  let m = e.dyn.stats.spirit.gainMult; // 파츠(곱 → 상한)
  if (e.temperament === 'composed') m *= sp.temperament.composed.changeMult;
  return m;
}
function lossMult(world, e) {
  const sp = world.constants.spirit;
  let m = e.dyn.stats.spirit.lossMult; // 파츠(곱 → 하한)
  if (e.temperament === 'composed') m *= sp.temperament.composed.changeMult;
  if (e.temperament === 'fervent') m *= sp.temperament.fervent.lossMult;
  return m;
}

export function addSpirit(world, e, amount) {
  if (amount === 0) return;
  const adj = amount > 0 ? amount * gainMult(world, e) : amount * lossMult(world, e);
  e.spirit = clamp(e.spirit + adj, 0, e.spiritMax);
}

// ── 배율 ────────────────────────────────────────────────
// 공격력 배율 = 1 + 0.2 × (투지−50) ÷ 50, 열혈은 투지 ≥ 70에서 +5%
export function attackMult(world, e) {
  const sp = world.constants.spirit;
  let m = 1 + (sp.attackSwing * (e.spirit - sp.start)) / (sp.baseMax / 2);
  if (e.temperament === 'fervent' && e.spirit >= sp.temperament.fervent.threshold) m += sp.temperament.fervent.attackBonus;
  return m * e.mods.attack;
}

// ── 사건 훅 (combat.js가 호출) ──────────────────────────
export function onDamageDealt(world, attacker, amount) {
  if (!attacker || amount <= 0) return;
  const sp = world.constants.spirit;
  const g = world.constants.gauge;
  addSpirit(world, attacker, sp.gainOnDamageDealt);
  attacker.gauge = clamp(attacker.gauge + amount * g.chargeOnDealt * attacker.dyn.stats.gauge.chargeMult, 0, g.max);
  attacker.stats.damageDealt += amount;
  attacker.stats.lastDealtAt = world.time;
}

export function onDamageTaken(world, victim, amount) {
  if (amount <= 0) return;
  const sp = world.constants.spirit;
  const g = world.constants.gauge;
  addSpirit(world, victim, -amount / sp.lossOnHitDivisor);
  victim.gauge = clamp(victim.gauge + amount * g.chargeOnTaken * victim.dyn.stats.gauge.chargeMult, 0, g.max);
  victim.stats.damageTaken += amount;
  victim.stats.lastHitAt = world.time;
}

export function onPartKill(world, attacker) {
  if (attacker) {
    addSpirit(world, attacker, world.constants.spirit.gainOnPartKill);
    attacker.stats.partsDestroyed += 1;
  }
}

// 아군(자신 포함) 파츠 이탈: 같은 팀 모든 생존 기체의 투지 −10
export function onPartLost(world, owner) {
  const loss = world.constants.spirit.lossOnAllyPartLost;
  owner.stats.partsLost += 1;
  for (const e of world.entities) if (e.team === owner.team && e.alive) addSpirit(world, e, -loss);
}

export function onFusionSuccess(world, e) {
  addSpirit(world, e, world.constants.spirit.gainOnFusion);
}

// ── 각성기 ──────────────────────────────────────────────
export function skillActive(e, id, t) {
  return e.skills.some((s) => s.id === id && s.activeUntil > t);
}

export function useSkill(world, e, skillId) {
  const t = world.time;
  const sk = e.skills.find((s) => s.id === skillId);
  const def = (world.skillDefs || PILOT_SKILLS)[skillId];
  if (!sk || !def || def.kind === 'passive' || sk.usesLeft <= 0 || e.spirit < def.spiritCost) return false;
  if (def.kind === 'timed' && sk.activeUntil > t) return false;
  sk.usesLeft -= 1;
  e.spirit = clamp(e.spirit - def.spiritCost, 0, e.spiritMax); // 발동 비용은 성향·부품 배율을 받지 않는다
  if (def.kind === 'timed') sk.activeUntil = t + def.durationSeconds;
  if (def.kind === 'instant' && def.effect.healHpPct) e.hp = Math.min(e.maxHp, e.hp + e.maxHp * def.effect.healHpPct);
  pushEvent(world, { type: 'skill', entity: e.id, skill: skillId });
  return true;
}

// 불굴 각성: 체력 0이 되는 피해를 1회 무효 (combat.js의 격파 판정에서 호출)
export function consumeUnyielding(world, e) {
  const sk = e.skills.find((s) => s.id === 'unyielding' && s.usesLeft > 0);
  if (!sk) return false;
  sk.usesLeft = 0;
  e.hp = (world.skillDefs || PILOT_SKILLS).unyielding.effect.leaveHp;
  pushEvent(world, { type: 'skill', entity: e.id, skill: 'unyielding' });
  return true;
}

// ── 오버드라이브 ────────────────────────────────────────
export function overdriveParts(e) {
  const out = [];
  for (const uid of e.dyn.working) if (e.tree.nodes.get(uid).def.category === 'overdrive') out.push(uid);
  return out;
}
export const hasOverdrive = (e) => e.tree.order.some((uid) => e.parts.get(uid).state !== 'detached' && e.tree.nodes.get(uid).def.category === 'overdrive');
export const canOverdrive = (world, e) => e.gauge >= world.constants.gauge.max && overdriveParts(e).length > 0;

// ── 매 틱 갱신 (틱 순서 ⑥) ──────────────────────────────
export function stepSpirit(world, dt) {
  const sp = world.constants.spirit;
  const t = world.time;
  for (const e of world.entities) {
    if (!e.alive) continue;
    e.spiritMax = e.dyn.stats.spirit.max;
    // 한동안 피격·명중이 없으면 초당 +1
    const quiet = t - Math.max(e.stats.lastHitAt, e.stats.lastDealtAt);
    if (quiet >= sp.idleThresholdSeconds) addSpirit(world, e, sp.idleGainPerSecond * dt);
    e.spirit = clamp(e.spirit, 0, e.spiritMax);
    e.gauge = clamp(e.gauge, 0, world.constants.gauge.max);

    // 투지와 각성기·병기 효과를 배율에 반영
    const swing = (e.spirit - sp.start) / (sp.baseMax / 2);
    const m = e.mods;
    m.accel = 1 + sp.accelSwing * swing;
    m.dodge = sp.dodgeMax * clamp(e.spirit / sp.baseMax, 0, 1) + (e.temperament === 'intuitive' ? sp.temperament.intuitive.dodgeBonus : 0);
    m.speed = 1;
    m.damageTaken = 1;
    m.cooldown = 1;
    for (const sk of e.skills) {
      if (sk.activeUntil <= t) continue;
      const fx = (world.skillDefs || PILOT_SKILLS)[sk.id].effect;
      if (fx.speedMult) m.speed *= fx.speedMult;
      if (fx.damageTakenMult) m.damageTaken *= fx.damageTakenMult;
      if (fx.dodgeBonus) m.dodge += fx.dodgeBonus;
      if (fx.cooldownMult) m.cooldown *= fx.cooldownMult;
    }
    if (e.status.rushUntil > t) m.speed *= e.status.rushSpeedMult || 1;
    m.dodge = clamp(m.dodge, 0, 0.9);
  }
}

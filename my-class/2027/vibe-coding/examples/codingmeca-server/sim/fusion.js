// server/sim/fusion.js  (78번)  — 비공개: 융합·변신·각성 판정. 공개 저장소에 넣지 않는다. (명세 12장)
//
//   const fx = createFusionManager({ recipes: loader.recipes, matchId, onCinematic, onCodex, constants });
//   createMatch({ ..., hooks: fx.hooks })            // hooks = { onSpecial, onTickEnd }
//   fx.state                                          // 진행 중 융합·연출 상태(관제용, 레시피 내용은 들어 있지 않음)
//
// 구현 방식(1차): 융합체는 '몸은 따로, 운명은 하나'로 다룬다.
//   · 구성원 체력·최대체력에 레시피 체력 배율을 곱하고, 공격·이동·피해·쿨다운 배율을 적용한다.
//   · 구성원 충돌 반경은 최대 반경 × 1.3. 구성원 하나가 격파되면 융합체 전원이 격파된다(12-2).
//   · 해제 조건: 지속시간 종료 / 에너지 풀 ≤ 5% / 체력 풀 ≤ 15% / 전술의 '분리' 동작. 해제 때 체력은 구성원 최대 체력 비율로, 에너지는 균등 분배. 재융합 쿨 60초.
//   · 발동 즉시 world.frozen 을 켜서 모든 틱·시계를 멈추고, 연출 길이 + 재개 카운트다운이 지나면 서버가 스스로 재개한다(12-5).
//   · 같은 틱에 여러 팀이 만족하면 팀 ID 순서로 큐 처리(연출을 하나씩).

import { CONSTANTS } from '#config/constants.js';
import { pushEvent } from '#shared/sim/world.js';
import { spendEnergy, refreshDynamics } from '#shared/sim/energy.js';
import { usesForms } from '#shared/build/assembly.js';

const alivePartDefs = (e) => [...e.parts.values()].filter((p) => p.state !== 'detached').map((p) => p.def);
const dist = (a, b) => Math.hypot(a.pos.x - b.pos.x, a.pos.z - b.pos.z);

function tagCounts(e) {
  const out = {};
  for (const d of alivePartDefs(e)) for (const t of d.tags || []) out[t] = (out[t] || 0) + 1;
  return out;
}

// 구성원 한 기가 구성원 조건 하나를 만족하는가
export function memberMatches(e, cond) {
  const tc = tagCounts(e);
  for (const [tag, n] of Object.entries(cond.tags || {})) if ((tc[tag] || 0) < n) return false;
  if (cond.form && cond.form !== 'any' && e.form !== cond.form) return false;
  if (cond.requiredParts?.length) {
    const have = new Set(alivePartDefs(e).map((d) => d.id));
    if (!cond.requiredParts.every((id) => have.has(id))) return false;
  }
  const ratio = e.maxHp > 0 ? e.hp / e.maxHp : 0;
  const [lo, hi] = cond.hpRange || [0, 1];
  return ratio >= lo - 1e-9 && ratio <= hi + 1e-9;
}

// 후보 중 size 기를 고르는 모든 조합
function combos(list, size) {
  const out = [];
  const rec = (start, acc) => {
    if (acc.length === size) { out.push([...acc]); return; }
    for (let i = start; i < list.length; i++) { acc.push(list[i]); rec(i + 1, acc); acc.pop(); }
  };
  rec(0, []);
  return out;
}
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  return arr.flatMap((x, i) => permutations([...arr.slice(0, i), ...arr.slice(i + 1)]).map((p) => [x, ...p]));
}

/** 레시피를 만족하는 구성원 목록을 찾는다(없으면 null). 큰 조합을 먼저 찾는다. */
export function findMembers(world, recipe, candidates) {
  const t = world.time;
  const cm = recipe.common;
  if (cm.mapIds.length && !cm.mapIds.includes(world.map?.id)) return null;
  for (let size = Math.min(recipe.maxMembers, candidates.length); size >= recipe.minMembers; size--) {
    for (const group of combos(candidates, size)) {
      if (group.some((e) => e.spirit < cm.spiritMin || e.gauge < cm.gaugeMin)) continue;
      let far = false;
      for (let i = 0; i < group.length && !far; i++) for (let j = i + 1; j < group.length; j++) if (dist(group[i], group[j]) > cm.distanceMax) { far = true; break; }
      if (far) continue;
      if (cm.requireSignal && group.some((e) => t - e.ai.fusionSignalAt > cm.signalWindowSeconds)) continue;
      const mc = recipe.memberConditions;
      const ok = mc.length === 1
        ? group.every((e) => memberMatches(e, mc[0]))
        : permutations(group).some((perm) => perm.every((e, i) => memberMatches(e, mc[Math.min(i, mc.length - 1)])));
      if (ok) return group;
    }
  }
  return null;
}

export function createFusionManager({ recipes = [], matchId = null, onCinematic = () => {}, onCodex = () => {}, constants = CONSTANTS, log = () => {} } = {}) {
  const FC = constants.fusion;
  const TC = constants.transform;
  const groups = []; // 진행 중 융합체
  const queue = []; // 대기 중 발동 { recipe, ids, teamId }
  const flips = []; // 기본 변신: 형태 바꿈 예약 { id, at }
  let cinematic = null; // { ticksLeft, resumeTicks, phase }
  let nextGroup = 1;
  const found = new Set(); // 이 경기에서 이미 도감에 올린 레시피

  const state = { get groups() { return groups.map((g) => ({ id: g.id, team: g.team, members: g.members.map((m) => m.id), until: g.until })); }, get cinematic() { return cinematic ? { ...cinematic } : null; }, get queued() { return queue.length; } };

  const fusedIds = () => new Set(groups.flatMap((g) => g.members.map((m) => m.id)));

  // ── 융합 시작 ───────────────────────────────────────────
  function activate(world, item) {
    const members = item.ids.map((id) => world.byId.get(id)).filter((e) => e && e.alive);
    const R = item.recipe;
    if (members.length < R.minMembers) return false;
    const r = R.result;
    const saved = members.map((e) => ({ id: e.id, hp: e.hp, maxHp: e.maxHp, bodyRadius: e.bodyRadius, mods: { ...e.mods } }));
    const maxR = Math.max(...members.map((e) => e.bodyRadius));
    for (const e of members) {
      e.maxHp *= r.hpMult;
      e.hp *= r.hpMult;
      e.mods.attack *= r.attackMult;
      e.mods.speed *= r.speedMult;
      e.mods.accel *= r.speedMult;
      e.mods.cooldown *= r.cooldownMult;
      e.mods.damageTaken /= r.reduceMult; // 경감 배율 > 1 이면 덜 맞는다
      e.bodyRadius = maxR * FC.radiusMult;
      e.fusionGroup = nextGroup;
      e.ai.fusionSignalAt = -Infinity;
    }
    const g = { id: nextGroup++, team: item.teamId, recipeId: R.id, members, saved, result: r, until: world.time + r.durationSeconds };
    groups.push(g);
    pushEvent(world, { type: 'fusion_start', entities: members.map((e) => e.id), preset: r.appearancePreset, cinematic: r.cinematicId });
    if (R.codexPublic !== undefined && !found.has(R.id)) { found.add(R.id); onCodex({ recipeId: R.id, teamId: item.teamId, matchId, at: Date.now(), public: R.codexPublic }); }
    // 연출: 모든 시계 정지 (12-5)
    const sec = Math.min(FC.cinematicMaxSeconds, Math.max(FC.cinematicMinSeconds, FC.cinematicSeconds));
    world.frozen = true;
    cinematic = { ticksLeft: Math.round(sec * constants.time.physicsHz), resumeTicks: Math.round(FC.resumeCountdownSeconds * constants.time.physicsHz), phase: 'play', seconds: sec, startedAtTick: world.tick };
    onCinematic({ type: 'start', id: r.cinematicId, seconds: sec, resumeSeconds: FC.resumeCountdownSeconds, kind: R.kind, team: item.teamId, members: members.map((e) => e.id), preset: r.appearancePreset, name: R.codexPublic ? R.name : null });
    return true;
  }

  // ── 융합 해제 ───────────────────────────────────────────
  function release(world, g, why) {
    const i = groups.indexOf(g);
    if (i < 0) return;
    groups.splice(i, 1);
    const alive = g.members.filter((e) => e.alive);
    const totalHp = alive.reduce((s, e) => s + Math.max(0, e.hp), 0);
    const totalEn = alive.reduce((s, e) => s + e.energy, 0);
    const maxSum = g.saved.reduce((s, m) => s + m.maxHp, 0);
    for (const m of g.saved) {
      const e = world.byId.get(m.id);
      if (!e) continue;
      e.mods = { ...m.mods };
      e.bodyRadius = m.bodyRadius;
      e.maxHp = m.maxHp;
      e.fusionGroup = null;
      if (!e.alive) continue;
      e.hp = Math.min(m.maxHp, Math.max(1, (totalHp * m.maxHp) / maxSum));
      e.energy = g.result.endEnergyZero ? 0 : Math.min(e.maxEnergy, totalEn / alive.length);
      e.ai.fusionSignalCooldownUntil = world.time + constants.tactics.fusionSignalCooldown;
    }
    world.teams[g.team].fusionCooldownUntil = world.time + FC.refuseCooldownSeconds;
    pushEvent(world, { type: 'fusion_end', entities: g.members.map((e) => e.id), reason: why });
  }

  // ── 기본 변신 ───────────────────────────────────────────
  function startTransform(world, e) {
    if (!usesForms(e.design)) return;
    const t = world.time;
    if (e.status.transformCooldownUntil > t || e.status.transformUntil > t || e.fusionGroup) return;
    if (!spendEnergy(e, TC.energyCost)) return;
    e.status.transformUntil = t + TC.durationSeconds;
    e.status.transformCooldownUntil = t + TC.cooldownSeconds;
    flips.push({ id: e.id, at: t + TC.durationSeconds });
    pushEvent(world, { type: 'transform', entity: e.id, to: e.form === 'A' ? 'B' : 'A' });
  }

  // ── 훅 ──────────────────────────────────────────────────
  function onSpecial(world, e, sp) {
    const t = world.time;
    if (sp.transform) startTransform(world, e);
    if (sp.fusionSignal) {
      if (e.ai.fusionSignalCooldownUntil > t) return; // 쿨다운 중이면 신호가 무시된다
      e.ai.fusionSignalAt = t;
      e.ai.fusionSignalCooldownUntil = t + constants.tactics.fusionSignalCooldown;
      e.ai.signalCheckAt = t + (recipes.reduce((m, r) => Math.max(m, r.common.signalWindowSeconds), FC.signalWindowSeconds));
    }
    if (sp.release && e.fusionGroup) {
      const g = groups.find((x) => x.id === e.fusionGroup);
      if (g) release(world, g, 'detach');
    }
  }

  function onTickEnd(world) {
    const t = world.time;

    // 연출 중: 시계는 멈춰 있고 틱 수만 센다
    if (world.frozen) {
      if (!cinematic) { world.frozen = false; return; }
      if (cinematic.phase === 'play') {
        if (--cinematic.ticksLeft <= 0) { cinematic.phase = 'resume'; onCinematic({ type: 'resume', seconds: FC.resumeCountdownSeconds }); }
      } else if (--cinematic.resumeTicks <= 0) {
        cinematic = null;
        // 큐에 남은 발동이 있으면 이어서 연출(조건을 다시 확인)
        while (queue.length) {
          const item = queue.shift();
          const cands = world.entities.filter((e) => e.team === item.teamId && e.alive && !e.fusionGroup);
          if (item.ids.every((id) => cands.some((c) => c.id === id)) && activate(world, item)) return;
        }
        world.frozen = false;
        onCinematic({ type: 'end' });
      }
      return;
    }

    // 기본 변신: 형태 바꿈
    for (let i = flips.length - 1; i >= 0; i--) {
      if (t < flips[i].at) continue;
      const e = world.byId.get(flips[i].id);
      flips.splice(i, 1);
      if (e && e.alive) { e.form = e.form === 'A' ? 'B' : 'A'; refreshDynamics(e, t, world.terrain); }
    }

    // 신호를 보냈는데 아무 융합도 일어나지 않으면 투지 −5 (명세 11-6)
    for (const e of world.entities) {
      if (e.ai.signalCheckAt != null && t >= e.ai.signalCheckAt) {
        e.ai.signalCheckAt = null;
        if (!e.fusionGroup && e.alive) e.spirit = Math.max(0, e.spirit - constants.tactics.fusionSignalSpiritCost);
      }
    }

    // 진행 중 융합: 구성원 하나가 격파되면 전원 격파, 해제 조건 확인
    for (const g of [...groups]) {
      if (g.members.some((e) => !e.alive)) {
        for (const e of g.members) if (e.alive) { e.hp = 0; e.alive = false; e.defeatedAt = t; pushEvent(world, { type: 'ko', entity: e.id, by: null }); }
        groups.splice(groups.indexOf(g), 1);
        pushEvent(world, { type: 'fusion_end', entities: g.members.map((e) => e.id), reason: 'ko' });
        continue;
      }
      const hp = g.members.reduce((s, e) => s + e.hp, 0);
      const mhp = g.members.reduce((s, e) => s + e.maxHp, 0);
      const en = g.members.reduce((s, e) => s + e.energy, 0);
      const men = g.members.reduce((s, e) => s + e.maxEnergy, 0);
      if (t >= g.until) release(world, g, 'time');
      else if (men > 0 && en / men <= FC.releaseEnergyPct) release(world, g, 'energy');
      else if (mhp > 0 && hp / mhp <= FC.releaseHpPct) release(world, g, 'hp');
    }

    // 새 발동 판정: 지휘관 비밀 레시피가 앞에 정렬돼 있다. 팀 ID 순서로 큐에 쌓는다(12-3)
    const busy = fusedIds();
    const triggers = [];
    for (const teamId of [...world.teamIds].sort()) {
      if (world.teams[teamId].fusionCooldownUntil > t) continue;
      const cands = world.entities.filter((e) => e.team === teamId && e.alive && !busy.has(e.id) && e.status.transformUntil <= t);
      if (!cands.length) continue;
      for (const R of recipes) {
        const members = findMembers(world, R, cands);
        if (members) { triggers.push({ recipe: R, ids: members.map((e) => e.id), teamId }); break; }
      }
    }
    if (!triggers.length) return;
    const [first, ...rest] = triggers;
    queue.push(...rest);
    activate(world, first);
  }

  return { hooks: { onSpecial, onTickEnd }, state, release: (world) => { for (const g of [...groups]) release(world, g, 'abort'); }, findMembers };
}

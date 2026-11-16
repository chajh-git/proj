// shared/tactics/conditions.js  (23번)
// 조건 평가 (명세 v1.0 11-5). 알 수 없는 정보(센서 없음·탐지 불가)를 요구하는 조건은 항상 거짓이다.
// 화면 코드를 import하지 않습니다.
//
// 평가 문맥 ctx: { world, self, perceptions, target }
//   target = 이 규칙의 대상 인식(perception) 또는 null.  enemy_* 조건은 대상이 적이면 그 적, 아니면 가장 가까운 적을 본다.
//   ally_* 조건은 대상이 아군이면 그 아군, 아니면 가장 가까운 아군을 본다.

import { selectTarget } from './targeting.js';
import { hasInfo } from './sensors.js';
import { uidsOfPartId } from '../sim/energy.js';
import { energyPct } from '../sim/energy.js';
import { aptitudeEnv, aliveEnemies, aliveAllies } from '../sim/world.js';

export function compare(op, a, b) {
  switch (op) {
    case '<': return a < b;
    case '<=': return a <= b;
    case '>': return a > b;
    case '>=': return a >= b;
    case '==': return a === b;
    case '!=': return a !== b;
    default: return false;
  }
}

const num = (op, actual, value) => actual !== null && actual !== undefined && Number.isFinite(actual) && compare(op, actual, value);

// 내 파츠 종류별 상태
function partStateIs(self, partId, state) {
  const uids = uidsOfPartId(self, partId);
  const parts = uids.map((u) => self.parts.get(u));
  switch (state) {
    case 'missing': return parts.length === 0;
    case 'ok': return parts.length > 0 && parts.some((p) => p.state === 'ok');
    case 'damaged': return parts.some((p) => p.state === 'broken');
    case 'cooldown': return parts.some((p) => p.cooldown > 0);
    default: return false;
  }
}

function enemyView(ctx) {
  const t = ctx.target;
  if (t && !t.isAlly && t.id !== ctx.self.id) return t;
  return selectTarget('nearest_enemy', ctx);
}
function allyView(ctx) {
  const t = ctx.target;
  if (t && t.isAlly) return t;
  return selectTarget('nearest_ally', ctx);
}

export function evaluateCondition(c, ctx) {
  const { world, self } = ctx;
  const t = world.time;
  switch (c.type) {
    // 내 상태
    case 'self_hp_pct': return num(c.op, self.maxHp > 0 ? (self.hp / self.maxHp) * 100 : 0, c.value);
    case 'self_energy_pct': return num(c.op, energyPct(self), c.value);
    case 'self_spirit': return num(c.op, self.spirit, c.value);
    case 'self_gauge': return num(c.op, self.gauge, c.value);
    case 'self_speed': return num(c.op, Math.hypot(self.vel.x, self.vel.z), c.value);
    case 'self_altitude': return compare(c.op, self.altitude, c.value);
    case 'self_env': return compare(c.op, aptitudeEnv(world, self), c.value);
    case 'self_form': return compare(c.op, self.form, c.value);
    case 'part_state': {
      const is = partStateIs(self, c.part, c.state);
      return c.op === '!=' ? !is : is;
    }
    case 'part_ammo': {
      const parts = uidsOfPartId(self, c.part).map((u) => self.parts.get(u)).filter((p) => p.ammo !== null);
      return parts.length > 0 && compare(c.op, parts.reduce((s, p) => s + p.ammo, 0), c.value);
    }
    // 시간
    case 'time_elapsed': return num(c.op, t, c.value);
    case 'time_in_stance': return num(c.op, t - self.ai.stanceSince, c.value);
    case 'timer_elapsed': {
      const start = self.ai.timers[c.timer];
      return start !== null && start !== undefined && compare(c.op, t - start, c.value);
    }
    // 전장
    case 'in_hazard': return (world.terrain.hazardsAt(self.pos.x, self.pos.z, self.altitude, t).length > 0) === c.value;
    case 'event_warning': {
      const w = world.terrain.warnings(t);
      return c.event === 'any' ? w.length > 0 : w.some((x) => x.kind === c.event);
    }
    // 변수
    case 'variable': return num(c.op, self.ai.vars[c.var], c.value);
    case 'shared_var': {
      if (!hasInfo(self, 'shared_vars', 0)) return false;
      return num(c.op, world.teams[self.team].shared[c.index - 1], c.value);
    }
    // 적
    case 'enemy_count': return num(c.op, aliveEnemies(world, self).length, c.value);
    case 'enemy_detected': return Boolean(enemyView(ctx)?.detected) === c.value;
    case 'enemy_band': { const p = enemyView(ctx); return p ? compare(c.op, p.band, c.value) : false; }
    case 'enemy_bearing': { const p = enemyView(ctx); return p ? compare(c.op, p.bearing8, c.value) : false; }
    case 'enemy_altitude': { const p = enemyView(ctx); return p ? compare(c.op, p.altitude, c.value) : false; }
    case 'enemy_distance': { const p = enemyView(ctx); return p ? num(c.op, p.distance, c.value) : false; }
    case 'enemy_hp_pct': { const p = enemyView(ctx); return p ? num(c.op, p.hpPct, c.value) : false; }
    case 'enemy_energy_pct': { const p = enemyView(ctx); return p ? num(c.op, p.energyPct, c.value) : false; }
    case 'enemy_spirit': { const p = enemyView(ctx); return p ? num(c.op, p.spirit, c.value) : false; }
    case 'enemy_weapon_active': {
      const p = enemyView(ctx);
      return p && p.weaponActive !== null ? p.weaponActive === c.value : false;
    }
    // 아군
    case 'ally_count': return num(c.op, aliveAllies(world, self).length, c.value);
    case 'ally_band': { const p = allyView(ctx); return p ? compare(c.op, p.band, c.value) : false; }
    case 'ally_hp_band': { const p = allyView(ctx); return p ? compare(c.op, p.hpBand, c.value) : false; }
    case 'ally_hp_pct': { const p = allyView(ctx); return p ? num(c.op, p.hpPct, c.value) : false; }
    default: return false;
  }
}

// 조건식 { mode, conditions }. 조건이 없으면 항상 참.
export function evaluateWhen(when, ctx) {
  const list = when?.conditions || [];
  if (list.length === 0) return true;
  return when.mode === 'any' ? list.some((c) => evaluateCondition(c, ctx)) : list.every((c) => evaluateCondition(c, ctx));
}

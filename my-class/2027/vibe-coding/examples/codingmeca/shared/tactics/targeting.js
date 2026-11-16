// shared/tactics/targeting.js  (25번)
// 대상 선택자 해석 (명세 v1.0 11-3). 선택은 '인식(perception)'만 사용한다:
// 센서가 없으면 거리 구간의 중간값으로 비교하고, 필요한 정보가 없는 선택자는 가장 가까운 적으로 대체한다.
// 화면 코드를 import하지 않습니다.

import { TARGET_DEFS } from './schema.js';
import { estimatedDistance } from './sensors.js';

// 후보 중 key가 가장 작은 인식. 동점이면 앞선 것(출전 순서).
function argmin(list, key) {
  let best = null;
  let bestV = Infinity;
  for (const p of list) {
    const v = key(p);
    if (v < bestV) {
      bestV = v;
      best = p;
    }
  }
  return best;
}

// 보이는(탐지된) 살아있는 적/아군 인식 목록
function candidates(world, self, perceptions, wantAlly) {
  const out = [];
  for (const e of world.entities) {
    if (e === self || !e.alive) continue;
    if ((e.team === self.team) !== wantAlly) continue;
    const p = perceptions.get(e.id);
    if (p && (wantAlly || p.detected)) out.push(p);
  }
  return out;
}

/**
 * 선택자 → 대상 인식(perception) 또는 null.
 * ctx: { world, self, perceptions }
 * 반환: { perception, selector(실제로 쓰인 것) } 형태가 아니라 perception만 돌려준다. 대상이 없으면 null.
 */
export function selectTarget(selector, ctx, depth = 0) {
  const { world, self, perceptions } = ctx;
  const C = world.constants;
  const enemies = () => candidates(world, self, perceptions, false);
  const allies = () => candidates(world, self, perceptions, true);
  const dist = (p) => estimatedDistance(p, C);
  const nearest = (list) => argmin(list, dist);
  const def = TARGET_DEFS[selector];
  if (!def || depth > 3) return nearest(enemies());

  const hasNeed = (need, list) => list.length > 0 && list.every((p) => (need === 'enemy_hp_pct' ? p.hpPct !== null : p.damagedParts !== null));

  switch (selector) {
    case 'self':
      return perceptions.get(self.id) ?? null;
    case 'nearest_enemy':
      return nearest(enemies());
    case 'lowest_hp_enemy': {
      const list = enemies();
      return hasNeed('enemy_hp_pct', list) ? argmin(list, (p) => p.hpPct) : nearest(list);
    }
    case 'most_damaged_enemy': {
      const list = enemies();
      return hasNeed('enemy_part_state', list) ? argmin(list, (p) => -p.damagedParts) : nearest(list);
    }
    case 'weapon_active_enemy': {
      const list = enemies();
      if (!list.length) return null;
      if (!hasNeed('enemy_part_state', list)) return nearest(list);
      const active = list.filter((p) => p.weaponActive);
      return nearest(active.length ? active : list);
    }
    case 'enemy_1':
    case 'enemy_2':
    case 'enemy_3': {
      const n = Number(selector.slice(-1)) - 1;
      const e = world.entities.find((o) => o.team !== self.team && o.index === n);
      const p = e && e.alive ? perceptions.get(e.id) : null;
      return p && p.detected ? p : nearest(enemies());
    }
    case 'nearest_ally':
      return nearest(allies());
    case 'lowest_hp_ally': {
      const list = allies();
      const precise = list.length > 0 && list.every((p) => p.hpPct !== null);
      const rank = { low: 0, mid: 1, high: 2 };
      return precise ? argmin(list, (p) => p.hpPct) : argmin(list, (p) => rank[p.hpBand]);
    }
    case 'locked': {
      const id = self.ai.lockedTargetId;
      const e = id ? world.byId.get(id) : null;
      const p = e && e.alive ? perceptions.get(e.id) : null;
      if (p && (p.detected || p.isAlly)) return p;
      return selectTarget('current', ctx, depth + 1);
    }
    case 'current':
    default: {
      // 잠금이 있으면 잠근 대상, 없으면 지금 노리던 적(살아있고 보이면), 아니면 가장 가까운 적
      if (self.ai.lockedTargetId) {
        const p = selectTarget('locked', ctx, depth + 1);
        if (p) return p;
      }
      const cur = self.ai.targetId ? perceptions.get(self.ai.targetId) : null;
      if (cur && cur.alive && !cur.isAlly && cur.detected) return cur;
      return nearest(enemies());
    }
  }
}

// 잠금 만료·격파 확인 (판단 틱마다 호출)
export function refreshLock(world, self) {
  const ai = self.ai;
  if (!ai.lockedTargetId) return;
  const target = world.byId.get(ai.lockedTargetId);
  const expired = ai.lockedUntil !== null && world.time >= ai.lockedUntil;
  if (!target || !target.alive || expired) {
    ai.lockedTargetId = null;
    ai.lockedSelector = null;
    ai.lockedUntil = null;
  }
}

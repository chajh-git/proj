// shared/tactics/interpreter.js  (26번)
// 전술 해석기: 판단 틱마다 센서 판독 → 태세 전환 평가 → 채널별 첫 참 규칙 실행 → 명령 생성.
// (명세 v1.0 9-1 ①, 11-2). 화면 코드를 import하지 않습니다.
//
// 규칙
//  1. 현재 태세의 전환 규칙을 위에서부터 평가해 첫 참 규칙으로 전환한다(한 사이클에 최대 1회).
//     전환 직후 같은 사이클에 새 태세의 규칙을 평가한다.
//  2. 태세 안에서 채널(이동/무장/방어/특수)마다 위에서부터 첫 참 규칙 하나만 실행한다.
//  3. 규칙이 없거나 참인 규칙이 없는 채널은 기본 동작: 이동 정지, 무장 사용 안 함, 방어·특수 없음.
//  4. 충돌하는 명령은 특수 > 방어 > 이동 > 무장 (resolveConflicts).

import { CHANNELS } from './schema.js';
import { perceiveAll } from './sensors.js';
import { selectTarget, refreshLock } from './targeting.js';
import { evaluateWhen } from './conditions.js';
import { applyAction, resolveConflicts } from './actions.js';
import { emptyCommand, pushEvent } from '../sim/world.js';

// 이번 틱이 판단 틱인가 (물리 60Hz, 판단 15Hz → 4틱마다)
export function isDecisionTick(world) {
  const every = Math.round(world.constants.time.physicsHz / world.constants.time.decisionHz);
  return world.tick % every === 0;
}

function switchTo(world, e, stanceId, reason) {
  if (stanceId === e.ai.stance || !e.tactics.stances.some((s) => s.id === stanceId)) return false;
  pushEvent(world, { type: 'stance', entity: e.id, from: e.ai.stance, to: stanceId, reason });
  e.ai.stance = stanceId;
  e.ai.stanceSince = world.time;
  return true;
}

export function decideEntity(world, e) {
  if (!e.alive) return;
  refreshLock(world, e);
  const perceptions = perceiveAll(world, e);
  const base = { world, self: e, perceptions, target: null };

  // 기본 대상(현재 대상)을 한 번 정해 둔다
  const current = selectTarget('current', base);
  const ctxFor = (target) => ({ ...base, target });

  // 1) 전환 규칙
  let stance = e.tactics.stances.find((s) => s.id === e.ai.stance) || e.tactics.stances[0];
  for (const tr of stance.transitions) {
    if (evaluateWhen(tr.when, ctxFor(current))) {
      if (switchTo(world, e, tr.to, 'transition')) stance = e.tactics.stances.find((s) => s.id === tr.to);
      break;
    }
  }

  // 2) 채널별 첫 참 규칙
  const cmd = emptyCommand();
  let pending = null;
  for (const channel of CHANNELS) {
    for (const rule of stance.rules) {
      if (rule.channel !== channel) continue;
      const target = rule.target === 'current' ? current : selectTarget(rule.target, base);
      const ctx = ctxFor(target);
      if (!evaluateWhen(rule.when, ctx)) continue;
      const res = applyAction(rule.do, ctx, cmd);
      if (res.switchStance) pending = res.switchStance;
      break; // 채널당 하나
    }
  }

  // 3) 태세 전환 동작은 이번 사이클의 규칙 평가가 끝난 뒤 적용(다음 판단부터 새 태세)
  if (pending) switchTo(world, e, pending, 'action');

  e.ai.targetId = cmd.targetId ?? (current && !current.isAlly ? current.id : e.ai.targetId);
  e.cmd = resolveConflicts(cmd);
}

export function decideAll(world) {
  for (const e of world.entities) decideEntity(world, e);
}

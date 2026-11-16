// shared/tactics/actions.js  (24번)
// 동작 카드를 '명령(cmd)'으로 바꾼다 (명세 v1.0 11-6). 실제 이동·발사는 physics.js·weapons.js 등이 명령을 읽어 수행한다.
// 화면 코드를 import하지 않습니다.
//
// 명령 형태 (world.js의 emptyCommand)
//   { throttle, turn, altTarget, thrustPct, targetId,
//     weapon: { use:[uid], hold, charge:[uid], overdrive, interval:{uid:초}, aimOffsetDeg },
//     defense: { shield, intercept, repair, phase, skill },
//     special: { transform, fusionSignal, detach:[partId]|null },
//     toggles: [{ uid, on }] }
//   throttle −1~1 (후진 음수), turn −1~1 (오른쪽 +)

import { clamp, wrapAngle } from '../util/math.js';
import { uidsOfPartId } from '../sim/energy.js';
import { selectTarget } from './targeting.js';
import { hasInfo } from './sensors.js';
import { CHANNEL_PRIORITY } from './schema.js';

const sign = (v) => (v >= 0 ? 1 : -1);

// 목표 방향각 desired(관찰자 기준, 오른쪽 +)에 대상이 오도록 조향. 대상이 오른쪽에 너무 있으면 오른쪽(+)으로 돈다.
const steer = (bearing, desired, gain) => clamp(wrapAngle(bearing - desired) * gain, -1, 1);

// 파츠 종류 목록 → 이 기체의 uid 목록. 비어 있으면 조건에 맞는 모든 파츠.
function resolveUids(self, partIds, fallbackPredicate) {
  if (partIds && partIds.length) return partIds.flatMap((id) => uidsOfPartId(self, id));
  const out = [];
  for (const [uid, p] of self.parts) if (p.state !== 'detached' && fallbackPredicate(p.def)) out.push(uid);
  return out;
}

function setOn(self, uids, on) {
  for (const uid of uids) {
    const p = self.parts.get(uid);
    if (p) p.on = on;
  }
}

// '정렬'이 맞출 방향각: 대상이 내 몸의 어느 쪽에 오게 할 것인가
function faceAngle(self, action, bearing) {
  switch (action.face) {
    case 'front': return 0;
    case 'back': return Math.PI * sign(bearing);
    case 'left': return -Math.PI / 2;
    case 'right': return Math.PI / 2;
    case 'part':
    case 'thickest_armor': {
      let uid = null;
      if (action.face === 'part') {
        uid = uidsOfPartId(self, action.part)[0] ?? null;
      } else {
        let best = -1;
        for (const [u, p] of self.parts) {
          if (p.state === 'detached' || p.def.category !== 'armor') continue;
          const score = (p.durability ?? 0) * (1 + Object.values(p.def.reduce || {}).reduce((s, v) => s + v, 0));
          if (score > best) { best = score; uid = u; }
        }
      }
      const it = uid ? self.layout.items.get(uid) : null;
      return it ? Math.atan2(it.center.x, -it.center.z) : 0; // 몸 기준 그 파츠가 있는 방향
    }
    default: return 0;
  }
}

/**
 * 동작 하나를 명령에 반영.
 * ctx: { world, self, perceptions, target }  target = 이 규칙의 대상 인식(null 가능)
 * 반환: { switchStance?: id }
 */
export function applyAction(action, ctx, cmd) {
  const { world, self, target } = ctx;
  const S = world.constants.tactics.steer;
  const t = world.time;
  const ai = self.ai;
  const hasTarget = Boolean(target) && target.id !== self.id;
  const b = hasTarget ? target.bearing : 0;

  switch (action.type) {
    // ── 이동 ──
    case 'approach': {
      if (!hasTarget) break;
      const near = target.distance !== null && target.distance <= S.stopDistance;
      cmd.turn = steer(b, 0, S.gain);
      cmd.throttle = near ? 0 : Math.abs(b) < S.approachSlowBearing ? 1 : 0.35;
      break;
    }
    case 'charge': {
      if (!hasTarget) break;
      cmd.turn = steer(b, 0, S.gain);
      cmd.throttle = 1;
      break;
    }
    case 'retreat': {
      if (!hasTarget) break;
      cmd.turn = steer(b, 0, S.gain); // 바라보며 뒤로
      cmd.throttle = -1;
      break;
    }
    case 'flee': {
      if (!hasTarget) break;
      cmd.turn = steer(b, Math.PI * sign(b), S.gain);
      cmd.throttle = Math.abs(b) > Math.PI / 2 ? 1 : 0.4;
      break;
    }
    case 'circle': {
      if (!hasTarget) break;
      const dir = action.dir === 'cw' ? 1 : action.dir === 'ccw' ? -1 : ai.circleDir;
      cmd.turn = steer(b, dir * S.circleBearing, S.gain);
      cmd.throttle = 0.8;
      break;
    }
    case 'align': {
      if (!hasTarget) break;
      cmd.turn = steer(b, faceAngle(self, action, b), S.gain);
      cmd.throttle = 0;
      break;
    }
    case 'stop':
      cmd.throttle = 0;
      cmd.turn = 0;
      break;
    case 'change_altitude':
      cmd.altTarget = action.to;
      break;
    case 'set_thrust': {
      cmd.thrustPct = { ...(cmd.thrustPct || {}) };
      for (const id of action.parts) cmd.thrustPct[id] = action.pct;
      break;
    }

    // ── 무장 ──
    case 'use_weapon':
      cmd.weapon.use = [...new Set([...cmd.weapon.use, ...resolveUids(self, action.parts, (d) => d.category === 'weapon')])];
      if (hasTarget && !target.isAlly) cmd.targetId = target.id;
      break;
    case 'hold_aim':
      cmd.weapon.hold = true;
      if (hasTarget && !target.isAlly) cmd.targetId = target.id;
      break;
    case 'charge_weapon':
      cmd.weapon.charge = [...new Set([...cmd.weapon.charge, ...resolveUids(self, action.parts, (d) => d.chargeSeconds !== undefined)])];
      break;
    case 'overdrive':
      cmd.weapon.overdrive = true;
      break;
    case 'fire_interval':
      for (const uid of resolveUids(self, action.parts, () => false)) cmd.weapon.interval[uid] = action.seconds;
      break;
    case 'aim_offset':
      cmd.weapon.aimOffsetDeg = action.deg;
      break;

    // ── 방어 ──
    case 'shield':
      cmd.defense.shield = action.on;
      setOn(self, resolveUids(self, null, (d) => d.shieldAbsorb !== undefined), action.on);
      break;
    case 'intercept':
      cmd.defense.intercept = action.on;
      setOn(self, resolveUids(self, null, (d) => d.interceptRange !== undefined), action.on);
      break;
    case 'repair':
      cmd.defense.repair = action.on;
      setOn(self, resolveUids(self, null, (d) => d.repairPartPerSecond !== undefined), action.on);
      break;
    case 'phase':
      cmd.defense.phase = true;
      break;
    case 'pilot_skill':
      cmd.defense.skill = action.skill;
      break;
    case 'toggle_part': {
      const uids = resolveUids(self, action.parts, () => false);
      setOn(self, uids, action.on);
      for (const uid of uids) cmd.toggles.push({ uid, on: action.on });
      break;
    }

    // ── 특수 ──
    case 'switch_stance':
      return { switchStance: action.to };
    case 'set_var': {
      const v = self.tactics.variables.find((x) => x.id === action.var);
      if (v) ai.vars[v.id] = clamp(action.value, v.min, v.max);
      break;
    }
    case 'add_var': {
      const v = self.tactics.variables.find((x) => x.id === action.var);
      if (v) ai.vars[v.id] = clamp(ai.vars[v.id] + action.delta, v.min, v.max);
      break;
    }
    case 'start_timer':
      if (action.timer in ai.timers) ai.timers[action.timer] = t;
      break;
    case 'set_shared_var':
      if (hasInfo(self, 'shared_vars', 0)) world.teams[self.team].shared[action.index - 1] = clamp(action.value, -999, 999);
      break;
    case 'lock_target': {
      const p = selectTarget(action.selector, ctx);
      if (p && !p.isAlly) {
        ai.lockedTargetId = p.id;
        ai.lockedSelector = action.selector;
        ai.lockedUntil = action.releaseSeconds ? t + action.releaseSeconds : null;
      }
      break;
    }
    case 'unlock_target':
      ai.lockedTargetId = null;
      ai.lockedSelector = null;
      ai.lockedUntil = null;
      break;
    case 'fusion_signal':
      cmd.special.fusionSignal = true;
      ai.fusionSignalAt = t; // 조건 판정·투지 −5·쿨다운 8초는 서버의 융합 훅이 처리
      break;
    case 'transform':
      cmd.special.transform = true;
      break;
    case 'detach':
      cmd.special.detach = [...(action.parts || [])];
      break;
    default:
      break;
  }
  return {};
}

// 같은 틱의 충돌 정리: 특수 > 방어 > 이동 > 무장 (명세 11-2의 3)
//  - 변신 중이면 이동·무장이 멈춘다(이동 제압).
export function resolveConflicts(cmd) {
  if (cmd.special.transform) {
    cmd.throttle = 0;
    cmd.turn = 0;
    cmd.weapon = { use: [], hold: false, charge: [], overdrive: false, interval: {}, aimOffsetDeg: 0 };
  }
  return cmd;
}

export { CHANNEL_PRIORITY };

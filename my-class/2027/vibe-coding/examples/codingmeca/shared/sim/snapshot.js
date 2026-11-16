// shared/sim/snapshot.js  (35번)
// 서버 → 화면으로 보내는 상태 스트림(20Hz)과 경기 시작 때 한 번 보내는 정적 정보, 그리고 화면의 보간.
// (명세 v1.0 9-1 ⑩, 9-6의 보간 버퍼, 16장 네트워크). 화면 코드를 import하지 않습니다.
//
// 숨겨야 할 것: 전술(태세 이름·규칙), 융합 레시피, 변수·타이머, 센서 인식 값은 스트림에 넣지 않는다.
//   관람 화면이 필요한 것은 위치·방향·체력·투지·게이지·파츠 상태·사건뿐이다.
//
// 파츠 상태 코드: 0 정상, 1 파손(기능 정지), 2 이탈, 3 일시 정지(EMP·스턴·꺼짐)
// 효과 플래그 비트: 1 은신, 2 실드 작동, 4 EMP, 8 이동 제압, 16 무적, 32 돌진, 64 변신

import { wrapAngle } from '../util/math.js';
import { energyPct } from './energy.js';

const r2 = (v) => Math.round(v * 100) / 100;
const r3 = (v) => Math.round(v * 1000) / 1000;

export const PART_STATE = Object.freeze({ ok: 0, broken: 1, detached: 2, paused: 3 });
export const FLAG = Object.freeze({ stealth: 1, shield: 2, emp: 4, immobilized: 8, invuln: 16, rush: 32, transform: 64 });

// ── 경기 시작 때 한 번: 정적 정보 ───────────────────────
export function makeInitInfo(world) {
  return {
    mapId: world.map.id,
    arena: { halfW: world.terrain.halfW, halfD: world.terrain.halfD },
    obstacles: world.terrain.obstacles.map((o) => ({ min: { x: o.min.x, z: o.min.z }, max: { x: o.max.x, z: o.max.z } })),
    island: world.terrain.island,
    spikePads: world.terrain.spikePads,
    teams: world.teamIds,
    entities: world.entities.map((e) => ({
      id: e.id, team: e.team, index: e.index, name: e.name, owner: e.owner,
      radius: r2(e.radius), maxHp: Math.round(e.maxHp), maxEnergy: Math.round(e.maxEnergy), spiritMax: e.spiritMax,
      hasOverdrive: e.tree.order.some((u) => e.tree.nodes.get(u).def.category === 'overdrive'),
      pilot: { name: e.design.pilot?.name, temperament: e.design.pilot?.temperament },
      // 화면이 모양을 만들 수 있도록 파츠 목록과 3D 배치(코어 중심 기준)
      parts: e.tree.order.map((uid) => {
        const n = e.tree.nodes.get(uid);
        const it = e.layout.items.get(uid);
        return {
          uid, part: n.partId, parent: n.parentUid, out: n.outKey, form: n.form,
          x: r3(it.center.x), y: r3(it.center.y), z: r3(it.center.z), edge: r3(it.edge),
        };
      }),
      groundOffset: r3(e.layout.groundOffset),
    })),
  };
}

function partStateCode(e, uid, t) {
  const p = e.parts.get(uid);
  if (p.state === 'detached') return PART_STATE.detached;
  if (p.state === 'broken') return PART_STATE.broken;
  if (p.disabledUntil > t || p.on === false || !e.dyn.working.has(uid)) return PART_STATE.paused;
  return PART_STATE.ok;
}

function flagsOf(e, t) {
  let f = 0;
  if (e.dyn.stealthActive && e.status.stealthBrokenUntil <= t) f |= FLAG.stealth;
  if ([...e.parts.values()].some((p) => p.def.shieldAbsorb && p.shieldHp > 0 && p.state === 'ok' && p.disabledUntil <= t && p.on !== false)) f |= FLAG.shield;
  if (e.dyn.empBlocked) f |= FLAG.emp;
  if (e.status.immobilizedUntil > t || e.altChange) f |= FLAG.immobilized;
  if (e.status.invulnUntil > t) f |= FLAG.invuln;
  if (e.status.rushUntil > t) f |= FLAG.rush;
  if (e.status.transformUntil > t) f |= FLAG.transform;
  return f;
}

// 사건 중 화면이 쓰는 것만, 전술 정보 없이
const PUBLIC_EVENTS = new Set([
  'start', 'end', 'extension', 'hit', 'part_broken', 'part_lost', 'ko', 'revive', 'shield_break', 'absorbed', 'blocked',
  'fire', 'projectile', 'projectile_blocked', 'intercepted', 'dodged', 'rail', 'overdrive', 'skill', 'phase', 'flip',
  'emp', 'emp_resisted', 'part_disabled', 'ram', 'direct', 'meteor_impact', 'spikes_fire',
  'fusion_start', 'fusion_end', 'transform',
]);

/** 20Hz 상태 스냅샷 */
export function makeSnapshot(world, match) {
  const t = world.time;
  const area = world.terrain.playArea(t);
  return {
    tick: world.tick,
    t: r3(t),
    phase: match ? match.phase : 'fight',
    countdown: match && match.phase === 'countdown' ? r2(Math.max(0, match.countdownLeft)) : 0,
    frozen: Boolean(world.frozen),
    area: { hw: r2(area.halfW), hd: r2(area.halfD) },
    ents: world.entities.map((e) => ({
      id: e.id,
      x: r2(e.pos.x), z: r2(e.pos.z), h: r3(e.heading), alt: e.altitude,
      altTo: e.altChange ? e.altChange.to : null,
      hp: Math.round(Math.max(0, e.hp)), mhp: Math.round(e.maxHp),
      en: Math.round(e.energy), sp: Math.round(e.spirit), g: Math.round(e.gauge),
      a: e.alive ? 1 : 0, form: e.form, fl: flagsOf(e, t),
      // tree.order 순서의 [상태코드, 내구도%]
      p: e.tree.order.map((uid) => {
        const p = e.parts.get(uid);
        return [partStateCode(e, uid, t), p.maxDurability ? Math.round((p.durability / p.maxDurability) * 100) : 100];
      }),
    })),
    proj: world.projectiles.map((p) => ({ id: p.id, k: p.kind, x: r2(p.x), z: r2(p.z), o: p.owner })),
    warn: world.terrain.warnings(t).map((w) => ({ k: w.kind, x: w.x !== undefined ? r2(w.x) : null, z: w.z !== undefined ? r2(w.z) : null, r: w.radius ?? null, s: r2(w.secondsLeft) })),
    ev: (world.evBuffer || world.events).filter((ev) => PUBLIC_EVENTS.has(ev.type)).map(({ handled, ...rest }) => rest),
    result: world.result ? { winner: world.result.winner, reason: world.result.reason } : null,
  };
}

// ── 화면 쪽 보간 (명세 9-6: 관람 화면은 서버보다 0.6초 늦게 재생) ──
// 두 스냅샷 사이를 alpha(0~1)로 섞는다. 위치·방향은 보간, 나머지는 가까운 쪽 값.
export function interpolateSnapshots(a, b, alpha) {
  if (!a) return b;
  if (!b) return a;
  const byId = new Map(a.ents.map((e) => [e.id, e]));
  const near = alpha < 0.5 ? a : b;
  return {
    ...near,
    t: a.t + (b.t - a.t) * alpha,
    ents: b.ents.map((eb) => {
      const ea = byId.get(eb.id);
      if (!ea) return eb;
      const src = alpha < 0.5 ? ea : eb;
      return {
        ...src,
        x: ea.x + (eb.x - ea.x) * alpha,
        z: ea.z + (eb.z - ea.z) * alpha,
        h: ea.h + wrapAngle(eb.h - ea.h) * alpha,
      };
    }),
    ev: [], // 사건은 보간하지 않고, 재생 시각을 지나는 순간 원본 스냅샷의 ev를 한 번씩 처리한다
  };
}

// 스냅샷 한 장으로 에너지 비율 등 HUD 값을 얻는다
export const hudOf = (snap, initInfo, id) => {
  const e = snap.ents.find((x) => x.id === id);
  const s = initInfo.entities.find((x) => x.id === id);
  if (!e || !s) return null;
  return {
    hpPct: s.maxHp ? (e.hp / s.maxHp) * 100 : 0,
    energyPct: s.maxEnergy ? (e.en / s.maxEnergy) * 100 : 0,
    spirit: e.sp, gauge: e.g, alive: Boolean(e.a),
  };
};

export { energyPct };

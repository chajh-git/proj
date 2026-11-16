// shared/build/stats.js  (17번)
// 설계 → 능력치. 무게·비용·체력·전력·이동·적성·투지·센서 정보 등 (명세 v1.0 5-4, 6장).
// 화면 코드를 import하지 않습니다(서버와 브라우저 공용). 모든 계수는 config/constants.js에서 읽습니다.
//
// 해석 메모
//  - 무게중심 편차: 전체 무게중심과 '추력 가중 이동 기관 중심'의 수평 거리(m). 이동 기관이 없으면 0.
//  - 전력을 받지 못하는 파츠(홉 초과)와 현재 형태에서 비활성인 파츠는 무게·비용에는 들어가지만
//    추력·소모·출력·센서·투지 효과에는 들어가지 않는다.
//  - 정적 계산이므로 스로틀 1, 에너지 충분을 가정한다. 시뮬레이션은 같은 공식을 실시간 값으로 다시 쓴다.

import { buildTree, DEFAULT_CTX, activeSet } from './assembly.js';
import { layoutTree, computeExposure } from './layout.js';
import { clamp, round } from '../util/math.js';
import { ALTITUDE_RANK } from '../../data/parts.js';
import { PILOT_SKILLS } from '../../data/pilot-skills.js';
import { countTags } from '../../data/tags.js';

export const GRADES = Object.freeze(['D', 'C', 'B', 'A', 'S']); // 낮은 순
export const ENV_IDS = Object.freeze(['ground', 'water', 'air', 'space']);
const gradeValue = (g) => Math.max(0, GRADES.indexOf(g));

export function pilotCost(pilot) {
  return (pilot?.skills || []).reduce((sum, id) => sum + (PILOT_SKILLS[id]?.cost || 0), 0);
}

// 활성 형태에서 쓰이는 파츠 중 전력을 받는 것
function workingNodes(tree, form) {
  const act = activeSet(tree, form);
  return [...tree.nodes.values()].filter((n) => act.has(n.uid) && n.powered);
}

/**
 * 능력 계산.
 * opts: { form: 'A'|'B', pilot, layout, exposure(true면 노출도 계산),
 *         presentSet, workingSet }  ← 시뮬레이션용: 이탈하지 않은 파츠 / 지금 작동 중인 파츠(없으면 설계 기준으로 계산)
 */
export function computeStatsFromTree(tree, opts = {}) {
  const ctx = tree.ctx || DEFAULT_CTX;
  const C = ctx.constants;
  const form = opts.form || 'A';
  const layout = opts.layout || layoutTree(tree, ctx);
  const nodes = [...tree.nodes.values()].filter((n) => !opts.presentSet || opts.presentSet.has(n.uid));
  const working = opts.workingSet
    ? nodes.filter((n) => opts.workingSet.has(n.uid))
    : workingNodes(tree, form).filter((n) => !opts.presentSet || opts.presentSet.has(n.uid));
  const workingSet = new Set(working.map((n) => n.uid));
  const defs = (cat) => working.filter((n) => n.def.category === cat);

  // ── 무게·비용·체력 ──────────────────────────────────────
  const weight = nodes.reduce((s, n) => s + n.def.weight, 0);
  const partsCost = nodes.reduce((s, n) => s + n.def.cost, 0);
  const pilotPoints = pilotCost(opts.pilot);
  const cost = partsCost + pilotPoints;
  const core = tree.root?.def;
  const hp = (core?.baseHp || 0) + nodes.reduce((s, n) => s + (n.def.hpBonus || 0), 0);

  // ── 전력 (5-4) ─────────────────────────────────────────
  const output = (core?.output || 0) + defs('cell').reduce((s, n) => s + n.def.output, 0);
  const capacity = (core?.capacity || 0) + defs('cell').reduce((s, n) => s + n.def.capacity, 0);
  const consumers = working.filter((n) => n.def.power > 0);
  const alwaysDraw = consumers.filter((n) => n.def.drain === 'always').reduce((s, n) => s + n.def.power, 0);
  const onUseList = consumers.filter((n) => n.def.drain !== 'always');
  const idleDraw = alwaysDraw + onUseList.reduce((s, n) => s + n.def.power * C.power.idleDrawFactor, 0);
  const peakDraw = alwaysDraw + onUseList.reduce((s, n) => s + n.def.power, 0);

  // ── 이동 (6장) ─────────────────────────────────────────
  const movers = defs('mobility');
  const totalThrust = movers.reduce((s, n) => s + n.def.thrust, 0);
  const weighted = (key) => (totalThrust > 0 ? movers.reduce((s, n) => s + n.def[key] * n.def.thrust, 0) / totalThrust : 0);
  const avgMaxSpeed = weighted('maxSpeed');
  const avgTurn = weighted('turn');

  // 무게중심과 이동 기관 중심
  let com = { x: 0, y: 0, z: 0 };
  if (weight > 0) {
    for (const n of nodes) {
      const c = layout.items.get(n.uid)?.center;
      if (!c) continue;
      com = { x: com.x + (c.x * n.def.weight) / weight, y: com.y + (c.y * n.def.weight) / weight, z: com.z + (c.z * n.def.weight) / weight };
    }
  }
  let moverCenter = { x: 0, y: 0, z: 0 };
  if (totalThrust > 0) {
    for (const n of movers) {
      const c = layout.items.get(n.uid)?.center;
      if (!c) continue;
      const w = n.def.thrust / totalThrust;
      moverCenter = { x: moverCenter.x + c.x * w, y: moverCenter.y + c.y * w, z: moverCenter.z + c.z * w };
    }
  }
  const comDeviation = totalThrust > 0 ? Math.hypot(com.x - moverCenter.x, com.z - moverCenter.z) : 0;

  // 환경별 적성 등급(추력 가중 평균 → 가장 가까운 등급)
  const aptitude = {};
  const S = C.stats;
  for (const env of ENV_IDS) {
    let grade = S.noMobilityGrade;
    if (totalThrust > 0) {
      const avg = movers.reduce((s, n) => s + gradeValue(n.def.aptitude[env]) * n.def.thrust, 0) / totalThrust;
      grade = GRADES[clamp(Math.round(avg), 0, GRADES.length - 1)];
    }
    aptitude[env] = { grade, mult: S.aptitudeMult[grade] };
  }

  const speedBase = avgMaxSpeed / (1 + weight / S.maxSpeedWeightDivisor);
  const turnBase = (avgTurn * S.turnBaseWeight) / (S.turnBaseWeight + weight) / (1 + S.turnCenterPenalty * comDeviation);
  const moveEnergy = movers.reduce((s, n) => s + n.def.power, 0) * (weight / S.moveEnergyWeightDivisor);

  const byEnv = {};
  for (const env of ENV_IDS) {
    const m = aptitude[env].mult;
    byEnv[env] = {
      thrust: totalThrust * m,
      accel: weight > 0 ? (totalThrust * m) / weight : 0,
      maxSpeed: speedBase * m,
    };
  }
  const maxAltitude = movers.reduce(
    (best, n) => (ALTITUDE_RANK[n.def.maxAltitude] > ALTITUDE_RANK[best] ? n.def.maxAltitude : best),
    'ground',
  );

  // ── 투지·게이지 (중첩 규칙: 곱 → 상한/하한) ───────────────
  const sp = C.spirit;
  const spiritParts = defs('spirit');
  const prod = (key) => spiritParts.reduce((m, n) => (n.def[key] ? m * n.def[key] : m), 1);
  const spirit = {
    max: sp.baseMax + spiritParts.reduce((s, n) => s + (n.def.spiritMaxBonus || 0), 0),
    lossMult: Math.max(sp.lossMultFloor, prod('spiritLossMult')),
    gainMult: Math.min(sp.gainMultCap, prod('spiritGainMult')),
  };
  const gauge = { chargeMult: Math.min(C.gauge.chargeMultCap, prod('gaugeChargeMult')) };

  // ── 센서 정보 ──────────────────────────────────────────
  const sensors = defs('sensor');
  const info = [...new Set(sensors.flatMap((n) => n.def.info || []))];
  const sensorRange = sensors.reduce((m, n) => Math.max(m, n.def.range || 0), 0);

  // ── 공격 요약 ──────────────────────────────────────────
  const weapons = defs('weapon').map((n) => {
    const d = n.def;
    const dps = d.damagePerSecond ?? (d.cooldown ? (d.damage || 0) / d.cooldown : 0);
    return { uid: n.uid, id: d.id, damageType: d.damageType, range: d.range, dps: round(dps, 1) };
  });
  const maxWeaponRange = weapons.reduce((m, w) => Math.max(m, w.range || 0), 0);

  // ── 충돌 반경: 코어 중심에서 수평으로 가장 먼 모서리 거리 ─────
  let collisionRadius = 0;
  for (const it of layout.items.values()) {
    for (const x of [it.box.min.x, it.box.max.x]) {
      for (const z of [it.box.min.z, it.box.max.z]) collisionRadius = Math.max(collisionRadius, Math.hypot(x, z));
    }
  }

  // ── 상태 요약 ──────────────────────────────────────────
  const unpowered = nodes.filter((n) => !n.powered).map((n) => n.uid);
  const stealthActive = working.some((n) => n.def.blocksDetection);
  const speedMult = working.reduce((m, n) => (n.def.speedMult ? m * n.def.speedMult : m), 1);
  const parts = nodes.map((n) => n.def);
  const tagCounts = countTags(parts);
  const canMove = totalThrust > 0;
  const stats = {
    form,
    weight, cost, partsCost, pilotCost: pilotPoints, hp, partCount: nodes.length,
    power: {
      output, capacity, idleDraw: round(idleDraw, 2), peakDraw: round(peakDraw, 2),
      etaPeak: peakDraw > 0 ? Math.min(1, output / peakDraw) : 1,
      moveEnergy: round(moveEnergy, 2),
    },
    move: {
      canMove, thrust: totalThrust, accel: weight > 0 ? totalThrust / weight : 0,
      maxSpeed: speedBase, turn: turnBase, comDeviation, maxAltitude, byEnv,
    },
    aptitude,
    spirit, gauge,
    sensors: { info, range: sensorRange },
    weapons, maxWeaponRange,
    collisionRadius,
    com, size: layout.size,
    tagCounts,
    stealthActive,
    speedMult,
    unpowered,
    working: [...workingSet],
  };
  if (opts.exposure) stats.exposure = computeExposure(tree, layout, { form });
  return stats;
}

// 설계 → 능력치 (트리·배치를 함께 돌려줌)
export function computeStats(design, opts = {}, ctx = DEFAULT_CTX) {
  const tree = buildTree(design, ctx);
  const layout = layoutTree(tree, ctx);
  const stats = computeStatsFromTree(tree, { pilot: design?.pilot, ...opts, layout });
  return { stats, tree, layout };
}

// 두 형태가 있는 설계는 A/B 각각의 능력치를 돌려준다.
export function computeBothForms(design, opts = {}, ctx = DEFAULT_CTX) {
  const tree = buildTree(design, ctx);
  const layout = layoutTree(tree, ctx);
  const o = { pilot: design?.pilot, ...opts, layout };
  return { A: computeStatsFromTree(tree, { ...o, form: 'A' }), B: computeStatsFromTree(tree, { ...o, form: 'B' }), tree, layout };
}

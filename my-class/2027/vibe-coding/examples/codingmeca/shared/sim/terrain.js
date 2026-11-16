// shared/sim/terrain.js  (29번)
// 전장: 크기·환경·벽·위험구역·주기 이벤트. 모든 값은 '시간의 함수'라서 같은 시간이면 항상 같은 결과입니다
// (시드가 같으면 운석 위치도 같음 → 리플레이·재경기가 일치).
// 피해를 실제로 입히는 일은 combat.js가 합니다. 여기서는 '어디가 위험한지, 무슨 일이 언제 일어나는지'만 알려줍니다.
// 화면 코드를 import하지 않습니다.
//
// 좌표: 전장 중앙이 원점, x = 동(+), z = 남/뒤(+). A팀은 서쪽(−x), B팀은 동쪽(+x).

import { rayAabb, clamp, lerp } from '../util/math.js';
import { createRng } from '../util/rng.js';
import { CONSTANTS } from '../../config/constants.js';
import { arenaSizeFor } from '../../data/maps.js';

const WALL_Y = { min: -50, max: 50 };

export function createTerrain({ map, teamSize = 1, seed = 1, constants = CONSTANTS, size = null }) {
  const [w, d] = size || arenaSizeFor(map, teamSize, constants.match.arenaSize);
  const halfW = w / 2;
  const halfD = d / 2;
  const rules = map.rules || {};
  const seedBase = createRng(seed).fork(`terrain:${map.id}`).seed;

  // 벽: 정규화 좌표 [cx, cz, 너비, 깊이] → 월드 AABB
  const obstacles = (map.obstacles || []).map(([cx, cz, ow, od]) => ({
    min: { x: cx * w - (ow * w) / 2, y: WALL_Y.min, z: cz * d - (od * d) / 2 },
    max: { x: cx * w + (ow * w) / 2, y: WALL_Y.max, z: cz * d + (od * d) / 2 },
  }));

  // 스파이크 패드: 중심 주변 고리에 고르게 배치
  const spikePads = [];
  if (rules.spikes) {
    const n = rules.spikes.count;
    const ring = Math.min(halfW, halfD) * 0.55;
    for (let i = 0; i < n; i++) {
      const a = (i / n) * Math.PI * 2 + Math.PI / 6;
      spikePads.push({ x: Math.cos(a) * ring * (i % 2 ? 1 : 0.6), z: Math.sin(a) * ring * (i % 2 ? 1 : 0.6), radius: rules.spikes.radius });
    }
  }

  // 중앙 섬(심해 해구): 전장 면적의 areaRatio를 차지하는 원
  const island = rules.island
    ? { x: 0, z: 0, radius: Math.sqrt((rules.island.areaRatio * w * d) / Math.PI), env: rules.island.envOnIsland }
    : null;

  // ── 연장전 급축소: 연장 시작 시각을 알려주면 그 뒤로 빠르게 좁힌다 ──
  const state = { extensionStart: null };
  const EXT_SECONDS = constants.time.extensionSeconds;

  // 현재 경기 가능 영역의 반폭
  function playArea(t) {
    let hw = halfW;
    let hd = halfD;
    const sh = rules.shrink;
    if (sh && t >= sh.startAtSeconds) {
      const steps = Math.floor((t - sh.startAtSeconds) / sh.intervalSeconds) + 1;
      const shrunk = Math.max(sh.minSize, Math.min(w, d) - steps * sh.stepMeters * 2);
      hw = Math.min(hw, (shrunk * w) / Math.min(w, d) / 2);
      hd = Math.min(hd, shrunk / 2);
    }
    if (state.extensionStart !== null && t >= state.extensionStart) {
      const k = clamp((t - state.extensionStart) / EXT_SECONDS, 0, 1);
      const minHalf = (sh?.minSize ?? 12) / 2;
      hw = Math.min(hw, lerp(hw, minHalf, k));
      hd = Math.min(hd, lerp(hd, minHalf, k));
    }
    return { halfW: hw, halfD: hd };
  }

  // 발밑 환경
  function envAt(x, z) {
    if (island && Math.hypot(x - island.x, z - island.z) <= island.radius) return island.env;
    return map.env;
  }

  // ── 벽과 시야 ──
  function segmentBlocked(ax, az, bx, bz) {
    if (!obstacles.length) return false;
    const dx = bx - ax;
    const dz = bz - az;
    const len = Math.hypot(dx, dz);
    if (len < 1e-6) return false;
    const origin = { x: ax, y: 0, z: az };
    const dir = { x: dx / len, y: 0, z: dz / len };
    return obstacles.some((o) => rayAabb(origin, dir, o, len) !== null);
  }
  const blocksSensors = Boolean(rules.walls?.blocksSensors);
  const blocksLaser = Boolean(rules.walls?.blocksLaser);
  const blocksStraightProjectiles = Boolean(rules.walls?.blocksStraightProjectiles);
  const sonarSeesThrough = Boolean(rules.walls?.sonarSeesThrough);

  // ── 위험구역 (지속 피해) ──
  // 반환: [{ kind, dps }]  (altitude: 'ground'|'low'|'high')
  function hazardsAt(x, z, altitude, t) {
    const out = [];
    const area = playArea(t);
    const outside = Math.abs(x) > area.halfW || Math.abs(z) > area.halfD;
    if (outside && (rules.shrink || state.extensionStart !== null)) {
      out.push({ kind: 'shrink', dps: rules.shrink?.hazardDps ?? 60 });
    }
    if (rules.lavaEdge) {
      const lv = rules.lavaEdge;
      const inLava = Math.abs(x) > halfW - lv.widthMeters || Math.abs(z) > halfD - lv.widthMeters;
      if (inLava && lv.affects.includes(altitude)) out.push({ kind: 'lava', dps: lv.dps });
    }
    return out;
  }

  // ── 주기 이벤트 ──
  const spk = rules.spikes;
  const spikePhase = (t) => (spk ? t % spk.periodSeconds : 0);
  const spikeActiveStart = spk ? spk.periodSeconds - spk.activeSeconds : 0;
  const spikeWarnStart = spk ? spikeActiveStart - spk.warnSeconds : 0;
  const spikesActive = (t) => Boolean(spk) && spikePhase(t) >= spikeActiveStart;
  const spikesWarning = (t) => Boolean(spk) && spikePhase(t) >= spikeWarnStart && spikePhase(t) < spikeActiveStart;

  const emp = rules.empStorm;
  const empPhase = (t) => (emp ? t % emp.periodSeconds : 0);
  const empStart = emp ? emp.warnAtSeconds + emp.warnLengthSeconds : 0;
  const empActive = (t) => Boolean(emp) && empPhase(t) >= empStart && empPhase(t) < empStart + emp.durationSeconds;
  const empWarning = (t) => Boolean(emp) && empPhase(t) >= emp.warnAtSeconds && empPhase(t) < empStart;

  // 운석 k번째(k ≥ 1): 충돌 시각 k × 간격, 위치는 k로 정해진다
  const met = rules.meteors;
  function meteorAt(k) {
    const r = createRng(seedBase ^ Math.imul(k, 0x9e3779b1));
    const mx = halfW - met.radius;
    const mz = halfD - met.radius;
    return { index: k, x: r.range(-mx, mx), z: r.range(-mz, mz), radius: met.radius, damage: met.damage, impactAt: k * met.intervalSeconds };
  }

  // t0 < 시각 ≤ t1 에 일어나는 일회성 사건: { kind, ... }
  function eventsBetween(t0, t1) {
    const out = [];
    if (met) {
      const first = Math.floor(t0 / met.intervalSeconds) + 1;
      for (let k = Math.max(1, first); k * met.intervalSeconds <= t1; k++) {
        if (k * met.intervalSeconds > t0) out.push({ kind: 'meteor', ...meteorAt(k) });
      }
    }
    if (spk) {
      // 작동 시작 순간(주기 끝 activeSeconds 전)에 한 번 피해
      const p = spk.periodSeconds;
      const first = Math.floor((t0 - spikeActiveStart) / p) + 1;
      for (let k = Math.max(0, first); k * p + spikeActiveStart <= t1; k++) {
        const at = k * p + spikeActiveStart;
        if (at > t0) for (const [i, pad] of spikePads.entries()) out.push({ kind: 'spikes', pad: i, x: pad.x, z: pad.z, radius: pad.radius, damage: spk.damage, at });
      }
    }
    return out;
  }

  // 지금 보이는 예고 목록 (전술의 '전장 이벤트 예고' 조건, 화면의 경고 표시)
  function warnings(t) {
    const out = [];
    if (met) {
      const k = Math.floor((t + met.warnSeconds) / met.intervalSeconds);
      for (const kk of [k, k + 1]) {
        if (kk < 1) continue;
        const m = meteorAt(kk);
        if (t >= m.impactAt - met.warnSeconds && t < m.impactAt) out.push({ kind: 'meteor', x: m.x, z: m.z, radius: m.radius, secondsLeft: m.impactAt - t });
      }
    }
    if (spikesWarning(t)) out.push({ kind: 'spikes', secondsLeft: spikeActiveStart - spikePhase(t) });
    if (empWarning(t)) out.push({ kind: 'emp', secondsLeft: empStart - empPhase(t) });
    if (rules.shrink) {
      const sh = rules.shrink;
      const next = t < sh.startAtSeconds ? sh.startAtSeconds : sh.startAtSeconds + (Math.floor((t - sh.startAtSeconds) / sh.intervalSeconds) + 1) * sh.intervalSeconds;
      if (next - t <= 3) out.push({ kind: 'shrink', secondsLeft: next - t });
    }
    return out;
  }

  // 스파이크 패드 위(지상)인지
  const onSpikePad = (x, z) => spikePads.some((p) => Math.hypot(x - p.x, z - p.z) <= p.radius);

  // 사거리 배율 (예: 심해 해구의 레이저 −30%)
  const rangeMult = (kind) => rules.rangeMult?.[kind] ?? 1;

  return {
    map, halfW, halfD, size: [w, d], rules, obstacles, spikePads, island,
    friction: map.friction ?? 1,
    bounceMult: rules.lowGravity?.bounceMult ?? 1,
    allSpaceAptitude: Boolean(rules.lowGravity?.allSpaceAptitude),
    blocksSensors, blocksLaser, blocksStraightProjectiles, sonarSeesThrough,
    playArea, envAt, segmentBlocked, hazardsAt, eventsBetween, warnings, rangeMult,
    spikesActive, spikesWarning, empActive, empWarning, onSpikePad, meteorAt,
    startExtension: (t) => { if (state.extensionStart === null) state.extensionStart = t; },
    get extensionStart() { return state.extensionStart; },
  };
}

// shared/sim/world.js  (27번)
// 경기 세계: 팀·기체·전장을 만들고 초기 상태를 정한다. 시뮬레이션의 모든 모듈이 이 구조를 읽고 씁니다.
// 한 틱을 진행하는 일(순서 ①~⑩)은 referee.js(34번)가 맡습니다. 화면 코드를 import하지 않습니다.
//
// ── 기체(entity) 필드 ──────────────────────────────────
//  식별     id('A1'…), team('A'|'B'), index(팀 안 출전 순서), name, owner
//  설계     design, tree, layout, form('A'|'B'), parts: Map uid → 파츠 런타임 상태 (energy.js 참고)
//  위치     pos{x,z}, altitude('ground'|'low'|'high'), altChange{to,until}|null, heading(rad), vel{x,z}, angVel
//  자원     hp, maxHp, energy, maxEnergy, spirit, spiritMax, gauge, alive
//  명령     cmd (actions.js의 명령 형태), ai (태세·변수·타이머·대상), used(이번 틱 사용 파츠)
//  상태     status{immobilizedUntil, empUntil, stealthBrokenUntil, invulnUntil …}, mods{…배율}, skills[]
//  기록     stats{damageDealt, damageTaken, partsLost, energySpent …}
//  현재값   dyn (energy.refreshDynamics 결과)

import { buildTree } from '../build/assembly.js';
import { layoutTree } from '../build/layout.js';
import { computeStatsFromTree } from '../build/stats.js';
import { createRng } from '../util/rng.js';
import { CONSTANTS } from '../../config/constants.js';
import { PILOT_SKILLS } from '../../data/pilot-skills.js';
import { createTerrain } from './terrain.js';
import { refreshDynamics } from './energy.js';
import { sanitizeTactics } from '../tactics/validator.js';
import { emptyTactics } from '../tactics/schema.js';
import { makeContext } from '../build/assembly.js';

export const ALTITUDES = Object.freeze(['ground', 'low', 'high']);
export const ALT_INDEX = Object.freeze({ ground: 0, low: 1, high: 2 });

export const defaultMods = () => ({
  speed: 1, accel: 1, turn: 1, attack: 1, damageTaken: 1, cooldown: 1, dodge: 0, reduce: 1,
});

// 파츠 런타임 상태 만들기
function makePartState(node) {
  const d = node.def;
  return {
    uid: node.uid, partId: node.partId, def: d,
    state: 'ok',
    durability: d.durability ?? null,
    maxDurability: d.durability ?? null,
    disabledUntil: 0,
    on: d.id === 'sp_stealth' ? false : true, // 은신 장치는 필요할 때 켠다
    cooldown: 0,
    ammo: d.ammo ?? null,
    heat: 0,
    heatLockedUntil: 0,
  };
}

export const emptyCommand = () => ({
  throttle: 0, turn: 0, altTarget: null, thrustPct: null, targetId: null,
  weapon: { use: [], hold: false, charge: [], overdrive: false, interval: {}, aimOffsetDeg: 0 },
  defense: { shield: null, intercept: null, repair: null, phase: false, skill: null },
  special: { transform: false, fusionSignal: false, detach: null },
  toggles: [],
});

function makeEntity({ id, team, index, design, tactics, owner }, ctx, constants) {
  const tree = buildTree(design, ctx);
  const layout = layoutTree(tree, ctx);
  const base = computeStatsFromTree(tree, { form: 'A', pilot: design.pilot, layout });
  const parts = new Map();
  for (const uid of tree.order) parts.set(uid, makePartState(tree.nodes.get(uid)));
  const pilot = design.pilot || {};
  const sp = constants.spirit;
  const e = {
    id, team, index, name: design.name, owner: owner ?? null,
    design, tree, layout, form: 'A', parts,
    pos: { x: 0, z: 0 }, altitude: 'ground', altChange: null, heading: 0, vel: { x: 0, z: 0 }, angVel: 0,
    hp: base.hp, maxHp: base.hp,
    energy: base.power.capacity, maxEnergy: base.power.capacity,
    spirit: sp.start, spiritMax: base.spirit.max, gauge: 0,
    alive: true, defeatedAt: null,
    radius: base.collisionRadius, // 외곽 반경(가장 먼 모서리) — 사거리·환경 피해 판정용
    bodyRadius: base.collisionRadius * constants.physics.collisionRadiusFactor, // 충돌 반경
    base,
    temperament: pilot.temperament || 'composed',
    skills: (pilot.skills || []).map((sid) => ({ id: sid, usesLeft: (ctx.pilotSkills || PILOT_SKILLS)[sid].uses, activeUntil: 0 })),
    cmd: emptyCommand(), used: new Set(),
    status: { immobilizedUntil: 0, empUntil: 0, empImmuneUntil: 0, stealthBrokenUntil: 0, invulnUntil: 0, transformUntil: 0, transformCooldownUntil: 0 },
    mods: defaultMods(),
    tactics: sanitizeTactics(tactics || emptyTactics(), { design, constants }),
    ai: null,
    stats: { damageDealt: 0, damageTaken: 0, partsLost: 0, partsDestroyed: 0, energySpent: 0, lastHitAt: -Infinity, lastDealtAt: -Infinity },
    dyn: null,
  };
  e.ai = {
    stance: e.tactics.startStance, stanceSince: 0,
    vars: Object.fromEntries(e.tactics.variables.map((v) => [v.id, v.init])),
    timers: Object.fromEntries(e.tactics.timers.map((tm) => [tm.id, null])),
    targetId: null, lockedSelector: null, lockedTargetId: null, lockedUntil: null,
    circleDir: index % 2 === 0 ? 1 : -1,
    fusionSignalAt: -Infinity, fusionSignalCooldownUntil: 0,
    pendingStance: null,
  };
  return e;
}

/**
 * 경기 세계 만들기.
 * config: {
 *   teams: [{ id:'A', entries:[{ design, tactics, owner? }] }, { id:'B', ... }],   // 각 1~3기, 두 팀 같은 수
 *   map, seed, balance?(constants 덮어쓰기), limits?
 * }
 */
export function createWorld(config) {
  const constants = config.constants || CONSTANTS;
  const ctx = makeContext({ parts: config.parts, constants });
  ctx.pilotSkills = config.pilotSkills || PILOT_SKILLS; // 조율 센터가 고친 각성기 수치(없으면 기본)
  const teamSize = config.teams[0].entries.length;
  if (config.teams.length !== 2) throw new Error('팀은 정확히 2개여야 합니다');
  if (!config.teams.every((t) => t.entries.length === teamSize)) throw new Error('두 팀의 기체 수가 같아야 합니다');
  if (teamSize < constants.match.minTeamSize || teamSize > constants.match.maxTeamSize) throw new Error('팀 크기는 1~3입니다');

  const seed = config.seed ?? 1;
  const terrain = createTerrain({ map: config.map, teamSize, seed, constants });
  const rng = createRng(seed);

  const entities = [];
  config.teams.forEach((team, ti) => {
    team.entries.forEach((entry, i) => {
      const e = makeEntity({ id: `${team.id}${i + 1}`, team: team.id, index: i, design: entry.design, tactics: entry.tactics, owner: entry.owner }, ctx, constants);
      // 시작 위치: A는 서쪽, B는 동쪽 라인에서 마주 봄. 앞(−z)을 상대 쪽으로 돌린다.
      const side = ti === 0 ? -1 : 1;
      e.pos = {
        x: side * terrain.halfW * constants.physics.spawnLineRatio,
        z: (i - (teamSize - 1) / 2) * constants.match.spawnGap,
      };
      e.heading = side === -1 ? -Math.PI / 2 : Math.PI / 2; // heading −π/2 → 앞이 +x
      entities.push(e);
    });
  });

  const world = {
    constants, ctx, skillDefs: ctx.pilotSkills, map: config.map, terrain, rng,
    seed, tick: 0, time: 0,
    teamSize,
    teamIds: config.teams.map((t) => t.id),
    entities,
    byId: new Map(entities.map((e) => [e.id, e])),
    teams: Object.fromEntries(config.teams.map((t) => [t.id, { id: t.id, shared: new Array(constants.tactics.maxSharedVariables).fill(0), fusionCooldownUntil: 0 }])),
    projectiles: [], // 날아가는 투사체 (weapons.js)
    effects: [], // 지속 효과: 중력 끌림, 중독 등 (weapons.js)
    nextProjectileId: 1,
    events: [], // 이번 틱에 일어난 일 (충돌·피해·이탈…). 스냅샷·효과음·로그가 읽는다. 틱 시작에 비운다.
    log: [],
    frozen: false, // 융합 연출 중
    over: false, result: null,
  };
  for (const e of entities) refreshDynamics(e, 0, terrain);
  return world;
}

// ── 조회 ────────────────────────────────────────────────
export const enemiesOf = (world, e) => world.entities.filter((o) => o.team !== e.team);
export const alliesOf = (world, e) => world.entities.filter((o) => o.team === e.team && o !== e);
export const aliveEnemies = (world, e) => enemiesOf(world, e).filter((o) => o.alive);
export const aliveAllies = (world, e) => alliesOf(world, e).filter((o) => o.alive);
export const entityById = (world, id) => world.byId.get(id) || null;

export function pushEvent(world, ev) {
  world.events.push({ tick: world.tick, time: world.time, ...ev });
}

// 팀 체력비 = Σ현재체력 ÷ Σ최대체력 (제한시간 종료 판정용)
export function teamHpRatio(world, teamId) {
  const list = world.entities.filter((e) => e.team === teamId);
  const max = list.reduce((s, e) => s + e.maxHp, 0);
  const cur = list.reduce((s, e) => s + (e.alive ? Math.max(0, e.hp) : 0), 0);
  return max > 0 ? cur / max : 0;
}

// 현재 환경에 맞는 적성 환경 키: 지상 전장에서 저공·고공에 떠 있으면 '공중' 적성
export function aptitudeEnv(world, e) {
  if (world.terrain.allSpaceAptitude) return 'space';
  const env = world.terrain.envAt(e.pos.x, e.pos.z);
  if (env === 'ground' && e.altitude !== 'ground') return 'air';
  return env;
}

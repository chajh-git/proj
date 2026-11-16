// data/parts.js
// 부품 카탈로그 전체 (명세 v1.0 7장). 수치의 원본이며 조율 센터가 이 값을 덮어쓸 수 있습니다.
//
// 공통 필드
//   id          고유 ID
//   name        화면에 보이는 이름
//   category    core | structure | joint | mobility | armor | defense | sensor | weapon | overdrive | spirit | cell | special
//   size        접속 크기 'S'|'M'|'L' (코어는 null) — 같은 크기 이상의 연결점에 붙는다
//   weight      무게(질량)
//   cost        비용(pt)
//   power       소모 전력(EU/s). 단발 무기는 1회 사용 = power × 1초
//   drain       'always'(활성 중 계속 소모) | 'onUse'(대기 시 power×0.1, 사용 중 power)
//   durability  파츠 내구도 (코어·구조체는 null: 파괴되지 않고 기체 체력의 일부)
//   tags        융합 조건 재료 (data/tags.js)
//   electronic  true면 EMP에 정지됨
//   provides    이 파츠가 새로 제공하는 연결점 개수 { S, M, L }
// 나머지 필드는 카테고리별 고유 효과 수치입니다.

const DEF = { power: 0, drain: 'onUse', durability: null, tags: [], electronic: false, provides: { S: 0, M: 0, L: 0 } };

const P = (p) => {
  const out = { ...DEF, ...p, provides: { ...DEF.provides, ...(p.provides || {}) } };
  out.tags = Object.freeze([...(p.tags || [])]);
  out.provides = Object.freeze(out.provides);
  return Object.freeze(out);
};

// ── 7-1. 코어 ──────────────────────────────────────────────
const CORES = [
  P({ id: 'core1', name: '마이크로 퓨전 코어', category: 'core', size: null, weight: 10, cost: 100,
      output: 100, capacity: 9000, baseHp: 300, provides: { S: 4, M: 2, L: 0 }, tags: ['machine'] }),
  P({ id: 'core2', name: '플라즈마 코어', category: 'core', size: null, weight: 18, cost: 260,
      output: 220, capacity: 20000, baseHp: 500, provides: { S: 6, M: 3, L: 1 }, tags: ['thunder'] }),
  P({ id: 'core3', name: '반물질 코어', category: 'core', size: null, weight: 30, cost: 650,
      output: 450, capacity: 40000, baseHp: 800, provides: { S: 8, M: 4, L: 2 }, tags: ['radiance'] }),
];

// ── 7-2. 구조체 (파괴 불가, 기체 체력 +) ─────────────────────
const STRUCTURES = [
  P({ id: 'fr_light', name: '경량 프레임', category: 'structure', size: 'S', weight: 3, cost: 20,
      hpBonus: 40, provides: { S: 2, M: 0, L: 0 }, tags: ['machine'] }),
  P({ id: 'fr_std', name: '표준 프레임', category: 'structure', size: 'M', weight: 8, cost: 50,
      hpBonus: 120, provides: { S: 2, M: 1, L: 0 }, tags: ['machine'] }),
  P({ id: 'fr_heavy', name: '중장 프레임', category: 'structure', size: 'L', weight: 16, cost: 110,
      hpBonus: 260, provides: { S: 2, M: 2, L: 1 }, tags: ['machine'] }),
  P({ id: 'fr_human', name: '인간형 몸통', category: 'structure', size: 'M', weight: 14, cost: 90,
      hpBonus: 170, provides: { S: 3, M: 2, L: 0 }, tags: ['machine'] }),
  P({ id: 'fr_beast', name: '야수 몸통', category: 'structure', size: 'M', weight: 14, cost: 90,
      hpBonus: 190, provides: { S: 3, M: 2, L: 0 }, tags: ['beast'] }),
  P({ id: 'fr_sea', name: '유선형 몸통', category: 'structure', size: 'M', weight: 13, cost: 95,
      hpBonus: 160, provides: { S: 3, M: 2, L: 0 }, tags: ['abyss'] }),
  P({ id: 'fr_wyrm', name: '비늘 몸통', category: 'structure', size: 'L', weight: 18, cost: 150,
      hpBonus: 220, provides: { S: 3, M: 2, L: 1 }, tags: ['flame', 'ancient'] }),
];

// ── 7-3. 관절·마운트·케이블 ──────────────────────────────────
const JOINTS = [
  P({ id: 'jt_ext', name: '확장 관절', category: 'joint', size: 'S', weight: 2, cost: 30, power: 2,
      durability: 60, provides: { S: 2, M: 0, L: 0 }, tags: ['machine'] }),
  P({ id: 'jt_morph', name: '가변 관절', category: 'joint', size: 'M', weight: 6, cost: 100, power: 8,
      durability: 90, provides: { S: 2, M: 1, L: 0 }, morphable: true, tags: ['machine'] }),
  P({ id: 'jt_cable', name: '전력 중계 케이블', category: 'joint', size: 'S', weight: 1, cost: 10, power: 0,
      durability: 40, relay: true, provides: { S: 1 }, tags: ['machine'] }),
  P({ id: 'jt_turret', name: '터렛 마운트', category: 'joint', size: 'M', weight: 6, cost: 70, power: 6,
      durability: 100, provides: { S: 0, M: 1, L: 0 }, turret: { arcDeg: 120, turnRateDeg: 180 },
      tags: ['machine'], electronic: true }),
];

// ── 7-4. 이동 기관 ───────────────────────────────────────────
// aptitude: 지상/수중/공중/우주 등급, maxAltitude: 이동 가능한 최고 고도층
const MOBILITY = [
  P({ id: 'mv_servo', name: '강화 다리 서보', category: 'mobility', size: 'M', weight: 8, cost: 60, power: 20,
      durability: 120, thrust: 300, maxSpeed: 9, turn: 120, maxAltitude: 'ground',
      aptitude: { ground: 'A', water: 'C', air: 'D', space: 'C' }, tags: ['machine'] }),
  P({ id: 'mv_beast', name: '야수 다리 세트', category: 'mobility', size: 'M', weight: 14, cost: 110, power: 32,
      durability: 180, thrust: 520, maxSpeed: 12, turn: 150, maxAltitude: 'ground',
      aptitude: { ground: 'S', water: 'C', air: 'D', space: 'C' }, tags: ['beast'] }),
  P({ id: 'mv_booster', name: '소형 부스터', category: 'mobility', size: 'S', weight: 4, cost: 50, power: 30,
      durability: 60, thrust: 180, maxSpeed: 14, turn: 90, maxAltitude: 'high',
      aptitude: { ground: 'D', water: 'D', air: 'B', space: 'A' }, tags: ['space'] }),
  P({ id: 'mv_wing', name: '날개 추진기', category: 'mobility', size: 'M', weight: 12, cost: 140, power: 36,
      durability: 110, thrust: 400, maxSpeed: 16, turn: 140, maxAltitude: 'high',
      aptitude: { ground: 'C', water: 'D', air: 'S', space: 'B' }, tags: ['beast'] }),
  P({ id: 'mv_jet', name: '수중 제트', category: 'mobility', size: 'M', weight: 9, cost: 90, power: 26,
      durability: 130, thrust: 350, maxSpeed: 11, turn: 100, maxAltitude: 'ground',
      aptitude: { ground: 'D', water: 'S', air: 'D', space: 'C' }, tags: ['abyss'] }),
  P({ id: 'mv_hover', name: '호버 패드', category: 'mobility', size: 'M', weight: 7, cost: 80, power: 24,
      durability: 100, thrust: 260, maxSpeed: 10, turn: 110, maxAltitude: 'low',
      aptitude: { ground: 'B', water: 'B', air: 'C', space: 'B' }, tags: ['machine'] }),
  P({ id: 'mv_space', name: '우주 추력 노즐', category: 'mobility', size: 'L', weight: 10, cost: 150, power: 40,
      durability: 100, thrust: 450, maxSpeed: 18, turn: 90, maxAltitude: 'high',
      aptitude: { ground: 'D', water: 'D', air: 'B', space: 'S' }, tags: ['space'] }),
];

// ── 7-5. 장갑 (경감은 해당 파츠 자신의 피해에 적용) ───────────
const ARMOR = [
  P({ id: 'ar_ti', name: '티타늄 합금판', category: 'armor', size: 'M', weight: 7, cost: 50, durability: 180,
      reduce: { physical: 0.25 }, tags: ['machine'] }),
  P({ id: 'ar_nano', name: '나노 장갑', category: 'armor', size: 'M', weight: 5, cost: 110, durability: 140,
      reduce: { physical: 0.2, energy: 0.2 }, selfRepairPerSecond: 2, tags: ['radiance'] }),
  P({ id: 'ar_react', name: '반응 장갑', category: 'armor', size: 'S', weight: 3, cost: 60, durability: 80,
      absorbFirstHit: true, reduce: { physical: 0.1 }, tags: ['flame'] }),
  P({ id: 'ar_mirror', name: '반사 코팅', category: 'armor', size: 'S', weight: 1, cost: 40, durability: 50,
      reduce: { energy: 0.6 }, tags: ['radiance'] }),
  P({ id: 'ar_heavy', name: '중장 방패판', category: 'armor', size: 'L', weight: 15, cost: 100, durability: 320,
      reduce: { physical: 0.35 }, tags: ['ancient'] }),
];

// ── 7-6. 방어 (능동) ─────────────────────────────────────────
const DEFENSE = [
  P({ id: 'ds_shield', name: '에너지 실드', category: 'defense', size: 'M', weight: 6, cost: 150, power: 25,
      drain: 'always', durability: 90, shieldAbsorb: 200, rebootSeconds: 8, tags: ['radiance'], electronic: true }),
  P({ id: 'ds_intercept', name: '미사일 요격기', category: 'defense', size: 'S', weight: 3, cost: 90, power: 5,
      durability: 70, interceptRange: 15, ammo: 6, cooldown: 1.5, tags: ['machine'], electronic: true }),
  P({ id: 'ds_emp', name: 'EMP 방호막', category: 'defense', size: 'S', weight: 2, cost: 80, power: 10,
      drain: 'always', durability: 60, empImmune: true, tags: ['thunder'] }),
  P({ id: 'ds_repair', name: '수리 나노봇', category: 'defense', size: 'S', weight: 2, cost: 120, power: 12,
      drain: 'always', durability: 70, repairPartPerSecond: 6, repairHpPerSecond: 2, tags: ['radiance'], electronic: true }),
  P({ id: 'ds_phase', name: '위상 전환기', category: 'defense', size: 'M', weight: 5, cost: 200, power: 80,
      durability: 80, invulnSeconds: 1.5, cooldown: 20, tags: ['space'], electronic: true }),
  P({ id: 'ds_regen', name: '재생 코어', category: 'defense', size: 'M', weight: 7, cost: 220, power: 10,
      durability: 100, reviveHpPct: 0.4, reviveStunSeconds: 4, reviveCount: 1, tags: ['flame', 'ancient'] }),
];

// ── 7-7. 센서 (상시형) ───────────────────────────────────────
// info: 이 센서가 열어주는 정보 키 (shared/tactics/sensors.js가 해석)
const SENSORS = [
  P({ id: 'se_radar', name: '근접 레이더', category: 'sensor', size: 'S', weight: 1, cost: 30, power: 2,
      drain: 'always', durability: 50, range: 30, info: ['enemy_distance', 'enemy_bearing'],
      tags: ['machine'], electronic: true }),
  P({ id: 'se_thermal', name: '열감지', category: 'sensor', size: 'S', weight: 1, cost: 40, power: 3,
      drain: 'always', durability: 50, range: 15, info: ['stealth_reveal', 'enemy_energy_pct'],
      tags: ['flame'], electronic: true }),
  P({ id: 'se_bio', name: '생체 스캐너', category: 'sensor', size: 'S', weight: 2, cost: 60, power: 4,
      drain: 'always', durability: 60, range: 25, info: ['enemy_hp_pct', 'enemy_spirit', 'enemy_part_state'],
      tags: ['radiance'], electronic: true }),
  P({ id: 'se_sonar', name: '소나', category: 'sensor', size: 'S', weight: 2, cost: 50, power: 3,
      drain: 'always', durability: 50, range: 20, info: ['through_walls', 'underwater_detect'],
      tags: ['abyss'], electronic: true }),
  P({ id: 'se_quantum', name: '양자 센서', category: 'sensor', size: 'M', weight: 4, cost: 180, power: 8,
      drain: 'always', durability: 80, range: 40,
      info: ['enemy_distance', 'enemy_bearing', 'stealth_reveal', 'enemy_energy_pct', 'enemy_hp_pct',
        'enemy_spirit', 'enemy_part_state', 'through_walls', 'underwater_detect', 'enemy_stance_name'],
      tags: ['space'], electronic: true }),
  P({ id: 'se_comm', name: '통신기', category: 'sensor', size: 'S', weight: 1, cost: 40, power: 2,
      drain: 'always', durability: 50, range: null, info: ['ally_precise', 'shared_vars'],
      tags: ['machine'], electronic: true }),
];

// ── 7-8. 무기 ────────────────────────────────────────────────
// damageType: physical | energy | emp | poison, range(m), cooldown(초)
const WEAPONS = [
  P({ id: 'wp_claw', name: '발톱', category: 'weapon', size: 'S', weight: 2, cost: 35, power: 2, durability: 60,
      damageType: 'physical', damage: 25, cooldown: 0.8, range: 1.2, melee: true, tags: ['beast'] }),
  P({ id: 'wp_fang', name: '송곳니', category: 'weapon', size: 'M', weight: 4, cost: 45, power: 3, durability: 80,
      damageType: 'physical', damage: 40, cooldown: 1.2, range: 1.2, melee: true, tags: ['beast'] }),
  P({ id: 'wp_tail', name: '꼬리 채찍', category: 'weapon', size: 'M', weight: 5, cost: 55, power: 5, durability: 80,
      damageType: 'physical', damage: 50, cooldown: 2, range: 3, melee: true, canHitRear: true, tags: ['beast'] }),
  P({ id: 'wp_spin_h', name: '수평 스피너', category: 'weapon', size: 'M', weight: 9, cost: 50, power: 15, durability: 90,
      damageType: 'physical', damagePerSecond: 25, contact: true, range: 1.5, melee: true,
      selfTurnPenalty: 0.1, tags: ['machine'] }),
  P({ id: 'wp_hammer', name: '해머 암', category: 'weapon', size: 'M', weight: 10, cost: 60, power: 6, durability: 100,
      damageType: 'physical', damage: 90, cooldown: 3, range: 2.5, melee: true, recoverySeconds: 0.8, tags: ['ancient'] }),
  P({ id: 'wp_lift', name: '리프터 웨지', category: 'weapon', size: 'M', weight: 8, cost: 40, power: 4, durability: 90,
      damageType: 'physical', damage: 10, cooldown: 6, range: 1.5, melee: true, immobilizeSeconds: 1.5, tags: ['machine'] }),
  P({ id: 'wp_spin_v', name: '수직 스피너', category: 'weapon', size: 'L', weight: 16, cost: 150, power: 30, durability: 140,
      damageType: 'physical', damagePerSecond: 40, contact: true, range: 1.8, melee: true,
      flipIntervalSeconds: 5, flipImmobilizeSeconds: 1, tags: ['machine'] }),
  P({ id: 'wp_plasma', name: '플라즈마 건', category: 'weapon', size: 'M', weight: 8, cost: 130, power: 14, durability: 90,
      damageType: 'energy', damage: 15, cooldown: 0.3, range: 25, projectile: true,
      heatPerShot: 5, heatMax: 100, overheatLockSeconds: 4, heatCoolPerSecond: 10,
      tags: ['thunder'], electronic: true }),
  P({ id: 'wp_missile', name: '소형 미사일 포드', category: 'weapon', size: 'M', weight: 9, cost: 140, power: 4, durability: 90,
      damageType: 'physical', damage: 45, cooldown: 1.5, range: 40, ammo: 6, projectile: true, homing: true,
      projectileSpeed: 20, interceptable: true, tags: ['flame'] }),
  P({ id: 'wp_stun', name: '스턴 건', category: 'weapon', size: 'S', weight: 3, cost: 110, power: 20, durability: 60,
      damageType: 'energy', damage: 0, cooldown: 8, range: 10, disablePartSeconds: 2.5,
      tags: ['thunder'], electronic: true }),
  P({ id: 'wp_breath', name: '브레스', category: 'weapon', size: 'L', weight: 12, cost: 180, power: 28, durability: 130,
      damageType: 'energy', damagePerSecond: 60, durationSeconds: 2, cooldown: 6, range: 8, cone: true, tags: ['flame'] }),
  P({ id: 'wp_laser', name: '레이저 캐논', category: 'weapon', size: 'M', weight: 10, cost: 260, power: 38, durability: 90,
      damageType: 'energy', damage: 55, cooldown: 2.5, range: 35, hitscan: true, tags: ['radiance'], electronic: true }),
  P({ id: 'wp_emp', name: 'EMP 펄스', category: 'weapon', size: 'M', weight: 7, cost: 240, power: 45, durability: 80,
      damageType: 'emp', damage: 0, cooldown: 18, range: 12, area: true, disableElectronicsSeconds: 4, tags: ['thunder'] }),
  P({ id: 'wp_grav', name: '중력 포', category: 'weapon', size: 'L', weight: 18, cost: 320, power: 55, durability: 140,
      damageType: 'physical', damage: 20, cooldown: 10, range: 20, pullSpeed: 12, pullSeconds: 1, canPush: true,
      tags: ['space'] }),
  P({ id: 'wp_rail', name: '궤도 레일건', category: 'weapon', size: 'L', weight: 28, cost: 650, power: 200, durability: 160,
      damageType: 'physical', damage: 220, cooldown: 12, range: 60, chargeSeconds: 4, pierce: true,
      tags: ['space', 'machine'] }),
  P({ id: 'wp_nano', name: '나노봇 군집 발사기', category: 'weapon', size: 'M', weight: 8, cost: 500, power: 15, durability: 90,
      damageType: 'poison', damage: 0, cooldown: 25, range: 30, tickSeconds: 2, partDurabilityPerTick: 4,
      durationSeconds: 20, ignoresArmor: true, tags: ['radiance'], electronic: true }),
];

// ── 7-9. 오버드라이브 병기 (게이지 100 소모) ──────────────────
const OVERDRIVES = [
  P({ id: 'od_annihil', name: '소멸포', category: 'overdrive', size: 'L', weight: 14, cost: 300, durability: 110,
      damageType: 'energy', damage: 150, line: { length: 12, width: 2 }, energyCost: 400, tags: ['radiance'] }),
  P({ id: 'od_blast', name: '광역 폭발', category: 'overdrive', size: 'L', weight: 12, cost: 260, durability: 110,
      damageType: 'physical', damage: 120, radius: 10, excludeSelf: true, tags: ['flame'] }),
  P({ id: 'od_rush', name: '초가속 돌진', category: 'overdrive', size: 'M', weight: 8, cost: 220, durability: 90,
      speedMult: 2, durationSeconds: 5, contactDamage: 100, oncePerTarget: true, tags: ['beast'] }),
];

// ── 7-10. 투지·게이지·에너지·특수 ────────────────────────────
const SPIRIT_PARTS = [
  P({ id: 'sp_amp', name: '투지 증폭기', category: 'spirit', size: 'S', weight: 1, cost: 60, power: 1, durability: 50,
      spiritMaxBonus: 30, tags: ['radiance'], electronic: true }),
  P({ id: 'sp_stab', name: '투지 안정기', category: 'spirit', size: 'S', weight: 1, cost: 50, power: 1, durability: 50,
      spiritLossMult: 0.6, tags: ['ancient'], electronic: true }),
  P({ id: 'sp_circuit', name: '전의 회로', category: 'spirit', size: 'S', weight: 1, cost: 70, power: 1, durability: 50,
      spiritGainMult: 1.5, tags: ['thunder'], electronic: true }),
  P({ id: 'od_cap', name: '오버드라이브 축전기', category: 'spirit', size: 'S', weight: 2, cost: 80, power: 1, durability: 50,
      gaugeChargeMult: 1.4, tags: ['thunder'], electronic: true }),
];

const CELLS = [
  P({ id: 'sp_cell_s', name: '보조 에너지 셀(소)', category: 'cell', size: 'S', weight: 6, cost: 60, power: 0, durability: 80,
      capacity: 3000, output: 15, tags: ['machine'] }),
  P({ id: 'sp_cell_m', name: '보조 에너지 셀(중)', category: 'cell', size: 'M', weight: 14, cost: 140, power: 0, durability: 110,
      capacity: 8000, output: 35, tags: ['machine'] }),
];

const SPECIAL = [
  P({ id: 'sp_stealth', name: '은신 장치', category: 'special', size: 'S', weight: 3, cost: 140, power: 15, drain: 'always',
      durability: 60, blocksDetection: true, speedMult: 0.7, breakAfterAttackSeconds: 3,
      tags: ['beast'], electronic: true }),
];

// ── 전체 목록과 조회 ─────────────────────────────────────────
export const PARTS = Object.freeze([
  ...CORES, ...STRUCTURES, ...JOINTS, ...MOBILITY, ...ARMOR, ...DEFENSE,
  ...SENSORS, ...WEAPONS, ...OVERDRIVES, ...SPIRIT_PARTS, ...CELLS, ...SPECIAL,
]);

export const PART_BY_ID = Object.freeze(Object.fromEntries(PARTS.map((p) => [p.id, p])));

export const PARTS_BY_CATEGORY = Object.freeze(
  PARTS.reduce((acc, p) => {
    (acc[p.category] ||= []).push(p);
    return acc;
  }, {}),
);

export const CATEGORY_ORDER = Object.freeze([
  'core', 'structure', 'joint', 'mobility', 'armor', 'defense', 'sensor', 'weapon', 'overdrive', 'spirit', 'cell', 'special',
]);

export function getPart(id) {
  const p = PART_BY_ID[id];
  if (!p) throw new Error(`알 수 없는 파츠 ID: ${id}`);
  return p;
}

// 파괴·이탈 대상인지 (코어와 구조체는 파괴되지 않는다)
export const isDestructible = (p) => p.category !== 'core' && p.category !== 'structure';

// 고도층 순서 (이동 기관의 maxAltitude 비교용)
export const ALTITUDE_RANK = Object.freeze({ ground: 0, low: 1, high: 2 });

export const SIZE_RANK = Object.freeze({ S: 1, M: 2, L: 3 });

// 파츠(size)가 해당 크기의 연결점(slotSize)에 붙을 수 있는가: 같은 크기 이하의 파츠만 가능
export const fitsSlot = (partSize, slotSize) => SIZE_RANK[partSize] <= SIZE_RANK[slotSize];

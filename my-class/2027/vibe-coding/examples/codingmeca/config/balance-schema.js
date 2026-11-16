// config/balance-schema.js  (101번)
// 조율 센터(밸런스 에디터)의 변수 명세 — 이 파일이 유일한 원본이다. (명세 18-1)
//   · 화면 컴포넌트는 이 명세로 자동 만들어지고, shared/balance/merge.js 가 기본 수치와 저장된 수치를 합치며 범위를 벗어난 값을 바로잡는다.
//   · 서버도 같은 명세로 저장 전에 검사한다(클라이언트가 보낸 값은 믿지 않는다).
//   · 기본값은 config/constants.js 에서 읽는다(숫자를 두 군데 적지 않기 위해).
//
// 변수 형식(type):
//   int       정수 범위                  슬라이더 + 숫자
//   num       실수 범위                  슬라이더 + 숫자
//   ratio     비율·배율(0.2 = 20%)       퍼센트 슬라이더 + 숫자
//   seconds   시간(초)                   스테퍼 + 슬라이더
//   bool      참/거짓                    토글
//   enum      열거 { options }           세그먼트 버튼
//   multi     다중 선택 { options }      칩 토글
//   range     구간 [낮음, 높음]          이중 핸들 슬라이더
//   curve     곡선 [[x,y],…]            핸들 드래그 편집기 { xMin,xMax,yMin,yMax, points(개수 고정) }
//   triple    크기별 개수 {S,M,L}        3칸 스테퍼
//   record    같은 형식의 이름 붙은 값들(예: 적성 S~D)  { keys:[[키,라벨]…], item:'ratio'|'num'|'int' }
// 공통 필드: path(constants 안의 경로), label, desc, unit, min, max, step, adv(고급: 접어 둠), public(기본 true; 레시피처럼 비밀이면 false)

import { CONSTANTS } from './constants.js';
import { PARTS } from '../data/parts.js';
import { MAPS } from '../data/maps.js';
import { PILOT_SKILLS } from '../data/pilot-skills.js';
import { LEAGUE_PRESETS } from '../data/league-presets.js';
import { TAGS } from '../data/tags.js';

const V = (type, path, label, min, max, extra = {}) => ({ type, path, label, min, max, public: true, ...extra });
const int = (path, label, min, max, extra) => V('int', path, label, min, max, { step: 1, ...extra });
const num = (path, label, min, max, extra) => V('num', path, label, min, max, { step: 0.01, ...extra });
const ratio = (path, label, min, max, extra) => V('ratio', path, label, min, max, { step: 0.01, ...extra });
const secs = (path, label, min, max, extra) => V('seconds', path, label, min, max, { step: 1, unit: '초', ...extra });
const bool = (path, label, extra) => ({ type: 'bool', path, label, public: true, ...extra });
const GRADES = [['S', 'S'], ['A', 'A'], ['B', 'B'], ['C', 'C'], ['D', 'D']];

export const BALANCE_GROUPS = Object.freeze([
  {
    id: 'global', label: '전역 규칙', desc: '시간·무게 상한·예산·시작 투지처럼 경기 전체에 걸리는 값',
    vars: [
      secs('time.matchSeconds', '제한시간', 30, 600, { step: 5, desc: '리그가 따로 정하지 않으면 이 시간으로 진행합니다.' }),
      secs('time.extensionSeconds', '연장 시간', 0, 120, { step: 5, desc: '제한시간 뒤 동률일 때 이어지는 시간(전장이 급히 좁아집니다).' }),
      secs('time.countdownSeconds', '개시 카운트다운', 1, 15),
      bool('match.extensionHazardShrink', '연장 때 전장 급축소'),
      int('limits.weightCap', '기체 무게 상한', 10, 999, { unit: 'kg', desc: '리그 설정이 없을 때의 기본값입니다.' }),
      int('limits.budget', '기체 예산', 100, 99999, { desc: '조종사 각성기 비용을 포함합니다.' }),
      int('limits.pilotSkillSlots', '각성기 칸 수', 0, 4),
      int('spirit.start', '시작 투지', 0, 100),
      int('league.concurrentMatches', '동시 경기 수(기본)', 1, 4),
      bool('league.allowRepairBetweenMatches', '경기 사이 정비 허용(기본)'),
    ],
  },
  {
    id: 'damage', label: '피해 모델', desc: '파츠가 맞았을 때 어디까지 전달되고 언제 부서지는지',
    vars: [
      ratio('damage.transferRatio', '기체 체력으로 전달되는 비율', 0, 1, { desc: '파츠 피해 중 이 비율이 기체 체력에서 빠집니다.' }),
      ratio('damage.brokenThreshold', '파손 임계(내구도)', 0, 0.9, { desc: '내구도가 이 비율 이하면 기능이 멈춥니다.' }),
      int('damage.detachSpiritLoss', '파츠 이탈 시 투지 감소', 0, 50),
      int('damage.exposureRays', '노출도 방향 수', 2, 16, { adv: true }),
      num('physics.ramThresholdSpeed', '충돌 피해 시작 속도', 0, 20, { unit: 'm/s', step: 0.5 }),
      num('physics.ramDamageFactor', '충돌 피해 계수', 0, 0.5, { step: 0.005, desc: '(상대속도 − 임계) × 상대 질량 × 이 값' }),
      num('physics.restitution', '충돌 반발 계수', 0, 1),
    ],
  },
  {
    id: 'stats', label: '능력 공식 계수', desc: '무게·무게중심이 속도·선회에 미치는 영향. 바꾸면 모든 기체의 느낌이 달라집니다.', adv: true,
    vars: [
      int('stats.maxSpeedWeightDivisor', '최고속 무게 나눔수', 20, 1000, { desc: 'v = 평균 최고속 ÷ (1 + 무게 ÷ 이 값)' }),
      int('stats.turnBaseWeight', '선회 기준 무게', 10, 500),
      num('stats.turnCenterPenalty', '무게중심 편차 감점', 0, 2),
      int('stats.moveEnergyWeightDivisor', '이동 에너지 무게 나눔수', 10, 500),
      num('physics.reverseSpeedMult', '후진 속도 비율', 0, 1),
      num('physics.turnResponse', '선회 반응', 1, 30, { step: 0.5 }),
      num('physics.collisionRadiusFactor', '충돌 반경 비율', 0.2, 1),
      num('physics.altitudeChangeSeconds', '고도 변경 시간', 0.2, 5, { unit: '초' }),
    ],
  },
  {
    id: 'aptitude', label: '적성 배율', desc: '이동 기관의 적성 등급(S~D)이 환경에 맞을 때 성능에 곱해지는 배율',
    vars: [
      { type: 'record', path: 'stats.aptitudeMult', label: '적성 배율(S~D)', keys: GRADES, item: 'ratio', min: 0, max: 2, step: 0.01, public: true, desc: 'S 가 가장 크고 D 가 가장 작아야 자연스럽습니다.' },
      { type: 'enum', path: 'stats.noMobilityGrade', label: '이동 기관 없음 등급', options: GRADES, public: true, desc: '이동 기관이 하나도 없을 때 적용하는 등급' },
    ],
  },
  {
    id: 'combat', label: '교전', desc: '사거리·조준·투사체',
    vars: [
      num('combat.bodyReachFactor', '몸 가장자리 사거리 비율', 0, 1.5),
      int('combat.aimArcDeg', '무기 조준 각도(±)', 10, 180, { unit: '°' }),
      int('combat.missileArcDeg', '유도 미사일 조준 각도', 10, 180, { unit: '°' }),
      num('combat.projectileSpeedDefault', '투사체 기본 속도', 5, 100, { unit: 'm/s', step: 1 }),
      num('combat.projectileHitRadius', '투사체 명중 반경', 0.1, 3),
      secs('combat.projectileLifeSeconds', '투사체 수명', 1, 20),
      int('combat.breathHalfAngleDeg', '브레스 반각', 5, 90, { unit: '°' }),
      num('combat.railWidth', '레일건 관통 폭', 0.3, 5, { unit: 'm' }),
      num('combat.gravPushRange', '중력 포 밀어내는 거리', 1, 20, { unit: 'm', step: 0.5 }),
    ],
  },
  {
    id: 'spirit', label: '투지', desc: '투지가 공격·가속·회피에 주는 영향과 오르내리는 속도',
    vars: [
      int('spirit.baseMax', '투지 기본 최대', 50, 200),
      num('spirit.gainOnDamageDealt', '피해를 줄 때 오르는 양', 0, 10, { step: 0.1 }),
      int('spirit.gainOnPartKill', '파츠 파괴 시 오르는 양', 0, 50),
      int('spirit.gainOnFusion', '융합 시 오르는 양', 0, 50),
      num('spirit.idleGainPerSecond', '잠잠할 때 초당 오름', 0, 10, { step: 0.1 }),
      secs('spirit.idleThresholdSeconds', '잠잠하다고 보는 시간', 1, 20),
      num('spirit.lossOnHitDivisor', '피격 감소 나눔수', 1, 50, { step: 0.5, desc: '피해 ÷ 이 값만큼 투지가 줄어듭니다.' }),
      int('spirit.lossOnAllyPartLost', '아군 파츠 이탈 시 감소', 0, 50),
      ratio('spirit.lossMultFloor', '감소 배율 하한', 0, 1),
      num('spirit.gainMultCap', '증가 배율 상한', 1, 5),
      ratio('spirit.attackSwing', '투지→공격 배율 폭', 0, 1, { desc: '투지 0~100 에서 공격이 ±(이 비율)만큼 변합니다.' }),
      ratio('spirit.accelSwing', '투지→가속 배율 폭', 0, 1),
      ratio('spirit.dodgeMax', '자동 회피 최대 확률', 0, 0.5),
    ],
  },
  {
    id: 'temperament', label: '조종사 성향', desc: '열혈·냉철·직감 성향이 투지와 회피에 주는 영향',
    vars: [
      ratio('spirit.temperament.fervent.attackBonus', '열혈 · 공격 보너스', 0, 0.5),
      int('spirit.temperament.fervent.threshold', '열혈 · 발동 투지', 0, 100),
      num('spirit.temperament.fervent.lossMult', '열혈 · 투지 감소 배율', 0.5, 3),
      ratio('spirit.temperament.composed.changeMult', '냉철 · 투지 변동 배율', 0.1, 1),
      ratio('spirit.temperament.intuitive.dodgeBonus', '직감 · 회피 보너스', 0, 0.5),
    ],
  },
  {
    id: 'gauge', label: '오버드라이브 게이지', desc: '게이지가 차는 속도와 발동 연출',
    vars: [
      int('gauge.max', '게이지 최대', 20, 500),
      ratio('gauge.chargeOnDealt', '가한 피해 충전 비율', 0, 1),
      ratio('gauge.chargeOnTaken', '받은 피해 충전 비율', 0, 1),
      num('gauge.chargeMultCap', '축전기 중첩 상한', 1, 5),
      secs('gauge.viewBufferSeconds', '관람 지연', 0.2, 2, { step: 0.1, desc: '관람 화면이 서버보다 늦게 재생되는 시간. 짧으면 끊김, 길면 반응이 느립니다.' }),
      num('gauge.slowmoSpeed', '슬로모션 속도', 0.1, 1),
    ],
  },
  {
    id: 'tactics', label: '전술 한도', desc: '메카닉이 한 기체에 넣을 수 있는 카드의 양', adv: true,
    vars: [
      int('tactics.maxStances', '태세 최대 수', 1, 8),
      int('tactics.maxRulesPerStance', '태세당 규칙 수', 1, 30),
      int('tactics.maxTransitionsPerStance', '태세당 전환 수', 1, 12),
      int('tactics.maxVariables', '변수 수', 0, 16),
      int('tactics.maxTimers', '타이머 수', 0, 8),
      int('tactics.maxConditionsPerRule', '규칙당 조건 수', 1, 6),
      int('tactics.maxSharedVariables', '팀 공유 변수 수', 0, 8),
      int('tactics.fusionSignalSpiritCost', '융합 신호 투지 비용', 0, 30),
      secs('tactics.fusionSignalCooldown', '융합 신호 재사용', 1, 60),
      int('tactics.rangeBand.near', '가까움 경계', 2, 30, { unit: 'm' }),
      int('tactics.rangeBand.mid', '중간 경계', 5, 60, { unit: 'm' }),
    ],
  },
  {
    id: 'transform', label: '변신·융합', desc: '기본 변신과 융합체의 성질. (융합 레시피 자체는 비밀 저장소에서 따로 관리합니다)',
    vars: [
      secs('transform.durationSeconds', '변신 시간', 0.5, 10, { step: 0.5 }),
      secs('transform.cooldownSeconds', '변신 재사용', 1, 60),
      int('transform.energyCost', '변신 에너지', 0, 200),
      num('fusion.radiusMult', '융합체 크기 배율', 1, 2.5),
      ratio('fusion.releaseEnergyPct', '에너지로 인한 해제선', 0, 0.5),
      ratio('fusion.releaseHpPct', '체력으로 인한 해제선', 0, 0.5),
      secs('fusion.refuseCooldownSeconds', '재융합 제한 시간', 0, 300, { step: 5 }),
      secs('fusion.signalWindowSeconds', '융합 신호 창', 0.5, 10, { step: 0.5 }),
      secs('fusion.cinematicSeconds', '융합 연출 길이', 6, 10, { desc: '6~10초. 연출 중 모든 시뮬레이션이 멈춥니다.' }),
      secs('fusion.resumeCountdownSeconds', '재개 카운트다운', 1, 5),
    ],
  },
  {
    id: 'assembly', label: '조립 한도', desc: '기체 하나의 크기·파츠 수 제한', adv: true,
    vars: [
      int('assembly.maxParts', '파츠 수 상한', 5, 80, { desc: '시뮬레이션 부하를 막기 위한 한도입니다.' }),
      int('assembly.maxDesignNameLength', '설계도 이름 길이', 4, 40),
      int('assembly.maxPowerHops', '전력 수신 단계', 1, 6),
      num('assembly.exposureFoldedMult', '접힌 파츠 노출 가중치', 0, 1),
    ],
  },
  {
    id: 'lab', label: '분석 기준', desc: '매치업 매트릭스에서 강조할 승률',
    vars: [
      int('lab.gamesPerPair', '쌍마다 판수', 2, 100, { step: 2 }),
      ratio('lab.highWinRate', '너무 센 기준(승률)', 0.5, 1),
      ratio('lab.lowWinRate', '너무 약한 기준(승률)', 0, 0.5),
    ],
  },
]);

// ── 조회 도우미 ──────────────────────────────────────────
export const getPath = (obj, path) => path.split('.').reduce((o, k) => (o == null ? undefined : o[k]), obj);

export const VARS = Object.freeze(BALANCE_GROUPS.flatMap((g) => g.vars.map((v) => Object.freeze({ ...v, group: g.id, default: getPath(CONSTANTS, v.path) }))));
export const VAR_BY_PATH = Object.freeze(Object.fromEntries(VARS.map((v) => [v.path, v])));
export const groupOf = (id) => BALANCE_GROUPS.find((g) => g.id === id) || null;

// ═══ 항목별 수치(부품·전장·각성기·리그 프리셋) ═══════════════════════════════
// data/*.js 의 숫자(와 일부 참/거짓·등급·태그)를 '잎(leaf)'으로 보고, 명세를 자동으로 만든다. 저장 형식:
//   { constants:{…}, parts:{ 부품ID:{ '잎 경로': 값 } }, maps:{…}, skills:{…}, presets:{…} }   ← 바뀐 값만
// 화면과 저장소에서는 한 줄 경로 `부품/ID/잎경로` 로 부른다(예: parts/fr_light/weight).

export const SECTIONS = Object.freeze({
  parts: { label: '부품', items: () => PARTS },
  maps: { label: '전장', items: () => MAPS },
  skills: { label: '각성기', items: () => Object.values(PILOT_SKILLS) },
  presets: { label: '리그 프리셋', items: () => LEAGUE_PRESETS },
});

const FIELD_LABELS = Object.freeze({
  weight: '무게', cost: '비용', power: '소모 전력', durability: '내구도', output: '출력', capacity: '용량', baseHp: '기본 체력', hpBonus: '체력 보너스',
  thrust: '추력', maxSpeed: '최고속', turn: '선회', ammo: '탄수', cooldown: '재사용(초)', range: '사거리', damage: '피해', damagePerSecond: '초당 피해',
  shieldAbsorb: '방어막 흡수량', rebootSeconds: '재가동(초)', interceptRange: '요격 거리', selfRepairPerSecond: '초당 자가 수리', repairPartPerSecond: '초당 파츠 수리',
  repairHpPerSecond: '초당 체력 수리', invulnSeconds: '무적(초)', reviveHpPct: '부활 체력 비율', reviveStunSeconds: '부활 후 기절(초)', reviveCount: '부활 횟수',
  recoverySeconds: '회복(초)', immobilizeSeconds: '이동 제압(초)', flipIntervalSeconds: '뒤집기 간격(초)', flipImmobilizeSeconds: '뒤집기 제압(초)', heatPerShot: '발열/발', heatMax: '최대 발열',
  overheatLockSeconds: '과열 잠금(초)', heatCoolPerSecond: '초당 냉각', projectileSpeed: '투사체 속도', disablePartSeconds: '파츠 정지(초)', durationSeconds: '지속(초)',
  disableElectronicsSeconds: '전자장비 정지(초)', pullSpeed: '끌어당김 속도', pullSeconds: '끌어당김(초)', chargeSeconds: '충전(초)', tickSeconds: '틱 간격(초)', partDurabilityPerTick: '틱당 파츠 피해',
  energyCost: '에너지 소모', radius: '반경', speedMult: '속도 배율', contactDamage: '접촉 피해', spiritMaxBonus: '투지 최대 보너스', spiritLossMult: '투지 감소 배율', spiritGainMult: '투지 증가 배율',
  gaugeChargeMult: '게이지 충전 배율', breakAfterAttackSeconds: '공격 후 해제(초)', selfTurnPenalty: '자체 선회 감점', friction: '마찰', spiritCost: '투지 소모', uses: '사용 횟수',
  teamSize: '팀 크기', weightCap: '무게 상한', budget: '예산', matchSeconds: '제한시간(초)', tags: '태그',
  'provides.S': '연결점 소', 'provides.M': '연결점 중', 'provides.L': '연결점 대', 'turret.arcDeg': '포탑 각도', 'turret.turnRateDeg': '포탑 선회', 'reduce.physical': '물리 경감', 'reduce.energy': '에너지 경감',
  'line.length': '선 길이', 'line.width': '선 폭', 'aptitude.ground': '지상 적성', 'aptitude.water': '수중 적성', 'aptitude.air': '공중 적성', 'aptitude.space': '우주 적성',
  'rules.shrink.startAtSeconds': '축소 시작(초)', 'rules.shrink.intervalSeconds': '축소 간격(초)', 'rules.shrink.stepMeters': '한 번에 줄어드는 폭(m)', 'rules.shrink.minSize': '최소 크기(m)', 'rules.shrink.hazardDps': '바깥 초당 피해',
  'rules.lavaEdge.widthMeters': '용암 폭(m)', 'rules.lavaEdge.dps': '용암 초당 피해', 'rules.spikes.count': '함정 수', 'rules.spikes.radius': '함정 반경', 'rules.spikes.periodSeconds': '함정 주기(초)', 'rules.spikes.activeSeconds': '함정 작동(초)',
  'rules.spikes.warnSeconds': '함정 예고(초)', 'rules.spikes.damage': '함정 피해', 'rules.lowGravity.frictionMult': '저중력 마찰 배율', 'rules.lowGravity.bounceMult': '저중력 반발 배율', 'rules.empStorm.periodSeconds': 'EMP 폭풍 주기(초)',
  'rules.empStorm.warnAtSeconds': 'EMP 예고 시각(초)', 'rules.empStorm.warnLengthSeconds': 'EMP 예고 길이(초)', 'rules.empStorm.durationSeconds': 'EMP 지속(초)', 'rules.meteors.intervalSeconds': '운석 간격(초)', 'rules.meteors.radius': '운석 반경',
  'rules.meteors.warnSeconds': '운석 예고(초)', 'rules.meteors.damage': '운석 피해', 'rules.island.areaRatio': '섬 면적 비율', 'rules.rangeMult.hitscanEnergy': '에너지 즉발 사거리 배율',
  'effect.speedMult': '속도 배율', 'effect.damageTakenMult': '받는 피해 배율', 'effect.dodgeBonus': '회피 보너스', 'effect.healHpPct': '회복 체력 비율', 'effect.cooldownMult': '재사용 배율', 'effect.leaveHp': '남기는 체력',
});
export const fieldLabel = (leaf) => FIELD_LABELS[leaf] || leaf;

const PART_SKIP = new Set(['id', 'name', 'category', 'size', 'drain', 'maxAltitude', 'damageType', 'info', 'desc', 'preview', 'kind', 'electronic', 'morphable', 'relay', 'melee', 'canHitRear', 'contact', 'projectile', 'homing', 'interceptable', 'cone', 'hitscan', 'area', 'canPush', 'pierce', 'ignoresArmor', 'empImmune', 'absorbFirstHit', 'excludeSelf', 'oncePerTarget', 'blocksDetection']);
const STRUCTURAL = new Set(['id', 'name', 'desc', 'env', 'preview', 'obstacles', 'kind']);

function leafRule(leaf, d) {
  const isRatio = /Mult$|Pct$|Ratio$|\.(physical|energy)$/.test(leaf) || (d > 0 && d < 1 && !Number.isInteger(d));
  const floaty = /Mult$|Ratio$|Pct$|friction|^reduce\./.test(leaf);
  const isInt = Number.isInteger(d) && !floaty;
  let min = d < 0 ? d * 5 : 0;
  let max = d === 0 ? 10 : Math.max(Math.abs(d) * 5, Math.abs(d) + 5);
  if (/^reduce\./.test(leaf)) max = 0.95;
  else if (/Pct$/.test(leaf)) max = 1;
  else if (/Mult$/.test(leaf)) { min = 0.1; max = Math.max(3, d * 3); }
  else if (isRatio && d <= 1 && leaf !== 'friction') max = 1;
  if (leaf === 'friction') { min = 0.1; max = 3; }
  if (/^provides\./.test(leaf)) max = 12;
  if (leaf === 'uses' || leaf === 'reviveCount') max = Math.max(max, 5);
  if (isInt) return { type: 'int', min: Math.floor(min), max: Math.ceil(max), step: 1 };
  return { type: 'num', min, max: Math.ceil(max * 100) / 100, step: Math.abs(d) < 1 ? 0.01 : Math.abs(d) < 10 ? 0.05 : 0.5 };
}

function collectLeaves(obj, prefix, out, skip) {
  for (const [k, v] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${k}` : k;
    if (!prefix && skip.has(k)) continue;
    if (v && typeof v === 'object' && !Array.isArray(v)) { if (k === 'preview') continue; collectLeaves(v, path, out, skip); continue; }
    out.push([path, v]);
  }
}

const GRADE_OPTS = GRADES;
const TAG_OPTS = Object.entries(TAGS).map(([k, t]) => [k, t.label]);

export function leafSpecsOf(section, item) {
  const out = [];
  const raw = [];
  collectLeaves(item, '', raw, section === 'parts' ? PART_SKIP : STRUCTURAL);
  for (const [leaf, d] of raw) {
    const base = { path: `${section}/${item.id}/${leaf}`, section, itemId: item.id, itemName: item.name || item.id, leaf, label: fieldLabel(leaf), public: true, default: d, group: `${section}/${item.id}` };
    if (section === 'parts' && leaf.startsWith('aptitude.') && typeof d === 'string') { out.push({ ...base, type: 'enum', options: GRADE_OPTS }); continue; }
    if (section === 'parts' && leaf === 'tags' && Array.isArray(d)) { out.push({ ...base, type: 'multi', options: TAG_OPTS }); continue; }
    if (section === 'maps' && typeof d === 'boolean') { out.push({ ...base, type: 'bool' }); continue; }
    if (typeof d === 'number' && Number.isFinite(d)) out.push({ ...base, ...leafRule(leaf, d) });
  }
  if (section === 'parts' && !raw.some(([l]) => l === 'tags') && Array.isArray(item.tags)) out.push({ path: `parts/${item.id}/tags`, section, itemId: item.id, itemName: item.name || item.id, leaf: 'tags', label: fieldLabel('tags'), public: true, default: [...item.tags], group: `parts/${item.id}`, type: 'multi', options: TAG_OPTS });
  return out;
}

let LEAF_INDEX = null;
function leafIndex() {
  if (LEAF_INDEX) return LEAF_INDEX;
  LEAF_INDEX = new Map();
  for (const [section, def] of Object.entries(SECTIONS)) for (const item of def.items()) for (const sp of leafSpecsOf(section, item)) LEAF_INDEX.set(sp.path, Object.freeze(sp));
  return LEAF_INDEX;
}

/** 경로 하나의 명세(일반 변수 또는 항목별 수치). 없으면 undefined */
export const specFor = (path) => (path.includes('/') ? leafIndex().get(path) : VAR_BY_PATH[path]);
export const allSpecs = () => [...VARS, ...leafIndex().values()];
export const leafSpecsFor = (section, itemId) => [...leafIndex().values()].filter((sp) => sp.section === section && sp.itemId === itemId);
export const SECTION_KEYS = Object.freeze(Object.keys(SECTIONS));

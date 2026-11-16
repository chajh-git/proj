// config/constants.js
// 시간·한도·공식 계수 등 모든 수치 상수의 원본입니다. (명세 v1.0의 [기본값])
// 조율 센터(editor.html)가 이 값들을 덮어쓸 수 있으며, 덮어쓰기는 shared/balance/merge.js가 처리합니다.
// 구조상 바꾸면 안 되는 [고정] 규칙은 이 파일이 아니라 코드에 들어 있습니다.

const deepFreeze = (o) => {
  Object.values(o).forEach((v) => v && typeof v === 'object' && deepFreeze(v));
  return Object.freeze(o);
};

export const CONSTANTS = deepFreeze({
  // ── 시간 ────────────────────────────────────────────────
  time: {
    physicsHz: 60, // 물리 틱/초
    decisionHz: 15, // 전술 판단 횟수/초 (물리 4틱마다)
    streamHz: 20, // 서버 → 화면 상태 전송
    matchSeconds: 180, // 제한시간
    extensionSeconds: 30, // 동률 시 연장
    countdownSeconds: 5, // 개시 카운트다운
  },

  // ── 대전 규모 ───────────────────────────────────────────
  match: {
    minTeamSize: 1,
    maxTeamSize: 3,
    spawnGap: 6, // 같은 팀 기체 간격(m)
    arenaSize: { 1: [40, 40], 2: [50, 50], 3: [60, 60] }, // n vs n 기본 전장 크기(m)
    tiePoints: { win: 3, draw: 1, loss: 0 },
    extensionHazardShrink: true, // 연장 시 전장 급축소
  },

  // ── 제약 (리그별로 지휘관이 덮어씀) ──────────────────────
  limits: {
    weightCap: 100, // 기체당 무게 상한
    budget: 1000, // 기체당 예산(조종사 각성기 비용 포함)
    pilotSkillSlots: 2,
  },

  // ── 조립 ────────────────────────────────────────────────
  assembly: {
    // 크기별 모형 변 길이(m)
    sizeEdge: { S: 0.4, M: 0.8, L: 1.4 },
    // 같은 크기 연결점의 방향 순환 순서
    directionCycle: ['front', 'back', 'left', 'right', 'up', 'down'],
    maxPowerHops: 2, // 이 단계 이하면 전력 수신, 초과 시 중계 케이블 필요
    coreEdge: 1.0, // 코어 모형 변 길이(m)
    overlapEpsilon: 0.001, // 이 값 이하의 겹침은 '맞닿음'으로 본다
    maxParts: 40, // 기체당 파츠 수 상한(시뮬레이션 보호)
    maxDesignNameLength: 20,
    exposureResolution: 16, // 노출도 광선 격자(한 변)
    layoutGap: 0.05, // 같은 면에 붙는 형제 파츠(와 그 하위 파츠) 사이 간격(m)
    exposureFoldedMult: 0.5, // 접힌(비활성 형태) 파츠의 노출 가중치
  },

  // ── 전력 ────────────────────────────────────────────────
  power: {
    idleDrawFactor: 0.1, // 비상시형 파츠가 대기할 때의 소모 비율
    singleShotSeconds: 1, // 단발 무기 1회 = 소모 × 이 시간
  },

  // ── 능력 공식 계수 ───────────────────────────────────────
  stats: {
    maxSpeedWeightDivisor: 200, // v = 평균최고속 ÷ (1 + M ÷ 200)
    turnBaseWeight: 60, // 선회 = 평균선회 × 60 ÷ (60 + M)
    turnCenterPenalty: 0.3, // × 1 ÷ (1 + 0.3 × 무게중심 편차[m])
    moveEnergyWeightDivisor: 50, // 이동 소모 × (M ÷ 50)
    aptitudeMult: { S: 1.2, A: 1.0, B: 0.85, C: 0.65, D: 0.4 },
    noMobilityGrade: 'D',
  },

  // ── 이동·충돌 ────────────────────────────────────────────
  physics: {
    ramThresholdSpeed: 4, // m/s 초과 충돌부터 피해
    ramDamageFactor: 0.05, // (상대속도−4) × 상대질량 × 0.05
    defaultFriction: 1.0,
    altitudeChangeSeconds: 1.5, // 고도층 한 칸 변경 시간(이동 제압)
    reverseSpeedMult: 0.5, // 후진 최고속 비율
    restitution: 0.3, // 기체 충돌 반발 계수
    turnResponse: 8, // 선회 속도가 목표에 다가가는 빠르기(1/s)
    collisionRadiusFactor: 0.6, // 기체끼리 부딪치는 반경 = 외곽 반경 × 이 값 (외곽 반경은 모서리 기준이라 크다)
    spawnLineRatio: 0.6, // 시작 위치: 전장 반폭 × 이 값만큼 중앙에서 떨어진 라인
  },

  // ── 피해 모델 ────────────────────────────────────────────
  damage: {
    transferRatio: 0.25, // 파츠 피해의 25%가 기체 체력으로 전달
    brokenThreshold: 0.3, // 내구도 30% 이하 → 파손(기능 정지)
    detachSpiritLoss: 10, // 파츠 이탈 시 투지 감소
    exposureRays: 6, // 노출도 지표용 방향 수
    hitRayHeightRandom: true, // 피격 광선 높이는 기체 높이 범위에서 무작위
  },

  // ── 교전(사거리·조준·투사체) ──────────────────────────────
  combat: {
    bodyReachFactor: 0.7, // 사거리 = 무기 사거리 + 상대 충돌 반경 × 이 값 (무기 위치에서 상대 몸 가장자리까지)
    aimArcDeg: 50, // 무기가 장착 방향 기준으로 겨눌 수 있는 각도(±)
    missileArcDeg: 90, // 유도 미사일은 더 넓게
    rearArcDeg: 180, // 꼬리 채찍(후방 가능)
    projectileSpeedDefault: 30, // 속도가 정해지지 않은 투사체(m/s)
    projectileHitRadius: 0.6, // 투사체가 맞는 거리 = 이 값 + 상대 반경 × bodyReachFactor
    projectileLifeSeconds: 6,
    breathHalfAngleDeg: 30, // 브레스 원뿔 반각
    railWidth: 1.5, // 레일건 관통 폭(m)
    gravPushRange: 6, // 중력 포: 이 거리 안이면 밀고, 밖이면 끌어당김
    envHitAltitudes: { meteor: ['ground', 'low'], spikes: ['ground'] },
    stunHitsOnePart: true,
  },

  // ── 투지 ─────────────────────────────────────────────────
  spirit: {
    start: 50,
    baseMax: 100,
    gainOnDamageDealt: 2,
    gainOnPartKill: 10,
    gainOnFusion: 20,
    idleGainPerSecond: 1, // 5초간 피격·명중 없을 때
    idleThresholdSeconds: 5,
    lossOnHitDivisor: 10, // 피격 시 피해 ÷ 10 감소
    lossOnAllyPartLost: 10,
    // 같은 종류 파츠를 여러 개 달았을 때: 곱으로 중첩한 뒤 이 범위로 제한
    lossMultFloor: 0.2,
    gainMultCap: 2.5,
    // 공격 배율 = 1 + 0.2 × (투지−50) ÷ 50 → 0.8 ~ 1.2
    attackSwing: 0.2,
    accelSwing: 0.1, // 가속 ±10%
    dodgeMax: 0.1, // 자동 회피 확률 0~10%
    temperament: {
      fervent: { attackBonus: 0.05, threshold: 70, lossMult: 1.3 },
      composed: { changeMult: 0.7 },
      intuitive: { dodgeBonus: 0.05 },
    },
  },

  // ── 오버드라이브 게이지 ───────────────────────────────────
  gauge: {
    max: 100,
    chargeOnDealt: 0.1, // 가한 피해 × 0.1
    chargeOnTaken: 0.15, // 받은 피해 × 0.15
    chargeMultCap: 2.5, // 축전기 중첩 한도
    // 발동 연출: 시뮬레이션은 멈추지 않고 화면 쪽에서 슬로모션 처리
    viewBufferSeconds: 0.6, // 관람 화면이 서버보다 늦게 재생되는 시간
    slowmoSeconds: 0.8,
    slowmoSpeed: 0.3,
    catchUpSpeed: 1.5,
  },

  // ── 전술 한도 ────────────────────────────────────────────
  tactics: {
    maxStances: 5,
    maxRulesPerStance: 12,
    maxTransitionsPerStance: 6,
    maxVariables: 8,
    maxTimers: 4,
    maxConditionsPerRule: 3,
    maxNameLength: 12,
    maxSharedVariables: 4, // 통신기로 읽고 쓰는 팀 공유 변수
    fusionSignalSpiritCost: 5,
    fusionSignalCooldown: 8, // 초
    // 센서가 없을 때의 거리 구간(m)
    rangeBand: { near: 8, mid: 20 },
    directionCount: 8,
    allyHpBands: 3, // 센서 없이 아군 체력은 상/중/하만
    bandMidpoint: { near: 4, mid: 14, far: 30 }, // 센서 없을 때 거리 구간의 추정 거리(m)
    allyHpBandCuts: { high: 66, mid: 33 }, // 상/중/하 경계(%)
    steer: { gain: 2, approachSlowBearing: 1.2, circleBearing: 1.4, stopDistance: 0.5 }, // 이동 동작 조향 계수
  },

  // ── 변신·융합 ────────────────────────────────────────────
  transform: {
    durationSeconds: 2,
    cooldownSeconds: 6,
    energyCost: 30,
    foldedExposureMult: 0.5,
  },
  fusion: {
    radiusMult: 1.3, // 융합체 충돌 반경 = 구성원 최대 반경 × 1.3
    releaseEnergyPct: 0.05,
    releaseHpPct: 0.15,
    refuseCooldownSeconds: 60,
    signalWindowSeconds: 2,
    cinematicSeconds: 8, // 1차 공통 연출 길이 (6~10초 권장)
    cinematicMinSeconds: 6,
    cinematicMaxSeconds: 10,
    resumeCountdownSeconds: 3,
  },

  // ── 리그 기본값 ──────────────────────────────────────────
  league: {
    concurrentMatches: 2,
    practiceSessions: 2,
    allowRepairBetweenMatches: true,
    spectatorCodeLength: 6,
    tournamentDrawReplays: 1,
  },

  // ── 조율 센터(매치업 매트릭스) ────────────────────────────
  lab: {
    gamesPerPair: 20, // 쌍마다 판수, 시작 위치 좌우 교대
    highWinRate: 0.65,
    lowWinRate: 0.35,
  },

  // ── 화면 품질 ────────────────────────────────────────────
  view: {
    fpsCap: 60,
    autoDowngradeFps: 30, // 이 프레임 아래가 이어지면 한 단계 하향
    autoDowngradeSeconds: 4,
  },

  // ── 계정 ─────────────────────────────────────────────────
  account: {
    virtualEmailDomain: 'codingmeca.invalid', // 아이디@도메인 형태로 내부 처리
    loginIdPattern: '^[a-z0-9_]{3,16}$',
    passwordMinLength: 6,
    nicknameMaxLength: 12,
  },

  // ── 열거 ─────────────────────────────────────────────────
  enums: {
    sizes: ['S', 'M', 'L'],
    altitudes: ['ground', 'low', 'high'],
    envs: ['ground', 'water', 'air', 'space'],
    channels: ['move', 'weapon', 'defense', 'special'],
    channelPriority: ['special', 'defense', 'move', 'weapon'], // 충돌 시 우선순위
    damageTypes: ['physical', 'energy', 'emp', 'poison'],
  },
});

export default CONSTANTS;

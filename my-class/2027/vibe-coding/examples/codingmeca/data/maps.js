// data/maps.js
// 전장 8종 (명세 v1.0 10장). 지휘관이 리그 설정에서 허용 전장 풀·선택 방식·공개 여부를 정합니다.
//
// env: 시작 지형 환경 ('ground' | 'water' | 'space'). 전장 적성은 이 환경 기준으로 계산됩니다.
// rules: 전장 특수 규칙. 키가 있으면 그 규칙이 켜지고 값은 수치입니다. (shared/sim/terrain.js가 해석)
// obstacles: 사각지대 미로의 벽. 전장 크기에 비례하는 정규화 좌표(−0.5 ~ 0.5)의 사각형 [중심x, 중심z, 너비, 깊이].

export const MAPS = Object.freeze([
  {
    id: 'm1',
    name: '기본 투기장',
    env: 'ground',
    desc: '사각 벽 경기장. 시간이 지나면 바닥이 좁아진다.',
    friction: 1.0,
    rules: {
      shrink: { startAtSeconds: 120, intervalSeconds: 10, stepMeters: 2, minSize: 12, hazardDps: 60 },
    },
    preview: { floor: '#2A303B', hazard: '#E5484D' },
  },
  {
    id: 'm2',
    name: '용암 투기장',
    env: 'ground',
    desc: '가장자리가 용암. 지상·저공은 피해를 입고 고공은 면제.',
    friction: 1.0,
    rules: {
      lavaEdge: { widthMeters: 4, dps: 40, affects: ['ground', 'low'] },
    },
    preview: { floor: '#3A2A26', hazard: '#FF5A1F' },
  },
  {
    id: 'm3',
    name: '스파이크 함정',
    env: 'ground',
    desc: '곳곳의 패드가 주기적으로 솟아오른다. 점멸 후 작동.',
    friction: 1.0,
    rules: {
      spikes: { count: 6, radius: 2.5, periodSeconds: 4, activeSeconds: 1, warnSeconds: 0.8, damage: 80 },
    },
    preview: { floor: '#2D2F36', hazard: '#C9CED6' },
  },
  {
    id: 'm4',
    name: '사각지대 미로',
    env: 'ground',
    desc: '벽 장애물이 시야를 가린다. 소나는 벽 너머를 탐지한다.',
    friction: 1.0,
    rules: {
      walls: { blocksSensors: true, blocksLaser: true, blocksStraightProjectiles: true, sonarSeesThrough: true },
    },
    // 좌우 대칭 배치 (공정성)
    obstacles: [
      [-0.2, -0.22, 0.04, 0.26],
      [0.2, -0.22, 0.04, 0.26],
      [-0.2, 0.22, 0.04, 0.26],
      [0.2, 0.22, 0.04, 0.26],
      [0, 0, 0.26, 0.04],
      [-0.36, 0, 0.04, 0.18],
      [0.36, 0, 0.04, 0.18],
    ],
    preview: { floor: '#262B33', hazard: '#6B7685' },
  },
  {
    id: 'm5',
    name: '저중력 정거장',
    env: 'space',
    desc: '마찰이 줄어 미끄러진다. 충돌 반동이 두 배.',
    friction: 0.3,
    rules: {
      lowGravity: { frictionMult: 0.3, bounceMult: 2, allSpaceAptitude: true },
    },
    preview: { floor: '#12162B', hazard: '#6C7BFF' },
  },
  {
    id: 'm6',
    name: 'EMP 폭풍',
    env: 'ground',
    desc: '주기적으로 전자 파츠가 정지한다. 기계식 무기와 장갑의 시간.',
    friction: 1.0,
    rules: {
      empStorm: { periodSeconds: 30, warnAtSeconds: 20, warnLengthSeconds: 2, durationSeconds: 5 },
    },
    preview: { floor: '#241F36', hazard: '#B58CFF' },
  },
  {
    id: 'm7',
    name: '운석 낙하',
    env: 'ground',
    desc: '무작위 위치에 운석이 떨어진다. 양쪽 모두에게 동일하다.',
    friction: 1.0,
    rules: {
      meteors: { intervalSeconds: 3, radius: 4, warnSeconds: 1.5, damage: 70 },
    },
    preview: { floor: '#2B2622', hazard: '#FF8A3D' },
  },
  {
    id: 'm8',
    name: '심해 해구',
    env: 'water',
    desc: '수중 전장에 중앙 섬이 있다. 레이저 사거리가 줄어든다.',
    friction: 0.8,
    rules: {
      island: { areaRatio: 0.15, envOnIsland: 'ground' },
      rangeMult: { hitscanEnergy: 0.7 }, // 레이저 사거리 −30%
    },
    preview: { floor: '#0E2A3A', hazard: '#2F8FBF' },
  },
]);

export const MAP_BY_ID = Object.freeze(Object.fromEntries(MAPS.map((m) => [m.id, m])));

export function getMap(id) {
  const m = MAP_BY_ID[id];
  if (!m) throw new Error(`알 수 없는 전장: ${id}`);
  return m;
}

// ── 리그 설정용 열거 ──────────────────────────────────────
export const MAP_SELECT_MODES = Object.freeze({
  fixed: '지정', // 리그 전체에서 한 전장
  random: '무작위', // 허용 풀에서 매치마다 무작위
  perMatch: '매치별 지정', // 지휘관이 매치마다 고름
});

export const MAP_REVEAL_MODES = Object.freeze({
  public: '사전 공개',
  atStart: '경기 직전 공개',
});

// n vs n에 따른 전장 크기(m). constants.match.arenaSize를 기본으로 하고, 전장이 sizeOverride를 가지면 우선합니다.
export function arenaSizeFor(map, teamSize, constantsArenaSize) {
  if (map.sizeOverride && map.sizeOverride[teamSize]) return map.sizeOverride[teamSize];
  return constantsArenaSize[teamSize];
}

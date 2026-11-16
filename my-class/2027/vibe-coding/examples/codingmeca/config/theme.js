// config/theme.js
// 공간별 색감·조명·화질 프리셋의 원본입니다.
// 색 값은 '#RRGGBB' 문자열, 3D 쪽에서는 parseInt(hex.slice(1), 16)으로 변환해서 씁니다.

// ── 공간별 팔레트 ─────────────────────────────────────────
// 격납고=강철과 불꽃 / 신경 연산실=네온 사이버 / 관제 스크린=신화 금빛
// 시험 사격장은 격납고 계열, 지휘 본부는 관제 스크린 계열을 따릅니다.
export const SPACES = Object.freeze({
  hangar: {
    id: 'hangar',
    label: '격납고',
    palette: {
      bg: '#14171C',
      panel: '#1C2128',
      panelEdge: '#3A4452',
      primary: '#FF7A1A', // 주황 불꽃
      secondary: '#5B8DB8', // 차가운 블루 보조
      text: '#E6EAF0',
      textDim: '#8A95A5',
      danger: '#E5484D',
      ok: '#3DD68C',
      glow: '#FFB067',
    },
    scene: {
      background: '#0B0D10',
      fog: { color: '#0F1217', near: 18, far: 70 },
      ambient: { color: '#8794A8', intensity: 0.45 },
      key: { color: '#FFD9B0', intensity: 1.1, position: [6, 12, 8] },
      accent: { color: '#FF7A1A', intensity: 0.8, position: [-8, 3, -4] },
      floor: '#20252D',
      metal: '#59616E',
      bloom: 0.5,
    },
    ambientEvent: 'amb_hangar',
  },

  tacticsLab: {
    id: 'tacticsLab',
    label: '신경 연산실',
    palette: {
      bg: '#060B1E',
      panel: '#0C1330',
      panelEdge: '#1E2B5E',
      primary: '#00E5FF', // 시안
      secondary: '#FF2BD6', // 마젠타
      text: '#DCF6FF',
      textDim: '#6F89B8',
      danger: '#FF4D6D',
      ok: '#4DFFB5',
      glow: '#7CF3FF',
    },
    scene: {
      background: '#03061A',
      fog: { color: '#040821', near: 14, far: 55 },
      ambient: { color: '#3A4C9A', intensity: 0.5 },
      key: { color: '#7CF3FF', intensity: 0.9, position: [0, 10, 6] },
      accent: { color: '#FF2BD6', intensity: 0.9, position: [-6, -2, -6] },
      floor: '#060B1E',
      metal: '#2B3A7A',
      bloom: 0.9,
    },
    ambientEvent: 'amb_lab',
  },

  arena: {
    id: 'arena',
    label: '관제 스크린',
    palette: {
      bg: '#070B14',
      panel: '#0E1523',
      panelEdge: '#34425E',
      primary: '#FFC857', // 금색
      secondary: '#E63946', // 심홍
      text: '#F4EEDC',
      textDim: '#9A9484',
      danger: '#E63946',
      ok: '#6FD69A',
      glow: '#FFE29A',
    },
    scene: {
      background: '#05080F',
      fog: { color: '#070B14', near: 40, far: 160 },
      ambient: { color: '#59627A', intensity: 0.5 },
      key: { color: '#FFE6B0', intensity: 1.2, position: [10, 26, 12] },
      accent: { color: '#E63946', intensity: 0.7, position: [-12, 6, -10] },
      floor: '#161D2C',
      metal: '#4A5368',
      bloom: 0.7,
    },
    ambientEvent: 'amb_arena',
  },

  range: {
    id: 'range',
    label: '시험 사격장',
    inherits: 'hangar', // 격납고 계열
    palette: { primary: '#FF9A3D', secondary: '#4FA3D9' },
    scene: {
      background: '#0A0E13',
      fog: { color: '#0C1218', near: 20, far: 80 },
      gridColor: '#2A6F9E',
    },
    ambientEvent: 'amb_range',
  },

  command: {
    id: 'command',
    label: '지휘 본부',
    inherits: 'arena', // 관제 스크린 계열
    palette: { primary: '#FFD36E', secondary: '#F25D6B' },
    scene: {
      background: '#050A12',
      radarColor: '#6FD69A',
    },
    ambientEvent: 'amb_command',
  },
});

// 상속을 풀어서 완성된 팔레트·씬 값을 돌려줍니다.
export function resolveSpace(id) {
  const s = SPACES[id];
  if (!s) throw new Error(`알 수 없는 공간: ${id}`);
  if (!s.inherits) return s;
  const base = resolveSpace(s.inherits);
  return {
    ...base,
    ...s,
    palette: { ...base.palette, ...s.palette },
    scene: { ...base.scene, ...s.scene },
  };
}

// ── 피해 종류·상태 색 ─────────────────────────────────────
export const EFFECT_COLORS = Object.freeze({
  physical: '#FFB347',
  energy: '#4DE1FF',
  emp: '#B58CFF',
  poison: '#7CFF6B',
  heal: '#4DFFB5',
  shield: '#5BC8FF',
  hpHigh: '#3DD68C',
  hpMid: '#FFC857',
  hpLow: '#E5484D',
  teamA: '#4DA3FF',
  teamB: '#FF6B6B',
  fusion: '#FFE29A',
});

// ── 화질 3단계 ───────────────────────────────────────────
// 배경 생동감은 '하'에서 입자·후처리를 줄입니다. (명세 14-1)
export const QUALITY = Object.freeze({
  high: {
    id: 'high',
    label: '상',
    pixelRatioCap: 2,
    shadows: true,
    shadowMapSize: 2048,
    particleMult: 1.0,
    postfx: true,
    bloom: true,
    antialias: true,
    ambientDetail: 1.0, // 배경 생동감(증기·불꽃 등) 밀도
  },
  mid: {
    id: 'mid',
    label: '중',
    pixelRatioCap: 1.5,
    shadows: true,
    shadowMapSize: 1024,
    particleMult: 0.6,
    postfx: true,
    bloom: false,
    antialias: true,
    ambientDetail: 0.65,
  },
  low: {
    id: 'low',
    label: '하',
    pixelRatioCap: 1,
    shadows: false,
    shadowMapSize: 512,
    particleMult: 0.3,
    postfx: false,
    bloom: false,
    antialias: false,
    ambientDetail: 0.35,
  },
});

export const QUALITY_ORDER = Object.freeze(['high', 'mid', 'low']);

// 자동 감지 시 한 단계 하향
export function downgradeQuality(id) {
  const i = QUALITY_ORDER.indexOf(id);
  return QUALITY_ORDER[Math.min(i + 1, QUALITY_ORDER.length - 1)];
}

// ── 공통 UI 값 ───────────────────────────────────────────
export const UI = Object.freeze({
  fontFamily: "'Pretendard', 'Noto Sans KR', system-ui, sans-serif",
  monoFamily: "'JetBrains Mono', 'D2Coding', ui-monospace, monospace",
  radius: 10,
  panelOpacity: 0.82, // 3D 배경 위에 올리는 패널 투명도
  transitionMs: 220,
});

// CSS 변수로 내보내기: document.documentElement.style에 적용해서 씁니다.
export function toCssVars(spaceId) {
  const { palette } = resolveSpace(spaceId);
  const vars = {};
  for (const [k, v] of Object.entries(palette)) vars[`--cm-${k}`] = v;
  vars['--cm-radius'] = `${UI.radius}px`;
  vars['--cm-panel-opacity'] = String(UI.panelOpacity);
  vars['--cm-font'] = UI.fontFamily;
  vars['--cm-mono'] = UI.monoFamily;
  return vars;
}

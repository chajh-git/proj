// web/core/quality.js  (48번)
// 화질 3단계(상/중/하) 관리자. (명세 14-1)
//   '자동'  = 기기 성능으로 시작 단계를 정하고, 프레임이 낮으면 렌더러가 한 단계씩 내린다.
//   '상/중/하' = 고정(자동 하향 끔).
// 렌더러(createRenderer)·후처리(createPostfx)에 단계를 적용하고, 선택값은 store에 저장한다.
//   const qm = createQualityManager({ renderer, postfx, store });
//   qm.setMode('auto'); qm.level; qm.mode; qm.onChange(fn)

import { QUALITY, QUALITY_ORDER } from '../../config/theme.js';

// 기기 성능 추정 → 시작 단계. env는 테스트용으로 바꿔 끼울 수 있다.
export function detectInitialLevel(env = globalThis) {
  const nav = env.navigator || {};
  const cores = nav.hardwareConcurrency || 4;
  const mem = nav.deviceMemory || 4; // 크롬 계열만 제공, 없으면 4로 가정
  const touch = (nav.maxTouchPoints || 0) > 0;
  const mobileUA = /Android|iPhone|iPad|iPod|Mobile/i.test(nav.userAgent || '');
  const coarse = typeof env.matchMedia === 'function' && env.matchMedia('(pointer: coarse)').matches;
  const small = (env.screen?.width || 1920) * (env.devicePixelRatio || 1) < 1100;

  if (mem <= 2 || cores <= 2) return 'low';
  if (mobileUA || (touch && coarse) || cores <= 4 || mem <= 4 || small) return 'mid';
  return 'high';
}

export const QUALITY_MODES = Object.freeze(['auto', ...QUALITY_ORDER]);

export function createQualityManager({ renderer, postfx = null, store = null, env = globalThis } = {}) {
  let mode = store?.get('settings.quality') || 'auto';
  if (!QUALITY_MODES.includes(mode)) mode = 'auto';
  const listeners = new Set();

  const bloomFor = (q) => (q.bloom ? undefined : 0); // 상: 공간 기본 블룸 유지, 그 외: 끔

  function applyLevel(level) {
    const q = QUALITY[level];
    if (!q) return;
    if (renderer.quality?.id !== level) renderer.setQuality(level);
    if (postfx) {
      postfx.setEnabled(q.postfx);
      const b = bloomFor(q);
      if (b !== undefined) postfx.setBloom(b);
    }
  }

  const api = {
    get mode() { return mode; },
    get level() { return renderer.quality?.id || 'high'; },
    get info() { return renderer.quality; },
    setMode(next) {
      if (!QUALITY_MODES.includes(next)) return mode;
      mode = next;
      renderer.autoQuality = next === 'auto';
      applyLevel(next === 'auto' ? detectInitialLevel(env) : next);
      store?.set('settings.quality', next);
      listeners.forEach((fn) => fn(api.level, mode));
      return mode;
    },
    // 후처리를 나중에 만든 경우 연결
    attachPostfx(p) {
      postfx = p;
      applyLevel(api.level);
    },
    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
    dispose() { off?.(); listeners.clear(); },
  };

  // 렌더러가 프레임 저하로 단계를 내렸을 때 후처리·구독자에 반영
  const off = renderer.onQuality?.((q) => {
    if (postfx) {
      postfx.setEnabled(q.postfx);
      const b = bloomFor(q);
      if (b !== undefined) postfx.setBloom(b);
    }
    listeners.forEach((fn) => fn(q.id, mode));
  });

  api.setMode(mode); // 저장된 값(기본 '자동')으로 시작
  return api;
}

// web/core/router.js  (46번)
// 페이지(HTML) 간 이동과 한 페이지 안의 공간 전환, 권한 검사를 맡습니다.
//   페이지: index(로비·로그인) / hangar(격납고·신경 연산실·시험 사격장) / arena(관제 스크린) / command(지휘 본부) / editor(조율 센터)
//   한 페이지 안의 공간은 주소 해시로 표시합니다.  예) hangar.html#tacticsLab
// 서버가 최종 권한을 검증하므로, 여기의 검사는 화면을 안내하기 위한 것입니다.

import { NAMES, SHELL_TEXT } from '../../config/names.js';

// role: 'any'(로그인 불필요) | 'mechanic'(로그인한 누구나) | 'commander'(지휘관만)
export const PAGES = Object.freeze({
  index: { file: 'index.html', label: NAMES.lobby, role: 'any', spaces: ['hangar'], defaultSpace: 'hangar' },
  hangar: { file: 'hangar.html', label: NAMES.hangar, role: 'mechanic', spaces: ['hangar', 'tacticsLab', 'range'], defaultSpace: 'hangar' },
  arena: { file: 'arena.html', label: NAMES.arena, role: 'any', spaces: ['arena'], defaultSpace: 'arena' }, // 관람 코드로 입장
  command: { file: 'command.html', label: NAMES.command, role: 'commander', spaces: ['command'], defaultSpace: 'command' },
  editor: { file: 'editor.html', label: NAMES.editor, role: 'commander', spaces: ['command'], defaultSpace: 'command' },
});

export const PAGE_IDS = Object.freeze(Object.keys(PAGES));

// 현재 주소 → { page, space, params }
export function parseLocation(loc = globalThis.location) {
  const path = (loc?.pathname || '').split('/').pop() || 'index.html';
  const page = PAGE_IDS.find((id) => PAGES[id].file === path) || 'index';
  const def = PAGES[page];
  const hash = (loc?.hash || '').replace(/^#\/?/, '');
  const space = def.spaces.includes(hash) ? hash : def.defaultSpace;
  const params = {};
  for (const [k, v] of new URLSearchParams(loc?.search || '')) params[k] = v;
  return { page, space, params };
}

// 주소 만들기(상대 경로: GitHub Pages 하위 경로에서도 동작)
export function buildUrl(page, { space = null, params = {} } = {}) {
  const def = PAGES[page];
  if (!def) throw new Error(`알 수 없는 페이지: ${page}`);
  const q = new URLSearchParams(params).toString();
  const h = space && space !== def.defaultSpace && def.spaces.includes(space) ? `#${space}` : '';
  return `${def.file}${q ? `?${q}` : ''}${h}`;
}

// 권한 검사 → { ok, reason, redirect }
export function checkAccess(page, session = {}) {
  const def = PAGES[page];
  if (!def) return { ok: false, reason: 'unknown', redirect: 'index' };
  if (def.role === 'any') return { ok: true };
  if (!session.user) return { ok: false, reason: SHELL_TEXT.needLogin, redirect: 'index' };
  if (def.role === 'commander' && session.role !== 'commander') {
    return { ok: false, reason: SHELL_TEXT.noAccess, redirect: 'hangar' };
  }
  return { ok: true };
}

// 라우터. 실제 이동(location, history)은 바꿔 끼울 수 있게 주입한다(테스트용).
export function createRouter({ store = null, location = globalThis.location, history = globalThis.history, onDenied = null } = {}) {
  const listeners = new Set();
  let cur = parseLocation(location);

  const emit = () => listeners.forEach((fn) => fn(cur));
  const session = () => store?.get('session') || {};

  const api = {
    get current() { return cur; },
    parse: () => parseLocation(location),

    // 시작할 때 한 번: 권한이 없으면 안내 후 다른 페이지로 보낸다. 통과하면 true.
    guard() {
      const r = checkAccess(cur.page, session());
      if (r.ok) return true;
      onDenied?.(r);
      if (r.redirect && r.redirect !== cur.page) location.replace(buildUrl(r.redirect));
      return false;
    },

    // 다른 페이지로 이동
    go(page, opts = {}) {
      const r = checkAccess(page, session());
      if (!r.ok) { onDenied?.(r); return false; }
      location.assign(buildUrl(page, opts));
      return true;
    },

    // 같은 페이지 안에서 공간 전환(주소 해시만 바꿈, 새로고침 없음)
    toSpace(space) {
      const def = PAGES[cur.page];
      if (!def.spaces.includes(space)) return false;
      cur = { ...cur, space };
      const url = buildUrl(cur.page, { space, params: cur.params });
      history?.replaceState?.(null, '', url);
      store?.set('ui.space', space);
      emit();
      return true;
    },

    // 주소창에서 해시를 바꾸거나 뒤로가기를 눌렀을 때
    sync() {
      const next = parseLocation(location);
      if (next.space !== cur.space) { cur = next; store?.set('ui.space', cur.space); emit(); }
    },

    onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); },
  };

  if (typeof globalThis.addEventListener === 'function') globalThis.addEventListener('hashchange', () => api.sync());
  store?.set('ui.space', cur.space);
  return api;
}

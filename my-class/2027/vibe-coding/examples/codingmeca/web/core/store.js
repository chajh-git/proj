// web/core/store.js  (47번)
// 아주 작은 상태 저장소. 화면 모듈들이 공유하는 설정·로그인 정보·화면 상태를 담습니다.
//   const store = createAppStore();
//   store.get('settings.quality');         // 점(.) 경로로 읽기
//   store.set('settings.quality', 'mid');  // 쓰기 → 구독자에게 알림, settings는 브라우저에 자동 저장
//   const off = store.on('session.user', (v, prev) => ...);  // 그 값이 바뀔 때만 호출
// 저장은 localStorage에 하고, 쓸 수 없는 환경(사생활 보호 모드 등)에서는 조용히 메모리만 씁니다.

export const STORAGE_KEY = 'codingmeca.v1';

// 앱 기본값. 새 항목을 추가하면 저장된 옛 값과 자동으로 합쳐집니다.
export const DEFAULT_STATE = Object.freeze({
  settings: {
    quality: 'auto', // 'auto' | 'high' | 'mid' | 'low'
    audio: { master: 0.8, muted: false, channels: { ambient: 0.5, sfx: 0.8, ui: 0.6, music: 0.5 } },
    cameraMode: 'follow',
    showSentence: false, // 신경 연산실 '문장 보기' 토글 기억
  },
  session: {
    user: null, // { id, loginId, nickname, role } — 로그인하면 채워짐
    role: null, // 'mechanic' | 'commander'
    token: null,
  },
  ui: {
    space: null, // 현재 공간 ID
    entered: false, // 입장 버튼을 눌렀는지
    connection: 'offline', // 'offline' | 'connecting' | 'online'
  },
});

const isObj = (v) => v && typeof v === 'object' && !Array.isArray(v);
const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

// 기본값 위에 저장값을 덮되, 기본값에 없는 키는 버린다(옛 저장물 정리)
export function mergeDeep(base, over) {
  if (!isObj(base)) return over === undefined ? clone(base) : clone(over);
  const out = {};
  for (const k of Object.keys(base)) {
    out[k] = isObj(base[k]) ? mergeDeep(base[k], isObj(over) ? over[k] : undefined) : (isObj(over) && over[k] !== undefined ? clone(over[k]) : clone(base[k]));
  }
  return out;
}

export function getPath(obj, path) {
  if (!path) return obj;
  let cur = obj;
  for (const k of path.split('.')) {
    if (cur == null) return undefined;
    cur = cur[k];
  }
  return cur;
}

function setPath(obj, path, value) {
  const keys = path.split('.');
  const out = { ...obj };
  let cur = out;
  for (let i = 0; i < keys.length - 1; i++) {
    cur[keys[i]] = isObj(cur[keys[i]]) ? { ...cur[keys[i]] } : {};
    cur = cur[keys[i]];
  }
  cur[keys[keys.length - 1]] = value;
  return out;
}

const sameValue = (a, b) => a === b || (isObj(a) && isObj(b) && JSON.stringify(a) === JSON.stringify(b));

function safeStorage() {
  try {
    const s = globalThis.localStorage;
    const k = '__cm_test__';
    s.setItem(k, '1');
    s.removeItem(k);
    return s;
  } catch {
    return null;
  }
}

// persist: 저장할 최상위 키 목록. 기본은 settings만(로그인 정보는 저장하지 않음 — 세션은 Supabase가 관리)
export function createStore(initial, { persistKey = null, persist = [], storage = undefined } = {}) {
  const store = storage === undefined ? safeStorage() : storage;
  let state = clone(initial);
  if (persistKey && store) {
    try {
      const raw = JSON.parse(store.getItem(persistKey) || 'null');
      if (isObj(raw)) {
        const keep = {};
        for (const k of persist) if (raw[k] !== undefined) keep[k] = raw[k];
        state = mergeDeep(initial, keep);
      }
    } catch { /* 깨진 저장값은 무시 */ }
  }

  const subs = new Set(); // { path, fn }
  let saveTimer = 0;
  const save = () => {
    if (!persistKey || !store) return;
    clearTimeout(saveTimer);
    saveTimer = setTimeout(() => {
      try {
        const out = {};
        for (const k of persist) out[k] = state[k];
        store.setItem(persistKey, JSON.stringify(out));
      } catch { /* 가득 참 등: 무시 */ }
    }, 150);
  };

  function notify(prev) {
    for (const s of [...subs]) {
      const a = getPath(state, s.path);
      const b = getPath(prev, s.path);
      if (!sameValue(a, b)) s.fn(a, b, state);
    }
  }

  const api = {
    get: (path) => getPath(state, path),
    snapshot: () => clone(state),
    set(path, value) {
      const prev = state;
      if (sameValue(getPath(state, path), value)) return;
      state = setPath(state, path, clone(value));
      notify(prev);
      if (persist.includes(path.split('.')[0])) save();
    },
    // 여러 값 한 번에: patch({'ui.space': 'hangar', 'ui.entered': true})
    patch(map) {
      const prev = state;
      let changed = false;
      for (const [path, v] of Object.entries(map)) {
        if (sameValue(getPath(state, path), v)) continue;
        state = setPath(state, path, clone(v));
        changed = true;
        if (persist.includes(path.split('.')[0])) save();
      }
      if (changed) notify(prev);
    },
    // path가 바뀔 때 fn(새값, 옛값). path가 ''이면 모든 변경. 구독 해제 함수를 돌려줌
    on(path, fn) {
      const s = { path, fn };
      subs.add(s);
      return () => subs.delete(s);
    },
    reset(path) {
      const base = getPath(initial, path);
      api.set(path, clone(base));
    },
    flush() {
      clearTimeout(saveTimer);
      if (!persistKey || !store) return;
      try {
        const out = {};
        for (const k of persist) out[k] = state[k];
        store.setItem(persistKey, JSON.stringify(out));
      } catch { /* ignore */ }
    },
  };
  return api;
}

export function createAppStore(opts = {}) {
  return createStore(DEFAULT_STATE, { persistKey: STORAGE_KEY, persist: ['settings'], ...opts });
}

// web/editor/balance-store.js  (104번)
// 조율 센터가 들고 있는 값 저장소. 서버에 저장된 버전(saved), 지금 화면에서 고치는 값(values), 기본값(defaults)을 구분해 들고 있다. (명세 18-1, 18-4)
//   const store = createBalanceStore({ net });  await store.load();
//   store.get(path) / set(path, v) / revert(path) / reset(path) / revertAll()
//   store.isChanged(path)   저장본과 다른가      store.isDefault(path)   기본값과 같은가
//   store.changes()         저장본 대비 바뀐 목록 [{path,label,from,to}]
//   await store.save(note)  새 밸런스 버전으로 저장(서버가 같은 명세로 다시 검사)
//   store.importData(obj)   가져오기(범위 밖 값은 고쳐서, 알 수 없는 변수는 무시하고, 문제 목록을 돌려줌)
//   store.on('change', fn)  store.on('saved', fn)
// 저장 전에 닫아도 잃지 않도록 작업 중인 값을 브라우저에 임시 저장한다(저장본과 같은 버전일 때만 되살린다).

import { allSpecs, specFor } from '../../config/balance-schema.js';
import { normalizeBalance, diffBalance, changedFromDefault, flattenBalance } from '../../shared/balance/merge.js';

const DRAFT_KEY = 'codingmeca.balance.draft';
const clone = (v) => JSON.parse(JSON.stringify(v));
const eq = (a, b) => JSON.stringify(a) === JSON.stringify(b);

export function createBalanceStore({ net = null, storage = (() => { try { return window.localStorage; } catch { return null; } })() } = {}) {
  const defaults = Object.fromEntries(allSpecs().map((v) => [v.path, clone(v.default)]));
  let saved = {}; // 한 줄 경로 → 저장된 값(기본값과 다른 것만)
  let values = clone(defaults);
  let version = 0;
  let note = '';
  const L = { change: new Set(), saved: new Set() };
  const emit = (t, p) => L[t].forEach((fn) => { try { fn(p); } catch (e) { console.error(e); } });

  const savedValue = (path) => (path in saved ? saved[path] : defaults[path]);
  const draftWrite = () => { try { storage?.setItem(DRAFT_KEY, JSON.stringify({ base: version, data: changedFromDefault(values) })); } catch { /* 저장 공간 없음 */ } };
  const draftRead = () => { try { return JSON.parse(storage?.getItem(DRAFT_KEY) || 'null'); } catch { return null; } };
  const draftClear = () => { try { storage?.removeItem(DRAFT_KEY); } catch { /* ignore */ } };

  const api = {
    get version() { return version; },
    get note() { return note; },
    defaultOf: (path) => clone(defaults[path]),
    get: (path) => values[path],
    set(path, v) {
      if (!specFor(path)) return;
      if (eq(values[path], v)) return;
      values[path] = clone(v);
      draftWrite();
      emit('change', { path });
    },
    isChanged: (path) => !eq(values[path], savedValue(path)),
    isDefault: (path) => eq(values[path], defaults[path]),
    revert(path) { api.set(path, savedValue(path)); }, // 저장본으로
    reset(path) { api.set(path, defaults[path]); }, // 기본값으로
    revertAll() { values = { ...clone(defaults), ...clone(saved) }; draftClear(); emit('change', { path: null }); },
    changes: () => diffBalance(changedFromDefault(saved), changedFromDefault(values)),
    spec: (path) => specFor(path),
    snapshot: () => ({ ...values }), // 지금 값 전체(분석 도구가 저장 전 수치로 시험할 때)
    get dirty() { return api.changes().length > 0; },
    toData: () => changedFromDefault(values),
    flatSaved: () => ({ ...saved }),

    async load() {
      if (!net) { version = 0; saved = {}; values = clone(defaults); return { ok: true, offline: true }; }
      const r = await net.request('balance.get');
      if (!r.ok) return { ok: false, error: r.error };
      const { data, issues } = normalizeBalance(r.data.data);
      version = r.data.version; note = r.data.note || '';
      saved = flattenBalance(data);
      values = { ...clone(defaults), ...clone(saved) };
      const d = draftRead();
      let restored = false;
      if (d && d.base === version && d.data?.constants) {
        const n = normalizeBalance(d.data);
        const flat = flattenBalance(n.data);
        for (const [p, v] of Object.entries(flat)) values[p] = clone(v);
        restored = Object.keys(flat).length > 0 && api.dirty;
      }
      emit('change', { path: null });
      return { ok: true, issues, restored };
    },

    async save(text = '') {
      if (!net) return { ok: false, error: '서버에 연결되어 있지 않습니다' };
      const r = await net.request('balance.save', { data: api.toData(), baseVersion: version, note: text });
      if (!r.ok) return { ok: false, error: r.error, code: r.code };
      version = r.data.version; note = text;
      saved = flattenBalance(api.toData());
      draftClear();
      emit('change', { path: null });
      emit('saved', { version });
      return { ok: true, version, warnings: r.data.warnings || [] };
    },

    importData(obj) {
      const { data, issues } = normalizeBalance(obj);
      const flat = flattenBalance(data);
      values = { ...clone(defaults), ...clone(flat) }; // 가져온 파일이 곧 새 작업본
      draftWrite();
      emit('change', { path: null });
      return { issues, count: Object.keys(flat).length };
    },

    on(type, fn) { L[type]?.add(fn); return () => L[type]?.delete(fn); },
  };
  return api;
}

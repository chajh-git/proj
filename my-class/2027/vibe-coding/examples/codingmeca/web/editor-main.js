// web/editor-main.js  (103번)
// 조율 센터(editor.html)의 조립자. 지휘관 전용(라우터 + 서버가 모두 검사). (명세 18장)
//   · 변수 명세(config/balance-schema.js)로 화면을 자동으로 만든다. 모든 수치에 슬라이더(또는 알맞은 컴포넌트)와 숫자 칸이 함께 있다.
//   · 바뀐 항목은 강조되고 항목별 ↶(저장본으로)·↺(기본값으로)가 있다. 저장하면 새 밸런스 버전이 된다(서버가 한 번 더 검사).
//   · 리그는 만들 때의 버전을 계속 쓰며, 지휘 본부에서 ‘새 버전으로 갱신’을 눌러야 바뀐다.
//   · 이 파일은 패널 모듈(editor/panels/*)이 생기면 그 화면을 따로 끼워 넣을 수 있다 — 아직 없는 패널은 명세 기반 자동 화면이 맡는다.

import { createAppShell } from './core/app-shell.js';
import { createSupabaseClient } from './core/supabase-client.js';
import { restoreSession } from './core/session.js';
import { createNetClient } from './core/net-client.js';
import { createAdapter, setPartViewAdapter } from './render/part-view-adapter.js';
import { createCommandScene } from './scenes/command-scene.js';
import { BALANCE_GROUPS, VAR_BY_PATH } from '../config/balance-schema.js';
import { LEAGUE_PRESETS as PRESETS_META } from '../data/league-presets.js';
import { createBalanceStore } from './editor/balance-store.js';
import { createRowKit } from './editor/row-kit.js';
import { createConstantsPanel } from './editor/panels/constants-panel.js';
import { createPartsPanel, createCoresPanel } from './editor/panels/parts-panel.js';
import { createAptitudePanel } from './editor/panels/aptitude-panel.js';
import { createSpiritPanel } from './editor/panels/spirit-panel.js';
import { createMapsPanel } from './editor/panels/maps-panel.js';
import { createPilotPanel } from './editor/panels/pilot-panel.js';
import { createRecipesPanel } from './editor/panels/recipes-panel.js';
import { createPresetPanel, presetOverLimit } from './editor/panels/preset-panel.js';
import { createMatchupPanel } from './editor/sim-lab/matchup-matrix.js';
import { exportBalance, downloadJson, readJsonFile, parseBalanceFile } from './editor/io.js';
import { el, clear, ensureStyle } from './ui/dom.js';
import { ENV } from '../config/env.js';
import { NAMES } from '../config/names.js';

const CSS = `
.ed-wrap{position:fixed;inset:48px 10px 10px 10px;display:flex;gap:10px;z-index:15;min-height:0}
.ed-nav{width:200px;flex:none;display:flex;flex-direction:column;overflow:auto;padding:8px}
.ed-nav button{font:inherit;text-align:left;padding:8px 10px;margin:2px 0;border-radius:6px;border:1px solid transparent;background:transparent;color:var(--cm-text);cursor:pointer;display:flex;justify-content:space-between;gap:6px}
.ed-nav button:hover{border-color:var(--cm-panelEdge)}
.ed-nav button.on{background:color-mix(in srgb,var(--cm-primary) 18%,transparent);border-color:var(--cm-primary)}
.ed-nav .badge{background:var(--cm-primary);color:var(--cm-bg);border-radius:999px;font-size:11px;padding:0 7px;font-weight:700}
.ed-main{flex:1;min-width:0;display:flex;flex-direction:column}
.ed-top{display:flex;gap:8px;align-items:center;flex-wrap:wrap;padding:8px 12px;border-bottom:1px solid var(--cm-panelEdge)}
.ed-top .ttl{font-weight:700;color:var(--cm-primary);margin-right:6px}
.ed-top .ver{font-size:12px;color:var(--cm-textDim)}
.ed-top .sp{flex:1}
.ed-body{flex:1;overflow:auto;padding:6px 14px 40px}
.ed-body h2{font-size:16px;margin:14px 0 2px;color:var(--cm-primary)}
.ed-body .gd{font-size:12px;color:var(--cm-textDim);margin:0 0 8px}
.ed-row{display:grid;grid-template-columns:minmax(150px,230px) 1fr auto;gap:10px;align-items:center;padding:8px 10px;border-radius:8px;border:1px solid transparent;border-bottom-color:var(--cm-panelEdge)}
.ed-row.changed{background:color-mix(in srgb,var(--cm-primary) 10%,transparent);border-color:var(--cm-primary)}
.ed-row .lb b{display:block;font-size:13px}
.ed-row .lb small{display:block;font-size:11px;color:var(--cm-textDim);margin-top:2px;line-height:1.35}
.ed-row .df{font-size:11px;color:var(--cm-textDim);white-space:nowrap}
.ed-row .acts{display:flex;gap:4px}
.ed-row .acts button{font:inherit;width:28px;height:28px;border-radius:6px;border:1px solid var(--cm-panelEdge);background:transparent;color:var(--cm-text);cursor:pointer}
.ed-row .acts button:disabled{opacity:.25;cursor:default}
.ed-row .acts button:not(:disabled):hover{border-color:var(--cm-primary);color:var(--cm-primary)}
.ed-recs{display:flex;flex-direction:column;gap:4px}.ed-rec{display:flex;align-items:center;gap:10px}.ed-rec b{width:18px;text-align:center}
details.ed-adv{margin-top:10px;border:1px dashed var(--cm-panelEdge);border-radius:8px;padding:4px 8px}
details.ed-adv summary{cursor:pointer;font-size:13px;color:var(--cm-textDim);padding:6px 0}
.ed-dlg{position:fixed;inset:0;background:rgba(0,0,0,.6);z-index:40;display:flex;align-items:center;justify-content:center;padding:14px}
.ed-dlg .box{width:min(620px,100%);max-height:86vh;display:flex;flex-direction:column;padding:16px}
.ed-dlg h3{border:0;padding:0 0 8px}
.ed-dlg .list{overflow:auto;flex:1;font-size:13px}
.ed-dlg .list div{padding:5px 0;border-bottom:1px solid var(--cm-panelEdge);display:flex;justify-content:space-between;gap:10px}
.ed-dlg .list .warn{color:var(--cm-warn,#FFC857);display:block}
.ed-dlg .row{display:flex;gap:8px;margin-top:12px;justify-content:flex-end;align-items:center}
.ed-note{flex:1}
.ed-empty{color:var(--cm-textDim);padding:24px;text-align:center}
@media (max-width:820px){.ed-wrap{flex-direction:column}.ed-nav{width:auto;flex-direction:row;overflow-x:auto;flex:none}.ed-row{grid-template-columns:1fr}}
`;

const fmt = (v) => {
  if (typeof v === 'boolean') return v ? '켜짐' : '꺼짐';
  if (typeof v === 'number') return String(Number(v.toFixed(4)));
  if (Array.isArray(v)) return JSON.stringify(v);
  if (v && typeof v === 'object') return Object.entries(v).map(([k, x]) => `${k}:${typeof x === 'number' ? Number(x.toFixed(3)) : x}`).join(' ');
  return String(v);
};

export async function startEditor() {
  ensureStyle(CSS, 'ed-style');
  const canvas = document.getElementById('scene');
  const uiRoot = document.getElementById('ui');
  setPartViewAdapter(await createAdapter());
  const shell = createAppShell({ canvas, uiRoot, spaceId: 'command' });
  shell.registerScene('command', createCommandScene);
  const client = await createSupabaseClient();
  const session = await restoreSession(shell.store, client);
  if (!shell.router.guard()) return;
  await shell.start();
  document.getElementById('boot')?.remove();
  const toast = (t, kind) => shell.toast(t, kind);

  if (!ENV.serverUrl) {
    uiRoot.append(el('div', { class: 'cm-panel', style: { position: 'fixed', left: '14px', top: '60px', padding: '16px' } }, '서버 주소가 설정되지 않았습니다(config/env.js). 조율 센터는 서버에 저장하므로 서버가 필요합니다.'));
    return;
  }

  const net = createNetClient({ url: ENV.serverUrl, getToken: () => client.getToken(), store: shell.store });
  const app = mountEditor({ uiRoot, net, toast, goCommand: () => shell.router.go('command') });
  window.codingmecaEditor = { shell, net, store: app.store };
  void session;
}

// 화면을 붙이는 부분(시험에서 가짜 net 으로도 쓴다)
export function mountEditor({ uiRoot, net, toast, goCommand = () => {} }) {
  ensureStyle(CSS, 'ed-style');
  const store = createBalanceStore({ net });

  // ── 화면 뼈대 ───────────────────────────────────────────
  const nav = el('div', { class: 'cm-panel ed-nav' });
  const body = el('div', { class: 'ed-body' });
  const verEl = el('span', { class: 'ver' }, '불러오는 중…');
  const search = el('input', { class: 'cm-input', type: 'search', placeholder: '변수 찾기…', style: { width: '160px' } });
  const btn = (label, fn, cls = '') => el('button', { type: 'button', class: `cm-btn ${cls}`, onClick: fn }, label);
  const saveBtn = btn('저장', () => openSaveDialog(), 'primary');
  const fileIn = el('input', { type: 'file', accept: 'application/json,.json', style: { display: 'none' } });
  const top = el('div', { class: 'ed-top' },
    el('span', { class: 'ttl' }, NAMES.editor || '조율 센터'), verEl, el('span', { class: 'sp' }), search,
    btn('가져오기', () => fileIn.click()), btn('내보내기', () => { downloadJson(`codingmeca-balance-v${store.version}.json`, exportBalance(store)); toast('내보냈습니다(바뀐 공개 수치만 들어 있습니다)'); }),
    btn('전체 되돌리기', () => { if (!store.dirty || confirm('저장하지 않은 변경을 모두 버리고 저장본으로 되돌릴까요?')) store.revertAll(); }),
    saveBtn, btn('지휘 본부', () => goCommand()), fileIn);
  const main = el('div', { class: 'cm-panel ed-main' }, top, body);
  const wrap = el('div', { class: 'ed-wrap' }, nav, main);
  uiRoot.append(wrap);

  // ── 패널 모음 ───────────────────────────────────────────
  const kit = createRowKit({ store });
  const C = (id, label, groups) => createConstantsPanel({ store, kit, groups, id, label });
  const panels = [
    C('global', '전역·피해', ['global', 'damage']),
    C('stats', '능력 공식', ['stats']),
    createCoresPanel({ store, kit }),
    createPartsPanel({ store, kit }),
    createAptitudePanel({ store, kit }),
    createSpiritPanel({ store, kit }),
    C('combat', '교전', ['combat']),
    C('tactics', '전술·변신·조립', ['tactics', 'transform', 'assembly']),
    createMapsPanel({ store, kit }),
    createPilotPanel({ store, kit }),
    createRecipesPanel({ net, toast }),
    createPresetPanel({ store, kit }),
    C('lab-vars', '분석 설정', ['lab']),
    createMatchupPanel({ store, toast }),
  ];
  // 패널에서 못 맡은 일반 변수 그룹이 있으면 맨 뒤 ‘기타’ 로 보여 준다(그룹이 늘어도 빠지지 않게)
  const covered = new Set(panels.filter((p) => p.searchable).flatMap((p) => BALANCE_GROUPS.flatMap((g) => g.vars.map((v) => v.path)).filter((x) => p.owns(x))));
  const restGroups = BALANCE_GROUPS.filter((g) => g.vars.some((v) => !covered.has(v.path))).map((g) => g.id);
  if (restGroups.length) panels.splice(panels.length - 2, 0, C('etc', '기타', restGroups));
  let active = panels[0].id;
  let query = '';
  const cur = () => panels.find((p) => p.id === active) || panels[0];

  function show() {
    clear(body);
    const p = cur();
    body.append(p.el);
    if (query && p.searchable) p.search(query); else if (p.searchable) p.search(''); else p.onShow();
  }

  function renderNav() {
    clear(nav);
    const changes = store.changes();
    for (const p of panels) {
      const n = changes.filter((c) => p.owns(c.path)).length;
      nav.append(el('button', { type: 'button', class: p.id === active ? 'on' : '', onClick: () => { active = p.id; show(); renderNav(); } }, el('span', {}, p.label), n ? el('span', { class: 'badge' }, n) : null));
    }
  }

  function refreshHeader() {
    const n = store.changes().length;
    verEl.textContent = `밸런스 v${store.version}${store.note ? ` · ${store.note}` : ''}${n ? ` · 저장 안 된 변경 ${n}개` : ''}`;
    saveBtn.disabled = n === 0;
    renderNav();
  }

  store.on('change', ({ path }) => { if (path === null) show(); refreshHeader(); });
  search.addEventListener('input', () => {
    query = search.value.trim();
    // 검색어가 있으면 그 변수를 가진 첫 패널로 옮긴다(현재 패널에 없을 때)
    if (query) {
      const q = query.toLowerCase();
      const hit = panels.find((p) => p.searchable && p.id === active && p.search && (p.search(query), p.el.textContent.toLowerCase().includes(q)))
        || panels.find((p) => p.searchable && (p.search(query), p.el.textContent.toLowerCase().includes(q)));
      if (hit) active = hit.id;
    }
    show(); renderNav();
  });

  // ── 저장(변경 요약 확인) ────────────────────────────────
  function presetWarnings() {
    return PRESETS_META.flatMap((p) => presetOverLimit(store, p.id).map((w) => `리그 프리셋 ‘${p.name}’ 한도 초과 — 원형 설계도 ${w}`));
  }

  function openSaveDialog() {
    const changes = store.changes();
    if (!changes.length) { toast('바뀐 값이 없습니다'); return; }
    const warns = presetWarnings();
    const note = el('input', { class: 'cm-input ed-note', type: 'text', maxlength: 80, placeholder: '이번 변경 메모(선택)' });
    const list = el('div', { class: 'list' }, changes.map((c) => el('div', {}, el('span', {}, c.label), el('span', { style: { color: 'var(--cm-textDim)' } }, `${fmt(c.from)} → `, el('b', { style: { color: 'var(--cm-primary)' } }, fmt(c.to))))),
      warns.map((w) => el('div', {}, el('span', { class: 'warn' }, `⚠ ${w}`))));
    const dlg = el('div', { class: 'ed-dlg' });
    const close = () => dlg.remove();
    const go = btn('새 버전으로 저장', async () => {
      go.disabled = true;
      const r = await store.save(note.value.trim());
      if (!r.ok) { toast(r.error || '저장하지 못했습니다', 'error'); go.disabled = false; if (r.code === 'conflict') { close(); await store.load(); } return; }
      close();
      toast(`밸런스 v${r.version} 으로 저장했습니다. 리그는 ‘새 버전으로 갱신’을 눌러야 반영됩니다${r.warnings?.length ? ` (${r.warnings.length}건 보정)` : ''}`);
    }, 'primary');
    dlg.append(el('div', { class: 'cm-panel box' }, el('h3', {}, `변경 요약 · ${changes.length}개`), list, el('div', { class: 'row' }, note, btn('취소', close), go)));
    dlg.addEventListener('click', (e) => { if (e.target === dlg) close(); });
    uiRoot.append(dlg);
  }

  // ── 가져오기 ────────────────────────────────────────────
  fileIn.addEventListener('change', async () => {
    const f = fileIn.files?.[0];
    fileIn.value = '';
    if (!f) return;
    try {
      const parsed = parseBalanceFile(await readJsonFile(f));
      if (!parsed.ok) { toast(parsed.notes[0], 'error', 5000); return; }
      if (store.dirty && !confirm('지금 고치던 값은 가져온 파일의 값으로 바뀝니다(저장 전에는 서버에 영향이 없습니다). 계속할까요?')) return;
      store.importData(parsed.data);
      toast(`가져왔습니다: 바뀐 변수 ${parsed.count}개${parsed.notes.length ? ` · 안내 ${parsed.notes.length}건` : ''}. 저장을 눌러야 서버에 반영됩니다`, 'info', 5000);
      if (parsed.notes.length) console.info('가져오기 안내', parsed.notes);
    } catch (e) { toast(e.message, 'error'); }
  });

  window.addEventListener('beforeunload', (e) => { if (store.dirty) { e.preventDefault(); e.returnValue = ''; } });

  // ── 시작 ────────────────────────────────────────────────
  renderNav(); show();
  net.on('auth_ok', async () => {
    const r = await store.load();
    if (!r.ok) { verEl.textContent = r.error || '불러오지 못했습니다'; return; }
    if (r.restored) toast('저장하지 않고 닫았던 작업본을 되살렸습니다');
    if (r.issues?.length) console.info('저장본 안내', r.issues);
    refreshHeader();
  });
  net.on('close', () => { verEl.textContent = '연결이 끊어졌습니다. 다시 연결하는 중…'; });
  net.connect();
  return { store, net };
}

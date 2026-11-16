// web/command-main.js  (90번)
// 지휘 본부(command.html)의 조립자. 지휘관만 들어올 수 있다(라우터 + 서버가 모두 검사).
//   탭: 리그 / 경기 관제 / 비밀 레시피 / 계정·팀.  뒤쪽 장면은 지휘실 레이더: 경기 중 기체 신호점이 움직인다.
//   · 모든 명령은 서버로 보내고, 권한·수치는 서버가 최종 판단한다.
//   · 지휘관은 리그를 고르면 그 방(room)에 들어가 경기 상태·league_update 를 실시간으로 받는다.

import { createAppShell } from './core/app-shell.js';
import { createSupabaseClient } from './core/supabase-client.js';
import { restoreSession } from './core/session.js';
import { createNetClient } from './core/net-client.js';
import { createAdapter, setPartViewAdapter } from './render/part-view-adapter.js';
import { createCommandScene } from './scenes/command-scene.js';
import { createLeagueUI } from './ui/commander/league-ui.js';
import { createMatchControlUI } from './ui/commander/match-control-ui.js';
import { createRecipeUI } from './ui/commander/recipe-ui.js';
import { createAccountUI } from './ui/commander/account-ui.js';
import { el, ensureStyle } from './ui/dom.js';
import { ENV } from '../config/env.js';
import { NAMES } from '../config/names.js';

const CSS = `
.cd-wrap{position:fixed;top:56px;left:10px;bottom:10px;width:min(560px,calc(100vw - 20px));display:flex;flex-direction:column;z-index:15}
.cd-tabs{display:flex;gap:4px;margin-bottom:6px;flex-wrap:wrap}
.cd-tabs button{border-radius:999px;padding:6px 14px;font-size:13px}
.cd-tabs button.on{background:var(--cm-primary);color:var(--cm-bg);border-color:var(--cm-primary);font-weight:700}
.cd-body{flex:1;min-height:0;display:flex;flex-direction:column}
.cd-body>div{display:none;flex:1;min-height:0}
.cd-body>div.on{display:flex;flex-direction:column}
.cd-body>div>.cm-panel{flex:1;min-height:0}
.cd-conn{position:fixed;left:10px;bottom:10px;font-size:11px;color:var(--cm-textDim);z-index:20;pointer-events:none}
.cd-hint{position:fixed;right:12px;top:60px;font-size:12px;color:var(--cm-textDim);z-index:15;max-width:260px;text-align:right}
@media (max-width:900px){.cd-wrap{width:calc(100vw - 20px)}.cd-hint{display:none}}
`;

const TABS = [['league', '리그'], ['match', '경기 관제'], ['recipe', '비밀 레시피'], ['account', '계정 · 팀']];

export async function startCommand() {
  ensureStyle(CSS, 'cd-style');
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
  const scene = shell.scene;
  const toast = (t, kind) => shell.toast(t, kind);

  if (!ENV.serverUrl) {
    uiRoot.append(el('div', { class: 'cm-panel cd-wrap', style: { padding: '16px', height: 'auto', bottom: 'auto' } }, '서버 주소가 설정되지 않았습니다(config/env.js).'));
    return;
  }

  // ── 화면 조립 ───────────────────────────────────────────
  const wrap = el('div', { class: 'cd-wrap' });
  const tabBar = el('div', { class: 'cd-tabs' });
  const body = el('div', { class: 'cd-body' });
  const pages = {};
  for (const [id] of TABS) { pages[id] = el('div', {}); body.append(pages[id]); }
  const conn = el('div', { class: 'cd-conn' }, '연결 중…');
  wrap.append(tabBar, body);
  uiRoot.append(wrap, conn, el('div', { class: 'cd-hint' }, `${NAMES.command} · 수업 중 빔프로젝터에는 관제 스크린을 띄우세요`));

  const net = createNetClient({ url: ENV.serverUrl, getToken: () => client.getToken(), store: shell.store });
  const selfId = session?.id ?? null;

  let current = null; // 고른 리그 view
  let tab = 'league';
  const loaded = new Set();

  const matchUI = createMatchControlUI({ root: pages.match, net, toast, onChange: () => refreshLeague() });
  const leagueUI = createLeagueUI({
    root: pages.league, net, toast,
    onSelect: async (id, view) => {
      current = view;
      matchUI.setLeague(view);
      await net.request('room.join', { leagueId: id }); // 이 리그의 경기·갱신을 받는다
    },
  });
  const recipeUI = createRecipeUI({ root: pages.recipe, net, toast });
  const accountUI = createAccountUI({ root: pages.account, net, toast, selfId });

  async function refreshLeague() {
    if (!leagueUI.selected || leagueUI.selected === 'new') return;
    const r = await net.request('league.view', { leagueId: leagueUI.selected });
    if (r.ok) { current = r.data; matchUI.setLeague(current); }
  }

  function showTab(id) {
    tab = id;
    for (const [t] of TABS) { pages[t].classList.toggle('on', t === id); tabBar.querySelector(`[data-tab=${t}]`)?.classList.toggle('on', t === id); }
    if (id === 'recipe' && !loaded.has(id)) { loaded.add(id); recipeUI.refresh(); }
    if (id === 'account' && !loaded.has(id)) { loaded.add(id); accountUI.refresh(); }
    if (id === 'match') refreshLeague();
  }
  for (const [id, label] of TABS) tabBar.append(el('button', { type: 'button', class: 'cm-btn', 'data-tab': id, onClick: () => showTab(id) }, label));
  showTab('league');

  // ── 서버 메시지 ─────────────────────────────────────────
  let refreshTimer = 0;
  const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(() => { leagueUI.refresh(); refreshLeague(); }, 250); };
  net.on('close', () => { conn.textContent = '연결이 끊어졌습니다. 다시 연결하는 중…'; });
  net.on('auth_ok', () => { conn.textContent = '지휘관 · 연결됨'; leagueUI.refresh(); });
  net.on('error', (m) => { conn.textContent = m.error || '오류'; if (m.code === 'auth') toast('로그인 정보를 확인할 수 없습니다. 다시 로그인해 주세요', 'error'); });
  net.on('league_update', () => refreshSoon());

  // 레이더: 진행 중인 경기의 기체 신호점
  let liveMatch = null;
  let teamOf = new Map();
  net.on('match_prepare', (m) => { liveMatch = m.match; teamOf = new Map((m.init?.entities || []).map((e) => [e.id, e.team])); const a = m.init?.arena; if (a) scene.setArena?.(a.halfW, a.halfD); scene.setStatus?.('live'); });
  net.on('state', (m) => {
    if (m.match !== liveMatch) return;
    scene.setBlips?.((m.s.ents || []).map((e) => ({ id: e.id, x: e.x, z: e.z, team: teamOf.get(e.id) || 'A', alive: e.a === 1 })));
  });
  net.on('match_end', (m) => { if (m.match === liveMatch) { liveMatch = null; scene.setBlips?.([]); scene.setStatus?.('idle'); scene.ping?.(); } });
  net.on('match_status', (m) => { if (m.match === liveMatch) scene.setStatus?.(m.status === 'paused' ? 'alert' : 'live'); });

  net.connect();
  void tab;
}

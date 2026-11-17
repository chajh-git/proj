// web/arena-main.js  (87번)
// 관제 스크린(arena.html)의 조립자. 관람 코드(6자리)로 읽기 전용 접속하거나, 지휘관이 로그인해 리그를 골라 본다.
//   · 서버가 보내는 상태(20Hz)를 관람 버퍼(0.6초 지연)에 쌓아 부드럽게 재생 — 서버가 공식 결과를 정한다.
//   · 경기 사이에는 순위표·대진표를 크게, 경기 중에는 HUD + 작은 점수판을 보여 준다.
//   · 로그인 없이 보는 사람은 어떤 설계·전술도 받지 못한다(서버가 공개 정보만 보낸다).

import { createAppShell } from './core/app-shell.js';
import { createSupabaseClient } from './core/supabase-client.js';
import { restoreSession } from './core/session.js';
import { createNetClient, createStateBuffer } from './core/net-client.js';
import { createAdapter, setPartViewAdapter } from './render/part-view-adapter.js';
import { createArenaScene } from './scenes/arena-scene.js';
import { createHud } from './ui/hud.js';
import { createManualPilot } from './core/manual-pilot.js';
import { createCinematicPlayer } from './cinematics/cinematic-player.js';
import { createScoreboard, statusLabel } from './ui/scoreboard.js';
import { createBracketView } from './ui/bracket-view.js';
import { el, clear, ensureStyle } from './ui/dom.js';
import { ENV } from '../config/env.js';
import { CONSTANTS } from '../config/constants.js';
import { NAMES } from '../config/names.js';

const CSS = `
.ar-bar{position:fixed;left:50%;bottom:10px;transform:translateX(-50%);display:flex;gap:6px;padding:5px 8px;border-radius:999px;z-index:20;flex-wrap:wrap;justify-content:center;max-width:calc(100vw - 20px)}
.ar-bar button{border-radius:999px;font-size:12px;padding:5px 11px}
.ar-bar button.on{background:var(--cm-primary);color:var(--cm-bg);border-color:var(--cm-primary);font-weight:700}
.ar-banner{position:fixed;top:92px;left:50%;transform:translateX(-50%);z-index:21;padding:8px 22px;border-radius:999px;background:rgba(0,0,0,.72);border:1px solid var(--cm-primary);font-size:15px;font-weight:700;letter-spacing:.06em;display:none;pointer-events:none}
.ar-banner.on{display:block}
.ar-idle{position:fixed;inset:0;z-index:12;display:none;align-items:center;justify-content:center;gap:14px;padding:56px 14px 60px;background:rgba(2,4,10,.55);box-sizing:border-box}
.ar-idle.on{display:flex}
.ar-idle>div{max-height:100%;min-width:0;display:flex;flex-direction:column}
.ar-idle .a{flex:0 1 480px}.ar-idle .b{flex:1 1 640px;max-width:900px}
.ar-corner{position:fixed;right:10px;bottom:56px;width:min(300px,calc(100vw - 20px));max-height:42vh;z-index:15;display:none}
.ar-corner.on{display:flex;flex-direction:column}
.ar-pick{position:fixed;inset:0;z-index:25;display:none;align-items:center;justify-content:center;padding:16px}
.ar-pick.on{display:flex}
.ar-pick .card{width:min(420px,100%);padding:18px}
.ar-pick h2{margin:0 0 4px;font-size:18px;color:var(--cm-primary)}
.ar-pick p{margin:0 0 10px;font-size:12px;color:var(--cm-textDim)}
.ar-pick .lg{display:flex;width:100%;justify-content:space-between;margin:5px 0;padding:10px 12px;text-align:left}
.ar-conn{position:fixed;left:10px;bottom:10px;font-size:11px;color:var(--cm-textDim);z-index:20}
@media (max-width:900px){.ar-idle{flex-direction:column;overflow:auto;align-items:stretch;justify-content:flex-start}.ar-idle .a,.ar-idle .b{flex:none;max-width:none}}
`;

export async function startArena() {
  ensureStyle(CSS, 'ar-style');
  const canvas = document.getElementById('scene');
  const uiRoot = document.getElementById('ui');
  const hudRoot = document.getElementById('hudRoot');

  setPartViewAdapter(await createAdapter());
  const shell = createAppShell({ canvas, uiRoot, spaceId: 'arena' });
  shell.registerScene('arena', createArenaScene);
  const client = await createSupabaseClient();
  const session = await restoreSession(shell.store, client);
  if (!shell.router.guard()) return;
  await shell.start();
  document.getElementById('boot')?.remove();
  const arena = shell.scene;
  const isCommander = session?.role === 'commander';
  const code = String(shell.router.current.params.code || '').trim().toUpperCase();

  // ── 화면 조각 ───────────────────────────────────────────
  const hud = createHud({ root: hudRoot });
  hud.setVisible(false);
  const idle = el('div', { class: 'ar-idle on' });
  const idleA = el('div', { class: 'a' }); const idleB = el('div', { class: 'b' });
  idle.append(idleA, idleB);
  const corner = el('div', { class: 'ar-corner' });
  const banner = el('div', { class: 'ar-banner' });
  const conn = el('div', { class: 'ar-conn' }, '연결 중…');
  const pick = el('div', { class: 'ar-pick' });
  uiRoot.append(idle, corner, banner, conn, pick);
  const board = createScoreboard({ root: idleA });
  const bracket = createBracketView({ root: idleB });
  const cine = createCinematicPlayer({ scene: arena, uiRoot, bufferDelay: CONSTANTS.gauge.viewBufferSeconds });
  const mini = createScoreboard({ root: corner });
  mini.setCompact(true);

  // ── 상태 ────────────────────────────────────────────────
  const buf = createStateBuffer();
  let view = null;
  let ref = code ? { code } : null; // { code } | { leagueId }
  let matchId = null;
  let init = null;
  let live = false;
  let ended = null;
  let shown = false;
  let endTimer = 0;
  let bannerTimer = 0;
  let refreshTimer = 0;
  let camMode = 'overview';
  let followIdx = 0;
  let myId = null;
  let lastSnap = null;

  const say = (text, ms = 0) => {
    clearTimeout(bannerTimer);
    banner.textContent = text || '';
    banner.classList.toggle('on', Boolean(text));
    if (text && ms) bannerTimer = setTimeout(() => banner.classList.remove('on'), ms);
  };

  function setView(v) {
    view = v;
    board.update(v);
    mini.update(v);
    const hasBracket = Boolean(v?.bracket);
    idleB.style.display = hasBracket ? '' : 'none';
    if (hasBracket) bracket.update(v);
  }

  async function refresh() {
    if (!ref) return;
    const r = await net.request('league.view', ref);
    if (r.ok && r.data) setView(r.data);
  }
  const refreshSoon = () => { clearTimeout(refreshTimer); refreshTimer = setTimeout(refresh, 250); };

  function showIdle(on) {
    idle.classList.toggle('on', on);
    corner.classList.toggle('on', !on && Boolean(view));
    hud.setVisible(!on);
  }

  function endMatchView() {
    pilot.stop();
    pilotBtn.style.display = 'none';
    live = false; ended = null; shown = false; matchId = null; init = null;
    arena.clearMatch?.();
    cine.cancelAll();
    hud.reset();
    buf.reset();
    say('');
    showIdle(true);
    refresh();
  }

  // ── 접속 ────────────────────────────────────────────────
  if (!ENV.serverUrl) {
    conn.textContent = '서버 주소가 설정되지 않았습니다(config/env.js)';
    pick.classList.add('on');
    pick.append(el('div', { class: 'cm-panel card' }, el('h2', {}, NAMES.arena), el('p', {}, '서버 주소가 비어 있어 경기를 볼 수 없습니다. 선생님께 문의하세요.')));
    return;
  }
  const net = createNetClient({ url: ENV.serverUrl, getToken: () => client.getToken(), store: shell.store });
  net.on('close', () => { conn.textContent = '연결이 끊어졌습니다. 다시 연결하는 중…'; });
  net.on('auth_ok', async (m) => {
    myId = m?.user?.id ?? null;
    conn.textContent = isCommander ? '지휘관 · 연결됨' : '연결됨';
    if (ref?.leagueId) { await net.request('room.join', { leagueId: ref.leagueId }); refresh(); }
    else if (!ref) await showPicker();
  });
  net.on('error', (m) => { conn.textContent = m.error || '오류'; if (m.code === 'not_found') say('관람 코드를 확인하세요', 4000); });
  net.on('view_ok', (m) => setView(m.view));
  net.on('league_update', () => refreshSoon());

  net.on('match_prepare', (m) => {
    if (m.practice) return;
    pilot.stop();
    matchId = m.match; init = m.init; live = true; ended = null; shown = false;
    pilotBtn.style.display = myId && init.entities?.some((e) => e.owner === myId) ? '' : 'none';
    clearTimeout(endTimer);
    buf.reset();
    arena.loadMatch(init);
    arena.setCameraMode(camMode, camMode === 'follow' ? { id: init.entities[0]?.id } : undefined);
    const names = {};
    for (const t of m.teams || []) names[t.id] = t.name;
    hud.setMatch(init, { teamNames: names });
    cine.reset(init, { teamNames: names });
    showIdle(false);
    say('경기 준비', 2500);
  });
  net.on('match_start', (m) => { if (m.match === matchId) say(''); });
  net.on('state', (m) => { if (m.match === matchId && !m.practice) buf.push(m.s); });
  net.on('match_status', (m) => {
    if (m.match !== matchId) return;
    say(m.status === 'paused' ? `⏸ ${statusLabel('paused')}` : '', 0);
  });
  net.on('cinematic_start', (m) => { if (m.match === matchId) cine.handleServer(m); });
  net.on('cinematic_resume', (m) => { if (m.match === matchId) cine.handleServer(m); });
  net.on('cinematic_end', (m) => { if (m.match === matchId) cine.handleServer(m); });
  net.on('match_end', (m) => {
    if (m.match !== matchId) return;
    ended = m.result;
    if (m.result?.aborted) { say('경기가 중단되었습니다', 4000); endTimer = setTimeout(endMatchView, 4500); }
  });

  async function showPicker() {
    const r = await net.request('leagues.list');
    clear(pick);
    pick.classList.add('on');
    const card = el('div', { class: 'cm-panel card' }, el('h2', {}, NAMES.arena), el('p', {}, isCommander ? '볼 리그를 고르세요.' : '관람 코드가 필요합니다. 로비에서 6자리 코드를 입력해 주세요.'));
    if (isCommander && r.ok) {
      if (!r.data.length) card.append(el('p', {}, '진행 중인 리그가 없습니다.'));
      for (const l of r.data) card.append(el('button', { type: 'button', class: 'cm-btn lg', onClick: async () => { ref = { leagueId: l.id }; pick.classList.remove('on'); await net.request('room.join', { leagueId: l.id }); refresh(); } }, el('b', {}, l.name), el('small', {}, statusLabel(l.status))));
    }
    pick.append(card);
  }

  net.connect();
  if (code) net.joinView(code);

  // ── 직접 조종(키보드·마우스) ─────────────────────────────
  // 서버가 '내 기체인지·리그가 허용했는지'를 판단한다. 조종 중에는 지연을 줄여 반응이 빠르게 보이게 한다.
  const pilot = createManualPilot({
    arena, canvas, uiRoot, sendEveryMs: 50,
    send: (raw) => net.send('pilot', { match: matchId, input: raw }),
    onStop: () => {
      if (matchId) net.send('pilot', { match: matchId, on: false });
      buf.setDelay(CONSTANTS.gauge.viewBufferSeconds);
      pilotBtn.classList.remove('on');
      setMode(camMode);
    },
  });
  let asking = false;
  const pilotBtn = el('button', { type: 'button', class: 'cm-btn', style: { display: 'none' }, title: '내 기체를 키보드·마우스로 직접 조종합니다(리그가 허용한 경기만)', onClick: () => {
    if (pilot.active) return pilot.stop();
    if (!live || !matchId) return;
    const mine = init?.entities?.find((e) => e.owner === myId);
    asking = true;
    net.send('pilot', { match: matchId, on: true, ent: mine?.id });
  } }, '직접 조종');
  const REASON = { disabled: '이 리그는 직접 조종이 꺼져 있습니다', not_owner: '내 기체가 이 경기에 없습니다', not_running: '경기가 진행 중일 때만 조종할 수 있습니다', dead: '기체가 이미 격파되었습니다' };
  net.on('pilot_state', (m) => {
    if (m.match !== matchId) return;
    if (!m.ok) { if (asking || pilot.active) say(REASON[m.reason] || '직접 조종을 시작할 수 없습니다', 3000); asking = false; if (pilot.active) pilot.stop(); return; }
    asking = false;
    if (m.on && !pilot.active) {
      const h = lastSnap?.ents?.find((e) => e.id === m.ent)?.h ?? init?.entities?.find((e) => e.id === m.ent)?.h ?? 0;
      buf.setDelay(0.15);
      pilot.start({ id: m.ent, heading: h });
      pilotBtn.classList.add('on');
    }
  });

  // ── 카메라·조작 막대 ────────────────────────────────────
  const modeBtns = new Map();
  const mkMode = (mode, label) => {
    const b = el('button', { type: 'button', class: 'cm-btn', onClick: () => setMode(mode) }, label);
    modeBtns.set(mode, b);
    return b;
  };
  function setMode(mode) {
    camMode = mode;
    if (mode === 'follow' && init?.entities?.length) { followIdx = (followIdx + 1) % init.entities.length; arena.setCameraMode('follow', { id: init.entities[followIdx].id }); }
    else arena.setCameraMode(mode);
    for (const [k, b] of modeBtns) b.classList.toggle('on', k === mode);
  }
  const showBoard = el('button', { type: 'button', class: 'cm-btn', onClick: () => { if (!live) return; const open = !idle.classList.contains('on'); idle.classList.toggle('on', open); corner.classList.toggle('on', !open); } }, '순위표');
  const bar = el('div', { class: 'cm-panel ar-bar' }, mkMode('overview', '전체'), mkMode('follow', '추적'), mkMode('duel', '대결'), mkMode('free', '자유'), showBoard, pilotBtn,
    isCommander ? el('button', { type: 'button', class: 'cm-btn', onClick: () => shell.router.go('command') }, '지휘 본부') : null);
  uiRoot.append(bar);
  modeBtns.get('overview').classList.add('on');

  // ── 매 프레임 ───────────────────────────────────────────
  let last = performance.now();
  const tick = (now) => {
    requestAnimationFrame(tick);
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    if (!live) return;
    buf.setTimeScale(Math.min(arena.timeScale || 1, cine.timeScale));
    const frame = buf.advance(dt);
    cine.update(dt, frame?.snap?.ents ?? null);
    if (frame) { lastSnap = frame.snap; arena.feed(frame); hud.update(frame.snap); hud.pushEvents(frame.events); cine.handleEvents(frame.events); }
    if (pilot.active) pilot.frame(dt, frame?.snap ?? lastSnap);
    if (ended && !ended.aborted && !shown && buf.lagSeconds < 0.03) {
      shown = true;
      hud.showResult(ended, {});
      arena.cheer?.(1);
      endTimer = setTimeout(endMatchView, 10000);
    }
  };
  requestAnimationFrame(tick);

  window.codingmecaArena = { shell, net, get view() { return view; }, get live() { return live; } };
}

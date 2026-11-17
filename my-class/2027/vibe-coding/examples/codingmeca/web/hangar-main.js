// web/hangar-main.js  (71번)
// 메카닉 앱(hangar.html)의 조립자. 공간: 격납고 / 신경 연산실 / 시험 사격장 + 출전 등록 · 기록·도감 화면.
//   · 격납고에서 만든 기체(설계)와 신경 연산실에서 짠 전술이 하나의 '기체'로 함께 저장된다.
//   · 시험 사격장: 이 브라우저에서 shared/sim 을 직접 돌리는 근사 시험(융합·변신 없음, 공식 결과 아님).
//   · 서버 연결(리그·전적·도감·출전 등록)은 client(supabase-client)가 제공하는 함수가 있을 때만 켜진다.

import { createAppShell } from './core/app-shell.js';
import { createSupabaseClient } from './core/supabase-client.js';
import { restoreSession } from './core/session.js';
import { createStateBuffer } from './core/net-client.js';
import { createAdapter, setPartViewAdapter } from './render/part-view-adapter.js';
import { createHangarScene } from './scenes/hangar-scene.js';
import { createTacticsLabScene } from './scenes/tactics-lab-scene.js';
import { createRangeScene } from './scenes/range-scene.js';
import { createArenaScene } from './scenes/arena-scene.js';
import { createAssemblyUI } from './ui/assembly-ui.js';
import { createCardLibrary } from './ui/tactics/card-library.js';
import { createCardBoard, createTacticsModel } from './ui/tactics/card-board.js';
import { createStanceMap, collectLinks } from './ui/tactics/stance-map.js';
import { createSentenceView } from './ui/tactics/sentence-view.js';
import { STANCE_COLORS } from './ui/tactics/labels.js';
import { createHud } from './ui/hud.js';
import { createRecordUI } from './ui/record-ui.js';
import { createRosterUI } from './ui/roster-ui.js';
import { el, clear, ensureStyle } from './ui/dom.js';
import { PRESETS } from '../data/presets.js';
import { MAPS, getMap } from '../data/maps.js';
import { NAMES } from '../config/names.js';
import { CONSTANTS } from '../config/constants.js';
import { validateDesign } from '../shared/build/validator.js';
import { serializeDesign } from '../shared/build/serialize.js';
import { emptyTactics } from '../shared/tactics/schema.js';
import { validateTactics } from '../shared/tactics/validator.js';
import { createMatch, stepMatch } from '../shared/sim/referee.js';
import { makeInitInfo } from '../shared/sim/snapshot.js';
import { enableManual, disableManual, setManualInput } from '../shared/tactics/manual.js';
import { createManualPilot } from './core/manual-pilot.js';

const LS_ROBOTS = 'codingmeca.local.robots';
const LS_TACTICS_DRAFT = 'codingmeca.draft.tactics';

const VIEWS = {
  hangar: { space: 'hangar', label: NAMES.hangar },
  lab: { space: 'tacticsLab', label: NAMES.tacticsLab },
  range: { space: 'range', label: NAMES.range },
  roster: { space: 'hangar', label: '출전 등록' },
  record: { space: 'hangar', label: `기록 · ${NAMES.codex}` },
};
const SPACE_TO_VIEW = { hangar: 'hangar', tacticsLab: 'lab', range: 'range' };

const clone = (o) => JSON.parse(JSON.stringify(o));
const lsGet = (k, d) => { try { const v = localStorage.getItem(k); return v ? JSON.parse(v) : d; } catch { return d; } };
const lsSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* 저장 불가 환경 */ } };

// 기체 저장소: 온라인이면 서버(robots 테이블), 아니면 이 브라우저(localStorage)
function createRobotStore(client) {
  if (client.online) return client.robots;
  return {
    async list() { return { ok: true, robots: lsGet(LS_ROBOTS, []).sort((a, b) => String(b.updated_at).localeCompare(String(a.updated_at))) }; },
    async save({ id = null, name, design, tactics }) {
      const all = lsGet(LS_ROBOTS, []);
      const rid = id || `L${Date.now().toString(36)}`;
      const row = { id: rid, name: String(name || design?.name || '이름 없는 기체').slice(0, 40), design, tactics, updated_at: new Date().toISOString() };
      const i = all.findIndex((r) => r.id === rid);
      if (i >= 0) all[i] = row; else all.push(row);
      lsSet(LS_ROBOTS, all);
      return { ok: true, id: rid };
    },
    async remove(id) { lsSet(LS_ROBOTS, lsGet(LS_ROBOTS, []).filter((r) => r.id !== id)); return { ok: true }; },
  };
}

export async function startHangar() {
  const canvas = document.getElementById('scene');
  const uiRoot = document.getElementById('ui');
  const hudRoot = document.getElementById('hudRoot');

  // 처음에는 늘 격납고 장면으로 시작(조립 화면이 격납고 장면을 필요로 함). 주소의 공간은 준비가 끝난 뒤 이동한다.
  const wantedSpace = location.hash.replace(/^#\/?/, '');
  if (location.hash) history.replaceState(null, '', location.pathname + location.search);

  setPartViewAdapter(await createAdapter());
  const shell = createAppShell({ canvas, uiRoot, spaceId: 'hangar' });
  shell.registerScene('hangar', createHangarScene);
  shell.registerScene('tacticsLab', createTacticsLabScene);
  shell.registerScene('range', createRangeScene);
  shell.registerScene('arena', createArenaScene); // 시험 경기 화면(쪽 주소에는 나타나지 않음)

  const client = await createSupabaseClient();
  const session = await restoreSession(shell.store, client);
  if (!shell.router.guard()) return;
  const me = session?.user || { nickname: '', loginId: '' };
  const robotsDb = createRobotStore(client);

  await shell.start();
  document.getElementById('boot')?.remove();
  const toast = (t, kind) => shell.toast(t, kind);
  const hangarScene = shell.scene;

  // ── 상태 ────────────────────────────────────────────────
  let robots = [];
  let activeRobotId = null;
  let tacticsDirty = false;
  let lastKey = '';
  const byKey = new Map(); // 설계 직렬화 → { robotId, tactics }  (불러오기 메뉴에서 고른 기체의 전술을 함께 불러오기 위함)

  const model = createTacticsModel(lsGet(LS_TACTICS_DRAFT, null) || emptyTactics());
  const initialKeyed = (list) => list.forEach((r) => byKey.set(serializeDesign(r.design), { robotId: r.id, tactics: r.tactics || r.design?.tactics || null }));
  for (const p of PRESETS) byKey.set(serializeDesign(p), { robotId: null, tactics: p.tactics });

  async function refreshRobots() {
    const res = await robotsDb.list();
    robots = res.ok ? res.robots : [];
    if (!res.ok) toast(res.error || '기체 목록을 불러오지 못했습니다', 'error');
    for (const [k, v] of [...byKey]) if (v.robotId) byKey.delete(k);
    initialKeyed(robots);
    asm.setLibrary({ mine: robots.map((r) => ({ id: r.id, name: r.name, design: r.design })) });
    roster?.setRobots(robots);
  }

  async function saveRobot(design) {
    const res = await robotsDb.save({ id: activeRobotId, name: design.name, design, tactics: model.get() });
    if (!res.ok) { toast(res.error || '저장하지 못했습니다', 'error'); return false; }
    activeRobotId = res.id;
    tacticsDirty = false;
    await refreshRobots();
    byKey.set(serializeDesign(design), { robotId: activeRobotId, tactics: clone(model.get()) });
    lastKey = serializeDesign(design);
    asm.markSaved?.();
    updateLabBar();
    return true;
  }

  // ── 격납고 ──────────────────────────────────────────────
  let ready = false; // 화면 조각이 모두 만들어지기 전에는 변경 알림에서 다른 화면을 건드리지 않는다
  let lab = null; let lib = null; let board = null; let map = null; let sent = null; let roster = null;
  const asm = createAssemblyUI({
    root: uiRoot, scene: hangarScene, renderer: shell.renderer, audio: shell.audio, presets: PRESETS,
    onSave: (design) => { saveRobot(design); },
    onChange: (design) => {
      const key = serializeDesign(design);
      if (key !== lastKey) {
        lastKey = key;
        const hit = byKey.get(key);
        // 불러오기 메뉴로 기체·원형 설계도를 골랐을 때: 전술을 아직 고치지 않았다면 그 전술을 함께 불러온다
        if (hit && hit.tactics && !tacticsDirty) { model.set(hit.tactics); activeRobotId = hit.robotId; }
      }
      if (!ready) return;
      lib?.setDesign(design);
      board?.setDesign(design);
      updateRange();
    },
  });
  asm.el.style.display = 'none';

  // ── 신경 연산실(처음 들어갈 때 만든다) ─────────────────
  let labReady = false;
  const labBox = el('div', { class: 'hg-view hg-lab', 'data-m': 'board' });
  const mtabs = el('div', { class: 'hg-mtabs' }, ...[['lib', '카드'], ['board', '규칙'], ['map', '태세']].map(([id, label]) => el('button', { type: 'button', class: 'cm-tab', onClick: () => { labBox.dataset.m = id; } }, label)));
  const c1 = el('div', { class: 'c1' }); const c2 = el('div', { class: 'c2' }); const c3 = el('div', { class: 'c3' }); const c4 = el('div', { class: 'c4' });
  const stState = el('span', { class: 'st' }, '');
  const sentBtn = el('button', { type: 'button', class: 'cm-btn' }, '문장으로 보기');
  const lbar = el('div', { class: 'cm-panel lbar' },
    el('button', { type: 'button', class: 'cm-btn primary', onClick: () => { if (!asm.validation.saveable) return toast('기체에 오류가 있어 저장할 수 없습니다. 격납고에서 확인하세요', 'error'); saveRobot(asm.getDesign()); } }, '기체 저장'),
    el('button', { type: 'button', class: 'cm-btn', onClick: () => show('range') }, '시험 사격장으로'),
    sentBtn, stState, el('span', { class: 'sp' }),
    el('small', { class: 'st' }, '카드를 눌러 고른 뒤 규칙 칸을 누르거나, 끌어서 놓으세요'));
  labBox.append(mtabs, c1, c2, c3, c4, lbar);
  uiRoot.append(labBox);

  function updateLabBar() {
    const r = validateTactics(model.get(), { design: asm.getDesign() });
    stState.textContent = `${tacticsDirty ? '● 저장 안 됨' : '저장됨'} · 오류 ${r.errors.length} · 경고 ${r.warnings.length}`;
  }

  function syncLab() {
    if (!lab) return;
    const t = model.get();
    lab.setStances(t.stances.map((s, i) => ({ id: s.id, label: s.name, color: STANCE_COLORS[i % STANCE_COLORS.length] })));
    lab.setLinks(collectLinks(t).map((l) => ({ from: l.from, to: l.to })));
    lab.highlight(model.currentStance);
  }

  function buildLab() {
    if (labReady) return;
    labReady = true;
    lab = shell.scene;
    lib = createCardLibrary({
      root: c1,
      onSelect: (p) => board.setPending(p),
      onLocked: (m) => toast(m),
      onDragMove: (p, x, y) => board.dragOver(x, y),
      onDrop: (p, x, y) => { const ok = board.drop(p, x, y); lib.setSelected(null); board.setPending(null); if (ok) { shell.audio.play('ui_confirm'); lab.pulse(); } },
      onDragCancel: () => board.dragEnd(),
    });
    board = createCardBoard({ root: c2, model, onToast: (t) => toast(t), onFocusRule: () => lab.pulse() });
    board.onPlaced(() => { lib.setSelected(null); board.setPending(null); shell.audio.play('ui_confirm'); lab.pulse(); });
    map = createStanceMap({ root: c4, model, onToast: (t) => toast(t) });
    sent = createSentenceView({ root: c4 });
    const showSent = () => !!shell.store.get('settings.showSentence');
    const applySent = () => { sent.show(showSent()); sentBtn.textContent = showSent() ? '문장 보기 끄기' : '문장으로 보기'; };
    sentBtn.addEventListener('click', () => { shell.store.set('settings.showSentence', !showSent()); applySent(); });
    lab.onPick((id) => { model.currentStance = id; });
    model.on('stance', () => lab.highlight(model.currentStance));
    model.on('change', (t, why) => {
      sent.update(t, asm.getDesign());
      syncLab();
      if (why === 'mutate' || why === 'undo' || why === 'redo') tacticsDirty = true;
      if (why === 'set') tacticsDirty = false;
      lsSet(LS_TACTICS_DRAFT, t);
      updateLabBar();
    });
    lib.setDesign(asm.getDesign());
    board.setDesign(asm.getDesign());
    sent.update(model.get(), asm.getDesign());
    applySent();
    syncLab();
    updateLabBar();
    window.addEventListener('keydown', (e) => {
      if (!labBox.classList.contains('on')) return;
      const tag = (e.target?.tagName || '').toLowerCase();
      if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? model.redo() : model.undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); model.redo(); }
      else if (e.key === 'Escape') { lib.setSelected(null); board.setPending(null); }
    });
  }

  // ── 시험 사격장 ─────────────────────────────────────────
  const rangeBox = el('div', { class: 'hg-view hg-range' });
  const oppSel = el('select', { class: 'cm-input', 'aria-label': '상대 기체' });
  const mapSel = el('select', { class: 'cm-input', 'aria-label': '전장' }, MAPS.map((m) => el('option', { value: m.id }, m.name)));
  const brief = el('div', { class: 'brief' });
  const startBtn = el('button', { type: 'button', class: 'cm-btn primary', style: { width: '100%', marginTop: '10px' } }, '시험 경기 시작');
  rangeBox.append(el('div', { class: 'cm-panel card' }, el('h3', {}, '시험 사격장'), el('div', { class: 'body' },
    el('div', { class: 'cm-field' }, el('label', {}, '상대 기체'), oppSel),
    el('div', { class: 'cm-field' }, el('label', {}, NAMES.map), mapSel),
    brief, startBtn,
    el('div', { class: 'brief', style: { marginTop: '10px' } }, '이 브라우저에서 계산하는 근사 시험입니다. 융합·변신은 쓸 수 없고, 공식 결과로 인정되지 않습니다.'))));
  uiRoot.append(rangeBox);

  function updateRange() {
    const cur = oppSel.value;
    clear(oppSel);
    const g1 = el('optgroup', { label: '원형 설계도' }, PRESETS.map((p) => el('option', { value: `p:${p.id}` }, p.name)));
    oppSel.append(g1);
    if (robots.length) oppSel.append(el('optgroup', { label: '내 기체' }, robots.map((r) => el('option', { value: `r:${r.id}` }, r.name))));
    if (cur && [...oppSel.options].some((o) => o.value === cur)) oppSel.value = cur;
    const v = asm.validation;
    const s = v?.stats;
    brief.innerHTML = '';
    brief.append(el('div', {}, '내 기체: ', el('b', {}, asm.getDesign().name || '이름 없음')),
      s ? el('div', {}, `무게 ${Math.round(s.weight * 10) / 10} · 체력 ${s.hp} · 무기 ${s.weapons.length}개`) : null,
      v && !v.ok ? el('div', { style: { color: 'var(--cm-danger)' } }, `출전 불가: ${v.errors[0]?.message || ''}`) : null);
  }

  // 시험 경기 ───────────────
  const hud = createHud({ root: hudRoot });
  hud.setVisible(false);
  const playCtl = el('div', { class: 'hg-view hg-play' });
  uiRoot.append(playCtl);
  let practice = null;

  function pickOpponent() {
    const val = oppSel.value || `p:${PRESETS[0].id}`;
    if (val.startsWith('p:')) { const p = PRESETS.find((x) => x.id === val.slice(2)); return { name: p.name, design: p, tactics: p.tactics }; }
    const r = robots.find((x) => x.id === val.slice(2));
    return r ? { name: r.name, design: r.design, tactics: r.tactics || r.design?.tactics || emptyTactics() } : null;
  }

  async function startPractice() {
    const design = asm.getDesign();
    const v = validateDesign(design, { limits: CONSTANTS.limits });
    if (!v.ok) return toast(`출전할 수 없는 기체입니다: ${v.errors[0]?.message || ''}`, 'error');
    const opp = pickOpponent();
    if (!opp) return toast('상대 기체를 고르세요', 'error');
    const buf = createStateBuffer({ delay: 0.2 });
    let match;
    try {
      match = createMatch({
        teams: [{ id: 'A', entries: [{ design, tactics: clone(model.get()) }] }, { id: 'B', entries: [{ design: opp.design, tactics: opp.tactics }] }],
        map: getMap(mapSel.value), seed: (Math.random() * 1e6) | 0, onSnapshot: (s) => buf.push(s),
      });
    } catch (e) { return toast(`경기를 만들지 못했습니다: ${e.message}`, 'error'); }
    const init = makeInitInfo(match.world);
    await shell.switchSpace('arena');
    const arena = shell.scene;
    arena.loadMatch(init);
    arena.setCameraMode('overview');
    hud.setMatch(init, { teamNames: { A: '내 기체', B: opp.name } });
    hud.setVisible(true);
    setPanels('play');

    const st = { speed: 1, acc: 0, last: performance.now(), raf: 0, shown: false, pilot: null };
    practice = st;
    // 직접 조종: 키보드·마우스(신경 연산실 전술과 별개). 켜 있는 동안 내 기체의 전술은 멈춘다(완전 수동).
    const me = () => match.world.byId.get('A1');
    const pilot = createManualPilot({
      arena, canvas, uiRoot, send: (raw) => { const e = me(); if (e?.manual) setManualInput(e, raw); },
      onStop: () => { const e = me(); if (e) disableManual(e); manualBtn.classList.remove('on'); arena.setCameraMode('overview'); },
    });
    st.pilot = pilot;
    const toggleManual = () => {
      if (pilot.active) return pilot.stop();
      const e = me();
      if (!e || !e.alive || match.status !== 'running') return toast('지금은 직접 조종할 수 없습니다', 'error');
      enableManual(e);
      pilot.start({ id: 'A1', heading: e.heading });
      manualBtn.classList.add('on');
    };
    const manualBtn = el('button', { type: 'button', class: 'cm-btn', title: '키보드·마우스로 내 기체를 직접 조종합니다(전술은 멈춤)', onClick: toggleManual }, '직접 조종');
    const tick = (now) => {
      if (practice !== st) return;
      st.raf = requestAnimationFrame(tick);
      const dt = Math.min(0.1, (now - st.last) / 1000);
      st.last = now;
      const eff = st.speed * arena.timeScale;
      st.acc += dt * eff;
      let n = 0;
      while (st.acc >= 1 / 60 && match.status === 'running' && n < 14) { stepMatch(match); st.acc -= 1 / 60; n++; }
      if (st.acc > 14 / 60) st.acc = 0;
      const frame = buf.advance(dt * eff);
      if (frame) { arena.feed(frame); hud.update(frame.snap); hud.pushEvents(frame.events); }
      if (pilot.active) { pilot.frame(dt, frame?.snap); if (match.status !== 'running') pilot.stop(); }
      if (match.status !== 'running' && !st.shown && buf.lagSeconds < 0.03) { st.shown = true; hud.showResult(match.result, { mySide: 'A' }); }
    };
    st.raf = requestAnimationFrame(tick);

    const spd = (x) => el('button', { type: 'button', class: 'cm-btn', onClick: () => { st.speed = x; } }, `×${x}`);
    const cam = (m, label, o) => el('button', { type: 'button', class: 'cm-btn', onClick: () => arena.setCameraMode(m, o) }, label);
    clear(playCtl);
    playCtl.append(el('div', { class: 'ctl' },
      el('button', { type: 'button', class: 'cm-btn primary', onClick: stopPractice }, '← 돌아가기'),
      spd(0.5), spd(1), spd(2), spd(4),
      cam('overview', '전체'), cam('follow', '추적', { id: 'A1' }), cam('duel', '대결'), manualBtn));
  }

  async function stopPractice() {
    if (!practice) return;
    cancelAnimationFrame(practice.raf);
    practice.pilot?.dispose();
    practice = null;
    hud.reset();
    hud.setVisible(false);
    shell.scene.clearMatch?.();
    await shell.switchSpace('range');
    setPanels('range');
  }

  startBtn.addEventListener('click', () => startPractice());

  // ── 출전 등록 · 기록 ────────────────────────────────────
  const rosterBox = el('div', { class: 'hg-view hg-panel' }, el('div', { class: 'inner' }));
  const recordBox = el('div', { class: 'hg-view hg-panel' }, el('div', { class: 'inner' }));
  uiRoot.append(rosterBox, recordBox);
  roster = createRosterUI({
    root: rosterBox.firstChild,
    onOpenHangar: () => show('hangar'),
    onRegister: async (payload) => {
      if (!client.rosters?.register) return { ok: false, error: '서버에 연결되어 있지 않아 지금은 등록할 수 없습니다' };
      return client.rosters.register(payload);
    },
  });
  const record = createRecordUI({ root: recordBox.firstChild });

  async function loadServerLists() {
    try {
      const l = await client.leagues?.listOpen?.();
      roster.setLeagues(l?.ok ? l.leagues : []);
      const r = await client.records?.list?.();
      record.setRecords(r?.ok ? r.records : []);
      const c = await client.codex?.list?.();
      record.setCodex(c?.ok ? c : { total: 0, entries: [] });
    } catch (e) { console.warn(e); }
  }

  // ── 위쪽 이동 막대와 화면 전환 ─────────────────────────
  const bar = el('div', { class: 'hg-bar' });
  document.body.append(bar);
  let cur = null;
  let busy = false;

  function setPanels(view) {
    asm.el.style.display = view === 'hangar' ? '' : 'none';
    labBox.classList.toggle('on', view === 'lab');
    rangeBox.classList.toggle('on', view === 'range');
    rosterBox.classList.toggle('on', view === 'roster');
    recordBox.classList.toggle('on', view === 'record');
    playCtl.classList.toggle('on', view === 'play');
    bar.style.display = view === 'play' ? 'none' : '';
    bar.querySelectorAll('button[data-view]').forEach((b) => b.classList.toggle('on', b.dataset.view === view));
  }

  async function show(view) {
    if (busy || view === cur || !VIEWS[view]) return;
    busy = true;
    try {
      if (practice) await stopPractice();
      await shell.switchSpace(VIEWS[view].space);
      if (view === 'lab') buildLab();
      if (view === 'range') updateRange();
      if (view === 'lab') { syncLab(); updateLabBar(); }
      if (view === 'roster' || view === 'record') loadServerLists();
      cur = view;
      setPanels(view);
    } finally { busy = false; }
  }

  for (const [id, v] of Object.entries(VIEWS)) bar.append(el('button', { type: 'button', 'data-view': id, onClick: () => show(id) }, v.label));
  bar.append(el('span', { class: 'who' }, me.nickname || ''),
    el('button', { type: 'button', onClick: () => { shell.router.go('index'); } }, '로비'));

  // ── 시작 ────────────────────────────────────────────────
  ready = true;
  await refreshRobots();
  updateRange();
  cur = 'hangar';
  setPanels('hangar');
  if (SPACE_TO_VIEW[wantedSpace] && wantedSpace !== 'hangar') await show(SPACE_TO_VIEW[wantedSpace]);

  window.codingmeca = { shell, asm, model, show, client };
}

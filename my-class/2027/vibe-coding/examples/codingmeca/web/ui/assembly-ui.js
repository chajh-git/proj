// web/ui/assembly-ui.js  (59번)
// 격납고 인터페이스 레이어 전체: 왼쪽 파츠 팔레트 / 가운데 3D 작업대 / 오른쪽 능력치·조종사 / 아래 불러오기·저장·형태 바. (명세 14-3)
//
// 조작
//   · 팔레트 카드를 끌어 작업대 위 연결점(●)에 놓는다. 또는 카드를 눌러 선택한 뒤 연결점을 누른다.
//   · 호환되는 연결점만 밝게 표시된다(소=초록, 중=파랑, 대=주황). 겹치거나 한도를 넘으면 빨갛게/경고로 알려 준다.
//   · 붙은 파츠를 누르면 선택 → 분리(그 아래 파츠도 함께) / 형태(공통·A·B) 지정. 키보드: Delete, Ctrl+Z, Ctrl+Y, Esc.
//   · 코어 탭에서 코어를 누르면 코어 교체(새 코어가 못 받는 파츠는 함께 제거).
//
//   const asm = createAssemblyUI({ root, scene, renderer, audio, presets, onSave, onChange });
//   asm.setDesign(design) / asm.getDesign() / asm.validation / asm.setLibrary({ mine:[{id,name,design}] })
//   asm.markSaved() / asm.focusPart(uid) / asm.destroy()
// scene = 격납고 장면(53번)의 객체(anchors.workbench, attachSpark, focus).  저장·서버 통신은 하지 않고 onSave로 넘긴다(71번이 처리).

import * as THREE from 'three';
import { attachPart, detachPart, replaceCore, setPartForm, hasMorphJoint, activeSet, descendantsOf, allSlots } from '../../shared/build/assembly.js';
import { validateDesign } from '../../shared/build/validator.js';
import { computeExposure } from '../../shared/build/layout.js';
import { normalizeDesign, emptyDesign, designHash } from '../../shared/build/serialize.js';
import { infoFromDesign, createRobotView } from '../render/robot-view.js';
import { getPartViewAdapter } from '../render/part-view-adapter.js';
import { getPart } from '../../data/parts.js';
import { CONSTANTS } from '../../config/constants.js';
import { SIZE_LABEL, CATEGORY_LABEL } from '../../config/names.js';
import { createPartsPalette } from './parts-palette.js';
import { createStatsPanel } from './stats-panel.js';
import { createPilotUI } from './pilot-ui.js';
import { el, clear, ensureStyle, flashHint } from './dom.js';

const DRAFT_KEY = 'codingmeca.draft.design';
const SIZE_COLOR = { S: 0x6bffb0, M: 0x6b9bff, L: 0xffa24d };
const HISTORY_MAX = 60;

const CSS = `
.cm-asm{position:fixed;inset:0;pointer-events:none;display:grid;grid-template-columns:minmax(210px,300px) 1fr minmax(230px,330px);grid-template-rows:1fr auto;gap:10px;padding:10px;z-index:12;box-sizing:border-box}
.cm-asm>*{pointer-events:auto;min-height:0}
.cm-asm .left{grid-row:1;grid-column:1}
.cm-asm .mid{grid-row:1;grid-column:2;pointer-events:none;position:relative}
.cm-asm .right{grid-row:1;grid-column:3;margin-top:44px;display:flex;flex-direction:column;gap:8px}
.cm-asm .right .tabs{display:flex;gap:6px}
.cm-asm .right .pane{flex:1;min-height:0}
.cm-asm .right .pane>.cm-panel{height:100%;overflow:auto}
.cm-asm .bar{grid-row:2;grid-column:1/-1;display:flex;flex-wrap:wrap;gap:8px;align-items:center;padding:8px 10px}
.cm-asm .bar .nm{width:170px}
.cm-asm .bar .sp{flex:1}
.cm-asm .bar .state{font-size:12px;color:var(--cm-textDim)}
.cm-asm .bar .state.dirty{color:var(--cm-warn,#FFB020)}
.cm-asm .sel{position:absolute;left:50%;bottom:6px;transform:translateX(-50%);pointer-events:auto;padding:8px 12px;display:flex;gap:10px;align-items:center;flex-wrap:wrap;max-width:94%}
.cm-menu{position:fixed;z-index:70;min-width:260px;max-height:60vh;overflow:auto;padding:6px}
.cm-menu h4{margin:8px 8px 4px;font-size:11px;letter-spacing:.1em;color:var(--cm-textDim)}
.cm-menu button{display:block;width:100%;text-align:left;padding:7px 10px;border:0;border-radius:6px;background:none;color:var(--cm-text);font:inherit;cursor:pointer}
.cm-menu button:hover{background:rgba(255,255,255,.08)}
.cm-menu small{color:var(--cm-textDim);margin-left:6px}
@media (max-width:900px){.cm-asm{grid-template-columns:200px 1fr 220px;font-size:12px}}
`;

const v3 = (o) => new THREE.Vector3(o.x, o.y, o.z);
const clone = (d) => JSON.parse(JSON.stringify(d));

export function createAssemblyUI({ root, scene, renderer, audio = null, presets = [], design = null, onSave = () => {}, onChange = () => {}, limits = CONSTANTS.limits } = {}) {
  ensureStyle(CSS, 'cm-asm-style');
  const camera = renderer.camera;
  const canvas = renderer.canvas;
  const workbench = scene.anchors.workbench;
  const play = (id) => audio?.play(id);

  // ── 상태 ──
  let draft = null;
  if (!design) { try { draft = JSON.parse(localStorage.getItem(DRAFT_KEY) || 'null'); } catch { draft = null; } }
  let current = normalizeDesign(design || draft || emptyDesign('core1', '새 기체'));
  let form = 'A';
  let past = [];
  let future = [];
  let held = null; // 손에 든 파츠 ID
  let selected = null; // 선택한 붙은 파츠 uid
  let v = null; // 현재 검증 결과
  let savedHash = designHash(current);
  let library = { mine: [] };
  let view = null;
  let markers = []; // { slot, mesh, ring, local:Vector3 }
  let hoverMarker = null;
  let raf = 0;
  let dead = false;
  let autosaveTimer = 0;
  let overlapTick = 0;

  // ── 화면 틀 ──
  const wrap = el('div', { class: 'cm-asm' });
  const left = el('div', { class: 'left' });
  const mid = el('div', { class: 'mid' });
  const right = el('div', { class: 'right' });
  const bar = el('div', { class: 'cm-panel bar' });
  wrap.append(left, mid, right, bar);
  root.append(wrap);

  const palette = createPartsPalette({
    root: left,
    onSelect: (id) => onPaletteSelect(id),
    onDragStart: (id) => { setHeld(id, false); },
    onDragMove: (id, x, y) => { hover(nearestMarker(x, y, 90)); },
    onDrop: (id, x, y) => {
      const over = document.elementFromPoint(x, y);
      const m = over === canvas || over === document.querySelector('.cm-ui') ? nearestMarker(x, y, 90) : null;
      if (getPart(id).category === 'core') { setHeld(null); return; }
      if (m) doAttach(id, m.slot);
      else if (over === canvas) flashHint(mid, '연결점(●) 가까이에 놓아 주세요');
      setHeld(null);
    },
    onDragCancel: () => setHeld(null),
  });
  left.firstChild.style.height = '100%';

  const tabs = el('div', { class: 'tabs' });
  const pane = el('div', { class: 'pane' });
  right.append(tabs, pane);
  const statsHost = el('div', { style: { height: '100%' } });
  const pilotHost = el('div', { style: { height: '100%', display: 'none' } });
  pane.append(statsHost, pilotHost);
  const stats = createStatsPanel({ root: statsHost, onFocusPart: (uid) => focusPart(uid), onExposureToggle: () => recompute(false) });
  const pilotUI = createPilotUI({ root: pilotHost, onChange: (p) => { commit({ ...current, pilot: p }, { merge: 'pilot' }); } });
  pilotUI.setPilot(current.pilot);
  for (const [id, label] of [['stats', '능력치'], ['pilot', '조종사']]) {
    tabs.append(el('button', { type: 'button', class: `cm-tab${id === 'stats' ? ' on' : ''}`, 'data-tab': id, onClick: () => showTab(id) }, label));
  }
  function showTab(id) {
    statsHost.style.display = id === 'stats' ? '' : 'none';
    pilotHost.style.display = id === 'pilot' ? '' : 'none';
    tabs.querySelectorAll('.cm-tab').forEach((t) => t.classList.toggle('on', t.dataset.tab === id));
  }

  // 아래 바
  const nameInput = el('input', { class: 'cm-input nm', maxlength: CONSTANTS.assembly.maxDesignNameLength, 'aria-label': '기체 이름', placeholder: '기체 이름' });
  const stateText = el('span', { class: 'state' });
  const btnUndo = el('button', { class: 'cm-btn', type: 'button', title: '되돌리기 (Ctrl+Z)', onClick: () => undo() }, '↶');
  const btnRedo = el('button', { class: 'cm-btn', type: 'button', title: '다시 (Ctrl+Y)', onClick: () => redo() }, '↷');
  const btnLoad = el('button', { class: 'cm-btn', type: 'button', onClick: (e) => openMenu(e.currentTarget) }, '불러오기');
  const btnSave = el('button', { class: 'cm-btn primary', type: 'button', onClick: () => save() }, '저장');
  const formBox = el('span', { class: 'cm-tabs', style: { display: 'none' } });
  bar.append(nameInput, btnLoad, btnSave, btnUndo, btnRedo, formBox, el('span', { class: 'sp' }), stateText);
  nameInput.addEventListener('input', () => { current = { ...current, name: nameInput.value }; recompute(false); });
  nameInput.addEventListener('change', () => { pushHistory(); });

  // 선택한 파츠 막대
  const selBar = el('div', { class: 'cm-panel sel', style: { display: 'none' } });
  mid.append(selBar);

  // ── 기록 ──
  function pushHistory() {
    past.push(clone(current));
    if (past.length > HISTORY_MAX) past.shift();
    future = [];
  }
  // 새 설계로 바꾼다. merge 가 같으면 직전 기록과 합친다(이름 입력처럼 연속 변경)
  let lastMerge = null;
  function commit(next, { merge = null } = {}) {
    if (!(merge && merge === lastMerge)) { past.push(clone(current)); if (past.length > HISTORY_MAX) past.shift(); }
    lastMerge = merge;
    future = [];
    current = normalizeDesign(next);
    recompute(true);
  }
  function undo() { if (!past.length) return; future.push(clone(current)); current = past.pop(); lastMerge = null; selected = null; recompute(true); play('ui_whoosh'); }
  function redo() { if (!future.length) return; past.push(clone(current)); current = future.pop(); lastMerge = null; selected = null; recompute(true); play('ui_whoosh'); }

  // ── 검증·화면 갱신 ──
  function recompute(rebuild = true) {
    v = validateDesign(current, { form, limits });
    const s = v.stats;
    let exposure = null;
    if (stats.exposureOn && v.tree.root && v.layout) exposure = computeExposure(v.tree, v.layout, { form });
    stats.update(v, { limits, exposure });

    if (s) {
      palette.setBudget({ weightLeft: limits.weightCap - s.weight, costLeft: limits.budget - s.cost });
    }
    const count = new Map();
    for (const p of current.parts) count.set(p.part, (count.get(p.part) || 0) + 1);
    palette.setPresent(count);

    if (document.activeElement !== nameInput) nameInput.value = current.name;
    btnUndo.disabled = !past.length;
    btnRedo.disabled = !future.length;
    const dirty = designHash(current) !== savedHash;
    stateText.textContent = v.errors.length ? `문제 ${v.errors.length}건` : dirty ? '수정됨 (저장 전)' : '저장됨';
    stateText.classList.toggle('dirty', dirty);
    btnSave.disabled = !v.saveable;

    // 형태 보기 막대
    const morph = hasMorphJoint(v.tree);
    formBox.style.display = morph ? '' : 'none';
    if (morph) {
      clear(formBox);
      for (const f of ['A', 'B']) formBox.append(el('button', { type: 'button', class: `cm-tab${form === f ? ' on' : ''}`, onClick: () => { form = f; recompute(true); } }, `형태 ${f}`));
    } else if (form !== 'A') form = 'A';

    if (selected && !v.tree.nodes.has(selected)) selected = null;
    if (rebuild) { rebuildView(); drawMarkers(); }
    renderSelBar();
    clearTimeout(autosaveTimer);
    autosaveTimer = setTimeout(() => { try { localStorage.setItem(DRAFT_KEY, JSON.stringify(current)); } catch { /* 저장 불가 환경 */ } }, 400);
    onChange(current, v);
  }

  // ── 3D 작업대 기체 ──
  function rebuildView() {
    if (view) { workbench.remove(view.group); view.dispose?.(); view = null; }
    const adapter = getPartViewAdapter();
    if (!adapter || !v.tree.root) return;
    const info = infoFromDesign(current);
    if (hasMorphJoint(v.tree)) {
      const act = activeSet(v.tree, form);
      info.parts = info.parts.filter((p) => act.has(p.uid));
    }
    view = createRobotView({ info, adapter, label: false });
    view.group.position.y = info.groundOffset || 0;
    workbench.add(view.group);
    view.update?.(null, 0, 0);
  }

  // ── 연결점 표시 ──
  const markerRoot = new THREE.Group();
  workbench.add(markerRoot);
  const sphereGeo = new THREE.SphereGeometry(0.17, 14, 12);
  const ringGeo = new THREE.RingGeometry(0.26, 0.31, 28);

  function clearMarkers() {
    for (const m of markers) { markerRoot.remove(m.mesh); m.mesh.material.dispose(); m.ring.material.dispose(); }
    markers = [];
    hoverMarker = null;
  }

  function slotPoint(slot) {
    const it = v.layout.items.get(slot.parentUid);
    const dir = v3(slot.dir);
    // 같은 면의 다른 연결점과 겹치지 않게 옆으로 벌리고, 이미 붙은 하위 파츠 바깥에 둔다
    const all = allSlots(v.tree).filter((s) => s.parentUid === slot.parentUid && s.dirKey === slot.dirKey);
    const rank = all.findIndex((s) => s.id === slot.id);
    let ext = it.half;
    for (const s of all) {
      if (!s.occupiedBy) continue;
      for (const uid of [s.occupiedBy, ...descendantsOf(v.tree, s.occupiedBy)]) {
        const b = v.layout.items.get(uid)?.box;
        if (!b) continue;
        const corner = new THREE.Vector3(dir.x >= 0 ? b.max.x : b.min.x, dir.y >= 0 ? b.max.y : b.min.y, dir.z >= 0 ? b.max.z : b.min.z);
        ext = Math.max(ext, corner.sub(v3(it.center)).dot(dir));
      }
    }
    const tangent = Math.abs(dir.x) > 0.5 ? new THREE.Vector3(0, 0, 1) : new THREE.Vector3(1, 0, 0);
    const p = v3(it.center).addScaledVector(dir, ext + 0.32).addScaledVector(tangent, (rank - (all.length - 1) / 2) * 0.42);
    p.y += view?.group.position.y || 0;
    return p;
  }

  function drawMarkers() {
    clearMarkers();
    if (!v?.tree.root || !v.layout) return;
    let candidates = [];
    if (held) {
      const def = getPart(held);
      if (def.category !== 'core') candidates = allSlots(v.tree).filter((s) => !s.occupiedBy && fits(def.size, s.size));
    } else if (current.parts.length <= 2) {
      candidates = allSlots(v.tree).filter((s) => !s.occupiedBy); // 빈 기체는 모든 연결점을 살짝 보여 준다
    }
    const bright = Boolean(held);
    for (const slot of candidates) {
      const color = SIZE_COLOR[slot.size];
      const mesh = new THREE.Mesh(sphereGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: bright ? 0.95 : 0.4, depthTest: false, toneMapped: false }));
      const ring = new THREE.Mesh(ringGeo, new THREE.MeshBasicMaterial({ color, transparent: true, opacity: bright ? 0.8 : 0.25, depthTest: false, side: THREE.DoubleSide, toneMapped: false }));
      mesh.renderOrder = ring.renderOrder = 80;
      const local = slotPoint(slot);
      mesh.position.copy(local);
      ring.position.copy(local);
      markerRoot.add(mesh, ring);
      markers.push({ slot, mesh, ring, local });
    }
  }
  const SIZE_RANK = { S: 1, M: 2, L: 3 };
  const fits = (partSize, slotSize) => SIZE_RANK[partSize] <= SIZE_RANK[slotSize];

  // ── 화면 좌표 도구 ──
  const rect = () => canvas.getBoundingClientRect();
  function project(world) {
    const p = world.clone().project(camera);
    const r = rect();
    return { x: r.left + ((p.x + 1) / 2) * r.width, y: r.top + ((1 - p.y) / 2) * r.height, behind: p.z > 1 };
  }
  function nearestMarker(cx, cy, maxPx) {
    workbench.updateWorldMatrix(true, true);
    let best = null;
    let bd = maxPx;
    for (const m of markers) {
      const w = m.mesh.getWorldPosition(new THREE.Vector3());
      const s = project(w);
      if (s.behind) continue;
      const d = Math.hypot(s.x - cx, s.y - cy);
      if (d < bd) { bd = d; best = m; }
    }
    return best;
  }
  function pxPerMeter(world) {
    const dist = camera.position.distanceTo(world);
    return rect().height / 2 / (Math.tan((camera.fov * Math.PI) / 360) * dist);
  }
  function nearestPart(cx, cy) {
    if (!view) return null;
    view.group.updateWorldMatrix(true, true);
    let best = null;
    let bd = Infinity;
    for (const [uid, it] of v.layout.items) {
      if (!view.getPartWorldPos) break;
      const w = view.getPartWorldPos(uid);
      if (!w) continue;
      const s = project(w);
      const rad = Math.max(22, (it.edge / 2) * pxPerMeter(w) * 1.05);
      const d = Math.hypot(s.x - cx, s.y - cy);
      const score = d - rad; // 반지름 안이면 음수. 작은 파츠(앞쪽에 붙은 것)가 우선되도록 반지름이 작을수록 유리
      if (d <= rad && score + rad * 0.5 < bd) { bd = score + rad * 0.5; best = uid; }
    }
    return best;
  }

  function hover(m) {
    if (hoverMarker === m) return;
    hoverMarker = m;
  }

  // ── 손에 든 파츠 ──
  function setHeld(id, fromPalette = true) {
    if (held === id) return;
    held = id;
    if (fromPalette === true) palette.setSelected(id);
    drawMarkers();
    if (id) flashHint(mid, '연결점(●)에 놓거나 눌러서 붙이세요 · Esc로 취소', 2600);
  }
  function onPaletteSelect(id) {
    if (!id) { setHeld(null, false); return; }
    play('part_pick');
    if (getPart(id).category === 'core') {
      doReplaceCore(id);
      palette.setSelected(null);
      setHeld(null, false);
      return;
    }
    setHeld(id, false);
  }

  // ── 편집 ──
  function doAttach(partId, slot) {
    const r = attachPart(current, { part: partId, parent: slot.parentUid, size: slot.size, index: slot.index });
    if (!r.ok) { play('part_invalid'); flashHint(mid, r.error.message || '붙일 수 없습니다'); return false; }
    commit(r.design);
    selected = r.uid;
    scene.attachSpark?.(partWorld(r.uid));
    play('link_chime');
    renderSelBar();
    return true;
  }
  function doDetach(uid) {
    const r = detachPart(current, uid);
    if (!r.ok) { play('part_invalid'); flashHint(mid, r.error.message); return; }
    selected = null;
    commit(r.design);
    play('part_detach');
    scene.steam?.(0);
  }
  function doReplaceCore(coreId) {
    const root0 = current.parts.find((p) => p.parent === null);
    if (root0?.part === coreId) return;
    const r = replaceCore(current, coreId);
    if (!r.ok) { flashHint(mid, r.error?.message || '코어를 바꿀 수 없습니다'); return; }
    const removed = current.parts.length - r.design.parts.length;
    if (removed > 0 && !window.confirm(`새 코어에 붙일 수 없는 파츠 ${removed}개가 함께 제거됩니다. 바꿀까요?`)) return;
    commit(r.design);
    play('part_attach');
    scene.pulseCore?.();
  }
  function partWorld(uid) {
    if (!view) return null;
    view.group.updateWorldMatrix(true, true);
    return view.getPartWorldPos(uid);
  }

  // ── 선택 막대 ──
  function renderSelBar() {
    clear(selBar);
    if (!selected || !v?.tree.nodes.has(selected)) { selBar.style.display = 'none'; return; }
    const n = v.tree.nodes.get(selected);
    const d = n.def;
    selBar.style.display = '';
    selBar.append(
      el('b', {}, d.name),
      d.size ? el('span', { class: `cm-chip ${d.size}` }, `${SIZE_LABEL[d.size]}`) : null,
      el('span', { class: 'cm-chip' }, CATEGORY_LABEL[d.category] || d.category),
      el('span', { style: { color: 'var(--cm-textDim)', fontSize: '12px' } }, `무게 ${d.weight} · 비용 ${d.cost}`));
    if (hasMorphJoint(v.tree) && n.parent) {
      for (const [f, label] of [['both', '공통'], ['A', 'A만'], ['B', 'B만']]) {
        const cur = current.parts.find((p) => p.uid === selected)?.form || 'both';
        selBar.append(el('button', { type: 'button', class: `cm-tab${cur === f ? ' on' : ''}`, onClick: () => { commit(setPartForm(current, selected, f)); } }, label));
      }
    }
    if (n.parent) {
      const sub = n.children.length;
      selBar.append(el('button', { class: 'cm-btn danger', type: 'button', onClick: () => doDetach(selected) }, sub ? `분리 (아래 ${sub}개 포함)` : '분리'));
    }
    selBar.append(el('button', { class: 'cm-btn', type: 'button', onClick: () => { selected = null; renderSelBar(); } }, '닫기'));
  }

  function focusPart(uid) {
    if (!v?.tree.nodes.has(uid)) return;
    selected = uid;
    renderSelBar();
    const w = partWorld(uid);
    if (w) scene.focus?.(w);
    view?.flashPart(uid, '#4DE1FF');
    showTab('stats');
  }

  // ── 불러오기 메뉴 ──
  let menu = null;
  function closeMenu() { menu?.remove(); menu = null; }
  function openMenu(anchor) {
    if (menu) { closeMenu(); return; }
    const r = anchor.getBoundingClientRect();
    menu = el('div', { class: 'cm-panel cm-menu', style: { left: `${r.left}px`, bottom: `${window.innerHeight - r.top + 6}px` } });
    const add = (label, small, fn) => menu.append(el('button', { type: 'button', onClick: () => { closeMenu(); fn(); } }, label, small ? el('small', {}, small) : null));
    add('＋ 새 기체', '코어만 있는 빈 기체', () => loadDesign(emptyDesign('core1', '새 기체')));
    if (library.mine.length) {
      menu.append(el('h4', {}, '내 기체'));
      for (const m of library.mine) add(m.name || '이름 없음', null, () => loadDesign(m.design));
    }
    menu.append(el('h4', {}, '원형 설계도'));
    for (const p of presets) add(p.name, `무게 ${p.expected?.weight ?? ''}`, () => loadDesign(p));
    document.body.append(menu);
    setTimeout(() => document.addEventListener('pointerdown', outside, { once: true, capture: true }), 0);
    function outside(e) { if (menu && !menu.contains(e.target) && e.target !== anchor) closeMenu(); else if (menu) document.addEventListener('pointerdown', outside, { once: true, capture: true }); }
  }
  function loadDesign(d) {
    selected = null;
    held = null;
    palette.setSelected(null);
    commit(clone(d));
    pilotUI.setPilot(current.pilot);
    savedHash = designHash(current);
    recompute(true);
    play('ui_whoosh');
    scene.pulseCore?.();
  }

  function save() {
    if (!v.saveable) { flashHint(mid, '구조에 문제가 있어 저장할 수 없습니다'); play('ui_error'); return; }
    onSave(normalizeDesign(current), v);
  }

  // ── 캔버스 입력: 눌러서 붙이기 / 파츠 선택 ──
  let down = null;
  const onDown = (e) => { if (wrap.style.display === 'none') return; down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onUp = (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 600;
    down = null;
    if (moved > 6 || !quick) return;
    if (held) {
      const m = nearestMarker(e.clientX, e.clientY, 60);
      if (m) doAttach(held, m.slot);
      else flashHint(mid, '연결점(●)을 눌러 주세요');
      return;
    }
    const uid = nearestPart(e.clientX, e.clientY);
    selected = uid;
    if (uid) { view?.flashPart(uid, '#4DE1FF'); play('part_pick'); }
    renderSelBar();
  };
  const onMove = (e) => { if (wrap.style.display === 'none') return; if (held && markers.length) hover(nearestMarker(e.clientX, e.clientY, 60)); };
  canvas.addEventListener('pointerdown', onDown);
  canvas.addEventListener('pointerup', onUp);
  canvas.addEventListener('pointermove', onMove);

  const onKey = (e) => {
    if (wrap.style.display === 'none') return; // 다른 공간에 있을 때는 단축키를 받지 않는다
    const tag = (e.target?.tagName || '').toLowerCase();
    if (tag === 'input' || tag === 'textarea' || tag === 'select') return;
    const mod = e.ctrlKey || e.metaKey;
    if (e.key === 'Escape') { if (held) { palette.setSelected(null); setHeld(null, false); } else { selected = null; renderSelBar(); } closeMenu(); }
    else if ((e.key === 'Delete' || e.key === 'Backspace') && selected) { e.preventDefault(); doDetach(selected); }
    else if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
    else if (mod && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
    else if (mod && e.key.toLowerCase() === 's') { e.preventDefault(); save(); }
  };
  window.addEventListener('keydown', onKey);

  // ── 연결점 맥동, 선택·겹침 깜빡임 ──
  let last = performance.now();
  function loop(now) {
    if (dead) return;
    raf = requestAnimationFrame(loop);
    const t = now / 1000;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    for (const m of markers) {
      const isHover = m === hoverMarker;
      const k = 1 + Math.sin(t * 5 + m.local.x) * 0.12 + (isHover ? 0.7 : 0);
      m.mesh.scale.setScalar(k);
      m.ring.scale.setScalar(k * (1 + (isHover ? 0.2 : 0)));
      m.ring.lookAt(camera.position);
      m.mesh.material.opacity = held ? (isHover ? 1 : 0.8 + Math.sin(t * 5) * 0.15) : 0.4;
    }
    overlapTick += dt;
    if (overlapTick > 0.55 && view) {
      overlapTick = 0;
      for (const o of v?.layout?.overlaps || []) { view.flashPart(o.a, '#FF2D2D'); view.flashPart(o.b, '#FF2D2D'); } // 겹침: 빨간색
      if (selected) view.flashPart(selected, '#4DE1FF');
    }
  }
  raf = requestAnimationFrame(loop);

  recompute(true);

  const api = {
    el: wrap,
    get validation() { return v; },
    getDesign: () => normalizeDesign(current),
    setDesign: (d, { saved = true } = {}) => { loadDesign(d); if (saved) { savedHash = designHash(current); recompute(false); } },
    setLibrary(lib) { library = { mine: lib?.mine || [] }; },
    markSaved() { savedHash = designHash(current); recompute(false); flashHint(mid, '저장했습니다', 1600); play('ui_save'); },
    focusPart,
    undo, redo,
    _debugMarkers() { workbench.updateWorldMatrix(true, true); return markers.map((m) => ({ id: m.slot.id, size: m.slot.size, ...project(m.mesh.getWorldPosition(new THREE.Vector3())) })); },
    get form() { return form; },
    destroy() {
      dead = true;
      cancelAnimationFrame(raf);
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      canvas.removeEventListener('pointermove', onMove);
      window.removeEventListener('keydown', onKey);
      closeMenu();
      clearMarkers();
      workbench.remove(markerRoot);
      sphereGeo.dispose();
      ringGeo.dispose();
      if (view) { workbench.remove(view.group); view.dispose?.(); }
      palette.destroy();
      stats.destroy();
      pilotUI.destroy();
      wrap.remove();
    },
  };
  return api;
}

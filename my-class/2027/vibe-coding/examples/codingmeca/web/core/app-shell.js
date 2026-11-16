// web/core/app-shell.js  (45번)
// 모든 페이지의 공통 뼈대. 3D 배경(캔버스) + 그 위 HTML 인터페이스 레이어를 묶어 준다. (명세 14-1)
//   · 렌더러·후처리·화질·오디오·스토어·라우터를 만들어 연결
//   · '입장' 버튼(첫 입장 때 오디오 잠금 해제) → 공간 앰비언트 시작
//   · 공간(장면) 등록·전환(암전 연출 + 전환음 + 앰비언트 교체)
//   · 캔버스 드래그·휠·핀치를 현재 장면에 전달(배경 카메라 오빗) — 인터페이스 레이어가 먼저 입력을 받는다
//   · 설정 패널(화질·음량), 알림(토스트), 버튼 효과음 자동 연결
//
// 사용 (각 페이지의 main.js)
//   const shell = createAppShell({ canvas, uiRoot, spaceId: 'hangar' });
//   shell.registerScene('hangar', (ctx) => ({ mount(){}, unmount(){}, update(dt,t){}, onDrag(dx,dy){}, onWheel(dy){} }));
//   await shell.start();            // 렌더 시작(입장 화면 뒤에서 배경이 이미 돈다)
//   await shell.whenEntered;        // 사용자가 '입장'을 누르면 이행
//
// 장면 팩토리의 인자: { shell, THREE, renderer, scene, camera, audio, store, postfx, quality }

import * as THREE from 'three';
import { createRenderer } from '../render/renderer.js';
import { createPostfx } from '../render/effects/postfx.js';
import { createQualityManager, QUALITY_MODES } from './quality.js';
import { createAudioEngine } from './audio-engine.js';
import { createAppStore } from './store.js';
import { createRouter } from './router.js';
import { toCssVars, UI, resolveSpace } from '../../config/theme.js';
import { NAMES, SHELL_TEXT } from '../../config/names.js';

// 공간별 앰비언트 이벤트(config/sound-manifest.js)
export const SPACE_AMBIENT = Object.freeze({
  hangar: 'amb_hangar',
  tacticsLab: 'amb_lab',
  range: 'amb_range',
  arena: 'amb_arena',
  command: 'amb_command',
});

const SHELL_CSS = `
.cm-ui{position:fixed;inset:0;pointer-events:none;font-family:var(--cm-font);color:var(--cm-text);z-index:10}
.cm-ui .cm-panel,.cm-ui button,.cm-ui input,.cm-ui select,.cm-ui a,.cm-ui [data-ui]{pointer-events:auto}
.cm-ui button{font-family:inherit;cursor:pointer}
.cm-fade{position:fixed;inset:0;background:var(--cm-bg);opacity:0;pointer-events:none;z-index:40;transition:opacity var(--cm-ms,220ms) ease}
.cm-fade.on{opacity:1;pointer-events:auto}
.cm-enter{position:fixed;inset:0;z-index:50;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:18px;
  background:radial-gradient(ellipse at center,rgba(0,0,0,.25),rgba(0,0,0,.72));backdrop-filter:blur(2px);pointer-events:auto;transition:opacity .5s ease}
.cm-enter.out{opacity:0;pointer-events:none}
.cm-enter h1{margin:0;font-size:clamp(34px,7vw,72px);letter-spacing:.08em;color:var(--cm-primary);text-shadow:0 0 28px var(--cm-primary)}
.cm-enter .cm-space{font-size:15px;color:var(--cm-textDim);letter-spacing:.3em}
.cm-enter button{padding:14px 54px;font-size:20px;border-radius:var(--cm-radius);border:2px solid var(--cm-primary);background:rgba(0,0,0,.35);color:var(--cm-primary);transition:all .2s}
.cm-enter button:hover{background:var(--cm-primary);color:var(--cm-bg);box-shadow:0 0 24px var(--cm-primary)}
.cm-enter .cm-hint{font-size:13px;color:var(--cm-textDim)}
.cm-gear{position:fixed;top:12px;right:12px;width:38px;height:38px;border-radius:50%;border:1px solid var(--cm-panelEdge);background:rgba(0,0,0,.45);color:var(--cm-text);font-size:18px;z-index:30}
.cm-settings{position:fixed;top:58px;right:12px;width:min(280px,calc(100vw - 24px));padding:14px;border-radius:var(--cm-radius);z-index:30;
  background:color-mix(in srgb,var(--cm-panel) calc(var(--cm-panel-opacity)*100%),transparent);border:1px solid var(--cm-panelEdge);display:none}
.cm-settings.open{display:block}
.cm-settings h3{margin:0 0 10px;font-size:15px}
.cm-settings .row{margin:12px 0}
.cm-settings label{display:block;font-size:13px;color:var(--cm-textDim);margin-bottom:6px}
.cm-seg{display:flex;gap:4px}
.cm-seg button{flex:1;padding:6px 0;font-size:13px;border-radius:6px;border:1px solid var(--cm-panelEdge);background:transparent;color:var(--cm-text)}
.cm-seg button.on{background:var(--cm-primary);color:var(--cm-bg);border-color:var(--cm-primary)}
.cm-settings input[type=range]{width:100%}
.cm-settings .note{font-size:12px;color:var(--cm-textDim);margin-top:4px}
.cm-toasts{position:fixed;left:50%;bottom:22px;transform:translateX(-50%);display:flex;flex-direction:column;gap:8px;align-items:center;z-index:45;pointer-events:none}
.cm-toast{padding:10px 18px;border-radius:var(--cm-radius);background:rgba(10,12,16,.88);border:1px solid var(--cm-panelEdge);font-size:14px;animation:cm-in .2s ease}
.cm-toast.error{border-color:var(--cm-danger);color:var(--cm-danger)}
@keyframes cm-in{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
`;

function el(tag, props = {}, ...kids) {
  const e = document.createElement(tag);
  for (const [k, v] of Object.entries(props)) {
    if (k === 'class') e.className = v;
    else if (k.startsWith('on')) e.addEventListener(k.slice(2).toLowerCase(), v);
    else if (v !== false && v != null) e.setAttribute(k, v === true ? '' : v);
  }
  for (const c of kids.flat()) if (c != null) e.append(c.nodeType ? c : document.createTextNode(String(c)));
  return e;
}

export function createAppShell({
  canvas,
  uiRoot,
  spaceId = 'hangar',
  rendererOptions = {},
  store = createAppStore(),
  audio = null,
  router = null,
  usePostfx = true,
} = {}) {
  if (!canvas || !uiRoot) throw new Error('createAppShell: canvas와 uiRoot가 필요합니다');
  uiRoot.classList.add('cm-ui');

  const audioEngine = audio || createAudioEngine({
    settings: store.get('settings.audio'),
    onSettingsChange: (s) => store.set('settings.audio', s),
  });
  const rt = router || createRouter({ store });

  let renderer = null;
  let postfx = null;
  let quality = null;
  const factories = new Map();
  const scenes = new Map(); // spaceId → 장면 객체
  let active = null;
  let activeId = null;
  let switching = false;
  const cleanups = [];

  let resolveEntered;
  const whenEntered = new Promise((r) => { resolveEntered = r; });

  // ── 스타일·색 ──
  function applyTheme(id) {
    const vars = toCssVars(id);
    for (const [k, v] of Object.entries(vars)) document.documentElement.style.setProperty(k, v);
    document.documentElement.style.setProperty('--cm-ms', `${UI.transitionMs}ms`);
    document.body.style.background = resolveSpace(id).palette.bg;
    document.title = `${NAMES.title} · ${NAMES[id] || ''}`.replace(/ · $/, '');
  }

  // ── 알림 ──
  let toasts = null;
  function toast(text, kind = 'info', ms = 3200) {
    if (!toasts) { toasts = el('div', { class: 'cm-toasts' }); document.body.append(toasts); }
    const t = el('div', { class: `cm-toast ${kind}` }, text);
    toasts.append(t);
    if (kind === 'error') audioEngine.play('ui_error');
    setTimeout(() => t.remove(), ms);
  }

  // ── 암전 전환 ──
  const fade = el('div', { class: 'cm-fade' });
  const fadeTo = (on) => new Promise((r) => {
    fade.classList.toggle('on', on);
    setTimeout(r, UI.transitionMs + 30);
  });

  // ── 공간 등록·전환 ──
  function registerScene(id, factory) { factories.set(id, factory); }

  function ctxFor() {
    return { shell: api, THREE, renderer, scene: renderer.scene, camera: renderer.camera, audio: audioEngine, store, postfx, quality };
  }

  async function switchSpace(id, { instant = false } = {}) {
    if (switching || id === activeId || !renderer) return false;
    const make = factories.get(id);
    if (!make) { console.warn(`등록되지 않은 공간: ${id}`); return false; }
    switching = true;
    try {
      if (activeId && !instant) { audioEngine.play('ui_space_change'); await fadeTo(true); }
      if (active) { active.unmount?.(); }
      if (!scenes.has(id)) scenes.set(id, make(ctxFor()) || {});
      active = scenes.get(id);
      activeId = id;
      renderer.setSpace(id);
      applyTheme(id);
      postfx?.setSpace?.(id);
      active.mount?.();
      audioEngine.setAmbient(store.get('ui.entered') ? SPACE_AMBIENT[id] || null : null);
      rt.toSpace(id);
      if (!instant) await fadeTo(false);
      return true;
    } finally {
      switching = false;
    }
  }

  // ── 입장 화면 ──
  function buildEnterOverlay() {
    const btn = el('button', { type: 'button' }, SHELL_TEXT.enter);
    const ov = el('div', { class: 'cm-enter' },
      el('div', { class: 'cm-space' }, (NAMES[activeId || spaceId] || '').split('').join(' ')),
      el('h1', {}, NAMES.title),
      btn,
      el('div', { class: 'cm-hint' }, SHELL_TEXT.enterHint));
    const go = async () => {
      btn.disabled = true;
      await audioEngine.unlock();
      audioEngine.preload().catch(() => {});
      audioEngine.play('ui_enter');
      store.set('ui.entered', true);
      audioEngine.setAmbient(SPACE_AMBIENT[activeId] || null);
      ov.classList.add('out');
      setTimeout(() => ov.remove(), 600);
      resolveEntered(true);
    };
    btn.addEventListener('click', go);
    uiRoot.append(ov);
    return ov;
  }

  // ── 설정 패널 ──
  function buildSettings() {
    const gear = el('button', { class: 'cm-gear', type: 'button', title: SHELL_TEXT.settings, 'aria-label': SHELL_TEXT.settings }, '⚙');
    const qLabel = { auto: SHELL_TEXT.qualityAuto, high: SHELL_TEXT.qualityHigh, mid: SHELL_TEXT.qualityMid, low: SHELL_TEXT.qualityLow };
    const seg = el('div', { class: 'cm-seg' });
    const refreshSeg = () => seg.querySelectorAll('button').forEach((b) => b.classList.toggle('on', b.dataset.q === quality.mode));
    for (const m of QUALITY_MODES) {
      seg.append(el('button', { type: 'button', 'data-q': m, onClick: () => { quality.setMode(m); refreshSeg(); } }, qLabel[m]));
    }
    const vol = el('input', { type: 'range', min: 0, max: 1, step: 0.01, value: audioEngine.getSettings().master, 'aria-label': SHELL_TEXT.volumeMaster });
    vol.addEventListener('input', () => audioEngine.setMasterVolume(Number(vol.value)));
    const mute = el('input', { type: 'checkbox', id: 'cm-mute' });
    mute.checked = audioEngine.getSettings().muted;
    mute.addEventListener('change', () => audioEngine.setMuted(mute.checked));

    const panel = el('div', { class: 'cm-settings cm-panel' },
      el('h3', {}, SHELL_TEXT.settings),
      el('div', { class: 'row' }, el('label', {}, SHELL_TEXT.quality), seg, el('div', { class: 'note' }, SHELL_TEXT.qualityAutoNote)),
      el('div', { class: 'row' }, el('label', {}, SHELL_TEXT.volumeMaster), vol),
      el('div', { class: 'row' }, el('label', { for: 'cm-mute' }, mute, ' ', SHELL_TEXT.mute)));
    gear.addEventListener('click', () => { panel.classList.toggle('open'); refreshSeg(); });
    refreshSeg();
    uiRoot.append(gear, panel);
    cleanups.push(quality.onChange(refreshSeg));
  }

  // ── 입력: 인터페이스가 먼저, 남는 것은 배경 오빗으로 ──
  function bindCanvasInput() {
    const pts = new Map();
    let lastPinch = 0;
    const down = (e) => { canvas.setPointerCapture?.(e.pointerId); pts.set(e.pointerId, { x: e.clientX, y: e.clientY }); lastPinch = 0; };
    const move = (e) => {
      const p = pts.get(e.pointerId);
      if (!p) return;
      const dx = e.clientX - p.x;
      const dy = e.clientY - p.y;
      p.x = e.clientX; p.y = e.clientY;
      if (pts.size === 1) active?.onDrag?.(dx, dy, e);
      else if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        const d = Math.hypot(a.x - b.x, a.y - b.y);
        if (lastPinch) active?.onWheel?.((lastPinch - d) * 2);
        lastPinch = d;
      }
    };
    const up = (e) => { pts.delete(e.pointerId); lastPinch = 0; };
    const wheel = (e) => { e.preventDefault(); active?.onWheel?.(e.deltaY, e); };
    canvas.style.touchAction = 'none';
    canvas.addEventListener('pointerdown', down);
    canvas.addEventListener('pointermove', move);
    canvas.addEventListener('pointerup', up);
    canvas.addEventListener('pointercancel', up);
    canvas.addEventListener('wheel', wheel, { passive: false });
  }

  // 버튼 효과음 자동 연결: data-sfx="이벤트ID"로 바꾸거나 "none"으로 끌 수 있다
  function bindUiSounds() {
    const pick = (e) => e.target.closest?.('button,[data-sfx]');
    const onClick = (e) => {
      const t = pick(e);
      if (!t || t.disabled) return;
      const id = t.dataset.sfx;
      if (id === 'none') return;
      audioEngine.play(id || 'ui_click');
    };
    const onOver = (e) => {
      const t = pick(e);
      if (!t || e.pointerType === 'touch' || t.dataset.sfx === 'none' || t.contains(e.relatedTarget)) return;
      audioEngine.play('ui_hover');
    };
    document.addEventListener('click', onClick);
    document.addEventListener('pointerover', onOver);
    cleanups.push(() => { document.removeEventListener('click', onClick); document.removeEventListener('pointerover', onOver); });
  }

  // ── 시작 ──
  async function start() {
    const style = el('style', {}, SHELL_CSS);
    document.head.append(style);
    cleanups.push(() => style.remove());
    document.body.append(fade);
    applyTheme(spaceId);

    if (!rt.guard()) return false; // 권한이 없으면 안내 후 다른 페이지로 이동

    renderer = createRenderer({ canvas, space: spaceId, quality: 'high', autoQuality: true, ...rendererOptions });
    if (usePostfx) { try { postfx = createPostfx(renderer); } catch (e) { console.warn('후처리를 쓸 수 없어 건너뜁니다', e); } }
    quality = createQualityManager({ renderer, postfx, store });
    cleanups.push(renderer.onFrame((dt, t) => active?.update?.(dt, t)));

    bindCanvasInput();
    bindUiSounds();
    buildSettings();

    // 연결 상태 알림(한 번 연결됐다가 끊길 때만)
    let wasOnline = false;
    cleanups.push(store.on('ui.connection', (c) => {
      if (c === 'online') { if (wasOnline === 'dropped') toast(SHELL_TEXT.online); wasOnline = true; }
      else if (c === 'offline' && wasOnline === true) { wasOnline = 'dropped'; toast(SHELL_TEXT.offline, 'error', 5000); }
    }));

    const first = rt.current.space || spaceId;
    if (factories.has(first)) await switchSpace(first, { instant: true });
    else if (factories.has(spaceId)) await switchSpace(spaceId, { instant: true });
    renderer.start();

    // 페이지를 옮길 때마다 입장 화면을 다시 보여 준다(브라우저가 페이지마다 오디오를 잠그기 때문)
    buildEnterOverlay();
    return true;
  }

  function dispose() {
    cleanups.splice(0).forEach((fn) => { try { fn(); } catch { /* ignore */ } });
    for (const s of scenes.values()) s.unmount?.(), s.dispose?.();
    audioEngine.stopAll();
    postfx?.dispose?.();
    quality?.dispose?.();
    renderer?.dispose?.();
    store.flush?.();
  }

  const api = {
    start, dispose, registerScene, switchSpace, toast, whenEntered,
    store, router: rt, audio: audioEngine,
    get renderer() { return renderer; },
    get postfx() { return postfx; },
    get quality() { return quality; },
    get space() { return activeId; },
    get scene() { return active; },
  };
  return api;
}

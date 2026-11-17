// web/core/manual-input.js
// 수동 조종 입력: 키보드·마우스를 '조종 입력(raw)'으로 바꾼다. 화면(three)을 모른다 — 시점은 호출한 쪽이 aim 값으로 그린다.
//
//   const inp = createManualInput({ target: canvas });
//   inp.enable(heading)            // 입력 받기 시작(현재 기체 방향에서 조준 시작)
//   inp.disable()
//   const raw = inp.sample(dt)     // → { throttle, aim, pitch, hold:{...}, once:[...] }  (once 는 이번 샘플에 새로 눌린 것만)
//
// 조작(기본값)
//   이동  W/↑ 전진 · S/↓ 후진       회전  A/← · D/→ (또는 마우스 좌우)      조준  마우스(클릭하면 포인터 잠금)
//   공격  좌클릭 / Space(누르는 동안)      각성(오버드라이브)  우클릭 / Shift(누르는 동안)
//   방어  Ctrl 방어막 · Alt 요격 · R 수리(누르는 동안)
//   특수  Q 위상 이동 · E 각성기 1 · F 각성기 2 · T 변신 · G 분리 · X 고도 올리기 · Z 고도 내리기 · C 겨냥 바꾸기 · V 겨냥 풀기
// 조종 중에는 브라우저의 Ctrl·Alt·Space 기본 동작을 막는다(입력 칸에 글을 쓰는 중이면 건드리지 않는다).

export const KEY_MAP = Object.freeze({
  forward: ['KeyW', 'ArrowUp'], back: ['KeyS', 'ArrowDown'], left: ['KeyA', 'ArrowLeft'], right: ['KeyD', 'ArrowRight'],
  fire: ['Space'], overdrive: ['ShiftLeft', 'ShiftRight'],
  shield: ['ControlLeft', 'ControlRight'], intercept: ['AltLeft', 'AltRight'], repair: ['KeyR'],
});
export const ONCE_KEYS = Object.freeze({ KeyQ: 'phase', KeyE: 'skill1', KeyF: 'skill2', KeyT: 'transform', KeyG: 'detach', KeyX: 'altUp', KeyZ: 'altDown', KeyC: 'lock', KeyV: 'unlock' });

export const HELP_ROWS = Object.freeze([
  ['이동', 'W/S 또는 ↑/↓'], ['회전', 'A/D 또는 ←/→ · 마우스'], ['공격', '좌클릭 · Space'], ['각성', '우클릭 · Shift'],
  ['방어막', 'Ctrl'], ['요격', 'Alt'], ['수리', 'R'], ['위상 이동', 'Q'], ['각성기 1·2', 'E · F'], ['변신 · 분리', 'T · G'], ['고도 ↑↓', 'X · Z'], ['겨냥 바꾸기·풀기', 'C · V'],
]);

const TAU = Math.PI * 2;
const wrap = (a) => { a %= TAU; if (a > Math.PI) a -= TAU; if (a < -Math.PI) a += TAU; return a; };
const typing = (t) => t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable);

export function createManualInput({ target = document.body, sensitivity = 0.0032, turnRate = 2.4 } = {}) {
  let on = false;
  let aim = 0;
  let pitch = 0.18;
  const down = new Set();
  const mouse = { l: false, r: false };
  let pending = [];
  let sens = sensitivity;

  const any = (codes) => codes.some((c) => down.has(c));
  const isMine = (code) => Object.values(KEY_MAP).some((l) => l.includes(code)) || code in ONCE_KEYS;

  function onKeyDown(ev) {
    if (!on || typing(ev.target)) return;
    if (isMine(ev.code)) ev.preventDefault();
    if (ev.repeat) return;
    down.add(ev.code);
    const once = ONCE_KEYS[ev.code];
    if (once) pending.push(once);
  }
  function onKeyUp(ev) {
    if (!on) return;
    if (isMine(ev.code)) ev.preventDefault(); // Alt 를 뗄 때 메뉴가 열리지 않게
    down.delete(ev.code);
  }
  function onMouseMove(ev) {
    if (!on) return;
    const locked = document.pointerLockElement === target;
    if (!locked && !(ev.buttons & 3)) return; // 잠금이 아니면 버튼을 누른 채 움직일 때만 조준
    aim = wrap(aim - ev.movementX * sens);
    pitch = Math.min(0.7, Math.max(-0.15, pitch + ev.movementY * sens * 0.7));
  }
  function onMouseDown(ev) {
    if (!on || ev.target !== target) return;
    if (document.pointerLockElement !== target) target.requestPointerLock?.();
    if (ev.button === 0) mouse.l = true;
    if (ev.button === 2) mouse.r = true;
    if (ev.button === 1) { pending.push('lock'); ev.preventDefault(); }
  }
  function onMouseUp(ev) { if (ev.button === 0) mouse.l = false; if (ev.button === 2) mouse.r = false; }
  const noMenu = (ev) => { if (on) ev.preventDefault(); };
  function onBlur() { down.clear(); mouse.l = false; mouse.r = false; }

  const api = {
    get enabled() { return on; },
    get aim() { return aim; },
    get pitch() { return pitch; },
    get locked() { return document.pointerLockElement === target; },
    setSensitivity(v) { sens = Math.min(0.01, Math.max(0.0008, v)); },
    enable(heading = 0) {
      if (on) return;
      on = true; aim = wrap(heading); down.clear(); pending = []; mouse.l = mouse.r = false;
      addEventListener('keydown', onKeyDown, true);
      addEventListener('keyup', onKeyUp, true);
      addEventListener('mousemove', onMouseMove);
      addEventListener('mousedown', onMouseDown);
      addEventListener('mouseup', onMouseUp);
      addEventListener('contextmenu', noMenu);
      addEventListener('blur', onBlur);
      // 가능하면 브라우저가 가로채는 키(전체 화면에서 Ctrl·Alt 조합 등)를 이 페이지가 받도록 요청한다. 실패해도 괜찮다.
      try { navigator.keyboard?.lock?.(['ControlLeft', 'ControlRight', 'AltLeft', 'AltRight', 'Space', 'KeyW', 'KeyQ', 'KeyR', 'KeyT']).catch(() => {}); } catch { /* 지원하지 않는 브라우저 */ }
    },
    disable() {
      if (!on) return;
      on = false; down.clear(); pending = []; mouse.l = mouse.r = false;
      removeEventListener('keydown', onKeyDown, true);
      removeEventListener('keyup', onKeyUp, true);
      removeEventListener('mousemove', onMouseMove);
      removeEventListener('mousedown', onMouseDown);
      removeEventListener('mouseup', onMouseUp);
      removeEventListener('contextmenu', noMenu);
      removeEventListener('blur', onBlur);
      if (document.pointerLockElement === target) document.exitPointerLock?.();
      try { navigator.keyboard?.unlock?.(); } catch { /* 무시 */ }
    },
    requestLock() { target.requestPointerLock?.(); },
    /** 지금 입력 상태. once 는 한 번 꺼내면 비워진다. */
    sample(dt = 1 / 60) {
      const turn = (any(KEY_MAP.left) ? 1 : 0) - (any(KEY_MAP.right) ? 1 : 0); // 왼쪽 +, 오른쪽 −  (heading 규약)
      if (turn) aim = wrap(aim + turn * turnRate * dt);
      const raw = {
        throttle: (any(KEY_MAP.forward) ? 1 : 0) - (any(KEY_MAP.back) ? 1 : 0),
        aim, pitch,
        hold: {
          fire: mouse.l || any(KEY_MAP.fire), overdrive: mouse.r || any(KEY_MAP.overdrive),
          shield: any(KEY_MAP.shield), intercept: any(KEY_MAP.intercept), repair: any(KEY_MAP.repair),
        },
        once: pending,
      };
      pending = [];
      return raw;
    },
    /** 화면 단추(터치·마우스)에서 한 번 동작을 넣을 때 */
    press(name) { if (on) pending.push(name); },
    dispose() { api.disable(); },
  };
  return api;
}

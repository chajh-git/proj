// web/core/manual-pilot.js
// 직접 조종 한 판의 조립: 입력(manual-input) ↔ 시점(arena.setCameraMode/setPilotAim) ↔ 화면 조각(manual-hud) ↔ 전달 방식(send).
// 시험 사격장은 send 가 내 컴퓨터의 시뮬레이션에 바로 넣고, 리그 경기·연습전은 서버로 보낸다(서버가 값을 다시 검사한다).
//
//   const pilot = createManualPilot({ arena, canvas, uiRoot, send(raw), sendEveryMs: 0|50 });
//   pilot.start({ id:'A1', heading })     pilot.frame(dt, snap)     pilot.stop()     pilot.active
import { createManualInput } from './manual-input.js';
import { createManualHud } from '../ui/manual-hud.js';

export function createManualPilot({ arena, canvas, uiRoot, send, sendEveryMs = 0, onStop = () => {}, firstView = 'shoulder' }) {
  const input = createManualInput({ target: canvas });
  let id = null;
  let view = firstView;
  let acc = 0;
  let once = [];
  let lastRaw = null;
  let dead = false;

  const setView = (v) => {
    view = v;
    hud.setView(v);
    arena.setCameraMode(v, v === 'shoulder' || v === 'follow' ? { id, yaw: input.aim } : undefined);
  };
  const hud = createManualHud({ root: uiRoot, onView: (v) => setView(v), onExit: () => api.stop() });

  const api = {
    get active() { return id !== null; },
    get id() { return id; },
    get view() { return view; },
    start({ id: entId, heading = 0 }) {
      id = entId; dead = false; acc = 0; once = [];
      input.enable(heading);
      hud.show(true);
      hud.setNote('');
      setView(firstView);
    },
    /** 매 화면 프레임. snap 은 지금 보여 주는 스냅샷(ents 포함). */
    frame(dt, snap) {
      if (id === null) return;
      const me = snap?.ents?.find((e) => e.id === id);
      if (me && (me.a === 0 || me.alive === false) && !dead) { dead = true; hud.setNote('기체가 격파되었습니다', true); }
      const raw = input.sample(dt);
      lastRaw = raw;
      if (view === 'shoulder') arena.setPilotAim?.(raw.aim, raw.pitch);
      hud.setHold(raw.hold);
      once.push(...raw.once);
      acc += dt * 1000;
      if (acc >= sendEveryMs) {
        acc = 0;
        send({ throttle: raw.throttle, aim: raw.aim, hold: raw.hold, once: once.splice(0, once.length) });
      }
    },
    note(text, warn) { hud.setNote(text, warn); },
    stop() {
      if (id === null) return;
      id = null;
      input.disable();
      hud.show(false);
      onStop();
    },
    dispose() { api.stop(); hud.dispose(); },
    get lastInput() { return lastRaw; },
  };
  return api;
}

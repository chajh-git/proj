// web/cinematics/transform-cinematic.js  (98번)
// 변신 연출 두 가지.
//   awaken(msg)  서버 연출 알림(kind:'transform', 각성 변신): 전체 정지 상태에서 기체 한 기에 집중 — 오라 → 파츠 접힘·펼침 → 충격파 → 자막
//   basic(ev)    경기 중 기본 변신 사건(형태 A↔B): 시뮬레이션은 멈추지 않으므로 짧게 — 빛 줄기와 기어 소리, 살짝 카메라 집중
// 파츠가 접히고 펼쳐지는 모습 자체는 기체 뷰가 형태(form) 값으로 그린다. 여기서는 그 둘레의 빛·소리·카메라만 맡는다.

import { NAMES } from '../../config/names.js';
import { EFFECT_COLORS } from '../../config/theme.js';

export function createTransformCinematic(env) {
  const V = (x, y, z) => new env.THREE.Vector3(x, y, z);

  function awaken(msg) {
    const secs = Math.max(2, msg.seconds || 6);
    const id = (msg.members || [])[0];
    const color = env.color(msg.team ?? env.teamOf(id));
    const state = { stopped: false, title: null, sub: null, count: null };
    let t = 0;
    let beat = 0;
    const q0 = env.pos(id) || { x: 0, y: 1.2, z: 0 };

    env.bars(true);
    env.dimTo(0.6);
    env.tintTo(color, 0.3);
    env.director.focus({ id, seconds: secs + 0.5, distance: 7.5 });
    env.play('slowmo_in', 0.7);

    const frame = (dt) => {
      if (state.stopped) return false;
      t += dt;
      const q = env.pos(id) || q0;
      const k = t / secs;
      // 오라: 발밑에서 위로 솟는 빛 + 주기적인 고리
      for (let i = 0; i < 3; i++) env.particles.glow(V(q.x + (Math.random() - 0.5) * 1.8, q.y - 0.8 + Math.random() * 2.6, q.z + (Math.random() - 0.5) * 1.8), i % 2 ? color : EFFECT_COLORS.fusion, 0.5, 0.8);
      if (t >= beat) { beat += 0.55; env.particles.ring(V(q.x, 0.2, q.z), color, 1.5 + k * 3.5, 32, 0.2 + k * 2); env.play('transform', 0.3); }
      if (k > 0.55 && !state.fired) {
        state.fired = true;
        env.flashNow('#fff4d6', 600);
        env.postfx?.pulse?.('overdrive');
        env.dimTo(0.15);
        env.particles.explosion(V(q.x, 1.4, q.z), 2.2, color);
        env.particles.ring(V(q.x, 0.2, q.z), EFFECT_COLORS.fusion, 6, 60);
        env.play('fusion_shockwave', 0.8);
      }
      if (k > 0.68 && !state.title) {
        env.play('fusion_title', 0.7);
        state.title = env.node('cn-title', msg.name ? msg.name : NAMES.transform);
        state.sub = env.node('cn-sub', env.nameOf(id));
        requestAnimationFrame(() => { state.title.classList.add('on'); state.sub.classList.add('on'); });
      }
      return true;
    };
    const off = env.frame(frame);

    return {
      resume(m2) {
        const n = Math.max(1, Math.round(m2?.seconds || msg.resumeSeconds || 3));
        env.dimTo(0);
        state.title?.classList.remove('on'); state.sub?.classList.remove('on');
        for (let i = 0; i < n; i++) env.later(i, () => { if (state.stopped) return; state.count?.remove(); state.count = env.node('cn-count pop', String(n - i)); });
      },
      stop() { state.stopped = true; off(); for (const n of [state.title, state.sub, state.count]) n?.remove(); env.bars(false); env.dimTo(0); env.tintTo(null, 0); },
    };
  }

  function basic(ev) {
    const q = env.pos(ev.entity);
    if (!q) return;
    const color = env.color(env.teamOf(ev.entity));
    env.particles.ring(V(q.x, 0.2, q.z), color, 2.6, 36, 0.3);
    env.particles.ring(V(q.x, 1.4, q.z), '#FFFFFF', 1.8, 24, 1.4);
    env.particles.sparks(V(q.x, 1.2, q.z), color, 14, 7);
    env.director.focus({ id: ev.entity, seconds: 0.9, distance: 8 });
    env.node('cn-tag', `${NAMES.transform} · ${env.nameOf(ev.entity)}`).style.setProperty('--c', color);
  }

  return { awaken, basic };
}

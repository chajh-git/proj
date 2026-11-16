// web/cinematics/fusion-cinematic.js  (97번)
// 융합 연출(공통 템플릿, 서버 고정 길이 8초). 명세 19장:
//   전체 정지 → 암전·줌 → 파츠 빛 입자 분해 → 중앙 소용돌이 → 재조립 → 충격파·글리프·타이틀 자막 → 재개 카운트
// 시간표는 서버가 알려 준 길이(seconds)에 비례해 나눈다. 서버는 고정 시간 뒤 알아서 재개한다(클라이언트 응답 없음).
//   start(msg) → { resume(msg), stop() }     release(ev): 융합이 풀릴 때의 작은 연출
// 숨은 레시피의 이름은 도감 공개 전에는 오지 않는다(msg.name === null) — 그때는 '융합'만 보여 준다.

import { NAMES } from '../../config/names.js';
import { EFFECT_COLORS } from '../../config/theme.js';

const PHASES = [0, 0.1, 0.33, 0.6, 0.7, 0.76]; // 암전 / 분해 / 소용돌이 / 재조립 / 충격파 / 타이틀 (비율)

export function createFusionCinematic(env) {
  const V = (x, y, z) => new env.THREE.Vector3(x, y, z);
  let rings = []; // 충격파 메시
  let stops = [];

  function shockwave(c, color) {
    const THREE = env.THREE;
    const m = new THREE.Mesh(new THREE.RingGeometry(0.9, 1.0, 64), new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false }));
    m.rotation.x = -Math.PI / 2;
    m.position.set(c.x, 0.15, c.z);
    env.root.add(m);
    const r = { m, t: 0 };
    rings.push(r);
    const off = env.frame((dt) => {
      r.t += dt;
      const k = r.t / 1.3;
      m.scale.setScalar(1 + k * 22);
      m.material.opacity = Math.max(0, 0.9 * (1 - k));
      if (k >= 1) { env.root.remove(m); m.geometry.dispose(); m.material.dispose(); rings = rings.filter((x) => x !== r); return false; }
      return true;
    });
    stops.push(off);
  }

  function start(msg) {
    const secs = Math.max(2, msg.seconds || 8);
    const ids = msg.members || [];
    const c = env.centroid(ids);
    const color = env.color(msg.team ?? env.teamOf(ids[0]));
    const at = PHASES.map((p) => p * secs);
    const isNew = Boolean(msg.isNew);
    const state = { stopped: false, title: null, sub: null, glyph: null, count: null };
    let t = 0;
    let phase = -1;

    // 암전·줌
    env.bars(true);
    env.dimTo(0.72);
    env.tintTo(color, 0.35);
    env.director.focus({ point: { x: c.x, y: 1.6, z: c.z }, seconds: secs + 0.5, distance: Math.max(9, c.spread * 2.4 + 7) });
    env.play('fusion_blackout');

    const frame = (dt) => {
      if (state.stopped) return false;
      t += dt;
      const p = t >= at[5] ? 5 : t >= at[4] ? 4 : t >= at[3] ? 3 : t >= at[2] ? 2 : t >= at[1] ? 1 : 0;
      if (p !== phase) {
        phase = p;
        if (p === 1) env.play('fusion_disperse');
        if (p === 2) env.play('fusion_vortex');
        if (p === 3) env.play('fusion_assemble');
        if (p === 4) {
          env.play('fusion_shockwave');
          env.flashNow('#fff8dc', 700);
          env.postfx?.pulse?.('fusion');
          env.dimTo(0.25);
          shockwave(c, EFFECT_COLORS.fusion);
          env.particles.explosion(V(c.x, 1.6, c.z), 2.6, EFFECT_COLORS.fusion);
          env.particles.ring(V(c.x, 0.2, c.z), EFFECT_COLORS.fusion, 6, 60);
          state.glyph = env.node('cn-glyph');
          requestAnimationFrame(() => state.glyph?.classList.add('on'));
        }
        if (p === 5) {
          env.play('fusion_title');
          state.title = env.node('cn-title', msg.name ? msg.name : `${NAMES.fusion}`);
          const names = ids.map((id) => env.nameOf(id)).join(' + ');
          state.sub = env.node('cn-sub', '');
          if (isNew) state.sub.append(env.node('cn-new', 'NEW', state.sub));
          state.sub.append(document.createTextNode(names));
          requestAnimationFrame(() => { state.title.classList.add('on'); state.sub.classList.add('on'); });
        }
      }
      const k = t / secs;
      // 분해: 각 구성원에서 빛 입자가 솟아오른다
      if (p === 1) for (const id of ids) {
        const q = env.pos(id);
        if (!q) continue;
        for (let i = 0; i < 2; i++) env.particles.glow(V(q.x + (Math.random() - 0.5) * 1.6, q.y + Math.random() * 2.2, q.z + (Math.random() - 0.5) * 1.6), color, 0.55, 0.9);
        if (Math.random() < dt * 8) env.particles.sparks(V(q.x, q.y + 1, q.z), color, 6, 4);
      }
      // 소용돌이 → 재조립: 중심으로 감겨 들어간다
      if (p === 2 || p === 3) {
        const span = at[4] - at[2];
        const u = Math.min(1, (t - at[2]) / span);
        const n = ids.length || 1;
        for (let i = 0; i < n * 3; i++) {
          const a = t * 7 + (i / (n * 3)) * Math.PI * 2;
          const r = (1 - u) * (3 + c.spread) + 0.4;
          env.particles.glow(V(c.x + Math.cos(a) * r, 0.8 + u * 2.4 + Math.sin(i) * 0.3, c.z + Math.sin(a) * r), i % 2 ? color : EFFECT_COLORS.fusion, 0.5, 0.45);
        }
        if (p === 3 && Math.random() < dt * 5) env.particles.ring(V(c.x, 1 + u * 2, c.z), EFFECT_COLORS.fusion, Math.max(0.6, (1 - u) * 5), 30, 1 + u * 2);
      }
      void k;
      return true;
    };
    stops.push(env.frame(frame));

    return {
      resume(m2) {
        const n = Math.max(1, Math.round(m2?.seconds || msg.resumeSeconds || 3));
        env.dimTo(0.0);
        state.title?.classList.remove('on'); state.sub?.classList.remove('on'); state.glyph?.classList.remove('on');
        for (let i = 0; i < n; i++) env.later(i, () => {
          if (state.stopped) return;
          state.count?.remove();
          state.count = env.node('cn-count pop', String(n - i));
          env.play('slowmo_in', 0.4);
        });
      },
      stop() {
        state.stopped = true;
        for (const n of [state.title, state.sub, state.glyph, state.count]) n?.remove();
        env.bars(false); env.dimTo(0); env.tintTo(null, 0);
      },
    };
  }

  // 융합이 풀릴 때: 짧은 빛 폭발 + 안내 문구
  function release(ev) {
    const ids = ev.entities || [];
    const c = env.centroid(ids);
    const color = env.color(env.teamOf(ids[0]));
    env.particles.explosion(V(c.x, 1.4, c.z), 1.6, color);
    env.particles.ring(V(c.x, 0.2, c.z), color, 4, 40);
    env.postfx?.pulse?.('emp');
    env.node('cn-tag', `${NAMES.fusion} 해제`).style.setProperty('--c', color);
    env.play('part_detach_boom', 0.6);
  }

  return {
    start, release,
    cancel() { for (const s of stops) s?.(); stops = []; for (const r of rings) { env.root.remove(r.m); r.m.geometry.dispose(); r.m.material.dispose(); } rings = []; },
  };
}

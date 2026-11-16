// web/cinematics/overdrive-cinematic.js  (99번)
// 오버드라이브 연출: 기체 클로즈업 컷인 + 색조 변화 + 슬로모션(슬로모션 자체는 관제 장면이 건다, 명세 9-6).
//   play(ev)  ev = { type:'overdrive', entity, uid, weapon }
// 화면: 비스듬한 띠가 좌측에서 밀려 들어와 "기체 이름 · 병기 이름"을 보여 주고 1.3초 뒤 우측으로 빠진다. 팀 색으로 화면 둘레가 물든다.
// 병기별 고유 연출은 2차 — 지금은 병기 종류와 상관없이 같은 기본형이다.

import { PART_BY_ID } from '../../data/parts.js';

const HOLD = 1.3; // 띠가 머무는 시간(초)

export function createOverdriveCinematic(env) {
  const V = (x, y, z) => new env.THREE.Vector3(x, y, z);
  let busy = 0; // 같은 순간에 여러 개가 겹쳐도 띠는 하나씩

  function play(ev) {
    const id = ev.entity;
    const q = env.pos(id);
    const color = env.color(env.teamOf(id));
    const weapon = PART_BY_ID[ev.weapon]?.name || '병기';

    env.director.focus({ id, seconds: 1.2, distance: 5.8 });
    env.tintTo(color, 0.32);
    env.later(1.6, () => env.tintTo(null, 0));
    env.dimTo(0.25);
    env.later(0.9, () => env.dimTo(0));
    env.flashNow(color, 300);
    if (q) {
      env.particles.ring(V(q.x, 0.2, q.z), color, 2.2, 36, 0.2);
      env.particles.ring(V(q.x, 1.2, q.z), '#FFFFFF', 3.2, 40, 1.2);
      env.particles.explosion(V(q.x, 1.2, q.z), 1.1, color);
    }

    const delay = busy * (HOLD + 0.5);
    busy++;
    env.later(delay, () => {
      const cut = env.node('cn-cut');
      cut.style.setProperty('--c', color);
      for (const [tag, text] of [['small', '오버드라이브'], ['b', env.nameOf(id)], ['span', `${weapon} 발동`]]) {
        const n = document.createElement(tag);
        n.textContent = text;
        cut.append(n);
      }
      requestAnimationFrame(() => cut.classList.add('on'));
      setTimeout(() => { cut.classList.add('out'); env.drop(cut, 420); }, HOLD * 1000);
      env.later(HOLD + 0.5, () => { busy = Math.max(0, busy - 1); });
    });
  }

  return { play };
}

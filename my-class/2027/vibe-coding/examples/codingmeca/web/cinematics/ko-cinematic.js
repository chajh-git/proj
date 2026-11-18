// web/cinematics/ko-cinematic.js  (100번)
// 격파·승리 연출 (명세 19장).
//   onKo(ev)   한 기가 쓰러질 때: 폭발 + 'K.O.' 글자 + 짧은 카메라 집중. 그 기로 한 팀이 모두 쓰러지면 '결정적 KO' — 슬로모션 + 카메라가 한 바퀴 도는 느낌.
//   onEnd(ev)  경기 끝: 이긴 팀 색 폭죽과 '승리' 글자(무승부는 '무승부'). 점수판·대진표 애니메이션은 관제 화면의 표가 맡는다.
// 결정적 KO 판단에 쓰는 살아 있는 수는 '이번 사건까지 반영된' 스냅샷의 ents 이다.

import { NAMES } from '../../config/names.js';

export function createKoCinematic(env) {
  const V = (x, y, z) => new env.THREE.Vector3(x, y, z);
  let fireworks = null;
  let decisive = false;

  const aliveByTeam = (exceptId) => {
    const out = {};
    for (const e of env.ents) { out[e.team] = (out[e.team] || 0) + (e.alive && e.id !== exceptId ? 1 : 0); }
    return out;
  };

  function onKo(ev) {
    const id = ev.entity;
    const q = env.pos(id);
    const team = env.teamOf(id);
    const color = env.color(team);
    const left = aliveByTeam(id)[team] ?? 1;
    decisive = left === 0; // 같은 팀에 남은 기체가 없음 → 이 격파로 승부가 갈린다

    if (q) {
      env.particles.explosion(V(q.x, 1.2, q.z), decisive ? 2.8 : 1.7, '#FF8A3D');
      env.particles.sparks(V(q.x, 1.4, q.z), color, decisive ? 40 : 18, 9);
      env.particles.ring(V(q.x, 0.2, q.z), '#FFFFFF', decisive ? 6 : 3.5, 40);
    }
    env.director.focus({ id, seconds: decisive ? 2.2 : 1.0, distance: decisive ? 9 : 7.5 });
    const t = env.node(`cn-ko pop${decisive ? ' big' : ''}`, 'K.O.');
    env.drop(t, 1200);
    if (decisive) { env.slowmo(1.8); env.postfx?.pulse?.('ko'); env.flashNow('#ffffff', 500); }
  }

  function onEnd(ev) {
    const winner = ev.winner;
    const color = winner ? env.color(winner) : '#C9D4E3';
    const label = winner ? '승리' : '무승부';
    const t = env.node('cn-win', label);
    t.style.setProperty('--c', color);
    requestAnimationFrame(() => t.classList.add('on'));
    if (winner) {
      const sub = env.node('cn-sub on', env.teamName(winner));
      env.drop(sub, 6500);
    }
    env.drop(t, 6500);
    // 폭죽: 3초 동안 전장 위로 터뜨린다
    let left = winner ? 3 : 0;
    let acc = 0;
    fireworks?.();
    fireworks = env.frame((dt) => {
      left -= dt; acc -= dt;
      if (left <= 0) return false;
      if (acc <= 0) {
        acc = 0.22;
        const x = (Math.random() - 0.5) * 22;
        const z = (Math.random() - 0.5) * 14;
        const p = V(x, 5 + Math.random() * 5, z);
        env.particles.explosion(p, 1.2 + Math.random(), Math.random() < 0.5 ? color : '#FFE29A');
        env.particles.sparks(p, '#FFFFFF', 10, 6);
      }
      return true;
    });
    void NAMES;
  }

  return { onKo, onEnd, cancel() { fireworks?.(); fireworks = null; decisive = false; } };
}

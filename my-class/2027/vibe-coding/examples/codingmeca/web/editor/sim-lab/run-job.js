// web/editor/sim-lab/run-job.js
// 매치업 한 판을 헤드리스로 끝까지 돌린다(워커와 Node 시험이 같이 쓴다). 화면·DOM을 쓰지 않는다. (명세 18-5)
//   const ctx = makeLabContext(balanceData);      // 조율 센터의 (저장 전) 수치를 병합한 실행 환경
//   runJob({ a, b, swap, seed, mapId }, ctx)      → { a, b, swap, winner:'a'|'b'|null, reason, duration, ratios:{a,b} }
// a, b 는 원형 설계도 ID. swap=true 면 b 가 A 팀(서쪽 시작)이 된다 — 시작 위치 좌우 교대.
// 샘플 전술은 원형 설계도에 들어 있는 것을 쓴다. 융합·변신 레시피는 로컬 분석에 없다.

import { simulateMatch } from '../../../shared/sim/referee.js';
import { mergeBalance } from '../../../shared/balance/merge.js';
import { PRESET_BY_ID } from '../../../data/presets.js';

export function makeLabContext(balanceData = {}) {
  const m = mergeBalance(balanceData);
  return { constants: m.constants, parts: m.parts, maps: m.maps, skills: m.skills };
}

export function runJob({ a, b, swap = false, seed = 1, mapId = 'm1' }, ctx) {
  const pa = PRESET_BY_ID[a];
  const pb = PRESET_BY_ID[b];
  const first = swap ? pb : pa;
  const second = swap ? pa : pb;
  const map = ctx.maps.find((x) => x.id === mapId) || ctx.maps[0];
  const match = simulateMatch({
    teams: [{ id: 'A', entries: [{ design: first, tactics: first.tactics }] }, { id: 'B', entries: [{ design: second, tactics: second.tactics }] }],
    map, seed, constants: ctx.constants, parts: ctx.parts, pilotSkills: ctx.skills,
  });
  const r = match.result;
  const side = (team) => (swap ? (team === 'A' ? 'b' : 'a') : (team === 'A' ? 'a' : 'b'));
  const ratios = r.ratios || {};
  return {
    a, b, swap, winner: r.winner ? side(r.winner) : null, reason: r.reason, duration: r.duration,
    ratios: { [side('A')]: ratios.A ?? 0, [side('B')]: ratios.B ?? 0 },
  };
}

/** 쌍마다 N판(절반씩 좌우 교대)의 작업 목록 */
export function planJobs(ids, games, mapId, seedBase = 1000) {
  const jobs = [];
  for (let i = 0; i < ids.length; i++) for (let j = i + 1; j < ids.length; j++) {
    for (let k = 0; k < games; k++) jobs.push({ a: ids[i], b: ids[j], swap: k % 2 === 1, seed: seedBase + i * 997 + j * 31 + k, mapId });
  }
  return jobs;
}

/** 결과 → 행렬. m[x][y] = { games, win, draw, loss, winRate, avgDuration } (x 입장에서 y 상대) */
export function aggregate(ids, results) {
  const m = Object.fromEntries(ids.map((x) => [x, Object.fromEntries(ids.filter((y) => y !== x).map((y) => [y, { games: 0, win: 0, draw: 0, loss: 0, dur: 0 }]))]));
  for (const r of results) {
    const A = m[r.a][r.b]; const B = m[r.b][r.a];
    A.games++; B.games++; A.dur += r.duration; B.dur += r.duration;
    if (r.winner === 'a') { A.win++; B.loss++; } else if (r.winner === 'b') { B.win++; A.loss++; } else { A.draw++; B.draw++; }
  }
  const rows = {};
  for (const x of ids) {
    let g = 0; let w = 0; let d = 0; let dur = 0;
    for (const y of Object.keys(m[x])) {
      const c = m[x][y];
      c.winRate = c.games ? (c.win + c.draw * 0.5) / c.games : null; // 무승부는 반 승
      c.avgDuration = c.games ? c.dur / c.games : null;
      g += c.games; w += c.win + c.draw * 0.5; d += c.draw; dur += c.dur;
    }
    rows[x] = { games: g, winRate: g ? w / g : null, drawRate: g ? d / g : null, avgDuration: g ? dur / g : null };
  }
  return { cells: m, rows };
}

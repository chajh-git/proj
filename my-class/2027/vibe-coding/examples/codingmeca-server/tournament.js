// server/tournament.js  (82번)
// 대진 만들기와 순위 계산. 순수 함수만 있어서 DB 없이 시험할 수 있다. (명세 9-8, 13)
//   roundRobin(teamIds)                       → [{ round, a, b }]  (부전승은 만들지 않음)
//   buildBracket({ format, seeds })           → { format, matches:{id→match}, order:[id...] }   format: 'single' | 'double'
//   reportResult(bracket, matchId, outcome)   → 승자를 다음 경기로 올린다 (outcome: 'a' | 'b')
//   computeStandings(matches, { points })     → 순위표(타이브레이크 적용)
//   seedTeams(teamIds, mode, manualOrder)     → 시드 순서 ('registration' | 'random' | 'manual')
//
// 경기: { id, bracket:'W'|'L'|'F', round, slot, a, b, winner, loser, status, win:{to,side}, lose:{to,side}|null }
//   a, b: 팀 ID | 'BYE' | null(아직 정해지지 않음)

import { CONSTANTS } from '#config/constants.js';

export const BYE = 'BYE';

// ── 시드 ────────────────────────────────────────────────
export function seedTeams(teamIds, mode = 'registration', manualOrder = null, rng = Math.random) {
  const ids = [...teamIds];
  if (mode === 'random') {
    for (let i = ids.length - 1; i > 0; i--) { const j = Math.floor(rng() * (i + 1)); [ids[i], ids[j]] = [ids[j], ids[i]]; }
    return ids;
  }
  if (mode === 'manual' && Array.isArray(manualOrder)) {
    const known = manualOrder.filter((id) => ids.includes(id));
    return [...known, ...ids.filter((id) => !known.includes(id))];
  }
  return ids;
}

// ── 리그전 (원 방식: 한 팀 고정, 나머지 회전) ───────────
export function roundRobin(teamIds) {
  const ids = [...teamIds];
  if (ids.length % 2) ids.push(null); // 부전
  const n = ids.length;
  const out = [];
  for (let r = 0; r < n - 1; r++) {
    for (let i = 0; i < n / 2; i++) {
      const a = ids[i];
      const b = ids[n - 1 - i];
      if (a && b) out.push({ round: r + 1, a: r % 2 === 0 ? a : b, b: r % 2 === 0 ? b : a });
    }
    ids.splice(1, 0, ids.pop());
  }
  return out;
}

// ── 토너먼트 ────────────────────────────────────────────
const pow2 = (n) => { let p = 1; while (p < n) p *= 2; return Math.max(2, p); };

// 표준 시드 배치: [1, n, ...] 에서 시작해 상위 시드가 결승 전에는 만나지 않게
export function seedOrder(n) {
  let order = [1, 2];
  while (order.length < n) {
    const m = order.length * 2;
    order = order.flatMap((s) => [s, m + 1 - s]);
  }
  return order;
}

function mk(id, bracket, round, slot) {
  return { id, bracket, round, slot, a: null, b: null, winner: null, loser: null, status: 'pending', win: null, lose: null };
}

export function buildBracket({ format = 'single', seeds = [] } = {}) {
  if (seeds.length < 2) throw new Error('토너먼트는 팀이 2팀 이상이어야 합니다');
  const n = pow2(seeds.length);
  const k = Math.log2(n);
  const order = seedOrder(n).map((s) => seeds[s - 1] ?? BYE);
  const M = {};
  const list = [];
  const add = (m) => { M[m.id] = m; list.push(m.id); return m; };

  // 승자 브래킷
  for (let r = 1; r <= k; r++) for (let s = 0; s < n / 2 ** r; s++) add(mk(`W${r}-${s + 1}`, 'W', r, s));
  for (let s = 0; s < n / 2; s++) { M[`W1-${s + 1}`].a = order[2 * s]; M[`W1-${s + 1}`].b = order[2 * s + 1]; }
  for (let r = 1; r < k; r++) for (let s = 0; s < n / 2 ** r; s++) M[`W${r}-${s + 1}`].win = { to: `W${r + 1}-${Math.floor(s / 2) + 1}`, side: s % 2 ? 'b' : 'a' };

  if (format === 'double') {
    // 패자 브래킷: 라운드 j = 1..2(k-1), 경기 수 n / 2^(ceil(j/2)+1)
    const rounds = 2 * (k - 1);
    for (let j = 1; j <= rounds; j++) for (let s = 0; s < n / 2 ** (Math.ceil(j / 2) + 1); s++) add(mk(`L${j}-${s + 1}`, 'L', j, s));
    // 패자 브래킷 안에서 이기면 다음 패자 경기로
    for (let j = 1; j <= rounds; j++) {
      const cnt = n / 2 ** (Math.ceil(j / 2) + 1);
      for (let s = 0; s < cnt; s++) {
        const m = M[`L${j}-${s + 1}`];
        if (j === rounds) m.win = { to: 'F-1', side: 'b' };
        else if (j % 2 === 1) m.win = { to: `L${j + 1}-${s + 1}`, side: 'a' }; // 홀수 → 짝수 라운드: 같은 번호로, 승자 브래킷 패자와 합류
        else m.win = { to: `L${j + 1}-${Math.floor(s / 2) + 1}`, side: s % 2 ? 'b' : 'a' };
      }
    }
    // 승자 브래킷에서 진 팀이 내려오는 자리
    if (k === 1) M['W1-1'].lose = { to: 'F-1', side: 'b' }; // 2팀: 패자 브래킷 없이 결승만
    else for (let s = 0; s < n / 2; s++) M[`W1-${s + 1}`].lose = { to: `L1-${Math.floor(s / 2) + 1}`, side: s % 2 ? 'b' : 'a' };
    if (k > 1) for (let r = 2; r <= k; r++) for (let s = 0; s < n / 2 ** r; s++) M[`W${r}-${s + 1}`].lose = { to: `L${2 * (r - 1)}-${s + 1}`, side: 'b' };
    add(mk('F-1', 'F', 1, 0));
    M[`W${k}-1`].win = { to: 'F-1', side: 'a' };
  }
  const bracket = { format, size: n, matches: M, order: list };
  settleByes(bracket);
  return bracket;
}

function put(bracket, target, team) {
  if (!target) return;
  bracket.matches[target.to][target.side] = team;
}

// 부전승 정리: 한쪽이 BYE 이고 다른 쪽이 정해졌으면 자동으로 올린다. 양쪽 BYE 이면 BYE 를 올린다.
function settleByes(bracket) {
  let changed = true;
  while (changed) {
    changed = false;
    for (const id of bracket.order) {
      const m = bracket.matches[id];
      if (m.status !== 'pending') continue;
      const aBye = m.a === BYE;
      const bBye = m.b === BYE;
      if (!aBye && !bBye) continue;
      if (aBye && bBye) { finish(bracket, m, BYE, BYE, 'bye'); changed = true; continue; }
      const other = aBye ? m.b : m.a;
      if (other === null) continue; // 상대가 아직 안 정해짐
      finish(bracket, m, other, BYE, 'bye');
      changed = true;
    }
  }
}

function finish(bracket, m, winner, loser, status) {
  m.winner = winner; m.loser = loser; m.status = status === 'bye' ? 'bye' : 'done';
  put(bracket, m.win, winner);
  put(bracket, m.lose, loser);
}

/** 결과 반영. outcome: 'a' | 'b'. 이미 끝난 경기를 고치면 아래 단계가 이미 진행됐는지 확인해 거절한다. */
export function reportResult(bracket, matchId, outcome) {
  const m = bracket.matches[matchId];
  if (!m) throw new Error('없는 경기입니다');
  if (m.a === null || m.b === null || m.a === BYE || m.b === BYE) throw new Error('아직 양쪽 팀이 정해지지 않은 경기입니다');
  const winner = outcome === 'a' ? m.a : m.b;
  const loser = outcome === 'a' ? m.b : m.a;
  if (m.status === 'done') {
    // 수정: 다음 경기가 이미 시작됐으면 거절
    for (const t of [m.win, m.lose]) if (t && bracket.matches[t.to].status !== 'pending') throw new Error('다음 경기가 이미 진행되어 결과를 고칠 수 없습니다');
  }
  finish(bracket, m, winner, loser, 'done');
  settleByes(bracket);
  return bracket;
}

// 지금 치를 수 있는 경기(양 팀이 정해지고 아직 안 끝난)
export const playable = (bracket) => bracket.order.map((id) => bracket.matches[id]).filter((m) => m.status === 'pending' && m.a && m.b && m.a !== BYE && m.b !== BYE);

export function champion(bracket) {
  const last = bracket.matches[bracket.format === 'double' ? 'F-1' : `W${Math.log2(bracket.size)}-1`];
  return last.status === 'done' || last.status === 'bye' ? last.winner : null;
}

// ── 순위 (리그전) ───────────────────────────────────────
// matches: [{ a, b, status:'done', result:{ winner, ratios:{[teamId]:ratio} } }]  (winner 가 null 이면 무승부)
export function computeStandings(matches, { points = CONSTANTS.league?.points ?? { win: 3, draw: 1, loss: 0 }, teamIds = [] } = {}) {
  const row = (id) => ({ team: id, played: 0, win: 0, draw: 0, loss: 0, points: 0, hpDiff: 0 });
  const table = new Map(teamIds.map((id) => [id, row(id)]));
  const get = (id) => { if (!table.has(id)) table.set(id, row(id)); return table.get(id); };
  const h2h = new Map(); // `${a}>${b}` → a가 b에게 거둔 승점
  for (const m of matches) {
    if (m.status !== 'done' || !m.result || m.result.aborted) continue;
    const A = get(m.a); const B = get(m.b);
    A.played++; B.played++;
    const ra = m.result.ratios?.[m.a] ?? 0;
    const rb = m.result.ratios?.[m.b] ?? 0;
    A.hpDiff += ra - rb; B.hpDiff += rb - ra;
    const w = m.result.winner;
    const add = (from, to, p) => h2h.set(`${from}>${to}`, (h2h.get(`${from}>${to}`) || 0) + p);
    if (!w) { A.draw++; B.draw++; A.points += points.draw; B.points += points.draw; add(m.a, m.b, points.draw); add(m.b, m.a, points.draw); }
    else {
      const [W, L] = w === m.a ? [A, B] : [B, A];
      W.win++; L.loss++; W.points += points.win; L.points += points.loss;
      add(W.team, L.team, points.win); add(L.team, W.team, points.loss);
    }
  }
  const rows = [...table.values()];
  // 타이브레이크: 승점 → 팀 체력비 누적 차 → 상대 전적 → (그래도 같으면 tie 표시, 지휘관 수동)
  rows.sort((x, y) => y.points - x.points || y.hpDiff - x.hpDiff || (h2h.get(`${y.team}>${x.team}`) || 0) - (h2h.get(`${x.team}>${y.team}`) || 0));
  rows.forEach((r, i) => {
    r.rank = i + 1;
    const prev = rows[i - 1];
    r.tied = false;
    if (prev && prev.points === r.points && Math.abs(prev.hpDiff - r.hpDiff) < 1e-9 && (h2h.get(`${prev.team}>${r.team}`) || 0) === (h2h.get(`${r.team}>${prev.team}`) || 0)) { r.tied = true; prev.tied = true; }
  });
  return rows;
}

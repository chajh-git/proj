// web/ui/commander/match-control-ui.js  (92번)
// 지휘 본부 · 경기 관제: 매치를 골라 준비 → 개시 → 일시정지·재개·중단 → 결과 확정(수정). (명세 13장)
//   const ui = createMatchControlUI({ root, net, toast });
//   ui.setLeague(view)    // server publicView() — 리그가 바뀌거나 league_update 가 올 때마다 다시 넘긴다
// 일시정지는 시뮬레이션 시계를 멈춘다. 진행 중인 경기는 서버 한 곳에서만 돌아가고, 여기서는 명령만 보낸다.

import { MAPS } from '../../../data/maps.js';
import { el, clear, ensureStyle } from '../dom.js';
import { COMMON_CSS, call } from './kit.js';
import { statusLabel, teamName, matchTitle, resultText } from '../scoreboard.js';

export function createMatchControlUI({ root, net, toast, onChange = () => {} } = {}) {
  ensureStyle(COMMON_CSS, 'cm-cmd-style');
  const wrap = el('div', { class: 'cm-panel cm-cmd' });
  const body = el('div', { class: 'bd cm-scroll' });
  wrap.append(el('h3', {}, '경기 관제'), body);
  root.append(wrap);
  let view = null;
  let cfg = null; // 리그 설정(전장 선택 방식)
  const mapPick = new Map(); // matchId → 고른 전장

  const run = async (op, args, ok) => { const d = await call(net, toast, op, args, ok); onChange(); return d; };

  function mapSelect(m) {
    const pool = (cfg?.mapPool?.length ? cfg.mapPool : MAPS.map((x) => x.id));
    const s = el('select', { class: 'cm-input', 'aria-label': '전장' }, pool.map((id) => el('option', { value: id }, MAPS.find((x) => x.id === id)?.name || id)));
    s.value = mapPick.get(m.id) || m.map || pool[0];
    mapPick.set(m.id, s.value);
    s.addEventListener('change', () => mapPick.set(m.id, s.value));
    return s;
  }

  function row(m) {
    const live = ['prep', 'running', 'paused'].includes(m.status);
    const btn = (label, fn, cls = '') => el('button', { type: 'button', class: `cm-btn ${cls}`, onClick: fn }, label);
    const acts = [];
    const perMatch = cfg?.mapMode === 'perMatch';
    const mapArg = () => (perMatch ? { mapId: mapPick.get(m.id) } : {});
    const ready = m.teamA && m.teamB;
    if (['scheduled', 'aborted'].includes(m.status) && ready) {
      if (perMatch) acts.push(mapSelect(m));
      acts.push(btn('준비', () => run('match.prepare', { matchId: m.id, ...mapArg() }, '준비했습니다')), btn('개시', () => run('match.start', { matchId: m.id, ...mapArg() }, '경기를 시작합니다'), 'primary'));
    }
    if (m.status === 'prep') acts.push(btn('개시', () => run('match.start', { matchId: m.id }, '경기를 시작합니다'), 'primary'), btn('준비 취소', () => run('match.abort', { matchId: m.id })));
    if (m.status === 'running') acts.push(btn('⏸ 일시정지', () => run('match.pause', { matchId: m.id })), btn('중단', () => { if (confirm('이 경기를 중단할까요? 결과는 기록되지 않습니다.')) run('match.abort', { matchId: m.id }); }, 'danger'));
    if (m.status === 'paused') acts.push(btn('▶ 재개', () => run('match.resume', { matchId: m.id }), 'primary'), btn('중단', () => { if (confirm('이 경기를 중단할까요? 결과는 기록되지 않습니다.')) run('match.abort', { matchId: m.id }); }, 'danger'));
    if (m.status === 'needs_decision' || m.status === 'finished') {
      const label = m.status === 'needs_decision' ? '승자 지정' : '결과 수정';
      acts.push(el('span', { style: { fontSize: '12px', color: 'var(--cm-textDim)' } }, label),
        btn(`${teamName(view, m.teamA)} 승`, () => run('match.set_result', { matchId: m.id, winner: m.teamA }, '결과를 정했습니다')),
        btn(`${teamName(view, m.teamB)} 승`, () => run('match.set_result', { matchId: m.id, winner: m.teamB }, '결과를 정했습니다')));
      if (view.format === 'roundrobin') acts.push(btn('무승부', () => run('match.set_result', { matchId: m.id, winner: null }, '무승부로 정했습니다')));
    }
    return el('div', { class: 'cm-panel', style: { padding: '8px 10px', margin: '6px 0', borderColor: live ? 'var(--cm-primary)' : undefined } },
      el('div', { class: 'cm-row' }, el('b', { style: { flex: 1 } }, matchTitle(view, m)), el('span', { class: 'cm-chip' }, statusLabel(m.status)), m.map ? el('span', { class: 'cm-chip' }, MAPS.find((x) => x.id === m.map)?.name || m.map) : null),
      m.result ? el('div', { style: { fontSize: '12px', color: 'var(--cm-textDim)', marginTop: '3px' } }, resultText(view, m)) : null,
      acts.length ? el('div', { class: 'actions', style: { margin: '6px 0 0' } }, acts) : null);
  }

  function render() {
    clear(body);
    if (!view) { body.append(el('p', { style: { color: 'var(--cm-textDim)' } }, '왼쪽 ‘리그 관리’에서 리그를 먼저 고르세요.')); return; }
    const ms = [...view.matches].sort((a, b) => a.round - b.round || a.slot - b.slot);
    body.append(el('div', { style: { fontSize: '12px', color: 'var(--cm-textDim)', marginBottom: '6px' } }, `${view.name} · 동시 경기 ${cfg?.concurrent ?? '-'}개까지`));
    if (!ms.length) { body.append(el('p', { style: { color: 'var(--cm-textDim)' } }, view.status === 'open' ? '대진이 없습니다. 리그 관리에서 ‘대진 만들기’를 누르세요.' : '경기가 없습니다.')); return; }
    const order = { running: 0, paused: 0, prep: 1, needs_decision: 2, scheduled: 3, aborted: 4, finished: 5 };
    for (const m of [...ms].sort((a, b) => (order[a.status] ?? 9) - (order[b.status] ?? 9) || a.round - b.round || a.slot - b.slot)) body.append(row(m));
  }

  render();
  return {
    setLeague(v, config = null) { view = v; if (config) cfg = config; render(); },
    setConfig(config) { cfg = config; },
    el: wrap, setVisible(on) { wrap.style.display = on ? '' : 'none'; }, destroy() { wrap.remove(); },
  };
}

// web/ui/bracket-view.js  (89번)
// 토너먼트 대진표. 승자 브래킷(W) · 패자 브래킷(L) · 결승(F)을 라운드 열로 그린다. 부전승은 그리지 않는다. (명세 13장)
//   const bv = createBracketView({ root });
//   bv.update(view)   // view.bracket = { format, size, matches:{id→{id,bracket,round,slot,a,b,winner,status}} }, view.teams
//
// 경기의 진행 상태(진행 중 등)는 view.matches 의 bracket 경기 행(id 가 `<리그>:<대진ID>`)에서 읽는다.

import { el, clear, ensureStyle } from './dom.js';
import { teamName, teamColor, statusLabel } from './scoreboard.js';

const CSS = `
.cm-br{display:flex;flex-direction:column;min-height:0}
.cm-br .hd{padding:10px 12px;border-bottom:1px solid var(--cm-panelEdge);font-weight:700;color:var(--cm-primary);display:flex;gap:10px;align-items:center}
.cm-br .hd small{color:var(--cm-textDim);font-weight:400}
.cm-br .bd{overflow:auto;padding:10px 12px 14px;min-height:0}
.cm-br .sec{margin-bottom:14px}
.cm-br .sec>b{display:block;font-size:11px;letter-spacing:.1em;color:var(--cm-textDim);margin-bottom:6px}
.cm-br .cols{display:flex;gap:18px;align-items:stretch}
.cm-br .col{display:flex;flex-direction:column;justify-content:space-around;gap:8px;min-width:150px}
.cm-br .col>small{text-align:center;color:var(--cm-textDim);font-size:10px}
.cm-br .m{border:1px solid var(--cm-panelEdge);border-radius:8px;background:rgba(255,255,255,.04);overflow:hidden;font-size:12px;position:relative}
.cm-br .m.live{border-color:var(--cm-primary);box-shadow:0 0 12px -2px var(--cm-primary)}
.cm-br .m.needs_decision{border-color:var(--cm-warn,#FFB020)}
.cm-br .m .s{display:flex;align-items:center;gap:6px;padding:5px 8px}
.cm-br .m .s+.s{border-top:1px solid rgba(255,255,255,.07)}
.cm-br .m .s.w{font-weight:800;background:rgba(120,220,255,.1)}
.cm-br .m .s.l{opacity:.5}
.cm-br .m .s.tbd{color:var(--cm-textDim);font-style:italic}
.cm-br .m .dot{width:8px;height:8px;border-radius:50%;flex:none}
.cm-br .m .tag{position:absolute;right:6px;top:2px;font-size:9px;color:var(--cm-primary)}
.cm-br .champ{margin-top:8px;padding:10px;border-radius:10px;text-align:center;border:1px solid var(--cm-primary);color:var(--cm-primary);font-weight:800}
.cm-br .empty{padding:14px;color:var(--cm-textDim);font-size:13px}
`;

const roundLabel = (kind, r, last) => (kind === 'F' ? '결승' : kind === 'W' && r === last ? (last === 1 ? '결승' : '승자 결승') : `${r}라운드`);

export function createBracketView({ root } = {}) {
  ensureStyle(CSS, 'cm-br-style');
  const wrap = el('div', { class: 'cm-panel cm-br' });
  root.append(wrap);

  function update(view) {
    clear(wrap);
    const b = view?.bracket;
    wrap.append(el('div', { class: 'hd' }, view?.format === 'double' ? '더블 토너먼트' : '싱글 토너먼트', el('small', {}, view?.name || '')));
    if (!b) { wrap.append(el('div', { class: 'empty' }, '토너먼트 대진이 아직 없습니다.')); return; }
    const status = new Map((view.matches || []).map((m) => [String(m.id).split(':').pop(), m.status]));
    const ms = Object.values(b.matches).filter((m) => m.status !== 'bye');
    const side = (m, key) => {
      const id = m[key];
      const won = m.winner && m.winner === id;
      const lost = m.winner && id && m.winner !== id;
      if (!id || id === 'BYE') return el('div', { class: 's tbd' }, id === 'BYE' ? '부전승' : '미정');
      return el('div', { class: `s${won ? ' w' : ''}${lost ? ' l' : ''}` }, el('span', { class: 'dot', style: { background: teamColor(view, id) } }), teamName(view, id));
    };
    const box = (m) => {
      const st = status.get(m.id);
      const live = st === 'running' || st === 'paused' || st === 'prep';
      return el('div', { class: `m${live ? ' live' : ''}${st === 'needs_decision' ? ' needs_decision' : ''}`, title: m.id },
        live || st === 'needs_decision' ? el('span', { class: 'tag' }, statusLabel(st)) : null, side(m, 'a'), side(m, 'b'));
    };
    const section = (kind, title) => {
      const list = ms.filter((m) => m.bracket === kind);
      if (!list.length) return null;
      const rounds = [...new Set(list.map((m) => m.round))].sort((x, y) => x - y);
      const last = rounds[rounds.length - 1];
      return el('div', { class: 'sec' }, el('b', {}, title), el('div', { class: 'cols' }, rounds.map((r) => el('div', { class: 'col' }, el('small', {}, roundLabel(kind, r, last)), list.filter((m) => m.round === r).sort((x, y) => x.slot - y.slot).map(box)))));
    };
    const bd = el('div', { class: 'bd cm-scroll' }, section('W', '승자 브래킷'), section('L', '패자 브래킷'), section('F', '결승'));
    const final = b.matches[b.format === 'double' ? 'F-1' : `W${Math.log2(b.size)}-1`];
    if (final?.status === 'done' && final.winner) bd.append(el('div', { class: 'champ' }, `우승 · ${teamName(view, final.winner)}`));
    wrap.append(bd);
  }

  return { update, el: wrap, setVisible(on) { wrap.style.display = on ? '' : 'none'; }, destroy() { wrap.remove(); } };
}

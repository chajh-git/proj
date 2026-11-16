// web/ui/scoreboard.js  (88번)
// 관제 스크린과 지휘 본부가 함께 쓰는 순위표·경기표. 서버가 내려 준 '공개 정보(view)'만 그린다 — 설계·전술은 들어 있지 않다. (명세 13장)
//   const sb = createScoreboard({ root, onReplay });
//   sb.update(view)       // view = server/league-manager.js publicView()
//   sb.setCompact(true)   // 경기 중에는 작게(모서리), 쉬는 동안에는 크게
//
// 함께 내보내는 글자 도우미: statusLabel, reasonLabel, teamName, teamColor, matchTitle, resultText

import { NAMES } from '../../config/names.js';
import { el, clear, ensureStyle } from './dom.js';

export const STATUS_LABEL = Object.freeze({
  scheduled: '대기', prep: '준비 중', running: '진행 중', paused: '일시정지', finished: '종료', aborted: '중단', needs_decision: '판정 필요',
  open: '등록 중', // 리그
});
export const REASON_LABEL = Object.freeze({
  knockout: '격파', time: '시간 종료', extension: '연장 판정', draw: '무승부', mutual_ko: '동시 격파', manual: '지휘관 판정',
  aborted: '중단', commander: '지휘관 중단', server_restart: '서버 재시작', server_stop: '서버 종료',
});
export const statusLabel = (s) => STATUS_LABEL[s] || s;
export const reasonLabel = (r) => REASON_LABEL[r] || r || '';
export const teamName = (view, id) => (id ? view?.teams?.[id]?.name || id : '미정');
export const teamColor = (view, id) => view?.teams?.[id]?.color || '#888';
export const matchTitle = (view, m) => `${teamName(view, m.teamA)} vs ${teamName(view, m.teamB)}`;
const pct = (v) => (typeof v === 'number' ? `${Math.round(v * 100)}%` : '–');

// 결과 문장: "가 팀 승 · 격파 (62% : 0%)" / "무승부 · 시간 종료"
export function resultText(view, m) {
  const r = m.result;
  if (!r) return '';
  if (r.aborted) return '중단됨';
  const why = reasonLabel(r.reason);
  if (!r.winner) return `${NAMES.draw}${why ? ` · ${why}` : ''}`;
  const ra = r.ratios?.[m.teamA]; const rb = r.ratios?.[m.teamB];
  const ratio = ra != null || rb != null ? ` (${pct(ra)} : ${pct(rb)})` : '';
  return `${teamName(view, r.winner)} ${NAMES.win}${why ? ` · ${why}` : ''}${ratio}`;
}

const CSS = `
.cm-sb{display:flex;flex-direction:column;min-height:0;max-height:100%}
.cm-sb .hd{display:flex;align-items:center;gap:10px;padding:10px 12px;border-bottom:1px solid var(--cm-panelEdge)}
.cm-sb .hd b{font-size:15px;color:var(--cm-primary);letter-spacing:.04em}
.cm-sb .hd .st{font-size:11px;padding:1px 8px;border-radius:999px;background:rgba(255,255,255,.1);color:var(--cm-textDim)}
.cm-sb .hd .code{margin-left:auto;font-family:monospace;letter-spacing:.25em;font-size:13px;color:var(--cm-textDim)}
.cm-sb .bd{padding:8px 12px 12px;overflow:auto;min-height:0}
.cm-sb table{width:100%;border-collapse:collapse;font-size:13px}
.cm-sb th{font-weight:600;color:var(--cm-textDim);font-size:11px;text-align:right;padding:3px 6px}
.cm-sb th:nth-child(-n+2),.cm-sb td:nth-child(-n+2){text-align:left}
.cm-sb td{padding:5px 6px;text-align:right;border-top:1px solid rgba(255,255,255,.06)}
.cm-sb td.pts{font-weight:800;color:var(--cm-text)}
.cm-sb .dot{display:inline-block;width:9px;height:9px;border-radius:50%;margin-right:6px;vertical-align:middle}
.cm-sb .tie{color:var(--cm-warn,#FFB020);font-size:10px;margin-left:4px}
.cm-sb h4{margin:12px 0 4px;font-size:12px;color:var(--cm-textDim);letter-spacing:.08em}
.cm-sb .mrow{display:flex;gap:8px;align-items:center;padding:6px 8px;margin:3px 0;border-radius:7px;background:rgba(255,255,255,.04);font-size:13px}
.cm-sb .mrow.live{border:1px solid var(--cm-primary);background:rgba(120,220,255,.08)}
.cm-sb .mrow .t{flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-sb .mrow small{color:var(--cm-textDim);font-size:11px}
.cm-sb .mrow .badge{font-size:10px;padding:1px 7px;border-radius:999px;background:rgba(255,255,255,.12)}
.cm-sb .mrow.live .badge{background:var(--cm-primary);color:var(--cm-bg);font-weight:800}
.cm-sb .mrow.needs_decision .badge{background:var(--cm-warn,#FFB020);color:#222}
.cm-sb .empty{padding:14px 4px;color:var(--cm-textDim);font-size:13px}
.cm-sb.compact .tbl,.cm-sb.compact h4{display:none}
`;

export function createScoreboard({ root, onReplay = null, title = null } = {}) {
  ensureStyle(CSS, 'cm-sb-style');
  const wrap = el('div', { class: 'cm-panel cm-sb' });
  root.append(wrap);
  let view = null;

  function standingsTable() {
    const rows = view.standings || [];
    if (!rows.length) return null;
    const t = el('table', { class: 'tbl' },
      el('thead', {}, el('tr', {}, ...['#', '팀', '경기', '승', '무', '패', '승점', '체력비 차'].map((h) => el('th', {}, h)))),
      el('tbody', {}, rows.map((r) => el('tr', {},
        el('td', {}, r.rank),
        el('td', {}, el('span', { class: 'dot', style: { background: teamColor(view, r.team) } }), teamName(view, r.team), r.tied ? el('span', { class: 'tie', title: '타이브레이크로도 가려지지 않음 — 지휘관 판정' }, '동률') : null),
        el('td', {}, r.played), el('td', {}, r.win), el('td', {}, r.draw), el('td', {}, r.loss),
        el('td', { class: 'pts' }, r.points),
        el('td', {}, `${r.hpDiff >= 0 ? '+' : ''}${r.hpDiff.toFixed(2)}`)))));
    return t;
  }

  function matchRow(m) {
    const live = m.status === 'running' || m.status === 'paused' || m.status === 'prep';
    const done = m.status === 'finished';
    return el('div', { class: `mrow ${live ? 'live ' : ''}${m.status}` },
      el('span', { class: 't' }, matchTitle(view, m), m.map ? el('small', {}, `  · ${m.map}`) : null),
      done ? el('small', {}, resultText(view, m)) : null,
      el('span', { class: 'badge' }, statusLabel(m.status)),
      done && m.replayId && onReplay ? el('button', { class: 'cm-btn', type: 'button', onClick: () => onReplay(m) }, '다시 보기') : null);
  }

  function render() {
    clear(wrap);
    if (!view) { wrap.append(el('div', { class: 'empty' }, '리그 정보를 기다리는 중…')); return; }
    wrap.append(el('div', { class: 'hd' }, el('b', {}, title || view.name), el('span', { class: 'st' }, statusLabel(view.status)), view.code ? el('span', { class: 'code', title: '관람 코드' }, view.code) : null));
    const bd = el('div', { class: 'bd cm-scroll' });
    const st = standingsTable();
    if (st) bd.append(el('h4', {}, '순위'), st);
    const ms = [...view.matches].sort((a, b) => a.round - b.round || a.slot - b.slot);
    const group = (label, f) => { const l = ms.filter(f); if (l.length) bd.append(el('h4', {}, label), ...l.map(matchRow)); };
    // 진행 중인 경기는 compact 에서도 보인다
    const lv = ms.filter((m) => ['running', 'paused', 'prep'].includes(m.status));
    if (lv.length) bd.append(el('h4', { style: { display: 'block' } }, '지금 경기'), ...lv.map(matchRow));
    group('판정 필요', (m) => m.status === 'needs_decision');
    group('다음 경기', (m) => m.status === 'scheduled' && m.teamA && m.teamB);
    group('종료', (m) => m.status === 'finished' || m.status === 'aborted');
    if (!ms.length) bd.append(el('div', { class: 'empty' }, view.status === 'open' ? '출전 등록 중입니다. 대진이 만들어지면 여기에 나옵니다.' : '경기가 없습니다.'));
    wrap.append(bd);
  }

  render();
  return {
    update(v) { view = v; render(); },
    setCompact(on) { wrap.classList.toggle('compact', Boolean(on)); },
    setVisible(on) { wrap.style.display = on ? '' : 'none'; },
    el: wrap,
    destroy() { wrap.remove(); },
  };
}

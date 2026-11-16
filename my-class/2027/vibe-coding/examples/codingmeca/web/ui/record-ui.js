// web/ui/record-ui.js  (68번)
// 기록·도감: 내 팀의 전적(이긴·진·비긴 횟수, 경기 목록, 리플레이 보기)과, 지금까지 밝혀진 융합·변신 도감. (명세 6, 9-7, 12장)
//   도감은 '발견한 것만' 내용이 보이고, 나머지는 ???로 가려 둔다. 숨겨진 조건은 이 화면에 절대 오지 않는다 —
//   서버가 공개된 항목(도감 공개 범위 안)만 내려 준다.
//
//   const ui = createRecordUI({ root, onReplay });
//   ui.setRecords([{ id, league, round, opponent, result:'win'|'lose'|'draw', myScore, oppScore, at, replayId }])
//   ui.setCodex({ total, entries:[{ id, name, kind:'fusion'|'transform', desc, foundBy, at, isNew }] })
//   ui.showTab('record'|'codex')

import { NAMES } from '../../config/names.js';
import { el, clear, ensureStyle } from './dom.js';

const CSS = `
.cm-record{display:flex;flex-direction:column;height:100%;min-height:0}
.cm-record .top{padding:8px 12px;border-bottom:1px solid var(--cm-panelEdge)}
.cm-record .body{flex:1;min-height:0;padding:10px 12px 16px}
.cm-record .sum{display:flex;gap:10px;margin-bottom:10px;flex-wrap:wrap}
.cm-record .sum div{flex:1;min-width:80px;padding:8px 10px;border-radius:8px;background:rgba(255,255,255,.05);text-align:center}
.cm-record .sum b{display:block;font-size:20px}
.cm-record .sum small{color:var(--cm-textDim);font-size:11px}
.cm-record .rec{display:flex;gap:10px;align-items:center;padding:8px 10px;margin:5px 0;border-radius:8px;border:1px solid var(--cm-panelEdge);background:rgba(255,255,255,.03)}
.cm-record .rec .res{width:44px;text-align:center;font-weight:800;border-radius:6px;padding:2px 0;font-size:12px}
.cm-record .rec .res.win{background:rgba(61,214,140,.2);color:#3DD68C}
.cm-record .rec .res.lose{background:rgba(229,72,77,.2);color:#E5484D}
.cm-record .rec .res.draw{background:rgba(255,200,87,.2);color:#FFC857}
.cm-record .rec .mid{flex:1;min-width:0}
.cm-record .rec .mid small{color:var(--cm-textDim)}
.cm-record .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(190px,1fr));gap:10px}
.cm-record .cx{padding:10px;border-radius:10px;border:1px solid var(--cm-panelEdge);background:rgba(255,255,255,.04);min-height:92px;position:relative}
.cm-record .cx.found{border-color:var(--cm-primary)}
.cm-record .cx.unk{opacity:.55}
.cm-record .cx b{display:block;margin-bottom:4px}
.cm-record .cx small{color:var(--cm-textDim);line-height:1.5;display:block}
.cm-record .cx .new{position:absolute;top:6px;right:8px;font-size:10px;font-weight:800;padding:1px 6px;border-radius:999px;background:#FFE29A;color:#222;animation:cm-recnew 1s infinite alternate}
@keyframes cm-recnew{from{opacity:.6}to{opacity:1}}
.cm-record .empty{padding:24px 8px;text-align:center;color:var(--cm-textDim)}
`;

const RESULT_TEXT = { win: NAMES.win, lose: NAMES.lose, draw: NAMES.draw };
const KIND_TEXT = { fusion: NAMES.fusion, transform: NAMES.transform };
const fmtDate = (s) => { const d = new Date(s); return Number.isNaN(d.getTime()) ? '' : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`; };

// 전적 요약 (순수 함수)
export function summarize(records = []) {
  const s = { total: records.length, win: 0, lose: 0, draw: 0 };
  for (const r of records) if (s[r.result] !== undefined) s[r.result]++;
  s.rate = s.total ? Math.round((s.win / s.total) * 100) : 0;
  return s;
}

export function createRecordUI({ root, onReplay = null } = {}) {
  ensureStyle(CSS, 'cm-record-style');
  const wrap = el('div', { class: 'cm-panel cm-record' });
  const tabs = el('div', { class: 'cm-tabs' });
  const body = el('div', { class: 'body cm-scroll' });
  wrap.append(el('h3', {}, `기록 · ${NAMES.codex}`), el('div', { class: 'top' }, tabs), body);
  root.append(wrap);

  let tab = 'record';
  let records = [];
  let codex = { total: 0, entries: [] };

  function render() {
    tabs.replaceChildren(...[['record', '전적'], ['codex', NAMES.codex]].map(([id, label]) => el('button', { type: 'button', class: `cm-tab${tab === id ? ' on' : ''}`, onClick: () => { tab = id; render(); } }, label)));
    clear(body);
    if (tab === 'record') {
      const s = summarize(records);
      body.append(el('div', { class: 'sum' }, ...[[s.win, NAMES.win], [s.lose, NAMES.lose], [s.draw, NAMES.draw], [`${s.rate}%`, '승률']].map(([v, l]) => el('div', {}, el('b', {}, v), el('small', {}, l)))));
      if (!records.length) body.append(el('div', { class: 'empty' }, `아직 ${NAMES.match} 기록이 없습니다`));
      for (const r of records) {
        body.append(el('div', { class: 'rec' },
          el('span', { class: `res ${r.result}` }, RESULT_TEXT[r.result] || r.result),
          el('div', { class: 'mid' }, el('b', {}, `vs ${r.opponent}`), el('small', {}, [r.league, r.round ? `${r.round}라운드` : '', r.myScore != null ? `${r.myScore} : ${r.oppScore}` : '', fmtDate(r.at)].filter(Boolean).join(' · '))),
          r.replayId && onReplay ? el('button', { type: 'button', class: 'cm-btn', onClick: () => onReplay(r) }, NAMES.replay) : null));
      }
    } else {
      const found = codex.entries || [];
      body.append(el('div', { class: 'sum' }, el('div', {}, el('b', {}, `${found.length}/${codex.total || found.length}`), el('small', {}, '발견한 항목'))));
      const grid = el('div', { class: 'grid' });
      for (const e of found) {
        grid.append(el('div', { class: 'cx found' },
          e.isNew ? el('span', { class: 'new' }, 'NEW') : null,
          el('b', {}, e.name), el('small', {}, `${KIND_TEXT[e.kind] || e.kind}${e.foundBy ? ` · 발견: ${e.foundBy}` : ''}`), el('small', {}, e.desc || '')));
      }
      for (let i = found.length; i < (codex.total || 0); i++) grid.append(el('div', { class: 'cx unk' }, el('b', {}, '???'), el('small', {}, '아직 밝혀지지 않았습니다')));
      body.append(grid);
      if (!found.length && !codex.total) body.append(el('div', { class: 'empty' }, '아직 밝혀진 것이 없습니다'));
    }
  }

  const api = {
    el: wrap,
    setRecords(list) { records = list || []; render(); },
    setCodex(c) { codex = { total: c?.total || 0, entries: c?.entries || [] }; render(); },
    showTab(t) { tab = t === 'codex' ? 'codex' : 'record'; render(); },
    destroy() { wrap.remove(); },
  };
  render();
  return api;
}

// web/editor/sim-lab/matchup-matrix.js  (124번)
// 매치업 매트릭스 화면: 원형 설계도 8종 × 8종 승률 열지도(행=선택, 열=상대), 평균 시간·무승부율, 평균 승률 65% 초과/35% 미만 강조. (명세 18-5)
//   createMatchupPanel({ store, runner, toast }) → 패널 { id:'lab', label, el, owns, search, onShow }
import { PRESETS } from '../../../data/presets.js';
import { createBatchRunner } from './batch-runner.js';
import { el, clear, ensureStyle } from '../../ui/dom.js';

const CSS = `
.mm-bar{display:flex;gap:8px;align-items:center;flex-wrap:wrap;margin:8px 0}
.mm-tbl{border-collapse:collapse;font-size:12px}
.mm-tbl th,.mm-tbl td{border:1px solid var(--cm-panelEdge);padding:5px 8px;text-align:center;min-width:56px}
.mm-tbl th{color:var(--cm-textDim);font-weight:600;white-space:nowrap}
.mm-tbl td.self{background:repeating-linear-gradient(45deg,transparent 0 4px,rgba(255,255,255,.05) 4px 8px)}
.mm-tbl .hi{outline:2px solid #ff6b3d;outline-offset:-2px;font-weight:700}
.mm-tbl .lo{outline:2px solid #4fc3f7;outline-offset:-2px;font-weight:700}
.mm-note{font-size:12px;color:var(--cm-textDim);margin:6px 0}
`;

export const heat = (p) => { // 0~1 → 파랑(약함) ~ 주황(강함), 0.5 는 투명
  if (p == null) return 'transparent';
  const t = Math.min(1, Math.abs(p - 0.5) * 2);
  return p >= 0.5 ? `rgba(255,140,60,${(t * 0.7).toFixed(2)})` : `rgba(79,195,247,${(t * 0.7).toFixed(2)})`;
};

export function createMatchupPanel({ store, runner = createBatchRunner(), toast = () => {}, ids = PRESETS.map((p) => p.id) }) {
  ensureStyle(CSS, 'ed-mm-style');
  const name = (id) => PRESETS.find((p) => p.id === id)?.name || id;
  const games = el('input', { class: 'cm-input', type: 'number', min: 2, max: 100, step: 2, value: 20, style: { width: '70px' } });
  const mapSel = el('select', { class: 'cm-input' }, ...['m1', 'm2', 'm3', 'm4', 'm5', 'm6', 'm7', 'm8'].map((m) => el('option', { value: m }, m)));
  const prog = el('span', { class: 'mm-note' }, '');
  const out = el('div', {});
  let abort = null;
  const go = el('button', { type: 'button', class: 'cm-btn primary', onClick: start }, '시험 시작');
  const stop = el('button', { type: 'button', class: 'cm-btn', onClick: () => abort?.abort() }, '중지');
  stop.disabled = true;
  const root = el('div', {},
    el('h2', {}, '매치업 분석'),
    el('p', { class: 'gd' }, '원형 설계도끼리 붙여 보며 저장 전 수치로 균형을 확인합니다. 쌍마다 절반씩 좌우를 바꿔 진행하며, 융합 레시피는 쓰지 않습니다.'),
    el('div', { class: 'mm-bar' }, el('span', {}, '쌍당 판 수'), games, el('span', {}, '전장'), mapSel, go, stop, prog), out);

  function draw(res) {
    clear(out);
    const th = (t) => el('th', {}, t);
    const head = el('tr', {}, th('선택＼상대'), ...ids.map((i) => th(name(i))), th('평균 승률'), th('무승부율'), th('평균 시간'));
    const rows = ids.map((x) => {
      const r = res.rows[x];
      const cls = r.winRate > 0.65 ? 'hi' : r.winRate < 0.35 ? 'lo' : '';
      return el('tr', {}, th(name(x)),
        ...ids.map((y) => {
          if (x === y) return el('td', { class: 'self' }, '—');
          const c = res.cells[x][y];
          return el('td', { style: { background: heat(c.winRate) }, title: `${c.win}승 ${c.draw}무 ${c.loss}패` }, c.winRate == null ? '' : `${Math.round(c.winRate * 100)}%`);
        }),
        el('td', { class: cls }, r.winRate == null ? '' : `${Math.round(r.winRate * 100)}%`),
        el('td', {}, r.drawRate == null ? '' : `${Math.round(r.drawRate * 100)}%`),
        el('td', {}, r.avgDuration == null ? '' : `${r.avgDuration.toFixed(0)}초`));
    });
    const bad = ids.filter((x) => res.rows[x].winRate > 0.65 || res.rows[x].winRate < 0.35).map((x) => `${name(x)} ${Math.round(res.rows[x].winRate * 100)}%`);
    out.append(el('table', { class: 'mm-tbl' }, head, ...rows),
      el('p', { class: 'mm-note' }, `${res.total}판 · ${(res.ms / 1000).toFixed(1)}초${res.cancelled ? ' · 중간에 멈춤' : ''}. 주황 테두리=65% 초과, 파랑 테두리=35% 미만. ${bad.length ? `쏠림: ${bad.join(', ')}` : '쏠림 없음'}`));
  }

  async function start() {
    const n = Math.max(2, Math.min(100, Math.round(+games.value || 20)));
    abort = new AbortController(); go.disabled = true; stop.disabled = false; prog.textContent = '준비 중…';
    try {
      const res = await runner.run({ ids, games: n, mapId: mapSel.value, balance: store.toData(), signal: abort.signal, onProgress: (d, t) => { prog.textContent = `${d} / ${t}`; } });
      draw(res); prog.textContent = '';
    } catch (e) { toast(`시험하지 못했습니다: ${e.message}`, 'error'); prog.textContent = ''; }
    go.disabled = false; stop.disabled = true; abort = null;
  }
  return { id: 'lab', label: '분석', el: root, searchable: false, owns: () => false, search() {}, onShow() {} };
}

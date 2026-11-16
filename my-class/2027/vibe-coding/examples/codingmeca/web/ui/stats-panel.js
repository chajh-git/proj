// web/ui/stats-panel.js  (61번)
// 격납고 오른쪽 능력치 패널. (명세 14-3)
//   무게·비용 게이지 / 전력 수지 / 체력 / 가속·최고속·선회 / 전장 적성 막대(지상·수중·공중·우주) /
//   센서 정보 / 무장 목록 / 노출도 보기 / 검증 메시지(오류·경고, 누르면 해당 파츠로 이동)
//   const panel = createStatsPanel({ root, onFocusPart, onExposureToggle });
//   panel.update(validation, { limits, exposure })   validation = validateDesign() 결과(18번)

import { CONSTANTS } from '../../config/constants.js';
import { ENV_LABEL, ALTITUDE_LABEL, GRADE_LABEL } from '../../config/names.js';
import { getPart } from '../../data/parts.js';
import { el, clear, gauge, ensureStyle, round1 } from './dom.js';

const CSS = `
.cm-stats{display:flex;flex-direction:column;min-height:0;height:100%}
.cm-stats .body{padding:6px 12px 12px;flex:1;min-height:0}
.cm-stats .sec{margin:12px 0 4px;font-size:11px;letter-spacing:.1em;color:var(--cm-textDim);border-bottom:1px solid var(--cm-panelEdge);padding-bottom:3px}
.cm-stats .kv{display:grid;grid-template-columns:auto 1fr;gap:3px 10px;font-size:12px}
.cm-stats .kv span{color:var(--cm-textDim)}
.cm-stats .kv b{font-weight:600;text-align:right}
.cm-apt{display:grid;grid-template-columns:34px 1fr 22px;align-items:center;gap:8px;margin:5px 0;font-size:12px}
.cm-apt .tr{height:7px;border-radius:4px;background:rgba(255,255,255,.08);overflow:hidden}
.cm-apt .fl{height:100%;border-radius:4px;background:var(--cm-primary)}
.cm-apt .gr{font-weight:800;text-align:center}
.cm-apt .gr.S{color:#FFD35A}.cm-apt .gr.A{color:#7CFF6B}.cm-apt .gr.B{color:#6BD0FF}.cm-apt .gr.C{color:#B8C2CF}.cm-apt .gr.D{color:#FF8A7A}
.cm-wp{font-size:12px;padding:3px 0;display:flex;justify-content:space-between;gap:8px}
.cm-wp i{font-style:normal;color:var(--cm-textDim)}
.cm-exp{display:grid;grid-template-columns:1fr 44px;gap:2px 8px;font-size:11px;margin-top:4px}
.cm-exp .nm{cursor:pointer}
.cm-exp .nm:hover{color:var(--cm-primary)}
.cm-exp .bar{height:6px;margin-top:5px;border-radius:3px;background:rgba(255,255,255,.08)}
.cm-exp .bar i{display:block;height:100%;border-radius:3px;background:linear-gradient(90deg,#FFB020,#FF4D4D)}
.cm-stats .row2{display:flex;gap:6px;flex-wrap:wrap;margin:4px 0}
`;

const SENSOR_LABEL = {
  enemy_distance: '적 거리', enemy_bearing: '적 방향', stealth_reveal: '은신 간파', enemy_energy_pct: '적 에너지', enemy_hp_pct: '적 체력',
  enemy_spirit: '적 투지', enemy_part_state: '적 파츠 상태', through_walls: '벽 너머 감지', underwater_detect: '수중 감지',
  enemy_stance_name: '적 태세 이름', ally_precise: '아군 정밀 정보', shared_vars: '변수 공유',
};
const ENV_ORDER = ['ground', 'water', 'air', 'space'];
const DIR_LABEL = { front: '정면', back: '후면', left: '좌측', right: '우측', up: '위', down: '아래' };

export function createStatsPanel({ root, onFocusPart = () => {}, onExposureToggle = () => {} } = {}) {
  ensureStyle(CSS, 'cm-stats-style');
  const wrap = el('div', { class: 'cm-panel cm-stats' });
  const body = el('div', { class: 'body cm-scroll' });
  wrap.append(el('h3', {}, '능력치'), body);
  root.append(wrap);

  let showExposure = false;
  let dir = 'overall';
  let last = null;

  function render() {
    if (!last) return;
    const { v, limits, exposure } = last;
    clear(body);
    const s = v.stats;
    const L = limits || CONSTANTS.limits;

    // 검증 메시지
    const msgs = el('div');
    if (!v.errors.length && !v.warnings.length) msgs.append(el('div', { class: 'cm-msg ok' }, '문제 없음 — 출전할 수 있는 기체입니다'));
    for (const m of v.errors) msgs.append(el('div', { class: 'cm-msg error', 'data-uid': m.uid || null, onClick: () => m.uid && onFocusPart(m.uid) }, m.message));
    for (const m of v.warnings) msgs.append(el('div', { class: 'cm-msg warning', 'data-uid': m.uid || null, onClick: () => m.uid && onFocusPart(m.uid) }, m.message));
    body.append(msgs);
    if (!s) return;

    // 한도 게이지
    const pc = s.pilotCost || 0;
    body.append(
      gauge({ label: '무게', value: s.weight, max: L.weightCap, over: s.weight > L.weightCap, warn: s.weight > L.weightCap * 0.9 }),
      gauge({ label: '비용', value: s.cost, max: L.budget, over: s.cost > L.budget, warn: s.cost > L.budget * 0.9, text: `${s.cost} / ${L.budget}`, hint: `파츠 ${s.partsCost} + 조종사 ${pc}` }),
      el('div', { class: 'row2' }, el('span', { class: 'cm-chip' }, `파츠 ${s.partsCost}`), el('span', { class: 'cm-chip' }, `조종사 ${pc}`), el('span', { class: 'cm-chip' }, `${s.partCount}개 파츠`)));

    // 전력 수지
    const pw = s.power;
    body.append(el('div', { class: 'sec' }, '전력'),
      gauge({ label: '최대 소모 / 출력', value: pw.peakDraw, max: pw.output, over: pw.peakDraw > pw.output, text: `${round1(pw.peakDraw)} / ${pw.output}`, hint: '동시에 전부 쓸 때의 소모' }),
      el('div', { class: 'kv' }, el('span', {}, '대기 소모'), el('b', {}, round1(pw.idleDraw)), el('span', {}, '에너지 용량'), el('b', {}, pw.capacity), el('span', {}, '이동 소모'), el('b', {}, round1(pw.moveEnergy))));

    // 기본 능력
    const m = s.move;
    body.append(el('div', { class: 'sec' }, '기본 능력'),
      el('div', { class: 'kv' },
        el('span', {}, '체력'), el('b', {}, s.hp),
        el('span', {}, '가속'), el('b', {}, m.canMove ? round1(m.accel) : '—'),
        el('span', {}, '최고속'), el('b', {}, m.canMove ? round1(m.maxSpeed) : '—'),
        el('span', {}, '선회'), el('b', {}, m.canMove ? `${Math.round(m.turn)}°/초` : '—'),
        el('span', {}, '최대 고도'), el('b', {}, ALTITUDE_LABEL[m.maxAltitude] || m.maxAltitude),
        el('span', {}, '투지 최대'), el('b', {}, s.spirit.max),
        el('span', {}, '쏠림'), el('b', { title: '추력 중심과 무게 중심이 어긋난 정도(작을수록 안정)' }, round1(m.comDeviation))));

    // 전장 적성
    body.append(el('div', { class: 'sec' }, '전장 적성'));
    for (const e of ENV_ORDER) {
      const a = s.aptitude[e];
      body.append(el('div', { class: 'cm-apt', title: `속도 배율 ×${a.mult}` }, el('span', {}, ENV_LABEL[e] || e),
        el('div', { class: 'tr' }, el('div', { class: 'fl', style: { width: `${Math.round(a.mult * 100)}%` } })),
        el('span', { class: `gr ${a.grade}` }, GRADE_LABEL[a.grade] || a.grade)));
    }

    // 센서
    body.append(el('div', { class: 'sec' }, '센서'));
    if (s.sensors.info.length) {
      body.append(el('div', { class: 'row2' }, ...s.sensors.info.map((i) => el('span', { class: 'cm-chip' }, SENSOR_LABEL[i] || i))), el('div', { class: 'kv' }, el('span', {}, '감지 범위'), el('b', {}, `${s.sensors.range}m`)));
    } else body.append(el('div', { class: 'cm-msg warning' }, '센서가 없습니다. 상대의 거리 구간(가까움·보통·멂)과 대략적인 방향만 알 수 있습니다.'));

    // 무장
    body.append(el('div', { class: 'sec' }, '무장'));
    if (!s.weapons.length) body.append(el('div', { class: 'cm-msg warning' }, '무기가 없습니다'));
    for (const w of s.weapons) body.append(el('div', { class: 'cm-wp' }, el('span', {}, getPart(w.id).name), el('i', {}, `${w.range}m · 초당 ${round1(w.dps)}`)));

    // 노출도
    body.append(el('div', { class: 'sec' }, '노출도'));
    body.append(el('button', { class: 'cm-btn', type: 'button', onClick: () => { showExposure = !showExposure; onExposureToggle(showExposure); render(); } }, showExposure ? '노출도 닫기' : '노출도 보기'));
    if (showExposure && exposure) {
      const dirs = ['overall', ...Object.keys(exposure.perDirection || {})];
      body.append(el('div', { class: 'cm-tabs', style: { margin: '8px 0 4px' } }, ...dirs.map((d) => el('button', { type: 'button', class: `cm-tab${d === dir ? ' on' : ''}`, onClick: () => { dir = d; render(); } }, d === 'overall' ? '전체' : DIR_LABEL[d] || d))));
      const table = dir === 'overall' ? exposure.overall : exposure.perDirection[dir];
      const rows = Object.entries(table || {}).sort((a, b) => b[1] - a[1]).slice(0, 12);
      const grid = el('div', { class: 'cm-exp' });
      for (const [uid, val] of rows) {
        const nm = v.tree.nodes.get(uid)?.def.name || uid;
        grid.append(el('div', { class: 'nm', onClick: () => onFocusPart(uid) }, nm, el('div', { class: 'bar' }, el('i', { style: { width: `${Math.min(100, Math.round(val * 100 * 3))}%` } }))), el('div', { style: { textAlign: 'right' } }, `${Math.round(val * 100)}%`));
      }
      body.append(grid, el('div', { class: 'cm-msg', style: { color: 'var(--cm-textDim)' } }, '값이 클수록 그 방향에서 맞기 쉬운 파츠입니다.'));
    }
  }

  return {
    el: wrap,
    update(validation, { limits = null, exposure = null } = {}) {
      last = { v: validation, limits, exposure };
      render();
    },
    get exposureOn() { return showExposure; },
    destroy() { wrap.remove(); },
  };
}

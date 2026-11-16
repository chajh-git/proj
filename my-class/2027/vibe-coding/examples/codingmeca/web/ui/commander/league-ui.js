// web/ui/commander/league-ui.js  (91번)
// 지휘 본부 · 리그 관리: 리그 만들기·설정, 출전 등록 현황, 대진 만들기, 수동 매치 추가, 밸런스 새 버전 반영. (명세 13장)
//   const ui = createLeagueUI({ root, net, toast, onSelect });
//   ui.refresh()   // 목록 다시 읽기
//   ui.selected    // 지금 고른 리그 id
// 모든 검사는 서버가 다시 한다(리그 설정 범위, 대진 중복 생성 거절 등). 여기는 입력을 편하게 해 주는 화면이다.

import { MAPS, MAP_SELECT_MODES } from '../../../data/maps.js';
import { CONSTANTS } from '../../../config/constants.js';
import { el, clear, ensureStyle } from '../dom.js';
import { COMMON_CSS, field, numInput, textInput, selectInput, check, call } from './kit.js';
import { statusLabel, teamName } from '../scoreboard.js';

const FORMATS = [['roundrobin', '리그전(라운드 로빈)'], ['single', '싱글 토너먼트'], ['double', '더블 토너먼트'], ['manual', '수동 매치']];
const SEEDS = [['registration', '등록 순서'], ['random', '무작위'], ['manual', '직접 지정']];

export function createLeagueUI({ root, net, toast, onSelect = () => {} } = {}) {
  ensureStyle(COMMON_CSS, 'cm-cmd-style');
  const wrap = el('div', { class: 'cm-panel cm-cmd' });
  const listBox = el('div', { class: 'list' });
  const detail = el('div', { class: 'cm-scroll', style: { minHeight: 0, overflow: 'auto' } });
  wrap.append(el('h3', {}, '리그 관리'), el('div', { class: 'bd' }, el('div', { class: 'split' }, listBox, detail)));
  root.append(wrap);

  let leagues = [];
  let selected = null; // 리그 id | 'new'
  let view = null;
  const teams = new Map(); // id → {name,color}

  async function refresh() {
    const d = await call(net, toast, 'leagues.all');
    if (!d) return;
    leagues = d;
    drawList();
    if (selected && selected !== 'new') await openLeague(selected, false);
  }

  function drawList() {
    clear(listBox);
    listBox.append(el('button', { type: 'button', class: `cm-btn item primary${selected === 'new' ? ' on' : ''}`, onClick: () => { selected = 'new'; view = null; drawList(); drawForm(null); } }, '＋ 새 리그'));
    for (const l of leagues) listBox.append(el('button', { type: 'button', class: `cm-btn item${selected === l.id ? ' on' : ''}`, onClick: () => openLeague(l.id) }, el('span', {}, l.name), el('small', {}, statusLabel(l.status))));
    if (!leagues.length) listBox.append(el('p', { style: { color: 'var(--cm-textDim)', fontSize: '13px' } }, '아직 리그가 없습니다.'));
  }

  async function openLeague(id, redraw = true) {
    selected = id;
    const r = await net.request('league.view', { leagueId: id });
    if (!r.ok) { toast(r.error, 'error'); return; }
    view = r.data;
    for (const [k, v] of Object.entries(view.teams || {})) teams.set(k, v);
    if (redraw) drawList();
    onSelect(id, view);
    drawForm(leagues.find((l) => l.id === id));
  }

  // 설정 양식
  function drawForm(l) {
    clear(detail);
    const c = l?.config || {};
    const isNew = !l;
    const locked = !isNew && l.status !== 'open'; // 진행 중에는 형식·팀 크기를 바꿀 수 없다
    const f = {
      name: textInput(c.name || '', { max: 30, placeholder: '예: 2학년 교내 리그' }),
      teamSize: selectInput([[1, '1 vs 1'], [2, '2 vs 2'], [3, '3 vs 3']], c.teamSize || 1),
      weightCap: numInput(c.weightCap ?? CONSTANTS.limits.weightCap, { min: 1, max: 9999 }),
      budget: numInput(c.budget ?? CONSTANTS.limits.budget, { min: 1, max: 99999 }),
      matchSeconds: numInput(c.matchSeconds ?? CONSTANTS.time.matchSeconds, { min: 30, max: 600, step: 10 }),
      mapMode: selectInput(Object.entries(MAP_SELECT_MODES), c.mapMode || 'fixed'),
      format: selectInput(FORMATS, c.format || 'roundrobin'),
      seedMode: selectInput(SEEDS, c.seedMode || 'registration'),
      win: numInput(c.points?.win ?? 3, { min: 0, max: 99, width: '60px' }),
      draw: numInput(c.points?.draw ?? 1, { min: 0, max: 99, width: '60px' }),
      loss: numInput(c.points?.loss ?? 0, { min: 0, max: 99, width: '60px' }),
      concurrent: numInput(c.concurrent ?? CONSTANTS.league.concurrentMatches, { min: 1, max: 4, width: '60px' }),
    };
    if (locked) { f.teamSize.disabled = true; f.format.disabled = true; }
    const maint = check('경기 사이 정비 허용', c.maintenance ?? CONSTANTS.league.allowRepairBetweenMatches);
    const codex = check('도감 공개(발견 즉시 모두에게)', c.codexPublic);
    const mapsPub = check('전장을 미리 공개', c.mapsPublic !== false);
    const pool = new Set(c.mapPool?.length ? c.mapPool : [MAPS[0].id]);
    const mapChecks = MAPS.map((m) => ({ id: m.id, ...check(m.name, pool.has(m.id)) }));

    const collect = () => ({
      name: f.name.value, teamSize: Number(f.teamSize.value), weightCap: Number(f.weightCap.value), budget: Number(f.budget.value),
      matchSeconds: Number(f.matchSeconds.value), mapMode: f.mapMode.value, mapPool: mapChecks.filter((x) => x.input.checked).map((x) => x.id),
      mapsPublic: mapsPub.input.checked, format: f.format.value, seedMode: f.seedMode.value,
      points: { win: Number(f.win.value), draw: Number(f.draw.value), loss: Number(f.loss.value) },
      maintenance: maint.input.checked, codexPublic: codex.input.checked, concurrent: Number(f.concurrent.value),
    });

    detail.append(
      el('div', { class: 'sec' }, isNew ? '새 리그 설정' : '리그 설정'),
      field('리그 이름', f.name),
      el('div', { class: 'grid2' }, field('팀 크기', f.teamSize), field('기체당 무게 상한', f.weightCap), field('기체당 예산', f.budget), field('제한 시간(초)', f.matchSeconds), field('동시 경기 수', f.concurrent)),
      el('div', { class: 'sec' }, '전장'),
      el('div', {}, mapChecks.map((x) => x.node)),
      el('div', { class: 'grid2' }, field('선택 방식', f.mapMode)),
      el('div', {}, mapsPub.node),
      el('div', { class: 'sec' }, '진행 방식'),
      el('div', { class: 'grid2' }, field('형식', f.format), field('시드(토너먼트)', f.seedMode)),
      el('div', { class: 'cm-row' }, el('span', { style: { fontSize: '12px' } }, '승점'), '승', f.win, '무', f.draw, '패', f.loss),
      el('div', { style: { marginTop: '8px' } }, maint.node, codex.node),
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'cm-btn primary', onClick: async () => {
          const body = collect();
          const d = isNew ? await call(net, toast, 'league.create', { config: body }, '리그를 만들었습니다') : await call(net, toast, 'league.update', { leagueId: l.id, patch: body }, '저장했습니다');
          if (d) { await refresh(); if (isNew) await openLeague(d.id); }
        } }, isNew ? '리그 만들기' : '설정 저장')));

    if (!isNew && view) detail.append(...manageBlock(l));
  }

  // 등록 현황 · 대진 · 수동 매치 · 밸런스
  function manageBlock(l) {
    const reg = new Set(view.registered || []);
    const out = [el('div', { class: 'sec' }, `관람 코드 ${l.code}   ·   밸런스 버전 ${l.balance}`)];
    const rows = Object.keys(view.teams).map((id) => el('tr', {}, el('td', {}, el('span', { style: { display: 'inline-block', width: '9px', height: '9px', borderRadius: '50%', background: view.teams[id].color, marginRight: '6px' } }), teamName(view, id)), el('td', {}, reg.has(id) ? '등록함' : '미등록'),
      el('td', {}, reg.has(id) && l.status === 'open' ? el('button', { type: 'button', class: 'cm-btn', onClick: async () => { if (await call(net, toast, 'league.withdraw', { leagueId: l.id, teamId: id }, '등록을 취소했습니다')) openLeague(l.id); } }, '등록 취소') : null)));
    out.push(el('div', { class: 'sec' }, '출전 등록 현황'), el('table', {}, el('thead', {}, el('tr', {}, el('th', {}, '팀'), el('th', {}, '상태'), el('th', {}))), el('tbody', {}, rows)));
    const acts = el('div', { class: 'actions' });
    const hasMatches = view.matches.length > 0;
    if (!hasMatches) acts.append(el('button', { type: 'button', class: 'cm-btn primary', onClick: async () => { if (await call(net, toast, 'schedule.generate', { leagueId: l.id }, '대진을 만들었습니다')) { await refresh(); } } }, '대진 만들기'));
    acts.append(el('button', { type: 'button', class: 'cm-btn', title: '리그 생성 때 고정된 밸런스 대신 최신 버전을 쓰도록 바꿉니다', onClick: () => call(net, toast, 'league.refresh_balance', { leagueId: l.id }, '새 밸런스 버전으로 갱신했습니다').then(refresh) }, '새 버전으로 갱신'));
    out.push(acts);
    // 수동 매치
    if (hasMatches || l.config.format === 'manual') {
      const ids = Object.keys(view.teams);
      const a = el('select', { class: 'cm-input' }, ids.map((id) => el('option', { value: id }, teamName(view, id))));
      const b = el('select', { class: 'cm-input' }, ids.map((id) => el('option', { value: id }, teamName(view, id))));
      if (ids.length > 1) b.selectedIndex = 1;
      out.push(el('div', { class: 'sec' }, '수동 매치 추가'), el('div', { class: 'cm-row' }, a, 'vs', b, el('button', { type: 'button', class: 'cm-btn', onClick: async () => { if (await call(net, toast, 'match.add', { leagueId: l.id, teamA: a.value, teamB: b.value }, '매치를 추가했습니다')) openLeague(l.id); } }, '추가')));
    }
    return out;
  }

  drawList();
  drawForm(null);
  return {
    refresh, el: wrap, setVisible(on) { wrap.style.display = on ? '' : 'none'; },
    get selected() { return selected === 'new' ? null : selected; },
    reopen: () => (selected && selected !== 'new' ? openLeague(selected, false) : refresh()),
    destroy() { wrap.remove(); },
  };
}

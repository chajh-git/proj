// web/ui/roster-ui.js  (69번)
// 출전 등록: 리그를 고르고, 내가 저장한 기체 중 n기를 골라 출전 순서를 정해 등록한다. (명세 4-3, 13장)
//   등록하는 순간 설계·전술·조종사의 '스냅샷'이 만들어지고, 경기 중에는 바꿀 수 없다(서버가 잠금).
//   이 화면은 한도 검사와 안내까지만 하고, 저장은 onRegister 콜백(서버 연결은 hangar-main)이 한다.
//
//   const ui = createRosterUI({ root, onRegister, onOpenHangar });
//   ui.setLeagues([{ id, name, teamSize, weightCap, budget, status:'open'|'locked', registered:[robotId...] }])
//   ui.setRobots([{ id, name, design, tactics }])     // 내 기체 목록(robots 테이블)
//   ui.setBusy(bool) / ui.setMessage(text, kind)
//   onRegister({ leagueId, robots:[{ robotId, name, design, tactics }] }) → Promise<{ok, error?}> 를 돌려주면 결과 안내를 띄운다.

import { validateDesign } from '../../shared/build/validator.js';
import { validateTactics } from '../../shared/tactics/validator.js';
import { CONSTANTS } from '../../config/constants.js';
import { NAMES } from '../../config/names.js';
import { el, clear, ensureStyle } from './dom.js';

const CSS = `
.cm-roster{display:grid;grid-template-columns:minmax(220px,300px) 1fr;gap:10px;height:100%;min-height:0}
.cm-roster .col{display:flex;flex-direction:column;min-height:0}
.cm-roster .col .body{flex:1;min-height:0;padding:8px 10px}
.cm-roster .lg{display:block;width:100%;text-align:left;margin:6px 0;padding:8px 10px;border-radius:8px;border:1px solid var(--cm-panelEdge);background:rgba(255,255,255,.03);color:var(--cm-text);font:inherit;cursor:pointer}
.cm-roster .lg:hover:not(:disabled){border-color:var(--cm-primary)}
.cm-roster .lg.on{border-color:var(--cm-primary);background:rgba(255,255,255,.1);box-shadow:0 0 0 1px var(--cm-primary) inset}
.cm-roster .lg:disabled{opacity:.45;cursor:not-allowed}
.cm-roster .lg b{display:block}
.cm-roster .lg small{color:var(--cm-textDim);line-height:1.5}
.cm-roster .rb{display:flex;gap:8px;align-items:center;margin:6px 0;padding:8px 10px;border-radius:8px;border:1px solid var(--cm-panelEdge);background:rgba(255,255,255,.03)}
.cm-roster .rb.on{border-color:var(--cm-primary);background:rgba(255,255,255,.09)}
.cm-roster .rb.bad{opacity:.55}
.cm-roster .rb .nm{flex:1;min-width:0}
.cm-roster .rb .nm b{display:block;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-roster .rb .nm small{color:var(--cm-textDim)}
.cm-roster .rb .ord{width:24px;height:24px;border-radius:50%;background:var(--cm-primary);color:var(--cm-bg);font-weight:800;display:flex;align-items:center;justify-content:center;font-size:12px}
.cm-roster .sum{margin:8px 0;font-size:12px;color:var(--cm-textDim)}
.cm-roster .empty{padding:18px 8px;text-align:center;color:var(--cm-textDim)}
.cm-roster .foot{padding:10px;border-top:1px solid var(--cm-panelEdge);display:flex;gap:8px;align-items:center;flex-wrap:wrap}
.cm-roster .foot .cm-msg{flex:1;margin:0}
@media (max-width:760px){.cm-roster{grid-template-columns:1fr;overflow:auto}}
`;

const clone = (o) => JSON.parse(JSON.stringify(o));

// 기체 한 대를 리그 한도로 검사 → { ok, reasons[], weight, cost }
export function checkRobotForLeague(robot, league) {
  const limits = { weightCap: league?.weightCap ?? CONSTANTS.limits.weightCap, budget: league?.budget ?? CONSTANTS.limits.budget };
  const design = robot.design || {};
  const v = validateDesign(design, { limits });
  const reasons = v.errors.map((e) => e.message);
  const tactics = robot.tactics || design.tactics;
  let tacticsIssues = 0;
  if (!tactics) reasons.push('전술이 아직 없습니다');
  else tacticsIssues = validateTactics(tactics, { design }).errors.length;
  return { ok: v.ok && !!tactics, reasons, weight: v.stats?.weight ?? 0, cost: v.stats?.cost ?? 0, tacticsIssues, limits };
}

export function createRosterUI({ root, onRegister = async () => ({ ok: true }), onOpenHangar = null } = {}) {
  ensureStyle(CSS, 'cm-roster-style');
  const wrap = el('div', { class: 'cm-roster' });
  const colL = el('div', { class: 'cm-panel col' });
  const colR = el('div', { class: 'cm-panel col' });
  const bodyL = el('div', { class: 'body cm-scroll' });
  const bodyR = el('div', { class: 'body cm-scroll' });
  const foot = el('div', { class: 'foot' });
  colL.append(el('h3', {}, `${NAMES.league} 고르기`), bodyL);
  colR.append(el('h3', {}, NAMES.roster), bodyR, foot);
  wrap.append(colL, colR);
  root.append(wrap);

  let leagues = [];
  let robots = [];
  let leagueId = null;
  let picked = []; // 출전 순서대로 robotId
  let busy = false;
  let msg = null;

  const league = () => leagues.find((l) => l.id === leagueId) || null;
  const checks = () => new Map(robots.map((r) => [r.id, checkRobotForLeague(r, league())]));

  function choose(id) {
    const l = leagues.find((x) => x.id === id);
    if (!l || l.status !== 'open') return;
    leagueId = id;
    picked = (l.registered || []).filter((rid) => robots.some((r) => r.id === rid)).slice(0, l.teamSize);
    msg = l.registered?.length ? { text: '이미 등록한 명단이 있습니다. 다시 등록하면 바뀝니다.', kind: 'warning' } : null;
    render();
  }

  function toggle(id) {
    const l = league();
    if (!l) return;
    if (picked.includes(id)) picked = picked.filter((x) => x !== id);
    else if (picked.length < l.teamSize) picked = [...picked, id];
    else msg = { text: `이 ${NAMES.league}는 ${l.teamSize}기까지 출전합니다`, kind: 'warning' };
    render();
  }

  function move(id, dir) {
    const i = picked.indexOf(id);
    const j = i + dir;
    if (i < 0 || j < 0 || j >= picked.length) return;
    [picked[i], picked[j]] = [picked[j], picked[i]];
    render();
  }

  async function submit() {
    const l = league();
    if (!l || busy) return;
    const list = picked.map((id) => robots.find((r) => r.id === id)).filter(Boolean).map((r) => ({
      robotId: r.id, name: r.name || r.design?.name, design: clone(r.design), tactics: clone(r.tactics || r.design?.tactics),
    }));
    busy = true; msg = { text: '등록하는 중…', kind: 'ok' }; render();
    let res;
    try { res = await onRegister({ leagueId: l.id, robots: list }); } catch (e) { res = { ok: false, error: String(e?.message || e) }; }
    busy = false;
    if (res?.ok === false) msg = { text: res.error || '등록하지 못했습니다', kind: 'error' };
    else {
      msg = { text: '출전 등록을 마쳤습니다. 경기가 시작되면 명단은 잠깁니다.', kind: 'ok' };
      l.registered = list.map((x) => x.robotId);
    }
    render();
  }

  function render() {
    const l = league();
    const ck = checks();
    // 리그
    clear(bodyL);
    if (!leagues.length) bodyL.append(el('div', { class: 'empty' }, `등록할 수 있는 ${NAMES.league}가 없습니다`));
    for (const g of leagues) {
      bodyL.append(el('button', { type: 'button', class: `lg${g.id === leagueId ? ' on' : ''}`, disabled: g.status !== 'open', onClick: () => choose(g.id) },
        el('b', {}, g.name),
        el('small', {}, `${g.teamSize}기 출전 · 무게 ${g.weightCap} · 예산 ${g.budget}`, g.registered?.length ? ' · 등록됨' : '', g.status !== 'open' ? ' · 마감' : '')));
    }
    // 기체
    clear(bodyR);
    if (!l) bodyR.append(el('div', { class: 'empty' }, `왼쪽에서 ${NAMES.league}를 먼저 고르세요`));
    else if (!robots.length) {
      bodyR.append(el('div', { class: 'empty' }, '저장한 기체가 없습니다', onOpenHangar ? el('div', { style: { marginTop: '10px' } }, el('button', { type: 'button', class: 'cm-btn primary', onClick: onOpenHangar }, `${NAMES.hangar}로 가기`)) : null));
    } else {
      bodyR.append(el('div', { class: 'sum' }, `${l.teamSize}기를 고르세요 (선택한 순서가 출전 순서입니다). 한도: 무게 ${l.weightCap} · 예산 ${l.budget}`));
      for (const r of robots) {
        const c = ck.get(r.id);
        const idx = picked.indexOf(r.id);
        const row = el('div', { class: `rb${idx >= 0 ? ' on' : ''}${c.ok ? '' : ' bad'}`, 'data-robot': r.id },
          idx >= 0 ? el('span', { class: 'ord' }, idx + 1) : el('span', { class: 'ord', style: { background: 'transparent', border: '1px dashed var(--cm-panelEdge)', color: 'var(--cm-textDim)' } }, '·'),
          el('div', { class: 'nm' }, el('b', {}, r.name || r.design?.name || '이름 없음'), el('small', {}, c.ok ? `무게 ${Math.round(c.weight * 10) / 10} · 비용 ${c.cost}${c.tacticsIssues ? ` · 전술 경고 ${c.tacticsIssues}` : ''}` : c.reasons[0] || '출전할 수 없습니다')),
          idx >= 0 ? el('span', {}, el('button', { type: 'button', class: 'cm-btn', disabled: idx === 0, onClick: () => move(r.id, -1), 'aria-label': '앞으로' }, '▲'), el('button', { type: 'button', class: 'cm-btn', disabled: idx === picked.length - 1, onClick: () => move(r.id, 1), 'aria-label': '뒤로' }, '▼')) : null,
          el('button', { type: 'button', class: `cm-btn${idx >= 0 ? '' : ' primary'}`, disabled: !c.ok, onClick: () => toggle(r.id) }, idx >= 0 ? '빼기' : '고르기'));
        bodyR.append(row);
      }
    }
    // 아래 줄
    clear(foot);
    if (msg) foot.append(el('div', { class: `cm-msg ${msg.kind}` }, msg.text));
    else foot.append(el('div', { class: 'cm-msg', style: { color: 'var(--cm-textDim)' } }, l ? `${picked.length}/${l.teamSize}기 선택` : ''));
    const ready = l && picked.length === l.teamSize && !busy;
    foot.append(el('button', { type: 'button', class: 'cm-btn primary', disabled: !ready, onClick: submit }, '출전 등록'));
  }

  const api = {
    el: wrap,
    setLeagues(list) { leagues = list || []; if (leagueId && !leagues.some((l) => l.id === leagueId)) leagueId = null; if (!leagueId) { const first = leagues.find((l) => l.status === 'open'); if (leagues.length === 1 && first) { choose(first.id); return; } } render(); },
    setRobots(list) { robots = list || []; picked = picked.filter((id) => robots.some((r) => r.id === id)); render(); },
    setBusy(b) { busy = !!b; render(); },
    setMessage(text, kind = 'ok') { msg = text ? { text, kind } : null; render(); },
    get picked() { return [...picked]; },
    choose, toggle,
    destroy() { wrap.remove(); },
  };
  render();
  return api;
}

// web/ui/hud.js  (67번)
// 경기 화면 위에 얹는 정보창: 팀별 기체 카드(체력·에너지·투지·게이지·상태), 남은 시간, 카운트다운,
// 전장 이벤트 예고, 사건 알림(쓰러짐·부활·오버드라이브·각성기·융합·연장), 결과 배너. (명세 14-5)
// 관제 스크린·시험 사격장·연습전이 함께 쓴다. 장면(3D)과 무관하게 스냅샷만 받는다.
//
//   const hud = createHud({ root, teamNames });
//   hud.setMatch(initInfo, { teamNames: { A:'가람', B:'나래' } })   // makeInitInfo() 결과
//   hud.update(snapshot)                                             // 스냅샷마다(또는 재생 시각마다) 호출
//   hud.pushEvents(snapshot.ev)                                      // 사건 알림(재생 시각을 지난 스냅샷의 ev를 한 번씩)
//   hud.showResult(result) / hud.clearResult() / hud.reset() / hud.setVisible(bool)

import { CONSTANTS } from '../../config/constants.js';
import { EFFECT_COLORS } from '../../config/theme.js';
import { NAMES } from '../../config/names.js';
import { PILOT_SKILLS } from '../../data/pilot-skills.js';
import { el, clear, ensureStyle } from './dom.js';

const FLAG = { stealth: 1, shield: 2, emp: 4, immobilized: 8, invuln: 16, rush: 32, transform: 64 };
const FLAG_TEXT = [[FLAG.stealth, '은신'], [FLAG.shield, '실드'], [FLAG.emp, 'EMP'], [FLAG.immobilized, '제압'], [FLAG.invuln, '무적'], [FLAG.rush, '돌진'], [FLAG.transform, '변신']];
const WARN_TEXT = { meteor: '운석 낙하', spikes: '바닥 함정', emp: 'EMP 폭풍', shrink: '전장 축소', hazard: '위험구역' };
const REASON_TEXT = { knockout: '상대 전멸', time: '시간 종료 — 남은 체력 비율', extension: '연장전 결착', draw: '연장까지 승부가 나지 않음', mutual_ko: '동시에 쓰러짐', aborted: '경기 중단' };

const CSS = `
.cm-hud{position:absolute;inset:0;pointer-events:none;font-size:13px;color:var(--cm-text);z-index:4}
.cm-hud .top{position:absolute;top:10px;left:50%;transform:translateX(-50%);display:flex;align-items:stretch;gap:0;border-radius:10px;overflow:hidden;border:1px solid var(--cm-panelEdge);background:color-mix(in srgb,var(--cm-panel) 82%,transparent);backdrop-filter:blur(6px)}
.cm-hud .top .tm{padding:6px 14px;font-weight:700;font-size:14px;max-width:180px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-hud .top .tm.A{color:${EFFECT_COLORS.teamA}}
.cm-hud .top .tm.B{color:${EFFECT_COLORS.teamB}}
.cm-hud .top .clock{padding:4px 14px;text-align:center;border-left:1px solid var(--cm-panelEdge);border-right:1px solid var(--cm-panelEdge);min-width:78px}
.cm-hud .top .clock b{display:block;font-size:20px;letter-spacing:.06em;font-variant-numeric:tabular-nums}
.cm-hud .top .clock small{font-size:10px;color:var(--cm-textDim)}
.cm-hud .top .clock.ext b{color:#FFC857}
.cm-hud .side{position:absolute;top:64px;display:flex;flex-direction:column;gap:6px;width:min(220px,28vw)}
.cm-hud .side.A{left:10px}
.cm-hud .side.B{right:10px;align-items:flex-end}
.cm-hud .ecard{width:100%;box-sizing:border-box;padding:6px 9px;border-radius:9px;border:1px solid var(--cm-panelEdge);background:color-mix(in srgb,var(--cm-panel) 82%,transparent);backdrop-filter:blur(6px);transition:opacity .3s}
.cm-hud .side.A .ecard{border-left:4px solid ${EFFECT_COLORS.teamA}}
.cm-hud .side.B .ecard{border-right:4px solid ${EFFECT_COLORS.teamB}}
.cm-hud .ecard.dead{opacity:.45}
.cm-hud .ecard .nm{display:flex;justify-content:space-between;gap:6px;font-weight:700}
.cm-hud .ecard .nm small{font-weight:400;color:var(--cm-textDim);overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.cm-hud .bar{height:7px;border-radius:4px;background:rgba(255,255,255,.1);margin-top:4px;overflow:hidden}
.cm-hud .bar i{display:block;height:100%;border-radius:4px;transition:width .12s}
.cm-hud .bar.thin{height:4px;margin-top:3px}
.cm-hud .row{display:flex;gap:4px;align-items:center;margin-top:4px;font-size:11px;color:var(--cm-textDim)}
.cm-hud .row b{color:var(--cm-text);font-weight:600}
.cm-hud .fl{display:flex;gap:3px;flex-wrap:wrap;margin-top:3px;min-height:14px}
.cm-hud .fl span{font-size:10px;padding:0 5px;border-radius:999px;background:rgba(255,255,255,.14)}
.cm-hud .pt{display:flex;gap:2px;margin-top:3px;flex-wrap:wrap}
.cm-hud .pt i{width:7px;height:7px;border-radius:2px;background:#58d38c}
.cm-hud .pt i.s1{background:#E5484D}.cm-hud .pt i.s2{background:#444;opacity:.6}.cm-hud .pt i.s3{background:#B58CFF}
.cm-hud .count{position:absolute;top:34%;left:50%;transform:translate(-50%,-50%);font-size:min(22vw,140px);font-weight:900;color:#fff;text-shadow:0 0 28px var(--cm-primary);opacity:0;transition:opacity .15s}
.cm-hud .count.on{opacity:1}
.cm-hud .warn{position:absolute;top:60px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:4px;align-items:center}
.cm-hud .warn div{padding:3px 12px;border-radius:999px;background:rgba(229,72,77,.82);font-weight:700;font-size:12px;color:#fff;animation:cm-hudblink .8s infinite alternate}
@keyframes cm-hudblink{from{opacity:.65}to{opacity:1}}
.cm-hud .feed{position:absolute;bottom:14px;left:50%;transform:translateX(-50%);display:flex;flex-direction:column;gap:4px;align-items:center;width:min(520px,90vw)}
.cm-hud .feed div{padding:4px 12px;border-radius:8px;background:rgba(0,0,0,.6);font-size:12px;animation:cm-hudin .25s}
.cm-hud .feed div.ko{background:rgba(229,72,77,.75)}
.cm-hud .feed div.big{background:color-mix(in srgb,var(--cm-primary) 55%,#000);font-weight:700}
@keyframes cm-hudin{from{opacity:0;transform:translateY(8px)}to{opacity:1;transform:none}}
.cm-hud .result{position:absolute;inset:0;display:none;align-items:center;justify-content:center;flex-direction:column;gap:8px;background:rgba(0,0,0,.45);pointer-events:auto}
.cm-hud .result.on{display:flex}
.cm-hud .result h2{margin:0;font-size:min(9vw,56px);letter-spacing:.08em;text-shadow:0 0 24px var(--cm-primary)}
.cm-hud .result p{margin:0;color:var(--cm-textDim)}
.cm-hud .result table{border-collapse:collapse;margin-top:8px;font-size:12px;background:rgba(0,0,0,.4);border-radius:8px;overflow:hidden}
.cm-hud .result td,.cm-hud .result th{padding:3px 10px;text-align:right}
.cm-hud .result th:first-child,.cm-hud .result td:first-child{text-align:left}
`;

const hpColor = (pct) => (pct > 55 ? EFFECT_COLORS.hpHigh : pct > 25 ? EFFECT_COLORS.hpMid : EFFECT_COLORS.hpLow);
const mmss = (s) => { const t = Math.max(0, Math.ceil(s)); return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`; };

export function createHud({ root, teamNames = {} } = {}) {
  ensureStyle(CSS, 'cm-hud-style');
  const wrap = el('div', { class: 'cm-hud' });
  const top = el('div', { class: 'top' });
  const sideA = el('div', { class: 'side A' });
  const sideB = el('div', { class: 'side B' });
  const count = el('div', { class: 'count' });
  const warn = el('div', { class: 'warn' });
  const feed = el('div', { class: 'feed' });
  const result = el('div', { class: 'result' });
  wrap.append(top, sideA, sideB, count, warn, feed, result);
  root.append(wrap);

  let info = null;
  let names = { ...teamNames };
  let cards = new Map(); // entityId → { root, hp, en, sp, gg, hpTxt, flags, pts }
  let ext = false;
  let clockEl = null;
  let clockSub = null;
  let lastCount = null;

  const teamName = (id) => names[id] || id;
  const entName = (id) => info?.entities.find((e) => e.id === id)?.name || id;

  function buildTop() {
    clear(top);
    const [a, b] = info.teams;
    clockEl = el('b', {}, mmss(CONSTANTS.time.matchSeconds));
    clockSub = el('small', {}, '남은 시간');
    top.append(el('div', { class: 'tm A' }, teamName(a)), el('div', { class: 'clock' }, clockEl, clockSub), el('div', { class: 'tm B' }, teamName(b)));
  }

  function buildCards() {
    clear(sideA); clear(sideB); cards = new Map();
    for (const e of info.entities) {
      const hp = el('i'); const en = el('i', { style: { background: EFFECT_COLORS.energy } }); const sp = el('i', { style: { background: '#FF9F4A' } }); const gg = el('i', { style: { background: EFFECT_COLORS.fusion } });
      const hpTxt = el('b', {}, '');
      const flags = el('div', { class: 'fl' });
      const pts = el('div', { class: 'pt' });
      const card = el('div', { class: 'ecard' },
        el('div', { class: 'nm' }, el('span', {}, e.name), el('small', {}, e.pilot?.name || '')),
        el('div', { class: 'bar' }, hp),
        el('div', { class: 'row' }, NAMES.hp, hpTxt, el('span', { style: { marginLeft: 'auto' } }, `${NAMES.spirit} `), el('b', {}, '')),
        el('div', { class: 'bar thin' }, en),
        el('div', { class: 'bar thin' }, sp),
        e.hasOverdrive ? el('div', { class: 'bar thin', title: NAMES.gauge }, gg) : null,
        flags, pts);
      (e.team === info.teams[0] ? sideA : sideB).append(card);
      cards.set(e.id, { card, hp, en, sp, gg, hpTxt, spTxt: card.querySelector('.row b:last-child'), flags, pts, partKey: '' });
    }
  }

  function setMatch(initInfo, opts = {}) {
    info = initInfo;
    if (opts.teamNames) names = { ...names, ...opts.teamNames };
    ext = false;
    api.clearResult();
    clear(feed);
    buildTop();
    buildCards();
  }

  function update(snap) {
    if (!info || !snap) return;
    // 시계
    const total = CONSTANTS.time.matchSeconds + (ext ? CONSTANTS.time.extensionSeconds : 0);
    clockEl.textContent = mmss(total - snap.t);
    top.querySelector('.clock').classList.toggle('ext', ext);
    clockSub.textContent = ext ? '연장전' : '남은 시간';
    // 카운트다운
    const c = snap.phase === 'countdown' ? Math.ceil(snap.countdown) : null;
    if (c !== lastCount) {
      lastCount = c;
      count.textContent = c ? String(c) : '';
      count.classList.toggle('on', !!c);
    }
    // 기체 카드
    for (const e of snap.ents) {
      const k = cards.get(e.id);
      const s = info.entities.find((x) => x.id === e.id);
      if (!k || !s) continue;
      const pct = s.maxHp ? (e.hp / s.maxHp) * 100 : 0;
      k.hp.style.width = `${pct}%`;
      k.hp.style.background = hpColor(pct);
      k.hpTxt.textContent = `${e.hp}/${s.maxHp}`;
      k.en.style.width = `${s.maxEnergy ? (e.en / s.maxEnergy) * 100 : 0}%`;
      k.sp.style.width = `${s.spiritMax ? (e.sp / s.spiritMax) * 100 : 0}%`;
      k.spTxt.textContent = String(e.sp);
      if (s.hasOverdrive) k.gg.style.width = `${Math.min(100, e.g)}%`;
      k.card.classList.toggle('dead', !e.a);
      const ft = FLAG_TEXT.filter(([bit]) => e.fl & bit).map(([, t]) => t).join('|');
      if (k.flagKey !== ft) { k.flagKey = ft; k.flags.replaceChildren(...ft.split('|').filter(Boolean).map((t) => el('span', {}, t))); }
      const pk = (e.p || []).map((p) => p[0]).join('');
      if (pk !== k.partKey) { k.partKey = pk; k.pts.replaceChildren(...(e.p || []).map((p) => el('i', { class: `s${p[0]}` }))); }
    }
    // 전장 이벤트 예고
    const w = (snap.warn || []).filter((x) => x.s > 0 && x.s < 6);
    const wk = w.map((x) => `${x.k}${Math.ceil(x.s)}`).join(',');
    if (warn.dataset.k !== wk) {
      warn.dataset.k = wk;
      warn.replaceChildren(...w.slice(0, 3).map((x) => el('div', {}, `⚠ ${WARN_TEXT[x.k] || x.k} ${Math.ceil(x.s)}초 전`)));
    }
  }

  function note(text, cls = '', ms = 4500) {
    const n = el('div', { class: cls }, text);
    feed.append(n);
    while (feed.children.length > 5) feed.firstChild.remove();
    setTimeout(() => n.remove(), ms);
  }

  function pushEvents(evs = []) {
    for (const ev of evs) {
      switch (ev.type) {
        case 'ko': note(ev.by ? `${entName(ev.by)} → ${entName(ev.entity)} 격파` : `${entName(ev.entity)} 쓰러짐`, 'ko'); break;
        case 'revive': note(`${entName(ev.entity)} 불굴의 부활!`, 'big'); break;
        case 'overdrive': note(`${entName(ev.entity)} ${NAMES.gauge ? '오버드라이브' : ''} 발동`, 'big'); break;
        case 'skill': note(`${entName(ev.entity)} 각성기 — ${PILOT_SKILLS[ev.skill]?.name || (ev.skill === 'unyielding' ? '불굴' : ev.skill)}`, 'big'); break;
        case 'fusion_start': note('융합 시작!', 'big'); break;
        case 'fusion_end': note('융합 종료'); break;
        case 'transform': note(`${entName(ev.entity)} 변신!`, 'big'); break;
        case 'part_lost': note(`${entName(ev.entity)} 파츠 이탈`); break;
        case 'extension': ext = true; note('동률 — 연장전 돌입, 전장이 급격히 줄어듭니다', 'big', 6000); break;
        case 'start': note('경기 시작!', 'big', 2000); break;
        default: break;
      }
    }
  }

  function showResult(res, { mySide = null } = {}) {
    if (!res) return;
    const [a, b] = info?.teams || [];
    let title = NAMES.draw;
    if (res.winner) title = mySide ? (res.winner === mySide ? NAMES.win : NAMES.lose) : `${teamName(res.winner)} ${NAMES.win}`;
    clear(result);
    result.append(el('h2', {}, title), el('p', {}, REASON_TEXT[res.reason] || res.reason || ''));
    if (res.ratios) result.append(el('p', {}, `남은 체력 비율  ${teamName(a)} ${Math.round((res.ratios[a] || 0) * 100)}% : ${Math.round((res.ratios[b] || 0) * 100)}% ${teamName(b)}`));
    if (res.entities?.length) {
      const t = el('table', {}, el('tr', {}, ...['기체', '준 피해', '받은 피해', '잃은 파츠'].map((h) => el('th', {}, h))));
      for (const e of res.entities) t.append(el('tr', {}, el('td', {}, `${teamName(e.team)} · ${e.name}`), el('td', {}, Math.round(e.damageDealt)), el('td', {}, Math.round(e.damageTaken)), el('td', {}, e.partsLost ?? 0)));
      result.append(t);
    }
    result.classList.add('on');
  }

  const api = {
    el: wrap,
    setMatch, update, pushEvents, showResult,
    clearResult() { result.classList.remove('on'); clear(result); },
    reset() { info = null; cards = new Map(); clear(top); clear(sideA); clear(sideB); clear(feed); count.classList.remove('on'); api.clearResult(); },
    setVisible(on) { wrap.style.display = on ? '' : 'none'; },
    destroy() { wrap.remove(); },
  };
  return api;
}

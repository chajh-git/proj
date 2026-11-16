// web/cinematics/cinematic-player.js  (96번)
// 연출 재생기: 서버가 보낸 연출 알림(cinematic_*)과 경기 사건(overdrive·ko·transform·end·fusion_end)을 받아 알맞은 연출을 틀어 준다.
//   · 화면 위 겹침(검은 띠·암전·자막·카운트다운)은 DOM, 3D 쪽은 입자·충격파·카메라 집중(director.focus)·후처리 펄스로 한다.
//   · 연출 중 시뮬레이션은 서버가 멈춰 둔다(명세 12-5). 여기서는 '보여 주기'만 하며, 어떤 입력도 경기에 영향을 주지 않는다.
//   · 관람 화면은 서버보다 bufferDelay(0.6초) 늦게 재생하므로, 서버 알림은 그만큼 미뤄서 시작한다.
//
//   const player = createCinematicPlayer({ scene: arena, uiRoot, bufferDelay });
//   player.reset(init, { teamNames })     // 경기 시작 때
//   player.handleServer(msg)              // cinematic_start / cinematic_resume / cinematic_end
//   player.handleEvents(events)           // 보간 버퍼가 내보낸 사건들
//   player.update(dt, ents)               // 매 프레임 (ents: 보간된 스냅샷의 ents)
//   player.timeScale                      // 결정적 KO 슬로모션 중 0.4 — 관람 버퍼 setTimeScale 에 곱해서 넘김
//   player.cancelAll()

import { el, ensureStyle } from '../ui/dom.js';
import { EFFECT_COLORS } from '../../config/theme.js';
import { createFusionCinematic } from './fusion-cinematic.js';
import { createTransformCinematic } from './transform-cinematic.js';
import { createOverdriveCinematic } from './overdrive-cinematic.js';
import { createKoCinematic } from './ko-cinematic.js';

const CSS = `
.cn-ov{position:fixed;inset:0;z-index:30;pointer-events:none;overflow:hidden}
.cn-dim{position:absolute;inset:0;background:#02040a;opacity:0;transition:opacity .5s}
.cn-tint{position:absolute;inset:0;opacity:0;transition:opacity .25s;mix-blend-mode:screen}
.cn-bar{position:absolute;left:0;right:0;height:0;background:#000;transition:height .6s ease}
.cn-bar.t{top:0}.cn-bar.b{bottom:0}
.cn-on .cn-bar{height:11vh}
.cn-flash{position:absolute;inset:0;background:#fff;opacity:0}
.cn-title{position:absolute;left:0;right:0;top:41%;text-align:center;color:#FFE29A;font-weight:800;letter-spacing:.35em;font-size:clamp(28px,7vw,76px);text-shadow:0 0 18px #FFC857,0 0 48px #F2994A;opacity:0;transform:scale(1.25);transition:opacity .45s,transform .6s cubic-bezier(.2,.8,.2,1)}
.cn-title.on{opacity:1;transform:scale(1)}
.cn-sub{position:absolute;left:0;right:0;top:calc(41% + clamp(40px,9vw,96px));text-align:center;color:#d9e6f5;font-size:clamp(13px,2.2vw,22px);letter-spacing:.2em;opacity:0;transition:opacity .6s .15s}
.cn-sub.on{opacity:.92}
.cn-new{display:inline-block;margin-right:10px;padding:1px 8px;border-radius:4px;background:#E63946;color:#fff;font-size:.7em;letter-spacing:.1em;vertical-align:middle}
.cn-count{position:absolute;left:0;right:0;top:34%;text-align:center;color:#fff;font-weight:900;font-size:clamp(70px,16vw,190px);text-shadow:0 0 30px #4DE1FF;opacity:0;transform:scale(1.6)}
.cn-count.pop{animation:cn-pop .95s ease-out forwards}
@keyframes cn-pop{0%{opacity:0;transform:scale(1.9)}18%{opacity:1;transform:scale(1)}80%{opacity:.9}100%{opacity:0;transform:scale(.8)}}
.cn-glyph{position:absolute;left:50%;top:48%;width:min(60vh,70vw);aspect-ratio:1;transform:translate(-50%,-50%) scale(.4);opacity:0;border-radius:50%;border:2px solid #FFE29A;box-shadow:0 0 40px #FFC857,inset 0 0 40px #FFC85766;transition:opacity .5s,transform .9s cubic-bezier(.2,.8,.2,1)}
.cn-glyph::before,.cn-glyph::after{content:"";position:absolute;inset:11%;border-radius:50%;border:2px dashed #FFE29Acc;animation:cn-spin 6s linear infinite}
.cn-glyph::after{inset:24%;border-style:solid;animation-duration:9s;animation-direction:reverse}
.cn-glyph.on{opacity:.85;transform:translate(-50%,-50%) scale(1)}
@keyframes cn-spin{to{transform:rotate(360deg)}}
.cn-cut{position:absolute;left:-10%;right:-10%;top:30%;height:26vh;transform:skewY(-4deg) translateX(-110%);display:flex;flex-direction:column;justify-content:center;padding:0 16vw;background:linear-gradient(90deg,rgba(0,0,0,.0),rgba(5,8,16,.88) 12%,rgba(5,8,16,.88) 88%,rgba(0,0,0,0));border-top:3px solid var(--c,#FFC857);border-bottom:3px solid var(--c,#FFC857);transition:transform .28s cubic-bezier(.2,.9,.2,1)}
.cn-cut.on{transform:skewY(-4deg) translateX(0)}
.cn-cut.out{transform:skewY(-4deg) translateX(110%);transition-duration:.35s}
.cn-cut small{letter-spacing:.4em;color:var(--c,#FFC857);font-size:clamp(11px,1.6vw,16px)}
.cn-cut b{font-size:clamp(26px,6vw,64px);color:#fff;text-shadow:0 0 14px var(--c,#FFC857)}
.cn-cut span{font-size:clamp(14px,2.6vw,28px);color:#cfe0f5;letter-spacing:.12em}
.cn-ko{position:absolute;left:0;right:0;top:30%;text-align:center;font-weight:900;font-style:italic;color:#fff;font-size:clamp(50px,13vw,150px);text-shadow:0 0 16px #E63946,4px 4px 0 #E63946;opacity:0;transform:scale(2.2) rotate(-6deg)}
.cn-ko.pop{animation:cn-ko 1.1s cubic-bezier(.2,.9,.2,1) forwards}
.cn-ko.big{font-size:clamp(70px,18vw,220px)}
@keyframes cn-ko{0%{opacity:0;transform:scale(2.4) rotate(-8deg)}15%{opacity:1;transform:scale(1) rotate(-4deg)}75%{opacity:1}100%{opacity:0;transform:scale(.95) rotate(-4deg)}}
.cn-tag{position:absolute;left:50%;top:22%;transform:translateX(-50%);padding:5px 18px;border-radius:999px;background:rgba(0,0,0,.65);border:1px solid var(--c,#FFC857);color:#fff;font-weight:700;letter-spacing:.2em;font-size:clamp(12px,2vw,18px);opacity:0;animation:cn-tag 1.4s ease-out forwards}
@keyframes cn-tag{0%{opacity:0;transform:translate(-50%,10px)}15%{opacity:1;transform:translate(-50%,0)}80%{opacity:1}100%{opacity:0}}
.cn-win{position:absolute;left:0;right:0;top:36%;text-align:center;font-weight:900;font-size:clamp(40px,10vw,120px);letter-spacing:.2em;color:var(--c,#FFC857);text-shadow:0 0 24px var(--c,#FFC857);opacity:0;transform:scale(1.4);transition:opacity .6s,transform .8s cubic-bezier(.2,.8,.2,1)}
.cn-win.on{opacity:1;transform:scale(1)}
`;

export function createCinematicPlayer({ scene, uiRoot = document.body, bufferDelay = 0.6, teamColors = { A: EFFECT_COLORS.teamA, B: EFFECT_COLORS.teamB } } = {}) {
  ensureStyle(CSS, 'cn-style');
  const ov = el('div', { class: 'cn-ov' });
  const dim = el('div', { class: 'cn-dim' });
  const tint = el('div', { class: 'cn-tint' });
  const flash = el('div', { class: 'cn-flash' });
  ov.append(dim, tint, el('div', { class: 'cn-bar t' }), el('div', { class: 'cn-bar b' }), flash);
  uiRoot.append(ov);

  // ── 상태 ────────────────────────────────────────────────
  let ents = [];
  const entInfo = new Map(); // id → { name, team }
  let teamNames = {};
  let queue = []; // { at, fn } 지연 실행(관람 버퍼 만큼 미룸)
  let clock = 0;
  const frames = new Set(); // 진행 중인 연출의 매 프레임 함수 (dt, t) → false 면 종료
  let slowUntil = 0;
  let overlays = [];

  const getEnt = (id) => ents.find((e) => e.id === id) || null;
  const pos = (id) => { const e = getEnt(id); return e ? { x: e.x, z: e.z, y: 1 + (e.alt === 'high' ? 5.2 : e.alt === 'low' ? 2.4 : 0), h: e.h || 0 } : null; };
  const teamOf = (id) => entInfo.get(id)?.team ?? 'A';

  const env = {
    THREE: scene.THREE, root: scene.root, particles: scene.particles, director: scene.director,
    get postfx() { return scene.postfx; },
    ov, dim, tint, flash,
    get ents() { return ents; },
    ent: getEnt, pos, teamOf,
    color: (team) => teamColors[team] || '#FFE29A',
    nameOf: (id) => entInfo.get(id)?.name || id,
    teamName: (t) => teamNames[t] || `팀 ${t}`,
    play: (id, vol) => scene.kit?.play?.(id, vol),
    later: (sec, fn) => { queue.push({ at: clock + sec, fn }); },
    frame: (fn) => { frames.add(fn); return () => frames.delete(fn); },
    // 화면 겹침 조각 만들기: 연출이 끝나면 자동으로 지운다
    node(cls, text = '', parent = ov) { const n = el('div', { class: cls }, text); parent.append(n); overlays.push(n); return n; },
    drop(n, afterMs = 0) { setTimeout(() => { n.remove(); overlays = overlays.filter((x) => x !== n); }, afterMs); },
    bars(on) { ov.classList.toggle('cn-on', on); },
    dimTo(a) { dim.style.opacity = String(a); },
    tintTo(color, a) { if (color) tint.style.background = `radial-gradient(circle at 50% 50%, transparent 25%, ${color} 140%)`; tint.style.opacity = String(a); },
    flashNow(color = '#fff', ms = 450) { flash.style.transition = 'none'; flash.style.background = color; flash.style.opacity = '0.9'; requestAnimationFrame(() => { flash.style.transition = `opacity ${ms}ms ease-out`; flash.style.opacity = '0'; }); },
    slowmo(seconds) { slowUntil = Math.max(slowUntil, clock + seconds); },
    centroid(ids) {
      const ps = ids.map(pos).filter(Boolean);
      if (!ps.length) return { x: 0, y: 1.2, z: 0, spread: 0 };
      const c = ps.reduce((a, p) => ({ x: a.x + p.x / ps.length, y: a.y + p.y / ps.length, z: a.z + p.z / ps.length }), { x: 0, y: 0, z: 0 });
      const spread = Math.max(...ps.map((p) => Math.hypot(p.x - c.x, p.z - c.z)));
      return { ...c, spread };
    },
  };

  const fusion = createFusionCinematic(env);
  const transform = createTransformCinematic(env);
  const overdrive = createOverdriveCinematic(env);
  const ko = createKoCinematic(env);
  let activeServer = null; // 지금 도는 서버 연출 { kind, stop() }

  function clearVisuals() {
    for (const n of overlays) n.remove();
    overlays = [];
    ov.classList.remove('cn-on');
    dim.style.opacity = '0'; tint.style.opacity = '0'; flash.style.opacity = '0';
  }

  const api = {
    reset(init, { teamNames: names = {} } = {}) {
      api.cancelAll();
      entInfo.clear();
      for (const e of init?.entities || []) entInfo.set(e.id, { name: e.name, team: e.team });
      teamNames = names;
    },

    // 서버 연출 알림. 관람 버퍼가 0.6초 늦게 재생되므로 그만큼 미뤄서 시작한다.
    handleServer(msg) {
      if (msg.type === 'cinematic_start') {
        env.later(bufferDelay, () => {
          activeServer?.stop?.();
          const impl = msg.kind === 'transform' ? transform.awaken : fusion.start;
          activeServer = impl(msg);
        });
      } else if (msg.type === 'cinematic_resume') {
        env.later(bufferDelay, () => activeServer?.resume?.(msg));
      } else if (msg.type === 'cinematic_end') {
        env.later(bufferDelay, () => { activeServer?.stop?.(); activeServer = null; env.bars(false); env.dimTo(0); });
      }
    },

    // 경기 사건 연출
    handleEvents(events = []) {
      for (const ev of events) {
        switch (ev.type) {
          case 'overdrive': overdrive.play(ev); break;
          case 'ko': ko.onKo(ev); break;
          case 'end': ko.onEnd(ev); break;
          case 'transform': transform.basic(ev); break;
          case 'fusion_end': fusion.release(ev); break;
          default: break;
        }
      }
    },

    update(dt, current = null) {
      if (current) ents = current.map((e) => ({ ...e, team: e.team ?? entInfo.get(e.id)?.team, alive: e.alive ?? e.a === 1 }));
      clock += dt;
      if (queue.length) {
        const due = queue.filter((q) => q.at <= clock);
        if (due.length) { queue = queue.filter((q) => q.at > clock); for (const q of due) { try { q.fn(); } catch (e) { console.error(e); } } }
      }
      for (const fn of [...frames]) { let keep = true; try { keep = fn(dt, clock) !== false; } catch (e) { console.error(e); keep = false; } if (!keep) frames.delete(fn); }
    },

    get timeScale() { return clock < slowUntil ? 0.4 : 1; },
    get active() { return Boolean(activeServer); },

    cancelAll() {
      queue = []; frames.clear(); slowUntil = 0;
      activeServer?.stop?.(); activeServer = null;
      fusion.cancel?.(); ko.cancel?.();
      clearVisuals();
    },
    dispose() { api.cancelAll(); ov.remove(); },
  };
  return api;
}

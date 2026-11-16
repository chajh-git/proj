// server/match-runner.js  (77번)
// 경기 하나를 서버에서 실시간(60Hz 계산, 20Hz 송출)으로 진행한다. 공식 결과는 여기서만 나온다. (명세 3-3, 9-1, 13, 16)
//   const runner = createMatchRunner({ id, teams, map, seed, recipes, publish, onEnd, onCodex });
//   runner.init          // 관람 화면이 장면을 만들 때 쓰는 초기 정보(전술은 들어 있지 않음)
//   runner.start()       // 5초 카운트다운 포함 진행 시작
//   runner.pause() / resume() / abort(reason)
//   runner.status        // 'ready' | 'running' | 'paused' | 'finished' | 'aborted'
//   runner.replay()      // { init, frames, result } — 같은 스트림을 저장해 재생한다(재시뮬레이션에 의존하지 않음)
//
// publish(msg) 로 나가는 메시지:
//   match_prepare {match, init, teams}   match_start {match}   state {match, s}   match_status {match, status}
//   cinematic_start {match, ...}  cinematic_resume {match}  cinematic_end {match}   match_end {match, result}

import { createMatch, stepMatch, abortMatch } from '#shared/sim/referee.js';
import { makeInitInfo } from '#shared/sim/snapshot.js';
import { CONSTANTS } from '#config/constants.js';
import { createFusionManager } from './sim/fusion.js';

const clone = (o) => JSON.parse(JSON.stringify(o));

export function createMatchRunner({
  id, teams, map, seed = (Math.random() * 1e9) | 0, recipes = [], publish = () => {}, onEnd = () => {}, onCodex = () => {},
  constants = CONSTANTS, log = console, now = () => performance.now(), setTimer = setInterval, clearTimer = clearInterval, enableFusion = true,
} = {}) {
  const frames = [];
  const sink = (msg) => { try { publish({ match: id, ...msg }); } catch (e) { log.error?.('publish 오류', e); } };

  const fx = enableFusion
    ? createFusionManager({
      recipes, matchId: id, constants, log,
      onCinematic: (c) => {
        const type = c.type === 'start' ? 'cinematic_start' : c.type === 'resume' ? 'cinematic_resume' : 'cinematic_end';
        const { type: _t, ...rest } = c;
        frames.push({ k: 'c', c: { type, ...rest } });
        sink({ type, ...rest });
      },
      onCodex,
    })
    : null;

  let status = 'ready';
  let timer = null;
  let last = 0;
  let acc = 0;
  let finished = false;
  let thin = 0;

  const simTeams = teams.map((t) => ({ id: t.id, entries: t.entries.map((en) => ({ design: clone(en.design), tactics: clone(en.tactics), owner: en.owner ?? null })) }));
  const match = createMatch({
    teams: simTeams, map, seed, constants,
    hooks: fx ? fx.hooks : {},
    onSnapshot: (s) => {
      // 카운트다운·연출 중에는 틱마다 스냅샷이 나오므로 20Hz로 솎는다
      if ((s.phase === 'countdown' || s.frozen) && (++thin % Math.max(1, Math.round(constants.time.physicsHz / constants.time.streamHz)) !== 0)) return;
      frames.push({ k: 's', s });
      sink({ type: 'state', s });
    },
    onEnd: (result) => {
      finished = true;
      status = result.aborted ? 'aborted' : 'finished';
      stop();
      sink({ type: 'match_end', result });
      onEnd(result);
    },
  });
  const init = makeInitInfo(match.world);

  function stop() { if (timer) { clearTimer(timer); timer = null; } }

  function loop() {
    const t = now();
    const dt = Math.min(250, t - last);
    last = t;
    if (status !== 'running') return;
    acc += dt;
    const step = 1000 / constants.time.physicsHz;
    let n = 0;
    while (acc >= step && match.status === 'running' && n < 24) { stepMatch(match); acc -= step; n++; }
    if (acc > step * 24) acc = 0; // 서버가 크게 밀리면 따라잡지 않고 버린다
  }

  const api = {
    id, init, seed,
    get status() { return status; },
    get teamInfo() { return teams.map((t) => ({ id: t.id, name: t.name || t.id })); },
    get match() { return match; },
    get fusion() { return fx ? fx.state : null; },
    get snapshotCount() { return frames.length; },
    get teamList() { return teams.map((t) => ({ id: t.id, name: t.name || t.id })); },
    prepare() {
      sink({ type: 'match_prepare', init, teams: teams.map((t) => ({ id: t.id, name: t.name || t.id })) });
    },
    start() {
      if (status !== 'ready') return false;
      status = 'running';
      last = now();
      sink({ type: 'match_start' });
      timer = setTimer(loop, 8);
      return true;
    },
    pause() { if (status !== 'running') return false; status = 'paused'; sink({ type: 'match_status', status }); return true; },
    resume() { if (status !== 'paused') return false; status = 'running'; last = now(); sink({ type: 'match_status', status }); return true; },
    abort(reason = 'aborted') {
      if (finished) return false;
      stop();
      abortMatch(match, reason);
      return true;
    },
    replay() { return { init, frames, result: match.result, seed }; },
    // 지금 상태(새로 접속한 관람자에게 보내 줄 용도)
    lastState() { for (let i = frames.length - 1; i >= 0; i--) if (frames[i].k === 's') return frames[i].s; return null; },
    isActive: () => status === 'running' || status === 'paused',
  };
  return api;
}

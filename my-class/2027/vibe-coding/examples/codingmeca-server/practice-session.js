// server/practice-session.js  (80번)
// 연습전: 메카닉이 자기 기체를 골라 프리셋(또는 거울 복제) 상대와 서버에서 연습 경기를 한다. 리그 기록·순위·도감에는 남지 않는다. (명세 4-3, 9-8)
//   const pm = createPracticeManager({ db, recipes, send });   send(userId, msg) → 그 사용자 소켓으로 보냄
//   await pm.start(who, { roster:[robotId], opponent:{ preset } | { mirror:true }, mapId })
//   pm.stop(userId)
// 기체는 ID로만 받고 DB에서 다시 읽는다. 한 사람이 동시에 한 판만 할 수 있다.

import { CONSTANTS } from '#config/constants.js';
import { getMap, MAP_BY_ID } from '#data/maps.js';
import { PRESET_BY_ID, PRESETS, clonePreset } from '#data/presets.js';
import { validateDesign } from '#shared/build/validator.js';
import { createMatchRunner } from './match-runner.js';

export class PracticeError extends Error {
  constructor(message, code = 'bad_request') { super(message); this.code = code; }
}
const fail = (m, c) => { throw new PracticeError(m, c); };

export function createPracticeManager({ db, recipes = null, send = () => {}, balanceCache = null, log = console, max = CONSTANTS.league.practiceSessions, makeRunner = createMatchRunner } = {}) {
  const sessions = new Map(); // userId → { runner, id }
  let seq = 0;
  const recipeList = () => (typeof recipes === 'function' ? recipes() : recipes?.recipes ?? recipes ?? []);

  async function start(who, { roster, opponent = { mirror: true }, mapId = null } = {}) {
    if (sessions.has(who.id)) fail('이미 연습 경기 중입니다', 'busy');
    if (sessions.size >= max) fail(`연습 경기는 동시에 ${max}판까지 가능합니다. 잠시 뒤에 다시 해 보세요`, 'busy');
    if (!Array.isArray(roster) || !roster.length || roster.length > CONSTANTS.match.maxTeamSize) fail('기체를 1~3기 골라야 합니다');
    if (new Set(roster).size !== roster.length) fail('같은 기체를 두 번 고를 수 없습니다');
    const mine = await db.getRobots(who.id, roster);
    if (mine.length !== roster.length) fail('내 기체만 연습에 쓸 수 있습니다', 'forbidden');
    const entries = mine.map((r) => {
      const v = validateDesign(r.design);
      if (!v.ok) fail(`‘${r.name}’ 설계에 문제가 있습니다: ${v.errors[0]?.message || ''}`);
      const tactics = r.tactics || r.design?.tactics;
      if (!tactics) fail(`‘${r.name}’에 전술이 없습니다`);
      return { design: r.design, tactics, owner: who.id };
    });
    // 상대
    let foes;
    if (opponent?.preset) {
      if (!PRESET_BY_ID[opponent.preset]) fail('없는 원형 설계도입니다', 'not_found');
      foes = entries.map(() => { const p = clonePreset(opponent.preset); return { design: p, tactics: p.tactics, owner: null }; });
    } else {
      foes = entries.map((e) => ({ design: JSON.parse(JSON.stringify(e.design)), tactics: JSON.parse(JSON.stringify(e.tactics)), owner: null }));
    }
    const map = getMap(mapId && MAP_BY_ID[mapId] ? mapId : Object.keys(MAP_BY_ID)[0]);
    const id = `practice-${++seq}`;
    const runner = makeRunner({
      id, map, recipes: recipeList(), log, ...(balanceCache ? { constants: (await balanceCache.latest()).constants } : {}),
      teams: [{ id: 'A', name: '내 팀', entries }, { id: 'B', name: '연습 상대', entries: foes }],
      publish: (msg) => send(who.id, msg),
      onEnd: (result) => { sessions.delete(who.id); send(who.id, { type: 'practice_end', match: id }); void result; },
    });
    sessions.set(who.id, { runner, id });
    runner.prepare();
    runner.start();
    return { id, map: map.id };
  }

  function stop(userId) {
    const s = sessions.get(userId);
    if (!s) return false;
    if (s.runner.isActive() || s.runner.status === 'ready') s.runner.abort('practice_stop');
    sessions.delete(userId);
    return true;
  }

  return {
    start, stop,
    has: (userId) => sessions.has(userId),
    get activeCount() { return sessions.size; },
    presets: () => PRESETS.map((p) => ({ id: p.id, name: p.name, species: p.species })),
    stopAll() { for (const id of [...sessions.keys()]) stop(id); },
  };
}

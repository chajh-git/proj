// server/league-manager.js  (81번)
// 리그 운영: 만들기·설정, 출전 등록(로스터 스냅샷), 대진 생성, 경기 준비·개시·일시정지·중단, 결과 확정, 순위, 관제 공개 정보. (명세 4-3, 9-8, 13)
// 모든 규칙·수치는 이 서버가 판단한다. 클라이언트가 보낸 설계·수치는 쓰지 않고, 기체 ID 만 받아 DB에서 다시 읽는다.
//
//   const lm = createLeagueManager({ db, recipes, publish, replayStore });
//   publish(room, msg): 'league:<leagueId>' 방으로 경기 메시지(match_prepare / state / …)와 league_update 를 보낸다.
//
// 경기 상태: scheduled → prep(양 팀·전장 확인, match_prepare 송출) → running ⇄ paused → finished | aborted | needs_decision
// 리그 상태: open(등록 중) → running → finished

import { randomInt } from 'node:crypto';
import { CONSTANTS } from '#config/constants.js';
import { getMap, MAP_BY_ID } from '#data/maps.js';
import { validateDesign } from '#shared/build/validator.js';
import { validateTactics } from '#shared/tactics/validator.js';
import { createMatchRunner } from './match-runner.js';
import * as T from './tournament.js';
import { createBalanceCache } from './balance-cache.js';

const LC = CONSTANTS.league;
const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'; // 헷갈리는 글자(0/O, 1/I/L) 제외
const FORMATS = ['roundrobin', 'single', 'double', 'manual'];
const MAP_MODES = ['fixed', 'random', 'perMatch'];
const clamp = (v, lo, hi, d) => { const n = Number(v); return Number.isFinite(n) ? Math.min(hi, Math.max(lo, n)) : d; };

export class LeagueError extends Error {
  constructor(message, code = 'bad_request') { super(message); this.code = code; }
}
const fail = (m, c) => { throw new LeagueError(m, c); };

// ── 리그 설정 검사 ───────────────────────────────────────
export function normalizeLeagueConfig(raw = {}, prev = null) {
  const c = { ...(prev || {}), ...raw };
  const name = String(c.name ?? '').trim().slice(0, 30);
  if (!name) fail('리그 이름이 필요합니다');
  const mapPool = (Array.isArray(c.mapPool) && c.mapPool.length ? c.mapPool : Object.keys(MAP_BY_ID).slice(0, 1)).map(String);
  for (const id of mapPool) if (!MAP_BY_ID[id]) fail(`알 수 없는 전장: ${id}`);
  const pts = { ...CONSTANTS.match.tiePoints, ...(c.points || {}) };
  return {
    name,
    teamSize: clamp(c.teamSize, 1, CONSTANTS.match.maxTeamSize, 1) | 0,
    weightCap: clamp(c.weightCap, 1, 9999, CONSTANTS.limits.weightCap),
    budget: clamp(c.budget, 1, 99999, CONSTANTS.limits.budget),
    matchSeconds: clamp(c.matchSeconds, 30, 600, CONSTANTS.time.matchSeconds) | 0,
    mapPool,
    mapMode: MAP_MODES.includes(c.mapMode) ? c.mapMode : 'fixed',
    mapsPublic: c.mapsPublic !== false,
    format: FORMATS.includes(c.format) ? c.format : 'roundrobin',
    seedMode: ['registration', 'random', 'manual'].includes(c.seedMode) ? c.seedMode : 'registration',
    seedOrder: Array.isArray(c.seedOrder) ? c.seedOrder.map(String) : [],
    points: { win: clamp(pts.win, 0, 99, 3), draw: clamp(pts.draw, 0, 99, 1), loss: clamp(pts.loss, 0, 99, 0) },
    maintenance: c.maintenance ?? LC.allowRepairBetweenMatches,
    codexPublic: Boolean(c.codexPublic),
    concurrent: clamp(c.concurrent, 1, 4, LC.concurrentMatches) | 0,
    bracket: c.bracket ?? null,
  };
}

export const leagueConstants = (cfg, base = CONSTANTS) => ({ ...base, time: { ...base.time, matchSeconds: cfg.matchSeconds } });

function newCode(existing) {
  for (let i = 0; i < 50; i++) {
    const code = Array.from({ length: LC.spectatorCodeLength }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
    if (!existing.has(code)) return code;
  }
  fail('관람 코드를 만들지 못했습니다', 'server');
}

export function createLeagueManager({ db, recipes = null, publish = () => {}, replayStore = null, balanceCache = null, log = console, now = () => new Date().toISOString(), makeRunner = createMatchRunner } = {}) {
  const runners = new Map(); // matchId → { runner, leagueId, teams:{A,B} }
  const room = (leagueId) => `league:${leagueId}`;
  const notify = (leagueId, what = {}) => publish(room(leagueId), { type: 'league_update', league: leagueId, ...what });
  const secretRecipes = () => (typeof recipes === 'function' ? recipes() : recipes?.recipes ?? []);

  async function mustLeague(id) { const l = await db.getLeague(id); if (!l) fail('없는 리그입니다', 'not_found'); return l; }
  const cfgOf = (l) => l.config || {};

  // ── 리그 만들기·고치기 ─────────────────────────────────
  async function createLeague(who, raw) {
    const cfg = normalizeLeagueConfig(raw);
    const codes = new Set((await db.listLeagues()).map((l) => l.view_code));
    const bal = await db.getBalance().catch(() => null);
    const row = await db.saveLeague({ name: cfg.name, config: cfg, status: 'open', view_code: newCode(codes), balance_version: bal?.version ?? 0, created_by: who.id });
    return row;
  }

  async function updateLeague(id, patch) {
    const l = await mustLeague(id);
    if (l.status === 'finished') fail('끝난 리그는 고칠 수 없습니다', 'locked');
    const locked = new Set(['teamSize', 'format', 'bracket']);
    if (l.status === 'running') for (const k of Object.keys(patch)) if (locked.has(k)) fail(`진행 중인 리그에서는 ${k} 를 바꿀 수 없습니다`, 'locked');
    const cfg = normalizeLeagueConfig(patch, { ...cfgOf(l), bracket: cfgOf(l).bracket });
    return db.saveLeague({ id, config: cfg, name: cfg.name });
  }

  // 밸런스 새 버전으로 갱신: 지휘관이 명시적으로 눌러야만 바뀐다
  async function refreshBalance(id) {
    const l = await mustLeague(id);
    const bal = await db.getBalance();
    return db.saveLeague({ id, balance_version: bal?.version ?? l.balance_version });
  }

  // ── 출전 등록 ──────────────────────────────────────────
  // robots: 기체 ID 배열. 등록한 사람 또는 같은 팀 구성원의 기체만 쓸 수 있다.
  async function registerRoster(who, { leagueId, robotIds, teamId = null }) {
    const l = await mustLeague(leagueId);
    const cfg = cfgOf(l);
    if (l.status === 'finished') fail('끝난 리그입니다', 'locked');
    const team = who.role === 'commander' && teamId ? teamId : who.teamId;
    if (!team) fail('팀에 소속되어 있지 않습니다. 지휘관에게 팀 배정을 요청하세요', 'forbidden');
    if (!Array.isArray(robotIds) || robotIds.length !== cfg.teamSize) fail(`${cfg.teamSize}기를 골라야 합니다`);
    if (new Set(robotIds).size !== robotIds.length) fail('같은 기체를 두 번 고를 수 없습니다');

    const cur = await db.getRoster(leagueId, team);
    if (cur?.locked) fail('경기 중이라 명단을 바꿀 수 없습니다', 'locked');
    if (l.status === 'running' && !cfg.maintenance && cur) fail('이 리그는 경기 사이 정비가 허용되지 않습니다', 'locked');

    // 소유 확인: 본인 또는 같은 팀 구성원
    const owners = who.role === 'commander' ? null : new Set([who.id]);
    const entries = [];
    for (const rid of robotIds) {
      const rows = await db.raw.robots.select({ id: rid });
      const r = rows[0];
      if (!r) fail('없는 기체가 있습니다', 'not_found');
      if (owners && !owners.has(r.owner)) {
        const p = await db.getProfile(r.owner);
        if (!p || p.team_id !== team) fail('내 팀의 기체만 등록할 수 있습니다', 'forbidden');
      }
      const v = validateDesign(r.design, { limits: { weightCap: cfg.weightCap, budget: cfg.budget } });
      if (!v.ok) fail(`‘${r.name}’은(는) 이 리그 한도에 맞지 않습니다: ${v.errors[0]?.message || ''}`);
      const tactics = r.tactics || r.design?.tactics;
      if (!tactics) fail(`‘${r.name}’에 전술이 없습니다`);
      entries.push({ robotId: r.id, owner: r.owner, name: r.name || r.design?.name, design: r.design, tactics, tacticsIssues: validateTactics(tactics, { design: r.design }).errors.length });
    }
    await db.saveRoster({ league_id: leagueId, team_id: team, snapshot: entries, locked: false });
    await db.addLeagueTeam({ league_id: leagueId, team_id: team, seed: null });
    notify(leagueId, { what: 'roster', team });
    return { ok: true, team, count: entries.length, warnings: entries.filter((e) => e.tacticsIssues).map((e) => `${e.name}: 전술 오류 ${e.tacticsIssues}건(위반 규칙은 무시됩니다)`) };
  }

  async function withdrawTeam(leagueId, teamId) {
    const l = await mustLeague(leagueId);
    if (l.status !== 'open') fail('등록 기간이 끝났습니다', 'locked');
    await db.removeLeagueTeam(leagueId, teamId);
    notify(leagueId, { what: 'roster', team: teamId });
  }

  // ── 대진 ───────────────────────────────────────────────
  async function generateSchedule(leagueId) {
    const l = await mustLeague(leagueId);
    const cfg = cfgOf(l);
    if ((await db.listMatches(leagueId)).length) fail('이미 대진이 있습니다. 새로 만들려면 먼저 지워야 합니다', 'locked');
    const teams = (await db.listLeagueTeams(leagueId)).sort((a, b) => String(a.registered_at).localeCompare(String(b.registered_at))).map((x) => x.team_id);
    const rosters = await db.listRosters(leagueId);
    const ready = teams.filter((id) => rosters.some((r) => r.team_id === id));
    if (ready.length < 2) fail('로스터를 등록한 팀이 2팀 이상이어야 합니다');
    const rows = [];
    let bracket = null;
    if (cfg.format === 'roundrobin') {
      T.roundRobin(ready).forEach((m, i) => rows.push({ id: `${leagueId}:R${m.round}-${i + 1}`, league_id: leagueId, round: m.round, slot: i, team_a: m.a, team_b: m.b, status: 'scheduled' }));
    } else if (cfg.format === 'single' || cfg.format === 'double') {
      bracket = T.buildBracket({ format: cfg.format, seeds: T.seedTeams(ready, cfg.seedMode, cfg.seedOrder) });
      for (const id of bracket.order) {
        const m = bracket.matches[id];
        if (m.status === 'bye') continue;
        rows.push({ id: `${leagueId}:${id}`, league_id: leagueId, round: m.round + (m.bracket === 'L' ? 100 : m.bracket === 'F' ? 200 : 0), slot: m.slot, team_a: nullBye(m.a), team_b: nullBye(m.b), status: 'scheduled', bracket_id: id });
      }
    } // manual: 대진 없음(지휘관이 직접 추가)
    for (const r of rows) await db.saveMatch({ ...r, created_at: now() });
    await db.saveLeague({ id: leagueId, status: 'running', config: { ...cfg, bracket } });
    notify(leagueId, { what: 'schedule' });
    return rows.length;
  }
  const nullBye = (x) => (x === T.BYE ? null : x);

  async function addManualMatch(leagueId, { teamA, teamB, mapId = null }) {
    const l = await mustLeague(leagueId);
    if (teamA === teamB) fail('같은 팀끼리는 경기할 수 없습니다');
    const id = `${leagueId}:M${Date.now().toString(36)}`;
    const row = await db.saveMatch({ id, league_id: leagueId, round: 0, slot: 0, team_a: teamA, team_b: teamB, map_id: mapId, status: 'scheduled', created_at: now() });
    if (l.status === 'open') await db.saveLeague({ id: leagueId, status: 'running' });
    notify(leagueId, { what: 'schedule' });
    return row;
  }

  // ── 경기 진행 ──────────────────────────────────────────
  function pickMap(cfg, mapId) {
    if (cfg.mapMode === 'perMatch') {
      if (!mapId || !cfg.mapPool.includes(mapId)) fail('이 리그는 경기마다 전장을 지정해야 합니다(허용 전장 중에서)');
      return getMap(mapId);
    }
    if (cfg.mapMode === 'random') return getMap(cfg.mapPool[randomInt(cfg.mapPool.length)]);
    return getMap(cfg.mapPool[0]);
  }

  async function prepareMatch(matchId, { mapId = null } = {}) {
    const m = await db.getMatch(matchId);
    if (!m) fail('없는 경기입니다', 'not_found');
    if (!['scheduled', 'aborted', 'needs_decision'].includes(m.status)) fail(`지금 상태(${m.status})에서는 준비할 수 없습니다`, 'locked');
    if (!m.team_a || !m.team_b) fail('아직 양쪽 팀이 정해지지 않은 경기입니다');
    const l = await mustLeague(m.league_id);
    const cfg = cfgOf(l);
    if ([...runners.values()].filter((x) => x.runner.isActive() || x.runner.status === 'ready').length >= cfg.concurrent) fail(`동시에 진행할 수 있는 경기는 ${cfg.concurrent}개입니다`, 'busy');
    const [ra, rb] = await Promise.all([db.getRoster(m.league_id, m.team_a), db.getRoster(m.league_id, m.team_b)]);
    if (!ra || !rb) fail('양 팀의 출전 로스터가 필요합니다');
    const map = pickMap(cfg, mapId || m.map_id);
    const teamNames = Object.fromEntries((await db.listTeams()).map((t) => [t.id, t.name]));
    const mk = (id, team, roster) => ({ id, name: teamNames[team] || team, entries: roster.snapshot.map((e) => ({ design: e.design, tactics: e.tactics, owner: e.owner })) });
    const mapTeam = { A: m.team_a, B: m.team_b };
    const runner = makeRunner({
      id: matchId, teams: [mk('A', m.team_a, ra), mk('B', m.team_b, rb)], map, recipes: secretRecipes(), constants: leagueConstants(cfg, balanceCache ? (await balanceCache.forVersion(l.balance_version)).constants : CONSTANTS), log,
      publish: (msg) => publish(room(m.league_id), msg),
      onCodex: (c) => recordCodex(l, matchId, mapTeam[c.teamId] || c.teamId, c),
      onEnd: (result) => { finishMatch(matchId, m.league_id, mapTeam, result).catch((e) => log.error?.('경기 종료 처리 오류', e)); },
    });
    runners.set(matchId, { runner, leagueId: m.league_id, teams: mapTeam });
    await db.saveMatch({ id: matchId, status: 'prep', map_id: map.id, result: null });
    runner.prepare();
    notify(m.league_id, { what: 'match', match: matchId, status: 'prep' });
    return { matchId, map: map.id };
  }

  async function startMatch(matchId, opts = {}) {
    if (!runners.has(matchId)) await prepareMatch(matchId, opts);
    const { runner, leagueId, teams } = runners.get(matchId);
    const m = await db.getMatch(matchId);
    if (runner.status !== 'ready') fail('이미 시작된 경기입니다', 'locked');
    // 경기 시작 때 해당 매치 로스터가 잠긴다
    for (const t of Object.values(teams)) { const r = await db.getRoster(leagueId, t); if (r) await db.saveRoster({ league_id: leagueId, team_id: t, snapshot: r.snapshot, locked: true }); }
    runner.start();
    await db.saveMatch({ id: matchId, status: 'running', started_at: now() });
    notify(leagueId, { what: 'match', match: matchId, status: 'running', map: m.map_id });
    return { ok: true };
  }

  const ctl = (matchId) => { const x = runners.get(matchId); if (!x) fail('진행 중인 경기가 아닙니다', 'not_found'); return x; };
  async function pauseMatch(matchId) { const x = ctl(matchId); if (!x.runner.pause()) fail('일시정지할 수 없는 상태입니다', 'locked'); await db.saveMatch({ id: matchId, status: 'paused' }); notify(x.leagueId, { what: 'match', match: matchId, status: 'paused' }); }
  async function resumeMatch(matchId) { const x = ctl(matchId); if (!x.runner.resume()) fail('재개할 수 없는 상태입니다', 'locked'); await db.saveMatch({ id: matchId, status: 'running' }); notify(x.leagueId, { what: 'match', match: matchId, status: 'running' }); }
  async function abortMatch(matchId, reason = 'commander') {
    const x = runners.get(matchId);
    if (!x) fail('진행 중인 경기가 아닙니다', 'not_found');
    if (x.runner.status === 'ready') { runners.delete(matchId); await db.saveMatch({ id: matchId, status: 'scheduled' }); notify(x.leagueId, { what: 'match', match: matchId, status: 'scheduled' }); return; }
    x.runner.abort(reason); // → onEnd → finishMatch
  }

  // 결과를 팀 ID 기준으로 정리 (내부 A/B 는 밖으로 내보내지 않는다)
  function mapResult(result, teams) {
    if (result.aborted) return { aborted: true, reason: result.reason, winner: null };
    return {
      winner: result.winner ? teams[result.winner] : null, reason: result.reason, duration: result.duration,
      ratios: Object.fromEntries(Object.entries(result.ratios || {}).map(([k, v]) => [teams[k], Math.round(v * 1000) / 1000])),
      entities: (result.entities || []).map((e) => ({ id: e.id, team: teams[e.team], name: e.name, owner: e.owner, alive: e.alive, hp: Math.round(e.hp), maxHp: Math.round(e.maxHp), damageDealt: Math.round(e.damageDealt), damageTaken: Math.round(e.damageTaken), partsLost: e.partsLost })),
    };
  }

  async function finishMatch(matchId, leagueId, teams, raw) {
    const x = runners.get(matchId);
    const result = mapResult(raw, teams);
    let replayId = null;
    if (x && !raw.aborted && replayStore) { try { replayId = await replayStore.save({ matchId, replay: x.runner.replay(), meta: { league: leagueId, matchId } }); } catch (e) { log.error?.('리플레이 저장 실패', e); } }
    runners.delete(matchId);
    const l = await mustLeague(leagueId);
    const cfg = cfgOf(l);
    // 로스터 잠금 해제
    for (const t of Object.values(teams)) { const r = await db.getRoster(leagueId, t); if (r) await db.saveRoster({ league_id: leagueId, team_id: t, snapshot: r.snapshot, locked: false }); }
    const m = await db.getMatch(matchId);
    let status = raw.aborted ? 'aborted' : 'finished';
    // 토너먼트 무승부: 재경기 1회, 그래도 무승부면 지휘관 수동 판정
    const isBracket = Boolean(m.bracket_id);
    if (!raw.aborted && isBracket && !result.winner) {
      if ((m.draws || 0) < LC.tournamentDrawReplays) {
        await db.saveMatch({ id: matchId, status: 'scheduled', draws: (m.draws || 0) + 1, result, replay_id: replayId, ended_at: now() });
        notify(leagueId, { what: 'match', match: matchId, status: 'scheduled', note: 'draw_replay' });
        return;
      }
      status = 'needs_decision';
    }
    await db.saveMatch({ id: matchId, status, result, replay_id: replayId, ended_at: now() });
    if (status === 'finished' && isBracket) await advanceBracket(leagueId, m, result.winner);
    notify(leagueId, { what: 'match', match: matchId, status, result });
    await maybeFinishLeague(leagueId);
    void cfg;
  }

  async function advanceBracket(leagueId, m, winner) {
    const l = await mustLeague(leagueId);
    const cfg = cfgOf(l);
    if (!cfg.bracket) return;
    const b = cfg.bracket;
    const bm = b.matches[m.bracket_id];
    T.reportResult(b, m.bracket_id, winner === bm.a ? 'a' : 'b');
    await db.saveLeague({ id: leagueId, config: { ...cfg, bracket: b } });
    // 대진 표 행에 새로 정해진 팀을 반영
    for (const id of b.order) {
      const x = b.matches[id];
      if (x.status === 'bye') continue;
      await db.saveMatch({ id: `${leagueId}:${id}`, team_a: nullBye(x.a), team_b: nullBye(x.b) });
    }
  }

  // 지휘관이 결과를 직접 정하거나(무승부 판정·수정) 고친다
  async function setResult(matchId, { winner }) {
    const m = await db.getMatch(matchId);
    if (!m) fail('없는 경기입니다', 'not_found');
    if (runners.has(matchId)) fail('진행 중인 경기입니다. 먼저 중단하세요', 'locked');
    if (winner && winner !== m.team_a && winner !== m.team_b) fail('이 경기의 팀이 아닙니다');
    if (m.bracket_id && !winner) fail('토너먼트에서는 승자를 정해야 합니다');
    const prev = m.result || {};
    const result = { ...prev, winner: winner || null, manual: true, reason: 'manual' };
    await db.saveMatch({ id: matchId, status: 'finished', result, ended_at: now() });
    if (m.bracket_id) await advanceBracket(m.league_id, m, winner);
    notify(m.league_id, { what: 'match', match: matchId, status: 'finished', result });
    await maybeFinishLeague(m.league_id);
  }

  async function maybeFinishLeague(leagueId) {
    const l = await mustLeague(leagueId);
    if (l.status !== 'running') return;
    const ms = await db.listMatches(leagueId);
    if (ms.length && ms.every((m) => m.status === 'finished') && cfgOf(l).format !== 'manual') {
      const b = cfgOf(l).bracket;
      if (!b || T.champion(b)) { await db.saveLeague({ id: leagueId, status: 'finished' }); notify(leagueId, { what: 'league', status: 'finished' }); }
    }
  }

  async function recordCodex(l, matchId, teamId, c) {
    try {
      if ((await db.listCodex({ recipe_id: c.recipeId })).length) return; // 첫 발견만
      await db.addCodex({ recipe_id: c.recipeId, found_by_team: teamId, match_id: matchId, public: Boolean(c.public && cfgOf(l).codexPublic) });
    } catch (e) { log.error?.('도감 기록 실패', e); }
  }

  // 서버가 다시 켜졌을 때: 진행 중이던 경기는 '중단' (명세 9-8)
  async function abortStale() {
    let n = 0;
    for (const l of await db.listLeagues()) {
      for (const m of await db.listMatches(l.id)) {
        if (['prep', 'running', 'paused'].includes(m.status)) { await db.saveMatch({ id: m.id, status: 'aborted', result: { aborted: true, reason: 'server_restart', winner: null } }); n++; }
      }
      for (const r of await db.listRosters(l.id)) if (r.locked) await db.saveRoster({ league_id: l.id, team_id: r.team_id, snapshot: r.snapshot, locked: false });
    }
    return n;
  }

  // ── 조회 ───────────────────────────────────────────────
  async function standings(leagueId) {
    const l = await mustLeague(leagueId);
    const ms = (await db.listMatches(leagueId)).map((m) => ({ a: m.team_a, b: m.team_b, status: m.status === 'finished' ? 'done' : m.status, result: m.result }));
    const teams = (await db.listLeagueTeams(leagueId)).map((x) => x.team_id);
    return T.computeStandings(ms, { points: cfgOf(l).points, teamIds: teams });
  }

  // 관제 스크린이 읽는 공개 정보: 설계·전술은 들어 있지 않다
  async function publicView(codeOrId) {
    const l = (await db.getLeagueByCode(codeOrId)) || (await db.getLeague(codeOrId));
    if (!l) return null;
    const cfg = cfgOf(l);
    const teamNames = Object.fromEntries((await db.listTeams()).map((t) => [t.id, { name: t.name, color: t.color }]));
    const matches = (await db.listMatches(l.id)).map((m) => ({
      id: m.id, round: m.round, slot: m.slot, teamA: m.team_a, teamB: m.team_b, status: m.status, replayId: m.replay_id,
      map: cfg.mapsPublic || ['running', 'paused', 'finished'].includes(m.status) ? m.map_id : null,
      result: m.result ? { winner: m.result.winner, reason: m.result.reason, ratios: m.result.ratios, manual: Boolean(m.result.manual) } : null,
    }));
    return {
      id: l.id, name: l.name, status: l.status, code: l.view_code, teamSize: cfg.teamSize, format: cfg.format,
      teams: teamNames, registered: (await db.listLeagueTeams(l.id)).map((x) => x.team_id), matches, standings: cfg.format === 'roundrobin' ? await standings(l.id) : null,
      bracket: cfg.bracket ? { format: cfg.bracket.format, size: cfg.bracket.size, matches: cfg.bracket.matches } : null,
      active: [...runners.entries()].filter(([, x]) => x.leagueId === l.id).map(([id, x]) => ({ id, status: x.runner.status })),
    };
  }

  async function listOpen() {
    return (await db.listLeagues()).filter((l) => l.status === 'open' || l.status === 'running').map((l) => ({ id: l.id, name: l.name, status: l.status, teamSize: cfgOf(l).teamSize, weightCap: cfgOf(l).weightCap, budget: cfgOf(l).budget, maintenance: cfgOf(l).maintenance }));
  }

  return {
    createLeague, updateLeague, refreshBalance, registerRoster, withdrawTeam, generateSchedule, addManualMatch,
    prepareMatch, startMatch, pauseMatch, resumeMatch, abortMatch, setResult, abortStale,
    standings, publicView, listOpen,
    runnerOf: (matchId) => runners.get(matchId)?.runner ?? null,
    get activeCount() { return runners.size; },
    abortAll(reason = 'server_stop') { for (const [id, x] of [...runners]) { if (x.runner.isActive()) x.runner.abort(reason); else runners.delete(id); } },
  };
}

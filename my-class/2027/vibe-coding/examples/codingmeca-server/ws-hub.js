// server/ws-hub.js  (74번)
// WebSocket 허브: 접속 → 인증 → 방(관람/리그) 구독 → 명령 처리. 모든 권한 판단은 여기서 서버가 한다. (명세 4-3, 16)
//
// 클라이언트 → 서버:  auth{token} | join_view{code} | leave_view | join_league{leagueId}(지휘관) | ping
//                    cmd{rid, op, ...인자}  → 응답 res{id: rid, ok, data|error, code}
//                    practice_start{roster, opponent, mapId} | practice_stop
// 서버 → 클라이언트:  auth_ok{user} | error{code,message} | pong | res | league_update | view_ok
//                    match_prepare / match_start / state / match_status / cinematic_* / match_end  (모두 match 필드 포함)
//                    replay_chunk{replay, seq, msgs[]} | replay_end{replay} | practice_end
//
// 명령 표(op):            필요 역할
//   league.list                  로그인
//   league.view {code|leagueId}  누구나(코드) / 로그인
//   league.standings {leagueId}  로그인
//   league.create/update/refreshBalance, schedule.generate, match.add/prepare/start/pause/resume/abort/result, team.withdraw, recipes.reload   지휘관
//   roster.register {leagueId, robotIds[]}   로그인(지휘관은 teamId 지정 가능)
//   replay.get {replayId, code?}  로그인 또는 관람 코드
//   codex.list                   로그인(지휘관은 전체, 그 외는 공개 항목만)

import { WebSocketServer } from 'ws';
import { LeagueError } from './league-manager.js';
import { PracticeError } from './practice-session.js';

const MAX_PAYLOAD = 256 * 1024;
const MAX_BUFFERED = 2 * 1024 * 1024; // 느린 접속에는 state 를 건너뛴다
const CMD_PER_SEC = 30;
const REPLAY_BATCH = 120;

export function createHub({ server, path = '/ws', guard, leagues, practice, replayStore, db, admin = {}, log = console } = {}) {
  const wss = new WebSocketServer({ server, path, maxPayload: MAX_PAYLOAD });
  const rooms = new Map(); // room → Set<client>
  const byUser = new Map(); // userId → Set<client>

  const sendTo = (c, msg) => {
    if (c.ws.readyState !== 1) return;
    if (msg.type === 'state' && c.ws.bufferedAmount > MAX_BUFFERED) return;
    try { c.ws.send(JSON.stringify(msg)); } catch (e) { log.warn?.('send 오류', e.message); }
  };
  const join = (c, room) => { if (!rooms.has(room)) rooms.set(room, new Set()); rooms.get(room).add(c); c.rooms.add(room); };
  const leave = (c, room) => { rooms.get(room)?.delete(c); c.rooms.delete(room); if (rooms.get(room)?.size === 0) rooms.delete(room); };
  const err = (c, code, message, id) => (id !== undefined ? sendTo(c, { type: 'res', id, ok: false, code, error: message }) : sendTo(c, { type: 'error', code, message, error: message }));

  function publish(room, msg) { const set = rooms.get(room); if (set) for (const c of set) sendTo(c, msg); }
  function sendUser(userId, msg) { const set = byUser.get(userId); if (set) for (const c of set) sendTo(c, msg); }

  // 새로 들어온 관람자에게 지금 상태를 먼저 보내 준다
  async function catchUp(c, leagueId) {
    const view = await leagues.publicView(leagueId);
    if (view) sendTo(c, { type: 'view_ok', view });
    for (const a of view?.active || []) {
      const r = leagues.runnerOf(a.id);
      if (!r) continue;
      sendTo(c, { type: 'match_prepare', match: a.id, init: r.init, teams: r.teamInfo });
      const s = r.lastState();
      if (s) sendTo(c, { type: 'state', match: a.id, s });
      sendTo(c, { type: 'match_status', match: a.id, status: r.status });
    }
  }

  const need = (c, role) => {
    if (!c.who) throw new LeagueError('로그인이 필요합니다', 'auth');
    if (!guard.can(c.who, role)) throw new LeagueError('지휘관만 할 수 있습니다', 'forbidden');
  };
  const matchLeague = async (matchId) => { const m = await db.getMatch(matchId); if (!m) throw new LeagueError('없는 경기입니다', 'not_found'); return m.league_id; };

  const OPS = {
    'league.list': async (c) => { need(c, 'mechanic'); return leagues.listOpen(); },
    'leagues.list': async (c) => { need(c, 'commander'); return leagues.listOpen(); },
    'room.join': async (c, a) => { need(c, 'commander'); join(c, `league:${a.leagueId}`); await catchUp(c, a.leagueId); return {}; },
    'league.withdraw': async (c, a) => { need(c, 'commander'); await leagues.withdrawTeam(a.leagueId, a.teamId); return {}; },
    'league.view': async (c, a) => {
      let v = null;
      if (a.code) v = await leagues.publicView(String(a.code).toUpperCase());
      else { need(c, 'mechanic'); v = await leagues.publicView(a.leagueId); }
      if (!v) throw new LeagueError('없는 리그입니다', 'not_found');
      return v;
    },
    'balance.get': async (c, a) => {
      need(c, 'mechanic');
      const row = await db.getBalance(a.version ? Number(a.version) : null);
      return row ? { version: row.version, data: row.data, note: row.note || '', createdAt: row.created_at } : { version: 0, data: { constants: {} }, note: '', createdAt: null };
    },
    'league.standings': async (c, a) => { need(c, 'mechanic'); return leagues.standings(a.leagueId); },
    'league.create': async (c, a) => { need(c, 'commander'); const l = await leagues.createLeague(c.who, a.config); join(c, `league:${l.id}`); return { id: l.id, code: l.view_code, name: l.name, status: l.status }; },
    'league.update': async (c, a) => { need(c, 'commander'); const l = await leagues.updateLeague(a.leagueId, a.config || {}); return { id: l.id, config: l.config }; },
    'league.refreshBalance': async (c, a) => { need(c, 'commander'); const l = await leagues.refreshBalance(a.leagueId); return { balance_version: l.balance_version }; },
    'roster.register': async (c, a) => { need(c, 'mechanic'); return leagues.registerRoster(c.who, { leagueId: a.leagueId, robotIds: a.robotIds, teamId: a.teamId }); },
    'team.withdraw': async (c, a) => { need(c, 'commander'); await leagues.withdrawTeam(a.leagueId, a.teamId); return {}; },
    'schedule.generate': async (c, a) => { need(c, 'commander'); join(c, `league:${a.leagueId}`); return { matches: await leagues.generateSchedule(a.leagueId) }; },
    'match.add': async (c, a) => { need(c, 'commander'); const m = await leagues.addManualMatch(a.leagueId, { teamA: a.teamA, teamB: a.teamB, mapId: a.mapId }); return { id: m.id }; },
    'match.prepare': async (c, a) => { need(c, 'commander'); join(c, `league:${await matchLeague(a.matchId)}`); return leagues.prepareMatch(a.matchId, { mapId: a.mapId }); },
    'match.start': async (c, a) => { need(c, 'commander'); join(c, `league:${await matchLeague(a.matchId)}`); return leagues.startMatch(a.matchId, { mapId: a.mapId }); },
    'match.pause': async (c, a) => { need(c, 'commander'); await leagues.pauseMatch(a.matchId); return {}; },
    'match.resume': async (c, a) => { need(c, 'commander'); await leagues.resumeMatch(a.matchId); return {}; },
    'match.abort': async (c, a) => { need(c, 'commander'); await leagues.abortMatch(a.matchId, 'commander'); return {}; },
    'match.result': async (c, a) => { need(c, 'commander'); await leagues.setResult(a.matchId, { winner: a.winner ?? null }); return {}; },
        'codex.list': async (c) => {
      need(c, 'mechanic');
      const rows = await db.listCodex(c.who.role === 'commander' ? {} : { public: true });
      return rows.map((r) => ({ recipeId: r.recipe_id, team: r.found_by_team, at: r.found_at, match: r.match_id, public: Boolean(r.public) }));
    },
    'replay.get': async (c, a) => {
      if (!c.who) { const l = a.code ? await db.getLeagueByCode(a.code) : null; if (!l) throw new LeagueError('로그인이 필요합니다', 'auth'); }
      const rp = await replayStore.load(a.replayId);
      if (!rp) throw new LeagueError('없는 리플레이입니다', 'not_found');
      const matchId = rp.meta?.matchId ?? a.matchId ?? a.replayId;
      const msgs = replayStore.toMessages(rp, matchId);
      setImmediate(() => {
        for (let i = 0, seq = 0; i < msgs.length; i += REPLAY_BATCH, seq++) sendTo(c, { type: 'replay_chunk', replay: a.replayId, seq, msgs: msgs.slice(i, i + REPLAY_BATCH) });
        sendTo(c, { type: 'replay_end', replay: a.replayId });
      });
      return { init: rp.init, result: rp.result, meta: rp.meta, frames: msgs.length, match: matchId };
    },
  };

  async function onCmd(c, m) {
    let fn = OPS[m.op];
    if (!fn && admin.ops?.has?.(m.op)) fn = async (cc, a) => { need(cc, 'commander'); return admin.ops.run(m.op, a, cc.who); };
    const rid = m.rid ?? m.id; // 요청 번호(rid). 구버전 호출은 id
    if (!fn) return err(c, 'bad_op', `알 수 없는 명령: ${m.op}`, rid);
    try { sendTo(c, { type: 'res', id: rid, ok: true, data: await fn(c, m) }); }
    catch (e) {
      if (e instanceof LeagueError || e instanceof PracticeError) err(c, e.code, e.message, rid);
      else { log.error?.(`명령 오류(${m.op})`, e); err(c, 'server', '서버에서 처리하지 못했습니다', rid); }
    }
  }

  async function onMessage(c, m) {
    switch (m.type) {
      case 'ping': return sendTo(c, { type: 'pong', t: m.t ?? null });
      case 'auth': {
        const who = await guard.verify(m.token);
        if (!who) return err(c, 'auth', '로그인 정보를 확인할 수 없습니다');
        c.who = who;
        if (!byUser.has(who.id)) byUser.set(who.id, new Set());
        byUser.get(who.id).add(c);
        return sendTo(c, { type: 'auth_ok', user: { id: who.id, nickname: who.nickname, role: who.role, teamId: who.teamId } });
      }
      case 'join_view': {
        const l = await db.getLeagueByCode(m.code);
        if (!l) return err(c, 'not_found', '관람 코드가 맞지 않습니다');
        join(c, `league:${l.id}`);
        return catchUp(c, l.id);
      }
      case 'join_league': {
        need(c, 'commander');
        join(c, `league:${m.leagueId}`);
        return catchUp(c, m.leagueId);
      }
      case 'leave_view': for (const r of [...c.rooms]) leave(c, r); return undefined;
      case 'cmd': return onCmd(c, m);
      case 'practice_start': {
        try { need(c, 'mechanic'); const r = await practice.start(c.who, m); sendTo(c, { type: 'practice_ready', ...r }); }
        catch (e) { err(c, e.code || 'server', e.message); if (!(e instanceof LeagueError || e instanceof PracticeError)) log.error?.(e); }
        return undefined;
      }
      case 'practice_stop': if (c.who) practice.stop(c.who.id); return undefined;
      default: return err(c, 'bad_type', `알 수 없는 메시지: ${m.type}`);
    }
  }

  wss.on('connection', (ws) => {
    const c = { ws, who: null, rooms: new Set(), tokens: CMD_PER_SEC, refill: Date.now(), alive: true };
    ws.on('pong', () => { c.alive = true; });
    ws.on('message', (raw) => {
      const now = Date.now();
      c.tokens = Math.min(CMD_PER_SEC, c.tokens + ((now - c.refill) / 1000) * CMD_PER_SEC); c.refill = now;
      let m;
      try { m = JSON.parse(raw.toString()); } catch { return err(c, 'bad_json', '메시지를 읽을 수 없습니다'); }
      if (!m || typeof m.type !== 'string') return err(c, 'bad_json', '메시지 형식이 맞지 않습니다');
      if (m.type !== 'ping' && --c.tokens < 0) return err(c, 'rate', '요청이 너무 빠릅니다', m.rid ?? m.id);
      onMessage(c, m).catch((e) => {
        if (e instanceof LeagueError || e instanceof PracticeError) err(c, e.code, e.message, m.rid ?? m.id);
        else { log.error?.('메시지 처리 오류', e); err(c, 'server', '서버에서 처리하지 못했습니다', m.rid ?? m.id); }
      });
    });
    ws.on('close', () => {
      for (const r of [...c.rooms]) leave(c, r);
      if (c.who) { const s = byUser.get(c.who.id); s?.delete(c); if (s && !s.size) { byUser.delete(c.who.id); practice.stop(c.who.id); } }
    });
    ws.on('error', () => {});
  });

  // 끊어진 접속 정리(30초마다)
  const beat = setInterval(() => { for (const ws of wss.clients) { const alive = ws.__alive !== false; if (!alive) { ws.terminate(); continue; } ws.__alive = false; ws.ping(); ws.once('pong', () => { ws.__alive = true; }); } }, 30_000);
  beat.unref?.();

  return {
    publish, sendUser,
    get clients() { return wss.clients.size; },
    close: () => new Promise((res) => { clearInterval(beat); for (const ws of wss.clients) ws.terminate(); wss.close(() => res()); }),
  };
}

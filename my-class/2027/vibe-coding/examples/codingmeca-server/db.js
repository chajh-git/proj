// server/db.js  (76번)
// 서버가 쓰는 저장소 입구. 서비스 키로 Supabase에 접속하고(키는 환경 변수로만), 개발 때는 메모리 저장소로 대신할 수 있다.
//   환경 변수: SUPABASE_URL, SUPABASE_SERVICE_KEY  /  DEV_MEMORY_DB=1 이면 메모리 저장소
//   const db = await createDb();
//
// 테이블 열(supabase/schema.sql 이 이 표를 따른다):
//   profiles(id, login_id, nickname, role, team_id)      teams(id, name, color)
//   robots(id, owner, name, design, tactics, updated_at)
//   leagues(id, name, config jsonb, status, view_code, balance_version, created_by, created_at)
//   league_teams(id, league_id, team_id, seed, registered_at)
//   rosters(id, league_id, team_id, snapshot jsonb, locked, updated_at)
//   matches(id, league_id, round, slot, team_a, team_b, map_id, status, result jsonb, replay_id, created_at, started_at, ended_at)
//   replays(id, match_id, meta jsonb, data text(base64 gzip), created_at)
//   codex(id, recipe_id, found_by_team, found_at, match_id, public)
//   recipes_secret(id, data jsonb)       balance_public(version, data jsonb, created_by, created_at, note)

import { randomUUID } from 'node:crypto';

const matches = (row, filter) => Object.entries(filter).every(([k, v]) => (Array.isArray(v) ? v.includes(row[k]) : row[k] === v));
const KEYS = { balance_public: 'version' };

function memoryTable(name) {
  const key = KEYS[name] || 'id';
  const rows = [];
  return {
    async select(filter = {}, { order = null, limit = null } = {}) {
      let out = rows.filter((r) => matches(r, filter)).map((r) => structuredClone(r));
      if (order) { const [col, dir] = order; out.sort((a, b) => (a[col] > b[col] ? 1 : a[col] < b[col] ? -1 : 0) * (dir === 'desc' ? -1 : 1)); }
      if (limit) out = out.slice(0, limit);
      return out;
    },
    async upsert(row) {
      const r = structuredClone(row);
      if (r[key] === undefined) r[key] = randomUUID();
      const i = rows.findIndex((x) => x[key] === r[key]);
      if (i >= 0) rows[i] = { ...rows[i], ...r }; else rows.push(r);
      return structuredClone(i >= 0 ? rows[i] : r);
    },
    async remove(filter) { for (let i = rows.length - 1; i >= 0; i--) if (matches(rows[i], filter)) rows.splice(i, 1); },
  };
}

function supabaseTable(sb, name) {
  const key = KEYS[name] || 'id';
  const fail = (e) => { throw new Error(`${name}: ${e.message}`); };
  return {
    async select(filter = {}, { order = null, limit = null } = {}) {
      let q = sb.from(name).select('*');
      for (const [k, v] of Object.entries(filter)) q = Array.isArray(v) ? q.in(k, v) : q.eq(k, v);
      if (order) q = q.order(order[0], { ascending: order[1] !== 'desc' });
      if (limit) q = q.limit(limit);
      const { data, error } = await q;
      if (error) fail(error);
      return data || [];
    },
    async upsert(row) {
      const r = { ...row };
      if (r[key] === undefined && key === 'id') r.id = randomUUID();
      const { data, error } = await sb.from(name).upsert(r).select().single();
      if (error) fail(error);
      return data;
    },
    async remove(filter) {
      let q = sb.from(name).delete();
      for (const [k, v] of Object.entries(filter)) q = q.eq(k, v);
      const { error } = await q;
      if (error) fail(error);
    },
  };
}

const TABLE_NAMES = ['profiles', 'teams', 'robots', 'leagues', 'league_teams', 'rosters', 'matches', 'replays', 'codex', 'recipes_secret', 'balance_public'];

export async function createDb({ env = process.env, log = console } = {}) {
  let t;
  let mode;
  let sb = null;
  if (env.DEV_MEMORY_DB === '1') {
    mode = 'memory';
    t = Object.fromEntries(TABLE_NAMES.map((n) => [n, memoryTable(n)]));
  } else {
    if (!env.SUPABASE_URL || !env.SUPABASE_SERVICE_KEY) throw new Error('SUPABASE_URL, SUPABASE_SERVICE_KEY 환경 변수가 필요합니다 (개발용: DEV_MEMORY_DB=1)');
    const { createClient } = await import('@supabase/supabase-js');
    sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_KEY, { auth: { persistSession: false, autoRefreshToken: false } });
    mode = 'supabase';
    t = Object.fromEntries(TABLE_NAMES.map((n) => [n, supabaseTable(sb, n)]));
  }
  log.info?.(`DB: ${mode}`);

  const one = async (table, filter) => (await t[table].select(filter, { limit: 1 }))[0] || null;

  return {
    mode,
    raw: t,
    auth: sb ? sb.auth : null, // auth-guard 가 토큰 검증에 사용
    admin: sb ? sb.auth.admin : null, // 계정 만들기·비밀번호 재설정(admin-ops)

    // 계정·기체
    getProfile: (id) => one('profiles', { id }),
    getTeam: (id) => one('teams', { id }),
    listTeams: () => t.teams.select({}),
    async getRobots(ownerId, ids) {
      const rows = await t.robots.select({ owner: ownerId, id: ids });
      return ids.map((id) => rows.find((r) => r.id === id)).filter(Boolean);
    },

    // 비밀 레시피·공개 수치
    async getSecretRecipes() { return (await t.recipes_secret.select({})).map((r) => ({ ...r.data, id: r.data?.id ?? r.id })); },
    async saveSecretRecipe(id, data) { return t.recipes_secret.upsert({ id, data }); },
    async getBalance(version = null) {
      const rows = await t.balance_public.select(version ? { version } : {}, { order: ['version', 'desc'], limit: 1 });
      return rows[0] || null;
    },

    // 리그
    listLeagues: () => t.leagues.select({}, { order: ['created_at', 'desc'] }),
    getLeague: (id) => one('leagues', { id }),
    getLeagueByCode: (code) => one('leagues', { view_code: String(code || '').toUpperCase() }),
    saveLeague: (row) => t.leagues.upsert(row.id ? row : { created_at: new Date().toISOString(), ...row }),
    listLeagueTeams: (leagueId) => t.league_teams.select({ league_id: leagueId }),
    addLeagueTeam: async (row) => (await one('league_teams', { league_id: row.league_id, team_id: row.team_id })) || t.league_teams.upsert({ registered_at: new Date().toISOString(), ...row }),
    removeLeagueTeam: (leagueId, teamId) => t.league_teams.remove({ league_id: leagueId, team_id: teamId }),
    getRoster: (leagueId, teamId) => one('rosters', { league_id: leagueId, team_id: teamId }),
    listRosters: (leagueId) => t.rosters.select({ league_id: leagueId }),
    async saveRoster({ league_id, team_id, snapshot, locked = false }) {
      const cur = await one('rosters', { league_id, team_id });
      return t.rosters.upsert({ ...(cur ? { id: cur.id } : {}), league_id, team_id, snapshot, locked, updated_at: new Date().toISOString() });
    },

    // 경기·리플레이·도감
    listMatches: (leagueId) => t.matches.select({ league_id: leagueId }, { order: ['round', 'asc'] }),
    getMatch: (id) => one('matches', { id }),
    saveMatch: (row) => t.matches.upsert(row),
    saveReplay: (row) => t.replays.upsert({ created_at: new Date().toISOString(), ...row }),
    getReplay: (id) => one('replays', { id }),
    addCodex: (row) => t.codex.upsert({ found_at: new Date().toISOString(), ...row }),
    listCodex: (filter = {}) => t.codex.select(filter, { order: ['found_at', 'asc'] }),
  };
}

// server/admin-ops.js
// 지휘 본부 전용 명령: 비밀 레시피 관리, 계정·팀 관리. 호출 전에 허브가 '지휘관인지'를 이미 검사한다.
//   const ops = createAdminOps({ db, loader });   await ops.run(op, msg, who)  → 결과 데이터 (오류는 LeagueError)
// 레시피는 DB(recipes_secret)에 그대로 저장하고, 저장 전에 서버가 형식을 검사한다. 저장·삭제 뒤에는 다시 읽어 다음 경기부터 반영한다.
// 비밀번호는 서버에서만 다룬다(서비스 키). 응답에 비밀번호를 되돌려 보내지 않는다.

import { normalizeRecipe } from './sim/recipe-loader.js';
import { normalizeBalance, diffBalance } from '#shared/balance/merge.js';
import { LeagueError } from './league-manager.js';

const fail = (m, c) => { throw new LeagueError(m, c); };
const LOGIN_RE = /^[a-z0-9_]{3,20}$/;
const DOMAIN = 'codingmeca.invalid';

export function createAdminOps({ db, loader, balanceCache = null, log = console } = {}) {
  async function reload() { await loader.load(); return { count: loader.recipes.length, errors: loader.errors }; }

  const ops = {
    // ── 리그 목록(끝난 것 포함, 설정 포함) ──
    async 'leagues.all'() {
      return (await db.listLeagues()).map((l) => ({ id: l.id, name: l.name, status: l.status, code: l.view_code, config: l.config, balance: l.balance_version, createdAt: l.created_at }));
    },

    // ── 밸런스(조율 센터) ──
    async 'balance.list'() {
      const rows = await db.raw.balance_public.select({}, { order: ['version', 'desc'], limit: 30 });
      return rows.map((r) => ({ version: r.version, note: r.note || '', createdAt: r.created_at, changes: Object.keys(r.data?.constants || {}).length }));
    },
    async 'balance.save'(m, who) {
      const { data, issues, ok } = normalizeBalance(m.data);
      if (!ok) fail(`저장할 수 없습니다: ${issues.filter((i) => i.level === 'error').map((i) => i.message).join(' / ')}`);
      const latest = await db.getBalance();
      const cur = latest?.version ?? 0;
      if (Number.isFinite(Number(m.baseVersion)) && Number(m.baseVersion) !== cur) fail(`다른 곳에서 먼저 v${cur} 이(가) 저장되었습니다. 새로 불러온 뒤 다시 저장해 주세요`, 'conflict');
      if (!diffBalance(latest?.data || { constants: {} }, data).length) fail('바뀐 값이 없습니다', 'nochange');
      const row = await db.raw.balance_public.upsert({ version: cur + 1, data, created_by: /^[0-9a-f-]{36}$/.test(who?.id || '') ? who.id : null, created_at: new Date().toISOString(), note: String(m.note || '').slice(0, 80) });
      balanceCache?.clear();
      return { version: row.version, warnings: issues.filter((i) => i.level !== 'error').map((i) => i.message) };
    },

    // ── 레시피 ──
    async 'recipes.list'() {
      const secret = await db.getSecretRecipes();
      return { secret, defaults: loader.recipes.filter((r) => !secret.some((s) => s.id === r.id)).map((r) => ({ id: r.id, name: r.name, kind: r.kind })), errors: loader.errors };
    },
    async 'recipes.save'(m) {
      const raw = m.recipe;
      if (!raw || typeof raw !== 'object') fail('레시피 내용이 필요합니다');
      const { errors } = normalizeRecipe(raw);
      if (errors.length) fail(errors.join(' / '));
      const { id, ...rest } = raw;
      await db.saveSecretRecipe(String(id).trim(), { ...rest, id: String(id).trim() });
      return reload();
    },
    async 'recipes.delete'(m) {
      await db.raw.recipes_secret.remove({ id: String(m.id) });
      return reload();
    },
    'recipes.reload': reload,

    // ── 팀 ──
    async 'team.save'(m) {
      const id = String(m.id || '').trim().toLowerCase();
      if (!/^[a-z0-9_]{1,12}$/.test(id)) fail('팀 ID는 영문 소문자·숫자·밑줄 1~12자입니다');
      const name = String(m.name || '').trim().slice(0, 30);
      if (!name) fail('팀 이름이 필요합니다');
      const color = /^#[0-9a-fA-F]{6}$/.test(m.color || '') ? m.color : '#888888';
      await db.raw.teams.upsert({ id, name, color });
      return { id };
    },
    async 'team.delete'(m) { await db.raw.teams.remove({ id: String(m.id) }); return {}; },

    // ── 계정 ──
    async 'account.list'() {
      const [profiles, teams] = await Promise.all([db.raw.profiles.select({}, { order: ['login_id', 'asc'] }), db.listTeams()]);
      return { profiles: profiles.map((p) => ({ id: p.id, loginId: p.login_id, nickname: p.nickname, role: p.role, teamId: p.team_id })), teams };
    },
    async 'account.update'(m, who) {
      const p = await db.getProfile(String(m.id));
      if (!p) fail('없는 계정입니다', 'not_found');
      const patch = { id: p.id };
      if (m.teamId !== undefined) patch.team_id = m.teamId || null;
      if (m.nickname !== undefined) patch.nickname = String(m.nickname).trim().slice(0, 20);
      if (m.role !== undefined) {
        if (!['mechanic', 'commander'].includes(m.role)) fail('역할이 올바르지 않습니다');
        if (p.id === who.id && m.role !== 'commander') fail('자기 자신의 지휘관 권한은 내릴 수 없습니다');
        patch.role = m.role;
      }
      await db.raw.profiles.upsert({ ...p, ...patch });
      return {};
    },
    async 'account.create'(m) {
      const list = Array.isArray(m.accounts) ? m.accounts.slice(0, 80) : [];
      if (!list.length) fail('만들 계정이 없습니다');
      const out = [];
      for (const a of list) {
        const loginId = String(a.loginId || '').trim().toLowerCase();
        const password = String(a.password || '');
        if (!LOGIN_RE.test(loginId)) { out.push({ loginId, ok: false, error: '아이디는 영문 소문자·숫자·밑줄 3~20자' }); continue; }
        if (password.length < 6) { out.push({ loginId, ok: false, error: '비밀번호는 6자 이상' }); continue; }
        try {
          let id;
          if (db.admin) {
            const { data, error } = await db.admin.createUser({ email: `${loginId}@${DOMAIN}`, password, email_confirm: true, user_metadata: { nickname: a.nickname || loginId } });
            if (error) throw new Error(error.message);
            id = data.user.id;
            await new Promise((r) => setTimeout(r, 120)); // 가입 트리거가 프로필을 만들 시간
          } else { id = `dev-${loginId}`; await db.raw.profiles.upsert({ id, login_id: loginId, nickname: a.nickname || loginId, role: 'mechanic', team_id: null }); }
          if (a.teamId) { const p = await db.getProfile(id); if (p) await db.raw.profiles.upsert({ ...p, team_id: a.teamId }); }
          out.push({ loginId, ok: true });
        } catch (e) { out.push({ loginId, ok: false, error: /already|exists|registered/i.test(e.message) ? '이미 있는 아이디입니다' : '만들지 못했습니다' }); log.warn?.('계정 생성 실패', loginId, e.message); }
      }
      return { results: out };
    },
    async 'account.reset_password'(m) {
      const pw = String(m.password || '');
      if (pw.length < 6) fail('비밀번호는 6자 이상이어야 합니다');
      if (!db.admin) { if (db.mode === 'memory') return {}; fail('이 서버에서는 비밀번호를 바꿀 수 없습니다', 'server'); }
      const { error } = await db.admin.updateUserById(String(m.id), { password: pw });
      if (error) fail('바꾸지 못했습니다', 'server');
      return {};
    },
  };

  return {
    has: (op) => Object.prototype.hasOwnProperty.call(ops, op),
    run: (op, m, who) => ops[op](m, who),
  };
}

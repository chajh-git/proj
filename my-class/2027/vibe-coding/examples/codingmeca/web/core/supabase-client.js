// web/core/supabase-client.js  (51번)
// Supabase 연결: 아이디+비밀번호 로그인(가상 이메일 방식), 프로필, 기체 저장·불러오기, 밸런스 버전 읽기.
//  - 아이디 → `아이디@codingmeca.invalid` 로 바꿔 Supabase 이메일 로그인에 넣는다. (config/constants.js account)
//  - Supabase 프로젝트에서 "이메일 확인(Confirm email)"을 꺼 두어야 가입 즉시 로그인된다.
//  - 역할(role)은 DB의 profiles 에서 읽는다. 화면 안내용일 뿐, 실제 권한은 서버와 DB 정책이 검증한다.
//  - 테이블 이름은 TABLES 에 모았고, supabase/schema.sql(85번)이 이 이름·열을 따른다.
//    profiles(id, login_id, nickname, role) / robots(id, owner, name, design jsonb, tactics jsonb, updated_at) /
//    balance_public(version, data jsonb, created_at)
// 라이브러리는 config/env.js 의 주소에서 필요할 때 불러온다. 테스트에서는 loader로 가짜를 넣는다.

import { CONSTANTS } from '../../config/constants.js';
import { ENV, isOnlineConfigured } from '../../config/env.js';

export const TABLES = Object.freeze({ profiles: 'profiles', robots: 'robots', balance: 'balance_public' });

// ── 입력 검사 (서버와 같은 규칙) ──────────────────────────
const A = CONSTANTS.account;
const idRe = new RegExp(A.loginIdPattern);

export const toVirtualEmail = (loginId) => `${String(loginId).trim().toLowerCase()}@${A.virtualEmailDomain}`;
export const fromVirtualEmail = (email) => String(email || '').split('@')[0];

export function validateLoginId(id) {
  return idRe.test(String(id || '')) ? null : '아이디는 영문 소문자·숫자·밑줄(_) 3~16자로 입력해 주세요';
}
export function validatePassword(pw) {
  return String(pw || '').length >= A.passwordMinLength ? null : `비밀번호는 ${A.passwordMinLength}자 이상이어야 합니다`;
}
export function validateNickname(n) {
  const s = String(n || '').trim();
  if (!s) return '이름(별명)을 입력해 주세요';
  return s.length <= A.nicknameMaxLength ? null : `이름(별명)은 ${A.nicknameMaxLength}자 이하로 입력해 주세요`;
}

// Supabase 오류 → 알아보기 쉬운 문구
export function friendlyError(err) {
  const msg = String(err?.message || err || '');
  const code = err?.code || '';
  if (/invalid login credentials|invalid_credentials/i.test(msg + code)) return '아이디 또는 비밀번호가 맞지 않습니다';
  if (/already registered|user_already_exists|already been registered/i.test(msg + code)) return '이미 사용 중인 아이디입니다';
  if (/weak_password|password should be/i.test(msg + code)) return '비밀번호가 너무 약합니다';
  if (/rate limit|over_request_rate_limit|too many/i.test(msg + code)) return '잠시 후 다시 시도해 주세요';
  if (/failed to fetch|network|load failed/i.test(msg)) return '서버에 연결할 수 없습니다. 인터넷 연결을 확인해 주세요';
  if (/email not confirmed/i.test(msg)) return '계정 확인이 필요합니다(관리자에게 문의)';
  return msg || '알 수 없는 오류가 발생했습니다';
}

const fail = (e) => ({ ok: false, error: friendlyError(e) });

// ── 클라이언트 만들기 ─────────────────────────────────────
export async function createSupabaseClient({ env = ENV, loader = null } = {}) {
  if (!isOnlineConfigured(env)) return createOfflineClient();
  const lib = loader ? await loader() : await import(/* @vite-ignore */ env.supabaseEsm);
  const sb = lib.createClient(env.supabaseUrl, env.supabaseAnonKey, {
    auth: { persistSession: true, autoRefreshToken: true, detectSessionInUrl: false },
  });

  async function loadProfile(userId) {
    // 가입 직후에는 DB 트리거가 프로필을 만드는 데 잠깐 걸릴 수 있어 몇 번 다시 시도한다
    for (let i = 0; i < 4; i++) {
      const { data } = await sb.from(TABLES.profiles).select('id, login_id, nickname, role').eq('id', userId).maybeSingle();
      if (data) return { id: data.id, loginId: data.login_id, nickname: data.nickname, role: data.role };
      await new Promise((r) => setTimeout(r, 250 * (i + 1)));
    }
    return null;
  }

  const toSession = async (session) => {
    if (!session?.user) return null;
    const profile = await loadProfile(session.user.id);
    if (!profile) return null;
    return { user: profile, role: profile.role, token: session.access_token };
  };

  return {
    online: true,
    raw: sb,

    async signUp({ loginId, password, nickname }) {
      const bad = validateLoginId(loginId) || validatePassword(password) || validateNickname(nickname);
      if (bad) return { ok: false, error: bad };
      const { data, error } = await sb.auth.signUp({
        email: toVirtualEmail(loginId),
        password,
        options: { data: { login_id: String(loginId).toLowerCase(), nickname: String(nickname).trim() } },
      });
      if (error) return fail(error);
      if (!data.session) return { ok: false, error: '가입은 되었지만 자동 로그인이 꺼져 있습니다(관리자: 이메일 확인 끄기 필요)' };
      const session = await toSession(data.session);
      return session ? { ok: true, session } : { ok: false, error: '프로필을 만들지 못했습니다' };
    },

    async signIn({ loginId, password }) {
      const bad = validateLoginId(loginId) || validatePassword(password);
      if (bad) return { ok: false, error: bad };
      const { data, error } = await sb.auth.signInWithPassword({ email: toVirtualEmail(loginId), password });
      if (error) return fail(error);
      const session = await toSession(data.session);
      return session ? { ok: true, session } : { ok: false, error: '프로필을 찾을 수 없습니다' };
    },

    async signOut() {
      const { error } = await sb.auth.signOut();
      return error ? fail(error) : { ok: true };
    },

    // 새로고침 후 저장된 로그인 복원 → session | null
    async restore() {
      const { data } = await sb.auth.getSession();
      return toSession(data.session);
    },

    // 서버 접속용 토큰(자동 갱신됨)
    async getToken() {
      const { data } = await sb.auth.getSession();
      return data.session?.access_token || null;
    },

    onAuthChange(fn) {
      const { data } = sb.auth.onAuthStateChange(async (event, session) => fn(event, await toSession(session)));
      return () => data.subscription.unsubscribe();
    },

    async updateNickname(nickname) {
      const bad = validateNickname(nickname);
      if (bad) return { ok: false, error: bad };
      const { data: u } = await sb.auth.getUser();
      const { error } = await sb.from(TABLES.profiles).update({ nickname: String(nickname).trim() }).eq('id', u.user.id);
      return error ? fail(error) : { ok: true };
    },

    // ── 기체(설계 + 전술) 저장·불러오기: 본인 행만 RLS가 허용 ──
    robots: {
      async list() {
        const { data, error } = await sb.from(TABLES.robots).select('id, name, design, tactics, updated_at').order('updated_at', { ascending: false });
        return error ? fail(error) : { ok: true, robots: data };
      },
      async save({ id = null, name, design, tactics }) {
        const row = { name: String(name || design?.name || '이름 없는 기체').slice(0, 40), design, tactics, updated_at: new Date().toISOString() };
        const q = id
          ? sb.from(TABLES.robots).update(row).eq('id', id).select('id').single()
          : sb.from(TABLES.robots).insert(row).select('id').single();
        const { data, error } = await q;
        return error ? fail(error) : { ok: true, id: data.id };
      },
      async remove(id) {
        const { error } = await sb.from(TABLES.robots).delete().eq('id', id);
        return error ? fail(error) : { ok: true };
      },
    },

    // 가장 최근 공개 밸런스 버전 → { version, data } | null (없으면 data/*.js 기본값을 쓴다)
    async fetchBalance() {
      const { data, error } = await sb.from(TABLES.balance).select('version, data').order('version', { ascending: false }).limit(1).maybeSingle();
      return error ? null : data;
    },
  };
}

// 접속 정보가 비어 있을 때: 같은 모양의 클라이언트지만 로그인·저장은 막혀 있고 오프라인 안내를 돌려준다.
export function createOfflineClient() {
  const no = async () => ({ ok: false, error: '서버 접속 정보가 설정되지 않았습니다(오프라인 모드)' });
  return {
    online: false,
    raw: null,
    signUp: no, signIn: no, signOut: async () => ({ ok: true }),
    restore: async () => null,
    getToken: async () => null,
    onAuthChange: () => () => {},
    updateNickname: no,
    robots: { list: async () => ({ ok: true, robots: [] }), save: no, remove: no },
    fetchBalance: async () => null,
  };
}

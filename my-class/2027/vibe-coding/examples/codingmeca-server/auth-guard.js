// server/auth-guard.js  (75번)
// 접속 때 보낸 로그인 토큰을 확인해 '누구인지·무슨 역할인지'를 서버가 직접 정한다. 클라이언트가 보낸 역할·수치는 믿지 않는다. (명세 4-3, 16)
//   const guard = createAuthGuard({ db });
//   const who = await guard.verify(token)     // → { id, loginId, nickname, role, teamId } | null
//   guard.can(who, 'commander')               // 역할 검사
//   개발용: DEV_AUTH=1 이면 'dev:<역할>:<아이디>:<닉네임>' 토큰을 받아 준다 (배포 환경에서는 절대 켜지 않는다)

export const ROLES = Object.freeze(['mechanic', 'commander']);

export function createAuthGuard({ db, env = process.env, cacheMs = 60_000, now = () => Date.now() } = {}) {
  const cache = new Map(); // token → { who, until }
  const dev = env.DEV_AUTH === '1';
  if (dev && env.NODE_ENV === 'production') throw new Error('DEV_AUTH 는 배포 환경에서 켤 수 없습니다');

  function fromDevToken(token) {
    const [, role, id, nickname] = token.split(':');
    if (!ROLES.includes(role) || !id) return null;
    return { id: `dev-${id}`, loginId: id, nickname: nickname || id, role, teamId: null };
  }

  async function lookup(token) {
    if (!db.auth) return null;
    const { data, error } = await db.auth.getUser(token);
    if (error || !data?.user) return null;
    const profile = await db.getProfile(data.user.id);
    if (!profile) return null;
    return { id: profile.id, loginId: profile.login_id, nickname: profile.nickname, role: ROLES.includes(profile.role) ? profile.role : 'mechanic', teamId: profile.team_id ?? null };
  }

  return {
    async verify(token) {
      if (typeof token !== 'string' || !token || token.length > 4096) return null;
      if (dev && token.startsWith('dev:')) {
        const w = fromDevToken(token);
        if (w) { try { const p = await db.getProfile(w.id); if (p?.team_id) w.teamId = p.team_id; } catch { /* 개발용 */ } }
        return w;
      }
      const hit = cache.get(token);
      if (hit && hit.until > now()) return hit.who;
      let who = null;
      try { who = await lookup(token); } catch { who = null; }
      if (who) cache.set(token, { who, until: now() + cacheMs });
      else cache.delete(token);
      if (cache.size > 500) for (const [k, v] of cache) if (v.until <= now()) cache.delete(k);
      return who;
    },
    can: (who, role) => Boolean(who) && (role === 'mechanic' ? true : who.role === role),
    // 역할이 바뀌었을 수 있으니 캐시를 비운다(지휘관 승격 직후 등)
    forget(token) { cache.delete(token); },
  };
}

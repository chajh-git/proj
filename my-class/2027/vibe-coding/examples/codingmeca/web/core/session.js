// web/core/session.js  (70·71번 보조)
// 페이지를 옮겨도 로그인 상태가 이어지게 한다.
//  · 온라인: Supabase가 브라우저에 세션을 저장해 두므로 client.restore() 로 되살린다.
//  · 오프라인 시작: 이 탭의 sessionStorage 에만 잠깐 남긴다(탭을 닫으면 사라짐, 개인 정보 없음).

const KEY = 'codingmeca.offlineSession';

export function rememberSession(store, client) {
  return store.on('session', (s) => {
    try {
      if (!s?.user) sessionStorage.removeItem(KEY);
      else if (!client.online) sessionStorage.setItem(KEY, JSON.stringify({ user: s.user, role: s.role }));
    } catch { /* 저장 불가 환경 */ }
  });
}

// 저장된 세션을 store 에 채우고 { user, role, token } 을 돌려준다(없으면 null)
export async function restoreSession(store, client) {
  let s = null;
  try { s = await client.restore(); } catch { s = null; }
  if (!s) {
    try { const raw = sessionStorage.getItem(KEY); if (raw) { const o = JSON.parse(raw); if (o?.user) s = { user: o.user, role: o.role, token: null }; } } catch { /* 무시 */ }
  }
  if (s) store.patch({ 'session.user': s.user, 'session.role': s.role, 'session.token': s.token || null });
  return s;
}

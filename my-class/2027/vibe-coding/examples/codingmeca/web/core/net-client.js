// web/core/net-client.js  (52번)
// 서버(WebSocket, JSON) 통신 + 관람용 상태 버퍼. (명세 16장, 9-6장)
//   클라이언트→서버: auth, join_view(code), cmd, practice_start(roster)   (+ ping)
//   서버→클라이언트: match_prepare, match_start, state(20Hz), event, match_status, cinematic_start/resume/end, match_end, league_update,
//                    view_ok, res (명령 응답)   (+ auth_ok, error, pong)
//
//   const net = createNetClient({ url, getToken, store });
//   net.on('match_start', (msg) => ...);  net.connect();
//   net.joinView('ABCDEF');                       // 로그인 없이도 가능(읽기 전용)
//   const r = await net.request('match.start', { matchId });   // → { ok, data } | { ok:false, error, code }   (권한은 서버가 검사)
//   net.practiceStart(robotIds, { opponent, mapId });
//
// 연결이 끊기면 지수 백오프로 다시 연결하고, 다시 연결되면 인증과 관람 코드 입장을 자동으로 되풀이한다.
// 서버는 클라이언트가 보낸 수치를 믿지 않는다(명령 권한을 서버가 검사). 여기서는 전달만 한다.
//
// StateBuffer: 관람 화면은 서버보다 viewBufferSeconds(0.6초) 늦게 재생한다.
//   push(snap) 로 받은 스냅샷을 쌓고, advance(dt) 마다 재생 시각을 앞으로 보내며 보간된 스냅샷과
//   그 시각을 지난 사건(ev)을 돌려준다. 늦어지면 catchUpSpeed 로 따라잡고, 너무 앞서면 잠깐 늦춘다.
//   오버드라이브 슬로모션은 setTimeScale(0.3) 로 재생만 느리게 한다(시뮬레이션은 그대로).

import { CONSTANTS } from '../../config/constants.js';
import { interpolateSnapshots } from '../../shared/sim/snapshot.js';

export const CLIENT_MSG = Object.freeze(['auth', 'join_view', 'cmd', 'practice_start', 'practice_stop', 'practice_pause', 'practice_resume', 'pilot', 'ping']);
export const SERVER_MSG = Object.freeze(['auth_ok', 'error', 'pong', 'res', 'view_ok', 'league_update', 'match_prepare', 'match_start', 'match_status', 'state', 'event', 'cinematic_start', 'cinematic_resume', 'cinematic_end', 'match_end', 'practice_ok', 'pilot_state']);

// ── 상태 버퍼 ────────────────────────────────────────────
export function createStateBuffer({ delay = CONSTANTS.gauge.viewBufferSeconds, catchUp = CONSTANTS.gauge.catchUpSpeed, maxKeep = 400 } = {}) {
  let snaps = [];
  let renderT = null; // 재생 시각(시뮬레이션 시간 기준)
  let timeScale = 1;
  let fired = -Infinity; // 사건을 이미 처리한 마지막 스냅샷 시각

  const latestT = () => (snaps.length ? snaps[snaps.length - 1].t : 0);

  return {
    push(snap) {
      if (!snap || typeof snap.t !== 'number') return;
      const last = snaps[snaps.length - 1];
      if (last && snap.t <= last.t) return; // 순서가 뒤바뀐 중복 패킷 무시
      snaps.push(snap);
      if (snaps.length > maxKeep) snaps = snaps.slice(-maxKeep);
      if (renderT === null) renderT = Math.max(snaps[0].t, snap.t - delay); // 처음엔 0.6초 뒤에서 시작
    },

    // dt초 지났다고 하고 앞으로 보냄 → { snap, events, t } (스냅샷이 없으면 null)
    advance(dt) {
      if (renderT === null || !snaps.length) return null;
      const lag = latestT() - renderT;
      let speed = timeScale;
      if (lag > delay * 1.6) speed *= catchUp; // 너무 늦음 → 빨리 감기
      else if (lag < delay * 0.4) speed *= 0.85; // 너무 앞섬 → 살짝 늦춤
      renderT = Math.min(renderT + dt * speed, latestT());

      // renderT를 감싸는 두 스냅샷
      let i = snaps.length - 1;
      while (i > 0 && snaps[i - 1].t > renderT) i--;
      const b = snaps[i];
      const a = i > 0 ? snaps[i - 1] : b;
      const span = b.t - a.t;
      const alpha = span > 1e-6 ? Math.min(1, Math.max(0, (renderT - a.t) / span)) : 1;
      const snap = a === b ? { ...b, ev: [] } : interpolateSnapshots(a, b, alpha);

      // 재생 시각을 지난 스냅샷들의 사건을 한 번씩만
      const events = [];
      for (const s of snaps) {
        if (s.t > renderT) break;
        if (s.t > fired) { if (s.ev?.length) events.push(...s.ev); fired = s.t; }
      }
      // 지난 스냅샷은 버린다(보간에 필요한 직전 1장은 남김)
      const keepFrom = Math.max(0, i - 1);
      if (keepFrom > 60) snaps = snaps.slice(keepFrom);
      return { snap, events, t: renderT };
    },

    setDelay(x) { delay = Math.max(0.05, Math.min(2, x)); },
    setTimeScale(x) { timeScale = Math.max(0.05, Math.min(3, x)); },
    reset() { snaps = []; renderT = null; fired = -Infinity; timeScale = 1; },
    get lagSeconds() { return renderT === null ? 0 : latestT() - renderT; },
    get size() { return snaps.length; },
  };
}

// ── 네트워크 클라이언트 ──────────────────────────────────
export function createNetClient({
  url,
  getToken = async () => null,
  store = null,
  WebSocketImpl = globalThis.WebSocket,
  heartbeatMs = 20000,
  backoff = [1000, 2000, 4000, 8000, 10000], // Render 무료 서버가 깨어나는 데 시간이 걸릴 수 있다
  authTimeoutMs = 15000,
} = {}) {
  const handlers = new Map(); // type → Set<fn>
  let ws = null;
  let attempt = 0;
  let wantOpen = false;
  let authed = false;
  let beat = 0;
  let reconnectTimer = 0;
  let authTimer = 0;
  let viewCode = null; // 재연결 때 되돌아갈 관람 코드
  const outbox = []; // 인증 전에 요청된 메시지
  const pending = new Map(); // 명령 id → 응답 처리 함수
  let reqSeq = 0;
  const failPending = (error) => { for (const [id, fn] of [...pending]) { pending.delete(id); fn({ ok: false, error }); } };

  const setConn = (s) => store?.set('ui.connection', s);
  const emit = (type, msg) => handlers.get(type)?.forEach((fn) => { try { fn(msg); } catch (e) { console.error(e); } });

  function rawSend(obj) {
    if (ws && ws.readyState === 1) { ws.send(JSON.stringify(obj)); return true; }
    return false;
  }

  function flush() { while (outbox.length && authed) rawSend(outbox.shift()); }

  async function open() {
    if (!url || !wantOpen) return;
    setConn('connecting');
    try {
      ws = new WebSocketImpl(url);
    } catch {
      scheduleReconnect();
      return;
    }
    const mine = ws;
    mine.onopen = async () => {
      attempt = 0;
      const token = await getToken();
      if (!token) { // 로그인 없이 관람만: 인증 단계를 건너뛰고 읽기 전용으로 연다
        authed = true;
        setConn('online');
        if (viewCode) rawSend({ type: 'join_view', code: viewCode });
        beat = setInterval(() => rawSend({ type: 'ping', t: Date.now() }), heartbeatMs);
        emit('auth_ok', { type: 'auth_ok', who: null });
        flush();
        return;
      }
      rawSend({ type: 'auth', token });
      clearTimeout(authTimer);
      authTimer = setTimeout(() => { if (!authed) mine.close(); }, authTimeoutMs);
      clearInterval(beat);
      beat = setInterval(() => rawSend({ type: 'ping', t: Date.now() }), heartbeatMs);
    };
    mine.onmessage = (ev) => {
      let msg;
      try { msg = JSON.parse(typeof ev.data === 'string' ? ev.data : String(ev.data)); } catch { return; }
      if (!msg || typeof msg.type !== 'string') return;
      if (msg.type === 'res') {
        const fn = pending.get(msg.id);
        if (fn) { pending.delete(msg.id); fn(msg.ok ? { ok: true, data: msg.data } : { ok: false, error: msg.error || '실패', code: msg.code }); }
        return;
      }
      if (msg.type === 'auth_ok') {
        authed = true;
        clearTimeout(authTimer);
        setConn('online');
        if (viewCode) rawSend({ type: 'join_view', code: viewCode }); // 재연결 시 관람 복귀
        flush();
      }
      emit(msg.type, msg);
      emit('*', msg);
    };
    mine.onclose = () => {
      if (ws !== mine) return;
      authed = false;
      clearInterval(beat);
      clearTimeout(authTimer);
      setConn('offline');
      failPending('서버와 연결이 끊어졌습니다');
      emit('close', { type: 'close' });
      if (wantOpen) scheduleReconnect();
    };
    mine.onerror = () => { /* onclose에서 처리 */ };
  }

  function scheduleReconnect() {
    clearTimeout(reconnectTimer);
    const wait = backoff[Math.min(attempt, backoff.length - 1)];
    attempt++;
    setConn('offline');
    reconnectTimer = setTimeout(open, wait);
  }

  const api = {
    connect() { wantOpen = true; if (!ws || ws.readyState > 1) open(); },
    disconnect() {
      wantOpen = false;
      authed = false;
      viewCode = null;
      failPending('연결을 닫았습니다');
      clearTimeout(reconnectTimer);
      clearInterval(beat);
      clearTimeout(authTimer);
      try { ws?.close(); } catch { /* ignore */ }
      ws = null;
      setConn('offline');
    },
    // 보내기: 인증 전이면 대기열에 두었다가 인증 후 보낸다
    send(type, payload = {}) {
      const msg = { type, ...payload };
      if (authed && rawSend(msg)) return true;
      outbox.push(msg);
      if (outbox.length > 50) outbox.shift();
      return false;
    },
    joinView(code) { viewCode = String(code || '').trim().toUpperCase(); return api.send('join_view', { code: viewCode }); },
    leaveView() { viewCode = null; },
    cmd(payload) { return api.send('cmd', payload); },
    // 응답을 기다리는 명령. 권한·수치는 서버가 판단한다.
    request(op, args = {}, timeoutMs = 15000) {
      return new Promise((resolve) => {
        const id = ++reqSeq;
        const timer = setTimeout(() => { pending.delete(id); resolve({ ok: false, error: '서버 응답이 없습니다' }); }, timeoutMs);
        pending.set(id, (r) => { clearTimeout(timer); resolve(r); });
        api.send('cmd', { ...args, rid: id, op }); // 인자의 id(팀 id 등)와 겹치지 않도록 요청 번호는 rid
      });
    },
    practiceStart(roster, opts = {}) { return api.send('practice_start', { roster, ...opts }); },
    practiceStop() { return api.send('practice_stop'); },

    on(type, fn) {
      if (!handlers.has(type)) handlers.set(type, new Set());
      handlers.get(type).add(fn);
      return () => handlers.get(type)?.delete(fn);
    },
    get connected() { return authed; },
  };
  return api;
}

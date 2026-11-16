// server/index.js  (73번)
// 진입점: DB·인증·레시피·리그·연습전·리플레이를 엮고 HTTP(상태 확인) + WebSocket(/ws)을 연다. (명세 16)
//   환경 변수: PORT, SUPABASE_URL, SUPABASE_SERVICE_KEY, ALLOWED_ORIGINS(쉼표 구분, 없으면 모두 허용)
//   개발용:   DEV_AUTH=1 DEV_MEMORY_DB=1 node index.js   (배포 환경에서는 금지)
//   import { startServer } → 시험에서 port:0 으로 띄울 수 있다.

import http from 'node:http';
import { fileURLToPath } from 'node:url';
import { createDb } from './db.js';
import { createAuthGuard } from './auth-guard.js';
import { createRecipeLoader } from './sim/recipe-loader.js';
import { createReplayStore } from './replay-store.js';
import { createLeagueManager } from './league-manager.js';
import { createPracticeManager } from './practice-session.js';
import { createHub } from './ws-hub.js';
import { createAdminOps } from './admin-ops.js';
import { createBalanceCache } from './balance-cache.js';

export async function startServer({ port = Number(process.env.PORT) || 8080, env = process.env, log = console } = {}) {
  const db = await createDb({ env, log });
  const guard = createAuthGuard({ db, env });
  const loader = createRecipeLoader({ db, log });
  await loader.load();
  const replayStore = createReplayStore({ db, log });
  const balanceCache = createBalanceCache({ db, log });

  let hub = null;
  const publish = (room, msg) => hub?.publish(room, msg);
  const leagues = createLeagueManager({ db, recipes: () => loader.recipes, publish, replayStore, balanceCache, log });
  const practice = createPracticeManager({ db, recipes: () => loader.recipes, send: (uid, msg) => hub?.sendUser(uid, msg), balanceCache, log });

  const allowed = (env.ALLOWED_ORIGINS || '').split(',').map((s) => s.trim()).filter(Boolean);
  const server = http.createServer((req, res) => {
    const origin = req.headers.origin;
    if (origin && (!allowed.length || allowed.includes(origin))) res.setHeader('Access-Control-Allow-Origin', origin);
    if (req.url === '/health') { res.writeHead(200, { 'content-type': 'application/json' }); res.end(JSON.stringify({ ok: true, matches: leagues.activeCount, practice: practice.activeCount, clients: hub?.clients ?? 0 })); return; }
    res.writeHead(404); res.end();
  });
  // WebSocket 접속 출처 확인(허용 목록이 있을 때)
  server.on('upgrade', (req, socket) => {
    const origin = req.headers.origin;
    if (allowed.length && origin && !allowed.includes(origin)) { socket.write('HTTP/1.1 403 Forbidden\r\n\r\n'); socket.destroy(); }
  });

  hub = createHub({ server, guard, leagues, practice, replayStore, db, log, admin: { ops: createAdminOps({ db, loader, balanceCache, log }) } });
  const aborted = await leagues.abortStale();
  if (aborted) log.info?.(`서버가 다시 켜져 진행 중이던 경기 ${aborted}개를 '중단' 처리했습니다`);

  await new Promise((res) => server.listen(port, res));
  const actual = server.address().port;
  log.info?.(`코딩메카 서버: 포트 ${actual}, 레시피 ${loader.recipes.length}개`);

  const stop = async () => {
    leagues.abortAll('server_stop'); practice.stopAll();
    await new Promise((r) => setTimeout(r, 50));
    await hub.close();
    await new Promise((r) => server.close(r));
  };
  return { port: actual, db, leagues, practice, hub, stop };
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const app = await startServer();
  for (const sig of ['SIGTERM', 'SIGINT']) process.on(sig, async () => { await app.stop(); process.exit(0); });
}

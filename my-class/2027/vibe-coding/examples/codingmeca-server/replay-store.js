// server/replay-store.js  (83번)
// 경기 스트림(20Hz 스냅샷 + 연출 알림)을 압축해 저장하고 다시 꺼낸다. 리플레이는 재시뮬레이션이 아니라 저장된 스트림을 그대로 재생한다. (명세 3-3)
//   const store = createReplayStore({ db });
//   const id = await store.save({ matchId, replay: runner.replay(), meta })   // → replay id
//   const rp = await store.load(id)   // → { init, frames, result, seed, meta } | null
//   store.toMessages(rp)              // 관람 화면이 net-client 와 같은 방식으로 받을 수 있는 메시지 배열(시각 순)

import { gzipSync, gunzipSync } from 'node:zlib';
import { randomUUID } from 'node:crypto';

const MAX_BYTES = 12 * 1024 * 1024; // 압축 후 한 경기 상한(넘으면 저장하지 않고 경고)

export function createReplayStore({ db, log = console, cacheSize = 8 } = {}) {
  const cache = new Map(); // id → replay (최근 것만)
  const remember = (id, rp) => { cache.set(id, rp); while (cache.size > cacheSize) cache.delete(cache.keys().next().value); };

  return {
    async save({ matchId, replay, meta = {} }) {
      if (!replay?.frames?.length) return null;
      const id = randomUUID();
      const json = JSON.stringify({ init: replay.init, frames: replay.frames, result: replay.result, seed: replay.seed });
      const zipped = gzipSync(Buffer.from(json, 'utf8'), { level: 6 });
      if (zipped.length > MAX_BYTES) { log.warn?.(`리플레이가 너무 커서 저장하지 않았습니다 (${zipped.length} bytes)`); return null; }
      const info = { frames: replay.frames.length, duration: replay.result?.duration ?? null, bytes: zipped.length, ...meta };
      await db.saveReplay({ id, match_id: matchId, meta: info, data: zipped.toString('base64') });
      remember(id, { ...replay, meta: info });
      return id;
    },

    async load(id) {
      if (cache.has(id)) return cache.get(id);
      const row = await db.getReplay(id);
      if (!row?.data) return null;
      const body = JSON.parse(gunzipSync(Buffer.from(row.data, 'base64')).toString('utf8'));
      const rp = { ...body, meta: row.meta || {} };
      remember(id, rp);
      return rp;
    },

    // 스트림을 메시지로: 시각 순서 그대로 (state / cinematic_*)
    toMessages(rp, matchId) {
      return rp.frames.map((f) => (f.k === 's' ? { type: 'state', match: matchId, s: f.s } : { match: matchId, ...f.c }));
    },
  };
}

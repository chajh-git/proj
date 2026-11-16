// web/editor/sim-lab/batch-runner.js  (123번)
// 원형 설계도 8종을 서로 붙여 승률을 모으는 일괄 실행기. 웹 워커 여러 개에 작업을 나눠 주고, 워커를 못 쓰면(시험·오래된 브라우저) 메인에서 조금씩 나눠 돈다. (명세 18-5)
//   const r = createBatchRunner({ workers: 4, makeWorker })     // makeWorker 없으면 브라우저 모듈 워커
//   const out = await r.run({ ids, games, mapId, balance, onProgress(done,total), signal })   → { cells, rows, total, ms, cancelled }
// 저장 전 수치(balance = store.toData())로 시험하므로 서버에 영향이 없다. 융합 레시피는 쓰지 않는다.

import { planJobs, aggregate, makeLabContext, runJob } from './run-job.js';

export function createBatchRunner({ workers = Math.min(4, (typeof navigator !== 'undefined' && navigator.hardwareConcurrency) || 2), makeWorker = null } = {}) {
  const mk = makeWorker || (typeof Worker !== 'undefined' ? () => new Worker(new URL('./worker.js', import.meta.url), { type: 'module' }) : null);

  async function run({ ids, games = 20, mapId = 'm1', balance = {}, onProgress = () => {}, signal = null }) {
    const jobs = planJobs(ids, games, mapId);
    const total = jobs.length;
    const t0 = Date.now();
    const results = [];
    let cancelled = false;
    const cancel = () => { cancelled = true; };
    signal?.addEventListener?.('abort', cancel);

    if (mk) {
      let pool;
      try { pool = Array.from({ length: Math.max(1, workers) }, mk); } catch { pool = null; }
      if (pool) {
        await new Promise((resolve) => {
          let next = 0; let done = 0; let alive = pool.length;
          const finish = () => { for (const w of pool) w.terminate(); resolve(); };
          const feed = (w) => {
            if (cancelled || next >= total) { if (--alive === 0 || cancelled) finish(); return; }
            const n = next++; w.postMessage({ type: 'job', n, job: jobs[n] });
          };
          for (const w of pool) {
            w.onmessage = (e) => { if (e.data.type === 'done') results[e.data.n] = e.data.result; done++; onProgress(done, total); if (done === total) finish(); else feed(w); };
            w.onerror = () => { done++; onProgress(done, total); if (done === total) finish(); else feed(w); };
            w.postMessage({ type: 'init', balance });
            feed(w);
          }
        });
        return { ...aggregate(ids, results.filter(Boolean)), total, ms: Date.now() - t0, cancelled };
      }
    }
    // 워커를 못 쓸 때: 메인에서 한 판씩, 틈틈이 화면에 양보
    const ctx = makeLabContext(balance);
    for (let i = 0; i < total && !cancelled; i++) {
      results.push(runJob(jobs[i], ctx));
      onProgress(i + 1, total);
      if (i % 2 === 1) await new Promise((r) => setTimeout(r, 0));
    }
    return { ...aggregate(ids, results), total, ms: Date.now() - t0, cancelled };
  }
  return { run };
}

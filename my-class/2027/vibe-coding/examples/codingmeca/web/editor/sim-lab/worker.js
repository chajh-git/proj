// web/editor/sim-lab/worker.js — 매치업 작업을 받아 헤드리스로 돌리는 웹 워커(모듈 워커).
//   받는 메시지: {type:'init', balance} 한 번, 이후 {type:'job', n, job}   돌려주는 메시지: {type:'done', n, result} | {type:'fail', n, error}
import { makeLabContext, runJob } from './run-job.js';
let ctx = null;
self.onmessage = (e) => {
  const m = e.data;
  if (m.type === 'init') { ctx = makeLabContext(m.balance); return; }
  if (m.type === 'job') {
    try { self.postMessage({ type: 'done', n: m.n, result: runJob(m.job, ctx) }); } catch (err) { self.postMessage({ type: 'fail', n: m.n, error: String(err?.message || err) }); }
  }
};

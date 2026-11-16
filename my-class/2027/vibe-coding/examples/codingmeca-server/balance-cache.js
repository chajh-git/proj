// server/balance-cache.js
// 밸런스 버전(조율 센터 저장본)을 읽어 합친 constants 를 기억해 둔다. 경기·연습전은 여기서 constants 를 받는다. (명세 18-4)
//   const bc = createBalanceCache({ db });
//   await bc.latest()            → { version, constants }   가장 최근 버전(연습전·새 리그용)
//   await bc.forVersion(7)       → { version, constants }   리그가 고정한 버전(없으면 기본값)
//   bc.clear()                   저장 직후 호출
// 저장본에 오류가 있어도(오래된 변수 등) 쓸 수 있는 값만 적용하고 경고를 남긴다.

import { mergeBalance } from '#shared/balance/merge.js';
import { CONSTANTS } from '#config/constants.js';

export function createBalanceCache({ db, log = console } = {}) {
  const byVersion = new Map();
  let latestKey = null;

  async function build(row) {
    if (!row) return { version: 0, constants: CONSTANTS };
    const m = mergeBalance(row.data);
    if (m.issues.length) log.warn?.(`밸런스 v${row.version} 경고:`, m.issues.map((i) => i.message));
    return { version: row.version, constants: m.constants };
  }

  return {
    async latest() {
      const row = await db.getBalance();
      const v = row?.version ?? 0;
      if (!byVersion.has(v)) byVersion.set(v, await build(row));
      latestKey = v;
      return byVersion.get(v);
    },
    async forVersion(version) {
      const v = Number(version) || 0;
      if (!v) return { version: 0, constants: CONSTANTS };
      if (!byVersion.has(v)) byVersion.set(v, await build(await db.getBalance(v)));
      return byVersion.get(v);
    },
    clear() { byVersion.clear(); latestKey = null; },
    get latestVersion() { return latestKey; },
  };
}

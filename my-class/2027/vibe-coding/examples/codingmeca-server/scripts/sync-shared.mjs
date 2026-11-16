// server/scripts/sync-shared.mjs  (84번)
// 배포 때 공개 저장소(codingmeca)의 shared/·config/·data/ 를 서버 폴더로 복사한다. (로컬에서는 심볼릭 링크로 대신해도 된다)
//   사용: SHARED_SRC=<공개 저장소 경로> node scripts/sync-shared.mjs
//   SHARED_SRC 가 없으면 PUBLIC_REPO_URL(예: https://github.com/<계정>/codingmeca.git)을 얕게 복제해서 쓴다.
// 비밀 레시피(private/, recipes_secret)는 이 스크립트가 만지지 않는다. data/recipes.sample.json 만 복사 대상에 들어 있다.

import { cpSync, existsSync, rmSync, lstatSync, mkdtempSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { tmpdir } from 'node:os';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const DIRS = ['shared', 'config', 'data'];
const SKIP = new Set(['recipes.json', 'recipes.secret.json']); // 혹시 공개 쪽에 실수로 있어도 가져오지 않는다

let src = process.env.SHARED_SRC ? resolve(process.env.SHARED_SRC) : null;
let tmp = null;
if (!src) {
  const url = process.env.PUBLIC_REPO_URL;
  if (!url) { console.error('SHARED_SRC(공개 저장소 경로) 또는 PUBLIC_REPO_URL 이 필요합니다'); process.exit(1); }
  tmp = mkdtempSync(join(tmpdir(), 'codingmeca-'));
  execFileSync('git', ['clone', '--depth', '1', url, tmp], { stdio: 'inherit' });
  src = tmp;
}

for (const d of DIRS) {
  const from = join(src, d);
  if (!existsSync(from)) { console.error(`없는 폴더: ${from}`); process.exit(1); }
  const to = join(root, d);
  if (existsSync(to)) { // 로컬 개발용 심볼릭 링크는 그대로 두고 건너뜀
    if (lstatSync(to).isSymbolicLink()) { console.log(`${d}: 심볼릭 링크라서 건너뜀`); continue; }
    rmSync(to, { recursive: true, force: true });
  }
  cpSync(from, to, { recursive: true, filter: (p) => !SKIP.has(p.split('/').pop()) });
  console.log(`${d}: 복사 완료`);
}
if (tmp) rmSync(tmp, { recursive: true, force: true });

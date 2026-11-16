// web/editor/io.js  (105번)
// 조율 센터 JSON 내보내기·가져오기. (명세 18-4)
//   exportBalance(store)            → 객체(공개 수치만; 바뀐 값만 담김)
//   exportRecipes(recipes)          → 객체(지휘관 전용 별도 파일. 공개 저장소로 올리지 말 것)
//   downloadJson(filename, obj)     브라우저 다운로드
//   readJsonFile(file)              File → 파싱된 객체 (Promise)
//   parseBalanceFile(obj)           → { ok, data, notes } 가져오기 전 검사
// 레시피는 공개 수치 파일에 절대 섞지 않는다. 가져온 공개 수치 파일에 레시피가 들어 있으면 버리고 알려 준다.

import { normalizeBalance, flattenBalance } from '../../shared/balance/merge.js';

export const BALANCE_FORMAT = 'codingmeca-balance';
export const RECIPES_FORMAT = 'codingmeca-recipes-secret';

export function exportBalance(store) {
  return { format: BALANCE_FORMAT, formatVersion: 1, version: store.version, exportedAt: new Date().toISOString(), ...store.toData() };
}

export function exportRecipes(recipes) {
  return { format: RECIPES_FORMAT, formatVersion: 1, exportedAt: new Date().toISOString(), _warning: '숨은 융합 레시피입니다. 공개 저장소(GitHub Pages)에 올리지 마세요.', recipes };
}

export function downloadJson(filename, obj) {
  const blob = new Blob([JSON.stringify(obj, null, 2)], { type: 'application/json' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = filename;
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
}

export function readJsonFile(file) {
  return new Promise((resolve, reject) => {
    if (!file) { reject(new Error('파일이 없습니다')); return; }
    if (file.size > 2 * 1024 * 1024) { reject(new Error('파일이 너무 큽니다(2MB 이하)')); return; }
    const r = new FileReader();
    r.onload = () => { try { resolve(JSON.parse(String(r.result))); } catch { reject(new Error('JSON 형식이 아닙니다')); } };
    r.onerror = () => reject(new Error('파일을 읽지 못했습니다'));
    r.readAsText(file);
  });
}

export function parseBalanceFile(obj) {
  const notes = [];
  if (!obj || typeof obj !== 'object') return { ok: false, notes: ['내용이 올바르지 않습니다'] };
  if (obj.format === RECIPES_FORMAT || Array.isArray(obj.recipes) && !obj.constants && !obj.parts) return { ok: false, notes: ['이 파일은 레시피 파일입니다. 레시피는 ‘비밀 레시피’ 화면에서 가져와 주세요'] };
  if (obj.format && obj.format !== BALANCE_FORMAT) return { ok: false, notes: ['조율 센터 파일이 아닙니다'] };
  if ('recipes' in obj) notes.push('파일에 들어 있던 레시피는 무시했습니다(레시피는 공개 수치와 섞지 않습니다)');
  const { data, issues } = normalizeBalance(obj);
  for (const i of issues) notes.push(i.message);
  return { ok: true, data, issues, notes, count: Object.keys(flattenBalance(data)).length };
}

// web/editor/panels/recipes-panel.js  (121번) — 융합·변신 비밀 레시피. 지휘 본부의 레시피 화면(recipe-ui)을 그대로 끼워 쓴다. (명세 12·18장)
// 레시피는 밸런스 버전에 들어가지 않고(공개 저장소·내보내기 파일에 없음) 서버의 비밀 저장소에만 저장된다.
import { createRecipeUI } from '../../ui/commander/recipe-ui.js';
import { el } from '../../ui/dom.js';

export function createRecipesPanel({ net, toast }) {
  const root = el('div', { style: { height: 'calc(100vh - 170px)', minHeight: '420px' } });
  const ui = createRecipeUI({ root, net, toast });
  return { id: 'recipes', label: '융합 레시피', el: root, searchable: false, owns: () => false, search() {}, onShow() { ui.refresh(); } };
}

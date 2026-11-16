// web/ui/commander/recipe-ui.js  (93번)
// 지휘 본부 · 비밀 레시피: 융합·변신 레시피를 지휘관만 보고 고친다. (명세 12장)
//   const ui = createRecipeUI({ root, net, toast });   ui.refresh()
// 레시피 원본은 서버의 비밀 저장소에만 있고, 이 화면은 지휘관 로그인 때만 서버에서 받아 온다.
// 저장하면 서버가 형식을 검사한 뒤 다시 읽어 '다음 경기부터' 반영한다(진행 중인 경기는 그대로).
// 수업 중 빔프로젝터에 띄우지 않도록 화면 위에 주의 문구를 둔다.

import { el, clear, ensureStyle } from '../dom.js';
import { COMMON_CSS, call } from './kit.js';

const TEMPLATE = {
  id: 'R-NEW', name: '새 융합', kind: 'fusion', members: 2,
  memberConditions: [{ tags: { machine: 1 }, form: 'any', requiredParts: [], hpRange: [0, 1] }],
  common: { spiritMin: 60, gaugeMin: 0, distanceMax: 6, mapIds: [], signalWindowSeconds: 2 },
  result: { hpMult: 1.4, attackMult: 1.3, speedMult: 1.0, reduceMult: 1.2, cooldownMult: 1.0, grants: [], appearancePreset: '', cinematicId: 'fusion_common', durationSeconds: 20, endEnergyZero: false },
  codexPublic: false,
};

export function createRecipeUI({ root, net, toast } = {}) {
  ensureStyle(COMMON_CSS, 'cm-cmd-style');
  const wrap = el('div', { class: 'cm-panel cm-cmd' });
  const listBox = el('div', { class: 'list' });
  const edit = el('div', { style: { minHeight: 0, overflow: 'auto' } });
  wrap.append(el('h3', {}, '비밀 레시피'), el('div', { class: 'bd' },
    el('div', { class: 'cm-msg warning' }, '이 화면에는 숨겨진 조건이 그대로 나옵니다. 학생에게 보이는 화면(빔프로젝터)에서는 열지 마세요.'),
    el('div', { class: 'split', style: { height: 'calc(100% - 52px)' } }, listBox, edit)));
  root.append(wrap);

  let data = { secret: [], defaults: [], errors: [] };
  let current = null; // id | '__new'
  let revealed = false;

  async function refresh() {
    const d = await call(net, toast, 'recipes.list');
    if (!d) return;
    data = d;
    drawList();
    drawEdit();
  }

  function drawList() {
    clear(listBox);
    listBox.append(el('button', { type: 'button', class: 'cm-btn item primary', onClick: () => { current = '__new'; drawList(); drawEdit(); } }, '＋ 새 레시피'));
    for (const r of data.secret) listBox.append(el('button', { type: 'button', class: `cm-btn item${current === r.id ? ' on' : ''}`, onClick: () => { current = r.id; drawList(); drawEdit(); } }, el('span', {}, `${r.id} · ${r.name || ''}`), el('small', {}, r.kind === 'awaken' ? '각성' : '융합')));
    if (data.defaults.length) {
      listBox.append(el('div', { class: 'sec' }, '기본 레시피(서버 파일)'));
      for (const r of data.defaults) listBox.append(el('div', { style: { fontSize: '12px', color: 'var(--cm-textDim)', padding: '2px 8px' } }, `${r.id} · ${r.name}`));
    }
    listBox.append(el('div', { class: 'actions' }, el('button', { type: 'button', class: 'cm-btn', onClick: async () => { const d = await call(net, toast, 'recipes.reload', {}, '다시 읽었습니다'); if (d) refresh(); } }, '서버에서 다시 읽기')));
  }

  function drawEdit() {
    clear(edit);
    if (data.errors?.length) edit.append(...data.errors.map((e) => el('div', { class: 'cm-msg error' }, e)));
    if (!current) { edit.append(el('p', { style: { color: 'var(--cm-textDim)', fontSize: '13px' } }, '왼쪽에서 레시피를 고르거나 새로 만드세요.')); return; }
    if (!revealed) {
      edit.append(el('p', { style: { fontSize: '13px' } }, '내용을 보려면 확인을 누르세요.'), el('button', { type: 'button', class: 'cm-btn primary', onClick: () => { revealed = true; drawEdit(); } }, '내용 보기'));
      return;
    }
    const isNew = current === '__new';
    const src = isNew ? TEMPLATE : data.secret.find((r) => r.id === current);
    if (!src) return;
    const ta = el('textarea', { class: 'cm-input', rows: 24, spellcheck: 'false' });
    ta.value = JSON.stringify(src, null, 2);
    const msg = el('div', {});
    edit.append(
      el('div', { class: 'sec' }, isNew ? '새 레시피 (JSON)' : `${src.id} 수정 (JSON)`), ta, msg,
      el('div', { class: 'actions' },
        el('button', { type: 'button', class: 'cm-btn primary', onClick: async () => {
          clear(msg);
          let recipe;
          try { recipe = JSON.parse(ta.value); } catch (e) { msg.append(el('div', { class: 'cm-msg error' }, `JSON 형식이 올바르지 않습니다: ${e.message}`)); return; }
          if (!isNew && recipe.id !== src.id) { msg.append(el('div', { class: 'cm-msg error' }, 'ID를 바꾸려면 새 레시피로 저장하세요(ID는 도감 기록과 연결됩니다).')); return; }
          const r = await net.request('recipes.save', { recipe });
          if (!r.ok) { msg.append(el('div', { class: 'cm-msg error' }, r.error)); return; }
          toast('저장했습니다. 다음 경기부터 적용됩니다.');
          current = recipe.id;
          await refresh();
        } }, '저장'),
        isNew ? null : el('button', { type: 'button', class: 'cm-btn danger', onClick: async () => { if (!confirm(`${src.id} 레시피를 지울까요?`)) return; if (await call(net, toast, 'recipes.delete', { id: src.id }, '지웠습니다')) { current = null; refresh(); } } }, '삭제'),
        el('button', { type: 'button', class: 'cm-btn', onClick: () => { revealed = false; drawEdit(); } }, '숨기기')));
  }

  drawList();
  drawEdit();
  return { refresh, el: wrap, setVisible(on) { wrap.style.display = on ? '' : 'none'; if (!on) { revealed = false; } }, destroy() { wrap.remove(); } };
}

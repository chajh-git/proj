// web/ui/pilot-ui.js  (62번)
// 조종사 설정: 이름·성향·각성기 2칸. 각성기 비용은 기체 예산에 들어간다. (명세 9-5, 9-7)
//   const pilot = createPilotUI({ root, onChange });
//   pilot.setPilot({ name, temperament, skills }); pilot.getPilot();
//   onChange(pilot) 는 값이 바뀔 때마다 호출 → 조립 화면이 설계에 반영·재검증

import { TEMPERAMENTS, TEMPERAMENT_IDS, PILOT_SKILLS, PILOT_SKILL_IDS, emptyPilot, pilotSkillsCost } from '../../data/pilot-skills.js';
import { CONSTANTS } from '../../config/constants.js';
import { FORBIDDEN_WORDS } from '../../config/names.js';
import { el, clear, ensureStyle } from './dom.js';

const CSS = `
.cm-pilot .body{padding:8px 12px 14px}
.cm-pilot .opt{display:block;width:100%;text-align:left;padding:8px 10px;margin:6px 0;border-radius:8px;border:1px solid var(--cm-panelEdge);background:rgba(255,255,255,.03);color:var(--cm-text);font:inherit;cursor:pointer}
.cm-pilot .opt:hover{border-color:var(--cm-primary)}
.cm-pilot .opt.on{border-color:var(--cm-primary);background:rgba(255,255,255,.1);box-shadow:0 0 0 1px var(--cm-primary) inset}
.cm-pilot .opt .t{display:flex;gap:8px;align-items:center;font-weight:700}
.cm-pilot .opt .t em{margin-left:auto;font-style:normal;font-weight:400;font-size:11px;color:var(--cm-textDim)}
.cm-pilot .opt .d{font-size:11px;color:var(--cm-textDim);margin-top:3px;line-height:1.45}
.cm-pilot .opt.lock{opacity:.4;cursor:not-allowed}
.cm-pilot .slots{display:flex;gap:8px;margin:6px 0}
.cm-pilot .slot{flex:1;min-height:42px;border:1px dashed var(--cm-panelEdge);border-radius:8px;padding:6px 8px;font-size:12px;display:flex;align-items:center;justify-content:center;text-align:center;color:var(--cm-textDim)}
.cm-pilot .slot.full{border-style:solid;border-color:var(--cm-primary);color:var(--cm-text);cursor:pointer}
`;

export function createPilotUI({ root, onChange = () => {}, slots = CONSTANTS.limits.pilotSkillSlots } = {}) {
  ensureStyle(CSS, 'cm-pilot-style');
  const wrap = el('div', { class: 'cm-panel cm-pilot' });
  const body = el('div', { class: 'body' });
  wrap.append(el('h3', {}, '조종사'), body);
  root.append(wrap);

  let pilot = emptyPilot();
  let nameErr = '';

  const emit = () => onChange({ ...pilot, skills: [...pilot.skills] });

  function toggleSkill(id) {
    const has = pilot.skills.includes(id);
    if (has) pilot.skills = pilot.skills.filter((s) => s !== id);
    else if (pilot.skills.length < slots) pilot.skills = [...pilot.skills, id];
    else return;
    render();
    emit();
  }

  function render() {
    clear(body);
    // 이름
    const input = el('input', { class: 'cm-input', value: pilot.name, maxlength: 12, 'aria-label': '조종사 이름' });
    input.addEventListener('input', () => {
      const v = input.value;
      nameErr = FORBIDDEN_WORDS.some((w) => v.includes(w)) ? '사용할 수 없는 단어가 들어 있습니다' : '';
      pilot.name = v;
      body.querySelector('.nerr').textContent = nameErr;
      emit();
    });
    body.append(el('div', { class: 'cm-field' }, el('label', {}, '이름'), input, el('div', { class: 'nerr', style: { color: 'var(--cm-danger)', fontSize: '11px', minHeight: '14px' } }, nameErr)));

    // 성향
    body.append(el('div', { class: 'cm-field' }, el('label', {}, '성향 (투지의 오르내림이 달라집니다)')));
    for (const id of TEMPERAMENT_IDS) {
      const t = TEMPERAMENTS[id];
      body.append(el('button', { type: 'button', class: `opt${pilot.temperament === id ? ' on' : ''}`, onClick: () => { pilot.temperament = id; render(); emit(); } },
        el('div', { class: 't' }, t.label), el('div', { class: 'd' }, t.desc)));
    }

    // 각성기 칸
    const total = pilotSkillsCost(pilot.skills);
    body.append(el('div', { class: 'cm-field' }, el('label', {}, `각성기 ${pilot.skills.length}/${slots} · 비용 ${total}`)));
    const slotRow = el('div', { class: 'slots' });
    for (let i = 0; i < slots; i++) {
      const id = pilot.skills[i];
      slotRow.append(id
        ? el('div', { class: 'slot full', title: '눌러서 해제', onClick: () => toggleSkill(id) }, PILOT_SKILLS[id].name)
        : el('div', { class: 'slot' }, '빈 칸'));
    }
    body.append(slotRow);

    for (const id of PILOT_SKILL_IDS) {
      const s = PILOT_SKILLS[id];
      const on = pilot.skills.includes(id);
      const lock = !on && pilot.skills.length >= slots;
      body.append(el('button', { type: 'button', class: `opt${on ? ' on' : ''}${lock ? ' lock' : ''}`, disabled: lock || null, onClick: () => toggleSkill(id) },
        el('div', { class: 't' }, s.name, el('em', {}, `비용 ${s.cost} · 투지 −${s.spiritCost} · ${s.kind === 'passive' ? '패시브' : `${s.uses}회`}`)),
        el('div', { class: 'd' }, s.desc)));
    }
  }

  render();
  return {
    el: wrap,
    setPilot(p) { pilot = { ...emptyPilot(), ...(p || {}), skills: [...(p?.skills || [])] }; nameErr = ''; render(); },
    getPilot: () => ({ ...pilot, skills: [...pilot.skills] }),
    destroy() { wrap.remove(); },
  };
}

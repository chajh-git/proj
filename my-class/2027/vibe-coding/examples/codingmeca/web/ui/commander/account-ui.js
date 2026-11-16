// web/ui/commander/account-ui.js  (95번)
// 지휘 본부 · 계정·팀 관리: 팀 만들기, 메카닉의 팀 배정, 계정 한꺼번에 만들기, 비밀번호 재설정. (명세 4-1)
//   const ui = createAccountUI({ root, net, toast });   ui.refresh()
// 비밀번호는 서버만 다룬다. 만든 직후 한 번만 화면에 보이고(수업 시간 안내용 표), 서버는 되돌려 보내지 않는다.
// 지휘관 승격은 이 화면에서도 할 수 있지만, 자기 자신의 권한은 내릴 수 없다.

import { el, clear, ensureStyle } from '../dom.js';
import { COMMON_CSS, field, textInput, call } from './kit.js';

export function createAccountUI({ root, net, toast, selfId = null } = {}) {
  ensureStyle(COMMON_CSS, 'cm-cmd-style');
  const wrap = el('div', { class: 'cm-panel cm-cmd' });
  const body = el('div', { class: 'bd cm-scroll' });
  wrap.append(el('h3', {}, '계정 · 팀'), body);
  root.append(wrap);
  let profiles = [];
  let teams = [];
  let filter = '';
  let created = null; // 방금 만든 계정 표(안내용)

  async function refresh() {
    const d = await call(net, toast, 'account.list');
    if (!d) return;
    profiles = d.profiles; teams = d.teams;
    draw();
  }

  const teamSelect = (value, onChange) => {
    const s = el('select', { class: 'cm-input' }, el('option', { value: '' }, '(팀 없음)'), teams.map((t) => el('option', { value: t.id }, t.name)));
    s.value = value || '';
    s.addEventListener('change', () => onChange(s.value || null));
    return s;
  };

  function teamBlock() {
    const id = textInput('', { max: 12, placeholder: '팀 ID(영문)', width: '110px' });
    const name = textInput('', { max: 30, placeholder: '팀 이름', width: '140px' });
    const color = el('input', { type: 'color', value: '#3b82f6', style: { width: '40px', height: '32px', border: 0, background: 'none' } });
    return [
      el('div', { class: 'sec' }, '팀'),
      el('table', {}, el('tbody', {}, teams.map((t) => el('tr', {},
        el('td', {}, el('span', { style: { display: 'inline-block', width: '10px', height: '10px', borderRadius: '50%', background: t.color, marginRight: '6px' } }), t.name), el('td', {}, el('small', {}, t.id)),
        el('td', {}, el('button', { type: 'button', class: 'cm-btn danger', onClick: async () => { if (confirm(`${t.name} 팀을 지울까요? 소속은 ‘팀 없음’이 됩니다.`) && await call(net, toast, 'team.delete', { id: t.id }, '지웠습니다')) refresh(); } }, '삭제')))))),
      el('div', { class: 'cm-row', style: { marginTop: '6px' } }, id, name, color, el('button', { type: 'button', class: 'cm-btn', onClick: async () => { if (await call(net, toast, 'team.save', { id: id.value, name: name.value, color: color.value }, '팀을 저장했습니다')) refresh(); } }, '팀 추가'))];
  }

  function accountTable() {
    const q = filter.trim().toLowerCase();
    const rows = profiles.filter((p) => !q || p.loginId.includes(q) || (p.nickname || '').toLowerCase().includes(q));
    const search = el('input', { class: 'cm-input', placeholder: '아이디·닉네임 검색', value: filter, style: { width: '200px' } });
    search.addEventListener('input', () => { filter = search.value; drawRows(); });
    const tbody = el('tbody', {});
    function drawRows() {
      clear(tbody);
      const q2 = filter.trim().toLowerCase();
      for (const p of profiles.filter((x) => !q2 || x.loginId.includes(q2) || (x.nickname || '').toLowerCase().includes(q2))) {
        tbody.append(el('tr', {},
          el('td', {}, p.loginId), el('td', {}, p.nickname),
          el('td', {}, teamSelect(p.teamId, async (v) => { if (await call(net, toast, 'account.update', { id: p.id, teamId: v }, '팀을 바꿨습니다')) p.teamId = v; })),
          el('td', {}, el('button', { type: 'button', class: 'cm-btn', disabled: p.id === selfId, onClick: async () => { const role = p.role === 'commander' ? 'mechanic' : 'commander'; if (confirm(`${p.loginId} 을(를) ${role === 'commander' ? '지휘관으로 올릴까요' : '메카닉으로 내릴까요'}?`) && await call(net, toast, 'account.update', { id: p.id, role }, '역할을 바꿨습니다')) refresh(); } }, p.role === 'commander' ? '지휘관 ✓' : '메카닉')),
          el('td', {}, el('button', { type: 'button', class: 'cm-btn', onClick: async () => { const pw = prompt(`${p.loginId} 의 새 비밀번호(6자 이상)`); if (pw) await call(net, toast, 'account.reset_password', { id: p.id, password: pw }, '비밀번호를 바꿨습니다'); } }, '비밀번호 재설정'))));
      }
      if (!tbody.children.length) tbody.append(el('tr', {}, el('td', { colspan: 5, style: { color: 'var(--cm-textDim)' } }, '계정이 없습니다')));
    }
    drawRows();
    void rows;
    return [el('div', { class: 'sec' }, `계정 (${profiles.length}명)`), search, el('table', {}, el('thead', {}, el('tr', {}, ['아이디', '닉네임', '팀', '역할', ''].map((h) => el('th', {}, h)))), tbody)];
  }

  // 한꺼번에 만들기: 한 줄에 "아이디,비밀번호,닉네임,팀ID(선택)"
  function bulkBlock() {
    const ta = el('textarea', { class: 'cm-input', rows: 5, placeholder: 'mec01,pass1234,늑대,t1\nmec02,pass1234,독수리,t2', spellcheck: 'false' });
    return [
      el('div', { class: 'sec' }, '계정 한꺼번에 만들기'),
      el('div', { style: { fontSize: '12px', color: 'var(--cm-textDim)', marginBottom: '4px' } }, '한 줄에 한 명: 아이디(영문 소문자·숫자·밑줄 3~20자), 비밀번호(6자 이상), 닉네임, 팀 ID(생략 가능). 닉네임에는 실명을 쓰지 않도록 안내하세요.'),
      ta,
      el('div', { class: 'actions' }, el('button', { type: 'button', class: 'cm-btn primary', onClick: async () => {
        const accounts = ta.value.split('\n').map((l) => l.trim()).filter(Boolean).map((l) => { const [loginId, password, nickname, teamId] = l.split(',').map((x) => x?.trim()); return { loginId, password, nickname, teamId: teamId || null }; });
        const d = await call(net, toast, 'account.create', { accounts });
        if (!d) return;
        const ok = d.results.filter((r) => r.ok).length;
        toast(`${ok}명 만들었습니다${ok < d.results.length ? ` (실패 ${d.results.length - ok})` : ''}`, ok === d.results.length ? 'info' : 'error');
        created = { rows: accounts.filter((a) => d.results.find((r) => r.loginId === String(a.loginId).toLowerCase() && r.ok)), fails: d.results.filter((r) => !r.ok) };
        await refresh();
      } }, '만들기')),
      created ? el('div', { class: 'cm-msg ok' }, `방금 만든 계정 ${created.rows.length}명`, ...created.rows.map((a) => el('div', { style: { fontFamily: 'monospace', fontSize: '12px' } }, `${a.loginId} / ${a.password}`)), ...created.fails.map((f) => el('div', { class: 'cm-msg error' }, `${f.loginId}: ${f.error}`))) : null];
  }

  function draw() {
    clear(body);
    body.append(...teamBlock(), ...accountTable(), ...bulkBlock());
  }

  draw();
  return { refresh, el: wrap, setVisible(on) { wrap.style.display = on ? '' : 'none'; if (!on) { created = null; } }, destroy() { wrap.remove(); } };
}

// web/ui/auth-ui.js  (58번)
// 로비(index.html)의 로그인·가입 화면. 아이디 + 비밀번호만 받고 이메일은 묻지 않는다. (명세 4-1)
//   const auth = createAuthUI({ root, client, store, router, audio });
//   · 저장된 로그인이 있으면 '이어서 시작' 한 번으로 입장
//   · 서버 접속 정보가 비어 있으면(오프라인) '오프라인으로 시작' 만 보여 준다(격납고·신경 연산실·시험 사격장 사용 가능)
//   · 관람 코드 6자리로 관제 스크린 읽기 전용 입장
//   · 로그인 성공 → store.session 채움 → 역할에 따라 이동(메카닉: 격납고, 지휘관: 지휘 본부 / 격납고 선택)
// client = createSupabaseClient() 의 결과(51번).

import { NAMES, ROLE_LABEL } from '../../config/names.js';
import { CONSTANTS } from '../../config/constants.js';
import { validateLoginId, validatePassword, validateNickname } from '../core/supabase-client.js';
import { el, ensureStyle, clear } from './dom.js';

const A = CONSTANTS.account;
const CSS = `
.cm-auth{position:fixed;inset:0;display:flex;align-items:center;justify-content:center;pointer-events:none;padding:16px}
.cm-auth .card{pointer-events:auto;width:min(380px,100%);padding:22px 22px 18px}
.cm-auth h2{margin:0 0 4px;font-size:22px;color:var(--cm-primary);letter-spacing:.06em}
.cm-auth .sub{color:var(--cm-textDim);font-size:12px;margin-bottom:12px}
.cm-auth .tabs{display:flex;margin-bottom:6px;border-bottom:1px solid var(--cm-panelEdge)}
.cm-auth .tabs button{flex:1;padding:9px 0;background:none;border:0;border-bottom:2px solid transparent;color:var(--cm-textDim);font:inherit;cursor:pointer}
.cm-auth .tabs button.on{color:var(--cm-primary);border-color:var(--cm-primary);font-weight:700}
.cm-auth .err{min-height:18px;color:var(--cm-danger);font-size:12px;margin:6px 0}
.cm-auth .full{width:100%;margin-top:6px}
.cm-auth .note{font-size:11px;color:var(--cm-textDim);margin-top:2px}
.cm-auth hr{border:0;border-top:1px solid var(--cm-panelEdge);margin:14px 0 10px}
.cm-auth .code{letter-spacing:.35em;text-transform:uppercase;text-align:center}
`;

// 역할별 첫 화면
export const homeFor = (role) => (role === 'commander' ? 'command' : 'hangar');

export function createAuthUI({ root, client, store, router, audio = null, autoRestore = true } = {}) {
  ensureStyle(CSS, 'cm-auth-style');
  const wrap = el('div', { class: 'cm-auth' });
  const card = el('div', { class: 'cm-panel card' });
  wrap.append(card);
  root.append(wrap);

  let mode = 'login'; // 'login' | 'signup'
  let busy = false;
  let restored = null; // 저장된 로그인 세션

  const setErr = (t) => { const n = card.querySelector('.err'); if (n) n.textContent = t || ''; };

  function enter(session) {
    store.patch({ 'session.user': session.user, 'session.role': session.role, 'session.token': session.token || null });
    audio?.play('ui_save');
    if (session.role === 'commander') { renderCommanderChoice(); return; }
    router.go(homeFor(session.role));
  }

  // 지휘관은 두 곳 중 선택
  function renderCommanderChoice() {
    clear(card);
    card.append(
      el('h2', {}, NAMES.title),
      el('div', { class: 'sub' }, `${store.get('session.user')?.nickname || ''} · ${ROLE_LABEL.commander}`),
      el('button', { class: 'cm-btn primary full', type: 'button', onClick: () => router.go('command') }, NAMES.command),
      el('button', { class: 'cm-btn full', type: 'button', onClick: () => router.go('hangar') }, NAMES.hangar),
      el('button', { class: 'cm-btn full', type: 'button', onClick: () => router.go('editor') }, NAMES.editor),
      el('button', { class: 'cm-btn full', type: 'button', onClick: logout }, '로그아웃'));
  }

  async function logout() {
    await client.signOut();
    store.patch({ 'session.user': null, 'session.role': null, 'session.token': null });
    restored = null;
    render();
  }

  async function submit(form) {
    if (busy) return;
    const f = new FormData(form);
    const loginId = String(f.get('id') || '').trim().toLowerCase();
    const password = String(f.get('pw') || '');
    const nickname = String(f.get('nick') || '').trim();
    const bad = validateLoginId(loginId) || validatePassword(password) || (mode === 'signup' ? validateNickname(nickname) : null);
    if (bad) { setErr(bad); audio?.play('ui_error'); return; }
    busy = true;
    setErr('');
    const btn = form.querySelector('button[type=submit]');
    btn.disabled = true;
    btn.textContent = '확인하는 중…';
    const r = mode === 'signup' ? await client.signUp({ loginId, password, nickname }) : await client.signIn({ loginId, password });
    busy = false;
    if (!r.ok) { btn.disabled = false; btn.textContent = mode === 'signup' ? '가입하고 시작' : '로그인'; setErr(r.error); audio?.play('ui_error'); return; }
    enter(r.session);
  }

  function viewForm() {
    const signup = mode === 'signup';
    const form = el('form', { autocomplete: 'on', onSubmit: (e) => { e.preventDefault(); submit(form); } },
      el('div', { class: 'cm-field' }, el('label', { for: 'cm-id' }, '아이디'),
        el('input', { class: 'cm-input', id: 'cm-id', name: 'id', autocomplete: 'username', maxlength: 16, autocapitalize: 'none', placeholder: '영문 소문자·숫자·밑줄 3~16자' })),
      el('div', { class: 'cm-field' }, el('label', { for: 'cm-pw' }, '비밀번호'),
        el('input', { class: 'cm-input', id: 'cm-pw', name: 'pw', type: 'password', autocomplete: signup ? 'new-password' : 'current-password', placeholder: `${A.passwordMinLength}자 이상` })),
      signup ? el('div', { class: 'cm-field' }, el('label', { for: 'cm-nick' }, `이름(별명) — ${A.nicknameMaxLength}자 이하`),
        el('input', { class: 'cm-input', id: 'cm-nick', name: 'nick', maxlength: A.nicknameMaxLength, placeholder: '예: 번개정비사' }),
        el('div', { class: 'note' }, '실명 대신 별명을 써 주세요. 이메일은 받지 않습니다.')) : null,
      el('div', { class: 'err' }),
      el('button', { class: 'cm-btn primary full', type: 'submit' }, signup ? '가입하고 시작' : '로그인'));
    return form;
  }

  function viewCode() {
    const input = el('input', { class: 'cm-input code', maxlength: 6, placeholder: '관람 코드', 'aria-label': '관람 코드' });
    const go = () => {
      const code = input.value.trim().toUpperCase();
      if (code.length !== 6) { setErr('관람 코드는 6자리입니다'); return; }
      router.go('arena', { params: { code } });
    };
    input.addEventListener('keydown', (e) => { if (e.key === 'Enter') go(); });
    return el('div', {}, el('div', { class: 'note' }, `${NAMES.arena} 보기 (읽기 전용)`), el('div', { class: 'cm-row', style: { marginTop: '6px' } }, input, el('button', { class: 'cm-btn', type: 'button', onClick: go }, '입장')));
  }

  function render() {
    clear(card);
    card.append(el('h2', {}, NAMES.title), el('div', { class: 'sub' }, NAMES.lobby));

    if (restored) { // 저장된 로그인으로 이어서
      card.append(
        el('div', { class: 'cm-msg ok' }, `${restored.user.nickname} 님으로 로그인되어 있습니다`),
        el('button', { class: 'cm-btn primary full', type: 'button', onClick: () => enter(restored) }, '이어서 시작'),
        el('button', { class: 'cm-btn full', type: 'button', onClick: logout }, '다른 아이디로 로그인'));
    } else if (!client.online) { // 오프라인(접속 정보 미설정)
      card.append(
        el('div', { class: 'cm-msg warning' }, '서버 접속 정보가 없어 오프라인으로 동작합니다. 기체 저장은 이 기기에만 남고, 서버 대전은 할 수 없습니다.'),
        el('button', { class: 'cm-btn primary full', type: 'button', onClick: () => enter({ user: { id: 'local', loginId: 'local', nickname: '오프라인', role: 'mechanic' }, role: 'mechanic' }) }, '오프라인으로 시작'));
    } else {
      card.append(el('div', { class: 'tabs' },
        el('button', { type: 'button', class: mode === 'login' ? 'on' : '', onClick: () => { mode = 'login'; render(); } }, '로그인'),
        el('button', { type: 'button', class: mode === 'signup' ? 'on' : '', onClick: () => { mode = 'signup'; render(); } }, '새로 가입')));
      card.append(viewForm());
    }
    card.append(el('hr'), viewCode());
  }

  render();

  if (autoRestore) {
    client.restore().then((s) => { if (s) { restored = s; render(); } }).catch(() => {});
  }

  return {
    el: wrap,
    logout,
    showError: setErr,
    destroy() { wrap.remove(); },
  };
}

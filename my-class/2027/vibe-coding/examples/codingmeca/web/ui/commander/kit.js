// web/ui/commander/kit.js
// 지휘 본부 화면들이 같이 쓰는 작은 도구: 칸 만들기, 서버 명령 호출 + 알림. 서버 권한 검사가 최종이다.
import { el } from '../dom.js';

export const field = (label, input, hint = null) => el('div', { class: 'cm-field' }, el('label', {}, label), input, hint ? el('small', { style: { color: 'var(--cm-textDim)', fontSize: '11px' } }, hint) : null);
export const numInput = (value, { min = 0, max = 9999, step = 1, width = '90px' } = {}) => el('input', { class: 'cm-input', type: 'number', value, min, max, step, style: { width } });
export const textInput = (value = '', { max = 40, placeholder = '', width = null } = {}) => el('input', { class: 'cm-input', type: 'text', value, maxlength: max, placeholder, style: width ? { width } : {} });
export function selectInput(options, value) {
  const s = el('select', { class: 'cm-input' }, options.map(([v, label]) => el('option', { value: v }, label)));
  if (value !== undefined && value !== null) s.value = value;
  return s;
}
export const check = (label, on) => { const i = el('input', { type: 'checkbox' }); i.checked = Boolean(on); return { input: i, node: el('label', { style: { display: 'inline-flex', gap: '6px', alignItems: 'center', fontSize: '13px', margin: '2px 10px 2px 0' } }, i, label) }; };

// 서버 명령 → 알림. 성공하면 결과 데이터, 실패하면 null
export async function call(net, toast, op, args = {}, okText = null) {
  const r = await net.request(op, args);
  if (!r.ok) { toast(r.error || '실패했습니다', 'error'); return null; }
  if (okText) toast(okText);
  return r.data ?? {};
}

export const COMMON_CSS = `
.cm-cmd{display:flex;flex-direction:column;min-height:0;height:100%}
.cm-cmd>h3{flex:none}
.cm-cmd .bd{padding:10px 12px;overflow:auto;min-height:0;flex:1}
.cm-cmd .split{display:grid;grid-template-columns:240px 1fr;gap:12px;height:100%;min-height:0}
.cm-cmd .list{overflow:auto;min-height:0}
.cm-cmd .item{display:flex;width:100%;justify-content:space-between;gap:8px;text-align:left;margin:4px 0;padding:8px 10px}
.cm-cmd .item.on{border-color:var(--cm-primary);background:rgba(120,220,255,.1)}
.cm-cmd .item small{color:var(--cm-textDim)}
.cm-cmd .grid2{display:grid;grid-template-columns:repeat(auto-fill,minmax(170px,1fr));gap:2px 14px}
.cm-cmd .sec{margin:14px 0 4px;font-size:12px;letter-spacing:.08em;color:var(--cm-textDim)}
.cm-cmd .actions{display:flex;gap:6px;flex-wrap:wrap;margin:10px 0}
.cm-cmd table{border-collapse:collapse;width:100%;font-size:13px}
.cm-cmd th{font-size:11px;color:var(--cm-textDim);text-align:left;padding:4px 6px}
.cm-cmd td{padding:4px 6px;border-top:1px solid rgba(255,255,255,.06);vertical-align:middle}
.cm-cmd textarea.cm-input{width:100%;box-sizing:border-box;font-family:ui-monospace,Menlo,Consolas,monospace;font-size:12px;resize:vertical}
@media (max-width:800px){.cm-cmd .split{grid-template-columns:1fr;grid-auto-rows:auto}}
`;

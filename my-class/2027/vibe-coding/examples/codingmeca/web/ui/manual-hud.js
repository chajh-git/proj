// web/ui/manual-hud.js
// 수동 조종 화면 조각: 조준점, 조작 안내(H로 접기), 시점 단추(오버더숄더·추적·전체), 상태 표시.
//   const hud = createManualHud({ root, onView(name), onExit() });
//   hud.show(true); hud.setView('shoulder'); hud.setStatus({ text, kind }); hud.setHold({fire, shield, ...})
import { el, ensureStyle } from './dom.js';
import { HELP_ROWS } from '../core/manual-input.js';

const CSS = `
.mp-cross{position:fixed;left:50%;top:46%;width:34px;height:34px;margin:-17px 0 0 -17px;z-index:18;pointer-events:none;display:none}
.mp-cross.on{display:block}
.mp-cross:before,.mp-cross:after{content:"";position:absolute;background:var(--cm-primary);opacity:.9}
.mp-cross:before{left:16px;top:0;width:2px;height:34px;-webkit-mask:linear-gradient(#000 0 11px,transparent 11px 23px,#000 23px);mask:linear-gradient(#000 0 11px,transparent 11px 23px,#000 23px)}
.mp-cross:after{top:16px;left:0;height:2px;width:34px;-webkit-mask:linear-gradient(90deg,#000 0 11px,transparent 11px 23px,#000 23px);mask:linear-gradient(90deg,#000 0 11px,transparent 11px 23px,#000 23px)}
.mp-help{position:fixed;left:10px;bottom:64px;z-index:19;padding:8px 10px;font-size:12px;line-height:1.5;display:none;max-width:230px}
.mp-help.on{display:block}
.mp-help h4{margin:0 0 4px;font-size:12px;color:var(--cm-primary)}
.mp-help .r{display:flex;justify-content:space-between;gap:10px}
.mp-help .r span:last-child{color:var(--cm-textDim)}
.mp-help small{display:block;margin-top:4px;color:var(--cm-textDim)}
.mp-bar{position:fixed;left:50%;top:72px;transform:translateX(-50%);z-index:19;display:none;flex-direction:row;flex-wrap:wrap;justify-content:center;gap:6px 8px;padding:6px 10px;align-items:center;max-width:calc(100vw - 20px)}
.mp-bar.on{display:flex}
.mp-bar .t{font-size:11px;color:var(--cm-textDim)}
.mp-bar button{font-size:12px;padding:5px 10px;border-radius:8px}
.mp-bar button.on{background:var(--cm-primary);color:var(--cm-bg);border-color:var(--cm-primary);font-weight:700}
.mp-chips{display:flex;gap:4px;flex-wrap:wrap}
.mp-chips i{font-style:normal;font-size:11px;padding:2px 7px;border-radius:999px;border:1px solid var(--cm-panelEdge);color:var(--cm-textDim)}
.mp-chips i.on{background:var(--cm-primary);color:var(--cm-bg);border-color:var(--cm-primary);font-weight:700}
.mp-note{font-size:12px;color:var(--cm-textDim)}
.mp-note.warn{color:var(--cm-danger)}
`;

const VIEWS = [['shoulder', '오버더숄더'], ['follow', '추적'], ['overview', '전체']];
const HOLDS = [['fire', '공격'], ['overdrive', '각성'], ['shield', '방어막'], ['intercept', '요격'], ['repair', '수리']];

export function createManualHud({ root, onView = () => {}, onExit = () => {} } = {}) {
  ensureStyle(CSS, 'mp-style');
  const cross = el('div', { class: 'mp-cross' });
  const help = el('div', { class: 'cm-panel mp-help' }, el('h4', {}, '직접 조종 · H 접기/펼치기'),
    ...HELP_ROWS.map(([a, b]) => el('div', { class: 'r' }, el('span', {}, a), el('span', {}, b))),
    el('small', {}, '화면을 클릭하면 마우스가 잡힙니다. Esc 로 풀기.'));
  const viewBtns = new Map(VIEWS.map(([k, label]) => [k, el('button', { type: 'button', class: 'cm-btn', onClick: () => onView(k) }, label)]));
  const chips = new Map(HOLDS.map(([k, label]) => [k, el('i', {}, label)]));
  const note = el('div', { class: 'mp-note' });
  const bar = el('div', { class: 'cm-panel mp-bar' }, ...viewBtns.values(),
    el('div', { class: 'mp-chips' }, ...chips.values()), note,
    el('button', { type: 'button', class: 'cm-btn', onClick: () => onExit() }, '직접 조종 끝내기'));
  root.append(cross, help, bar);

  let visible = false;
  let helpOpen = true;
  let view = 'shoulder';
  const paint = () => {
    cross.classList.toggle('on', visible && view === 'shoulder');
    help.classList.toggle('on', visible && helpOpen);
    bar.classList.toggle('on', visible);
    for (const [k, b] of viewBtns) b.classList.toggle('on', k === view);
  };
  const onKey = (ev) => { if (visible && ev.code === 'KeyH' && !ev.repeat && !/INPUT|TEXTAREA|SELECT/.test(ev.target?.tagName || '')) { helpOpen = !helpOpen; paint(); } };
  addEventListener('keydown', onKey);

  return {
    show(v) { visible = Boolean(v); paint(); },
    setView(v) { view = v; paint(); },
    setHold(h = {}) { for (const [k, c] of chips) c.classList.toggle('on', Boolean(h[k])); },
    setNote(text = '', warn = false) { note.textContent = text; note.classList.toggle('warn', warn); },
    dispose() { removeEventListener('keydown', onKey); cross.remove(); help.remove(); bar.remove(); },
  };
}

/* ═══════════════════════════════════════════════════════════════
   탭 4 · 디자인 — 테마·카드·호버·글꼴·모션 선택, 타이틀·안내 문구 편집, 연도별 비교, 실시간 미리보기
   저장 위치: {연도}/vibe-coding/theme.json
═══════════════════════════════════════════════════════════════ */
"use strict";
(function () {
  /* 테마 목록 — pv: 카드 안에 보이는 작은 미리보기 모형 */
const TEMPLATES = [
  { id: "default",   name: "기본",              desc: "지금 쓰는 디자인", sw: ["#0d0f14", "#4f8ef7", "#7c5cfc", "#f5c842"],
    pv: { bg: "#0d0f14", t: "linear-gradient(90deg,#fff,#4f8ef7)", card: "background:#1c2030;border:1px solid #252a3a" } },
  { id: "neon",      name: "네온 아케이드",     desc: "짙은 남색 + 네온, 픽셀 숫자", sw: ["#0a0620", "#ff3df2", "#38f3ff", "#ffd93d"],
    pv: { bg: "radial-gradient(ellipse at 50% 0,rgba(255,61,242,.4),transparent 70%),#0a0620", t: "linear-gradient(90deg,#ff3df2,#38f3ff)", card: "background:#140d36;border:2px solid #38f3ff;border-radius:0;box-shadow:3px 3px 0 rgba(56,243,255,.3)" } },
  { id: "bento",     name: "다크 벤토",         desc: "비대칭 타일, 제품 UI 느낌", sw: ["#0b0c10", "#12141a", "#7fe8ff", "#8ab4ff"],
    pv: { bg: "#0b0c10", t: "linear-gradient(90deg,#7fe8ff,#8ab4ff)", card: "background:#12141a;border:1px solid #2a2f3d;border-radius:8px" } },
  { id: "brutal",    name: "네오브루탈리즘",    desc: "노란 바탕, 굵은 테두리·그림자", sw: ["#ffe45e", "#111111", "#ff5d8f", "#8be9ff"],
    pv: { bg: "#ffe45e", t: "#111", card: "background:#fff;border:2px solid #111;border-radius:0;box-shadow:3px 3px 0 #111" } },
  { id: "clay",      name: "소프트 클레이",     desc: "말랑한 입체 카드, 밝고 친근", sw: ["#dff5ec", "#ffffff", "#ff7a59", "#6fd8ff"],
    pv: { bg: "#dff5ec", t: "#ff7a59", card: "background:#fff;border-radius:12px;box-shadow:0 5px 0 rgba(0,0,0,.09)" } },
  { id: "editorial", name: "에디토리얼 타이포", desc: "흰 바탕, 거대한 제목과 순위 숫자", sw: ["#fafafa", "#0e0e0e", "#d93a12", "#c9c9c4"],
    pv: { bg: "#fafafa", t: "#0e0e0e", card: "background:#fafafa;border:1px solid #0e0e0e;border-radius:0" } },
  { id: "holo",      name: "홀로그램 연구소",   desc: "반투명 유리 패널 + 은은한 글로우", sw: ["#070b16", "#6ee7ff", "#a78bfa", "#ffd36e"], isNew: true,
    pv: { bg: "radial-gradient(circle at 15% 0,rgba(110,231,255,.4),transparent 55%),radial-gradient(circle at 92% 0,rgba(167,139,250,.4),transparent 55%),#070b16", t: "linear-gradient(90deg,#fff,#6ee7ff,#a78bfa)", card: "background:linear-gradient(160deg,rgba(255,255,255,.2),rgba(255,255,255,.03));border:1px solid rgba(110,231,255,.55);border-radius:8px;box-shadow:0 0 10px rgba(110,231,255,.35)" } },
  { id: "gallery",   name: "어두운 갤러리",     desc: "검은 전시장 + 위에서 떨어지는 스포트라이트", sw: ["#0a0a0c", "#e9c883", "#f4eee0", "#a9a499"], isNew: true,
    pv: { bg: "radial-gradient(ellipse 70% 62% at 50% -12%,rgba(255,244,214,.5),transparent 70%),#0a0a0c", t: "linear-gradient(#fffaf0,#e9c883)", card: "background:linear-gradient(180deg,#25231b,#0e0e10);border:1px solid rgba(233,200,131,.7);border-radius:1px;box-shadow:0 -4px 12px rgba(233,200,131,.3)" } },
  { id: "blueprint", name: "사이버 블루프린트", desc: "청색 격자·좌표선, 설계도 느낌", sw: ["#06121f", "#5ec8ff", "#ffd166", "#a8c4dc"], isNew: true,
    pv: { bg: "linear-gradient(rgba(94,200,255,.28) 1px,transparent 1px) 0 0/13px 13px,linear-gradient(90deg,rgba(94,200,255,.28) 1px,transparent 1px) 0 0/13px 13px,#06121f", t: "#eaf6ff", card: "background:#0a1b2e;border:1px dashed #5ec8ff;border-radius:0" } },
  { id: "aurora",    name: "오로라 바이브",     desc: "천천히 흐르는 오로라 배경", sw: ["#060814", "#5df2c2", "#9d7bff", "#42a5ff"], isNew: true,
    pv: { bg: "radial-gradient(circle at 25% 28%,rgba(93,242,194,.65),transparent 55%),radial-gradient(circle at 82% 22%,rgba(157,123,255,.65),transparent 55%),radial-gradient(circle at 55% 95%,rgba(66,165,255,.5),transparent 60%),#060814", t: "linear-gradient(90deg,#fff,#5df2c2,#9d7bff)", card: "background:rgba(255,255,255,.12);border:1px solid rgba(255,255,255,.28);border-radius:10px" } },
];

const CARD_OPTS = [
  { id: "default", name: "기본 카드", desc: "테마에 맞춘 기본 카드 모양", dcls: "", demo: "<i></i>" },
  { id: "frame",   name: "전시 액자", desc: "이중 액자 테두리와 전시 번호(NO. 001)", dcls: "dm-frame", demo: "<i></i>" },
];
const HOVER_OPTS = [
  { id: "default",   name: "테마 기본",       desc: "테마에 들어 있는 호버 그대로 (살짝 떠오름)", dcls: "hv-def",  demo: "<i></i>" },
  { id: "glow",      name: "테두리 발광",     desc: "카드 테두리가 빛나며 번집니다", dcls: "hv-glow", demo: "<i></i>" },
  { id: "spotlight", name: "스포트라이트",    desc: "마우스를 따라 조명이 움직입니다", dcls: "hv-spot", demo: "<i></i>" },
  { id: "tilt",      name: "3D 기울기",       desc: "마우스 위치에 따라 카드가 기웁니다", dcls: "hv-tilt", demo: "<i></i>" },
  { id: "none",      name: "효과 없음",       desc: "호버해도 움직이지 않습니다", dcls: "", demo: "<i></i>" },
];
const FONT_OPTS = [
  { id: "auto",  name: "테마 기본 글꼴",       desc: "테마가 정한 글꼴 그대로", title: "'Black Han Sans','Noto Sans KR',sans-serif", w: 400 },
  { id: "lab",   name: "랩 · 기하학 산세리프", desc: "Space Grotesk + Pretendard 굵게", title: "'Space Grotesk','Pretendard Variable',sans-serif", w: 800 },
  { id: "orbit", name: "오빗 · 미래형",        desc: "Orbitron + Pretendard 굵게", title: "'Orbitron','Pretendard Variable',sans-serif", w: 800 },
  { id: "mono",  name: "모노 · 코드 노트",     desc: "JetBrains Mono + Pretendard", title: "'JetBrains Mono','Pretendard Variable',monospace", w: 800 },
];
const TITLE_OPTS = [
  { id: "off",    name: "효과 없음", desc: "타이틀이 바로 나타납니다", demo: `<div class="big">AI 바이브 랩</div>` },
  { id: "typing", name: "타이핑",    desc: "글자가 한 자씩 써집니다", demo: `<span class="tyw">AI 바이브 랩</span>` },
  { id: "glitch", name: "글리치",    desc: "깜빡이며 화면이 갈라지듯 등장", demo: `<div class="gl" data-t="AI 바이브 랩">AI 바이브 랩</div>` },
];
const MOTION_OPTS = [
  { id: "stars",  name: "별빛 파티클",        desc: "배경에 아주 느린 별빛이 떠다닙니다", dcls: "stars", demo: `<span style="left:18%;top:62%"></span><span style="left:34%;top:26%;animation-delay:.5s"></span><span style="left:52%;top:70%;animation-delay:1s"></span><span style="left:68%;top:34%;animation-delay:1.5s"></span><span style="left:82%;top:58%;animation-delay:.8s"></span>` },
  { id: "fadeup", name: "카드 페이드업 + 글로우", desc: "스크롤하면 카드가 떠오르며 빛납니다", dcls: "", demo: `<i class="fu"></i>` },
  { id: "btn",    name: "버튼 빛 번짐",       desc: "버튼에 마우스를 올리면 빛이 번집니다", dcls: "", demo: `<span class="bt">1반</span>` },
];

  /* ═══ 상태 ═══ */
  const { $, esc, say, clone } = A;
  const emptyTexts = () => ({ title: "", lead: "", body: "", steps: [{ t: "", d: "" }, { t: "", d: "" }, { t: "", d: "" }] });
  const defaults = () => ({ theme: "default", card: "default", hover: "default", font: "auto", motion: { title: "off", stars: false, fadeup: false, btn: false }, texts: emptyTexts() });
  const picked = new Set();          // 적용 대상 연도
  let cfg = defaults();              // 지금 고르고 있는 설정
  const current = {};                // 연도 → 저장되어 있는 설정
  let frameReady = false, started = false;

  function cleanTexts(t) {
    const r = t && typeof t === "object" ? t : {};
    const s = (v, n) => (typeof v === "string" ? v.trim().slice(0, n) : "");
    const e = emptyTexts();
    const steps = Array.isArray(r.steps) ? r.steps : [];
    return { title: s(r.title, 60), lead: s(r.lead, 80), body: s(r.body, 200), steps: e.steps.map((_, i) => ({ t: s(steps[i] && steps[i].t, 40), d: s(steps[i] && steps[i].d, 160) })) };
  }
  function norm(raw) {
    const d = defaults(), r = raw && typeof raw === "object" ? raw : {}, m = r.motion && typeof r.motion === "object" ? r.motion : {};
    const has = (list, v, dflt) => (list.some(o => o.id === v) ? v : dflt);
    return {
      theme: has(TEMPLATES, r.theme, d.theme), card: has(CARD_OPTS, r.card, d.card), hover: has(HOVER_OPTS, r.hover, d.hover), font: has(FONT_OPTS, r.font, d.font),
      motion: { title: has(TITLE_OPTS, m.title, "off"), stars: m.stars === true, fadeup: m.fadeup === true, btn: m.btn === true },
      texts: cleanTexts(r.texts),
    };
  }
  const nameOf = id => (TEMPLATES.find(t => t.id === id) || TEMPLATES[0]).name;
  const hasTexts = t => !!(t.title || t.lead || t.body || t.steps.some(s => s.t || s.d));
  function describe(c) {
    const lab = (list, id) => (list.find(o => o.id === id) || list[0]).name;
    const parts = [nameOf(c.theme)];
    if (c.card !== "default") parts.push("카드 " + lab(CARD_OPTS, c.card));
    if (c.hover !== "default") parts.push("호버 " + lab(HOVER_OPTS, c.hover));
    if (c.font !== "auto") parts.push("글꼴 " + lab(FONT_OPTS, c.font));
    const mo = [];
    if (c.motion.title !== "off") mo.push("타이틀 " + lab(TITLE_OPTS, c.motion.title));
    MOTION_OPTS.forEach(o => { if (c.motion[o.id]) mo.push(o.name); });
    if (mo.length) parts.push("모션 " + mo.join(", "));
    if (c.texts && hasTexts(c.texts)) parts.push("문구 수정");
    return parts.join(" · ");
  }
  A.describeTheme = raw => describe(norm(raw));

  /* ═══ 선택 UI ═══ */
  function tile(o, pressed, demoHTML, onClick, extraCls) {
    const b = document.createElement("button");
    b.type = "button"; b.className = "tcard opt " + (extraCls || "");
    b.setAttribute("aria-pressed", String(pressed));
    b.innerHTML = demoHTML + `<b>${o.name}${o.isNew ? '<span class="badge new">NEW</span>' : ""}${o.badge || ""}</b><span class="d">${o.desc}</span>`;
    b.dataset.k = (extraCls || "") + "|" + o.id;
    b.addEventListener("click", onClick);
    return b;
  }
  function renderThemes() {
    const box = $("d-cards"); box.innerHTML = "";
    TEMPLATES.forEach(t => {
      const applied = A.years.filter(y => current[y] && current[y].theme === t.id);
      const p = t.pv;
      const demo = `<div class="pv" style="background:${p.bg}"><div class="pv-t" style="background:${p.t}"></div><div class="pv-s" style="background:${p.t}"></div>
        <div class="pv-g">${[0, 1, 2].map(() => `<i style="${p.card}"></i>`).join("")}</div></div><div class="dots">${t.sw.map(c => `<i style="background:${c}"></i>`).join("")}</div>`;
      const o = { ...t, badge: applied.length ? `<span class="badge">${applied.join("·")} 적용 중</span>` : "" };
      box.appendChild(tile(o, cfg.theme === t.id, demo, () => { cfg.theme = t.id; renderAll(); pushPreview(); }, "theme"));
    });
  }
  function renderSimple(boxId, list, key, demoFn) {
    const box = $(boxId); box.innerHTML = "";
    list.forEach(o => box.appendChild(tile(o, cfg[key] === o.id, demoFn(o), () => { cfg[key] = o.id; renderAll(); pushPreview(); }, key)));
  }
  function renderMotion() {
    const tbox = $("d-title"); tbox.innerHTML = "";
    TITLE_OPTS.forEach(o => tbox.appendChild(tile(o, cfg.motion.title === o.id, `<div class="demo">${o.demo}</div>`, () => { cfg.motion.title = o.id; renderAll(); pushPreview(); }, "title")));
    const mbox = $("d-motion"); mbox.innerHTML = "";
    MOTION_OPTS.forEach(o => mbox.appendChild(tile(o, !!cfg.motion[o.id], `<div class="demo ${o.dcls || ""}">${o.demo}</div>`, () => { cfg.motion[o.id] = !cfg.motion[o.id]; renderAll(); pushPreview(); }, "motion")));
  }
  function renderYears() {
    const box = $("d-years"); box.innerHTML = "";
    A.years.forEach(y => {
      const lab = document.createElement("label"); lab.className = picked.has(y) ? "on" : "";
      lab.style.cssText = "display:inline-flex;gap:6px;align-items:center;margin-right:14px";
      const cb = document.createElement("input"); cb.type = "checkbox"; cb.checked = picked.has(y);
      cb.addEventListener("change", () => { cb.checked ? picked.add(y) : picked.delete(y); updateApply(); });
      lab.append(cb, document.createTextNode(y + "학년도")); box.appendChild(lab);
    });
  }
  function renderCompare() {
    const box = $("d-compare");
    box.innerHTML = A.years.map(y => {
      const c = current[y] || defaults(), th = TEMPLATES.find(t => t.id === c.theme) || TEMPLATES[0];
      return `<div class="ycard"><h3>${y}학년도</h3>
        <div class="dots" style="padding:2px 0 8px">${th.sw.map(s => `<i style="background:${s}"></i>`).join("")}</div>
        <p style="margin:0;color:var(--text)">${esc(describe(c))}</p>
        <div class="row"><button class="sm" data-load="${y}" type="button">이 설정 불러오기</button></div></div>`;
    }).join("");
  }
  function renderTexts() {
    const t = cfg.texts;
    const f = (id, label, val, max, ph, area) => `<div><label for="${id}">${label}</label>${area
      ? `<textarea id="${id}" rows="2" maxlength="${max}" placeholder="${esc(ph)}">${esc(val)}</textarea>`
      : `<input id="${id}" type="text" maxlength="${max}" value="${esc(val)}" placeholder="${esc(ph)}">`}</div>`;
    $("d-texts").innerHTML = `<div class="texts-grid">
      ${f("tx-title", "큰 타이틀 (최대 60자)", t.title, 60, dflt.title)}${f("tx-lead", "굵은 한 줄 메시지 (최대 80자)", t.lead, 80, dflt.lead)}
      <div style="grid-column:1/-1">${f("tx-body", "설명 문구 (최대 200자)", t.body, 200, dflt.body, true)}</div>
      ${[0, 1, 2].map(i => `${f("tx-st" + i, `활동 ${i + 1}단계 이름`, t.steps[i].t, 40, dflt.steps[i].t)}${f("tx-sd" + i, `활동 ${i + 1}단계 설명`, t.steps[i].d, 160, dflt.steps[i].d)}`).join("")}
    </div><div class="row" style="margin-top:10px"><button id="tx-clear" class="sm" type="button">문구 모두 비우기(기본 문구로)</button></div>`;
    const bind = (id, set) => $(id).addEventListener("input", A.debounce(e => { set(e.target.value); updateApply(); pushPreview(); }, 250));
    bind("tx-title", v => (cfg.texts.title = v)); bind("tx-lead", v => (cfg.texts.lead = v)); bind("tx-body", v => (cfg.texts.body = v));
    [0, 1, 2].forEach(i => { bind("tx-st" + i, v => (cfg.texts.steps[i].t = v)); bind("tx-sd" + i, v => (cfg.texts.steps[i].d = v)); });
    $("tx-clear").addEventListener("click", () => { cfg.texts = emptyTexts(); renderTexts(); pushPreview(); });
  }
  let dflt = { title: "", lead: "", body: "", steps: [{ t: "", d: "" }, { t: "", d: "" }, { t: "", d: "" }] };   // 페이지 기본 문구(placeholder)

  function renderAll() {
    const fk = document.activeElement && document.activeElement.dataset ? document.activeElement.dataset.k : null;
    renderThemes();
    renderSimple("d-card", CARD_OPTS, "card", o => `<div class="demo ${o.dcls}">${o.demo}</div>`);
    renderSimple("d-hover", HOVER_OPTS, "hover", o => `<div class="demo ${o.dcls}">${o.demo}</div>`);
    renderSimple("d-font", FONT_OPTS, "font", o => `<div class="demo font"><div style="font-family:${o.title};font-weight:${o.w}">AI 바이브 랩</div><div>NO. 001 · 1위 · 1,204</div></div>`);
    renderMotion(); renderYears(); renderCompare(); updateApply();
    if (fk) { const el = [...document.querySelectorAll("button.opt")].find(b => b.dataset.k === fk); if (el) el.focus(); }
  }

  /* ═══ 미리보기 ═══ */
  function motionParam(m) { const p = []; if (m.title !== "off") p.push("title:" + m.title); ["stars", "fadeup", "btn"].forEach(k => { if (m[k]) p.push(k); }); return p.join(","); }
  function loadPreview() {
    const y = $("d-prev-year").value; frameReady = false;
    const q = new URLSearchParams({ theme: cfg.theme, card: cfg.card, hover: cfg.hover, font: cfg.font, motion: motionParam(cfg.motion) });
    $("frame").src = `../${y}/${A.PAGE}/index.html?${q}&_=${Date.now()}`;
    say($("d-st-apply"), `미리보기: ${y}학년도 · ${describe(cfg)} (저장되지 않음)`);
  }
  function pushPreview() {
    const win = $("frame").contentWindow;
    if (frameReady && win) { win.postMessage({ type: "lab-cfg", cfg: clone(cfg) }, location.origin); say($("d-st-apply"), `미리보기: ${$("d-prev-year").value}학년도 · ${describe(cfg)} (저장되지 않음)`); }
    else loadPreview();
  }
  function readDefaults() {
    try {
      const d = $("frame").contentDocument, g = (el, k) => (el && el.dataset[k]) || "";
      const title = d.querySelector(".title-main"), lead = d.querySelector(".lab-lead");
      dflt.title = g(title, "orig");
      if (lead && lead.dataset.orig) { const tmp = d.createElement("div"); tmp.innerHTML = lead.dataset.orig; const st = tmp.querySelector("strong"); dflt.lead = st ? st.textContent.trim() : ""; dflt.body = tmp.textContent.replace(dflt.lead, "").trim(); }
      d.querySelectorAll(".lab-steps li").forEach((li, i) => { if (i < 3) { const b = li.querySelector("b"), s = li.querySelector(".d"); dflt.steps[i] = { t: g(b, "orig") || (b ? b.textContent : ""), d: g(s, "orig") || (s ? s.textContent : "") }; } });
      document.querySelectorAll("#d-texts [placeholder]").forEach(el => { const m = el.id.match(/^tx-(title|lead|body|st(\d)|sd(\d))$/); if (!m) return; el.placeholder = m[1] === "title" ? dflt.title : m[1] === "lead" ? dflt.lead : m[1] === "body" ? dflt.body : m[2] ? dflt.steps[+m[2]].t : dflt.steps[+m[3]].d; });
    } catch {}
  }
  function setDevice(phone) { $("frame").classList.toggle("phone", phone); $("d-pc").setAttribute("aria-pressed", String(!phone)); $("d-phone").setAttribute("aria-pressed", String(phone)); }

  /* ═══ 적용 ═══ */
  function updateApply() { $("d-apply").disabled = !(A.connected && picked.size); }
  async function putTheme(year, c) {
    const data = { ...c, texts: cleanTexts(c.texts), updated: new Date().toISOString() };
    await A.putFile(`${year}/${A.PAGE}/theme.json`, JSON.stringify(data, null, 2) + "\n", `${year}: 디자인 설정 변경 (${nameOf(c.theme)})`);
  }
  async function applyNow() {
    const targets = [...picked].sort();
    $("d-apply").disabled = true; say($("d-st-apply"), "저장하는 중…");
    const done = [], fail = [], snap = clone(cfg);
    for (const y of targets) { try { await putTheme(y, snap); done.push(y); current[y] = norm(snap); if (A.cache[y]) A.cache[y].theme = clone(snap); } catch (e) { fail.push(`${y}: ${e.message}`); } }
    renderAll();
    if (fail.length) say($("d-st-apply"), (done.length ? `${done.join(", ")} 저장됨. ` : "") + fail.join(" / "), "err");
    else say($("d-st-apply"), `${done.join(", ")}학년도에 적용을 저장했습니다. (${describe(snap)}) 학생 화면에는 1~2분 뒤 반영됩니다.`, "ok");
    updateApply();
  }

  async function loadCurrent() {
    await Promise.all(A.years.map(async y => { const Y = await A.loadYear(y); current[y] = norm(Y.theme); }));
  }

  A.registerTab({
    id: "design", icon: "🎨", title: "디자인",
    init(p) {
      p.innerHTML = `
      <div class="pane-head"><h2>디자인 · 문구</h2><span class="hint" style="margin:0">기능과 내용은 그대로이고 모양, 움직임, 안내 문구만 바뀝니다.</span></div>
      <div class="panel"><h2>연도별 현재 설정 비교</h2><div id="d-compare" class="ycards"></div><p class="hint">‘이 설정 불러오기’를 누르면 아래 편집기에 가져와 다른 연도에 그대로 쓸 수 있습니다.</p></div>
      <div class="panel"><h2>테마</h2><p class="hint" style="margin:-6px 0 12px">아래의 카드·호버·글꼴·모션 옵션은 어떤 테마에서든 함께 적용됩니다.</p><div id="d-cards" class="cards"></div></div>
      <div class="panel"><h2>카드 형태와 마우스 호버</h2><h3>카드 형태 (명예의 전당·예시 작품)</h3><div id="d-card" class="cards wide"></div>
        <h3>마우스 호버 효과</h3><div id="d-hover" class="cards wide"></div><p class="hint">카드 위에 마우스를 올리면 효과가 재생됩니다. 호버는 PC에서만 보이며, 폰에서는 터치로 대신합니다.</p></div>
      <div class="panel"><h2>타이포그래피</h2><div id="d-font" class="cards wide"></div></div>
      <div class="panel"><h2>모션 · 인터랙션</h2><h3>타이틀 등장 (하나 선택)</h3><div id="d-title" class="cards wide"></div>
        <h3>추가 효과 (여러 개 선택 가능)</h3><div id="d-motion" class="cards wide"></div>
        <p class="hint">학생 기기의 ‘동작 줄이기’ 설정이 켜져 있으면 모션은 자동으로 꺼집니다.</p></div>
      <div class="panel"><h2>타이틀 · 안내 문구</h2><p class="hint" style="margin:-6px 0 12px">비워 두면 페이지의 기본 문구를 그대로 씁니다. 입력하는 즉시 아래 미리보기에 반영됩니다.</p><div id="d-texts"></div></div>
      <div class="panel"><h2>미리보기와 적용</h2>
        <div class="frame-bar"><div class="row"><label for="d-prev-year">미리볼 연도</label><select id="d-prev-year" style="width:auto"></select>
          <button id="d-pc" type="button" aria-pressed="true">PC</button><button id="d-phone" type="button" aria-pressed="false">폰</button>
          <button id="d-replay" type="button">▶ 모션 다시 재생</button><button id="d-reset" type="button">기본값으로</button></div></div>
        <div class="row" style="margin:10px 0"><span style="color:var(--muted);font-size:.88rem">적용할 연도</span><div id="d-years"></div>
          <button id="d-apply" class="primary" type="button" disabled style="margin-left:auto">선택한 연도에 적용</button></div>
        <div id="d-st-apply" class="status" role="status">고른 설정이 아래 실제 페이지에 바로 반영됩니다. 미리보기는 저장되지 않습니다.</div>
        <div class="frame-wrap"><iframe id="frame" title="선택한 디자인 미리보기" ></iframe></div></div>`;
      p.addEventListener("click", e => { const b = e.target.closest("[data-load]"); if (!b) return; cfg = clone(current[b.dataset.load] || defaults()); renderAll(); renderTexts(); loadPreview(); A.toast(`${b.dataset.load}학년도 설정을 불러왔습니다`, "ok"); });
      $("d-pc").addEventListener("click", () => setDevice(false)); $("d-phone").addEventListener("click", () => setDevice(true));
      $("d-replay").addEventListener("click", () => { const w = $("frame").contentWindow; if (frameReady && w) w.postMessage({ type: "lab-replay" }, location.origin); else loadPreview(); });
      $("d-reset").addEventListener("click", () => { cfg = defaults(); renderAll(); renderTexts(); pushPreview(); });
      $("d-apply").addEventListener("click", applyNow);
      $("d-prev-year").addEventListener("change", loadPreview);
      $("frame").addEventListener("load", () => { frameReady = true; readDefaults(); if (hasTexts(cfg.texts) || true) { const w = $("frame").contentWindow; if (w) w.postMessage({ type: "lab-cfg", cfg: clone(cfg) }, location.origin); } });
      document.addEventListener("vc-connected", updateApply);
    },
    async show() {
      await loadCurrent();
      const sel = $("d-prev-year");
      sel.innerHTML = A.years.map(y => `<option value="${y}">${y}학년도</option>`).join("");
      if (!started) { started = true; sel.value = A.year; picked.add(A.year); cfg = clone(current[A.year] || defaults()); renderTexts(); }
      else if (![...sel.options].some(o => o.value === sel.value)) sel.value = A.year;
      renderAll();
      if (!frameReady) loadPreview();
    },
  });
})();

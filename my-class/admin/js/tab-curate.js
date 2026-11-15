/* ═══════════════════════════════════════════════════════════════
   탭 3 · 작품 관리 — 학생 작품 숨김·추천·제목/메모, 예시 작품 순서·분류·숨김
   저장 위치: {연도}/vibe-coding/curation.json  (학생 파일은 건드리지 않음)
═══════════════════════════════════════════════════════════════ */
"use strict";
(function () {
  const { $, esc } = A;
  let Y = null, cur = null, school = "all", q = "", only = "all", dirty = false;

  const cleanCur = () => {
    const keys = new Set(Y.students.map(s => s.ck));
    const meta = {};
    Object.keys(cur.meta).forEach(k => {
      const m = cur.meta[k] || {};
      const t = (m.title || "").trim().slice(0, 60), n = (m.note || "").trim().slice(0, 100);
      if ((t || n) && keys.has(k)) meta[k] = { ...(t ? { title: t } : {}), ...(n ? { note: n } : {}) };
    });
    const exDirs = new Set(Y.examples.map(e => e.dir));
    const cat = {};
    Object.keys(cur.examples.category).forEach(d => { const v = String(cur.examples.category[d] || "").trim().slice(0, 12); if (v && exDirs.has(d)) cat[d] = v; });
    return {
      hidden: cur.hidden.filter(k => keys.has(k)).sort(A.cmp),
      featured: cur.featured.filter(k => keys.has(k)).sort(A.cmp),
      meta,
      examples: { hidden: cur.examples.hidden.filter(d => exDirs.has(d)), order: cur.examples.order.filter(d => exDirs.has(d)), category: cat },
    };
  };
  const setDirty = v => { dirty = v; $("cu-dirty").hidden = !v; };
  const toggle = (arr, k, on) => { const i = arr.indexOf(k); if (on && i < 0) arr.push(k); if (!on && i >= 0) arr.splice(i, 1); };

  function studentRows() {
    const list = Y.students.filter(s => (school === "all" || s.school === school)
      && (only === "all" || (only === "hidden" && cur.hidden.includes(s.ck)) || (only === "featured" && cur.featured.includes(s.ck)) || (only === "edited" && cur.meta[s.ck]))
      && (!q || (s.file + " " + s.title + " " + s.id).toLowerCase().includes(q)))
      .sort((a, b) => A.cmp(a.school, b.school) || A.cmp(a.file, b.file));
    if (!list.length) return `<div class="empty">조건에 맞는 작품이 없습니다.</div>`;
    return `<div class="tbl-wrap maxh" style="max-height:560px"><table class="tbl"><thead><tr><th>학교</th><th>학번</th><th>원래 제목</th><th>숨김</th><th>추천</th><th>표시 제목</th><th>한 줄 메모</th></tr></thead><tbody>${
      list.map(s => { const m = cur.meta[s.ck] || {}, hid = cur.hidden.includes(s.ck);
        return `<tr data-k="${esc(s.ck)}"${hid ? ' style="opacity:.55"' : ""}><td>${esc(A.schoolLabel(s.school))}</td><td class="mono">${esc(s.id || "?")}</td>
          <td><a href="${s.href}" target="_blank" rel="noopener">${esc(s.title)}</a></td>
          <td><input type="checkbox" data-a="hide" ${hid ? "checked" : ""} aria-label="숨김"></td>
          <td><input type="checkbox" data-a="feat" ${cur.featured.includes(s.ck) ? "checked" : ""} aria-label="추천"></td>
          <td><input type="text" data-a="title" value="${esc(m.title || "")}" maxlength="60" placeholder="(원래 제목 그대로)"></td>
          <td><input type="text" data-a="note" value="${esc(m.note || "")}" maxlength="100" placeholder="추천 이유 등"></td></tr>`; }).join("")
    }</tbody></table></div>`;
  }

  function exampleRows() {
    const ex = cur.examples;
    const idx = d => { const i = ex.order.indexOf(d); return i < 0 ? 1e9 : i; };
    const list = Y.examples.slice().sort((a, b) => (idx(a.dir) - idx(b.dir)) || A.cmp(a.dir, b.dir));
    if (!list.length) return `<div class="empty">예시 작품이 없습니다.</div>`;
    const cats = [...new Set(Object.values(ex.category))];
    return `<datalist id="cu-cats">${cats.map(c => `<option value="${esc(c)}">`).join("")}</datalist>
    <div class="tbl-wrap"><table class="tbl"><thead><tr><th>순서</th><th>작품 폴더</th><th>숨김</th><th>분류</th></tr></thead><tbody>${
      list.map((e, i) => `<tr data-d="${esc(e.dir)}"${ex.hidden.includes(e.dir) ? ' style="opacity:.55"' : ""}>
        <td style="white-space:nowrap"><button class="sm" data-a="up" type="button" ${i === 0 ? "disabled" : ""} aria-label="위로">↑</button> <button class="sm" data-a="down" type="button" ${i === list.length - 1 ? "disabled" : ""} aria-label="아래로">↓</button></td>
        <td>${esc(e.dir)}</td><td><input type="checkbox" data-a="exhide" ${ex.hidden.includes(e.dir) ? "checked" : ""} aria-label="숨김"></td>
        <td><input type="text" data-a="cat" list="cu-cats" value="${esc(ex.category[e.dir] || "")}" maxlength="12" placeholder="예: 게임"></td></tr>`).join("")
    }</tbody></table></div>`;
  }

  function render() {
    $("cu-students").innerHTML = studentRows();
    $("cu-examples").innerHTML = exampleRows();
    const n = (cur.hidden.length), f = cur.featured.length, e = Object.keys(cur.meta).length;
    $("cu-sum").textContent = `숨김 ${n} · 추천 ${f} · 제목/메모 수정 ${e} · 예시 숨김 ${cur.examples.hidden.length}`;
  }

  function wire() {
    $("cu-students").addEventListener("input", ev => {
      const tr = ev.target.closest("tr[data-k]"); if (!tr) return;
      const k = tr.dataset.k, a = ev.target.dataset.a;
      if (a === "hide") { toggle(cur.hidden, k, ev.target.checked); tr.style.opacity = ev.target.checked ? ".55" : ""; }
      else if (a === "feat") toggle(cur.featured, k, ev.target.checked);
      else if (a === "title" || a === "note") { (cur.meta[k] = cur.meta[k] || {})[a] = ev.target.value; }
      setDirty(true);
      $("cu-sum").textContent = `숨김 ${cur.hidden.length} · 추천 ${cur.featured.length} · 제목/메모 수정 ${Object.values(cur.meta).filter(m => m && (m.title || m.note)).length} · 예시 숨김 ${cur.examples.hidden.length}`;
    });
    $("cu-examples").addEventListener("click", ev => {
      const b = ev.target.closest("button[data-a]"); if (!b) return;
      const d = b.closest("tr").dataset.d;
      const idx = x => { const i = cur.examples.order.indexOf(x); return i < 0 ? 1e9 : i; };
      const full = Y.examples.slice().sort((a, c) => (idx(a.dir) - idx(c.dir)) || A.cmp(a.dir, c.dir)).map(e => e.dir);
      const i = full.indexOf(d), j = b.dataset.a === "up" ? i - 1 : i + 1;
      if (j < 0 || j >= full.length) return;
      [full[i], full[j]] = [full[j], full[i]];
      cur.examples.order = full; setDirty(true); render();
    });
    $("cu-examples").addEventListener("input", ev => {
      const tr = ev.target.closest("tr[data-d]"); if (!tr) return;
      const d = tr.dataset.d, a = ev.target.dataset.a;
      if (a === "exhide") { toggle(cur.examples.hidden, d, ev.target.checked); tr.style.opacity = ev.target.checked ? ".55" : ""; }
      else if (a === "cat") cur.examples.category[d] = ev.target.value;
      setDirty(true);
    });
  }

  async function save() {
    if (!A.requireWrite()) return;
    const data = cleanCur();
    const btn = $("cu-save"); btn.disabled = true;
    try {
      await A.putFile(`${A.year}/${A.PAGE}/curation.json`, JSON.stringify({ ...data, updated: new Date().toISOString() }, null, 2) + "\n", `${A.year}: 작품 관리 저장`);
      A.cache[A.year].curation = A.clone(data); A.cache[A.year].curationExists = true;
      cur = A.curDraft[A.year] = A.clone(data); setDirty(false); render();
      A.toast("저장했습니다. 학생 화면에는 1~2분 뒤 반영됩니다.", "ok");
    } catch (e) { A.toast(e.message, "err"); }
    btn.disabled = false;
  }

  A.registerTab({
    id: "curate", icon: "🖼️", title: "작품 관리",
    init(p) {
      p.innerHTML = `
      <div class="pane-head"><h2>작품 관리 <span id="cu-dirty" class="tag warn" hidden>저장 안 됨</span></h2>
        <span class="hint" style="margin:0">학생 파일은 그대로 두고, 갤러리에 보이는 방식만 바꿉니다.</span></div>
      <div class="panel"><h2>학생 작품</h2>
        <div class="row" style="margin-bottom:10px"><select id="cu-school" style="width:auto" aria-label="학교"></select>
          <input id="cu-q" type="text" placeholder="학번·제목 검색" style="max-width:220px" aria-label="검색">
          <select id="cu-only" style="width:auto" aria-label="보기"><option value="all">전체</option><option value="hidden">숨김만</option><option value="featured">추천만</option><option value="edited">수정한 것만</option></select>
          <span id="cu-sum" class="hint" style="margin:0 0 0 auto"></span></div>
        <div id="cu-students"></div>
        <p class="hint">숨김: 갤러리 모든 목록에서 빠집니다 · 추천: ‘선생님 추천’ 구역과 ★ 배지 · 표시 제목: 파일명을 바꾸지 않고 제목만 고칩니다.</p></div>
      <div class="panel"><h2>예시 작품</h2><div id="cu-examples"></div>
        <p class="hint">순서를 지정하지 않은 작품은 이름순으로 뒤에 붙습니다. 분류는 예시 목록 오른쪽에 작게 표시됩니다.</p></div>
      <div class="panel"><div class="row">
        <button id="cu-save" class="primary" type="button">저장 (curation.json)</button>
        <button id="cu-prune" type="button">없어진 작품 항목 정리</button>
        <button id="cu-dl" type="button">JSON 내려받기</button>
        <button id="cu-reset" class="danger" type="button">변경 취소</button></div>
        <p class="hint">토큰 없이도 편집·JSON 내려받기는 가능하며, 저장에는 GitHub 연결이 필요합니다.</p></div>`;
      wire();
      $("cu-school").addEventListener("change", e => { school = e.target.value; render(); });
      $("cu-only").addEventListener("change", e => { only = e.target.value; render(); });
      $("cu-q").addEventListener("input", A.debounce(e => { q = e.target.value.trim().toLowerCase(); render(); }, 200));
      $("cu-save").addEventListener("click", save);
      $("cu-dl").addEventListener("click", () => A.download("curation.json", JSON.stringify(cleanCur(), null, 2) + "\n", "application/json"));
      $("cu-prune").addEventListener("click", () => { cur.hidden = cleanCur().hidden; const c = cleanCur(); cur.hidden = c.hidden; cur.featured = c.featured; cur.meta = c.meta; cur.examples = c.examples; setDirty(true); render(); A.toast("없어진 작품 항목을 정리했습니다. 저장을 눌러 주세요.", "ok"); });
      $("cu-reset").addEventListener("click", () => { delete A.curDraft[A.year]; cur = A.getCur(A.year); setDirty(false); render(); });
      window.addEventListener("beforeunload", e => { if (dirty) { e.preventDefault(); e.returnValue = ""; } });
    },
    async show() {
      const same = Y && Y.year === A.year;
      if (dirty && !same && !confirm("저장하지 않은 변경이 있습니다. 버리고 다른 연도로 이동할까요?")) { A.$("year-sel").value = Y.year; A.year = Y.year; return; }
      Y = await A.loadYear(A.year);
      if (!same) { setDirty(false); school = "all"; }
      cur = A.getCur(A.year);
      const sc = Y.schools;
      $("cu-school").innerHTML = `<option value="all">전체 학교</option>` + sc.map(s => `<option value="${esc(s)}">${esc(A.schoolLabel(s))}</option>`).join("");
      $("cu-school").value = school;
      render();
    },
  });
})();

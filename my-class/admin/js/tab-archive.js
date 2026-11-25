/* ═══════════════════════════════════════════════════════════════
   탭 8 · 보관·새 학년도 — 학년말 점검, CSV 내보내기, 설정 백업, 새 연도/프로젝트 뼈대 만들기
═══════════════════════════════════════════════════════════════ */
"use strict";
(function () {
  const { $, esc, say } = A;

  /* ── 학년말 점검 ── */
  async function endCheck() {
    const box = $("ar-check"); box.innerHTML = `<div class="empty">확인하는 중…</div>`;
    const Y = await A.loadYear(A.year, true);
    const r = await A.runChecks(A.year);
    const errs = r.issues.filter(i => i.level === "err").length, warns = r.issues.filter(i => i.level === "warn").length;
    const li = (ok, t, note) => `<li><span class="tag ${ok ? "ok" : "warn"}">${ok ? "OK" : "확인"}</span> ${esc(t)}${note ? ` <small style="color:var(--muted)">${esc(note)}</small>` : ""}</li>`;
    box.innerHTML = `<ul style="list-style:none;padding:0;margin:0;display:grid;gap:8px">
      ${li(Y.hasManifest, "files.json (작품 목록)", Y.hasManifest ? `학생 ${Y.students.length} · 예시 ${Y.examples.length}` : "없음 — 워크플로 실행 필요")}
      ${li(!!Y.meta, "meta.json (업로드 시각)", Y.meta ? "" : "없음 — 다음 업로드 때 생성")}
      ${li(!!Y.theme, "theme.json (디자인 설정)", Y.theme && A.describeTheme ? A.describeTheme(Y.theme) : "없음 — 기본 디자인")}
      ${li(Y.curationExists, "curation.json (작품 관리)", Y.curationExists ? "" : "없음 — 숨김·추천을 쓰지 않으면 괜찮음")}
      ${li(errs === 0, "제출 점검 오류 0개", `오류 ${errs} · 주의 ${warns}`)}</ul>`;
  }

  /* ── CSV ── */
  const csvCell = v => { const s = String(v == null ? "" : v); return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s; };
  async function exportCsv() {
    const btn = $("ar-csv"); btn.disabled = true;
    try {
      const Y = await A.loadYear(A.year), S = await A.loadStats(A.year), c = Y.curation;
      const head = ["학년도", "학교", "학번", "이름", "표시 제목", "원래 제목", "👍 수", "추천", "숨김", "업로드 시각", "주소"];
      const rows = Y.students.map(s => {
        const m = c.meta[s.ck] || {};
        return [A.year, A.schoolLabel(s.school), s.id, s.name, m.title || s.title, s.title, S.thumbs[s.key] || 0,
          c.featured.includes(s.ck) ? "Y" : "", c.hidden.includes(s.ck) ? "Y" : "", A.timeOf(Y, s), A.publicUrl(s.rel)];
      });
      A.download(`vibe-coding-${A.year}.csv`, "﻿" + [head, ...rows].map(r => r.map(csvCell).join(",")).join("\r\n") + "\r\n", "text/csv;charset=utf-8");
      A.toast(`${rows.length}행을 내려받았습니다` + (S.ok ? "" : " (👍 수는 불러오지 못해 0)"), S.ok ? "ok" : "err");
    } catch (e) { A.toast(e.message, "err"); }
    btn.disabled = false;
  }

  /* ── 설정 백업 ── */
  async function backup() {
    const out = { exported: new Date().toISOString(), years: {} };
    for (const y of A.years) { const Y = await A.loadYear(y); out.years[y] = { theme: Y.theme, curation: Y.curation }; }
    A.download(`my-class-settings-${new Date().toISOString().slice(0, 10)}.json`, JSON.stringify(out, null, 2) + "\n", "application/json");
  }

  /* ── 새 연도 / 프로젝트 뼈대 ── */
  const PLACEHOLDER = (title) => `<!doctype html>
<html lang="ko"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(title)}</title>
<style>body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0b0d12;color:#e8eaf0;font-family:system-ui,"Noto Sans KR",sans-serif;text-align:center}main{padding:24px}h1{margin:0 0 8px}p{color:#9aa1b2}</style></head>
<body><main><h1>${esc(title)}</h1><p>준비 중입니다.</p></main></body></html>
`;
  function planScaffold() {
    const year = $("sc-year").value.trim(), proj = $("sc-proj").value.trim();
    if (!/^\d{4}$/.test(year)) return { err: "학년도는 4자리 숫자로 입력하세요 (예: 2028)" };
    if (!/^[a-z0-9][a-z0-9-]{1,40}$/.test(proj)) return { err: "프로젝트 폴더 이름은 영문 소문자·숫자·하이픈만 쓸 수 있습니다" };
    const dir = `${year}/${proj}`, files = {};
    const isMain = proj === A.PAGE;
    if (isMain) {
      const src = A.years.filter(y => y < year).pop() || A.years[A.years.length - 1];
      files.copy = { from: `${src}/${A.PAGE}/index.html`, to: `${dir}/index.html`, src };
      files.theme = { from: `${src}/${A.PAGE}/theme.json`, to: `${dir}/theme.json` };
      files.text = [[`${dir}/curation.json`, JSON.stringify({ hidden: [], featured: [], meta: {}, examples: { hidden: [], order: [], category: {} } }, null, 2) + "\n"],
        [`${dir}/examples/.gitkeep`, ""]];
    } else files.text = [[`${dir}/index.html`, PLACEHOLDER($("sc-title").value.trim() || proj)]];
    return { year, proj, dir, files, isMain };
  }
  function previewScaffold() {
    const p = planScaffold();
    if (p.err) { say($("sc-st"), p.err, "err"); $("sc-go").disabled = true; return null; }
    const list = [];
    if (p.files.copy) list.push(p.files.copy.to + `  (← ${p.files.copy.src}학년도 갤러리 복사)`);
    if (p.files.theme) list.push(p.files.theme.to + "  (← 가장 가까운 연도 설정 복사)");
    p.files.text.forEach(([n]) => list.push(n));
    if (p.isMain) list.push(`${p.dir}/school-…/student/.gitkeep  (학교 폴더는 아래 입력 후 생성)`);
    say($("sc-st"), "만들 파일:\n" + list.join("\n"));
    $("sc-go").disabled = !A.connected;
    return p;
  }
  async function createScaffold() {
    if (!A.requireWrite()) return;
    const p = previewScaffold(); if (!p) return;
    if (A.years.includes(p.year) && p.isMain && !confirm(`${p.year}학년도 폴더가 이미 있습니다. 없는 파일만 만들고 기존 파일은 덮어쓰지 않습니다. 계속할까요?`)) return;
    $("sc-go").disabled = true; say($("sc-st"), "만드는 중…");
    const tree = (await A.treeSafe(true)) || [];
    const exists = path => tree.some(t => t.path === `${A.BASE}/${path}`);
    const made = [], skipped = [];
    try {
      const put = async (rel, text, msg) => { if (exists(rel)) { skipped.push(rel); return; } await A.putFile(rel, text, msg); made.push(rel); };
      if (p.files.copy) {
        const html = await A.fetchRepo(p.files.copy.from, true);
        if (!html) throw new Error(`${p.files.copy.from} 를 읽지 못했습니다`);
        await put(p.files.copy.to, html, `${p.year}: 새 학년도 갤러리 뼈대`);
        const th = await A.fetchRepo(p.files.theme.from);
        if (th) await put(p.files.theme.to, JSON.stringify({ ...th, updated: new Date().toISOString() }, null, 2) + "\n", `${p.year}: 디자인 설정 복사`);
      }
      for (const [n, t] of p.files.text) await put(n, t, `${p.year}: ${p.proj} 뼈대`);
      const schools = $("sc-schools").value.split(/[\s,]+/).map(s => s.trim().toLowerCase()).filter(Boolean);
      if (p.isMain) for (const s of schools) {
        const code = "school-" + s.replace(/^school-/, "").replace(/[^a-z0-9-]/g, "");
        if (code === "school-") continue;
        await put(`${p.dir}/${code}/student/.gitkeep`, "", `${p.year}: ${code} 폴더`);
      }
      say($("sc-st"), `만들었습니다 (${made.length}개)` + (skipped.length ? `, 이미 있어 건너뜀 ${skipped.length}개` : "") + "\n" + made.join("\n") +
        (p.isMain ? "\n\n학생 파일이 올라오면 워크플로가 files.json 을 만듭니다. 이 페이지의 연도 목록은 ‘다시 불러오기’ 후 갱신됩니다." : `\n\n※ 자동 목록(files.json) 워크플로는 ${A.PAGE} 폴더에만 동작합니다.`), "ok");
    } catch (e) { say($("sc-st"), `${e.message}\n(이미 만든 파일: ${made.join(", ") || "없음"})`, "err"); }
    $("sc-go").disabled = !A.connected;
  }

  A.registerTab({
    id: "archive", icon: "🗄️", title: "보관·새 학년도",
    init(p) {
      p.innerHTML = `<div class="pane-head"><h2>보관 · 새 학년도 <span id="ar-y" class="tag"></span></h2></div>
      <div class="panel"><h2>학년말 점검</h2><div id="ar-check"></div><div class="row" style="margin-top:12px"><button id="ar-rerun" class="sm" type="button">다시 점검</button></div></div>
      <div class="panel" style="margin-top:18px"><h2>내보내기</h2>
        <div class="row"><button id="ar-csv" type="button">작품 목록 CSV (엑셀용)</button><button id="ar-bak" type="button">디자인·작품 관리 설정 백업(JSON)</button></div>
        <p class="hint">CSV에는 학번, 이름, 제목, 👍 수, 추천·숨김 여부, 업로드 시각, 주소가 들어갑니다. 한글이 깨지지 않도록 UTF-8(BOM)으로 저장합니다.</p></div>
      <div class="panel" style="margin-top:18px"><h2>새 학년도 · 프로젝트 만들기</h2>
        <div class="row"><div><label for="sc-year">학년도</label><input id="sc-year" type="text" maxlength="4" style="width:100px"></div>
          <div><label for="sc-proj">프로젝트 폴더</label><input id="sc-proj" type="text" value="${A.PAGE}" style="width:180px"></div>
          <div><label for="sc-title">이름(수업 갤러리 외)</label><input id="sc-title" type="text" maxlength="40" style="width:180px"></div>
          <div><label for="sc-schools">학교 코드(쉼표로 구분, 선택)</label><input id="sc-schools" type="text" placeholder="예: bsn, dd" style="width:200px"></div></div>
        <div class="row" style="margin-top:12px"><button id="sc-prev" type="button">미리보기</button><button id="sc-go" class="primary" type="button" disabled>만들기</button></div>
        <div id="sc-st" class="status" role="status"></div>
        <p class="hint">${A.PAGE} 는 가장 가까운 지난 연도의 갤러리·디자인 설정을 복사합니다. 이미 있는 파일은 덮어쓰지 않습니다.</p></div>`;
      $("ar-rerun").addEventListener("click", endCheck);
      $("ar-csv").addEventListener("click", exportCsv);
      $("ar-bak").addEventListener("click", () => backup().catch(e => A.toast(e.message, "err")));
      $("sc-prev").addEventListener("click", previewScaffold);
      $("sc-go").addEventListener("click", createScaffold);
      document.addEventListener("vc-connected", () => { if ($("sc-go").dataset.ready) $("sc-go").disabled = false; });
    },
    async show() {
      $("ar-y").textContent = A.year + "학년도";
      if (!$("sc-year").value) $("sc-year").value = String(Number(A.years[A.years.length - 1]) + 1);
      await endCheck();
    },
  });
})();

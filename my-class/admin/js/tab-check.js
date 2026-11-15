/* ═══════════════════════════════════════════════════════════════
   탭 2 · 제출 점검 — 파일명 규칙 / 잘못된 위치 / 중복·재제출 / 미제출 학생 / 목록 미반영
   A.runChecks(year) 는 보관 탭에서도 씁니다.
═══════════════════════════════════════════════════════════════ */
"use strict";
(function () {
  const { $, esc } = A;
  const KNOWN_ROOT = new Set(["index.html", "files.json", "meta.json", "theme.json", "curation.json", "README.md", "readme.md"]);
  let lastIssues = [], filter = "all";

  /* 학생 파일명 규칙 검사 */
  function nameIssues(s, legacy) {
    const out = [], base = s.file.replace(/\.html?$/i, "");
    if (!s.id) { out.push(["err", legacy ? "파일명이 학번 4자리(앞에 n 가능)로 시작하지 않습니다" : "파일명이 학번 4자리로 시작하지 않습니다 (예: 1101-코드 안 title.html)"]); return out; }
    if (/[#?%]/.test(s.file)) out.push(["warn", "파일명에 # ? % 문자가 있어 주소가 깨질 수 있습니다"]);
    if (legacy) { if (!base.includes(" - ")) out.push(["warn", "‘학번 - 제목’ 형식이 아니어서 제목이 파일명 전체로 표시됩니다"]); }
    else if (!s.title || s.title === base || /^[\d]{4}$/.test(s.title)) out.push(["warn", "학번 뒤에 제목이 없습니다"]);
    if (/\s{2,}/.test(s.file)) out.push(["info", "파일명에 공백이 연속으로 들어 있습니다"]);
    return out;
  }

  /* 연도 전체 점검 → 문제 목록 */
  A.runChecks = async function (year) {
    const Y = await A.loadYear(year, false);
    const tree = await A.treeSafe();
    const legacy = A.isLegacy(year), issues = [];
    const add = (level, kind, file, msg, href) => issues.push({ level, kind, file, msg, href });

    /* 1) 학생 후보: files.json + 저장소 */
    const cand = new Map();           // "school/file" → student
    Y.students.forEach(s => cand.set(s.ck, s));
    let treeStudents = null;
    if (tree) {
      const files = A.pageFiles(tree, year);
      treeStudents = new Set();
      files.forEach(f => {
        const sub = f.sub;
        if (/(^|\/)\.gitkeep$/.test(sub)) return;
        let m = sub.match(/^(school-[^/]+)\/student\/([^/]+)$/i);
        if (m) {
          if (!/\.html?$/i.test(m[2])) { add("warn", "형식", sub, "html 파일이 아닙니다 (갤러리에 나오지 않습니다)"); return; }
          treeStudents.add(`${m[1]}/${m[2]}`);
          if (!cand.has(`${m[1]}/${m[2]}`)) cand.set(`${m[1]}/${m[2]}`, A.parseStudent(m[2], m[1], year));
          return;
        }
        if (/^examples\//.test(sub) || KNOWN_ROOT.has(sub) || /^school-[^/]+\/index\.html$/i.test(sub)) return;
        if (!/\.html?$/i.test(sub)) return;
        let hint = "갤러리는 school-*/student/ 폴더 안의 html만 읽습니다.";
        if (/^students?\//i.test(sub)) hint = "school-?/student/ 폴더로 옮겨야 갤러리에 보입니다.";
        else if (m = sub.match(/^(school-[^/]+)\/[^/]+\.html?$/i)) hint = `${m[1]}/student/ 안으로 옮겨야 합니다 (student 폴더 바깥입니다).`;
        else if (/^school-[^/]+\/student\/.+\//i.test(sub)) hint = "student 폴더 안에 하위 폴더를 만들지 말고 파일을 바로 두세요.";
        add("err", "잘못된 위치", sub, hint, A.publicUrl(`${year}/${A.PAGE}/${sub}`));
      });
    } else add("info", "안내", "", "저장소 목록을 읽지 못해 ‘잘못된 위치’ 검사는 건너뜁니다. " + (A.treeError || ""));
    if (tree && A.treeTruncated) add("warn", "안내", "", "저장소가 너무 커서 목록이 일부만 조회되었습니다. 점검 결과가 불완전할 수 있습니다.");

    /* 2) 파일명 규칙 */
    const students = [...cand.values()];
    students.forEach(s => nameIssues(s, legacy).forEach(([lv, msg]) => add(lv, "파일명", s.rel, msg, s.href)));

    /* 3) 같은 학교 안 같은 학번 중복 */
    const byId = new Map();
    students.filter(s => s.id).forEach(s => { const k = s.school + "|" + s.id; (byId.get(k) || byId.set(k, []).get(k)).push(s); });
    byId.forEach(list => {
      if (list.length < 2) return;
      const sorted = list.slice().sort((a, b) => (A.timeOf(Y, b) || "").localeCompare(A.timeOf(Y, a) || "") || A.cmp(b.file, a.file));
      const hasTime = !!A.timeOf(Y, sorted[0]);
      add("warn", "중복·재제출", `${A.schoolLabel(list[0].school)} ${list[0].id}`,
        `같은 학번 파일 ${list.length}개: ` + sorted.map((s, i) => `${i === 0 && hasTime ? "★최신 " : ""}${s.file}${A.timeOf(Y, s) ? " (" + A.fmtTime(A.timeOf(Y, s)) + ")" : ""}`).join(" / "));
    });

    /* 4) 목록 동기화 */
    if (treeStudents) {
      const inList = new Set(Y.students.map(s => s.ck));
      [...treeStudents].filter(k => !inList.has(k)).forEach(k => add("warn", "목록 미반영", k, "저장소에는 있으나 files.json에 없습니다 (워크플로 대기 중이거나 실패)"));
      [...inList].filter(k => !treeStudents.has(k)).forEach(k => add("warn", "목록 미반영", k, "files.json에는 있으나 저장소에 없습니다 (삭제된 파일)"));
    }
    const order = { err: 0, warn: 1, info: 2 };
    issues.sort((a, b) => order[a.level] - order[b.level] || A.cmp(a.kind, b.kind) || A.cmp(a.file, b.file));
    return { issues, students, Y };
  };

  /* 명단 대조 */
  function parseRoster(text) {
    const out = [];
    text.split(/\r?\n/).forEach(line => {
      const m = line.match(/(?:^|[^\d])(\d{4})(?!\d)/);
      if (!m) return;
      const name = line.replace(m[1], " ").replace(/[,\t;|"]+/g, " ").replace(/\s+/g, " ").trim();
      out.push({ id: m[1], name });
    });
    const seen = new Set();
    return out.filter(r => !seen.has(r.id) && seen.add(r.id));
  }

  function renderIssues() {
    const box = $("ck-list");
    const shown = lastIssues.filter(i => filter === "all" || i.level === filter);
    if (!lastIssues.length) { box.innerHTML = `<div class="empty">✔ 문제가 발견되지 않았습니다.</div>`; return; }
    if (!shown.length) { box.innerHTML = `<div class="empty">해당하는 항목이 없습니다.</div>`; return; }
    const tag = { err: '<span class="tag err">오류</span>', warn: '<span class="tag warn">주의</span>', info: '<span class="tag">안내</span>' };
    box.innerHTML = `<div class="tbl-wrap maxh"><table class="tbl"><thead><tr><th>수준</th><th>종류</th><th>대상</th><th>내용</th></tr></thead><tbody>${
      shown.map(i => `<tr><td>${tag[i.level]}</td><td>${esc(i.kind)}</td><td class="fn mono">${i.href ? `<a href="${i.href}" target="_blank" rel="noopener">${esc(i.file)}</a>` : esc(i.file)}</td><td>${esc(i.msg)}</td></tr>`).join("")
    }</tbody></table></div>`;
  }

  function renderRoster(students) {
    const sc = $("ck-school").value, out = $("ck-roster-out");
    const text = $("ck-roster").value;
    A.ls.set(`vc_roster_${A.year}_${sc}`, text);
    const roster = parseRoster(text);
    if (!roster.length) { out.innerHTML = `<p class="hint">학번(4자리)이 들어 있는 줄이 없습니다. 구글 시트에서 학번·이름 열을 복사해 붙여넣으세요.</p>`; return; }
    const mine = students.filter(s => s.school === sc && s.id);
    const have = new Map(); mine.forEach(s => (have.get(s.id) || have.set(s.id, []).get(s.id)).push(s));
    const missing = roster.filter(r => !have.has(r.id));
    const ids = new Set(roster.map(r => r.id));
    const extra = [...have.keys()].filter(id => !ids.has(id));
    const pct = Math.round(((roster.length - missing.length) / roster.length) * 100);
    out.innerHTML = `<div class="kpis"><div class="kpi"><b>${roster.length - missing.length} / ${roster.length}</b><span>제출 완료 (${pct}%)</span></div>
      <div class="kpi"><b style="color:${missing.length ? "var(--warn)" : "var(--ok)"}">${missing.length}</b><span>미제출</span></div>
      <div class="kpi"><b>${extra.length}</b><span>명단에 없는 학번</span></div></div>
      <div class="progress"><i style="width:${pct}%"></i></div>
      ${missing.length ? `<h3>미제출 학생</h3><div class="tbl-wrap maxh"><table class="tbl"><tbody>${missing.map(r => `<tr><td class="mono">${r.id}</td><td>${esc(r.name)}</td></tr>`).join("")}</tbody></table></div>
        <div class="row" style="margin-top:8px"><button id="ck-copy-miss" class="sm" type="button">미제출 명단 복사</button></div>` : `<p class="status ok">✔ 명단의 모든 학생이 제출했습니다.</p>`}
      ${extra.length ? `<h3>명단에 없는 학번 (오타 가능성)</h3><p class="mono">${extra.join(", ")}</p>` : ""}`;
    const cb = $("ck-copy-miss");
    if (cb) cb.addEventListener("click", () => A.copy(missing.map(r => `${r.id}\t${r.name}`).join("\n")));
  }

  async function run() {
    $("ck-list").innerHTML = `<div class="empty">점검하는 중…</div>`;
    const { issues, students, Y } = await A.runChecks(A.year);
    lastIssues = issues;
    const c = k => issues.filter(i => i.level === k).length;
    $("ck-kpi").innerHTML = `<div class="kpi"><b>${students.length}</b><span>학생 파일</span></div>
      <div class="kpi"><b style="color:${c("err") ? "var(--err)" : "var(--ok)"}">${c("err")}</b><span>오류</span></div>
      <div class="kpi"><b style="color:${c("warn") ? "var(--warn)" : "var(--ok)"}">${c("warn")}</b><span>주의</span></div>`;
    renderIssues();
    const sel = $("ck-school"), prev = sel.value;
    const schools = [...new Set([...Y.schools, ...students.map(s => s.school)])].sort(A.cmp);
    sel.innerHTML = schools.map(s => `<option value="${esc(s)}">${esc(A.schoolLabel(s))}</option>`).join("") || `<option value="">(학교 없음)</option>`;
    if (schools.includes(prev)) sel.value = prev;
    $("ck-roster").value = A.ls.get(`vc_roster_${A.year}_${sel.value}`, "");
    $("ck-run").onclick = () => renderRoster(students);
    sel.onchange = () => { $("ck-roster").value = A.ls.get(`vc_roster_${A.year}_${sel.value}`, ""); $("ck-roster-out").innerHTML = ""; };
    if ($("ck-roster").value.trim()) renderRoster(students); else $("ck-roster-out").innerHTML = "";
  }

  A.registerTab({
    id: "check", icon: "✅", title: "제출 점검",
    init(p) {
      p.innerHTML = `
      <div class="pane-head"><h2>제출 점검</h2><span class="hint" style="margin:0">갤러리에 안 보이는 작품의 원인을 찾습니다. 수업 직후 한 번 눌러 보세요.</span></div>
      <div class="panel"><div class="kpis" id="ck-kpi"></div>
        <div class="fchips" role="group" aria-label="수준 필터">
          <button data-f="all" aria-pressed="true" type="button">전체</button><button data-f="err" aria-pressed="false" type="button">오류</button>
          <button data-f="warn" aria-pressed="false" type="button">주의</button><button data-f="info" aria-pressed="false" type="button">안내</button>
          <button id="ck-rerun" class="sm" type="button" style="margin-left:auto">↻ 다시 점검</button></div>
        <div id="ck-list"></div>
        <p class="hint">검사 항목: 파일명 규칙 · 잘못된 위치(students/ 등) · 학번 중복·재제출 · 저장소와 files.json 불일치</p></div>
      <div class="panel"><h2>미제출 학생 체크</h2>
        <p class="hint" style="margin:-6px 0 10px">링크시트의 학번·이름 열을 복사해 붙여넣으면 제출 여부를 대조합니다. 학교별로 따로 저장됩니다. 파일명에는 학번만 들어 있어 학번으로 대조합니다.</p>
        <div class="row"><label for="ck-school">학교</label><select id="ck-school" style="width:auto"></select></div>
        <textarea id="ck-roster" rows="6" placeholder="1101&#9;홍길동&#10;1102&#9;김철수&#10;…" style="margin-top:10px"></textarea>
        <div class="row" style="margin-top:8px"><button id="ck-run" class="primary" type="button">대조하기</button></div>
        <div id="ck-roster-out" style="margin-top:12px"></div></div>`;
      p.querySelectorAll(".fchips button[data-f]").forEach(b => b.addEventListener("click", () => {
        filter = b.dataset.f;
        p.querySelectorAll(".fchips button[data-f]").forEach(x => x.setAttribute("aria-pressed", String(x === b)));
        renderIssues();
      }));
      $("ck-rerun").addEventListener("click", async () => { await A.treeSafe(true); A.cache = {}; run(); });
    },
    show() { run(); },
  });
})();

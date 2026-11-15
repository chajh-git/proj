/* ═══════════════════════════════════════════════════════════════
   탭 1 · 현황 — 연도·프로젝트별 대시보드 / 프로젝트 레지스트리 / 빌드 상태
═══════════════════════════════════════════════════════════════ */
"use strict";
(function () {
  const { $, esc, say } = A;
  const WF_URL = `https://github.com/${A.OWNER}/${A.REPO}/actions/workflows/build-manifest.yml`;
  let registry = {};         // "2027/vibe-coding" → { title, desc }
  let regLoaded = false;

  async function commitInfo(path) {
    try {
      const r = await fetch(A.api(`commits?path=${encodeURIComponent(path)}&per_page=1&sha=${A.BRANCH}`), { headers: A.headers() });
      if (!r.ok) return null;
      const j = await r.json();
      return j[0] ? { date: j[0].commit.committer.date, msg: j[0].commit.message.split("\n")[0] } : null;
    } catch { return null; }
  }

  function yearCard(Y, selected) {
    const per = Y.schools.map(sc => {
      const n = Y.students.filter(s => s.school === sc).length;
      return `<span class="tag">${esc(A.schoolLabel(sc))} ${n}</span>`;
    }).join(" ");
    const last = Y.meta ? Object.values(Y.meta).sort().pop() : "";
    const th = Y.theme && A.describeTheme ? A.describeTheme(Y.theme) : "기본 설정";
    return `<div class="ycard${selected ? " sel" : ""}">
      <h3>${Y.year}학년도</h3>
      <div class="big">${Y.students.length}<small>학생 작품</small></div>
      <p>${per || '<span class="tag warn">학교 폴더 없음</span>'}</p>
      <p>예시 작품 ${Y.examples.length}개${last ? ` · 마지막 업로드 ${A.ago(last)}` : ""}</p>
      <p>🎨 ${esc(th)}</p>
      <div class="row"><button class="sm" data-go="${Y.year}" type="button">이 연도 보기</button>
        <a href="${A.pageUrl(Y.year)}" target="_blank" rel="noopener"><button class="sm" type="button">갤러리 열기 ↗</button></a></div>
    </div>`;
  }

  async function buildStatus(Y, tree) {
    const box = $("ov-build");
    const files = tree ? A.pageFiles(tree, Y.year) : null;
    const inTree = files ? files.filter(f => /^school-[^/]+\/student\/[^/]+\.html?$/i.test(f.sub)).map(f => f.sub) : null;
    const inList = new Set(Y.students.map(s => `${s.school}/student/${s.file}`));
    const [fj, mj] = await Promise.all([commitInfo(`${A.BASE}/${Y.year}/${A.PAGE}/files.json`), commitInfo(`${A.BASE}/${Y.year}/${A.PAGE}/meta.json`)]);
    let h = `<div class="kpis">
      <div class="kpi"><b>${fj ? A.ago(fj.date) : "—"}</b><span>files.json 마지막 갱신</span></div>
      <div class="kpi"><b>${mj ? A.ago(mj.date) : "—"}</b><span>meta.json(업로드 시각) 갱신</span></div>
      <div class="kpi"><b>${inTree ? inTree.length : "?"}</b><span>저장소의 학생 파일</span></div>
      <div class="kpi"><b>${Y.students.length}</b><span>갤러리 목록(files.json)</span></div></div>`;
    if (inTree) {
      const pending = inTree.filter(x => !inList.has(x));
      const stale = [...inList].filter(x => !inTree.includes(x));
      if (!pending.length && !stale.length) h += `<p class="status ok">✔ 저장소 파일과 갤러리 목록이 일치합니다.</p>`;
      if (pending.length) h += `<p class="status warn">⏳ 아직 갤러리 목록에 없는 파일 ${pending.length}개 — 워크플로가 실행 중이거나 실패했을 수 있습니다.<br><span class="mono">${pending.slice(0, 6).map(esc).join("<br>")}${pending.length > 6 ? "<br>…" : ""}</span></p>`;
      if (stale.length) h += `<p class="status warn">⚠ 목록에는 있지만 저장소에는 없는 파일 ${stale.length}개 (삭제 후 목록 미갱신)</p>`;
    } else h += `<p class="hint">${esc(A.treeError || "저장소 목록을 읽지 못해 일치 여부는 확인하지 못했습니다.")}</p>`;
    h += `<div class="row" style="margin-top:10px"><a href="${WF_URL}" target="_blank" rel="noopener"><button class="sm" type="button">GitHub Actions 열기 ↗</button></a>
      <span class="hint" style="margin:0">워크플로 이름: build-manifest · 학생 파일이 올라오면 1~2분 안에 목록이 갱신됩니다.</span></div>`;
    box.innerHTML = h;
  }

  function recentTable(Y) {
    const box = $("ov-recent");
    if (!Y.meta) { box.innerHTML = `<div class="empty">아직 meta.json이 없습니다. 다음 파일 업로드 때 워크플로가 만듭니다.</div>`; return; }
    const rows = Y.students.map(s => ({ s, t: A.timeOf(Y, s) })).filter(r => r.t).sort((a, b) => b.t.localeCompare(a.t)).slice(0, 12);
    if (!rows.length) { box.innerHTML = `<div class="empty">업로드 기록이 없습니다.</div>`; return; }
    const day = Date.now() - 86400000;
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>시각</th><th>학교</th><th>학번</th><th>제목</th></tr></thead><tbody>${
      rows.map(({ s, t }) => `<tr><td class="mono">${A.fmtTime(t)} <small style="color:var(--muted)">${A.ago(t)}</small>${new Date(t).getTime() > day ? '<span class="badge new">NEW</span>' : ""}</td>
        <td>${esc(A.schoolLabel(s.school))}</td><td class="mono">${esc(s.id || "?")}</td><td><a href="${s.href}" target="_blank" rel="noopener">${esc(s.title)}</a></td></tr>`).join("")
    }</tbody></table></div>`;
  }

  async function loadRegistry() {
    if (regLoaded) return;
    regLoaded = true;
    const j = await A.fetchRepo("data/projects.json");
    registry = j && typeof j === "object" && j.projects && typeof j.projects === "object" ? j.projects : {};
  }

  function registryTable(tree) {
    const box = $("ov-reg");
    let items = [];
    if (tree) {
      const dirs = tree.filter(t => t.type === "tree" && /^\d{4}\/[^/]+$/.test(t.path)).map(t => t.path).sort();
      items = dirs.map(d => ({ id: d, hasIndex: tree.some(t => t.path === d + "/index.html") }));
    } else items = A.years.map(y => ({ id: `${y}/${A.PAGE}`, hasIndex: true }));
    if (!items.length) { box.innerHTML = `<div class="empty">연도 폴더를 찾지 못했습니다.</div>`; return; }
    box.innerHTML = `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>폴더</th><th>표시 이름</th><th>설명</th><th></th></tr></thead><tbody>${
      items.map((it, i) => {
        const r = registry[it.id] || {};
        const isMain = it.id.endsWith("/" + A.PAGE);
        return `<tr><td class="mono">${esc(it.id)}${isMain ? ' <span class="tag ok">수업 갤러리</span>' : ""}${it.hasIndex ? "" : ' <span class="tag warn">index.html 없음</span>'}</td>
          <td><input type="text" data-rid="${i}" data-f="title" value="${esc(r.title || "")}" placeholder="${isMain ? "AI 바이브 랩" : "프로젝트 이름"}" maxlength="40"></td>
          <td><input type="text" data-rid="${i}" data-f="desc" value="${esc(r.desc || "")}" placeholder="한 줄 설명" maxlength="80"></td>
          <td>${it.hasIndex ? `<a href="${A.pageUrl(it.id.split("/")[0], it.id.split("/")[1])}" target="_blank" rel="noopener">열기 ↗</a>` : ""}</td></tr>`;
      }).join("")
    }</tbody></table></div>
    <div class="row" style="margin-top:10px"><button id="ov-reg-save" class="primary" type="button">이름·설명 저장</button>
      <span class="hint" style="margin:0"><code>data/projects.json</code> 에 저장됩니다. my-class 시작 화면 등에서 읽어 쓸 수 있습니다.</span></div>`;
    box.querySelectorAll("input[data-rid]").forEach(inp => inp.addEventListener("input", () => {
      const it = items[+inp.dataset.rid]; const r = (registry[it.id] = registry[it.id] || {});
      r[inp.dataset.f] = inp.value.trim();
    }));
    $("ov-reg-save").addEventListener("click", async () => {
      if (!A.requireWrite()) return;
      const clean = {};
      Object.keys(registry).forEach(k => { const r = registry[k]; if (r && (r.title || r.desc)) clean[k] = { title: r.title || "", desc: r.desc || "" }; });
      try {
        await A.putFile("data/projects.json", JSON.stringify({ projects: clean, updated: new Date().toISOString() }, null, 2) + "\n", "admin: 프로젝트 이름·설명 저장");
        A.toast("프로젝트 정보를 저장했습니다", "ok");
      } catch (e) { A.toast(e.message, "err"); }
    });
  }

  A.registerTab({
    id: "overview", icon: "📊", title: "현황",
    init(p) {
      p.innerHTML = `
      <div class="pane-head"><h2>현황 대시보드</h2><span class="hint" style="margin:0">연도별 작품 수, 최근 업로드, 빌드 상태를 한눈에 봅니다.</span></div>
      <div class="panel"><h2>연도별 요약</h2><div id="ov-years" class="ycards"><div class="empty">불러오는 중…</div></div></div>
      <div class="grid2" style="margin-top:18px">
        <div class="panel"><h2>빌드 상태 · <span id="ov-yl"></span></h2><div id="ov-build"><div class="empty">확인하는 중…</div></div></div>
        <div class="panel"><h2>최근 업로드 · <span id="ov-yl2"></span></h2><div id="ov-recent"></div></div>
      </div>
      <div class="panel" style="margin-top:18px"><h2>프로젝트 레지스트리</h2>
        <p class="hint" style="margin:-6px 0 10px">저장소의 연도 폴더 아래 프로젝트 폴더를 자동으로 찾아 보여 줍니다. <code>vibe-coding</code> 외 프로젝트를 추가해도 여기에 나타납니다.</p>
        <div id="ov-reg"></div></div>`;
      p.addEventListener("click", e => { const b = e.target.closest("[data-go]"); if (b) A.setYear(b.dataset.go); });
    },
    async show() {
      $("ov-yl").textContent = $("ov-yl2").textContent = A.year + "학년도";
      const [tree, ys] = await Promise.all([A.treeSafe(), Promise.all(A.years.map(y => A.loadYear(y)))]);
      $("ov-years").innerHTML = ys.map(Y => yearCard(Y, Y.year === A.year)).join("");
      const Y = ys.find(y => y.year === A.year);
      if (!Y.hasManifest) $("ov-build").innerHTML = `<p class="status warn">${A.year}학년도에는 files.json이 아직 없습니다. 학생·예시 파일을 올리면 워크플로가 만듭니다.</p>`;
      else await buildStatus(Y, tree);
      recentTable(Y);
      await loadRegistry();
      registryTable(tree);
    },
  });
})();

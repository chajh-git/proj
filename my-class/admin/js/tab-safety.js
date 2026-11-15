/* ═══════════════════════════════════════════════════════════════
   탭 6 · 안전·품질 — 외부 요청, 파일 크기, 깨진 스크립트 점검 (정적 분석, 파일은 실행하지 않음)
═══════════════════════════════════════════════════════════════ */
"use strict";
(function () {
  const { $, esc } = A;
  const WARN_KB = 500, ERR_KB = 2048;
  const CDN = ["cdnjs.cloudflare.com", "cdn.jsdelivr.net", "unpkg.com", "fonts.googleapis.com", "fonts.gstatic.com", "code.jquery.com", "ajax.googleapis.com", "cdn.tailwindcss.com"];
  let results = [], running = false;

  function hosts(html) {
    const set = new Set();
    const re = /(?:src|href|action|data|poster)\s*=\s*["']\s*((?:https?:)?\/\/[^"'\s>]+)|url\(\s*["']?((?:https?:)?\/\/[^"')\s]+)|@import\s+["']((?:https?:)?\/\/[^"']+)|\b(?:fetch|open|WebSocket|EventSource)\s*\(\s*["'`]((?:https?:|wss?:)?\/\/[^"'`]+)/gi;
    let m;
    while ((m = re.exec(html))) {
      const u = (m[1] || m[2] || m[3] || m[4] || "").replace(/^\/\//, "https://");
      try { set.add(new URL(u).hostname); } catch {}
    }
    return [...set];
  }
  function badScripts(html) {
    const errs = [], re = /<script\b([^>]*)>([\s\S]*?)<\/script>/gi;
    let m, i = 0;
    while ((m = re.exec(html))) {
      i++;
      const attrs = m[1], code = m[2];
      if (/\bsrc\s*=/i.test(attrs) || !code.trim()) continue;
      const t = (attrs.match(/type\s*=\s*["']?([^"'\s>]+)/i) || [])[1];
      if (t && !/^(text|application)\/(javascript|ecmascript)$/i.test(t)) continue;      // module·json 등은 건너뜀
      try { new Function(code); } catch (e) { errs.push(`스크립트 #${i}: ${e.message}`); }
    }
    return errs;
  }
  function inspect(s, text, bytes) {
    const issues = [];
    if (bytes === 0 || !text.trim()) issues.push({ sev: "err", t: "빈 파일" });
    else {
      if (!/<html[\s>]|<body[\s>]|<!doctype/i.test(text)) issues.push({ sev: "warn", t: "html/body 태그가 없음 (조각 코드일 수 있음)" });
      if (!/<\/html>\s*$/i.test(text.trim()) && /<html/i.test(text)) issues.push({ sev: "warn", t: "</html> 없이 끝남 — 파일이 중간에 잘렸을 수 있음" });
    }
    const kb = bytes / 1024;
    if (kb > ERR_KB) issues.push({ sev: "err", t: `파일이 매우 큼 (${(kb / 1024).toFixed(1)}MB) — 이미지가 직접 들어갔는지 확인` });
    else if (kb > WARN_KB) issues.push({ sev: "warn", t: `파일이 큼 (${Math.round(kb)}KB)` });
    const hs = hosts(text), ext = hs.filter(h => !CDN.includes(h)), cdn = hs.filter(h => CDN.includes(h));
    if (ext.length) issues.push({ sev: "warn", t: "외부 사이트 요청: " + ext.join(", ") });
    if (cdn.length) issues.push({ sev: "info", t: "공개 CDN 사용: " + cdn.join(", ") });
    badScripts(text).forEach(t => issues.push({ sev: "err", t: "문법 오류 — " + t }));
    return { s, bytes, issues };
  }

  async function run() {
    if (running) return;
    running = true; $("sf-run").disabled = true;
    const Y = await A.loadYear(A.year);
    const list = Y.students; results = [];
    let done = 0;
    const bar = $("sf-bar");
    $("sf-prog").hidden = false; $("sf-st").textContent = `0 / ${list.length}`;
    await A.pool(list, 6, async s => {
      try {
        const r = await fetch(s.href, { cache: "no-store" });
        if (!r.ok) results.push({ s, bytes: 0, issues: [{ sev: "err", t: `불러오기 실패 (HTTP ${r.status}) — 목록에는 있으나 파일이 없음` }] });
        else { const t = await r.text(); results.push(inspect(s, t, new Blob([t]).size)); }
      } catch (e) { results.push({ s, bytes: 0, issues: [{ sev: "err", t: "불러오기 실패: " + e.message }] }); }
      done++; bar.style.width = (done / list.length * 100) + "%"; $("sf-st").textContent = `${done} / ${list.length}`;
    });
    running = false; $("sf-run").disabled = false; $("sf-prog").hidden = true;
    render();
  }

  function render() {
    const box = $("sf-out");
    if (!results.length) { box.innerHTML = `<div class="empty">‘점검 시작’을 누르면 학생 파일을 읽어 분석합니다.</div>`; return; }
    const cnt = sev => results.filter(r => r.issues.some(i => i.sev === sev)).length;
    const clean = results.filter(r => !r.issues.some(i => i.sev !== "info")).length;
    const only = $("sf-only").value;
    const ord = { err: 0, warn: 1, info: 2 };
    const shown = results.filter(r => only === "all" || r.issues.some(i => i.sev === only)).sort((a, b) =>
      Math.min(...a.issues.map(i => ord[i.sev]), 3) - Math.min(...b.issues.map(i => ord[i.sev]), 3) || A.cmp(a.s.file, b.s.file));
    const tag = { err: "err", warn: "warn", info: "" };
    box.innerHTML = `<div class="kpis"><div class="kpi"><b>${results.length}</b><span>점검한 파일</span></div><div class="kpi"><b style="color:var(--ok)">${clean}</b><span>문제 없음</span></div>
      <div class="kpi"><b style="color:var(--warn)">${cnt("warn")}</b><span>주의</span></div><div class="kpi"><b style="color:var(--err)">${cnt("err")}</b><span>오류</span></div></div>` +
      (shown.length ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>학교</th><th>작품</th><th class="num">크기</th><th>내용</th></tr></thead><tbody>${shown.map(r => `<tr><td>${esc(A.schoolLabel(r.s.school))}</td>
        <td><a href="${r.s.href}" target="_blank" rel="noopener">${esc(r.s.id || "?")} ${esc(r.s.title)}</a></td><td class="num">${r.bytes ? Math.round(r.bytes / 1024) + "KB" : "—"}</td>
        <td>${r.issues.length ? r.issues.map(i => `<div><span class="tag ${tag[i.sev]}">${{ err: "오류", warn: "주의", info: "참고" }[i.sev]}</span> ${esc(i.t)}</div>`).join("") : '<span class="tag ok">이상 없음</span>'}</td></tr>`).join("")}</tbody></table></div>` : `<div class="empty">해당하는 작품이 없습니다.</div>`);
  }

  A.registerTab({
    id: "safety", icon: "🛡️", title: "안전·품질",
    init(p) {
      p.innerHTML = `<div class="pane-head"><h2>안전 · 품질 점검 <span id="sf-y" class="tag"></span></h2></div>
        <div class="panel"><div class="row"><button id="sf-run" class="primary" type="button">점검 시작</button>
          <select id="sf-only" style="width:auto" aria-label="보기"><option value="all">모두 보기</option><option value="err">오류만</option><option value="warn">주의만</option></select>
          <span id="sf-st" class="hint" style="margin:0"></span></div>
          <div id="sf-prog" class="progress" hidden><i id="sf-bar"></i></div>
          <p class="hint">학생 파일을 읽어 글자로만 분석하며 실행하지 않습니다. 확인 항목: 외부 사이트 요청(공개 CDN은 ‘참고’), 파일 크기(${WARN_KB}KB 초과 주의 · 2MB 초과 오류), 빈 파일·잘린 파일, 스크립트 문법 오류. 학교 네트워크가 막는 외부 주소는 작품이 빈 화면이 되는 흔한 원인입니다.</p></div>
        <div class="panel" style="margin-top:18px"><div id="sf-out"></div></div>`;
      $("sf-run").addEventListener("click", run);
      $("sf-only").addEventListener("change", render);
    },
    show() { $("sf-y").textContent = A.year + "학년도"; if (results.length && results[0].s.year !== A.year) results = []; render(); },
  });
})();

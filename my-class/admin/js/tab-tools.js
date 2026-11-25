/* ═══════════════════════════════════════════════════════════════
   탭 7 · 수업 도구 — 수업 체크리스트, 링크 허브, QR 코드 생성
═══════════════════════════════════════════════════════════════ */
"use strict";
(function () {
  const { $, esc } = A;
  const MAX_BYTES = 600;
  const DEFAULT_CHECK = ["학교 폴더(school-…/student)가 만들어져 있다", "학생에게 파일명 규칙(학번4자리 + 이름 - 제목.html)을 안내했다", "제출 점검 탭에서 오류가 0개다", "갤러리 링크·QR을 학생에게 공유했다", "👍 추천이 정상 기록되는지 확인했다", "우수 작품을 추천으로 지정했다"];
  let Y = null, qrData = null;

  /* ── 체크리스트 (이 브라우저에만 저장) ── */
  const ckKey = () => `vc_chk_${A.year}`;
  const ckLoad = () => { const v = A.ls.get(ckKey(), null); return v && Array.isArray(v.items) ? v : { items: DEFAULT_CHECK.map(t => ({ t, d: false })) }; };
  function renderCheck() {
    const c = ckLoad(), n = c.items.filter(i => i.d).length;
    $("tl-chk").innerHTML = `<div class="hint" style="margin:0 0 8px">${n} / ${c.items.length} 완료</div>` + c.items.map((it, i) =>
      `<div class="row" style="gap:8px;margin:4px 0"><label style="display:flex;gap:8px;align-items:center;flex:1;${it.d ? "opacity:.55;text-decoration:line-through" : ""}"><input type="checkbox" data-i="${i}" ${it.d ? "checked" : ""}>${esc(it.t)}</label>
      <button class="sm" data-del="${i}" type="button" aria-label="삭제">✕</button></div>`).join("");
  }
  function chkSave(c) { A.ls.set(ckKey(), c); renderCheck(); }

  /* ── 링크 허브 ── */
  function links() {
    const base = `${A.year}/${A.PAGE}/`;
    const out = [{ g: "갤러리", n: "통합 갤러리", u: A.publicUrl(base) }];
    (Y ? Y.schools : []).forEach(sc => {
      out.push({ g: "학교별", n: `${A.schoolLabel(sc)} 학교만 보기 (?school=)`, u: A.publicUrl(base) + "?school=" + encodeURIComponent(sc) });
      out.push({ g: "학교별", n: `${A.schoolLabel(sc)} 분리 갤러리 (폴더)`, u: A.publicUrl(`${base}${sc}/`) });
    });
    return out;
  }
  function renderLinks() {
    const warn = /^(localhost|127\.|\[::1\])/.test(location.hostname) && !A.ls.get("vc_public_base", "");
    $("tl-warn").innerHTML = warn ? `<p class="status warn">⚠ 지금 localhost 에서 열었습니다. 학생 폰에서는 열리지 않으므로 아래 ‘공개 주소’를 실제 사이트 주소로 설정하세요. (기본값: ${esc(A.publicBase())})</p>` : "";
    $("tl-base").value = A.ls.get("vc_public_base", "");
    $("tl-base").placeholder = A.publicBase();
    $("tl-links").innerHTML = `<div class="tbl-wrap"><table class="tbl"><tbody>${links().map((l, i) => `<tr><td><span class="tag">${l.g}</span></td><td>${esc(l.n)}</td>
      <td class="mono" style="word-break:break-all"><a href="${esc(l.u)}" target="_blank" rel="noopener">${esc(l.u)}</a></td>
      <td style="white-space:nowrap"><button class="sm" data-cp="${i}" type="button">복사</button> <button class="sm" data-qr="${i}" type="button">QR</button></td></tr>`).join("")}</tbody></table></div>`;
  }

  /* ── QR ── */
  function makeQr(url) {
    if (new TextEncoder().encode(url).length > MAX_BYTES) throw new Error(`주소가 너무 깁니다 (${MAX_BYTES}바이트 이하만 지원)`);
    return QR.encode(url, "M");
  }
  function showQr(name, url) {
    try { const q = makeQr(url); qrData = { name, url, q }; $("qr-out").innerHTML = `<div class="row" style="gap:18px;align-items:flex-start"><div class="qr-box">${QR.toSvg(q, 2, "#000", "#fff")}</div>
      <div><b>${esc(name)}</b><div class="mono" style="word-break:break-all;margin:6px 0">${esc(url)}</div>
      <div class="row" style="gap:8px"><button id="qr-png" class="sm" type="button">PNG 저장</button><button id="qr-svg" class="sm" type="button">SVG 저장</button><button id="qr-cp" class="sm" type="button">주소 복사</button></div></div></div>`; }
    catch (e) { qrData = null; $("qr-out").innerHTML = `<p class="status err">${esc(e.message)}</p>`; }
  }
  const safeName = s => String(s).replace(/[^\w가-힣.-]+/g, "_").slice(0, 40) || "qr";
  function dlPng() { const a = document.createElement("a"); a.href = QR.toPng(qrData.q, 10, 4); a.download = safeName(qrData.name) + ".png"; a.click(); }

  function qrTargets() {
    const scope = $("qr-scope").value, base = `${A.year}/${A.PAGE}/`;
    if (scope === "gallery") return [{ name: `${A.year}학년도 갤러리`, url: A.publicUrl(base) }];
    if (scope === "school") return (Y.schools).map(sc => ({ name: `${A.schoolLabel(sc)} 갤러리`, url: A.publicUrl(base) + "?school=" + encodeURIComponent(sc) }));
    if (scope === "students") { const sc = $("qr-school").value; return Y.students.filter(s => s.school === sc).map(s => ({ name: `${s.id} ${s.name || ""}`.trim(), sub: s.title, url: A.publicUrl(s.rel) })); }
    const u = $("qr-url").value.trim(); return u ? [{ name: $("qr-label").value.trim() || "링크", url: u }] : [];
  }
  function syncScope() {
    const s = $("qr-scope").value;
    $("qr-school").hidden = s !== "students"; $("qr-custom").hidden = s !== "custom";
  }
  function preview() {
    const t = qrTargets();
    if (!t.length) { $("qr-out").innerHTML = `<div class="empty">만들 대상이 없습니다.</div>`; qrData = null; return; }
    if (t.length === 1) { showQr(t[0].name, t[0].url); $("qr-sheet-btn").hidden = true; return; }
    qrData = null; $("qr-out").innerHTML = `<p class="hint">${t.length}개의 QR을 만들 수 있습니다. ‘인쇄용 시트 만들기’를 눌러 확인한 뒤 인쇄하세요.</p>`; $("qr-sheet-btn").hidden = false;
  }
  function sheet() {
    const t = qrTargets(), fail = [];
    const cells = t.map(x => { try { return `<div class="qr-cell">${QR.toSvg(makeQr(x.url), 2, "#000", "#fff")}<b>${esc(x.name)}</b>${x.sub ? `<small>${esc(x.sub)}</small>` : ""}</div>`; } catch (e) { fail.push(x.name); return ""; } }).join("");
    $("qr-sheet").innerHTML = cells; $("qr-print").hidden = false;
    A.toast(fail.length ? `${fail.length}개는 주소가 길어 건너뜀` : `${t.length}개의 QR 시트를 만들었습니다`, fail.length ? "err" : "ok");
  }

  A.registerTab({
    id: "tools", icon: "🧰", title: "수업 도구",
    init(p) {
      p.innerHTML = `<div class="pane-head"><h2>수업 도구 <span id="tl-y" class="tag"></span></h2></div>
      <div class="grid2"><div class="panel"><h2>수업 준비 체크리스트</h2><div id="tl-chk"></div>
        <div class="row" style="margin-top:10px"><input id="tl-new" type="text" placeholder="항목 추가" maxlength="80" style="flex:1"><button id="tl-add" class="sm" type="button">추가</button><button id="tl-rst" class="sm" type="button">초기화</button></div>
        <p class="hint">이 브라우저에만 저장되며 연도별로 따로 관리됩니다.</p></div>
      <div class="panel"><h2>공개 주소</h2><div id="tl-warn"></div><label for="tl-base">학생이 접속하는 주소(비우면 자동)</label>
        <div class="row"><input id="tl-base" type="text" style="flex:1" placeholder="https://…/my-class/"><button id="tl-bsave" class="sm" type="button">저장</button></div>
        <p class="hint">QR과 링크는 이 주소를 기준으로 만들어집니다.</p></div></div>
      <div class="panel" style="margin-top:18px"><h2>링크 허브</h2><div id="tl-links"></div></div>
      <div class="panel" style="margin-top:18px"><h2>QR 코드</h2>
        <div class="row" style="margin-bottom:12px"><select id="qr-scope" style="width:auto" aria-label="대상"><option value="gallery">연도 갤러리</option><option value="school">학교별 갤러리</option><option value="students">학생 작품(학교 선택)</option><option value="custom">직접 입력</option></select>
          <select id="qr-school" style="width:auto" hidden aria-label="학교"></select>
          <span id="qr-custom" class="row" hidden><input id="qr-label" type="text" placeholder="이름" style="width:140px"><input id="qr-url" type="text" placeholder="https://…" style="width:300px"></span>
          <button id="qr-make" class="primary" type="button">QR 만들기</button><button id="qr-sheet-btn" type="button" hidden>인쇄용 시트 만들기</button></div>
        <div id="qr-out"><div class="empty">대상을 고르고 ‘QR 만들기’를 누르세요.</div></div>
        <p class="hint">주소가 ${MAX_BYTES}바이트를 넘으면 만들지 않습니다. 인쇄 전 휴대폰으로 한 번 스캔해 보세요.</p></div>
      <div class="panel printable" id="qr-print" hidden style="margin-top:18px"><div class="row noprint"><h2 style="margin:0">인쇄용 QR 시트</h2><button id="qr-doprint" class="primary" type="button" style="margin-left:auto">인쇄</button></div><div id="qr-sheet" class="qr-sheet"></div></div>`;
      p.addEventListener("click", e => {
        const t = e.target.closest("button"); if (!t) return;
        const L = links();
        if (t.dataset.cp != null) A.copy(L[+t.dataset.cp].u);
        else if (t.dataset.qr != null) { $("qr-scope").value = "custom"; syncScope(); $("qr-label").value = L[+t.dataset.qr].n; $("qr-url").value = L[+t.dataset.qr].u; showQr(L[+t.dataset.qr].n, L[+t.dataset.qr].u); $("qr-sheet-btn").hidden = true; }
        else if (t.id === "qr-png" && qrData) dlPng();
        else if (t.id === "qr-svg" && qrData) A.download(safeName(qrData.name) + ".svg", QR.toSvg(qrData.q, 4, "#000", "#fff"), "image/svg+xml");
        else if (t.id === "qr-cp" && qrData) A.copy(qrData.url);
      });
      $("tl-chk").addEventListener("input", e => { const i = e.target.dataset.i; if (i == null) return; const c = ckLoad(); c.items[+i].d = e.target.checked; chkSave(c); });
      $("tl-chk").addEventListener("click", e => { const b = e.target.closest("[data-del]"); if (!b) return; const c = ckLoad(); c.items.splice(+b.dataset.del, 1); chkSave(c); });
      $("tl-add").addEventListener("click", () => { const v = $("tl-new").value.trim(); if (!v) return; const c = ckLoad(); c.items.push({ t: v, d: false }); $("tl-new").value = ""; chkSave(c); });
      $("tl-rst").addEventListener("click", () => { if (confirm("체크리스트를 처음 상태로 되돌릴까요?")) { A.ls.set(ckKey(), null); renderCheck(); } });
      $("tl-bsave").addEventListener("click", () => { const v = $("tl-base").value.trim(); if (v && !/^https?:\/\//i.test(v)) return A.toast("http:// 또는 https:// 로 시작해야 합니다", "err"); A.ls.set("vc_public_base", v); renderLinks(); A.toast("저장했습니다", "ok"); });
      $("qr-scope").addEventListener("change", () => { syncScope(); $("qr-print").hidden = true; });
      $("qr-make").addEventListener("click", preview);
      $("qr-sheet-btn").addEventListener("click", sheet);
      $("qr-doprint").addEventListener("click", () => window.print());
    },
    async show() {
      $("tl-y").textContent = A.year + "학년도";
      Y = await A.loadYear(A.year);
      $("qr-school").innerHTML = Y.schools.map(s => `<option value="${esc(s)}">${esc(A.schoolLabel(s))}</option>`).join("");
      $("qr-print").hidden = true; qrData = null; $("qr-out").innerHTML = `<div class="empty">대상을 고르고 ‘QR 만들기’를 누르세요.</div>`;
      syncScope(); renderCheck(); renderLinks();
    },
  });
})();

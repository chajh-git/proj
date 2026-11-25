/* ═══════════════════════════════════════════════════════════════
   탭 5 · 통계 — 👍 추천 순위, 학교별 비교, 이상치 탐지 (Supabase 읽기 전용)
═══════════════════════════════════════════════════════════════ */
"use strict";
(function () {
  const { $, esc } = A;
  let Y = null, S = null, rows = [], asTable = false;

  const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  const fmt = n => Number(n).toLocaleString("ko-KR");
  const sCls = (sc, all) => { const i = all.indexOf(sc); return i >= 0 && i < 3 ? `s-${i}` : "s-x"; };
  const lab = r => `${r.s.id || "?"} ${r.s.title}`;

  function bars(list, schools) {
    if (!list.length) return `<div class="empty">아직 👍 기록이 없습니다.</div>`;
    const max = Math.max(...list.map(r => r.n), 1);
    if (asTable) return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>작품</th><th>학교</th><th class="num">👍</th></tr></thead><tbody>${
      list.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(lab(r))}</td><td>${esc(A.schoolLabel(r.s.school))}</td><td class="num">${fmt(r.n)}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="chart" role="img" aria-label="👍 순위 막대 차트">${list.map(r => `<div class="brow" title="${esc(A.schoolLabel(r.s.school) + " · " + lab(r))}">
      <span class="blab">${esc(lab(r))}</span><span class="btrack"><span class="bar ${sCls(r.s.school, schools)}" style="display:block;width:${(r.n / max * 100).toFixed(1)}%"></span></span>
      <span class="bval">${fmt(r.n)}</span></div>`).join("")}</div>`;
  }

  function render() {
    if (!S.ok) { $("st-body").innerHTML = `<p class="status err">👍 기록을 불러오지 못했습니다 (${esc(S.error || "")}). 네트워크나 Supabase 설정을 확인하세요.</p>`; return; }
    rows = Y.students.map(s => ({ s, n: S.thumbs[s.key] || 0 }));
    const schools = Y.schools, total = rows.reduce((a, r) => a + r.n, 0), got = rows.filter(r => r.n > 0).length;
    const kp = `<div class="kpis"><div class="kpi"><b>${fmt(total)}</b><span>총 👍</span></div><div class="kpi"><b>${got} / ${rows.length}</b><span>👍를 받은 작품</span></div>
      <div class="kpi"><b>${rows.length ? (total / rows.length).toFixed(1) : "—"}</b><span>작품당 평균 👍</span></div><div class="kpi"><b>${rows.length}</b><span>학생 작품</span></div></div>`;
    const legend = `<div class="legend">${schools.map(sc => `<span><i class="${sCls(sc, schools)}"></i>${esc(A.schoolLabel(sc))}</span>`).join("")}</div>`;
    const top = rows.filter(r => r.n > 0).sort((a, b) => b.n - a.n || A.cmp(a.s.title, b.s.title)).slice(0, 10);
    const per = schools.map(sc => { const rs = rows.filter(r => r.s.school === sc), t = rs.reduce((a, r) => a + r.n, 0); return { sc, n: rs.length, t, avg: rs.length ? t / rs.length : 0 }; });
    const cmp = (title, key, f) => `<div><h3>${title}</h3>` + (asTable
      ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>학교</th><th class="num">👍</th></tr></thead><tbody>${per.map(p => `<tr><td>${esc(A.schoolLabel(p.sc))}</td><td class="num">${f(p[key])}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="chart">${per.map(p => { const mx = Math.max(...per.map(q => q[key]), 1); return `<div class="brow"><span class="blab">${esc(A.schoolLabel(p.sc))}</span><span class="btrack"><span class="bar ${sCls(p.sc, schools)}" style="display:block;width:${(p[key] / mx * 100).toFixed(1)}%"></span></span><span class="bval">${f(p[key])}</span></div>`; }).join("")}</div>`) + `</div>`;
    const out = [], v = rows.map(r => r.n).filter(x => x > 0);
    if (v.length >= 5) { const m = median(v), mad = median(v.map(x => Math.abs(x - m))) || 1; rows.filter(r => r.n > m + 6 * 1.4826 * mad && r.n > m * 3).forEach(r => out.push({ r, why: `👍 ${fmt(r.n)}개 — 중앙값(${fmt(m)})보다 훨씬 많음 (반복 클릭·여러 기기 사용 가능성)` })); }
    const orphan = Object.keys(S.thumbs).filter(k => !new Set(Y.students.map(s => s.key)).has(k));
    const anHtml = (out.length || orphan.length) ? `<div class="tbl-wrap"><table class="tbl"><tbody>${out.map(a => `<tr><td>⚠</td><td>${esc(A.schoolLabel(a.r.s.school))} · ${esc(lab(a.r))}</td><td>${esc(a.why)}</td></tr>`).join("")}${
      orphan.length ? `<tr><td>ℹ</td><td colspan="2">현재 작품 목록에 없는 기록 ${orphan.length}건 (삭제·이름 변경된 작품)</td></tr>` : ""}</tbody></table></div>` : `<p class="status ok">✔ 눈에 띄는 이상치가 없습니다.</p>`;
    const zero = rows.filter(r => r.n === 0);
    $("st-body").innerHTML = `${kp}
      <div class="row" style="margin:14px 0 8px">${schools.length > 1 ? legend : ""}<button id="st-toggle" class="sm" type="button" style="margin-left:auto">${asTable ? "차트로 보기" : "표로 보기"}</button></div>
      <div class="panel"><h2>👍 TOP 10</h2>${bars(top, schools)}</div>
      <div class="panel" style="margin-top:18px"><h2>학교별 비교</h2>${schools.length < 2 ? `<p class="hint">학교가 하나뿐이라 비교는 생략합니다.</p>` : ""}
        <div class="grid2">${cmp("학교별 👍 합계", "t", x => fmt(x))}${cmp("작품 1개당 평균 👍", "avg", x => x.toFixed(1))}</div></div>
      <div class="panel" style="margin-top:18px"><h2>이상치 점검</h2>${anHtml}
        <p class="hint">${zero.length ? `아직 👍가 없는 작품 ${zero.length}개: ${esc(zero.slice(0, 8).map(r => r.s.id || r.s.file).join(", "))}${zero.length > 8 ? " …" : ""}` : ""}</p></div>`;
    $("st-toggle").addEventListener("click", () => { asTable = !asTable; render(); });
  }

  async function load() {
    $("st-y").textContent = A.year + "학년도";
    $("st-body").innerHTML = `<div class="empty">불러오는 중…</div>`;
    Y = await A.loadYear(A.year);
    S = await A.loadStats(A.year);
    render();
  }

  A.registerTab({
    id: "stats", icon: "👍", title: "통계",
    init(p) {
      p.innerHTML = `<div class="pane-head"><h2>👍 추천 통계 <span id="st-y" class="tag"></span></h2>
        <button id="st-reload" class="sm" type="button">↻ 다시 불러오기</button></div>
        <p class="hint">읽기 전용입니다. 2026학년도는 파일명, 2027학년도부터는 전체 경로로 기록을 맞춥니다.</p><div id="st-body"><div class="empty">불러오는 중…</div></div>`;
      $("st-reload").addEventListener("click", () => { A.statsCache = {}; load(); });
    },
    show: load,
  });
})();

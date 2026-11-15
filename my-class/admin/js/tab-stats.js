/* ═══════════════════════════════════════════════════════════════
   탭 5 · 통계 — 조회수·별점 순위, 학교별 비교, 이상치 탐지 (Supabase 읽기 전용)
═══════════════════════════════════════════════════════════════ */
"use strict";
(function () {
  const { $, esc } = A;
  let Y = null, S = null, rows = [], asTable = false;

  const median = a => { const s = a.slice().sort((x, y) => x - y), n = s.length; return n ? (n % 2 ? s[(n - 1) / 2] : (s[n / 2 - 1] + s[n / 2]) / 2) : 0; };
  const fmt = n => Number(n).toLocaleString("ko-KR");
  const avg = r => (r.cnt ? r.sum / r.cnt : 0);
  const sCls = (sc, all) => { const i = all.indexOf(sc); return i >= 0 && i < 3 ? `s-${i}` : "s-x"; };

  function build() {
    rows = Y.students.map(s => {
      const r = S.ratings[s.key] || { sum: 0, cnt: 0 };
      return { s, views: S.views[s.key] || 0, avg: avg(r), cnt: r.cnt, sum: r.sum };
    });
  }

  function bars(list, val, label, schools, unit) {
    if (!list.length) return `<div class="empty">데이터가 없습니다.</div>`;
    const max = Math.max(...list.map(val), 1);
    if (asTable) return `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>#</th><th>작품</th><th>학교</th><th class="num">${unit}</th></tr></thead><tbody>${
      list.map((r, i) => `<tr><td>${i + 1}</td><td>${esc(label(r))}</td><td>${esc(A.schoolLabel(r.s.school))}</td><td class="num">${esc(String(Math.round(val(r) * 100) / 100))}</td></tr>`).join("")}</tbody></table></div>`;
    return `<div class="chart" role="img" aria-label="${esc(unit)} 순위 막대 차트">${list.map(r => `<div class="brow" title="${esc(A.schoolLabel(r.s.school) + " · " + label(r))}">
      <span class="blab">${esc(label(r))}</span><span class="btrack"><span class="bar ${sCls(r.s.school, schools)}" style="display:block;width:${(val(r) / max * 100).toFixed(1)}%"></span></span>
      <span class="bval">${Math.round(val(r) * 100) / 100}</span></div>`).join("")}</div>`;
  }
  const lab = r => `${r.s.id || "?"} ${r.s.title}`;

  function anomalies() {
    const out = [];
    const v = rows.map(r => r.views).filter(x => x > 0);
    if (v.length >= 5) {
      const m = median(v), mad = median(v.map(x => Math.abs(x - m))) || 1;
      rows.filter(r => r.views > m + 6 * 1.4826 * mad && r.views > m * 3).forEach(r => out.push({ sev: "warn", r, why: `조회수 ${fmt(r.views)} — 중앙값(${fmt(m)})보다 훨씬 많음 (새로고침 반복 가능성)` }));
    }
    rows.filter(r => r.cnt >= 3 && r.avg === 5 && r.cnt === r.cnt).forEach(r => out.push({ sev: "warn", r, why: `별점 ${r.cnt}개가 모두 5.0 — 자기 평가 가능성` }));
    rows.filter(r => r.cnt > 0 && r.views > 0 && r.cnt > r.views).forEach(r => out.push({ sev: "err", r, why: `별점 수(${r.cnt})가 조회수(${r.views})보다 많음 — 비정상` }));
    rows.filter(r => r.views === 0 && r.cnt === 0).forEach(r => out.push({ sev: "info", r, why: "조회수·별점 기록 없음 (아직 아무도 보지 않음)" }));
    const known = new Set(Y.students.map(s => s.key));
    const orphan = Object.keys(S.views).filter(k => !known.has(k));
    return { list: out, orphan };
  }

  function render() {
    if (!S.ok) { $("st-body").innerHTML = `<p class="status err">조회수를 불러오지 못했습니다 (${esc(S.error || "")}). 네트워크나 Supabase 설정을 확인하세요.</p>`; return; }
    build();
    const schools = Y.schools;
    const totalV = rows.reduce((a, r) => a + r.views, 0), totalC = rows.reduce((a, r) => a + r.cnt, 0), totalS = rows.reduce((a, r) => a + r.sum, 0);
    const kp = `<div class="kpis"><div class="kpi"><b>${fmt(totalV)}</b><span>총 조회수</span></div><div class="kpi"><b>${fmt(totalC)}</b><span>총 별점 수</span></div>
      <div class="kpi"><b>${totalC ? (totalS / totalC).toFixed(2) : "—"}</b><span>전체 평균 별점</span></div><div class="kpi"><b>${Y.students.length}</b><span>학생 작품</span></div></div>`;
    const legend = `<div class="legend">${schools.map((sc, i) => `<span><i class="${sCls(sc, schools)}"></i>${esc(A.schoolLabel(sc))}</span>`).join("")}</div>`;
    const topV = rows.slice().sort((a, b) => b.views - a.views).slice(0, 10).filter(r => r.views > 0);
    const topR = rows.filter(r => r.cnt >= 2).sort((a, b) => b.avg - a.avg || b.cnt - a.cnt).slice(0, 10);
    const per = schools.map(sc => {
      const rs = rows.filter(r => r.s.school === sc), c = rs.reduce((a, r) => a + r.cnt, 0), su = rs.reduce((a, r) => a + r.sum, 0), v = rs.reduce((a, r) => a + r.views, 0);
      return { sc, n: rs.length, v, c, a: c ? su / c : 0, vp: rs.length ? v / rs.length : 0 };
    });
    const cmp = (title, key, unit, f) => `<div><h3>${title}</h3>` + (asTable
      ? `<div class="tbl-wrap"><table class="tbl"><thead><tr><th>학교</th><th class="num">${unit}</th></tr></thead><tbody>${per.map(p => `<tr><td>${esc(A.schoolLabel(p.sc))}</td><td class="num">${f(p[key])}</td></tr>`).join("")}</tbody></table></div>`
      : `<div class="chart">${per.map(p => { const mx = Math.max(...per.map(q => q[key]), 1); return `<div class="brow"><span class="blab">${esc(A.schoolLabel(p.sc))}</span><span class="btrack"><span class="bar ${sCls(p.sc, schools)}" style="display:block;width:${(p[key] / mx * 100).toFixed(1)}%"></span></span><span class="bval">${f(p[key])}</span></div>`; }).join("")}</div>`) + `</div>`;
    const an = anomalies();
    const ico = { err: "⛔", warn: "⚠", info: "ℹ" };
    const anHtml = (an.list.filter(a => a.sev !== "info").length || an.orphan.length)
      ? `<div class="tbl-wrap"><table class="tbl"><tbody>${an.list.filter(a => a.sev !== "info").map(a => `<tr><td>${ico[a.sev]}</td><td>${esc(A.schoolLabel(a.r.s.school))} · ${esc(lab(a.r))}</td><td>${esc(a.why)}</td></tr>`).join("")}${
        an.orphan.length ? `<tr><td>ℹ</td><td colspan="2">현재 작품 목록에 없는 기록 ${an.orphan.length}건 (삭제·이름 변경된 작품의 조회수)</td></tr>` : ""}</tbody></table></div>`
      : `<p class="status ok">✔ 눈에 띄는 이상치가 없습니다.</p>`;
    const zero = an.list.filter(a => a.sev === "info");
    $("st-body").innerHTML = `${kp}
      <div class="row" style="margin:14px 0 8px">${schools.length > 1 ? legend : ""}<button id="st-toggle" class="sm" type="button" style="margin-left:auto">${asTable ? "차트로 보기" : "표로 보기"}</button></div>
      <div class="grid2"><div class="panel"><h2>조회수 TOP 10</h2>${bars(topV, r => r.views, lab, schools, "조회수")}</div>
        <div class="panel"><h2>평균 별점 TOP 10 <small style="color:var(--muted);font-weight:400">(별점 2개 이상)</small></h2>${bars(topR, r => r.avg, lab, schools, "평균 별점")}</div></div>
      <div class="panel" style="margin-top:18px"><h2>학교별 비교</h2>${schools.length < 2 ? `<p class="hint">학교가 하나뿐이라 비교는 생략합니다.</p>` : ""}
        <div class="grid2">${cmp("작품 1개당 평균 조회수", "vp", "평균 조회수", x => x.toFixed(1))}${cmp("평균 별점", "a", "평균 별점", x => x ? x.toFixed(2) : "—")}</div></div>
      <div class="panel" style="margin-top:18px"><h2>이상치 점검</h2>${anHtml}
        <p class="hint">${zero.length ? `아직 기록이 전혀 없는 작품 ${zero.length}개: ${esc(zero.slice(0, 8).map(a => a.r.s.id || a.r.s.file).join(", "))}${zero.length > 8 ? " …" : ""}` : ""}${S.ratingsOk ? "" : " · 별점 표를 읽지 못해 별점 통계는 비어 있습니다."}</p></div>`;
    $("st-toggle").addEventListener("click", () => { asTable = !asTable; render(); });
  }

  A.registerTab({
    id: "stats", icon: "📈", title: "통계",
    init(p) {
      p.innerHTML = `<div class="pane-head"><h2>조회수 · 별점 통계 <span id="st-y" class="tag"></span></h2>
        <button id="st-reload" class="sm" type="button">↻ 다시 불러오기</button></div>
        <p class="hint">읽기 전용입니다. 2026학년도는 파일명, 2027학년도부터는 전체 경로로 기록을 맞춥니다.</p><div id="st-body"><div class="empty">불러오는 중…</div></div>`;
      $("st-reload").addEventListener("click", () => { A.statsCache = {}; this_show(); });
    },
    show() { return this_show(); },
  });
  async function this_show() {
    $("st-y").textContent = A.year + "학년도";
    $("st-body").innerHTML = `<div class="empty">불러오는 중…</div>`;
    Y = await A.loadYear(A.year);
    S = await A.loadStats(A.year);
    render();
  }
})();

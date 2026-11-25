/* ═══════════════════════════════════════════════════════════════
   관리자 공통 코드 — 설정 · GitHub API · 데이터 불러오기 · 탭 프레임워크
   · 읽기는 대부분 같은 사이트의 정적 파일(files.json, theme.json …)에서 하므로 토큰이 없어도 됩니다.
   · 저장(curation.json, theme.json, projects.json, 새 폴더 만들기)에만 GitHub 토큰이 필요합니다.
═══════════════════════════════════════════════════════════════ */
"use strict";
(function () {
  const A = (window.A = {});

  /* ═══ 설정 ═══ */
  A.OWNER = "chajh-git";
  A.REPO = "proj";
  A.BRANCH = "main";
  A.BASE = "my-class";                       // 저장소 안의 폴더
  A.PAGE = "vibe-coding";                    // 연도 폴더 안의 기본 수업 페이지 폴더
  A.FALLBACK_YEARS = ["2026", "2027"];
  A.LEGACY_YEARS = new Set(["2026"]);        // 👍 키가 '파일명만'인 예전 방식 연도
  A.SB_URL = "https://uzkicgzshaxsjsmjznhl.supabase.co/rest/v1/";
  A.SB_KEY = "sb_publishable_0mL1dcNMbKGSaDgi66mvLA_tuVftomj";   // 갤러리와 같은 공개(읽기용) 키

  /* ═══ 작은 도구 ═══ */
  A.$ = id => document.getElementById(id);
  A.esc = s => String(s).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
  A.clone = o => JSON.parse(JSON.stringify(o));
  A.cmp = (a, b) => String(a).localeCompare(String(b), "ko", { numeric: true });
  A.schoolLabel = code => String(code).replace(/^school-/i, "").toUpperCase();
  A.say = (el, msg, kind) => { el.textContent = msg; el.className = "status" + (kind ? " " + kind : ""); };
  A.debounce = (fn, ms) => { let t = 0; return (...a) => { clearTimeout(t); t = setTimeout(() => fn(...a), ms); }; };
  A.ls = {
    get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
    set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} },
  };
  A.toast = (msg, kind) => {
    const box = A.$("toast"), d = document.createElement("div");
    d.textContent = msg; if (kind) d.className = kind;
    box.appendChild(d);
    setTimeout(() => d.remove(), kind === "err" ? 7000 : 3800);
  };
  A.ago = iso => {
    const t = new Date(iso).getTime();
    if (!t) return "";
    const s = Math.max(0, (Date.now() - t) / 1000);
    if (s < 90) return "방금 전";
    if (s < 3600) return Math.round(s / 60) + "분 전";
    if (s < 86400) return Math.round(s / 3600) + "시간 전";
    if (s < 86400 * 45) return Math.round(s / 86400) + "일 전";
    return new Date(t).toLocaleDateString("ko-KR");
  };
  A.fmtTime = iso => { const d = new Date(iso); return isNaN(d) ? "" : `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`; };
  A.download = (name, text, type) => {
    const blob = new Blob([text], { type: type || "text/plain;charset=utf-8" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = name; document.body.appendChild(a); a.click();
    setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 500);
  };
  A.copy = async text => {
    try { await navigator.clipboard.writeText(text); A.toast("복사했습니다", "ok"); }
    catch {
      const ta = document.createElement("textarea"); ta.value = text; document.body.appendChild(ta); ta.select();
      try { document.execCommand("copy"); A.toast("복사했습니다", "ok"); } catch { A.toast("복사하지 못했습니다. 직접 선택해 복사해 주세요.", "err"); }
      ta.remove();
    }
  };
  /* 비동기 작업을 n개씩 동시에 */
  A.pool = async (items, n, worker) => {
    let i = 0;
    const run = async () => { while (i < items.length) { const k = i++; await worker(items[k], k); } };
    await Promise.all(Array.from({ length: Math.min(n, items.length) }, run));
  };

  /* ═══ GitHub 연결 ═══ */
  A.connected = false;
  A.token = () => (A.$("token") ? A.$("token").value.replace(/[^\x21-\x7e]/g, "") : "");
  A.api = path => `https://api.github.com/repos/${A.OWNER}/${A.REPO}/${path}`;
  A.headers = () => { const h = { Accept: "application/vnd.github+json" }; const t = A.token(); if (t) h.Authorization = "Bearer " + t; return h; };
  A.requireWrite = () => {
    if (A.connected) return true;
    A.toast("저장하려면 먼저 위쪽 '연결' 버튼에서 GitHub 토큰을 연결하세요.", "warn");
    const p = A.$("conn-panel"); if (p) { p.hidden = false; p.scrollIntoView({ behavior: "smooth" }); }
    return false;
  };

  /* ═══ 저장소 파일 읽기 (같은 사이트 → 안 되면 raw.githubusercontent) ═══ */
  A.siteBase = () => new URL("../", location.href).href;                    // …/my-class/
  A.fetchRepo = async (rel, asText) => {
    const urls = [
      A.siteBase() + rel + "?t=" + Date.now(),
      `https://raw.githubusercontent.com/${A.OWNER}/${A.REPO}/${A.BRANCH}/${A.BASE}/${rel.split("/").map(encodeURIComponent).join("/")}?t=${Date.now()}`,
    ];
    for (const u of urls) {
      try {
        const r = await fetch(u, { cache: "no-store" });
        if (r.ok) return asText ? await r.text() : await r.json();
      } catch {}
    }
    return null;
  };

  /* 저장소 전체 파일 목록 (한 번의 API 호출, 3분 캐시) */
  let treeCache = null;
  A.getTree = async force => {
    if (!force && treeCache && Date.now() - treeCache.t < 180000) return treeCache.v;
    const r = await fetch(A.api(`git/trees/${A.BRANCH}?recursive=1`), { headers: A.headers() });
    if (!r.ok) throw new Error(r.status === 403 ? "GitHub 조회 한도를 넘었습니다. 토큰을 연결하면 풀립니다." : "저장소 목록을 불러오지 못했습니다 (" + r.status + ")");
    const j = await r.json();
    const pre = A.BASE + "/";
    const v = (j.tree || []).filter(t => t.path.startsWith(pre)).map(t => ({ path: t.path.slice(pre.length), type: t.type, size: t.size || 0 }));
    A.treeTruncated = !!j.truncated;
    treeCache = { t: Date.now(), v };
    return v;
  };
  A.treeSafe = async force => { try { return await A.getTree(force); } catch (e) { A.treeError = e.message; return null; } };

  /* ═══ 저장 (GitHub Contents API, 충돌 시 재시도) ═══ */
  const shaCache = {};
  const b64 = text => btoa(unescape(encodeURIComponent(text)));
  async function getSha(path) {
    const g = await fetch(A.api(`contents/${path.split("/").map(encodeURIComponent).join("/")}?ref=${A.BRANCH}&_=${Date.now()}`), { headers: A.headers(), cache: "no-store" });
    return g.ok ? (await g.json()).sha : undefined;
  }
  /* rel: my-class 기준 경로. text: 파일 내용(문자열). */
  A.putFile = async (rel, text, message) => {
    const path = `${A.BASE}/${rel}`;
    const content = b64(text);
    let sha = shaCache[path] || await getSha(path);
    let lastMsg = "";
    for (let attempt = 0; attempt < 6; attempt++) {
      const body = { message, content, branch: A.BRANCH };
      if (sha) body.sha = sha;
      const r = await fetch(A.api(`contents/${path.split("/").map(encodeURIComponent).join("/")}`), {
        method: "PUT", headers: { ...A.headers(), "Content-Type": "application/json" }, body: JSON.stringify(body), cache: "no-store",
      });
      const j = await r.json().catch(() => ({}));
      if (r.ok) { if (j.content && j.content.sha) shaCache[path] = j.content.sha; return j; }
      lastMsg = j.message || "";
      if (r.status !== 409 && r.status !== 422) throw new Error(`저장 실패 (${r.status}) ${lastMsg}`);
      const tried = sha;
      await new Promise(res => setTimeout(res, 800 * (attempt + 1)));
      sha = await getSha(path);
      if (sha === tried) { await new Promise(res => setTimeout(res, 1500)); sha = await getSha(path); }
    }
    delete shaCache[path];
    throw new Error(`저장 실패 (409) ${lastMsg}`);
  };

  /* ═══ 연도별 규칙 ═══ */
  A.isLegacy = y => A.LEGACY_YEARS.has(String(y));
  /* 갤러리(index.html)의 parseStudent 와 같은 규칙 */
  A.parseStudent = (file, school, year) => {
    const legacy = A.isLegacy(year);
    const base = file.replace(/\.html?$/i, "");
    const m = base.match(legacy ? /^n?(\d{2})(\d{2})/i : /^(\d{2})(\d{2})/);
    const cls = m ? m[1] : null, id = m ? m[1] + m[2] : "";
    const rest = m ? (legacy ? base.slice(m[0].length) : base.slice(4)) : base;
    const dash = rest.indexOf(" - ");
    const trim = s => s.replace(/^[\s_\-]+/, "").trim();
    const name = dash !== -1 ? trim(rest.slice(0, dash)) : "";
    const title = dash !== -1 ? rest.slice(dash + 3).trim() : (trim(rest) || base);
    return {
      year: String(year), file, school, cls, id, name, title,
      ck: `${school}/${file}`,                                                                  // 작품 관리(curation.json) 키
      key: legacy ? file : [A.BASE, year, A.PAGE, school, "student", file].join("/"),           // 👍(Supabase) 키
      rel: `${year}/${A.PAGE}/${school}/student/${file}`,
      href: new URL(`../${year}/${A.PAGE}/${school}/student/${encodeURIComponent(file)}`, location.href).href,
    };
  };
  A.pageUrl = (year, proj) => new URL(`../${year}/${proj || A.PAGE}/`, location.href).href;

  A.normCuration = raw => {
    const j = raw && typeof raw === "object" ? raw : {};
    const arr = v => (Array.isArray(v) ? v.filter(x => typeof x === "string") : []);
    const ex = j.examples && typeof j.examples === "object" ? j.examples : {};
    return {
      hidden: arr(j.hidden), featured: arr(j.featured),
      meta: j.meta && typeof j.meta === "object" ? j.meta : {},
      examples: { hidden: arr(ex.hidden), order: arr(ex.order), category: ex.category && typeof ex.category === "object" ? ex.category : {} },
    };
  };

  /* 연도의 수업 페이지 폴더 안 파일들 (sub: 폴더 기준 상대 경로) */
  A.pageFiles = (tree, year, proj) => {
    const pre = `${year}/${proj || A.PAGE}/`;
    return tree.filter(t => t.type === "blob" && t.path.startsWith(pre)).map(t => ({ ...t, sub: t.path.slice(pre.length) }));
  };
  /* 학생 폰에서 열 수 있는 공개 주소 (localhost 에서 열었을 때 QR 이 쓸모없어지는 것을 막음) */
  A.publicBase = () => {
    const saved = A.ls.get("vc_public_base", "");
    if (saved) return saved.replace(/\/?$/, "/");
    return /github\.io$/i.test(location.hostname) ? A.siteBase() : `https://${A.OWNER}.github.io/${A.REPO}/${A.BASE}/`;
  };
  A.publicUrl = rel => A.publicBase() + rel.split("/").map(encodeURIComponent).join("/");

  /* ═══ 연도 데이터 (files.json · meta.json · theme.json · curation.json) ═══ */
  A.cache = {};
  A.loadYear = async (year, force) => {
    year = String(year);
    if (!force && A.cache[year]) return A.cache[year];
    const d = `${year}/${A.PAGE}/`;
    const [manifest, meta, theme, curation] = await Promise.all([
      A.fetchRepo(d + "files.json"), A.fetchRepo(d + "meta.json"), A.fetchRepo(d + "theme.json"), A.fetchRepo(d + "curation.json"),
    ]);
    const ok = manifest && manifest.schools && typeof manifest.schools === "object";
    const mf = ok ? manifest : { examples: [], schools: {} };
    const students = [];
    Object.keys(mf.schools).sort(A.cmp).forEach(school => {
      (mf.schools[school] || []).filter(f => /\.html?$/i.test(f)).forEach(f => students.push(A.parseStudent(f, school, year)));
    });
    const examples = (mf.examples || []).map(e => (typeof e === "string" ? { dir: e, entry: "index.html" } : e)).filter(e => e && e.dir);
    const Y = {
      year, hasManifest: !!ok, manifest: mf, students, examples,
      schools: Object.keys(mf.schools).sort(A.cmp),
      meta: meta && meta.files ? meta.files : null,
      theme: theme || null,
      curation: A.normCuration(curation), curationExists: !!curation,
    };
    A.cache[year] = Y;
    return Y;
  };
  /* 작품 관리 탭과 제출 점검 탭이 함께 쓰는 '편집 중인' 큐레이션 */
  A.curDraft = {};
  A.getCur = year => (A.curDraft[year] = A.curDraft[year] || A.clone(A.cache[year].curation));
  A.timeOf = (Y, s) => (Y.meta && Y.meta[`${s.school}/student/${s.file}`]) || "";

  /* ═══ Supabase (👍 추천 수) ═══ */
  async function sb(path, opts = {}) {
    const res = await fetch(A.SB_URL + path, { ...opts, headers: { apikey: A.SB_KEY, Authorization: "Bearer " + A.SB_KEY, "Content-Type": "application/json", ...(opts.headers || {}) } });
    if (!res.ok && res.status !== 404) throw new Error("Supabase " + res.status);
    return res.status === 204 ? null : res.json();
  }
  A.sbAll = async path => {
    const out = [];
    for (let from = 0; ; from += 1000) {
      const rows = await sb(path, { headers: { Range: `${from}-${from + 999}` } });
      out.push(...(rows || []));
      if (!rows || rows.length < 1000) break;
    }
    return out;
  };
  A.statsCache = {};
  A.loadStats = async (year, force) => {
    year = String(year);
    if (!force && A.statsCache[year]) return A.statsCache[year];
    const filter = A.isLegacy(year) ? "" : `&file=like.${encodeURIComponent(`${A.BASE}/${year}/${A.PAGE}`)}/*`;
    const out = { thumbs: {}, ok: true };
    try { (await A.sbAll(`thumbsups?select=file,thumbs${filter}`)).forEach(r => { out.thumbs[r.file] = r.thumbs; }); } catch (e) { out.ok = false; out.error = e.message; }
    A.statsCache[year] = out;
    return out;
  };

  /* ═══ 탭 프레임워크 ═══ */
  A.tabs = [];
  A.registerTab = def => A.tabs.push(def);
  A.year = null; A.years = [];
  const inited = new Set();
  A.currentTab = null;
  A.showTab = id => {
    const def = A.tabs.find(t => t.id === id) || A.tabs[0];
    A.currentTab = def.id;
    document.querySelectorAll("#tabs button").forEach(b => b.setAttribute("aria-selected", String(b.dataset.id === def.id)));
    document.querySelectorAll(".pane").forEach(p => { p.hidden = p.id !== "pane-" + def.id; });
    const pane = A.$("pane-" + def.id);
    if (!inited.has(def.id)) { inited.add(def.id); def.init && def.init(pane); }
    def.show && def.show(pane);
    if (location.hash !== "#" + def.id) history.replaceState(null, "", "#" + def.id);
  };
  A.refreshCurrent = () => { const def = A.tabs.find(t => t.id === A.currentTab); if (def && def.show) def.show(A.$("pane-" + def.id)); };

  A.setYear = y => {
    A.year = String(y);
    A.$("year-sel").value = A.year;
    A.refreshCurrent();
  };

  /* ═══ GitHub 토큰 UI ═══ */
  function initConnection() {
    try { const saved = localStorage.getItem("vc_admin_token"); if (saved) { A.$("token").value = saved; A.$("remember").checked = true; } } catch {}
    const persist = () => {
      try {
        if (A.$("remember").checked && A.$("token").value.trim()) localStorage.setItem("vc_admin_token", A.$("token").value.trim());
        else localStorage.removeItem("vc_admin_token");
      } catch {}
    };
    A.$("remember").addEventListener("change", persist);
    A.$("token").addEventListener("change", persist);
    A.$("conn-chip").addEventListener("click", () => { A.$("conn-panel").hidden = !A.$("conn-panel").hidden; });
    const check = async quiet => {
      persist();
      if (!A.token()) { if (!quiet) A.say(A.$("st-conn"), "토큰을 먼저 붙여넣어 주세요.", "warn"); return; }
      A.say(A.$("st-conn"), "확인하는 중…");
      try {
        const r = await fetch(A.api("").replace(/\/$/, ""), { headers: A.headers() });
        if (!r.ok) throw new Error(r.status === 401 ? "토큰이 올바르지 않거나 만료되었습니다." : r.status === 404 ? "저장소에 접근할 수 없습니다. 토큰의 저장소 선택을 확인하세요." : "오류 " + r.status);
        const j = await r.json();
        if (!j.permissions || !j.permissions.push) throw new Error("읽기만 가능합니다. 토큰에 Contents: Read and write 권한이 필요합니다.");
        A.connected = true;
        A.say(A.$("st-conn"), `연결됨: ${j.full_name} (쓰기 가능)`, "ok");
        A.$("conn-chip").textContent = "🔓 연결됨"; A.$("conn-chip").classList.add("on");
        document.dispatchEvent(new CustomEvent("vc-connected"));
      } catch (e) {
        A.connected = false;
        A.$("conn-chip").textContent = "🔒 연결 안 됨"; A.$("conn-chip").classList.remove("on");
        A.say(A.$("st-conn"), e instanceof TypeError ? "GitHub 서버(api.github.com)에 연결하지 못했습니다. 학교·회사 네트워크나 광고 차단 확장 프로그램이 막고 있을 수 있습니다. 집 와이파이나 휴대폰 데이터로 다시 시도해 보세요." : e.message, "err");
      }
    };
    A.$("btn-check").addEventListener("click", () => check(false));
    if (A.token()) check(true);
  }

  /* ═══ 시작 ═══ */
  A.start = async () => {
    initConnection();
    const nav = A.$("tabs"), panes = A.$("panes");
    A.tabs.forEach(t => {
      const b = document.createElement("button");
      b.type = "button"; b.dataset.id = t.id; b.setAttribute("role", "tab"); b.textContent = `${t.icon} ${t.title}`;
      b.addEventListener("click", () => A.showTab(t.id));
      nav.appendChild(b);
      const p = document.createElement("section");
      p.className = "pane"; p.id = "pane-" + t.id; p.hidden = true; p.setAttribute("role", "tabpanel");
      panes.appendChild(p);
    });

    /* 연도 목록: 저장소 목록에서 찾고, 안 되면 기본값 */
    let list = [];
    const tree = await A.treeSafe();
    if (tree) {
      const withPage = new Set(tree.filter(t => t.type === "tree" && /^\d{4}\/[^/]+$/.test(t.path)).map(t => t.path));
      list = [...new Set(tree.filter(t => /^\d{4}$/.test(t.path) && t.type === "tree").map(t => t.path))].filter(y => withPage.has(`${y}/${A.PAGE}`));
    }
    A.years = (list.length ? list : A.FALLBACK_YEARS).sort();
    A.$("year-sel").innerHTML = A.years.map(y => `<option value="${y}">${y}학년도</option>`).join("");
    A.year = A.years[A.years.length - 1];
    A.$("year-sel").value = A.year;
    A.$("year-sel").addEventListener("change", () => A.setYear(A.$("year-sel").value));
    A.$("btn-reload").addEventListener("click", async () => {
      A.cache = {}; A.statsCache = {};
      await A.treeSafe(true);
      A.toast("다시 불러옵니다", "ok");
      A.refreshCurrent();
    });
    window.addEventListener("hashchange", () => A.showTab(location.hash.slice(1)));
    A.showTab(location.hash.slice(1) || A.tabs[0].id);
  };
})();

/* ═══════════════════════════════════════════════════════════════
   AI 바이브 랩 : 창작 전시관 — 디자인 옵션 로더
   · 수업 페이지(vibe-coding/index.html)가 불러 씁니다.
   · 설정은 각 연도 vibe-coding/theme.json 에 저장되고 admin 페이지에서 바꿉니다.
       {
         "theme":  "holo",        // default | neon | bento | brutal | clay | editorial | holo | gallery | blueprint | aurora
         "card":   "frame",       // default | frame      (전시 액자 카드)
         "hover":  "glow",        // default | glow | spotlight | tilt | none
         "font":   "lab",         // auto | lab | orbit | mono
         "motion": { "title": "typing",   // off | typing | glitch
                     "stars": true, "fadeup": true, "btn": true }
       }
   · 주소 끝에 ?theme=holo&card=frame&hover=glow&font=lab&motion=title:typing,stars,fadeup,btn
     을 붙이면 저장하지 않고 미리보기만 됩니다. (motion= 만 쓰면 모션 모두 끔)
   · 값이 없거나 잘못되면 기존 디자인 그대로입니다.
   · 운영체제의 '동작 줄이기' 설정이 켜져 있으면 모션은 자동으로 꺼집니다.
═══════════════════════════════════════════════════════════════ */
(function () {
  "use strict";

  const THEMES = ["neon", "bento", "brutal", "clay", "editorial", "holo", "gallery", "blueprint", "aurora"];
  const CARDS  = ["default", "frame"];
  const HOVERS = ["default", "glow", "spotlight", "tilt", "none"];
  const FONTS  = ["auto", "lab", "orbit", "mono"];
  const TITLES = ["off", "typing", "glitch"];

  const PRETENDARD = "https://cdn.jsdelivr.net/gh/orioncactus/pretendard@v1.3.9/dist/web/variable/pretendardvariable-dynamic-subset.min.css";
  const FONT_LINKS = {
    lab:   ["https://fonts.googleapis.com/css2?family=Space+Grotesk:wght@500;700&family=JetBrains+Mono:wght@400;700&display=swap", PRETENDARD],
    orbit: ["https://fonts.googleapis.com/css2?family=Orbitron:wght@600;800&family=JetBrains+Mono:wght@400;700&display=swap", PRETENDARD],
    mono:  ["https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;700;800&display=swap", PRETENDARD],
  };

  const root = document.documentElement;
  const reduced = () => !!(window.matchMedia && matchMedia("(prefers-reduced-motion: reduce)").matches);
  const pick = (v, list, dflt) => (list.includes(v) ? v : dflt);

  let assetsDir = "";
  let current = null;

  /* ── 설정 정리 ── */
  function normalize(raw) {
    const r = raw && typeof raw === "object" ? raw : {};
    const m = r.motion && typeof r.motion === "object" ? r.motion : {};
    return {
      theme:  THEMES.includes(r.theme) ? r.theme : "default",
      card:   pick(r.card, CARDS, "default"),
      hover:  pick(r.hover, HOVERS, "default"),
      font:   pick(r.font, FONTS, "auto"),
      motion: {
        title:  pick(m.title, TITLES, "off"),
        stars:  m.stars === true,
        fadeup: m.fadeup === true,
        btn:    m.btn === true,
      },
    };
  }

  function parseMotion(str) {
    const out = { title: "off", stars: false, fadeup: false, btn: false };
    String(str || "").split(",").forEach(tok => {
      const [k, v] = tok.trim().split(":");
      if (k === "title") out.title = pick(v, TITLES, "off");
      else if (k === "stars" || k === "fadeup" || k === "btn") out[k] = true;
    });
    return out;
  }

  async function loadConfig(themeUrl) {
    let raw = {};
    try {
      const r = await fetch(themeUrl + "?t=" + Date.now(), { cache: "no-store" });
      if (r.ok) raw = await r.json();
    } catch {}
    const cfg = normalize(raw);
    const q = new URLSearchParams(location.search);
    if (q.has("theme")) cfg.theme = THEMES.includes(q.get("theme")) ? q.get("theme") : "default";
    if (q.has("card"))  cfg.card  = pick(q.get("card"), CARDS, "default");
    if (q.has("hover")) cfg.hover = pick(q.get("hover"), HOVERS, "default");
    if (q.has("font"))  cfg.font  = pick(q.get("font"), FONTS, "auto");
    if (q.has("motion")) cfg.motion = parseMotion(q.get("motion"));
    return cfg;
  }

  /* ── 스타일시트 불러오기 (한 번만) ── */
  function loadCss(href, id, beforeId) {
    return new Promise(done => {
      const old = document.getElementById(id);
      if (old) { done(); return; }
      const l = document.createElement("link");
      l.rel = "stylesheet"; l.href = href; l.id = id;
      l.onload = l.onerror = () => done();
      /* 테마 CSS는 항상 공통 옵션 CSS보다 앞에 두어, 옵션(액자·호버 등)이 테마를 덮어쓰게 함 */
      const ref = beforeId ? document.getElementById(beforeId) : null;
      if (ref) document.head.insertBefore(l, ref); else document.head.appendChild(l);
      setTimeout(done, 2500);
    });
  }

  function setAttr(name, value) {
    if (value === null || value === undefined || value === false) root.removeAttribute(name);
    else root.setAttribute(name, value === true ? "1" : value);
  }

  /* ═══ 타이틀 등장 (타이핑 / 글리치) ═══ */
  let typingTimer = 0, glitchTimer = 0;
  function playTitle(mode) {
    const el = document.querySelector(".title-main");
    if (!el) return;
    clearInterval(typingTimer); clearTimeout(glitchTimer);
    el.classList.remove("fx-glitch");
    el.style.minHeight = "";
    const full = el.dataset.full || (el.dataset.full = el.textContent.trim());
    el.setAttribute("role", "heading"); el.setAttribute("aria-level", "1"); el.setAttribute("aria-label", full);
    el.dataset.text = full;
    el.textContent = full;
    if (mode === "off" || reduced()) return;

    if (mode === "typing") {
      el.style.minHeight = el.offsetHeight + "px";
      const caret = document.createElement("span");
      caret.className = "fx-caret";
      el.textContent = "";
      el.appendChild(caret);
      let i = 0;
      typingTimer = setInterval(() => {
        i++;
        el.textContent = full.slice(0, i);
        el.appendChild(caret);
        if (i >= full.length) {
          clearInterval(typingTimer);
          setTimeout(() => { caret.remove(); el.style.minHeight = ""; }, 1400);
        }
      }, 75);
    } else if (mode === "glitch") {
      void el.offsetWidth;
      el.classList.add("fx-glitch");
      glitchTimer = setTimeout(() => el.classList.remove("fx-glitch"), 1500);
    }
  }

  /* ═══ 배경 별빛 파티클 ═══ */
  let cv = null, raf = 0, starsRun = false;
  function startStars() {
    if (starsRun || reduced()) return;
    starsRun = true;
    cv = document.createElement("canvas");
    cv.className = "fx-stars";
    cv.setAttribute("aria-hidden", "true");
    document.body.prepend(cv);
    const ctx = cv.getContext("2d");
    let w = 0, h = 0, dpr = 1, parts = [], color = "#7fe8ff", lastColor = 0;

    const spawn = () => {
      const n = Math.max(28, Math.min(110, Math.round((w * h) / 20000)));
      parts = Array.from({ length: n }, () => ({
        x: Math.random() * w, y: Math.random() * h,
        r: .5 + Math.random() * 1.5,
        vx: (Math.random() - .5) * .08, vy: -(.02 + Math.random() * .08),
        ph: Math.random() * 6.28, sp: .4 + Math.random() * .9,
      }));
    };
    const resize = () => {
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = window.innerWidth; h = window.innerHeight;
      cv.width = w * dpr; cv.height = h * dpr;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      spawn();
    };
    cv._resize = resize;
    window.addEventListener("resize", resize);
    resize();

    const frame = t => {
      if (!starsRun) return;
      if (t - lastColor > 1500) {
        lastColor = t;
        const c = getComputedStyle(root).getPropertyValue("--accent").trim();
        if (c) color = c;
      }
      ctx.clearRect(0, 0, w, h);
      ctx.fillStyle = color;
      for (const p of parts) {
        p.x += p.vx; p.y += p.vy;
        if (p.y < -4) { p.y = h + 4; p.x = Math.random() * w; }
        if (p.x < -4) p.x = w + 4; else if (p.x > w + 4) p.x = -4;
        ctx.globalAlpha = .18 + .62 * ((Math.sin(t / 1000 * p.sp + p.ph) + 1) / 2);
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, 6.2832); ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(frame);
    };
    raf = requestAnimationFrame(frame);
  }
  function stopStars() {
    starsRun = false;
    cancelAnimationFrame(raf);
    if (cv) { window.removeEventListener("resize", cv._resize); cv.remove(); cv = null; }
  }
  /* 탭이 가려지면 멈추고, 다시 보이면 재시작 (배터리·성능 보호) */
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) stopStars();
    else if (current && current.motion.stars) startStars();
  });

  /* ═══ 카드 페이드업 + 글로우 ═══ */
  let io = null, mo = null;
  const FX_SEL = ".medal-card, .example-item, #app tbody tr";
  function scanFx() {
    let n = 0;
    document.querySelectorAll(FX_SEL).forEach(el => {
      if (el.classList.contains("fx-up")) return;
      el.classList.add("fx-up");
      el.style.setProperty("--fx-d", (n++ % 6) * 70 + "ms");
      io.observe(el);
    });
  }
  function startFadeup() {
    if (io || reduced() || !("IntersectionObserver" in window)) return;
    io = new IntersectionObserver(entries => {
      entries.forEach(e => {
        if (e.isIntersecting) { e.target.classList.add("fx-show"); io.unobserve(e.target); }
      });
    }, { threshold: 0.06, rootMargin: "0px 0px -3% 0px" });
    scanFx();
    mo = new MutationObserver(scanFx);
    mo.observe(document.getElementById("app") || document.body, { childList: true, subtree: true });
  }
  function stopFadeup() {
    if (io) { io.disconnect(); io = null; }
    if (mo) { mo.disconnect(); mo = null; }
    document.querySelectorAll(".fx-up").forEach(el => {
      el.classList.remove("fx-up", "fx-show");
      el.style.removeProperty("--fx-d");
    });
  }

  /* ═══ 마우스 효과 (스포트라이트 · 기울기 · 버튼 빛) ═══ */
  document.addEventListener("pointermove", e => {
    const t = e.target;
    if (!t || !t.closest) return;
    const hv = root.getAttribute("data-hover");
    if (hv === "spotlight" || hv === "tilt") {
      const el = t.closest(".medal-card, .example-item");
      if (el) {
        const r = el.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        el.style.setProperty("--mx", x + "px");
        el.style.setProperty("--my", y + "px");
        if (hv === "tilt" && !reduced() && r.width && r.height) {
          const rx = (y / r.height - .5) * -9, ry = (x / r.width - .5) * 9;
          el.style.transform = `perspective(720px) rotateX(${rx.toFixed(2)}deg) rotateY(${ry.toFixed(2)}deg) translateY(-4px)`;
        }
      }
    }
    if (root.hasAttribute("data-m-btn")) {
      const b = t.closest(".class-chip, .back-link");
      if (b) {
        const r = b.getBoundingClientRect();
        b.style.setProperty("--bx", (e.clientX - r.left) + "px");
        b.style.setProperty("--by", (e.clientY - r.top) + "px");
      }
    }
  }, { passive: true });
  document.addEventListener("pointerout", e => {
    const el = e.target && e.target.closest ? e.target.closest(".medal-card, .example-item") : null;
    if (el && el.style.transform && !el.contains(e.relatedTarget)) el.style.transform = "";
  });
  function clearInlineTilt() {
    document.querySelectorAll(".medal-card, .example-item").forEach(el => { el.style.transform = ""; });
  }

  /* ═══ 적용 ═══ */
  async function apply(raw) {
    const cfg = normalize(raw);
    const prev = current;
    current = cfg;

    const jobs = [];
    if (cfg.theme !== "default") jobs.push(loadCss(assetsDir + "themes/" + cfg.theme + ".css", "lab-theme-" + cfg.theme, "lab-options"));
    jobs.push(loadCss(assetsDir + "css/lab-options.css", "lab-options"));
    if (cfg.font !== "auto") FONT_LINKS[cfg.font].forEach((u, i) => jobs.push(loadCss(u, "lab-font-" + cfg.font + "-" + i)));
    await Promise.all(jobs);

    setAttr("data-theme", cfg.theme === "default" ? null : cfg.theme);
    setAttr("data-card",  cfg.card  === "default" ? null : cfg.card);
    setAttr("data-hover", cfg.hover === "default" ? null : cfg.hover);
    setAttr("data-font",  cfg.font  === "auto"    ? null : cfg.font);
    setAttr("data-m-title",  cfg.motion.title === "off" ? null : cfg.motion.title);
    setAttr("data-m-stars",  cfg.motion.stars);
    setAttr("data-m-fadeup", cfg.motion.fadeup);
    setAttr("data-m-btn",    cfg.motion.btn);

    clearInlineTilt();
    cfg.motion.stars ? startStars() : stopStars();
    cfg.motion.fadeup ? startFadeup() : stopFadeup();
    if (!prev || prev.motion.title !== cfg.motion.title) playTitle(cfg.motion.title);
    return cfg;
  }

  /* ═══ 공개 함수 ═══ */
  window.LabUI = {
    async init(opts) {
      assetsDir = (opts && opts.assetsDir) || "";
      const cfg = await loadConfig((opts && opts.themeUrl) || "theme.json");
      return apply(cfg);
    },
    apply,
    replay() {
      if (!current) return;
      playTitle(current.motion.title);
      if (io) { stopFadeup(); startFadeup(); }
    },
  };

  /* admin 미리보기에서 보내는 실시간 변경 신호 */
  window.addEventListener("message", e => {
    if (e.origin !== location.origin) return;
    const d = e.data;
    if (!d || typeof d !== "object") return;
    if (d.type === "lab-cfg") apply(d.cfg);
    else if (d.type === "lab-replay") window.LabUI.replay();
  });
})();

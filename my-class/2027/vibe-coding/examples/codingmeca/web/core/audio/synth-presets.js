// web/core/audio/synth-presets.js  (50번)
// WebAudio 합성음 프리셋. config/sound-manifest.js 의 synth 이름 79종을 모두 구현합니다. (명세 14-5)
// 음원 파일이 준비되면 매니페스트의 src만 채우면 되고, 파일 로딩이 실패하면 이 합성음이 대신 재생됩니다.
//
// 형태
//   SYNTH_PRESETS[이름] = { kind: 'oneshot', play(ctx, out) → 길이(초) }
//   SYNTH_PRESETS[이름] = { kind: 'loop',    start(ctx, out) → { stop() } }
// ctx = AudioContext(또는 OfflineAudioContext), out = 연결할 GainNode. 볼륨·채널은 audio-engine이 맡습니다.
// 이 파일은 DOM을 쓰지 않으므로 Node에서 import 해도 안전합니다(재생할 때만 ctx가 필요).

const hz = (semi) => 440 * 2 ** (semi / 12); // A4 기준 반음
const rnd = (a, b) => a + Math.random() * (b - a);
const END = 0.0001;

// ── 기본 재료 ───────────────────────────────────────────
const noiseCache = new WeakMap();
function noiseBuffer(ctx) {
  let b = noiseCache.get(ctx);
  if (!b) {
    b = ctx.createBuffer(1, Math.floor(ctx.sampleRate * 2), ctx.sampleRate);
    const d = b.getChannelData(0);
    for (let i = 0; i < d.length; i++) d[i] = Math.random() * 2 - 1;
    noiseCache.set(ctx, b);
  }
  return b;
}

// 오실레이터 한 음. f→f2 로 주파수가 미끄러지고, 필터(ft/fc→fc2)를 걸 수 있다.
function tone(ctx, out, o = {}) {
  const { t = 0, type = 'sine', f = 440, f2 = null, dur = 0.2, a = 0.005, vol = 0.5, ft = null, fc = 1000, fc2 = null, q = 1, det = 0 } = o;
  const t0 = ctx.currentTime + t;
  const osc = ctx.createOscillator();
  osc.type = type;
  osc.frequency.setValueAtTime(f, t0);
  if (f2 != null) osc.frequency.exponentialRampToValueAtTime(Math.max(1, f2), t0 + dur);
  if (det) osc.detune.value = det;
  const g = ctx.createGain();
  g.gain.setValueAtTime(END, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + Math.min(a, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(END, t0 + dur);
  let node = osc;
  if (ft) {
    const fl = ctx.createBiquadFilter();
    fl.type = ft;
    fl.Q.value = q;
    fl.frequency.setValueAtTime(fc, t0);
    if (fc2 != null) fl.frequency.exponentialRampToValueAtTime(Math.max(20, fc2), t0 + dur);
    osc.connect(fl);
    node = fl;
  }
  node.connect(g).connect(out);
  osc.start(t0);
  osc.stop(t0 + dur + 0.05);
  return osc;
}

// 필터 노이즈 한 번
function noise(ctx, out, o = {}) {
  const { t = 0, dur = 0.2, a = 0.003, vol = 0.5, ft = 'lowpass', fc = 2000, fc2 = null, q = 0.7 } = o;
  const t0 = ctx.currentTime + t;
  const src = ctx.createBufferSource();
  src.buffer = noiseBuffer(ctx);
  src.loop = true;
  const fl = ctx.createBiquadFilter();
  fl.type = ft;
  fl.Q.value = q;
  fl.frequency.setValueAtTime(fc, t0);
  if (fc2 != null) fl.frequency.exponentialRampToValueAtTime(Math.max(20, fc2), t0 + dur);
  const g = ctx.createGain();
  g.gain.setValueAtTime(END, t0);
  g.gain.linearRampToValueAtTime(vol, t0 + Math.min(a, dur * 0.5));
  g.gain.exponentialRampToValueAtTime(END, t0 + dur);
  src.connect(fl).connect(g).connect(out);
  src.start(t0, Math.random());
  src.stop(t0 + dur + 0.05);
}

// 음 여러 개를 일정 간격으로 (아르페지오·팡파르)
function notes(ctx, out, semis, o = {}) {
  const { step = 0.1, base = 0, ...rest } = o;
  semis.forEach((s, i) => tone(ctx, out, { ...rest, t: (rest.t || 0) + i * step, f: hz(s + base) }));
  return semis.length * step + (rest.dur || 0.2);
}

// 지속음(루프용) 재료 묶음: 정지하면 전부 정리된다
function loopKit(ctx, out) {
  const nodes = [];
  const timers = [];
  const master = ctx.createGain();
  master.gain.value = 1;
  master.connect(out);
  const kit = {
    ctx, master,
    osc(type, f, vol) {
      const o = ctx.createOscillator();
      o.type = type;
      o.frequency.value = f;
      const g = ctx.createGain();
      g.gain.value = vol;
      o.connect(g).connect(master);
      o.start();
      nodes.push(o);
      return { osc: o, gain: g };
    },
    noise(ft, fc, q, vol) {
      const s = ctx.createBufferSource();
      s.buffer = noiseBuffer(ctx);
      s.loop = true;
      const fl = ctx.createBiquadFilter();
      fl.type = ft;
      fl.frequency.value = fc;
      fl.Q.value = q;
      const g = ctx.createGain();
      g.gain.value = vol;
      s.connect(fl).connect(g).connect(master);
      s.start();
      nodes.push(s);
      return { src: s, filter: fl, gain: g };
    },
    lfo(param, rate, depth) {
      const o = ctx.createOscillator();
      o.frequency.value = rate;
      const g = ctx.createGain();
      g.gain.value = depth;
      o.connect(g).connect(param);
      o.start();
      nodes.push(o);
    },
    // 무작위 간격 사건: ms±jitter 마다 fn 실행
    every(ms, fn, jitter = 0.4) {
      let id = 0;
      const next = () => {
        id = setTimeout(() => { fn(); next(); }, ms * rnd(1 - jitter, 1 + jitter));
        timers.push(id);
      };
      next();
    },
    stop() {
      timers.forEach(clearTimeout);
      timers.length = 0;
      const t = ctx.currentTime;
      try { master.gain.cancelScheduledValues(t); master.gain.setValueAtTime(master.gain.value, t); master.gain.linearRampToValueAtTime(0, t + 0.15); } catch { /* ignore */ }
      nodes.forEach((n) => { try { n.stop(t + 0.2); } catch { /* ignore */ } });
      setTimeout(() => { try { master.disconnect(); } catch { /* ignore */ } }, 400);
    },
  };
  return kit;
}

export const SYNTH_PRESETS = {};
const one = (name, play) => { SYNTH_PRESETS[name] = { kind: 'oneshot', play }; };
const loop = (name, start) => { SYNTH_PRESETS[name] = { kind: 'loop', start: (ctx, out) => { const k = loopKit(ctx, out); start(k, ctx); return { stop: () => k.stop() }; } }; };

// 자주 쓰는 소리 조각
const clang = (ctx, out, vol = 0.4) => { // 금속 타격
  const f = rnd(500, 900);
  tone(ctx, out, { type: 'square', f, f2: f * 0.7, dur: 0.4, vol: vol * 0.5, ft: 'bandpass', fc: f * 1.5, q: 6 });
  tone(ctx, out, { type: 'triangle', f: f * 2.76, dur: 0.25, vol: vol * 0.4 });
  noise(ctx, out, { dur: 0.05, vol: vol * 0.6, ft: 'highpass', fc: 3000 });
};
const boom = (ctx, out, vol = 0.8, len = 0.7) => {
  tone(ctx, out, { type: 'sine', f: 110, f2: 32, dur: len, vol, a: 0.004 });
  noise(ctx, out, { dur: len, vol: vol * 0.8, ft: 'lowpass', fc: 2400, fc2: 120 });
};
const ping = (ctx, out, f, vol = 0.3, dur = 0.5) => tone(ctx, out, { type: 'sine', f, dur, vol, a: 0.002 });

// ── 앰비언트(루프) ──────────────────────────────────────
loop('ambHangar', (k, ctx) => { // 저역 기계 험, 간헐 금속 타격, 증기, 크레인 모터
  const h = k.osc('sawtooth', 55, 0.12);
  const hf = ctx.createBiquadFilter(); hf.type = 'lowpass'; hf.frequency.value = 180;
  h.gain.disconnect(); h.gain.connect(hf).connect(k.master);
  k.osc('sine', 110.5, 0.06);
  const s = k.noise('bandpass', 1800, 0.6, 0.015);
  k.lfo(s.gain.gain, 0.12, 0.012);
  k.every(7000, () => clang(ctx, k.master, 0.25));
  k.every(11000, () => noise(ctx, k.master, { dur: 1.6, a: 0.3, vol: 0.18, ft: 'highpass', fc: 3500, fc2: 1500 }));
  k.every(15000, () => tone(ctx, k.master, { type: 'sawtooth', f: 90, f2: 140, dur: 2.4, a: 0.6, vol: 0.05, ft: 'lowpass', fc: 400 }));
});
loop('ambLab', (k, ctx) => { // 저역 드론 + 고음 전자 아르페지오
  k.osc('sine', 48, 0.16);
  const d = k.osc('triangle', 72.3, 0.07);
  k.lfo(d.osc.frequency, 0.07, 1.2);
  const scale = [0, 3, 7, 10, 12, 15, 19];
  let i = 0;
  k.every(380, () => { tone(ctx, k.master, { type: 'sine', f: hz(scale[i++ % scale.length] + 12), dur: 0.6, vol: 0.06, a: 0.01 }); }, 0.15);
});
loop('ambRange', (k, ctx) => { // 바람, 원거리 전자음
  const w = k.noise('bandpass', 500, 0.8, 0.07);
  k.lfo(w.filter.frequency, 0.09, 220);
  k.lfo(w.gain.gain, 0.06, 0.04);
  k.every(5200, () => tone(ctx, k.master, { type: 'square', f: rnd(900, 1800), f2: rnd(300, 600), dur: 0.12, vol: 0.04, ft: 'lowpass', fc: 1500 }), 0.7);
});
loop('ambArena', (k, ctx) => { // 군중 웅성, 비트
  const c = k.noise('bandpass', 700, 0.5, 0.09);
  k.lfo(c.gain.gain, 0.2, 0.04);
  k.lfo(c.filter.frequency, 0.13, 180);
  k.osc('sine', 52, 0.06);
  let b = 0;
  k.every(500, () => { tone(ctx, k.master, { type: 'sine', f: 90, f2: 40, dur: 0.22, vol: b++ % 4 === 0 ? 0.28 : 0.16 }); }, 0.02);
});
loop('ambCommand', (k, ctx) => { // 조용한 컴퓨터 beep, 레이더 ping
  k.osc('sine', 60, 0.07);
  k.noise('lowpass', 300, 0.5, 0.012);
  k.every(2600, () => tone(ctx, k.master, { type: 'square', f: hz(rnd(0, 1) > 0.5 ? 19 : 24), dur: 0.05, vol: 0.03 }), 0.6);
  k.every(5000, () => tone(ctx, k.master, { type: 'sine', f: 1320, f2: 1250, dur: 1.2, vol: 0.05, a: 0.002 }), 0.1);
});
loop('wpSpin', (k) => { // 회전 날 (수평)
  const o = k.osc('sawtooth', 110, 0.12);
  k.lfo(o.osc.frequency, 7, 6);
  k.noise('bandpass', 2400, 2, 0.05);
});
loop('wpSpinHeavy', (k) => { // 회전 톱 (수직, 묵직)
  const o = k.osc('sawtooth', 70, 0.16);
  k.lfo(o.osc.frequency, 5, 5);
  k.osc('square', 140, 0.04);
  k.noise('bandpass', 1500, 1.5, 0.07);
});
loop('repairLoop', (k, ctx) => { // 수리 빔
  k.osc('sine', 520, 0.05);
  const o = k.osc('sine', 780, 0.03);
  k.lfo(o.osc.frequency, 4, 25);
  k.every(260, () => tone(ctx, k.master, { type: 'triangle', f: rnd(1200, 1800), dur: 0.05, vol: 0.03 }), 0.5);
});

// ── UI ──────────────────────────────────────────────────
one('uiEnter', (c, o) => notes(c, o, [-12, -5, 0, 7], { step: 0.07, type: 'triangle', dur: 0.5, vol: 0.4 }) + 0.2);
one('uiClick', (c, o) => { tone(c, o, { type: 'square', f: 1200, f2: 800, dur: 0.05, vol: 0.25 }); return 0.1; });
one('uiHover', (c, o) => { tone(c, o, { type: 'sine', f: 1800, dur: 0.04, vol: 0.2 }); return 0.08; });
one('uiError', (c, o) => { tone(c, o, { type: 'sawtooth', f: 180, dur: 0.18, vol: 0.35, ft: 'lowpass', fc: 900 }); tone(c, o, { t: 0.12, type: 'sawtooth', f: 140, dur: 0.25, vol: 0.35, ft: 'lowpass', fc: 700 }); return 0.4; });
one('uiSave', (c, o) => notes(c, o, [7, 12, 19], { step: 0.08, type: 'sine', dur: 0.35, vol: 0.35 }));
one('uiWhoosh', (c, o) => { noise(c, o, { dur: 0.5, a: 0.15, vol: 0.4, ft: 'bandpass', fc: 400, fc2: 3000, q: 1.2 }); return 0.55; });
one('cardPlace', (c, o) => { tone(c, o, { type: 'square', f: 220, f2: 110, dur: 0.09, vol: 0.35 }); noise(c, o, { dur: 0.04, vol: 0.3, ft: 'highpass', fc: 2500 }); return 0.15; });
one('cardRemove', (c, o) => { noise(c, o, { dur: 0.18, a: 0.01, vol: 0.3, ft: 'bandpass', fc: 3000, fc2: 800 }); return 0.2; });
one('linkChime', (c, o) => notes(c, o, [12, 19, 24], { step: 0.06, type: 'sine', dur: 0.8, vol: 0.28 }));

// ── 조립(격납고) ────────────────────────────────────────
one('partPick', (c, o) => { tone(c, o, { type: 'triangle', f: 400, f2: 600, dur: 0.07, vol: 0.3 }); return 0.1; });
one('partAttach', (c, o) => { clang(c, o, 0.5); tone(c, o, { type: 'square', f: 150, f2: 70, dur: 0.12, vol: 0.5 }); noise(c, o, { dur: 0.07, vol: 0.4, ft: 'bandpass', fc: 2500 }); return 0.5; });
one('partDetach', (c, o) => { noise(c, o, { dur: 0.2, vol: 0.4, ft: 'bandpass', fc: 1200, fc2: 400 }); tone(c, o, { type: 'square', f: 200, f2: 90, dur: 0.15, vol: 0.3 }); return 0.25; });
one('partInvalid', (c, o) => { tone(c, o, { type: 'square', f: 130, dur: 0.14, vol: 0.35 }); tone(c, o, { t: 0.1, type: 'square', f: 110, dur: 0.18, vol: 0.35 }); return 0.3; });
one('craneMove', (c, o) => { tone(c, o, { type: 'sawtooth', f: 80, f2: 120, dur: 1.2, a: 0.3, vol: 0.2, ft: 'lowpass', fc: 500 }); return 1.3; });
one('weldSpark', (c, o) => { for (let i = 0; i < 6; i++) noise(c, o, { t: i * 0.05 + rnd(0, 0.03), dur: 0.04, vol: 0.4, ft: 'highpass', fc: rnd(3500, 6500) }); return 0.4; });
one('steamVent', (c, o) => { noise(c, o, { dur: 1.1, a: 0.05, vol: 0.4, ft: 'highpass', fc: 4000, fc2: 1800 }); return 1.2; });

// ── 전투: 피격·파손 ─────────────────────────────────────
one('hitLight', (c, o) => { noise(c, o, { dur: 0.07, vol: 0.5, ft: 'bandpass', fc: 2200 }); tone(c, o, { type: 'square', f: 260, f2: 130, dur: 0.08, vol: 0.35 }); return 0.12; });
one('hitHeavy', (c, o) => { noise(c, o, { dur: 0.18, vol: 0.7, ft: 'lowpass', fc: 2500, fc2: 300 }); tone(c, o, { type: 'sine', f: 120, f2: 45, dur: 0.3, vol: 0.8 }); clang(c, o, 0.3); return 0.4; });
one('partBreak', (c, o) => { noise(c, o, { dur: 0.35, vol: 0.6, ft: 'bandpass', fc: 1800, fc2: 500 }); tone(c, o, { type: 'sawtooth', f: 300, f2: 60, dur: 0.4, vol: 0.4, ft: 'lowpass', fc: 1200 }); clang(c, o, 0.3); return 0.5; });
one('partDetachBoom', (c, o) => { boom(c, o, 0.8, 0.9); clang(c, o, 0.3); return 1.0; });
one('robotCollide', (c, o) => { tone(c, o, { type: 'sine', f: 100, f2: 40, dur: 0.25, vol: 0.8 }); noise(c, o, { dur: 0.12, vol: 0.5, ft: 'lowpass', fc: 1500 }); clang(c, o, 0.35); return 0.35; });
one('koBoom', (c, o) => { boom(c, o, 1, 1.6); tone(c, o, { t: 0.1, type: 'sawtooth', f: 600, f2: 40, dur: 1.2, vol: 0.3, ft: 'lowpass', fc: 1500, fc2: 100 }); noise(c, o, { t: 0.2, dur: 1.2, vol: 0.3, ft: 'bandpass', fc: 4000, fc2: 500 }); return 1.8; });
one('poisonTick', (c, o) => { tone(c, o, { type: 'sine', f: 300, f2: 180, dur: 0.12, vol: 0.3 }); noise(c, o, { t: 0.02, dur: 0.06, vol: 0.2, ft: 'bandpass', fc: 900 }); return 0.2; });

// ── 전투: 무기 ──────────────────────────────────────────
one('wpClaw', (c, o) => { noise(c, o, { dur: 0.16, a: 0.01, vol: 0.5, ft: 'bandpass', fc: 5000, fc2: 1800, q: 1.5 }); tone(c, o, { type: 'sawtooth', f: 900, f2: 300, dur: 0.1, vol: 0.2 }); return 0.2; });
one('wpFang', (c, o) => { tone(c, o, { type: 'square', f: 300, f2: 120, dur: 0.1, vol: 0.4 }); noise(c, o, { dur: 0.1, vol: 0.5, ft: 'highpass', fc: 2500 }); tone(c, o, { t: 0.08, type: 'sine', f: 90, f2: 45, dur: 0.15, vol: 0.5 }); return 0.25; });
one('wpTail', (c, o) => { noise(c, o, { dur: 0.3, a: 0.02, vol: 0.5, ft: 'bandpass', fc: 600, fc2: 3500 }); tone(c, o, { t: 0.22, type: 'sine', f: 140, f2: 60, dur: 0.15, vol: 0.5 }); return 0.4; });
one('wpHammer', (c, o) => { tone(c, o, { type: 'sine', f: 70, f2: 28, dur: 0.6, vol: 1, a: 0.004 }); noise(c, o, { dur: 0.25, vol: 0.7, ft: 'lowpass', fc: 1800, fc2: 100 }); clang(c, o, 0.45); return 0.7; });
one('wpLift', (c, o) => { tone(c, o, { type: 'sawtooth', f: 100, f2: 260, dur: 0.5, a: 0.1, vol: 0.3, ft: 'lowpass', fc: 600 }); clang(c, o, 0.25); return 0.6; });
one('wpPlasma', (c, o) => { tone(c, o, { type: 'sawtooth', f: 900, f2: 200, dur: 0.3, vol: 0.35, ft: 'lowpass', fc: 3000, fc2: 400 }); tone(c, o, { type: 'sine', f: 1500, f2: 400, dur: 0.25, vol: 0.2 }); return 0.35; });
one('wpMissileLaunch', (c, o) => { noise(c, o, { dur: 0.8, a: 0.05, vol: 0.6, ft: 'bandpass', fc: 800, fc2: 3500 }); tone(c, o, { type: 'sawtooth', f: 120, f2: 300, dur: 0.6, vol: 0.25, ft: 'lowpass', fc: 800 }); return 0.9; });
one('missileExplode', (c, o) => { boom(c, o, 0.9, 1.0); noise(c, o, { dur: 0.3, vol: 0.5, ft: 'highpass', fc: 3500 }); return 1.1; });
one('wpStun', (c, o) => { for (let i = 0; i < 7; i++) tone(c, o, { t: i * 0.04, type: 'square', f: rnd(600, 2400), dur: 0.05, vol: 0.25 }); noise(c, o, { dur: 0.3, vol: 0.3, ft: 'highpass', fc: 5000 }); return 0.4; });
one('wpBreath', (c, o) => { noise(c, o, { dur: 1.0, a: 0.12, vol: 0.55, ft: 'bandpass', fc: 500, fc2: 2000, q: 0.8 }); tone(c, o, { type: 'sawtooth', f: 70, f2: 110, dur: 0.9, vol: 0.3, ft: 'lowpass', fc: 400 }); return 1.1; });
one('wpLaser', (c, o) => { tone(c, o, { type: 'sawtooth', f: 2400, f2: 400, dur: 0.22, vol: 0.3, ft: 'lowpass', fc: 5000 }); tone(c, o, { type: 'sine', f: 1200, f2: 300, dur: 0.2, vol: 0.25 }); return 0.3; });
one('wpEmp', (c, o) => { tone(c, o, { type: 'sine', f: 60, f2: 25, dur: 0.9, vol: 0.8 }); noise(c, o, { dur: 0.7, vol: 0.35, ft: 'bandpass', fc: 3000, fc2: 300 }); for (let i = 0; i < 5; i++) tone(c, o, { t: 0.1 + i * 0.07, type: 'square', f: rnd(1000, 3000), dur: 0.04, vol: 0.2 }); return 1.0; });
one('wpGrav', (c, o) => { tone(c, o, { type: 'sine', f: 40, f2: 90, dur: 1.2, a: 0.4, vol: 0.7 }); tone(c, o, { type: 'sawtooth', f: 300, f2: 60, dur: 1.2, a: 0.3, vol: 0.2, ft: 'lowpass', fc: 700 }); return 1.3; });
one('wpRailCharge', (c, o) => { tone(c, o, { type: 'sawtooth', f: 200, f2: 3200, dur: 1.2, a: 0.9, vol: 0.28, ft: 'lowpass', fc: 2500 }); tone(c, o, { type: 'sine', f: 400, f2: 4000, dur: 1.2, a: 0.9, vol: 0.2 }); return 1.3; });
one('wpRailFire', (c, o) => { noise(c, o, { dur: 0.08, vol: 1, ft: 'highpass', fc: 1500 }); tone(c, o, { type: 'sine', f: 140, f2: 30, dur: 0.7, vol: 1 }); tone(c, o, { type: 'sawtooth', f: 3500, f2: 200, dur: 0.35, vol: 0.4 }); return 0.8; });
one('wpNano', (c, o) => { for (let i = 0; i < 9; i++) tone(c, o, { t: i * 0.035, type: 'sine', f: rnd(2000, 4500), dur: 0.06, vol: 0.18 }); noise(c, o, { dur: 0.35, vol: 0.2, ft: 'bandpass', fc: 6000 }); return 0.45; });

// ── 전투: 방어·특수 ─────────────────────────────────────
one('shieldOn', (c, o) => { tone(c, o, { type: 'sine', f: 300, f2: 900, dur: 0.4, a: 0.1, vol: 0.35 }); tone(c, o, { type: 'triangle', f: 600, f2: 1800, dur: 0.4, a: 0.1, vol: 0.2 }); return 0.5; });
one('shieldHit', (c, o) => { tone(c, o, { type: 'sine', f: 1400, f2: 900, dur: 0.18, vol: 0.4 }); noise(c, o, { dur: 0.1, vol: 0.25, ft: 'highpass', fc: 4000 }); return 0.25; });
one('shieldBreak', (c, o) => { noise(c, o, { dur: 0.5, vol: 0.5, ft: 'highpass', fc: 3000, fc2: 800 }); for (let i = 0; i < 6; i++) tone(c, o, { t: i * 0.03, type: 'triangle', f: rnd(900, 2800), f2: 200, dur: 0.3, vol: 0.25 }); return 0.6; });
one('intercept', (c, o) => { tone(c, o, { type: 'square', f: 1800, f2: 600, dur: 0.07, vol: 0.3 }); tone(c, o, { t: 0.06, type: 'sine', f: 120, f2: 50, dur: 0.2, vol: 0.5 }); noise(c, o, { t: 0.06, dur: 0.12, vol: 0.4, ft: 'bandpass', fc: 2500 }); return 0.3; });
one('phaseShift', (c, o) => { tone(c, o, { type: 'sine', f: 1500, f2: 150, dur: 0.6, vol: 0.4, a: 0.02 }); tone(c, o, { type: 'sine', f: 1510, f2: 155, dur: 0.6, vol: 0.4, a: 0.02 }); return 0.7; });
one('revive', (c, o) => notes(c, o, [0, 4, 7, 12, 16, 19, 24], { step: 0.09, base: -5, type: 'triangle', dur: 1.0, vol: 0.35 }) + 0.3);
one('awakenSkill', (c, o) => { tone(c, o, { type: 'sawtooth', f: 150, f2: 900, dur: 0.5, a: 0.3, vol: 0.3, ft: 'lowpass', fc: 2500 }); notes(c, o, [7, 12, 16, 19], { t: 0.4, step: 0.06, type: 'square', dur: 0.4, vol: 0.2 }); return 1.0; });
one('stealthOn', (c, o) => { noise(c, o, { dur: 0.5, a: 0.1, vol: 0.2, ft: 'bandpass', fc: 4000, fc2: 500 }); tone(c, o, { type: 'sine', f: 800, f2: 200, dur: 0.5, vol: 0.2 }); return 0.6; });

// ── 변신·오버드라이브 ───────────────────────────────────
one('transform', (c, o) => { for (let i = 0; i < 6; i++) { tone(c, o, { t: i * 0.09, type: 'square', f: 140 + i * 15, f2: 90, dur: 0.08, vol: 0.3 }); clang(c, o, 0.18); } tone(c, o, { t: 0.1, type: 'sawtooth', f: 300, f2: 1800, dur: 0.6, vol: 0.2, ft: 'lowpass', fc: 2500 }); return 0.9; });
one('overdriveCutin', (c, o) => { tone(c, o, { type: 'sawtooth', f: 80, f2: 400, dur: 0.9, a: 0.5, vol: 0.4, ft: 'lowpass', fc: 900, fc2: 3500 }); noise(c, o, { dur: 0.9, a: 0.5, vol: 0.3, ft: 'highpass', fc: 800, fc2: 5000 }); notes(c, o, [0, 7, 12], { t: 0.6, step: 0.08, type: 'square', dur: 0.5, vol: 0.2 }); return 1.2; });
one('overdriveFire', (c, o) => { boom(c, o, 1, 1.2); tone(c, o, { type: 'sawtooth', f: 200, f2: 2000, dur: 0.3, vol: 0.4 }); notes(c, o, [0, 7, 12, 19], { t: 0.05, step: 0.05, type: 'square', dur: 0.6, vol: 0.2 }); return 1.3; });
one('slowmoIn', (c, o) => { tone(c, o, { type: 'sine', f: 800, f2: 120, dur: 0.7, vol: 0.4 }); noise(c, o, { dur: 0.7, vol: 0.2, ft: 'lowpass', fc: 4000, fc2: 150 }); return 0.8; });
one('slowmoOut', (c, o) => { tone(c, o, { type: 'sine', f: 120, f2: 800, dur: 0.5, vol: 0.4 }); noise(c, o, { dur: 0.5, vol: 0.2, ft: 'lowpass', fc: 150, fc2: 4000 }); return 0.6; });

// ── 융합 연출 ───────────────────────────────────────────
one('fusionBlackout', (c, o) => { tone(c, o, { type: 'sine', f: 900, f2: 30, dur: 1.2, vol: 0.6 }); noise(c, o, { dur: 1.0, vol: 0.4, ft: 'lowpass', fc: 5000, fc2: 60 }); return 1.3; });
one('fusionDisperse', (c, o) => { for (let i = 0; i < 18; i++) tone(c, o, { t: i * 0.06, type: 'sine', f: rnd(1500, 5000), dur: 0.25, vol: 0.12 }); noise(c, o, { dur: 1.2, a: 0.2, vol: 0.2, ft: 'highpass', fc: 5000 }); return 1.4; });
one('fusionVortex', (c, o) => { tone(c, o, { type: 'sawtooth', f: 60, f2: 600, dur: 2.2, a: 1.6, vol: 0.35, ft: 'lowpass', fc: 400, fc2: 4000 }); tone(c, o, { type: 'sine', f: 90, f2: 900, dur: 2.2, a: 1.6, vol: 0.3 }); noise(c, o, { dur: 2.2, a: 1.5, vol: 0.25, ft: 'bandpass', fc: 300, fc2: 5000, q: 1.5 }); return 2.3; });
one('fusionAssemble', (c, o) => { for (let i = 0; i < 8; i++) { tone(c, o, { t: i * 0.1, type: 'square', f: 150 + i * 30, f2: 80, dur: 0.08, vol: 0.3 }); clang(c, o, 0.14); } return 1.0; });
one('fusionShockwave', (c, o) => { boom(c, o, 1, 1.6); noise(c, o, { dur: 1.4, vol: 0.4, ft: 'bandpass', fc: 5000, fc2: 300, q: 0.6 }); notes(c, o, [0, 7, 12, 19, 24], { t: 0.15, step: 0.04, base: -12, type: 'sawtooth', dur: 1.4, vol: 0.18, ft: 'lowpass', fc: 2500 }); return 1.8; });
one('fusionTitle', (c, o) => notes(c, o, [0, 7, 12], { step: 0.2, base: -7, type: 'triangle', dur: 1.4, vol: 0.35 }) + 0.4);
one('fusionNewCodex', (c, o) => notes(c, o, [12, 16, 19, 24, 28], { step: 0.07, type: 'sine', dur: 0.8, vol: 0.3 }) + 0.3);

// ── 경기 흐름 ───────────────────────────────────────────
one('countdownTick', (c, o) => { tone(c, o, { type: 'square', f: 660, dur: 0.12, vol: 0.35 }); return 0.2; });
one('countdownGo', (c, o) => { tone(c, o, { type: 'square', f: 990, dur: 0.5, vol: 0.4 }); tone(c, o, { type: 'square', f: 1485, dur: 0.5, vol: 0.2 }); return 0.6; });
one('matchStart', (c, o) => { noise(c, o, { dur: 0.6, a: 0.3, vol: 0.4, ft: 'lowpass', fc: 300, fc2: 3000 }); notes(c, o, [-12, -5, 0], { t: 0.4, step: 0.1, type: 'sawtooth', dur: 0.8, vol: 0.3, ft: 'lowpass', fc: 2000 }); return 1.3; });
one('matchEnd', (c, o) => { for (let i = 0; i < 3; i++) tone(c, o, { t: i * 0.35, type: 'sine', f: 140 - i * 20, f2: 60, dur: 0.6, vol: 0.7 }); clang(c, o, 0.3); return 1.4; });
one('victory', (c, o) => notes(c, o, [0, 4, 7, 12, 7, 12, 16, 24], { step: 0.14, base: -3, type: 'square', dur: 0.5, vol: 0.28, ft: 'lowpass', fc: 3000 }) + 0.5);
one('defeat', (c, o) => notes(c, o, [0, -3, -5, -10], { step: 0.28, base: -3, type: 'triangle', dur: 0.9, vol: 0.35 }) + 0.5);
one('drawGame', (c, o) => notes(c, o, [0, 0, -5], { step: 0.25, type: 'triangle', dur: 0.6, vol: 0.3 }) + 0.4);
one('hazardWarn', (c, o) => { for (let i = 0; i < 3; i++) { tone(c, o, { t: i * 0.22, type: 'square', f: 880, dur: 0.12, vol: 0.3 }); tone(c, o, { t: i * 0.22 + 0.11, type: 'square', f: 660, dur: 0.1, vol: 0.3 }); } return 0.8; });
one('hazardHit', (c, o) => { boom(c, o, 0.8, 0.8); noise(c, o, { dur: 0.3, vol: 0.5, ft: 'highpass', fc: 3000 }); return 0.9; });
one('crowdCheer', (c, o) => { noise(c, o, { dur: 2.2, a: 0.5, vol: 0.55, ft: 'bandpass', fc: 900, fc2: 1800, q: 0.5 }); noise(c, o, { t: 0.3, dur: 1.8, a: 0.4, vol: 0.25, ft: 'highpass', fc: 2500 }); return 2.4; });

// ── 지휘 본부·관제 ──────────────────────────────────────
one('radarPing', (c, o) => { ping(c, o, 1400, 0.4, 1.0); ping(c, o, 1405, 0.2, 1.4); return 1.5; });
one('scoreboardUpdate', (c, o) => notes(c, o, [12, 19], { step: 0.07, type: 'square', dur: 0.15, vol: 0.2 }));

export const PRESET_NAMES = Object.freeze(Object.keys(SYNTH_PRESETS).sort());
export const hasPreset = (name) => Boolean(SYNTH_PRESETS[name]);

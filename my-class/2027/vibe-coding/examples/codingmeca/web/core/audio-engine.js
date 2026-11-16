// web/core/audio-engine.js  (49번)
// 이벤트 ID로 소리를 재생하는 엔진. (명세 14-5)
//   engine.unlock()            첫 입장 버튼에서 호출 → 오디오 잠금 해제
//   engine.play('hit_heavy')   효과음·UI음 한 번 재생 → { stop() } 반환
//   engine.playLoop('wp_spin_h') / engine.stop('wp_spin_h')   루프음(중복 시작 방지)
//   engine.setAmbient('amb_hangar')  공간 앰비언트 교체(크로스페이드). null이면 끔
//   engine.setMasterVolume(v) / setChannelVolume('sfx', v) / setMuted(true)
//
// 소리 원본: config/sound-manifest.js 가 정한다. src(음원 파일)가 있으면 파일, 없거나 로딩 실패면 합성음(synth-presets).
// 채널: ambient / sfx / ui / music, 각자 볼륨과 마스터 볼륨, 음소거.
// 브라우저 밖(테스트)에서는 createContext 옵션으로 가짜 컨텍스트를 넣을 수 있다.

import { resolveSound, CHANNELS, SOUND_MANIFEST } from '../../config/sound-manifest.js';
import { SYNTH_PRESETS } from './audio/synth-presets.js';

const MAX_VOICES = 40;
const DEFAULT_COOLDOWN_MS = 35; // 같은 이벤트가 이보다 빨리 연속 요청되면 무시(소리 겹침 폭주 방지)
const COOLDOWN_MS = { ui_hover: 70, hit_light: 60, poison_tick: 120, radar_ping: 200 };

export function createAudioEngine({
  createContext = () => new (globalThis.AudioContext || globalThis.webkitAudioContext)(),
  fetchFn = (...a) => globalThis.fetch(...a),
  presets = SYNTH_PRESETS,
  overrides = {},
  settings: initial = {},
  onSettingsChange = null,
} = {}) {
  let ctx = null;
  let master = null;
  const chanGain = {};
  const buffers = new Map(); // src → AudioBuffer | null(실패)
  const loops = new Map(); // eventId → handle
  const lastPlay = new Map(); // eventId → ms
  let voices = 0;
  let ambientId = null;
  let ambientHandle = null;

  const settings = {
    master: 0.8,
    muted: false,
    channels: Object.fromEntries(Object.entries(CHANNELS).map(([k, v]) => [k, v.volume])),
    ...initial,
  };
  settings.channels = { ...Object.fromEntries(Object.entries(CHANNELS).map(([k, v]) => [k, v.volume])), ...(initial.channels || {}) };

  const clamp01 = (v) => Math.max(0, Math.min(1, Number(v) || 0));
  const emitSettings = () => onSettingsChange?.(JSON.parse(JSON.stringify(settings)));

  function applyGains() {
    if (!ctx) return;
    const t = ctx.currentTime;
    master.gain.setTargetAtTime(settings.muted ? 0 : settings.master, t, 0.03);
    for (const [k, g] of Object.entries(chanGain)) g.gain.setTargetAtTime(settings.channels[k] ?? 1, t, 0.03);
  }

  // ── 잠금 해제 ──
  async function unlock() {
    if (!ctx) {
      try {
        ctx = createContext();
      } catch {
        return false; // 오디오를 쓸 수 없는 환경: 이후 play는 조용히 무시
      }
      master = ctx.createGain();
      // 큰 소리가 겹쳐도 깨지지 않도록 마지막에 리미터(압축기)를 둔다
      const lim = ctx.createDynamicsCompressor?.();
      if (lim) {
        lim.threshold.value = -8; lim.knee.value = 8; lim.ratio.value = 12; lim.attack.value = 0.003; lim.release.value = 0.15;
        master.connect(lim);
        lim.connect(ctx.destination);
      } else master.connect(ctx.destination);
      for (const k of Object.keys(CHANNELS)) {
        chanGain[k] = ctx.createGain();
        chanGain[k].connect(master);
      }
      applyGains();
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (!ctx) return;
          if (document.hidden) ctx.suspend?.().catch(() => {});
          else ctx.resume?.().catch(() => {});
        });
      }
    }
    if (ctx.state === 'suspended') {
      try { await ctx.resume(); } catch { return false; }
    }
    return ctx.state === 'running' || ctx.state === undefined;
  }

  // ── 음원 파일 불러오기(실패하면 null을 기억 → 합성음 대체) ──
  async function loadBuffer(src) {
    if (buffers.has(src)) return buffers.get(src);
    buffers.set(src, null);
    try {
      const res = await fetchFn(src);
      if (!res.ok) throw new Error(String(res.status));
      const arr = await res.arrayBuffer();
      const buf = await new Promise((ok, no) => ctx.decodeAudioData(arr, ok, no));
      buffers.set(src, buf);
      return buf;
    } catch {
      return null;
    }
  }

  // 매니페스트의 음원 파일을 미리 불러온다(없으면 아무 일도 없다)
  async function preload(eventIds = null) {
    if (!ctx) return 0;
    const list = eventIds || Object.keys(SOUND_MANIFEST);
    let n = 0;
    await Promise.all(list.map(async (id) => {
      const r = resolveSound(id, overrides);
      if (r?.src) { await loadBuffer(r.src); n++; }
    }));
    return n;
  }

  // ── 재생 ──
  function startVoice(r, extraVol = 1) {
    const vg = ctx.createGain();
    vg.gain.value = r.volume * extraVol;
    vg.connect(chanGain[r.channel] || master);
    voices++;
    let done = false;
    const release = (delayMs = 0) => setTimeout(() => {
      if (done) return;
      done = true;
      voices--;
      try { vg.disconnect(); } catch { /* ignore */ }
    }, delayMs);
    return { vg, release };
  }

  function play(eventId, { volume = 1, rate = 1 } = {}) {
    if (!ctx || ctx.state === 'closed') return null;
    const r = resolveSound(eventId, overrides);
    if (!r) return null;
    if (r.loop) return playLoop(eventId, { volume });

    const now = Date.now();
    const cd = COOLDOWN_MS[eventId] ?? DEFAULT_COOLDOWN_MS;
    if (now - (lastPlay.get(eventId) || 0) < cd) return null;
    if (voices >= MAX_VOICES) return null;
    lastPlay.set(eventId, now);

    const { vg, release } = startVoice(r, volume);
    const buf = r.src ? buffers.get(r.src) : null;
    if (buf) {
      const src = ctx.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;
      src.connect(vg);
      src.start();
      src.onended = () => release(0);
      return { stop: () => { try { src.stop(); } catch { /* ignore */ } release(0); } };
    }
    const p = presets[r.synth];
    if (!p || p.kind !== 'oneshot') { release(0); return null; }
    let len = 0.5;
    try { len = p.play(ctx, vg) || 0.5; } catch { release(0); return null; }
    release((len + 0.4) * 1000);
    return { stop: () => { vg.gain.setTargetAtTime(0, ctx.currentTime, 0.03); release(200); } };
  }

  function playLoop(eventId, { volume = 1 } = {}) {
    if (!ctx) return null;
    if (loops.has(eventId)) return loops.get(eventId);
    const r = resolveSound(eventId, overrides);
    if (!r) return null;
    const { vg, release } = startVoice(r, volume);
    vg.gain.value = 0;
    vg.gain.setTargetAtTime(r.volume * volume, ctx.currentTime, 0.2); // 부드럽게 시작
    let inner = null;
    const buf = r.src ? buffers.get(r.src) : null;
    if (buf) {
      const s = ctx.createBufferSource();
      s.buffer = buf;
      s.loop = true;
      s.connect(vg);
      s.start();
      inner = { stop: () => { try { s.stop(); } catch { /* ignore */ } } };
    } else {
      const p = presets[r.synth];
      if (!p || p.kind !== 'loop') { release(0); return null; }
      try { inner = p.start(ctx, vg); } catch { release(0); return null; }
    }
    const handle = {
      eventId,
      stop(fade = 0.4) {
        if (!loops.has(eventId)) return;
        loops.delete(eventId);
        vg.gain.setTargetAtTime(0, ctx.currentTime, fade / 3);
        setTimeout(() => { inner.stop(); release(0); }, fade * 1000 + 100);
      },
    };
    loops.set(eventId, handle);
    return handle;
  }

  const stop = (eventId, fade) => { loops.get(eventId)?.stop(fade); };
  const stopAll = () => { [...loops.values()].forEach((h) => h.stop(0.1)); ambientId = null; ambientHandle = null; };

  // 공간 앰비언트: 이전 것은 서서히 끄고 새 것은 서서히 켠다
  function setAmbient(eventId) {
    if (eventId === ambientId) return ambientHandle;
    ambientHandle?.stop(0.8);
    ambientId = eventId;
    ambientHandle = eventId ? playLoop(eventId) : null;
    return ambientHandle;
  }

  // ── 볼륨·음소거 ──
  function setMasterVolume(v) { settings.master = clamp01(v); applyGains(); emitSettings(); }
  function setChannelVolume(ch, v) { if (!(ch in CHANNELS)) return; settings.channels[ch] = clamp01(v); applyGains(); emitSettings(); }
  function setMuted(m) { settings.muted = Boolean(m); applyGains(); emitSettings(); }
  const toggleMuted = () => { setMuted(!settings.muted); return settings.muted; };

  return {
    unlock, preload, play, playLoop, stop, stopAll, setAmbient,
    setMasterVolume, setChannelVolume, setMuted, toggleMuted,
    getSettings: () => JSON.parse(JSON.stringify(settings)),
    get unlocked() { return Boolean(ctx) && ctx.state !== 'suspended'; },
    get context() { return ctx; },
    get activeVoices() { return voices; },
    get ambient() { return ambientId; },
  };
}

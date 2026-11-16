// web/render/effects/postfx.js  (43번)
// 후처리: 블룸(빛 번짐) + 마무리 패스(비네트·색수차·섬광·채도 낮춤). 화질 '하'에서는 끈다. (명세 v1.0 14-1, 14-3)
//
//   const fx = createPostfx(r);          // r = createRenderer(...) 의 반환값. r.customRender를 대신 설정한다.
//   fx.pulse('hit' | 'ko' | 'overdrive' | 'fusion' | 'emp' | 'meteor');
//   fx.setSlowmo(0~1);                   // 오버드라이브 슬로모션 중의 화면 톤(채도↓·비네트↑)
//   fx.onEvent(ev);                      // 서버 사건을 그대로 넘기면 알맞은 펄스를 낸다
// three/addons는 import map의 'three/addons/'를 쓴다(진입 HTML 참고).

import * as THREE from 'three';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { ShaderPass } from 'three/addons/postprocessing/ShaderPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

// 마무리 패스: 색수차(화면 가장자리에서 RGB가 어긋남) + 비네트 + 섬광 + 채도
const FinalShader = {
  uniforms: {
    tDiffuse: { value: null },
    uAberration: { value: 0 },
    uVignette: { value: 0.25 },
    uFlash: { value: new THREE.Color(0xffffff) },
    uFlashAmount: { value: 0 },
    uDesat: { value: 0 },
  },
  vertexShader: `
    varying vec2 vUv;
    void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
  `,
  fragmentShader: `
    uniform sampler2D tDiffuse;
    uniform float uAberration;
    uniform float uVignette;
    uniform vec3 uFlash;
    uniform float uFlashAmount;
    uniform float uDesat;
    varying vec2 vUv;
    void main() {
      vec2 d = vUv - 0.5;
      float r2 = dot(d, d);
      vec2 off = d * (uAberration * (0.4 + r2 * 3.0));
      vec3 c;
      c.r = texture2D(tDiffuse, vUv + off).r;
      c.g = texture2D(tDiffuse, vUv).g;
      c.b = texture2D(tDiffuse, vUv - off).b;
      float l = dot(c, vec3(0.299, 0.587, 0.114));
      c = mix(c, vec3(l), uDesat);
      c *= 1.0 - uVignette * smoothstep(0.15, 0.75, r2 * 2.2);
      c = mix(c, uFlash, uFlashAmount);
      gl_FragColor = vec4(c, 1.0);
    }
  `,
};

// 펄스 종류별: 섬광 색·세기, 색수차 세기, 지속(초)
const PULSES = {
  hit: { flash: 0xffffff, flashAmt: 0.0, aberration: 0.0035, seconds: 0.18 },
  meteor: { flash: 0xffd9a0, flashAmt: 0.12, aberration: 0.005, seconds: 0.3 },
  emp: { flash: 0xb58cff, flashAmt: 0.18, aberration: 0.008, seconds: 0.45 },
  ko: { flash: 0xffffff, flashAmt: 0.35, aberration: 0.012, seconds: 0.6 },
  overdrive: { flash: 0xff2bd6, flashAmt: 0.3, aberration: 0.014, seconds: 0.7 },
  fusion: { flash: 0xffe29a, flashAmt: 0.5, aberration: 0.01, seconds: 0.9 },
};

export function createPostfx(r, { space = null } = {}) {
  const { renderer, scene, camera } = r;
  const size = new THREE.Vector2();
  renderer.getSize(size);
  const pr = renderer.getPixelRatio();

  const composer = new EffectComposer(renderer);
  composer.setPixelRatio(pr);
  composer.setSize(size.x, size.y);
  const renderPass = new RenderPass(scene, camera);
  const bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.6, 0.6, 0.85);
  const final = new ShaderPass(FinalShader);
  const output = new OutputPass();
  composer.addPass(renderPass);
  composer.addPass(bloom);
  composer.addPass(final);
  composer.addPass(output);

  let enabled = true;
  let bloomBase = (space || r.space)?.scene?.bloom ?? 0.6;
  let slowmo = 0;
  const pulses = []; // { def, t }
  const u = final.uniforms;

  function applyQuality(q) {
    enabled = Boolean(q.postfx);
    bloom.enabled = Boolean(q.bloom);
    bloom.strength = bloomBase;
  }
  applyQuality(r.quality);

  const offQuality = r.onQuality((q) => applyQuality(q));
  const offSpace = r.onSpace((sp) => {
    bloomBase = sp.scene.bloom ?? 0.6;
    bloom.strength = bloomBase;
  });
  const offResize = r.onResize((w, h) => {
    composer.setPixelRatio(renderer.getPixelRatio());
    composer.setSize(w, h);
  });

  // 펄스 감쇠는 프레임 구독으로 처리
  const offFrame = r.onFrame((dt) => {
    let flashAmt = 0;
    let aberration = 0;
    const flashColor = new THREE.Color(0xffffff);
    for (let i = pulses.length - 1; i >= 0; i--) {
      const p = pulses[i];
      p.t += dt;
      const k = Math.max(0, 1 - p.t / p.def.seconds);
      if (k <= 0) {
        pulses.splice(i, 1);
        continue;
      }
      const e = k * k;
      if (p.def.flashAmt * e > flashAmt) {
        flashAmt = p.def.flashAmt * e;
        flashColor.set(p.def.flash);
      }
      aberration = Math.max(aberration, p.def.aberration * e);
    }
    u.uFlashAmount.value = flashAmt;
    u.uFlash.value.copy(flashColor);
    u.uAberration.value = aberration;
    u.uDesat.value = slowmo * 0.45;
    u.uVignette.value = 0.25 + slowmo * 0.35;
    // 펄스 동안 블룸을 조금 키운다
    bloom.strength = bloomBase + flashAmt * 1.2;
  });

  r.customRender = (dt) => {
    if (enabled) composer.render(dt);
    else renderer.render(scene, camera);
  };

  const api = {
    composer, bloom, final,
    get enabled() { return enabled; },
    setEnabled(on) { enabled = Boolean(on); },
    setBloom(v) { bloomBase = v; bloom.strength = v; },
    setSlowmo(v) { slowmo = Math.max(0, Math.min(1, v)); },
    pulse(kind) {
      const def = PULSES[kind];
      if (!def) return;
      // 같은 종류가 연달아 오면 새로 시작(쌓이지 않음)
      const same = pulses.find((p) => p.def === def);
      if (same) same.t = 0;
      else pulses.push({ def, t: 0 });
    },
    // 서버 사건 → 펄스. 크기가 작은 피격은 무시하고 큰 것만 반응한다.
    onEvent(ev) {
      switch (ev.type) {
        case 'hit': if ((ev.amount || 0) >= 40) api.pulse('hit'); break;
        case 'ram': api.pulse('hit'); break;
        case 'meteor_impact': api.pulse('meteor'); break;
        case 'emp': api.pulse('emp'); break;
        case 'ko': api.pulse('ko'); break;
        case 'overdrive': api.pulse('overdrive'); break;
        case 'fusion_start': case 'fusion_end': api.pulse('fusion'); break;
        default: break;
      }
    },
    dispose() {
      offQuality(); offSpace(); offResize(); offFrame();
      if (r.customRender) r.customRender = null;
      composer.dispose?.();
    },
  };
  return api;
}

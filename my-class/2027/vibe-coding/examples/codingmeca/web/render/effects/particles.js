// web/render/effects/particles.js  (41번)
// 입자 시스템: 풀링된 Points 두 벌(가산 합성 = 불꽃·빛, 일반 합성 = 연기·먼지)과 자주 쓰는 방출 함수.
// 입자 수는 화질(QUALITY.particleMult)을 따른다. 모든 연산은 CPU(Float32Array)라 장면 정리가 쉽다.
//
//   const fx = createParticles(scene, { quality });
//   fx.sparks(pos, '#FFB347', 12);   fx.smoke(pos);   fx.explosion(pos, 1.5, '#FF8A3D');
//   매 프레임 fx.update(dt)

import * as THREE from 'three';

const VERT = /* glsl */ `
attribute float aSize;
attribute float aAlpha;
attribute vec3 aColor;
varying float vAlpha;
varying vec3 vColor;
void main() {
  vAlpha = aAlpha;
  vColor = aColor;
  vec4 mv = modelViewMatrix * vec4(position, 1.0);
  gl_PointSize = aSize * (260.0 / -mv.z);
  gl_Position = projectionMatrix * mv;
}`;
const FRAG = /* glsl */ `
varying float vAlpha;
varying vec3 vColor;
uniform float uSoft;
void main() {
  vec2 d = gl_PointCoord - 0.5;
  float r = length(d) * 2.0;
  float a = smoothstep(1.0, mix(0.9, 0.0, uSoft), r) * vAlpha;
  if (a < 0.01) discard;
  gl_FragColor = vec4(vColor, a);
}`;

class Pool {
  constructor(scene, max, { additive, soft }) {
    this.max = max;
    this.head = 0;
    this.pos = new Float32Array(max * 3);
    this.vel = new Float32Array(max * 3);
    this.col = new Float32Array(max * 3);
    this.size = new Float32Array(max);
    this.alpha = new Float32Array(max);
    // 수명·변화
    this.life = new Float32Array(max); // 남은 시간
    this.maxLife = new Float32Array(max);
    this.size0 = new Float32Array(max);
    this.grow = new Float32Array(max); // 초당 크기 배율 변화
    this.grav = new Float32Array(max);
    this.drag = new Float32Array(max);
    const g = new THREE.BufferGeometry();
    g.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aColor', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aSize', new THREE.BufferAttribute(this.size, 1).setUsage(THREE.DynamicDrawUsage));
    g.setAttribute('aAlpha', new THREE.BufferAttribute(this.alpha, 1).setUsage(THREE.DynamicDrawUsage));
    const m = new THREE.ShaderMaterial({
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: additive ? THREE.AdditiveBlending : THREE.NormalBlending,
      uniforms: { uSoft: { value: soft ? 1 : 0 } },
    });
    this.points = new THREE.Points(g, m);
    this.points.frustumCulled = false;
    this.points.renderOrder = additive ? 20 : 10;
    scene.add(this.points);
  }

  emit(o) {
    const i = this.head;
    this.head = (this.head + 1) % this.max;
    const k = i * 3;
    this.pos[k] = o.x; this.pos[k + 1] = o.y; this.pos[k + 2] = o.z;
    this.vel[k] = o.vx; this.vel[k + 1] = o.vy; this.vel[k + 2] = o.vz;
    this.col[k] = o.r; this.col[k + 1] = o.g; this.col[k + 2] = o.b;
    this.size0[i] = o.size;
    this.size[i] = o.size;
    this.alpha[i] = o.alpha;
    this.life[i] = o.life;
    this.maxLife[i] = o.life;
    this.grow[i] = o.grow;
    this.grav[i] = o.grav;
    this.drag[i] = o.drag;
  }

  update(dt) {
    const { pos, vel, life, maxLife, size, size0, alpha, grow, grav, drag } = this;
    for (let i = 0; i < this.max; i++) {
      if (life[i] <= 0) { if (alpha[i] !== 0) { alpha[i] = 0; size[i] = 0; } continue; }
      life[i] -= dt;
      const k = i * 3;
      const dr = Math.max(0, 1 - drag[i] * dt);
      vel[k] *= dr; vel[k + 1] = vel[k + 1] * dr - grav[i] * dt; vel[k + 2] *= dr;
      pos[k] += vel[k] * dt; pos[k + 1] += vel[k + 1] * dt; pos[k + 2] += vel[k + 2] * dt;
      const t = Math.max(0, life[i] / maxLife[i]); // 1 → 0
      size[i] = size0[i] * (1 + grow[i] * (1 - t));
      alpha[i] = t < 0.3 ? t / 0.3 : 1;
      if (life[i] <= 0) { alpha[i] = 0; size[i] = 0; }
    }
    const a = this.points.geometry.attributes;
    a.position.needsUpdate = true; a.aColor.needsUpdate = true; a.aSize.needsUpdate = true; a.aAlpha.needsUpdate = true;
  }
}

const tmp = new THREE.Color();
const rnd = (a, b) => a + Math.random() * (b - a); // 화면 연출 전용(시뮬레이션과 무관하므로 Math.random 허용)

export function createParticles(scene, { quality, maxAdd = 3000, maxSmoke = 1500 } = {}) {
  let mult = quality?.particleMult ?? 1;
  const add = new Pool(scene, maxAdd, { additive: true, soft: false });
  const smokePool = new Pool(scene, maxSmoke, { additive: false, soft: true });

  const count = (n) => Math.max(1, Math.round(n * mult));
  const col = (c) => tmp.set(c);

  // 한 입자 방출 보조
  function put(pool, p, o) {
    col(o.color);
    pool.emit({
      x: p.x, y: p.y, z: p.z, vx: o.vx, vy: o.vy, vz: o.vz,
      r: tmp.r, g: tmp.g, b: tmp.b, size: o.size, alpha: o.alpha ?? 1, life: o.life,
      grow: o.grow ?? 0, grav: o.grav ?? 0, drag: o.drag ?? 0,
    });
  }

  const api = {
    get mult() { return mult; },
    setQuality(q) { mult = q.particleMult; },

    // 불꽃 튀김
    sparks(p, color = '#FFB347', n = 10, speed = 6) {
      for (let i = 0; i < count(n); i++) {
        const a = rnd(0, Math.PI * 2);
        const e = rnd(-0.2, 1);
        const s = rnd(0.4, 1) * speed;
        put(add, p, { color, vx: Math.cos(a) * s, vy: e * s, vz: Math.sin(a) * s, size: rnd(0.18, 0.32), life: rnd(0.25, 0.6), grav: 9, drag: 1.5 });
      }
    },

    // 연기 한 덩이 (파손 파츠가 계속 내뿜을 때 호출)
    smoke(p, { color = '#3A3F48', size = 0.9, life = 1.4, rise = 1.4 } = {}) {
      if (Math.random() > mult) return;
      put(smokePool, p, { color, vx: rnd(-0.3, 0.3), vy: rise * rnd(0.7, 1.2), vz: rnd(-0.3, 0.3), size, alpha: 0.55, life, grow: 2.2, drag: 0.4 });
    },

    // 폭발: 빛 + 불꽃 + 연기
    explosion(p, scale = 1, color = '#FF8A3D') {
      for (let i = 0; i < count(26 * scale); i++) {
        const a = rnd(0, Math.PI * 2);
        const e = rnd(-0.4, 1);
        const s = rnd(2, 9) * scale;
        put(add, p, { color, vx: Math.cos(a) * s, vy: Math.abs(e) * s, vz: Math.sin(a) * s, size: rnd(0.3, 0.7) * scale, life: rnd(0.35, 0.8), grav: 4, drag: 2, grow: -0.3 });
      }
      for (let i = 0; i < count(10 * scale); i++) {
        const a = rnd(0, Math.PI * 2);
        put(smokePool, p, { color: '#2A2E36', vx: Math.cos(a) * rnd(0.5, 2.5), vy: rnd(0.8, 3), vz: Math.sin(a) * rnd(0.5, 2.5), size: rnd(1, 1.8) * scale, alpha: 0.6, life: rnd(1, 1.8), grow: 2.5, drag: 0.8 });
      }
      put(add, p, { color: '#FFFFFF', vx: 0, vy: 0, vz: 0, size: 4.5 * scale, life: 0.18, grow: 1.5 });
    },

    // 빛 입자 소용돌이/분해 (융합·충전 연출용): 중심 방향 또는 바깥 방향으로 흐르는 입자
    stream(from, to, color = '#FFE29A', n = 3, speed = 5) {
      for (let i = 0; i < count(n); i++) {
        const dx = to.x - from.x, dy = to.y - from.y, dz = to.z - from.z;
        const l = Math.hypot(dx, dy, dz) || 1;
        const s = speed * rnd(0.7, 1.2);
        put(add, from, { color, vx: (dx / l) * s + rnd(-0.5, 0.5), vy: (dy / l) * s + rnd(-0.5, 0.5), vz: (dz / l) * s + rnd(-0.5, 0.5), size: rnd(0.15, 0.3), life: l / s, drag: 0 });
      }
    },

    // 한 점에서 사방으로 퍼지는 빛 고리 입자 (충격파용 보조)
    ring(p, color = '#FFFFFF', radius = 3, n = 40, y = 0.2) {
      for (let i = 0; i < count(n); i++) {
        const a = (i / n) * Math.PI * 2;
        put(add, { x: p.x, y: p.y + y, z: p.z }, { color, vx: Math.cos(a) * radius * 2.2, vy: 0, vz: Math.sin(a) * radius * 2.2, size: 0.3, life: 0.45, drag: 3.5 });
      }
    },

    // 먼지(이동 연출): 바닥에서 낮게 퍼지는 연기
    dust(p, color = '#8A8F99') {
      if (Math.random() > mult) return;
      put(smokePool, { x: p.x, y: 0.2, z: p.z }, { color, vx: rnd(-0.4, 0.4), vy: rnd(0.2, 0.6), vz: rnd(-0.4, 0.4), size: 0.7, alpha: 0.35, life: 0.8, grow: 2, drag: 1 });
    },

    // 빛 한 점(무기 총구 섬광·투사체 꼬리)
    glow(p, color = '#FFFFFF', size = 1, life = 0.15) {
      put(add, p, { color, vx: 0, vy: 0, vz: 0, size, life, grow: -0.4 });
    },

    // 꼬리: 지나간 자리에 작은 빛을 남김
    trail(p, color = '#FFB347', size = 0.35) {
      put(add, p, { color, vx: rnd(-0.2, 0.2), vy: rnd(-0.2, 0.2), vz: rnd(-0.2, 0.2), size, life: 0.35, grow: -0.5 });
    },

    update(dt) {
      add.update(dt);
      smokePool.update(dt);
    },
    clear() {
      add.life.fill(0);
      smokePool.life.fill(0);
    },
    dispose() {
      for (const p of [add, smokePool]) {
        scene.remove(p.points);
        p.points.geometry.dispose();
        p.points.material.dispose();
      }
    },
  };
  return api;
}

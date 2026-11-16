// web/render/effects/weapon-fx.js  (42번)
// 전투 이펙트: 스냅샷의 사건(ev)·투사체(proj)·예고(warn)를 받아 무기별 이펙트와 피격·파손·격파 연출을 만든다.
// 실드 육각 패턴(createShieldDome)도 여기에 있다. 시뮬레이션 상태는 읽기만 한다. (명세 v1.0 19장)
//
//   const fx = createBattleFx({ scene, particles, getView: (id) => robotView });
//   스냅샷마다: fx.syncProjectiles(snap.proj); fx.syncWarnings(snap.warn); snap.ev.forEach(fx.handleEvent);
//   매 프레임:  fx.update(dt, time)

import * as THREE from 'three';
import { EFFECT_COLORS } from '../../../config/theme.js';

const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
const rnd = (a, b) => a + Math.random() * (b - a);

// ── 실드 육각 패턴 ───────────────────────────────────────
const DOME_VERT = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vView;
void main() {
  vPos = position;
  vec4 wp = modelMatrix * vec4(position, 1.0);
  vNormalW = normalize(mat3(modelMatrix) * normal);
  vView = normalize(cameraPosition - wp.xyz);
  gl_Position = projectionMatrix * viewMatrix * wp;
}`;
const DOME_FRAG = /* glsl */ `
varying vec3 vPos;
varying vec3 vNormalW;
varying vec3 vView;
uniform vec3 uColor;
uniform float uTime;
uniform float uAlpha;
uniform vec4 uRipple[4];
// 육각 격자 거리 (선 두께용)
float hex(vec2 p) {
  p = abs(p);
  return max(dot(p, normalize(vec2(1.0, 1.7320508))), p.x);
}
vec4 hexCoords(vec2 uv) {
  vec2 r = vec2(1.0, 1.7320508);
  vec2 h = r * 0.5;
  vec2 a = mod(uv, r) - h;
  vec2 b = mod(uv - h, r) - h;
  vec2 gv = dot(a, a) < dot(b, b) ? a : b;
  return vec4(gv, uv - gv);
}
void main() {
  vec3 n = normalize(vPos);
  // 구면 좌표 → 평면 격자 (극에서 약간 늘어나도 무방)
  vec2 uv = vec2(atan(n.z, n.x) * 3.2, n.y * 5.0);
  vec4 hc = hexCoords(uv);
  float edge = smoothstep(0.38, 0.5, hex(hc.xy));
  float fres = pow(1.0 - max(dot(normalize(vNormalW), vView), 0.0), 2.2);
  // 파문
  float rip = 0.0;
  for (int i = 0; i < 4; i++) {
    vec4 r = uRipple[i];
    if (r.w > 0.0) {
      float age = uTime - r.w;
      if (age > 0.0 && age < 0.9) {
        float d = distance(n, normalize(r.xyz));
        rip += smoothstep(0.18, 0.0, abs(d - age * 1.3)) * (1.0 - age / 0.9);
      }
    }
  }
  float a = (0.06 + edge * 0.35 + fres * 0.5 + rip * 0.9) * uAlpha;
  gl_FragColor = vec4(uColor * (0.8 + rip * 1.5), a);
}`;

export function createShieldDome(radius, color = EFFECT_COLORS.shield) {
  const group = new THREE.Group();
  const uniforms = {
    uColor: { value: new THREE.Color(color) }, uTime: { value: 0 }, uAlpha: { value: 0 },
    uRipple: { value: [V4(), V4(), V4(), V4()] },
  };
  function V4() { return new THREE.Vector4(0, 0, 0, -10); }
  const mesh = new THREE.Mesh(
    new THREE.SphereGeometry(radius, 32, 20),
    new THREE.ShaderMaterial({ vertexShader: DOME_VERT, fragmentShader: DOME_FRAG, uniforms, transparent: true, depthWrite: false, side: THREE.DoubleSide, blending: THREE.AdditiveBlending }),
  );
  mesh.renderOrder = 15;
  group.add(mesh);
  let time = 0;
  let target = 0;
  let shatterT = -1;
  let rippleIdx = 0;
  return {
    group,
    setVisible(on) { if (shatterT < 0) target = on ? 1 : 0; },
    // 월드 좌표의 충격 위치에 파문
    ripple(worldPoint) {
      const local = group.worldToLocal(worldPoint.clone());
      uniforms.uRipple.value[rippleIdx].set(local.x, local.y, local.z, time);
      rippleIdx = (rippleIdx + 1) % 4;
    },
    shatter() { shatterT = 0; target = 0; },
    update(dt) {
      time += dt;
      uniforms.uTime.value = time;
      if (shatterT >= 0) {
        shatterT += dt;
        mesh.scale.setScalar(1 + shatterT * 1.2);
        uniforms.uAlpha.value = Math.max(0, 1 - shatterT / 0.4) * 1.5;
        if (shatterT > 0.4) { shatterT = -1; mesh.scale.setScalar(1); uniforms.uAlpha.value = 0; }
      } else {
        uniforms.uAlpha.value += (target - uniforms.uAlpha.value) * Math.min(1, dt * 8);
      }
      group.visible = uniforms.uAlpha.value > 0.01;
    },
    dispose() { mesh.geometry.dispose(); mesh.material.dispose(); group.parent?.remove(group); },
  };
}

// ── 전투 이펙트 허브 ─────────────────────────────────────
const MELEE = new Set(['wp_claw', 'wp_fang', 'wp_tail', 'wp_spin_h', 'wp_spin_v', 'wp_hammer', 'wp_lift']);

export function createBattleFx({ scene, particles, getView }) {
  const group = new THREE.Group();
  group.name = 'battle-fx';
  scene.add(group);

  const timed = []; // { obj, life, max, update(t01) }
  const breaths = []; // 지속 브레스
  const projMeshes = new Map(); // id → { obj, kind, last }
  const markers = []; // 예고 표시 풀
  const state = { empWarning: false, shrinkWarning: false, spikesWarning: false };

  const addTimed = (obj, life, update) => {
    group.add(obj);
    timed.push({ obj, life, max: life, update });
  };

  // 빛줄기: a→b 사이 원기둥
  const beamGeo = new THREE.CylinderGeometry(1, 1, 1, 8, 1, true);
  beamGeo.userData.shared = true;
  function beam(a, b, color, width, life) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(beamGeo, mat);
    const dir = b.clone().sub(a);
    const len = dir.length();
    m.position.copy(a).addScaledVector(dir, 0.5);
    m.quaternion.setFromUnitVectors(V(0, 1, 0), dir.normalize());
    m.scale.set(width, len, width);
    addTimed(m, life, (t) => { mat.opacity = t; m.scale.x = m.scale.z = width * (0.3 + 0.7 * t); });
    return m;
  }

  // 번개: 꺾인 선
  function lightning(a, b, color, life = 0.25) {
    const pts = [];
    const n = 9;
    const mat = new THREE.LineBasicMaterial({ color, transparent: true, opacity: 1, blending: THREE.AdditiveBlending });
    const line = new THREE.Line(new THREE.BufferGeometry(), mat);
    const rebuild = () => {
      pts.length = 0;
      for (let i = 0; i <= n; i++) {
        const t = i / n;
        const p = a.clone().lerp(b, t);
        if (i > 0 && i < n) p.add(V(rnd(-0.5, 0.5), rnd(-0.5, 0.5), rnd(-0.5, 0.5)));
        pts.push(p);
      }
      line.geometry.setFromPoints(pts);
    };
    rebuild();
    let acc = 0;
    addTimed(line, life, (t, dt) => { acc += dt; if (acc > 0.04) { acc = 0; rebuild(); } mat.opacity = t; });
  }

  // 퍼지는 고리 (수평 또는 구 표면 느낌)
  const ringGeo = new THREE.RingGeometry(0.92, 1, 40);
  ringGeo.userData.shared = true;
  function ring(pos, color, r0, r1, life, vertical = null) {
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 0.9, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const m = new THREE.Mesh(ringGeo, mat);
    m.position.copy(pos);
    if (vertical) m.quaternion.setFromUnitVectors(V(0, 0, 1), vertical);
    else m.rotation.x = -Math.PI / 2;
    addTimed(m, life, (t) => { const k = r0 + (r1 - r0) * (1 - t); m.scale.set(k, k, k); mat.opacity = t * 0.9; });
  }

  // 베기 호: 공격자 → 대상 방향의 휘어진 빛
  function slash(from, to, color = '#FFFFFF', life = 0.22) {
    const dir = to.clone().sub(from);
    const len = Math.min(dir.length(), 3);
    dir.normalize();
    const mat = new THREE.MeshBasicMaterial({ color, transparent: true, opacity: 1, side: THREE.DoubleSide, blending: THREE.AdditiveBlending, depthWrite: false });
    const geo = new THREE.RingGeometry(len * 0.45, len * 0.55, 20, 1, 0, Math.PI * 0.7);
    const m = new THREE.Mesh(geo, mat);
    m.position.copy(from).addScaledVector(dir, len * 0.4);
    const axis = V(0, 1, 0).cross(dir);
    if (axis.lengthSq() < 1e-6) axis.set(1, 0, 0);
    m.quaternion.setFromUnitVectors(V(0, 0, 1), axis.normalize());
    m.rotation.z += rnd(-0.6, 0.6);
    addTimed(m, life, (t) => { mat.opacity = t; m.scale.setScalar(0.8 + (1 - t) * 0.5); });
    // geo는 timed 종료 때 obj.geometry로 정리된다
  }

  const centerOf = (id) => getView(id)?.getCenterWorldPos(V()) ?? null;
  const dmgColor = (t) => EFFECT_COLORS[t] || EFFECT_COLORS.physical;

  // ── 사건 처리 ──
  function handleEvent(ev) {
    switch (ev.type) {
      case 'fire': {
        const v = getView(ev.entity);
        const tv = getView(ev.target);
        if (!v) break;
        const muzzle = v.getMuzzleWorldPos(ev.uid, V());
        const tpos = tv ? tv.getCenterWorldPos(V()) : muzzle.clone().add(V(0, 0, -5));
        v.flashPart(ev.uid, '#FFD9A0');
        particles?.glow(muzzle, '#FFE0A0', 1.4, 0.12);
        const w = ev.weapon;
        if (MELEE.has(w)) {
          slash(muzzle, tpos, w === 'wp_spin_h' || w === 'wp_spin_v' ? '#B8E4FF' : '#FFFFFF');
          particles?.sparks(muzzle.clone().lerp(tpos, 0.3), '#FFD9A0', 6, 4);
        } else if (w === 'wp_laser') {
          beam(muzzle, tpos, '#FF3D5A', 0.12, 0.16);
        } else if (w === 'wp_stun') {
          lightning(muzzle, tpos, '#B58CFF');
        } else if (w === 'wp_emp') {
          ring(v.getCenterWorldPos(V()), '#B58CFF', 1, 14, 0.5);
        } else if (w === 'wp_grav') {
          ring(muzzle, '#8A6CFF', 0.5, 6, 0.6, tpos.clone().sub(muzzle).normalize());
          ring(tpos, '#8A6CFF', 5, 0.5, 0.6);
        } else if (w === 'wp_nano') {
          for (let i = 0; i < 14; i++) particles?.smoke(tpos.clone().add(V(rnd(-1.5, 1.5), rnd(-0.5, 1.5), rnd(-1.5, 1.5))), { color: '#4DFF7A', size: 0.8, life: 1.2, rise: 0.4 });
        } else if (w === 'wp_breath') {
          breaths.push({ view: v, uid: ev.uid, target: ev.target, until: performance.now() / 1000 + 1.4 });
        }
        break;
      }
      case 'rail': {
        const a = V(ev.x, 1.4, ev.z);
        const b = a.clone().addScaledVector(V(ev.dx, 0, ev.dz), ev.length);
        beam(a, b, '#9FF3FF', 0.35, 0.4);
        beam(a, b, '#FFFFFF', 0.12, 0.3);
        particles?.ring(a, '#9FF3FF', 3, 30, 1.4);
        break;
      }
      case 'hit': {
        const v = getView(ev.victim);
        if (!v) break;
        const pos = ev.uid ? v.getPartWorldPos(ev.uid, V()) : v.getCenterWorldPos(V());
        const c = dmgColor(ev.damageType);
        particles?.sparks(pos, c, Math.min(26, 5 + Math.sqrt(ev.amount || 1) * 2), 5 + Math.min(6, (ev.amount || 0) * 0.08));
        particles?.glow(pos, c, 1.2, 0.1);
        if (ev.uid) v.flashPart(ev.uid, c);
        if (ev.absorbed > 0) v.ripple(pos);
        break;
      }
      case 'absorbed': {
        const v = getView(ev.entity);
        v?.ripple(v.getCenterWorldPos(V()).add(V(0, 0.5, 0)));
        break;
      }
      case 'shield_break': {
        const v = getView(ev.entity);
        if (v) { v.breakShield(); particles?.sparks(v.getCenterWorldPos(V()), EFFECT_COLORS.shield, 24, 7); }
        break;
      }
      case 'part_broken': {
        const v = getView(ev.entity);
        if (!v) break;
        const pos = v.getPartWorldPos(ev.uid, V());
        particles?.sparks(pos, '#FFB347', 16, 6);
        for (let i = 0; i < 4; i++) particles?.smoke(pos);
        break;
      }
      case 'part_lost': {
        const v = getView(ev.entity);
        if (v && ev.uids?.length) particles?.explosion(v.getPartWorldPos(ev.uids[0], V()), 0.9, '#FF8A3D');
        break;
      }
      case 'ko': {
        const v = getView(ev.entity);
        if (!v) break;
        const c = v.getCenterWorldPos(V());
        particles?.explosion(c, 2.4, '#FF8A3D');
        particles?.ring(c, '#FFFFFF', 6, 60, 0.3);
        ring(V(c.x, 0.1, c.z), '#FFB347', 1, 12, 0.7);
        break;
      }
      case 'ram': {
        const p = V(ev.point.x, 1.2, ev.point.z);
        particles?.sparks(p, '#FFFFFF', 20, 8);
        particles?.explosion(p, 0.7, '#FFB347');
        break;
      }
      case 'meteor_impact': {
        const p = V(ev.x, 0.2, ev.z);
        particles?.explosion(p, 2.6, '#FF6A3D');
        ring(p, '#FF6A3D', 0.5, ev.radius ?? 4, 0.6);
        break;
      }
      case 'spikes_fire': {
        const p = V(ev.x, 0.2, ev.z);
        particles?.sparks(p, '#FF5A5A', 18, 9);
        ring(p, '#FF5A5A', 0.4, ev.radius ?? 2, 0.35);
        break;
      }
      case 'emp': {
        const v = getView(ev.entity);
        if (v) { ring(v.getCenterWorldPos(V()), '#B58CFF', 1, 5, 0.5); v.flashAll('#B58CFF'); }
        break;
      }
      case 'overdrive': {
        const v = getView(ev.entity);
        if (!v) break;
        const c = v.getCenterWorldPos(V());
        particles?.ring(c, '#FF5A3D', 5, 60, 0.4);
        particles?.explosion(v.getMuzzleWorldPos(ev.uid, V()), 1.2, '#FF5A3D');
        v.flashAll('#FF5A3D');
        break;
      }
      case 'skill':
      case 'phase': {
        const v = getView(ev.entity);
        if (v) { ring(v.getCenterWorldPos(V()), ev.type === 'phase' ? '#B58CFF' : '#4DFFB5', 0.5, 5, 0.5); v.flashAll(ev.type === 'phase' ? '#B58CFF' : '#4DFFB5'); }
        break;
      }
      case 'revive': {
        const v = getView(ev.entity);
        if (v) { particles?.explosion(v.getCenterWorldPos(V()), 1.2, '#FFE29A'); v.flashAll('#FFE29A'); }
        break;
      }
      case 'dodged': {
        const v = getView(ev.entity);
        if (v) particles?.sparks(v.getCenterWorldPos(V()), '#FFFFFF', 6, 5);
        break;
      }
      case 'intercepted':
      case 'projectile_blocked': {
        const p = V(ev.x, 1.6, ev.z);
        particles?.explosion(p, 0.5, '#9FF3FF');
        break;
      }
      case 'flip': {
        const v = getView(ev.entity);
        if (v) particles?.sparks(v.getCenterWorldPos(V()), '#FFFFFF', 10, 6);
        break;
      }
      default:
        break;
    }
  }

  // ── 투사체 동기화 ──
  function makeProjectile(kind) {
    const g = new THREE.Group();
    if (kind === 'wp_missile') {
      const body = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.6, 8), new THREE.MeshStandardMaterial({ color: '#C9D0DA', metalness: 0.6, roughness: 0.4 }));
      body.rotation.x = -Math.PI / 2; // 원뿔 끝이 −z
      g.add(body);
    } else {
      const core = new THREE.Mesh(new THREE.SphereGeometry(0.28, 12, 10), new THREE.MeshBasicMaterial({ color: '#7CF3FF' }));
      const halo = new THREE.Mesh(new THREE.SphereGeometry(0.5, 12, 10), new THREE.MeshBasicMaterial({ color: '#4DE1FF', transparent: true, opacity: 0.35, blending: THREE.AdditiveBlending, depthWrite: false }));
      g.add(core, halo);
    }
    group.add(g);
    return g;
  }

  function syncProjectiles(list = []) {
    const seen = new Set();
    for (const p of list) {
      seen.add(p.id);
      let rec = projMeshes.get(p.id);
      if (!rec) {
        rec = { obj: makeProjectile(p.k), kind: p.k, pos: V(p.x, 1.6, p.z), init: false };
        projMeshes.set(p.id, rec);
      }
      const next = V(p.x, 1.6, p.z);
      if (rec.init) {
        const d = next.clone().sub(rec.pos);
        if (d.lengthSq() > 1e-4) rec.obj.quaternion.setFromUnitVectors(V(0, 0, -1), d.normalize());
      }
      rec.pos.copy(next);
      rec.init = true;
      rec.obj.position.copy(rec.pos);
      particles?.trail(rec.pos, rec.kind === 'wp_missile' ? '#FFB347' : '#4DE1FF', rec.kind === 'wp_missile' ? 0.4 : 0.5);
    }
    for (const [id, rec] of projMeshes) {
      if (seen.has(id)) continue;
      particles?.explosion(rec.pos, rec.kind === 'wp_missile' ? 0.7 : 0.4, rec.kind === 'wp_missile' ? '#FF8A3D' : '#4DE1FF');
      rec.obj.parent?.remove(rec.obj);
      rec.obj.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      projMeshes.delete(id);
    }
  }

  // ── 전장 예고 표시 (운석 낙하 지점 등) ──
  const markerGeo = new THREE.RingGeometry(0.9, 1, 40);
  function syncWarnings(list = []) {
    state.empWarning = list.some((w) => w.k === 'emp');
    state.shrinkWarning = list.some((w) => w.k === 'shrink');
    state.spikesWarning = list.some((w) => w.k === 'spikes');
    const withPos = list.filter((w) => w.x !== null && w.x !== undefined && w.r);
    while (markers.length < withPos.length) {
      const mat = new THREE.MeshBasicMaterial({ color: '#FF4D4D', transparent: true, opacity: 0.7, side: THREE.DoubleSide, depthWrite: false });
      const m = new THREE.Mesh(markerGeo, mat);
      m.rotation.x = -Math.PI / 2;
      m.position.y = 0.06;
      const inner = new THREE.Mesh(new THREE.CircleGeometry(1, 32), new THREE.MeshBasicMaterial({ color: '#FF4D4D', transparent: true, opacity: 0.2, depthWrite: false }));
      m.add(inner);
      group.add(m);
      markers.push(m);
    }
    markers.forEach((m, i) => {
      const w = withPos[i];
      m.visible = Boolean(w);
      if (!w) return;
      m.position.x = w.x;
      m.position.z = w.z;
      m.scale.setScalar(w.r);
      const pulse = 0.5 + 0.5 * Math.sin(performance.now() / 90);
      m.material.opacity = 0.4 + 0.5 * pulse * (1 - Math.min(1, w.s / 1.6));
      m.children[0].scale.setScalar(Math.max(0.05, 1 - w.s / 1.6));
    });
  }

  function update(dt) {
    const now = performance.now() / 1000;
    for (let i = timed.length - 1; i >= 0; i--) {
      const t = timed[i];
      t.life -= dt;
      t.update(Math.max(0, t.life / t.max), dt);
      if (t.life <= 0) {
        group.remove(t.obj);
        if (!t.obj.geometry?.userData?.shared) t.obj.geometry?.dispose?.();
        t.obj.material?.dispose?.();
        t.onEnd?.();
        timed.splice(i, 1);
      }
    }
    for (let i = breaths.length - 1; i >= 0; i--) {
      const b = breaths[i];
      if (now > b.until) { breaths.splice(i, 1); continue; }
      const muzzle = b.view.getMuzzleWorldPos(b.uid, V());
      const tv = getView(b.target);
      const dir = (tv ? tv.getCenterWorldPos(V()) : muzzle.clone().add(V(0, 0, -5))).sub(muzzle).normalize();
      for (let k = 0; k < 4; k++) {
        const s = rnd(7, 12);
        particles?.sparks(muzzle.clone().addScaledVector(dir, rnd(0, 1)), Math.random() < 0.5 ? '#FF6A3D' : '#FFC857', 1, 0);
        particles?.smoke(muzzle.clone().addScaledVector(dir, rnd(1, 4)), { color: '#FF8A3D', size: 0.8, life: 0.7, rise: 0.3 });
        void s;
      }
    }
  }

  return {
    group, state, handleEvent, syncProjectiles, syncWarnings, update,
    beam, lightning, ring, // 다른 연출(오버드라이브·융합)에서도 쓸 수 있게 공개
    dispose() {
      for (const t of timed) { if (!t.obj.geometry?.userData?.shared) t.obj.geometry?.dispose?.(); t.obj.material?.dispose?.(); }
      timed.length = 0;
      for (const rec of projMeshes.values()) rec.obj.traverse((o) => { o.geometry?.dispose(); o.material?.dispose?.(); });
      projMeshes.clear();
      beamGeo.dispose(); ringGeo.dispose(); markerGeo.dispose();
      scene.remove(group);
    },
  };
}

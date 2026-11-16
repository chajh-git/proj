// web/scenes/scene-kit.js  (53~57번 공통 도구)
// 다섯 공간 장면이 함께 쓰는 재료: 장면 그룹 관리, 시간 예약, 배경 카메라 오빗, 클릭 감지, 재질·캔버스 화면.
// 장면 객체의 약속(app-shell.js): { mount(), unmount(), update(dt, t), onDrag(dx, dy), onWheel(dy), dispose() }

import * as THREE from 'three';

export const V = (x = 0, y = 0, z = 0) => new THREE.Vector3(x, y, z);
export const rnd = (a, b) => a + Math.random() * (b - a);
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);

// ── 재질 ─────────────────────────────────────────────────
export const steel = (color = '#59616E', rough = 0.55, metal = 0.8) => new THREE.MeshStandardMaterial({ color, roughness: rough, metalness: metal });
export const glow = (color, opacity = 1) => new THREE.MeshBasicMaterial({ color, transparent: opacity < 1, opacity, toneMapped: false });
export const additive = (color, opacity = 0.6) => new THREE.MeshBasicMaterial({ color, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, side: THREE.DoubleSide, toneMapped: false });
export const holoWire = (color, opacity = 0.7) => new THREE.MeshBasicMaterial({ color, wireframe: true, transparent: true, opacity, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false });

// 캔버스에 그린 그림을 화면(재질)으로: redraw()를 부를 때마다 갱신된다
export function canvasScreen(w, h, draw) {
  const canvas = document.createElement('canvas');
  canvas.width = w;
  canvas.height = h;
  const g = canvas.getContext('2d');
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const material = new THREE.MeshBasicMaterial({ map: tex, toneMapped: false });
  const redraw = (...a) => { draw(g, w, h, ...a); tex.needsUpdate = true; };
  redraw(0);
  return { canvas, g, tex, material, redraw };
}

// 상자 한 줄 만들기
export function box(w, h, d, mat, x = 0, y = 0, z = 0, parent = null) {
  const m = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent?.add(m);
  return m;
}
export function cyl(rt, rb, h, mat, x = 0, y = 0, z = 0, parent = null, seg = 20) {
  const m = new THREE.Mesh(new THREE.CylinderGeometry(rt, rb, h, seg), mat);
  m.position.set(x, y, z);
  m.castShadow = true;
  m.receiveShadow = true;
  parent?.add(m);
  return m;
}

// 모든 하위 자원 정리 (userData.shared 는 건드리지 않음)
export function disposeTree(obj) {
  obj.traverse((o) => {
    if (o.userData?.shared) return;
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => { x.map?.dispose?.(); x.dispose(); });
    else if (m) { m.map?.dispose?.(); m.dispose(); }
  });
  obj.parent?.remove(obj);
}

// ── 시간 예약(장면 시간 기준: 일시정지·화질과 무관하게 update(dt)로만 흐른다) ──
export function createScheduler() {
  const jobs = [];
  return {
    // sec 간격(±jitter 비율)으로 반복. 취소 함수를 돌려준다
    every(sec, fn, jitter = 0.3) {
      const j = { left: sec * rnd(0.3, 1), sec, jitter, fn, repeat: true };
      jobs.push(j);
      return () => { j.dead = true; };
    },
    after(sec, fn) {
      const j = { left: sec, fn, repeat: false };
      jobs.push(j);
      return () => { j.dead = true; };
    },
    update(dt) {
      for (let i = jobs.length - 1; i >= 0; i--) {
        const j = jobs[i];
        if (j.dead) { jobs.splice(i, 1); continue; }
        j.left -= dt;
        if (j.left > 0) continue;
        j.fn();
        if (j.repeat) j.left = j.sec * rnd(1 - j.jitter, 1 + j.jitter);
        else jobs.splice(i, 1);
      }
    },
    clear() { jobs.length = 0; },
  };
}

// ── 배경 카메라 오빗: 드래그로 돌리고 휠로 당기고, 가만히 두면 천천히 돈다 ──
export function createOrbit(camera, { target = V(0, 1, 0), dist = 14, yaw = 0.6, pitch = 0.35, minDist = 5, maxDist = 30, minPitch = 0.05, maxPitch = 1.35, autoSpeed = 0.06, idleSeconds = 4, damping = 6, yawLimit = null } = {}) {
  const goal = { yaw, pitch, dist, target: target.clone() };
  const cur = { yaw, pitch, dist, target: target.clone() };
  let idle = idleSeconds;
  const api = {
    goal,
    cur,
    autoSpeed,
    drag(dx, dy) {
      goal.yaw -= dx * 0.005;
      goal.pitch = clamp(goal.pitch + dy * 0.004, minPitch, maxPitch);
      if (yawLimit) goal.yaw = clamp(goal.yaw, yawLimit[0], yawLimit[1]);
      idle = 0;
    },
    wheel(dy) {
      goal.dist = clamp(goal.dist * (1 + dy * 0.0011), minDist, maxDist);
      idle = 0;
    },
    setTarget(p, k = null) { goal.target.copy(p); if (k === 0) cur.target.copy(p); },
    setView({ yaw: y, pitch: p, dist: d } = {}, instant = false) {
      if (y !== undefined) goal.yaw = y;
      if (p !== undefined) goal.pitch = p;
      if (d !== undefined) goal.dist = d;
      if (instant) Object.assign(cur, { yaw: goal.yaw, pitch: goal.pitch, dist: goal.dist });
    },
    update(dt) {
      idle += dt;
      if (idle > idleSeconds && api.autoSpeed) {
        goal.yaw += api.autoSpeed * dt;
        if (yawLimit && (goal.yaw > yawLimit[1] || goal.yaw < yawLimit[0])) api.autoSpeed *= -1;
      }
      const k = damp(damping, dt);
      cur.yaw += (goal.yaw - cur.yaw) * k;
      cur.pitch += (goal.pitch - cur.pitch) * k;
      cur.dist += (goal.dist - cur.dist) * k;
      cur.target.lerp(goal.target, k);
      const cp = Math.cos(cur.pitch);
      camera.position.set(cur.target.x + Math.sin(cur.yaw) * cp * cur.dist, cur.target.y + Math.sin(cur.pitch) * cur.dist, cur.target.z + Math.cos(cur.yaw) * cp * cur.dist);
      camera.lookAt(cur.target);
    },
  };
  return api;
}

// ── 장면 틀: 그룹 하나를 mount 때 붙이고 unmount 때 뗀다. 클릭 감지·화질 값도 여기서 ──
export function createSceneKit(ctx, { name = 'scene' } = {}) {
  const { scene, camera, renderer } = ctx;
  const root = new THREE.Group();
  root.name = name;
  const sched = createScheduler();
  const clickers = new Set();
  const canvas = renderer.canvas;
  let down = null;

  const onDown = (e) => { down = { x: e.clientX, y: e.clientY, t: performance.now() }; };
  const onUp = (e) => {
    if (!down) return;
    const moved = Math.hypot(e.clientX - down.x, e.clientY - down.y);
    const quick = performance.now() - down.t < 500;
    down = null;
    if (moved < 6 && quick) clickers.forEach((fn) => fn(e));
  };

  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();

  const kit = {
    THREE, root, sched, scene, camera, renderer,
    // 화질 3단계에 따른 생동감 배율(0.35~1)
    get detail() { return renderer.quality?.ambientDetail ?? 1; },
    count(n) { return Math.max(1, Math.round(n * kit.detail)); },
    add(obj) { root.add(obj); return obj; },
    // 화면 좌표(clientX/Y) → 장면 객체 맞추기
    pick(e, objects, recursive = true) {
      const r = canvas.getBoundingClientRect();
      ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
      ray.setFromCamera(ndc, camera);
      return ray.intersectObjects(objects, recursive);
    },
    onClick(fn) { clickers.add(fn); return () => clickers.delete(fn); },
    mount() {
      scene.add(root);
      canvas.addEventListener('pointerdown', onDown);
      canvas.addEventListener('pointerup', onUp);
    },
    unmount() {
      canvas.removeEventListener('pointerdown', onDown);
      canvas.removeEventListener('pointerup', onUp);
      scene.remove(root);
      sched.clear();
    },
    dispose() {
      kit.unmount();
      disposeTree(root);
      clickers.clear();
    },
    play(id, vol) { return ctx.audio?.play(id, { volume: vol }); },
  };
  return kit;
}

// 가까울수록 크게 들리는 소리(장면 안의 위치 → 볼륨 0~1)
export function proximity(camera, pos, near = 6, far = 40) {
  const d = camera.position.distanceTo(pos);
  return clamp(1 - (d - near) / (far - near), 0.05, 1);
}

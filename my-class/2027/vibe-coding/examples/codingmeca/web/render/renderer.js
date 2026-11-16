// web/render/renderer.js  (36번)
// Three.js 렌더러 래퍼: 장면·카메라·조명·바닥, 공간별 색감 적용, 화질 3단계와 자동 하향, 프레임 상한, 렌더 루프.
// 모든 공간(격납고·신경 연산실·관제 스크린 …)이 이 래퍼 위에 자기 장면 객체를 올린다. (명세 v1.0 14-1)
//
// 사용
//   const r = createRenderer({ canvas, space: 'arena', quality: 'high' });
//   r.onFrame((dt, t) => { ... });   // 매 프레임 호출(구독 해제 함수를 돌려줌)
//   r.start();
// three는 import map의 'three'를 쓴다(진입 HTML 참고).

import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { resolveSpace, QUALITY, QUALITY_ORDER, downgradeQuality } from '../../config/theme.js';
import { CONSTANTS } from '../../config/constants.js';

const hex = (s) => new THREE.Color(s);

// 객체와 그 아래 자원을 정리 (공유 자원은 userData.shared = true 로 표시하면 건드리지 않음)
export function disposeObject(obj) {
  obj.traverse((o) => {
    if (o.userData?.shared) return;
    o.geometry?.dispose?.();
    const m = o.material;
    if (Array.isArray(m)) m.forEach((x) => !x.userData?.shared && x.dispose());
    else if (m && !m.userData?.shared) m.dispose();
  });
  obj.parent?.remove(obj);
}

export function createRenderer({ canvas, space = 'arena', quality = 'high', autoQuality = true, fpsCap = CONSTANTS.view.fpsCap, onQualityChange = null } = {}) {
  let q = QUALITY[quality] || QUALITY.high;
  // 안티앨리어싱은 컨텍스트 생성 때만 정할 수 있다 → 처음 화질을 따른다
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: q.antialias, powerPreference: 'high-performance', preserveDrawingBuffer: false });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  renderer.toneMapping = THREE.ACESFilmicToneMapping;
  renderer.toneMappingExposure = 1.0;
  renderer.shadowMap.type = THREE.PCFSoftShadowMap;

  const scene = new THREE.Scene();
  // 금속 재질이 검게 보이지 않도록 약한 환경 반사를 깐다(조명 느낌은 공간별 조명이 정함)
  const pmrem = new THREE.PMREMGenerator(renderer);
  const envTex = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
  scene.environment = envTex;
  const camera = new THREE.PerspectiveCamera(50, 1, 0.1, 400);
  camera.position.set(0, 18, 26);
  camera.lookAt(0, 0, 0);

  // 조명: 환경광 + 주광(그림자) + 강조광
  const ambient = new THREE.AmbientLight(0xffffff, 0.5);
  const key = new THREE.DirectionalLight(0xffffff, 1);
  key.castShadow = true;
  key.shadow.camera.near = 1;
  key.shadow.camera.far = 120;
  key.shadow.bias = -0.0004;
  const accent = new THREE.PointLight(0xffffff, 1, 80, 1.6);
  scene.add(ambient, key, key.target, accent);

  // 바닥(공간별 색) — 전장 크기는 setArenaSize로 맞춘다
  const floorMat = new THREE.MeshStandardMaterial({ color: 0x20252d, roughness: 0.85, metalness: 0.25 });
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.receiveShadow = true;
  floor.userData.shared = true;
  scene.add(floor);
  let grid = null;

  const listeners = { frame: new Set(), quality: new Set(), space: new Set(), resize: new Set() };
  const emit = (name, ...a) => listeners[name].forEach((fn) => fn(...a));
  const on = (name) => (fn) => {
    listeners[name].add(fn);
    return () => listeners[name].delete(fn);
  };

  const api = {
    THREE, renderer, scene, camera, canvas, lights: { ambient, key, accent }, floor,
    spaceId: null, space: null,
    get quality() { return q; },
    time: 0,
    frameCount: 0,
    fps: 60,
    autoQuality, // 런타임에 켜고 끌 수 있다(quality.js)
    customRender: null, // postfx가 (dt)=>void 로 설정하면 renderer.render 대신 호출
    onFrame: on('frame'), onQuality: on('quality'), onSpace: on('space'), onResize: on('resize'),
  };

  // ── 공간 색감 적용 ──
  api.setSpace = (id) => {
    const sp = resolveSpace(id);
    const s = sp.scene;
    api.spaceId = id;
    api.space = sp;
    scene.background = hex(s.background);
    scene.fog = new THREE.Fog(hex(s.fog.color), s.fog.near, s.fog.far);
    ambient.color.copy(hex(s.ambient.color));
    ambient.intensity = s.ambient.intensity * Math.PI; // three r155+ 물리 단위 보정
    key.color.copy(hex(s.key.color));
    key.intensity = s.key.intensity * Math.PI;
    key.position.set(...s.key.position);
    accent.color.copy(hex(s.accent.color));
    accent.intensity = s.accent.intensity * 40; // PointLight 단위 보정
    accent.position.set(...s.accent.position);
    floorMat.color.copy(hex(s.floor));
    if (grid) { scene.remove(grid); grid.geometry.dispose(); grid.material.dispose(); grid = null; }
    if (s.gridColor) {
      grid = new THREE.GridHelper(80, 40, hex(s.gridColor), hex(s.gridColor));
      grid.position.y = 0.01;
      grid.material.opacity = 0.35;
      grid.material.transparent = true;
      scene.add(grid);
    }
    emit('space', sp);
    return sp;
  };

  // 바닥 크기와 그림자 범위를 전장에 맞춘다
  api.setArenaSize = (halfW, halfD, margin = 60) => {
    floor.scale.set(halfW * 2 + margin, halfD * 2 + margin, 1);
    const r = Math.max(halfW, halfD) + 10;
    const c = key.shadow.camera;
    c.left = -r; c.right = r; c.top = r; c.bottom = -r;
    c.updateProjectionMatrix();
  };

  // ── 화질 ──
  api.setQuality = (id) => {
    const next = QUALITY[id];
    if (!next) return q;
    q = next;
    renderer.setPixelRatio(Math.min(globalThis.devicePixelRatio || 1, q.pixelRatioCap));
    renderer.shadowMap.enabled = q.shadows;
    key.castShadow = q.shadows;
    key.shadow.mapSize.set(q.shadowMapSize, q.shadowMapSize);
    if (key.shadow.map) { key.shadow.map.dispose(); key.shadow.map = null; }
    api.resize();
    emit('quality', q);
    onQualityChange?.(q);
    return q;
  };

  api.resize = () => {
    const w = canvas.clientWidth || canvas.width || 800;
    const h = canvas.clientHeight || canvas.height || 450;
    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    emit('resize', w, h);
  };

  // ── 루프: 프레임 상한 + 자동 하향 ──
  let raf = 0;
  let last = 0;
  let running = false;
  let lowTime = 0;
  const minDt = 1 / (fpsCap + 1);
  const A = CONSTANTS.view;

  function frame(nowMs) {
    if (!running) return;
    raf = requestAnimationFrame(frame);
    const now = nowMs / 1000;
    const dt = Math.min(0.1, now - last);
    if (last && dt < minDt) return; // 프레임 상한
    last = now;
    api.time += dt;
    api.frameCount += 1;
    api.fps += (1 / Math.max(dt, 1e-4) - api.fps) * 0.1;

    if (api.autoQuality && api.frameCount > 30) {
      if (api.fps < A.autoDowngradeFps) lowTime += dt;
      else lowTime = Math.max(0, lowTime - dt);
      if (lowTime >= A.autoDowngradeSeconds && q.id !== QUALITY_ORDER[QUALITY_ORDER.length - 1]) {
        lowTime = 0;
        api.setQuality(downgradeQuality(q.id));
      }
    }
    emit('frame', dt, api.time);
    if (api.customRender) api.customRender(dt);
    else renderer.render(scene, camera);
  }

  api.start = () => {
    if (running) return;
    running = true;
    last = 0;
    raf = requestAnimationFrame(frame);
  };
  api.stop = () => {
    running = false;
    cancelAnimationFrame(raf);
  };
  // 한 프레임만 직접 그리기(테스트·캡처용)
  api.renderOnce = (dt = 1 / 60) => {
    api.time += dt;
    emit('frame', dt, api.time);
    if (api.customRender) api.customRender(dt);
    else renderer.render(scene, camera);
  };
  api.dispose = () => {
    api.stop();
    disposeObject(scene);
    envTex.dispose();
    pmrem.dispose();
    renderer.dispose();
    Object.values(listeners).forEach((s) => s.clear());
  };

  if (typeof ResizeObserver !== 'undefined') new ResizeObserver(() => api.resize()).observe(canvas);
  api.setQuality(q.id);
  api.setSpace(space);
  api.setArenaSize(20, 20);
  return api;
}

export { QUALITY, QUALITY_ORDER };

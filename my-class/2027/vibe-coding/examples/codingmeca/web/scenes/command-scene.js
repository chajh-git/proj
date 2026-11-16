// web/scenes/command-scene.js  (57번)
// 지휘 본부: 관제 스크린 계열의 어두운 지휘실. 가운데 레이더 홀로그램 탁자, 벽 모니터, 상태등. (명세 14-2)
// 생동감: 레이더 스윕, 기체 신호점, 모니터 그래프, 깜빡이는 상태등, 경보 시 붉은 맥동.
//
//   const cmd = shell.scene;
//   cmd.setArena(halfW, halfD)                         // 레이더에 그릴 전장 크기
//   cmd.setBlips([{ id, x, z, team:'A'|'B', alive }])   // 기체 신호점(경기 중 스냅샷으로 갱신)
//   cmd.setStatus('idle' | 'live' | 'alert')            // 상태등·분위기
//   cmd.ping()                                          // 레이더 핑(소리 포함)

import { createParticles } from '../render/effects/particles.js';
import { EFFECT_COLORS, SPACES } from '../../config/theme.js';
import { createSceneKit, createOrbit, canvasScreen, steel, glow, additive, box, cyl, V, rnd } from './scene-kit.js';

const TABLE_Y = 1.1;
const RADAR_R = 4.2;

export function createCommandScene(ctx) {
  const kit = createSceneKit(ctx, { name: 'command' });
  const { THREE, root, sched, camera } = kit;
  const P = SPACES.command.palette;
  const particles = createParticles(root, { quality: ctx.renderer.quality });
  const offQ = ctx.renderer.onQuality((q) => particles.setQuality(q));
  const orbit = createOrbit(camera, { target: V(0, TABLE_Y + 0.8, 0), dist: 12, yaw: 0.2, pitch: 0.42, minDist: 6, maxDist: 20, minPitch: 0.1, maxPitch: 1.2, autoSpeed: 0.03 });
  const anim = [];
  const ROOM = { w: 40, h: 14, d: 34 };

  // 방
  const wall = steel('#10182A', 0.9, 0.4);
  wall.side = THREE.BackSide;
  const room = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, ROOM.h, ROOM.d), wall);
  room.position.y = ROOM.h / 2;
  root.add(room);
  for (let i = -3; i <= 3; i++) {
    box(0.4, 0.1, ROOM.d, glow(P.primary, 0.6), i * 5.5, ROOM.h - 0.2, 0, root); // 천장 조명띠
    box(0.5, ROOM.h, 0.5, steel('#1B2740', 0.6, 0.6), i * 6, ROOM.h / 2, -ROOM.d / 2 + 0.3, root);
  }
  const floorGlow = new THREE.Mesh(new THREE.RingGeometry(RADAR_R + 1.6, RADAR_R + 1.7, 64), additive(P.primary, 0.5));
  floorGlow.rotation.x = -Math.PI / 2;
  floorGlow.position.y = 0.03;
  root.add(floorGlow);

  // 레이더 탁자
  cyl(RADAR_R + 0.9, RADAR_R + 1.2, TABLE_Y, steel('#1A2438', 0.4, 0.8), 0, TABLE_Y / 2, 0, root, 48);
  const disc = new THREE.Mesh(new THREE.CircleGeometry(RADAR_R, 64), new THREE.MeshBasicMaterial({ color: '#06122A', toneMapped: false }));
  disc.rotation.x = -Math.PI / 2;
  disc.position.y = TABLE_Y + 0.02;
  root.add(disc);
  for (let i = 1; i <= 4; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry((RADAR_R * i) / 4 - 0.02, (RADAR_R * i) / 4 + 0.02, 64), additive(P.primary, 0.35));
    r.rotation.x = -Math.PI / 2;
    r.position.y = TABLE_Y + 0.03;
    root.add(r);
  }
  for (let i = 0; i < 4; i++) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(RADAR_R * 2, 0.03), additive(P.primary, 0.25));
    l.rotation.x = -Math.PI / 2;
    l.rotation.z = (i / 4) * Math.PI;
    l.position.y = TABLE_Y + 0.03;
    root.add(l);
  }
  // 스윕 부채꼴
  const sweepMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending, side: THREE.DoubleSide,
    uniforms: { uColor: { value: new THREE.Color(P.primary) }, uAlert: { value: 0 } },
    vertexShader: 'varying vec2 vUv; void main(){ vUv = uv; gl_Position = projectionMatrix*modelViewMatrix*vec4(position,1.0); }',
    fragmentShader: 'varying vec2 vUv; uniform vec3 uColor; uniform float uAlert; void main(){ vec2 p = vUv-0.5; float a = atan(p.y,p.x); float r = length(p)*2.0; if(r>1.0) discard; float k = smoothstep(-1.2,0.0,a)*step(a,0.0); vec3 c = mix(uColor, vec3(1.0,0.2,0.2), uAlert); gl_FragColor = vec4(c, k*0.55*(1.0-r*0.4)); }',
  });
  const sweep = new THREE.Mesh(new THREE.PlaneGeometry(RADAR_R * 2, RADAR_R * 2), sweepMat);
  sweep.rotation.x = -Math.PI / 2;
  sweep.position.y = TABLE_Y + 0.05;
  root.add(sweep);
  let alert = 0;
  let alertTarget = 0;
  anim.push((dt, t) => {
    sweep.rotation.z = -t * 1.6;
    alert += (alertTarget - alert) * Math.min(1, dt * 4);
    sweepMat.uniforms.uAlert.value = alert * (0.5 + 0.5 * Math.sin(t * 8));
  });

  // 전장 윤곽 + 신호점
  const arena = { halfW: 20, halfD: 14 };
  const outline = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([V(-1, 0, -1), V(1, 0, -1), V(1, 0, 1), V(-1, 0, 1)]), new THREE.LineBasicMaterial({ color: '#8FC4F5', transparent: true, opacity: 0.8, toneMapped: false }));
  outline.position.y = TABLE_Y + 0.06;
  root.add(outline);
  function fitOutline() {
    const k = (RADAR_R * 0.9) / Math.hypot(arena.halfW, arena.halfD);
    outline.scale.set(arena.halfW * k, 1, arena.halfD * k);
    return k;
  }
  fitOutline();
  const blips = new Map();
  const blipGeo = new THREE.SphereGeometry(0.11, 10, 8);
  blipGeo.userData.shared = true;
  function setBlips(list = []) {
    const k = fitOutline();
    const seen = new Set();
    for (const b of list) {
      seen.add(b.id);
      let m = blips.get(b.id);
      if (!m) {
        m = new THREE.Mesh(blipGeo, glow(b.team === 'B' ? EFFECT_COLORS.teamB : EFFECT_COLORS.teamA));
        const halo = new THREE.Mesh(new THREE.RingGeometry(0.16, 0.2, 20), additive('#FFFFFF', 0.6));
        halo.rotation.x = -Math.PI / 2;
        m.add(halo);
        m.userData.halo = halo;
        root.add(m);
        blips.set(b.id, m);
      }
      m.position.set(b.x * k, TABLE_Y + 0.12, b.z * k);
      m.visible = b.alive !== false;
    }
    for (const [id, m] of blips) if (!seen.has(id)) { root.remove(m); m.userData.halo.geometry.dispose(); m.userData.halo.material.dispose(); m.material.dispose(); blips.delete(id); }
  }
  anim.push((dt, t) => { for (const m of blips.values()) m.userData.halo.scale.setScalar(1 + 0.4 * Math.sin(t * 5)); });

  // 벽 모니터
  const screens = [];
  [[-12, 6.5, -ROOM.d / 2 + 0.1, 0], [-4, 6.5, -ROOM.d / 2 + 0.1, 0], [4, 6.5, -ROOM.d / 2 + 0.1, 0], [12, 6.5, -ROOM.d / 2 + 0.1, 0], [-ROOM.w / 2 + 0.1, 6, -5, Math.PI / 2], [-ROOM.w / 2 + 0.1, 6, 5, Math.PI / 2], [ROOM.w / 2 - 0.1, 6, -5, -Math.PI / 2], [ROOM.w / 2 - 0.1, 6, 5, -Math.PI / 2]].forEach(([x, y, z, ry], i) => {
    const s = canvasScreen(256, 144, (g, w, h, t = 0) => {
      g.fillStyle = '#050B1A'; g.fillRect(0, 0, w, h);
      g.strokeStyle = i % 2 ? '#FF9A3D' : P.primary; g.fillStyle = g.strokeStyle; g.lineWidth = 2;
      if (i % 3 === 0) { g.beginPath(); for (let x2 = 0; x2 < w; x2 += 4) { const y2 = h * 0.6 - Math.abs(Math.sin(x2 * 0.04 + t * 1.5)) * h * 0.4 * (0.5 + 0.5 * Math.sin(x2 * 0.01 + i)); x2 ? g.lineTo(x2, y2) : g.moveTo(x2, y2); } g.stroke(); }
      else if (i % 3 === 1) { for (let r = 0; r < 6; r++) { g.fillRect(14, 14 + r * 20, 30 + ((t * 40 + r * 31) % 160), 8); } }
      else { g.beginPath(); g.arc(w / 2, h / 2, 40, 0, 7); g.stroke(); g.beginPath(); g.moveTo(w / 2, h / 2); g.lineTo(w / 2 + Math.cos(-t * 2) * 40, h / 2 + Math.sin(-t * 2) * 40); g.stroke(); }
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(7, 3.94), s.material);
    const g = new THREE.Group();
    g.add(box(7.3, 4.24, 0.12, steel('#0C1220', 0.5, 0.6)), m);
    m.position.z = 0.08;
    g.position.set(x, y, z);
    g.rotation.y = ry;
    root.add(g);
    screens.push(s);
  });
  let acc = 0;
  anim.push((dt, t) => { acc += dt; if (acc < 0.3 / kit.detail) return; acc = 0; screens.forEach((s) => s.redraw(t)); });

  // 상태등
  const lamps = [];
  for (let i = 0; i < 6; i++) {
    const m = new THREE.Mesh(new THREE.SphereGeometry(0.16, 10, 8), glow('#3DD68C'));
    m.position.set(-3 + i * 1.2, TABLE_Y + 0.15, RADAR_R + 1.0);
    root.add(m);
    lamps.push(m);
  }
  let status = 'idle';
  anim.push((dt, t) => {
    lamps.forEach((l, i) => {
      const on = status === 'alert' ? Math.sin(t * 9 + i) > 0 : status === 'live' ? Math.sin(t * 3 + i * 0.7) > -0.3 : i === Math.floor(t * 1.5) % lamps.length;
      l.material.color.set(status === 'alert' ? (on ? '#FF4D4D' : '#331010') : on ? (status === 'live' ? '#4DE1FF' : '#3DD68C') : '#0C2018');
    });
  });
  sched.every(10, () => particles.ring(V(0, TABLE_Y + 0.1, 0), P.primary, 3, 30, TABLE_Y + 0.1), 0.4);

  return {
    orbit, particles,
    mount() { kit.mount(); ctx.renderer.setArenaSize(14, 14, 0); orbit.setView({ yaw: 0.2, pitch: 0.42, dist: 12 }, true); orbit.update(0.016); },
    unmount() { kit.unmount(); },
    update(dt, t) { sched.update(dt); for (const fn of anim) fn(dt, t); orbit.update(dt); particles.update(dt); },
    onDrag: (dx, dy) => orbit.drag(dx, dy),
    onWheel: (dy) => orbit.wheel(dy),
    setArena(halfW, halfD) { arena.halfW = halfW; arena.halfD = halfD; fitOutline(); },
    setBlips,
    setStatus(s) { status = s; alertTarget = s === 'alert' ? 1 : 0; },
    ping() { kit.play('radar_ping', 0.7); particles.ring(V(0, TABLE_Y + 0.1, 0), P.primary, RADAR_R, 48, TABLE_Y + 0.1); },
    setView: (v, i) => orbit.setView(v, i),
    dispose() { offQ(); particles.dispose?.(); kit.dispose(); },
  };
}

// web/scenes/hangar-scene.js  (53번)
// 격납고: 거대한 정비 격납고. 천장 크레인, 작업대, 벽면 모니터, 전시 중인 기체 실루엣. (명세 14-2)
// 생동감: 크레인 이동, 로봇 팔 용접 불꽃, 바닥 증기, 회전 경고등, 작업대 위 홀로그램 회전, 코어 맥동, 부착 시 스파크.
// 사운드: 앰비언트는 앱 셸이 amb_hangar를 틀고, 이 장면은 크레인·용접·증기 같은 간헐음을 거리에 맞춰 얹는다.
//
//   shell.registerScene('hangar', createHangarScene);
//   const hangar = shell.scene;                      // 활성 장면
//   hangar.anchors.workbench                         // 작업대 위 Group (기체를 여기에 붙인다, 윗면 기준 y=0)
//   hangar.attachSpark(worldPos) / hangar.pulseCore() / hangar.focus(point) / hangar.setView({...})

import { createParticles } from '../render/effects/particles.js';
import { createRobotView, infoFromDesign } from '../render/robot-view.js';
import { getPartViewAdapter } from '../render/part-view-adapter.js';
import { PRESETS } from '../../data/presets.js';
import { SPACES } from '../../config/theme.js';
import { createSceneKit, createOrbit, canvasScreen, steel, glow, additive, holoWire, box, cyl, V, rnd, proximity } from './scene-kit.js';

const BENCH_TOP = 0.95; // 작업대 윗면 높이(m)
const ROOM = { w: 64, h: 20, d: 52 };

export function createHangarScene(ctx) {
  const kit = createSceneKit(ctx, { name: 'hangar' });
  const { THREE, root, sched } = kit;
  const P = SPACES.hangar.palette;
  const orange = P.primary;
  const camera = ctx.camera;
  const particles = createParticles(root, { quality: ctx.renderer.quality });
  const offQ = ctx.renderer.onQuality((q) => particles.setQuality(q));

  const orbit = createOrbit(camera, { target: V(0, BENCH_TOP + 1.4, 0), dist: 14, yaw: 0.55, pitch: 0.36, minDist: 6, maxDist: 28, minPitch: 0.06, maxPitch: 1.2, autoSpeed: 0.05 });
  const anim = []; // (dt, t) => void

  // ── 방 ──────────────────────────────────────────────
  const wallMat = steel('#2A3039', 0.85, 0.5);
  wallMat.side = THREE.BackSide;
  const room = new THREE.Mesh(new THREE.BoxGeometry(ROOM.w, ROOM.h, ROOM.d), wallMat);
  room.position.y = ROOM.h / 2;
  room.receiveShadow = true;
  root.add(room);

  const ribMat = steel('#3A4452', 0.6, 0.7);
  for (let i = -3; i <= 3; i++) { // 벽 기둥
    box(1.2, ROOM.h, 1.2, ribMat, i * 9, ROOM.h / 2, -ROOM.d / 2 + 0.6, root);
    box(1.2, ROOM.h, 1.2, ribMat, i * 9, ROOM.h / 2, ROOM.d / 2 - 0.6, root);
  }
  for (let i = -2; i <= 2; i++) {
    box(1.2, ROOM.h, 1.2, ribMat, -ROOM.w / 2 + 0.6, ROOM.h / 2, i * 9, root);
    box(1.2, ROOM.h, 1.2, ribMat, ROOM.w / 2 - 0.6, ROOM.h / 2, i * 9, root);
  }
  for (let i = -3; i <= 3; i++) box(0.8, 0.9, ROOM.d, ribMat, i * 9, ROOM.h - 0.5, 0, root); // 천장 보
  for (let i = -2; i <= 2; i++) box(ROOM.w, 0.7, 0.8, ribMat, 0, ROOM.h - 2.2, i * 10, root);
  const lampMat = glow('#FFE9C9');
  for (let i = -2; i <= 2; i++) for (let j = -1; j <= 1; j++) box(5, 0.12, 0.6, lampMat, i * 12, ROOM.h - 1.15, j * 15, root); // 조명띠
  // 바닥 안전선
  const lineMat = glow(orange, 0.85);
  box(12.5, 0.02, 0.15, lineMat, 0, 0.02, 4.7, root);
  box(12.5, 0.02, 0.15, lineMat, 0, 0.02, -4.7, root);
  box(0.15, 0.02, 9.4, lineMat, 6.2, 0.02, 0, root);
  box(0.15, 0.02, 9.4, lineMat, -6.2, 0.02, 0, root);

  // ── 작업대 ──────────────────────────────────────────
  const bench = new THREE.Group();
  root.add(bench);
  const topMat = steel('#3B434E', 0.4, 0.85);
  box(9, 0.3, 6.5, topMat, 0, BENCH_TOP - 0.15, 0, bench);
  for (const sx of [-4.2, 4.2]) for (const sz of [-3, 3]) box(0.5, BENCH_TOP - 0.3, 0.5, steel('#2B323C', 0.6, 0.7), sx, (BENCH_TOP - 0.3) / 2, sz, bench);
  box(9.2, 0.06, 0.12, glow(orange), 0, BENCH_TOP - 0.02, 3.28, bench); // 가장자리 발광
  box(9.2, 0.06, 0.12, glow(orange), 0, BENCH_TOP - 0.02, -3.28, bench);
  // 홀로그램 격자(윗면)
  const gridMat = additive('#5B8DB8', 0.28);
  const gridTex = canvasScreen(256, 256, (g, w, h) => {
    g.clearRect(0, 0, w, h);
    g.strokeStyle = '#8FC4F5';
    g.lineWidth = 2;
    for (let i = 0; i <= 8; i++) { g.beginPath(); g.moveTo((i * w) / 8, 0); g.lineTo((i * w) / 8, h); g.stroke(); g.beginPath(); g.moveTo(0, (i * h) / 8); g.lineTo(w, (i * h) / 8); g.stroke(); }
  });
  gridMat.map = gridTex.tex;
  const grid = new THREE.Mesh(new THREE.PlaneGeometry(8.4, 5.8), gridMat);
  grid.rotation.x = -Math.PI / 2;
  grid.position.y = BENCH_TOP + 0.02;
  bench.add(grid);

  // 기체를 붙이는 자리 + 코어 받침
  const workbench = new THREE.Group();
  workbench.position.y = BENCH_TOP;
  root.add(workbench);
  const cradleMat = additive(orange, 0.8);
  const cradle = new THREE.Mesh(new THREE.RingGeometry(1.5, 1.7, 48), cradleMat);
  cradle.rotation.x = -Math.PI / 2;
  cradle.position.y = BENCH_TOP + 0.04;
  root.add(cradle);
  const cradle2 = new THREE.Mesh(new THREE.RingGeometry(2.2, 2.26, 48), additive('#FFB067', 0.5));
  cradle2.rotation.x = -Math.PI / 2;
  cradle2.position.y = BENCH_TOP + 0.04;
  root.add(cradle2);
  const coreGlow = new THREE.Mesh(new THREE.CircleGeometry(1.5, 40), additive(orange, 0.25));
  coreGlow.rotation.x = -Math.PI / 2;
  coreGlow.position.y = BENCH_TOP + 0.03;
  root.add(coreGlow);
  let corePulse = 0;
  anim.push((dt, t) => {
    corePulse = Math.max(0, corePulse - dt * 1.6);
    const beat = 0.5 + 0.5 * Math.sin(t * 2.2);
    coreGlow.material.opacity = 0.14 + beat * 0.14 + corePulse * 0.5;
    coreGlow.scale.setScalar(1 + beat * 0.05 + corePulse * 0.35);
    cradle.material.opacity = 0.55 + beat * 0.3 + corePulse * 0.4;
    cradle2.rotation.z += dt * 0.25;
  });

  // ── 옆 콘솔 + 회전 홀로그램 ─────────────────────────
  const consoleG = new THREE.Group();
  consoleG.position.set(9.5, 0, 3);
  root.add(consoleG);
  box(2.2, 1.0, 1.4, steel('#2E353F', 0.5, 0.7), 0, 0.5, 0, consoleG);
  cyl(0.9, 1.0, 0.1, glow('#5B8DB8', 0.9), 0, 1.05, 0, consoleG);
  const holo = new THREE.Group();
  holo.position.y = 2.1;
  consoleG.add(holo);
  holo.add(new THREE.Mesh(new THREE.IcosahedronGeometry(0.7, 1), holoWire('#8FC4F5', 0.8)));
  const holoRing = new THREE.Mesh(new THREE.TorusGeometry(1.0, 0.02, 6, 48), additive(orange, 0.8));
  holoRing.rotation.x = Math.PI / 2.4;
  holo.add(holoRing);
  anim.push((dt) => { holo.rotation.y += dt * 0.9; holoRing.rotation.z += dt * 1.4; });

  // ── 벽면 모니터 ─────────────────────────────────────
  const screens = [];
  const monitorSpec = [
    [-18, 6.5, -ROOM.d / 2 + 0.15, 0, 7, 3.6], [-9, 6.5, -ROOM.d / 2 + 0.15, 0, 7, 3.6], [0, 6.8, -ROOM.d / 2 + 0.15, 0, 9, 4.4],
    [9, 6.5, -ROOM.d / 2 + 0.15, 0, 7, 3.6], [18, 6.5, -ROOM.d / 2 + 0.15, 0, 7, 3.6],
    [-ROOM.w / 2 + 0.15, 6.5, -6, Math.PI / 2, 7, 3.6], [-ROOM.w / 2 + 0.15, 6.5, 6, Math.PI / 2, 7, 3.6],
    [ROOM.w / 2 - 0.15, 6.5, -6, -Math.PI / 2, 7, 3.6], [ROOM.w / 2 - 0.15, 6.5, 6, -Math.PI / 2, 7, 3.6],
  ];
  monitorSpec.forEach(([x, y, z, ry, w, h], i) => {
    const kind = i % 3;
    const scr = canvasScreen(256, Math.round((256 * h) / w), (g, cw, ch, t = 0) => {
      g.fillStyle = '#071018';
      g.fillRect(0, 0, cw, ch);
      g.strokeStyle = kind === 1 ? '#FFB067' : '#5BC0FF';
      g.fillStyle = g.strokeStyle;
      g.lineWidth = 2;
      if (kind === 0) { // 파형
        g.beginPath();
        for (let px = 0; px < cw; px += 4) { const py = ch / 2 + Math.sin(px * 0.05 + t * 2) * ch * 0.25 * Math.sin(px * 0.013 + t); px ? g.lineTo(px, py) : g.moveTo(px, py); }
        g.stroke();
      } else if (kind === 1) { // 막대
        for (let b = 0; b < 12; b++) { const bh = (0.2 + 0.8 * Math.abs(Math.sin(b * 1.7 + t * 1.3))) * (ch - 20); g.fillRect(12 + b * 20, ch - 8 - bh, 12, bh); }
      } else { // 도면 선
        g.strokeRect(20, 14, cw - 40, ch - 28);
        g.beginPath(); g.moveTo(cw / 2, 14); g.lineTo(cw / 2, ch - 14); g.moveTo(20, ch / 2); g.lineTo(cw - 20, ch / 2); g.stroke();
        g.beginPath(); g.arc(cw / 2, ch / 2, 18 + (Math.sin(t * 2) + 1) * 8, 0, 7); g.stroke();
        for (let k = 0; k < 4; k++) g.fillRect(28, 22 + k * 10, 20 + ((t * 30 + k * 17) % 50), 3);
      }
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(w, h), scr.material);
    const frame = box(w + 0.3, h + 0.3, 0.15, steel('#1B2028', 0.5, 0.6));
    const g = new THREE.Group();
    g.add(frame, m);
    m.position.z = 0.09;
    g.position.set(x, y, z);
    g.rotation.y = ry;
    root.add(g);
    screens.push(scr);
  });
  let screenAcc = 0;
  anim.push((dt, t) => {
    screenAcc += dt;
    if (screenAcc < 0.25 / kit.detail) return; // 화질이 낮으면 덜 자주 갱신
    screenAcc = 0;
    for (const s of screens) s.redraw(t);
  });

  // ── 전시 중인 기체 실루엣 ───────────────────────────
  const exhibits = [];
  const silhouette = new THREE.MeshStandardMaterial({ color: '#0E1116', roughness: 0.9, metalness: 0.3, emissive: '#1A3552', emissiveIntensity: 0.35 });
  silhouette.userData.shared = true;
  function buildExhibits() {
    const adapter = getPartViewAdapter();
    if (!adapter) return;
    const picks = [PRESETS[0], PRESETS[3], PRESETS[6]].filter(Boolean);
    const spots = [[-14, -ROOM.d / 2 + 6], [14, -ROOM.d / 2 + 6], [-ROOM.w / 2 + 6, 12]];
    picks.forEach((design, i) => {
      try {
        const info = infoFromDesign(design, { id: `EX${i}`, team: 'A' });
        const view = createRobotView({ info, adapter, particles: null, label: false });
        view.group.traverse((o) => { if (o.isMesh) { o.material = silhouette; o.castShadow = true; } });
        const s = 0.85;
        view.group.scale.setScalar(s);
        const ped = cyl(info.radius * s + 0.6, info.radius * s + 0.9, 0.5, steel('#2B323C', 0.5, 0.7), 0, 0.25, 0);
        const g = new THREE.Group();
        g.add(ped, view.group);
        view.group.position.y = 0.5;
        g.position.set(spots[i][0], 0, spots[i][1]);
        g.rotation.y = i === 2 ? Math.PI / 2 : 0;
        root.add(g);
        exhibits.push({ view, g });
      } catch (e) {
        console.warn('격납고 전시 기체를 만들지 못했습니다', e);
      }
    });
  }
  buildExhibits();

  // ── 천장 크레인 ─────────────────────────────────────
  const crane = new THREE.Group(); // 다리(레일 위를 z 방향으로 이동)
  root.add(crane);
  const railY = ROOM.h - 3.2;
  box(0.5, 0.5, ROOM.d - 4, steel('#4A5260', 0.5, 0.8), -ROOM.w / 2 + 2.5, railY + 0.3, 0, root); // 레일
  box(0.5, 0.5, ROOM.d - 4, steel('#4A5260', 0.5, 0.8), ROOM.w / 2 - 2.5, railY + 0.3, 0, root);
  const bridge = box(ROOM.w - 5, 0.9, 1.4, steel('#C9961B', 0.55, 0.6), 0, railY, 0, crane); // 노란 다리보
  box(1.4, 1.3, 2.2, steel('#7A5E10', 0.6, 0.6), -ROOM.w / 2 + 2.5, railY, 0, crane);
  box(1.4, 1.3, 2.2, steel('#7A5E10', 0.6, 0.6), ROOM.w / 2 - 2.5, railY, 0, crane);
  const trolley = new THREE.Group();
  crane.add(trolley);
  box(2.2, 0.8, 1.8, steel('#2F3640', 0.5, 0.7), 0, -0.1, 0, trolley);
  const cable = cyl(0.04, 0.04, 1, steel('#9AA3B0', 0.4, 0.9), 0, -1, 0, trolley, 6);
  const hook = new THREE.Group();
  trolley.add(hook);
  box(0.7, 0.5, 0.7, steel('#C9961B', 0.5, 0.6), 0, 0, 0, hook);
  const hookTip = cyl(0.12, 0.05, 0.5, steel('#9AA3B0', 0.4, 0.9), 0, -0.45, 0, hook, 8);
  const crate = box(1.4, 1.0, 1.4, steel('#5A4A32', 0.8, 0.3));
  crate.visible = false;
  hook.add(crate);
  crate.position.y = -1.2;
  void hookTip;

  const craneState = { phase: 'idle', t: 0, from: V(), to: V(), dur: 1, reach: 0, carrying: false, wait: 2 };
  const craneSpots = [[-20, -14], [18, -12], [-18, 14], [20, 14], [-8, 18], [8, -18]];
  const REACH_LEN = railY - 3.2; // 갈고리가 내려갈 수 있는 길이
  function craneNext() {
    const [x, z] = craneSpots[Math.floor(Math.random() * craneSpots.length)];
    craneState.from.set(trolley.position.x, 0, crane.position.z);
    craneState.to.set(x, 0, z);
    craneState.dur = Math.max(3, craneState.from.distanceTo(craneState.to) / 4);
    craneState.t = 0;
    craneState.phase = 'move';
    kit.play('crane_move', proximity(camera, V(x, 8, z), 4, 50) * 0.5);
  }
  anim.push((dt) => {
    const s = craneState;
    if (s.phase === 'idle') { s.wait -= dt; if (s.wait <= 0) craneNext(); }
    else if (s.phase === 'move') {
      s.t += dt;
      const k = Math.min(1, s.t / s.dur);
      const e = k * k * (3 - 2 * k);
      trolley.position.x = s.from.x + (s.to.x - s.from.x) * e;
      crane.position.z = s.from.z + (s.to.z - s.from.z) * e;
      if (k >= 1) { s.phase = 'down'; s.t = 0; }
    } else if (s.phase === 'down') {
      s.t += dt;
      s.reach = Math.min(1, s.t / 2);
      if (s.t >= 2.4) { s.phase = 'up'; s.t = 0; s.carrying = !s.carrying; crate.visible = s.carrying; }
    } else if (s.phase === 'up') {
      s.t += dt;
      s.reach = 1 - Math.min(1, s.t / 2);
      if (s.t >= 2) { s.phase = 'idle'; s.wait = rnd(3, 7); s.reach = 0; }
    }
    const len = 1.2 + s.reach * REACH_LEN; // 트롤리 아래로 내려간 길이
    cable.scale.y = len;
    cable.position.y = -len / 2 - 0.4;
    hook.position.y = -len - 0.4;
    hook.rotation.y += dt * 0.2;
  });

  // ── 용접 로봇 팔 ────────────────────────────────────
  const arms = [];
  function makeArm(x, z, ry) {
    const g = new THREE.Group();
    g.position.set(x, 0, z);
    g.rotation.y = ry;
    root.add(g);
    cyl(0.9, 1.1, 0.5, steel('#2B323C', 0.5, 0.8), 0, 0.25, 0, g);
    const turret = new THREE.Group();
    turret.position.y = 0.5;
    g.add(turret);
    cyl(0.55, 0.65, 0.6, steel('#C96A1B', 0.5, 0.5), 0, 0.3, 0, turret);
    const l1 = new THREE.Group();
    l1.position.y = 0.6;
    turret.add(l1);
    box(0.4, 3.0, 0.4, steel('#C96A1B', 0.5, 0.5), 0, 1.5, 0, l1);
    const l2 = new THREE.Group();
    l2.position.y = 3.0;
    l1.add(l2);
    box(0.32, 2.6, 0.32, steel('#D9822B', 0.5, 0.5), 0, 1.3, 0, l2);
    const head = new THREE.Group();
    head.position.y = 2.6;
    l2.add(head);
    box(0.5, 0.3, 0.5, steel('#2B323C', 0.5, 0.8), 0, 0.1, 0, head);
    const tip = V(0, 0.45, 0);
    head.add(new THREE.Mesh(new THREE.ConeGeometry(0.1, 0.4, 8), glow('#8FC4F5')));
    head.children[head.children.length - 1].position.copy(tip);
    const arm = { g, turret, l1, l2, head, t: rnd(0, 6), welding: 0, aim: 0, goal: { yaw: 0, a1: 0.5, a2: -1.0 } };
    arms.push(arm);
    return arm;
  }
  makeArm(-6.5, 5.5, -0.9);
  makeArm(6.5, -5.5, Math.PI - 0.9);

  const weldLight = new THREE.PointLight('#8FC4F5', 0, 12, 2);
  root.add(weldLight);
  const tmpV = V();
  function weld(arm) {
    arm.welding = rnd(0.5, 1.1);
    arm.head.getWorldPosition(tmpV);
    tmpV.y += 0.6;
    const vol = proximity(camera, tmpV, 5, 30) * 0.7;
    kit.play('weld_spark', vol);
  }
  arms.forEach((a, i) => { sched.every(5 + i * 2, () => { a.goal.yaw = rnd(-0.9, 0.9); a.goal.a1 = rnd(0.35, 0.9); a.goal.a2 = rnd(-1.5, -0.6); sched.after(1.2, () => weld(a)); }, 0.4); });
  anim.push((dt) => {
    let flash = 0;
    for (const a of arms) {
      const k = Math.min(1, dt * 2.2);
      a.turret.rotation.y += (a.goal.yaw - a.turret.rotation.y) * k;
      a.l1.rotation.z += (a.goal.a1 - a.l1.rotation.z) * k;
      a.l2.rotation.z += (a.goal.a2 - a.l2.rotation.z) * k;
      if (a.welding > 0) {
        a.welding -= dt;
        a.head.getWorldPosition(tmpV);
        tmpV.y += 0.5;
        if (Math.random() < 0.8) particles.sparks(tmpV, Math.random() < 0.5 ? '#FFE29A' : '#FF9A3D', kit.count(4), 4);
        particles.glow(tmpV, '#BFE4FF', 1.2, 0.08);
        weldLight.position.copy(tmpV);
        flash = Math.max(flash, 0.7 + Math.random() * 0.6);
      }
    }
    weldLight.intensity = flash * 60;
  });

  // ── 바닥 증기 ───────────────────────────────────────
  const vents = [[-10, 8], [11, -8], [-12, -10], [12, 9]].map(([x, z]) => {
    box(1.6, 0.06, 1.6, steel('#1A1E24', 0.7, 0.6), x, 0.03, z, root);
    box(1.4, 0.07, 0.1, glow('#3A4452'), x, 0.04, z, root);
    return V(x, 0.2, z);
  });
  function steam(i = Math.floor(Math.random() * vents.length)) {
    const p = vents[i];
    for (let k = 0; k < kit.count(10); k++) particles.smoke(V(p.x + rnd(-0.4, 0.4), p.y, p.z + rnd(-0.4, 0.4)), { color: '#B8C2CF', size: 1.3, life: 2.2, rise: 2.4 });
    kit.play('steam_vent', proximity(camera, p, 4, 34) * 0.7);
  }
  sched.every(9, () => steam(), 0.5);

  // ── 회전 경고등 ─────────────────────────────────────
  const beacons = [];
  [[-24, -20], [24, -20], [-24, 20], [24, 20]].forEach(([x, z], i) => {
    const g = new THREE.Group();
    g.position.set(x, ROOM.h - 5, z);
    root.add(g);
    cyl(0.35, 0.45, 0.5, steel('#2B323C', 0.5, 0.7), 0, -0.3, 0, g);
    g.add(new THREE.Mesh(new THREE.SphereGeometry(0.35, 12, 10), glow('#FF8A1F')));
    const cone = new THREE.Mesh(new THREE.ConeGeometry(2.2, 9, 14, 1, true), additive('#FF8A1F', 0.2));
    cone.rotation.z = Math.PI / 2;
    cone.position.x = 4.5;
    const spin = new THREE.Group();
    spin.add(cone);
    g.add(spin);
    beacons.push({ spin, off: i * 1.3 });
  });
  anim.push((dt, t) => { for (const b of beacons) b.spin.rotation.y = t * 2.4 + b.off; });

  // ── 안쪽 장식: 상자·드럼통 ──────────────────────────
  const crateMat = steel('#4B4332', 0.85, 0.2);
  const drumMat = steel('#6B2A22', 0.6, 0.5);
  [[-22, 18], [-24, 14.6], [23, -18], [-25, -6], [24, 6]].forEach(([x, z], i) => {
    box(2.2, 1.6, 2.2, crateMat, x, 0.8, z, root);
    cyl(0.6, 0.6, 1.3, drumMat, x + (i % 2 ? 2 : -2), 0.65, z + 1.5, root);
  });

  // ── 공용 장면 객체 ──────────────────────────────────
  const scene = {
    anchors: { workbench, benchTop: BENCH_TOP },
    orbit, particles, room: ROOM,
    mount() {
      kit.mount();
      ctx.renderer.setArenaSize(ROOM.w / 2 - 2, ROOM.d / 2 - 2, 0);
      ctx.renderer.lights.key.position.set(8, 16, 10);
      ctx.renderer.lights.accent.position.set(-6, 3.5, -4);
      orbit.setView({ yaw: 0.55, pitch: 0.36, dist: 14 }, true);
      orbit.update(0.016);
    },
    unmount() { kit.unmount(); },
    update(dt, t) {
      sched.update(dt);
      for (const fn of anim) fn(dt, t);
      orbit.update(dt);
      particles.update(dt);
    },
    onDrag: (dx, dy) => orbit.drag(dx, dy),
    onWheel: (dy) => orbit.wheel(dy),
    // 부품이 철컥 붙었을 때: 불꽃 + 소리 + 코어 맥동
    attachSpark(pos) {
      const p = pos?.isVector3 ? pos : V(0, BENCH_TOP + 1, 0);
      particles.sparks(p, orange, kit.count(18), 6);
      particles.glow(p, '#FFD9A0', 1.6, 0.14);
      kit.play('part_attach');
      corePulse = 1;
    },
    pulseCore() { corePulse = 1; },
    steam,
    focus(point, dist = null) { orbit.setTarget(point); if (dist) orbit.setView({ dist }); },
    resetView() { orbit.setTarget(V(0, BENCH_TOP + 1.4, 0)); orbit.setView({ yaw: 0.55, pitch: 0.36, dist: 14 }); },
    setView: (v, instant) => orbit.setView(v, instant),
    dispose() {
      offQ();
      for (const e of exhibits) e.view.dispose?.();
      particles.dispose?.();
      kit.dispose();
    },
  };
  return scene;
}

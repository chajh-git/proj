// web/scenes/tactics-lab-scene.js  (54번)
// 신경 연산실: 어두운 사이버 공간. 가운데 코어와 궤도 고리, 데이터 입자, 태세 노드와 연결선. (명세 14-2)
// 생동감: 코어 맥동, 데이터 입자의 나선 흐름, 노드 부유, 연결선을 따라 흐르는 빛, 규칙 발동 시 번쩍임.
//
//   const lab = shell.scene;
//   lab.setStances([{ id:'s1', label:'공격', color:'#FF2BD6' }, ...]);   // 태세 노드(최대 5)
//   lab.setLinks([{ from:'s1', to:'s2' }]);                              // 태세 전환 연결선
//   lab.highlight('s1');  lab.flashRule('s1');  lab.lightLink('s1','s2');  lab.testRun(true);
//   lab.onPick((id) => ...);                                             // 노드 클릭
//   lab.pulse();  lab.setView({...});

import { createParticles } from '../render/effects/particles.js';
import { SPACES } from '../../config/theme.js';
import { createSceneKit, createOrbit, canvasScreen, glow, additive, holoWire, V, rnd, clamp } from './scene-kit.js';

const CORE_Y = 3;
const NODE_R = 7.5;

export function createTacticsLabScene(ctx) {
  const kit = createSceneKit(ctx, { name: 'tacticsLab' });
  const { THREE, root, sched, camera } = kit;
  const P = SPACES.tacticsLab.palette;
  const cyan = new THREE.Color(P.primary);
  const magenta = new THREE.Color(P.secondary);
  const particles = createParticles(root, { quality: ctx.renderer.quality });
  const offQ = ctx.renderer.onQuality((q) => particles.setQuality(q));
  const orbit = createOrbit(camera, { target: V(0, CORE_Y, 0), dist: 22, yaw: 0.4, pitch: 0.3, minDist: 8, maxDist: 32, minPitch: -0.1, maxPitch: 1.3, autoSpeed: 0.05 });
  const anim = [];

  // ── 배경 구 (그라디언트 + 격자선) ──
  const bgMat = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    uniforms: { uTime: { value: 0 }, uA: { value: new THREE.Color('#02040F') }, uB: { value: new THREE.Color('#0A1A4A') }, uLine: { value: cyan.clone() } },
    vertexShader: 'varying vec3 vP; void main(){ vP = normalize(position); gl_Position = projectionMatrix * modelViewMatrix * vec4(position,1.0); }',
    fragmentShader: `varying vec3 vP; uniform vec3 uA,uB,uLine; uniform float uTime;
      void main(){
        float h = vP.y*0.5+0.5;
        vec3 c = mix(uA, uB, pow(h,1.6));
        float lon = atan(vP.z, vP.x);
        float gl = abs(fract(lon*3.8197+uTime*0.01)-0.5);
        float gh = abs(fract(vP.y*6.0)-0.5);
        float line = smoothstep(0.495,0.5,gl) + smoothstep(0.49,0.5,gh);
        c += uLine*line*0.05*(0.4+h);
        gl_FragColor = vec4(c,1.0);
      }`,
  });
  const bg = new THREE.Mesh(new THREE.SphereGeometry(70, 32, 20), bgMat);
  bg.renderOrder = -10;
  root.add(bg);
  anim.push((dt, t) => { bgMat.uniforms.uTime.value = t; });

  // ── 바닥 동심원 ──
  const floor = new THREE.Group();
  root.add(floor);
  for (let i = 1; i <= 7; i++) {
    const r = new THREE.Mesh(new THREE.RingGeometry(i * 3 - 0.03, i * 3 + 0.03, 96), additive(P.primary, 0.12 + (i === 3 ? 0.18 : 0)));
    r.rotation.x = -Math.PI / 2;
    r.position.y = 0.02;
    floor.add(r);
  }
  for (let i = 0; i < 24; i++) {
    const l = new THREE.Mesh(new THREE.PlaneGeometry(0.04, 21), additive(P.primary, 0.08));
    l.rotation.x = -Math.PI / 2;
    l.rotation.z = (i / 24) * Math.PI * 2;
    l.position.y = 0.02;
    l.geometry.translate(0, 10.5, 0);
    floor.add(l);
  }
  anim.push((dt) => { floor.rotation.y += dt * 0.02; });

  // ── 코어 ──
  const core = new THREE.Group();
  core.position.y = CORE_Y;
  root.add(core);
  const coreMesh = new THREE.Mesh(new THREE.SphereGeometry(1.1, 32, 24), glow(P.primary));
  core.add(coreMesh);
  const halo = new THREE.Mesh(new THREE.SphereGeometry(1.8, 24, 18), additive(P.primary, 0.18));
  core.add(halo);
  const cage = new THREE.Mesh(new THREE.IcosahedronGeometry(1.6, 1), holoWire(P.glow, 0.55));
  core.add(cage);
  const rings = [];
  [[2.6, 0.0, 0.0, 1], [3.2, Math.PI / 3, 0.4, -1.3], [3.8, -Math.PI / 4, -0.6, 0.8]].forEach(([r, rx, rz, sp], i) => {
    const ring = new THREE.Mesh(new THREE.TorusGeometry(r, 0.025, 6, 96), additive(i === 1 ? P.secondary : P.primary, 0.75));
    ring.rotation.set(rx + Math.PI / 2, 0, rz);
    core.add(ring);
    rings.push({ ring, sp });
  });
  let beatBoost = 0;
  let running = 0; // 0..1 시험 실행 중이면 빠르게
  let runTarget = 0;
  anim.push((dt, t) => {
    running += (runTarget - running) * Math.min(1, dt * 3);
    beatBoost = Math.max(0, beatBoost - dt * 1.8);
    const beat = 0.5 + 0.5 * Math.sin(t * (2 + running * 4));
    const s = 1 + beat * 0.08 + beatBoost * 0.4;
    coreMesh.scale.setScalar(s);
    halo.scale.setScalar(1 + beat * 0.12 + beatBoost * 0.6);
    halo.material.opacity = 0.14 + beat * 0.1 + beatBoost * 0.35;
    cage.rotation.y += dt * (0.4 + running);
    cage.rotation.x += dt * 0.2;
    for (const r of rings) r.ring.rotation.z += dt * r.sp * (0.5 + running * 2);
    core.position.y = CORE_Y + Math.sin(t * 0.8) * 0.15;
  });

  // ── 데이터 입자: 바깥에서 코어로 나선을 그리며 빨려 든다 ──
  const N = kit.count(420);
  const pPos = new Float32Array(N * 3);
  const pCol = new Float32Array(N * 3);
  const pst = Array.from({ length: N }, () => ({ a: rnd(0, 6.28), r: rnd(4, 22), y: rnd(0, 9), sp: rnd(0.5, 1.4), hue: Math.random() }));
  const pGeo = new THREE.BufferGeometry();
  pGeo.setAttribute('position', new THREE.BufferAttribute(pPos, 3));
  pGeo.setAttribute('color', new THREE.BufferAttribute(pCol, 3));
  const dataPts = new THREE.Points(pGeo, new THREE.PointsMaterial({ size: 0.16, vertexColors: true, transparent: true, opacity: 0.9, blending: THREE.AdditiveBlending, depthWrite: false, sizeAttenuation: true }));
  dataPts.frustumCulled = false;
  root.add(dataPts);
  const tmpC = new THREE.Color();
  anim.push((dt) => {
    for (let i = 0; i < N; i++) {
      const s = pst[i];
      s.r -= dt * s.sp * (1.2 + running * 3.5);
      s.a += dt * (0.6 + 2.2 / Math.max(2, s.r)) * s.sp;
      s.y += (CORE_Y - s.y) * dt * 0.35;
      if (s.r < 1.8) { s.r = rnd(16, 24); s.y = rnd(0, 9); s.a = rnd(0, 6.28); }
      pPos[i * 3] = Math.cos(s.a) * s.r;
      pPos[i * 3 + 1] = s.y;
      pPos[i * 3 + 2] = Math.sin(s.a) * s.r;
      tmpC.copy(cyan).lerp(magenta, s.hue * 0.35 + (1 - clamp((s.r - 1.8) / 14, 0, 1)) * 0.5);
      pCol[i * 3] = tmpC.r; pCol[i * 3 + 1] = tmpC.g; pCol[i * 3 + 2] = tmpC.b;
    }
    pGeo.attributes.position.needsUpdate = true;
    pGeo.attributes.color.needsUpdate = true;
  });

  // ── 태세 노드 + 연결선 ──
  const nodes = new Map(); // id → { group, mesh, ring, label, base:Vector3, flash, selected, color }
  const links = []; // { a, b, line, dot, t, flash }
  const nodeGroup = new THREE.Group();
  root.add(nodeGroup);
  const pickables = [];
  const pickCbs = new Set();

  function labelSprite(text, color) {
    const s = canvasScreen(256, 64, (g, w, h) => {
      g.clearRect(0, 0, w, h);
      g.font = 'bold 30px "Malgun Gothic","Noto Sans KR",sans-serif';
      g.textAlign = 'center';
      g.textBaseline = 'middle';
      g.shadowColor = color;
      g.shadowBlur = 12;
      g.fillStyle = '#EAFBFF';
      g.fillText(text, w / 2, h / 2);
    });
    const sp = new THREE.Sprite(new THREE.SpriteMaterial({ map: s.tex, transparent: true, depthTest: false, toneMapped: false }));
    sp.scale.set(4, 1, 1);
    sp.renderOrder = 5;
    return sp;
  }

  function clearStances() {
    for (const n of nodes.values()) { nodeGroup.remove(n.group); n.group.traverse((o) => { o.geometry?.dispose?.(); o.material?.map?.dispose?.(); o.material?.dispose?.(); }); }
    nodes.clear();
    pickables.length = 0;
    clearLinks();
  }
  function clearLinks() {
    for (const l of links) { nodeGroup.remove(l.line); nodeGroup.remove(l.dot); l.line.geometry.dispose(); l.line.material.dispose(); l.dot.geometry.dispose(); l.dot.material.dispose(); }
    links.length = 0;
  }

  function setStances(list = []) {
    clearStances();
    const n = Math.min(5, list.length);
    list.slice(0, 5).forEach((st, i) => {
      const a = (i / Math.max(1, n)) * Math.PI * 2 - Math.PI / 2;
      const base = V(Math.cos(a) * NODE_R, CORE_Y + (i % 2 ? 1.2 : -0.6), Math.sin(a) * NODE_R);
      const color = st.color || (i % 2 ? P.secondary : P.primary);
      const g = new THREE.Group();
      g.position.copy(base);
      const mesh = new THREE.Mesh(new THREE.OctahedronGeometry(0.9, 1), new THREE.MeshBasicMaterial({ color, toneMapped: false }));
      mesh.userData.stanceId = st.id;
      g.add(mesh);
      const shell = new THREE.Mesh(new THREE.IcosahedronGeometry(1.35, 1), holoWire(color, 0.5));
      g.add(shell);
      const ring = new THREE.Mesh(new THREE.TorusGeometry(1.7, 0.03, 6, 48), additive(color, 0.0));
      ring.rotation.x = Math.PI / 2;
      g.add(ring);
      const label = labelSprite(st.label || st.id, color);
      label.position.y = 2.4;
      g.add(label);
      nodeGroup.add(g);
      pickables.push(mesh);
      nodes.set(st.id, { id: st.id, group: g, mesh, shell, ring, label, base, flash: 0, selected: false, color: new THREE.Color(color), phase: rnd(0, 6.28) });
    });
  }

  const curve = new THREE.QuadraticBezierCurve3(V(), V(), V());
  function setLinks(list = []) {
    clearLinks();
    for (const l of list) {
      const A = nodes.get(l.from);
      const B = nodes.get(l.to);
      if (!A || !B || A === B) continue;
      const line = new THREE.Line(new THREE.BufferGeometry(), new THREE.LineBasicMaterial({ color: A.color, transparent: true, opacity: 0.45, blending: THREE.AdditiveBlending, depthWrite: false, toneMapped: false }));
      const dot = new THREE.Mesh(new THREE.SphereGeometry(0.16, 8, 6), glow('#FFFFFF'));
      nodeGroup.add(line, dot);
      links.push({ from: l.from, to: l.to, a: A, b: B, line, dot, t: rnd(0, 1), flash: 0 });
    }
  }

  function updateLink(l, dt) {
    const a = l.a.group.position;
    const b = l.b.group.position;
    const mid = a.clone().add(b).multiplyScalar(0.5);
    mid.y += 2.4;
    mid.multiplyScalar(0.8); // 안쪽으로 휘어 코어 쪽으로
    mid.y += CORE_Y * 0.2;
    curve.v0.copy(a); curve.v1.copy(mid); curve.v2.copy(b);
    l.line.geometry.setFromPoints(curve.getPoints(24));
    l.t = (l.t + dt * (0.25 + running * 0.9 + l.flash * 1.5)) % 1;
    curve.getPoint(l.t, l.dot.position);
    l.flash = Math.max(0, l.flash - dt * 1.2);
    l.line.material.opacity = 0.35 + l.flash * 0.65;
    l.dot.scale.setScalar(1 + l.flash * 3);
  }

  anim.push((dt, t) => {
    for (const n of nodes.values()) {
      n.flash = Math.max(0, n.flash - dt * 1.6);
      n.group.position.y = n.base.y + Math.sin(t * 0.9 + n.phase) * 0.35;
      n.mesh.rotation.y += dt * 0.8;
      n.shell.rotation.y -= dt * 0.4;
      const target = n.selected ? 1.25 : 1;
      const s = n.mesh.scale.x + (target + n.flash * 0.5 - n.mesh.scale.x) * Math.min(1, dt * 10);
      n.mesh.scale.setScalar(s);
      n.ring.material.opacity = (n.selected ? 0.8 : 0) + n.flash * 0.8;
      n.ring.rotation.z += dt * 1.5;
      n.ring.scale.setScalar(1 + n.flash * 0.6);
      n.label.material.opacity = n.selected ? 1 : 0.8;
    }
    for (const l of links) updateLink(l, dt);
  });

  // 둥둥 떠다니는 배경 점
  const dustN = kit.count(90);
  const dustPos = new Float32Array(dustN * 3);
  for (let i = 0; i < dustN; i++) { dustPos[i * 3] = rnd(-30, 30); dustPos[i * 3 + 1] = rnd(0, 18); dustPos[i * 3 + 2] = rnd(-30, 30); }
  const dustGeo = new THREE.BufferGeometry();
  dustGeo.setAttribute('position', new THREE.BufferAttribute(dustPos, 3));
  const dust = new THREE.Points(dustGeo, new THREE.PointsMaterial({ color: P.glow, size: 0.1, transparent: true, opacity: 0.5, blending: THREE.AdditiveBlending, depthWrite: false }));
  dust.frustumCulled = false;
  root.add(dust);
  anim.push((dt) => { dust.rotation.y += dt * 0.01; dust.position.y = Math.sin(performance.now() / 4000) * 0.4; });

  // 가끔 코어에서 번쩍
  sched.every(6, () => { beatBoost = Math.max(beatBoost, 0.5); particles.ring(V(0, CORE_Y, 0), P.primary, 6, 40, CORE_Y); }, 0.5);

  // ── 클릭으로 노드 고르기 ──
  kit.onClick((e) => {
    const hit = kit.pick(e, pickables, false)[0];
    if (!hit) return;
    const id = hit.object.userData.stanceId;
    kit.play('ui_click');
    pickCbs.forEach((fn) => fn(id));
  });

  const scene = {
    orbit, particles, nodes,
    mount() {
      kit.mount();
      ctx.renderer.setArenaSize(20, 20, 0);
      orbit.setView({ yaw: 0.4, pitch: 0.3, dist: 22 }, true);
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
    setStances, setLinks,
    onPick(fn) { pickCbs.add(fn); return () => pickCbs.delete(fn); },
    // 선택한 태세를 크게 + 고리 표시
    highlight(id) {
      for (const n of nodes.values()) n.selected = n.id === id;
      const n = nodes.get(id);
      if (n) orbit.setTarget(V(n.base.x * 0.35, CORE_Y, n.base.z * 0.35));
    },
    // 규칙이 발동하는 모습: 노드 번쩍 + 코어 맥동 + 소리
    flashRule(id) {
      const n = nodes.get(id);
      if (!n) return;
      n.flash = 1;
      beatBoost = 1;
      particles.sparks(n.group.position, '#' + n.color.getHexString(), kit.count(14), 4);
      kit.play('link_chime', 0.6);
    },
    // 태세 전환: from → to 연결선이 밝게 흐른다
    lightLink(from, to) {
      const l = links.find((x) => x.from === from && x.to === to) || links.find((x) => x.from === to && x.to === from);
      if (l) { l.flash = 1; l.a.flash = 0.6; l.b.flash = 0.8; kit.play('link_chime', 0.5); }
    },
    testRun(on) { runTarget = on ? 1 : 0; },
    pulse() { beatBoost = 1; },
    resetView() { orbit.setTarget(V(0, CORE_Y, 0)); orbit.setView({ yaw: 0.4, pitch: 0.3, dist: 22 }); },
    setView: (v, i) => orbit.setView(v, i),
    dispose() { offQ(); clearStances(); particles.dispose?.(); kit.dispose(); },
  };
  return scene;
}

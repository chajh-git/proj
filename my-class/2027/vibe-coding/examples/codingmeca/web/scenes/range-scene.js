// web/scenes/range-scene.js  (55번)
// 시험 사격장: 작은 격자 연습장. 바닥 격자에 파동이 퍼지고, 표적 드론이 떠다닌다. (명세 14-2)
// 생동감: 격자 파동, 표적 드론 순찰, 바람에 날리는 먼지, 깜빡이는 안내판, 피격 시 불꽃과 재생성.
//
//   const range = shell.scene;
//   range.targets                    // [{ id, pos(Vector3), hp, maxHp, alive, kind }] 시험 사격 상대(화면용 표적)
//   range.hitTarget(i, damage)       // 맞았을 때: 불꽃·소리, 체력이 0이면 폭발 후 잠시 뒤 재생성
//   range.resetTargets()  range.bounds  range.ripple(x, z)

import { createParticles } from '../render/effects/particles.js';
import { SPACES } from '../../config/theme.js';
import { createSceneKit, createOrbit, canvasScreen, steel, glow, additive, box, cyl, V, rnd } from './scene-kit.js';

const HALF_W = 12;
const HALF_D = 9;

export function createRangeScene(ctx) {
  const kit = createSceneKit(ctx, { name: 'range' });
  const { THREE, root, sched, camera } = kit;
  const P = SPACES.range.palette;
  const grid = SPACES.range.scene.gridColor || '#2A6F9E';
  const particles = createParticles(root, { quality: ctx.renderer.quality });
  const offQ = ctx.renderer.onQuality((q) => particles.setQuality(q));
  const orbit = createOrbit(camera, { target: V(0, 1, 0), dist: 20, yaw: 0.5, pitch: 0.5, minDist: 8, maxDist: 34, autoSpeed: 0.04 });
  const anim = [];

  // ── 바닥: 격자 + 퍼지는 파동 ──
  const floorMat = new THREE.ShaderMaterial({
    transparent: true, depthWrite: false, blending: THREE.AdditiveBlending,
    uniforms: { uTime: { value: 0 }, uColor: { value: new THREE.Color(grid) }, uHot: { value: new THREE.Color(P.primary) }, uRip: { value: new THREE.Vector4(0, 0, -10, 0) } },
    vertexShader: 'varying vec2 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW = w.xz; gl_Position = projectionMatrix*viewMatrix*w; }',
    fragmentShader: `varying vec2 vW; uniform vec3 uColor,uHot; uniform float uTime; uniform vec4 uRip;
      void main(){
        vec2 g = abs(fract(vW/2.0-0.5)-0.5)/fwidth(vW/2.0);
        float line = 1.0 - min(min(g.x,g.y),1.0);
        float d = length(vW);
        float wave = smoothstep(0.35,0.0,abs(fract(d*0.12-uTime*0.12)-0.0)*8.0) ;
        float rd = length(vW-uRip.xy); float rt = uTime-uRip.z;
        float rip = rt>0.0&&rt<2.0 ? smoothstep(0.6,0.0,abs(rd-rt*8.0))*(1.0-rt/2.0) : 0.0;
        vec3 c = uColor*line*(0.35+wave*1.2) + uHot*rip*0.9;
        float edge = smoothstep(1.0,0.0,max(abs(vW.x)/${HALF_W}.0,abs(vW.y)/${HALF_D}.0));
        gl_FragColor = vec4(c, max(line*0.8*(0.5+0.5*edge), rip));
      }`,
  });
  floorMat.extensions = { derivatives: true };
  const floor = new THREE.Mesh(new THREE.PlaneGeometry(HALF_W * 2, HALF_D * 2), floorMat);
  floor.rotation.x = -Math.PI / 2;
  floor.position.y = 0.03;
  root.add(floor);
  let simT = 0;
  anim.push((dt) => { simT += dt; floorMat.uniforms.uTime.value = simT; });

  // ── 벽·기둥·안내판 ──
  const wallMat = steel('#2B323C', 0.7, 0.6);
  const hazard = glow('#FFC21A');
  for (const [x, z, w, d] of [[0, -HALF_D - 0.4, HALF_W * 2 + 1.6, 0.8], [0, HALF_D + 0.4, HALF_W * 2 + 1.6, 0.8], [-HALF_W - 0.4, 0, 0.8, HALF_D * 2], [HALF_W + 0.4, 0, 0.8, HALF_D * 2]]) {
    box(w, 1.6, d, wallMat, x, 0.8, z, root);
    box(w > d ? w : 0.1, 0.12, w > d ? 0.1 : d, hazard, x, 1.62, z + (w > d ? (z < 0 ? 0.35 : -0.35) : 0), root);
  }
  for (const [x, z] of [[-HALF_W, -HALF_D], [HALF_W, -HALF_D], [-HALF_W, HALF_D], [HALF_W, HALF_D]]) {
    cyl(0.5, 0.6, 3.4, steel('#3A4452', 0.5, 0.7), x, 1.7, z, root);
    const lamp = new THREE.Mesh(new THREE.SphereGeometry(0.3, 10, 8), glow(P.primary));
    lamp.position.set(x, 3.6, z);
    root.add(lamp);
  }
  // 안내판(깜빡임)
  const signs = [];
  [[-6, 4.2, -HALF_D - 0.85, '시험 사격'], [6, 4.2, -HALF_D - 0.85, '표적 연습']].forEach(([x, y, z, text]) => {
    const s = canvasScreen(256, 80, (g, w, h, on = 1) => {
      g.fillStyle = '#071018'; g.fillRect(0, 0, w, h);
      g.strokeStyle = P.primary; g.lineWidth = 4; g.strokeRect(4, 4, w - 8, h - 8);
      g.font = 'bold 34px "Malgun Gothic","Noto Sans KR",sans-serif';
      g.textAlign = 'center'; g.textBaseline = 'middle';
      g.fillStyle = P.primary; g.globalAlpha = on; g.fillText(text, w / 2, h / 2 + 2);
    });
    const m = new THREE.Mesh(new THREE.PlaneGeometry(5, 1.56), s.material);
    m.position.set(x, y, z);
    root.add(m);
    signs.push(s);
  });
  let blink = 0;
  anim.push((dt, t) => { blink += dt; if (blink > 0.3) { blink = 0; const on = Math.sin(t * 3) > -0.6 ? 1 : 0.35; signs.forEach((s) => s.redraw(on)); } });

  // ── 표적 드론 ──
  const targets = [];
  function makeDrone(i) {
    const g = new THREE.Group();
    const body = new THREE.Mesh(new THREE.SphereGeometry(0.55, 16, 12), steel('#46505E', 0.4, 0.8));
    const core = new THREE.Mesh(new THREE.SphereGeometry(0.22, 12, 10), glow('#FF4D4D'));
    core.position.z = 0.42;
    const ring = new THREE.Mesh(new THREE.TorusGeometry(0.85, 0.05, 6, 32), additive('#FF4D4D', 0.8));
    ring.rotation.x = Math.PI / 2;
    g.add(body, core, ring);
    root.add(g);
    const t = {
      id: `T${i}`, kind: 'drone', pos: g.position, hp: 100, maxHp: 100, alive: true, g, ring, flash: 0, respawn: 0,
      path: { cx: rnd(-6, 6), cz: rnd(-4, 4), rx: rnd(3, 8), rz: rnd(2, 5), sp: rnd(0.25, 0.55), ph: rnd(0, 6.28), y: rnd(1.6, 3.6) },
    };
    return t;
  }
  for (let i = 0; i < 4; i++) targets.push(makeDrone(i));
  // 지상 표적 더미
  const dummy = new THREE.Group();
  cyl(0.15, 0.15, 1.6, steel('#5A6270', 0.6, 0.6), 0, 0.8, 0, dummy);
  const bull = cyl(0.9, 0.9, 0.12, glow('#FF4D4D'), 0, 1.9, 0, dummy, 32);
  bull.rotation.x = Math.PI / 2;
  const bull2 = cyl(0.55, 0.55, 0.14, glow('#FFFFFF'), 0, 1.9, 0, dummy, 32);
  bull2.rotation.x = Math.PI / 2;
  const bull3 = cyl(0.25, 0.25, 0.16, glow('#FF4D4D'), 0, 1.9, 0, dummy, 32);
  bull3.rotation.x = Math.PI / 2;
  dummy.position.set(HALF_W - 3, 0, 0);
  root.add(dummy);
  targets.push({ id: 'T4', kind: 'dummy', pos: V(HALF_W - 3, 1.9, 0), hp: 150, maxHp: 150, alive: true, g: dummy, ring: null, flash: 0, respawn: 0, path: null });

  const redMat = new THREE.Color('#FF4D4D');
  anim.push((dt, t) => {
    for (const d of targets) {
      if (!d.alive) { d.respawn -= dt; if (d.respawn <= 0) { d.alive = true; d.hp = d.maxHp; d.g.visible = true; particles.ring(d.pos, '#6CFFB5', 2, 24, 0.2); kit.play('link_chime', 0.35); } continue; }
      d.flash = Math.max(0, d.flash - dt * 4);
      if (d.path) {
        const p = d.path;
        d.g.position.set(p.cx + Math.cos(t * p.sp + p.ph) * p.rx, p.y + Math.sin(t * 1.3 + p.ph) * 0.35, p.cz + Math.sin(t * p.sp * 1.3 + p.ph) * p.rz);
        d.g.rotation.y = -(t * p.sp + p.ph) + Math.PI / 2;
        d.ring.rotation.z += dt * 2;
        d.ring.material.color.copy(redMat).lerp(new THREE.Color('#FFFFFF'), d.flash);
      }
    }
  });
  function hitTarget(i, damage = 25) {
    const d = targets[i];
    if (!d || !d.alive) return false;
    d.hp -= damage;
    d.flash = 1;
    particles.sparks(d.pos, '#FFD9A0', kit.count(10), 5);
    particles.glow(d.pos, '#FFFFFF', 1.2, 0.1);
    kit.play('hit_light', 0.6);
    if (d.hp <= 0) {
      d.alive = false;
      d.respawn = 3;
      d.g.visible = false;
      particles.explosion(d.pos, 1.3, '#FF8A3D');
      kit.play('hit_heavy', 0.6);
    }
    return true;
  }
  function resetTargets() { for (const d of targets) { d.alive = true; d.hp = d.maxHp; d.g.visible = true; d.respawn = 0; } }

  // ── 바람에 날리는 먼지 ──
  const dN = kit.count(120);
  const dPos = new Float32Array(dN * 3);
  for (let i = 0; i < dN; i++) { dPos[i * 3] = rnd(-HALF_W, HALF_W); dPos[i * 3 + 1] = rnd(0.2, 5); dPos[i * 3 + 2] = rnd(-HALF_D, HALF_D); }
  const dGeo = new THREE.BufferGeometry();
  dGeo.setAttribute('position', new THREE.BufferAttribute(dPos, 3));
  const dustPts = new THREE.Points(dGeo, new THREE.PointsMaterial({ color: '#BFD4EA', size: 0.07, transparent: true, opacity: 0.55, depthWrite: false }));
  dustPts.frustumCulled = false;
  root.add(dustPts);
  anim.push((dt) => {
    for (let i = 0; i < dN; i++) {
      dPos[i * 3] += dt * (0.8 + (i % 5) * 0.2);
      dPos[i * 3 + 1] += Math.sin(i + simT) * dt * 0.1;
      if (dPos[i * 3] > HALF_W) dPos[i * 3] = -HALF_W;
    }
    dGeo.attributes.position.needsUpdate = true;
  });

  sched.every(7, () => { const t = targets[Math.floor(Math.random() * 4)]; if (t.alive) particles.sparks(t.pos, '#6CFFB5', kit.count(5), 2); }, 0.6);

  const scene = {
    orbit, particles, targets, bounds: { halfW: HALF_W, halfD: HALF_D },
    mount() {
      kit.mount();
      ctx.renderer.setArenaSize(HALF_W, HALF_D, 0);
      orbit.setView({ yaw: 0.5, pitch: 0.5, dist: 20 }, true);
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
    hitTarget, resetTargets,
    ripple(x = 0, z = 0) { floorMat.uniforms.uRip.value.set(x, z, simT, 0); },
    resetView() { orbit.setTarget(V(0, 1, 0)); orbit.setView({ yaw: 0.5, pitch: 0.5, dist: 20 }); },
    setView: (v, i) => orbit.setView(v, i),
    dispose() { offQ(); particles.dispose?.(); kit.dispose(); },
  };
  return scene;
}

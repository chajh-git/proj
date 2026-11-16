// web/scenes/arena-scene.js  (56번)
// 관제 스크린: 경기장 + 관중석 실루엣 + 전광판. 경기를 그리는 장면이다. (명세 14-2, 15장)
//   · loadMatch(init)  경기 시작 때 받은 정적 정보(makeInitInfo)로 전장·기체를 만든다
//   · feed(frame)      관람 버퍼가 돌려준 { snap, events, t } 를 넘긴다 → 다음 update에서 기체·이펙트·소리·카메라에 반영
//   · 지형: 벽·장애물·용암 가장자리·스파이크 패드·급축소 위험 구역·중앙 섬(물)·우주 별밭
//   · 전광판(3D 화면)에 시간·팀별 체력, 관중은 격파·승리 때 환호
//
//   const arena = shell.scene;
//   arena.loadMatch(init);
//   net.on('state', ...) → buffer.push(...);  frame loop: arena.feed(buffer.advance(dt));
//   arena.setCameraMode('overview'|'follow'|'duel'|'free', { id });  arena.focus({ id });
//   arena.timeScale  // 오버드라이브 슬로모션 중 0.35 — 관람 버퍼의 setTimeScale에 넘길 값
//   arena.clearMatch();

import { createParticles } from '../render/effects/particles.js';
import { createBattleFx } from '../render/effects/weapon-fx.js';
import { createCameraDirector } from '../render/camera-director.js';
import { createRobotView } from '../render/robot-view.js';
import { getPartViewAdapter } from '../render/part-view-adapter.js';
import { getMap } from '../../data/maps.js';
import { EFFECT_COLORS, SPACES } from '../../config/theme.js';
import { createSceneKit, canvasScreen, steel, glow, additive, box, cyl, disposeTree, V, rnd, clamp } from './scene-kit.js';

const DEFAULT_INIT = { mapId: 'm1', arena: { halfW: 20, halfD: 14 }, obstacles: [], island: null, spikePads: [], teams: ['A', 'B'], entities: [] };

// 사건 → 소리 (config/sound-manifest.js 의 ID)
const WEAPON_SOUND = { wp_claw: 'wp_claw', wp_fang: 'wp_fang', wp_tail: 'wp_tail', wp_hammer: 'wp_hammer', wp_lift: 'wp_lift', wp_spin_h: 'wp_claw', wp_spin_v: 'wp_claw', wp_plasma: 'wp_plasma', wp_missile: 'wp_missile_launch', wp_stun: 'wp_stun', wp_breath: 'wp_breath', wp_laser: 'wp_laser', wp_emp: 'wp_emp', wp_grav: 'wp_grav', wp_rail: 'wp_rail_fire', wp_nano: 'wp_nano' };

export function createArenaScene(ctx) {
  const kit = createSceneKit(ctx, { name: 'arena' });
  const { THREE, root, sched, camera } = kit;
  const particles = createParticles(root, { quality: ctx.renderer.quality });
  const offQ = ctx.renderer.onQuality((q) => particles.setQuality(q));
  const director = createCameraDirector({ camera, arena: { halfW: 20, halfD: 14 } });
  const views = new Map(); // id → RobotView
  const teamOf = new Map();
  const battleFx = createBattleFx({ scene: root, particles, getView: (id) => views.get(id) });
  let stage = null; // 경기마다 새로 만드는 전장 묶음
  let init = null;
  let map = null;
  let pending = null;
  let lastSnap = null;
  let lastT = 0;
  let slow = 0; // 슬로모션 남은 시간
  let lastCount = -1;
  let lastPhase = '';
  let cheer = 0;
  let screenAcc = 0;
  const anim = [];

  // ── 전광판 ──
  const board = canvasScreen(1024, 288, (g, w, h, info) => {
    g.fillStyle = '#050A14';
    g.fillRect(0, 0, w, h);
    g.strokeStyle = SPACES.arena.palette.primary;
    g.lineWidth = 6;
    g.strokeRect(6, 6, w - 12, h - 12);
    if (!info) return;
    g.textAlign = 'center';
    g.textBaseline = 'middle';
    g.font = 'bold 30px "Malgun Gothic","Noto Sans KR",sans-serif';
    g.fillStyle = '#8FA3C2';
    g.fillText(info.title, w / 2, 40);
    const mm = String(Math.floor(info.time / 60)).padStart(2, '0');
    const ss = String(Math.floor(info.time % 60)).padStart(2, '0');
    g.font = 'bold 96px "Malgun Gothic",monospace';
    g.fillStyle = info.hot ? '#FF6A3D' : '#EAF2FF';
    g.fillText(`${mm}:${ss}`, w / 2, 132);
    g.font = 'bold 26px "Malgun Gothic","Noto Sans KR",sans-serif';
    g.fillStyle = '#8FA3C2';
    g.fillText(info.status, w / 2, 200);
    info.teams.forEach((tm, i) => {
      const x0 = i === 0 ? 40 : w - 40 - 380;
      g.fillStyle = tm.color;
      g.textAlign = i === 0 ? 'left' : 'right';
      g.font = 'bold 34px "Malgun Gothic","Noto Sans KR",sans-serif';
      g.fillText(tm.name, i === 0 ? x0 : x0 + 380, 232);
      g.fillStyle = '#18202E';
      g.fillRect(x0, 250, 380, 20);
      g.fillStyle = tm.color;
      const bw = 380 * clamp(tm.hp, 0, 1);
      g.fillRect(i === 0 ? x0 : x0 + 380 - bw, 250, bw, 20);
    });
  });

  // ── 전장 만들기 ──────────────────────────────────────
  function buildStage(info) {
    const g = new THREE.Group();
    g.name = 'stage';
    root.add(g);
    const { halfW, halfD } = info.arena;
    map = getMap(info.mapId) || getMap('m1');
    const rules = map.rules || {};
    const pv = map.preview || { floor: '#2A303B', hazard: '#E5484D' };
    const s = { group: g, halfW, halfD, shrink: [], spikes: [], lava: null, crowd: null, extras: [] };

    // 바닥 판
    const floorMat = new THREE.MeshStandardMaterial({ color: pv.floor, roughness: map.env === 'water' ? 0.25 : 0.8, metalness: map.env === 'water' ? 0.6 : 0.3 });
    const floor = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfD * 2), floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.y = 0.005;
    floor.receiveShadow = true;
    g.add(floor);
    s.floor = floor;
    // 격자 + 중앙선
    const lineMat = additive('#8FA3C2', 0.12);
    for (let x = -Math.floor(halfW / 4) * 4; x <= halfW; x += 4) { const l = new THREE.Mesh(new THREE.PlaneGeometry(0.05, halfD * 2), lineMat); l.rotation.x = -Math.PI / 2; l.position.set(x, 0.012, 0); g.add(l); }
    for (let z = -Math.floor(halfD / 4) * 4; z <= halfD; z += 4) { const l = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, 0.05), lineMat); l.rotation.x = -Math.PI / 2; l.position.set(0, 0.012, z); g.add(l); }
    const mid = new THREE.Mesh(new THREE.PlaneGeometry(0.25, halfD * 2), additive('#FFFFFF', 0.25));
    mid.rotation.x = -Math.PI / 2; mid.position.y = 0.014; g.add(mid);
    // 출발 구역(팀 색)
    for (const [sx, col] of [[-1, EFFECT_COLORS.teamA], [1, EFFECT_COLORS.teamB]]) {
      const z = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 0.35, halfD * 2), additive(col, 0.07));
      z.rotation.x = -Math.PI / 2; z.position.set(sx * (halfW - halfW * 0.175), 0.013, 0); g.add(z);
    }

    // 둘레 벽
    const wallMat = steel('#2B323C', 0.7, 0.6);
    const edge = glow(pv.hazard, 0.9);
    [[0, -halfD - 0.4, halfW * 2 + 1.6, 0.8], [0, halfD + 0.4, halfW * 2 + 1.6, 0.8], [-halfW - 0.4, 0, 0.8, halfD * 2], [halfW + 0.4, 0, 0.8, halfD * 2]].forEach(([x, z, w, d]) => {
      box(w, 1.4, d, wallMat, x, 0.7, z, g);
      box(w > d ? w : 0.12, 0.1, w > d ? 0.12 : d, edge, x + (w > d ? 0 : (x < 0 ? 0.3 : -0.3)), 1.45, z + (w > d ? (z < 0 ? 0.3 : -0.3) : 0), g);
    });

    // 장애물(벽)
    const obMat = steel('#4A5260', 0.55, 0.75);
    for (const o of info.obstacles || []) {
      const w = o.max.x - o.min.x;
      const d = o.max.z - o.min.z;
      const m = box(w, 3, d, obMat, (o.min.x + o.max.x) / 2, 1.5, (o.min.z + o.max.z) / 2, g);
      const e = new THREE.LineSegments(new THREE.EdgesGeometry(m.geometry), new THREE.LineBasicMaterial({ color: '#8FC4F5', toneMapped: false }));
      m.add(e);
    }

    // 중앙 섬(심해 해구): 바닥은 물, 섬 위가 땅
    if (info.island) {
      const isl = info.island;
      const water = new THREE.ShaderMaterial({
        transparent: true,
        uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xz; gl_Position=projectionMatrix*viewMatrix*w; }',
        fragmentShader: 'varying vec2 vW; uniform float uTime; void main(){ float a = sin(vW.x*0.7+uTime*1.3)+sin(vW.y*0.9-uTime*1.1)+sin((vW.x+vW.y)*0.5+uTime*0.7); float c = 0.5+0.16*a; gl_FragColor = vec4(vec3(0.03,0.22,0.42)*c*1.6+vec3(0.02,0.08,0.14), 0.92); }',
      });
      const wp = new THREE.Mesh(new THREE.PlaneGeometry(halfW * 2, halfD * 2), water);
      wp.rotation.x = -Math.PI / 2; wp.position.y = 0.02; g.add(wp);
      s.water = water;
      const island = cyl(isl.radius, isl.radius + 0.4, 0.5, steel('#3A3F46', 0.9, 0.2), isl.x, 0.25, isl.z, g, 48);
      island.receiveShadow = true;
      const rim = new THREE.Mesh(new THREE.RingGeometry(isl.radius, isl.radius + 0.5, 64), additive('#7CD7FF', 0.55));
      rim.rotation.x = -Math.PI / 2; rim.position.set(isl.x, 0.52, isl.z); g.add(rim);
      floor.visible = false;
    }

    // 용암 가장자리
    if (rules.lavaEdge) {
      const wd = rules.lavaEdge.widthMeters;
      const lavaMat = new THREE.ShaderMaterial({
        uniforms: { uTime: { value: 0 } },
        vertexShader: 'varying vec2 vW; void main(){ vec4 w = modelMatrix*vec4(position,1.0); vW=w.xz; gl_Position=projectionMatrix*viewMatrix*w; }',
        fragmentShader: 'varying vec2 vW; uniform float uTime; void main(){ float n = sin(vW.x*1.3+uTime*0.8)*sin(vW.y*1.1-uTime*0.6)+sin((vW.x-vW.y)*0.8+uTime*1.1); float k = 0.55+0.25*n; gl_FragColor = vec4(vec3(1.0,0.28+0.3*k,0.04)*(0.7+0.6*k),1.0); }',
      });
      const strips = [[0, -halfD + wd / 2, halfW * 2, wd], [0, halfD - wd / 2, halfW * 2, wd], [-halfW + wd / 2, 0, wd, halfD * 2 - wd * 2], [halfW - wd / 2, 0, wd, halfD * 2 - wd * 2]];
      for (const [x, z, w, d] of strips) { const m = new THREE.Mesh(new THREE.PlaneGeometry(w, d), lavaMat); m.rotation.x = -Math.PI / 2; m.position.set(x, 0.03, z); g.add(m); }
      s.lava = lavaMat;
      const lv = new THREE.PointLight('#FF6A1F', 90, 40, 2);
      lv.position.set(0, 3, 0);
      g.add(lv);
    }

    // 스파이크 패드
    for (const p of info.spikePads || []) {
      const pad = new THREE.Group();
      pad.position.set(p.x, 0, p.z);
      g.add(pad);
      const plate = new THREE.Mesh(new THREE.CircleGeometry(p.radius, 28), new THREE.MeshStandardMaterial({ color: '#2B2F36', roughness: 0.7, metalness: 0.6 }));
      plate.rotation.x = -Math.PI / 2; plate.position.y = 0.02; pad.add(plate);
      const ring = new THREE.Mesh(new THREE.RingGeometry(p.radius - 0.15, p.radius, 32), additive('#FF4D4D', 0.0));
      ring.rotation.x = -Math.PI / 2; ring.position.y = 0.03; pad.add(ring);
      const cones = new THREE.Group();
      cones.position.y = -1.2;
      for (let i = 0; i < 9; i++) {
        const a = (i / 9) * Math.PI * 2;
        const rr = i === 0 ? 0 : p.radius * 0.6;
        const c = new THREE.Mesh(new THREE.ConeGeometry(0.28, 1.4, 6), steel('#B8C0CC', 0.3, 0.9));
        c.position.set(Math.cos(a) * rr, 0.7, Math.sin(a) * rr);
        cones.add(c);
      }
      pad.add(cones);
      s.spikes.push({ pad, ring, cones, until: 0 });
    }

    // 급축소 위험 구역(경기장 가장자리부터 안쪽으로 붉게)
    const hz = additive('#FF3D3D', 0.28);
    for (let i = 0; i < 4; i++) { const m = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), hz); m.rotation.x = -Math.PI / 2; m.position.y = 0.04; m.visible = false; g.add(m); s.shrink.push(m); }
    const bound = new THREE.LineLoop(new THREE.BufferGeometry().setFromPoints([V(-1, 0, -1), V(1, 0, -1), V(1, 0, 1), V(-1, 0, 1)]), new THREE.LineBasicMaterial({ color: '#FF6A6A', toneMapped: false }));
    bound.position.y = 0.06;
    bound.visible = false;
    g.add(bound);
    s.bound = bound;

    // 우주(저중력): 별밭
    if (map.env === 'space') {
      const N = kit.count(500);
      const p = new Float32Array(N * 3);
      for (let i = 0; i < N; i++) { const a = rnd(0, 6.28); const b = rnd(0.05, 1.3); const r = rnd(70, 110); p[i * 3] = Math.cos(a) * Math.cos(b) * r; p[i * 3 + 1] = Math.sin(b) * r * 0.7; p[i * 3 + 2] = Math.sin(a) * Math.cos(b) * r; }
      const sg = new THREE.BufferGeometry();
      sg.setAttribute('position', new THREE.BufferAttribute(p, 3));
      const stars = new THREE.Points(sg, new THREE.PointsMaterial({ color: '#FFFFFF', size: 0.5, sizeAttenuation: true, depthWrite: false }));
      stars.frustumCulled = false;
      g.add(stars);
      s.extras.push(stars);
    }

    // 관중석 + 관중 실루엣
    buildStands(s, halfW, halfD);

    // 전광판
    const screenMesh = new THREE.Mesh(new THREE.PlaneGeometry(26, 7.3), board.material);
    screenMesh.position.set(0, 14, -halfD - 17);
    const frame = box(27, 8.3, 0.5, steel('#10151D', 0.5, 0.7), 0, 14, -halfD - 17.3, g);
    void frame;
    g.add(screenMesh);
    for (const sx of [-12, 12]) box(0.8, 14, 0.8, steel('#10151D', 0.5, 0.7), sx, 7, -halfD - 17.5, g);

    // 모서리 조명 기둥(빛줄기)
    for (const [x, z] of [[-halfW - 3, -halfD - 3], [halfW + 3, -halfD - 3], [-halfW - 3, halfD + 3], [halfW + 3, halfD + 3]]) {
      cyl(0.35, 0.5, 8, steel('#1A2029', 0.5, 0.7), x, 4, z, g);
      const shaft = new THREE.Mesh(new THREE.ConeGeometry(4.5, 8, 16, 1, true), additive('#CFE4FF', 0.07));
      shaft.position.set(x * 0.9, 4, z * 0.9);
      shaft.rotation.set((z < 0 ? 1 : -1) * 0.25, 0, (x < 0 ? -1 : 1) * 0.25);
      shaft.position.y = 4.5;
      g.add(shaft);
    }
    return s;
  }

  function buildStands(s, halfW, halfD) {
    const g = s.group;
    const standMat = steel('#1A212C', 0.9, 0.2);
    const people = [];
    const sides = [
      { len: halfW * 2 + 12, axis: 'x', sign: -1, off: halfD },
      { len: halfW * 2 + 12, axis: 'x', sign: 1, off: halfD },
      { len: halfD * 2 + 12, axis: 'z', sign: -1, off: halfW },
      { len: halfD * 2 + 12, axis: 'z', sign: 1, off: halfW },
    ];
    const spacing = Math.max(1.0, ((halfW + halfD) * 4 * 4) / Math.max(1, kit.count(420)));
    for (const sd of sides) {
      for (let k = 0; k < 4; k++) {
        const d = 3.2 + k * 1.7;
        const h = 0.9 + k * 1.15;
        const pos = sd.off + d;
        const w = sd.len;
        if (sd.axis === 'x') box(w, h, 1.7, standMat, 0, h / 2, sd.sign * pos, g);
        else box(1.7, h, w, standMat, sd.sign * pos, h / 2, 0, g);
        for (let u = -w / 2 + 0.8; u < w / 2 - 0.5; u += spacing * rnd(0.9, 1.4)) {
          if (Math.random() < 0.12) continue;
          people.push({ x: sd.axis === 'x' ? u : sd.sign * pos, z: sd.axis === 'x' ? sd.sign * pos : u, y: h + 0.55, ph: rnd(0, 6.28), sc: rnd(0.85, 1.15) });
        }
      }
    }
    const geo = new THREE.CapsuleGeometry(0.26, 0.55, 3, 6);
    geo.userData.shared = false;
    const mesh = new THREE.InstancedMesh(geo, new THREE.MeshStandardMaterial({ color: '#FFFFFF', roughness: 0.95, metalness: 0 }), people.length);
    const palette = ['#2A3550', '#3A2A3E', '#2A4048', '#40362A', '#25303A', '#4A3440', '#33404F'];
    const c = new THREE.Color();
    people.forEach((p, i) => { c.set(palette[i % palette.length]).offsetHSL(rnd(-0.02, 0.02), 0, rnd(-0.03, 0.05)); mesh.setColorAt(i, c); });
    mesh.frustumCulled = false;
    g.add(mesh);
    s.crowd = { mesh, people };
    updateCrowd(0, true);
  }

  const dummyM = new THREE.Object3D();
  function updateCrowd(t, force = false) {
    const cr = stage?.crowd;
    if (!cr) return;
    const amp = 0.08 + cheer * 0.55;
    cr.people.forEach((p, i) => {
      const jump = Math.max(0, Math.sin(t * (2 + cheer * 6) + p.ph)) * amp;
      dummyM.position.set(p.x, p.y + jump, p.z);
      dummyM.scale.set(p.sc, p.sc * (1 + cheer * 0.1), p.sc);
      dummyM.updateMatrix();
      cr.mesh.setMatrixAt(i, dummyM.matrix);
    });
    cr.mesh.instanceMatrix.needsUpdate = true;
    void force;
  }

  // ── 경기 불러오기·비우기 ─────────────────────────────
  function clearMatch() {
    for (const v of views.values()) { v.group.parent?.remove(v.group); v.dispose?.(); }
    views.clear();
    teamOf.clear();
    if (stage) { disposeTree(stage.group); stage = null; }
    particles.clear?.();
    lastSnap = null;
    pending = null;
    lastCount = -1;
    lastPhase = '';
  }

  function loadMatch(info = DEFAULT_INIT) {
    clearMatch();
    init = info;
    stage = buildStage(info);
    ctx.renderer.setArenaSize(info.arena.halfW, info.arena.halfD, 60);
    director.setArena(info.arena);
    const adapter = getPartViewAdapter();
    for (const en of info.entities || []) {
      teamOf.set(en.id, en.team);
      if (!adapter) continue;
      const view = createRobotView({ info: en, adapter, particles, team: en.team, label: true });
      root.add(view.group);
      views.set(en.id, view);
    }
    director.setMode('overview');
    drawBoard(null);
    return true;
  }

  // ── 전광판 ──
  function teamStats(snap) {
    const sums = new Map();
    for (const en of init?.entities || []) {
      const cur = snap?.ents.find((e) => e.id === en.id);
      const a = sums.get(en.team) || { hp: 0, max: 0, names: [] };
      a.max += en.maxHp;
      a.hp += cur ? cur.hp : en.maxHp;
      a.names.push(en.name);
      sums.set(en.team, a);
    }
    return sums;
  }
  function drawBoard(snap) {
    const sums = teamStats(snap);
    const ids = init?.teams?.length ? init.teams : ['A', 'B'];
    const timeLeft = snap ? Math.max(0, 180 - snap.t) : 180;
    board.redraw({
      title: map?.name || '',
      time: snap?.phase === 'countdown' ? 180 : timeLeft,
      hot: Boolean(snap && snap.phase !== 'countdown' && timeLeft < 20),
      status: !snap ? '' : snap.result ? '경기 종료' : snap.phase === 'countdown' ? '준비' : snap.phase === 'extension' ? '연장전' : '경기 중',
      teams: ids.slice(0, 2).map((id, i) => {
        const a = sums.get(id) || { hp: 1, max: 1, names: [id] };
        return { name: a.names.join(' · ').slice(0, 18) || `팀 ${id}`, hp: a.max ? a.hp / a.max : 0, color: i === 0 ? EFFECT_COLORS.teamA : EFFECT_COLORS.teamB };
      }),
    });
  }

  // ── 사건 → 소리·카메라·후처리 ──
  const distVol = (x, z) => clamp(1 - (camera.position.distanceTo(V(x, 1, z)) - 14) / 70, 0.35, 1);
  function posOf(ev) {
    const id = ev.victim || ev.entity || ev.target;
    const v = id ? views.get(id) : null;
    if (v) { const p = v.getCenterWorldPos(V()); return p; }
    if (ev.x !== undefined) return V(ev.x, 1, ev.z);
    return V(0, 1, 0);
  }
  function eventSound(ev) {
    const p = posOf(ev);
    const vol = distVol(p.x, p.z);
    const play = (id, k = 1) => kit.play(id, vol * k);
    switch (ev.type) {
      case 'fire': play(WEAPON_SOUND[ev.weapon] || 'wp_claw'); break;
      case 'hit': play((ev.amount || 0) >= 40 ? 'hit_heavy' : 'hit_light'); break;
      case 'part_broken': play('part_break'); break;
      case 'part_lost': play('part_detach_boom'); break;
      case 'ko': play('ko'); cheer = 1.2; kit.play('crowd_cheer', 0.7); break;
      case 'ram': play('robot_collide'); break;
      case 'shield_break': play('shield_break'); break;
      case 'absorbed': play('shield_hit', 0.8); break;
      case 'intercepted': case 'projectile_blocked': play('intercept'); break;
      case 'meteor_impact': case 'spikes_fire': play('hazard_hit'); break;
      case 'emp': play('wp_emp', 0.6); break;
      case 'overdrive': play('overdrive_fire'); break;
      case 'skill': play('awaken_skill'); break;
      case 'phase': play('phase_shift'); break;
      case 'revive': play('revive'); break;
      case 'transform': play('transform'); break;
      case 'extension': kit.play('hazard_warn'); break;
      case 'end': kit.play('match_end'); cheer = 1.5; kit.play('crowd_cheer', 0.8); break;
      case 'rail': play('wp_rail_fire'); break;
      default: break;
    }
  }
  function directorEnts(snap) {
    return snap.ents.map((e) => ({ id: e.id, x: e.x, z: e.z, h: e.h, alive: e.a === 1, alt: e.alt, team: teamOf.get(e.id) }));
  }
  function handleEvents(events, ents) {
    for (const ev of events) {
      battleFx.handleEvent(ev);
      director.onEvent(ev, ents);
      ctx.postfx?.onEvent?.(ev);
      eventSound(ev);
      if (ev.type === 'overdrive') { slow = 1.4; ctx.postfx?.setSlowmo?.(1); kit.play('slowmo_in', 0.6); }
      if (ev.type === 'spikes_fire' && stage) {
        const pad = stage.spikes.reduce((b, sp) => { const d = Math.hypot(sp.pad.position.x - ev.x, sp.pad.position.z - ev.z); return !b || d < b.d ? { sp, d } : b; }, null);
        if (pad && pad.d < 3) pad.sp.until = (map?.rules?.spikes?.activeSeconds || 1.5);
      }
    }
  }

  // ── 한 프레임 반영 ──
  function applyFrame(frame, dt) {
    const snap = frame?.snap || lastSnap;
    if (!snap) return;
    const t = frame?.t ?? lastT;
    lastSnap = snap;
    lastT = t;
    const ents = directorEnts(snap);
    for (const e of snap.ents) views.get(e.id)?.update(e, dt, t);
    battleFx.syncProjectiles(snap.proj);
    battleFx.syncWarnings(snap.warn);

    // 급축소 구역
    if (stage) {
      const { halfW, halfD } = stage;
      const hw = snap.area?.hw ?? halfW;
      const hd = snap.area?.hd ?? halfD;
      const shrunk = halfW - hw > 0.05 || halfD - hd > 0.05;
      const [top, bottom, left, right] = stage.shrink;
      top.visible = bottom.visible = left.visible = right.visible = shrunk;
      stage.bound.visible = shrunk;
      if (shrunk) {
        top.scale.set(halfW * 2, halfD - hd, 1); top.position.set(0, 0.04, -(hd + halfD) / 2);
        bottom.scale.set(halfW * 2, halfD - hd, 1); bottom.position.set(0, 0.04, (hd + halfD) / 2);
        left.scale.set(halfW - hw, hd * 2, 1); left.position.set(-(hw + halfW) / 2, 0.04, 0);
        right.scale.set(halfW - hw, hd * 2, 1); right.position.set((hw + halfW) / 2, 0.04, 0);
        stage.bound.scale.set(hw, 1, hd);
      }
    }

    // 개시 카운트다운·국면 소리
    if (snap.phase === 'countdown') {
      const n = Math.ceil(snap.countdown);
      if (n !== lastCount && n > 0) { kit.play('countdown_tick'); lastCount = n; }
    }
    if (lastPhase === 'countdown' && snap.phase !== 'countdown') { kit.play('countdown_go'); kit.play('match_start', 0.8); }
    lastPhase = snap.phase;

    // EMP 예고 중에는 번개
    if (battleFx.state.empWarning && Math.random() < dt * 8) {
      const a = V(rnd(-stage.halfW, stage.halfW), 6, rnd(-stage.halfD, stage.halfD));
      battleFx.lightning(a, V(a.x + rnd(-3, 3), 0, a.z + rnd(-3, 3)), '#B58CFF', 0.2);
    }
    handleEvents(frame?.events || [], ents);
    director.update(dt, ents);
  }

  const scene = {
    director, particles, battleFx, views, THREE, root, kit,
    get postfx() { return ctx.postfx; },
    get timeScale() { return slow > 0 ? 0.35 : 1; },
    get init() { return init; },
    mount() {
      kit.mount();
      if (!stage) loadMatch(DEFAULT_INIT);
    },
    unmount() { kit.unmount(); },
    loadMatch, clearMatch,
    feed(frame) { pending = frame; },
    update(dt, t) {
      sched.update(dt);
      for (const fn of anim) fn(dt, t);
      const frame = pending;
      pending = null;
      if (init) {
        applyFrame(frame, dt);
      }
      if (slow > 0) { slow -= dt; if (slow <= 0) { ctx.postfx?.setSlowmo?.(0); kit.play('slowmo_out', 0.6); } }
      cheer = Math.max(0, cheer - dt * 0.35);
      if (stage) {
        if (stage.lava) stage.lava.uniforms.uTime.value = t;
        if (stage.water) stage.water.uniforms.uTime.value = t;
        for (const sp of stage.spikes) {
          sp.until = Math.max(0, sp.until - dt);
          const up = sp.until > 0 ? 1 : 0;
          sp.cones.position.y += ((up ? 0 : -1.2) - sp.cones.position.y) * Math.min(1, dt * 18);
          const warn = battleFx.state.spikesWarning ? 0.4 + 0.5 * Math.sin(t * 14) : up ? 0.8 : 0;
          sp.ring.material.opacity += (Math.max(0, warn) - sp.ring.material.opacity) * Math.min(1, dt * 12);
        }
      }
      screenAcc += dt;
      if (screenAcc > 0.5) { screenAcc = 0; drawBoard(lastSnap); updateCrowd(t); }
      else if (cheer > 0.02 && Math.floor(t * 20) !== Math.floor((t - dt) * 20)) updateCrowd(t);
      battleFx.update(dt);
      particles.update(dt);
    },
    onDrag: (dx, dy) => director.orbitBy(-dx * 0.005, dy * 0.004),
    onWheel: (dy) => director.zoomBy(1 + dy * 0.0012),
    setCameraMode: (m, o) => director.setMode(m, o),
    focus: (o) => director.focus(o),
    cheer(amount = 1) { cheer = Math.max(cheer, amount); kit.play('crowd_cheer', 0.7); },
    dispose() {
      offQ();
      clearMatch();
      battleFx.dispose();
      particles.dispose?.();
      board.tex.dispose();
      kit.dispose();
    },
  };
  return scene;
}

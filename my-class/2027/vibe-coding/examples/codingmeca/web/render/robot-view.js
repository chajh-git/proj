// web/render/robot-view.js  (40번)
// 기체 뷰: 서버 스냅샷의 '파츠 상태'만 읽어 기체를 그린다 (명세 v1.0 15장). 파츠 모양은 어댑터가 만든다.
//  · 파츠 배치는 경기 시작 때 받은 정적 정보(snapshot.makeInitInfo의 entities[i])를 쓴다.
//  · 격납고 작업대 등 경기 밖에서도 쓸 수 있도록 infoFromDesign(design)이 같은 형태의 정보를 만들어 준다.
//
//   const view = createRobotView({ info, adapter, scene, particles, team: 'A' });
//   view.update(snapEnt, dt, time);   // snapEnt = 스냅샷 ents[i] (정적 보기라면 생략 가능)
//   view.group 을 장면에 add.

import * as THREE from 'three';
import { buildTree, DEFAULT_CTX } from '../../shared/build/assembly.js';
import { layoutTree } from '../../shared/build/layout.js';
import { PART_BY_ID } from '../../data/parts.js';
import { EFFECT_COLORS } from '../../config/theme.js';
import { orientationFor, stateFromSnapshot } from './part-view-adapter.js';
import { createShieldDome } from './effects/weapon-fx.js';

// 고도층 → 화면 높이(m)
export const ALTITUDE_Y = Object.freeze({ ground: 0, low: 2.4, high: 5.2 });
const FLAG = { stealth: 1, shield: 2, emp: 4, immobilized: 8, invuln: 16, rush: 32, transform: 64 }; // snapshot.js의 FLAG와 같은 값

const r3 = (v) => Math.round(v * 1000) / 1000;

/** 설계 → 기체 정보(makeInitInfo.entities[i]와 같은 모양). 경기 밖 화면(격납고 등)에서 사용 */
export function infoFromDesign(design, { ctx = DEFAULT_CTX, id = 'X1', team = 'A' } = {}) {
  const tree = buildTree(design, ctx);
  const layout = layoutTree(tree, ctx);
  let radius = 0;
  for (const it of layout.items.values()) {
    for (const x of [it.box.min.x, it.box.max.x]) for (const z of [it.box.min.z, it.box.max.z]) radius = Math.max(radius, Math.hypot(x, z));
  }
  return {
    id, team, index: 0, name: design.name, radius: r3(radius),
    parts: tree.order.map((uid) => {
      const n = tree.nodes.get(uid);
      const it = layout.items.get(uid);
      return { uid, part: n.partId, parent: n.parentUid, out: n.outKey, form: n.form, x: r3(it.center.x), y: r3(it.center.y), z: r3(it.center.z), edge: r3(it.edge) };
    }),
    groundOffset: r3(layout.groundOffset),
  };
}

// ── 이름표(이름 + 체력/에너지 막대) ──────────────────────
function createLabel(name, teamColor) {
  const canvas = document.createElement('canvas');
  canvas.width = 256;
  canvas.height = 72;
  const tex = new THREE.CanvasTexture(canvas);
  tex.colorSpace = THREE.SRGBColorSpace;
  const sprite = new THREE.Sprite(new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false }));
  sprite.scale.set(5, 5 * (72 / 256), 1);
  sprite.renderOrder = 50;
  const ctx = canvas.getContext('2d');
  let key = '';
  return {
    sprite,
    draw(hpPct, enPct, dead) {
      const k = `${Math.round(hpPct)}|${Math.round(enPct)}|${dead}`;
      if (k === key) return;
      key = k;
      ctx.clearRect(0, 0, 256, 72);
      ctx.fillStyle = 'rgba(8,12,20,0.62)';
      ctx.beginPath();
      ctx.roundRect(2, 2, 252, 68, 10);
      ctx.fill();
      ctx.fillStyle = teamColor;
      ctx.fillRect(2, 2, 6, 68);
      ctx.font = 'bold 22px sans-serif';
      ctx.fillStyle = dead ? '#8A95A5' : '#FFFFFF';
      ctx.textBaseline = 'middle';
      ctx.fillText(name.slice(0, 12), 18, 20);
      const bar = (y, pct, color) => {
        ctx.fillStyle = 'rgba(255,255,255,0.15)';
        ctx.fillRect(18, y, 220, 10);
        ctx.fillStyle = color;
        ctx.fillRect(18, y, 220 * Math.max(0, Math.min(1, pct / 100)), 10);
      };
      bar(38, hpPct, hpPct > 60 ? EFFECT_COLORS.hpHigh : hpPct > 30 ? EFFECT_COLORS.hpMid : EFFECT_COLORS.hpLow);
      bar(54, enPct, '#4DE1FF');
      tex.needsUpdate = true;
    },
  };
}

export function createRobotView({ info, adapter, scene = null, particles = null, team = info.team, label = true, spaceTint = null }) {
  const teamColor = team === 'B' ? EFFECT_COLORS.teamB : EFFECT_COLORS.teamA;
  const group = new THREE.Group(); // 월드 위치(x,z)·방향(heading)
  group.name = `robot:${info.id}`;
  const air = new THREE.Group(); // 고도
  const body = new THREE.Group(); // 바닥에 맞춘 오프셋
  body.position.y = info.groundOffset || 0;
  air.add(body);
  group.add(air);

  // 바닥 팀 링 + 그림자 덩어리
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(info.radius * 0.92, info.radius, 48),
    new THREE.MeshBasicMaterial({ color: teamColor, transparent: true, opacity: 0.55, side: THREE.DoubleSide, depthWrite: false }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.03;
  group.add(ring);
  const blob = new THREE.Mesh(
    new THREE.CircleGeometry(info.radius * 0.8, 24),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.3, depthWrite: false }),
  );
  blob.rotation.x = -Math.PI / 2;
  blob.position.y = 0.02;
  group.add(blob);

  // 파츠 만들기
  const nodes = new Map(); // uid → node
  const list = []; // info.parts 순서(스냅샷 p[] 순서와 같음)
  let topY = 0;
  for (const p of info.parts) {
    const def = PART_BY_ID[p.part];
    const obj = adapter.build(def, { edge: p.edge, form: p.form });
    const o = orientationFor(p.out);
    obj.rotation.set(o.x, o.y, o.z);
    obj.position.set(p.x, p.y, p.z);
    body.add(obj);
    topY = Math.max(topY, p.y + p.edge / 2);
    const node = {
      uid: p.uid, partId: p.part, def, obj, form: p.form, parent: p.parent, edge: p.edge,
      status: 'ok', pct: 100, scale: 1, active: true, detached: false, smokeT: Math.random() * 0.3,
    };
    nodes.set(p.uid, node);
    list.push(node);
  }

  let shield = null;
  const labelObj = label ? createLabel(info.name, teamColor) : null;
  if (labelObj) {
    labelObj.sprite.position.y = (info.groundOffset || 0) + topY + 1.4;
    air.add(labelObj.sprite);
  }

  const debris = [];
  const debrisParent = () => scene || group.parent;
  const tmpV = new THREE.Vector3();
  const tmpQ = new THREE.Quaternion();
  const tmpS = new THREE.Vector3();
  let ghost = false;
  let alive = true;
  let deadApplied = false;
  let lastPos = null;
  let speed = 0;
  let invulnT = 0;
  let empT = 0;

  const isSmoking = (obj) => obj.userData.smoking || obj.children[0]?.userData?.smoking;

  // 반투명(은신) 적용
  function setGhost(on) {
    if (ghost === on) return;
    ghost = on;
    body.traverse((o) => {
      const m = o.material;
      if (!m || o.isLineSegments) return;
      for (const mm of Array.isArray(m) ? m : [m]) {
        if (mm.userData.baseOpacity === undefined) { mm.userData.baseOpacity = mm.opacity; mm.userData.baseTransparent = mm.transparent; }
        mm.transparent = on || mm.userData.baseTransparent;
        mm.opacity = on ? Math.min(0.22, mm.userData.baseOpacity) : mm.userData.baseOpacity;
        mm.depthWrite = !on;
      }
    });
  }

  // 파츠 이탈: 월드 변환을 유지한 채 떼어 내 날려 보낸다
  function detachNode(node) {
    if (node.detached) return;
    node.detached = true;
    const obj = node.obj;
    const parentScene = debrisParent();
    obj.updateWorldMatrix(true, false);
    obj.getWorldPosition(tmpV);
    obj.getWorldQuaternion(tmpQ);
    obj.getWorldScale(tmpS);
    const wp = tmpV.clone();
    const wq = tmpQ.clone();
    const ws = tmpS.clone();
    adapter.detach(obj);
    if (!parentScene) return;
    parentScene.add(obj);
    obj.position.copy(wp);
    obj.quaternion.copy(wq);
    obj.scale.copy(ws);
    const center = group.getWorldPosition(new THREE.Vector3());
    const out = wp.clone().sub(center);
    out.y = Math.abs(out.y) * 0.5 + 2;
    out.normalize().multiplyScalar(4 + Math.random() * 4);
    debris.push({ obj, vel: out, spin: new THREE.Vector3(Math.random() * 8 - 4, Math.random() * 8 - 4, Math.random() * 8 - 4), life: 3 });
    particles?.explosion(wp, 0.6, '#FF8A3D');
  }

  function applyDead() {
    deadApplied = true;
    for (const n of list) if (!n.detached) adapter.applyState(n.obj, { status: 'broken', durabilityPct: 0, working: false });
  }

  const view = {
    info, group, air, body, nodes, list, teamColor,
    get alive() { return alive; },
    get speed() { return speed; },
    get topY() { return (info.groundOffset || 0) + topY; },

    // 파츠의 월드 위치
    getPartWorldPos(uid, out = new THREE.Vector3()) {
      const n = nodes.get(uid);
      if (!n) return out.copy(group.position);
      n.obj.updateWorldMatrix(true, false);
      return n.obj.getWorldPosition(out);
    },
    // 총구 위치: 파츠 앞면 중심
    getMuzzleWorldPos(uid, out = new THREE.Vector3()) {
      const n = nodes.get(uid);
      if (!n) return out.copy(group.position);
      n.obj.updateWorldMatrix(true, false);
      return n.obj.localToWorld(out.set(0, 0, -n.edge / 2));
    },
    // 기체 중심(코어)의 월드 위치
    getCenterWorldPos(out = new THREE.Vector3()) {
      body.updateWorldMatrix(true, false);
      return body.localToWorld(out.set(0, 0, 0));
    },
    uidsOfPart(partId) {
      return list.filter((n) => n.partId === partId && !n.detached).map((n) => n.uid);
    },
    flashPart(uid, color = '#FFFFFF') {
      const n = nodes.get(uid);
      if (n && !n.detached) adapter.flash?.(n.obj, color);
    },
    flashAll(color = '#FFFFFF') {
      for (const n of list) if (!n.detached) adapter.flash?.(n.obj, color);
    },
    ripple(point) {
      shield?.ripple(point);
    },
    breakShield() {
      shield?.shatter();
    },

    /** 스냅샷 ents[i] 하나로 갱신. snap이 없으면 애니메이션만 */
    update(snap, dt, time) {
      if (snap) {
        group.position.set(snap.x, 0, snap.z);
        group.rotation.y = snap.h;
        const targetY = ALTITUDE_Y[snap.altTo || snap.alt] ?? 0;
        air.position.y += (targetY - air.position.y) * Math.min(1, dt * 4);
        const fl = snap.fl || 0;

        // 속도(먼지·돌진 연출용)
        if (lastPos && dt > 0) speed = Math.hypot(snap.x - lastPos.x, snap.z - lastPos.z) / dt;
        lastPos = { x: snap.x, z: snap.z };

        // 파츠 상태
        for (let i = 0; i < list.length; i++) {
          const n = list[i];
          if (n.detached) continue;
          const st = stateFromSnapshot(snap.p?.[i]);
          if (st.status === 'detached') { detachNode(n); continue; }
          if (st.status !== n.status || Math.abs(st.durabilityPct - n.pct) >= 5) {
            n.status = st.status;
            n.pct = st.durabilityPct;
            adapter.applyState(n.obj, st);
          }
        }

        // 형태 A/B: 활성이 아닌 파츠(와 그 하위)는 접어서 숨김
        for (const n of list) {
          if (n.detached) continue;
          const parentActive = n.parent ? nodes.get(n.parent)?.active !== false : true;
          n.active = parentActive && (n.form === 'both' || n.form === snap.form);
          const target = n.active ? 1 : 0.001;
          const speedK = fl & FLAG.transform ? 5 : 10;
          n.scale += (target - n.scale) * Math.min(1, dt * speedK);
          n.obj.scale.setScalar(n.scale);
          n.obj.visible = n.scale > 0.02;
        }

        // 효과 플래그
        setGhost(Boolean(fl & FLAG.stealth));
        if (fl & FLAG.shield) {
          if (!shield) {
            shield = createShieldDome(info.radius * 1.05, EFFECT_COLORS.shield);
            shield.group.position.y = (info.groundOffset || 0) + topY * 0.5;
            air.add(shield.group);
          }
          shield.setVisible(true);
        } else shield?.setVisible(false);

        if (fl & FLAG.emp) {
          empT += dt;
          for (const n of list) if (!n.detached) n.obj.position.x += (Math.random() - 0.5) * 0.02;
          if (particles && Math.random() < 0.3) particles.sparks(view.getCenterWorldPos(tmpV).add(new THREE.Vector3((Math.random() - 0.5) * 2, Math.random(), (Math.random() - 0.5) * 2)), '#B58CFF', 3, 3);
        }
        if (fl & FLAG.invuln) {
          invulnT += dt;
          if (invulnT > 0.25) { invulnT = 0; view.flashAll('#FFFFFF'); }
        }
        if (fl & FLAG.rush && particles) {
          view.getCenterWorldPos(tmpV);
          particles.trail(tmpV, '#FF5A3D', 0.9);
        }

        // 격파
        alive = Boolean(snap.a);
        if (!alive && !deadApplied) applyDead();
        if (!alive) air.position.y += (-0.1 - air.position.y) * Math.min(1, dt * 1.2);

        if (labelObj) labelObj.draw(snap.mhp ? (snap.hp / snap.mhp) * 100 : 0, 100 * (snap.en / (info.maxEnergy || snap.en || 1)), !alive);

        // 이동 먼지(지상)
        if (particles && alive && speed > 2 && snap.alt === 'ground' && Math.random() < Math.min(0.8, speed * 0.04)) {
          view.getCenterWorldPos(tmpV);
          particles.dust(tmpV);
        }
      }

      // 파츠 상시 연출 + 연기
      for (const n of list) {
        if (n.detached || !n.obj.visible) continue;
        adapter.animate(n.obj, time, dt);
        if (particles && isSmoking(n.obj)) {
          n.smokeT -= dt;
          if (n.smokeT <= 0) {
            n.smokeT = 0.18;
            n.obj.getWorldPosition(tmpV);
            particles.smoke(tmpV);
          }
        }
      }

      // 이탈한 파편
      for (let i = debris.length - 1; i >= 0; i--) {
        const d = debris[i];
        d.life -= dt;
        d.vel.y -= 14 * dt;
        d.obj.position.addScaledVector(d.vel, dt);
        d.obj.rotation.x += d.spin.x * dt;
        d.obj.rotation.y += d.spin.y * dt;
        d.obj.rotation.z += d.spin.z * dt;
        if (d.obj.position.y < 0.2) { d.obj.position.y = 0.2; d.vel.y *= -0.35; d.vel.x *= 0.7; d.vel.z *= 0.7; d.spin.multiplyScalar(0.7); }
        if (d.life < 1) d.obj.scale.multiplyScalar(Math.max(0.01, 1 - dt * 2.5));
        if (d.life <= 0) {
          d.obj.parent?.remove(d.obj);
          adapter.dispose(d.obj);
          debris.splice(i, 1);
        }
      }
      shield?.update(dt);
    },

    dispose() {
      for (const d of debris) { d.obj.parent?.remove(d.obj); adapter.dispose(d.obj); }
      debris.length = 0;
      for (const n of list) if (!n.detached) adapter.dispose(n.obj);
      ring.geometry.dispose(); ring.material.dispose();
      blob.geometry.dispose(); blob.material.dispose();
      labelObj?.sprite.material.map.dispose();
      labelObj?.sprite.material.dispose();
      shield?.dispose();
      group.parent?.remove(group);
    },
  };
  return view;
}

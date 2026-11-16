// web/render/primitives/part-builders.js  (38번)
// 프로토타입용 파츠 모형: 코드로 만든 도형. 파츠마다 눈에 띄는 실루엣을 갖도록 만든다.
// 나중에 3D 모델 파일로 바꿀 때는 part-view-adapter.js 설정만 바꾸면 되고, 이 파일은 '대체 모형'으로 남는다.
//
// 모형 규약
//  - 한 변이 1인 정육면체 안(−0.5 ~ 0.5)에 들어간다. 호출하는 쪽이 edge만큼 키운다.
//  - 파츠의 '앞(바깥쪽)'은 −z. 부모에 붙는 면은 +z 쪽이다. (방향은 어댑터가 면에 맞춰 돌린다)
//  - 재질은 kit(기체별 재질 묶음)에서 이름으로 가져온다. 기체마다 kit이 따로라 은신·피격 표현을 기체 단위로 바꿀 수 있다.

import * as THREE from 'three';
import { PartViewAdapter, defaultAttachPoints } from '../part-view-adapter.js';

// ── 재질 묶음 ───────────────────────────────────────────
// 범주별 기본색(금속 느낌). 팀 색은 띠(trim)와 발광 부위에 쓴다.
const CATEGORY_COLOR = {
  core: 0x39424f, structure: 0x59616e, joint: 0x6b7480, mobility: 0x4a5a70, armor: 0x707a88,
  defense: 0x3c6c78, sensor: 0x46705a, weapon: 0x7a4a3a, overdrive: 0x6a3a7a, spirit: 0x7a6a30,
  cell: 0x7a7030, special: 0x4a3a70,
};
const GLOW = {
  core: 0x4de1ff, weapon: 0xff7a1a, sensor: 0x7cffb0, defense: 0x5bc8ff, overdrive: 0xff2bd6, spirit: 0xffd36e,
  cell: 0xffe06e, special: 0xb58cff, mobility: 0x7cc8ff, armor: 0x7cffb0, structure: 0x4de1ff, joint: 0x4de1ff,
};

export function makeKit(teamColor = 0x9fd8ff) {
  const cache = new Map();
  const std = (key, params) => {
    if (!cache.has(key)) cache.set(key, new THREE.MeshStandardMaterial({ roughness: 0.55, metalness: 0.6, ...params }));
    return cache.get(key);
  };
  const kit = {
    teamColor,
    all: cache,
    metal: (cat) => std(`m_${cat}`, { color: CATEGORY_COLOR[cat] ?? 0x59616e }),
    dark: std('dark', { color: 0x1c2128, roughness: 0.7, metalness: 0.5 }),
    light: std('light', { color: 0x9aa4b4, roughness: 0.4, metalness: 0.7 }),
    mirror: std('mirror', { color: 0xdfe8f5, roughness: 0.05, metalness: 1 }),
    team: std('team', { color: teamColor, emissive: teamColor, emissiveIntensity: 0.55, roughness: 0.4, metalness: 0.3 }),
    glow: (cat) => std(`g_${cat}`, { color: GLOW[cat] ?? 0x4de1ff, emissive: GLOW[cat] ?? 0x4de1ff, emissiveIntensity: 1.1, roughness: 0.3, metalness: 0 }),
    hot: std('hot', { color: 0xff7a1a, emissive: 0xff5a0a, emissiveIntensity: 1.2, roughness: 0.4, metalness: 0 }),
    green: std('green', { color: 0x7cff6b, emissive: 0x3dd68c, emissiveIntensity: 0.9, roughness: 0.4, metalness: 0 }),
    dispose() {
      for (const m of cache.values()) m.dispose();
    },
  };
  return kit;
}

// ── 도형 도우미 ─────────────────────────────────────────
const geoCache = new Map();
const geo = (key, make) => {
  if (!geoCache.has(key)) geoCache.set(key, make());
  return geoCache.get(key);
};
const BOX = () => geo('box', () => new THREE.BoxGeometry(1, 1, 1));
const CYL = (seg = 16) => geo(`cyl${seg}`, () => new THREE.CylinderGeometry(0.5, 0.5, 1, seg));
const CONE = (seg = 16) => geo(`cone${seg}`, () => new THREE.ConeGeometry(0.5, 1, seg));
const SPH = () => geo('sph', () => new THREE.SphereGeometry(0.5, 16, 12));
const TORUS = (tube = 0.12) => geo(`tor${tube}`, () => new THREE.TorusGeometry(0.5, tube, 8, 24));
const OCT = () => geo('oct', () => new THREE.OctahedronGeometry(0.5));

// 메시 만들기: (도형, 재질, [x,y,z], [sx,sy,sz], [rx,ry,rz])
function mesh(g, mat, pos = [0, 0, 0], scale = [1, 1, 1], rot = [0, 0, 0]) {
  const m = new THREE.Mesh(g, mat);
  m.position.set(...pos);
  m.scale.set(...scale);
  m.rotation.set(...rot);
  m.castShadow = true;
  m.receiveShadow = true;
  return m;
}
const box = (mat, pos, scale, rot) => mesh(BOX(), mat, pos, scale, rot);
// 축이 앞뒤(z)를 향하는 원기둥/원뿔: x축으로 90° 눕힌다
const barrel = (mat, pos, radius, length, seg = 16) => mesh(CYL(seg), mat, pos, [radius * 2, length, radius * 2], [Math.PI / 2, 0, 0]);
const coneFront = (mat, pos, radius, length, seg = 16) => mesh(CONE(seg), mat, pos, [radius * 2, length, radius * 2], [-Math.PI / 2, 0, 0]); // 끝이 −z
const coneBack = (mat, pos, radius, length, seg = 16) => mesh(CONE(seg), mat, pos, [radius * 2, length, radius * 2], [Math.PI / 2, 0, 0]); // 끝이 +z
const ball = (mat, pos, d) => mesh(SPH(), mat, pos, [d, d, d]);
const ring = (mat, pos, d, tube = 0.12, rot = [0, 0, 0]) => mesh(TORUS(tube), mat, pos, [d, d, d], rot);
const disc = (mat, pos, d, h, rot = [0, 0, 0]) => mesh(CYL(24), mat, pos, [d, h, d], rot);

// 팀 색 띠 (몸체 윗면 가장자리)
const trim = (kit, w = 0.8, z = 0.35) => box(kit.team, [0, 0.46, z], [w, 0.05, 0.12]);

// ── 범주별 빌더 ─────────────────────────────────────────
const B = {};

// 코어
B.core1 = (k) => [box(k.metal('core'), [0, 0, 0], [0.92, 0.92, 0.92]), ball(k.glow('core'), [0, 0, 0], 0.5), trim(k, 0.9, 0)];
B.core2 = (k) => [box(k.metal('core'), [0, 0, 0], [0.94, 0.94, 0.94]), ball(k.glow('core'), [0, 0, 0], 0.46), ring(k.light, [0, 0, 0], 0.78, 0.05, [Math.PI / 2, 0, 0]), trim(k, 0.9, 0)];
B.core3 = (k) => [box(k.metal('core'), [0, 0, 0], [0.96, 0.96, 0.96]), mesh(OCT(), k.glow('core'), [0, 0, 0], [0.7, 0.7, 0.7]), ring(k.light, [0, 0, 0], 0.88, 0.04, [Math.PI / 2, 0, 0]), ring(k.light, [0, 0, 0], 0.88, 0.04, [0, Math.PI / 2, 0]), trim(k, 0.94, 0)];

// 구조체
B.fr_light = (k) => [box(k.metal('structure'), [0, 0, 0], [0.7, 0.7, 0.7]), box(k.dark, [0, 0, 0], [0.5, 0.9, 0.5]), box(k.dark, [0, 0, 0], [0.9, 0.5, 0.5]), trim(k, 0.6, 0.2)];
B.fr_std = (k) => [box(k.metal('structure'), [0, 0, 0], [0.9, 0.9, 0.9]), box(k.dark, [0, 0, -0.46], [0.6, 0.6, 0.06]), trim(k, 0.8, 0.3)];
B.fr_heavy = (k) => [box(k.metal('structure'), [0, 0, 0], [0.94, 0.94, 0.94]), box(k.metal('armor'), [0, 0.3, -0.3], [0.98, 0.2, 0.5]), box(k.metal('armor'), [0, -0.3, -0.3], [0.98, 0.2, 0.5]), box(k.dark, [0, 0, -0.48], [0.5, 0.5, 0.04]), trim(k, 0.9, 0.3)];
B.fr_human = (k) => [box(k.metal('structure'), [0, -0.05, 0], [0.7, 0.8, 0.6]), box(k.metal('armor'), [0, 0.38, 0], [0.96, 0.18, 0.6]), ball(k.metal('joint'), [-0.46, 0.38, 0], 0.22), ball(k.metal('joint'), [0.46, 0.38, 0], 0.22), box(k.glow('core'), [0, 0.1, -0.31], [0.22, 0.22, 0.03]), trim(k, 0.6, 0.2)];
B.fr_beast = (k) => [box(k.metal('structure'), [0, -0.05, 0.05], [0.8, 0.7, 0.9]), box(k.metal('armor'), [0, 0.32, 0.1], [0.7, 0.14, 0.7]), box(k.dark, [0, 0.38, 0.1], [0.12, 0.1, 0.7]), ...[-0.25, 0, 0.25].map((z) => box(k.dark, [0, 0.24, z + 0.1], [0.85, 0.05, 0.05])), trim(k, 0.7, 0.3)];
B.fr_sea = (k) => [mesh(geo('cap', () => new THREE.CapsuleGeometry(0.34, 0.5, 6, 12)), k.metal('structure'), [0, 0, 0], [1, 1, 1], [Math.PI / 2, 0, 0]), box(k.metal('armor'), [0, 0.34, 0.1], [0.06, 0.28, 0.5]), trim(k, 0.4, 0.3)];
B.fr_wyrm = (k) => [...[-0.3, 0, 0.3].map((z, i) => disc(k.metal('structure'), [0, 0, z], 0.86 - i * 0.04, 0.26, [Math.PI / 2, 0, 0])), ...[-0.3, 0, 0.3].map((z) => box(k.metal('armor'), [0, 0.46, z], [0.06, 0.12, 0.2])), trim(k, 0.5, 0.3)];

// 관절
B.jt_ext = (k) => [barrel(k.metal('joint'), [0, 0, 0], 0.16, 0.9, 12), ring(k.light, [0, 0, -0.2], 0.4, 0.06), ring(k.light, [0, 0, 0.2], 0.4, 0.06)];
B.jt_morph = (k) => [ball(k.metal('joint'), [0, 0, 0], 0.6), ring(k.glow('joint'), [0, 0, 0], 0.72, 0.05, [0, Math.PI / 2, 0]), ring(k.light, [0, 0, 0], 0.72, 0.05, [Math.PI / 2, 0, 0])];
B.jt_cable = (k) => [barrel(k.dark, [0, 0, 0], 0.07, 0.9, 8), barrel(k.glow('joint'), [0, 0, 0], 0.035, 0.92, 8), ball(k.metal('joint'), [0, 0, 0.4], 0.2), ball(k.metal('joint'), [0, 0, -0.4], 0.2)];
B.jt_turret = (k) => [disc(k.metal('joint'), [0, -0.3, 0], 0.8, 0.3), disc(k.light, [0, 0, 0], 0.56, 0.2), ring(k.glow('joint'), [0, -0.15, 0], 0.8, 0.03, [Math.PI / 2, 0, 0])];

// 이동
B.mv_servo = (k) => [box(k.metal('mobility'), [-0.22, 0.15, 0], [0.22, 0.6, 0.26]), box(k.metal('mobility'), [0.22, 0.15, 0], [0.22, 0.6, 0.26]), box(k.dark, [-0.22, -0.2, -0.05], [0.28, 0.14, 0.4]), box(k.dark, [0.22, -0.2, -0.05], [0.28, 0.14, 0.4]), ball(k.metal('joint'), [-0.22, 0.4, 0], 0.22), ball(k.metal('joint'), [0.22, 0.4, 0], 0.22)];
B.mv_beast = (k) => [box(k.metal('mobility'), [-0.26, 0.12, 0.05], [0.2, 0.5, 0.22], [0.3, 0, 0]), box(k.metal('mobility'), [0.26, 0.12, 0.05], [0.2, 0.5, 0.22], [0.3, 0, 0]), box(k.dark, [-0.26, -0.3, -0.1], [0.24, 0.12, 0.34]), box(k.dark, [0.26, -0.3, -0.1], [0.24, 0.12, 0.34]), ...[-0.26, 0.26].flatMap((x) => [-0.1, 0.02].map((dx) => coneFront(k.light, [x + dx * 0.4, -0.36, -0.32], 0.04, 0.1, 6)))];
B.mv_booster = (k) => [barrel(k.metal('mobility'), [0, 0, 0.1], 0.22, 0.5, 12), coneBack(k.hot, [0, 0, 0.38], 0.2, 0.28, 12), ring(k.light, [0, 0, -0.14], 0.5, 0.06)];
B.mv_wing = (k) => [box(k.metal('mobility'), [-0.4, 0, 0.1], [0.5, 0.05, 0.7], [0, 0.35, 0]), box(k.metal('mobility'), [0.4, 0, 0.1], [0.5, 0.05, 0.7], [0, -0.35, 0]), box(k.glow('mobility'), [-0.4, 0.03, -0.2], [0.4, 0.02, 0.05], [0, 0.35, 0]), box(k.glow('mobility'), [0.4, 0.03, -0.2], [0.4, 0.02, 0.05], [0, -0.35, 0]), box(k.dark, [0, 0, 0.35], [0.3, 0.2, 0.3])];
B.mv_jet = (k) => [barrel(k.metal('mobility'), [0, 0, 0.05], 0.3, 0.8, 16), coneBack(k.glow('mobility'), [0, 0, 0.45], 0.26, 0.3, 16), ring(k.light, [0, 0, -0.25], 0.64, 0.07), coneFront(k.dark, [0, 0, -0.4], 0.22, 0.2, 16)];
B.mv_hover = (k) => [disc(k.metal('mobility'), [0, -0.2, 0], 0.92, 0.2), disc(k.glow('mobility'), [0, -0.33, 0], 0.7, 0.04), disc(k.dark, [0, 0, 0], 0.5, 0.26), ring(k.light, [0, -0.2, 0], 0.92, 0.04, [Math.PI / 2, 0, 0])];
B.mv_space = (k) => [coneBack(k.metal('mobility'), [0, 0, 0.15], 0.4, 0.6, 20), disc(k.dark, [0, 0, -0.25], 0.7, 0.3, [Math.PI / 2, 0, 0]), ring(k.glow('mobility'), [0, 0, 0.42], 0.78, 0.06), ...[0, 1, 2, 3].map((i) => box(k.light, [Math.cos((i * Math.PI) / 2) * 0.34, Math.sin((i * Math.PI) / 2) * 0.34, -0.1], [0.08, 0.08, 0.5]))];

// 장갑
const plate = (k, mat, t = 0.14, w = 0.92) => box(mat, [0, 0, -0.5 + t / 2], [w, w, t]);
B.ar_ti = (k) => [plate(k, k.metal('armor')), box(k.dark, [0, 0, -0.5], [0.5, 0.5, 0.02]), trim(k, 0.7, -0.4)];
B.ar_nano = (k) => [plate(k, k.metal('armor')), ...[-0.25, 0, 0.25].map((x) => box(k.green, [x, 0, -0.5], [0.05, 0.8, 0.02]))];
B.ar_react = (k) => [...[[-0.22, 0.22], [0.22, 0.22], [-0.22, -0.22], [0.22, -0.22]].map(([x, y]) => box(k.metal('armor'), [x, y, -0.4], [0.38, 0.38, 0.2])), box(k.hot, [0, 0, -0.5], [0.12, 0.12, 0.02])];
B.ar_mirror = (k) => [plate(k, k.mirror, 0.08), box(k.dark, [0, 0, -0.42], [0.96, 0.96, 0.04])];
B.ar_heavy = (k) => [plate(k, k.metal('armor'), 0.3, 0.98), ...[[-0.38, 0.38], [0.38, 0.38], [-0.38, -0.38], [0.38, -0.38]].map(([x, y]) => ball(k.light, [x, y, -0.5], 0.1)), box(k.dark, [0, 0, -0.5], [0.6, 0.12, 0.03])];

// 방어
B.ds_shield = (k) => [disc(k.metal('defense'), [0, 0, 0.2], 0.7, 0.2, [Math.PI / 2, 0, 0]), mesh(geo('dome', () => new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), k.glow('defense'), [0, 0, 0.1], [0.7, 0.7, 0.7], [-Math.PI / 2, 0, 0]), ring(k.light, [0, 0, 0.1], 0.74, 0.04)];
B.ds_intercept = (k) => [disc(k.metal('defense'), [0, 0.25, 0.1], 0.5, 0.2), box(k.metal('defense'), [0, 0.05, 0], [0.3, 0.3, 0.3]), barrel(k.dark, [0, 0.05, -0.28], 0.06, 0.4, 8), barrel(k.dark, [0.1, 0.05, -0.28], 0.04, 0.4, 8), ball(k.glow('defense'), [0, 0.05, -0.1], 0.12)];
B.ds_emp = (k) => [barrel(k.metal('defense'), [0, 0, 0.1], 0.14, 0.7, 10), ring(k.glow('special'), [0, 0, -0.1], 0.6, 0.06), ring(k.glow('special'), [0, 0, 0.1], 0.5, 0.06), ring(k.glow('special'), [0, 0, 0.3], 0.4, 0.06)];
B.ds_repair = (k) => [box(k.metal('defense'), [0, 0, 0.2], [0.7, 0.7, 0.3]), box(k.green, [0, 0, -0.02], [0.52, 0.16, 0.08]), box(k.green, [0, 0, -0.02], [0.16, 0.52, 0.08])];
B.ds_phase = (k) => [mesh(OCT(), k.glow('defense'), [0, 0, 0], [0.8, 0.9, 0.8], [0, 0.5, 0]), ring(k.light, [0, 0, 0], 0.95, 0.03, [Math.PI / 2, 0, 0]), ring(k.light, [0, 0, 0], 0.95, 0.03, [0, Math.PI / 2, 0])];
B.ds_regen = (k) => [disc(k.metal('defense'), [0, 0, 0.1], 0.6, 0.7, [Math.PI / 2, 0, 0]), ...[0, 1, 2, 3, 4, 5].map((i) => box(k.green, [Math.cos((i * Math.PI) / 3) * 0.34, Math.sin((i * Math.PI) / 3) * 0.34, 0.1], [0.1, 0.1, 0.6]))];

// 센서
B.se_radar = (k) => [box(k.dark, [0, -0.2, 0.1], [0.08, 0.5, 0.08]), mesh(geo('dish', () => new THREE.SphereGeometry(0.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.4)), k.metal('sensor'), [0, 0.1, -0.05], [0.9, 0.5, 0.9], [-Math.PI / 2 + 0.3, 0, 0]), ball(k.glow('sensor'), [0, 0.12, -0.3], 0.1)];
B.se_thermal = (k) => [box(k.metal('sensor'), [0, 0, 0.15], [0.6, 0.6, 0.5]), barrel(k.dark, [0, 0, -0.2], 0.22, 0.3, 14), disc(k.hot, [0, 0, -0.36], 0.3, 0.03, [Math.PI / 2, 0, 0])];
B.se_bio = (k) => [ball(k.metal('sensor'), [0, 0, 0.1], 0.6), ring(k.glow('sensor'), [0, 0, 0.1], 0.74, 0.04), ball(k.glow('sensor'), [0, 0, -0.15], 0.24)];
B.se_sonar = (k) => [mesh(geo('dome', () => new THREE.SphereGeometry(0.5, 16, 8, 0, Math.PI * 2, 0, Math.PI / 2)), k.metal('sensor'), [0, 0, 0.1], [0.9, 0.9, 0.9], [-Math.PI / 2, 0, 0]), ring(k.glow('sensor'), [0, 0, -0.1], 0.5, 0.03), ring(k.glow('sensor'), [0, 0, -0.18], 0.3, 0.03)];
B.se_quantum = (k) => [box(k.metal('sensor'), [0, 0, 0.2], [0.8, 0.8, 0.4]), mesh(geo('tknot', () => new THREE.TorusKnotGeometry(0.3, 0.07, 48, 8)), k.glow('sensor'), [0, 0, -0.1], [0.9, 0.9, 0.9]), ring(k.light, [0, 0, -0.1], 0.9, 0.03)];
B.se_comm = (k) => [box(k.metal('sensor'), [0, -0.3, 0.1], [0.3, 0.2, 0.3]), box(k.light, [0, 0, 0.1], [0.05, 0.7, 0.05]), ball(k.glow('sensor'), [0, 0.38, 0.1], 0.14), ring(k.glow('sensor'), [0, 0.25, 0.1], 0.3, 0.02, [Math.PI / 2, 0, 0])];

// 무기
B.wp_claw = (k) => [box(k.dark, [0, 0, 0.3], [0.5, 0.4, 0.3]), ...[-0.15, 0, 0.15].map((x) => coneFront(k.light, [x, 0, -0.15], 0.07, 0.55, 8))];
B.wp_fang = (k) => [box(k.dark, [0, 0, 0.3], [0.7, 0.5, 0.35]), coneFront(k.light, [-0.2, 0.15, -0.15], 0.1, 0.55, 8), coneFront(k.light, [0.2, 0.15, -0.15], 0.1, 0.55, 8), coneFront(k.light, [-0.2, -0.15, -0.15], 0.1, 0.5, 8), coneFront(k.light, [0.2, -0.15, -0.15], 0.1, 0.5, 8)];
B.wp_tail = (k) => [...[0, 1, 2, 3, 4].map((i) => ball(i % 2 ? k.dark : k.metal('weapon'), [Math.sin(i * 0.8) * 0.15, 0.1 * i - 0.2, 0.3 - i * 0.15], 0.3 - i * 0.03)), coneFront(k.light, [0.1, 0.3, -0.35], 0.07, 0.25, 6)];
B.wp_spin_h = (k) => [box(k.dark, [0, -0.1, 0.1], [0.2, 0.3, 0.2]), disc(k.metal('weapon'), [0, 0.1, -0.05], 0.9, 0.08), ...[0, 1, 2, 3].map((i) => box(k.light, [Math.cos((i * Math.PI) / 2) * 0.4, 0.14, -0.05 + Math.sin((i * Math.PI) / 2) * 0.4], [0.18, 0.1, 0.1], [0, -(i * Math.PI) / 2, 0]))];
B.wp_hammer = (k) => [box(k.dark, [0, 0, 0.2], [0.2, 0.2, 0.7]), box(k.metal('weapon'), [0, 0, -0.3], [0.7, 0.45, 0.35]), box(k.light, [0, 0, -0.49], [0.6, 0.35, 0.02])];
B.wp_lift = (k) => [box(k.dark, [0, 0, 0.25], [0.8, 0.4, 0.4]), mesh(geo('wedge', () => new THREE.ConeGeometry(0.5, 1, 4)), k.metal('weapon'), [0, -0.1, -0.2], [0.9, 0.7, 0.4], [-Math.PI / 2 + 0.2, Math.PI / 4, 0])];
B.wp_spin_v = (k) => [box(k.dark, [0, -0.3, 0.2], [0.3, 0.3, 0.5]), disc(k.metal('weapon'), [0, 0.05, -0.1], 0.95, 0.14, [0, 0, Math.PI / 2]), ...[0, 1, 2, 3, 4, 5].map((i) => box(k.light, [0, 0.05 + Math.sin((i * Math.PI) / 3) * 0.46, -0.1 + Math.cos((i * Math.PI) / 3) * 0.46], [0.18, 0.1, 0.1], [(i * Math.PI) / 3, 0, 0]))];
B.wp_plasma = (k) => [box(k.dark, [0, 0, 0.25], [0.6, 0.6, 0.45]), barrel(k.metal('weapon'), [0, 0, -0.2], 0.14, 0.6, 12), ring(k.hot, [0, 0, -0.1], 0.4, 0.05), ball(k.hot, [0, 0, -0.5], 0.12)];
B.wp_missile = (k) => [box(k.metal('weapon'), [0, 0, 0.1], [0.9, 0.7, 0.7]), ...[[-0.25, 0.18], [0, 0.18], [0.25, 0.18], [-0.25, -0.18], [0, -0.18], [0.25, -0.18]].map(([x, y]) => coneFront(k.hot, [x, y, -0.27], 0.1, 0.22, 8)), box(k.team, [0, 0.36, 0.1], [0.5, 0.04, 0.5])];
B.wp_stun = (k) => [box(k.dark, [0, 0, 0.3], [0.5, 0.4, 0.3]), barrel(k.metal('weapon'), [-0.1, 0, -0.1], 0.04, 0.6, 6), barrel(k.metal('weapon'), [0.1, 0, -0.1], 0.04, 0.6, 6), ball(k.glow('special'), [0, 0, -0.1], 0.1)];
B.wp_breath = (k) => [box(k.dark, [0, 0, 0.3], [0.8, 0.7, 0.4]), mesh(CONE(20), k.metal('weapon'), [0, 0, -0.15], [0.95, 0.65, 0.95], [Math.PI / 2, 0, 0]), disc(k.hot, [0, 0, -0.46], 0.5, 0.04, [Math.PI / 2, 0, 0]), ring(k.hot, [0, 0, 0.0], 0.7, 0.05)];
B.wp_laser = (k) => [box(k.dark, [0, 0, 0.3], [0.7, 0.6, 0.4]), barrel(k.metal('weapon'), [0, 0, -0.2], 0.1, 0.7, 12), barrel(k.light, [0, 0, -0.2], 0.06, 0.72, 12), ball(k.glow('weapon'), [0, 0, -0.5], 0.14), ring(k.glow('weapon'), [0, 0, -0.1], 0.3, 0.03)];
B.wp_emp = (k) => [box(k.dark, [0, 0, 0.3], [0.7, 0.6, 0.4]), mesh(geo('dish', () => new THREE.SphereGeometry(0.5, 16, 6, 0, Math.PI * 2, 0, Math.PI / 2.4)), k.metal('weapon'), [0, 0, -0.05], [0.9, 0.5, 0.9], [-Math.PI / 2, 0, 0]), ring(k.glow('special'), [0, 0, -0.3], 0.5, 0.04), ball(k.glow('special'), [0, 0, -0.1], 0.15)];
B.wp_grav = (k) => [box(k.dark, [0, 0, 0.3], [0.9, 0.9, 0.4]), ring(k.metal('weapon'), [0, 0, -0.1], 0.9, 0.1), ring(k.glow('special'), [0, 0, -0.1], 0.6, 0.06), ball(k.glow('special'), [0, 0, -0.1], 0.3)];
B.wp_rail = (k) => [box(k.dark, [0, 0, 0.3], [0.9, 0.7, 0.4]), box(k.metal('weapon'), [-0.17, 0, -0.15], [0.14, 0.4, 0.9]), box(k.metal('weapon'), [0.17, 0, -0.15], [0.14, 0.4, 0.9]), box(k.glow('weapon'), [0, 0, -0.15], [0.12, 0.12, 0.8]), ...[0, 1, 2].map((i) => ring(k.light, [0, 0, -0.45 + i * 0.25], 0.5, 0.03))];
B.wp_nano = (k) => [box(k.dark, [0, 0, 0.25], [0.7, 0.6, 0.45]), mesh(geo('hive', () => new THREE.IcosahedronGeometry(0.5, 0)), k.glow('armor'), [0, 0, -0.1], [0.5, 0.5, 0.5]), ...[0, 1, 2, 3, 4, 5].map((i) => ball(k.green, [Math.cos(i * 1.05) * 0.32, Math.sin(i * 1.05) * 0.32, -0.25], 0.06))];

// 오버드라이브
B.od_annihil = (k) => [box(k.dark, [0, 0, 0.3], [0.9, 0.9, 0.4]), barrel(k.metal('overdrive'), [0, 0, -0.1], 0.3, 0.8, 20), ring(k.glow('overdrive'), [0, 0, -0.38], 0.7, 0.06), ring(k.glow('overdrive'), [0, 0, -0.1], 0.74, 0.04), ball(k.glow('overdrive'), [0, 0, -0.4], 0.3)];
B.od_blast = (k) => [ball(k.metal('overdrive'), [0, 0, 0.05], 0.75), ...[0, 1, 2, 3, 4, 5].map((i) => ball(k.glow('overdrive'), [Math.cos((i * Math.PI) / 3) * 0.42, Math.sin((i * Math.PI) / 3) * 0.42, 0.05], 0.14)), ball(k.glow('overdrive'), [0, 0, 0.05], 0.35)];
B.od_rush = (k) => [box(k.metal('overdrive'), [0, 0, 0.2], [0.8, 0.6, 0.5]), mesh(geo('wedge', () => new THREE.ConeGeometry(0.5, 1, 4)), k.metal('overdrive'), [0, 0, -0.2], [0.9, 0.7, 0.8], [-Math.PI / 2, Math.PI / 4, 0]), box(k.glow('overdrive'), [0, 0, -0.1], [0.06, 0.5, 0.06])];

// 투지·전력
B.sp_amp = (k) => [box(k.dark, [0, -0.2, 0.1], [0.5, 0.2, 0.5]), mesh(OCT(), k.glow('spirit'), [0, 0.1, 0.1], [0.55, 0.7, 0.55], [0, 0.4, 0])];
B.sp_stab = (k) => [box(k.metal('spirit'), [0, 0, 0.1], [0.6, 0.6, 0.6]), ring(k.glow('spirit'), [0, 0, 0.1], 0.5, 0.04, [Math.PI / 2, 0, 0]), box(k.dark, [0, 0, -0.22], [0.3, 0.3, 0.05])];
B.sp_circuit = (k) => [box(k.dark, [0, 0, 0.2], [0.8, 0.8, 0.12]), ...[-0.25, 0, 0.25].map((y) => box(k.glow('spirit'), [0, y, 0.12], [0.6, 0.04, 0.02])), box(k.metal('spirit'), [-0.2, 0.2, 0.1], [0.16, 0.16, 0.1]), box(k.metal('spirit'), [0.2, -0.2, 0.1], [0.2, 0.2, 0.1])];
B.od_cap = (k) => [barrel(k.metal('spirit'), [-0.2, 0, 0.1], 0.18, 0.7, 12), barrel(k.metal('spirit'), [0.2, 0, 0.1], 0.18, 0.7, 12), ring(k.glow('overdrive'), [-0.2, 0, -0.1], 0.38, 0.03), ring(k.glow('overdrive'), [0.2, 0, -0.1], 0.38, 0.03)];
B.sp_cell_s = (k) => [barrel(k.metal('cell'), [0, 0, 0.1], 0.2, 0.6, 12), barrel(k.glow('cell'), [0, 0, -0.22], 0.12, 0.08, 12), box(k.dark, [0, 0, 0.32], [0.4, 0.4, 0.08])];
B.sp_cell_m = (k) => [barrel(k.metal('cell'), [-0.22, 0, 0.1], 0.2, 0.8, 12), barrel(k.metal('cell'), [0.22, 0, 0.1], 0.2, 0.8, 12), barrel(k.glow('cell'), [-0.22, 0, -0.32], 0.12, 0.08, 12), barrel(k.glow('cell'), [0.22, 0, -0.32], 0.12, 0.08, 12), box(k.dark, [0, 0, 0.35], [0.9, 0.5, 0.08])];
B.sp_stealth = (k) => [mesh(geo('prism', () => new THREE.CylinderGeometry(0.5, 0.5, 1, 3)), k.metal('special'), [0, 0, 0.1], [0.8, 0.5, 0.8], [Math.PI / 2, 0, 0]), ball(k.glow('special'), [0, 0, -0.15], 0.16), ring(k.glow('special'), [0, 0, 0.1], 0.7, 0.02, [0, 0, 0])];

// 범주 대체 모형 (위에 없는 새 파츠용)
const FALLBACK = {
  core: (k) => B.core1(k), structure: (k) => B.fr_std(k), joint: (k) => B.jt_ext(k), mobility: (k) => B.mv_servo(k),
  armor: (k) => B.ar_ti(k), defense: (k) => B.ds_shield(k), sensor: (k) => B.se_comm(k), weapon: (k) => B.wp_plasma(k),
  overdrive: (k) => B.od_blast(k), spirit: (k) => B.sp_stab(k), cell: (k) => B.sp_cell_s(k), special: (k) => B.sp_stealth(k),
};

export const BUILDER_IDS = Object.freeze(Object.keys(B));

/**
 * 파츠 모형 하나를 만든다.
 * 반환: THREE.Group (한 변 1인 상자 안, 앞 = −z). 팀 띠를 입히는 일은 빌더가 kit.team으로 직접 한다.
 */
export function buildPartPrimitive(partId, category, kit) {
  const fn = B[partId] || FALLBACK[category] || FALLBACK.structure;
  const group = new THREE.Group();
  for (const m of fn(kit)) {
    if (m && m.isObject3D) group.add(m);
  }
  group.userData.primitive = true;
  return group;
}

// ── 어댑터 구현 A ───────────────────────────────────────
// part-view-adapter.js의 PartViewAdapter 규약을 따른다.
//  build(partDef, { edge, form }) → 바깥 그룹(스케일 1, robot-view가 접힘 연출로 스케일을 바꿈) 안에 edge로 키운 모형
//  applyState: 정상 / 파손(어둡게 + 연기) / 정지(희미하게)
//  animate: 발광 맥동, 스피너 회전, 피격 섬광 감쇠
//  flash: 잠깐 번쩍
// 파츠마다 재질을 복제해 갖는다(상태 표현이 파츠별로 독립). 도형(geometry)은 모두가 공유하므로 dispose에서 건드리지 않는다.

const SPINNERS = { wp_spin_h: ['y', 14], wp_spin_v: ['x', 14], jt_turret: ['y', 0.8], ds_regen: ['z', 2], se_radar: ['y', 1.2] };

export class PrimitivesAdapter extends PartViewAdapter {
  constructor({ teamTint = 0x9fd8ff } = {}) {
    super();
    this.kit = makeKit(teamTint);
  }

  get kind() { return 'primitives'; }

  build(def, state = {}) {
    const edge = state.edge ?? 1;
    const inner = buildPartPrimitive(def.id, def.category, this.kit);
    inner.scale.setScalar(edge);
    const outer = new THREE.Group();
    outer.add(inner);
    outer.userData.partId = def.id;
    outer.userData.edge = edge;
    outer.userData.attachPoints = defaultAttachPoints(def, edge);
    const mats = [];
    inner.traverse((o) => {
      if (!o.isMesh) return;
      o.material = o.material.clone();
      const m = o.material;
      m.userData.base = { color: m.color.clone(), emissive: m.emissive.clone(), intensity: m.emissiveIntensity };
      mats.push(m);
    });
    outer.userData.mats = mats;
    outer.userData.glow = mats.filter((m) => m.userData.base.intensity > 0.8);
    outer.userData.phase = Math.random() * 6.28;
    outer.userData.status = 'ok';
    outer.userData.flashT = 0;
    const spin = SPINNERS[def.id];
    if (spin) {
      // 스피너는 접속면에서 떨어진 둥근 날을 돌린다(가장 넓은 원판)
      let best = null;
      inner.traverse((o) => { if (o.isMesh && o.geometry.type === 'CylinderGeometry' && (!best || o.scale.x > best.scale.x)) best = o; });
      if (best && def.category === 'weapon') outer.userData.spinner = { mesh: best, axis: spin[0], speed: spin[1] };
    }
    if (state.status) this.applyState(outer, state);
    return outer;
  }

  applyState(obj, state) {
    const status = state.status || 'ok';
    const dim = status === 'broken' ? 0.4 : status === 'paused' || state.working === false ? 0.7 : 1;
    const glow = status === 'broken' ? 0.05 : status === 'paused' || state.working === false ? 0.25 : 1;
    for (const m of obj.userData.mats || []) {
      const b = m.userData.base;
      m.color.copy(b.color).multiplyScalar(dim);
      m.emissive.copy(b.emissive);
      m.emissiveIntensity = b.intensity * glow;
    }
    obj.userData.status = status;
    obj.userData.working = state.working !== false && status === 'ok';
    // 파손: 연기를 낸다 (robot-view가 userData.smoking을 읽음)
    obj.userData.smoking = status === 'broken';
  }

  animate(obj, time, dt) {
    const u = obj.userData;
    if (u.spinner && u.working !== false) {
      u.spinner.mesh.rotation[u.spinner.axis] += u.spinner.speed * dt;
    }
    if (u.flashT > 0) {
      u.flashT = Math.max(0, u.flashT - dt * 5);
      for (const m of u.mats) {
        const b = m.userData.base;
        m.emissive.copy(b.emissive).lerp(u.flashColor, u.flashT);
        m.emissiveIntensity = b.intensity + u.flashT * 1.6;
      }
      return;
    }
    if (u.working && u.glow?.length) {
      const k = 0.85 + 0.15 * Math.sin(time * 4 + u.phase);
      for (const m of u.glow) m.emissiveIntensity = m.userData.base.intensity * k;
    }
  }

  flash(obj, color = '#FFFFFF') {
    obj.userData.flashColor = new THREE.Color(color);
    obj.userData.flashT = 1;
  }

  dispose(obj) {
    for (const m of obj.userData.mats || []) m.dispose();
  }
}

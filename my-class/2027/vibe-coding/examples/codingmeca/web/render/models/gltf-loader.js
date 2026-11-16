// web/render/models/gltf-loader.js  (39번)
// 어댑터 구현 B: 3D 모델 파일(glTF/GLB)로 파츠를 그린다. (명세 v1.0 15장)
//  · 파츠 ID → 모델 파일 매핑 표(manifest)를 읽어 로드한다. 매핑에 없거나 로드에 실패한 파츠는 구현 A(primitives)로 대신 그린다.
//  · 연결점 위치는 모델 안의 앵커 이름(anchor_S1, anchor_M2 …)으로 읽는다. 앵커가 없으면 기본 면 중심을 쓴다.
//  · A→B 전환은 part-view-adapter.js의 createAdapter({ kind: 'gltf', manifestUrl }) 설정만 바꾸면 된다.
//
// manifest 예: { "wp_fang": { "src": "assets/models/wp_fang.glb", "fit": 1.0, "rotationY": 0, "yOffset": 0 } }
//   fit: 모델의 가장 긴 변을 edge × fit 로 맞춤(기본 0.96) / rotationY: 모델 앞이 −z가 아닐 때 보정(rad)
//
// 모델 제작 규칙(아티스트용): 앞(−z)이 바깥, 원점이 중심, 단위는 자유(자동 맞춤), 재질 이름은 자유.

import * as THREE from 'three';
import { PartViewAdapter, defaultAttachPoints, PART_STATUS } from '../part-view-adapter.js';

export async function loadManifest(url) {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`모델 매핑표를 읽을 수 없습니다: ${url} (${res.status})`);
  return res.json();
}

export class GltfAdapter extends PartViewAdapter {
  /**
   * opts: { manifest, fallback(PartViewAdapter), basePath, loader? }
   *   loader: 테스트용으로 GLTFLoader 대신 쓸 { loadAsync(url) → { scene } }
   */
  constructor({ manifest = {}, fallback, basePath = '', loader = null } = {}) {
    super();
    if (!fallback) throw new Error('GltfAdapter에는 대체 어댑터(fallback)가 필요합니다');
    this.manifest = manifest;
    this.fallback = fallback;
    this.basePath = basePath;
    this._loader = loader;
    this.cache = new Map(); // partId → { scene, size } | 'failed'
    this.pending = new Map(); // partId → Promise
    this.waiting = new Map(); // partId → Set<wrapper>  (모델이 늦게 오면 교체)
  }

  get kind() { return 'gltf'; }

  async _getLoader() {
    if (!this._loader) {
      const { GLTFLoader } = await import('three/addons/loaders/GLTFLoader.js');
      this._loader = new GLTFLoader();
    }
    return this._loader;
  }

  /** 필요한 파츠 모델을 미리 불러온다. 실패한 파츠는 조용히 primitives로 대체된다. */
  async preload(partIds) {
    await Promise.all(partIds.map((id) => this._load(id)));
  }

  _load(partId) {
    const entry = this.manifest[partId];
    if (!entry || this.cache.has(partId)) return Promise.resolve(this.cache.get(partId) ?? 'failed');
    if (this.pending.has(partId)) return this.pending.get(partId);
    const p = (async () => {
      try {
        const loader = await this._getLoader();
        const gltf = await loader.loadAsync(this.basePath + entry.src);
        const box = new THREE.Box3().setFromObject(gltf.scene);
        const size = box.getSize(new THREE.Vector3());
        const center = box.getCenter(new THREE.Vector3());
        this.cache.set(partId, { scene: gltf.scene, size, center });
      } catch (err) {
        console.warn(`[gltf] ${partId} 로드 실패 → primitives로 대체`, err?.message || err);
        this.cache.set(partId, 'failed');
      }
      this.pending.delete(partId);
      this._swapWaiting(partId);
      return this.cache.get(partId);
    })();
    this.pending.set(partId, p);
    return p;
  }

  // 모델을 불러오는 중에 만들어진 임시(대체) 모양을 실제 모델로 바꿔 끼운다
  _swapWaiting(partId) {
    const set = this.waiting.get(partId);
    const hit = this.cache.get(partId);
    if (!set || !hit || hit === 'failed') return;
    for (const wrapper of set) this._fill(wrapper, partId, wrapper.userData.partDef, wrapper.userData.edge);
    this.waiting.delete(partId);
  }

  _fill(wrapper, partId, partDef, edge) {
    const hit = this.cache.get(partId);
    const entry = this.manifest[partId];
    // 기존 내용 비우기
    for (const c of [...wrapper.children]) {
      wrapper.remove(c);
      this.fallback.dispose(c);
    }
    const model = hit.scene.clone(true);
    const fit = entry.fit ?? 0.96;
    const longest = Math.max(hit.size.x, hit.size.y, hit.size.z) || 1;
    const k = (edge * fit) / longest;
    const holder = new THREE.Group();
    model.position.set(-hit.center.x, -hit.center.y + (entry.yOffset || 0) / k, -hit.center.z);
    holder.add(model);
    holder.scale.setScalar(k);
    holder.rotation.y = entry.rotationY || 0;
    // 재질 복제(손상·정지 때 인스턴스별로 바꾸기 위해) + 앵커 읽기
    const mats = [];
    const anchors = {};
    holder.updateMatrixWorld(true);
    model.traverse((o) => {
      if (o.isMesh) {
        o.castShadow = true;
        o.receiveShadow = true;
        const ms = (Array.isArray(o.material) ? o.material : [o.material]).map((m) => {
          const c = m.clone();
          mats.push({ m: c, color: c.color ? c.color.clone() : null, emissive: c.emissive ? c.emissive.clone() : null, ei: c.emissiveIntensity ?? 0 });
          return c;
        });
        o.material = Array.isArray(o.material) ? ms : ms[0];
      }
      const m = /^anchor_([SML]\d+)$/i.exec(o.name || '');
      if (m) {
        const wp = new THREE.Vector3();
        o.getWorldPosition(wp);
        anchors[m[1].toUpperCase()] = holder.worldToLocal(wp.clone()).multiplyScalar(k).applyEuler(holder.rotation);
      }
    });
    wrapper.add(holder);
    wrapper.userData.mats = mats;
    wrapper.userData.attachPoints = { ...defaultAttachPoints(partDef, edge), ...anchors };
    wrapper.userData.isModel = true;
    this.applyState(wrapper, {});
  }

  build(partDef, state = {}) {
    const edge = state.edge || 1;
    const partId = partDef.id;
    const entry = this.manifest[partId];
    const hit = this.cache.get(partId);
    // 모델 없음/실패 → 구현 A 그대로
    if (!entry || hit === 'failed') return this.fallback.build(partDef, state);

    const wrapper = new THREE.Group();
    wrapper.name = `part:${partId}`;
    Object.assign(wrapper.userData, {
      partId, partDef, edge, mats: [], anims: [], view: { status: PART_STATUS.ok, pct: 100, working: true },
      flash: 0, flashColor: new THREE.Color('#FFFFFF'), attachPoints: defaultAttachPoints(partDef, edge),
    });
    if (hit) {
      this._fill(wrapper, partId, partDef, edge);
    } else {
      // 아직 로드 전: 임시로 구현 A 모양을 넣고, 로드되면 교체
      const temp = this.fallback.build(partDef, state);
      wrapper.add(temp);
      if (!this.waiting.has(partId)) this.waiting.set(partId, new Set());
      this.waiting.get(partId).add(wrapper);
      this._load(partId);
    }
    this.applyState(wrapper, state);
    return wrapper;
  }

  applyState(obj, state) {
    // 임시(대체) 모양 안의 구현 A 상태 처리
    if (!obj.userData.isModel) {
      const inner = obj.children[0];
      if (inner?.userData?.mats && inner !== obj) this.fallback.applyState(inner, state);
      return;
    }
    const v = obj.userData.view;
    v.status = state.status ?? v.status;
    v.pct = state.durabilityPct ?? v.pct;
    v.working = state.working ?? v.working;
    const broken = v.status === PART_STATUS.broken;
    const scorch = broken ? 0.35 : v.pct < 40 ? 0.5 : v.pct < 70 ? 0.78 : 1;
    for (const r of obj.userData.mats) {
      if (r.color) r.m.color.copy(r.color).multiplyScalar(scorch);
      if (r.emissive) r.m.emissiveIntensity = broken ? 0 : v.working ? r.ei : r.ei * 0.15;
    }
    obj.userData.smoking = broken || v.pct < 40;
    obj.userData.broken = broken;
    obj.userData.paused = !v.working;
  }

  animate(obj, time, dt) {
    if (!obj.userData.isModel) {
      const inner = obj.children[0];
      if (inner?.userData?.anims) this.fallback.animate(inner, time, dt);
      return;
    }
    const u = obj.userData;
    if (u.flash > 0) {
      u.flash = Math.max(0, u.flash - dt * 4);
      for (const r of u.mats) {
        if (!r.m.emissive) continue;
        r.m.emissive.copy(r.emissive || new THREE.Color('#000000')).lerp(u.flashColor, u.flash);
        r.m.emissiveIntensity = Math.max(r.ei, u.flash * 2);
      }
    }
  }

  flash(obj, color = '#FFFFFF') {
    const target = obj.userData.isModel ? obj : obj.children[0] ?? obj;
    if (target === obj) {
      obj.userData.flash = 1;
      obj.userData.flashColor.set(color);
    } else this.fallback.flash?.(target, color);
  }

  attachPoints(obj) {
    return obj.userData.attachPoints || {};
  }
}

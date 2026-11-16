// web/render/part-view-adapter.js  (37번)
// 파츠 → 3D 표현 어댑터 인터페이스 (명세 v1.0 15장 [고정]).
// 기체 뷰·조립 화면은 이 인터페이스로만 파츠를 그린다. 구현체는 둘:
//   A  primitives/part-builders.js  — 코드로 만든 저폴리 도형 (프로토타입)
//   B  models/gltf-loader.js        — 3D 모델 파일 (완성본). A→B 전환은 어댑터 설정만 바꾸면 된다.
//
// ── 약속 ───────────────────────────────────────────────
//  · 파츠 모형은 '한 변이 edge(m)인 정육면체' 안에 들어간다 (shared/build/layout.js의 상자와 같은 크기).
//  · 파츠의 로컬 앞(−z)이 바깥 방향(부모에서 뻗어나가는 쪽)이다. 놓는 쪽이 orientationFor(outKey)로 돌려 준다.
//  · 파츠는 shared의 파츠 정의(partDef)와 상태(state)만 보고 그린다. 전투·조립 로직은 어느 구현체인지 모른다.
//
// state 형태 (PartViewState)
//   { edge, status: 'ok'|'broken'|'detached'|'paused', durabilityPct(0~100), working(bool), form: 'both'|'A'|'B' }

import { WORLD_DIR, slotDirectionKey } from '../../shared/build/assembly.js';

export const PART_STATUS = Object.freeze({ ok: 'ok', broken: 'broken', detached: 'detached', paused: 'paused' });
const CODE_TO_STATUS = ['ok', 'broken', 'detached', 'paused']; // shared/sim/snapshot.js의 PART_STATE 코드 순서

export const defaultPartState = (edge) => ({ edge, status: 'ok', durabilityPct: 100, working: true, form: 'both' });

// 스냅샷의 [상태코드, 내구도%] → PartViewState 조각
export function stateFromSnapshot(pair) {
  const [code, pct] = pair || [0, 100];
  return { status: CODE_TO_STATUS[code] || 'ok', durabilityPct: pct, working: code === 0 };
}

// outKey(전/후/좌/우/상/하) → 파츠를 돌릴 오일러 각 (로컬 앞 −z 가 그 방향을 향하게)
const HALF_PI = Math.PI / 2;
export function orientationFor(outKey) {
  switch (outKey) {
    case 'back': return { x: 0, y: Math.PI, z: 0 };
    case 'right': return { x: 0, y: -HALF_PI, z: 0 };
    case 'left': return { x: 0, y: HALF_PI, z: 0 };
    case 'up': return { x: HALF_PI, y: 0, z: 0 };
    case 'down': return { x: -HALF_PI, y: 0, z: 0 };
    case 'front':
    default: return { x: 0, y: 0, z: 0 };
  }
}

// 파츠 로컬 좌표의 연결점 위치: { 'S1': {x,y,z}, 'M2': … } (큰 크기 → 번호순). 구현체 공통 기본 계산.
export function defaultAttachPoints(partDef, edge) {
  const out = {};
  const isRoot = partDef.category === 'core';
  const half = edge / 2;
  for (const size of ['L', 'M', 'S']) {
    const count = partDef.provides?.[size] || 0;
    for (let i = 1; i <= count; i++) {
      const d = WORLD_DIR[slotDirectionKey(isRoot, i)];
      out[`${size}${i}`] = { x: d.x * half, y: d.y * half, z: d.z * half };
    }
  }
  return out;
}

/** 구현체가 상속하는 기본 클래스. 필요한 메서드만 덮어쓴다. */
export class PartViewAdapter {
  get kind() { return 'abstract'; }

  /** partDef + state → Object3D (중심이 원점, 한 변 edge 안) */
  build(/* partDef, state */) {
    throw new Error('PartViewAdapter.build를 구현하세요');
  }

  /** 상태 반영: 손상 단계, 접힘, 발광, 정지 */
  applyState(/* obj, state */) {}

  /** 매 프레임 호출(맥동·회전 등 상시 연출). time은 초 */
  animate(/* obj, time, dt */) {}

  /** 이탈 연출: 부모 그룹에서 떼어 내 날려 보낼 Object3D를 돌려준다(호출한 쪽이 날리고 지운다) */
  detach(obj) {
    const parent = obj.parent;
    if (!parent) return obj;
    obj.updateWorldMatrix(true, false);
    parent.remove(obj);
    return obj;
  }

  /** 연결점 위치(파츠 로컬) */
  attachPoints(obj) {
    return obj.userData.attachPoints || {};
  }

  /** 자원 정리 */
  dispose(obj) {
    obj.traverse((o) => {
      if (o.userData?.shared) return;
      o.geometry?.dispose?.();
      const m = o.material;
      if (Array.isArray(m)) m.forEach((x) => x.dispose());
      else m?.dispose?.();
    });
  }
}

// ── 어댑터 선택 ─────────────────────────────────────────
// 설정 { kind: 'primitives' | 'gltf', manifestUrl?, basePath? }
//  gltf는 파츠마다 모델이 없거나 불러오기에 실패하면 그 파츠만 primitives로 대체한다.
export const DEFAULT_ADAPTER_CONFIG = Object.freeze({ kind: 'primitives' });

let current = null;

export async function createAdapter(config = DEFAULT_ADAPTER_CONFIG) {
  const prim = await import('./primitives/part-builders.js');
  const primitives = new prim.PrimitivesAdapter(config.primitives || {});
  if (config.kind !== 'gltf') return primitives;
  const gl = await import('./models/gltf-loader.js');
  const manifest = config.manifest || (config.manifestUrl ? await gl.loadManifest(config.manifestUrl) : {});
  return new gl.GltfAdapter({ manifest, fallback: primitives, basePath: config.basePath || '' });
}

export function setPartViewAdapter(adapter) {
  current = adapter;
  return adapter;
}

export function getPartViewAdapter() {
  if (!current) throw new Error('파츠 어댑터가 아직 정해지지 않았습니다. createAdapter()로 만든 뒤 setPartViewAdapter()를 부르세요');
  return current;
}

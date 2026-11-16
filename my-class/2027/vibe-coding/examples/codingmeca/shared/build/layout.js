// shared/build/layout.js  (16번)
// 트리 → 3D 자동 배치. 각 파츠의 중심·모서리 상자(AABB)를 계산하고, 겹침(무효 배치)과 노출도를 구한다.
// 화면 코드를 import하지 않습니다(서버와 브라우저 공용). 좌표 규약은 math.js와 같음(앞 = −z).
//
// 배치 규칙
//  1) 파츠는 정육면체 모형이다. 변 길이는 접속 크기(소/중/대)로, 코어는 coreEdge로 정한다.
//  2) 자식은 부모의 연결점 방향 면 바깥쪽에 맞닿게 붙는다.
//  3) 같은 부모의 같은 면에 파츠가 여러 개면, 그 면을 따라 옆으로 나란히 놓는다.
//     이때 '하위 파츠까지 합친 덩어리'의 폭을 기준으로 간격(layoutGap)을 둔다.
//     줄이 면보다 길면 풍차 방식으로 한쪽 모서리에만 걸치게 해 인접 면과 부딪치지 않게 한다.
//  4) 위치는 코어 중심이 원점(0,0,0). 화면은 groundOffset을 더해 바닥에 맞춘다.
//  5) 두 파츠의 상자가 overlapEpsilon보다 깊게 겹치면 겹침이다(조립 화면에서 빨갛게 표시).

import { aabbFromCenter, aabbUnion, aabbOverlapDepth, aabbCenter, aabbSize, rayAabb, v3add } from '../util/math.js';
import { DEFAULT_CTX, DIR_KEYS, WORLD_DIR, activeSet } from './assembly.js';

const AXES = ['x', 'y', 'z'];

// 면(out 방향)마다 옆으로 늘어놓을 축: [옆 축, 나머지 축]
const ROW_AXIS = {
  front: ['x', 'y'], back: ['x', 'y'],
  left: ['z', 'y'], right: ['z', 'y'],
  up: ['x', 'z'], down: ['x', 'z'],
};

export const edgeOf = (node, A) => (node.def.category === 'core' ? A.coreEdge : A.sizeEdge[node.def.size]);

const zero = () => ({ x: 0, y: 0, z: 0 });
const shiftBox = (b, d) => ({ min: v3add(b.min, d), max: v3add(b.max, d) });

// 부모 기준 상대 배치를 아래에서 위로 계산한다.
// 반환(각 노드): { half, rel: Map(uid → 이 노드 중심 기준 상대 위치), bbox: 이 노드 중심 기준 하위 전체 상자 }
function layoutSubtree(node, A, memo) {
  const half = edgeOf(node, A) / 2;
  let bbox = aabbFromCenter(zero(), { x: half, y: half, z: half });
  const rel = new Map([[node.uid, zero()]]);

  // 면별로 묶기
  const groups = new Map();
  for (const child of node.children) {
    if (!groups.has(child.outKey)) groups.set(child.outKey, []);
    groups.get(child.outKey).push(child);
  }

  for (const key of DIR_KEYS) {
    const kids = groups.get(key);
    if (!kids) continue;
    const out = WORLD_DIR[key];
    const [rowAxis, otherAxis] = ROW_AXIS[key];
    const outAxis = AXES.find((a) => out[a] !== 0);
    const outSign = out[outAxis];

    // 각 자식의 하위 덩어리 배치를 먼저 구한다
    const subs = kids.map((kid) => ({ kid, sub: layoutSubtree(kid, A, memo) }));

    // 옆으로 나란히: 덩어리의 옆 방향 범위 [lo, hi]를 기준으로 커서를 옮긴다
    let cursor = 0;
    const placed = [];
    for (const { kid, sub } of subs) {
      const lo = sub.bbox.min[rowAxis];
      const hi = sub.bbox.max[rowAxis];
      const center = cursor - lo;
      placed.push({ kid, sub, rowPos: center });
      cursor = center + hi + A.layoutGap;
    }
    const rowLo = placed[0].rowPos + placed[0].sub.bbox.min[rowAxis];
    const rowHi = cursor - A.layoutGap;
    // 면보다 줄이 짧으면 가운데, 길면 풍차 방식으로 한쪽 모서리에만 걸치게 한다.
    // (앞→+x, 오른쪽→+z, 뒤→−x, 왼쪽→−z 로 걸쳐서 인접한 두 면의 줄이 같은 모서리에서 부딪치지 않음)
    let rowShift = -(rowLo + rowHi) / 2;
    if (rowHi - rowLo > 2 * half) {
      if (key === 'front' || key === 'right') rowShift = -half - rowLo;
      else if (key === 'back' || key === 'left') rowShift = half - rowHi;
    }

    for (const { kid, sub, rowPos } of placed) {
      const kidHalf = edgeOf(kid, A) / 2;
      const offset = zero();
      offset[outAxis] = outSign * (half + kidHalf);
      offset[rowAxis] = rowPos + rowShift;
      offset[otherAxis] = 0;
      for (const [uid, p] of sub.rel) rel.set(uid, v3add(p, offset));
      bbox = aabbUnion(bbox, shiftBox(sub.bbox, offset));
    }
  }

  const out = { half, rel, bbox };
  memo.set(node.uid, out);
  return out;
}

/**
 * 트리 → 배치.
 * 반환: {
 *   items: Map(uid → { uid, center, half, edge, box, outKey }),
 *   bounds: 전체 상자, size, center,
 *   groundOffset: 바닥(y=0)에 맞추려면 더할 y,
 *   overlaps: [{ a, b, depth, form }],   // form: 'A'|'B'|'both'
 *   hasOverlap
 * }
 */
export function layoutTree(tree, ctx = tree.ctx || DEFAULT_CTX) {
  const A = ctx.constants.assembly;
  const items = new Map();
  if (!tree.root) {
    return { items, bounds: null, size: zero(), center: zero(), groundOffset: 0, overlaps: [], hasOverlap: false };
  }
  const memo = new Map();
  const top = layoutSubtree(tree.root, A, memo);

  let bounds = null;
  for (const [uid, c] of top.rel) {
    const node = tree.nodes.get(uid);
    if (!node) continue;
    const edge = edgeOf(node, A);
    const half = edge / 2;
    const box = aabbFromCenter(c, { x: half, y: half, z: half });
    items.set(uid, { uid, center: c, half, edge, box, outKey: node.outKey });
    bounds = bounds ? aabbUnion(bounds, box) : box;
  }

  const overlaps = findOverlaps(tree, items, A);
  return {
    items,
    bounds,
    size: aabbSize(bounds),
    center: aabbCenter(bounds),
    groundOffset: -bounds.min.y,
    overlaps,
    hasOverlap: overlaps.length > 0,
  };
}

// 겹침 검사. 두 형태(A/B)로 나뉜 설계는 형태별로 따로 검사한다(접힌 쪽은 같은 자리를 써도 된다).
function findOverlaps(tree, items, A) {
  const uids = [...items.keys()];
  const forms = [...tree.nodes.values()].some((n) => n.form !== 'both') ? ['A', 'B'] : ['both'];
  const found = new Map();
  for (const form of forms) {
    const act = form === 'both' ? new Set(uids) : activeSet(tree, form);
    const list = uids.filter((u) => act.has(u));
    for (let i = 0; i < list.length; i++) {
      for (let j = i + 1; j < list.length; j++) {
        const depth = aabbOverlapDepth(items.get(list[i]).box, items.get(list[j]).box, A.overlapEpsilon);
        if (depth > 0) {
          const key = `${list[i]}|${list[j]}`;
          if (!found.has(key)) found.set(key, { a: list[i], b: list[j], depth, form });
        }
      }
    }
  }
  return [...found.values()];
}

// 겹침에 걸린 파츠 uid 집합 (화면의 빨간 표시용)
export const overlappingUids = (layout) => new Set(layout.overlaps.flatMap((o) => [o.a, o.b]));

// 특정 파츠를 붙였을 때 겹치는지 미리 보기: 후보 설계의 배치를 돌려주면 호출자가 판단한다.

// ── 노출도 ────────────────────────────────────────────────────
// 6방향에서 격자 광선을 쏴 처음 닿는 파츠의 면적 비중. (조립 화면 표시용, 시뮬레이션의 피격 판정과는 별개)
// 반환: { perDirection: { front: {uid: share}, ... }, overall: {uid: share} }
export function computeExposure(tree, layout, { form = 'A', resolution } = {}) {
  const ctx = tree.ctx || DEFAULT_CTX;
  const A = ctx.constants.assembly;
  const res = resolution || A.exposureResolution;
  const act = activeSet(tree, form);
  // 활성이 아닌 파츠(접힌 형태)도 몸에 붙어 있으므로 낮은 가중치로 가린다
  const entries = [];
  for (const [uid, it] of layout.items) {
    entries.push({ uid, box: it.box, weight: act.has(uid) ? 1 : A.exposureFoldedMult });
  }
  const b = layout.bounds;
  const perDirection = {};
  const overall = {};
  let overallTotal = 0;

  for (const key of DIR_KEYS) {
    const dir = WORLD_DIR[key]; // 이 방향으로 '들어오는' 광선이 아니라, 그 방향에서 쏘는 광선: 방향 반대로 진행
    const travel = { x: -dir.x, y: -dir.y, z: -dir.z };
    const axis = AXES.find((a) => dir[a] !== 0);
    const [u, v] = AXES.filter((a) => a !== axis);
    const share = {};
    let total = 0;
    const start = dir[axis] > 0 ? b.max[axis] + 1 : b.min[axis] - 1;
    const span = b.max[axis] - b.min[axis] + 2;
    for (let i = 0; i < res; i++) {
      for (let j = 0; j < res; j++) {
        const origin = { x: 0, y: 0, z: 0 };
        origin[axis] = start;
        origin[u] = b.min[u] + ((i + 0.5) / res) * (b.max[u] - b.min[u]);
        origin[v] = b.min[v] + ((j + 0.5) / res) * (b.max[v] - b.min[v]);
        let best = null;
        let bestT = Infinity;
        for (const e of entries) {
          const t = rayAabb(origin, travel, e.box, span);
          if (t !== null && t < bestT) {
            bestT = t;
            best = e;
          }
        }
        if (best) {
          share[best.uid] = (share[best.uid] || 0) + best.weight;
          total += best.weight;
        }
      }
    }
    perDirection[key] = Object.fromEntries(Object.entries(share).map(([k, w]) => [k, total ? w / total : 0]));
    for (const [k, w] of Object.entries(share)) overall[k] = (overall[k] || 0) + w;
    overallTotal += total;
  }
  for (const k of Object.keys(overall)) overall[k] = overallTotal ? overall[k] / overallTotal : 0;
  return { perDirection, overall };
}

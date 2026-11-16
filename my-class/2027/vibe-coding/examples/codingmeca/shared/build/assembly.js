// shared/build/assembly.js  (15번)
// 기체 조립의 구조 규칙: 설계 데이터 → 연결점 트리, 연결점 방향, 전력 홉, 형태(A/B) 활성 집합,
// 그리고 부착·분리·코어 교체 같은 편집 연산(원본을 바꾸지 않고 새 설계를 돌려줌).
// 화면 코드를 import하지 않습니다(서버와 브라우저 공용).
//
// ── 설계(design) 데이터 형태 ─────────────────────────────────
//   { schema, name, parts: [{ uid, part, parent, slot: {size, index}, form }], pilot: {...} }
//   - 코어는 parent = null, slot = null, uid = 'core'
//   - form: 'both'(기본) | 'A' | 'B'  — 가변 관절이 있는 기체의 두 형태 중 어디서 활성인가
//
// ── 좌표·방향 규약 (shared/util/math.js와 같음) ───────────────
//   x = 오른쪽, y = 위, z = 뒤쪽. 기체의 앞(front)은 −z.  left = −x, right = +x.
//
// ── 연결점 방향 배정 [고정 규칙의 보완] ───────────────────────
//   같은 크기 연결점은 번호순으로 전→후→좌→우→상→하를 순환한다. (명세 5-1)
//   보완: 코어가 아닌 파츠의 '후(back)'는 자기를 붙들고 있는 부모 쪽을 가리키므로 쓸 수 없다.
//   그래서 코어가 아닌 파츠는 후를 건너뛰고 전→좌→우→상→하 5개를 순환한다.
//   또 코어가 아닌 파츠의 '전'은 부모에서 뻗어 나가는 바깥 방향이다(파츠 자신의 앞).

import { PART_BY_ID, fitsSlot, SIZE_RANK } from '../../data/parts.js';
import { CONSTANTS } from '../../config/constants.js';
import { makeUid, slotId } from '../util/ids.js';

// ── 컨텍스트 ──────────────────────────────────────────────────
// parts: 파츠ID → 정의 (조율 센터의 오버라이드가 병합된 것을 넣을 수 있음), constants: 수치 상수
export const DEFAULT_CTX = Object.freeze({ parts: PART_BY_ID, constants: CONSTANTS });

export function makeContext({ parts, constants } = {}) {
  return { parts: parts || PART_BY_ID, constants: constants || CONSTANTS };
}

// ── 방향 ──────────────────────────────────────────────────────
export const DIR_KEYS = Object.freeze(['front', 'back', 'left', 'right', 'up', 'down']);

const V = (x, y, z) => Object.freeze({ x, y, z });

export const WORLD_DIR = Object.freeze({
  front: V(0, 0, -1),
  back: V(0, 0, 1),
  left: V(-1, 0, 0),
  right: V(1, 0, 0),
  up: V(0, 1, 0),
  down: V(0, -1, 0),
});

// 바깥 방향(out)이 world의 어느 방향 키인지
export function worldKeyOf(vec) {
  for (const k of DIR_KEYS) {
    const d = WORLD_DIR[k];
    if (d.x === vec.x && d.y === vec.y && d.z === vec.z) return k;
  }
  throw new Error(`축 정렬 방향이 아닙니다: ${JSON.stringify(vec)}`);
}

// 파츠가 바깥(out)을 '앞'으로 바라볼 때, 그 파츠 기준 전·후·좌·우·상·하가 world의 어느 벡터인지
const FRAMES = {
  front: { front: 'front', back: 'back', left: 'left', right: 'right', up: 'up', down: 'down' },
  back: { front: 'back', back: 'front', left: 'right', right: 'left', up: 'up', down: 'down' },
  right: { front: 'right', back: 'left', left: 'front', right: 'back', up: 'up', down: 'down' },
  left: { front: 'left', back: 'right', left: 'back', right: 'front', up: 'up', down: 'down' },
  // 위/아래로 뻗는 파츠: 좌우는 그대로, '상/하'는 앞뒤 축을 쓴다
  up: { front: 'up', back: 'down', left: 'left', right: 'right', up: 'back', down: 'front' },
  down: { front: 'down', back: 'up', left: 'left', right: 'right', up: 'front', down: 'back' },
};

export function localFrame(outVec) {
  const map = FRAMES[worldKeyOf(outVec)];
  const frame = {};
  for (const k of DIR_KEYS) frame[k] = WORLD_DIR[map[k]];
  return frame;
}

// 같은 크기 연결점의 index(1부터)가 가리키는 방향 키
export function slotDirectionKey(isRoot, index, ctx = DEFAULT_CTX) {
  const base = ctx.constants.assembly.directionCycle;
  const cycle = isRoot ? base : base.filter((k) => k !== 'back');
  return cycle[(index - 1) % cycle.length];
}

// 연결점 정렬 키: 큰 크기 먼저, 같은 크기면 번호순 (결정적 순서)
export const slotOrder = (size, index) => (4 - SIZE_RANK[size]) * 1000 + index;

// ── 트리 만들기 ───────────────────────────────────────────────
const err = (code, message, uid = null) => ({ level: 'error', code, uid, message });

// 연결점 정의를 노드에서 꺼낸다 (제공 개수는 파츠 정의의 provides)
export function slotsOfNode(node, children = node.children) {
  const slots = [];
  for (const size of ['L', 'M', 'S']) {
    const count = node.def.provides?.[size] || 0;
    for (let i = 1; i <= count; i++) {
      const dirKey = slotDirectionKey(node.parent === null, i, node.ctx);
      const occupant = children.find((c) => c.slot.size === size && c.slot.index === i);
      slots.push({
        id: slotId(node.uid, size, i),
        parentUid: node.uid,
        size,
        index: i,
        dirKey,
        dir: localFrame(node.out)[dirKey],
        occupiedBy: occupant ? occupant.uid : null,
      });
    }
  }
  return slots;
}

/**
 * 설계 → 트리.
 * 반환: { ok, errors, root, nodes(Map uid→node), order(BFS uid 배열), ctx }
 * 오류가 있어도 가능한 만큼의 트리를 만들어 돌려줍니다(화면이 부분적으로라도 그릴 수 있도록).
 * node: { uid, partId, def, parent, children[], slot, form, depth, out, outKey, dirKey,
 *         hop, emitHop, powered, relay, ctx }
 */
export function buildTree(design, ctx = DEFAULT_CTX) {
  const errors = [];
  const raw = design?.parts || [];
  const A = ctx.constants.assembly;

  if (raw.length > A.maxParts) errors.push(err('too_many_parts', `파츠가 너무 많습니다 (${raw.length} / 최대 ${A.maxParts})`));

  // 1) 노드 만들기
  const nodes = new Map();
  for (const p of raw) {
    if (nodes.has(p.uid)) {
      errors.push(err('duplicate_uid', `같은 uid가 두 번 나옵니다: ${p.uid}`, p.uid));
      continue;
    }
    const def = ctx.parts[p.part];
    if (!def) {
      errors.push(err('unknown_part', `알 수 없는 파츠: ${p.part}`, p.uid));
      continue;
    }
    nodes.set(p.uid, {
      uid: p.uid, partId: p.part, def, parent: null, parentUid: p.parent ?? null, children: [],
      slot: p.slot ? { size: p.slot.size, index: p.slot.index } : null,
      form: p.form === 'A' || p.form === 'B' ? p.form : 'both',
      depth: 0, out: WORLD_DIR.front, outKey: 'front', dirKey: null,
      hop: 0, emitHop: 0, powered: false, relay: Boolean(def.relay), ctx,
    });
  }

  // 2) 코어 확인
  const cores = [...nodes.values()].filter((n) => n.def.category === 'core');
  if (cores.length === 0) errors.push(err('no_core', '코어가 없습니다'));
  if (cores.length > 1) errors.push(err('multiple_core', '코어는 정확히 1개여야 합니다'));
  const root = cores.find((n) => n.parentUid === null) || cores[0] || null;
  for (const c of cores) {
    if (c.parentUid !== null) errors.push(err('core_has_parent', '코어는 다른 파츠에 붙일 수 없습니다', c.uid));
  }

  // 3) 부모 연결 (연결점 검증)
  const used = new Set();
  for (const n of nodes.values()) {
    if (n === root || n.def.category === 'core') continue;
    if (n.parentUid === null) {
      errors.push(err('missing_parent', `${n.def.name}이(가) 어디에도 붙어 있지 않습니다`, n.uid));
      continue;
    }
    const parent = nodes.get(n.parentUid);
    if (!parent) {
      errors.push(err('missing_parent', `${n.def.name}의 부모(${n.parentUid})를 찾을 수 없습니다`, n.uid));
      continue;
    }
    if (!n.slot || !SIZE_RANK[n.slot.size] || !Number.isInteger(n.slot.index) || n.slot.index < 1) {
      errors.push(err('bad_slot', `${n.def.name}의 연결점 표기가 올바르지 않습니다`, n.uid));
      continue;
    }
    const provided = parent.def.provides?.[n.slot.size] || 0;
    if (n.slot.index > provided) {
      errors.push(err('bad_slot', `${parent.def.name}에는 ${n.slot.size}${n.slot.index} 연결점이 없습니다`, n.uid));
      continue;
    }
    if (!fitsSlot(n.def.size, n.slot.size)) {
      errors.push(err('slot_size', `${n.def.name}(${n.def.size})은(는) ${n.slot.size} 연결점에 붙일 수 없습니다`, n.uid));
      continue;
    }
    const key = `${parent.uid}.${n.slot.size}${n.slot.index}`;
    if (used.has(key)) {
      errors.push(err('slot_occupied', `연결점 ${key}에 파츠가 두 개 붙어 있습니다`, n.uid));
      continue;
    }
    used.add(key);
    n.parent = parent;
    parent.children.push(n);
  }

  // 4) 코어에서 도달 가능한지(고아·순환 제거) + BFS 순서 + 방향/전력 계산
  const order = [];
  if (root) {
    root.out = WORLD_DIR.front;
    root.outKey = 'front';
    root.powered = true;
    const queue = [root];
    const seen = new Set([root.uid]);
    while (queue.length) {
      const node = queue.shift();
      order.push(node.uid);
      node.children.sort((a, b) => slotOrder(a.slot.size, a.slot.index) - slotOrder(b.slot.size, b.slot.index));
      const frame = localFrame(node.out);
      for (const child of node.children) {
        if (seen.has(child.uid)) continue; // 순환 방지
        seen.add(child.uid);
        child.depth = node.depth + 1;
        child.dirKey = slotDirectionKey(node.parent === null, child.slot.index, ctx);
        child.out = frame[child.dirKey];
        child.outKey = worldKeyOf(child.out);
        // 전력 홉: 부모가 (전력을 받는) 중계 케이블이면 0부터 다시 센다
        const parentEmit = node.relay && node.powered ? 0 : node.hop;
        child.hop = parentEmit + 1;
        child.emitHop = child.relay ? 0 : child.hop;
        child.powered = node.powered && child.hop <= A.maxPowerHops;
        queue.push(child);
      }
    }
    for (const n of nodes.values()) {
      if (!seen.has(n.uid)) {
        // 고아: 부모 링크가 순환하거나 코어에 닿지 않음
        if (!errors.some((e) => e.uid === n.uid)) {
          errors.push(err('orphan', `${n.def.name}이(가) 코어와 이어져 있지 않습니다`, n.uid));
        }
        n.orphan = true;
      }
    }
    // 고아 노드는 트리에서 분리
    for (const n of [...nodes.values()]) if (n.orphan) nodes.delete(n.uid);
  }

  return { ok: errors.length === 0, errors, root, nodes, order, ctx };
}

// ── 조회 보조 ─────────────────────────────────────────────────
export function descendantsOf(tree, uid) {
  const out = [];
  const start = tree.nodes.get(uid);
  if (!start) return out;
  const stack = [...start.children];
  while (stack.length) {
    const n = stack.pop();
    out.push(n.uid);
    stack.push(...n.children);
  }
  return out;
}

export function ancestorsOf(tree, uid) {
  const out = [];
  let n = tree.nodes.get(uid);
  while (n && n.parent) {
    out.push(n.parent.uid);
    n = n.parent;
  }
  return out;
}

// 이 노드가 코어를 포함한 경로상의 구조(체력 풀)인지가 아니라, 코어까지 몇 단계인지 (depth와 동일)
export const depthOf = (tree, uid) => tree.nodes.get(uid)?.depth ?? -1;

// 노드의 모든 연결점(점유 여부 포함)
export function allSlots(tree) {
  const out = [];
  for (const uid of tree.order) out.push(...slotsOfNode(tree.nodes.get(uid)));
  return out;
}

// 특정 파츠를 붙일 수 있는 빈 연결점 목록 (조립 화면의 하이라이트용)
export function freeSlotsFor(tree, partId, ctx = tree.ctx) {
  const def = ctx.parts[partId];
  if (!def || def.category === 'core') return [];
  return allSlots(tree).filter((s) => !s.occupiedBy && fitsSlot(def.size, s.size));
}

// ── 형태(A/B)와 기능 가능 집합 ────────────────────────────────
// 활성: 자기 형태가 맞고 조상도 모두 활성. (접힌 부모에 붙은 파츠는 함께 접힌다)
export function activeSet(tree, form = 'A') {
  const set = new Set();
  const visit = (node) => {
    const on = node.form === 'both' || node.form === form;
    if (!on) return;
    set.add(node.uid);
    node.children.forEach(visit);
  };
  if (tree.root) visit(tree.root);
  return set;
}

// 기능 가능: 활성 + 전력을 받음
export function functionalSet(tree, form = 'A') {
  const act = activeSet(tree, form);
  const set = new Set();
  for (const uid of act) if (tree.nodes.get(uid).powered) set.add(uid);
  return set;
}

export const hasMorphJoint = (tree) => [...tree.nodes.values()].some((n) => n.def.morphable);
export const usesForms = (design) => (design?.parts || []).some((p) => p.form === 'A' || p.form === 'B');

// ── 편집 연산 (모두 새 설계를 돌려줌) ─────────────────────────
const cloneParts = (design) => design.parts.map((p) => ({ ...p, slot: p.slot ? { ...p.slot } : null }));

export const withParts = (design, parts) => ({ ...design, parts });

/**
 * 파츠 부착.  attach = { part, parent, size, index, form? }
 * 반환: { ok, design, uid } 또는 { ok:false, error }
 */
export function attachPart(design, attach, ctx = DEFAULT_CTX) {
  const def = ctx.parts[attach.part];
  if (!def) return { ok: false, error: err('unknown_part', `알 수 없는 파츠: ${attach.part}`) };
  if (def.category === 'core') return { ok: false, error: err('core_attach', '코어는 따로 붙일 수 없습니다 (코어 교체를 쓰세요)') };
  const tree = buildTree(design, ctx);
  const parent = tree.nodes.get(attach.parent);
  if (!parent) return { ok: false, error: err('missing_parent', `부모를 찾을 수 없습니다: ${attach.parent}`) };
  const provided = parent.def.provides?.[attach.size] || 0;
  if (attach.index < 1 || attach.index > provided) {
    return { ok: false, error: err('bad_slot', `${parent.def.name}에는 ${attach.size}${attach.index} 연결점이 없습니다`) };
  }
  if (!fitsSlot(def.size, attach.size)) {
    return { ok: false, error: err('slot_size', `${def.name}(${def.size})은(는) ${attach.size} 연결점에 붙일 수 없습니다`) };
  }
  if (parent.children.some((c) => c.slot.size === attach.size && c.slot.index === attach.index)) {
    return { ok: false, error: err('slot_occupied', '이미 파츠가 붙어 있는 연결점입니다') };
  }
  if (design.parts.length + 1 > ctx.constants.assembly.maxParts) {
    return { ok: false, error: err('too_many_parts', `파츠는 최대 ${ctx.constants.assembly.maxParts}개까지 붙일 수 있습니다`) };
  }
  const uid = makeUid(attach.part, new Set(design.parts.map((p) => p.uid)));
  const parts = cloneParts(design);
  parts.push({ uid, part: attach.part, parent: attach.parent, slot: { size: attach.size, index: attach.index }, form: attach.form || 'both' });
  return { ok: true, design: withParts(design, parts), uid };
}

// 파츠 분리: 그 파츠와 그 아래에 붙은 모든 파츠가 함께 떨어진다. 코어는 분리할 수 없다.
export function detachPart(design, uid) {
  const target = design.parts.find((p) => p.uid === uid);
  if (!target) return { ok: false, error: err('missing_part', `파츠를 찾을 수 없습니다: ${uid}`) };
  if (target.parent === null) return { ok: false, error: err('core_detach', '코어는 분리할 수 없습니다') };
  const removed = new Set([uid]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const p of design.parts) {
      if (!removed.has(p.uid) && p.parent !== null && removed.has(p.parent)) {
        removed.add(p.uid);
        grew = true;
      }
    }
  }
  return { ok: true, design: withParts(design, cloneParts(design).filter((p) => !removed.has(p.uid))), removed: [...removed] };
}

// 파츠의 형태(A/B/both) 지정
export function setPartForm(design, uid, form) {
  const f = form === 'A' || form === 'B' ? form : 'both';
  return withParts(design, cloneParts(design).map((p) => (p.uid === uid ? { ...p, form: f } : p)));
}

// 코어 교체: 새 코어가 제공하지 못하는 연결점에 붙어 있던 파츠(와 그 하위)는 함께 제거된다.
export function replaceCore(design, coreId, ctx = DEFAULT_CTX) {
  const def = ctx.parts[coreId];
  if (!def || def.category !== 'core') return { ok: false, error: err('unknown_part', `코어가 아닙니다: ${coreId}`) };
  let parts = cloneParts(design).map((p) => (p.parent === null ? { ...p, part: coreId } : p));
  const removed = [];
  // 코어에 직접 붙은 파츠 중 연결점이 사라진 것을 찾아 제거 (하위 포함)
  let d = withParts(design, parts);
  for (const p of parts.filter((q) => q.parent === 'core' || q.parent === parts.find((r) => r.parent === null)?.uid)) {
    const provided = def.provides?.[p.slot.size] || 0;
    if (p.slot.index > provided || !fitsSlot(ctx.parts[p.part]?.size || 'L', p.slot.size)) {
      const res = detachPart(d, p.uid);
      if (res.ok) {
        d = res.design;
        removed.push(...res.removed);
      }
    }
  }
  return { ok: true, design: d, removed };
}

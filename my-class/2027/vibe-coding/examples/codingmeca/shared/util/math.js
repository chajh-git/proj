// shared/util/math.js
// 벡터·각도·AABB·광선 보조 함수. 화면 코드를 import하지 않습니다(서버와 브라우저 공용).
//
// 좌표계 (three.js와 같은 규약)
//   x = 오른쪽, y = 위, z = 뒤쪽.  기체의 '앞'은 −z 방향.
//   heading(rad)은 y축 회전이며 three.js의 group.rotation.y 와 같은 의미입니다.
//   heading 0 이면 앞이 −z, 양의 방향으로 돌수록 앞이 −x 쪽(왼쪽)으로 돕니다.
//   전장 평면은 (x, z), 단위 m.

export const EPS = 1e-9;
export const DEG = Math.PI / 180;

// ── 스칼라 ─────────────────────────────────────────────────
export const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
export const clamp01 = (v) => clamp(v, 0, 1);
export const lerp = (a, b, t) => a + (b - a) * t;
export const inverseLerp = (a, b, v) => (a === b ? 0 : (v - a) / (b - a));
export const remap = (v, a, b, c, d) => lerp(c, d, inverseLerp(a, b, v));
export const sign = (v) => (v > 0 ? 1 : v < 0 ? -1 : 0);
export const round = (v, digits = 2) => {
  const f = 10 ** digits;
  return Math.round(v * f) / f;
};
// 현재 값을 목표 값으로 최대 maxDelta만큼 이동
export const approach = (cur, target, maxDelta) =>
  cur < target ? Math.min(cur + maxDelta, target) : Math.max(cur - maxDelta, target);

// ── 각도 ───────────────────────────────────────────────────
export const deg2rad = (d) => d * DEG;
export const rad2deg = (r) => r / DEG;
// −π ~ π 범위로 정규화
export const wrapAngle = (a) => {
  const t = (a + Math.PI) % (2 * Math.PI);
  return (t < 0 ? t + 2 * Math.PI : t) - Math.PI;
};
// from → to 로 가는 최단 회전량(부호 있음)
export const angleDiff = (from, to) => wrapAngle(to - from);

// ── 3D 벡터 (순수 객체 {x,y,z}) ────────────────────────────
export const v3 = (x = 0, y = 0, z = 0) => ({ x, y, z });
export const v3clone = (a) => ({ x: a.x, y: a.y, z: a.z });
export const v3add = (a, b) => ({ x: a.x + b.x, y: a.y + b.y, z: a.z + b.z });
export const v3sub = (a, b) => ({ x: a.x - b.x, y: a.y - b.y, z: a.z - b.z });
export const v3scale = (a, s) => ({ x: a.x * s, y: a.y * s, z: a.z * s });
export const v3dot = (a, b) => a.x * b.x + a.y * b.y + a.z * b.z;
export const v3len = (a) => Math.hypot(a.x, a.y, a.z);
export const v3dist = (a, b) => v3len(v3sub(a, b));
export const v3lerp = (a, b, t) => ({ x: lerp(a.x, b.x, t), y: lerp(a.y, b.y, t), z: lerp(a.z, b.z, t) });
export const v3norm = (a) => {
  const l = v3len(a);
  return l < EPS ? { x: 0, y: 0, z: 0 } : v3scale(a, 1 / l);
};
export const v3eq = (a, b, eps = 1e-6) =>
  Math.abs(a.x - b.x) < eps && Math.abs(a.y - b.y) < eps && Math.abs(a.z - b.z) < eps;

// 수평(x,z) 거리와 길이
export const horizontalLen = (a) => Math.hypot(a.x, a.z);
export const horizontalDist = (a, b) => Math.hypot(a.x - b.x, a.z - b.z);

// ── heading 변환 ───────────────────────────────────────────
// y축으로 h(rad)만큼 회전 (three.js rotation.y와 동일)
export const rotateY = (v, h) => {
  const c = Math.cos(h);
  const s = Math.sin(h);
  return { x: v.x * c + v.z * s, y: v.y, z: -v.x * s + v.z * c };
};
// heading → 앞 방향 단위벡터 (heading 0 → −z)
export const forwardFromHeading = (h) => rotateY({ x: 0, y: 0, z: -1 }, h);
// 방향 벡터(수평) → heading
export const headingFromDirection = (d) => Math.atan2(-d.x, -d.z);

// ── AABB ({min, max}) ──────────────────────────────────────
export const aabbFromCenter = (center, half) => ({
  min: { x: center.x - half.x, y: center.y - half.y, z: center.z - half.z },
  max: { x: center.x + half.x, y: center.y + half.y, z: center.z + half.z },
});
export const aabbCenter = (b) => ({
  x: (b.min.x + b.max.x) / 2,
  y: (b.min.y + b.max.y) / 2,
  z: (b.min.z + b.max.z) / 2,
});
export const aabbSize = (b) => ({ x: b.max.x - b.min.x, y: b.max.y - b.min.y, z: b.max.z - b.min.z });
export const aabbUnion = (a, b) => ({
  min: { x: Math.min(a.min.x, b.min.x), y: Math.min(a.min.y, b.min.y), z: Math.min(a.min.z, b.min.z) },
  max: { x: Math.max(a.max.x, b.max.x), y: Math.max(a.max.y, b.max.y), z: Math.max(a.max.z, b.max.z) },
});
export const aabbContains = (b, p) =>
  p.x >= b.min.x && p.x <= b.max.x && p.y >= b.min.y && p.y <= b.max.y && p.z >= b.min.z && p.z <= b.max.z;

// 세 축 모두에서 eps보다 깊게 겹칠 때만 '겹침'. 맞닿은 면은 겹침이 아니다.
// 겹치면 최소 침투 깊이를, 아니면 0을 돌려준다.
export function aabbOverlapDepth(a, b, eps = 0) {
  const dx = Math.min(a.max.x, b.max.x) - Math.max(a.min.x, b.min.x);
  const dy = Math.min(a.max.y, b.max.y) - Math.max(a.min.y, b.min.y);
  const dz = Math.min(a.max.z, b.max.z) - Math.max(a.min.z, b.min.z);
  if (dx <= eps || dy <= eps || dz <= eps) return 0;
  return Math.min(dx, dy, dz);
}
export const aabbOverlap = (a, b, eps = 0) => aabbOverlapDepth(a, b, eps) > 0;

// 광선(origin, 단위 방향 dir) 과 AABB의 교차. 맞으면 진입 거리 t(≥0), 아니면 null. (slab 방식)
export function rayAabb(origin, dir, box, maxT = Infinity) {
  let tmin = 0;
  let tmax = maxT;
  for (const axis of ['x', 'y', 'z']) {
    const o = origin[axis];
    const d = dir[axis];
    const lo = box.min[axis];
    const hi = box.max[axis];
    if (Math.abs(d) < EPS) {
      if (o < lo || o > hi) return null;
    } else {
      let t1 = (lo - o) / d;
      let t2 = (hi - o) / d;
      if (t1 > t2) [t1, t2] = [t2, t1];
      tmin = Math.max(tmin, t1);
      tmax = Math.min(tmax, t2);
      if (tmin > tmax) return null;
    }
  }
  return tmin;
}

// ── 2D (전장 평면 x,z) 보조 ─────────────────────────────────
export const dist2 = (ax, az, bx, bz) => Math.hypot(ax - bx, az - bz);

// 원과 사각형(축 정렬, 중심 cx,cz / 반폭 hx,hz) 충돌
export function circleRect(px, pz, r, cx, cz, hx, hz) {
  const dx = Math.max(Math.abs(px - cx) - hx, 0);
  const dz = Math.max(Math.abs(pz - cz) - hz, 0);
  return dx * dx + dz * dz <= r * r;
}

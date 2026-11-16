// shared/util/rng.js
// 시드 난수. 같은 시드 → 같은 수열이므로 시뮬레이션과 리플레이가 항상 같은 결과를 냅니다.
// 시뮬레이션 안에서는 Math.random()을 절대 쓰지 말고 이 모듈만 쓰세요.

// 문자열 → 32비트 정수 (FNV-1a)
export function hashString(str) {
  let h = 0x811c9dc5;
  const s = String(str);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

export function toSeed(seed) {
  if (typeof seed === 'string') return hashString(seed);
  if (typeof seed === 'number' && Number.isFinite(seed)) return seed >>> 0;
  return 1;
}

// mulberry32
export function createRng(seedInput = 1) {
  const seed = toSeed(seedInput);
  let a = seed;

  const next = () => {
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };

  const api = {
    seed,
    // [0, 1)
    next,
    float: next,
    // [min, max)
    range: (min, max) => min + (max - min) * next(),
    // 정수 [min, max] (양끝 포함)
    int: (min, max) => min + Math.floor(next() * (max - min + 1)),
    // p 확률로 true
    chance: (p) => next() < p,
    pick: (arr) => arr[Math.floor(next() * arr.length)],
    // Fisher–Yates (새 배열)
    shuffle: (arr) => {
      const out = arr.slice();
      for (let i = out.length - 1; i > 0; i--) {
        const j = Math.floor(next() * (i + 1));
        [out[i], out[j]] = [out[j], out[i]];
      }
      return out;
    },
    // 대략 정규분포 (Box–Muller)
    normal: (mean = 0, sd = 1) => {
      const u = Math.max(next(), 1e-12);
      const v = next();
      return mean + sd * Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v);
    },
    // 이름이 다르면 독립된 수열을 주는 하위 난수 (예: 'meteors', 'hitRay')
    fork: (label) => createRng((seed ^ hashString(label)) >>> 0),
    getState: () => a >>> 0,
    setState: (s) => {
      a = s | 0;
    },
  };
  return api;
}

// shared/util/ids.js
// 파츠 uid, 연결점 ID, 임의 ID 보조 함수.
//
// uid 규칙: 코어는 'core', 같은 파츠가 처음 나오면 파츠ID 그대로, 두 번째부터 '파츠ID#2', '파츠ID#3' …
// 연결점 ID: '부모uid.크기순번'  (예: core.중1, mv_servo#2.소1)

import { SIZE_LABEL } from '../../config/names.js';

const LABEL_TO_SIZE = Object.fromEntries(Object.entries(SIZE_LABEL).map(([k, v]) => [v, k]));

// existing: Set | Array | { [uid]: any } 에 이미 있는 uid를 피해 새 uid를 만든다.
export function makeUid(partId, existing) {
  const has = (u) =>
    existing instanceof Set ? existing.has(u) : Array.isArray(existing) ? existing.includes(u) : u in existing;
  if (!has(partId)) return partId;
  for (let n = 2; n < 1000; n++) {
    const u = `${partId}#${n}`;
    if (!has(u)) return u;
  }
  throw new Error(`uid를 만들 수 없습니다: ${partId}`);
}

// 'mv_servo#2' → 'mv_servo'
export const uidToPartId = (uid) => uid.split('#')[0];

// 연결점 ID 만들기·해석
export const slotId = (parentUid, size, index) => `${parentUid}.${SIZE_LABEL[size]}${index}`;

export function parseSlotId(text) {
  const m = /^(.+)\.(소|중|대)(\d+)$/.exec(String(text));
  if (!m) return null;
  return { parentUid: m[1], size: LABEL_TO_SIZE[m[2]], index: Number(m[3]) };
}

// 화면용 임의 ID (시뮬레이션에서는 쓰지 않음 — 시뮬레이션은 rng를 쓴다)
export function randomId(prefix = 'id', length = 8) {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let out = '';
  const c = globalThis.crypto;
  if (c && c.getRandomValues) {
    const buf = new Uint8Array(length);
    c.getRandomValues(buf);
    for (const b of buf) out += chars[b % chars.length];
  } else {
    for (let i = 0; i < length; i++) out += chars[Math.floor(Math.random() * chars.length)];
  }
  return `${prefix}_${out}`;
}

// 짧은 해시(FNV-1a, 8자리 16진수). 설계 변경 감지·스냅샷 식별용 (보안용 아님)
export function shortHash(text) {
  let h = 0x811c9dc5;
  const s = String(text);
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

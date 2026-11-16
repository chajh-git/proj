// shared/build/serialize.js  (19번)
// 설계 저장 형식. DB(designs.data)·내보내기 JSON·출전 스냅샷이 모두 이 형식을 씁니다.
// 화면 코드를 import하지 않습니다.
//
// 저장 형식 (schema 1)
//   { schema: 1, name, parts: [{ uid, part, parent, slot, form? }], pilot: { name, temperament, skills }, tactics? }
//   - form은 'A'/'B'일 때만 기록(기본 both는 생략)
//   - tactics는 전술 설계(20번 이후 형식)를 그대로 담는 칸. 이 모듈은 내용을 해석하지 않는다.

import { shortHash } from '../util/ids.js';
import { emptyPilot } from '../../data/pilot-skills.js';

export const DESIGN_SCHEMA = 1;

export function emptyDesign(coreId = 'core1', name = '새 기체') {
  return normalizeDesign({ name, parts: [{ uid: 'core', part: coreId, parent: null, slot: null }] });
}

// 느슨한 입력을 표준 형태로 (없는 칸 채움, 필요 없는 칸 제거). 원본은 바꾸지 않음.
export function normalizeDesign(input) {
  const src = input || {};
  const parts = (src.parts || []).map((p) => {
    const out = {
      uid: String(p.uid),
      part: String(p.part),
      parent: p.parent ?? null,
      slot: p.slot ? { size: p.slot.size, index: Number(p.slot.index) } : null,
    };
    if (p.form === 'A' || p.form === 'B') out.form = p.form;
    return out;
  });
  const pilotSrc = src.pilot || {};
  const base = emptyPilot();
  const design = {
    schema: DESIGN_SCHEMA,
    name: String(src.name ?? '').trim(),
    parts,
    pilot: {
      name: String(pilotSrc.name ?? base.name),
      temperament: pilotSrc.temperament ?? base.temperament,
      skills: [...(pilotSrc.skills || [])],
    },
  };
  if (src.tactics) design.tactics = JSON.parse(JSON.stringify(src.tactics));
  return design;
}

// 정렬된 키로 문자열화 → 같은 내용이면 항상 같은 문자열
function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value).sort().map((k) => `${JSON.stringify(k)}:${stable(value[k])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

export const serializeDesign = (design) => JSON.stringify(normalizeDesign(design));

export function parseDesign(text) {
  let raw;
  try {
    raw = JSON.parse(text);
  } catch {
    return { ok: false, error: '설계 파일을 읽을 수 없습니다 (JSON 형식 오류)' };
  }
  if (!raw || typeof raw !== 'object' || !Array.isArray(raw.parts)) {
    return { ok: false, error: '설계 파일 형식이 올바르지 않습니다' };
  }
  if (raw.schema !== undefined && raw.schema > DESIGN_SCHEMA) {
    return { ok: false, error: '더 새로운 버전에서 만든 설계입니다' };
  }
  return { ok: true, design: normalizeDesign(raw) };
}

// 설계 변경 감지용 지문(이름·전술 포함). 보안용 아님.
export const designHash = (design) => shortHash(stable(normalizeDesign(design)));

// 형태(구조)만의 지문: 전술·이름이 달라도 같은 기체 구조면 같다
export const structureHash = (design) => {
  const d = normalizeDesign(design);
  return shortHash(stable({ parts: d.parts, pilot: d.pilot }));
};

// 두 설계의 차이 요약 (버전 비교 화면용)
export function diffDesigns(a, b) {
  const A = new Map(normalizeDesign(a).parts.map((p) => [p.uid, p]));
  const B = new Map(normalizeDesign(b).parts.map((p) => [p.uid, p]));
  const added = [...B.keys()].filter((u) => !A.has(u));
  const removed = [...A.keys()].filter((u) => !B.has(u));
  const changed = [...B.keys()].filter((u) => A.has(u) && stable(A.get(u)) !== stable(B.get(u)));
  return { added, removed, changed, same: !added.length && !removed.length && !changed.length };
}

// 출전 스냅샷: 대전 중 수정 불가. 설계와 전술을 한 덩어리로 얼려 지문을 붙인다.
export function makeSnapshot(design, { balanceVersion = null, takenAt = null } = {}) {
  const d = normalizeDesign(design);
  return Object.freeze({ design: d, hash: designHash(d), balanceVersion, takenAt });
}

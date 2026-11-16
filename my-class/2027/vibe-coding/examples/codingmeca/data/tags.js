// data/tags.js
// 파츠 태그 정의. 융합·변신 조건(숨은 레시피)의 재료가 되며, 3D 표현의 색조에도 쓰입니다.
// 태그는 화면에 그대로 보여주어도 되고, 지휘관 설정으로 숨길 수도 있습니다(기본: 조립 화면에는 보임).

export const TAGS = Object.freeze({
  machine: { id: 'machine', label: '기계', color: '#8FA3B8', desc: '정밀 기계 계열' },
  beast: { id: 'beast', label: '야수', color: '#D9A15B', desc: '포식자·야생 계열' },
  abyss: { id: 'abyss', label: '심해', color: '#2F8FBF', desc: '깊은 바다 계열' },
  flame: { id: 'flame', label: '화염', color: '#FF6A3D', desc: '불과 열 계열' },
  thunder: { id: 'thunder', label: '뇌전', color: '#B58CFF', desc: '번개·전기 계열' },
  radiance: { id: 'radiance', label: '광휘', color: '#FFE27A', desc: '빛·에너지 계열' },
  ancient: { id: 'ancient', label: '고대', color: '#C9B27C', desc: '신화 시대 유산 계열' },
  space: { id: 'space', label: '우주', color: '#6C7BFF', desc: '궤도·우주 계열' },
});

export const TAG_IDS = Object.freeze(Object.keys(TAGS));

// 파츠 데이터에 쓰인 태그가 정의된 태그인지 확인하는 보조 함수
export function isValidTag(id) {
  return Object.prototype.hasOwnProperty.call(TAGS, id);
}

// 파츠 목록에서 태그별 개수를 센다. (융합 조건 판정·UI 표시 공용)
//  parts: [{ tags: ['beast', ...] }, ...]
export function countTags(parts) {
  const out = {};
  for (const id of TAG_IDS) out[id] = 0;
  for (const p of parts) for (const t of p.tags || []) if (t in out) out[t] += 1;
  return out;
}

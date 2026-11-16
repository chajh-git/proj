// web/ui/tactics/labels.js  (63~66번이 함께 쓰는 글자표)
// 신경 연산실 화면에서 쓰는 이름표. 게임 용어는 config/names.js 를 따른다.

export const SENSOR_LABEL = Object.freeze({
  enemy_distance: '거리 측정', enemy_bearing: '방향 측정', stealth_reveal: '은신 간파', enemy_energy_pct: '적 에너지 측정', enemy_hp_pct: '적 체력 측정',
  enemy_spirit: '적 투지 측정', enemy_part_state: '적 파츠 상태 측정', through_walls: '벽 너머 감지', underwater_detect: '수중 감지',
  enemy_stance_name: '적 태세 읽기', ally_precise: '아군 정밀 정보', shared_vars: '변수 공유',
});

// 동작·조건 카드 안에서 값 앞에 붙는 짧은 이름
export const PARAM_LABEL = Object.freeze({
  dir: '방향', face: '바라볼 면', part: '파츠', parts: '파츠', to: '목표', pct: '출력', seconds: '간격', deg: '각도', skill: '각성기',
  var: '변수', value: '', delta: '증감', timer: '타이머', selector: '대상', releaseSeconds: '해제', index: '번호', event: '', state: '', on: '', op: '',
});

// 태세 노드 색 (신경 연산실 3D 노드와 태세 지도가 같은 색을 쓴다)
export const STANCE_COLORS = Object.freeze(['#00E5FF', '#FF2BD6', '#FFD35A', '#7CFF6B', '#B58CFF']);

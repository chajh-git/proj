// config/names.js
// 게임에 등장하는 모든 명칭의 유일한 원본입니다.
// 화면에 보이는 문구를 바꾸고 싶으면 이 파일만 수정하세요.
// 규칙: 게임 안의 문구에는 '학생', '교사'라는 표현을 쓰지 않습니다. (FORBIDDEN_WORDS 참고)

export const GAME_TITLE = '코딩메카';

// ── 핵심 용어 ─────────────────────────────────────────────
export const NAMES = Object.freeze({
  title: GAME_TITLE,

  // 사람
  user: '메카닉', // 기체를 조립하고 전술을 짜는 사용자
  admin: '지휘관', // 리그를 운영하는 관리자
  team: '팀',

  // 기체 관련
  robot: '기체',
  preset: '원형 설계도', // 종족 프레임 예시 조립품
  core: '코어',
  spirit: '투지',
  gauge: '오버드라이브 게이지',
  pilotSkill: '조종사 각성기',
  pilot: '조종사',
  aptitude: '전장 적성',
  weight: '무게',
  cost: '비용',
  power: '출력',
  energy: '에너지',
  durability: '내구도',
  hp: '체력',

  // 전장·전술
  map: '전장',
  tacticCard: '전술 카드',
  stance: '태세',
  condition: '조건',
  action: '동작',
  variable: '변수',
  timer: '타이머',

  // 공간(화면)
  hangar: '격납고', // 조립 공간
  tacticsLab: '신경 연산실', // 코딩 공간
  range: '시험 사격장', // 연습 공간
  arena: '관제 스크린', // 통합 모니터
  command: '지휘 본부', // 관리자 페이지
  editor: '조율 센터', // 밸런스 에디터
  codex: '도감',
  lobby: '로비',

  // 특수 기능
  fusion: '융합',
  transform: '변신',
  fusionSignal: '융합 신호',
  detach: '분리',
  formA: '형태 A',
  formB: '형태 B',

  // 대전·리그
  match: '대전',
  league: '리그',
  tournament: '토너먼트',
  roster: '출전 명단',
  scoreboard: '점수판',
  replay: '리플레이',
  win: '승리',
  lose: '패배',
  draw: '무승부',
  aborted: '중단',
});

// ── 열거값 표시 이름 ──────────────────────────────────────
export const SIZE_LABEL = Object.freeze({ S: '소', M: '중', L: '대' });

export const CHANNEL_LABEL = Object.freeze({
  move: '이동',
  weapon: '무장',
  defense: '방어',
  special: '특수',
});

export const CATEGORY_LABEL = Object.freeze({
  core: '코어',
  structure: '구조체',
  joint: '관절·마운트',
  mobility: '이동 기관',
  armor: '장갑',
  defense: '방어',
  sensor: '센서',
  weapon: '무기',
  overdrive: '오버드라이브 병기',
  spirit: '투지·게이지',
  cell: '에너지 셀',
  special: '특수',
});

export const DAMAGE_TYPE_LABEL = Object.freeze({
  physical: '물리',
  energy: '에너지',
  emp: 'EMP',
  poison: '중독',
});

export const ENV_LABEL = Object.freeze({
  ground: '지상',
  water: '수중',
  air: '공중',
  space: '우주',
});

export const ALTITUDE_LABEL = Object.freeze({
  ground: '지상',
  low: '저공',
  high: '고공',
});

export const GRADE_LABEL = Object.freeze({ S: 'S', A: 'A', B: 'B', C: 'C', D: 'D' });

export const DIRECTION_LABEL = Object.freeze({
  front: '전',
  back: '후',
  left: '좌',
  right: '우',
  up: '상',
  down: '하',
});

export const TEMPERAMENT_LABEL = Object.freeze({
  fervent: '열혈',
  composed: '냉철',
  intuitive: '직감',
});

export const ROLE_LABEL = Object.freeze({
  mechanic: NAMES.user,
  commander: NAMES.admin,
});

export const MATCH_STATUS_LABEL = Object.freeze({
  scheduled: '대기',
  ready: '준비',
  running: '진행 중',
  paused: '일시정지',
  finished: '종료',
  aborted: NAMES.aborted,
});

// ── 금지 표현 검사 ────────────────────────────────────────
// 화면 문구에 들어가면 안 되는 표현. 개발 중 점검용입니다.
export const FORBIDDEN_WORDS = Object.freeze(['학생', '교사']);

export function findForbidden(text) {
  const s = String(text ?? '');
  return FORBIDDEN_WORDS.filter((w) => s.includes(w));
}

// 이 파일의 모든 문구를 점검해 위반 목록을 돌려줍니다. (테스트·디버그용)
export function auditNames() {
  const bad = [];
  const walk = (obj, path) => {
    for (const [k, v] of Object.entries(obj)) {
      if (typeof v === 'string') {
        const hits = findForbidden(v);
        if (hits.length) bad.push({ path: `${path}.${k}`, value: v, hits });
      } else if (v && typeof v === 'object') walk(v, `${path}.${k}`);
    }
  };
  walk({ NAMES, SIZE_LABEL, CHANNEL_LABEL, CATEGORY_LABEL, DAMAGE_TYPE_LABEL, ENV_LABEL,
    ALTITUDE_LABEL, DIRECTION_LABEL, TEMPERAMENT_LABEL, ROLE_LABEL, MATCH_STATUS_LABEL, SHELL_TEXT }, 'names');
  return bad;
}

// ── 앱 셸 공통 문구 (web/core/app-shell.js) ───────────────
export const SHELL_TEXT = Object.freeze({
  enter: '입장',
  enterHint: '화면을 눌러 소리를 켜고 시작합니다',
  settings: '설정',
  close: '닫기',
  quality: '화질',
  qualityAuto: '자동',
  qualityHigh: '상',
  qualityMid: '중',
  qualityLow: '하',
  qualityAutoNote: '프레임이 낮아지면 한 단계씩 낮춥니다',
  volumeMaster: '전체 음량',
  mute: '소리 끄기',
  loading: '불러오는 중…',
  offline: '서버와 연결이 끊어졌습니다. 다시 연결하는 중…',
  online: '서버에 연결되었습니다',
  noAccess: '이 화면에 들어올 권한이 없습니다',
  needLogin: '먼저 로그인해 주세요',
});

// 연결점 ID 표기: 부모ID.크기순번  (예: core.중1)
export function connectionId(parentUid, size, index) {
  return `${parentUid}.${SIZE_LABEL[size]}${index}`;
}

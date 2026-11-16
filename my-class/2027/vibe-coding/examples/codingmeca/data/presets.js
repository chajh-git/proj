// data/presets.js
// 원형 설계도 8종 (명세 v1.0 8장). 불러오기용 '예시 조립품'이며, 불러온 뒤에는 자유롭게 고칠 수 있습니다.
// 그리폰형·케르베로스형은 2차에 추가합니다.
//
// 조립 표기:  파츠ID@부모.크기순번
//   - 첫 항목은 코어(부모 없음, uid 'core')
//   - 부모는 이미 배치된 파츠의 uid. 같은 파츠가 여러 개면 두 번째부터 uid가 '파츠ID#2', '파츠ID#3'
//   - 크기순번은 부모가 제공하는 같은 크기 연결점의 번호 (예: 중1 = 첫 번째 중형 연결점)
//
// ※ 샘플 전술의 어휘(조건·동작 이름)는 임시입니다. shared/tactics/schema.js(20번)에서 어휘를 확정하면서
//   함께 검증·갱신합니다. 구조(태세/전환/규칙/채널)는 명세 11장 그대로입니다.

import { SIZE_LABEL } from '../config/names.js';

const LABEL_TO_SIZE = Object.fromEntries(Object.entries(SIZE_LABEL).map(([k, v]) => [v, k]));

// ── 조립 문자열 해석 ───────────────────────────────────────
export function parseAssembly(text) {
  const items = text.split(';').map((s) => s.trim()).filter(Boolean);
  const seen = {};
  const parts = [];
  for (const [i, item] of items.entries()) {
    const [partId, attach] = item.split('@');
    const n = (seen[partId] = (seen[partId] || 0) + 1);
    const uid = i === 0 ? 'core' : n === 1 ? partId : `${partId}#${n}`;
    if (i === 0) {
      parts.push({ uid, part: partId, parent: null, slot: null });
      continue;
    }
    const m = /^([^.]+)\.(소|중|대)(\d+)$/.exec(attach || '');
    if (!m) throw new Error(`조립 표기 오류: "${item}"`);
    const parentUid = m[1];
    parts.push({ uid, part: partId, parent: parentUid, slot: { size: LABEL_TO_SIZE[m[2]], index: Number(m[3]) } });
  }
  return parts;
}

// ── 샘플 전술 만들기(임시 어휘) ─────────────────────────────
const ALWAYS = { mode: 'all', conditions: [] };
const when = (...conditions) => ({ mode: 'all', conditions });
const dist = (op, value) => ({ type: 'enemy_distance', op, value });
const hp = (op, value) => ({ type: 'self_hp_pct', op, value });
const band = (op, value) => ({ type: 'enemy_band', op, value });
const inStance = (op, value) => ({ type: 'time_in_stance', op, value });

const rule = (channel, cond, action, target = 'nearest_enemy') => ({ channel, when: cond, do: action, target });

// 근접 사냥형: 달려들어 때리고, 체력이 낮으면 잠시 물러난다
function meleeTactic({ weapons, reach, retreatHp = 30, guardDefense = null, flank = false, alignArmor = false }) {
  const hunt = [
    // (flank는 거리 센서가 없는 기체용 표시 — 거리를 모르므로 곧장 달려든다)
    rule('move', ALWAYS, { type: 'approach' }),
    rule('weapon', when(band('==', 'near')), { type: 'use_weapon', parts: weapons }),
  ];
  const guard = [
    alignArmor
      ? rule('move', ALWAYS, { type: 'align', face: 'thickest_armor' })
      : rule('move', ALWAYS, { type: 'retreat' }),
    rule('weapon', when(band('==', 'near')), { type: 'use_weapon', parts: weapons }),
    ...(guardDefense ? [rule('defense', ALWAYS, guardDefense)] : []),
  ];
  return {
    startStance: 'hunt',
    stances: [
      { id: 'hunt', name: '사냥', transitions: [{ when: when(hp('<', retreatHp)), to: 'guard' }], rules: hunt },
      { id: 'guard', name: '경계', transitions: [{ when: when(inStance('>', 5)), to: 'hunt' }], rules: guard },
    ],
    variables: [],
    timers: [],
  };
}

// 원거리 견제형: 가까우면 물러나고, 멀면 다가가고, 적당하면 맴돌며 쏜다
function kiteTactic({ weapons, range, near = 8, far = 18, retreatHp = 30, defense = null, bands = false }) {
  // bands: 거리 센서가 없는 기체용 — 근거리 구간(8m 미만)까지 다가간 뒤 맴돌며 쏜다
  const common = [
    ...(bands
      ? [rule('move', when(band('!=', 'near')), { type: 'approach' })]
      : [rule('move', when(dist('<', near)), { type: 'retreat' }), rule('move', when(dist('>', far)), { type: 'approach' })]),
    rule('move', ALWAYS, { type: 'circle' }),
    rule('weapon', when(bands ? band('==', 'near') : dist('<=', range)), { type: 'use_weapon', parts: weapons }),
  ];
  return {
    startStance: 'kite',
    stances: [
      {
        id: 'kite', name: '견제',
        transitions: [{ when: when(hp('<', retreatHp)), to: 'run' }],
        rules: [...common, ...(defense ? [rule('defense', when(hp('<', 70)), defense)] : [])],
      },
      {
        id: 'run', name: '이탈',
        transitions: [{ when: when(inStance('>', 4)), to: 'kite' }],
        rules: [
          rule('move', ALWAYS, { type: 'retreat' }),
          rule('weapon', when(bands ? band('==', 'near') : dist('<=', range)), { type: 'use_weapon', parts: weapons }),
          ...(defense ? [rule('defense', ALWAYS, defense)] : []),
        ],
      },
    ],
    variables: [],
    timers: [],
  };
}

// ── 8종 정의 ───────────────────────────────────────────────
const RAW = [
  {
    id: 'preset_human',
    name: '인간형 전사',
    species: 'humanoid',
    blurb: '균형 잡힌 기본 기체. 플라즈마 건으로 거리를 두고 싸우는 입문용 설계도.',
    assembly:
      'core1; fr_human@core.중1; mv_servo@fr_human.중1; mv_servo@fr_human.중2; wp_plasma@core.중2; ar_react@core.소1; se_radar@core.소2; sp_amp@core.소3',
    pilot: { name: '아르고', temperament: 'fervent', skills: ['haste'] },
    tactics: kiteTactic({ weapons: ['wp_plasma'], range: 25 }),
    expected: { weight: 53, cost: 590 },
  },
  {
    id: 'preset_wolf',
    name: '늑대형',
    species: 'predator',
    blurb: '빠른 속도와 측면 기동. 송곳니와 발톱으로 달려들지만 장갑이 얇다.',
    assembly:
      'core1; fr_beast@core.중1; mv_beast@fr_beast.중1; mv_servo@fr_beast.중2; wp_fang@core.중2; wp_claw@fr_beast.소1; sp_amp@core.소1; se_radar@core.소2; sp_circuit@core.소3',
    pilot: { name: '그레이', temperament: 'fervent', skills: ['haste', 'sixth_sense'] },
    tactics: meleeTactic({ weapons: ['wp_fang', 'wp_claw'], reach: 1.4, flank: true, retreatHp: 25 }),
    expected: { weight: 55, cost: 600 },
  },
  {
    id: 'preset_lion',
    name: '사자형',
    species: 'predator',
    blurb: '정면 돌파와 두꺼운 장갑. 느리지만 앞면이 단단하고 후방이 약점.',
    assembly:
      'core2; fr_heavy@core.대1; ar_heavy@fr_heavy.대1; mv_beast@fr_heavy.중1; wp_fang@fr_heavy.중2; ar_ti@core.중1; wp_claw@core.소1; ar_react@core.소2; sp_stab@core.소3; se_radar@core.소4',
    pilot: { name: '레오', temperament: 'composed', skills: ['ironwall'] },
    tactics: meleeTactic({ weapons: ['wp_fang', 'wp_claw'], reach: 1.4, retreatHp: 25, alignArmor: true }),
    expected: { weight: 81, cost: 850 },
  },
  {
    id: 'preset_tiger',
    name: '호랑이형',
    species: 'predator',
    blurb: '은신과 기습. 열감지로 간파되기 전까지 상대 센서에 잡히지 않는다. 지구력은 낮다.',
    assembly:
      'core1; fr_beast@core.중1; mv_servo@fr_beast.중1; wp_fang@fr_beast.중2; wp_claw@core.소1; wp_claw@fr_beast.소1; sp_stealth@core.소2; se_thermal@core.소3; sp_circuit@core.소4; ar_react@fr_beast.소2',
    pilot: { name: '하랑', temperament: 'intuitive', skills: ['sixth_sense', 'haste'] },
    tactics: (() => {
      const t = meleeTactic({ weapons: ['wp_fang', 'wp_claw'], reach: 1.4, flank: true, retreatHp: 30 });
      // 시작하자마자 은신 켜기 (특수 채널)
      t.stances[0].rules.unshift(rule('special', ALWAYS, { type: 'toggle_part', parts: ['sp_stealth'], on: true }, 'self'));
      return t;
    })(),
    expected: { weight: 48, cost: 675 },
  },
  {
    id: 'preset_shark',
    name: '상어형',
    species: 'predator',
    blurb: '수중 전장에서 압도적. 육지에서는 약하며, 수리 나노봇으로 버틴다.',
    assembly:
      'core2; fr_sea@core.중1; mv_jet@core.중2; ar_ti@core.중3; mv_jet@fr_sea.중1; wp_fang@fr_sea.중2; se_sonar@core.소1; sp_stab@core.소2; se_radar@core.소3; ds_repair@core.소4',
    pilot: { name: '마리나', temperament: 'composed', skills: ['focus'] },
    tactics: meleeTactic({
      weapons: ['wp_fang'], reach: 1.4, retreatHp: 25,
      guardDefense: { type: 'toggle_part', parts: ['ds_repair'], on: true },
    }),
    expected: { weight: 66, cost: 880 },
  },
  {
    id: 'preset_dragon',
    name: '드래곤형',
    species: 'mythic',
    blurb: '비행과 브레스. 몸집이 커서 피격 면적이 넓고 비용이 높다.',
    assembly:
      'core2; fr_wyrm@core.대1; wp_breath@fr_wyrm.대1; mv_wing@core.중1; mv_servo@core.중2; se_thermal@core.소1; sp_amp@core.소2; od_cap@core.소3',
    pilot: { name: '이그니스', temperament: 'fervent', skills: [] },
    tactics: kiteTactic({ weapons: ['wp_breath'], range: 8, retreatHp: 25, bands: true }),
    expected: { weight: 72, cost: 970 },
  },
  {
    id: 'preset_phoenix',
    name: '불사조형',
    species: 'mythic',
    blurb: '체력이 0이 되면 한 번 부활한다. 부활 중에는 무방비.',
    assembly:
      'core2; fr_std@core.중1; ds_regen@core.중2; mv_wing@core.중3; wp_missile@fr_std.중1; ar_react@core.소1; se_radar@core.소2; sp_circuit@core.소3',
    pilot: { name: '아스트라', temperament: 'intuitive', skills: [] },
    tactics: kiteTactic({ weapons: ['wp_missile'], range: 40, near: 10, far: 28, retreatHp: 20 }),
    expected: { weight: 59, cost: 970 },
  },
  {
    id: 'preset_hydra',
    name: '히드라형',
    species: 'mythic',
    blurb: '머리 여러 개에 무기 다중 장착. 중앙 코어가 약점이다.',
    assembly:
      'core2; fr_heavy@core.대1; wp_fang@fr_heavy.중1; wp_fang@fr_heavy.중2; wp_fang@core.중1; wp_breath@fr_heavy.대1; mv_servo@core.중2; mv_servo@core.중3; ar_react@core.소1; sp_stab@core.소2; se_radar@core.소3',
    pilot: { name: '레르네', temperament: 'composed', skills: [] },
    tactics: (() => {
      const t = meleeTactic({ weapons: ['wp_fang'], reach: 1.4, retreatHp: 25 });
      // 가까우면 송곳니와 브레스를 함께 (무기 파츠는 사거리 안일 때만 실제로 발사된다)
      t.stances[0].rules = [
        t.stances[0].rules[0],
        rule('weapon', when(band('==', 'near')), { type: 'use_weapon', parts: ['wp_fang', 'wp_breath'] }),
      ];
      return t;
    })(),
    expected: { weight: 79, cost: 945 },
  },
];

// ── 내보내기 ────────────────────────────────────────────────
export const PRESETS = Object.freeze(
  RAW.map(({ assembly, ...rest }) =>
    Object.freeze({
      ...rest,
      assemblyText: assembly,
      parts: Object.freeze(parseAssembly(assembly)),
      form: null, // 형태 A/B 변신 설계는 사용하지 않음
    }),
  ),
);

export const PRESET_BY_ID = Object.freeze(Object.fromEntries(PRESETS.map((p) => [p.id, p])));

export const SPECIES_LABEL = Object.freeze({
  humanoid: '인간형',
  predator: '포식자형',
  mythic: '신화형',
});

export function getPreset(id) {
  const p = PRESET_BY_ID[id];
  if (!p) throw new Error(`알 수 없는 원형 설계도: ${id}`);
  return p;
}

// 불러오기: 편집 가능한 깊은 복사본을 돌려줍니다.
export function clonePreset(id) {
  return JSON.parse(JSON.stringify(getPreset(id)));
}

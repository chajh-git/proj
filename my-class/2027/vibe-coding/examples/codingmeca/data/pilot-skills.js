// data/pilot-skills.js
// 조종사 성향과 각성기 (명세 v1.0 9-5, 9-7).
// 각성기는 기체당 2칸이며 비용은 기체 예산에 포함됩니다. 발동 시 투지를 소모하고 사용 횟수가 정해져 있습니다.

// ── 성향 ───────────────────────────────────────────────────
// 실제 수치는 config/constants.js의 spirit.temperament 에 있습니다. 여기는 표시용 설명만 둡니다.
export const TEMPERAMENTS = Object.freeze({
  fervent: { id: 'fervent', label: '열혈', desc: '투지 70 이상에서 공격 +5%. 대신 투지가 1.3배 빠르게 떨어진다.' },
  composed: { id: 'composed', label: '냉철', desc: '투지 변동 폭이 0.7배. 오르내림이 적다.' },
  intuitive: { id: 'intuitive', label: '직감', desc: '회피 확률 +5%p.' },
});

export const TEMPERAMENT_IDS = Object.freeze(Object.keys(TEMPERAMENTS));

// ── 각성기 ─────────────────────────────────────────────────
// kind: 'timed'(지속시간 동안 효과) | 'instant'(즉시) | 'passive'(조건 충족 시 자동)
export const PILOT_SKILLS = Object.freeze({
  haste: {
    id: 'haste', name: '가속 각성', cost: 60, spiritCost: 20, uses: 2, kind: 'timed',
    durationSeconds: 10, effect: { speedMult: 1.4 }, desc: '10초 동안 속도 ×1.4',
  },
  ironwall: {
    id: 'ironwall', name: '철벽 각성', cost: 80, spiritCost: 30, uses: 1, kind: 'timed',
    durationSeconds: 8, effect: { damageTakenMult: 0.6 }, desc: '8초 동안 받는 피해 −40%',
  },
  sixth_sense: {
    id: 'sixth_sense', name: '직감 각성', cost: 70, spiritCost: 20, uses: 2, kind: 'timed',
    durationSeconds: 8, effect: { dodgeBonus: 0.2 }, desc: '8초 동안 회피 +20%p',
  },
  recover: {
    id: 'recover', name: '재기 각성', cost: 100, spiritCost: 30, uses: 1, kind: 'instant',
    effect: { healHpPct: 0.15 }, desc: '기체 체력 +15%',
  },
  focus: {
    id: 'focus', name: '집중 각성', cost: 70, spiritCost: 20, uses: 2, kind: 'timed',
    durationSeconds: 10, effect: { cooldownMult: 0.7 }, desc: '10초 동안 쿨다운 −30%',
  },
  unyielding: {
    id: 'unyielding', name: '불굴 각성', cost: 120, spiritCost: 40, uses: 1, kind: 'passive',
    effect: { negateLethalOnce: true, leaveHp: 1 }, desc: '패시브: 체력이 0이 되는 피해를 1회 무효(체력 1 유지)',
  },
});

export const PILOT_SKILL_IDS = Object.freeze(Object.keys(PILOT_SKILLS));

export function getPilotSkill(id) {
  const s = PILOT_SKILLS[id];
  if (!s) throw new Error(`알 수 없는 각성기: ${id}`);
  return s;
}

// 조종사 정보의 기본 형태 (설계 데이터에 들어가는 pilot 필드)
export function emptyPilot() {
  return { name: '조종사', temperament: 'composed', skills: [] };
}

// 각성기 목록의 총 비용 (기체 예산에 합산)
export function pilotSkillsCost(skillIds) {
  return skillIds.reduce((sum, id) => sum + getPilotSkill(id).cost, 0);
}

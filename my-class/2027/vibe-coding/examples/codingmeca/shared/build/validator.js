// shared/build/validator.js  (18번)
// 설계 검증. 저장·출전 등록·서버 대전 시작 전에 같은 함수를 씁니다(서버가 최종 판정).
// 결과 항목: { level: 'error'|'warning', code, uid, message }
//   error   → 저장은 가능하나 출전 불가(또는 저장 불가: 구조가 깨진 경우)
//   warning → 출전은 가능하나 알려줄 것
// 화면 코드를 import하지 않습니다.

import { buildTree, DEFAULT_CTX } from './assembly.js';
import { layoutTree, overlappingUids } from './layout.js';
import { computeStatsFromTree } from './stats.js';
import { PILOT_SKILLS, TEMPERAMENTS } from '../../data/pilot-skills.js';
import { findForbidden } from '../../config/names.js';

const item = (level, code, message, uid = null) => ({ level, code, uid, message });

// 구조가 깨져 저장도 막아야 하는 오류 코드
export const STRUCTURAL_CODES = Object.freeze([
  'no_core', 'multiple_core', 'core_has_parent', 'duplicate_uid', 'unknown_part', 'missing_parent',
  'bad_slot', 'slot_size', 'slot_occupied', 'orphan', 'too_many_parts',
]);

/**
 * 설계 검증.
 * opts: { limits: { weightCap, budget, pilotSkillSlots }, ctx, form }
 * 반환: { ok(출전 가능), saveable(저장 가능), errors, warnings, stats, tree, layout }
 */
export function validateDesign(design, opts = {}) {
  const ctx = opts.ctx || DEFAULT_CTX;
  const limits = { ...ctx.constants.limits, ...(opts.limits || {}) };
  const out = [];

  // 이름
  const name = String(design?.name ?? '').trim();
  if (!name) out.push(item('error', 'no_name', '기체 이름을 입력하세요'));
  if (name.length > ctx.constants.assembly.maxDesignNameLength) {
    out.push(item('error', 'name_too_long', `기체 이름은 ${ctx.constants.assembly.maxDesignNameLength}자 이하여야 합니다`));
  }
  if (findForbidden(name).length) out.push(item('error', 'forbidden_word', '사용할 수 없는 단어가 들어 있습니다'));

  // 구조
  const tree = buildTree(design, ctx);
  out.push(...tree.errors);

  // 조종사
  const pilot = design?.pilot || {};
  if (pilot.temperament && !TEMPERAMENTS[pilot.temperament]) {
    out.push(item('error', 'bad_temperament', `알 수 없는 성향: ${pilot.temperament}`));
  }
  const skills = pilot.skills || [];
  if (skills.length > limits.pilotSkillSlots) {
    out.push(item('error', 'too_many_skills', `각성기는 ${limits.pilotSkillSlots}개까지 장착할 수 있습니다`));
  }
  if (new Set(skills).size !== skills.length) out.push(item('error', 'duplicate_skill', '같은 각성기를 두 번 장착할 수 없습니다'));
  for (const id of skills) {
    if (!PILOT_SKILLS[id]) out.push(item('error', 'unknown_skill', `알 수 없는 각성기: ${id}`));
  }
  if (findForbidden(pilot.name).length) out.push(item('error', 'forbidden_word', '조종사 이름에 사용할 수 없는 단어가 들어 있습니다'));

  const structural = out.some((e) => e.level === 'error' && STRUCTURAL_CODES.includes(e.code));
  let stats = null;
  let layout = null;

  if (tree.root) {
    layout = layoutTree(tree, ctx);
    // 겹침
    const bad = overlappingUids(layout);
    for (const o of layout.overlaps) {
      const an = tree.nodes.get(o.a)?.def.name;
      const bn = tree.nodes.get(o.b)?.def.name;
      out.push(item('error', 'overlap', `${an}와(과) ${bn}이(가) 겹칩니다`, o.a));
    }
    stats = computeStatsFromTree(tree, { pilot, layout, form: opts.form || 'A' });

    // 한도
    if (stats.weight > limits.weightCap) {
      out.push(item('error', 'over_weight', `총무게 ${stats.weight}이(가) 상한 ${limits.weightCap}을(를) 넘었습니다`));
    }
    if (stats.cost > limits.budget) {
      out.push(item('error', 'over_budget', `총비용 ${stats.cost}이(가) 예산 ${limits.budget}을(를) 넘었습니다`));
    }

    // 경고
    for (const uid of stats.unpowered) {
      const n = tree.nodes.get(uid);
      if (n.def.category === 'structure' || n.def.category === 'core') continue;
      out.push(item('warning', 'unpowered', `${n.def.name}에 전력이 닿지 않습니다 (전력 중계 케이블이 필요합니다)`, uid));
    }
    if (!stats.move.canMove) out.push(item('warning', 'no_mobility', '이동 기관이 없어 움직일 수 없습니다'));
    if (stats.weapons.length === 0) out.push(item('warning', 'no_weapon', '무기가 없습니다'));
    if (stats.power.peakDraw > stats.power.output) {
      out.push(item('warning', 'power_short', `최대 소모(${stats.power.peakDraw})가 출력(${stats.power.output})보다 커서 성능이 떨어질 수 있습니다`));
    }
    void bad;
  }

  const errors = out.filter((e) => e.level === 'error');
  const warnings = out.filter((e) => e.level === 'warning');
  return { ok: errors.length === 0, saveable: !structural, errors, warnings, stats, tree, layout };
}

// 출전 등록 직전 검사: 설계 + 한도. 실패 사유를 사람이 읽는 한 줄 목록으로 돌려준다.
export function rosterCheck(design, limits, ctx = DEFAULT_CTX) {
  const r = validateDesign(design, { limits, ctx });
  return { ok: r.ok, reasons: r.errors.map((e) => e.message) };
}

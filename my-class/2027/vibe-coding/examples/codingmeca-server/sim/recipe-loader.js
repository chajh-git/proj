// server/sim/recipe-loader.js  (79번)
// 융합·변신 레시피 읽기와 검사. 레시피는 이 비공개 서버에만 있다. (명세 3-1, 12-3, 12-4)
//   · 기본 레시피: private/recipes.default.json (이 저장소에만 존재)
//   · 지휘관 비밀 레시피: Supabase recipes_secret 테이블 (같은 ID면 기본 레시피를 덮어쓴다)
//   · 판정 순서: 지휘관 비밀 레시피가 먼저, 그다음 기본 레시피를 ID 순으로 (12-3)
//
//   const loader = createRecipeLoader({ db });  await loader.load();
//   loader.recipes   // 판정에 쓸 정렬된 레시피 배열
//   loader.errors    // 검사에서 걸러진 레시피 사유 목록(지휘관에게 보여 줄 수 있다)

import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { TAG_IDS } from '#data/tags.js';
import { CONSTANTS } from '#config/constants.js';

const DEFAULT_PATH = fileURLToPath(new URL('../private/recipes.default.json', import.meta.url));
const num = (v, d) => (Number.isFinite(Number(v)) ? Number(v) : d);
const rangePair = (v, lo, hi) => {
  const a = Array.isArray(v) && v.length === 2 ? v : [lo, hi];
  return [Math.max(lo, num(a[0], lo)), Math.min(hi, num(a[1], hi))];
};

// 자연 정렬용 ID 키 (R2 < R10)
const idKey = (id) => String(id).replace(/\d+/g, (d) => d.padStart(6, '0'));

/** 레시피 한 개를 검사하고 기본값을 채운다 → { recipe, errors } (errors가 있으면 recipe는 null) */
export function normalizeRecipe(raw, C = CONSTANTS) {
  const errors = [];
  const id = String(raw?.id ?? '').trim();
  if (!id) errors.push('ID가 없습니다');
  const kind = raw?.kind === 'awaken' ? 'awaken' : raw?.kind === 'fusion' ? 'fusion' : null;
  if (!kind) errors.push('종류는 fusion 또는 awaken 이어야 합니다');

  // 구성원 수: 숫자 또는 [최소, 최대]
  let [minM, maxM] = Array.isArray(raw?.members) ? [num(raw.members[0], 1), num(raw.members[1], 1)] : [num(raw?.members, 1), num(raw?.members, 1)];
  minM = Math.round(minM); maxM = Math.round(maxM);
  if (kind === 'awaken') { minM = 1; maxM = 1; }
  if (minM < 1 || maxM > C.match.maxTeamSize || minM > maxM) errors.push(`구성원 수는 1~${C.match.maxTeamSize}`);
  if (kind === 'fusion' && minM < 2) errors.push('융합은 구성원이 2기 이상이어야 합니다');

  // 구성원 조건: 1개면 모든 구성원에 적용, 아니면 자리별
  const mc = Array.isArray(raw?.memberConditions) && raw.memberConditions.length ? raw.memberConditions : [{}];
  if (mc.length !== 1 && (mc.length < maxM && mc.length !== minM)) errors.push('구성원 조건 개수가 구성원 수와 맞지 않습니다');
  const memberConditions = mc.map((c) => {
    const tags = {};
    for (const [t, n] of Object.entries(c.tags || {})) {
      if (!TAG_IDS.includes(t)) { errors.push(`알 수 없는 태그: ${t}`); continue; }
      tags[t] = Math.max(0, Math.round(num(n, 0)));
    }
    const form = ['A', 'B', 'any'].includes(c.form) ? c.form : 'any';
    return { tags, form, requiredParts: Array.isArray(c.requiredParts) ? c.requiredParts.map(String) : [], hpRange: rangePair(c.hpRange, 0, 1) };
  });

  const cm = raw?.common || {};
  const common = {
    spiritMin: num(cm.spiritMin, 0),
    gaugeMin: num(cm.gaugeMin, 0),
    distanceMax: num(cm.distanceMax, 999),
    mapIds: Array.isArray(cm.mapIds) ? cm.mapIds.map(String) : [],
    signalWindowSeconds: num(cm.signalWindowSeconds, C.fusion.signalWindowSeconds),
    requireSignal: Boolean(cm.requireSignal),
  };

  const rs = raw?.result || {};
  const result = {
    hpMult: num(rs.hpMult, 1), attackMult: num(rs.attackMult, 1), speedMult: num(rs.speedMult, 1),
    reduceMult: num(rs.reduceMult, 1), cooldownMult: num(rs.cooldownMult, 1),
    grants: Array.isArray(rs.grants) ? rs.grants.map(String) : [],
    appearancePreset: String(rs.appearancePreset || ''),
    cinematicId: String(rs.cinematicId || (kind === 'awaken' ? 'awaken_common' : 'fusion_common')),
    durationSeconds: Math.max(3, num(rs.durationSeconds, 15)),
    endEnergyZero: Boolean(rs.endEnergyZero),
  };
  for (const k of ['hpMult', 'attackMult', 'speedMult', 'reduceMult', 'cooldownMult']) {
    if (result[k] <= 0 || result[k] > 5) errors.push(`${k}는 0 초과 5 이하`);
  }
  if (errors.length) return { recipe: null, errors: errors.map((e) => `${id || '(ID 없음)'}: ${e}`) };
  return {
    recipe: { id, name: String(raw.name || id), kind, minMembers: minM, maxMembers: maxM, memberConditions, common, result, codexPublic: Boolean(raw.codexPublic) },
    errors: [],
  };
}

export async function loadDefaultRecipes(path = DEFAULT_PATH) {
  const json = JSON.parse(await readFile(path, 'utf8'));
  return json.recipes || [];
}

/** 정렬: 지휘관 비밀(주어진 순서가 아닌 ID 순) → 기본(ID 순). 같은 ID는 비밀이 기본을 덮어쓴다 */
export function mergeRecipes(secretList, defaultList) {
  const secretIds = new Set(secretList.map((r) => r.id));
  const byId = (a, b) => (idKey(a.id) < idKey(b.id) ? -1 : 1);
  return [...[...secretList].sort(byId), ...defaultList.filter((r) => !secretIds.has(r.id)).sort(byId)];
}

export function createRecipeLoader({ db = null, defaultPath = DEFAULT_PATH, constants = CONSTANTS, log = console } = {}) {
  const state = { recipes: [], errors: [], loadedAt: 0 };
  return {
    get recipes() { return state.recipes; },
    get errors() { return state.errors; },
    get loadedAt() { return state.loadedAt; },
    async load() {
      const errors = [];
      const take = (list, from) => list.flatMap((raw) => {
        const { recipe, errors: e } = normalizeRecipe(raw, constants);
        errors.push(...e.map((m) => `[${from}] ${m}`));
        return recipe ? [recipe] : [];
      });
      let defaults = [];
      try { defaults = take(await loadDefaultRecipes(defaultPath), '기본'); } catch (e) { errors.push(`[기본] 파일을 읽지 못했습니다: ${e.message}`); }
      let secret = [];
      try { secret = take((await db?.getSecretRecipes?.()) || [], '비밀'); } catch (e) { errors.push(`[비밀] DB에서 읽지 못했습니다: ${e.message}`); }
      state.recipes = mergeRecipes(secret, defaults);
      state.errors = errors;
      state.loadedAt = Date.now();
      if (errors.length) log.warn?.('레시피 검사 경고:', errors);
      return state.recipes;
    },
    byId: (id) => state.recipes.find((r) => r.id === id) || null,
  };
}

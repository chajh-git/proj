// config/sound-manifest.js
// 사운드 이벤트 ↔ 소리 원본 매핑입니다. (명세 14-5)
//
// 각 이벤트는 다음 형태입니다.
//   { synth: '프리셋명', channel, volume, loop?, src?, srcVolume? }
//
// ● 프로토타입(지금): src가 모두 null → web/core/audio/synth-presets.js의 합성음(WebAudio)을 씁니다.
// ● 완성본: 원하는 이벤트의 src에 'assets/audio/…' 경로를 적기만 하면 음원 파일로 바뀝니다.
//   파일을 불러오지 못하면 자동으로 synth 합성음으로 대체됩니다. (synth는 지우지 마세요)
//
// channel: 'ambient'(공간 루프) | 'sfx'(효과음) | 'ui' | 'music'
// volume: 0~1 (합성음 기준), srcVolume: 음원 파일 사용 시 볼륨(생략하면 volume)

export const SOUND_MODE = 'auto'; // 'auto'(src 있으면 파일) | 'synth'(항상 합성음) | 'file'(항상 파일, 실패 시 합성음)

export const CHANNELS = Object.freeze({
  ambient: { label: '앰비언트', volume: 0.5 },
  sfx: { label: '효과음', volume: 0.8 },
  ui: { label: 'UI', volume: 0.6 },
  music: { label: '음악', volume: 0.5 },
});

export const AUDIO_ROOT = 'assets/audio/';

const ev = (synth, channel, volume, extra = {}) => ({ synth, channel, volume, src: null, ...extra });

export const SOUND_MANIFEST = Object.freeze({
  // ── 공간 앰비언트(루프) ─────────────────────────────────
  amb_hangar: ev('ambHangar', 'ambient', 0.5, { loop: true }), // 저역 기계 험, 간헐 금속 타격, 증기, 크레인 모터
  amb_lab: ev('ambLab', 'ambient', 0.45, { loop: true }), // 저역 드론 + 고음 전자 아르페지오
  amb_range: ev('ambRange', 'ambient', 0.4, { loop: true }), // 바람, 원거리 전자음
  amb_arena: ev('ambArena', 'ambient', 0.5, { loop: true }), // 군중 웅성, 비트
  amb_command: ev('ambCommand', 'ambient', 0.3, { loop: true }), // 조용한 컴퓨터 beep, 레이더 ping

  // ── UI ─────────────────────────────────────────────────
  ui_enter: ev('uiEnter', 'ui', 0.7), // 입장 버튼
  ui_click: ev('uiClick', 'ui', 0.5),
  ui_hover: ev('uiHover', 'ui', 0.25),
  ui_error: ev('uiError', 'ui', 0.6),
  ui_save: ev('uiSave', 'ui', 0.6),
  ui_space_change: ev('uiWhoosh', 'ui', 0.5),
  card_place: ev('cardPlace', 'ui', 0.6),
  card_remove: ev('cardRemove', 'ui', 0.5),
  link_chime: ev('linkChime', 'ui', 0.5), // 신경선(태세 전환) 연결

  // ── 조립(격납고) ────────────────────────────────────────
  part_pick: ev('partPick', 'sfx', 0.5),
  part_attach: ev('partAttach', 'sfx', 0.8), // 철컥
  part_detach: ev('partDetach', 'sfx', 0.6),
  part_invalid: ev('partInvalid', 'sfx', 0.6),
  crane_move: ev('craneMove', 'sfx', 0.35),
  weld_spark: ev('weldSpark', 'sfx', 0.3),
  steam_vent: ev('steamVent', 'sfx', 0.3),

  // ── 전투: 피격·파손 ─────────────────────────────────────
  hit_light: ev('hitLight', 'sfx', 0.6),
  hit_heavy: ev('hitHeavy', 'sfx', 0.85),
  part_break: ev('partBreak', 'sfx', 0.8), // 파손(기능 정지)
  part_detach_boom: ev('partDetachBoom', 'sfx', 0.9), // 이탈 폭발
  robot_collide: ev('robotCollide', 'sfx', 0.7),
  ko: ev('koBoom', 'sfx', 1.0),
  poison_tick: ev('poisonTick', 'sfx', 0.3),

  // ── 전투: 무기 ──────────────────────────────────────────
  wp_claw: ev('wpClaw', 'sfx', 0.6),
  wp_fang: ev('wpFang', 'sfx', 0.65),
  wp_tail: ev('wpTail', 'sfx', 0.65),
  wp_spin_h: ev('wpSpin', 'sfx', 0.5, { loop: true }),
  wp_hammer: ev('wpHammer', 'sfx', 0.85),
  wp_lift: ev('wpLift', 'sfx', 0.6),
  wp_spin_v: ev('wpSpinHeavy', 'sfx', 0.6, { loop: true }),
  wp_plasma: ev('wpPlasma', 'sfx', 0.5),
  wp_missile_launch: ev('wpMissileLaunch', 'sfx', 0.7),
  missile_explode: ev('missileExplode', 'sfx', 0.85),
  wp_stun: ev('wpStun', 'sfx', 0.65),
  wp_breath: ev('wpBreath', 'sfx', 0.75),
  wp_laser: ev('wpLaser', 'sfx', 0.7),
  wp_emp: ev('wpEmp', 'sfx', 0.8),
  wp_grav: ev('wpGrav', 'sfx', 0.8),
  wp_rail_charge: ev('wpRailCharge', 'sfx', 0.7),
  wp_rail_fire: ev('wpRailFire', 'sfx', 1.0),
  wp_nano: ev('wpNano', 'sfx', 0.6),

  // ── 전투: 방어·특수 ─────────────────────────────────────
  shield_on: ev('shieldOn', 'sfx', 0.5),
  shield_hit: ev('shieldHit', 'sfx', 0.55),
  shield_break: ev('shieldBreak', 'sfx', 0.8),
  intercept: ev('intercept', 'sfx', 0.6),
  repair_loop: ev('repairLoop', 'sfx', 0.3, { loop: true }),
  phase_shift: ev('phaseShift', 'sfx', 0.7),
  revive: ev('revive', 'sfx', 0.9), // 재생 코어 부활
  awaken_skill: ev('awakenSkill', 'sfx', 0.7), // 각성기 발동
  stealth_on: ev('stealthOn', 'sfx', 0.4),

  // ── 변신·오버드라이브 ───────────────────────────────────
  transform: ev('transform', 'sfx', 0.8), // 기어 소리 + 빛 라인
  overdrive_cutin: ev('overdriveCutin', 'sfx', 0.9),
  overdrive_fire: ev('overdriveFire', 'sfx', 1.0),
  slowmo_in: ev('slowmoIn', 'sfx', 0.6),
  slowmo_out: ev('slowmoOut', 'sfx', 0.6),

  // ── 융합 연출(8초 템플릿): 단계별 이벤트 ─────────────────
  fusion_blackout: ev('fusionBlackout', 'sfx', 0.9), // 전체 정지·암전
  fusion_disperse: ev('fusionDisperse', 'sfx', 0.8), // 파츠 빛 입자 분해
  fusion_vortex: ev('fusionVortex', 'sfx', 0.9), // 중앙 소용돌이
  fusion_assemble: ev('fusionAssemble', 'sfx', 0.9), // 재조립
  fusion_shockwave: ev('fusionShockwave', 'sfx', 1.0), // 충격파·글리프
  fusion_title: ev('fusionTitle', 'sfx', 0.8), // 타이틀 자막
  fusion_new_codex: ev('fusionNewCodex', 'ui', 0.8), // 첫 발견 NEW (2차)

  // ── 경기 흐름 ───────────────────────────────────────────
  countdown_tick: ev('countdownTick', 'ui', 0.7),
  countdown_go: ev('countdownGo', 'ui', 0.9),
  match_start: ev('matchStart', 'sfx', 0.9),
  match_end: ev('matchEnd', 'sfx', 0.9),
  victory: ev('victory', 'music', 0.8),
  defeat: ev('defeat', 'music', 0.7),
  draw: ev('drawGame', 'music', 0.6),
  hazard_warn: ev('hazardWarn', 'sfx', 0.6), // 함정·운석·EMP 폭풍 예고
  hazard_hit: ev('hazardHit', 'sfx', 0.8),
  crowd_cheer: ev('crowdCheer', 'ambient', 0.6),

  // ── 지휘 본부·관제 ──────────────────────────────────────
  radar_ping: ev('radarPing', 'sfx', 0.3),
  scoreboard_update: ev('scoreboardUpdate', 'ui', 0.5),
});

// 합성음 프리셋 이름의 목록(= web/core/audio/synth-presets.js가 구현해야 할 항목)
export const REQUIRED_SYNTH_PRESETS = Object.freeze(
  [...new Set(Object.values(SOUND_MANIFEST).map((e) => e.synth))].sort(),
);

// 이벤트 ID로 재생 정보를 해석합니다. 오버라이드(조율 센터 등)가 있으면 덮어씁니다.
export function resolveSound(eventId, overrides = {}) {
  const base = SOUND_MANIFEST[eventId];
  if (!base) return null;
  const e = { ...base, ...(overrides[eventId] || {}) };
  const useFile =
    SOUND_MODE === 'synth' ? false : Boolean(e.src) && (SOUND_MODE === 'auto' || SOUND_MODE === 'file');
  return {
    eventId,
    channel: e.channel,
    loop: Boolean(e.loop),
    synth: e.synth,
    src: useFile ? (e.src.startsWith('http') || e.src.startsWith(AUDIO_ROOT) ? e.src : AUDIO_ROOT + e.src) : null,
    volume: useFile ? (e.srcVolume ?? e.volume) : e.volume,
  };
}

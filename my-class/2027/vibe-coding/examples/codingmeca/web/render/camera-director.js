// web/render/camera-director.js  (44번)
// 카메라 연출: 경기 관람(전체 조망·추적·대결 구도), 격납고·연구소의 턴테이블, 사용자 자유 시점,
// 그리고 사건(격파·오버드라이브·융합 등)에 반응하는 자동 감독. (명세 v1.0 14장)
// 화면(three) 객체는 camera 하나만 만지며, 위치·시선은 목표값을 부드럽게 따라간다.
//
//   const dir = createCameraDirector({ camera, arena: { halfW, halfD } });
//   dir.setMode('overview');                       // 'overview' | 'follow' | 'duel' | 'turntable' | 'free'
//   dir.update(dt, entities);                      // entities: [{ id, x, z, h, alive, alt }] (보간된 스냅샷의 ents)
//   dir.onEvent(ev, entities);                     // 서버 사건에 반응: 흔들림·집중 연출
//   dir.focus({ id | point:{x,y,z}, seconds, distance }) // 잠깐 한 곳을 비춘 뒤 원래 모드로 복귀

const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
const damp = (k, dt) => 1 - Math.exp(-k * dt);
const lerp = (a, b, t) => a + (b - a) * t;
const wrap = (a) => Math.atan2(Math.sin(a), Math.cos(a));

// 흔들림용 결정적 잡음(시간의 사인 합) — 시뮬레이션과 무관한 화면 연출
const noise = (t, seed) => Math.sin(t * 37.1 + seed) * 0.6 + Math.sin(t * 61.7 + seed * 1.7) * 0.4;

const HEIGHT = 1.6; // 기체를 바라보는 높이(m)

export const DIRECTOR_DEFAULTS = Object.freeze({
  pitch: 0.62, // 전체 조망 기울기(rad)
  fov: 50,
  autoYawSpeed: 0.05, // 전체 조망에서 천천히 도는 속도(rad/s). 0이면 고정
  minDistance: 16,
  followDistance: 11,
  followPitch: 0.42,
  damping: 3.2, // 위치 추종 속도
  lookDamping: 5,
});

export function createCameraDirector({ camera, arena = { halfW: 20, halfD: 20 }, options = {} }) {
  const O = { ...DIRECTOR_DEFAULTS, ...options };
  let mode = 'overview';
  let auto = true; // 사건 반응 켜기/끄기
  let arenaSize = { ...arena };

  // 현재(부드럽게 움직이는) 카메라 상태
  const cur = { px: 0, py: 18, pz: 26, tx: 0, ty: 0, tz: 0, fov: O.fov };
  let hasPose = false;

  // 모드 변수
  const orbit = { yaw: 0, pitch: O.pitch, dist: 30, userYawVelocity: 0 };
  const follow = { id: null };
  const duel = { a: null, b: null };
  const turntable = { center: { x: 0, y: 1, z: 0 }, radius: 8, height: 3.5, speed: 0.35, yaw: 0.6, fovBase: 42 };
  let free = { yaw: 0.4, pitch: 0.55, dist: 34, target: { x: 0, y: 0, z: 0 } };

  // 임시 연출
  let focusState = null; // { id?, point?, until, distance, yawOffset, fov }
  let trauma = 0; // 0~1, 제곱으로 흔들림
  let fovKick = 0;
  let time = 0;

  const alive = (ents) => ents.filter((e) => e.alive);
  const byId = (ents, id) => ents.find((e) => e.id === id) || null;

  // 기체들을 모두 담는 거리 계산
  function frameEntities(list) {
    if (!list.length) return { x: 0, z: 0, spread: 0 };
    let cx = 0;
    let cz = 0;
    for (const e of list) { cx += e.x; cz += e.z; }
    cx /= list.length;
    cz /= list.length;
    let spread = 0;
    for (const e of list) spread = Math.max(spread, Math.hypot(e.x - cx, e.z - cz));
    return { x: cx, z: cz, spread };
  }

  function desiredPose(ents, dt) {
    // 임시 집중이 있으면 우선
    if (focusState) {
      if (time >= focusState.until) focusState = null;
      else {
        const e = focusState.id ? byId(ents, focusState.id) : null;
        const p = e ? { x: e.x, y: HEIGHT, z: e.z } : focusState.point;
        if (p) {
          const yaw = (e ? -e.h : 0) + focusState.yawOffset;
          const d = focusState.distance;
          return {
            tx: p.x, ty: p.y ?? HEIGHT, tz: p.z,
            px: p.x + Math.sin(yaw) * d * Math.cos(0.3), py: (p.y ?? HEIGHT) + Math.sin(0.3) * d + 1, pz: p.z + Math.cos(yaw) * d * Math.cos(0.3),
            fov: focusState.fov ?? O.fov - 8,
          };
        }
      }
    }

    switch (mode) {
      case 'turntable': {
        turntable.yaw += turntable.speed * dt;
        const c = turntable.center;
        return {
          tx: c.x, ty: c.y, tz: c.z,
          px: c.x + Math.sin(turntable.yaw) * turntable.radius, py: c.y + turntable.height, pz: c.z + Math.cos(turntable.yaw) * turntable.radius,
          fov: turntable.fovBase,
        };
      }
      case 'free': {
        const f = free;
        return {
          tx: f.target.x, ty: f.target.y, tz: f.target.z,
          px: f.target.x + Math.sin(f.yaw) * Math.cos(f.pitch) * f.dist, py: f.target.y + Math.sin(f.pitch) * f.dist, pz: f.target.z + Math.cos(f.yaw) * Math.cos(f.pitch) * f.dist,
          fov: O.fov,
        };
      }
      case 'follow': {
        const e = byId(ents, follow.id) || alive(ents)[0];
        if (!e) break;
        // 기체의 뒤쪽 위에서, 가장 가까운 적 쪽을 함께 바라본다
        const foes = alive(ents).filter((o) => o.id !== e.id && o.team !== e.team);
        let aimX = e.x - Math.sin(e.h) * 6;
        let aimZ = e.z - Math.cos(e.h) * 6;
        if (foes.length) {
          const n = foes.reduce((b, o) => (Math.hypot(o.x - e.x, o.z - e.z) < Math.hypot(b.x - e.x, b.z - e.z) ? o : b));
          aimX = lerp(e.x, n.x, 0.45);
          aimZ = lerp(e.z, n.z, 0.45);
        }
        const dx = aimX - e.x;
        const dz = aimZ - e.z;
        const l = Math.hypot(dx, dz) || 1;
        const d = O.followDistance;
        return {
          tx: aimX, ty: HEIGHT, tz: aimZ,
          px: e.x - (dx / l) * d * Math.cos(O.followPitch), py: Math.sin(O.followPitch) * d + 2, pz: e.z - (dz / l) * d * Math.cos(O.followPitch),
          fov: O.fov,
        };
      }
      case 'duel': {
        const a = byId(ents, duel.a);
        const b = byId(ents, duel.b);
        if (a && b) {
          const mx = (a.x + b.x) / 2;
          const mz = (a.z + b.z) / 2;
          const sep = Math.hypot(a.x - b.x, a.z - b.z);
          // 두 기체를 잇는 선의 옆에서 본다
          const ang = Math.atan2(b.x - a.x, b.z - a.z) + Math.PI / 2;
          const d = clamp(sep * 0.9 + 10, 14, 44);
          return {
            tx: mx, ty: HEIGHT, tz: mz,
            px: mx + Math.sin(ang) * d * Math.cos(0.45), py: Math.sin(0.45) * d + 1.5, pz: mz + Math.cos(ang) * d * Math.cos(0.45),
            fov: O.fov,
          };
        }
        break;
      }
      default: break;
    }

    // overview (기본)
    const list = alive(ents);
    const f = frameEntities(list.length ? list : ents);
    orbit.yaw += O.autoYawSpeed * dt;
    const need = Math.max(O.minDistance, f.spread * 2.6 + 12);
    const dist = Math.min(need, Math.max(arenaSize.halfW, arenaSize.halfD) * 2.4 + 10);
    return {
      tx: f.x, ty: 0.6, tz: f.z,
      px: f.x + Math.sin(orbit.yaw) * Math.cos(orbit.pitch) * dist, py: Math.sin(orbit.pitch) * dist, pz: f.z + Math.cos(orbit.yaw) * Math.cos(orbit.pitch) * dist,
      fov: O.fov,
    };
  }

  const api = {
    get mode() { return mode; },
    get shaking() { return trauma > 0.01; },
    get focusing() { return focusState !== null; },

    setMode(m, opts = {}) {
      mode = m;
      if (m === 'follow') follow.id = opts.id ?? follow.id;
      if (m === 'duel') { duel.a = opts.a ?? duel.a; duel.b = opts.b ?? duel.b; }
      if (m === 'turntable') Object.assign(turntable, opts);
      if (m === 'free') free = { ...free, ...opts };
      return api;
    },
    setArena(a) { arenaSize = { ...a }; },
    setAuto(v) { auto = Boolean(v); },

    // 자유 시점 조작: 마우스 드래그·휠에서 호출
    orbitBy(dyaw, dpitch) {
      if (mode !== 'free') {
        // 다른 모드에서 드래그하면 지금 시점에서 자유 시점으로 넘어간다
        const dx = cur.px - cur.tx;
        const dz = cur.pz - cur.tz;
        const dy = cur.py - cur.ty;
        free = { yaw: Math.atan2(dx, dz), pitch: Math.atan2(dy, Math.hypot(dx, dz)), dist: Math.hypot(dx, dy, dz), target: { x: cur.tx, y: cur.ty, z: cur.tz } };
        mode = 'free';
      }
      free.yaw += dyaw;
      free.pitch = clamp(free.pitch + dpitch, 0.08, 1.4);
    },
    zoomBy(factor) {
      if (mode === 'free') free.dist = clamp(free.dist * factor, 6, 90);
      else if (mode === 'turntable') turntable.radius = clamp(turntable.radius * factor, 3, 40);
    },

    // 잠깐 한 곳을 비춘다
    focus({ id = null, point = null, seconds = 1.5, distance = 9, yawOffset = 0.6, fov = null } = {}) {
      focusState = { id, point, until: time + seconds, distance, yawOffset, fov };
    },
    clearFocus() { focusState = null; },

    shake(amount = 0.4) { trauma = Math.min(1, trauma + amount); },
    kickFov(deg) { fovKick = Math.max(fovKick, deg); },

    // 서버 사건에 반응 (auto가 꺼져 있으면 흔들림만)
    onEvent(ev, ents = []) {
      switch (ev.type) {
        case 'hit': if ((ev.amount || 0) >= 60) api.shake(0.18); break;
        case 'ram': api.shake(clamp((ev.speed - 4) * 0.05 + 0.15, 0.15, 0.5)); break;
        case 'rail': api.shake(0.6); break;
        case 'meteor_impact': api.shake(0.55); break;
        case 'part_lost': api.shake(0.2); break;
        case 'emp': api.shake(0.25); break;
        case 'ko':
          api.shake(0.7);
          if (auto) api.focus({ id: ev.entity, seconds: 1.8, distance: 10 });
          break;
        case 'overdrive':
          api.shake(0.3);
          api.kickFov(8);
          if (auto) api.focus({ id: ev.entity, seconds: 1.4, distance: 8 });
          break;
        case 'fusion_start':
          if (auto) {
            const members = (ev.members || []).map((id) => byId(ents, id)).filter(Boolean);
            const f = frameEntities(members);
            api.focus({ point: { x: f.x, y: HEIGHT, z: f.z }, seconds: ev.seconds || 6, distance: 14 + f.spread });
          }
          break;
        case 'end':
          if (auto) {
            const w = ents.filter((e) => e.team === ev.winner && e.alive);
            if (w.length) api.focus({ id: w[0].id, seconds: 4, distance: 12 });
          }
          break;
        default: break;
      }
    },

    // 매 프레임: 목표 자세 계산 → 부드럽게 따라가기 → 카메라에 적용
    update(dt, ents = []) {
      time += dt;
      const want = desiredPose(ents, dt);
      if (!hasPose) {
        Object.assign(cur, want);
        hasPose = true;
      }
      const kp = damp(focusState ? O.damping * 1.8 : O.damping, dt);
      const kl = damp(O.lookDamping, dt);
      cur.px += (want.px - cur.px) * kp;
      cur.py += (want.py - cur.py) * kp;
      cur.pz += (want.pz - cur.pz) * kp;
      cur.tx += (want.tx - cur.tx) * kl;
      cur.ty += (want.ty - cur.ty) * kl;
      cur.tz += (want.tz - cur.tz) * kl;
      cur.fov += (want.fov - cur.fov) * damp(4, dt);

      // 흔들림: 위치와 시선을 함께 살짝 움직인다
      trauma = Math.max(0, trauma - dt * 1.6);
      fovKick = Math.max(0, fovKick - dt * 14);
      const s = trauma * trauma;
      const sx = noise(time, 1) * s * 0.7;
      const sy = noise(time, 2) * s * 0.7;
      const sz = noise(time, 3) * s * 0.7;
      camera.position.set(cur.px + sx, cur.py + sy, cur.pz + sz);
      camera.lookAt(cur.tx + sx * 0.4, cur.ty + sy * 0.4, cur.tz + sz * 0.4);
      const fov = cur.fov + fovKick;
      if (Math.abs(camera.fov - fov) > 0.01) {
        camera.fov = fov;
        camera.updateProjectionMatrix();
      }
    },

    // 지금 시점 정보 (HUD·마우스 피킹용)
    pose: () => ({ ...cur }),
    reset() { hasPose = false; focusState = null; trauma = 0; fovKick = 0; },
    wrapAngle: wrap,
  };
  return api;
}

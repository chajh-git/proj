# 코딩메카

메카닉이 3D 격납고에서 기체를 자유롭게 조립하고, 신경 연산실에서 **전술 카드(태세·규칙)** 로 행동을 코딩해 출전시키면, 서버가 실시간 물리로 1~3 대 1~3 대전을 계산하고 관제 스크린이 3D로 중계하는 로봇 대전 게임입니다. 지휘관은 지휘 본부에서 리그·토너먼트·전장·숨은 융합 레시피를 운영하고, 조율 센터에서 밸런스 수치를 조정합니다.

전체 설계는 [`docs/코딩메카_알고리즘_v1.0.md`](docs/코딩메카_알고리즘_v1.0.md)가 기준입니다. 이 README는 구조와 작업 규칙만 다룹니다.

---

## 1. 저장소 구성

| 저장소 | 올리는 곳 | 내용 |
|---|---|---|
| `codingmeca` (공개) | GitHub Pages | `web/`, `shared/`, `config/`, `data/`, `assets/`, 진입 HTML (`index.html`, `hangar.html`, `arena.html`, `command.html`, `editor.html`) |
| `codingmeca-server` (비공개) | Render | `server/` 전체. 배포 때 `scripts/sync-shared.mjs`가 공개 저장소의 `shared/`, `config/`, `data/`를 복사해서 같은 계산 모듈을 씁니다 |
| Supabase | 클라우드 | 로그인, 설계·전술·리그·전적·도감 저장, 비밀 레시피 |

> **숨은 융합 레시피는 공개 저장소에 절대 넣지 않습니다.** `data/recipes.sample.json`은 형식을 보여주는 가짜 예시입니다. 실제 레시피는 Supabase `recipes_secret` 테이블 또는 비공개 서버 저장소에만 둡니다.

## 2. 폴더 구조

```
codingmeca/
├─ README.md
├─ docs/                  설계 명세
├─ config/                이름·수치·색감·사운드 (바꾸는 곳)
│   ├─ names.js           명칭 사전 (게임 제목 포함)
│   ├─ constants.js       시간·한도·공식 계수
│   ├─ theme.js           공간별 색감·조명·화질 프리셋
│   └─ sound-manifest.js  사운드 이벤트 ↔ 합성음/음원 매핑
├─ data/                  게임 데이터 (파츠·설계도·전장 등)
│   ├─ tags.js
│   ├─ parts.js
│   ├─ presets.js
│   ├─ pilot-skills.js
│   ├─ maps.js
│   └─ recipes.sample.json
├─ shared/                브라우저와 서버가 함께 쓰는 계산 (화면 코드 import 금지)
│   ├─ util/  build/  tactics/  sim/  balance/
├─ web/                   브라우저 쪽
│   ├─ core/  render/  scenes/  ui/  cinematics/
├─ editor/                조율 센터
└─ assets/
    ├─ audio/             음원 파일을 넣는 곳 (완성본)
    └─ models/            3D 모델 파일을 넣는 곳 (완성본)
```

## 3. 무엇을 어디서 바꾸나

| 바꾸고 싶은 것 | 파일 |
|---|---|
| 화면에 보이는 이름·용어·게임 제목 | `config/names.js` |
| 제한시간, 한도, 능력 공식 계수, 투지·게이지 값 | `config/constants.js` |
| 공간별 색감, 조명, 화질 단계 | `config/theme.js` |
| 소리 (합성음 ↔ 음원 파일) | `config/sound-manifest.js` |
| 파츠 수치·새 파츠 추가 | `data/parts.js` |
| 파츠 태그 | `data/tags.js` |
| 원형 설계도 | `data/presets.js` |
| 조종사 성향·각성기 | `data/pilot-skills.js` |
| 전장 규칙·새 전장 | `data/maps.js` |
| 3D 표현(도형 ↔ 모델 파일) | `web/render/part-view-adapter.js` 설정 |

수치는 조율 센터(`editor.html`)에서도 슬라이더로 바꿀 수 있고, 조율 센터의 저장값이 위 파일의 기본값을 덮어씁니다.

## 4. 작업 규칙

1. **계산(`shared/`)은 화면 코드를 import하지 않습니다.** 서버와 브라우저가 같은 모듈을 쓰기 때문입니다.
2. **3D 표현은 `PartViewAdapter`를 통해서만** 그립니다. 전투·조립 로직은 도형인지 모델 파일인지 모릅니다.
3. **이름은 `names.js`에서만**, **수치는 `constants.js`·`data/`에서만**, **색은 `theme.js`에서만**, **소리는 `sound-manifest.js`에서만** 바꿉니다.
4. 게임 안의 문구에는 `학생`, `교사`라는 표현을 쓰지 않습니다. 사용자는 **메카닉**, 관리자는 **지휘관**, 모둠은 **팀**입니다. (`names.js`의 `auditNames()`로 점검)
5. 파일은 기능별로 작게 나눕니다. 수정은 기능·파일 단위로 합니다.

## 5. 데이터 표기 요약

- **크기**: 내부 코드는 `S`/`M`/`L`, 화면 표기는 소/중/대. 파츠는 **같은 크기 이하**의 연결점에만 붙습니다 (대 연결점에 중·소 가능).
- **연결점 ID**: `부모uid.크기순번` (예: `core.중1`). 같은 크기 연결점은 전→후→좌→우→상→하 순으로 방향이 순환 배정됩니다.
- **조립 표기**: `파츠ID@부모.크기순번` 을 `;` 로 이어 씁니다. 첫 항목은 코어. 같은 파츠가 여러 개면 두 번째부터 uid가 `파츠ID#2`.
- **전력**: 코어까지 연결 경로 2단계(홉) 이하면 전력을 받고, 그보다 멀면 경로 중간에 전력 중계 케이블이 필요합니다.
- **태그**: `machine`(기계) `beast`(야수) `abyss`(심해) `flame`(화염) `thunder`(뇌전) `radiance`(광휘) `ancient`(고대) `space`(우주).

## 6. 로컬 실행

ES Modules를 쓰므로 `file://`로 열면 동작하지 않습니다. 정적 서버로 여세요.

```bash
cd codingmeca
python3 -m http.server 8000
# 브라우저에서 http://localhost:8000
```

Node 서버(비공개 저장소)는 `package.json`에 `"type": "module"`을 두어 같은 ES Module 파일을 그대로 읽습니다.

## 7. 배포 메모

- **GitHub Pages**: 공개 저장소의 main 브랜치 루트를 배포. 빌드 도구 없음. Three.js는 import map으로 버전을 고정해 CDN에서 불러옵니다.
- **Render**: 비공개 저장소를 연결해 Node 웹 서비스로 배포. 무료 플랜은 15분 무활동 시 잠들어 첫 접속에 30~50초가 걸립니다. 지휘 본부 접속 시 깨우기 요청을 보냅니다.
- **환경 변수(서버)**: `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`. **저장소에 넣지 않습니다.**
- **Supabase**: RLS를 켭니다 (설계·전술은 본인 소유 행만 읽기·쓰기, 지휘관은 전체, `recipes_secret`은 지휘관과 서버 키만).

## 8. 개발 진행 현황

전체 파일 목록과 번호는 명세 21장에 있습니다. 번호 순서로 작성합니다.

| 묶음 | 번호 | 상태 |
|---|---|---|
| A. 설정·데이터 | 1~11 | ✅ 작성 완료 |
| B. 공용 계산 | 12~35 ✅ 전부 (util 3, build 5, tactics 7, sim 9) | 완료 |
| C. 3D 렌더 | 36~44 ✅ 전부 | 완료 |
| D. 앱 코어 | 45~52 ✅ 전부 (+ `config/env.js`: 접속 주소 3칸) | 완료 |
| E. 공간 씬 | 53~57 ✅ 전부 (+ `web/scenes/scene-kit.js` 공통 도구) | 완료 |
| F. 메카닉 UI | 58~71 ✅ (+ `web/ui/dom.js`, `web/ui/tactics/labels.js`, `web/core/session.js` 보조) | — |
| G. 서버 | 72~84 | ✅ 완료 (비공개 저장소 `codingmeca-server`용, 별도 zip) |
| H. 데이터베이스 | 85~86 | ✅ 완료 (`supabase/schema.sql` → `policies.sql` 순서로 실행) |
| I. 관제·지휘 | 87~95 | ✅ 완료 (94번은 폐지) |
| J. 연출 | 96~100 | ✅ 완료 |
| K. 조율 센터 | 101~124 | ✅ 101~112 자동 화면·컴포넌트·서버 저장 · 113~124 패널 14개(전역·능력·코어·부품·적성·투지·교전·전술·전장·조종사·레시피·프리셋)와 분석(워커 일괄 실행·매치업 열지도) |

### 직접 조종(키보드·마우스) — 추가 기능

신경 연산실의 전술과 별개로, 시험 사격장·연습전·(허용한 리그의) 실제 전투에서 메카닉이 자기 기체를 직접 조종합니다. 켜 있는 동안 그 기체의 전술은 완전히 멈춥니다.

| 조작 | 키 |
|---|---|
| 이동·회전 | W/S(↑/↓) 전진·후진 · A/D(←/→) 회전 · 마우스로 조준(클릭하면 포인터 잠금, Esc 해제) |
| 공격·각성 | 좌클릭/Space(공격) · 우클릭/Shift(오버드라이브) |
| 방어 | Ctrl 방어막 · Alt 요격 · R 수리 (누르는 동안) |
| 특수 | Q 위상 이동 · E/F 각성기 1·2 · T 변신 · G 분리 · X/Z 고도 ↑↓ · C/V 겨냥 바꾸기·풀기(휠클릭도 겨냥 바꾸기) |

- 시점: 오버더숄더(기본) · 추적 · 전체를 조종 중에 고를 수 있습니다(`mode 'shoulder'`, `camera-director.js`).
- 모듈: `shared/tactics/manual.js`(입력→명령, 서버·브라우저 공용) · `web/core/manual-input.js`(키·마우스) · `web/core/manual-pilot.js`(조립) · `web/ui/manual-hud.js`(조준점·안내·시점 단추).
- 서버: `pilot` 메시지(`{match, on?, ent?, input?}` → `pilot_state`). 기체 주인만, 연습전은 항상, 리그는 설정 `manualControl`(지휘관이 리그 설정에서 켜기, 기본 꺼짐)일 때만. 입력은 서버가 `sanitizeInput`으로 다시 다듬고 초당 40개까지만 받습니다.
- 관제 화면(arena)에서는 내 기체가 있는 경기에 `직접 조종` 단추가 나타납니다. 조종 중에는 화면 지연을 0.15초로 줄입니다.
- 시험: `server/test/e2e-pilot.mjs`

### 알려진 임시 사항

- `data/presets.js`의 샘플 전술 어휘(조건·동작 이름)는 임시입니다. `shared/tactics/schema.js`(20번)에서 어휘를 확정할 때 함께 맞춥니다.
- `config/sound-manifest.js`가 요구하는 합성음 프리셋 이름 목록은 `REQUIRED_SYNTH_PRESETS`로 내보내집니다. `web/core/audio/synth-presets.js`(50번)가 이 목록을 모두 구현해야 합니다.
- 코딩 공간 이름은 `신경 연산실`입니다(`names.js`의 `tacticsLab`).

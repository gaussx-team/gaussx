# backend — NestJS + PostgreSQL

프론트 목업 API(`frontend/src/app/api`)와 **같은 계약**을 실제 DB 로 구현한 서버. API 목록은 [`docs/api.md`](../docs/api.md), 데이터는 [`docs/ERD.md`](../docs/ERD.md).

## 켜기

```bash
cd backend
npm install
npm run dev            # 빌드 + 실행 → http://localhost:3001/docs
```

- DB: `DATABASE_URL` 이 없으면 **PGlite**(설치 없는 PostgreSQL 17.5)를 `.data/pglite/` 에 만든다. 무대 · 팀 통합은 PostgreSQL 17 —
  접속 계정은 **DB 소유자**로 (회차마다 스키마를 만든다: `createdb -U postgres gaussx` 후 `postgres://postgres:…@127.0.0.1:5432/gaussx`)
- 처음 켜면 데모 데이터(지난 일주일 작업 6건 + 오늘 작업 3건 · 태그 · 도면)가 든 회차를 만든다 — 프론트 목업과 같은 내용
- 프론트를 붙이려면 `frontend/.env.local` 에 `NEXT_PUBLIC_API_BASE_URL=http://localhost:3001` (휴대폰은 노트북 IP — 서버가 켜질 때 찍어 준다)

| 환경 변수 | 기본값 | |
|---|---|---|
| `DATABASE_URL` | (없음 → PGlite) | `postgres://user:pw@127.0.0.1:5432/gaussx` |
| `PORT` | `3001` | |
| `SCENE_DIR` | `scenes/dev` | 현장 · 구역 · 단말 · 로봇 대기 위치 · 사전 계산표 · 데모 데이터 |
| `FILES_DIR` | `.data/files` | 올린 사진 · 허가서 · 도면 (회차별 폴더) |
| `COMPUTE_URL` | `http://127.0.0.1:8766` | 계산 서비스(경로 계획 + MuJoCo). `off` 면 사전 계산표만 |
| `PGLITE_DIR` | `.data/pglite` | `memory://` 면 메모리 |
| `GATEWAYS_FILE` | `.data/gateways.json` | 관리자 화면 '수신기 배치' · 1m 보정으로 바꾼 비콘 수신기 설정 (씬 값 위에 덮어쓴다) |

`.env.example` 을 `.env` 로 복사해 쓴다 (`.env` 는 커밋하지 않는다).

## 데모 리셋 = 새 회차

화면의 '데모 리셋'(`POST /api/debug/reset`)은 **기록을 지우지 않는다.** 새 PostgreSQL 스키마(`gx_20261105_142101`)에 새 회차를 만들고
데모 데이터를 넣은 뒤 그쪽으로 옮긴다. 지난 회차는 자기 스키마에 그대로 남는다 (`GET /api/debug/sessions`).
무대 직전에 서버를 켜지 않고 만들 때: `npm run session:new -- "11/5 본 무대"`.

## 비콘 구역 (⚠️ 잠정 — 팀 합의 전)

구역마다 둔 수신기(폰)가 헬멧 비콘(작업자 폰)을 듣고 1초마다 `POST /api/gateway` 로 보낸다 → 서버 메모리에서 '누가 어느 구역 안에 있나' 판정 →
쓰러짐 알림의 구역에 쓴다 (`zoneSource: "beacon"`). 수신기가 두 대면 헬멧 위치를 계산해 수신기 화면 레이더로 돌려준다.
API · 판정 값은 [`docs/api.md`](../docs/api.md) '비콘 구역 · 레이더', 폰 앱은 [`android/`](../android/README.md).
단말 · 수신기 · 판정 값은 씬 `demo.json` 의 `devices[].beacon_id` · `gateways` · `locate`. 폰은 `http://노트북IP:3001` 로 보낸다 (서버는 0.0.0.0 에서 듣는다 —
Windows 방화벽이 Node.js 를 막으면 '개인 네트워크' 허용).
수신기 자리 · 구역 · 1m 세기는 웹 관리자 화면 **수신기 배치**(`/admin/receivers`)에서 바꾼다 → `.data/gateways.json` 에 남는다 (씬 파일은 그대로).
폰 없이 시험: 백엔드를 켠 채 `npm run sim:gateways` — 수신기 두 대를 흉내 내 관제 화면 평면도에 헬멧이 돈다 (실제 수신기 폰과 같이 켜지 않는다).

## 구조

```
backend/
├── db/migrations/0000_init.sql   스키마 원본 (ERD v5). 회차마다 이 파일을 넣는다
├── db/migrations/0001_beacon.sql 비콘 구역 (v5.1 · ⚠️ 잠정)
├── scenes/dev/demo/              개발용 씬: demo.json · robot_home.json · routes.json · seed.json (프론트 목업과 같은 바닥 4×3m)
├── scripts/gen-dev-routes.mjs    개발용 routes.json 생성 (목업 경로 · 0.45m/s)
├── src/
│   ├── main.ts · app.ts          부트스트랩 · 검증 · 오류 → 400 한국어 · CORS · Swagger(/docs) · 파일(/media)
│   ├── config/                   환경 변수 · 씬 파일 읽기 · 설정 테이블 반영
│   ├── db/                       pg / PGlite · 회차(스키마) · 마이그레이션 · 이벤트 · DB 오류 메시지
│   ├── domain/                   DB 행 → API 모양(camelCase) · 범위 · KST 날짜 규칙
│   ├── seed/                     데모 데이터 넣기
│   ├── tags/ works/ alerts/ drawings/ state/ debug/ media/   API
│   ├── dispatch/                 로봇 출동 (계산 서비스 → 사전 계산표 → 도착 타이머 → 재시작 복구)
│   ├── locate/                   비콘 구역 판정 · 수신기 두 대 레이더 위치 (1초 보고 → 메모리, 위치 이력 없음)
│   └── compute/                  계산 서비스 호출 (route 1초 · simulate 5초 · health 10초)
└── test/                         node:test — DB 규칙 47 · A 흐름 · C 흐름 · 비콘 구역 · 레이더 · 도면 · 이력 · 리셋 · 재시작 (96개)
```

## 규칙

- **스키마는 SQL 이 원본.** 바꿀 때는 `db/migrations/0001_….sql` 을 추가하고 `docs/ERD.md` 도 고친다. 코드가 테이블을 만들지 않는다
- **API 를 바꾸면 `docs/api.md` 먼저** (CONVENTION §5). 응답 모양은 `frontend/src/lib/types.ts` 와 같게
- 상태 변경 + 이벤트 = 한 트랜잭션: `db.tx(async (q) => { …; await events.log(q, {…}) })`. 콜백 안에서는 넘겨받은 `q` 만 쓴다
- DB 가 막은 쓰기는 400 + 한국어 `message` (`src/db/db-error.filter.ts`). 화면 말투(해요체)로
- 서버 프로세스는 하나 (진행 중 출동이 메모리에 있다)

## 테스트

```bash
npm test               # 빌드 + 96개 (약 15초). DB 는 PGlite
TEST_DATABASE_URL=postgres://…/빈DB npm test   # DB 규칙 테스트를 설치한 PostgreSQL 로
```

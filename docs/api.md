# API 약속 (프론트 ↔ 백)

> v1 · 2026-10-12 · 바꾸기 전에 이 파일부터 고친다
> 기준: 프론트 목업(`frontend/src/app/api/*` · `frontend/src/lib/server/store.ts`)이 정한 계약을 백엔드(`backend/`)가 **그대로** 구현했다.
> 응답 모양 = `frontend/src/lib/types.ts`. ⚠️ = 10/14 중간점검에서 팀 확인

## 연결

```bash
# frontend/.env.local — 비워 두면 Next 목업(/api/*), 넣으면 NestJS
NEXT_PUBLIC_API_BASE_URL=http://localhost:3001
```

| | |
|---|---|
| 주소 | `{NEXT_PUBLIC_API_BASE_URL}/api/…` (백엔드 기본 포트 3001 · CORS 허용) |
| 키 | **camelCase** (DB 는 snake_case, 백엔드가 바꾼다) |
| 시각 | ISO 문자열(UTC). 날짜 계산(오늘 · 하루 경계)은 **KST** |
| 오류 | 400 · 404 + `{ "message": "한국어 안내" }` — 화면이 그대로 보여준다. 목업과 같은 문장 |
| 문서 | 백엔드를 켜고 `http://localhost:3001/docs` (직접 호출해 볼 수 있다) |

## 목록

**읽기** (폴링)

| 메서드 · 경로 | 응답 (`types.ts`) | 메모 |
|---|---|---|
| GET `/api/state` | `StateResponse` | 구역 색 · 작업(진행) · 현재 태그 · 최근 알림 10 · 마지막 출동 · 로봇 · 오늘 타임라인 30 |
| GET `/api/card?device=` · `?work=` | `CardResponse` | `device` = 그 단말이 **가장 최근에 받은** 작업, `work` = 작업 하나(관리자 미리보기). ⚠️ 카드 주소 방식 |
| GET `/api/inbox?device=` | `InboxResponse` | 열린 작업 + 오늘 끝나거나 취소된 작업 (최근 순) |
| GET `/api/work/{id}` | `WorkDetailResponse` | 작업 상세: 확인 결과 · 알림 · 출동 · 기록 · 도면 |
| GET `/api/tags` | `TagsResponse` | 현재 버전 · 예전 버전 · 작업별로 쓴 버전 |
| GET `/api/drawings` | `DrawingsResponse` | |
| GET `/api/drawing/file?id=` | 파일 | 올린 도면. CAD 원본은 내려받기(attachment) |
| GET `/api/history?day=&cat=&zone=&work=&q=` | `HistoryResponse` | `day` = `YYYY-MM-DD` · `today` · `all`, `cat` = `work,check,alert,robot,tag,system` |

**쓰기** (본문 JSON, 응답 = 바뀐 대상)

| 메서드 · 경로 | 본문 | 응답 | 규칙 |
|---|---|---|---|
| POST `/api/tag` | `{ zoneId, title, substance, hazard, emergencyNote, equipmentState, official, x, y, checkItems[] }` | `Tag` | 이름 · 위험 문구 필수, 확인 항목 1개 이상 |
| POST `/api/tag/revise` | `{ tagId, patch }` | `Tag` (새 버전) | 고치면 **새 버전**(새 id). 예전 버전은 superseded, 이미 보낸 작업은 예전 버전 유지 |
| POST `/api/tag/verify` | `{ tagId }` | `Tag` | 미확인 → 공식. 한 번, 되돌리지 않는다 |
| POST `/api/work` | `{ title, zoneId, deviceId, tagIds, permitName, permitStart, permitEnd }` | `Work` | 현재 버전 태그만. 번호(`W-001`)는 DB 가 매긴다 |
| POST `/api/card/opened` | `{ workId }` | `Work` | 처음 열 때 published → opened |
| POST `/api/confirm` | `{ workId, checkItemId, value, photo }` | `Confirmation` | 되돌리지 않는다. 첫 확인 = 체크인. **정상 범위 밖이면 저장하지 않고 측정 이상 알림 + 400** |
| POST `/api/work/complete` | `{ workId }` | `Work` | 작업 시작. 필수 항목 다 했을 때만, **한 단말에서 작업 중은 1건** |
| POST `/api/work/end` | `{ workId }` | `Work` | 작업 중일 때 |
| POST `/api/work/cancel` | `{ workId, reason }` | `Work` | 시작 전만, 사유 필수 |
| POST `/api/event` | `{ source, deviceId?, zoneId? }` | `Alert` | 쓰러짐. `source` = `sos_button` · `accel` · `operator` · `debug`. 구역: zoneId → 그 단말의 작업 중 구역 → 불명. **알림과 동시에 로봇 출발**, 못 가면 `status: "no_robot"` + `robotUnavailable` |
| POST `/api/alert/ack` | `{ alertId }` | `Alert` | 관제 확인 (기록용 · 출동 조건 아님) |
| POST `/api/alert/resolve` | `{ alertId, resolution }` | `Alert` | `handled` · `false_alarm`. 가는 중인 로봇은 멈추고 대기 위치로 |
| POST `/api/alert/human` | `{ alertId }` | `Alert` | 안전관리자 출동 지시 (관제 확인도 함께) |
| POST `/api/robot/mode` | `{ mode }` | `{ mode, battery, available }` | `ready` · `charging` · `maintenance` · `offline` |
| POST `/api/drawing` | `{ title, kind, dwgNo, revision, zoneIds, equipment, fileName, mime, dataBase64 }` | `Drawing` | 20MB 까지 (목업 3MB) |
| POST `/api/debug/reset` | — | `{ ok, session }` | 데모 리셋 (아래) |

## 목업과 다른 점 (백엔드만의 것)

| | 목업 | 백엔드 | 프론트가 할 일 |
|---|---|---|---|
| 데모 리셋 | 메모리를 지우고 다시 만든다 | **기록은 지우지 않는다**: 새 회차(DB 스키마)를 만들어 데모 데이터를 넣고 그쪽으로 옮긴다. 지난 회차는 그대로 남는다 | 없음 (화면은 똑같이 처음 상태) |
| 확인 사진 · 작업허가서 | 파일 **이름만** 보낸다 | 이름만 와도 받는다(임시 · 증빙 안 됨). **파일 내용을 data URL 로 보내면 저장**: `confirm.photo = "data:image/jpeg;base64,…"`, `work.permitFile = "data:application/pdf;base64,…"` | ⚠️ 데모 전에 `FileReader.readAsDataURL` 로 바꾸면 사진이 실제로 남는다 (`photo` 응답 = 파일 주소) |
| 올린 파일 주소 | `/api/drawing/file?id=` (같은 주소) | 백엔드 **절대 주소** (`http://노트북IP:3001/…`) — 프론트가 다른 주소에서 돌기 때문. 데모 도면(`/drawings/*.svg`)은 프론트 파일이라 그대로 | 없음 |
| 로봇 경로 | 직선 경로표 (0.45m/s) | 계산 서비스(경로 계획 + MuJoCo) → 안 되면 **사전 계산표**(`backend/scenes/*/demo/routes.json`). 개발용 씬은 목업과 같은 경로 | 없음 |
| 출동 상태 | `moving` · `arrived` | + `planning`(경로 계산 중, 1초 이내) · `failed`(도달 실패) · `cancelled`(가는 중 알림 종료) | `dispatch.status === "moving"` 비교는 그대로 동작 |
| 이벤트 종류 | 22가지 | + `dispatch.failed`(도달 실패 → 사람 출동 필요) | `EVENT_LABEL` 에 한 줄 추가 권장 |

**더 있는 것**: `GET /api/devices` (단말 목록 — `lib/devices.ts` 를 바꿀 때) · `GET /api/config` · `GET /api/health` · `GET /api/debug/sessions` (회차 목록) ·
`POST /api/media` (multipart 업로드 → `mediaId`, `confirm.photoMediaId` 로) · 구역 · 태그 · 작업 · 알림 · 도면에 `siteId` (여러 현장 대비, SPEC v2 §8).

## 10/14 확인할 것 (⚠️)

1. 카드 주소: `?device=` = 내 작업 목록 / 가장 최근 작업, `?work=` = 카드 하나 — 지금 구현 그대로 갈지
2. 사진 · 허가서를 파일로 보낼지 (위 표). 현장 사진은 개인정보가 찍힐 수 있으니 보관 기간도 함께
3. `site_id` 는 들어갔다 (현장 1개). '현장 선택/전환' 화면이 생기면 API 에 `?site=` 를 더한다
4. 구역은 사각형 `rect` (임시). 3D 연동 때 다각형으로 — 백엔드는 이미 다각형으로 저장한다(`zone.polygon`)

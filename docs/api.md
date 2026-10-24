# API 약속 (프론트 ↔ 백)

> v1 · 2026-10-12 · v1.1 · 2026-10-18 비콘 구역 · v1.2 · 2026-10-20 수신기 두 대 레이더 · v1.3 · 2026-10-21 관제 평면도 헬멧 위치 · v1.4 · 2026-10-22 수신기 배치(관리자 화면) (⚠️ 잠정, 아래) · 바꾸기 전에 이 파일부터 고친다
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
| POST `/api/event` | `{ source, deviceId?, zoneId? }` | `Alert` | 쓰러짐. `source` = `sos_button` · `accel` · `operator` · `debug`. 구역: zoneId → 헬멧 비콘이 안에 있는 구역(아래 '비콘 구역') → 그 단말의 작업 중 구역 → 불명, 어디서 정했는지 `zoneSource`. **알림과 동시에 로봇 출발**, 못 가면 `status: "no_robot"` + `robotUnavailable` |
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
`POST /api/media` (multipart 업로드 → `mediaId`, `confirm.photoMediaId` 로) · 구역 · 태그 · 작업 · 알림 · 도면에 `siteId` (여러 현장 대비, SPEC v2 §8) ·
`POST /api/gateway` · `GET /api/locate` (비콘 구역, 아래).

## 비콘 구역 · 레이더 (v1.1 10/18 · v1.2 10/20 · ⚠️ 잠정 — 팀 합의 전)

헬멧 비콘(작업자 폰이 iBeacon 광고) → 구역마다 둔 수신기(폰) → 1초마다 백엔드에 보고 → 백엔드가 "누가 어느 수신기 구역 안에 있나"를 판정한다.
수신기가 **두 대**면 두 수신기까지의 어림 거리로 헬멧 위치를 계산해, 수신기 화면 레이더에 방향 · 거리를 보여 준다 (아래 '레이더').
판정 · 위치는 **서버 메모리에서만** 계산한다 (위치 이력을 남기지 않는다 — ERD 원칙 4). 쓰러짐 알림이 날 때 그 순간의 구역만 알림에 남는다 (`zoneSource: "beacon"`).
폰 앱: [`android/`](../android/README.md) (앱 하나 · 역할 둘)

| 메서드 · 경로 | 본문 → 응답 | 메모 |
|---|---|---|
| POST `/api/gateway` | `{ gatewayId, readings: [{ beaconId, rssi: number[], txPower? }] }` → `{ ok, gatewayId, zoneId, devices: Presence[], radar: Radar }` | 수신기가 1초마다. `beaconId` = `"uuid:major:minor"` (대소문자 · 앞자리 0 무관). 들린 게 없어도 보낸다(살아 있음). 모르는 수신기 → 400. `radar` = 이 수신기 기준 레이더 |
| GET `/api/radar?gateway=` | `Radar` | 수신기 하나 기준 레이더 (보고 응답의 `radar` 와 같다) |
| POST `/api/gateway/calibrate` | `{ gatewayId, beaconId?, reset? }` → `{ gatewayId, ref1mDbm, deviceId, label, samples, saved }` | 1m 보정: 헬멧을 수신기 1m 앞에 두고 부른다 → 최근 3초 세기를 그 수신기의 1m 세기로 **저장** (아래 수신기 설정과 같은 곳). `reset` = 씬 값으로. 들린 게 없으면 400 |
| GET `/api/gateways` | `GatewaySetting[]` | 관리자 화면 '수신기 배치': 수신기마다 자리 · 지키는 구역 · 1m 세기 + 연결 상태 |
| POST `/api/gateway/settings` | `{ gatewayId, zoneId?, x?, y?, ref1mDbm?, reset? }` → `GatewaySetting` | 수신기 자리(바닥 m) · 구역 · 1m 세기 바꾸기. 주지 않은 칸은 그대로, `ref1mDbm: null` = 자동, `reset` = 씬 값으로. 바로 쓴다 (구역 판정 · 레이더 · 관제) |
| GET `/api/locate` | `{ now, params, gateways, devices: (Presence + links[] + ranges[] + position), unknownBeacons }` | 현장 보정용: 수신기별 RSSI 중앙값 · 표본 수 · 어림 거리, 위치(바닥 좌표), 등록 안 된 비콘(30초 동안) |
| GET `/api/state` | + `presence: Presence[]` · `gateways: Gateway[]` | 관제 · 시연 평면도(`ZoneMap`)가 헬멧 위치 · 수신기를 그린다 (목업에는 없다 → 선택 필드) |
| GET `/api/devices` · `/api/config` | 단말에 `beaconId`, config 에 `gateways` · `locate` | |
| POST `/api/event` | 응답 `Alert` 에 `zoneSource` | 구역: `zoneId`(`request`) → **비콘이 안**(`beacon`) → 작업 중 구역(`work`) → 불명(`null`) |

- `Presence` = `{ deviceId, label, beaconId, state: "in" | "out" | "unknown", zoneId, gatewayId, rssi, since, lastSeen, pending: { kind: "enter" | "switch" | "exit", gatewayId, forS } | null, position: { x, y, err } | null }`
  — `position` = **바닥 m** (구역 · 태그 · 로봇과 같은 좌표) · 오차 반지름. 수신기 두 대가 들을 때만 (아래 '레이더'와 같은 계산)
- `Gateway` = `{ id, zoneId, label, x, y, online, lastReportAt, ref1mDbm, calibrated }` — `x · y` = 바닥 m (씬 `world`), `online` = `timeout_s` 안에 보고가 왔나
- `Radar` = `{ gatewayId, zoneId, zone: { id, name, polygon } | null, receivers: [{ id, label, x, y, online }], blips: [{ deviceId, label, beaconId, state, zoneId, distance, x, y, err, rssi, heardBy }] }`
  — 좌표는 **그 수신기 기준 m: `x` = 오른쪽, `y` = 앞(구역 쪽)**. `x · y` 는 두 수신기가 들을 때만, 아니면 `null` (거리만)

판정 값 — 씬 `demo.json` 의 `locate`. 현장에서 `/api/locate` 를 보며 고친다:

| 값 | 기본 | 뜻 |
|---|---|---|
| `window_s` | 1.5 | 이 시간 안의 RSSI 중앙값으로 본다 (튀는 값 무시) |
| `enter_dbm` | -70 | 이보다 센 채로 `hold_s` → 안 |
| `exit_margin_db` | 6 | `enter_dbm - 6` (-76) 보다 약한 채로 `hold_s` → 밖. 문턱 근처에서 깜빡이지 않게 |
| `switch_db` | 6 | 수신기가 여럿일 때: 다른 수신기가 이만큼 더 센 채로 `hold_s` → 구역 바뀜 |
| `hold_s` | 2 | 확정까지 기다리는 시간 |
| `timeout_s` | 4 | 어느 수신기에도 안 들린 지 이만큼 → 알 수 없음 |
| `path_loss_n` | 2.5 | 레이더 거리 어림: 감쇠 지수 (자유 공간 2, 실내 2.5~3.5) |
| `ref_1m_dbm` | null | 레이더 거리 어림: 1m 세기. null = 비콘이 알린 값(iBeacon txPower) → 없으면 -59 |

씬 설정: `devices[].beacon_id` · `gateways: [{ id, zone, label?, world?, ref_1m_dbm? }]` (구역마다 1대 이상) · `locate`.
개발용 씬 = 단말 1번 `…:1:1` · 단말 2번 `…:1:2` + 수신기 `gw-01` (0, 1.5) · `gw-02` (2, 1.5) = 1구역 아래쪽 양끝 (2m 간격, 구역을 바라본다).

**레이더** (수신기 두 대):

- 거리: 수신기마다 최근 3초 RSSI 의 상위 25% 지점 → `d = 10^((1m 세기 − RSSI) / (10 · path_loss_n))`. 실내에서는 ±50% 정도 틀린다 → 1m 보정 권장
- 1m 세기 순서: 수신기 값(관리자 화면 · 1m 보정 > `gateways[].ref_1m_dbm`) > `locate.ref_1m_dbm` > 비콘이 알린 값 > -59
- 수신기 설정(자리 · 구역 · 1m 세기)은 씬 값이 기본이고, 관리자 화면 · 1m 보정으로 바꾼 값은 백엔드 `.data/gateways.json`(`GATEWAYS_FILE`)에
  남아 재시작 · 데모 리셋 뒤에도 쓴다 (씬마다 · 바꾼 칸만). 바꾸면 이번 회차의 `anchor` 행도 같이 고친다
- `GatewaySetting` = `{ id, label, zoneId, x, y, z, ref1mDbm, custom, defaults: { zoneId, x, y, z, ref1mDbm }, online, lastReportAt }` — `custom` = 씬 값에서 바꿨나
- 위치: 가까운 두 수신기의 거리 원이 만나는 점. 점이 둘(두 수신기를 잇는 선의 앞뒤)이면 **구역 가운데 쪽**을 고른다
  → 두 수신기는 구역 한쪽 끝에 나란히, 구역을 바라보게 둔다 (`world` = 실제로 잰 자리). 원이 안 만나면 선 위의 가장 가까운 점
- 위치는 1.5초 정도로 부드럽게 따라가고(5초 넘게 끊기면 새로 잡는다), 오차 반지름 `err` ≈ 0.3 + 0.35 × 평균 거리
- 수신기 하나만 들으면 그 수신기 기준 거리만 (`x · y = null`). 세 대 이상이면 가까운 두 대만 쓴다 (셋 다 쓰는 계산은 로드맵)

⚠️ 합의할 것: ① 범위 — 10/10 · SPEC v2 에서 헬멧 · 실시간 위치는 로드맵이었다 ② 쓰러짐 구역 순서 (비콘 > 작업 중 구역)
③ 관제 · 시연 평면도에 헬멧 위치를 넣었다 (10/21) — [웹] 확인 필요 ④ 레이더 시연 = 폰 세 대 (헬멧 1 + 수신기 2),
구역 안/밖만이면 두 대 ⑤ 거리는 어림값 (±50%) — 발표에서 '정밀 위치'라고 하지 않는다

## 10/14 확인할 것 (⚠️)

1. 카드 주소: `?device=` = 내 작업 목록 / 가장 최근 작업, `?work=` = 카드 하나 — 지금 구현 그대로 갈지
2. 사진 · 허가서를 파일로 보낼지 (위 표). 현장 사진은 개인정보가 찍힐 수 있으니 보관 기간도 함께
3. `site_id` 는 들어갔다 (현장 1개). '현장 선택/전환' 화면이 생기면 API 에 `?site=` 를 더한다
4. 구역은 사각형 `rect` (임시). 3D 연동 때 다각형으로 — 백엔드는 이미 다각형으로 저장한다(`zone.polygon`)

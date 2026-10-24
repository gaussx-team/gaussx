// 화면 ↔ 서버 공용 타입. 이름은 ERD v3 기준(camelCase). 백엔드와 다르면 docs/api.md 에서 맞춘다.

export type Needs = "none" | "value" | "photo";

export interface CheckItem {
  id: number;
  tagId: number;
  seq: number;
  item: string;
  needs: Needs;
  unit?: string | null;
  required: boolean; // 필수면 체크해야 "작업 시작" 가능
  min?: number | null; // 측정값 정상 범위
  max?: number | null;
  maxExclusive?: boolean | null; // true면 최대값 '미만' (법정 기준이 대부분 "~미만" 표현)
}

export type EquipmentState =
  | "running"
  | "stopped"
  | "valve_open"
  | "valve_closed"
  | "deteriorated";

export interface Tag {
  id: number;
  zoneId: string;
  title: string; // 설비 번호 포함 (예: "배관 P-203")
  substance?: string | null;
  hazard: string; // 카드에 크게 나오는 한 줄
  emergencyNote?: string | null; // 사고 시 구조자용 주의
  equipmentState: EquipmentState;
  official: boolean;
  verifiedBy?: string | null;
  verifiedAt?: string | null; // 미검증 → 공식 승인 시각
  version: number; // 수정하면 새 줄(새 id)로 버전 +1, 예전 줄은 superseded 로 남는다
  replacesId?: number | null; // 이 버전이 대체한 이전 버전 id
  supersededAt?: string | null;
  x: number; // 바닥 좌표(m) — 3D 연동 전 임시
  y: number;
  status: "active" | "superseded";
  checkItems: CheckItem[];
  createdAt: string;
}

export interface Zone {
  id: string;
  name: string;
  rect: [number, number, number, number]; // x, y, w, h (m) — 화면 표시용
}

export type WorkStatus = "published" | "opened" | "confirmed" | "ended" | "cancelled";

export interface Work {
  id: number;
  code: string; // "W-001"
  title: string;
  zoneId: string;
  deviceId: string; // 로그인 없음 → 기기 ID
  status: WorkStatus;
  tagIds: number[];
  permitName?: string | null; // 작업허가서 PDF (목업은 파일 이름만)
  permitStart?: string | null;
  permitEnd?: string | null;
  publishedAt: string;
  openedAt?: string | null;
  checkedInAt?: string | null; // 첫 체크 = 체크인
  confirmedAt?: string | null; // 확인 완료 = 작업 시작
  endedAt?: string | null;
  cancelledAt?: string | null; // 작업 시작 전 취소
  cancelReason?: string | null;
}

export interface Confirmation {
  id: number;
  workId: number;
  tagId: number;
  checkItemId: number;
  value?: number | null;
  photo?: string | null;
  deviceId: string;
  confirmedAt: string;
}

export type AlertSource = "sos_button" | "accel" | "operator" | "debug" | "reading";
// no_robot: 로봇이 못 감 (충전·점검·오프라인·다른 출동·구역 불명) → 사람 출동 필요
// open: 측정 이상처럼 로봇 출동이 없는 알림
export type AlertStatus = "dispatched" | "arrived" | "no_robot" | "open" | "resolved";

// 측정 이상: 정상 범위를 벗어난 값이 들어왔을 때 남는 기록 (확인으로는 저장되지 않음)
export interface AbnormalReading {
  tagId: number;
  tagTitle: string;
  checkItemId: number;
  item: string;
  value: number;
  unit?: string | null;
  range: string; // "18% 이상 23.5% 미만"
  recheckedValue?: number | null; // 이후 정상값으로 다시 확인된 값
  recheckedAt?: string | null;
}

export interface Alert {
  id: number;
  type: "fall" | "abnormal"; // 쓰러짐 / 측정 이상
  source: AlertSource;
  deviceId?: string | null;
  zoneId: string | null;
  workId?: number | null;
  status: AlertStatus;
  raisedAt: string;
  acknowledgedAt?: string | null; // 관제 확인 (출동 조건 아님, 기록용)
  resolvedAt?: string | null;
  resolution?: "handled" | "false_alarm" | null;
  robotUnavailable?: string | null; // 로봇이 못 간 이유
  humanDispatchedAt?: string | null; // 관제가 사람(안전관리자) 출동 지시한 시각
  reading?: AbnormalReading | null; // type=abnormal 일 때
}

export interface Dispatch {
  id: number;
  alertId: number;
  goalZoneId: string;
  computed: "live" | "precomputed";
  path: [number, number][];
  durationS: number;
  startedAt: string;
  endedAt?: string | null;
  // planning·failed·cancelled 는 백엔드만 보낸다 (경로 계산 중 / 도달 실패 → 사람 출동 / 가는 중 알림 종료)
  status: DispatchStatus;
}

export type DispatchStatus = "planning" | "moving" | "arrived" | "failed" | "cancelled";

export interface EventLog {
  seq: number;
  at: string;
  type: string;
  actor: string;
  text: string;
  workId?: number | null;
  alertId?: number | null;
}

export type ZoneWorkState = "none" | "planned" | "working" | "ended";

export interface ZoneView extends Zone {
  workState: ZoneWorkState;
  alert: boolean; // 열린 쓰러짐 알림
  warning: boolean; // 열린 측정 이상
}

export interface WorkView extends Work {
  done: number;
  total: number;
  requiredLeft: number;
}

export type RobotMode = "ready" | "charging" | "maintenance" | "offline";

export interface RobotView {
  x: number;
  y: number;
  state: "idle" | "moving" | "arrived";
  etaS: number | null;
  mode: RobotMode; // 운영 상태 (출동 가능 여부)
  battery: number; // %
  available: boolean; // 지금 알림이 오면 바로 출동할 수 있는지
}

// 헬멧 비콘 (⚠️ 잠정 — 백엔드만, 목업에는 없다). 구역 안/밖 판정 + 수신기 두 대가 들으면 바닥 위치
export interface Presence {
  deviceId: string;
  label: string;
  beaconId: string | null;
  state: "in" | "out" | "unknown"; // 수신기 구역 안 · 밖 · 신호 없음
  zoneId: string | null;
  gatewayId: string | null;
  rssi: number | null;
  since: string | null;
  lastSeen: string | null;
  position?: { x: number; y: number; err: number } | null; // 바닥 m (신호 세기로 어림 ±50%, 오차 반지름 err)
}

// 비콘 수신기 설정 (관리자 화면 '수신기 배치' — 백엔드만). 바꾸면 백엔드 .data/gateways.json 에 남는다
export interface GatewaySetting {
  id: string;
  label: string;
  zoneId: string; // 이 수신기가 지키는 구역
  x: number; // 바닥 m (실제로 놓은 자리)
  y: number;
  z: number;
  ref1mDbm: number | null; // 1m 세기 (dBm). null = 자동 (비콘이 알린 값)
  custom: boolean; // 씬 값에서 바꿨는지
  defaults: { zoneId: string; x: number; y: number; z: number; ref1mDbm: number | null };
  online: boolean;
  lastReportAt: string | null;
}

// 비콘 수신기 (구역에 둔 폰)
export interface GatewayView {
  id: string;
  zoneId: string;
  label: string;
  x?: number; // 바닥 m
  y?: number;
  online: boolean;
  lastReportAt: string | null;
}

export interface StateResponse {
  now: string;
  zones: ZoneView[];
  works: WorkView[];
  tags: Tag[];
  alerts: Alert[];
  dispatch: Dispatch | null;
  robot: RobotView;
  events: EventLog[];
  presence?: Presence[]; // 백엔드만 (헬멧 비콘)
  gateways?: GatewayView[];
}

export interface CardResponse {
  now: string;
  work: Work | null;
  zone: Zone | null;
  tags: Tag[];
  confirmations: Confirmation[];
  alert: Alert | null; // 열린 쓰러짐 알림 (SOS 화면)
  abnormal: Alert[]; // 이 작업의 열린 측정 이상
  robot: RobotView;
  drawings: Drawing[]; // 이 작업 구역·설비의 도면
}

export interface TagsResponse {
  zones: Zone[];
  tags: Tag[]; // 현재 버전
  history: Tag[]; // 이전 버전들
  works: Pick<Work, "id" | "code" | "tagIds">[]; // 어느 작업이 어느 버전을 썼는지
}

export interface WorkDetailResponse {
  now: string;
  work: WorkView;
  zone: Zone | null;
  tags: Tag[];
  confirmations: Confirmation[];
  alerts: Alert[];
  dispatches: Dispatch[];
  events: EventLog[];
  drawings: Drawing[];
}

export type EventCategory = "work" | "check" | "alert" | "robot" | "tag" | "system";

export interface HistoryEvent extends EventLog {
  category: EventCategory;
  zoneId: string | null;
  workCode: string | null;
}

export interface HistoryResponse {
  now: string;
  day: string; // 조회한 날짜 YYYY-MM-DD 또는 "all"
  today: string;
  events: HistoryEvent[];
  works: Pick<Work, "id" | "code" | "title">[];
  zones: Zone[];
}

// 작업자 단말의 '내 작업' 목록
export interface InboxResponse {
  now: string;
  deviceId: string;
  works: WorkView[]; // 열린 작업 + 오늘 끝난/취소된 작업 (최근 순)
  zones: Zone[];
  alert: Alert | null; // 이 단말의 열린 쓰러짐 알림
}

// 도면: CAD 원본(DWG/DXF)은 브라우저에서 바로 못 그려서 PDF·SVG·PNG 로 내보낸 파일을 보여주고, 원본은 내려받기만
export type DrawingKind = "floor" | "pid" | "electrical" | "other";

export interface Drawing {
  id: number;
  title: string;
  kind: DrawingKind;
  dwgNo?: string | null; // 도면 번호 (예: A-101)
  revision: string; // REV.B
  zoneIds: string[]; // 관련 구역
  equipment: string[]; // 관련 설비 번호 (예: P-203) — 태그 제목에 이 번호가 있으면 연결
  fileName: string;
  mime: string;
  url: string; // 보기 주소
  cad: boolean; // CAD 원본이면 true (보기 불가, 내려받기만)
  mapsToFloor: boolean; // 평면도 좌표(4×3m)와 같아서 태그 위치를 겹쳐 표시할 수 있음
  note?: string | null;
  uploadedAt: string;
  uploadedBy: string;
}

export interface DrawingsResponse {
  zones: Zone[];
  drawings: Drawing[];
}

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

export type WorkStatus = "published" | "opened" | "confirmed" | "ended";

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

export type AlertSource = "sos_button" | "accel" | "operator" | "debug";
// no_robot: 로봇이 못 감 (충전·점검·오프라인·다른 출동·구역 불명) → 사람 출동 필요
export type AlertStatus = "dispatched" | "arrived" | "no_robot" | "resolved";

export interface Alert {
  id: number;
  type: "fall";
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
  status: "moving" | "arrived";
}

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
  alert: boolean;
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


export interface StateResponse {
  now: string;
  zones: ZoneView[];
  works: WorkView[];
  tags: Tag[];
  alerts: Alert[];
  dispatch: Dispatch | null;
  robot: RobotView;
  events: EventLog[];
}

export interface CardResponse {
  now: string;
  work: Work | null;
  zone: Zone | null;
  tags: Tag[];
  confirmations: Confirmation[];
  alert: Alert | null;
  robot: RobotView;
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

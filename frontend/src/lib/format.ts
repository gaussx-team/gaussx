import type { AlertSource, CheckItem, EventCategory, Needs, RobotMode, RobotView, Work, WorkStatus } from "./types";

export const TZ = "Asia/Seoul";

export const fmtTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("ko-KR", {
        timeZone: TZ,
        hour: "2-digit",
        minute: "2-digit",
        second: "2-digit",
        hour12: false,
      })
    : "-";

export const minutesBetween = (from: string, to: string) =>
  Math.floor((new Date(to).getTime() - new Date(from).getTime()) / 60000);

export const WORK_STATUS_LABEL: Record<WorkStatus, string> = {
  published: "전송됨",
  opened: "열람",
  confirmed: "작업 중",
  ended: "종료",
  cancelled: "취소",
};

export const SOURCE_LABEL: Record<AlertSource, string> = {
  sos_button: "수동 SOS",
  accel: "자동 감지",
  operator: "관제 직접 출동",
  debug: "무대 트리거",
  reading: "측정값",
};

export const NEEDS_LABEL: Record<Needs, string> = {
  none: "체크",
  value: "측정값",
  photo: "사진",
};

export const EVENT_LABEL: Record<string, string> = {
  "tag.created": "태그 생성",
  "work.published": "작업 전송",
  "card.opened": "카드 열람",
  "work.checked_in": "체크인 (첫 확인)",
  "check.confirmed": "항목 확인",
  "check.rejected": "측정 이상값",
  "alert.abnormal": "측정 이상 알림",
  "tag.revised": "태그 수정",
  "tag.verified": "태그 승인",
  "work.cancelled": "작업 취소",
  "work.confirmed": "확인 완료 · 작업 시작",
  "work.ended": "작업 종료",
  "alert.raised": "쓰러짐 알림",
  "dispatch.started": "로봇 출동",
  "dispatch.arrived": "로봇 도착",
  "alert.acknowledged": "관제 확인",
  "alert.resolved": "알림 종료",
  "dispatch.unavailable": "로봇 출동 불가",
  "dispatch.human": "사람 출동 지시",
  "robot.mode": "로봇 상태 변경",
  "drawing.uploaded": "도면 등록",
  "session.reset": "리셋",
};

// 이벤트 종류 → 이력 필터 분류
export const eventCategory = (type: string): EventCategory => {
  const head = type.split(".")[0];
  if (head === "work" || head === "card") return "work";
  if (head === "check") return "check";
  if (head === "alert") return "alert";
  if (head === "dispatch" || head === "robot") return "robot";
  if (head === "tag") return "tag";
  return "system";
};

export const CATEGORY_LABEL: Record<EventCategory, string> = {
  work: "작업",
  check: "확인",
  alert: "알림",
  robot: "로봇",
  tag: "태그",
  system: "시스템",
};

export const CATEGORY_STYLE: Record<EventCategory, string> = {
  work: "bg-blue-50 text-blue-700",
  check: "bg-emerald-50 text-emerald-700",
  alert: "bg-red-50 text-red-700",
  robot: "bg-orange-50 text-orange-700",
  tag: "bg-violet-50 text-violet-700",
  system: "bg-slate-100 text-slate-600",
};

const WEEK = ["일", "월", "화", "수", "목", "금", "토"];

// 화면의 날짜·시간은 기기 시간대와 상관없이 한국 시간(KST)으로 고정한다 (서버 dayKey 와 같은 기준)
const KST_MS = 9 * 3_600_000;
// KST 벽시계 값을 UTC 필드로 읽을 수 있게 옮긴 Date
const kstParts = (iso: string) => new Date(new Date(iso).getTime() + KST_MS);
const pad = (n: number) => String(n).padStart(2, "0");

// "10월 11일 (일)" — YYYY-MM-DD 키도 받는다
export const fmtDay = (isoOrKey: string) => {
  const d = isoOrKey.length === 10 ? new Date(`${isoOrKey}T00:00:00Z`) : kstParts(isoOrKey);
  return `${d.getUTCMonth() + 1}월 ${d.getUTCDate()}일 (${WEEK[d.getUTCDay()]})`;
};

// "10/11 14:05"
export const fmtShort = (iso?: string | null) => {
  if (!iso) return "-";
  const d = kstParts(iso);
  return `${d.getUTCMonth() + 1}/${d.getUTCDate()} ${pad(d.getUTCHours())}:${pad(d.getUTCMinutes())}`;
};

// KST 날짜 키 YYYY-MM-DD
export const localDayKey = (iso: string) => kstParts(iso).toISOString().slice(0, 10);

// YYYY-MM-DD 에서 n일 이동
export const shiftDay = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// "14:30" (KST 오늘) → ISO
export const kstTodayAt = (hhmm: string) => new Date(`${localDayKey(new Date().toISOString())}T${hhmm}:00+09:00`).toISOString();

// CSV 등 전체 표기 "2026-10-11 14:05:09"
export const fmtFull = (iso: string) => kstParts(iso).toISOString().slice(0, 19).replace("T", " ");

export const secondsBetween = (from: string, to: string) => Math.round((new Date(to).getTime() - new Date(from).getTime()) / 1000);

export const fmtDuration = (sec: number) => {
  if (sec < 60) return `${sec}초`;
  const m = Math.floor(sec / 60);
  if (m < 60) return `${m}분`;
  return `${Math.floor(m / 60)}시간 ${m % 60}분`;
};

export const ROBOT_MODE_LABEL: Record<RobotMode, string> = {
  ready: "출동 대기",
  charging: "충전 중",
  maintenance: "점검 중",
  offline: "연결 끊김",
};

// 로봇 상태 한 줄 (대시보드·관제·시연 공용)
export const robotSummary = (r: RobotView) =>
  r.state === "moving" ? `출동 중 · ${r.etaS}초 남음` : r.state === "arrived" ? "현장 도착" : r.mode === "ready" ? "출동 대기" : `${ROBOT_MODE_LABEL[r.mode]} · 출동 불가`;


// 측정값 정상 범위 문구: "18% 이상 23.5% 미만", "0V", "10%LEL 미만"
export const fmtRange = (c: Pick<CheckItem, "min" | "max" | "maxExclusive" | "unit">) => {
  const u = c.unit ?? "";
  if (c.min != null && c.max != null && c.min === c.max) return `${c.min}${u}`;
  const parts: string[] = [];
  if (c.min != null && !(c.min === 0 && c.max != null)) parts.push(`${c.min}${u} 이상`);
  if (c.max != null) parts.push(`${c.max}${u} ${c.maxExclusive ? "미만" : "이하"}`);
  return parts.join(" ");
};

// 정상 범위 안인지 (최소는 이상, 최대는 이하 또는 미만)
export const inRange = (c: Pick<CheckItem, "min" | "max" | "maxExclusive">, v: number) =>
  !(c.min != null && v < c.min) && !(c.max != null && (c.maxExclusive ? v >= c.max : v > c.max));

// 작업 경고: 카드 미확인(전송 후 UNSEEN_MIN분), 허가 시간 초과. 서버 시각(now) 기준으로 화면이 계산
export const UNSEEN_MIN = 5;
export function workWarnings(w: Pick<Work, "status" | "publishedAt" | "permitEnd">, nowIso: string) {
  if (w.status === "ended" || w.status === "cancelled") return [] as { kind: "unseen" | "permit"; text: string }[];
  const out: { kind: "unseen" | "permit"; text: string }[] = [];
  const unseen = minutesBetween(w.publishedAt, nowIso);
  if (w.status === "published" && unseen >= UNSEEN_MIN) out.push({ kind: "unseen", text: `카드 미확인 ${unseen}분` });
  if (w.permitEnd && nowIso > w.permitEnd) out.push({ kind: "permit", text: `허가 시간 초과 ${minutesBetween(w.permitEnd, nowIso)}분` });
  return out;
}

export const isOpen = (w: Pick<Work, "status">) => w.status !== "ended" && w.status !== "cancelled";

export const DRAWING_KIND_LABEL: Record<import("./types").DrawingKind, string> = {
  floor: "평면도",
  pid: "배관 계통도(P&ID)",
  electrical: "전기 단선도",
  other: "기타",
};

// 태그 제목에 들어 있는 설비 번호로 도면을 찾는다 (태그가 새 버전이 돼도 연결 유지)
export const drawingMatchesTag = (d: { equipment: string[] }, tagTitle: string) => d.equipment.find((code) => tagTitle.includes(code)) ?? null;

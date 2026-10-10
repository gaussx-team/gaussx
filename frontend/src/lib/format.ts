import type { AlertSource, EventCategory, Needs, RobotMode, RobotView, WorkStatus } from "./types";

export const fmtTime = (iso?: string | null) =>
  iso
    ? new Date(iso).toLocaleTimeString("ko-KR", {
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
};

export const SOURCE_LABEL: Record<AlertSource, string> = {
  sos_button: "수동 SOS",
  accel: "자동 감지",
  operator: "관제 직접 출동",
  debug: "무대 트리거",
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

// "10월 11일 (일)"
export const fmtDay = (isoOrKey: string) => {
  const d = new Date(isoOrKey.length === 10 ? `${isoOrKey}T00:00:00` : isoOrKey);
  return `${d.getMonth() + 1}월 ${d.getDate()}일 (${WEEK[d.getDay()]})`;
};

// "10/11 14:05"
export const fmtShort = (iso?: string | null) => {
  if (!iso) return "-";
  const d = new Date(iso);
  return `${d.getMonth() + 1}/${d.getDate()} ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
};

// 브라우저 로컬 날짜 키 YYYY-MM-DD
export const localDayKey = (iso: string) => new Date(iso).toLocaleDateString("sv-SE");

// YYYY-MM-DD 에서 n일 이동
export const shiftDay = (key: string, n: number) => {
  const d = new Date(`${key}T00:00:00`);
  d.setDate(d.getDate() + n);
  return d.toLocaleDateString("sv-SE");
};

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

